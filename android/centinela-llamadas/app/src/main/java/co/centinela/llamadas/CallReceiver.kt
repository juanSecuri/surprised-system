package co.centinela.llamadas

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.telephony.TelephonyManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/** Se dispara con cada cambio de estado del teléfono. Al sonar, avisa a Centinela. */
class CallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
        if (intent.getStringExtra(TelephonyManager.EXTRA_STATE) != TelephonyManager.EXTRA_STATE_RINGING) return
        val numero = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER) ?: ""
        val pending = goAsync()
        Thread {
            try {
                Red.avisarLlamada(context, numero)?.let { notificar(context, it) }
            } finally { pending.finish() }
        }.start()
    }

    private fun notificar(ctx: Context, r: Red.Resultado) {
        val canal = "centinela_llamadas"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(
                NotificationChannel(canal, "Llamadas entrantes", NotificationManager.IMPORTANCE_HIGH))
        }
        val titulo = when (r.nivel) {
            "alto" -> "⚠️ Posible SPAM"
            "medio" -> "🟠 Llamada dudosa"
            else -> "🟢 Sin reportes"
        }
        val texto = (if (r.numero.isNotEmpty()) r.numero + " · " else "") + r.notificacion
        val n = NotificationCompat.Builder(ctx, canal)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(titulo)
            .setContentText(texto)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .build()
        try { NotificationManagerCompat.from(ctx).notify(1, n) } catch (e: SecurityException) { /* sin permiso de notificar */ }
    }
}
