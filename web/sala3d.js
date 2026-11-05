/* CENTINELA · Sala de control 3D (Three.js, vendorizado para respetar el CSP estricto)
   Dibuja el clúster vivo + un globo de amenazas con arcos de reportes REALES.
   Lee los mismos endpoints que app.js: /gateway/estado y /api/recientes.
   Si el navegador no soporta WebGL, se oculta solo y la web sigue igual. */
"use strict";
import * as THREE from "./vendor/three.module.js";

const API = new URLSearchParams(location.search).get("api") ||
  (location.protocol === "file:" ? "https://centinela.juan-gallego-sec.workers.dev" : "");

const lienzo = document.getElementById("sala3d");
const seccion = document.getElementById("sala");
if (!lienzo) { /* nada que hacer */ } else arrancar();

function arrancar() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, alpha: true, powerPreference: "low-power" });
  } catch (e) {
    if (seccion) seccion.hidden = true;       // sin WebGL: ocultamos la escena, el resto de la web queda intacto
    return;
  }
  const C = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const COL = {
    cobalto: 0x7a93ff, acento: 0x8ea2ff, verde: 0x3cc488, ambar: 0xf0b13d,
    rojo: 0xff5c70, linea: 0x283252, tinta: 0xe7ebf4,
  };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(48, 2, 0.1, 100);
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const luz = new THREE.PointLight(0xaec0ff, 60, 60); luz.position.set(4, 6, 8); scene.add(luz);
  const luz2 = new THREE.PointLight(0x4668e0, 30, 60); luz2.position.set(-6, -3, 4); scene.add(luz2);

  // ---------- GLOBO DE AMENAZAS ----------
  const R = 2.4;
  const globo = new THREE.Group(); scene.add(globo);
  const malla = new THREE.Mesh(
    new THREE.SphereGeometry(R, 32, 22),
    new THREE.MeshBasicMaterial({ color: COL.cobalto, wireframe: true, transparent: true, opacity: 0.18 }));
  globo.add(malla);
  const nucleo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 0.985, 32, 22),
    new THREE.MeshPhongMaterial({ color: 0x101a33, emissive: 0x0b1226, shininess: 8, transparent: true, opacity: 0.92 }));
  globo.add(nucleo);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.12, 24, 16),
    new THREE.MeshBasicMaterial({ color: COL.acento, transparent: true, opacity: 0.06, side: THREE.BackSide }));
  globo.add(halo);

  // de lat/long a un punto en la superficie del globo
  function enGlobo(lat, lon, r = R) {
    const phi = (90 - lat) * Math.PI / 180, theta = (lon + 180) * Math.PI / 180;
    return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  }
  const CASA = { lat: 4.6, lon: -74 };                 // Colombia: a donde llegan los ataques
  const marcaCasa = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12),
    new THREE.MeshBasicMaterial({ color: COL.verde }));
  marcaCasa.position.copy(enGlobo(CASA.lat, CASA.lon)); globo.add(marcaCasa);

  // prefijo del número -> país aproximado (datos reales del reporte, ubicación a nivel país)
  function ubicar(numero) {
    const n = (numero || "").replace(/[^\d+]/g, "");
    const t = [
      [/^\+?57/, 4.6, -74], [/^\+?1(809|829|849)/, 18.5, -69.9], [/^\+?1/, 38, -97],
      [/^\+?52/, 23, -102], [/^\+?51/, -10, -76], [/^\+?58/, 8, -66], [/^\+?593/, -1.8, -78],
      [/^\+?54/, -34, -64], [/^\+?56/, -33, -71], [/^\+?34/, 40, -4], [/^\+?44/, 54, -2],
      [/^\+?91/, 22, 79], [/^\+?234/, 9, 8], [/^\+?233/, 8, -1], [/^\+?225/, 7.5, -5.5],
    ];
    for (const [re, la, lo] of t) if (re.test(n)) return { lat: la + (Math.random() - 0.5) * 6, lon: lo + (Math.random() - 0.5) * 6 };
    return { lat: (Math.random() - 0.5) * 100, lon: (Math.random() - 0.5) * 340 };
  }
  const colorNivel = (nv) => nv === "alto" ? COL.rojo : nv === "medio" ? COL.ambar : COL.verde;

  // ---------- NODOS DEL CLÚSTER (adelante del globo) ----------
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
    return { id, grupo, esfera, anillo, lab, pos: pos.clone(), base: radio };
  }
  const P = {
    GW: new THREE.Vector3(0, 1.75, 3.4), JE: new THREE.Vector3(-1.95, 0.2, 3.4),
    JP: new THREE.Vector3(1.95, 0.2, 3.4), BD: new THREE.Vector3(-1.0, -1.5, 3.4),
    IA: new THREE.Vector3(1.0, -1.5, 3.4),
  };
  const N = {
    GW: crearNodo("GW", "Cloudflare", P.GW, 0.3),
    JE: crearNodo("JE", "JE · principal", P.JE, 0.3),
    JP: crearNodo("JP", "JP · respaldo", P.JP, 0.3),
    BD: crearNodo("BD", "Base de datos", P.BD, 0.22),
    IA: crearNodo("IA", "IA local", P.IA, 0.22),
  };
  // enlaces: gateway<->nodos, nodos<->BD/IA
  const defEnlaces = [["GW", "JE"], ["GW", "JP"], ["JE", "BD"], ["JP", "BD"], ["JE", "IA"], ["JP", "IA"]];
  const enlaces = defEnlaces.map(([a, b]) => {
    const geo = new THREE.BufferGeometry().setFromPoints([P[a], P[b]]);
    const mat = new THREE.LineBasicMaterial({ color: COL.linea, transparent: true, opacity: 0.6 });
    const ln = new THREE.Line(geo, mat); frente.add(ln);
    return { a, b, ln, mat };
  });
  // paquetes de datos que viajan por el enlace activo
  const paquetes = [];
  function paquete(a, b, color) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color }));
    frente.add(m); paquetes.push({ a: P[a], b: P[b], m, t: Math.random(), vel: 0.6 + Math.random() * 0.5 });
  }

  // ---------- ARCOS DE AMENAZA ----------
  const arcos = [];
  function lanzarArco(numero, nivel) {
    const o = ubicar(numero); const ini = enGlobo(o.lat, o.lon), fin = enGlobo(CASA.lat, CASA.lon);
    if (ini.distanceTo(fin) < 0.3) ini.add(new THREE.Vector3(0.6, 0.4, 0));   // mismo país: separa un poco
    const med = ini.clone().add(fin).multiplyScalar(0.5).normalize().multiplyScalar(R + 1.1 + Math.random() * 0.5);
    const curva = new THREE.QuadraticBezierCurve3(ini, med, fin);
    const color = colorNivel(nivel);
    const tubo = new THREE.Mesh(new THREE.TubeGeometry(curva, 40, 0.018, 6, false),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    const punta = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), new THREE.MeshBasicMaterial({ color }));
    globo.add(tubo, punta);
    arcos.push({ curva, tubo, punta, color, t: 0, vida: 1, fase: "viaja" });
    if (arcos.length > 14) { const v = arcos.shift(); globo.remove(v.tubo, v.punta); }
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
      const r = await fetch(API + "/gateway/estado"); const d = await r.json();
      const por = Object.fromEntries((d.nodos || []).map((n) => [n.nombre, n]));
      const activo = d.activo;
      pintarNodo(N.GW, "activo");                                  // el gateway siempre está (Cloudflare)
      ["JE", "JP"].forEach((k) => {
        const i = por[k];
        pintarNodo(N[k], !i || !i.online ? "caido" : k === activo ? "activo" : "espera");
      });
      const salud = activo && por[activo] && por[activo].health;
      pintarNodo(N.BD, salud && salud.db ? "activo" : "caido");
      pintarNodo(N.IA, salud && salud.ollama ? "activo" : "off");
      // resaltar el enlace que atiende
      enlaces.forEach((e) => {
        const act = (e.a === "GW" && e.b === activo) || (e.a === activo && (e.b === "BD" || e.b === "IA"));
        e.mat.color.setHex(act ? COL.cobalto : COL.linea);
        e.mat.opacity = act ? 1 : 0.4;
      });
      // paquetes nuevos por el camino activo
      paquetes.forEach((p) => frente.remove(p.m)); paquetes.length = 0;
      if (activo) { paquete("GW", activo, COL.cobalto); paquete(activo, "BD", COL.acento); if (salud && salud.ollama) paquete(activo, "IA", COL.acento); }
      // failover: destello cuando cambia quién atiende
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
      const r = await fetch(API + "/api/recientes?limite=8"); const d = await r.json();
      (d || []).slice().reverse().forEach((x) => {
        const clave = x.numero + "|" + x.creado;
        if (vistos.has(clave)) return;
        vistos.add(clave);
        if (!primera) lanzarArco(x.numero, x.nivel);               // al abrir no disparamos los viejos
      });
      if (vistos.size > 200) vistos.clear();
    } catch { /* opcional */ }
  }

  // ---------- control de cámara (órbita suave + arrastre) ----------
  let theta = 0.35, phi = 0.12, objT = 0.35, objP = 0.12, arrastrando = false, px = 0, py = 0;
  const foco = new THREE.Vector3(0, 0.1, 1.2);
  lienzo.addEventListener("pointerdown", (e) => { arrastrando = true; px = e.clientX; py = e.clientY; lienzo.setPointerCapture(e.pointerId); });
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
  const ro = new ResizeObserver(medir); ro.observe(lienzo); medir();

  const reloj = new THREE.Clock();
  function animar() {
    const dt = Math.min(0.05, reloj.getDelta());
    if (!reduce) { theta += dt * 0.03; globo.rotation.y += dt * 0.05; }
    objT += dt * (reduce ? 0 : 0.0);
    const t = theta + (objT - theta) * 0; // theta ya integra el auto-giro
    const ang = theta, ph = phi + (objP - phi) * 0.08; phi = ph;
    const rad = 8.6;
    camara.position.set(Math.sin(objT) * rad, 1.1 + ph * 3, Math.cos(objT) * rad);
    camara.lookAt(foco);

    // nodos: leve flotación + mirar a cámara lo hacen los sprites de etiqueta
    frente.children.forEach((g, i) => { if (g.type === "Group" && !reduce) g.position.y += Math.sin(reloj.elapsedTime * 1.3 + i) * 0.0008; });
    Object.values(N).forEach((n) => { if (!reduce) n.anillo.rotation.z += dt * 0.6; });

    // paquetes
    paquetes.forEach((p) => {
      p.t += dt * p.vel; if (p.t > 1) p.t -= 1;
      p.m.position.lerpVectors(p.a, p.b, p.t);
    });

    // arcos de amenaza
    for (let i = arcos.length - 1; i >= 0; i--) {
      const a = arcos[i];
      if (a.fase === "viaja") {
        a.t += dt * 0.5;
        a.punta.position.copy(a.curva.getPointAt(Math.min(1, a.t)));
        if (a.t >= 1) { a.fase = "apaga"; globo.remove(a.punta); }
      } else {
        a.vida -= dt * 0.25; a.tubo.material.opacity = Math.max(0, a.vida * 0.85);
        if (a.vida <= 0) { globo.remove(a.tubo); arcos.splice(i, 1); }
      }
    }

    // destello de failover
    if (flash > 0) { flash = Math.max(0, flash - dt * 1.2); halo.material.opacity = 0.06 + flash * 0.35; halo.material.color.setHex(flash > 0.5 ? COL.rojo : COL.acento); }
    else { halo.material.color.setHex(COL.acento); }

    renderer.render(scene, camara);
  }
  renderer.setAnimationLoop(() => { if (!document.hidden) animar(); });

  // ---------- arranque de datos ----------
  estadoCluster(); amenazas(true);
  setInterval(estadoCluster, 5000);
  setInterval(() => amenazas(false), 6000);
  // un par de arcos de bienvenida para que la escena no nazca vacía
  if (!reduce) setTimeout(() => { lanzarArco("+1 809 555 0101", "alto"); lanzarArco("+57 300 000 0000", "medio"); }, 1200);
}
