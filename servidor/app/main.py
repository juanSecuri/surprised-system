"""
CENTINELA · API del nodo
------------------------
Corre igual en JE (principal) y JP (respaldo). Ambos comparten la base de datos
en Supabase, así que cualquiera de los dos puede atender a los usuarios.
Si Supabase no responde, el nodo entra en MODO DEGRADADO: guarda los reportes en
SQLite local (bandeja de salida) y responde consultas desde su caché local; cuando
Supabase vuelve, sincroniza solo.
"""
import os, re, math, json, time, socket, sqlite3, hashlib, hmac, base64, struct, secrets, asyncio, logging, subprocess
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
import psutil
from fastapi import FastAPI, HTTPException, Request, Response, BackgroundTasks, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

VERSION = "1.4.0"
NODO = os.getenv("NODO_NOMBRE", "JE")
ROL = os.getenv("NODO_ROL", "principal")
DATABASE_URL = os.getenv("DATABASE_URL", "")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://centinela-ia:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")
LOCAL_DB = os.getenv("LOCAL_DB", os.path.join(os.path.dirname(os.path.abspath(__file__)), "local.db"))
SAL = os.getenv("SAL_HASH", "centinela")
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN", "")
TELEGRAM_API = os.getenv("TELEGRAM_API", "https://api.telegram.org")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")      # a quién avisar de llamadas reales
LLAMADAS_TOKEN = os.getenv("LLAMADAS_TOKEN", "")          # clave que usa el celular para avisar
# Neon (plan gratis) apaga la BD tras 5 min sin uso y cobra horas de cómputo:
# con Neon se late cada 15 min y no se dejan conexiones abiertas.
ES_NEON = "neon.tech" in DATABASE_URL
LATIDO_SEG = int(os.getenv("LATIDO_SEG", "900" if ES_NEON else "20"))
POOL_MIN = int(os.getenv("POOL_MIN", "0" if ES_NEON else "1"))
INICIO = datetime.now(timezone.utc)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("centinela")

CATEGORIAS = ["estafa", "telemarketing", "cobranza", "encuesta", "wangiri",
              "suplantacion", "extorsion", "otro"]

# Prefijos frecuentes en estafas de "llamada perdida" (wangiri) y tarificación premium
PREFIJOS_RIESGO = ["+225", "+233", "+234", "+216", "+232", "+222", "+882", "+883",
                   "+1268", "+1284", "+1473", "+1649", "+1767", "+1809", "+1829",
                   "+1849", "+1876"]
PAISES = {"+57": "Colombia", "+1": "EE. UU. / Caribe", "+52": "México", "+34": "España",
          "+44": "Reino Unido", "+51": "Perú", "+58": "Venezuela", "+593": "Ecuador",
          "+591": "Bolivia", "+56": "Chile", "+54": "Argentina", "+55": "Brasil",
          "+225": "Costa de Marfil", "+233": "Ghana", "+234": "Nigeria", "+216": "Túnez",
          "+232": "Sierra Leona", "+222": "Mauritania", "+882": "Red internacional",
          "+883": "Red internacional"}

# ---------------------------------------------------------------- utilidades

def normalizar(raw: str) -> str:
    """Convierte cualquier forma de escribir un número a E.164 (+57...)."""
    s = (raw or "").strip()
    internacional = s.startswith("+") or s.startswith("00")
    d = re.sub(r"\D", "", s)
    if s.startswith("00"):
        d = d[2:]
    if len(d) < 3 or len(d) > 15:
        raise HTTPException(422, "Número inválido")
    if not internacional:
        if len(d) == 10 and (d.startswith("3") or d.startswith("60")):
            d = "57" + d                      # celular o fijo colombiano
        elif len(d) <= 8:
            return d                          # código corto (SMS, líneas especiales)
    return "+" + d


def pais_de(numero: str) -> str:
    if not numero.startswith("+"):
        return "Código corto"
    for p in sorted(PAISES, key=len, reverse=True):
        if numero.startswith(p):
            return PAISES[p]
    return "Desconocido"


def prefijo_riesgo(numero: str) -> bool:
    return any(numero.startswith(p) for p in PREFIJOS_RIESGO)


def calcular_score(unicos: int, dias_desde_ultimo: float, numero: str, verificado: bool) -> int:
    if verificado:
        return 0
    s = 100 * (1 - math.exp(-0.35 * unicos))   # 1→30, 2→50, 3→65, 5→83
    if dias_desde_ultimo > 90:
        s *= 0.6
    elif dias_desde_ultimo > 30:
        s *= 0.85
    if prefijo_riesgo(numero):
        s += 25
    elif numero.startswith("+") and not numero.startswith("+57"):
        s += 10
    return int(min(100, round(s)))


def nivel_de(score: int) -> str:
    return "alto" if score >= 60 else "medio" if score >= 25 else "bajo"


def ip_cliente(req: Request) -> str:
    for h in ("x-real-ip", "cf-connecting-ip", "x-forwarded-for"):
        v = req.headers.get(h)
        if v:
            return v.split(",")[0].strip()
    return req.client.host if req.client else "?"


def hash_reportero(valor: str) -> str:
    return hashlib.sha256(f"{SAL}:{valor}".encode()).hexdigest()[:16]


def ip_tailscale() -> str:
    try:
        return subprocess.run(["tailscale", "ip", "-4"], capture_output=True,
                              text=True, timeout=3).stdout.strip().splitlines()[0]
    except Exception:
        return ""


def metricas() -> dict:
    temp = None
    try:
        sensores = psutil.sensors_temperatures()
        for clave in ("k10temp", "coretemp", "acpitz", "cpu_thermal"):
            if sensores.get(clave):
                temp = sensores[clave][0].current
                break
    except Exception:
        pass
    return {"cpu": psutil.cpu_percent(interval=None),
            "ram": psutil.virtual_memory().percent,
            "disco": psutil.disk_usage("/").percent,
            "temp": temp}

# ---------------------------------------------------------------- base de datos

