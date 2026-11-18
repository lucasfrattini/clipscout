# cg-ui — paquete común de interfaz de Clipgeist

Componentes de interfaz compartidos por clipkeeper, clipscout y clonbuster (SU-17). Sin dependencias ni compilación: un `.css`, un `.js` (script clásico que registra *custom elements* sin shadow DOM) y una página de muestra, `cg-ui.html`.

## Regla de copia idéntica

- La copia **canónica** es esta: `clonbuster/src/clonbuster/web/cg/`. Los cambios se hacen aquí.
- Las otras son copias **byte a byte**: clipscout `public/cg/` y clipkeeper `frontend/public/cg/`.
- Cada repo tiene un test que compara el md5 de `cg-ui.css` y `cg-ui.js` con una constante. Al copiar, se actualiza esa constante en los tres.
- Lo propio de cada app (acento, ajustes) va en sus estilos, nunca en estos ficheros.

## Cómo se incluye

```html
<html lang="es" data-app="clonbuster">           <!-- acento: clonbuster | clipscout | clipkeeper -->
<link rel="stylesheet" href="/cg/cg-ui.css">
<script src="/cg/cg-ui.js" defer></script>       <!-- defer: los elementos se montan con sus hijos ya leídos -->
```

- **clonbuster**: lo sirve `/cg/{nombre}` (`servidor/paginas.py`); la muestra está en `/cg/cg-ui.html`.
- **clipscout**: `public/cg/`, mismas dos líneas.
- **clipkeeper (React)**: `frontend/public/cg/`, las dos líneas en `index.html`, y tipos en `frontend/src/cg.d.ts`. En React 18 los eventos `cg-…` se escuchan con `ref` + `addEventListener`; los atributos (`abierta`, `cuenta`, `filtros`) se pasan como texto. Los componentes **no mueven** los hijos del autor (solo añaden los suyos delante o detrás), así que React puede seguir gestionándolos.

Tema: `<html data-theme="light|dark">` fuerza uno; sin él, el del sistema. Textos internos (Cerrar, Deshacer, Más, Filtros…) en es o en según `<html lang>`, y cambian solos si cambia.

## Variables

`--cg-fondo`, `--cg-superficie`, `--cg-superficie-2`, `--cg-texto`, `--cg-tenue`, `--cg-borde`, `--cg-acento` (+ `-claro`, `-texto`, `-suave`), `--cg-ok`, `--cg-mal`, `--cg-esp-1…6`, `--cg-radio(-chico|-grande)`, `--cg-sombra(-media|-alta)`, `--cg-tactil: 44px`, `--cg-tactil-principal: 48px`, `--cg-seguro-abajo`, `--cg-rapido`/`--cg-medio` (casi 0 con `prefers-reduced-motion`). Lo que ocupan las barras fijas: `--cg-ocupa-abajo` y `--cg-ocupa-izq` (el `<body>` ya recibe ese relleno). Clases sueltas: `.cg-boton` (`--principal`, `--peligro`, `--fantasma`, `--icono`).

## Componentes

| Componente | Uso |
| --- | --- |
| `<cg-barra-inferior>` | Hijos `<a data-icono="biblioteca" data-activo>Biblioteca</a>` (4–5). Los que llevan `data-mas` van a la hoja «Más» en el móvil y bajo un separador en la barra lateral. `[data-marca]`: logo, solo en escritorio. ≤ 768 px abajo; más ancho, lateral plegable (`plegada`, se recuerda). `activar(elemento|href)`. |
| `<cg-cabecera titulo="…">` | Fila de 48 px con el título (o un `<h1>` hijo) y los demás hijos como acciones. `atras` añade «Atrás» (evento cancelable `cg-atras`, si no `history.back()`). En el móvil se esconde al bajar y vuelve al subir; `fija` lo evita; `desplaza="#sel"` si lo que se desplaza no es la ventana. |
| `<cg-hoja titulo="…">` | Hoja inferior modal (centrada en escritorio). `abrir()`, `cerrar()`, atributo `abierta`; eventos `cg-abrir`/`cg-cerrar`. Hijo `slot="pie"` fijo abajo. Asa para arrastrar, Escape, velo, foco atrapado y devuelto, 90 dvh con desplazamiento interno. |
| `cgAviso(texto, {deshacer, accion: {texto, fn}, duracion, tipo})` | Aviso abajo, encima de la barra. `tipo`: `info`, `ok`, `error` (no se cierra solo, `role="alert"`). Con `deshacer`, botón «Deshacer» y 6 s. Devuelve `{cerrar(), elemento}`. Crea `<cg-aviso>` (región `aria-live`) si no existe. |
| `cgConfirmar({titulo, texto, aceptar, cancelar, peligro, mantener})` | `Promise<boolean>`. `mantener`: el botón exige 1,5 s pulsado (ratón, dedo, Espacio o Intro). Con `peligro` el foco empieza en «Cancelar». En el móvil sale abajo con botones a todo lo ancho. |
| `<cg-dialogo>` | El diálogo de `cgConfirmar`, también usable a mano: `abrir()`, `cerrar(valor)`; un botón con `data-valor` lo cierra y pasa `{valor}` en `cg-cerrar`. |
| `<cg-chips filtros="N" [unico]>` | Fila deslizable de `<button>`; estado en `aria-pressed` (inicial con `data-activo`). Eventos `cg-cambio` (cancelable, antes) y `cg-cambiado` (`{chip, activo, activos}`). Con `filtros`, botón final «Filtros» con la cuenta, que emite `cg-filtros`. |
| `<cg-barra-accion cuenta="N">` | Barra de selección: «✕ · N seleccionados · acciones». Se abre con `cuenta > 0` y entonces oculta `<cg-barra-inferior>` (clase `cg-seleccionando` en `<html>`). Hijos `<button data-icono="papelera" [data-peligro]>`. «✕» emite `cg-cancelar` (cancelable; si no, pone la cuenta a 0). |
| `cgSeleccion(contenedor, {item, clave, alCambiar, espera, desplaza})` | Pulsación larga (500 ms) entra en modo selección; en modo, un toque alterna; mantener y arrastrar marca el rango (con autodesplazamiento); mayúsculas+clic rango, Ctrl/Cmd+clic alterna; Escape sale. Devuelve `{claves, cuenta, modo, elementos, seleccionar(lista, si), poner(lista), alternar(x), todos(), limpiar(), destruir()}`. La selección va por `clave` (por defecto `data-id`), así sobrevive a repintados y puede incluir lo no cargado (`poner(ids)`). |

También: `window.cg = {version, aviso, confirmar, seleccion, icono, iconos, textos, t}` y `cgIcono(nombre)`, con iconos para los destinos de las tres apps (`biblioteca`, `limpiar`, `reels`, `personas`, `buscar`, `actividad`, `ajustes`, `papelera`, `revisar`, `apartar`, `etiqueta`, `carpeta`, `mover`…). Un nombre desconocido se pinta como texto (p. ej. un emoji).

## Notas

- `position: fixed` falla dentro de un antepasado con `transform` o `filter`: pon hojas y barras fuera de esos contenedores.
- Los elementos seleccionables reciben `aria-selected`; dales `role="option"` o `role="gridcell"` si la lista lo admite.
- Prueba: `pytest -m interfaz tests/test_cg_ui.py` (Playwright a 390×844 y 1280×800, claro y oscuro).
