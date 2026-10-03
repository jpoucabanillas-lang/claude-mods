# Mis mods de Claude Code

Catálogo (`mis-mods`) con mods escritos a mano, sin nada de terceros.
Requieren Claude Code 2.1.287 o posterior. Funcionan en la terminal y en la
pestaña Code de la app de escritorio.

## Instalarlo

```
claude plugin marketplace add jpoucabanillas-lang/claude-mods
claude plugin install limites@mis-mods
```

Luego reiniciar Claude Code o escribir `/reload-plugins`. Para recibir versiones
nuevas: `claude plugin marketplace update mis-mods && claude plugin update limites@mis-mods`.

## limites

Una línea encima de la caja de texto con el uso de los límites de la suscripción:

```
5 h 28% ━━━━━━━━━━━━━━────────────────────────────────    semana 41% ━━━━━━━━━━━━━━━━━━━───────────────────────────
```

Cada límite ocupa media línea: la etiqueta con su % y la barra estirada hasta el final.

- **5 h** y **semana**: los límites de la **cuenta** (toda la cuenta, no solo esa
  conversación). Con los colores de la gráfica de uso de claude.ai: azul `#2a78d6`,
  ámbar `#fab219` desde el 75 % y rojo `#d03b3b` desde el 90 %, cada uno sobre su
  pista clara u oscura según el tema. Un aviso único al
  90 % del de 5 h.
- **Siempre una sola línea**, para no quitar altura al chat. En escritorio las barras
  son SVG finas (4 px, redondeadas) estiradas al ancho del hueco; en la terminal, una
  línea de texto (`━━━───`) de tantas casillas como quepan.
- **Por API no sale nada**: ahí no hay límites (la terminal del Mac va con «API Usage
  Billing»). El contexto tampoco sale: ya lo enseña la app abajo a la derecha.

No llama a modelos, no lee ficheros, no lanza procesos ni toca la red:
`claude plugin validate limites` lo lista en `calls:`.

Historia: empezó como `contexto` (contexto + gasto + límite de 5 h) y se quedó solo
con los límites el 3 oct 2026.

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
5. En una sesión abierta, `/reload-plugins`; si no, se carga en la siguiente.
6. `git commit` y `git push`, para que lo reciban los demás (lo instalan desde GitHub;
   en este Mac el catálogo apunta a esta carpeta, no al repo).

Para probar sin instalar: `claude --plugin-dir ~/Documents/code/claude-mods/limites`.

## Quitarlo

```
claude plugin uninstall limites@mis-mods
claude plugin marketplace remove mis-mods
```
