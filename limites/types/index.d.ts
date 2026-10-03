// Lo que el mod guarda entre dibujo y dibujo: el % usado de cada límite de la
// cuenta. null cuando Claude Code no lo da (por API no hay límites).
export type Limites = {
  cincoHoras: number | null
  semana: number | null
}

declare module 'claude-code' {
  interface PluginState {
    limites: { actuales: Limites | null }
  }
}
