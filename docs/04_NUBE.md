# 04 · Nube gratuita — Supabase, GitHub y Cloudflare

## 1 · Supabase (base de datos compartida)
1. <https://supabase.com> → Sign in con GitHub → **New project**.
   - Name: `centinela` · Region: **East US (North Virginia)** (buena latencia desde Colombia) · Genera una contraseña **sin símbolos raros** (solo letras y números) y guárdala.
2. Menú izquierdo → **SQL Editor** → New query → pegar todo `db/schema.sql` → **Run**. Debe decir *Success*.
3. Botón **Connect** (arriba) → pestaña *Connection string* → **Session pooler** → copiar la URI y reemplazar `[YOUR-PASSWORD]`.
   - ⚠️ No uses "Direct connection": en el plan gratis es solo IPv6 y la mayoría de redes caseras en Colombia no lo tienen.
4. Esa cadena es el `DATABASE_URL` de JE y JP.

> Plan gratis: 500 MB y el proyecto se pausa tras 7 días sin actividad. Los latidos de los servidores lo mantienen activo.

## 2 · GitHub (para llevar el código a JE y JP)
En el PC personal:
```bash
cd ~/surprised-system
git init && git add . && git commit -m "Centinela: fase 1 infraestructura"
gh repo create surprised-system --public --source=. --push      # o créalo en github.com
```
El `.gitignore` evita subir `.env`, bases de datos locales y tokens.
*(Público para clonar sin contraseña en los servidores; no contiene secretos.)*

## 3 · Cloudflare Worker (gateway con failover)
Cuando JE y JP tengan su link de Funnel:
1. Crear cuenta gratis en <https://dash.cloudflare.com>.
2. En el PC personal:
```bash
cd ~/surprised-system/gateway
nano wrangler.toml          # pon los links reales de JE y JP
npx wrangler login          # abre el navegador, autoriza
npx wrangler deploy
```
3. Te da un link `https://centinela.<tu-subdominio>.workers.dev`. **Ese es el link público del proyecto.**

Probar:
```bash
curl -si https://centinela.<tu-subdominio>.workers.dev/health | grep -i x-centinela
curl -s  https://centinela.<tu-subdominio>.workers.dev/gateway/estado
```

### ¿Por qué Cloudflare y no Render?
- Render gratis "duerme" el servicio tras 15 min (la primera visita tarda ~1 min) y su Postgres gratis se borra a los 30 días.
- Cloudflare Workers: 100.000 peticiones/día gratis, sin dormir, y permite el failover en el código. Supabase se queda con la base de datos.
