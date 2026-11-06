"""CENTINELA · capa de IA local (Ollama)."""
import json, os, time
import httpx
from .config import OLLAMA_URL, OLLAMA_MODEL, CATEGORIAS, log
from .db import pool, recalcular

_ollama_estado = {"ok": False, "t": 0.0}

def ollama_disponible(forzar=False) -> bool:
    if not forzar and time.time() - _ollama_estado["t"] < 60:
        return _ollama_estado["ok"]
    try: ok = httpx.get(f"{OLLAMA_URL}/api/tags", timeout=2).status_code == 200
    except Exception: ok = False
    _ollama_estado.update(ok=ok, t=time.time())
    return ok

def ollama_chat(system: str, usuario: str, json_mode=False, timeout=90, temperatura=0.2, num_predict=220) -> str:
    opciones = {"temperature": temperatura, "num_predict": num_predict, "num_ctx": int(os.getenv("OLLAMA_NUM_CTX", "1024"))}
    cuerpo = {"model": OLLAMA_MODEL, "stream": False, "options": opciones, "keep_alive": os.getenv("OLLAMA_KEEP_ALIVE", "10m"), "messages": [{"role": "system", "content": system}, {"role": "user", "content": usuario}]}
    if json_mode: cuerpo["format"] = "json"
    r = httpx.post(f"{OLLAMA_URL}/api/chat", json=cuerpo, timeout=timeout)
    r.raise_for_status()
    return r.json()["message"]["content"].strip()

def clasificar_con_ia(reporte_id: int, numero: str, descripcion: str):
    if not descripcion or not ollama_disponible(): return
    try:
        system = ("Eres un analista antifraude telefónico en Colombia. Clasifica el reporte en UNA categoría:\n"
                  "- suplantacion: dicen ser de un banco, entidad, empresa o autoridad para pedir claves, códigos o datos\n"
                  "- estafa: premios falsos, inversiones, falsos familiares en apuros, ventas engañosas para robar dinero\n"
                  "- extorsion: amenazas, intimidación, exigen dinero bajo presión\n"
                  "- cobranza: cobran deudas o cuotas\n"
                  "- telemarketing: ofrecen productos, planes, créditos o servicios\n"
                  "- encuesta: encuestas o estudios de opinión\n"
                  "- wangiri: timbran una vez desde el extranjero para que devuelvas la llamada\n"
                  "- otro: nada de lo anterior\n"
                  'Responde SOLO JSON: {"categoria": "...", "resumen": "frase corta en español, sin punto final"}')
        res = json.loads(ollama_chat(system, f"Número: {numero}\nReporte: {descripcion}", json_mode=True, temperatura=0, num_predict=140, timeout=45))
        cat = res.get("categoria", "otro").lower().strip()
        cat = cat if cat in CATEGORIAS else "otro"
        with pool.connection(timeout=4) as conn:
            conn.execute("update reportes set categoria=%s, clasificado_por='ia' where id=%s and categoria is null", (cat, reporte_id))
            conn.execute("update numeros set resumen_ia=%s where numero=%s", (res.get("resumen", "")[:280], numero))
            recalcular(conn, numero)
    except Exception as e: log.warning("Clasificación IA falló: %s", e)
