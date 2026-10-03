// limites: una línea fina encima del prompt con el uso de los límites de la
// suscripción, el de 5 horas y el semanal.
//
// No llama a ningún modelo, no lee ficheros, no lanza procesos ni toca la red.
// Solo pregunta a Claude Code sus propias cifras de uso (gratis) y las dibuja.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Limites } from '../types'

const actuales = atom({ plugin: 'limites', key: 'actuales' } as const, null)

// Los colores de la gráfica de uso de claude.ai (Ajustes → Uso), sacados de la
// página el 3 oct 2026: el relleno es --cds-role-<tono>-fill, el mismo en los dos
// temas, y la pista --cds-role-<tono>-100 en tema claro y -800 en el oscuro.
// Azul (accent) normalmente, ámbar (warning) desde el 75 % y rojo (danger) desde
// el 90 %, como se ha visto en claude.ai al acercarse al límite.
const TONOS = {
  azul: { relleno: '#2a78d6', pistaClara: '#cde2fb', pistaOscura: '#032042' },
  ambar: { relleno: '#fab219', pistaClara: '#f9dca4', pistaOscura: '#311a00' },
  rojo: { relleno: '#d03b3b', pistaClara: '#fad6d6', pistaOscura: '#3c0e0e' },
}

function tono(pct: number) {
  if (pct >= 90) return TONOS.rojo
  if (pct >= 75) return TONOS.ambar
  return TONOS.azul
}

function acotar(pct: number) {
  return Math.min(100, Math.max(0, pct))
}

