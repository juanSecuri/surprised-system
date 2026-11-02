# 07 · Detectar llamadas reales (la idea de la mamá de Juan 📞)

**Objetivo:** cuando entra una llamada de verdad a un celular, en menos de 4 segundos:
1. El celular muestra una notificación: **"🔴 NO CONTESTES · riesgo alto (75/100) · falso banco o entidad"**.
2. Llega una alerta a Telegram con la ficha del número.
3. La web muestra la llamada **en vivo** en el teléfono de la portada ("● En vivo · celular del proyecto").

```
 📱 Celular ──(número entrante)──► Cloudflare ──► JE/JP /api/llamada ──► Supabase
      ▲                                              │
      └──── notificación con el veredicto ◄──────────┤──► Telegram (alerta)
                                                     └──► Web (en vivo)
```

## Android vs iPhone (importante)
- **Android:** el sistema deja que una app lea el número que está entrando. Con **MacroDroid** (gratis) se hace sin programar. ✅ Automático.
- **iPhone:** Apple **no permite** que ninguna app ni Atajo lea el número de una llamada entrante (solo apps nativas con CallKit, fuera del alcance). En iPhone se hace **semi‑automático** con un Atajo después de la llamada.

**Recomendación para la demo:** usar un Android con SIM (el de un familiar o uno viejo) como **"celular sensor"**: tiene que recibir llamadas normales, no de WhatsApp. Las alertas llegan al Telegram de Juan en su iPhone.

---

## Opción A · Android con MacroDroid (automático)
Necesitas la **clave del celular** (`LLAMADAS_TOKEN`) que generó `configurar_telegram.sh` en JE.

1. Instala **MacroDroid** desde Play Store. Acepta los permisos de **Teléfono** y **Notificaciones** cuando los pida.
2. **Agregar macro** → nombre `Centinela`.
3. **Disparador (Trigger)** → *Llamadas* → **Llamada entrante** → elige **Cualquier número**
   (o *No está en contactos* para no enviar los números de familiares).
4. **Acción 1** → *Conectividad* → **Solicitud HTTP**:
   - Método: **POST**
   - URL:
     `https://centinela.juan-gallego-sec.workers.dev/api/llamada?token=TU_CLAVE&formato=texto`
   - Cuerpo / Content body: tipo `application/json` y texto:
     `{"numero":"{call_number}","dispositivo":"samsung-a50"}`
     (insértalo con el botón **"…"** → *Número de llamada*; las versiones nuevas de MacroDroid usan llaves `{ }`, las viejas corchetes `[ ]`.)
   - Guardar respuesta en variable: crea variable de texto **`veredicto`**.
   - Tiempo de espera: 10 s.
5. **Acción 2** → *Notificación* → **Mostrar notificación**:
   - Título: `Centinela`
   - Texto: `{lv=veredicto}` (variable local *veredicto*, insertada con el botón "…").
6. Guarda la macro (✔) y deja MacroDroid con permiso de **ejecutarse en segundo plano** / sin optimización de batería.

**Importante (Samsung A50, probado):** después de dar los permisos hay que **reiniciar el celular**; sin reinicio el disparador *Llamada entrante* no se activa. Para probar sin llamada: en la macro, menú ⋮ → *Probar acciones* (debe llegar "número oculto").

**Probar:** desde otro celular llama al Android. Antes del segundo timbre debe salir la notificación, llegar la alerta a Telegram y aparecer en la web.

## Opción B · iPhone con Atajos (semi‑automático)
Úsalo para verificar rápido una llamada perdida o recién recibida.

1. App **Atajos** → **+** → nombre `¿Quién me llamó?`.
2. Acciones, en orden:
   1. **Obtener portapapeles**
   2. **Obtener contenido de URL**
      - URL: `https://centinela.juan-gallego-sec.workers.dev/api/llamada?token=TU_CLAVE&formato=texto`
      - Método: **POST** · Cuerpo de la solicitud: **JSON**
      - Campo `numero` (Texto) = *Portapapeles* · Campo `dispositivo` (Texto) = `iphone-juan`
   3. **Mostrar notificación** → *Contenido de URL*
3. Atajo rápido: **Ajustes → Accesibilidad → Tocar → Tocar atrás → Doble toque → `¿Quién me llamó?`**.

**Uso:** en *Teléfono → Recientes* toca la ⓘ del número, mantén presionado el número → **Copiar**, y da **doble toque en la parte de atrás** del iPhone. Sale la notificación con el veredicto (y también aparece en la web y en Telegram).

---

## Privacidad (para el informe)
- El celular solo envía el número y un nombre de dispositivo, protegido con una clave (`LLAMADAS_TOKEN`); sin clave la API responde 401.
- En la web pública, los números **sin reportes** se muestran enmascarados (`+57 311 ••• 3344`) para no exponer a contactos legítimos. Solo los números ya reportados como spam se ven completos.
- La alerta con el número completo llega únicamente al Telegram del dueño (`TELEGRAM_CHAT_ID`).
