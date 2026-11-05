# Centinela · App de llamadas (Android, desarrollo propio)

Detecta cada llamada entrante en el celular, le avisa al servidor Centinela
(`POST /api/llamada`) y muestra una notificación de alta prioridad diciendo si
el número es **SPAM / dudoso / sin reportes**. Reemplaza a MacroDroid con código propio.

## Compilar
1. Abre la carpeta `centinela-llamadas` en **Android Studio** (Giraffe o más nuevo).
   Al abrir, Android Studio crea el `gradlew` y baja Gradle 8.9 solo.
2. Conecta el celular (Samsung A50) con **depuración USB** activada.
3. Botón ▶ (Run). Se instala la app.
   - O por consola:  `./gradlew assembleDebug`  → el APK queda en
     `app/build/outputs/apk/debug/app-debug.apk`

## Usar
1. Abre la app, escribe el **gateway** y el **token de llamadas** (el mismo
   `LLAMADAS_TOKEN` del servidor), toca **Guardar**.
2. Toca **Dar permisos** y acepta: teléfono, registro de llamadas, notificaciones.
3. Toca **Probar envío**: debe aparecer el veredicto del número de prueba.
4. Listo: cuando entre una llamada real, verás la notificación de Centinela.

## Notas
- En Android 9+ el número entrante solo llega con el permiso **Registro de llamadas**
  (ya incluido). Si una marca lo bloquea, la llamada se registra como "oculta".
- Para que funcione con la pantalla bloqueada sin que el sistema la mate, deja la
  app sin optimización de batería (Ajustes → Batería → sin restricciones).
