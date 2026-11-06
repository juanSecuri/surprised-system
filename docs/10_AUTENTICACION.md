# 10 · Autenticación del panel (lo que pide el profesor)

**Dónde se ve:** `https://centinela.juan-gallego-sec.workers.dev/admin`
**Login:** `https://centinela.juan-gallego-sec.workers.dev/admin/login`
**Alias amigable:** `https://centinela.juan-gallego-sec.workers.dev/login` → login del panel

## Cómo funciona (defensa en profundidad)

El panel puede servirse simultáneamente en dos capas; la que esté configurada atiende:

1. **Borde (Cloudflare Worker)** — preferente para la demo. Si `ADMIN_USER` y `ADMIN_HASH` existen como *secrets* del Worker (`wrangler secret list`), el Worker sirve `/admin` y `/login` sin tocar JE. Los datos del panel (tabla top 100, stats) se cargan vía `/api/top` y `/api/stats` contra JE/JP, así que el failover sigue funcionando.
   - Cálculo en Workers: **PBKDF2-HMAC-SHA256 100k** (Workers no permiten >100k; JE usa 200k en su `.env`).
   - Sesión firmada **HMAC-SHA256**, 30 min, `HttpOnly · SameSite=Strict · Secure`.
   - Bloqueo: 5 fallos por IP → 15 min + limpia al éxito.
   - TOTP opcional compatible con Aegis.
2. **Nodo (JE/JP FastAPI)** — cuando corres `sudo bash servidor/configurar_admin.sh` en JE (y JP con los mismos datos). El gateway proxeaba a `/admin` del nodo; ahora, si el borde tiene credenciales, el borde atiende y el nodo queda como respaldo de datos.
   - `centinela/auth.py` implementa el mismo modelo: PBKDF2 (200k), HMAC, TOTP, bloqueo.

**Sin credenciales configuradas, no se expone nada:** el Worker proxeaba y JE respondía *"Panel no configurado"*. Ahora el login funciona en el borde sin necesidad de SSH a JE.

## Credenciales de demostración (profesor)

| Campo | Valor demo |
|---|---|
| Usuario | `profesor` |
| Contraseña | `profesor2024` (demo — cámbiala antes de la nota final) |

- Hash PBKDF2 100k generado y guardado **solo como secret del Worker** (`wrangler secret list` → `ADMIN_USER`, `ADMIN_HASH`, `SECRET_KEY`). No está en git.
- `SECRET_KEY` es aleatoria (64 hex), firmada en el borde.
- Para cambiar: `printf %s "$NUEVO_HASH" | npm exec -y wrangler@4.30.0 -- secret put ADMIN_HASH` o repite el flujo de abajo.

## Cambiar la clave (cuando quieras salir de la demo)

En esta PC (no en git):
```bash
python3 - <<'PY'
import hashlib, secrets
# cola aqui tu clave nueva
c = "<TU_CLAVE>".encode(); s = secrets.token_bytes(16)
print("pbkdf2$%s$%s" % (s.hex(), hashlib.pbkdf2_hmac("sha256", c, s, 100000).hex()))
PY
# copia la línea y:
printf %s 'pbkdf2$...$...' | npm exec -y wrangler@4.30.0 -- secret put ADMIN_HASH
```

Para el nodo JE (si quieres doble capa):
```bash
cd ~/surprised-system && sudo bash servidor/configurar_admin.sh
# repite en JP con los mismos datos
```

## Probar (sin exponer credenciales en el informe)

1. `/admin` en privado → pide login.
2. Falla 5 veces → al 6º intento: *"Demasiados intentos. Espera 15 minutos."*
3. Entra con `profesor`/`profesor2024` → panel con tabla top, stats y salida.
4. El público (web/Telegram/Android) no necesita login; números sin reportes se enmascaran.

## Arquitectura limpia (backend)

```
servidor/app/main.py               → 78 líneas, solo compone la app
servidor/app/centinela/config.py    → entorno/constantes
servidor/app/centinela/utilidades.py→ dominio
servidor/app/centinela/db.py        → Supabase + SQLite
servidor/app/centinela/ia.py        → Ollama
servidor/app/centinela/servicios.py → reportes/Telegram/rate limiting
servidor/app/centinela/auth.py      → este panel en el nodo (200k)
servidor/app/centinela/rutas.py     → contrato HTTP
gateway/worker.js                   → este panel en el borde (100k, sin SSH a JE)
```

No enviar `.env`, tokens ni `ADMIN_HASH` al profesor. Solo el árbol + esta guía.
