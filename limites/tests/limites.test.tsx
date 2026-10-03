import { expect, mock, test } from 'claude-code/testing'
import type { SessionMessage, SessionUsage } from 'claude-code'

const BANDA = {
  plugin: 'limites',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 },
} as const

function uso(cincoHoras: number | null, semana: number | null, reinicio5h?: string, tokens = 1000): SessionUsage {
  const rateLimits = []
  if (cincoHoras !== null) rateLimits.push({ kind: 'five_hour', percentUsed: cincoHoras, resetsAt: reinicio5h })
  if (semana !== null) rateLimits.push({ kind: 'seven_day', percentUsed: semana })
  const percent = Math.round((tokens / 1_000_000) * 100)
  return { startedAt: 0, context: { tokens, window: 1_000_000, percent }, rateLimits, cost: { usd: 1 } }
}

// Las pruebas no traen almacén entre sesiones: uno en memoria.
function hacerDeAlmacen(on: Parameters<Parameters<typeof test>[1]>[1]) {
  const almacen = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: almacen.get(e.key) }))
  on('store.set', ($, e) => {
    almacen.set(e.key, e.value)
    return { value: undefined }
  })
}

const PASO = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

test('dibuja los límites de 5 h y semanal en una línea fina', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-03T12:00:00Z') })
  let ahora = uso(28, 41)
  on('session.usage', () => ({ value: ahora }))
  hacerDeAlmacen(on)
  // Nada responde por debajo en una prueba: hacemos de motor.
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  // Terminal, 120 columnas: a la derecha "contexto 0%" (11), y dos mitades de
  // (120 - 11 - 2 × 4) / 2 = 50.
  // "5 h 28%" + espacio = 8 → barra de 42: 12 llenas y 30 vacías.
  // "semana 41%" + espacio = 11 → barra de 39: 16 llenas y 23 vacías.
  const terminal = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await terminal.find({ text: /^5 h 28%$/ })).toBeDefined()
  expect(await terminal.find({ text: /^━{12}─{30}$/ })).toBeDefined()
  expect(await terminal.find({ text: /^semana 41%$/ })).toBeDefined()
  expect(await terminal.find({ text: /^━{16}─{23}$/ })).toBeDefined()
  expect(await terminal.find({ text: /^contexto 0%$/ })).toBeDefined()
  // Ni dinero ni botón de purgar (no hay mod purgar).
  expect(await terminal.find({ text: /\$/ })).toBeUndefined()
  expect(await terminal.find({ type: 'Button' })).toBeUndefined()
  await terminal.unmount()

  // Escritorio: una barra SVG por límite.
  const escritorio = await $.ui.mount({ ...BANDA, surface: 'desktop' })
  expect((await escritorio.findAll({ type: 'Svg' })).length).toBe(2)
  await escritorio.unmount()

  // Tras un paso, las cifras se actualizan.
  ahora = uso(93, 50)
  await $.turn.complete({ ...PASO, turnId: 't1' })
  const despues = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await despues.find({ text: / 93%/ })).toBeDefined()
  expect(await despues.find({ text: / 50%/ })).toBeDefined()
  await despues.unmount()

  // Por API no hay límites: la banda no dibuja nada suyo.
  ahora = uso(null, null)
  await $.turn.complete({ ...PASO, turnId: 't2' })
  const api = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await api.find({ text: /5 h|semana/ })).toBeUndefined()
  await api.unmount()

  // Si hay una encuesta en la banda, el mod se aparta.
  ahora = uso(28, 41)
  await $.turn.complete({ ...PASO, turnId: 't3' })
  const conEncuesta = await $.ui.mount({ ...BANDA, surface: 'terminal', props: { ...BANDA.props, hasSurvey: true } })
  expect(await conEncuesta.find({ text: /5 h/ })).toBeUndefined()
})