// Escritorio: una barra fina y redondeada, dibujada en SVG, que se estira a lo
// ancho de su hueco: el dibujo es muy ancho y se encoge al sitio que haya, con la
// altura fija (4 px y extremos redondos, como en claude.ai). Los anchos van en %,
// así que la proporción se mantiene. La pista cambia con el tema por la consulta
// de medios dentro del propio SVG.
const ALTO = 4
function barraSvg(pct: number) {
  const { relleno, pistaClara, pistaOscura } = tono(pct)
  const lleno = acotar(pct)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="${ALTO}" preserveAspectRatio="none">` +
    `<style>.pista{fill:${pistaClara}}@media (prefers-color-scheme:dark){.pista{fill:${pistaOscura}}}</style>` +
    `<rect class="pista" width="100%" height="${ALTO}" rx="${ALTO / 2}"/>` +
    (lleno > 0 ? `<rect width="${lleno}%" height="${ALTO}" rx="${ALTO / 2}" fill="${relleno}"/>` : '') +
    `</svg>`
  )
}

// Terminal: no se puede dibujar tan fino, así que una línea de texto delgada
// de tantas casillas como quepan. 28 % de 50 → 14 "━" y 36 "─".
function barraTexto(pct: number, casillas: number) {
  const total = Math.max(4, casillas)
  const llenas = Math.round((acotar(pct) / 100) * total)
  return { lleno: '━'.repeat(llenas), vacio: '─'.repeat(total - llenas) }
}

// Un solo aviso por sesión cuando el límite de 5 h se acerca al final.
let avisado = false

// Lo último medido, guardado entre sesiones en el almacén del mod. Claude Code no
// tiene cifras de límites hasta la primera respuesta de la sesión, así que sin
// esto la línea no salía hasta enviar el primer mensaje.
type Lectura = { pct: number; reinicio?: string }
type Ultima = { cincoHoras: Lectura | null; semana: Lectura | null }

function lectura(rateLimits: SessionRateLimit[], kind: string): Lectura | null {
  const r = rateLimits.find(r => r.kind === kind)
  return r ? { pct: r.percentUsed, reinicio: r.resetsAt } : null
}

// Si la ventana ya se reinició desde que se guardó, está a 0 diga lo que diga.
function vigente(l: Lectura | null, ahora: number) {
  if (l === null) return null
  if (l.reinicio && Date.parse(l.reinicio) <= ahora) return 0
  return l.pct
}

// Pide las cifras a Claude Code, las guarda y las pone en la línea (guardar
// redibuja). Devuelve false si no había ninguna: antes de la primera respuesta,
// o por API, donde no hay límites.
async function medir($: EngineInterface) {
  const { rateLimits } = await $.session.usage()
  const ultima: Ultima = {
    cincoHoras: lectura(rateLimits, 'five_hour'),
    semana: lectura(rateLimits, 'seven_day'),
  }
  if (ultima.cincoHoras === null && ultima.semana === null) return false

  await $.store.set('ultima', ultima)
  const nuevos: Limites = {
    cincoHoras: ultima.cincoHoras?.pct ?? null,
    semana: ultima.semana?.pct ?? null,
    deMemoria: false,
  }
  await update($, actuales, () => nuevos)

  if (nuevos.cincoHoras !== null && nuevos.cincoHoras >= 90 && !avisado) {
    avisado = true
    $.ui.toast(`Llevas el ${nuevos.cincoHoras}% del límite de 5 horas`)
  }
  return true
}

// Al abrir una sesión, mientras no hay cifras nuevas: lo último que se guardó.
// Puede quedarse corto si desde entonces se gastó en otro sitio (otro equipo,
// claude.ai), por eso se dibuja atenuado hasta la primera respuesta.
async function recordar($: EngineInterface) {
  const ultima = (await $.store.get('ultima')) as Ultima | undefined
  if (!ultima) return
  const ahora = await $.clock.now()
  await update($, actuales, () => ({
    cincoHoras: vigente(ultima.cincoHoras, ahora),
    semana: vigente(ultima.semana, ahora),
    deMemoria: true,
  }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const resultado = await next(e)
    if (!(await medir($))) await recordar($)
    return resultado
  })

  // Las cifras llegan con cada respuesta de la API, así que se miden al acabar
  // cada paso (también los de subagentes: gastan del mismo límite).
  on('turn.complete', async ($, e, next) => {
    const resultado = await next(e)
    // Una respuesta sin cifras es que no hay límites (por API): fuera la línea,
    // también lo que se había recordado.
    if (!(await medir($))) await update($, actuales, () => null)
    return resultado
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const l = await read($, actuales)
    // Sin límites (por API, o antes de la primera respuesta) no se dibuja nada.
    if (e.props.hasSurvey || l === null || (l.cincoHoras === null && l.semana === null)) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    // Solo el escritorio sabe dibujar SVG; la terminal usa la barra de texto.
    const Svg = e.surface === 'desktop' ? $.ui.resolve(e).Svg : undefined

    // Una línea con los dos límites, cada uno en su mitad: "5 h 28%" y la barra
    // estirada hasta el final de su mitad. Siempre una sola línea de alto.
    const medidores = [
      { nombre: '5 h', pct: l.cincoHoras },
      { nombre: 'semana', pct: l.semana },
    ].filter((m): m is { nombre: string; pct: number } => m.pct !== null)
    const SEPARACION = 4
    const mitad = Math.floor((e.props.bodyColumns - SEPARACION * (medidores.length - 1)) / medidores.length)

    return (
      <Box alignItems="center" flexWrap="nowrap" overflow="hidden" columnGap={SEPARACION}>
        {medidores.map(({ nombre, pct }) => {
          const etiqueta = `${nombre} ${pct}%`
          const { lleno, vacio } = barraTexto(pct, mitad - etiqueta.length - 1)
          return (
            <Box key={nombre} flexGrow={1} alignItems="center" columnGap={1}>
              {/* La etiqueta no encoge nunca: si encogiera, partiría en dos líneas
                  y la banda doblaría su altura (pasó en la app de escritorio). */}
              <Box flexShrink={0}>
                <Text wrap="truncate">
                  <Text dimColor>{nombre}</Text> <Text dimColor={l.deMemoria}>{pct}%</Text>
                </Text>
              </Box>
              {Svg ? (
                <Box flexGrow={1} flexShrink={1}>
                  <Svg source={barraSvg(pct)} alt={`${nombre}: ${pct}% usado`} height={ALTO} />
                </Box>
              ) : (
                <Text>
                  <Text color={tono(pct).relleno}>{lleno}</Text>
                  <Text dimColor>{vacio}</Text>
                </Text>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
