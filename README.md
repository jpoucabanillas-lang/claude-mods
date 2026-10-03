# Mis mods de Claude Code

Catálogo (`mis-mods`) con mods escritos a mano, sin nada de terceros.
Requieren Claude Code 2.1.287 o posterior. Funcionan en la terminal y en la
pestaña Code de la app de escritorio.

## Instalarlo

```
claude plugin marketplace add jpoucabanillas-lang/claude-mods
claude plugin install limites@mis-mods
claude plugin install purgar@mis-mods
claude plugin install sugeridor@mis-mods
```

Luego reiniciar Claude Code o escribir `/reload-plugins`. Para recibir versiones
nuevas: `claude plugin marketplace update mis-mods && claude plugin update limites@mis-mods`.

## limites

Una línea encima de la caja de texto con el uso de los límites de la suscripción:

```
hasta 16:14 28% ━━━━━━━━━━━━──────────────────────    semana 41% ━━━━━━━━━━━━━━───────────────────    contexto 23% [ Purgar ]
```

Cada límite ocupa media línea: la etiqueta con su % y la barra estirada hasta el final.
A la derecha, el % de la ventana de contexto de la sesión.

- **El de 5 h se nombra por la hora a la que se reinicia** («hasta 16:14»), en la
  hora local del equipo. Pone «5 h» solo mientras no se sabe la hora: si la ventana
  ya se reinició y aún no ha llegado una respuesta con la hora nueva. Al pasar esa
  hora, el mod lo pone a 0 % sin esperar a la siguiente respuesta (lo comprueba cada
  minuto). El aviso del 90 % también dice la hora.

- **5 h** y **semana**: los límites de la **cuenta** (toda la cuenta, no solo esa
  conversación). Con los colores de la gráfica de uso de claude.ai: azul `#2a78d6`,
  ámbar `#fab219` desde el 75 % y rojo `#d03b3b` desde el 90 %, cada uno sobre su
  pista clara u oscura según el tema. Un aviso único al
  90 % del de 5 h.
- **Sale nada más abrir la sesión**, antes del primer mensaje: Claude Code no tiene
  cifras hasta la primera respuesta, así que el mod guarda la última lectura y la
  enseña **atenuada** hasta entonces (a 0 % la ventana que ya se haya reiniciado).
  Puede quedarse corta si mientras tanto se gastó en otro sitio (otro equipo,
  claude.ai).
- **Siempre una sola línea**, para no quitar altura al chat. En escritorio las barras
  son SVG finas (4 px, redondeadas) estiradas al ancho del hueco; en la terminal, una
  línea de texto (`━━━───`) de tantas casillas como quepan.
- **Botón [Purgar]**, solo si está instalado el mod `purgar` y `/purgar` quitaría **al
  menos el 40 % del contexto**. Lo calcula con las mismas reglas que `/purgar` (están
  repetidas en los dos mods: si cambian en uno, cambiarlas en el otro), estimando 2
  caracteres por token (medido en dos purgas reales: ~1,6 y ~1,9). Por debajo del 40 %, perder la caché cuesta más de lo
  que se ahorra, así que si sale el botón, compensa. No sale mientras Claude está
  trabajando. Pulsarlo es lo mismo que escribir `/purgar`.
- **[Purgar gratis]**: si la sesión lleva más de 1 h sin actividad, su caché ya ha
  caducado y la siguiente petición la reescribe entera igualmente. Entonces purgar no
  pierde nada, y el botón sale desde el **10 %**. Al retomar una sesión vieja sale
  **antes del primer mensaje**, que es el momento bueno. Para eso el mod apunta en su
  almacén, por sesión, cuándo tuvo actividad y con cuánto contexto (las 30 últimas):
  las sesiones que no se hayan usado con esta versión aún no tienen registro.
- **Se actualiza durante el turno**, tras cada herramienta, y no solo al acabar: en un
  turno largo se quedaba con la cifra del principio.
- **Por API no sale nada**: ahí no hay límites (la terminal del Mac va con «API Usage
  Billing»).

No llama a modelos, no lee ficheros, no lanza procesos ni toca la red:
`claude plugin validate limites` lo lista en `calls:`.

Historia: empezó como `contexto` (contexto + gasto + límite de 5 h) y se quedó solo
con los límites el 3 oct 2026. Ese mismo día volvió el % de contexto, para acompañar
al botón de purgar.

## purgar

Aligera el contexto de la sesión **sin resumirlo**:

- **`/purgar`**: cambia cada salida larga de herramienta (más de 1000 caracteres: logs,
  archivos leídos enteros, `ps`…) por una línea que dice qué era: `[Salida purgada con
  /purgar …: 340 líneas de Bash «journalctl -u bot-trend» …]`. Así Claude sabe que
  existió y la vuelve a pedir si le hace falta. **Las 10 últimas salidas no se tocan**,
  se cuentan salidas y no intercambios, porque uno solo puede llevar decenas de comandos.
  Tus mensajes y sus respuestas se quedan todos.
- **`/purgar N`**: deja solo los últimos N intercambios, con una nota delante para que
  Claude sepa que hubo más. Como un `/clear` que conserva el hilo reciente.

Va por la compactación de Claude Code (`/purgar` lanza `/compact purgar`), pero en vez
del resumen, que es una llamada al modelo, el mod devuelve la conversación recortada:
**no gasta límite y es instantáneo**. Cualquier otro `/compact` pasa intacto. Los cortes
caen siempre en el inicio de un mensaje tuyo, así que nunca separan una llamada a una
herramienta de su resultado.

