import { expect, mock, test } from 'claude-code/testing'

import { aligerar, amortizacion, avisoDeAhorro, caracteres, quedarse } from '../hooks/register'
import type { SessionMessage } from 'claude-code'

// Una conversación de prueba: `n` intercambios, cada uno con tu mensaje, una
// llamada a Bash con una salida larga y la respuesta final.
function conversacion(n: number): SessionMessage[] {
  const m: SessionMessage[] = []
  for (let i = 1; i <= n; i++) {
    m.push({ role: 'user', text: `pregunta ${i}`, toolUses: [], handle: `u${i}` })
    m.push({
      role: 'assistant',
      text: '',
      toolUses: [{ tool_use_id: `t${i}`, tool: 'Bash', input: { command: `journalctl -u bot-${i}` } }],
      handle: `a${i}`,
    })
    m.push({
      role: 'user',
      text: '',
      toolUses: [],
      toolResults: [{ tool_use_id: `t${i}`, text: `línea\n`.repeat(400), isError: false }],
      handle: `r${i}`,
    })
    m.push({ role: 'assistant', text: `respuesta ${i}`, toolUses: [], handle: `f${i}` })
  }
  return m
}

// Hace de motor: guarda lo que el mod le pide y le da la conversación.
function motor(on: Parameters<Parameters<typeof test>[1]>[1], mensajes: SessionMessage[]) {
  const pedidos: string[] = []
  const avisos: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', $ => ({ value: { command: 'purgar' } }))
  on('command.run', { command: 'compact' }, ($, e) => {
    pedidos.push(e.args)
    return { text: '' }
  })
  on('session.messages', () => ({ value: { messages: mensajes } }))
  on('ui.toast', ($, e) => {
    avisos.push(e.text)
    return { value: undefined }
  })
  return { pedidos, avisos }
}

test('/purgar lanza /compact con su marca, y /purgar N con el número', async ($, on) => {
  const reloj = mock.clock(on)
  const { pedidos, avisos } = motor(on, [])
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  await $.command.run({ command: 'purgar', args: '' })
  await $.command.run({ command: 'purgar', args: '2' })
  const mal = await $.command.run({ command: 'purgar', args: 'todo' })
  await reloj.settle()
  expect({ pedidos, avisos }).toEqual({ pedidos: ['purgar', 'purgar 2'], avisos: [] })
  expect(mal.text).toMatch(/^Uso:/)
})

