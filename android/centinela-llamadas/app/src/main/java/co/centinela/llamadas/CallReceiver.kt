package co.centinela.llamadas

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telephony.TelephonyManager
import android.util.Log

/** Se dispara con cada cambio de estado del teléfono. Al sonar, avisa a Centinela. */
class CallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return
        if (intent.getStringExtra(TelephonyManager.EXTRA_STATE) != TelephonyManager.EXTRA_STATE_RINGING) return
        val numero = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER) ?: ""
        Log.d("CentinelaCall", "RINGING numero=$numero")
        val pending = goAsync()
        Thread {
            try {
                val r = CentinelaApi.avisarLlamada(context, numero)
                if (r.esError) {
                    Log.w("CentinelaCall", "Error: ${r.notificacion}")
                    Notificador.error(context, r.notificacion)
                } else Notificador.veredicto(context, r)
            } finally { pending.finish() }
        }.start()
    }
}
