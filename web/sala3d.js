/* CENTINELA · Sala de control 3D (Three.js, vendorizado para respetar el CSP estricto)
   Globo de amenazas con ciudades reales de Colombia (por indicativo) + clúster vivo,
   sonido en cada amenaza, teléfono 3D que timbra con llamadas reales y modo pantalla completa.
   Lee los mismos endpoints que app.js. Si no hay WebGL, se oculta solo. */
"use strict";
import * as THREE from "./vendor/three.module.js";

const API = new URLSearchParams(location.search).get("api") ||
  (location.protocol === "file:" ? "https://centinela.juan-gallego-sec.workers.dev" : "");

const lienzo = document.getElementById("sala3d");
const seccion = document.getElementById("sala");
if (lienzo) arrancar();

function arrancar() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true, powerPreference: "low-power" });
  } catch (e) { if (seccion) seccion.hidden = true; return; }

  const COL = { cobalto: 0x7a93ff, acento: 0x8ea2ff, verde: 0x3cc488, ambar: 0xf0b13d, rojo: 0xff5c70, linea: 0x283252, tinta: 0xe7ebf4 };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(48, 2, 0.1, 100);
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const luz = new THREE.PointLight(0xaec0ff, 60, 60); luz.position.set(4, 6, 8); scene.add(luz);
  const luz2 = new THREE.PointLight(0x4668e0, 30, 60); luz2.position.set(-6, -3, 4); scene.add(luz2);

  // ---------- GLOBO ----------
  const R = 2.4;
  const globo = new THREE.Group(); scene.add(globo);
  globo.add(new THREE.Mesh(new THREE.SphereGeometry(R, 32, 22),
    new THREE.MeshBasicMaterial({ color: COL.cobalto, wireframe: true, transparent: true, opacity: 0.18 })));
  globo.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.985, 32, 22),
    new THREE.MeshPhongMaterial({ color: 0x101a33, emissive: 0x0b1226, shininess: 8, transparent: true, opacity: 0.92 })));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.12, 24, 16),
    new THREE.MeshBasicMaterial({ color: COL.acento, transparent: true, opacity: 0.06, side: THREE.BackSide }));
  globo.add(halo);

  function enGlobo(lat, lon, r = R) {
    const phi = (90 - lat) * Math.PI / 180, theta = (lon + 180) * Math.PI / 180;
    return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  }
  const CASA = { lat: 4.6, lon: -74 };
  const marcaCasa = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), new THREE.MeshBasicMaterial({ color: COL.verde }));
  marcaCasa.position.copy(enGlobo(CASA.lat, CASA.lon)); globo.add(marcaCasa);

  // ---------- UBICACIÓN POR NÚMERO (ciudades reales de Colombia por indicativo) ----------
  const CIUDADES = {
    "601": ["Bogotá", 4.61, -74.08], "602": ["Cali", 3.44, -76.52], "604": ["Medellín", 6.25, -75.56],
    "605": ["Barranquilla", 10.96, -74.80], "606": ["Pereira", 4.81, -75.69],
    "607": ["Bucaramanga", 7.12, -73.12], "608": ["Tunja", 5.53, -73.36],
  };
  const PAISES = [
    [/^\+?1(809|829|849)/, "Rep. Dominicana", 18.5, -69.9], [/^\+?1/, "EE. UU.", 38, -97],
    [/^\+?52/, "México", 23, -102], [/^\+?51/, "Perú", -10, -76], [/^\+?58/, "Venezuela", 8, -66],
    [/^\+?593/, "Ecuador", -1.8, -78], [/^\+?54/, "Argentina", -34, -64], [/^\+?56/, "Chile", -33, -71],
    [/^\+?34/, "España", 40, -4], [/^\+?44/, "Reino Unido", 54, -2], [/^\+?91/, "India", 22, 79],
    [/^\+?234/, "Nigeria", 9, 8], [/^\+?233/, "Ghana", 8, -1], [/^\+?225/, "Costa de Marfil", 7.5, -5.5],
  ];
  function ubicar(numero) {
    const n = (numero || "").replace(/[^\d+]/g, "");
    const fijo = n.match(/^\+?57(60[1-8])/);
    if (fijo && CIUDADES[fijo[1]]) { const [c, la, lo] = CIUDADES[fijo[1]]; return { lat: la, lon: lo, lugar: c }; }
    if (/^\+?573\d{2}/.test(n)) return { lat: 4.6 + (Math.random() - .5) * 8, lon: -74 + (Math.random() - .5) * 9, lugar: "Móvil (Col.)" };
    for (const [re, nom, la, lo] of PAISES) if (re.test(n)) return { lat: la + (Math.random() - .5) * 5, lon: lo + (Math.random() - .5) * 5, lugar: nom };
    return { lat: (Math.random() - .5) * 100, lon: (Math.random() - .5) * 340, lugar: "Desconocido" };
  }
  const colorNivel = (nv) => nv === "alto" ? COL.rojo : nv === "medio" ? COL.ambar : COL.verde;

  // ---------- SONIDO (WebAudio, sin archivos → CSP intacto) ----------
  let audioCtx = null, sonidoOn = false;
  function armarAudio() {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }
  function tono(freq, at, dur, vol = 0.14, tipo = "sine") {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = tipo; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(audioCtx.destination); o.start(at); o.stop(at + dur + 0.02);
  }
  function ping(nivel) {
    if (!sonidoOn || !audioCtx) return;
    tono(nivel === "alto" ? 880 : nivel === "medio" ? 660 : 520, audioCtx.currentTime, 0.22);
  }
  function timbrar() {
    if (!sonidoOn || !audioCtx) return;
    const t0 = audioCtx.currentTime;
    for (let i = 0; i < 3; i++) { tono(480, t0 + i * 0.8, 0.32, 0.12, "triangle"); tono(620, t0 + i * 0.8 + 0.18, 0.32, 0.12, "triangle"); }
  }

  // ---------- NODOS DEL CLÚSTER ----------
  const frente = new THREE.Group(); scene.add(frente);
  function etiqueta(texto, color = COL.tinta) {
    const cv = document.createElement("canvas"); cv.width = 256; cv.height = 72;
    const g = cv.getContext("2d");
    g.font = "bold 34px Archivo, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = "#" + color.toString(16).padStart(6, "0"); g.fillText(texto, 128, 40);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(1.3, 0.37, 1); return sp;
  }
  function crearNodo(id, texto, pos, radio = 0.26) {
    const grupo = new THREE.Group(); grupo.position.copy(pos);
    const esfera = new THREE.Mesh(new THREE.IcosahedronGeometry(radio, 1),
      new THREE.MeshStandardMaterial({ color: COL.linea, emissive: 0x111a30, metalness: 0.4, roughness: 0.4 }));
    const anillo = new THREE.Mesh(new THREE.TorusGeometry(radio * 1.7, 0.02, 10, 40),
      new THREE.MeshBasicMaterial({ color: COL.acento, transparent: true, opacity: 0.5 }));
    anillo.rotation.x = Math.PI / 2;
    const lab = etiqueta(texto); lab.position.set(0, radio + 0.42, 0);
    grupo.add(esfera, anillo, lab); frente.add(grupo);
    return { id, grupo, esfera, anillo, pos: pos.clone() };
  }
  const P = {
    GW: new THREE.Vector3(0, 1.75, 3.4), JE: new THREE.Vector3(-1.95, 0.2, 3.4),
    JP: new THREE.Vector3(1.95, 0.2, 3.4), BD: new THREE.Vector3(-1.0, -1.5, 3.4), IA: new THREE.Vector3(1.0, -1.5, 3.4),
  };
  const N = {
    GW: crearNodo("GW", "Cloudflare", P.GW, 0.3), JE: crearNodo("JE", "JE · principal", P.JE, 0.3),
    JP: crearNodo("JP", "JP · respaldo", P.JP, 0.3), BD: crearNodo("BD", "Base de datos", P.BD, 0.22),
    IA: crearNodo("IA", "IA local", P.IA, 0.22),
  };
  const enlaces = [["GW", "JE"], ["GW", "JP"], ["JE", "BD"], ["JP", "BD"], ["JE", "IA"], ["JP", "IA"]].map(([a, b]) => {
    const mat = new THREE.LineBasicMaterial({ color: COL.linea, transparent: true, opacity: 0.6 });
    frente.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([P[a], P[b]]), mat));
    return { a, b, mat };
  });
  const paquetes = [];
  function paquete(a, b, color) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color }));
    frente.add(m); paquetes.push({ a: P[a], b: P[b], m, t: Math.random(), vel: 0.6 + Math.random() * 0.5 });
  }

  // ---------- TELÉFONO 3D (timbra con llamadas reales) ----------
  const telCv = document.createElement("canvas"); telCv.width = 300; telCv.height = 500;
  const telG = telCv.getContext("2d");
  const telTex = new THREE.CanvasTexture(telCv); telTex.colorSpace = THREE.SRGBColorSpace;
  const tele = new THREE.Group(); tele.position.set(0, 0.1, 4.6); tele.visible = false; scene.add(tele);
  tele.add(new THREE.Mesh(new THREE.BoxGeometry(1.15, 2.05, 0.14),
    new THREE.MeshStandardMaterial({ color: 0x0b1020, metalness: 0.6, roughness: 0.3 })));
  const telPant = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.9), new THREE.MeshBasicMaterial({ map: telTex }));
  telPant.position.z = 0.08; tele.add(telPant);
  let telHasta = 0;
  function dibujarTel(num, nivel, texto) {
    const g = telG;
    g.fillStyle = nivel === "alto" ? "#2a0b12" : nivel === "medio" ? "#2a1e0b" : "#0b2018";
    g.fillRect(0, 0, 300, 500);
    g.textAlign = "center"; g.fillStyle = "#cdd6ea";
    g.font = "bold 24px Archivo, sans-serif"; g.fillText("LLAMADA ENTRANTE", 150, 64);
    g.fillStyle = "#fff"; g.font = "bold 30px Archivo, sans-serif"; g.fillText(num || "Desconocido", 150, 130);
    const col = nivel === "alto" ? "#ff5c70" : nivel === "medio" ? "#f0b13d" : "#3cc488";
    g.fillStyle = col; g.beginPath(); g.arc(150, 250, 64, 0, 7); g.fill();
    g.fillStyle = "#0b1020"; g.font = "bold 34px Archivo, sans-serif";
    g.fillText(nivel === "alto" ? "SPAM" : nivel === "medio" ? "DUDA" : "OK", 150, 262);
    g.fillStyle = "#e7ebf4"; g.font = "18px Archivo, sans-serif";
    (texto || "").split("\n").slice(0, 3).forEach((l, i) => g.fillText(l.slice(0, 32), 150, 360 + i * 28));
    telTex.needsUpdate = true;
  }
  function mostrarLlamada(num, nivel, texto) {
    dibujarTel(num, nivel, texto); tele.visible = true; telHasta = performance.now() + 9000;
    timbrar(); ping(nivel);
  }

  // ---------- ARCOS DE AMENAZA ----------
  const arcos = [];
  const conteo = new Map();
  function lanzarArco(numero, nivel) {
    const o = ubicar(numero);
    conteo.set(o.lugar, (conteo.get(o.lugar) || 0) + 1); refrescarTop();
    const ini = enGlobo(o.lat, o.lon), fin = enGlobo(CASA.lat, CASA.lon);
    if (ini.distanceTo(fin) < 0.3) ini.add(new THREE.Vector3(0.5, 0.4, 0.2));
    const med = ini.clone().add(fin).multiplyScalar(0.5).normalize().multiplyScalar(R + 1.1 + Math.random() * 0.5);
    const curva = new THREE.QuadraticBezierCurve3(ini, med, fin);
    const color = colorNivel(nivel);
    const tubo = new THREE.Mesh(new THREE.TubeGeometry(curva, 40, 0.018, 6, false),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    const punta = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), new THREE.MeshBasicMaterial({ color }));
    globo.add(tubo, punta);
    arcos.push({ curva, tubo, punta, t: 0, vida: 1, fase: "viaja" });
    ping(nivel);
    if (arcos.length > 14) { const v = arcos.shift(); globo.remove(v.tubo, v.punta); }
  }
  function refrescarTop() {
    const ul = document.getElementById("sala-top-lista"); if (!ul) return;
    const top = [...conteo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    ul.replaceChildren();
    top.forEach(([lugar, n]) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${lugar}</span><b>${n}</b>`;
      ul.appendChild(li);
    });
  }

  // ---------- ESTADO DEL CLÚSTER ----------
  let activoAnterior = null, flash = 0;
  function pintarNodo(nodo, estado) {
    const c = estado === "activo" ? COL.verde : estado === "espera" ? COL.ambar : estado === "caido" ? COL.rojo : COL.linea;
    nodo.esfera.material.color.setHex(c); nodo.esfera.material.emissive.setHex(c);
    nodo.esfera.material.emissiveIntensity = estado === "off" ? 0.1 : 0.6;
    nodo.anillo.material.color.setHex(estado === "off" ? COL.linea : c);
  }
  async function estadoCluster() {
    try {
      const d = await (await fetch(API + "/gateway/estado")).json();
      const por = Object.fromEntries((d.nodos || []).map((n) => [n.nombre, n]));
      const activo = d.activo;
      pintarNodo(N.GW, "activo");
      ["JE", "JP"].forEach((k) => { const i = por[k]; pintarNodo(N[k], !i || !i.online ? "caido" : k === activo ? "activo" : "espera"); });
      const salud = activo && por[activo] && por[activo].health;
      pintarNodo(N.BD, salud && salud.db ? "activo" : "caido");
      pintarNodo(N.IA, salud && salud.ollama ? "activo" : "off");
      enlaces.forEach((e) => {
        const act = (e.a === "GW" && e.b === activo) || (e.a === activo && (e.b === "BD" || e.b === "IA"));
        e.mat.color.setHex(act ? COL.cobalto : COL.linea); e.mat.opacity = act ? 1 : 0.4;
      });
      paquetes.forEach((p) => frente.remove(p.m)); paquetes.length = 0;
      if (activo) { paquete("GW", activo, COL.cobalto); paquete(activo, "BD", COL.acento); if (salud && salud.ollama) paquete(activo, "IA", COL.acento); }
      if (activoAnterior && activo !== activoAnterior) flash = 1;
      activoAnterior = activo;
      estadoUI(activo, por);
    } catch { estadoUI(null, {}); }
  }
  function estadoUI(activo, por) {
    const chip = document.getElementById("sala-estado"); if (!chip) return;
    if (!activo) { chip.textContent = "Sin servidores"; chip.dataset.e = "caido"; return; }
    const lat = por[activo] && por[activo].latencia_ms;
    chip.textContent = `Atendiendo ${activo}${lat != null ? " · " + lat + " ms" : ""}`;
    chip.dataset.e = activo === "JE" ? "ok" : "failover";
  }

  // ---------- amenazas nuevas (reportes reales) ----------
  const vistos = new Set();
  async function amenazas(primera = false) {
    try {
      const d = await (await fetch(API + "/api/recientes?limite=8")).json();
      (d || []).slice().reverse().forEach((x) => {
        const clave = x.numero + "|" + x.creado;
        if (vistos.has(clave)) return;
        vistos.add(clave);
        if (!primera) lanzarArco(x.numero, x.nivel);
      });
      if (vistos.size > 200) vistos.clear();
    } catch {}
  }
  // ---------- llamadas reales (teléfono 3D) ----------
  let ultLlamada = null;
  async function llamadas() {
    try {
      const d = await (await fetch(API + "/api/llamadas?limite=1")).json();
      const l = d && d[0]; if (!l) return;
      if (ultLlamada === null) { ultLlamada = l.id; return; }
      if (l.id === ultLlamada || (l.segundos != null && l.segundos > 120)) return;
      ultLlamada = l.id;
      const txt = (l.categoria_principal ? l.categoria_principal : "") + (l.total_reportes ? `\n${l.total_reportes} reportes` : "");
      mostrarLlamada(l.numero || "Oculto", l.nivel || "bajo", txt);
    } catch {}
  }

  // ---------- cámara + controles ----------
  let objT = 0.35, theta = 0.35, phi = 0.12, objP = 0.12, arrastrando = false, px = 0, py = 0;
  const foco = new THREE.Vector3(0, 0.1, 1.2);
  lienzo.addEventListener("pointerdown", (e) => { armarAudio(); arrastrando = true; px = e.clientX; py = e.clientY; lienzo.setPointerCapture(e.pointerId); });
  lienzo.addEventListener("pointerup", (e) => { arrastrando = false; try { lienzo.releasePointerCapture(e.pointerId); } catch {} });
  lienzo.addEventListener("pointermove", (e) => {
    if (!arrastrando) return;
    objT += (e.clientX - px) * 0.005; objP += (e.clientY - py) * 0.005; px = e.clientX; py = e.clientY;
    objT = Math.max(-0.9, Math.min(0.9, objT)); objP = Math.max(-0.35, Math.min(0.6, objP));
  });
  function medir() {
    const w = lienzo.clientWidth, h = lienzo.clientHeight || Math.round(w * 0.62);
    renderer.setSize(w, h, false); camara.aspect = w / h; camara.updateProjectionMatrix();
  }
  new ResizeObserver(medir).observe(lienzo); medir();

  // botones: sonido + pantalla completa
  const btnSon = document.getElementById("sala-sonido");
  if (btnSon) btnSon.addEventListener("click", () => { armarAudio(); sonidoOn = !sonidoOn; btnSon.textContent = sonidoOn ? "🔊" : "🔇"; btnSon.setAttribute("aria-pressed", String(sonidoOn)); if (sonidoOn) ping("medio"); });
  const btnFull = document.getElementById("sala-full");
  const caja = document.querySelector(".sala-lienzo");
  if (btnFull && caja) btnFull.addEventListener("click", () => { if (document.fullscreenElement) document.exitFullscreen(); else caja.requestFullscreen && caja.requestFullscreen(); });
  document.addEventListener("fullscreenchange", () => setTimeout(medir, 60));

  // ---------- bucle ----------
  const reloj = new THREE.Clock();
  function animar() {
    const dt = Math.min(0.05, reloj.getDelta());
    if (!reduce) globo.rotation.y += dt * 0.05;
    theta += (objT - theta) * 0.08; phi += (objP - phi) * 0.08;
    const rad = 8.6;
    camara.position.set(Math.sin(theta) * rad, 1.1 + phi * 3, Math.cos(theta) * rad);
    camara.lookAt(foco);

    Object.values(N).forEach((n) => { if (!reduce) n.anillo.rotation.z += dt * 0.6; });
    paquetes.forEach((p) => { p.t += dt * p.vel; if (p.t > 1) p.t -= 1; p.m.position.lerpVectors(p.a, p.b, p.t); });

    for (let i = arcos.length - 1; i >= 0; i--) {
      const a = arcos[i];
      if (a.fase === "viaja") {
        a.t += dt * 0.5; a.punta.position.copy(a.curva.getPointAt(Math.min(1, a.t)));
        if (a.t >= 1) { a.fase = "apaga"; globo.remove(a.punta); }
      } else { a.vida -= dt * 0.25; a.tubo.material.opacity = Math.max(0, a.vida * 0.85); if (a.vida <= 0) { globo.remove(a.tubo); arcos.splice(i, 1); } }
    }

    // teléfono timbrando
    if (tele.visible) {
      tele.rotation.z = Math.sin(reloj.elapsedTime * 22) * 0.06;
      tele.position.y = 0.1 + Math.sin(reloj.elapsedTime * 3) * 0.05;
      if (performance.now() > telHasta) { tele.visible = false; tele.rotation.z = 0; }
    }

    if (flash > 0) { flash = Math.max(0, flash - dt * 1.2); halo.material.opacity = 0.06 + flash * 0.35; halo.material.color.setHex(flash > 0.5 ? COL.rojo : COL.acento); }
    else halo.material.color.setHex(COL.acento);

    renderer.render(scene, camara);
  }
  renderer.setAnimationLoop(() => { if (!document.hidden) animar(); });

  // ---------- arranque de datos ----------
  estadoCluster(); amenazas(true); llamadas();
  setInterval(estadoCluster, 5000);
  setInterval(() => amenazas(false), 6000);
  setInterval(llamadas, 4000);
  if (!reduce) setTimeout(() => { lanzarArco("+57 604 000 0000", "alto"); lanzarArco("+57 602 000 0000", "medio"); }, 1200);
}
