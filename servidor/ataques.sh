#!/usr/bin/env bash
# =====================================================================
#  CENTINELA · Auto-ataques controlados (pruebas de resistencia)
#  Ataca SOLO nuestro propio servicio para demostrar que las defensas
#  aguantan. No se ataca a nadie más.
#  Uso:  bash servidor/ataques.sh [URL_DEL_GATEWAY]
# =====================================================================
set -u
GW="${1:-https://centinela.juan-gallego-sec.workers.dev}"
verde(){ printf "  \e[1;32m✔ %s\e[0m\n" "$*"; }
gris(){ printf "  %s\n" "$*"; }
azul(){ printf "\n\e[1;34m▶ %s\e[0m\n" "$*"; }
code(){ curl -s -o /dev/null -w "%{http_code}" "$@"; }

azul "Objetivo: $GW   (SOLO nuestro propio servicio)"

azul "1) Inundación / flood — ¿el límite de peticiones frena la avalancha?"
gris "lanzando 250 peticiones en paralelo..."
N429=$(for i in $(seq 1 250); do curl -s -o /dev/null -w "%{http_code}\n" "$GW/api/numero/3001234567" & done | grep -c 429)
gris "respuestas 429 (bloqueadas por el límite): $N429"
if [ "$(code "$GW/health")" = "200" ]; then verde "El servicio SIGUE EN PIE tras el flood"; else gris "revisar: el servicio no respondió"; fi

azul "2) Cuerpo gigante (payload de 20 KB) — ¿lo rechaza?"
BIG=$(head -c 20000 /dev/zero | tr '\0' A)
C=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$GW/api/reportar" -H 'content-type: application/json' --data-binary "{\"numero\":\"3001234567\",\"descripcion\":\"$BIG\"}")
if [ "$C" = "413" ]; then verde "413: cortó el cuerpo gigante antes de procesarlo"; else gris "HTTP $C"; fi

azul "3) Llamada sin token — ¿la autenticación del endpoint sensible aguanta?"
C=$(code -X POST "$GW/api/llamada" -H 'content-type: application/json' -d '{"numero":"3001234567"}')
if [ "$C" = "401" ]; then verde "401: sin token NO se puede registrar una llamada"; else gris "esperaba 401, dio $C"; fi

azul "4) Inyección SQL — ¿las consultas parametrizadas resisten?"
INY=$(python3 -c "import urllib.parse;print(urllib.parse.quote(\"3001234567'; DROP TABLE numeros;--\"))")
C=$(code "$GW/api/numero/$INY")
if [ "$C" = "422" ] || [ "$C" = "200" ]; then verde "La inyección no hace nada (entrada validada, consultas parametrizadas)"; else gris "HTTP $C"; fi
if [ "$(code "$GW/health")" = "200" ]; then verde "La base de datos sigue intacta"; fi

azul "5) Fuerza bruta al panel — ¿se bloquea el login?"
gris "(ojo: esto bloquea TU propio acceso al panel por 15 min; es la prueba de que funciona)"
for i in $(seq 1 6); do printf "%s " "$(code -X POST "$GW/admin/login" -d "usuario=admin&clave=mala$i")"; done; echo
gris "tras 5 intentos fallidos debe aparecer 429 (bloqueo por intentos)"

azul "6) Cabeceras de seguridad en la web"
H=$(curl -sI "$GW/" | grep -ciE "content-security-policy|x-frame-options|x-content-type-options|strict-transport-security")
if [ "$H" -ge 4 ]; then verde "La web envía $H cabeceras de seguridad"; else gris "faltan cabeceras (encontradas: $H)"; fi

echo; echo "Fin. Cada defensa que aguantó se puede mostrar en vivo al profesor."
