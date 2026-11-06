/* CENTINELA · Sala de control 3D (Three.js, vendorizado para respetar el CSP estricto)
   Globo de amenazas con ciudades reales de Colombia (por indicativo) + clúster vivo,
   sonido en cada amenaza y modo pantalla completa.
   Las llamadas reales se pintan SOLO en el teléfono del hero (app.js).
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

  // ---------- GLOBO TIERRA (procedural, sin imágenes externas por CSP) ----------
  const R = 2.4;
  const globo = new THREE.Group(); scene.add(globo);
  // textura procedural Tierra: océano oscuro + continentes aprox + graticula
  function texturaTierra() {
    const w = 1024, h = 512;
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const g = cv.getContext("2d");
    g.fillStyle = "#0a1a33"; g.fillRect(0, 0, w, h); // océano
    // continentes aprox (lon/lat -> x/y)
    const tierra = (lon, lat, rx, ry) => { const x = (lon + 180) / 360 * w, y = (90 - lat) / 180 * h; g.fillStyle = "#1a3a5f"; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill(); };
    // Norteamérica
    tierra(-100, 45, 110, 45); tierra(-80, 35, 40, 30); tierra(-120, 60, 70, 25);
    // Sudamérica
    tierra(-60, -10, 55, 55); tierra(-55, -25, 30, 25);
    // África
    tierra(20, 5, 60, 45); tierra(10, 20, 40, 20);
    // Europa
    tierra(10, 50, 35, 20); tierra(25, 60, 30, 15);
    // Asia
    tierra(80, 45, 120, 40); tierra(110, 30, 60, 30); tierra(75, 20, 25, 20);
    // Oceanía
    tierra(135, -25, 35, 22);
    // graticula suave
    g.strokeStyle = "rgba(122,147,255,0.12)"; g.lineWidth = 1;
    for (let i = 0; i < 360; i += 15) { g.beginPath(); g.moveTo(i / 360 * w, 0); g.lineTo(i / 360 * w, h); g.stroke(); }
    for (let j = 0; j < 180; j += 15) { g.beginPath(); g.moveTo(0, j / 180 * h); g.lineTo(w, j / 180 * h); g.stroke(); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; return tex;
  }
  const tierraTex = texturaTierra();
  // malla wireframe (malla del globo)
  globo.add(new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32),
    new THREE.MeshBasicMaterial({ color: COL.cobalto, wireframe: true, transparent: true, opacity: 0.14 })));
  // superficie sólida Tierra
  globo.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.985, 64, 48),
    new THREE.MeshPhongMaterial({ map: tierraTex, emissive: 0x0b1226, shininess: 8, transparent: true, opacity: 0.96 })));
  // atmósfera (BackSide glow)
  const halo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.18, 32, 24),
    new THREE.MeshBasicMaterial({ color: COL.acento, transparent: true, opacity: 0.08, side: THREE.BackSide }));
  globo.add(halo);
  // estrellas (puntos fuera del globo)
  {
    const N2 = 900; const pos = new Float32Array(N2 * 3);
    for (let i = 0; i < N2; i++) {
      const r = 7 + Math.random() * 18, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = r * Math.cos(ph); pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xaac0ff, size: 0.04, transparent: true, opacity: 0.7 }));
    scene.add(stars);
  }

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
    if (flash > 0) { flash = Math.max(0, flash - dt * 1.2); halo.material.opacity = 0.06 + flash * 0.35; halo.material.color.setHex(flash > 0.5 ? COL.rojo : COL.acento); }
    else halo.material.color.setHex(COL.acento);
    renderer.render(scene, camara);
  }
  renderer.setAnimationLoop(() => { if (!document.hidden) animar(); });

  // ---------- arranque de datos (optimizado: app.js ya hace llamadas al hero; aquí solo cluster + amenazas) ----------
  estadoCluster(); amenazas(true);
  setInterval(() => { if (!document.hidden) estadoCluster(); }, 10000);
  setInterval(() => { if (!document.hidden) amenazas(false); }, 12000);
  if (!reduce) setTimeout(() => { lanzarArco("+57 604 000 0000", "alto"); lanzarArco("+57 602 000 0000", "medio"); }, 1200);
}
