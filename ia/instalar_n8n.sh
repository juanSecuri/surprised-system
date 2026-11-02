#!/usr/bin/env bash
# =====================================================================
#  CENTINELA · n8n en el PC personal (Omarchy / Arch) para el bot de Telegram
#  - n8n corre en Docker, arranca solo con el PC.
#  - Telegram necesita un link HTTPS para avisarle a n8n de cada mensaje:
#    se publica SOLO la ruta /webhook con Tailscale Funnel (el editor de n8n
#    sigue siendo privado: http://localhost:5678).
#
#  Uso:  bash ia/instalar_n8n.sh
# =====================================================================
set -euo pipefail
verde(){ echo -e "\e[1;32m$*\e[0m"; }
azul(){ echo -e "\n\e[1;34m▶ $*\e[0m"; }

azul "1/4 Docker"
if ! command -v docker >/dev/null; then
  if command -v pacman >/dev/null; then sudo pacman -S --needed --noconfirm docker
  else sudo apt-get update && sudo apt-get install -y docker.io; fi
fi
sudo systemctl enable --now docker
command -v jq >/dev/null || { command -v pacman >/dev/null && sudo pacman -S --needed --noconfirm jq || sudo apt-get install -y jq; }

DNS="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
[[ -n "$DNS" && "$DNS" != "null" ]] || { echo "Primero corre ia/instalar_ollama.sh (instala Tailscale)"; exit 1; }
URL_PUBLICA="https://$DNS/"

azul "2/4 Contenedor n8n"
# Si ya tienes otro n8n u otro programa en el 5678, usamos el siguiente puerto libre
sudo docker rm -f centinela-n8n >/dev/null 2>&1 || true
PUERTO="${N8N_PUERTO:-5678}"
while ss -ltn | awk '{print $4}' | grep -qE "[:.]$PUERTO\$"; do
  echo "   El puerto $PUERTO está ocupado por otro programa; pruebo el $((PUERTO+1))"
  PUERTO=$((PUERTO+1))
done
echo "   n8n de Centinela usará el puerto $PUERTO"
sudo docker run -d --name centinela-n8n --restart unless-stopped \
  -p 127.0.0.1:$PUERTO:5678 \
  --add-host=host.docker.internal:host-gateway \
  -e TZ=America/Bogota -e GENERIC_TIMEZONE=America/Bogota \
  -e N8N_SECURE_COOKIE=false \
  -e WEBHOOK_URL="$URL_PUBLICA" \
  -e N8N_PROXY_HOPS=1 \
  -e N8N_DISABLED_MODULES=instance-ai \
  -v centinela_n8n_data:/home/node/.n8n \
  docker.n8n.io/n8nio/n8n

azul "3/4 Publicando solo los webhooks con Tailscale Funnel"
sudo tailscale funnel --bg --set-path /webhook http://127.0.0.1:$PUERTO/webhook
sudo tailscale funnel --bg --set-path /webhook-test http://127.0.0.1:$PUERTO/webhook-test

azul "4/4 Esperando a que n8n arranque (1-3 min la primera vez)"
for i in $(seq 1 90); do curl -sf localhost:$PUERTO/healthz >/dev/null && break; sleep 2; done

verde "\n============================================================"
verde "  n8n LISTO"
verde "  Editor (privado):     http://localhost:$PUERTO"
verde "  Webhooks (públicos):  ${URL_PUBLICA}webhook/..."
verde "  Ollama desde n8n:     http://host.docker.internal:11434"
verde "  API Centinela:        https://centinela.<tu-cuenta>.workers.dev"
verde "============================================================"
sudo tailscale funnel status
