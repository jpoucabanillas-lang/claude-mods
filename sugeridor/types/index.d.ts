// La sugerencia que se ve encima de la caja de texto, o null si no hay.
// borrador: lo que habías escrito, para poder volver a ello tras «Usar».
export type Sugerencia = {
  nombre: string
  plantilla: string
  borrador: string
  isAplicada: boolean
}

declare module 'claude-code' {
  interface PluginState {
    sugeridor: { actual: Sugerencia | null }
  }
}
