package co.centinela.llamadas

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Capa de datos: cliente HTTP contra el gateway (POST /api/llamada).
 * Llamar SIEMPRE desde un hilo en segundo plano. Nunca lanza: devuelve Veredicto.error con detalle.
 */
object CentinelaApi {
    private const val TAG = "CentinelaApi"

    @JvmStatic
    fun avisarLlamada(ctx: Context, numero: String): Veredicto {
        val cfg = ConfigStore(ctx)
        val url = cfg.url()
        val tok = cfg.token()
        if (url.isEmpty()) return Veredicto.error("Falta la URL del gateway (guardala arriba).")
        if (tok.isEmpty()) return Veredicto.error("Falta el token de llamadas (guardalo arriba).")
        var c: HttpURLConnection? = null
        return try {
            val conn = (URL("$url/api/llamada").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 8000; readTimeout = 12000; doOutput = true
                setRequestProperty("content-type", "application/json")
                setRequestProperty("x-centinela-token", tok)
            }
            c = conn
            val cuerpo = JSONObject().put("numero", numero).put("dispositivo", "android").toString()
            conn.outputStream.use { it.write(cuerpo.toByteArray(Charsets.UTF_8)) }
            val codigo = conn.responseCode
            val ins = if (codigo in 200..299) conn.inputStream else conn.errorStream
            val cuerpoR = if (ins != null) ins.bufferedReader().readText() else ""
            if (codigo !in 200..299) {
                val detalle = try { JSONObject(cuerpoR).optString("error", cuerpoR).take(140) } catch (e2: Exception) { cuerpoR.take(140) }
                val hint = when (codigo) {
                    401 -> "Token invalido: el LLAMADAS_TOKEN del celular no coincide con el del servidor."
                    429 -> "Demasiadas peticiones: espera 60 s."
                    503, 530 -> "Servidores JE/JP offline: enciendelos, revisa Tailscale Funnel y /health."
                    else -> "Revisa URL, token y que JE/JP esten online."
                }
                Log.w(TAG, "HTTP $codigo: $cuerpoR")
                Veredicto.error("HTTP $codigo - $detalle - $hint")
            } else {
                val j = JSONObject(cuerpoR)
                Veredicto(j.optBoolean("ok", true), j.optString("nivel", "bajo"), j.optInt("score", 0), j.optString("numero", numero), j.optString("notificacion", ""))
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error de red contra $url/api/llamada", e)
            Veredicto.error("Sin conexion contra $url - ${e.message?.take(100)} - Revisa internet, URL y que JE/JP esten online.")
        } finally { try { c?.disconnect() } catch (ignored: Exception) {} }
    }
}
