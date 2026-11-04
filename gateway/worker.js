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
 */

const TIMEOUT_MS = 8000;        // un nodo que no responde en 8 s se considera caído
const TIMEOUT_CHAT_MS = 90000;  // la IA puede tardar
const MAX_BODY = 4096;          // cuerpo máximo de una petición (bytes); corta payloads de ataque

// Escudo por IP: ventana deslizante en memoria del isolate. Es defensa en profundidad;
// la barrera principal son las "Rate limiting rules" de Cloudflare (ver docs/09_BLINDAJE.md).
const VENTANA_MS = 60000;
const visitas = new Map();      // ip -> number[] (timestamps)

function limitado(ip, maximo) {
  const ahora = Date.now();
  const cola = (visitas.get(ip) || []).filter((t) => ahora - t < VENTANA_MS);
  cola.push(ahora);
  visitas.set(ip, cola);
  if (visitas.size > 5000) {     // tope de memoria: suelta la IP más antigua
    visitas.delete(visitas.keys().next().value);
  }
  return cola.length > maximo;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));

    const ip = req.headers.get("CF-Connecting-IP") || "0.0.0.0";
    const esApi = url.pathname.startsWith("/api/") || url.pathname === "/health";

    if (esApi) {
      const tope = url.pathname.startsWith("/api/chat")
        ? Number(env.LIMITE_CHAT_MIN || 12) : Number(env.LIMITE_MIN || 100);
      if (limitado(ip, tope)) {
        return cors(json({ error: "Demasiadas peticiones. Espera un minuto." }, 429,
          { "Retry-After": "60" }));
      }
    }

    if (url.pathname === "/gateway/estado") return cors(json(await estado(env)));
    if (esApi) return cors(await proxy(req, env, url));
    if (env.ASSETS) return env.ASSETS.fetch(req);
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
  const esChat = url.pathname.startsWith("/api/chat");

  let cuerpo;
  if (!["GET", "HEAD"].includes(req.method)) {
    cuerpo = await req.arrayBuffer();
    if (cuerpo.byteLength > MAX_BODY) {
      return json({ error: "Cuerpo demasiado grande" }, 413);
    }
  }
  const fallas = [];

  for (const n of lista) {
    // Para el chat (lento) confirmamos primero con /health que el nodo está vivo
    if (esChat) {
      const v = await vivo(n);
      if (!v.online) { fallas.push(`${n.nombre}:${v.error}`); continue; }
    }
    try {
      const h = new Headers(req.headers);
      h.delete("host");
      h.set("X-Real-IP", req.headers.get("CF-Connecting-IP") || "");
      h.set("X-Centinela-Gateway", "1");
      const r = await conTimeout(n.base + url.pathname + url.search,
        { method: req.method, headers: h, body: cuerpo }, esChat ? TIMEOUT_CHAT_MS : TIMEOUT_MS);
      // 5xx = nodo en problemas → probar el siguiente. 429 = el nodo frena al cliente: se respeta.
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
  return r;
}
