// sugeridor: mientras escribes en la caja, al parar 2 segundos mira si lo que
// llevas encaja con un prompt de tu librería (~/.claude/prompt-library.md) y te
// lo propone encima de la caja, con «Usar» para cambiar tu borrador por él.
//
// Sin modelo: decide por frases clave, así que no gasta límite ni tarda. Lee la
// librería y nada más; no toca la red ni lanza procesos.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Sugerencia } from '../types'

const actual = atom({ plugin: 'sugeridor', key: 'actual' } as const, null)

// Cambia la sugerencia y pide repintar la banda: la app guarda su dibujo y, con
// otro mod dibujando en el mismo hueco, no se enteraba del cambio.
async function poner($: EngineInterface, valor: Sugerencia | null) {
  await update($, actual, () => valor)
  $.ui.invalidate('ui.render')
}

const PAUSA_MS = 2000
const MIN_PALABRAS = 4

// Qué frase de un borrador apunta a cada prompt de la librería, por su nombre
// allí. Se comparan en minúsculas y sin tildes: también sin la de la ñ, así que
// aquí va "anade", no "añade". Un prompt sin entrada aquí no se sugiere nunca;
// uno de la librería que no exista se ignora.
const PISTAS: Record<string, RegExp> = {
  // Raspberry Pi
  'Desplegar': /(despleg|desplieg|sub|instal|mont|pon)\w* (?!.{0,40}\bmac\b).{0,40}(en|a) la pi\b|como servicio|systemd|timer de systemd/,
  'Diagnosticar un servicio': /\bla pi\b.{0,40}(no (funciona|va|arranca|responde)|se ha caido|esta caido|ha dejado de)|(no (funciona|va|arranca|responde)|se ha caido|esta caido|ha dejado de).{0,40}\b(en )?la pi\b|systemctl|journalctl/,
  'Antes de desplegar': /(version|python|node)\w*.{0,30}(de|en) la pi\b|(funciona|funcionara|funcionaria|correra|va a ir) en la pi\b|cp313|node --check/,
  'Publicar algo': /funnel|caddy|publica\w*.{0,30}(internet|fuera)|acceso desde fuera|desde internet/,
  'Exposición': /0\.0\.0\.0|sin (token|autenticar|contrasena)|expuest|(que|quien) (se )?(ve|puede ver|entra|puede entrar).{0,30}(lan|la red)/,
  '¿Mac o Pi?': /mac o (en )?(la )?pi\b|pi o (en )?(el )?mac|launchagent|siempre (encendid|disponible)|24\/7|cuando (el mac )?se (duerme|apaga)/,
  // Verificar y documentar
  'Verificar antes de afirmar': /(estas|seguro) seguro|lo has (comprobado|verificado)|(compruebalo|verificalo) (antes|primero)|no te lo inventes|sin comprobar/,
  'Actualizar en vez de crear': /(apunta|guarda|anota|documenta)(lo)? (en|esto en) (la )?(memoria|claude\.?md)|actualiza (la )?(memoria|claude\.?md)|(anade|anadelo|mete|metelo) (esto )?(a|en) (la )?memoria/,
  'Coste': /(cuanto|lo que) (cuesta|gasta|consume)|\bneon\b|coste|despierta la base|(muchas|cuantas) llamadas/,
  'Credenciales': /(credenciales|api ?keys?|llaves|secretos?|\.env)\b.{0,40}(expuest|copiad|versionad|subid|en git|filtrad|por ahi)|(busca|hay) (llaves|credenciales|secretos)/,
  'Visión general de un repo': /vision general|arquitectura|explica(me)? (el|este) (repo|proyecto|codigo)|que hace (este|el) (repo|proyecto)/,
  'Explicar un archivo': /explica(me)? (que hace )?(el|este) (archivo|fichero|script)|como funciona (el|este) (archivo|fichero|script)/,
  'Localizar comportamiento': /donde (se )?(calcula|hace|esta|define|guarda|calculamos|hacemos|guardamos|definimos)/,
  'Impacto de borrar': /(que (pasa|se rompe|se romperia)|rompo algo).{0,40}(borr|quit|elimin)|(borr|quit|elimin)\w* .{0,40}(se rompe|rompo|pasa algo)/,
  'Arqueología': /historial de|por que (esta|se hizo) asi|como (ha )?evolucionado/,
  'Recorrido funcional': /que pasa (exactamente )?cuando|guiame por/,
  'Alcance de un cambio': /que (archivos|ficheros) (tendria|tengo|habria|hay) que (tocar|cambiar)/,
  'Plan de refactor sin tocar código': /refactori|reorganiza(r)? (el|este) codigo|limpia(r)? (el|este) codigo/,
  'Spec por entrevista': /quiero (construir|hacer|montar|crear) (una?|el|la) (app|aplicacion|feature|funcion|herramienta|web|bot|sistema)/,
  'Casos límite': /casos? limite|que (puede|podria) fallar/,
  'Copiar patrón existente': /igual que (el|la|lo) |con el mismo (estilo|patron)|copia(ndo)? (el|la) (estructura|patron)/,
  'Endpoint nuevo': /endpoint/,
  'Herramienta rápida': /hazme una (herramienta|pagina|calculadora|web)/,
  'Implementar issue': /issue ?#?\d+/,
  'Añadir comentarios/docstrings': /docstring|anade comentarios|pon(er)? comentarios/,
  'Tests + arreglar fallos': /(escribe|haz|hazme|añade|crea) (unos |los )?tests?|(escribe|haz|hazme|añade|crea) (unas )?pruebas/,
  'TDD': /\btdd\b|tests? primero/,
  'Subir cobertura': /cobertura|coverage/,
  'Migración': /migra(r)? (todo )?de|pasar todo de .{1,30} a/,
  'Portar': /porta(r|lo)? (a|de) |pasar(lo)? a (python|node|typescript|javascript|rust|go)\b/,
  'Optimizar métrica': /optimiza|va (muy )?lento|tarda (mucho|demasiado)|mas rapido/,
  'Arreglar layout': /se sale|desborda|se descuadra|no cabe|se ve mal en/,
  'Antes de commitear': /(revisa|mira).{0,40}(cambios|(lo )?que (he )?(tocado|cambiado|hecho))|antes de (hacer (el |un )?)?commit|voy a (hacer (el |un )?)?commit/,
  'Revisar PR': /\bpr\b|pull request/,
  'Revisión de seguridad con subagente': /seguridad|vulnerab/,
  'Test que falla': /test.{0,25}fall|fall\w* (el|los|un) test/,
  'Síntoma en producción': /los usuarios (ven|dicen)|en produccion/,
  'Error de build': /error de (build|compilacion)|no compila|(el )?build (falla|roto|no pasa)/,
  'Diagnóstico por logs': /no funciona|se ha caido|esta caido|ha dejado de|no arranca|por que no (va|funciona)|mira los logs/,
  'Commit': /^(haz (un )?)?commit(ea)?\b|commitea/,
  'Resolver conflictos': /conflictos?( de merge)?/,
  'Release notes': /release notes|notas de (la )?version|changelog/,
  'Analizar y guardar': /(analiza|resume|resumeme).{0,30}(csv|json|datos|archivo|fichero|excel|backtest)/,
  'Consulta + análisis': /(muestrame|dame|sacame) todos? (los|las)/,
  'Crear skill': /(crea|haz|hazme) una skill/,
  'Crear hook': /(crea|haz|hazme|escribe) un hook/,
  'Configurar MCP': /\bmcp\b/,
  'Corregir mi comportamiento': /no paras de|siempre (haces|te olvidas)|otra vez (has|te)/,
  'Cierre de sesión': /resume (lo que (hemos )?hecho|la sesion)|que hemos hecho (hoy|en esta sesion)/,
}

