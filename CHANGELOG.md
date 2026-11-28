# Cambios

## 2.28.8

- **Enlaces de salto**: si un agregador enlaza un salto por su servidor («/out/?l=…», «/go?url=…») con la
  ficha de verdad dentro (en claro o en base64), se manda esa ficha al gestor de descargas. Antes el salto no
  se abría (suele tener una comprobación anti-robots) y el vídeo se perdía.
- **Nada se pierde en silencio**: si al terminar un paquete alguna ficha nunca entró en JDownloader, se
  intenta una vez más (la ficha de dentro del salto, o el fichero directo). Si sigue faltando, el paquete queda
  **incompleto**, con aviso («Descarga incompleta: … 3 de 21 no entraron») y «Reintentar» en Actividad.

## 2.28.7

- **Personas en la ficha** (Ajustes → Sitios → «⋯»): al mandar un vídeo de un sitio con esta opción, clipscout
  abre su página y pasa a clipkeeper las personas que nombra (autora y reparto de sus datos estructurados y,
  opcionalmente, los de un selector CSS). El vídeo llega ya con su actriz. Se hace en segundo plano: el envío
  no tarda más.

## 2.28.6

- **Enviar a descargar ya no se queda colgado** con una lista larga: las miniaturas se piden solo las que se ven y
  de 4 en 4. Antes salían cientos de golpe y cualquier otra acción (elegir carpeta y enviar, abrir una ficha)
  esperaba detrás de todas: 5–8 s por VPN, más en el iPhone.

## 2.28.5

- **Más rápida por VPN o datos**: la interfaz (scripts, estilos y la página) va comprimida con gzip, unas 4
  veces menos que bajar.
- **Buscar, más rápido**: 6 sitios a la vez en vez de 3 (cada sitio es otro dominio: el freno por dominio sigue
  igual). Se cambia en Ajustes → Búsqueda web → «Sitios a la vez al buscar».

## 2.28.4

- Buscar en el móvil: la línea de «N resultados · N ya enviados · Recoger» ya no se parte en dos (bajaba el botón
  de la vista y empujaba los resultados); los textos se recortan con «…».
- Editor de sitio en el móvil: «Que lo configure por mí» vuelve a ir debajo de la dirección (el campo quedaba
  aplastado).
- Actividad: la cabecera con «Limpiar» no baja la lista.
- Al apagar, se guardan también los eventos que un guardado en curso aún no había escrito (antes podía perderse
  lo ya visto de una búsqueda a medias).
- CI: `.gitattributes` para que Windows no cambie los finales de línea de cg-ui; la prueba de humo, al día con la
  barra y la cabecera nuevas.

## 2.28.3

- Búsquedas de varias palabras en sitios que ponen el término en la ruta (`/search/<término>/`): nuevo marcador
  `{q:guion}` («Ana Pérez» → `ana-perez`). Con el espacio codificado esos sitios respondían 403 y daban 0
  resultados. El alta automática de sitios ya lo usa en la ruta (y lo prueba así).

## 2.28.2

- iPhone: «Borrar el historial» (y los recientes) responden al toque; antes la lista se escondía al perder
  el foco la caja, antes de que llegara el toque.
- Si una pantalla no carga, lo dice en la propia pantalla, con el motivo y «Recargar», en vez de quedarse en
  blanco; y los errores del navegador quedan en el registro del servidor (en el móvil no hay consola).

## 2.28.1

- **Gestos** (cg-ui 1.5.0): las hojas se cierran arrastrando hacia abajo también desde su contenido; en
  Actividad → Descargas, deslizar a la derecha reintenta un paquete con fallos.
- Texto tenue con más contraste (5,5:1), campos a 16 px en el móvil (sin zoom al escribir) y escala de letra
  común.

## 2.28.0

Auditoría de UX (clipscout):

- **Barra**: «Avanzada» se llama **Explorar** y «Apps» pasa a **Más** (apps, guía y salir). El pie de estado
  solo aparece si algo falla.
- **Buscar**: una sola cruz al escribir (la de «Limpiar»); «Filtros» y la lupa sin relleno oscuro; «Borrar el
  historial» con Deshacer; sin botones repetidos en el inicio; en Filtros la profundidad manda y las páginas
  exactas quedan en «Avanzado»; la vista (grandes o lista) en un botón junto a los resultados.
- **Resultados**: la casilla solo al seleccionar (mantener pulsado) o con el ratón encima; una línea de
  datos (sitio, repetidos, álbum); sin emoji.
