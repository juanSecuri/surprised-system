"""CENTINELA · rutas HTTP (API pública + bot + llamadas reales)."""
import os, re
from datetime import datetime, timezone
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from .config import NODO, ROL, VERSION, INICIO, CAT_TXT, EMOJI, LLAMADAS_TOKEN, CONSEJOS, log
from .db import q, local, db_ok, ficha, stats_completas, top_numeros, recientes_reportes, cluster_data
from .utilidades import normalizar, ip_cliente, metricas, formato, enmascarar, texto_ficha
from .ia import ollama_disponible, ollama_chat
from .servicios import registrar_reporte, telegram_enviar, _exceso
from . import auth as authmod

RE_NUM = re.compile(r"(?:\+|00)?\d[\d\s\-().]{5,17}\d")

class Reporte(BaseModel):
    numero: str = Field(..., max_length=25)
    categoria: str | None = None
    descripcion: str | None = Field(None, max_length=500)
    canal: str = Field("web", max_length=20)
    reportero_id: str | None = Field(None, max_length=64)

class Chat(BaseModel):
    mensaje: str = Field(..., max_length=600)

class Llamada(BaseModel):
    numero: str = Field("", max_length=40)
    dispositivo: str = Field("celular", max_length=40)

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

def chat_logic(c: Chat):
    nums = []
    for m in RE_NUM.findall(c.mensaje)[:3]:
        try: nums.append(normalizar(m))
        except HTTPException: pass
    fichas = [ficha(n) for n in nums]
    try: st = q("""select (select count(*) from numeros) numeros, (select count(*) from reportes where creado > now() - interval '24 hours') reportes_24h""", uno=True)
    except Exception: st = None
    if ollama_disponible():
        try:
            import json as _json
            contexto = _json.dumps({"numeros_consultados": fichas, "estadisticas": st}, default=str, ensure_ascii=False)
            system = ("Eres Centinela, asistente de un sistema comunitario anti-spam telefónico en Colombia. "
                      "Tu ÚNICO tema son las llamadas, el spam, las estafas telefónicas y este sistema. "
                      "Responde en español, cálido y breve (máximo 4 líneas). Usa SOLO los datos del CONTEXTO "
                      "para hablar de números; nunca inventes reportes ni cifras. Si el riesgo es alto, "
                      "aconseja no contestar y bloquear. "
                      "Si te preguntan cualquier cosa que NO tenga que ver con llamadas o estafas telefónicas "
                      "(matemáticas, código, chistes, otros temas), responde exactamente: "
                      "'Solo puedo ayudarte con Centinela y la identificación de llamadas.' "
                      "Nunca pidas datos personales.")
            txt = ollama_chat(system, f"CONTEXTO: {contexto}\n\nUSUARIO: {c.mensaje}", temperatura=0.3, num_predict=200)
            return {"respuesta": txt, "fuente": "ollama", "modelo": os.getenv("OLLAMA_MODEL", "qwen2.5:7b"), "nodo": NODO, "numeros": fichas}
        except Exception as e: log.warning("Ollama falló, respondo con reglas: %s", e)
    return {"respuesta": respuesta_reglas(fichas, st), "fuente": "reglas", "nodo": NODO, "numeros": fichas}

