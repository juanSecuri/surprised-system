# 06 · Bot de Telegram con n8n

**Cómo funciona:** Telegram → n8n (PC personal, webhook por Tailscale Funnel) → Gateway Cloudflare → JE/JP (`/api/bot`) → respuesta → n8n → Telegram.
La lógica del bot vive en la API (probada y con failover); n8n orquesta y además corre dos automatizaciones: **resumen diario** y **alerta de failover**.
Las **alertas de llamadas reales** las envían JE/JP directo a Telegram, así funcionan aunque el PC personal esté apagado.

Tiempo: 30‑40 min. Orden: 1 → 8.

---

## 1 · Crear el bot (celular, 5 min)
1. En Telegram busca **@BotFather** → `/newbot`.
2. Nombre visible: `Centinela Anti-Spam`.
3. Usuario (único, termina en `bot`): por ejemplo `centinela_antispam_bot`.
4. Copia el **token** (`123456789:AAH...`). **No lo pegues en el chat de Claude ni en GitHub.**
5. Menú de comandos: `/setcommands` → elige tu bot → pega:
```
start - Menú principal
reportar - Reportar un número: /reportar 3001234567 qué te dijeron
top - Números más reportados
stats - Cifras de la comunidad
estado - Qué servidor te está atendiendo
miid - Tu chat_id para recibir alertas
```
6. (Opcional) `/setdescription` → *"Consulta si un número es spam o estafa antes de contestar. Proyecto de Sistemas Distribuidos."* y `/setuserpic` con el escudo.

## 2 · Base de datos (Supabase, 1 min)
SQL Editor → New query → pega `db/002_llamadas.sql` → **Run** → *Success*.

## 3 · Actualizar JE a la API 1.3 (PC personal)
```bash
cd ~/surprised-system && git pull
ssh juanesg@centinela-je
cd ~/surprised-system && sudo bash servidor/actualizar.sh      # debe decir "version":"1.3.0"
```

## 4 · Conectar JE con Telegram (sigues dentro de JE)
```bash
sudo bash servidor/configurar_telegram.sh
```
- Token: pégalo (no se ve mientras escribes, es normal).
- chat_id: **déjalo vacío por ahora** (lo sacamos en el paso 7).
- Clave del celular: **vacío** → se genera una. **Cópiala** (`LLAMADAS_TOKEN = ...`), la usan JP y el celular.
```bash
exit
```

## 5 · Instalar n8n (PC personal)
```bash
cd ~/surprised-system && bash ia/instalar_n8n.sh
```
Abre <http://localhost:5678> → crea la cuenta de dueño (correo + contraseña) → *Skip* en la encuesta.

## 6 · Cargar el flujo del bot en n8n
1. **Credencial:** menú izquierdo → *Credentials* → **Add credential** → *Telegram API* → pega el token → nombre `Telegram Centinela` → **Save**.
2. **Importar:** *Workflows* → **Create workflow** → menú `⋯` (arriba a la derecha) → **Import from file…** → `~/surprised-system/ia/n8n/centinela_bot.json`.
3. Abre los nodos **Telegram Trigger**, **Escribiendo…** y **Responder** → en *Credential* elige `Telegram Centinela`.
4. **Save** → interruptor **Inactive → Active** (arriba). Si pregunta, confirma.

> Si al activar sale *"Bad webhook"*: en la terminal `sudo tailscale funnel status` debe listar `/webhook`. Si no, vuelve a correr `bash ia/instalar_n8n.sh`.

## 7 · Probar y sacar tu chat_id
En Telegram abre tu bot y envía:
- `/start` → menú
- `3001234567` → ficha de riesgo 🔴/🟠/🟢
- `/reportar 3157778899 dijeron ser de Nequi y pidieron el código`
- `/estado` → *Te atendió: JE*
- `¿cómo sé si una llamada es estafa?` → responde la IA
- `/miid` → **copia el número**

Guarda el chat_id en JE (solo esa pregunta, lo demás vacío):
```bash
ssh juanesg@centinela-je
cd ~/surprised-system && sudo bash servidor/configurar_telegram.sh
exit
```

## 8 · Avisos automáticos (resumen 7:00 a. m. + alerta de failover)
1. Importa `ia/n8n/centinela_avisos.json` igual que en el paso 6.
2. En los nodos **Enviar resumen** y **Enviar alerta**: credencial `Telegram Centinela` y en *Chat ID* reemplaza `TU_CHAT_ID` por tu número del paso 7 (puede ser también el id de un grupo del curso).
3. **Save** → **Active**.

Para probar el resumen sin esperar a mañana: abre el nodo **Enviar resumen** y pulsa **Execute step** (ejecuta también los nodos anteriores de esa rama).
La alerta de failover se prueba en la sustentación: al apagar JE llega *"⚠️ JE dejó de responder. JP tomó el control…"*.

---

### Comandos del bot
| Envías | Responde |
|---|---|
| `3001234567` o un contacto compartido | Ficha de riesgo con consejo |
| `/reportar 300... texto` | Guarda el reporte; la IA lo clasifica |
| `/top` · `/stats` | Ranking y cifras |
| `/estado` | Qué nodo atendió, CPU/RAM de JE y JP, IA activa |
| `/miid` | Tu chat_id |
| Cualquier pregunta | IA local (Ollama) |

### Si algo falla
| Síntoma | Revisa |
|---|---|
| El bot no responde | n8n → *Executions*: ¿llegó el mensaje? Si no, webhook/Funnel (paso 6) |
| Responde "servidores no respondieron" | `curl https://centinela.juan-gallego-sec.workers.dev/health` |
| No llegan alertas de llamadas | `TELEGRAM_CHAT_ID` en JE (paso 7) y haberle escrito antes al bot |
