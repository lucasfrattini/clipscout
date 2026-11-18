# cg-ui — paquete común de interfaz de Clipgeist

Componentes de interfaz compartidos por clipkeeper, clipscout y clonbuster (SU-17). Sin dependencias ni compilación: un `.css`, un `.js` (script clásico que registra *custom elements* sin shadow DOM) y una página de muestra, `cg-ui.html`.

## Regla de copia idéntica

- Se copian `cg-ui.css` y `cg-ui.js` (y, si se quiere la muestra, `cg-ui.html`, `cg-ui-muestra.css` y `cg-ui-muestra.js`).
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
- **clipkeeper (React)**: `frontend/public/cg/`, las dos líneas en `index.html`, y tipos en `frontend/src/cg.d.ts`. En React 18, en los *custom elements* se escribe **`class=`** y no `className=` (con los *custom elements* React 18 pasa las propiedades como atributos y no siempre traduce `className`). Los eventos `cg-…` se escuchan con `ref` + `addEventListener`; los atributos (`abierta`, `cuenta`, `filtros`) se pasan como texto. Los componentes **no mueven** los hijos del autor (solo añaden los suyos delante o detrás), así que React puede seguir gestionándolos.

Tema: `<html data-theme="light|dark">` fuerza uno; sin él, el del sistema. Textos internos (Cerrar, Deshacer, Más, Filtros…) en es o en según `<html lang>`, y cambian solos si cambia.

## Variables

`--cg-fondo`, `--cg-superficie`, `--cg-superficie-2`, `--cg-texto`, `--cg-tenue`, `--cg-borde`, `--cg-acento` (+ `-claro`, `-texto`, `-suave`), `--cg-ok`, `--cg-mal`, `--cg-esp-1…6`, `--cg-radio(-chico|-grande)`, `--cg-sombra(-media|-alta)`, `--cg-tactil: 44px`, `--cg-tactil-principal: 48px`, `--cg-seguro-abajo`, `--cg-rapido`/`--cg-medio` (casi 0 con `prefers-reduced-motion`). Lo que ocupan las barras fijas: `--cg-ocupa-abajo` y `--cg-ocupa-izq` (el `<body>` ya recibe ese relleno). Clases sueltas: `.cg-boton` (`--principal`, `--peligro`, `--fantasma`, `--icono`).

## Componentes

| Componente | Uso |
| --- | --- |
| `<cg-barra-inferior>` | Hijos `<a data-icono="biblioteca" data-activo>Biblioteca</a>` (hasta 6 visibles en el móvil: a 390 px miden 65 px, etiqueta en una línea). Los que llevan `data-mas` van a la hoja «Más» en el móvil y bajo un separador en la barra lateral; el botón «Más» se coloca **justo detrás del último `data-mas`**, así que un destino escrito después (el acceso a las otras apps: `<button data-icono="apps">Apps</button>`, que abre una `cg-hoja`) sigue siendo el último de la barra, también en escritorio. `[data-marca]`: logo, solo en escritorio. `data-aviso` en un destino (o su alias `data-punto`): punto de aviso sobre su icono, también en la barra lateral de escritorio (p. ej. «Apps» con una versión nueva); para los lectores de pantalla se añade tras el nombre su valor o, si va vacío, «hay novedades». Un destino con aviso dentro de «Más» lo pone también en «Más». El componente marca el destino con `data-cg-aviso` (el que usa la hoja de estilos). ≤ 768 px abajo; más ancho, lateral plegable (`plegada`, se recuerda). `activar(elemento|href)`. |
| `<cg-cabecera titulo="…">` | Fila de 48 px con el título (o un `<h1>` hijo) y los demás hijos como acciones. `atras` añade «Atrás» (evento cancelable `cg-atras`, si no `history.back()`). En el móvil se esconde al bajar y vuelve al subir; `fija` lo evita; `desplaza="#sel"` si lo que se desplaza no es la ventana. |
| `<cg-hoja titulo="…">` | Hoja inferior modal (centrada en escritorio). `abrir()`, `cerrar()`, atributo `abierta`; eventos `cg-abrir`/`cg-cerrar`. Hijo `slot="pie"` fijo abajo. Asa para arrastrar, Escape, velo, foco atrapado y devuelto, 90 dvh con desplazamiento interno. |
| `cgAviso(texto, {deshacer, accion: {texto, fn}, duracion, tipo})` | Aviso abajo, encima de la barra. **Uno solo a la vez**: el nuevo sustituye al anterior (y su «Deshacer» se pierde). `tipo`: `info`, `ok`, `error` (no se cierra solo, `role="alert"`). Con `deshacer`, botón «Deshacer» y 6 s. Devuelve `{cerrar(), elemento}`. Crea `<cg-aviso>` (región `aria-live`) si no existe. |
| `cgConfirmar({titulo, texto, aceptar, cancelar, peligro, mantener})` | `Promise<boolean>`. `mantener`: el botón exige 1,5 s pulsado (ratón, dedo, Espacio o Intro). Con `peligro` el foco empieza en «Cancelar». En el móvil sale abajo con botones a todo lo ancho. |
| `<cg-dialogo>` | El diálogo de `cgConfirmar`, también usable a mano: `abrir()`, `cerrar(valor)`; un botón con `data-valor` lo cierra y pasa `{valor}` en `cg-cerrar`. |
| `<cg-chips filtros="N" [unico]>` | Fila deslizable de `<button>`; estado en `aria-pressed` (inicial con `data-activo`). Eventos `cg-cambio` (cancelable, antes) y `cg-cambiado` (`{chip, activo, activos}`). Con `filtros`, botón final «Filtros» con la cuenta, que emite `cg-filtros`; va fijo a la derecha, no es punto de encaje y no deja asomar ningún chip a su derecha. |
| `<cg-barra-accion cuenta="N">` | Barra de selección: «✕ · N seleccionados · acciones». Se abre con `cuenta > 0` y entonces oculta `<cg-barra-inferior>` (clase `cg-seleccionando` en `<html>`). Hijos `<button data-icono="papelera" [data-peligro]>`; cada uno recibe `aria-label` con su nombre. Con 5 acciones o más, en el móvil pasan a solo iconos (`data-compacta`). «✕» emite `cg-cancelar` (cancelable; si no, pone la cuenta a 0). |
| `cgSeleccion(contenedor, {item, clave, alCambiar, espera, desplaza, lista})` | Pulsación larga (500 ms) entra en modo selección; en modo, un toque alterna; mantener y arrastrar marca el rango (con autodesplazamiento); mayúsculas+clic rango, Ctrl/Cmd+clic alterna; Escape sale. Con `lista: true` (filas), la selección es solo fondo y borde: ni encoge ni pinta el círculo. Devuelve `{claves, cuenta, modo, elementos, seleccionar(lista, si), poner(lista), alternar(x), todos(), limpiar(), destruir()}`. La selección va por `clave` (por defecto `data-id`), así sobrevive a repintados y puede incluir lo no cargado (`poner(ids)`). |

