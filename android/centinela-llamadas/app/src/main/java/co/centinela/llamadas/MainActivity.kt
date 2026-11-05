package co.centinela.llamadas

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        val prefs = getSharedPreferences(Red.PREFS, Context.MODE_PRIVATE)
        val url = findViewById<EditText>(R.id.url)
        val token = findViewById<EditText>(R.id.token)
        val estado = findViewById<TextView>(R.id.estado)
        url.setText(prefs.getString("url", "https://centinela.juan-gallego-sec.workers.dev"))
        token.setText(prefs.getString("token", ""))

        findViewById<Button>(R.id.guardar).setOnClickListener {
            prefs.edit()
                .putString("url", url.text.toString().trim())
                .putString("token", token.text.toString().trim())
                .apply()
            Toast.makeText(this, "Guardado", Toast.LENGTH_SHORT).show()
        }
        findViewById<Button>(R.id.permisos).setOnClickListener { pedirPermisos() }
        findViewById<Button>(R.id.probar).setOnClickListener {
            estado.text = "Enviando prueba…"
            Thread {
                val r = Red.avisarLlamada(this, "+57 300 123 4567")
                runOnUiThread {
                    estado.text = if (r != null) "OK · ${r.numero} · ${r.nivel} (${r.score}/100)"
                                  else "No se pudo. Revisa URL, token y permisos."
                }
            }.start()
        }
        pedirPermisos()
    }

    private fun pedirPermisos() {
        val permisos = mutableListOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            permisos.add(Manifest.permission.POST_NOTIFICATIONS)
        val faltan = permisos.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (faltan.isNotEmpty()) ActivityCompat.requestPermissions(this, faltan.toTypedArray(), 1)
    }
}
