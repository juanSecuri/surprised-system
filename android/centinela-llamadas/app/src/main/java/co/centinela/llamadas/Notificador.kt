package co.centinela.llamadas

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Capa de presentación: construye las notificaciones de alta prioridad.
 * Extraído de CallReceiver para que el receptor solo orqueste.
 */
object Notificador {
    private const val TAG = "CentinelaNoti"
    private const val CANAL = "centinela_llamadas"

    private fun canal(ctx: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(NotificationChannel(CANAL, "Llamadas entrantes", NotificationManager.IMPORTANCE_HIGH))
        }
    }

    private fun construir(ctx: Context, titulo: String, texto: String) =
        NotificationCompat.Builder(ctx, CANAL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(titulo)
            .setContentText(texto)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .build()

    fun veredicto(ctx: Context, r: Veredicto) {
        canal(ctx)
        val titulo = when (r.nivel) {
            "alto" -> "⚠️ Posible SPAM"
            "medio" -> "🟠 Llamada dudosa"
            else -> "🟢 Sin reportes"
        }
        val texto = (if (r.numero.isNotEmpty()) r.numero + " · " else "") + r.notificacion
        try { NotificationManagerCompat.from(ctx).notify(1, construir(ctx, titulo, texto)) }
        catch (e: SecurityException) { Log.w(TAG, "Sin permiso de notificar", e) }
    }

    fun error(ctx: Context, motivo: String) {
        canal(ctx)
        try { NotificationManagerCompat.from(ctx).notify(2, construir(ctx, "⚠️ Centinela sin servidor", motivo)) }
        catch (e: SecurityException) { Log.w(TAG, "Sin permiso de notificar (error)", e) }
    }
}
