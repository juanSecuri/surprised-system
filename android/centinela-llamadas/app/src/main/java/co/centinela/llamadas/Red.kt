package co.centinela.llamadas

/**
 * Compatibilidad: la capa de red antigua se llamaba Red.
 * La implementación real vive en [CentinelaApi]; este objeto solo re-exporta.
 */
object Red {
    const val PREFS = ConfigStore.PREFS
    fun base(ctx: android.content.Context) = ConfigStore(ctx).url()
    fun token(ctx: android.content.Context) = ConfigStore(ctx).token()
    fun avisarLlamada(ctx: android.content.Context, numero: String) = CentinelaApi.avisarLlamada(ctx, numero)
}
