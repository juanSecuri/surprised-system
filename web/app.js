/* CENTINELA · lógica de la web
   La web se sirve desde el mismo Worker de Cloudflare, así que la API está en el mismo
   origen (/api/...). Para probar en local: index.html?api=https://centinela.xxx.workers.dev */
"use strict";

const API = new URLSearchParams(location.search).get("api") ||
  (location.protocol === "file:" ? "https://centinela.juan-gallego-sec.workers.dev" : "");

const $ = (s) => document.querySelector(s);
const CATEGORIAS = {
  estafa: "Estafa", suplantacion: "Falso banco o entidad", cobranza: "Cobranza",
  telemarketing: "Venta / telemarketing", wangiri: "Llamada perdida internacional",
  extorsion: "Extorsión", encuesta: "Encuesta", otro: "Otro", "sin clasificar": "Sin clasificar",
};
const CANALES = { web: "web", telegram: "Telegram", android: "celular" };

async function pedir(ruta, opciones = {}) {
  const r = await fetch(API + ruta, {
    ...opciones,
    headers: { "content-type": "application/json", ...(opciones.headers || {}) },
  });
  let data = null;
  try { data = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) {
    const msg = (data && (data.detail || data.error)) || `Error ${r.status}`;
    throw new Error(typeof msg === "string" ? msg : "Solicitud inválida");
  }
  return { data, nodo: r.headers.get("X-Centinela-Nodo"), failover: r.headers.get("X-Centinela-Failover") };
}

/* ---------- formato ---------- */
function formatoNumero(n) {
  if (!n) return "";
  const m = n.match(/^\+57(\d{3})(\d{3})(\d{4})$/);
  if (m) return `+57 ${m[1]} ${m[2]} ${m[3]}`;
  const caribe = n.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (caribe) return `+1 ${caribe[1]} ${caribe[2]} ${caribe[3]}`;
  return n.replace(/^(\+\d{2,3})(\d+)$/, "$1 $2");
}
function hace(fecha) {
  const s = Math.max(0, (Date.now() - new Date(fecha).getTime()) / 1000);
  if (s < 60) return "hace un momento";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}
