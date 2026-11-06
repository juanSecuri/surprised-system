package co.centinela.llamadas

/**
 * Capa de dominio: veredicto de riesgo que devuelve el servidor.
 * nivel = "alto" | "medio" | "bajo" | "error" (error = motivo en [notificacion]).
 */
data class Veredicto(
    val ok: Boolean, val nivel: String, val score: Int, val numero: String, val notificacion: String
) {
    companion object {
        fun error(motivo: String) = Veredicto(false, "error", 0, "", motivo)
    }
    val esError: Boolean get() = nivel == "error"
}
