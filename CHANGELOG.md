# Cambios

## 2.20.0 — cómoda con una mano (fase 3)

- **Navegación nueva**: **Buscar · Actividad · Ajustes**, abajo en el móvil y como barra lateral
  en escritorio, con el paquete común de interfaz de Clipgeist (`public/cg/`, copia idéntica de
  la de clonbuster). Cada pantalla tiene una cabecera de una fila que se esconde al bajar.
- **Actividad** reúne lo que antes estaba en tres sitios: la cola de búsquedas, los paquetes
  mandados a JDownloader y las búsquedas programadas (alta y edición en una hoja).
- **Buscar**: la caja va arriba; sitios, páginas y «Varias búsquedas» en «Opciones»; los filtros
  en una hoja («Filtros (N)») y fuera solo los activos, cada uno con su ✕. Una marca por sitio con
  su recuento y su estado sustituye a la lista de progreso y a las pestañas por sitio.
- **Lista compacta** (unas ocho filas por pantalla, antes ninguna entera) con **selección
  múltiple**: pulsación larga o la casilla; abajo, **Descargar**, **Todos** y **Quitar** (con
  «Deshacer»). Ver, abrir, descargar y el álbum, en el «⋯» de cada fila.
- **«Ya lo tengo»** y **lo ya enviado** se ocultan por defecto, con su contador, y nunca entran en
  «Descargar todo». Lo enviado se recuerda en el servidor (`POST /api/ajustes/jdownloader/enviados`,
  ruta nueva).
- La lista ya no se rehace entera con cada tanda de resultados: reutiliza las filas.
- **Ajustes** de 9 secciones a 4 (**Búsqueda · Descargas · Clipgeist · Sistema**); en el móvil, una
  lista y una pantalla por sección. **Sitios**: una fila por sitio con interruptor grande («buscar
  por defecto») y «⋯» con editar, fichero directo y **borrar**.
- **Avanzado** sale del menú: es el **editor de sitio** (Ajustes → Búsqueda → Sitios → ⋯ → Editar).
- Los iconos de las otras apps (en el logo) usan la dirección desde la que se ve la página: desde
  el móvil ya abren.
- Ningún control mide menos de 44 px en el móvil; lo irreversible (borrar un sitio, quitar una
  programada, vaciar el capturador, poner las cifras a cero) pide mantener pulsado.
- Ya no se pregunta «¿también en la web?» en cada búsqueda (es una casilla recordada en
  Opciones) ni se ve el aviso fijo de uso responsable (se acepta al entrar).

**Al actualizar**: no hay que hacer nada; búsquedas, programadas, paquetes y sitios siguen igual y
ninguna ruta de la API cambia. Dónde quedó cada cosa:

| Antes                                                      | Ahora                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| Avanzado (menú)                                            | Ajustes → Búsqueda → Sitios → ⋯ → Editar (o `#/explorer`) |
| Cola de búsquedas (en Buscar)                              | Actividad → Búsquedas                                     |
| Ajustes → JDownloader → paquetes                           | Actividad → Descargas                                     |
| Ajustes → Búsqueda → programadas                           | Actividad → Programadas                                   |
| Ajustes → Sitios, Búsqueda (web)                           | Ajustes → Búsqueda                                        |
| Ajustes → JDownloader                                      | Ajustes → Descargas                                       |
| Ajustes → Conexiones, clave de API                         | Ajustes → Clipgeist                                       |
| Ajustes → General, Seguridad, Copia, Apariencia, Acerca de | Ajustes → Sistema                                         |
| Iconos de las apps, «?», «Salir» (cabecera)                | Logo de clipscout (arriba a la derecha)                   |
| Filtros de resultados                                      | Botón «Filtros»                                           |
| Sitios de la búsqueda, páginas, «Varias búsquedas…»        | Botón de opciones junto a la caja                         |
| «▶ Ver», «Abrir», «⬇ Descargar», «✕» de cada tarjeta       | «⋯» de cada fila                                          |

Las direcciones viejas (`#/ajustes/sitios`, `#/ajustes/jdownloader`…) llevan a la sección nueva.
Los sitios que tenías apagados en Buscar en este navegador siguen apagados para esa búsqueda.

## 2.19.0 — Windows, instalador y primer arranque (fase 2)

- **Apagado ordenado**: `POST /api/apagar` (sesión, clave de administración, o el propio equipo con
  `X-Clipgeist: 1`) deja de aceptar trabajo nuevo, espera a lo que se está guardando (60 s como
  mucho), guarda la cola de búsquedas para retomarla y sale con 0. SIGTERM hace lo mismo.
  `GET /api/estado-trabajos` dice si hay algo en marcha. El instalador de Windows lo pide antes de
  tocar nada y solo mata si no responde en 75 s.