test('purga las salidas largas menos las 10 últimas, aunque estén en el mismo intercambio', async () => {
  const mensajes = conversacion(14)
  const recorte = aligerar(mensajes)
  if ('saltar' in recorte) throw new Error(`se saltó: ${recorte.saltar}`)
  const r = recorte.mensajes
  expect(r.length).toBe(mensajes.length)

  // Las 4 primeras salidas: cambiadas por la línea que dice qué eran.
  for (const i of [0, 1, 2, 3]) {
    const salida = r[i * 4 + 2]
    expect(salida.handle).toBeUndefined()
    expect(salida.toolResults?.[0].tool_use_id).toBe(`t${i + 1}`)
    expect(salida.toolResults?.[0].text).toMatch(/^\[Salida purgada con \/purgar.*401 líneas.*Bash «journalctl -u bot-\d»/)
  }
  // Tus mensajes, las llamadas y las respuestas: los del motor, enteros.
  expect(r[0].handle).toBe('u1')
  expect(r[1].handle).toBe('a1')
  expect(r[3].handle).toBe('f1')
  // Las 10 últimas salidas, sin tocar.
  for (let i = 4; i < 14; i++) expect(r[i * 4 + 2].handle).toBe(`r${i + 1}`)
  expect(recorte.aviso).toBe('Purgadas 4 salidas viejas: 10k caracteres menos')

  // Todo en un solo intercambio (un mensaje tuyo y 14 comandos): igual.
  const unSolo = mensajes.filter((m, i) => i === 0 || !(m.role === 'user' && !m.toolResults))
  const r2 = aligerar(unSolo)
  if ('saltar' in r2) throw new Error(`se saltó: ${r2.saltar}`)
  expect(r2.aviso).toBe('Purgadas 4 salidas viejas: 10k caracteres menos')
})

test('cuenta cuántas peticiones tarda en amortizarse', () => {
  // Lo medido el 3 oct 2026: de 292k a 237k.
  expect(amortizacion(292_500, 236_800)).toBe(80)
  // Quitar mucho se amortiza enseguida; no quitar nada, nunca.
  expect(amortizacion(300_000, 100_000)).toBe(9)
  expect(amortizacion(200_000, 200_000)).toBeNull()
})

test('/purgar N deja los últimos N intercambios, con una nota delante', async ($, on) => {
  const recorte = quedarse(conversacion(5), 2)
  if ('saltar' in recorte) throw new Error(`se saltó: ${recorte.saltar}`)
  const r = { messages: recorte.mensajes }
  expect(r.messages.length).toBe(8)
  expect(r.messages[0].role).toBe('user')
  expect(r.messages[0].text).toMatch(/^\[Conversación anterior purgada .*3 intercambios.*últimos 2\.\]\n\npregunta 4$/)
  // Desde ahí, los del motor tal cual: la llamada y su resultado, juntos.
  expect(r.messages[1].handle).toBe('a4')
  expect(r.messages[2].handle).toBe('r4')
  expect(r.messages[7].handle).toBe('f5')
})

// Que un /compact normal pase intacto no se puede probar aquí: el kit lanza la
// compactación sin mensajes. Se comprobó en una sesión real.
test('no purga si no hay nada que ganar', async () => {
  const corta = conversacion(3)
  expect(aligerar(corta)).toEqual({ saltar: 'Nada que purgar: no hay salidas largas fuera de las últimas' })
  expect(quedarse(corta, 5)).toEqual({ saltar: 'Nada que purgar: solo hay 3 intercambios' })
  const sinSalidasLargas = conversacion(15).map(m =>
    m.toolResults ? { ...m, toolResults: m.toolResults.map(r => ({ ...r, text: 'ok' })) } : m,
  )
  expect(aligerar(sinSalidasLargas)).toEqual({ saltar: 'Nada que purgar: no hay salidas largas fuera de las últimas' })
})

test('el aviso tras purgar: con la cifra de antes, o estimada si la sesión se retomó', () => {
  expect(avisoDeAhorro(292_500, 0, 236_800, false)).toBe('Purga: 293k → 237k de contexto (−19 %); se amortiza en unas 80 peticiones')
  // La prueba de bot dca (3 oct 2026): sesión retomada, 255 000 caracteres
  // quitados, 184k después; la real de antes era 319k.
  expect(avisoDeAhorro(undefined, 255_000, 184_157)).toBe(
    'Purga: ~312k → 184k de contexto (−41 %, estimado). Si la sesión llevaba más de 1 h parada, ' +
      'ha salido gratis; si no, se amortiza en unas 27 peticiones',
  )
  // Con registro de la sesión: la cifra real de antes, y se sabe si salió gratis.
  expect(avisoDeAhorro(319_317, 255_000, 184_157, true)).toBe(
    'Purga: 319k → 184k de contexto (−42 %). Gratis: la caché ya había caducado',
  )
  expect(avisoDeAhorro(319_317, 255_000, 184_157, false)).toBe(
    'Purga: 319k → 184k de contexto (−42 %); se amortiza en unas 25 peticiones',
  )
  expect(avisoDeAhorro(200_000, 0, 200_000)).toBe('La purga no bajó el contexto (200k → 200k)')
})

test('cuenta lo que se quita en caracteres', () => {
  const mensajes = conversacion(14)
  const r = aligerar(mensajes)
  if ('saltar' in r) throw new Error(r.saltar)
  // 4 salidas de 2400 caracteres, cambiadas por líneas de unos 160.
  const quitados = caracteres(mensajes) - caracteres(r.mensajes)
  expect(quitados).toBeGreaterThan(4 * 2200)
  expect(quitados).toBeLessThan(4 * 2400)
})