pool = ConnectionPool(DATABASE_URL, min_size=POOL_MIN, max_size=4, max_idle=60, open=False,
                      kwargs={"row_factory": dict_row, "connect_timeout": 5,
                              "prepare_threshold": None}) if DATABASE_URL else None


def q(sql: str, params=(), uno=False, todos=False):
    """Ejecuta SQL en Supabase. Lanza excepción si la nube no responde."""
    if pool is None:
        raise RuntimeError("DATABASE_URL no configurada")
    with pool.connection(timeout=4) as conn:
        cur = conn.execute(sql, params)
        if uno:
            return cur.fetchone()
        if todos:
            return cur.fetchall()
        return None


_db_estado = {"ok": False, "t": time.time()}  # el latido lo actualiza al arrancar


def db_ok() -> bool:
    """Estado de la BD en caché: lo actualiza el latido, así /health responde al instante."""
    if time.time() - _db_estado["t"] < LATIDO_SEG + 10:
        return _db_estado["ok"]
    try:
        q("select 1", uno=True)
        ok = True
    except Exception:
        ok = False
    _db_estado.update(ok=ok, t=time.time())
    return ok


def local():
    c = sqlite3.connect(LOCAL_DB, timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("create table if not exists pendientes (id integer primary key autoincrement,"
              " payload text not null, creado text default current_timestamp)")
    c.execute("create table if not exists cache (numero text primary key, data text not null,"
              " actualizado text default current_timestamp)")
    return c


def evento(tipo: str, detalle: str = ""):
    try:
        q("insert into eventos (nodo, tipo, detalle) values (%s,%s,%s)", (NODO, tipo, detalle))
    except Exception:
        pass


def recalcular(conn, numero: str):
    r = conn.execute("""
        select count(*) total,
               count(distinct coalesce(reportero, id::text)) unicos,
               max(creado) ultimo, min(creado) primero,
               mode() within group (order by categoria) cat
        from reportes where numero = %s""", (numero,)).fetchone()
    n = conn.execute("select verificado from numeros where numero=%s", (numero,)).fetchone()
    dias = (datetime.now(timezone.utc) - r["ultimo"]).days if r["ultimo"] else 999
    score = calcular_score(r["unicos"], dias, numero, n["verificado"] if n else False)
    conn.execute("""update numeros set score=%s, nivel=%s, total_reportes=%s, reporteros_unicos=%s,
                    categoria_principal=%s, ultimo_reporte=coalesce(%s, ultimo_reporte),
                    primer_reporte=coalesce(%s, primer_reporte)
                    where numero=%s""",
                 (score, nivel_de(score), r["total"], r["unicos"], r["cat"], r["ultimo"], r["primero"], numero))


def guardar_reporte(p: dict) -> int:
    with pool.connection(timeout=4) as conn:
        conn.execute("insert into numeros (numero, pais) values (%s,%s) on conflict do nothing",
                     (p["numero"], pais_de(p["numero"])))
        rid = conn.execute("""insert into reportes (numero, categoria, descripcion, canal, reportero,
                              nodo, clasificado_por, creado)
                              values (%s,%s,%s,%s,%s,%s,%s, coalesce(%s::timestamptz, now()))
                              returning id""",
                           (p["numero"], p.get("categoria"), p.get("descripcion"), p["canal"],
                            p["reportero"], p["nodo"], "usuario" if p.get("categoria") else None,
                            p.get("creado"))).fetchone()["id"]
        recalcular(conn, p["numero"])
    return rid


def ficha(numero: str) -> dict:
    """Información completa de un número (desde Supabase, o caché local si está caída)."""
    try:
        n = q("select * from numeros where numero=%s", (numero,), uno=True)
        ult = q("""select categoria, descripcion, canal, creado from reportes where numero=%s
                   order by creado desc limit 5""", (numero,), todos=True)
        if n:
            data = {**n, "conocido": True, "ultimos_reportes": ult}
        else:
            s = calcular_score(0, 999, numero, False)
            data = {"numero": numero, "pais": pais_de(numero), "score": s, "nivel": nivel_de(s),
                    "total_reportes": 0, "reporteros_unicos": 0, "categoria_principal": None,
                    "resumen_ia": None, "verificado": False, "conocido": False, "ultimos_reportes": []}
        data = json.loads(json.dumps(data, default=str))
        with local() as c:
            c.execute("insert or replace into cache (numero, data) values (?,?)",
                      (numero, json.dumps(data)))
        data["modo"] = "normal"
        return data
    except Exception as e:
        log.warning("Supabase no disponible, usando caché local: %s", e)
        with local() as c:
            row = c.execute("select data from cache where numero=?", (numero,)).fetchone()
        if row:
            data = json.loads(row["data"])
        else:
            s = calcular_score(0, 999, numero, False)
            data = {"numero": numero, "pais": pais_de(numero), "score": s, "nivel": nivel_de(s),
                    "total_reportes": None, "conocido": False, "ultimos_reportes": []}
        data["modo"] = "degradado"
        return data

# ---------------------------------------------------------------- IA (Ollama)

_ollama_estado = {"ok": False, "t": 0.0}


def ollama_disponible(forzar=False) -> bool:
    if not forzar and time.time() - _ollama_estado["t"] < 60:
        return _ollama_estado["ok"]
    try:
        ok = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=2).status_code == 200
    except Exception:
        ok = False
    _ollama_estado.update(ok=ok, t=time.time())
    return ok


def ollama_chat(system: str, usuario: str, json_mode=False, timeout=90,
                temperatura=0.2, num_predict=220) -> str:
    # Límites para que la IA no consuma de más: contexto chico, respuesta corta,
    # y keep_alive para que el modelo se descargue solo cuando nadie lo usa.
    opciones = {
        "temperature": temperatura,
        "num_predict": num_predict,
        "num_ctx": int(os.getenv("OLLAMA_NUM_CTX", "1024")),
    }
    cuerpo = {"model": OLLAMA_MODEL, "stream": False, "options": opciones,
              "keep_alive": os.getenv("OLLAMA_KEEP_ALIVE", "10m"),
              "messages": [{"role": "system", "content": system},
                           {"role": "user", "content": usuario}]}
    if json_mode:
        cuerpo["format"] = "json"
    r = httpx.post(f"{OLLAMA_URL}/api/chat", json=cuerpo, timeout=timeout)
    r.raise_for_status()
    return r.json()["message"]["content"].strip()


