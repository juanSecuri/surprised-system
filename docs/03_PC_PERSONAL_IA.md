# 03 · PC personal de Juan — Nodo de IA (`centinela-ia`, Omarchy / Arch)

Este PC **no es servidor 24/7**: aporta la potencia para la IA (Ollama) y corre n8n para el bot de Telegram. Si está apagado, el sistema sigue funcionando (chat por reglas).

## Paso 1 · Ollama + Tailscale
```bash
cd ~/surprised-system
bash ia/instalar_ollama.sh
```
- Si pide login de Tailscale, usa **la misma cuenta** que en JE.
- Descarga `qwen2.5:7b` (~4.7 GB): muy buen español y razona bien para clasificar. Con ~16‑21 GB de RAM y un Ryzen 7000 responde en pocos segundos.
- Si quieres más velocidad: `ollama pull qwen2.5:3b` y en JE/JP pon `OLLAMA_MODEL=qwen2.5:3b` en `/opt/centinela/.env`.

Probar:
```bash
ollama run qwen2.5:7b "Clasifica: me llamaron diciendo que eran de Bancolombia y pidieron mi clave"
```
Y desde JE (`ssh ...@centinela-je`):
```bash
curl -s http://centinela-ia:11434/api/tags
```

**Seguridad:** Ollama escucha en todas las interfaces para que JE/JP lo alcancen, pero el script solo abre el puerto 11434 hacia Tailscale (y hacia Docker para n8n) si `ufw` está activo. En Omarchy revisa con `sudo ufw status`.

## Paso 2 · n8n (fase 3, cuando vayamos con el bot)
```bash
bash ia/instalar_n8n.sh
```
- Editor privado: <http://localhost:5678> (crear cuenta de dueño la primera vez).
- Solo las rutas `/webhook/...` quedan públicas vía Funnel, que es lo que Telegram necesita.
- Desde n8n, Ollama está en `http://host.docker.internal:11434` y la API en el link del Gateway.

## Paso 3 · Bot de Telegram (fase 3)
1. En Telegram → **@BotFather** → `/newbot` → nombre `Centinela Anti‑Spam` → usuario `centinela_antispam_bot` (o similar).
2. Guardar el token. **Nunca subirlo a GitHub.**
3. El flujo de n8n lo construimos juntos en la siguiente sesión (comandos en `00_PLAN_MAESTRO.md` §4, fase 3).
