#!/usr/bin/env bash
# Actualiza la API del nodo con la última versión de GitHub.
# Uso (en JE o JP):  sudo bash servidor/actualizar.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
sudo -u "${SUDO_USER:-$USER}" git pull --ff-only
cp servidor/app/main.py servidor/app/requirements.txt /opt/centinela/
/opt/centinela/venv/bin/pip install -q -r /opt/centinela/requirements.txt
chown -R centinela:centinela /opt/centinela
systemctl restart centinela
for i in $(seq 1 20); do
  if curl -sf localhost:8000/health; then echo; echo "✔ Actualizado"; exit 0; fi
  sleep 1
done
echo "✘ La API no respondió en 20 s. Revisa: journalctl -u centinela -n 30 --no-pager"; exit 1
