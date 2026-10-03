// limites: una línea fina encima del prompt con el uso de los límites de la
// suscripción, el de 5 horas y el semanal.
//
// No llama a ningún modelo, no lee ficheros, no lanza procesos ni toca la red.
// Solo pregunta a Claude Code sus propias cifras de uso (gratis) y las dibuja.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Limites } from '../types'

const actuales = atom({ plugin: 'limites', key: 'actuales' } as const, null)

// El botón [Purgar] sale cuando /purgar quitaría al menos esta parte del
// contexto: purgar pierde la caché y la siguiente petición la reescribe entera,
// así que quitar poco cuesta más de lo que ahorra (medido el 3 oct 2026: quitar
// el 19 % tardaba unas 80 peticiones en amortizarse; el 40 %, unas 25).
const PARTE_PURGA = 0.4
// Con la caché ya caducada (más de 1 h sin actividad) purgar sale gratis: la
// siguiente petición la reescribe entera igualmente. Basta con que quite algo
// que se note. Segunda prueba real (3 oct 2026): una sesión de una semana, −42 %
// desde el primer mensaje.
const PARTE_PURGA_GRATIS = 0.1
const CADUCIDAD = 60 * 60_000
// Las reglas de /purgar, repetidas de purgar/hooks/register.ts (son mods
// distintos y no pueden importarse): si cambian allí, cambiarlas aquí.
const PROTEGIDAS = 10
const MINIMO = 1000
const CAMPO_LARGO = 200
// Caracteres por token de las salidas de herramientas (logs, código). Medido en
// dos purgas reales el 3 oct 2026: ~1,6 y ~1,9. Se redondea al alza, a 2, para
// que el botón salga de menos más que de más.
const CARACTERES_POR_TOKEN = 2
// Si el mod purgar está instalado (su /purgar existe). Sin él no hay botón.
let hayPurgar = false

// Por sesión: cuándo tuvo actividad por última vez y con cuánto contexto, en el
// almacén. Al retomar una sesión es lo único que dice su contexto (Claude Code
// no lo sabe hasta la primera respuesta) y si su caché ya caducó, que es justo
// cuando purgar sale gratis: antes de ese primer mensaje. ⚠️ purgar lleva su
// propio registro igual, en su almacén.
type Registro = Record<string, { t: number; tokens: number }>
const SESIONES_GUARDADAS = 30
// La última actividad de esta sesión, para el reloj.
let ultimaActividad: number | undefined

// El id de la sesión, o undefined si no se puede saber (sin registro, entonces).
function idSesion($: EngineInterface) {
  return $.session.id().catch(() => undefined)
}

async function apuntarSesion($: EngineInterface, ahora: number, tokens: number) {
  const id = await idSesion($)
  if (!id || !tokens) return
  const registro = ((await $.store.get('sesiones')) as Registro | undefined) ?? {}
  const recientes = Object.entries({ ...registro, [id]: { t: ahora, tokens } })
    .sort(([, a], [, b]) => b.t - a.t)
    .slice(0, SESIONES_GUARDADAS)
  await $.store.set('sesiones', Object.fromEntries(recientes))
}

