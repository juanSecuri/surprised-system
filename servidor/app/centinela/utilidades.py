"""CENTINELA · utilidades puras (sin base de datos ni red).

Funciones de dominio: normalización E.164, país, score de riesgo,
formato/enmascarado para Telegram y web, métricas del equipo e IP del cliente.
"""

import hashlib
import math
import re
import subprocess

import psutil
from fastapi import HTTPException, Request

from .config import PAISES, PREFIJOS_RIESGO, CAT_TXT, EMOJI, SAL


def normalizar(raw: str) -> str:
    """Convierte cualquier forma de escribir un número a E.164 (+57...)."""
    s = (raw or "").strip()
    internacional = s.startswith("+") or s.startswith("00")
    d = re.sub(r"\D", "", s)
    if s.startswith("00"):
        d = d[2:]
    if len(d) < 3 or len(d) > 15:
        raise HTTPException(422, "Número inválido")
    if not internacional:
        if len(d) == 10 and (d.startswith("3") or d.startswith("60")):
            d = "57" + d  # celular o fijo colombiano
        elif len(d) <= 8:
            return d  # código corto (SMS, líneas especiales)
    return "+" + d


def pais_de(numero: str) -> str:
    if not numero.startswith("+"):
        return "Código corto"
    for p in sorted(PAISES, key=len, reverse=True):
        if numero.startswith(p):
            return PAISES[p]
    return "Desconocido"


def prefijo_riesgo(numero: str) -> bool:
    return any(numero.startswith(p) for p in PREFIJOS_RIESGO)


def calcular_score(unicos: int, dias_desde_ultimo: float, numero: str, verificado: bool) -> int:
    if verificado:
        return 0
    s = 100 * (1 - math.exp(-0.35 * unicos))  # 1→30, 2→50, 3→65, 5→83
    if dias_desde_ultimo > 90:
        s *= 0.6
    elif dias_desde_ultimo > 30:
        s *= 0.85
    if prefijo_riesgo(numero):
        s += 25
    elif numero.startswith("+") and not numero.startswith("+57"):
        s += 10
    return int(min(100, round(s)))


def nivel_de(score: int) -> str:
    return "alto" if score >= 60 else "medio" if score >= 25 else "bajo"


def ip_cliente(req: Request) -> str:
    for h in ("x-real-ip", "cf-connecting-ip", "x-forwarded-for"):
        v = req.headers.get(h)
        if v:
            return v.split(",")[0].strip()
    return req.client.host if req.client else "?"


def hash_reportero(valor: str) -> str:
    return hashlib.sha256(f"{SAL}:{valor}".encode()).hexdigest()[:16]


def ip_tailscale() -> str:
    try:
        return subprocess.run(
            ["tailscale", "ip", "-4"], capture_output=True, text=True, timeout=3
        ).stdout.strip().splitlines()[0]
    except Exception:
        return ""


def metricas() -> dict:
    temp = None
    try:
        sensores = psutil.sensors_temperatures()
        for clave in ("k10temp", "coretemp", "acpitz", "cpu_thermal"):
            if sensores.get(clave):
                temp = sensores[clave][0].current
                break
    except Exception:
        pass
    return {
        "cpu": psutil.cpu_percent(interval=None),
        "ram": psutil.virtual_memory().percent,
        "disco": psutil.disk_usage("/").percent,
        "temp": temp,
    }


def formato(n: str) -> str:
    m = re.match(r"^\+57(\d{3})(\d{3})(\d{4})$", n or "")
    return f"+57 {m[1]} {m[2]} {m[3]}" if m else (n or "")


def enmascarar(n: str) -> str:
    """Para la web pública: +57 300 ••• 4567 (protege a contactos legítimos)."""
    n = n or ""
    for pref in ("+57", "+1"):
        if n.startswith(pref) and len(n) >= len(pref) + 7:
            resto = n[len(pref):]
            return f"{pref} {resto[:3]} ••• {resto[-4:]}"
    return f"{n[:4]} ••• {n[-4:]}" if len(n) > 8 else "Número oculto"


def texto_ficha(f: dict) -> str:
    nivel = f.get("nivel", "bajo")
    lineas = [
        f"{EMOJI.get(nivel, '⚪')} {formato(f['numero'])} · {f.get('pais', '')}",
        f"Riesgo {nivel} ({f.get('score', 0)}/100)",
    ]
    if f.get("total_reportes"):
        cat = f.get("categoria_principal")
        lineas.append(
            f"{f['total_reportes']} reporte(s)"
            + (f", casi siempre: {CAT_TXT.get(cat, cat)}" if cat else "")
        )
        if f.get("resumen_ia"):
            lineas.append(f"IA: {f['resumen_ia']}")
    else:
        lineas.append("Nadie lo ha reportado todavía.")
    lineas.append(
        {"alto": "👉 Mejor no contestes y bloquéalo.",
         "medio": "👉 Contesta con cuidado y no des datos."}.get(
            nivel, "👉 Parece tranquilo."
        )
    )
    return "\n".join(lineas)
