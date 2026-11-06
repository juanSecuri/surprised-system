package co.centinela.llamadas

import android.Manifest
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
    private lateinit var estado: TextView
    private lateinit var cfg: ConfigStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        cfg = ConfigStore(this)
        val url = findViewById<EditText>(R.id.url)
        val token = findViewById<EditText>(R.id.token)
        estado = findViewById(R.id.estado)
        url.setText(cfg.url())
        token.setText(cfg.token())

        findViewById<Button>(R.id.guardar).setOnClickListener {
            val u = url.text.toString().trim()
            val t = token.text.toString().trim()
            if (u.isEmpty() || t.isEmpty()) {
                estado.text = "Escribe la URL y el token antes de guardar."
                Toast.makeText(this, "Falta URL o token", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            cfg.guardar(u, t)
            estado.text = "Guardado. Ahora toca Probar envío."
            Toast.makeText(this, "Guardado", Toast.LENGTH_SHORT).show()
        }
        findViewById<Button>(R.id.permisos).setOnClickListener { pedirPermisos() }
        findViewById<Button>(R.id.probar).setOnClickListener {
            estado.text = "Enviando prueba contra ${url.text.toString().trim()}/api/llamada …"
            Thread {
                val r = CentinelaApi.avisarLlamada(this, "+57 300 123 4567")
                runOnUiThread {
                    estado.text = when {
                        r.esError -> "❌ ${r.notificacion}"
                        else -> "OK · ${r.numero} · ${r.nivel} (${r.score}/100) · ${r.notificacion}"
                    }
                }
            }.start()
        }
        pedirPermisos()
    }

    private fun pedirPermisos() {
        val permisos = mutableListOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) permisos.add(Manifest.permission.POST_NOTIFICATIONS)
        val faltan = permisos.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (faltan.isNotEmpty()) ActivityCompat.requestPermissions(this, faltan.toTypedArray(), 1)
        else estado.text = "Permisos OK. Toca Probar envío para verificar el servidor."
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != 1) return
        val denegados = permissions.filterIndexed { i, _ -> grantResults.getOrNull(i) != PackageManager.PERMISSION_GRANTED }
        estado.text = if (denegados.isEmpty()) "Permisos OK. Toca Probar envío y luego reinicia el celular (Samsung lo necesita)."
            else "Faltan permisos: ${denegados.joinToString(", ")}. Sin READ_CALL_LOG no llega el número entrante (queda oculto). Sin POST_NOTIFICATIONS no ves la alerta."
    }
}
