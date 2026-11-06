"""CENTINELA · panel de administración con autenticación (lo que pide el profesor).

Flujo: usuario + contraseña PBKDF2 (200k iteraciones), cookie firmada HMAC-SHA256
(expira en 30 min, HttpOnly, SameSite=Strict, Secure), bloqueo tras 5 fallos por IP
(15 min) y TOTP opcional compatible con Aegis/Google Authenticator.

El panel SOLO se activa si ADMIN_USER y ADMIN_HASH existen en el .env del nodo,
creados con `sudo bash servidor/configurar_admin.sh`. Sin eso, /admin responde
"Panel no configurado" (fail-closed, sin exponer nada).
"""
import base64, hashlib, hmac, json, os, struct, time
from collections import defaultdict
from fastapi import Form, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse

from .config import SAL, NODO, log
from .db import q, evento
from .utilidades import ip_cliente

ADMIN_USER = os.getenv("ADMIN_USER", "")
ADMIN_HASH = os.getenv("ADMIN_HASH", "")  # pbkdf2$<salt>$<hash>
ADMIN_TOTP = os.getenv("ADMIN_TOTP", "")  # secreto base32 (2FA, opcional)
SECRET_KEY = os.getenv("SECRET_KEY", "") or SAL  # firma de la cookie de sesión
ADMIN_ACTIVO = bool(ADMIN_USER and ADMIN_HASH)
SESION_MIN = 30
INTENTOS_MAX = 5
BLOQUEO_MIN = 15
_login_fallos: dict[str, list] = defaultdict(list)

PAGINA = """<!doctype html><html lang=es><head><meta charset=utf-8>
<meta name=viewport content="width=device-width, initial-scale=1"><title>Centinela · Panel</title>
<style>body{font-family:system-ui,sans-serif;background:#0e1424;color:#e7ebf4;margin:0;padding:24px}
.card{max-width:480px;margin:6vh auto;background:#161e33;border:1px solid #283252;border-radius:16px;padding:28px}
h1{font-size:20px;margin:0 0 4px}} .sub{{color:#9ba5bd;margin:0 0 18px;font-size:14px}
label{display:block;font-size:13px;color:#9ba5bd;margin:12px 0 4px}
input{width:100%;box-sizing:border-box;padding:11px;border-radius:8px;border:1px solid #283252;background:#0e1424;color:#e7ebf4;font-size:15px}
button{width:100%;margin-top:18px;padding:12px;border:0;border-radius:8px;background:#2346d8;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
.err{background:#3a0f16;color:#ff8a98;border:1px solid #cc2539;border-radius:8px;padding:10px;font-size:14px;margin-bottom:12px}
.ok{background:#0f2a1a;color:#7dffa9;border:1px solid #1f7a4a;border-radius:8px;padding:10px;font-size:14px;margin-bottom:12px}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}
th,td{padding:8px;border-bottom:1px solid #283252;text-align:left}} th{{color:#9ba5bd}
a{color:#7a93ff}} .top{{max-width:1100px;margin:0 auto}
code{background:#0e1424;padding:2px 6px;border-radius:6px;font-size:12px}
.ver{color:#9ba5bd;font-size:13px;margin-top:12px}}</style></head><body>{{cuerpo}</body></html>"""

LOGIN_HTML = """<div class=card><h1>🛡️ Centinela · Panel</h1>
<p class=sub>Acceso solo para el equipo (profesor / admin)</p>{error}
<form method=post action="/admin/login">
<label>Usuario</label><input name=usuario autocomplete=username required>
<label>Contraseña</label><input name=clave type=password autocomplete=current-password required>
{totp}<button>Entrar</button></form>
<p class=ver>Verificación: PBKDF2-HMAC-SHA256 · cookie firmada HMAC · bloqueo tras 5 intentos/IP · TOTP opcional (Aegis).</p></div>"""


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
    cuerpo = base64.urlsafe_b64encode(json.dumps({"u": usuario, "exp": int(time.time()) + SESION_MIN * 60}).encode()).decode()
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


