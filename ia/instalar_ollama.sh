#!/usr/bin/env bash
# =====================================================================
#  CENTINELA · Nodo de IA en el PC personal de Juan (Omarchy / Arch Linux)
#  Instala Tailscale + Ollama, deja Ollama visible SOLO para la red Tailscale
#  y descarga el modelo.
#
#  Uso:   bash ia/instalar_ollama.sh            (pide sudo cuando lo necesita)
#         bash ia/instalar_ollama.sh llama3.1:8b (otro modelo)
# =====================================================================
set -euo pipefail
MODELO="${1:-qwen2.5:7b}"
verde(){ echo -e "\e[1;32m$*\e[0m"; }
azul(){ echo -e "\n\e[1;34m▶ $*\e[0m"; }

azul "1/5 Tailscale"
if ! command -v tailscale >/dev/null; then
  if command -v pacman >/dev/null; then sudo pacman -S --needed --noconfirm tailscale
  else curl -fsSL https://tailscale.com/install.sh | sh; fi
fi
sudo systemctl enable --now tailscaled
sudo tailscale status >/dev/null 2>&1 || sudo tailscale up --hostname=centinela-ia
sudo tailscale set --hostname=centinela-ia || true
verde "   IP Tailscale: $(tailscale ip -4 | head -1)"

azul "2/5 Ollama"
if ! command -v ollama >/dev/null; then
  if command -v pacman >/dev/null; then
    # ollama = CPU. Si tu Ryzen tiene gráfica Radeon compatible puedes probar: ollama-rocm
    sudo pacman -S --needed --noconfirm ollama
  else
    curl -fsSL https://ollama.com/install.sh | sh
  fi
fi

azul "3/5 Configurando Ollama para escuchar en la red (servidores JE/JP lo usarán)"
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/centinela.conf >/dev/null <<'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_KEEP_ALIVE=30m"
Environment="OLLAMA_NUM_PARALLEL=2"
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now ollama
sudo systemctl restart ollama
for i in $(seq 1 30); do curl -sf localhost:11434/api/tags >/dev/null && break; sleep 1; done

azul "4/5 Firewall: el puerto 11434 solo se abre hacia Tailscale"
if command -v ufw >/dev/null && sudo ufw status | grep -q "Status: active"; then
  # Política por defecto de ufw = negar entradas; solo abrimos lo necesario
  sudo ufw allow in on tailscale0 to any port 11434 proto tcp
  # n8n (Docker) necesita alcanzar Ollama por la red interna de Docker
  sudo ufw allow from 172.16.0.0/12 to any port 11434 proto tcp
  verde "   Reglas ufw aplicadas"
else
  echo "   ufw no está activo. Recomendado: sudo pacman -S ufw && sudo ufw enable, y volver a correr este script."
fi

azul "5/5 Descargando modelo $MODELO (varios GB, paciencia)"
ollama pull "$MODELO"

verde "\n============================================================"
verde "  IA LISTA · modelo $MODELO"
verde "  Desde JE/JP prueba:  curl -s http://centinela-ia:11434/api/tags"
verde "============================================================"
echo "Prueba rápida:"
curl -s localhost:11434/api/chat -d "{\"model\":\"$MODELO\",\"stream\":false,\"messages\":[{\"role\":\"user\",\"content\":\"En una frase: ¿qué es una llamada wangiri?\"}]}" | jq -r '.message.content' 2>/dev/null || true
