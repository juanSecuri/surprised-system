package co.centinela.llamadas

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Habla con el gateway de Centinela. Llamar SIEMPRE desde un hilo (no en el principal). */
object Red {
    const val PREFS = "centinela"
    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun base(ctx: Context) = (prefs(ctx).getString("url", "") ?: "").trimEnd('/')
    fun token(ctx: Context) = prefs(ctx).getString("token", "") ?: ""

    data class Resultado(val ok: Boolean, val nivel: String, val score: Int,
                         val numero: String, val notificacion: String)

    fun avisarLlamada(ctx: Context, numero: String): Resultado? {
        val url = base(ctx); val tok = token(ctx)
        if (url.isEmpty() || tok.isEmpty()) return null
        return try {
            val c = (URL("$url/api/llamada").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 8000; readTimeout = 12000; doOutput = true
                setRequestProperty("content-type", "application/json")
                setRequestProperty("x-centinela-token", tok)
            }
            val cuerpo = JSONObject().put("numero", numero).put("dispositivo", "android").toString()
            c.outputStream.use { it.write(cuerpo.toByteArray(Charsets.UTF_8)) }
            if (c.responseCode !in 200..299) return null
            val j = JSONObject(c.inputStream.bufferedReader().readText())
            Resultado(
                ok = j.optBoolean("ok", true),
                nivel = j.optString("nivel", "bajo"),
                score = j.optInt("score", 0),
                numero = j.optString("numero", numero),
                notificacion = j.optString("notificacion", "")
            )
        } catch (e: Exception) { null }
    }
}