def _campo_totp() -> str:
    return ("<label>Código (Aegis)</label><input name=codigo inputmode=numeric autocomplete=one-time-code>") if ADMIN_TOTP else ""


def pagina(cuerpo: str):
    return HTMLResponse(PAGINA.replace("{cuerpo}", cuerpo))


def admin_panel(request: Request, stats_fn, formato_fn, cat_txt: dict):
    if not ADMIN_ACTIVO:
        return pagina("<div class=card><h1>Panel no configurado</h1><p class=sub>El administrador debe correr <code>sudo bash servidor/configurar_admin.sh</code> en JE (y JP con los mismos datos). Luego recargar esta página.</p><p class=ver>Qué protege esto: solo el equipo ve el panel completo; el público solo ve números enmascarados. Ver docs/10_AUTENTICACION.md.</p></div>")
    if not sesion_valida(request.cookies.get("centinela_admin")):
        return RedirectResponse("/admin/login", status_code=303)
    try:
        filas = q("""select numero, pais, score, nivel, total_reportes, categoria_principal from numeros order by score desc, ultimo_reporte desc limit 100""", todos=True)
        st = stats_fn()
        cab = (f"<div class=top><h1>Panel de Centinela</h1><p class=sub>{st['numeros']} números · {st['reportes']} reportes · {st['alto_riesgo']} de riesgo alto · atendido por {NODO} · <a href='/admin/salir'>Salir</a></p>")
        cuerpo = "".join(f"<tr><td>{formato_fn(f['numero'])}</td><td>{f['pais'] or ''}</td><td>{f['score']}</td><td>{f['nivel']}</td><td>{f['total_reportes']}</td><td>{cat_txt.get(f['categoria_principal'], '—')}</td></tr>" for f in filas)
        tabla = ("<table><tr><th>Número</th><th>País</th><th>Riesgo</th><th>Nivel</th><th>Reportes</th><th>Tipo</th></tr>" + cuerpo + "</table></div>")
        return pagina(cab + tabla)
    except Exception as e:
        log.warning("Panel: %s", e)
        return pagina("<div class=card><h1>Sin conexión a la base</h1><p class=sub><a href='/admin/salir'>Salir</a></p></div>")


def admin_login_form(request: Request):
    if not ADMIN_ACTIVO:
        return RedirectResponse("/admin", status_code=303)
    if sesion_valida(request.cookies.get("centinela_admin")):
        return RedirectResponse("/admin", status_code=303)
    return HTMLResponse(PAGINA.replace("{cuerpo}", LOGIN_HTML.format(error="", totp=_campo_totp())))


def admin_login(request: Request, usuario: str = Form(""), clave: str = Form(""), codigo: str = Form("")):
    if not ADMIN_ACTIVO:
        return RedirectResponse("/admin", status_code=303)
    ip = ip_cliente(request)

    def error(msg, code=401):
        return HTMLResponse(PAGINA.replace("{cuerpo}", LOGIN_HTML.format(error=f"<div class=err>{msg}</div>", totp=_campo_totp())), status_code=code)

    if login_bloqueado(ip):
        return error(f"Demasiados intentos. Espera {BLOQUEO_MIN} minutos.", 429)
    ok = (hmac.compare_digest(usuario, ADMIN_USER) and clave_ok(clave, ADMIN_HASH) and totp_ok(ADMIN_TOTP, codigo))
    if not ok:
        _login_fallos[ip].append(time.time())
        evento("login_fallido", f"intento de acceso al panel desde {ip[:12]}")
        return error("Datos incorrectos.")
    _login_fallos[ip].clear()
    resp = RedirectResponse("/admin", status_code=303)
    resp.set_cookie("centinela_admin", firmar_sesion(usuario), max_age=SESION_MIN * 60, httponly=True, samesite="strict", secure=True)
    return resp


def admin_salir():
    resp = RedirectResponse("/admin/login", status_code=303)
    resp.delete_cookie("centinela_admin")
    return resp
