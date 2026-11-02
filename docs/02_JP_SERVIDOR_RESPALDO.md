# 02 · JP — Servidor de respaldo (laptop, Linux Mint XFCE)

> El respaldo es **idéntico** al principal: misma API, misma base de datos. El Gateway de Cloudflare lo usa automáticamente cuando JE no responde.

## Parte A · Lo que hace JE (Juan) antes
1. Entrar a <https://login.tailscale.com/admin/settings/keys> → **Generate auth key**.
   - Reusable: **no** · Ephemeral: **no** · Pre‑approved: **sí** · Expiración: 7 días.
2. Enviarle a JP por privado: la **auth key** (`tskey-auth-...`), la **cadena de Supabase** y la **frase secreta**.
   *(Así la laptop de JP entra a la red de Juan sin usar la cuenta de Juan.)*

## Parte B · Instalar Linux Mint XFCE (JP)
1. Descargar **Linux Mint 22 XFCE** desde linuxmint.com → Download.
2. Grabar la ISO en una USB de 8 GB con **Rufus** (Windows) o **Balena Etcher**.
3. Arrancar la laptop desde la USB (F12, F9 o Esc según la marca) → *Install Linux Mint*.
4. Opciones: idioma Español, **borrar el disco e instalar** (si no hay nada que guardar), usuario y contraseña sencillos de recordar, **marcar "Iniciar sesión automáticamente"**.
5. Al terminar: reiniciar, sacar la USB, conectar internet (ideal por cable).

## Parte C · Convertirla en servidor de respaldo
En la terminal (`Ctrl + Alt + T`):
```bash
sudo apt update && sudo apt install -y git
cd ~
git clone https://github.com/USUARIO_DE_JUAN/surprised-system.git
cd surprised-system
TS_AUTHKEY=tskey-auth-PEGA_AQUI sudo -E bash servidor/instalar_nodo.sh JP
```
Cuando pregunte:
- `DATABASE_URL:` → la cadena que mandó Juan (**la misma de JE**).
- `Nombre Tailscale del PC con Ollama` → Enter.
- `Frase secreta` → **la misma de JE**.
- Si sale el link de Funnel → abrirlo y **Enable** (lo puede aprobar Juan desde su cuenta).

Al final: **NODO JP (respaldo) LISTO** y el link `https://centinela-jp.<tailnet>.ts.net`. Mandárselo a Juan.

```bash
sudo reboot
```

## Parte D · Particularidades de la laptop
- El script ya configuró que **cerrar la tapa no la apague ni suspenda**.
- Dejarla **conectada al cargador**. La batería actúa como mini‑UPS: si se va la luz, JP sigue vivo y JE (todo‑en‑uno) se apaga → ¡failover real!
- Revisar temperatura de vez en cuando: `sensors`. Ponerla sobre superficie dura.

## Verificación
```bash
curl -s localhost:8000/health
```
`"nodo":"JP"`, `"rol":"respaldo"`, `"db":true`.

Juan, desde su PC: `ssh USUARIO_JP@centinela-jp` y `tailscale ping centinela-jp`.