También: `window.cg = {version, aviso, confirmar, seleccion, icono, iconos, textos, t}` y `cgIcono(nombre)`, con iconos para los destinos de las tres apps (`biblioteca`, `limpiar`, `reels`, `personas`, `buscar`, `actividad`, `ajustes`, `papelera`, `revisar`, `apartar`, `etiqueta`, `carpeta`, `mover`, `deshacer`, `lista`, `anadir`…). Un nombre desconocido se pinta como texto (p. ej. un emoji).

## Versiones

- **1.4.0** (clonbuster 0.23.0): `data-aviso` (alias `data-punto`) en los destinos de `<cg-barra-inferior>`: punto de aviso en la barra inferior y en la lateral, en la hoja «Más» y en el botón «Más» si lo lleva alguno de los que guarda; «hay novedades» para lectores de pantalla. Texto común `novedad`. Sin otros cambios de API.
- **1.3.0** (clonbuster 0.21.0): un solo aviso a la vez (el nuevo sustituye al anterior; los errores tampoco se apilan y siguen sin cerrarse solos); «Más» se coloca tras el último `data-mas`, así el acceso «Apps» puede ser el último botón; 6 destinos caben a 390 px (65 px, etiqueta entera en una línea); `cg-chips`: «Filtros» sin encaje y sin chip asomando a su derecha; `cg-barra-accion`: `aria-label` en cada acción, solo iconos en el móvil con 5 o más, y en escritorio centrada en el hueco a la derecha de la barra lateral; LEEME: `class=` en React 18.
- **1.2.0** (clonbuster 0.20.0): `<cg-chips filtros="0">` ya no pinta «Filtros null»; el logo `[data-marca]` no cuenta como destino de `<cg-barra-inferior>` (ni `activar()` lo marca ni lleva icono); `cgSeleccion(…, {lista: true})` para filas (sin encoger ni círculo: fondo y borde, la casilla la pone la app); la muestra lleva su estilo y su script en `cg-ui-muestra.css` / `cg-ui-muestra.js` (vale con CSP estricta).
- **1.1.0**: iconos `deshacer`, `lista` y `anadir`. Sin cambios de API ni de estilos.
- **1.0.0**: primera versión (SU-17).

## Notas

- `position: fixed` falla dentro de un antepasado con `transform` o `filter`: pon hojas y barras fuera de esos contenedores.
- Los elementos seleccionables reciben `aria-selected`; dales `role="option"` o `role="gridcell"` si la lista lo admite.
- Prueba: `pytest -m interfaz tests/test_cg_ui.py` (Playwright a 390×844 y 1280×800, claro y oscuro).
