# 09 · Blindaje del clúster (para el día de los ataques)

> Objetivo: que JE y JP **sigan en pie** cuando el resto de grupos intente tumbarlos.
> No atacamos a nadie: ganamos siendo el servicio que no se cae. Entender el ataque es
> lo que nos deja defenderlo, y eso es lo que se evalúa.

## Cómo nos pueden atacar y con qué lo paramos

| Ataque típico en clase | Qué le pasaría a Centinela | Nuestra defensa (ya montada) |
|---|---|---|
| Inundar la web/API con miles de peticiones (flood / DoS) | Saturar CPU/RAM del nodo | Cloudflare absorbe el volumen + escudo por IP en el Worker (100/min) + límite por IP en cada nodo (150/min) → responde 429, no cae |
| Pegarle a `/api/chat` para reventar la IA | Ollama encolado, nodo lento | Chat limitado a 12/min por IP en el gateway; health responde desde caché, no espera a Ollama |
| Payloads gigantes en el cuerpo | Memoria del nodo | Worker corta cuerpos > 4 KB (413); Pydantic limita cada campo |
| Apagar/matar el proceso de la API | Caída del servicio | `systemd Restart=always` lo revive en 3 s; `MemoryMax=600M` evita que tumbe el PC |
| Tumbar el nodo principal entero | Sin servicio | **Failover**: el gateway manda todo a JP en ≤8 s, sin perder peticiones |
| Fuerza bruta por SSH | Entrar al servidor | SSH solo desde la LAN (ufw) y por Tailscale SSH; nada expuesto a internet |
| Escanear puertos del PC | Encontrar XAMPP, Postgres, etc. | ufw niega todo lo entrante salvo `tailscale0`; no hay XAMPP ni DB local expuesta |
| Robar la base de datos | Leer/borrar datos | Supabase con RLS; credenciales solo en los nodos (`.env` 600); nunca en la web ni en GitHub |
| Abusar del endpoint de llamadas | Llenar la BD de llamadas falsas | `/api/llamada` exige token secreto; sin él responde 401 |

## Sprint 1 · Reforzar el código (10 min, lo hago yo, tú solo despliegas)
Ya está en el repo:
- **Gateway** (`gateway/worker.js`): escudo por IP (100/min, chat 12/min), corte de cuerpos > 4 KB, 429 con `Retry-After`. Probado.
- **API** (`servidor/app/main.py`): límite global por IP (150/min) en todos los endpoints salvo `/health` y `/ping`; baldes separados por tipo. Probado (flood → 429, otras IP siguen, nodo sano).
- **Servicio** (`instalar_nodo.sh`): `--limit-concurrency 96 --timeout-keep-alive 5`.

Desplegar:
```bash
# PC personal
cd ~/surprised-system && git pull
cd gateway && npx wrangler deploy
# JE
ssh juanesg@centinela-je 'cd ~/surprised-system && sudo bash servidor/actualizar.sh'
# en JE, subir el límite de concurrencia al servicio ya instalado:
ssh juanesg@centinela-je
sudo sed -i 's#--proxy-headers$#--proxy-headers --limit-concurrency 96 --timeout-keep-alive 5#' /etc/systemd/system/centinela.service
sudo systemctl daemon-reload && sudo systemctl restart centinela
exit
```
(JP ya queda con todo porque instala desde el repo actualizado.)

## Sprint 2 · Cloudflare como muro (5 min, en el panel, gratis)
dash.cloudflare.com → tu Worker/Zona:
1. **Security → WAF → Rate limiting rules → Create**: si la ruta contiene `/api/` → más de **60 req/min por IP** → **Block 1 min**. (1 regla gratis.)
2. Si aparece **Security → Settings → "Under Attack Mode"**, déjalo a la mano para activarlo en la demo si te inundan.
3. **Caching**: la web (HTML/CSS/JS) la cachea Cloudflare sola; los `/api/` no se cachean (tienen datos vivos).

> Cloudflare es gratis y aguanta ataques que a dos PCs viejos los reventarían. Es tu mejor escudo: todo el tráfico entra por ahí, no directo a los PCs.

## Sprint 3 · Endurecer los dos nodos (10 min cada uno)
En JE y en JP:
```bash
# 1. Firewall activo y solo Tailscale
sudo ufw status verbose          # debe decir: deny incoming, allow tailscale0
# 2. fail2ban para SSH (opcional pero suma en el informe)
sudo apt install -y fail2ban && sudo systemctl enable --now fail2ban
# 3. Confirmar que NO hay nada extra escuchando en internet
sudo ss -ltnp                    # solo deben salir 8000 (API) y 22 (ssh)
# 4. El Funnel sigue arriba tras reinicios
tailscale funnel status
```
- Si ves XAMPP, Apache, MySQL u otra cosa escuchando en `0.0.0.0`, apágala: en el servidor no va nada de eso.
- Deja los PCs **por cable** (más estable que Wi-Fi bajo carga).

## Sprint 4 · Prueba de resistencia antes de la clase (haz esto tú, a TUS servidores)
Mide cuánto aguanta y confirma el 429, sin tumbar nada:
```bash
GW=https://centinela.juan-gallego-sec.workers.dev
sudo apt install -y apache2-utils
# 500 peticiones, 20 a la vez, a TU propia web:
ab -n 500 -c 20 $GW/api/numero/3001234567
```
Esperado: muchas respuestas 200 y 429, **cero** fallidas por caída, y la web sigue abriendo. Anota los números para el informe.

## Sprint 5 · Failover en vivo (el momento de la sustentación)
Guion en `docs/08_CHECKLIST_FINAL.md` §B: con el monitor corriendo, desconectas JE y JP toma el control sin que se caiga nada.

## Regla del equipo
Solo probamos resistencia contra **nuestros propios** servidores. No se atacan los de otros grupos: el puntaje y el aprendizaje están en defender bien, demostrarlo con `ab`, los 429 y el failover en vivo, y explicar por qué cada defensa funciona.
