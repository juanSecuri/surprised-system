#!/usr/bin/env bash
# =====================================================================
#  CENTINELA · Activa las alertas de Telegram y las llamadas reales en un nodo
#  Uso (en JE y luego en JP, con los MISMOS valores):
#     sudo bash servidor/configurar_telegram.sh
# =====================================================================
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Ejecuta con sudo"; exit 1; }
ENV=/opt/centinela/.env
[[ -f $ENV ]] || { echo "No existe $ENV: primero instala el nodo"; exit 1; }

poner() {   # poner CLAVE valor  → reemplaza o agrega la línea en .env
  sed -i "/^$1=/d" "$ENV"
  echo "$1=$2" >> "$ENV"
}

echo "(Si vuelves a correr esto solo para agregar el chat_id, deja vacío lo demás: se conserva.)"
echo "Token del bot (te lo dio @BotFather, forma 123456789:AAH...):"
read -r -s TG; echo
echo "Tu chat_id (escríbele /miid al bot cuando ya funcione; si aún no lo tienes, deja vacío):"
read -r CHAT
echo "Clave para el celular (LLAMADAS_TOKEN)."
echo "  · En JE: deja vacío y se genera una nueva (o se conserva la que ya había)."
echo "  · En JP: pega la MISMA que se generó en JE."
read -r CLAVE
if [[ -z "$CLAVE" ]]; then
  CLAVE="$(grep -E '^LLAMADAS_TOKEN=' "$ENV" | cut -d= -f2- || true)"
  [[ -n "$CLAVE" ]] || CLAVE="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
fi

[[ -n "$TG" ]] && poner TELEGRAM_TOKEN "$TG"
[[ -n "$CHAT" ]] && poner TELEGRAM_CHAT_ID "$CHAT"
poner LLAMADAS_TOKEN "$CLAVE"
chmod 600 "$ENV"; chown centinela:centinela "$ENV"
systemctl restart centinela

echo
echo -e "\e[1;32m✔ Listo. Guarda esta clave para el celular (y para JP):\e[0m"
echo -e "\e[1;33m   LLAMADAS_TOKEN = $CLAVE\e[0m"
for i in $(seq 1 20); do curl -sf localhost:8000/health >/dev/null && break; sleep 1; done
curl -s localhost:8000/health; echo