function normal(texto: string) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

// Las líneas `- Nombre: "plantilla"` de la librería, por nombre.
function leerLibreria(md: string) {
  const prompts = new Map<string, string>()
  for (const linea of md.split('\n')) {
    const m = /^- ([^:"]+): "(.+)"\s*$/.exec(linea.trim())
    if (m) prompts.set(m[1].trim(), m[2])
  }
  return prompts
}

// El prompt que mejor encaja: el de la frase clave más larga que aparezca (más
// larga = más concreta: «el test falla» gana a «falla»).
function elegir(borrador: string, prompts: Map<string, string>) {
  const texto = normal(borrador)
  let mejor: { nombre: string; plantilla: string; largo: number } | null = null
  for (const [nombre, plantilla] of prompts) {
    const m = PISTAS[nombre]?.exec(texto)
    if (m && (!mejor || m[0].length > mejor.largo)) mejor = { nombre, plantilla, largo: m[0].length }
  }
  return mejor
}

// Si el borrador ya dice casi todo lo de la plantilla, sobra sugerirla.
function yaLoDice(borrador: string, plantilla: string) {
  const palabras = (s: string) =>
    normal(s.replace(/\{[^}]*\}/g, ' ')).split(/[^a-zñ0-9]+/).filter(p => p.length > 3)
  const suyas = new Set(palabras(borrador))
  const deLaPlantilla = palabras(plantilla)
  if (deLaPlantilla.length === 0) return false
  return deLaPlantilla.filter(p => suyas.has(p)).length / deLaPlantilla.length >= 0.6
}

// Lo de la sesión: se pierde al recargar el mod, y no importa.
let prompts = new Map<string, string>()
let reloj: Timer | null = null
// Los que descartaste con × no vuelven a salir en esta sesión.
const descartados = new Set<string>()
// Diagnóstico (/sugeridor): por dónde ha pasado y qué decidió la última vez.
const diag = { libreria: 'sin leer', ediciones: 0, pausas: 0, ultima: '—', dibujos: 0 }

async function sondear($: EngineInterface, borrador: string) {
  const limpio = borrador.trim()
  // Un comando no cuenta, para que escribir /sugeridor no tape la pausa anterior.
  if (limpio.startsWith('/')) return
  diag.pausas += 1
  if (limpio.split(/\s+/).length < MIN_PALABRAS) {
    diag.ultima = `demasiado corto: «${limpio.slice(0, 40)}»`
    return
  }
  const elegido = elegir(limpio, prompts)
  if (!elegido || descartados.has(elegido.nombre) || yaLoDice(limpio, elegido.plantilla)) {
    diag.ultima = `sin sugerencia para «${limpio.slice(0, 40)}»${elegido ? ` (${elegido.nombre} descartado o ya dicho)` : ''}`
    return
  }
  diag.ultima = `sugerido ${elegido.nombre}`
  await poner($, {
    nombre: elegido.nombre,
    plantilla: elegido.plantilla,
    borrador,
    isAplicada: false,
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const resultado = await next(e)
    try {
      const casa = await $.env.get('HOME')
      prompts = leerLibreria(await $.fs.read(`${casa}/.claude/prompt-library.md`))
      diag.libreria = `${prompts.size} prompts`
    } catch (error) {
      prompts = new Map()
      diag.libreria = `no se pudo leer: ${String(error).slice(0, 80)}`
    }
    await $.command.register({ name: 'sugeridor', description: 'Diagnóstico del sugeridor de prompts' })
    return resultado
  })

  // Cada tecla reinicia la cuenta; a los 2 s sin tocar nada, se sondea el borrador.
  on('prompt.edit', async ($, e, next) => {
    const caja = await next(e)
    diag.ediciones += 1
    reloj?.cancel()
    const s = await read($, actual)
    // Escribir encima de una sugerencia sin usar la quita; una ya usada se queda
    // (con su «Deshacer») hasta que escribas en la caja.
    if (s !== null) await poner($, null)
    const borrador = caja.text
    reloj = $.clock.after(PAUSA_MS, () => void sondear($, borrador))
    return caja
  })

  on('command.run', { command: 'sugeridor' }, async $ => {
    const s = await read($, actual)
    return {
      text:
        `Librería: ${diag.libreria} · teclas vistas: ${diag.ediciones} · pausas de 2 s: ${diag.pausas} · ` +
        `dibujos de la banda: ${diag.dibujos}\nÚltima pausa: ${diag.ultima}\n` +
        `Sugerencia guardada ahora: ${s ? s.nombre : 'ninguna'}`,
    }
  })

  on('prompt.submit', async ($, e, next) => {
    reloj?.cancel()
    await poner($, null)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const debajo = await next(e)
    const s = await read($, actual)
    diag.dibujos += 1
    if (e.props.hasSurvey || s === null) return debajo

    const { Box, Button, Text } = $.ui.resolve(e)
    const fila = s.isAplicada ? (
      <Box key="sugeridor" columnGap={1} alignItems="center">
        <Text dimColor>Puesta la plantilla de «{s.nombre}»: rellena los {'{huecos}'}.</Text>
        <Button
          key="deshacer"
          label="Deshacer"
          onPress={async () => {
            await $.prompt.fill({ text: s.borrador, mode: 'replace' })
            await poner($, null)
          }}
        />
      </Box>
    ) : (
      <Box key="sugeridor" columnGap={1} alignItems="center">
        <Box flexShrink={1}>
          <Text wrap="wrap">
            <Text color="#e0a030">Sugerencia</Text>
            <Text dimColor> · {s.nombre} → </Text>
            {s.plantilla}
          </Text>
        </Box>
        <Button
          key="usar"
          label="Usar"
          onPress={async () => {
            const hecho = await $.prompt.fill({ text: s.plantilla, mode: 'replace' })
            await poner($, hecho.isFilled ? { ...s, isAplicada: true } : s)
          }}
        />
        <Button
          key="descartar"
          label="×"
          onPress={async () => {
            descartados.add(s.nombre)
            await poner($, null)
          }}
        />
      </Box>
    )

    return (
      <Box flexDirection="column">
        {fila}
        {debajo}
      </Box>
    )
  })
}
