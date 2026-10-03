// Lo que el mod guarda entre dibujo y dibujo: el % usado de cada límite de la
// cuenta. null cuando Claude Code no lo da (por API no hay límites). deMemoria:
// las cifras son las guardadas de una sesión anterior, aún sin respuesta nueva.
// reinicio5h: cuándo se reinicia la ventana de 5 h (ISO 8601), null si no se sabe.
// contexto: el % de la ventana de contexto en uso, null si no se sabe.
// tokens: el contexto en uso, en tokens (0 si no se sabe).
// purgable: lo que quitaría /purgar, estimado en tokens con sus mismas reglas.
// frio: la caché de la sesión ya ha caducado (más de 1 h sin actividad), así que
// purgar ahora no pierde nada.
export type Limites = {
  cincoHoras: number | null
  semana: number | null
  deMemoria: boolean
  reinicio5h: string | null
  contexto: number | null
  tokens: number
  purgable: number
  frio: boolean
}

declare module 'claude-code' {
  interface PluginState {
    limites: { actuales: Limites | null }
  }
}