function duracion(seg) {
  if (seg == null) return "—";
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)} d ${h % 24} h`;
  return h ? `${h} h ${m} min` : `${m} min`;
}
const nivelTxt = { alto: "Riesgo alto", medio: "Riesgo medio", bajo: "Riesgo bajo" };
const el = (tag, props = {}, ...hijos) => {
  const e = Object.assign(document.createElement(tag), props);
  hijos.forEach((h) => e.append(h));
  return e;
};

/* ---------- reloj del teléfono ---------- */
function reloj() {
  $("#hora").textContent = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", hour12: false });
}
reloj(); setInterval(reloj, 20000);

/* ---------- consulta (hero) ---------- */
const inputNum = $("#numero");
inputNum.addEventListener("input", () => {
  $(".prefijo").style.display = /^\s*(\+|00)/.test(inputNum.value) ? "none" : "";
});

function pintarPantalla(f, nodo) {
  const p = $("#pantalla");
  const score = f.score ?? 0;
  p.dataset.nivel = f.nivel || "bajo";
  $("#estado-llamada").textContent = "Llamada entrante";
  $("#caller").textContent = formatoNumero(f.numero);
  $("#pais").textContent = f.pais || "";
  $("#arco").style.strokeDashoffset = 314.16 * (1 - score / 100);

  // contador animado
  const ini = performance.now(), dur = 900, out = $("#score");
  const paso = (t) => {
    const k = Math.min(1, (t - ini) / dur);
    out.textContent = Math.round(score * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);

  let veredicto, detalle;
  const n = f.total_reportes || 0;
  const cat = f.categoria_principal ? CATEGORIAS[f.categoria_principal] || f.categoria_principal : null;
  if (f.verificado) {
    veredicto = "Número verificado"; detalle = "Pertenece a una entidad legítima.";
  } else if (f.nivel === "alto") {
    veredicto = "Mejor no contestes";
  } else if (f.nivel === "medio") {
    veredicto = "Contesta con cuidado";
  } else {
    veredicto = n ? "Riesgo bajo" : "Sin reportes";
  }
  if (!detalle) {
    if (n) {
      detalle = `${n} ${n === 1 ? "reporte" : "reportes"}${cat ? ` · casi siempre ${cat.toLowerCase()}` : ""}.`;
      if (f.resumen_ia) detalle += ` ${f.resumen_ia}.`;
    } else if (score >= 25) {
      detalle = "Nadie lo ha reportado, pero el prefijo es de un país muy usado en estafas de llamada perdida.";
    } else {
      detalle = "Nadie lo ha reportado todavía. Si te pareció sospechoso, repórtalo.";
    }
  }
  $("#veredicto").textContent = veredicto;
  $("#detalle").textContent = detalle.replace(/\.\./g, ".");
  $("#atendio").textContent = f.modo === "degradado"
    ? `Respondió ${nodo || "un nodo"} en modo sin conexión (datos guardados)`
    : nodo ? `Respondió el servidor ${nodo}` : "";
}

$("#form-consulta").addEventListener("submit", async (e) => {
  e.preventDefault();
  const valor = inputNum.value.trim();
  if (!valor) return;
  const btn = e.submitter || $("#form-consulta button");
  btn.disabled = true; btn.textContent = "Consultando…";
  $("#estado-llamada").textContent = "Identificando…";
  try {
    const { data, nodo } = await pedir(`/api/numero/${encodeURIComponent(valor)}`);
    pintarPantalla(data, nodo);
    $("#r-numero").value = formatoNumero(data.numero);
  } catch (err) {
    $("#pantalla").dataset.nivel = "espera";
    $("#estado-llamada").textContent = "No se pudo consultar";
    $("#veredicto").textContent = err.message === "Número inválido" ? "Número inválido" : "Sin conexión";
    $("#detalle").textContent = err.message === "Número inválido"
      ? "Revisa que tenga entre 7 y 15 dígitos."
      : "Los servidores no respondieron. Intenta de nuevo en unos segundos.";
  } finally {
    btn.disabled = false; btn.textContent = "Consultar";
  }
});

/* ---------- reportar ---------- */
$("#form-reporte").addEventListener("submit", async (e) => {
  e.preventDefault();
  const out = $("#r-resultado");
  const btn = e.submitter || $("#form-reporte button");
  const cat = document.querySelector('input[name="cat"]:checked');
  const cuerpo = {
    numero: $("#r-numero").value.trim(),
    categoria: cat ? cat.value : null,
    descripcion: $("#r-desc").value.trim() || null,
    canal: "web",
  };
  btn.disabled = true; out.className = "resultado"; out.textContent = "Enviando…";
  try {
    const { data, nodo } = await pedir("/api/reportar", { method: "POST", body: JSON.stringify(cuerpo) });
    if (data.modo === "degradado") {
      out.textContent = "Reporte recibido. Se sincroniza con la base de datos apenas vuelva la conexión.";
    } else {
      const f = data.numero;
      out.textContent = `Reporte enviado. ${formatoNumero(f.numero)} queda en ${nivelTxt[f.nivel].toLowerCase()} (${f.score}/100)` +
        (cuerpo.descripcion && !cuerpo.categoria ? ". La IA lo está clasificando." : ".");
      pintarPantalla(f, nodo);
    }
    out.classList.add("ok");
    e.target.reset();
    setTimeout(cargarComunidad, 1500);
  } catch (err) {
    out.textContent = err.message.includes("Demasiados") ? "Enviaste muchos reportes seguidos. Espera unos minutos." :
      err.message === "Número inválido" ? "Ese número no es válido. Revisa los dígitos." :
      "No se pudo enviar. Revisa tu conexión e intenta otra vez.";
    out.classList.add("error");
  } finally { btn.disabled = false; }
});

/* ---------- comunidad ---------- */
function consultarDesdeLista(numero) {
  inputNum.value = numero; inputNum.dispatchEvent(new Event("input"));
  window.scrollTo({ top: 0, behavior: "smooth" });
  $("#form-consulta").requestSubmit();
}

async function cargarComunidad() {
  try {
    const [{ data: st }, { data: top }, { data: rec }] = await Promise.all([
      pedir("/api/stats"), pedir("/api/top?limite=8"), pedir("/api/recientes?limite=8"),
    ]);
    $("#c-numeros").textContent = st.numeros.toLocaleString("es-CO");
    $("#c-24h").textContent = st.reportes_24h.toLocaleString("es-CO");
    $("#c-alto").textContent = st.alto_riesgo.toLocaleString("es-CO");

    const ulTop = $("#top"); ulTop.replaceChildren();
    if (!top.length) ulTop.append(el("li", { className: "vacio", textContent: "Aún no hay reportes. Sé el primero." }));
    top.forEach((t) => {
      const li = el("li", { tabIndex: 0, title: "Ver detalle" },
        el("span", { className: "num", textContent: formatoNumero(t.numero) }),
        el("span", { className: `nivel ${t.nivel}`, textContent: `${t.score}` }),
        el("span", { className: "meta", textContent: `${t.total_reportes} ${t.total_reportes === 1 ? "reporte" : "reportes"} · ${CATEGORIAS[t.categoria_principal] || "sin clasificar"}` }));
      li.addEventListener("click", () => consultarDesdeLista(t.numero));
      li.addEventListener("keydown", (ev) => { if (ev.key === "Enter") consultarDesdeLista(t.numero); });
      ulTop.append(li);
    });

    const ulCat = $("#categorias"); ulCat.replaceChildren();
    const max = Math.max(1, ...st.por_categoria.map((c) => c.total));
    if (!st.por_categoria.length) ulCat.append(el("li", { className: "vacio", textContent: "Sin datos todavía." }));
    st.por_categoria.forEach((c) => {
      const llena = el("div", { className: "barra-llena" });
      llena.style.width = `${(c.total / max) * 100}%`;
      ulCat.append(el("li", {},
        el("span", { textContent: CATEGORIAS[c.categoria] || c.categoria }),
        el("b", { textContent: c.total }),
        el("div", { className: "barra-fondo" }, llena)));
    });

    const dias = $("#dias"); dias.replaceChildren();
    const porDia = Object.fromEntries(st.por_dia.map((d) => [String(d.dia).slice(0, 10), d.total]));
    const maxDia = Math.max(1, ...Object.values(porDia));
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
      const v = porDia[d] || 0;
      const s = el("span", { title: `${d}: ${v} reportes` });
      s.style.height = `${Math.max(4, (v / maxDia) * 100)}%`;
      dias.append(s);
    }

    const feed = $("#feed"); feed.replaceChildren();
    if (!rec.length) feed.append(el("li", { className: "vacio", textContent: "Aún no hay reportes." }));
    rec.forEach((r) => feed.append(el("li", {},
      el("span", { className: "num", textContent: formatoNumero(r.numero) }), " ",
      el("span", { className: `nivel ${r.nivel}`, textContent: nivelTxt[r.nivel] }),
      el("span", { className: "meta", textContent:
        `${CATEGORIAS[r.categoria] || "Sin clasificar"} · por ${CANALES[r.canal] || r.canal} · atendió ${r.nodo || "—"} · ${hace(r.creado)}` }))));
  } catch (err) {
    console.warn("Comunidad no disponible:", err.message);
  }
}

/* ---------- clúster en vivo ---------- */
let activoAnterior = null;

function pintarNodo(nombre, info, activo) {
  const art = $(`#nodo-${nombre}`);
  if (!art) return;
  const h = info && info.health;
  const estado = !info || !info.online ? "caido" : nombre === activo ? "activo" : "espera";
  art.dataset.estado = estado;
  art.querySelector(".estado").textContent =
    estado === "activo" ? "Atendiendo" : estado === "espera" ? "En espera, listo" : info && info.error === "HTTP 530" ? "Sin instalar o apagado" : "Fuera de línea";
  const m = (k, v) => { art.querySelector(`[data-m="${k}"]`).textContent = v; };
  m("lat", info && info.online ? `${info.latencia_ms} ms` : "—");
  m("cpu", h ? `${Math.round(h.cpu)} %` : "—");
  m("ram", h ? `${Math.round(h.ram)} %` : "—");
  m("temp", h && h.temp != null ? `${Math.round(h.temp)} °C` : "—");
  m("db", h ? (h.db ? "Conectada" : "Sin conexión") : "—");
  m("up", h ? duracion(h.uptime_seg) : "—");
}

