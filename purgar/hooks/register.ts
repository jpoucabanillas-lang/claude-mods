// purgar: aligera el contexto de la sesión sin resumirlo.
//
// /purgar      cambia las salidas largas de herramientas por una línea que dice
//              qué eran, menos las 10 últimas; la conversación se queda.
// /purgar N    deja solo los últimos N intercambios.
//
// Va por la compactación de Claude Code (/compact), pero en lugar del resumen,
// que es una llamada al modelo, este mod devuelve la conversación recortada: no
// gasta límite y es instantáneo. Cualquier otro /compact pasa intacto.
//
// No llama a ningún modelo, no lee ficheros, no lanza procesos ni toca la red.

import type { Register, SessionMessage, ToolResultSummary, ToolUseSummary } from 'claude-code'

// La marca con la que /purgar lanza /compact, para reconocer lo suyo.
const MARCA = 'purgar'

// Las últimas salidas no se tocan: suelen ser con lo que se está trabajando. Se
// cuentan salidas y no intercambios porque un solo intercambio puede llevar
// decenas de comandos (el 3 oct 2026, proteger los 3 últimos dejó sin purgar lo
// más pesado de la sesión).
// ⚠️ limites (botón [Purgar]) repite estas dos reglas para calcular cuánto se
// quitaría: si cambian aquí, cambiarlas allí.
const PROTEGIDAS = 10
// Una salida más corta que esto cuesta menos que la línea que la sustituiría.
const MINIMO = 1000
// Caracteres por token, para estimar lo quitado cuando no se sabe el contexto de
// antes. Medido en dos purgas reales el 3 oct 2026: ~1,6 y ~1,9. Repetido en
// limites, como las dos reglas de arriba.
const CARACTERES_POR_TOKEN = 2
// Lo que dura la caché sin usarse, a lo sumo. Pasado esto hay que reescribirla
// entera igualmente, así que purgar no pierde nada: sale gratis.
export const CADUCIDAD = 60 * 60_000

// Por sesión: cuándo acabó su último turno y con cuánto contexto. Sirve para
// saber, al purgar, el contexto de antes en una sesión retomada (que no lo sabe
// hasta responder) y si la caché ya había caducado. ⚠️ limites lleva su propio
// registro igual, en su almacén.
type Registro = Record<string, { t: number; tokens: number }>
const SESIONES_GUARDADAS = 30

// Dónde empieza cada intercambio: un mensaje tuyo con texto, que no sea la
// respuesta de una herramienta. Cortar ahí nunca separa una llamada a una
// herramienta de su resultado.
function inicios(mensajes: readonly SessionMessage[]) {
  const r: number[] = []
  mensajes.forEach((m, i) => {
    if (m.role === 'user' && !m.toolResults?.length && m.text.trim() !== '') r.push(i)
  })
  return r
}

// Qué era la llamada, en pocas palabras: el comando, el archivo, la búsqueda.
function describir(uso: ToolUseSummary | undefined) {
  if (!uso) return 'una herramienta'
  const i = uso.input
  const dato = [i.command, i.file_path, i.path, i.pattern, i.url, i.query, i.description].find(
    v => typeof v === 'string' && v.trim() !== '',
  ) as string | undefined
  if (!dato) return uso.tool
  const linea = dato.replace(/\s+/g, ' ').trim()
  return `${uso.tool} «${linea.length > 80 ? linea.slice(0, 79) + '…' : linea}»`
}

function lineas(texto: string) {
  return texto.split('\n').length
}

type Recorte = { mensajes: SessionMessage[]; aviso: string } | { saltar: string }

