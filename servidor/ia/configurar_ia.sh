#!/usr/bin/env bash
# =====================================================================
#  CENTINELA · Configura la IA local (Ollama) en la máquina de la IA
#  - Crea el modelo acotado "centinela" (solo habla de spam/llamadas)
#  - Usa la GPU (RTX 4060) si está disponible; si no, modelo liviano en CPU
#  - Limita el consumo: 1 petición a la vez, se descarga sola al estar ocioso
#  Córrelo en el PC donde vive Ollama (el de mesa con la 4060).
#  Uso:  bash servidor/ia/configurar_ia.sh
# =====================================================================
set -euo pipefail
azul(){ printf "\n\e[1;34m▶ %s\e[0m\n" "$*"; }
ok(){ printf "  \e[1;32m✔ %s\e[0m\n" "$*"; }
DIR="$(cd "$(dirname "$0")" && pwd)"

command -v ollama >/dev/null || { echo "Ollama no está instalado aquí. Instálalo primero:"; echo "  Arch/omarchy:  sudo pacman -S ollama   (o: curl -fsSL https://ollama.com/install.sh | sh)"; exit 1; }

# ---- GPU o CPU ----
if command -v nvidia-smi >/dev/null && nvidia-smi >/dev/null 2>&1; then
  BASE="qwen2.5:7b"; MODO="GPU (RTX)"
else
  BASE="qwen2.5:3b"; MODO="CPU (sin GPU detectada)"
  echo "  (No vi nvidia-smi. Si tienes la 4060, instala los drivers nvidia y el soporte CUDA de Ollama para ir por GPU.)"
fi
azul "Modo: $MODO · modelo base: $BASE"

# ---- límites de consumo de Ollama (drop-in de systemd) ----
if systemctl list-unit-files 2>/dev/null | grep -q '^ollama.service'; then
  azul "Limitando el consumo de Ollama (systemd)"
  sudo mkdir -p /etc/systemd/system/ollama.service.d
  sudo tee /etc/systemd/system/ollama.service.d/centinela.conf >/dev/null <<EOF
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
Environment="OLLAMA_KEEP_ALIVE=10m"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_FLASH_ATTENTION=1"
EOF
  sudo systemctl daemon-reload
  sudo systemctl restart ollama
  sleep 2
  ok "Ollama escucha en 0.0.0.0:11434, 1 petición a la vez, se descarga a los 10 min ocioso"
else
  echo "  (Ollama no corre como servicio systemd; arráncalo con: OLLAMA_HOST=0.0.0.0 ollama serve)"
fi

# ---- bajar el modelo base y crear el modelo acotado ----
azul "Descargando el modelo base (puede tardar la primera vez)"
ollama pull "$BASE"

azul "Creando el modelo acotado 'centinela'"
sed "s|^FROM .*|FROM $BASE|" "$DIR/Modelfile" > /tmp/Modelfile.centinela
ollama create centinela -f /tmp/Modelfile.centinela
ok "Modelo 'centinela' listo"

# ---- prueba rápida: debe rechazar lo que no es del tema ----
azul "Prueba (debe negarse a un tema ajeno):"
ollama run centinela "cuánto es 2+2?" 2>/dev/null | head -3 || true

# ---- qué poner en los nodos ----
HOST_TS="$(tailscale status --self --json 2>/dev/null | grep -o '"DNSName":"[^"]*"' | head -1 | cut -d'"' -f4 | sed 's/\.$//' || true)"
[ -z "${HOST_TS:-}" ] && HOST_TS="$(hostname)"
azul "AHORA, en JE y en JP, pon en /opt/centinela/.env:"
cat <<EOF
  OLLAMA_URL=http://$HOST_TS:11434
  OLLAMA_MODEL=centinela
  OLLAMA_KEEP_ALIVE=10m
  OLLAMA_NUM_CTX=1024
y reinicia:  sudo systemctl restart centinela
EOF
echo
ok "IA configurada. Rápida, acotada y sin consumir de más."