// La hora a la que se reinicia la ventana, en la hora local del equipo: "16:14".
// null si no hay fecha. (El entorno del mod tiene la zona horaria del sistema:
// comprobado el 3 oct 2026, sale Europe/Madrid.)
function horaDeReinicio(reinicio: string | null) {
  if (!reinicio) return null
  const d = new Date(reinicio)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

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
// `actividad`: si esta medida es de una respuesta nueva (al abrir la sesión no lo
// es: entonces no dice nada de si la caché sigue viva).
async function medir($: EngineInterface, actividad = true) {
  const { rateLimits, context } = await $.session.usage()
  const ultima: Ultima = {
    cincoHoras: lectura(rateLimits, 'five_hour'),
    semana: lectura(rateLimits, 'seven_day'),
  }
  if (ultima.cincoHoras === null && ultima.semana === null) return false

  await $.store.set('ultima', ultima)
  if (actividad) {
    ultimaActividad = await $.clock.now()
    await apuntarSesion($, ultimaActividad, context.tokens ?? 0)
  }
  const nuevos: Limites = {
    cincoHoras: ultima.cincoHoras?.pct ?? null,
    semana: ultima.semana?.pct ?? null,
    deMemoria: false,
    reinicio5h: ultima.cincoHoras?.reinicio ?? null,
    contexto: context.percent ?? null,
    tokens: context.tokens ?? 0,
    purgable: 0,
    frio: false,
  }
  // Lo purgable se calcula aparte y solo al acabar cada turno: aquí se conserva.
  // Una respuesta nueva deja la caché viva; si no lo es, sigue como estaba.
  await update($, actuales, l => ({
    ...nuevos,
    purgable: l?.purgable ?? 0,
    frio: actividad ? false : (l?.frio ?? false),
  }))

  if (nuevos.cincoHoras !== null && nuevos.cincoHoras >= 90 && !avisado) {
    avisado = true
    const hora = horaDeReinicio(nuevos.reinicio5h)
    $.ui.toast(`Llevas el ${nuevos.cincoHoras}% del límite de 5 horas` + (hora ? `; se reinicia a las ${hora}` : ''))
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
  const reinicio = ultima.cincoHoras?.reinicio
  await update($, actuales, () => ({
    cincoHoras: vigente(ultima.cincoHoras, ahora),
    semana: vigente(ultima.semana, ahora),
    deMemoria: true,
    // Si ya pasó, la ventana nueva aún no tiene hora: vuelve la etiqueta "5 h".
    reinicio5h: reinicio && Date.parse(reinicio) > ahora ? reinicio : null,
    // El contexto es de esta sesión: hasta la primera respuesta no se sabe.
    contexto: null,
    tokens: 0,
    purgable: 0,
    frio: false,
  }))
}

// Al abrir una sesión: lo que el registro sabe de ella. El contexto, si Claude
// Code aún no lo da, y si la caché ya caducó.
async function cargarSesion($: EngineInterface) {
  const id = await idSesion($)
  if (!id) return
  const r = (((await $.store.get('sesiones')) as Registro | undefined) ?? {})[id]
  if (!r) return
  ultimaActividad = r.t
  const frio = (await $.clock.now()) - r.t > CADUCIDAD
  const { context } = await $.session.usage()
  await update($, actuales, l =>
    l
      ? {
          ...l,
          frio,
          tokens: l.tokens || r.tokens,
          contexto: l.contexto ?? Math.round((r.tokens / context.window) * 100),
        }
      : l,
  )
}

// Cuánto quitaría /purgar, en tokens: las salidas largas y los textos largos de
// las llamadas largas (código de un Write, scripts de Bash), menos las últimas.
async function calcularPurgable($: EngineInterface) {
  if (!hayPurgar) return
  const mensajes = await $.session.messages()
  const salidas = mensajes
    .flatMap(m => m.toolResults ?? [])
    .slice(0, -PROTEGIDAS)
    .filter(r => r.text.length >= MINIMO)
    .reduce((n, r) => n + r.text.length, 0)
  const llamadas = mensajes
    .flatMap(m => m.toolUses)
    .slice(0, -PROTEGIDAS)
    .filter(u => JSON.stringify(u.input).length >= MINIMO)
    .flatMap(u => Object.values(u.input))
    .filter((v): v is string => typeof v === 'string' && v.length > CAMPO_LARGO)
    .reduce((n, v) => n + v.length, 0)
  const caracteres = salidas + llamadas
  const purgable = Math.round(caracteres / CARACTERES_POR_TOKEN)
  await update($, actuales, l => (l ? { ...l, purgable } : l))
}

// Cada minuto: si la ventana de 5 h acaba de reiniciarse, la pone a 0 sin esperar
// a la siguiente respuesta (que traerá la hora nueva); y si pasó 1 h sin
// actividad, marca la caché como caducada.
let pararReloj: (() => void) | undefined
function arrancarReloj($: EngineInterface) {
  pararReloj?.()
  pararReloj = $.clock.every(60_000, async () => {
    const ahora = await $.clock.now()
    const frio = ultimaActividad !== undefined && ahora - ultimaActividad > CADUCIDAD
    await update($, actuales, l => {
      if (!l) return l
      const reiniciado = l.reinicio5h && Date.parse(l.reinicio5h) <= ahora
      if (!reiniciado && l.frio === frio) return l
      return { ...l, frio, ...(reiniciado ? { cincoHoras: 0, reinicio5h: null } : {}) }
    })
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const resultado = await next(e)
    // Si no se puede saber, sin botón: la barra sigue igual.
    hayPurgar = await $.command.list().then(
      l => l.some(c => c.name === 'purgar'),
      () => false,
    )
    if (!(await medir($, false))) await recordar($)
    await cargarSesion($)
    await calcularPurgable($)
    arrancarReloj($)
    return resultado
  })

  // Las cifras llegan con cada respuesta de la API: se miden al acabar cada turno
  // (también los de subagentes: gastan del mismo límite), y durante el turno tras
  // cada herramienta (abajo).
  on('turn.complete', async ($, e, next) => {
    const resultado = await next(e)
    // Una respuesta sin cifras es que no hay límites (por API): fuera la línea,
    // también lo que se había recordado.
    if (!(await medir($))) await update($, actuales, () => null)
    else await calcularPurgable($)
    return resultado
  })

  // Durante un turno largo también: tras cada herramienta ya hay una respuesta
  // nueva con cifras. Sin esperar, para no retrasar la herramienta.
  on('tool.call', async ($, e, next) => {
    const resultado = await next(e)
    void medir($).catch(() => {})
    return resultado
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Lo que dibujen los mods de debajo (el sugeridor de prompts, por ejemplo) va
    // debajo de la barra: si se devolviera solo la barra, no se verían nunca.
    const debajo = await next(e)
    const l = await read($, actuales)
    // Sin límites (por API, o antes de la primera respuesta) no se dibuja nada.
    if (e.props.hasSurvey || l === null || (l.cincoHoras === null && l.semana === null)) return debajo

    const { Box, Text, Button } = $.ui.resolve(e)
    // Solo el escritorio sabe dibujar SVG; la terminal usa la barra de texto.
    const Svg = e.surface === 'desktop' ? $.ui.resolve(e).Svg : undefined

    // A la derecha, el % de contexto y, cuando compensa, el botón de purgar. No
    // mientras trabaja: la compactación no se puede lanzar a mitad de un turno.
    const contexto = l.contexto === null ? null : `contexto ${l.contexto}%`
    const parte = l.frio ? PARTE_PURGA_GRATIS : PARTE_PURGA
    const conBoton = hayPurgar && l.tokens > 0 && l.purgable >= parte * l.tokens && !e.props.isWorking
    const etiquetaBoton = l.frio ? 'Purgar gratis' : 'Purgar'
    const purgar = () => {
      $.command.run({ command: 'purgar' }).catch((err: unknown) => {
        $.ui.toast(`No se pudo purgar: ${err instanceof Error ? err.message : String(err)}`)
      })
    }
    // Lo que ocupa en la terminal: la etiqueta, y "[ Purgar ]" con su hueco.
    const anchoDerecha = (contexto?.length ?? 0) + (conBoton ? etiquetaBoton.length + 5 : 0)

    // Una línea con los dos límites, cada uno en su mitad: "5 h 28%" y la barra
    // estirada hasta el final de su mitad. Siempre una sola línea de alto.
    // El de 5 h se nombra por la hora a la que se reinicia ("hasta 16:14 28%");
    // "5 h" solo mientras no se sabe.
    const hora = horaDeReinicio(l.reinicio5h)
    const medidores = [
      { nombre: hora ? `hasta ${hora}` : '5 h', pct: l.cincoHoras },
      { nombre: 'semana', pct: l.semana },
    ].filter((m): m is { nombre: string; pct: number } => m.pct !== null)
    const SEPARACION = 4
    const huecos = medidores.length - 1 + (anchoDerecha > 0 ? 1 : 0)
    const mitad = Math.floor((e.props.bodyColumns - anchoDerecha - SEPARACION * huecos) / medidores.length)

    return (
      <Box flexDirection="column">
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
          {anchoDerecha > 0 ? (
            <Box flexShrink={0} alignItems="center" columnGap={1}>
              {contexto ? (
                <Text wrap="truncate" dimColor>
                  {contexto}
                </Text>
              ) : null}
              {conBoton ? (
                <Button key="purgar" dimColor={!l.frio} onPress={purgar}>
                  {etiquetaBoton}
                </Button>
              ) : null}
            </Box>
          ) : null}
        </Box>
        {debajo}
      </Box>
    )
  })
}
