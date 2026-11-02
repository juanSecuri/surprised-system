# 08 · Checklist final: cuando JP esté listo + sustentación

## A · Integrar a JP (15 min, cuando su laptop diga "NODO JP LISTO")
- [ ] JP manda foto de `curl -s localhost:8000/health` con `"db":true`.
- [ ] Juan, desde su PC: `tailscale ping centinela-jp` responde.
- [ ] En JP (Juan puede hacerlo por `ssh USUARIO_JP@centinela-jp`):
  ```bash
  cd ~/surprised-system && sudo bash servidor/actualizar.sh        # "version":"1.3.0"
  sudo bash servidor/configurar_telegram.sh                        # MISMO token, chat_id y clave que JE
  ```
- [ ] `curl -s https://centinela.juan-gallego-sec.workers.dev/gateway/estado` → JE y JP `online:true`, `activo:"JE"`.
- [ ] En la web, sección *El clúster, en vivo*: JE "Atendiendo", JP "En espera, listo".
- [ ] Bot: `/estado` muestra 🟢 JE y 🟢 JP.

## B · Ensayo de failover (antes de la sustentación)
1. PC personal, terminal 1 (monitor):
   ```bash
   GW=https://centinela.juan-gallego-sec.workers.dev
   while true; do printf "%s  " "$(date +%T)"; curl -s -o /dev/null -D - $GW/health | grep -i x-centinela-nodo || echo "SIN RESPUESTA"; sleep 1; done
   ```
2. Web abierta en la sección del clúster y Telegram a la mano.
3. **Desconectar JE de la corriente.**
4. Esperado: el monitor cambia `JE → JP` sin `SIN RESPUESTA`; la web muestra el aviso ámbar; a los ≤2 min llega a Telegram *"⚠️ JE dejó de responder…"*.
5. Consultar un número y reportar otro **con JE apagado** → funciona ("Respondió el servidor JP").
6. Encender JE → vuelve solo como principal; llega *"✅ JE volvió…"*.
7. Anotar: hora de corte, segundos hasta que respondió JP, peticiones perdidas (meta: 0).

## C · Guion de sustentación (8‑10 min)
| Min | Qué se muestra | Quién |
|---|---|---|
| 0‑1 | El problema: llamadas de falsos bancos, cobranza, wangiri. "¿Quién te está llamando?" | JE |
| 1‑3 | Arquitectura (diagrama de la web): 2 PCs viejos en consola, Tailscale, Cloudflare, Supabase, IA local | JP |
| 3‑4 | Web en vivo: consultar `300 123 4567` → celular rojo. Reportar uno nuevo con descripción → la IA lo clasifica | JE |
| 4‑5 | Telegram: el profesor le escribe un número al bot / `/estado` | JP |
| 5‑6 | **Llamada real:** alguien llama al celular sensor → notificación + Telegram + web en vivo | JE |
| 6‑8 | **Failover:** desconectar JE de la corriente frente a todos; la web y el bot siguen; llega la alerta | JP |
| 8‑10 | Resultados: RAM 63 % → 17 % en consola, latencias, 0 peticiones perdidas, seguridad (RLS, ufw, tokens, hashes). Preguntas | Ambos |

**Plan B si falla internet en el salón:** compartir datos desde un celular a los dos PCs; tener capturas y un video corto del failover grabado el día anterior.

## D · Evidencias para el informe
- [ ] `free -h` en JE con escritorio (antes) y en consola (después).
- [ ] Captura de `tailscale status` con los 3 nodos y latencias de `tailscale ping`.
- [ ] Tabla de failover del punto B.
- [ ] Captura de Supabase con RLS activado en las 5 tablas.
- [ ] `sudo ufw status verbose` de JE y JP.
- [ ] Capturas: web (escritorio y celular), bot, notificación del celular, flujos de n8n, bitácora del clúster.
- [ ] `docs/05_PRUEBAS.md` ejecutado con resultados.

## E · Pendientes opcionales (si sobra tiempo)
- Dominio propio barato (.com.co) apuntando a Cloudflare.
- Página `/acerca` con el informe técnico.
- Tercer nodo de emergencia en el PC personal.