Tras la primera respuesta después de purgar, un aviso dice el ahorro real y cuánto
tarda en recuperarse: «Purga: 292k → 237k de contexto (−19 %); se amortiza en unas 80
peticiones», o «Gratis: la caché ya había caducado» si llevaba más de 1 h parada. Lo
sabe por un registro propio, por sesión, igual que el de `limites`. En una sesión sin
registro (retomada y sin usar desde que se instaló esta versión) estima el contexto de
antes con lo quitado y lo marca como «estimado».

**Cuándo compensa**: cada paso de Claude relee todo el contexto (de caché, más barato,
pero en una sesión larga es la mayor parte del gasto). Purgar pierde la caché, y el
siguiente paso la reescribe entera a precio de escritura. Solo compensa si quita mucho:
con los precios de la API, quitar el 19 % tarda unas 80 peticiones en amortizarse, y el
40 %, unas 25. **Primera prueba real (3 oct 2026, versión 0.1.0, que protegía los 3
últimos intercambios): de 292k a 237k, −19 %. No compensó**: lo pesado estaba en los
intercambios protegidos. Para cambiar de tema es gratis abrir una sesión nueva, y
`/purgar N` quita mucho más. **Segunda prueba (3 oct 2026, versión 0.2.0)**, en una
sesión de una semana antes: **de 319k a 184k, −42 %**. Y salió gratis: tras más de una
hora parada la caché ya ha caducado y hay que reescribirla de todos modos, así que
**purgar al retomar una sesión vieja siempre compensa**. Ojo: el aviso de la app
(«se ahorraron 248k tokens») es una estimación suya; la cifra real es la del aviso de
`purgar`. Cómo cuenta el plan Pro la caché no es público: la
dirección es la misma, la proporción puede no serlo.

No llama a modelos, no lee ficheros, no lanza procesos ni toca la red.

## sugeridor

Mientras escribes en la caja, al parar 2 segundos mira si lo que llevas encaja con un
prompt de tu librería y te lo propone encima de la caja:

```
Sugerencia · Diagnosticar un servicio → {servicio} de la Pi no {hace X}. Mira …  [ Usar ] [ × ]
```

- **«Usar»** cambia tu borrador por la plantilla, para rellenar sus `{huecos}`;
  **«Deshacer»** lo devuelve. **«×»** descarta esa sugerencia para el resto de la sesión.
- **Sin modelo**: decide por frases clave (tabla `PISTAS` de `hooks/register.tsx`), así
  que no gasta límite ni tarda. Hacen falta al menos 4 palabras.
- **`/sugeridor`** da un diagnóstico: cuántos prompts leyó, teclas, pausas y la última
  decisión.
- Lee `~/.claude/prompt-library.md` y nada más; no toca la red ni lanza procesos.

**Depende del formato de la librería**, y por eso no sirve tal cual a otra persona:

- Solo entiende líneas `- Nombre: "plantilla"` que **acaben en la comilla**.
- Busca cada prompt **por su nombre exacto**. Renombrar uno en la librería, o poner
  texto detrás de las comillas, lo deja sin sugerir sin ningún aviso (pasó el 3 oct
  2026: una reescritura de la librería rompió 20 de sus 39 prompts).
- Un prompt nuevo no se sugiere hasta que tiene su entrada en `PISTAS`.
- Las pistas se comparan sin tildes y con la «ñ» como «n»: se escribe `anade`, no
  `añade`.

## Guardado: `guardado/limites-con-linea-de-estado`

Variante de `limites` que, **además** de la caja de arriba, escribe los límites en la
línea de estado del pie de la app (entre «Auto» y el modelo), sin ocupar altura:

```
limites   5 h 39% ━━━━━────────  ·  semana 14% ━━───────────
```

Lo que se probó en la app de escritorio (3 oct 2026), para no repetirlo:

- **Sin color**: la línea de estado (`$.ui.status`) solo admite texto plano. Probados y
  descartados: emojis (🔵🟠🔴) y códigos ANSI.
- **Ancho**: 13 casillas por barra caben; 16 cortan la semanal con «…». No se puede
  estirar hasta «Auto»: la app limita el ancho.
- **Grosor**: probados `▰▱` y `▬`, descartados; se queda la línea fina `━─`.
- **Otros huecos del pie**: el de la derecha (`SessionMode`) admite color pero es
  estrecho y corta; la línea de pistas (`PromptHint`) no se ve en escritorio.

Para recuperarla: copiar su `hooks/register.tsx` sobre `limites/hooks/register.tsx`
(si solo se quiere la línea de abajo, borrar el `on('ui.render', { component:
'AbovePrompt' } …)`), subir la versión y seguir los pasos de abajo.

## Cambiar un mod

Lo instalado es una **copia** en caché: editar aquí no cambia nada hasta actualizar.

1. Editar `limites/hooks/register.tsx`.
2. `claude plugin test limites` y `claude plugin validate limites`.
3. Subir `version` en `limites/.claude-plugin/plugin.json` (sin subirla no se actualiza).
4. `claude plugin marketplace update mis-mods && claude plugin update limites@mis-mods`
5. En una sesión abierta, `/reload-plugins`; si no, se carga en la siguiente. En la
   app de escritorio, si tras `/reload-plugins` no se ve el cambio, abrir una sesión
   nueva (el 3 oct 2026 pasó con `limites` 0.8.0; la causa no se llegó a confirmar).
6. `git commit` y `git push`, para que lo reciban los demás (lo instalan desde GitHub;
   en este Mac el catálogo apunta a esta carpeta, no al repo).

Para probar sin instalar: `claude --plugin-dir ~/Documents/code/claude-mods/limites`.

## Quitarlo

```
claude plugin uninstall limites@mis-mods
claude plugin marketplace remove mis-mods
```
