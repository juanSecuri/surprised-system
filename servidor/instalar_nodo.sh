#!/usr/bin/env bash
# =====================================================================
#  CENTINELA · Instalador de nodo servidor (Linux Mint XFCE → servidor en consola)
#
#  Uso (desde la carpeta del proyecto):
#     sudo bash servidor/instalar_nodo.sh JE      # PC todo-en-uno de Juan (principal)
#     sudo bash servidor/instalar_nodo.sh JP      # laptop de JP (respaldo)
#
#  Opcional: TS_AUTHKEY=tskey-auth-xxxx sudo -E bash servidor/instalar_nodo.sh JP
#            (para que JP entre a la red Tailscale de Juan sin iniciar sesión)
#
#  Se puede ejecutar varias veces: si algo ya está hecho, lo salta.
# =====================================================================
set -euo pipefail

ROL_CORTO="${1:-}"
if [[ "$ROL_CORTO" != "JE" && "$ROL_CORTO" != "JP" ]]; then
  echo "Uso: sudo bash $0 JE|JP"; exit 1
fi
[[ $EUID -eq 0 ]] || { echo "Ejecuta con sudo"; exit 1; }

if [[ "$ROL_CORTO" == "JE" ]]; then ROL="principal"; else ROL="respaldo"; fi
HOST_TS="centinela-$(echo "$ROL_CORTO" | tr '[:upper:]' '[:lower:]')"
DIR_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR=/opt/centinela
PUERTO=8000

verde(){ echo -e "\e[1;32m$*\e[0m"; }
azul(){ echo -e "\n\e[1;34m▶ $*\e[0m"; }
amarillo(){ echo -e "\e[1;33m$*\e[0m"; }

# ---------------------------------------------------------------------
azul "1/8 Hora del sistema y paquetes base"
timedatectl set-timezone America/Bogota || true
timedatectl set-ntp true || true
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  curl git ca-certificates python3 python3-venv python3-pip sqlite3 \
  openssh-server ufw htop lm-sensors zram-tools jq

# ---------------------------------------------------------------------
azul "2/8 Modo servidor: arrancar en consola (sin escritorio gráfico)"
systemctl set-default multi-user.target
amarillo "   El escritorio XFCE NO se borra: para volver a verlo una vez →  sudo systemctl isolate graphical.target"
amarillo "   Para dejarlo gráfico de nuevo al arrancar →  sudo systemctl set-default graphical.target"

# ---------------------------------------------------------------------
azul "3/8 Apagando servicios que gastan RAM/CPU y no sirven en un servidor"
for s in cups cups-browsed bluetooth avahi-daemon ModemManager kerneloops colord \
         openvpn speech-dispatcher whoopsie apport rsyslog; do
  if systemctl list-unit-files | grep -q "^$s"; then
    systemctl disable --now "$s" 2>/dev/null && echo "   – $s desactivado" || true
  fi
done
# Que nunca se suspenda ni hiberne
systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null
# Laptop (JP): seguir funcionando con la tapa cerrada
mkdir -p /etc/systemd/logind.conf.d
cat > /etc/systemd/logind.conf.d/centinela.conf <<'EOF'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
IdleAction=ignore
EOF
# Swap comprimida en RAM (zram): da aire a equipos de 4 GB
cat > /etc/default/zramswap <<'EOF'
ALGO=zstd
PERCENT=50
PRIORITY=100
EOF
systemctl restart zramswap || true
echo "vm.swappiness=100" > /etc/sysctl.d/99-centinela.conf
sysctl -p /etc/sysctl.d/99-centinela.conf >/dev/null
# Limitar el tamaño de los logs
mkdir -p /etc/systemd/journald.conf.d
printf "[Journal]\nSystemMaxUse=100M\n" > /etc/systemd/journald.conf.d/centinela.conf
systemctl restart systemd-journald
# Pantalla de consola se apaga sola al minuto (ahorra energía en el todo-en-uno)
if [[ -f /etc/default/grub ]] && ! grep -q consoleblank /etc/default/grub; then
  sed -i 's/^GRUB_CMDLINE_LINUX_DEFAULT="\(.*\)"/GRUB_CMDLINE_LINUX_DEFAULT="\1 consoleblank=60"/' /etc/default/grub
  update-grub >/dev/null 2>&1 || true
