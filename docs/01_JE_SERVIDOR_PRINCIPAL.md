# 01 · JE — Servidor principal (todo‑en‑uno AMD Athlon, 4 GB, Linux Mint XFCE)

> **Antes de empezar** debes tener hecho: proyecto en Supabase con `schema.sql` y la carpeta subida a GitHub (`04_NUBE.md`, pasos 1 y 2). Ten a mano la cadena de conexión *Session pooler* de Supabase.

Tiempo estimado: 25‑40 min. Conecta el equipo **por cable de red** si puedes.

## Paso 1 · Abrir la terminal en JE
Menú → Terminal (o `Ctrl + Alt + T`). Todo lo que sigue se escribe ahí.

## Paso 2 · Bajar el proyecto
```bash
sudo apt update && sudo apt install -y git
cd ~
git clone https://github.com/TU_USUARIO/surprised-system.git
cd surprised-system
```

## Paso 3 · Instalar todo con un comando
```bash
sudo bash servidor/instalar_nodo.sh JE
```
Durante la instalación:

| Cuando aparezca… | Haz esto |
|---|---|
| `To authenticate, visit: https://login.tailscale.com/...` | Abre el link en el celular e inicia sesión con **tu** cuenta (Google). Esta es la red del grupo. |
| `DATABASE_URL:` | Pega la cadena de Supabase (con tu contraseña puesta) |
| `Nombre Tailscale del PC con Ollama` | Enter (queda `centinela-ia`) |
| `Frase secreta` | Inventa una y **anótala**: JP debe usar la misma |
| Link para habilitar Funnel | Ábrelo, deja las casillas marcadas → **Enable** |

Al final sale en verde **NODO JE (principal) LISTO** con el link público, algo como `https://centinela-je.tail1234.ts.net`. **Anótalo.**

### Qué hace el script (para el informe)
1. Zona horaria Bogotá + paquetes base.
2. Arranque en **consola** (`multi-user.target`). XFCE no se borra.
3. Apaga servicios inútiles en un servidor: impresión (cups), bluetooth, avahi, ModemManager, colord, rsyslog…; bloquea suspensión; tapa cerrada = sigue encendido.
4. **zram** (swap comprimida en RAM, 50 %) y `swappiness=100`; logs limitados a 100 MB.
5. Tailscale con hostname `centinela-je` y **Tailscale SSH** activado.
6. API en `/opt/centinela` con usuario de sistema `centinela`, entorno virtual Python.
7. Servicio **systemd** `centinela`: arranca al encender, se reinicia si falla, máximo 600 MB.
8. Firewall **ufw**: todo cerrado salvo Tailscale y SSH desde la red local.
9. **Tailscale Funnel** → HTTPS público en el puerto 443 hacia la API.

## Paso 4 · Comprobar
```bash
curl -s localhost:8000/health
```
Debe mostrar `"ok":true` y `"db":true`. Si `db` es `false`, revisa la cadena de Supabase:
```bash
sudo nano /opt/centinela/.env        # corregir DATABASE_URL
sudo systemctl restart centinela
```
Desde el celular (con datos móviles, no Wi‑Fi) abre `https://centinela-je.<tu-tailnet>.ts.net/health`.

## Paso 5 · Reiniciar en modo consola
```bash
sudo reboot
```
Arrancará en una pantalla negra de login. **Es lo esperado.** No necesitas iniciar sesión: la API arranca sola.

## Administrarlo desde tu PC personal (ya no necesitas sentarte frente a JE)
```bash
ssh TU_USUARIO_DE_JE@centinela-je        # funciona gracias a Tailscale SSH
```

## Comandos de operación
| Para… | Comando |
|---|---|
| Ver si la API corre | `systemctl status centinela` |
| Ver logs en vivo | `journalctl -u centinela -f` |
| Reiniciar API | `sudo systemctl restart centinela` |
| Actualizar a la última versión | `cd ~/surprised-system && sudo bash servidor/actualizar.sh` |
| Ver link público | `tailscale funnel status` |
| Reactivar link público | `sudo tailscale funnel --bg 8000` |
| RAM / CPU | `htop` |
| Temperatura | `sensors` |
| Ver el escritorio una vez | `sudo systemctl isolate graphical.target` |
| Volver a arrancar siempre en gráfico | `sudo systemctl set-default graphical.target` |

## Problemas comunes
| Síntoma | Causa | Solución |
|---|---|---|
| `db:false` | Cadena mal copiada o usaste "Direct connection" (solo IPv6) | Usa **Session pooler**; si la clave tiene `@ # / ?` cámbiala en Supabase por una sin símbolos |
| `ollama:false` | PC personal apagado o sin Tailscale | Normal; el chatbot usa reglas |
| Funnel no abre | Funnel no habilitado en la cuenta | `sudo tailscale funnel --bg 8000` y abre el link que muestra |
| Pantalla negra al arrancar | Modo consola | Es lo correcto |
