# 10 · Autenticación del panel (lo que pide el profesor)

**Dónde se ve:** `https://centinela.juan-gallego-sec.workers.dev/admin`
**Login:** `https://centinela.juan-gallego-sec.workers.dev/admin/login`
**Alias amigable:** `https://centinela.juan-gallego-sec.workers.dev/login` → redirige al login (reservado para la sustentación).

## Qué demuestra (para el informe)

1. **Sin admin configurado, no se expone nada.** `/admin` responde *"Panel no configurado"* y no revela usuarios ni datos.
2. **Con admin configurado, el profesor ve:**
   - Usuario + contraseña **cifradas en el servidor** con **PBKDF2-HMAC-SHA256** (200 000 iteraciones, sal aleatoria 16 B).
   - **Sesión firmada HMAC-SHA256**, expira en 30 min, cookie `HttpOnly · SameSite=Strict · Secure`.
   - **Bloqueo por fuerza bruta:** 5 intentos fallidos por IP → bloqueo 15 min + evento en la bitácora.
   - **TOTP opcional** compatible con Aegis / Google Authenticator (6 dígitos, ventana 30 s, ±1 paso).
   - Panel con top 100 números por riesgo, contadores y margen de error (si Supabase cae, muestra *"Sin conexión a la base"* en vez de filtrar).
3. **El público (web/Telegram/Android) no necesita login.** Solo reporta y consulta sin registrarse; los números sin reportes se enmascaran (`+57 314 ••• 0841`). Solo números ya reportados como riesgo ≥25 son públicos. Esa es la decisión de privacidad documentada en `07_LLAMADAS_REALES.md`.

## Activarlo en JE (y luego en JP con los mismos datos)

En **JE**, conectado físicamente o por su red local:

```bash
cd ~/surprised-system && sudo bash servidor/configurar_admin.sh
```

El script pregunta:
1. Usuario del panel (por defecto `admin`)
2. Contraseña ≥8 caracteres (dos veces)
3. ¿Activar doble factor con Aegis? (recomendado: S)

Debe mostrar: *"✔ Panel configurado. Entra por el link del gateway, ruta /admin"* y `curl -s localhost:8000/health` con `"ok":true`.

**Repetir en JP** con **los mismos** usuario, contraseña, `SECRET_KEY` y TOTP, para que la sesión sirva en los dos nodos:
```bash
cd ~/surprised-system && sudo bash servidor/configurar_admin.sh
```

## Probarlo (sin exponer credenciales)

1. Abre `/admin` en privado → debe pedir login.
2. Fallla 5 veces a propósito con clave errónea → al 6º intento debe decir *"Demasiados intentos. Espera 15 minutos."* (prueba de blindaje).
3. Entra con la clave correcta → verás el panel con la tabla y el nodo atendido (`X-Centinela-Nodo: JE`).
4. `/admin/salir` cierra la sesión.

**Para la sustentación:** deja un usuario de demostración ya creado (ej. `profesor`) conclave fuerte guardada en papel, **nunca en el repositorio**. El resto del público no lo necesita: todo lo demás (consultar, reportar, chat, bot) es abierto pero con rate limiting por IP.

## Dónde vive el código (arquitectura limpia)

```
servidor/app/main.py               → solo compose FastAPI + lifespan (78 líneas)
servidor/app/centinela/config.py    → entorno y constantes
servidor/app/centinela/utilidades.py→ dominio puro
servidor/app/centinela/db.py        → Supabase + SQLite degradado
servidor/app/centinela/ia.py        → Ollama local
servidor/app/centinela/servicios.py → reportes, Telegram, rate limiting, tareas
servidor/app/centinela/auth.py      → este panel (PBKDF2, HMAC, TOTP, bloqueo)
servidor/app/centinela/rutas.py     → contrato HTTP
```

Enviar al profesor el árbol + esta guía. No enviar `.env` ni tokens.