async function cargarCluster() {
  const pill = $("#pulso"), txt = $("#pulso-txt");
  try {
    const { data } = await pedir("/gateway/estado");
    const porNombre = Object.fromEntries(data.nodos.map((n) => [n.nombre, n]));
    pintarNodo("JE", porNombre.JE, data.activo);
    pintarNodo("JP", porNombre.JP, data.activo);

    const act = data.activo ? porNombre[data.activo] : null;
    if (!act) {
      pill.dataset.estado = "caido"; txt.textContent = "Sin servidores";
    } else {
      pill.dataset.estado = data.activo === "JE" ? "ok" : "failover";
      txt.textContent = `Atendiendo ${data.activo} · ${act.latencia_ms} ms`;
    }
    $("#diag-nodo").classList.toggle("vivo", !!act);
    $("#diag-nodo b").textContent = data.activo || "JE / JP";
    $("#diag-ia").classList.toggle("vivo", !!(act && act.health && act.health.ollama));
    $("#chat-estado").textContent = act && act.health && act.health.ollama ? "Responde con IA local" : "IA en pausa · respuestas automáticas";

    const aviso = $("#aviso-failover");
    const hora = new Date().toLocaleTimeString("es-CO", { hour12: false });
    if (activoAnterior && data.activo !== activoAnterior) {
      aviso.hidden = false;
      if (data.activo === "JP") {
        aviso.className = "aviso-failover";
        aviso.textContent = `${hora} · JE dejó de responder. JP tomó el control y el servicio siguió funcionando.`;
      } else if (data.activo === "JE") {
        aviso.className = "aviso-failover ok";
        aviso.textContent = `${hora} · JE volvió a estar en línea y retomó como servidor principal.`;
      } else {
        aviso.className = "aviso-failover";
        aviso.textContent = `${hora} · Ningún servidor responde en este momento.`;
      }
    }
    activoAnterior = data.activo;
  } catch {
    pill.dataset.estado = "caido"; txt.textContent = "Sin conexión";
  }
}

