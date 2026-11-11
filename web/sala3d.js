/* CENTINELA · Sala de control 3D (Three.js vendorizado para respetar el CSP estricto)
   Globo de amenazas con la Tierra real (./vendor/earth.jpg) + clúster vivo.
   - Arrastrar = girar el globo con inercia (también dentro del zoom de Colombia).
   - Clic en el punto verde de Colombia = zoom estable + pines de las 7 ciudades.
   - Las llamadas reales se pintan SOLO en el teléfono del hero (app.js).
   Si no hay WebGL, la sección se oculta sola. No hay recursos externos. */
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

  const COL = {
    cobalto: 0x7a93ff, acento: 0x8ea2ff, verde: 0x3cc488,
    ambar: 0xf0b13d, rojo: 0xff5c70, linea: 0x283252, tinta: 0xe7ebf4,
  };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  let zoomOn = false;

  const scene = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(48, 2, 0.1, 100);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const sol = new THREE.DirectionalLight(0xffffff, 1.35); sol.position.set(5, 3, 5); scene.add(sol);
  const relleno = new THREE.DirectionalLight(0x5a79c8, 0.3); relleno.position.set(-5, -2, -4); scene.add(relleno);

  // ---------- GLOBO TIERRA (textura real, vendorizada localmente por CSP) ----------
  const R = 2.4;
  const globo = new THREE.Group(); scene.add(globo);
  const tierraTex = new THREE.TextureLoader().load("./vendor/earth.jpg");
  tierraTex.colorSpace = THREE.SRGBColorSpace;
  tierraTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  // Superficie sólida: la textura equirectangular coincide con enGlobo().
  globo.add(new THREE.Mesh(new THREE.SphereGeometry(R, 64, 48),
    new THREE.MeshPhongMaterial({ map: tierraTex, emissive: 0x0a1428, emissiveIntensity: 0.22, shininess: 12, specular: 0x223355 })));
  // Graticula muy tenue (toque sala de control).
  globo.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.002, 48, 32),
    new THREE.MeshBasicMaterial({ color: COL.cobalto, wireframe: true, transparent: true, opacity: 0.06 })));
  // Atmósfera (glow).
  const halo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.16, 32, 24),
    new THREE.MeshBasicMaterial({ color: COL.acento, transparent: true, opacity: 0.1, side: THREE.BackSide }));
  globo.add(halo);
  // Estrellas (puntos fuera del globo).
  {
    const N2 = 900; const pos = new Float32Array(N2 * 3);
    for (let i = 0; i < N2; i++) {
      const r = 7 + Math.random() * 18, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = r * Math.cos(ph); pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xaac0ff, size: 0.04, transparent: true, opacity: 0.7 })));
  }

  function enGlobo(lat, lon, r = R) {
    const phi = (90 - lat) * Math.PI / 180, theta = (lon + 180) * Math.PI / 180;
    return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  }
  const CASA = { lat: 4.6, lon: -74 };
  const posCasa = enGlobo(CASA.lat, CASA.lon);
  const marcaCasa = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 12), new THREE.MeshBasicMaterial({ color: COL.verde }));
  marcaCasa.position.copy(posCasa); globo.add(marcaCasa);
  // Anillo que late: invita a hacer clic sin añadir texto extra.
  const anilloCasa = new THREE.Mesh(new THREE.RingGeometry(0.045, 0.062, 32),
    new THREE.MeshBasicMaterial({ color: COL.verde, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthTest: false }));
  anilloCasa.position.copy(posCasa);
  anilloCasa.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), posCasa.clone().normalize());
  anilloCasa.renderOrder = 2;
  globo.add(anilloCasa);
  // Zona de clic generosa (invisible, solo para el raycaster).
  const hitCasa = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hitCasa.position.copy(posCasa); hitCasa.visible = false; globo.add(hitCasa);

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
  const rangoNivel = (nv) => nv === "alto" ? 2 : nv === "medio" ? 1 : 0;

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
    g.shadowColor = "rgba(0,0,0,.85)"; g.shadowBlur = 8;
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

  // ---------- ARCOS DE AMENAZA + PULSOS ----------
  const arcos = [];
  const conteo = new Map();
  const nivelCiudad = new Map();
  const etiquetasCiudad = [];
  const pulsos = [];
  const EJE_Z = new THREE.Vector3(0, 0, 1);

  function pulso(pos, color) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.08, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthTest: false, blending: THREE.AdditiveBlending }));
    m.position.copy(pos);
    m.quaternion.setFromUnitVectors(EJE_Z, pos.clone().normalize());
    m.renderOrder = 2;
    globo.add(m); pulsos.push({ m, vida: 1 });
  }
  function limpiarEfectos() {
    arcos.forEach((a) => globo.remove(a.tubo, a.punta)); arcos.length = 0;
    pulsos.forEach((p) => globo.remove(p.m)); pulsos.length = 0;
    etiquetasCiudad.forEach((e) => globo.remove(e.spr)); etiquetasCiudad.length = 0;
  }
  function lanzarArco(numero, nivel) {
    const o = ubicar(numero);
    conteo.set(o.lugar, (conteo.get(o.lugar) || 0) + 1);
    const previo = nivelCiudad.has(o.lugar) ? rangoNivel(nivelCiudad.get(o.lugar)) : -1;
    if (rangoNivel(nivel) > previo) nivelCiudad.set(o.lugar, nivel);
    refrescarTop();
    if (zoomOn) return; // en el zoom mandan los pines; sin arcos que tapen el país

    const ini = enGlobo(o.lat, o.lon), fin = enGlobo(CASA.lat, CASA.lon);
    if (ini.distanceTo(fin) < 0.3) ini.add(new THREE.Vector3(0.5, 0.4, 0.2));
    const med = ini.clone().add(fin).multiplyScalar(0.5).normalize().multiplyScalar(R + 1.1 + Math.random() * 0.5);
    const curva = new THREE.QuadraticBezierCurve3(ini, med, fin);
    const color = colorNivel(nivel);
    const tubo = new THREE.Mesh(new THREE.TubeGeometry(curva, 44, 0.02, 6, false),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending }));
    const punta = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 10), new THREE.MeshBasicMaterial({ color }));
    globo.add(tubo, punta);

    const etq = etiqueta(o.lugar, nivel === "alto" ? 0xffb3c0 : nivel === "medio" ? 0xffd79a : 0xd6ffe6);
    etq.material.depthTest = true;
    etq.scale.set(0.95, 0.27, 1);
    etq.position.copy(enGlobo(o.lat, o.lon, R * 1.07));
    globo.add(etq); etiquetasCiudad.push({ spr: etq, vida: 1.8 });

    arcos.push({ curva, tubo, punta, color, t: 0, vida: 1, fase: "viaja" });
    ping(nivel);
    if (arcos.length > 14) { const v = arcos.shift(); globo.remove(v.tubo, v.punta); }
  }
  function refrescarTop() {
    const ul = document.getElementById("sala-top-lista"); if (!ul) return;
    const top = [...conteo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    ul.replaceChildren();
    top.forEach(([lugar, n]) => {
      const li = document.createElement("li");
      const nombre = document.createElement("span"); nombre.textContent = lugar;
      const num = document.createElement("b"); num.textContent = n;
      li.append(nombre, num); ul.appendChild(li);
    });
    actualizarPines();
  }

  // ---------- PINES DE LAS 7 CIUDADES (visibles solo en el zoom) ----------
  const pines = Object.entries(CIUDADES).map(([codigo, [nombre, lat, lon]]) => {
    const grupo = new THREE.Group();
    grupo.position.copy(enGlobo(lat, lon, R * 1.008));
    const punto = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 10),
      new THREE.MeshBasicMaterial({ color: COL.acento }));
    const brillo = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 10),
      new THREE.MeshBasicMaterial({ color: COL.acento, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }));
    grupo.add(punto, brillo);
    grupo.visible = false;
    globo.add(grupo);
    return { codigo, nombre, lat, lon, grupo, punto, brillo, etq: null, linea: null, ancho: 90, _proy: null };
  });
  function actualizarPines() {
    pines.forEach((p) => {
      const n = conteo.get(p.nombre) || 0;
      const nivel = nivelCiudad.get(p.nombre) || "bajo";
      const color = n ? colorNivel(nivel) : COL.acento;
      const escala = n ? 1 + Math.min(0.8, Math.log2(n + 1) * 0.25) : 1;
      p.punto.material.color.setHex(color);
      p.brillo.material.color.setHex(color);
      p.brillo.material.opacity = n ? 0.32 : 0.14;
      p.punto.scale.setScalar(escala);
      p.brillo.scale.setScalar(escala * (n ? 1.3 : 1));
      if (p.etq) {
        p.etq.textContent = n ? `${p.nombre} · ${n}` : p.nombre;
        p.etq.classList.toggle("con-reportes", n > 0);
        p.ancho = p.etq.offsetWidth || 90;
      }
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

  // ---------- AMENAZAS NUEVAS (reportes reales) ----------
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
  // Siembra el panel/etiquetas con el top real (una sola vez; no duplica el conteo vivo).
  async function cargarTop() {
    try {
      const d = await (await fetch(API + "/api/top?limite=40")).json();
      (d || []).forEach((x) => {
        const o = ubicar(x.numero);
        const n = Number(x.total_reportes) || 1;
        conteo.set(o.lugar, (conteo.get(o.lugar) || 0) + n);
        const previo = nivelCiudad.has(o.lugar) ? rangoNivel(nivelCiudad.get(o.lugar)) : -1;
        if (rangoNivel(x.nivel) > previo) nivelCiudad.set(o.lugar, x.nivel);
      });
      refrescarTop();
    } catch {}
  }

  // ---------- CÁMARA, ZOOM Y CONTROLES ----------
  const CAM_BASE = new THREE.Vector3(0, 0.6, 8.6);
  const LOOK_BASE = new THREE.Vector3(0, 0.1, 0);
  const camObjetivo = CAM_BASE.clone();
  const lookObjetivo = LOOK_BASE.clone();
  const lookActual = LOOK_BASE.clone();
  const _casaMundo = new THREE.Vector3();
  camara.position.copy(CAM_BASE); camara.lookAt(LOOK_BASE);
  globo.rotation.y = -0.279;  // Colombia / Sudamérica de frente
  globo.rotation.x = -0.12;

  let velY = 0, velX = 0, arrastrando = false, px = 0, py = 0;
  let abajoX = 0, abajoY = 0, movido = false;
  let capaPines = null, svgPines = null, btnVolver = null;

  const raycaster = new THREE.Raycaster();
  const raton = new THREE.Vector2();
  function apuntar(e) {
    const r = lienzo.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    raton.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    raton.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(raton, camara);
    return true;
  }
  function sobreCasa() {
    return raycaster.intersectObjects([hitCasa, marcaCasa, anilloCasa], false).length > 0;
  }

  function setZoom(on) {
    if (zoomOn === on) return;
    zoomOn = on;
    velY = velX = 0; arrastrando = false;
    if (on) {
      marcaCasa.getWorldPosition(_casaMundo);
      camObjetivo.copy(_casaMundo).normalize().multiplyScalar(R + 1.55);
      lookObjetivo.copy(_casaMundo);
      frente.visible = false;
      marcaCasa.visible = false;
      anilloCasa.visible = false;
      limpiarEfectos();
      actualizarPines();
    } else {
      camObjetivo.copy(CAM_BASE);
      lookObjetivo.copy(LOOK_BASE);
    }
    pines.forEach((p) => { p.grupo.visible = on; });
    if (capaPines) capaPines.classList.toggle("activa", on);
    if (btnVolver) btnVolver.hidden = !on;
    lienzo.style.cursor = "grab";
    lienzo.setAttribute("aria-label", on
      ? "Colombia ampliada. Arrastra para girar el globo. Ciudades con reportes. Pulsa Volver o Escape para salir."
      : "Visualización 3D del clúster y las amenazas en vivo. Clic en el punto verde para acercar Colombia.");
  }

  // Capa HTML para etiquetas de tamaño de pantalla constante + líneas-guía.
  const caja = document.querySelector(".sala-lienzo");
  if (caja) {
    capaPines = document.createElement("div");
    capaPines.className = "sala-pines";
    capaPines.setAttribute("aria-hidden", "true");
    svgPines = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgPines.setAttribute("width", "100%");
    svgPines.setAttribute("height", "100%");
    svgPines.setAttribute("focusable", "false");
    capaPines.appendChild(svgPines);
    pines.forEach((p) => {
      const linea = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      svgPines.appendChild(linea);
      const etq = document.createElement("span");
      etq.className = "sala-pin-etq";
      etq.textContent = p.nombre;
      capaPines.appendChild(etq);
      p.linea = linea; p.etq = etq;
    });
    caja.insertBefore(capaPines, lienzo.nextSibling);

    btnVolver = document.createElement("button");
    btnVolver.type = "button";
    btnVolver.className = "sala-volver";
    btnVolver.textContent = "← Volver";
    btnVolver.hidden = true;
    btnVolver.addEventListener("click", () => setZoom(false));
    caja.appendChild(btnVolver);
  }

  // Distribuye etiquetas en dos columnas y evita que se pisen.
  function repartir(lista, alto) {
    if (!lista.length) return;
    const GAP = 22, MIN = 14, MAX = alto - 14;
    lista.sort((a, b) => a.y - b.y);
    let previo = -Infinity;
    for (const o of lista) { o.ly = Math.max(o.y, previo + GAP); previo = o.ly; }
    const exceso = lista[lista.length - 1].ly - MAX;
    if (exceso > 0) for (const o of lista) o.ly -= exceso;
    if (lista[0].ly < MIN) { const d = MIN - lista[0].ly; for (const o of lista) o.ly += d; }
  }
  const _v = new THREE.Vector3();
  function actualizarEtiquetas() {
    if (!zoomOn || !capaPines || !lienzo) return;
    const w = lienzo.clientWidth, h = lienzo.clientHeight;
    if (!w || !h) return;
    const pts = [];
    pines.forEach((p) => {
      p.grupo.getWorldPosition(_v);
      const visible = _v.dot(camara.position) > R * R; // hemisferio que mira a la cámara
      const proy = p._proy || (p._proy = new THREE.Vector3());
      proy.copy(_v).project(camara);
      if (!visible || proy.z > 1 || proy.z < -1) {
        if (p.etq) { p.etq.style.display = "none"; p.linea.style.display = "none"; }
        return;
      }
      if (p.etq) p.etq.style.display = "";
      if (p.linea) p.linea.style.display = "";
      pts.push({ p, x: (proy.x * 0.5 + 0.5) * w, y: (-proy.y * 0.5 + 0.5) * h });
    });
    if (!pts.length) return;

    const centro = w / 2;
    const izq = pts.filter((o) => o.x < centro);
    const der = pts.filter((o) => o.x >= centro);
    repartir(izq, h); repartir(der, h);
    const minX = Math.min(...pts.map((o) => o.x), centro - 18);
    const maxX = Math.max(...pts.map((o) => o.x), centro + 18);
    const lx = Math.max(10, minX - 16);
    const rx = Math.min(w - 10, maxX + 16);

    pts.forEach((o) => {
      const lado = o.x < centro ? -1 : 1;
      const ancho = o.p.ancho || 90;
      const anclaX = lado < 0 ? Math.max(ancho + 8, lx) : Math.min(w - ancho - 8, rx);
      o.p.etq.style.left = anclaX + "px";
      o.p.etq.style.top = o.ly + "px";
      o.p.etq.style.transform = lado < 0 ? "translate(-100%,-50%)" : "translate(0,-50%)";
      const codoX = o.x + lado * 10;
      o.p.linea.setAttribute("points", `${o.x.toFixed(1)},${o.y.toFixed(1)} ${codoX.toFixed(1)},${o.y.toFixed(1)} ${anclaX.toFixed(1)},${o.ly.toFixed(1)}`);
    });
  }

  // Eventos de puntero: arrastre con inercia + clic en el marcador de Colombia.
  lienzo.addEventListener("pointerdown", (e) => {
    armarAudio();
    arrastrando = true; movido = false;
    px = e.clientX; py = e.clientY; abajoX = e.clientX; abajoY = e.clientY;
    velY = 0; velX = 0;
    try { lienzo.setPointerCapture(e.pointerId); } catch {}
  });
  lienzo.addEventListener("pointerup", (e) => {
    arrastrando = false;
    try { lienzo.releasePointerCapture(e.pointerId); } catch {}
    if (movido || !apuntar(e)) return;
    if (!zoomOn && sobreCasa()) setZoom(true);
  });
  lienzo.addEventListener("pointermove", (e) => {
    if (arrastrando) {
      if (Math.abs(e.clientX - abajoX) + Math.abs(e.clientY - abajoY) > 7) movido = true;
      // En el zoom el globo está más cerca: bajamos la sensibilidad para girarlo con control.
      const sens = zoomOn ? 0.003 : 0.006;
      velY = (e.clientX - px) * sens; velX = (e.clientY - py) * sens;
      px = e.clientX; py = e.clientY;
      globo.rotation.y += velY;
      globo.rotation.x = Math.max(-1.0, Math.min(1.0, globo.rotation.x + velX));
    } else if (apuntar(e)) {
      lienzo.style.cursor = !zoomOn && sobreCasa() ? "pointer" : "grab";
    }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && zoomOn) setZoom(false); });

  function medir() {
    const w = lienzo.clientWidth, h = lienzo.clientHeight || Math.round(w * 0.62);
    renderer.setSize(w, h, false);
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
  }
  new ResizeObserver(medir).observe(lienzo); medir();

  // Botones: sonido + pantalla completa.
  const btnSon = document.getElementById("sala-sonido");
  if (btnSon) btnSon.addEventListener("click", () => {
    armarAudio(); sonidoOn = !sonidoOn;
    btnSon.textContent = sonidoOn ? "🔊" : "🔇";
    btnSon.setAttribute("aria-pressed", String(sonidoOn));
    if (sonidoOn) ping("medio");
  });
  const btnFull = document.getElementById("sala-full");
  if (btnFull && caja) btnFull.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else caja.requestFullscreen && caja.requestFullscreen();
  });
  document.addEventListener("fullscreenchange", () => setTimeout(medir, 60));

  // ---------- BUCLE ----------
  const reloj = new THREE.Clock();
  let t = 0;
  function animar() {
    const dt = Math.min(0.05, reloj.getDelta());
    t += dt;

    if (!arrastrando) {
      globo.rotation.y += velY;
      globo.rotation.x = Math.max(-1.0, Math.min(1.0, globo.rotation.x + velX));
      // En el zoom frenamos antes: el país se mantiene a la vista.
      const freno = zoomOn ? 0.86 : 0.95;
      velY *= freno; velX *= freno;
      // Deriva lenta solo en la vista general: en el zoom manda el usuario.
      if (!zoomOn && !reduce && Math.abs(velY) < 0.0004 && Math.abs(velX) < 0.0004) globo.rotation.y += 0.0006;
    }

    // En el zoom la cámara queda fija a distancia de Colombia y el globo gira debajo.
    const k = reduce ? 1 : 1 - Math.pow(0.0015, dt);
    camara.position.lerp(camObjetivo, k);
    lookActual.lerp(lookObjetivo, k);
    camara.lookAt(lookActual);
    if (!zoomOn && !frente.visible && camara.position.length() > 6.2) {
      frente.visible = true; marcaCasa.visible = true; anilloCasa.visible = true;
    }

    // Marcador de Colombia: late para invitar al clic.
    if (!reduce) {
      const s = 1 + Math.sin(t * 3.2) * 0.22;
      anilloCasa.scale.setScalar(s);
      anilloCasa.material.opacity = 0.42 + (s - 1) * 0.8;
    }

    Object.values(N).forEach((n) => { if (!reduce) n.anillo.rotation.z += dt * 0.6; });
    paquetes.forEach((p) => { p.t += dt * p.vel; if (p.t > 1) p.t -= 1; p.m.position.lerpVectors(p.a, p.b, p.t); });

    for (let i = arcos.length - 1; i >= 0; i--) {
      const a = arcos[i];
      if (a.fase === "viaja") {
        a.t += dt * 0.5; a.punta.position.copy(a.curva.getPointAt(Math.min(1, a.t)));
        if (a.t >= 1) { a.fase = "apaga"; globo.remove(a.punta); pulso(a.curva.getPointAt(1), a.color); }
      } else {
        a.vida -= dt * 0.25; a.tubo.material.opacity = Math.max(0, a.vida * 0.85);
        if (a.vida <= 0) { globo.remove(a.tubo); arcos.splice(i, 1); }
      }
    }
    for (let i = etiquetasCiudad.length - 1; i >= 0; i--) {
      const e = etiquetasCiudad[i]; e.vida -= dt * 0.35;
      e.spr.material.opacity = Math.max(0, Math.min(1, e.vida));
      // Contra-escalado por distancia: tamaño de pantalla constante.
      e.spr.getWorldPosition(_v);
      const escala = Math.max(0.25, camara.position.distanceTo(_v) / 8.6);
      e.spr.scale.set(0.95 * escala, 0.27 * escala, 1);
      if (e.vida <= 0) { globo.remove(e.spr); etiquetasCiudad.splice(i, 1); }
    }
    for (let i = pulsos.length - 1; i >= 0; i--) {
      const p = pulsos[i]; p.vida -= dt * 1.2; p.m.scale.multiplyScalar(1 + dt * 2.2);
      p.m.material.opacity = Math.max(0, p.vida * 0.6);
      if (p.vida <= 0) { globo.remove(p.m); pulsos.splice(i, 1); }
    }
    if (flash > 0) {
      flash = Math.max(0, flash - dt * 1.2);
      halo.material.opacity = 0.1 + flash * 0.35;
      halo.material.color.setHex(flash > 0.5 ? COL.rojo : COL.acento);
    } else halo.material.color.setHex(COL.acento);

    if (zoomOn) actualizarEtiquetas();
    renderer.render(scene, camara);
  }
  renderer.setAnimationLoop(() => { if (!document.hidden) animar(); });

  // ---------- ARRANQUE ----------
  // app.js ya consulta /api/llamadas para el hero; aquí solo clúster + amenazas + top.
  estadoCluster(); amenazas(true); cargarTop();
  setInterval(() => { if (!document.hidden) estadoCluster(); }, 10000);
  setInterval(() => { if (!document.hidden) amenazas(false); }, 12000);
  if (!reduce) setTimeout(() => { lanzarArco("+57 604 000 0000", "alto"); lanzarArco("+57 602 000 0000", "medio"); }, 1200);
}