def clasificar_con_ia(reporte_id: int, numero: str, descripcion: str):
    """Tarea en segundo plano: la IA lee la descripción y asigna categoría + resumen."""
    if not descripcion or not ollama_disponible():
        return
    try:
        system = ("Eres un analista antifraude telefónico en Colombia. Clasifica el reporte en UNA categoría:\n"
                  "- suplantacion: dicen ser de un banco, entidad, empresa o autoridad para pedir claves, códigos o datos\n"
                  "- estafa: premios falsos, inversiones, falsos familiares en apuros, ventas engañosas para robar dinero\n"
                  "- extorsion: amenazas, intimidación, exigen dinero bajo presión\n"
                  "- cobranza: cobran deudas o cuotas\n"
                  "- telemarketing: ofrecen productos, planes, créditos o servicios\n"
                  "- encuesta: encuestas o estudios de opinión\n"
                  "- wangiri: timbran una vez desde el extranjero para que devuelvas la llamada\n"
                  "- otro: nada de lo anterior\n"
                  'Responde SOLO JSON: {"categoria": "...", "resumen": "frase corta en español, sin punto final"}')
        res = json.loads(ollama_chat(system, f"Número: {numero}\nReporte: {descripcion}",
                                     json_mode=True, temperatura=0, num_predict=140, timeout=45))
        cat = res.get("categoria", "otro").lower().strip()
        cat = cat if cat in CATEGORIAS else "otro"
        with pool.connection(timeout=4) as conn:
            conn.execute("update reportes set categoria=%s, clasificado_por='ia' where id=%s and categoria is null",
                         (cat, reporte_id))
            conn.execute("update numeros set resumen_ia=%s where numero=%s",
                         (res.get("resumen", "")[:280], numero))
            recalcular(conn, numero)
    except Exception as e:
        log.warning("Clasificación IA falló: %s", e)

# ---------------------------------------------------------------- tareas de fondo

async def latido():
    psutil.cpu_percent(interval=None)
    ip = ip_tailscale()
    host = socket.gethostname()
    while True:
        m = metricas()
        try:
            await asyncio.to_thread(q, """
                insert into nodos (nombre, rol, ip_tailscale, hostname, cpu, ram, disco, temp, version,
                                   iniciado, ultimo_latido)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
                on conflict (nombre) do update set rol=excluded.rol, ip_tailscale=excluded.ip_tailscale,
                    hostname=excluded.hostname, cpu=excluded.cpu, ram=excluded.ram, disco=excluded.disco,
                    temp=excluded.temp, version=excluded.version, iniciado=excluded.iniciado,
                    ultimo_latido=now()""",
                (NODO, ROL, ip, host, m["cpu"], m["ram"], m["disco"], m["temp"], VERSION, INICIO))
            _db_estado.update(ok=True, t=time.time())
        except Exception as e:
            _db_estado.update(ok=False, t=time.time())
            log.warning("Latido no enviado (Supabase caída?): %s", e)
        await asyncio.sleep(LATIDO_SEG)


async def vigilar_ia():
    """Revisa en segundo plano si Ollama responde, para no hacer esperar a los usuarios."""
    while True:
        await asyncio.to_thread(ollama_disponible, True)
        await asyncio.sleep(20)


def vaciar_bandeja() -> int:
    enviados = 0
    with local() as c:
        filas = c.execute("select id, payload from pendientes order by id limit 50").fetchall()
        for f in filas:
            try:
                guardar_reporte(json.loads(f["payload"]))
                c.execute("delete from pendientes where id=?", (f["id"],))
                enviados += 1
            except Exception:
                break
    if enviados:
        evento("sincronizacion", f"{enviados} reportes pendientes enviados a la nube")
    return enviados