- **Asistente de primer arranque** (solo en instalaciones nuevas): usuario (o la misma cuenta que
  otra app de Clipgeist), JDownloader, de 1 a 3 sitios con alta automática, conectar las otras
  apps y un QR para abrirlo desde el móvil (generado en el navegador, sin CDN).
- **`DATA_DIR` es la carpeta de todo**: con él, `crew.json` y `profiles.json` van dentro. Sin él,
  nada cambia. Nunca se copia ni mueve nada solo: si el `data/` del programa tiene uno y la
  carpeta nueva no, se avisa en el registro.
- **Componentes fijados**: Node.js, el navegador interno (el mismo Chrome que espera Puppeteer, ya
  incluido en el paquete) e Inno Setup con versión y sha256 en `empaquetado/componentes.txt`; si
  no coincide, la compilación se aborta. Imagen Docker con Node fijado (22.23.0).
- **Licencias de terceros**: `TERCEROS.txt` en el paquete y en la imagen; **Ajustes → Acerca de**.
- **Windows**: guardados con reintentos también al apagar; prueba de que ningún proceso abre
  ventana; la batería de pruebas corre también en Windows (CI).
- **Prueba de humo** con navegador: `npm run e2e` (asistente → buscar en un sitio falso → enviar a
  una cola falsa).

**Al actualizar**: no hay que hacer nada. Con usuario ya creado el asistente no aparece; la
`X-Api-Key`, la cola y las programadas siguen igual. En Docker sin `DATA_DIR` los ajustes siguen en
`data/crew.json`. Si arrancas con `DATA_DIR` pero sin `CREW_PATH`, mira el registro: si avisa,
copia tú `crew.json` y `profiles.json` a esa carpeta (o define `CREW_PATH` y `PROFILES_PATH`).

## 2.18.0 — seguridad (fase 1, común a las tres apps)

- **Claves**: la clave de API pasa a ser la **clave de administración** (mismo valor; sigue abriendo
  toda la API para tus scripts). Cada conexión usa ahora su propia **clave de conexión** (`cgc_…`),
  que solo abre las rutas del protocolo que necesita la otra app y se revoca en Ajustes →
  Conexiones.
- **Sesiones en el servidor**: «Salir» la cierra de verdad, cambiar la contraseña cierra las demás y
  Ajustes → Seguridad lista las sesiones abiertas. Entrar en una app vale en las otras conectadas.
- **Peticiones de otras webs y nombres de host**: se rechaza lo que cambia algo si no viene de la
  propia app, y los nombres desconocidos (421; se añaden en `CLIPGEIST_HOSTS`).
- **Primer arranque**: sin usuario solo se atiende al propio equipo; desde otro hace falta el
  código que se escribe en el registro. Aviso si se entra desde internet sin cifrar.
- **Navegador interno**: no puede alcanzar la red local, va aislado fuera de Docker, con un perfil
  nuevo cada vez y sin extensiones.
- **Ficheros**: carpeta de datos 700 y ficheros 600; la copia que se descarga va sin contraseña ni
  claves. HTTP Basic ya no se acepta.

**Al actualizar**: no hay que hacer nada. La sesión abierta se canjea sola por una nueva, la
`X-Api-Key` de siempre sigue valiendo, las conexiones se pasan solas a claves de conexión en cuanto
la otra app también esté actualizada (hasta entonces siguen como estaban) y las búsquedas en cola y
programadas siguen. Si entras por un nombre con dominio público (no por IP ni por un nombre de
la red local), añádelo a `CLIPGEIST_HOSTS`.

## 2.17.0

- **Acceso**: HTTP Basic cuenta los fallos con el mismo contador que el formulario (8 fallos → 429
  durante 5 min) y la contraseña se comprueba sin bloquear el servidor.
- **Ajustes dañados**: si `crew.json` no se puede leer se recupera `crew.json.bak` (el dañado queda
  como `.corrupto-<fecha>`); sin copia buena la app queda cerrada (503) y no se sobrescribe nada.
  Todos los `data/*.json` se escriben con temporal único + rename y guardan la versión anterior.
- **Programadas**: el mismo vídeo ya no se manda varias veces (misma ficha escrita de otra forma,
  o repetido en varios sitios), ni en la misma vuelta ni en las siguientes.
- **Programadas**: lo ya enviado sale de `crew.json` a `data/programadas-enviados.json` (se migra
  solo al arrancar) y entra en las copias diarias.
