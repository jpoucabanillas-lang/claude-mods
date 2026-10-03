// limites: una línea fina encima del prompt con el uso de los límites de la
// suscripción, el de 5 horas y el semanal.
//
// No llama a ningún modelo, no lee ficheros, no lanza procesos ni toca la red.
// Solo pregunta a Claude Code sus propias cifras de uso (gratis) y las dibuja.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limites } from '../types'

const actuales = atom({ plugin: 'limites', key: 'actuales' } as const, null)

// Azul normalmente, ámbar desde el 75 % y rojo desde el 90 %.
function colorBarra(pct: number) {
  if (pct >= 90) return '#e05252'
  if (pct >= 75) return '#e0a030'
  return '#4a86e8'
}

function acotar(pct: number) {
  return Math.min(100, Math.max(0, pct))
}

// Escritorio: una barra fina y redondeada, dibujada en SVG, que se estira a lo
// ancho de su hueco: el dibujo es muy ancho y se encoge al sitio que haya, con la
// altura fija. Los anchos van en %, así que la proporción se mantiene. El fondo es
// el mismo color, transparente, para que se vea bien en tema claro y oscuro.
const ALTO = 4
function barraSvg(pct: number) {
  const color = colorBarra(pct)
  const lleno = acotar(pct)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="${ALTO}" preserveAspectRatio="none">` +
    `<rect width="100%" height="${ALTO}" rx="${ALTO / 2}" fill="${color}" fill-opacity="0.22"/>` +
    (lleno > 0 ? `<rect width="${lleno}%" height="${ALTO}" rx="${ALTO / 2}" fill="${color}"/>` : '') +
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

const CASILLAS_PIE = 13

// Barra de la línea de estado: línea fina, llena ━ y vacía ─. Probado en la app y
// descartado: ▰▱ y ▬ (más altas), emojis y códigos ANSI (para color).
// 28 % de 13 = 3,6 → 4 llenas: "━━━━─────────".
function barraPie(pct: number) {
  const llenas = Math.round((acotar(pct) / 100) * CASILLAS_PIE)
  return '━'.repeat(llenas) + '─'.repeat(CASILLAS_PIE - llenas)
}

// Un solo aviso por sesión cuando el límite de 5 h se acerca al final.
let avisado = false

// Pide las cifras a Claude Code y las guarda; guardar redibuja la línea.
async function medir($: EngineInterface) {
  const { rateLimits } = await $.session.usage()
  const nuevos: Limites = {
    cincoHoras: rateLimits.find(r => r.kind === 'five_hour')?.percentUsed ?? null,
    semana: rateLimits.find(r => r.kind === 'seven_day')?.percentUsed ?? null,
  }
  await update($, actuales, () => nuevos)

  // Los límites en la línea de estado del pie, en el centro: es el hueco más ancho
  // (el de la derecha corta con «…» y la línea de pistas no sale en escritorio).
  // Solo admite texto plano, así que sin color (probado: emojis descartados, y los
  // códigos ANSI no se quisieron). Ancho probado en la app: 13 casillas caben, 16
  // cortan la semanal.
  const partes = [
    ['5 h', nuevos.cincoHoras],
    ['semana', nuevos.semana],
  ].flatMap(([nombre, pct]) => {
    if (pct === null) return []
    return [`${nombre} ${pct}% ${barraPie(pct as number)}`]
  })
  $.ui.status(partes.length ? partes.join('  ·  ') : undefined)

  if (nuevos.cincoHoras !== null && nuevos.cincoHoras >= 90 && !avisado) {
    avisado = true
    $.ui.toast(`Llevas el ${nuevos.cincoHoras}% del límite de 5 horas`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const resultado = await next(e)
    await medir($)
    return resultado
  })

  // Las cifras llegan con cada respuesta de la API, así que se miden al acabar
  // cada paso (también los de subagentes: gastan del mismo límite).
  on('turn.complete', async ($, e, next) => {
    const resultado = await next(e)
    await medir($)
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
                  <Text dimColor>{nombre}</Text> {pct}%
                </Text>
              </Box>
              {Svg ? (
                <Box flexGrow={1} flexShrink={1}>
                  <Svg source={barraSvg(pct)} alt={`${nombre}: ${pct}% usado`} height={ALTO} />
                </Box>
              ) : (
                <Text>
                  <Text color={colorBarra(pct)}>{lleno}</Text>
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