test('antes del primer mensaje enseña lo último guardado, atenuado', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-03T12:00:00Z') })
  // Hace mucho que pasó el reinicio de las 5 h; el semanal no tiene fecha.
  let ahora = uso(60, 30, '2000-01-01T00:00:00Z')
  on('session.usage', () => ({ value: ahora }))
  hacerDeAlmacen(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  // Una sesión con cifras las guarda.
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  // La siguiente arranca sin cifras (aún no hay respuesta): tira de lo guardado.
  // El de 5 h ya se reinició, así que sale a 0; el semanal, como estaba.
  ahora = uso(null, null)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const banda = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await banda.find({ text: /^0%$/ })).toBeDefined()
  expect(await banda.find({ text: /^30%$/ })).toBeDefined()
  await banda.unmount()

  // Con la primera respuesta mandan las cifras nuevas.
  ahora = uso(12, 31)
  await $.turn.complete({ ...PASO, turnId: 't1' })
  const despues = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await despues.find({ text: /^12%$/ })).toBeDefined()
  expect(await despues.find({ text: /^31%$/ })).toBeDefined()
})

test('el de 5 h se nombra por la hora a la que se reinicia', async ($, on) => {
  const reloj = mock.clock(on, { now: Date.parse('2026-10-03T12:00:00Z') })
  const reinicio = '2026-10-03T14:14:00Z'
  // La hora sale en la zona del equipo; la prueba la calcula igual.
  const d = new Date(reinicio)
  const hora = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  on('session.usage', () => ({ value: uso(28, 41, reinicio) }))
  hacerDeAlmacen(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const banda = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await banda.find({ text: new RegExp(`^hasta ${hora} 28%$`) })).toBeDefined()
  expect(await banda.find({ text: /^5 h/ })).toBeUndefined()
  await banda.unmount()

  // Pasada la hora, el reloj lo pone a 0 y vuelve "5 h" hasta la próxima respuesta.
  await reloj.advance(2 * 60 * 60_000 + 15 * 60_000)
  const despues = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await despues.find({ text: /^5 h 0%$/ })).toBeDefined()
})

// Una conversación con `n` salidas de herramienta de 9000 caracteres.
function salidas(n: number): SessionMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: 'user' as const,
    text: '',
    toolUses: [],
    toolResults: [{ tool_use_id: `t${i}`, text: 'x'.repeat(9000), isError: false }],
  }))
}

test('con el mod purgar, el botón [Purgar] sale cuando quitaría el 40 % del contexto', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-03T12:00:00Z') })
  // 100k de contexto (10 %) en todo momento.
  on('session.usage', () => ({ value: uso(28, 41, undefined, 100_000) }))
  hacerDeAlmacen(on)
  on('command.list', () => ({ value: [{ name: 'purgar', description: '', source: 'plugin' }] }))
  let mensajes = salidas(20)
  on('session.messages', () => ({ value: mensajes }))
  const corridos: string[] = []
  on('command.run', { command: 'purgar' }, ($, e) => {
    corridos.push(e.command)
    return { text: '' }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  // 12 salidas: se quitarían las 2 viejas, 18 000 caracteres ≈ 9k tokens. El
  // 9 %: no compensa.
  mensajes = salidas(12)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  let banda = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await banda.find({ text: /^contexto 10%$/ })).toBeDefined()
  expect(await banda.find({ type: 'Button' })).toBeUndefined()
  await banda.unmount()

  // 20 salidas: 10 viejas, 90 000 caracteres ≈ 45k tokens. El 45 %: sale.
  mensajes = salidas(20)
  await $.turn.complete({ ...PASO, turnId: 't1' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const b = await $.ui.mount({ ...BANDA, surface })
    await b.press({ key: 'purgar' })
    await b.unmount()
  }
  expect(corridos).toEqual(['purgar', 'purgar'])

  // Mientras trabaja, no: la compactación no se puede lanzar a mitad de turno.
  banda = await $.ui.mount({ ...BANDA, surface: 'terminal', props: { ...BANDA.props, isWorking: true } })
  expect(await banda.find({ type: 'Button' })).toBeUndefined()
  await banda.unmount()
})

test('durante un turno largo se actualiza tras cada herramienta', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-03T12:00:00Z') })
  let ahora = uso(10, 41)
  on('session.usage', () => ({ value: ahora }))
  hacerDeAlmacen(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '' } }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  ahora = uso(15, 42)
  await $.tool.call({ tool: 'Bash', input: { command: 'ls' } })
  const banda = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await banda.find({ text: /^5 h 15%$/ })).toBeDefined()
})
