# CENTINELA 🛡️

Sistema distribuido y tolerante a fallos que identifica llamadas spam y estafas telefónicas con reportes de la comunidad, puntaje de riesgo e IA local.

**Grupo:** JE (Juan) · JP — Ingeniería de Sistemas, semestre 8.

```
Usuarios → Cloudflare Worker (failover) → JE principal ─┐
                                        ↘ JP respaldo ──┴→ Supabase Postgres
                         Tailscale ↔ PC personal: Ollama + n8n + Telegram
```

## Empieza aquí
1. [`docs/00_PLAN_MAESTRO.md`](docs/00_PLAN_MAESTRO.md) — arquitectura, decisiones, fases
2. [`docs/04_NUBE.md`](docs/04_NUBE.md) — Supabase, GitHub, Cloudflare
3. [`docs/01_JE_SERVIDOR_PRINCIPAL.md`](docs/01_JE_SERVIDOR_PRINCIPAL.md)
4. [`docs/02_JP_SERVIDOR_RESPALDO.md`](docs/02_JP_SERVIDOR_RESPALDO.md)
5. [`docs/03_PC_PERSONAL_IA.md`](docs/03_PC_PERSONAL_IA.md)
6. [`docs/05_PRUEBAS.md`](docs/05_PRUEBAS.md) — protocolo de pruebas y auditoría
7. [`docs/06_TELEGRAM_N8N.md`](docs/06_TELEGRAM_N8N.md) — bot de Telegram y automatizaciones n8n
8. [`docs/07_LLAMADAS_REALES.md`](docs/07_LLAMADAS_REALES.md) — detectar llamadas reales (Android / iPhone)
9. [`docs/08_CHECKLIST_FINAL.md`](docs/08_CHECKLIST_FINAL.md) — integrar a JP y guion de sustentación

**En vivo:** https://centinela.juan-gallego-sec.workers.dev

## Estructura
```
db/schema.sql              Esquema PostgreSQL
servidor/app/              API FastAPI del nodo (igual en JE y JP)
servidor/instalar_nodo.sh  Mint XFCE → servidor en consola (JE | JP)
servidor/actualizar.sh     Actualizar la API desde GitHub
servidor/configurar_telegram.sh  Token del bot, chat_id y clave del celular
gateway/                   Cloudflare Worker con failover
ia/                        Ollama y n8n en el PC personal
web/                       Web responsive (se publica con el gateway)
ia/n8n/                    Flujos de n8n para importar (bot + avisos)
db/002_llamadas.sql        Migración: llamadas reales
docs/                      Guías paso a paso
```

*Toda la gloria a Dios.*