// /purgar: las salidas largas, menos las últimas, por una línea.
export function aligerar(mensajes: readonly SessionMessage[]): Recorte {
  // Las salidas que no se tocan: las PROTEGIDAS últimas, cortas o largas.
  const todas = mensajes.flatMap(m => m.toolResults ?? [])
  const protegidas = new Set(todas.slice(-PROTEGIDAS).map(r => r.tool_use_id))
  const purgable = (r: ToolResultSummary) => r.text.length >= MINIMO && !protegidas.has(r.tool_use_id)

  const usos = new Map<string, ToolUseSummary>()
  for (const m of mensajes) for (const u of m.toolUses) usos.set(u.tool_use_id, u)

  let salidas = 0
  let caracteres = 0
  const nuevos = mensajes.map((m): SessionMessage => {
    if (!m.toolResults?.some(purgable)) return m
    const resultados = m.toolResults.map((r): ToolResultSummary => {
      if (!purgable(r)) return { tool_use_id: r.tool_use_id, text: r.text, isError: r.isError }
      salidas++
      caracteres += r.text.length
      return {
        tool_use_id: r.tool_use_id,
        isError: r.isError,
        text:
          `[Salida purgada con /purgar para ahorrar contexto: ${lineas(r.text)} líneas ` +
          `(${r.text.length} caracteres) de ${describir(usos.get(r.tool_use_id))}. ` +
          `Si vuelve a hacer falta, hay que repetir la llamada.]`,
      }
    })
    // Sin `handle`: el motor lo construye de nuevo con estas salidas.
    return { role: m.role, text: m.text, toolUses: [], toolResults: resultados }
  })

  if (salidas === 0) return { saltar: 'Nada que purgar: no hay salidas largas fuera de las últimas' }
  return {
    mensajes: nuevos,
    aviso: `Purgadas ${salidas} salidas viejas: ${Math.round(caracteres / 1000)}k caracteres menos`,
  }
}

// /purgar N: solo los últimos N intercambios, con una nota delante para que el
// modelo sepa que hubo más.
export function quedarse(mensajes: readonly SessionMessage[], n: number): Recorte {
  const ini = inicios(mensajes)
  if (ini.length <= n) return { saltar: `Nada que purgar: solo hay ${ini.length} intercambios` }
  const corte = ini[ini.length - n]
  const [primero, ...resto] = mensajes.slice(corte)
  const nota =
    `[Conversación anterior purgada con /purgar: se han quitado ${ini.length - n} intercambios ` +
    `y se conservan los últimos ${n}.]`
  return {
    mensajes: [{ role: 'user', text: `${nota}\n\n${primero.text}`, toolUses: [] }, ...resto],
    aviso: `Purgados ${ini.length - n} intercambios; quedan los últimos ${n}`,
  }
}

// Tras purgar se pierde la caché: la siguiente petición reescribe todo el
// contexto (a 2× con caché de 1 h) en vez de leerlo (a 0,1×), y cada una de las
// siguientes ahorra 0,1× lo quitado. Cuántas hacen falta para recuperarlo, con
// los precios de la API; es conservador, porque el principio del contexto
// (instrucciones, herramientas) suele seguir en caché.
export function amortizacion(antes: number, despues: number) {
  const ahorro = 0.1 * (antes - despues)
  return ahorro > 0 ? Math.ceil((2 * despues - 0.1 * antes) / ahorro) : null
}

function k(tokens: number) {
  return `${Math.round(tokens / 1000)}k`
}

// Lo que se ve de una conversación, en caracteres: textos y salidas.
export function caracteres(mensajes: readonly SessionMessage[]) {
  return mensajes.reduce(
    (n, m) => n + m.text.length + (m.toolResults ?? []).reduce((r, x) => r + x.text.length, 0),
    0,
  )
}