async def sincronizador():
    while True:
        await asyncio.sleep(30)
        try:
            await asyncio.to_thread(vaciar_bandeja)
        except Exception as e:
            log.warning("Sincronización falló: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if pool:
        pool.open(wait=False)
    local().close()
    await asyncio.to_thread(evento, "arranque", f"Nodo {NODO} ({ROL}) v{VERSION} iniciado")
    tareas = [asyncio.create_task(latido()), asyncio.create_task(sincronizador()),
              asyncio.create_task(vigilar_ia())]
    yield
    for t in tareas:
        t.cancel()
    await asyncio.to_thread(evento, "apagado", f"Nodo {NODO} detenido")
    if pool:
        pool.close()

# ---------------------------------------------------------------- API

app = FastAPI(title="Centinela API", version=VERSION, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
                   allow_methods=["*"], allow_headers=["*"],
                   expose_headers=["X-Centinela-Nodo"])


LIMITE_GLOBAL = int(os.getenv("LIMITE_GLOBAL", "150"))   # peticiones/min por IP a este nodo


@app.middleware("http")
async def guardia(request: Request, call_next):
    # Escudo por IP en el propio nodo: si el gateway cae o atacan por el Funnel directo,
    # ninguna IP puede inundar la API. /health y /ping quedan libres (los usa el clúster).
    if request.url.path not in ("/health", "/ping", "/"):
        if _exceso("global", ip_cliente(request), LIMITE_GLOBAL, 60):
            r = Response('{"error":"Demasiadas peticiones"}', status_code=429,
                         media_type="application/json")
            r.headers["Retry-After"] = "60"
            r.headers["X-Centinela-Nodo"] = NODO
            return r
    resp = await call_next(request)
    resp.headers["X-Centinela-Nodo"] = NODO
    return resp


# Rate limiting por IP, defensa en profundidad (el gateway ya filtra antes).
# Un balde por "cubeta" (global, reportes, chat) para que no se pisen entre sí.
_baldes: dict[str, defaultdict] = {}


def _exceso(cubeta: str, ip: str, maximo: int, ventana: int) -> bool:
    cola = _baldes.setdefault(cubeta, defaultdict(deque))[ip]
    ahora = time.time()
    while cola and ahora - cola[0] > ventana:
        cola.popleft()
    if len(cola) >= maximo:
        return True
    cola.append(ahora)
    return False


def limitar(ip: str, maximo=10, ventana=600):
    """Límite de reportes por IP (escrituras)."""
    if _exceso("reportes", ip, maximo, ventana):
        raise HTTPException(429, "Demasiados reportes, intenta en unos minutos")


class Reporte(BaseModel):
    numero: str = Field(..., max_length=25)
    categoria: str | None = None
    descripcion: str | None = Field(None, max_length=500)
    canal: str = Field("web", max_length=20)
    reportero_id: str | None = Field(None, max_length=64)   # p.ej. id de Telegram


class Chat(BaseModel):
    mensaje: str = Field(..., max_length=600)


@app.get("/")
def raiz():
    return {"servicio": "Centinela", "nodo": NODO, "rol": ROL, "version": VERSION}


@app.get("/ping")
def ping():
    return {"ok": True, "nodo": NODO}


@app.get("/health")
def health():
    with local() as c:
        pend = c.execute("select count(*) n from pendientes").fetchone()["n"]
    return {"ok": True, "nodo": NODO, "rol": ROL, "version": VERSION,
            "db": db_ok(), "ollama": ollama_disponible(), "pendientes": pend,
            "uptime_seg": int((datetime.now(timezone.utc) - INICIO).total_seconds()),
            **metricas()}


@app.get("/api/numero/{numero}")
def consultar(numero: str):
    return ficha(normalizar(numero))


# Detección de campañas activas: muchas personas distintas reportando el mismo número en poco tiempo
CAMPANA_REPORTEROS = int(os.getenv("CAMPANA_REPORTEROS", "3"))
CAMPANA_VENTANA_MIN = int(os.getenv("CAMPANA_VENTANA_MIN", "15"))


def detectar_campana(numero: str):
    """Si varias personas DISTINTAS reportan el mismo número en pocos minutos, es una
    campaña en curso: deja un evento en la bitácora y avisa por Telegram (una vez por hora)."""
    try:
        with pool.connection(timeout=4) as conn:
            r = conn.execute("""select count(distinct coalesce(reportero, id::text)) unicos
                                 from reportes
                                 where numero=%s and creado > now() - (%s || ' minutes')::interval""",
                             (numero, CAMPANA_VENTANA_MIN)).fetchone()
            unicos = r["unicos"] if r else 0
            if unicos < CAMPANA_REPORTEROS:
                return
            ya = conn.execute("""select 1 from eventos where tipo='campana' and detalle like %s
                                 and creado > now() - interval '60 minutes' limit 1""",
                             ("%" + numero + "%",)).fetchone()
            if ya:
                return
            conn.execute("insert into eventos (nodo, tipo, detalle) values (%s,'campana',%s)",
                         (NODO, f"Campaña activa: {numero} · {unicos} personas en {CAMPANA_VENTANA_MIN} min"))
        f = ficha(numero)
        telegram_enviar(f"🚨 CAMPAÑA ACTIVA\n{numero} — {unicos} reportes de personas distintas "
                        f"en {CAMPANA_VENTANA_MIN} min.\nRiesgo {f.get('score')}/100 ({f.get('nivel')}). "
                        f"Bloquéalo y avisa a tus contactos.")
    except Exception as e:
        log.warning("Detección de campaña falló: %s", e)


def registrar_reporte(numero_raw: str, categoria: str | None, descripcion: str | None, canal: str,
                      reportero: str, bg: BackgroundTasks) -> dict:
    """Núcleo compartido por la web, Telegram y el celular."""
    limitar(reportero)
    numero = normalizar(numero_raw)
    cat = (categoria or "").lower().strip() or None
    if cat and cat not in CATEGORIAS:
        raise HTTPException(422, f"Categoría inválida. Usa: {', '.join(CATEGORIAS)}")
    p = {"numero": numero, "categoria": cat, "descripcion": (descripcion or "").strip() or None,
         "canal": canal, "reportero": hash_reportero(reportero), "nodo": NODO,
         "creado": datetime.now(timezone.utc).isoformat()}
    try:
        rid = guardar_reporte(p)
        if p["descripcion"] and not cat:
            bg.add_task(clasificar_con_ia, rid, numero, p["descripcion"])
        bg.add_task(detectar_campana, numero)
        return {"ok": True, "modo": "normal", "id": rid, "nodo": NODO, "numero": ficha(numero)}
    except Exception as e:
        log.warning("Guardando reporte en bandeja local: %s", e)
        with local() as c:
            c.execute("insert into pendientes (payload) values (?)", (json.dumps(p),))
        return {"ok": True, "modo": "degradado", "nodo": NODO,
                "mensaje": "Recibido. Se sincronizará con la nube apenas vuelva la conexión."}


@app.post("/api/reportar")
def reportar(r: Reporte, request: Request, bg: BackgroundTasks):
    return registrar_reporte(r.numero, r.categoria, r.descripcion, r.canal,
                             r.reportero_id or ip_cliente(request), bg)


@app.get("/api/top")
def top(limite: int = 10):
    return q("""select numero, pais, score, nivel, total_reportes, categoria_principal, ultimo_reporte
                from numeros where verificado = false order by score desc, total_reportes desc
                limit %s""", (min(limite, 50),), todos=True)


@app.get("/api/recientes")
def recientes(limite: int = 15):
    return q("""select r.numero, r.categoria, r.canal, r.nodo, r.creado, n.nivel, n.score
                from reportes r join numeros n using (numero)
                order by r.creado desc limit %s""", (min(limite, 50),), todos=True)


@app.get("/api/stats")
def stats():
    gen = q("""select (select count(*) from numeros) numeros,
                      (select count(*) from reportes) reportes,
                      (select count(*) from reportes where creado > now() - interval '24 hours') reportes_24h,
                      (select count(*) from numeros where nivel = 'alto') alto_riesgo""", uno=True)
    gen["por_categoria"] = q("""select coalesce(categoria, 'sin clasificar') categoria, count(*) total
                                from reportes group by 1 order by 2 desc""", todos=True)
    gen["por_canal"] = q("select canal, count(*) total from reportes group by 1 order by 2 desc", todos=True)
    gen["por_dia"] = q("""select date_trunc('day', creado)::date dia, count(*) total from reportes
                          where creado > now() - interval '14 days' group by 1 order by 1""", todos=True)
    return gen


@app.get("/api/cluster")
def cluster():
    nodos = q("""select *, (ultimo_latido > now() - make_interval(secs => %s)) as online
                 from nodos order by nombre""", (LATIDO_SEG * 3,), todos=True)
    ev = q("select nodo, tipo, detalle, creado from eventos order by creado desc limit 15", todos=True)
    return {"atendido_por": NODO, "nodos": nodos, "eventos": ev, "ollama": ollama_disponible()}


RE_NUM = re.compile(r"(?:\+|00)?\d[\d\s\-().]{5,17}\d")


def respuesta_reglas(fichas: list, st: dict | None) -> str:
    if fichas:
        partes = []
        for f in fichas:
            emoji = {"alto": "🔴", "medio": "🟠", "bajo": "🟢"}.get(f.get("nivel"), "⚪")
            linea = f"{emoji} {f['numero']} ({f.get('pais')}): riesgo {f.get('nivel')} ({f.get('score')}/100)"
            if f.get("total_reportes"):
                linea += f", {f['total_reportes']} reportes"
                if f.get("categoria_principal"):
                    linea += f", mayormente {f['categoria_principal']}"
            elif f.get("conocido") is False:
                linea += ", sin reportes en la comunidad"
            partes.append(linea + ".")
        consejo = " Te recomiendo no contestar." if any(f.get("nivel") == "alto" for f in fichas) else ""
        return "\n".join(partes) + consejo
    base = ("Soy Centinela 🛡️. Envíame un número (ej. 3001234567 o +57 300 123 4567) y te digo si "
            "la comunidad lo ha reportado como spam o estafa.")
    if st:
        base += f" Hoy llevo {st['numeros']} números vigilados y {st['reportes_24h']} reportes en 24 h."
    return base


@app.post("/api/chat")
def chat(c: Chat):
    nums = []
    for m in RE_NUM.findall(c.mensaje)[:3]:
        try:
            nums.append(normalizar(m))
        except HTTPException:
            pass
    fichas = [ficha(n) for n in nums]
    try:
        st = q("""select (select count(*) from numeros) numeros,
                         (select count(*) from reportes where creado > now() - interval '24 hours') reportes_24h""",
               uno=True)
    except Exception:
        st = None
    if ollama_disponible():
        try:
            contexto = json.dumps({"numeros_consultados": fichas, "estadisticas": st},
                                  default=str, ensure_ascii=False)
            system = ("Eres Centinela, asistente de un sistema comunitario anti-spam telefónico en Colombia. "
                      "Tu ÚNICO tema son las llamadas, el spam, las estafas telefónicas y este sistema. "
                      "Responde en español, cálido y breve (máximo 4 líneas). Usa SOLO los datos del CONTEXTO "
                      "para hablar de números; nunca inventes reportes ni cifras. Si el riesgo es alto, "
                      "aconseja no contestar y bloquear. "
                      "Si te preguntan cualquier cosa que NO tenga que ver con llamadas o estafas telefónicas "
                      "(matemáticas, código, chistes, otros temas), responde exactamente: "
                      "'Solo puedo ayudarte con Centinela y la identificación de llamadas.' "
                      "Nunca pidas datos personales.")
            txt = ollama_chat(system, f"CONTEXTO: {contexto}\n\nUSUARIO: {c.mensaje}",
                              temperatura=0.3, num_predict=200)
            return {"respuesta": txt, "fuente": "ollama", "modelo": OLLAMA_MODEL, "nodo": NODO, "numeros": fichas}
        except Exception as e:
            log.warning("Ollama falló, respondo con reglas: %s", e)
    return {"respuesta": respuesta_reglas(fichas, st), "fuente": "reglas", "nodo": NODO, "numeros": fichas}


# ================================================================ Telegram y llamadas reales

EMOJI = {"alto": "🔴", "medio": "🟠", "bajo": "🟢"}
CONSEJOS = [
    "Tu banco nunca te pide claves ni el código que llega por SMS. Si te lo piden, cuelga.",
    "No devuelvas llamadas perdidas de números extranjeros: pueden cobrarte tarifa premium.",
    "Si te meten prisa (\"tu cuenta se bloquea hoy\"), es una señal de estafa. Cuelga y verifica.",
    "\"Tu familiar está detenido y necesita plata\": cuelga y llama tú a tu familiar.",
    "Reporta aunque no hayas caído: tres reportes ponen un número en riesgo alto para todos.",
]


def formato(n: str) -> str:
    m = re.match(r"^\+57(\d{3})(\d{3})(\d{4})$", n or "")
    return f"+57 {m[1]} {m[2]} {m[3]}" if m else (n or "")


def enmascarar(n: str) -> str:
    """Para la web pública: +57 300 ••• 4567 (protege a contactos legítimos)."""
    n = n or ""
    for pref in ("+57", "+1"):
        if n.startswith(pref) and len(n) >= len(pref) + 7:
            resto = n[len(pref):]
            return f"{pref} {resto[:3]} ••• {resto[-4:]}"
    return f"{n[:4]} ••• {n[-4:]}" if len(n) > 8 else "Número oculto"


CAT_TXT = {"estafa": "estafa", "suplantacion": "falso banco o entidad", "cobranza": "cobranza",
           "telemarketing": "ventas / telemarketing", "wangiri": "llamada perdida internacional",
           "extorsion": "extorsión", "encuesta": "encuesta", "otro": "otro"}


def texto_ficha(f: dict) -> str:
    nivel = f.get("nivel", "bajo")
    lineas = [f"{EMOJI.get(nivel, '⚪')} {formato(f['numero'])} · {f.get('pais', '')}",
              f"Riesgo {nivel} ({f.get('score', 0)}/100)"]
    if f.get("total_reportes"):
        cat = f.get("categoria_principal")
        lineas.append(f"{f['total_reportes']} reporte(s)" + (f", casi siempre: {CAT_TXT.get(cat, cat)}" if cat else ""))
        if f.get("resumen_ia"):
            lineas.append(f"IA: {f['resumen_ia']}")
    else:
        lineas.append("Nadie lo ha reportado todavía.")
    lineas.append({"alto": "👉 Mejor no contestes y bloquéalo.",
                   "medio": "👉 Contesta con cuidado y no des datos."}.get(nivel, "👉 Parece tranquilo."))
    return "\n".join(lineas)


def telegram_enviar(texto: str, chat_id: str | int | None = None):
    destino = chat_id or TELEGRAM_CHAT_ID
    if not TELEGRAM_TOKEN or not destino:
        return
    try:
        httpx.post(f"{TELEGRAM_API}/bot{TELEGRAM_TOKEN}/sendMessage",
                   json={"chat_id": destino, "text": texto, "disable_web_page_preview": True}, timeout=8)
    except Exception as e:
        log.warning("No se pudo enviar a Telegram: %s", e)


class Llamada(BaseModel):
    numero: str = Field("", max_length=40)
    dispositivo: str = Field("celular", max_length=40)


@app.post("/api/llamada")
def llamada_entrante(l: Llamada, request: Request, bg: BackgroundTasks):
    """El celular avisa que está entrando una llamada (MacroDroid en Android / Atajo en iPhone)."""
    token = request.headers.get("x-centinela-token") or request.query_params.get("token")
    if not LLAMADAS_TOKEN or token != LLAMADAS_TOKEN:
        raise HTTPException(401, "Token de llamadas inválido")
    if len(re.sub(r"\D", "", l.numero)) < 3:
        f = {"numero": None, "nivel": "medio", "score": 40, "pais": "Oculto", "total_reportes": 0}
        aviso = "📞 Llamada de número oculto o privado.\n🟠 No se puede verificar: si contestas, no des datos."
    else:
        f = ficha(normalizar(l.numero))
        aviso = "📞 Te está llamando:\n" + texto_ficha(f)
    try:
        q("""insert into llamadas (numero, dispositivo, score, nivel, nodo) values (%s,%s,%s,%s,%s)""",
          (f["numero"], l.dispositivo, f.get("score"), f.get("nivel"), NODO))
    except Exception as e:
        log.warning("No se pudo guardar la llamada: %s", e)
    bg.add_task(telegram_enviar, aviso)
    corto = {"alto": "🔴 NO CONTESTES · riesgo alto", "medio": "🟠 Cuidado · riesgo medio"}.get(f.get("nivel"), "🟢 Riesgo bajo")
    if request.query_params.get("formato") == "texto":      # para la notificación de MacroDroid
        extra = f" · {CAT_TXT.get(f.get('categoria_principal'), '')}" if f.get("categoria_principal") else ""
        return PlainTextResponse(f"{corto} ({f.get('score')}/100){extra}")
    return {"ok": True, "nodo": NODO, "numero": f["numero"], "nivel": f.get("nivel"),
            "score": f.get("score"), "notificacion": f"{corto} ({f.get('score')}/100)"}


@app.get("/api/llamadas")
def llamadas(limite: int = 5):
    filas = q("""select l.id, l.numero, l.dispositivo, l.score, l.nivel, l.nodo, l.creado,
                        n.pais, n.total_reportes, n.categoria_principal, n.resumen_ia
                 from llamadas l left join numeros n using (numero)
                 order by l.creado desc limit %s""", (min(limite, 20),), todos=True)
    for f in filas:
        # los números con reportes ya son públicos; los demás se enmascaran
        if not f["numero"]:
            f["numero"] = "Número oculto"
        elif (f["score"] or 0) < 25 and not f["total_reportes"]:
            f["numero"] = enmascarar(f["numero"])
        f["segundos"] = int((datetime.now(timezone.utc) - f["creado"]).total_seconds())
    return filas


class MensajeBot(BaseModel):
    chat_id: int | str
    texto: str | None = Field(None, max_length=1000)
    contacto: str | None = Field(None, max_length=40)
    nombre: str | None = Field(None, max_length=80)


AYUDA = ("🛡️ Soy Centinela, tu escudo contra llamadas spam y estafas.\n\n"
         "• Envíame un número (ej. 3001234567) y te digo si es peligroso.\n"
         "• También puedes compartirme un contacto.\n"
         "• /reportar 3001234567 lo que te dijeron → reporta una llamada\n"
         "• /top → los números más reportados\n"
         "• /stats → cifras de la comunidad\n"
         "• /estado → qué servidor te está atendiendo\n"
         "• /miid → tu chat_id (para recibir alertas)\n"
         "• O pregúntame lo que quieras sobre estafas telefónicas 💬")


@app.post("/api/bot")
def bot(m: MensajeBot, bg: BackgroundTasks):
    """Cerebro del bot de Telegram: n8n le pasa el mensaje y reenvía la respuesta."""
    t = (m.contacto or m.texto or "").strip()
    cmd, _, resto = t.partition(" ")
    cmd = cmd.lower().split("@")[0]
    try:
        if not t or cmd in ("/start", "/ayuda", "/help"):
            saludo = f"Hola {m.nombre} 👋\n" if m.nombre and cmd == "/start" else ""
            r = saludo + AYUDA
        elif cmd == "/miid":
            r = f"Tu chat_id es: {m.chat_id}\nPonlo como TELEGRAM_CHAT_ID en los servidores para recibir las alertas de llamadas."
        elif cmd == "/top":
            filas = top(5)
            r = "🔝 Más reportados:\n\n" + "\n".join(
                f"{i}. {EMOJI.get(f['nivel'], '⚪')} {formato(f['numero'])} · {f['score']}/100 · {CAT_TXT.get(f['categoria_principal'], 'sin clasificar')}"
                for i, f in enumerate(filas, 1)) if filas else "Todavía no hay reportes."
        elif cmd == "/stats":
            st = stats()
            cats = ", ".join(f"{CAT_TXT.get(c['categoria'], c['categoria'])} {c['total']}" for c in st["por_categoria"][:4])
            r = (f"📊 Centinela hoy\n• {st['numeros']} números vigilados\n• {st['reportes']} reportes en total\n"
                 f"• {st['reportes_24h']} en las últimas 24 h\n• {st['alto_riesgo']} de riesgo alto\n• Tipos: {cats}")
        elif cmd == "/estado":
            c = cluster()
            lineas = [f"{'🟢' if n['online'] else '🔴'} {n['nombre']} ({n['rol']}) · CPU {round(n['cpu'] or 0)}% · RAM {round(n['ram'] or 0)}%"
                      for n in c["nodos"]]
            r = (f"🖥️ Te atendió: {NODO}\n" + "\n".join(lineas) +
                 f"\n🧠 IA local: {'activa' if c['ollama'] else 'en pausa'}")
        elif cmd == "/reportar":
            nums = RE_NUM.findall(resto)
            if not nums:
                r = "Escribe así: /reportar 3001234567 me dijeron que eran del banco"
            else:
                desc = resto.replace(nums[0], "", 1).strip() or None
                res = registrar_reporte(nums[0], None, desc, "telegram", f"tg:{m.chat_id}", bg)
                if res["modo"] == "degradado":
                    r = "✅ Reporte recibido. Se sincroniza apenas vuelva la conexión con la base de datos."
                else:
                    r = "✅ Gracias, reporte guardado.\n\n" + texto_ficha(res["numero"])
                    if desc:
                        r += "\n\n🧠 La IA está clasificando tu reporte."
        elif RE_NUM.fullmatch(t) or (m.contacto and RE_NUM.search(t)):
            r = texto_ficha(ficha(normalizar(RE_NUM.search(t).group())))
        else:
            r = chat(Chat(mensaje=t[:600]))["respuesta"]
    except HTTPException as e:
        r = "Ese número no parece válido. Revísalo e intenta de nuevo." if e.status_code == 422 else \
            "Vas muy rápido 😅 Espera unos minutos para reportar otra vez." if e.status_code == 429 else \
            "No pude procesar eso. Intenta de nuevo."
    except Exception as e:
        log.warning("Bot: %s", e)
        r = "⚠️ Tuve un problema consultando la base de datos. Intenta en un momento."
    return {"respuesta": r, "nodo": NODO}


@app.get("/api/bot/resumen")
def resumen_diario():
    st = stats()
    filas = top(3)
    tope = "\n".join(f"{EMOJI.get(f['nivel'], '⚪')} {formato(f['numero'])} ({f['score']}/100)" for f in filas)
    consejo = CONSEJOS[datetime.now().timetuple().tm_yday % len(CONSEJOS)]
    return {"respuesta": (f"☀️ Buenos días. Así va Centinela:\n• {st['reportes_24h']} reportes en las últimas 24 h\n"
                          f"• {st['numeros']} números vigilados, {st['alto_riesgo']} de riesgo alto\n\n"
                          f"🔝 Más peligrosos:\n{tope or 'Sin datos'}\n\n💡 {consejo}")}


# ================================================================ Panel de administración (login)
# Proceso de autenticación: usuario + contraseña cifrada (PBKDF2), sesión firmada (HMAC),
# bloqueo tras varios intentos y doble factor opcional (TOTP, compatible con Aegis).
# Solo se activa cuando hay ADMIN_USER y ADMIN_HASH configurados (configurar_admin.sh).
ADMIN_USER = os.getenv("ADMIN_USER", "")
ADMIN_HASH = os.getenv("ADMIN_HASH", "")              # pbkdf2$<salt>$<hash>
ADMIN_TOTP = os.getenv("ADMIN_TOTP", "")              # secreto base32 (2FA, opcional)
SECRET_KEY = os.getenv("SECRET_KEY", "") or SAL       # firma de la cookie de sesión
ADMIN_ACTIVO = bool(ADMIN_USER and ADMIN_HASH)
SESION_MIN = 30
INTENTOS_MAX = 5
BLOQUEO_MIN = 15
_login_fallos: dict[str, list] = defaultdict(list)


def clave_ok(clave: str, guardado: str) -> bool:
    try:
        _, salt_hex, hash_hex = guardado.split("$")
        h = hashlib.pbkdf2_hmac("sha256", clave.encode(), bytes.fromhex(salt_hex), 200_000)
        return hmac.compare_digest(h.hex(), hash_hex)
    except Exception:
        return False


def totp_ok(secreto: str, codigo: str) -> bool:
    if not secreto:
        return True
    try:
        clave = base64.b32decode(secreto.upper() + "=" * (-len(secreto) % 8))
        codigo = (codigo or "").strip().replace(" ", "")
        ahora = int(time.time())
        for d in (-1, 0, 1):
            msg = struct.pack(">Q", ahora // 30 + d)
            h = hmac.new(clave, msg, hashlib.sha1).digest()
            o = h[-1] & 15
            val = "%06d" % ((struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % 1_000_000)
            if hmac.compare_digest(val, codigo):
                return True
        return False
    except Exception:
        return False


def firmar_sesion(usuario: str) -> str:
    cuerpo = base64.urlsafe_b64encode(json.dumps(
        {"u": usuario, "exp": int(time.time()) + SESION_MIN * 60}).encode()).decode()
    firma = hmac.new(SECRET_KEY.encode(), cuerpo.encode(), hashlib.sha256).hexdigest()
    return f"{cuerpo}.{firma}"


def sesion_valida(cookie: str | None) -> bool:
    if not cookie or "." not in cookie:
        return False
    cuerpo, firma = cookie.rsplit(".", 1)
    esperado = hmac.new(SECRET_KEY.encode(), cuerpo.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(firma, esperado):
        return False
    try:
        return json.loads(base64.urlsafe_b64decode(cuerpo)).get("exp", 0) > time.time()
    except Exception:
        return False


def login_bloqueado(ip: str) -> bool:
    ahora = time.time()
    _login_fallos[ip] = [t for t in _login_fallos[ip] if ahora - t < BLOQUEO_MIN * 60]
    return len(_login_fallos[ip]) >= INTENTOS_MAX


PAGINA = """<!doctype html><html lang=es><head><meta charset=utf-8>
<meta name=viewport content="width=device-width, initial-scale=1"><title>Centinela · Panel</title>
<style>body{{font-family:system-ui,sans-serif;background:#0e1424;color:#e7ebf4;margin:0;padding:24px}}
.card{{max-width:420px;margin:7vh auto;background:#161e33;border:1px solid #283252;border-radius:16px;padding:28px}}
h1{{font-size:20px;margin:0 0 4px}} .sub{{color:#9ba5bd;margin:0 0 18px;font-size:14px}}
label{{display:block;font-size:13px;color:#9ba5bd;margin:12px 0 4px}}
input{{width:100%;box-sizing:border-box;padding:11px;border-radius:8px;border:1px solid #283252;background:#0e1424;color:#e7ebf4;font-size:15px}}
button{{width:100%;margin-top:18px;padding:12px;border:0;border-radius:8px;background:#2346d8;color:#fff;font-size:15px;font-weight:600;cursor:pointer}}
.err{{background:#3a0f16;color:#ff8a98;border:1px solid #cc2539;border-radius:8px;padding:10px;font-size:14px;margin-bottom:12px}}
table{{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}}
th,td{{padding:8px;border-bottom:1px solid #283252;text-align:left}} th{{color:#9ba5bd}}
a{{color:#7a93ff}} .top{{max-width:1000px;margin:0 auto}}</style></head><body>{cuerpo}</body></html>"""

LOGIN_HTML = """<div class=card><h1>🛡️ Centinela · Panel</h1>
<p class=sub>Acceso solo para el equipo</p>{error}
<form method=post action="/admin/login">
<label>Usuario</label><input name=usuario autocomplete=username required>
<label>Contraseña</label><input name=clave type=password autocomplete=current-password required>
{totp}<button>Entrar</button></form></div>"""


def _campo_totp() -> str:
    return ("<label>Código (Aegis)</label><input name=codigo inputmode=numeric "
            "autocomplete=one-time-code>") if ADMIN_TOTP else ""


@app.get("/admin", response_class=HTMLResponse)
def admin_panel(request: Request):
    if not ADMIN_ACTIVO:
        return HTMLResponse(PAGINA.format(cuerpo="<div class=card><h1>Panel no configurado</h1>"
            "<p class=sub>Corre <code>configurar_admin.sh</code> en el servidor.</p></div>"))
    if not sesion_valida(request.cookies.get("centinela_admin")):
        return RedirectResponse("/admin/login", status_code=303)
    try:
        filas = q("""select numero, pais, score, nivel, total_reportes, categoria_principal
                     from numeros order by score desc, ultimo_reporte desc limit 100""", todos=True)
        st = stats()
        cab = (f"<div class=top><h1>Panel de Centinela</h1><p class=sub>"
               f"{st['numeros']} números · {st['reportes']} reportes · {st['alto_riesgo']} de riesgo alto · "
               f"atendido por {NODO} · <a href='/admin/salir'>Salir</a></p>")
        cuerpo = "".join(
            f"<tr><td>{formato(f['numero'])}</td><td>{f['pais'] or ''}</td><td>{f['score']}</td>"
            f"<td>{f['nivel']}</td><td>{f['total_reportes']}</td>"
            f"<td>{CAT_TXT.get(f['categoria_principal'], '—')}</td></tr>" for f in filas)
        tabla = ("<table><tr><th>Número</th><th>País</th><th>Riesgo</th><th>Nivel</th>"
                 "<th>Reportes</th><th>Tipo</th></tr>" + cuerpo + "</table></div>")
        return HTMLResponse(PAGINA.format(cuerpo=cab + tabla))
    except Exception as e:
        log.warning("Panel: %s", e)
        return HTMLResponse(PAGINA.format(cuerpo="<div class=card><h1>Sin conexión a la base</h1>"
            "<p class=sub><a href='/admin/salir'>Salir</a></p></div>"))


@app.get("/admin/login", response_class=HTMLResponse)
def admin_login_form(request: Request):
    if not ADMIN_ACTIVO:
        return RedirectResponse("/admin", status_code=303)
    if sesion_valida(request.cookies.get("centinela_admin")):
        return RedirectResponse("/admin", status_code=303)
    return HTMLResponse(PAGINA.format(cuerpo=LOGIN_HTML.format(error="", totp=_campo_totp())))


@app.post("/admin/login", response_class=HTMLResponse)
def admin_login(request: Request, usuario: str = Form(""), clave: str = Form(""), codigo: str = Form("")):
    if not ADMIN_ACTIVO:
        return RedirectResponse("/admin", status_code=303)
    ip = ip_cliente(request)

    def error(msg, code=401):
        return HTMLResponse(PAGINA.format(cuerpo=LOGIN_HTML.format(
            error=f"<div class=err>{msg}</div>", totp=_campo_totp())), status_code=code)

    if login_bloqueado(ip):
        return error(f"Demasiados intentos. Espera {BLOQUEO_MIN} minutos.", 429)
    ok = (hmac.compare_digest(usuario, ADMIN_USER) and clave_ok(clave, ADMIN_HASH)
          and totp_ok(ADMIN_TOTP, codigo))
    if not ok:
        _login_fallos[ip].append(time.time())
        evento("login_fallido", f"intento de acceso al panel desde {ip[:12]}")
        return error("Datos incorrectos.")
    _login_fallos[ip].clear()
    resp = RedirectResponse("/admin", status_code=303)
    resp.set_cookie("centinela_admin", firmar_sesion(usuario), max_age=SESION_MIN * 60,
                    httponly=True, samesite="strict", secure=True)
    return resp


@app.get("/admin/salir")
def admin_salir():
    resp = RedirectResponse("/admin/login", status_code=303)
    resp.delete_cookie("centinela_admin")
    return resp
