package co.centinela.llamadas

import android.content.Context

/**
 * Capa de datos: persistencia de la URL del gateway y el token de llamadas.
 * Se lee/graba siempre desde la UI; la red nunca toca SharedPreferences directo.
 */
class ConfigStore(ctx: Context) {
    private val prefs = ctx.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun url(): String = (prefs.getString(KEY_URL, DEFAULT_URL) ?: DEFAULT_URL).trimEnd('/')
    fun token(): String = prefs.getString(KEY_TOKEN, "") ?: ""

    fun guardar(url: String, token: String) {
        prefs.edit().putString(KEY_URL, url.trim()).putString(KEY_TOKEN, token.trim()).apply()
    }

    companion object {
        const val PREFS = "centinela"
        const val KEY_URL = "url"
        const val KEY_TOKEN = "token"
        const val DEFAULT_URL = "https://centinela.juan-gallego-sec.workers.dev"
    }
}
