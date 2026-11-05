#!/usr/bin/env bash
# =====================================================================
#  CENTINELA · Configura el panel de administración (login)
#  Crea usuario + contraseña cifrada, clave de sesión y doble factor opcional.
#  Uso (en JE y luego en JP, con los MISMOS datos):
#     sudo bash servidor/configurar_admin.sh
# =====================================================================
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Ejecuta con sudo"; exit 1; }
ENV=/opt/centinela/.env
[[ -f $ENV ]] || { echo "No existe $ENV: primero instala el nodo"; exit 1; }

poner() { sed -i "/^$1=/d" "$ENV"; printf '%s=%s\n' "$1" "$2" >> "$ENV"; }

read -rp "Usuario del panel [admin]: " U; U="${U:-admin}"
read -rsp "Contraseña (mínimo 8 caracteres): " C1; echo
read -rsp "Repite la contraseña: " C2; echo
[[ "$C1" == "$C2" ]] || { echo "No coinciden."; exit 1; }
[[ ${#C1} -ge 8 ]] || { echo "Muy corta (mínimo 8)."; exit 1; }
read -rp "¿Activar doble factor con Aegis? [s/N]: " DF

HASH=$(C="$C1" python3 - <<'PY'
import os, hashlib, secrets
c = os.environ["C"].encode(); s = secrets.token_bytes(16)
print("pbkdf2$%s$%s" % (s.hex(), hashlib.pbkdf2_hmac("sha256", c, s, 200000).hex()))
PY
)
poner ADMIN_USER "$U"
poner ADMIN_HASH "$HASH"
grep -q '^SECRET_KEY=' "$ENV" || poner SECRET_KEY "$(python3 -c 'import secrets;print(secrets.token_hex(32))')"

if [[ "${DF,,}" == "s" ]]; then
  TOTP=$(python3 -c 'import secrets,base64;print(base64.b32encode(secrets.token_bytes(20)).decode())')
  poner ADMIN_TOTP "$TOTP"
  echo
  echo "===== DOBLE FACTOR ====="
  echo "En Aegis / Google Authenticator: + -> Entrada manual -> TOTP, 6 dígitos, 30 s, SHA1"
  echo "Secreto:  $TOTP"
  echo "(mete el MISMO secreto en JE y en JP para que el código sirva en los dos)"
else
  sed -i '/^ADMIN_TOTP=/d' "$ENV"
fi

chmod 600 "$ENV"; chown centinela:centinela "$ENV"
systemctl restart centinela
for i in $(seq 1 20); do curl -sf localhost:8000/health >/dev/null && break; sleep 1; done
echo
echo "✔ Panel configurado. Entra por el link del gateway, ruta /admin"
echo "  Ej: https://centinela.juan-gallego-sec.workers.dev/admin"
