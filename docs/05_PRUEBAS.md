# 05 · Protocolo de pruebas y auditoría

Reemplaza `GW` por el link del Worker. Ejecutar desde cualquier PC con internet.
```bash
GW=https://centinela.<tu-subdominio>.workers.dev
```

## P1 · Conectividad Tailscale (rol: redes)
```bash
tailscale status
tailscale ping centinela-je
tailscale ping centinela-jp
tailscale ping centinela-ia
```
Anotar latencias (ms) y si la conexión es `direct` o `via DERP` → tabla para el informe.

## P2 · Salud de cada nodo
```bash
curl -s https://centinela-je.<tailnet>.ts.net/health
curl -s https://centinela-jp.<tailnet>.ts.net/health
curl -s $GW/gateway/estado
```
✔ Esperado: ambos `ok:true`, `db:true`; `activo: "JE"`.

## P3 · Funcionalidad
```bash
curl -s -X POST $GW/api/reportar -H 'content-type: application/json' \
  -d '{"numero":"3001234567","descripcion":"Dicen ser del banco y piden la clave"}'
curl -s $GW/api/numero/3001234567
curl -s -X POST $GW/api/chat -H 'content-type: application/json' -d '{"mensaje":"¿Contesto el 300 123 4567?"}'
curl -s $GW/api/stats
```
✔ La categoría pasa a `suplantacion` (si `centinela-ia` está prendido) y el chat dice `"fuente":"ollama"`.

## P4 · FAILOVER (la prueba estrella)
Terminal 1 — monitor que pregunta cada segundo quién atiende:
```bash
while true; do printf "%s  " "$(date +%T)"; curl -s -o /dev/null -D - $GW/health | grep -i x-centinela-nodo || echo "SIN RESPUESTA"; sleep 1; done
```
Terminal 2 — tumbar el principal (cualquiera de estas):
- `ssh ...@centinela-je sudo systemctl stop centinela` (falla de software)
- Desconectar el cable de red de JE (falla de red)
- **Desconectar JE de la corriente** (falla de hardware) ← para la sustentación

✔ Esperado: la columna cambia de `JE` a `JP` sin ninguna línea `SIN RESPUESTA` (como máximo una petición tarda ~4 s).
Restaurar JE → al arrancar vuelve a aparecer `JE` solo.
Medir y anotar: **tiempo de detección** y **peticiones perdidas** (debe ser 0).

## P5 · Modo degradado (falla de la nube)
En JP, simular caída de Supabase bloqueando el puerto:
```bash
sudo iptables -I OUTPUT -p tcp --dport 5432 -j REJECT
curl -s localhost:8000/health                # db:false
curl -s -X POST localhost:8000/api/reportar -H 'content-type: application/json' -d '{"numero":"3157778899","categoria":"cobranza"}'
# → "modo":"degradado"
sudo iptables -D OUTPUT -p tcp --dport 5432 -j REJECT
sleep 35; curl -s localhost:8000/health      # pendientes: 0
```
✔ En `$GW/api/cluster` aparece el evento `sincronizacion`.

## P6 · Seguridad (auditoría)
| Verificación | Comando | Esperado |
|---|---|---|
| Puertos abiertos en la LAN | `sudo ufw status verbose` | Solo tailscale0 y 22 desde LAN |
| `.env` protegido | `ls -l /opt/centinela/.env` | `-rw-------` centinela |
| API no corre como root | `ps -o user= -C uvicorn` | `centinela` |
| API pública de Supabase bloqueada | Supabase → Table editor → RLS enabled | ✔ en las 4 tablas |
| Límite anti‑abuso | 11 reportes seguidos | El 11º da HTTP 429 |
| Sin datos personales | `select reportero from reportes` | Solo hashes |

## P7 · Rendimiento (opcional para el informe)
```bash
sudo apt install -y apache2-utils
ab -n 200 -c 10 $GW/api/numero/3001234567
```
Comparar `free -h` en JE antes (con XFCE) y después (consola).