// El aviso tras la primera respuesta. `frio`: la caché había caducado (true), no
// (false) o no se sabe (undefined, una sesión sin registro). `antes` falta si no
// se sabe el contexto de antes: se estima con lo quitado.
export function avisoDeAhorro(antes: number | undefined, quitados: number, despues: number, frio?: boolean) {
  const estimado = antes === undefined
  const previo = antes ?? despues + Math.round(quitados / CARACTERES_POR_TOKEN)
  const vueltas = amortizacion(previo, despues)
  if (vueltas === null) return `La purga no bajó el contexto (${k(previo)} → ${k(despues)})`
  const cifras =
    `Purga: ${estimado ? '~' : ''}${k(previo)} → ${k(despues)} de contexto ` +
    `(−${Math.round((1 - despues / previo) * 100)} %${estimado ? ', estimado' : ''})`
  if (frio === true) return `${cifras}. Gratis: la caché ya había caducado`
  if (frio === false) return `${cifras}; se amortiza en unas ${vueltas} peticiones`
  return `${cifras}. Si la sesión llevaba más de 1 h parada, ha salido gratis; si no, se amortiza en unas ${vueltas} peticiones`
}

// La última purga, hasta que la primera respuesta diga el contexto de después y
// se pueda avisar del ahorro de verdad.
let pendiente: { antes?: number; quitados: number; frio?: boolean } | undefined

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const resultado = await next(e)
    await $.command.register({
      name: 'purgar',
      description: 'Quita del contexto las salidas viejas de herramientas, sin resumen (N: deja los últimos N intercambios)',
      argumentHint: '[N]',
    })
    return resultado
  })

  on('command.run', { command: 'purgar' }, async ($, e) => {
    const args = e.args.trim()
    if (args !== '' && !/^[1-9]\d*$/.test(args)) return { text: 'Uso: /purgar, o /purgar N para dejar los últimos N intercambios' }
    // Desde aquí no se puede lanzar otro comando (esperaría a este mismo): se
    // lanza /compact en cuanto este acaba, desde un temporizador.
    $.clock.after(0, () => {
      $.command.run({ command: 'compact', args: args ? `${MARCA} ${args}` : MARCA }).catch((err: unknown) => {
        $.ui.toast(`No se pudo purgar: ${err instanceof Error ? err.message : String(err)}`)
      })
    })
    return { text: args ? `Purgando: se quedan los últimos ${args} intercambios…` : 'Purgando las salidas viejas…' }
  })

  on('session.compact', async ($, e, next) => {
    // Solo lo suyo y solo la conversación principal (no la de un subagente).
    const m = /^purgar(?:\s+(\d+))?$/.exec(e.instructions?.trim() ?? '')
    if (!m || e.agentId || !Array.isArray(e.messages)) return next(e)

    const recorte = m[1] ? quedarse(e.messages, Number(m[1])) : aligerar(e.messages)
    if ('saltar' in recorte) return { skip: recorte.saltar }
    const registro = (((await $.store.get('sesiones')) as Registro | undefined) ?? {})[await $.session.id()]
    const ahora = await $.clock.now()
    pendiente = {
      antes: (await $.session.usage()).context.tokens || registro?.tokens,
      quitados: caracteres(e.messages) - caracteres(recorte.mensajes),
      frio: registro ? ahora - registro.t > CADUCIDAD : undefined,
    }
    $.ui.toast(recorte.aviso)
    return { messages: recorte.mensajes }
  })

  // La primera respuesta tras purgar trae el contexto de verdad: el ahorro real.
  on('turn.complete', async ($, e, next) => {
    const resultado = await next(e)
    if (e.agentId !== undefined) return resultado
    const despues = (await $.session.usage()).context.tokens
    if (!despues) return resultado

    // Apuntar este turno: cuándo y con cuánto contexto. Solo las más recientes.
    const id = await $.session.id()
    const ahora = await $.clock.now()
    const registro = ((await $.store.get('sesiones')) as Registro | undefined) ?? {}
    const recientes = Object.entries({ ...registro, [id]: { t: ahora, tokens: despues } })
      .sort(([, a], [, b]) => b.t - a.t)
      .slice(0, SESIONES_GUARDADAS)
    await $.store.set('sesiones', Object.fromEntries(recientes))

    if (pendiente !== undefined) {
      const { antes, quitados, frio } = pendiente
      pendiente = undefined
      $.ui.toast(avisoDeAhorro(antes, quitados, despues, frio))
    }
    return resultado
  })
}