- **Explorar**: la tarjeta de resultados solo cuando hay resultados, con los filtros plegados en «Filtrar» y
  exportar y copiar en «⋯»; guardar, borrar y compartir una configuración en «⋯»; el editor de un sitio dice
  su nombre en el título; carril de pasos de una línea en el móvil; toques de 44 px.
- **Analizar enlace** (antes «Vídeos»): el botón siempre a la vista en el móvil.
- **Actividad**: el aviso de sitios sin resultados en una línea; descargas con una línea de datos y «⋯»
  (reintentar, carpeta); el punto rojo se apaga al entrar; fechas en tu idioma y sin segundos.
- **Ajustes**: en el móvil, secciones sin marco doble y los sitios sin cifras (en el «⋯»).
- Botones de una sola familia (`cg-boton`) y cg-ui 1.5.0 (iconos, foco, casillas de 22 px).

## 2.27.0

- **«Limpiar» en Buscar**: una × junto a la caja vacía lo escrito y lo que se ve; al volver a Buscar ya no
  aparece la última búsqueda (sigue en Actividad y, si estaba en marcha, sigue buscando).
- **«Limpiar» en Actividad**: borra las búsquedas terminadas (pestaña Búsquedas) y los avisos (pestaña Avisos).
- **Descargar y subir la configuración de sitios** (Ajustes → Sitios): un fichero con todos los sitios y sus
  opciones, para pasárselo a otra persona. Al subirlo se suman los que faltan; los que ya tienes se pueden
  reemplazar o dejar como están.
- **Más sitios que dan resultados**: se leen también los vídeos que el reproductor declara dentro de un script
  (antes solo salían los anuncios de esas fichas), y un sitio puede entregar la propia ficha cuando firma sus
  ficheros (opción `fichaComoFichero`: el gestor de descargas la resuelve).
- Las estadísticas de un sitio se pueden poner a cero solas (para que vuelva a probarse uno que se saltaba).
- **Todo desde la app**: en Ajustes → Sitios → ⋯, «Pasar la página a JDownloader» y «Poner sus cifras a cero»;
  en Ajustes → JDownloader, **Calidad por sitio** (los ajustes de calidad del plugin de cada sitio en
  JDownloader: solo la mejor, calidad preferida, formatos). El alta automática prueba sola a pasar la página
  cuando el sitio no da ficheros y JDownloader tiene un plugin para él.

## 2.26.0

- **Buscar mucho más rápido**: las fichas de vídeo se abren en el navegador sin bajar la página entera (antes
  hasta 12 s por ficha) y el navegador usa 4 pestañas en vez de 2. Una búsqueda que antes revisaba 12 fichas
  de un sitio en 2 minutos ahora revisa 30 en unos 40 s.
- **Se saltan los sitios que nunca dan nada**: con 20 búsquedas o más y ningún resultado, el sitio sale como
  «Nunca dio resultados: se salta» en vez de abrir decenas de fichas para nada (`BUSQUEDA_MIN_BUSQUEDAS_MUERTO`,
  0 = nunca). Vuelve a buscarse al poner las estadísticas a cero en Ajustes → Sitios.

## 2.25.4

- **Fotos de una persona juntas en `<persona>/Fotos`**: cada álbum sigue siendo un paquete, pero ya no
  crea su propia subcarpeta.
- **Scroll en el iPhone** (Safari y Chrome): sin `overscroll-behavior` en html/body (en WebKit enganchaba el
  desplazamiento, sobre todo en la app de la pantalla de inicio); el bloqueo de la página con un
  modal abierto depende de los modales abiertos de verdad, no de un contador que podía quedarse
  descuadrado y dejar la página sin desplazarse.
- **Confirmar un borrado es un toque** en el diálogo: ya no hay que mantener pulsado.

## 2.25.3

- cg-ui común: deslizar ya no dispara «mantener para seleccionar», sin nada marcado se sale del modo
  selección y el desplazamiento no espera al JS en el iPhone.

## 2.25.2

- **Aviso a clipkeeper al terminar un paquete, también con JDownloader que borra lo terminado de la
  lista**: antes el paquete nunca llegaba a «terminado» (desaparecía de la lista sin verse acabado) y
  clipkeeper no escaneaba la carpeta. Ahora un envío que ya no está ni en el capturador ni en
  descargas, pasados 3 minutos (`JD_DESAPARECIDO_TERMINADO_MS`), se da por terminado.
- El capturador se consulta también por nombre y carpeta del paquete (no solo por trabajo).

## 2.25.1

- **Lo enviado pasa solo a descargas también en JDownloader que no filtran por trabajo**: algunas
  versiones devuelven una lista vacía al pedir los enlaces de un envío (`jobUUIDs`), y todo se
  quedaba en el capturador. Ahora se buscan los paquetes de ese envío por nombre y carpeta.
