# 04 · Nube gratuita — Supabase, GitHub y Cloudflare

## 1 · Supabase (base de datos compartida)
1. <https://supabase.com> → Sign in con GitHub → **New project**.
   - Name: `centinela` · Region: **East US (North Virginia)** (buena latencia desde Colombia) · Genera una contraseña **sin símbolos raros** (solo letras y números) y guárdala.
2. Menú izquierdo → **SQL Editor** → New query → pegar todo `db/schema.sql` → **Run**. Debe decir *Success*.
3. Botón **Connect** (arriba) → pestaña *Connection string* → **Session pooler** → copiar la URI y reemplazar `[YOUR-PASSWORD]`.
   - ⚠️ No uses "Direct connection": en el plan gratis es solo IPv6 y la mayoría de redes caseras en Colombia no lo tienen.
4. Esa cadena es el `DATABASE_URL` de JE y JP.

> Plan gratis: 500 MB y el proyecto se pausa tras 7 días sin actividad. Los latidos de los servidores lo mantienen activo.

### ¿Ya tienes 2 proyectos gratis en Supabase? (límite de la cuenta)
- **Opción A (recomendada): que JP cree el proyecto en SU cuenta** de Supabase e invite a Juan como *Developer* (Organization → Team → Invite). Cada persona tiene su propio cupo de 2 proyectos. No cambia nada más.
- **Opción B: pausar** uno de tus proyectos que no uses (los pausados no cuentan). No lo hagas con proyectos de trabajo.
- **Opción C: Neon** (Postgres gratis, hasta 100 proyectos) — ver abajo.

### Alternativa: Neon
1. <https://neon.com> → Sign up con GitHub → proyecto `centinela`, región **AWS US East (N. Virginia)**, Postgres 17.
2. **SQL Editor** → pegar `db/schema.sql` → Run.
3. **Connect** → copiar la cadena (`postgresql://...neon.tech/neondb?sslmode=require`). Ese es el `DATABASE_URL`.

La API detecta Neon sola y se adapta: Neon gratis da 100 horas de cómputo al mes y apaga la BD tras 5 min sin uso, así que con Neon los latidos van cada 15 min (no cada 20 s) y no se dejan conexiones abiertas. El estado "en vivo" de JE/JP lo da el Gateway (`/gateway/estado`), que no usa la base de datos. La primera consulta tras un rato sin uso tarda ~1 s más mientras Neon despierta.

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