fi

# ---------------------------------------------------------------------
azul "4/8 Tailscale (red privada entre JE, JP y el PC personal)"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
systemctl enable --now tailscaled
if ! tailscale status >/dev/null 2>&1; then
  if [[ -n "${TS_AUTHKEY:-}" ]]; then
    tailscale up --ssh --hostname="$HOST_TS" --authkey="$TS_AUTHKEY"
  else
    amarillo "   Abre el link que aparece abajo (en el celular sirve) e inicia sesión con la cuenta de Juan."
    tailscale up --ssh --hostname="$HOST_TS"
  fi
else
  tailscale set --ssh --hostname="$HOST_TS" || true
fi
verde "   IP Tailscale: $(tailscale ip -4 | head -1)"

# ---------------------------------------------------------------------
azul "5/8 Instalando la API Centinela en $APP_DIR"
id centinela >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin centinela
mkdir -p "$APP_DIR"
cp "$DIR_SCRIPT"/app/main.py "$DIR_SCRIPT"/app/requirements.txt "$APP_DIR"/
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --upgrade pip -q
"$APP_DIR/venv/bin/pip" install -q -r "$APP_DIR/requirements.txt"

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo
  amarillo "   Pega la cadena de conexión de Supabase (Session pooler). Ej:"
  amarillo "   postgresql://postgres.abcd:CLAVE@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
  read -r -p "   DATABASE_URL: " DBURL
  read -r -p "   Nombre Tailscale del PC con Ollama [centinela-ia]: " IAHOST
  IAHOST="${IAHOST:-centinela-ia}"
  read -r -p "   Frase secreta (IGUAL en JE y JP): " SAL
  cat > "$APP_DIR/.env" <<EOF
NODO_NOMBRE=$ROL_CORTO
NODO_ROL=$ROL
DATABASE_URL=$DBURL
OLLAMA_URL=http://$IAHOST:11434
OLLAMA_MODEL=qwen2.5:7b
SAL_HASH=${SAL:-centinela}
LOCAL_DB=$APP_DIR/local.db
CORS_ORIGINS=*
EOF
fi
chmod 600 "$APP_DIR/.env"
chown -R centinela:centinela "$APP_DIR"

# ---------------------------------------------------------------------
azul "6/8 Servicio systemd (arranca solo al encender y se reinicia si falla)"
cat > /etc/systemd/system/centinela.service <<EOF
[Unit]
Description=Centinela API (nodo $ROL_CORTO - $ROL)
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
User=centinela
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=$APP_DIR/venv/bin/uvicorn main:app --host 0.0.0.0 --port $PUERTO --workers 1 --proxy-headers
Restart=always
RestartSec=3
MemoryMax=600M
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now centinela
systemctl restart centinela

# ---------------------------------------------------------------------
azul "7/8 Firewall: solo se entra por Tailscale (y SSH desde la red local)"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0
ufw allow from 192.168.0.0/16 to any port 22 proto tcp
ufw allow from 10.0.0.0/8 to any port 22 proto tcp
ufw --force enable

# ---------------------------------------------------------------------
azul "8/8 Publicando la API en internet con Tailscale Funnel (HTTPS gratis)"
amarillo "   Si aparece un link para habilitar Funnel, ábrelo, deja las casillas marcadas y dale Enable."
tailscale funnel --bg $PUERTO || amarillo "   Funnel pendiente: habilítalo con el link y vuelve a correr:  sudo tailscale funnel --bg $PUERTO"

sleep 3
URL="https://$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
echo
verde "============================================================"
verde "  NODO $ROL_CORTO ($ROL) LISTO"
verde "  Link público:    $URL"
verde "  Prueba local:    curl -s localhost:$PUERTO/health"
verde "  Prueba pública:  curl -s $URL/health"
verde "  Logs en vivo:    journalctl -u centinela -f"
verde "  Reinicia el PC para quedar en modo consola:  sudo reboot"
verde "============================================================"
curl -s "localhost:$PUERTO/health" || amarillo "La API aún está arrancando: espera 5 s y prueba de nuevo."
echo
