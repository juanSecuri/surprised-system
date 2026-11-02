/**
 * CENTINELA · Gateway con failover automático (Cloudflare Worker, plan gratis)
 *
 *   Usuario ──► centinela.<tu-cuenta>.workers.dev ──► JE (principal, Tailscale Funnel)
 *                                                └─► JP (respaldo) si JE no responde
 *
 * - Cada petición /api/* y /health intenta primero JE; si falla (timeout, error de red
 *   o 5xx) pasa a JP en el mismo instante. El usuario nunca ve el error.
 * - La respuesta lleva el encabezado X-Centinela-Nodo: JE | JP (para demostrarlo en clase).
 * - /gateway/estado consulta ambos nodos en paralelo (para el panel "Clúster en vivo").
 * - Variables (wrangler.toml o panel de Cloudflare): NODO_PRINCIPAL, NODO_RESPALDO.
 */

const TIMEOUT_MS = 4000;     // tiempo máximo para decidir que un nodo está caído
const TIMEOUT_CHAT_MS = 90000; // la IA puede tardar en responder

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    if (url.pathname === "/gateway/estado") return cors(json(await estado(env)));
    if (url.pathname.startsWith("/api/") || url.pathname === "/health") {
      return cors(await proxy(req, env, url));
    }
    if (env.ASSETS) return env.ASSETS.fetch(req); // la web (fase 2) se sirve desde aquí
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
  const cuerpo = ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer();
  const fallas = [];

  for (const n of lista) {
    // Para el chat (lento) primero confirmamos con /health que el nodo está vivo
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
  return e && e.name === "AbortError" ? "timeout" : e && e.message && e.message.startsWith("HTTP") ? e.message : "sin conexión";
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8" },
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