- Álbumes: fuera las imágenes de la propia web (fondos, logos) cuando las fotos vienen de otro servidor.
- `POST /api/fotos/mandar` acepta la persona como texto además de `{nombre}`.

## 2.25.0 — fotos por persona y completar por persona (fase 7)

- **Fotos** (Buscar → «Fotos»): los álbumes de lo buscado en los sitios que tienen sección de
  álbumes —se configura en Ajustes → Sitios → ⋯ → «Álbumes de fotos», con una dirección con `{q}`
  como la de vídeos; un sitio sin ella no sale— y, si hay SearXNG, en la web (solo resultados que
  nombran a la persona; palabra extra opcional en Ajustes → Búsqueda, de fábrica ninguna). Cada
  álbum con portada, nº de fotos, sitio y «ya lo tienes / faltan fotos / en camino».
- **Mandar a una persona**: se elige la persona de clipkeeper y cada álbum va en su paquete a
  `<carpeta de la persona>/Fotos/<álbum>`, con las fotos a tamaño completo (se recorre la
  paginación del álbum; fuera miniaturas, iconos y anuncios). Como siempre, clipscout no descarga:
  manda enlaces directos al gestor.
- **Ingreso con metadatos**: cada envío al gestor (Buscar, Recoger, programadas, fotos, mejorar y
  volver a descargar) avisa a clipkeeper de lo que va a llegar —título, personas (por el término,
  el título y sus alias), etiquetas, duración y página de origen— para que la ficha nazca completa.
- **Alias**: si lo buscado es una persona de clipkeeper, se busca también por sus alias, «Recoger»
  los acepta como su nombre y se propone su carpeta como destino.
- **Seguir a una persona** (desde clipkeeper o desde Actividad → Programadas → «Seguir a una
  persona»): una programada de Recoger con todos sus alias a su carpeta; grupo «Seguidas» con la
  próxima vuelta y lo último mandado, y avisos con los títulos.
- **Para clipkeeper**: mejorar calidad (busca la misma escena en más resolución), volver a
  descargar un fichero roto desde su origen y «cuántos tiene cada sitio» de un término.
- Las conexiones HTTP se mantienen 65 s (Safari daba «Load failed» al reutilizar una cerrada).

**Al actualizar**: no hay que hacer nada; ninguna ruta cambia. Rutas nuevas del protocolo:
`/api/crew/v1/seguir` (POST, GET, DELETE `/{id}`), `/mejorar` (POST, GET `/{trabajo}`, POST
`/{trabajo}/enviar`), `/reenviar` y `/recuento` (también con la clave de conexión). clipscout llama a
clipkeeper a `GET /personas` y `POST|GET /esperados`: con un clipkeeper anterior a 0.37 (404) todo
sigue como antes, sin metadatos ni lista de personas. Interfaz: `/api/ajustes/personas`,
`/api/fotos/*`, `/api/seguidas` y `PUT /api/ajustes/sitios-albumes/{id}`. Campos nuevos opcionales
en la configuración de un sitio (`albumSearchUrl`, `albumLinkPattern`), en las programadas
(`alias`, `bibliotecaId`, `seguida`) y en Ajustes → Búsqueda (`palabraFotos`). Fichero nuevo en la
carpeta de datos: `fotos-enviadas.json`.

## 2.24.0 — funciones nuevas (fase 6)

- **Recoger** (en Buscar, junto a los resultados): de lo que encontró la búsqueda de una persona o
  un término, los N vídeos que llevan su nombre, que no tienes (se pregunta a clipkeeper; lo de su
  papelera tampoco vuelve), sin repetidos —también el mismo título en dos sitios— y los más largos
  o de más calidad. Se ve la lista antes de mandar, con un solo botón «Mandar N a <carpeta>», una
  etiqueta opcional y «Repetir cada semana».
- **Programadas** con la misma elección: «como mucho N», «solo con el nombre» y orden.
- **Avisos**: punto en Actividad y pestaña Avisos (programada que manda algo o falla, descarga
  terminada o con fallos, sitio roto, búsqueda larga terminada); en Ajustes → Sistema, además,
  notificaciones del navegador.
- **Proxy de salida en Ajustes** (Sistema), en caliente; «Probar» dice con qué dirección sales.
- **Historial**: «Recientes» en Buscar, a un toque. **Copiar** lo seleccionado (enlaces, .txt o
  .csv). **Compartir** un enlace desde el móvil a clipscout (instalada como app).