def registrar(app: FastAPI):
    @app.get("/")
    def raiz(): return {"servicio": "Centinela", "nodo": NODO, "rol": ROL, "version": VERSION}

    @app.get("/ping")
    def ping(): return {"ok": True, "nodo": NODO}

    @app.get("/health")
    def health():
        with local() as c: pend = c.execute("select count(*) n from pendientes").fetchone()["n"]
        return {"ok": True, "nodo": NODO, "rol": ROL, "version": VERSION, "db": db_ok(), "ollama": ollama_disponible(), "pendientes": pend, "uptime_seg": int((datetime.now(timezone.utc) - INICIO).total_seconds()), **metricas()}

    @app.get("/api/numero/{numero}")
    def consultar(numero: str): return ficha(normalizar(numero))

    @app.post("/api/reportar")
    def reportar(r: Reporte, request: Request, bg: BackgroundTasks):
        return registrar_reporte(r.numero, r.categoria, r.descripcion, r.canal, r.reportero_id or ip_cliente(request), bg)

    @app.get("/api/top")
    def top(limite: int = 10): return top_numeros(limite)

    @app.get("/api/recientes")
    def recientes(limite: int = 15): return recientes_reportes(limite)

    @app.get("/api/stats")
    def stats(): return stats_completas()

    @app.get("/api/cluster")
    def cluster():
        d = cluster_data()
        return {"atendido_por": NODO, "nodos": d["nodos"], "eventos": d["eventos"], "ollama": ollama_disponible()}

    @app.post("/api/chat")
    def chat(c: Chat): return chat_logic(c)

    @app.post("/api/llamada")
    def llamada_entrante(l: Llamada, request: Request, bg: BackgroundTasks):
        token = request.headers.get("x-centinela-token") or request.query_params.get("token")
        if not LLAMADAS_TOKEN or token != LLAMADAS_TOKEN: raise HTTPException(401, "Token de llamadas inválido")
        if len(re.sub(r"\D", "", l.numero)) < 3:
            f = {"numero": None, "nivel": "medio", "score": 40, "pais": "Oculto", "total_reportes": 0}
            aviso = "📞 Llamada de número oculto o privado.\n🟠 No se puede verificar: si contestas, no des datos."
        else:
            f = ficha(normalizar(l.numero)); aviso = "📞 Te está llamando:\n" + texto_ficha(f)
        try: q("""insert into llamadas (numero, dispositivo, score, nivel, nodo) values (%s,%s,%s,%s,%s)""", (f["numero"], l.dispositivo, f.get("score"), f.get("nivel"), NODO))
        except Exception as e: log.warning("No se pudo guardar la llamada: %s", e)
        bg.add_task(telegram_enviar, aviso)
        corto = {"alto": "🔴 NO CONTESTES · riesgo alto", "medio": "🟠 Cuidado · riesgo medio"}.get(f.get("nivel"), "🟢 Riesgo bajo")
        if request.query_params.get("formato") == "texto":
            extra = f" · {CAT_TXT.get(f.get('categoria_principal'), '')}" if f.get("categoria_principal") else ""
            return PlainTextResponse(f"{corto} ({f.get('score')}/100){extra}")
        return {"ok": True, "nodo": NODO, "numero": f["numero"], "nivel": f.get("nivel"), "score": f.get("score"), "notificacion": f"{corto} ({f.get('score')}/100)"}

    @app.get("/api/llamadas")
    def llamadas(limite: int = 5):
        filas = q("""select l.id, l.numero, l.dispositivo, l.score, l.nivel, l.nodo, l.creado, n.pais, n.total_reportes, n.categoria_principal, n.resumen_ia from llamadas l left join numeros n using (numero) order by l.creado desc limit %s""", (min(limite, 20),), todos=True)
        for f in filas:
            if not f["numero"]: f["numero"] = "Número oculto"
            elif (f["score"] or 0) < 25 and not f["total_reportes"]: f["numero"] = enmascarar(f["numero"])
            f["segundos"] = int((datetime.now(timezone.utc) - f["creado"]).total_seconds())
        return filas

    @app.post("/api/bot")
    def bot(m: MensajeBot, bg: BackgroundTasks):
        t = (m.contacto or m.texto or "").strip()
        cmd, _, resto = t.partition(" "); cmd = cmd.lower().split("@")[0]
        try:
            if not t or cmd in ("/start", "/ayuda", "/help"):
                saludo = f"Hola {m.nombre} 👋\n" if m.nombre and cmd == "/start" else ""; r = saludo + AYUDA
            elif cmd == "/miid": r = f"Tu chat_id es: {m.chat_id}\nPonlo como TELEGRAM_CHAT_ID en los servidores para recibir las alertas de llamadas."
            elif cmd == "/top":
                filas = top_numeros(5)
                r = "🔝 Más reportados:\n\n" + "\n".join(f"{i}. {EMOJI.get(x['nivel'], '⚪')} {formato(x['numero'])} · {x['score']}/100 · {CAT_TXT.get(x['categoria_principal'], 'sin clasificar')}" for i, x in enumerate(filas, 1)) if filas else "Todavía no hay reportes."
            elif cmd == "/stats":
                st = stats_completas(); cats = ", ".join(f"{CAT_TXT.get(c['categoria'], c['categoria'])} {c['total']}" for c in st["por_categoria"][:4])
                r = (f"📊 Centinela hoy\n• {st['numeros']} números vigilados\n• {st['reportes']} reportes en total\n• {st['reportes_24h']} en las últimas 24 h\n• {st['alto_riesgo']} de riesgo alto\n• Tipos: {cats}")
            elif cmd == "/estado":
                d = cluster_data(); lineas = [f"{'🟢' if n['online'] else '🔴'} {n['nombre']} ({n['rol']}) · CPU {round(n['cpu'] or 0)}% · RAM {round(n['ram'] or 0)}%" for n in d["nodos"]]
                r = (f"🖥️ Te atendió: {NODO}\n" + "\n".join(lineas) + f"\n🧠 IA local: {'activa' if ollama_disponible() else 'en pausa'}")
            elif cmd == "/reportar":
                nums = RE_NUM.findall(resto)
                if not nums: r = "Escribe así: /reportar 3001234567 me dijeron que eran del banco"
                else:
                    desc = resto.replace(nums[0], "", 1).strip() or None
                    res = registrar_reporte(nums[0], None, desc, "telegram", f"tg:{m.chat_id}", bg)
                    r = "✅ Reporte recibido. Se sincroniza apenas vuelva la conexión con la base de datos." if res["modo"] == "degradado" else "✅ Gracias, reporte guardado.\n\n" + texto_ficha(res["numero"]) + ("\n\n🧠 La IA está clasificando tu reporte." if desc else "")
            elif RE_NUM.fullmatch(t) or (m.contacto and RE_NUM.search(t)): r = texto_ficha(ficha(normalizar(RE_NUM.search(t).group())))
            else: r = chat_logic(Chat(mensaje=t[:600]))["respuesta"]
        except HTTPException as e:
            r = "Ese número no parece válido. Revísalo e intenta de nuevo." if e.status_code == 422 else "Vas muy rápido 😅 Espera unos minutos para reportar otra vez." if e.status_code == 429 else "No pude procesar eso. Intenta de nuevo."
        except Exception as e: log.warning("Bot: %s", e); r = "⚠️ Tuve un problema consultando la base de datos. Intenta en un momento."
        return {"respuesta": r, "nodo": NODO}

    @app.get("/api/bot/resumen")
    def resumen_diario():
        st = stats_completas(); filas = top_numeros(3)
        tope = "\n".join(f"{EMOJI.get(f['nivel'], '⚪')} {formato(f['numero'])} ({f['score']}/100)" for f in filas)
        consejo = CONSEJOS[datetime.now().timetuple().tm_yday % len(CONSEJOS)]
        return {"respuesta": (f"☀️ Buenos días. Así va Centinela:\n• {st['reportes_24h']} reportes en las últimas 24 h\n• {st['numeros']} números vigilados, {st['alto_riesgo']} de riesgo alto\n\n🔝 Más peligrosos:\n{tope or 'Sin datos'}\n\n💡 {consejo}")}

    # --- Panel admin autenticado (lo que pide el profesor) ---
    @app.get("/admin", response_class=authmod.HTMLResponse)
    def admin_panel(request: Request): return authmod.admin_panel(request, stats_completas, formato, CAT_TXT)

    @app.get("/admin/login", response_class=authmod.HTMLResponse)
    def admin_login_form(request: Request): return authmod.admin_login_form(request)

    @app.post("/admin/login", response_class=authmod.HTMLResponse)
    def admin_login(request: Request, usuario: str = authmod.Form(""), clave: str = authmod.Form(""), codigo: str = authmod.Form("")):
        return authmod.admin_login(request, usuario, clave, codigo)

    @app.get("/admin/salir")
    def admin_salir(): return authmod.admin_salir()
