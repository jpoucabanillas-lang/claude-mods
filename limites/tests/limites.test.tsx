import { expect, test } from 'claude-code/testing'
import type { SessionUsage } from 'claude-code'

const BANDA = {
  plugin: 'limites',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 },
} as const

function uso(cincoHoras: number | null, semana: number | null, reinicio5h?: string): SessionUsage {
  const rateLimits = []
  if (cincoHoras !== null) rateLimits.push({ kind: 'five_hour', percentUsed: cincoHoras, resetsAt: reinicio5h })
  if (semana !== null) rateLimits.push({ kind: 'seven_day', percentUsed: semana })
  return { startedAt: 0, context: { tokens: 1000, window: 200000, percent: 1 }, rateLimits, cost: { usd: 1 } }
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

  // Terminal, 120 columnas: dos mitades de (120 - 4) / 2 = 58.
  // "5 h 28%" + espacio = 8 → barra de 50: 14 llenas y 36 vacías.
  // "semana 41%" + espacio = 11 → barra de 47: 19 llenas y 28 vacías.
  const terminal = await $.ui.mount({ ...BANDA, surface: 'terminal' })
  expect(await terminal.find({ text: /^5 h 28%$/ })).toBeDefined()
  expect(await terminal.find({ text: /^━{14}─{36}$/ })).toBeDefined()
  expect(await terminal.find({ text: /^semana 41%$/ })).toBeDefined()
  expect(await terminal.find({ text: /^━{19}─{28}$/ })).toBeDefined()
  // Ni contexto ni dinero: eso ya lo enseña la app.
  expect(await terminal.find({ text: /contexto|\$/ })).toBeUndefined()
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
  on('clock.now', () => ({ value: Date.parse('2026-10-03T12:00:00Z') }))
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