- **Búsqueda web**: si no hay buscador, se explica cómo ponerlo en vez de esconder la opción.
- **Suite**: contrato común sin fallos ni avisos; «Permitir acceso desde otros dispositivos» en el
  asistente de escritorio; desinstalar la app suelta no toca la suite.
- Seguridad: sin el nombre de usuario sin sesión, cabeceras de aislamiento, enlaces solo http(s),
  contador de intentos que no se vacía entero; la guía de JDownloader limita su API al equipo de
  clipscout.

**Al actualizar**: no hay que hacer nada; ninguna ruta de antes cambia y `detail` sigue en todos
los errores. Cambia: `GET /api/crew/v1/status` **sin clave** responde (solo app y versión; con
una clave mala, 401 como antes); las copias de la suite dan `copia_no_valida`, `copia_de_otra_app`
y `copia_mas_nueva` (antes `copia_invalida` y `version_mas_nueva`); renovar una conexión con otra
URL da 403; borrar una conexión que no existe da 404; el diagnóstico nombra `conexion:<app>`. Rutas
nuevas: `/api/recoger/propuesta`, `/api/avisos`, `/api/avisos/leidos`, `/api/buscar/historial`,
`PUT /api/ajustes/proxy`, `PUT /api/asistente/red`, `/api/auth/configurar` y `/compartir`. Ficheros
nuevos en la carpeta de datos: `avisos.json` e `historial.json`. Con clipkeeper anterior a 0.36,
Recoger pregunta vídeo a vídeo (como «ya lo tengo»). En Docker, el proxy de `OUTBOUND_PROXY` sigue
mandando mientras no guardes otro en Ajustes.

## 2.23.0 — un solo producto (fase 5)

- **Errores con código**: toda respuesta de error lleva `{codigo, detail, params}` y `detail` llega
  en el idioma de la petición (`Accept-Language`; español por defecto). La interfaz traduce por
  código. Un fallo no previsto da `error_interno` con una referencia que está también en el
  registro.
- **Diagnóstico** (Ajustes → Sistema): qué funciona y qué no (ajustes, carpeta de datos, navegador
  interno, **proxy de salida**, gestor de descargas y cada app conectada), las últimas líneas del
  registro y «Descargar informe» (un zip sin rutas, nombres de fichero ni claves). El registro va a
  `data/registro/` con rotación (5 MB × 3). `GET /api/salud` dice la verdad: `ok:false` si no puede
  trabajar.
- **Copia de Clipgeist**: un zip con sitios, ajustes, programadas y estadísticas para llevarte
  clipscout a otro equipo, sin contraseña ni claves; restaurarlo guarda antes lo actual y no
  cambia la contraseña ni las claves.
- **Versiones**: una vez al día se baja `clipgeist.com/versiones.json` (sin enviar nada; se puede
  apagar en Acerca de). Con versión nueva, un punto en «Apps» y la orden para actualizar en
  Docker; en Conexiones, aviso si otra app es demasiado antigua.
- **Qué sale de este equipo** (Acerca de): la lista de las conexiones salientes con lo que tienes
  configurado.
- **Instalable en el móvil**: manifiesto, iconos y color de la barra según el tema.
- **Más ligera al abrir**: solo el diccionario del idioma activo, módulos de arranque pedidos a la
  vez y logo a su tamaño (de 38 peticiones y 704 KB a 35 y 502 KB). Mantenimiento: `explorer.js`,
  `ajustes.js` y `main.css` partidos.

**Al actualizar**: no hay que hacer nada. Ninguna ruta cambia y `detail` sigue en todos los errores
(con `error` y `code` de antes); hay campos nuevos (`codigo`, `params`) y rutas nuevas
(`/api/salud`, `/api/diagnostico`, `/api/crew/v1/copia`, `/api/actualizaciones`,
`/api/privacidad`). La consulta de versiones queda **encendida**: la primera, unos minutos después
de arrancar; si no la quieres, apágala en Ajustes → Sistema → Acerca de. Aparece
`data/registro/clipscout.log`. Con una X-Api-Key mala, el 401 dice ahora `clave_invalida`.

## 2.22.0 — rápida y robusta (fase 4)

- **Proxy de salida caído, a la vista**: se prueba al arrancar, cada minuto y antes de buscar; si no
  responde, Buscar lo avisa, sus sitios fallan al momento (no a los 30 s) y Ajustes → Sistema tiene
  el estado y «Probar».
- **Sitio roto**: dos búsquedas seguidas sin nada lo marcan en Actividad y en Ajustes → Sitios, con
  «Volver a configurar» (alta automática que cambia su configuración sin moverlo de la lista).
