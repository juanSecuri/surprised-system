"""CENTINELA · servicios: rate limiting, Telegram, reportes, tareas de fondo."""
import asyncio, json, logging, time
from collections import defaultdict, deque
from datetime import datetime, timezone
from fastapi import BackgroundTasks, HTTPException
import httpx
from .config import NODO, ROL, VERSION, INICIO, LATIDO_SEG, TELEGRAM_TOKEN, TELEGRAM_API, TELEGRAM_CHAT_ID, CATEGORIAS, CAMPANA_REPORTEROS, CAMPANA_VENTANA_MIN, log
from .db import pool, q, local, evento, guardar_reporte, ficha, marcar_db
from .utilidades import normalizar, hash_reportero, ip_tailscale, metricas, texto_ficha
from .ia import clasificar_con_ia, ollama_disponible

# ------ Rate limiting (defensa en profundidad) ------
_baldes: dict[str, defaultdict] = {}
def _exceso(cubeta: str, ip: str, maximo: int, ventana: int) -> bool:
    cola = _baldes.setdefault(cubeta, defaultdict(deque))[ip]
    ahora = time.time()
    while cola and ahora - cola[0] > ventana: cola.popleft()
    if len(cola) >= maximo: return True
    cola.append(ahora); return False

def limitar(ip: str, maximo=10, ventana=600):
    if _exceso("reportes", ip, maximo, ventana):
        raise HTTPException(429, "Demasiados reportes, intenta en unos minutos")

def telegram_enviar(texto: str, chat_id: str | int | None = None):
    destino = chat_id or TELEGRAM_CHAT_ID
    if not TELEGRAM_TOKEN or not destino: return
    try: httpx.post(f"{TELEGRAM_API}/bot{TELEGRAM_TOKEN}/sendMessage", json={"chat_id": destino, "text": texto, "disable_web_page_preview": True}, timeout=8)
    except Exception as e: log.warning("No se pudo enviar a Telegram: %s", e)

def detectar_campana(numero: str):
    try:
        with pool.connection(timeout=4) as conn:
            r = conn.execute("""select count(distinct coalesce(reportero, id::text)) unicos from reportes where numero=%s and creado > now() - (%s || ' minutes')::interval""", (numero, CAMPANA_VENTANA_MIN)).fetchone()
            unicos = r["unicos"] if r else 0
            if unicos < CAMPANA_REPORTEROS: return
            ya = conn.execute("""select 1 from eventos where tipo='campana' and detalle like %s and creado > now() - interval '60 minutes' limit 1""", ("%" + numero + "%",)).fetchone()
            if ya: return
            conn.execute("insert into eventos (nodo, tipo, detalle) values (%s,'campana',%s)", (NODO, f"Campaña activa: {numero} · {unicos} personas en {CAMPANA_VENTANA_MIN} min"))
        f = ficha(numero)
        telegram_enviar(f"🚨 CAMPAÑA ACTIVA\n{numero} — {unicos} reportes de personas distintas en {CAMPANA_VENTANA_MIN} min.\nRiesgo {f.get('score')}/100 ({f.get('nivel')}). Bloquéalo y avisa a tus contactos.")
    except Exception as e: log.warning("Detección de campaña falló: %s", e)

def registrar_reporte(numero_raw: str, categoria, descripcion, canal: str, reportero: str, bg: BackgroundTasks) -> dict:
    limitar(reportero)
    numero = normalizar(numero_raw)
    cat = (categoria or "").lower().strip() or None
    if cat and cat not in CATEGORIAS: raise HTTPException(422, f"Categoría inválida. Usa: {', '.join(CATEGORIAS)}")
    p = {"numero": numero, "categoria": cat, "descripcion": (descripcion or "").strip() or None, "canal": canal, "reportero": hash_reportero(reportero), "nodo": NODO, "creado": datetime.now(timezone.utc).isoformat()}
    try:
        rid = guardar_reporte(p)
        if p["descripcion"] and not cat: bg.add_task(clasificar_con_ia, rid, numero, p["descripcion"])
        bg.add_task(detectar_campana, numero)
        return {"ok": True, "modo": "normal", "id": rid, "nodo": NODO, "numero": ficha(numero)}
    except Exception as e:
        log.warning("Guardando reporte en bandeja local: %s", e)
        with local() as c: c.execute("insert into pendientes (payload) values (?)", (json.dumps(p),))
        return {"ok": True, "modo": "degradado", "nodo": NODO, "mensaje": "Recibido. Se sincronizará con la nube apenas vuelva la conexión."}

def vaciar_bandeja() -> int:
    enviados = 0
    with local() as c:
        filas = c.execute("select id, payload from pendientes order by id limit 50").fetchall()
        for f in filas:
            try: guardar_reporte(json.loads(f["payload"])); c.execute("delete from pendientes where id=?", (f["id"],)); enviados += 1
            except Exception: break
    if enviados: evento("sincronizacion", f"{enviados} reportes pendientes enviados a la nube")
    return enviados

async def latido():
    import psutil, socket
    psutil.cpu_percent(interval=None)
    ip = ip_tailscale(); host = socket.gethostname()
    while True:
        m = metricas()
        try:
            await asyncio.to_thread(q, """insert into nodos (nombre, rol, ip_tailscale, hostname, cpu, ram, disco, temp, version, iniciado, ultimo_latido) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now()) on conflict (nombre) do update set rol=excluded.rol, ip_tailscale=excluded.ip_tailscale, hostname=excluded.hostname, cpu=excluded.cpu, ram=excluded.ram, disco=excluded.disco, temp=excluded.temp, version=excluded.version, iniciado=excluded.iniciado, ultimo_latido=now()""", (NODO, ROL, ip, host, m["cpu"], m["ram"], m["disco"], m["temp"], VERSION, INICIO))
            marcar_db(True)
        except Exception as e: marcar_db(False); log.warning("Latido no enviado (Supabase caída?): %s", e)
        await asyncio.sleep(LATIDO_SEG)

async def vigilar_ia():
    while True: await asyncio.to_thread(ollama_disponible, True); await asyncio.sleep(20)

async def sincronizador():
    while True:
        await asyncio.sleep(30)
        try: await asyncio.to_thread(vaciar_bandeja)
        except Exception as e: log.warning("Sincronización falló: %s", e)
