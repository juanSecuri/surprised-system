/**
 * CENTINELA · Gateway con failover + escudo de peticiones (Cloudflare Worker, plan gratis)
 *
 *   Usuario ──► centinela.<cuenta>.workers.dev ──► JE (principal, Tailscale Funnel)
 *                                              └─► JP (respaldo) si JE no responde
 *
 * Cloudflare es la primera línea de defensa: absorbe el tráfico volumétrico (DDoS) antes
 * de que llegue a los PCs. Encima de eso, este Worker limita las peticiones por IP para
 * que una avalancha nunca sature a los nodos, y hace failover a JP si el principal cae.
 *
 * Variables (wrangler.toml): NODO_PRINCIPAL, NODO_RESPALDO.
 * Opcionales: LIMITE_MIN (peticiones/min por IP, def. 100), LIMITE_CHAT_MIN (def. 12).
 * Admin en el borde (profesor): ADMIN_USER, ADMIN_HASH, SECRET_KEY (opcional), ADMIN_TOTP (opcional).
 * Si ADMIN_USER/HASH existen, /admin y /login se sirven aquí sin tocar JE (ver docs/10_AUTENTICACION.md).
 * Si no, se reenvían a JE/JP como antes.
 */

const TIMEOUT_MS = 8000;        // un nodo que no responde en 8 s se considera caído
const TIMEOUT_CHAT_MS = 90000;  // la IA puede tardar
const MAX_BODY = 4096;          // cuerpo máximo de una petición (bytes); corta payloads de ataque

const VENTANA_MS = 60000;
const visitas = new Map();

// Bloqueo de fuerza bruta para el panel (memoria del isolate, respaldo de SECURE_DELAY del borde)
const loginFallos = new Map(); // ip -> timestamps[]

function limitado(clave, maximo) {
  const ahora = Date.now();
  const cola = (visitas.get(clave) || []).filter((t) => ahora - t < VENTANA_MS);
  cola.push(ahora);
  visitas.set(clave, cola);
  if (visitas.size > 8000) {
    visitas.delete(visitas.keys().next().value);
  }
  return cola.length > maximo;
}

function loginBloqueado(ip) {
  const ahora = Date.now();
  const arr = (loginFallos.get(ip) || []).filter((t) => ahora - t < 15 * 60 * 1000);
  loginFallos.set(ip, arr);
  return arr.length >= 5;
}
function registrarFallo(ip) {
  const ahora = Date.now();
  const arr = (loginFallos.get(ip) || []).filter((t) => ahora - t < 15 * 60 * 1000);
  arr.push(ahora);
  loginFallos.set(ip, arr);
}
function limpiarFallos(ip) { loginFallos.delete(ip); }