- **Buscar con una mano**: deslizar una fila (izquierda la quita, con «Deshacer»; derecha la
  descarga), «Primeros» (los 5/10/20/50 primeros), profundidad **Rápida / Normal / A fondo**,
  «Descargar en» entero (antes «Pregun…») y la carpeta propuesta sola si lo buscado es una carpeta,
  persona o etiqueta de clipkeeper.
- **Búsquedas guardadas sin desgastar el disco**: `busquedas.json` es solo el índice y cada búsqueda
  añade sus eventos a `busquedas/<id>.jsonl` (3.000 resultados: de 53 MB escritos a 1,1 MB). Tras un
  reinicio se sigue **por la página y la ficha** donde iba cada sitio, identificado por su
  dirección (no por su posición); una programada en marcha se recoge en vez de repetirse.
- **Más rápida**: repetidos agrupados por cubos y en vivo (10.000 resultados de 1 s a 48 ms); «Ver»
  una búsqueda recibe lo ocurrido resumido; cada pantalla se carga al abrirla (al arrancar 36
  peticiones en vez de 54 y la mitad de JavaScript, sin llamadas repetidas); en escritorio, caché de
  miniaturas de 64 MB que se vacía sola.
- **JDownloader**: un enlace caído se sustituye tras varias revisiones (más si el estado puede ser
  pasajero) y se desactiva en vez de borrarse; con el gestor en pausa ya no se arranca al enviar.
- **Seguridad**: cada redirección se valida también con proxy de salida; las miniaturas y el vídeo
  pasan por clipscout solo con firma o desde los sitios configurados, con tope de tamaño y tiempo.
- Sesión caducada → pantalla de acceso y de vuelta a donde estabas. Errores de la API con un solo
  formato (`error` y `detail`). Restaurar una copia ya no recupera la contraseña antigua.
- Mantenimiento: lo que decide qué se ve en Buscar sale a un módulo propio con pruebas; la hoja
  «Apps» sale de Ajustes; arquitectura y especificación al día.

**Al actualizar**: no hay que hacer nada. `busquedas.json` se pasa solo al formato nuevo al
arrancar, sin perder la cola ni lo encontrado; si fuera ilegible se aparta como
`busquedas.json.corrupto-<fecha>`. Ninguna ruta cambia; hay rutas y campos nuevos
(`/api/ajustes/proxy`, `/api/sitios/reconfigurar`, `?resumen=1` en el stream de una búsqueda,
`thumbnailFirma`/`urlFirma` en los resultados). Quien pida `/api/thumbnail` o `/api/media` desde
fuera de la interfaz con direcciones de otros dominios necesita la clave de administración. El
stream de una búsqueda puede saltarse números de `seq` (eventos internos que no se mandan).

## 2.21.0 — ajustes de la fase 3 tras usarla en el iPhone

- **La página ya no se va sola hacia arriba** (iPhone). Las filas de resultados llevaban
  `content-visibility: auto`: en WebKit, sin anclaje del desplazamiento, las de fuera de pantalla
  medían lo estimado y no lo real, y cada fila rehecha por encima (duraciones, «ya lo tengo», lo
  enviado) movía la lista. Fuera; una prueba con WebKit emulando un iPhone lo vigila.
- **Barra: Buscar · Avanzada · Actividad · Ajustes · Apps.** Vuelve **Avanzada** (recorrer una
  página o un sitio, lo de la pestaña «Avanzado» de antes); el editor de un sitio sigue en Ajustes
  → Sitios → Editar. **Apps** es el último botón, como en clonbuster y clipkeeper: las otras apps,
  la guía y «Salir» (el logo ya no abre nada).
- **Un solo botón de filtros**, junto a la caja: «Filtros (N)» abre una hoja con **Qué buscar**
  (sitios, páginas, web, varias búsquedas, vista) y **Filtrar resultados**; N cuenta las dos.
- **Miniaturas grandes** por defecto: dos resultados por fila en el móvil (miniatura de ~180 px),
  casilla sobre la miniatura y «⋯» abajo. «Lista compacta» en Filtros, recordada en el dispositivo.
- **«Parar» para al instante**: la pantalla dice «Búsqueda parada» en el acto (antes el botón se
  rehacía con cada tanda y el toque se perdía en el iPhone) y el servidor la da por terminada ya,
  aunque un sitio no responda; corta también las páginas abiertas con el navegador.
- Paquete común cg-ui 1.3.0 (un solo aviso a la vez, barra con «Apps» al final).

**Al actualizar**: no hay que hacer nada; ninguna ruta de la API cambia. Si preferías la lista de
antes: Filtros → «Lista compacta».

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