async function cargarEventos() {
  try {
    const { data } = await pedir("/api/cluster");
    const ul = $("#eventos"); ul.replaceChildren();
    if (!data.eventos.length) ul.append(el("li", { className: "vacio", textContent: "Sin eventos." }));
    data.eventos.forEach((ev) => ul.append(el("li", {},
      el("time", { dateTime: ev.creado, textContent: new Date(ev.creado).toLocaleTimeString("es-CO", { hour12: false, hour: "2-digit", minute: "2-digit" }) }),
      el("span", { textContent: ev.detalle || ev.tipo }))));
  } catch { /* la bitácora es opcional */ }
}

/* ---------- chat ---------- */
const chat = $("#chat"), abrir = $("#chat-abrir");
function alternarChat(mostrar) {
  chat.hidden = !mostrar;
  abrir.setAttribute("aria-expanded", String(mostrar));
  if (mostrar) $("#chat-txt").focus();
}
abrir.addEventListener("click", () => alternarChat(chat.hidden));
$("#chat-cerrar").addEventListener("click", () => { alternarChat(false); abrir.focus(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !chat.hidden) alternarChat(false); });

$("#chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#chat-txt"), msgs = $("#chat-msgs");
  const texto = input.value.trim();
  if (!texto) return;
  msgs.append(el("p", { className: "msg yo", textContent: texto }));
  input.value = "";
  const pensando = el("p", { className: "msg bot pensando", textContent: "Revisando…" });
  msgs.append(pensando); msgs.scrollTop = msgs.scrollHeight;
  try {
    const { data } = await pedir("/api/chat", { method: "POST", body: JSON.stringify({ mensaje: texto }) });
    pensando.className = "msg bot";
    pensando.textContent = data.respuesta;
    pensando.append(el("small", { textContent:
      data.fuente === "ollama" ? `IA local · servidor ${data.nodo}` : `Respuesta automática · servidor ${data.nodo}` }));
  } catch {
    pensando.className = "msg bot";
    pensando.textContent = "No pude conectarme con los servidores. Intenta de nuevo en un momento.";
  }
  msgs.scrollTop = msgs.scrollHeight;
});

/* ---------- llamadas reales en vivo ----------
   Cuando el celular del proyecto recibe una llamada, MacroDroid/Atajos avisa a /api/llamada
   y aquí aparece en el teléfono de la página en menos de 4 segundos. */
let ultimaLlamada = null;
async function vigilarLlamadas() {
  try {
    const { data, nodo } = await pedir("/api/llamadas?limite=1");
    const l = data[0];
    if (!l) { ultimaLlamada = ultimaLlamada ?? 0; return; }
    if (ultimaLlamada === null) { ultimaLlamada = l.id; return; }   // no repetir llamadas viejas al abrir
    if (l.id === ultimaLlamada || l.segundos > 120) return;
    ultimaLlamada = l.id;
    pintarPantalla({ ...l, conocido: !!l.total_reportes }, l.nodo || nodo);
    $("#estado-llamada").textContent = "Llamada real entrante";
    $("#en-vivo").hidden = false;
    setTimeout(() => { $("#en-vivo").hidden = true; }, 60000);
    if (window.scrollY > 400) {
      $("#pulso-txt").textContent = "📞 Llamada entrante";
    }
  } catch { /* opcional: si falla, la web sigue normal */ }
}

/* ---------- arranque ---------- */
cargarCluster(); cargarComunidad(); cargarEventos();
setInterval(cargarCluster, 5000);
setInterval(cargarComunidad, 30000);
setInterval(cargarEventos, 15000);
vigilarLlamadas(); setInterval(vigilarLlamadas, 4000);