// ---------- Admin en el borde ----------
const enc = new TextEncoder();
const dec = new TextDecoder();
function hexToBytes(h) { const a = []; for (let i = 0; i < h.length; i += 2) a.push(parseInt(h.slice(i, i + 2), 16)); return new Uint8Array(a); }
function toHex(buf) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function parseCookies(req) {
  const out = {};
  const raw = req.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
async function pbkdf2(clave, saltHex, iter) {
  const key = await crypto.subtle.importKey("raw", enc.encode(clave), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", iterations: iter, salt: hexToBytes(saltHex) }, key, 256);
  return toHex(bits);
}
async function claveOk(clave, guardado) {
  try {
    const [pref, saltHex, hashHex] = String(guardado).split("$");
    if (pref !== "pbkdf2" || !saltHex || !hashHex) return false;
    const h = await pbkdf2(clave, saltHex, 100000);
    // comparación en tiempo constante (mismo largo 64 chars hex)
    let diff = 0;
    if (h.length !== hashHex.length) return false;
    for (let i = 0; i < h.length; i += 1) diff |= h.charCodeAt(i) ^ hashHex.charCodeAt(i);
    return diff === 0;
  } catch { return false; }
}
function base32ToBytes(s) {
  const ALF = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  s = s.replace(/[^A-Z2-7]/gi, "").toUpperCase();
  const bits = [];
  for (const ch of s) bits.push(ALF.indexOf(ch));
  let out = [];
  for (let i = 0; i < bits.length; i += 1) {
    // expandir bits
  }
  // implementación compacta RFC4648
  let buffer = 0, n = 0;
  const res = [];
  for (const ch of s) {
    buffer = (buffer << 5) | ALF.indexOf(ch);
    n += 5;
    if (n >= 8) { n -= 8; res.push((buffer >> n) & 0xff); }
  }
  return new Uint8Array(res);
}
async function totpOk(secreto, codigo) {
  if (!secreto) return true;
  try {
    const keyBytes = base32ToBytes(secreto);
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    const ahora = Math.floor(Date.now() / 1000);
    const code = String(codigo || "").replace(/\s/g, "");
    for (const d of [-1, 0, 1]) {
      const step = Math.floor(ahora / 30) + d;
      const msg = new DataView(new ArrayBuffer(8));
      msg.setUint32(0, Math.floor(step / 0xffffffff));
      msg.setUint32(4, step >>> 0);
      const sig = await crypto.subtle.sign("HMAC", key, msg.buffer);
      const o = new Uint8Array(sig)[19] & 15;
      const val = (((new Uint8Array(sig)[o] & 0x7f) << 24) | (new Uint8Array(sig)[o + 1] << 16) | (new Uint8Array(sig)[o + 2] << 8) | new Uint8Array(sig)[o + 3]);
      const otp = String(val % 1000000).padStart(6, "0");
      if (otp === code) return true;
    }
    return false;
  } catch { return false; }
}
function firmarSesion(usuario, secret) {
  const body = btoa(JSON.stringify({ u: usuario, exp: Math.floor(Date.now() / 1000) + 30 * 60 }));
  // btoa directo falla con utf8 mínimo; los campos son ascii
  return body + "." + toHex(new Uint8Array([])); // placeholder reemplazado abajo por async firmado
}
async function firmarAsync(usuario, secret) {
  const cuerpo = btoa(JSON.stringify({ u: usuario, exp: Math.floor(Date.now() / 1000) + 30 * 60 }));
  const k = await crypto.subtle.importKey("raw", enc.encode(secret || "centinela"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(cuerpo));
  return cuerpo + "." + toHex(sig);
}
async function sesionValida(cookieVal, secret) {
  if (!cookieVal || !cookieVal.includes(".")) return false;
  try {
    const [cuerpo, firma] = cookieVal.split(".");
    const k = await crypto.subtle.importKey("raw", enc.encode(secret || "centinela"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", k, enc.encode(cuerpo));
    const esp = toHex(sig);
    if (esp.length !== firma.length) return false;
    let diff = 0;
    for (let i = 0; i < esp.length; i += 1) diff |= esp.charCodeAt(i) ^ firma.charCodeAt(i);
    if (diff !== 0) return false;
    const obj = JSON.parse(atob(cuerpo));
    return obj.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

const LOGIN_CSS = "body{font-family:system-ui,sans-serif;background:#0e1424;color:#e7ebf4;margin:0;padding:24px}.card{max-width:480px;margin:6vh auto;background:#161e33;border:1px solid #283252;border-radius:16px;padding:28px}h1{font-size:20px;margin:0 0 4px}.sub{color:#9ba5bd;margin:0 0 18px;font-size:14px}label{display:block;font-size:13px;color:#9ba5bd;margin:12px 0 4px}input{width:100%;box-sizing:border-box;padding:11px;border-radius:8px;border:1px solid #283252;background:#0e1424;color:#e7ebf4;font-size:15px}button{width:100%;margin-top:18px;padding:12px;border:0;border-radius:8px;background:#2346d8;color:#fff;font-size:15px;font-weight:600;cursor:pointer}.err{background:#3a0f16;color:#ff8a98;border:1px solid #cc2539;border-radius:8px;padding:10px;font-size:14px;margin-bottom:12px}.count{color:#9ba5bd;font-size:12px;margin-top:12px;text-align:center}";

function loginHtml(error, totp) {
  const err = error ? `<div class=err>${error}</div>` : "";
  const totpHtml = totp ? `<label>Código (Aegis)</label><input name=codigo inputmode=numeric autocomplete=one-time-code required>` : "";
  return `<!doctype html><html lang=es><head><meta charset=utf-8><meta name=viewport content="width=device-width, initial-scale=1"><title>Centinela · Panel</title><style>${LOGIN_CSS}</style></head><body><div class=card><h1>🛡️ Centinela · Panel</h1><p class=sub>Acceso solo para el equipo (profesor / admin)</p>${err}<form method=post action="/admin/login"><label>Usuario</label><input name=usuario autocomplete=username required autofocus><label>Contraseña</label><input name=clave type=password autocomplete=current-password required>${totpHtml}<button>Entrar</button></form><p class=count>Verificación: PBKDF2-HMAC-SHA256 · cookie firmada HMAC · bloqueo tras 5 intentos/IP · TOTP opcional (Aegis).</p></div></body></html>`;
}

function escHtml(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function fmtNum(n){var m=n&&String(n).match(/^\+57(\d{3})(\d{3})(\d{4})$/);return m?"+57 "+m[1]+" "+m[2]+" "+m[3]:(n||"");}
var CAT_PANEL={estafa:"Estafa",suplantacion:"Falso banco",cobranza:"Cobranza",telemarketing:"Telemarketing",wangiri:"Wangiri",extorsion:"Extorsion",encuesta:"Encuesta",otro:"Otro"};
async function datosPanel(env){
  for (const n of nodos(env)) {
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 8000);
      try {
        const sres = await fetch(n.base + "/api/stats", { signal: c.signal });
        if (!sres.ok) throw new Error("down");
        const s = await sres.json();
        const tres = await fetch(n.base + "/api/top?limite=100", { signal: c.signal });
        const tp = tres.ok ? await tres.json() : [];
        return { stats: s, top: Array.isArray(tp) ? tp : [], nodo: n.nombre };
      } finally { clearTimeout(t); }
    } catch (e) {}
  }
  return { stats: null, top: [], nodo: null };
}
function panelHtml(username, d) {
  d = d || { stats: null, top: [], nodo: null };
  const act = d.nodo || "sin conexion";
  const linea = d.stats
    ? (d.stats.numeros + " numeros · " + d.stats.reportes + " reportes · " + d.stats.alto_riesgo + " de riesgo alto")
    : "Sin conexion a la base (recarga en unos segundos).";
  const filas = (d.top && d.top.length)
    ? d.top.map(function(f){return "<tr><td>" + escHtml(fmtNum(f.numero)) + "</td><td>" + escHtml(f.pais||"") + "</td><td>" + escHtml(f.score) + "</td><td>" + escHtml(f.nivel) + "</td><td>" + escHtml(f.total_reportes) + "</td><td>" + escHtml(CAT_PANEL[f.categoria_principal]||"—") + "</td></tr>";}).join("")
    : "<tr><td colspan=6>Sin numeros todavia</td></tr>";
  const btn = function(nodo, accion, clase, txt){ return '<form method=post action="/admin/control"><input type=hidden name=nodo value="' + nodo + '"><input type=hidden name=accion value="' + accion + '"><button class="' + clase + '">' + txt + '</button></form>'; };
  const EXTRA = " .hdr{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:4px} .top{max-width:1100px;margin:0 auto} table{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px} th,td{padding:8px;border-bottom:1px solid #283252;text-align:left} th{color:#9ba5bd} a{color:#7a93ff} .stats{color:#9ba5bd;font-size:14px;margin:0 0 8px} .ctrl{background:#161e33;border:1px solid #283252;border-radius:12px;padding:16px;margin:12px 0 18px} .ctrl-top{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px} .act{font-size:22px;font-weight:700;color:#7dffa9;margin-top:2px} .lbl{color:#9ba5bd;font-size:12px;text-transform:uppercase;letter-spacing:.04em} .grupo{display:flex;gap:10px;flex-wrap:wrap} .ctrl form{display:inline;margin:0} .ctrl button{width:auto;margin-top:0;padding:10px 14px;font-size:14px} .rojo{background:#cc2539} .verde{background:#1f9d57} .chico{padding:7px 11px;font-size:13px;opacity:.92} .jp{margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;align-items:center} .jp .lbl{margin-right:4px} .nota{color:#9ba5bd;font-size:13px;margin:12px 0 0} .count{color:#9ba5bd;font-size:12px;margin-top:14px}";
  return "<!doctype html><html lang=es><head><meta charset=utf-8><meta name=viewport content=\"width=device-width, initial-scale=1\"><title>Centinela · Panel</title><style>" + LOGIN_CSS + EXTRA + "</style></head><body><div class=top>"
    + "<div class=hdr><h1>Panel de Centinela</h1><a href=\"/admin/salir\">Salir (" + escHtml(username) + ")</a></div>"
    + "<div class=ctrl><div class=ctrl-top><div><span class=lbl>Atendiendo ahora</span><div class=act>" + escHtml(act) + "</div></div>"
    + "<div class=grupo>" + btn("JE","pausar","rojo","⏸ Detener JE") + btn("JE","reactivar","verde","▶ Reactivar JE") + "</div></div>"
    + "<div class=jp><span class=lbl>Respaldo</span>" + btn("JP","pausar","rojo chico","Detener JP") + btn("JP","reactivar","verde chico","Reactivar JP") + "</div>"
    + "<p class=nota>Detener un nodo lo deja de atender DE VERDAD (responde 503): el gateway enruta el tráfico al otro nodo (otra máquina, otro internet). Reactiva para repetir.</p></div>"
    + "<p class=stats>" + linea + " · datos vía " + escHtml(act) + "</p>"
    + "<table><thead><tr><th>Numero</th><th>Pais</th><th>Riesgo</th><th>Nivel</th><th>Reportes</th><th>Tipo</th></tr></thead><tbody>" + filas + "</tbody></table>"
    + "<p class=count>Datos de /api/top y /api/stats (JE/JP), cargados por el gateway. Sin scripts en el navegador — compatible con el blindaje (CSP).</p></div></body></html>";
}

async function handleAdmin(req, env, url) {
  const user = env.ADMIN_USER || "";
  const hash = env.ADMIN_HASH || "";
  const totp = env.ADMIN_TOTP || "";
  const secret = env.SECRET_KEY || "centinela";
  const cookies = parseCookies(req);
  const ses = cookies["centinela_admin"] || "";
  const valid = await sesionValida(ses, secret);
  if (url.pathname === "/admin/salir") {
    const r = new Response("", { status: 303, headers: { Location: "/admin/login", "Set-Cookie": "centinela_admin=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict; Secure" } });
    return r;
  }
  if (req.method === "POST" && url.pathname === "/admin/login") {
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/x-www-form-urlencoded")) return new Response("Unsupported", { status: 415 });
    const body = await req.text();
    const params = new URLSearchParams(body);
    const usuario = params.get("usuario") || "";
    const clave = params.get("clave") || "";
    const codigo = params.get("codigo") || "";
    const ip = req.headers.get("CF-Connecting-IP") || "0.0.0.0";
    if (loginBloqueado(ip)) {
      return new Response(loginHtml("Demasiados intentos. Espera 15 minutos.", false), { status: 429, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    const const1 = usuario.length === String(user).length;
    let ok = false;
    if (const1) {
      let uOk = true; for (let i = 0; i < usuario.length; i += 1) uOk &= (usuario[i] === user[i]);
      const pOk = await claveOk(clave, hash);
      const tOk = await totpOk(totp, codigo);
      ok = Boolean(uOk && pOk && tOk);
    } else {
      // tarea la misma: pbkdf2 para no filtrar tiempo user-enum
      await claveOk(clave, hash);
    }
    if (!ok) {
      registrarFallo(ip);
      return new Response(loginHtml("Datos incorrectos.", Boolean(totp)), { status: 401, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    limpiarFallos(ip);
    const token = await firmarAsync(user, secret);
    const r = new Response("", { status: 303, headers: { Location: "/admin", "Set-Cookie": `centinela_admin=${token}; HttpOnly; Path=/; Max-Age=1800; SameSite=Strict; Secure` } });
    return r;
  }
  if (url.pathname === "/admin/login") {
    if (valid) return new Response("", { status: 303, headers: { Location: "/admin" } });
    return new Response(loginHtml("", Boolean(totp)), { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (req.method === "POST" && url.pathname === "/admin/control") {
    if (!valid) return new Response("", { status: 303, headers: { Location: "/admin/login" } });
    const body = await req.text();
    const params = new URLSearchParams(body);
    const nodo = params.get("nodo") === "JP" ? "JP" : "JE";
    const accion = params.get("accion") === "pausar" ? "pausar" : "reactivar";
    const base = ((nodo === "JE" ? env.NODO_PRINCIPAL : env.NODO_RESPALDO) || "").replace(/\/$/, "");
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 8000);
      try { await fetch(base + "/api/control?accion=" + accion, { method: "POST", headers: { "x-centinela-control": env.CONTROL_TOKEN || "" }, signal: c.signal }); }
      finally { clearTimeout(t); }
    } catch (e) {}
    return new Response("", { status: 303, headers: { Location: "/admin" } });
  }
  // GET /admin
  if (!valid) return new Response("", { status: 303, headers: { Location: "/admin/login" } });
  const d = await datosPanel(env);
  return new Response(panelHtml(user, d), { headers: { "content-type": "text/html; charset=utf-8" } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));

    const ip = req.headers.get("CF-Connecting-IP") || "0.0.0.0";
    // Admin en el borde si hay credenciales (profesor): no depende de JE
    const esAdmin = url.pathname === "/admin" || url.pathname === "/admin/login" || url.pathname === "/admin/salir" || url.pathname === "/admin/control";
    if (esAdmin && env.ADMIN_USER && env.ADMIN_HASH) {
      return cors(await handleAdmin(req, env, url));
    }
    // Alias amigable: /login -> /admin/login (si admin en borde, el anterior ya lo atendió; si no, proxeamos)
    if (url.pathname === "/login") {
      if (env.ADMIN_USER && env.ADMIN_HASH) {
        // redirigir a /admin/login sin pasar por nodos
        const u2 = new URL(req.url);
        u2.pathname = "/admin/login";
        const r = await handleAdmin(req, env, u2);
        return cors(r);
      }
      url.pathname = "/admin/login";
      return cors(await proxy(req, env, url));
    }
    const esApi = url.pathname.startsWith("/api/") || url.pathname === "/health"
      || url.pathname.startsWith("/admin");

    if (esApi) {
      const esChat = url.pathname.startsWith("/api/chat");
      const cubeta = esChat ? "chat:" : "api:";
      const tope = esChat ? Number(env.LIMITE_CHAT_MIN || 20) : Number(env.LIMITE_MIN || 200);
      if (limitado(cubeta + ip, tope)) {
        return cors(json({ error: "Demasiadas peticiones. Espera un minuto." }, 429,
          { "Retry-After": "60" }));
      }
    }

    if (url.pathname === "/gateway/estado") return cors(json(await estado(env)));
    if (esApi) return cors(await proxy(req, env, url));
    if (env.ASSETS) return cors(await env.ASSETS.fetch(req));
    return cors(json({ servicio: "Centinela gateway", rutas: ["/api/*", "/health", "/gateway/estado"] }));
  },
};

function nodos(env) {
  return [
    { nombre: "JE", base: (env.NODO_PRINCIPAL || "").replace(/\/$/, "") },
    { nombre: "JP", base: (env.NODO_RESPALDO || "").replace(/\/$/, "") },
  ].filter((n) => n.base);
}

async function conTimeout(recurso, opciones, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(recurso, { ...opciones, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function vivo(n) {
  const t0 = Date.now();
  try {
    const r = await conTimeout(n.base + "/health", {}, TIMEOUT_MS);
    if (r.status >= 500) throw new Error("HTTP " + r.status);
    return { nombre: n.nombre, online: true, latencia_ms: Date.now() - t0, health: await r.json() };
  } catch (e) {
    return { nombre: n.nombre, online: false, latencia_ms: Date.now() - t0, error: motivo(e) };
  }
}

async function proxy(req, env, url) {
  const lista = nodos(env);
  const esLento = url.pathname.startsWith("/api/chat") || url.pathname.startsWith("/api/bot");

  let cuerpo;
  if (!["GET", "HEAD"].includes(req.method)) {
    cuerpo = await req.arrayBuffer();
    if (cuerpo.byteLength > MAX_BODY) {
      return json({ error: "Cuerpo demasiado grande" }, 413);
    }
  }
  const fallas = [];

  for (const n of lista) {
    if (esLento) {
      const v = await vivo(n);
      if (!v.online) { fallas.push(`${n.nombre}:${v.error}`); continue; }
    }
    try {
      const h = new Headers(req.headers);
      h.delete("host");
      h.set("X-Real-IP", req.headers.get("CF-Connecting-IP") || "");
      h.set("X-Centinela-Gateway", "1");
      const r = await conTimeout(n.base + url.pathname + url.search,
        { method: req.method, headers: h, body: cuerpo }, esLento ? TIMEOUT_CHAT_MS : TIMEOUT_MS);
      if (r.status >= 500) { fallas.push(`${n.nombre}:HTTP ${r.status}`); continue; }
      const resp = new Response(r.body, r);
      resp.headers.set("X-Centinela-Nodo", n.nombre);
      if (fallas.length) resp.headers.set("X-Centinela-Failover", fallas.join(" | "));
      return resp;
    } catch (e) {
      fallas.push(`${n.nombre}:${motivo(e)}`);
    }
  }
  return json({ error: "Todos los nodos están fuera de línea", detalle: fallas }, 503);
}

async function estado(env) {
  const res = await Promise.all(nodos(env).map(vivo));
  const activo = res.find((r) => r.online);
  return { activo: activo ? activo.nombre : null, nodos: res, hora: new Date().toISOString() };
}

function motivo(e) {
  return e && e.name === "AbortError" ? "timeout"
    : e && e.message && e.message.startsWith("HTTP") ? e.message : "sin conexión";
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

function cors(resp) {
  const r = new Response(resp.body, resp);
  r.headers.set("Access-Control-Allow-Origin", "*");
  r.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  r.headers.set("Access-Control-Allow-Headers", "content-type");
  r.headers.set("Access-Control-Expose-Headers", "X-Centinela-Nodo, X-Centinela-Failover");
  r.headers.set("X-Content-Type-Options", "nosniff");
  r.headers.set("X-Frame-Options", "DENY");
  r.headers.set("Referrer-Policy", "no-referrer");
  r.headers.set("Strict-Transport-Security", "max-age=31536000");
  r.headers.set("Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; " +
    "connect-src 'self'; frame-ancestors 'none'");
  return r;
}
