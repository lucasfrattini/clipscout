# Protocolo Clipgeist v1

Cómo se conectan entre sí las apps de **Clipgeist** (clipscout, clonbuster, clipkeeper). Cada app
es independiente — su base de datos, su contenedor — y habla con las demás solo por esta API.
Inspirado en cómo se enlazan Sonarr, Radarr y Prowlarr.

> Este documento es **idéntico en los tres repositorios** (clipscout, clonbuster y clipkeeper). Si el
> protocolo cambia, se cambia en los tres a la vez.

## Arquitectura de Clipgeist

```
                    ┌──────────────────────┐
                    │   clipscout  (:3001) │  busca vídeos en sitios web
                    └─────────┬────────────┘
           /api/crew/v1  ▲    │    ▲  /api/crew/v1
         ┌───────────────┘    │    └───────────────┐
         ▼                    ▼                    ▼
┌──────────────────────┐            ┌──────────────────────┐
│  clonbuster  (:8095) │◀──────────▶│  clipkeeper  (:8096) │
│  huellas, duplicados │ /api/crew  │  catálogo, reproduc- │
│  y papelera          │    /v1     │  tor, orden del disco│
└──────────────────────┘            └──────────────────────┘
```

- **Independientes**: cada app tiene su contenedor, su base de datos y su interfaz. Si una está
  apagada, las otras siguen funcionando.
- **Un dueño por dato**: clonbuster las huellas y los duplicados; clipkeeper los metadatos, los
  nombres y las carpetas; clipscout el origen de cada vídeo. Ninguna copia datos de otra: los pide.
- **Locales**: nada pasa por internet ni por servicios de terceros. Lo normal es que las tres vivan
  en la misma red (o el mismo servidor) y se hablen por la IP local.

## Identidad de cada app

Cada app tiene:

| Dato        | Ejemplo                    | Dónde se ve                                                         |
| ----------- | -------------------------- | ------------------------------------------------------------------- |
| `app`       | `clipkeeper`               | Fijo: `clipscout`, `clonbuster` o `clipkeeper`                      |
| `instancia` | `Biblioteca de casa`       | Ajustes → General (editable)                                        |
| `url`       | `http://192.168.1.10:8096` | Ajustes → General: la URL por la que **las otras apps** la alcanzan |
| `api_key`   | 32 caracteres hex          | Clave de administración: Ajustes → Seguridad (copiar / regenerar)   |

## Autenticación

Toda petición entre apps lleva una clave de la app **destino** en la cabecera `X-Api-Key`. Desde
la fase 1 de seguridad (clipscout 2.18) hay dos tipos, que se distinguen por el valor:

| Clave                 | Forma                               | Qué abre                                      | Dónde vive                                                                                                                          |
| --------------------- | ----------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **De administración** | 32 hex, sin prefijo (la de siempre) | Toda la API (scripts, como en las *arr)       | Ajustes → Seguridad. No se regenera sola.                                                                                           |
| **De conexión**       | `cgc_` + 32 bytes en base64url      | Solo `/api/crew/v1/*` de la lista de permisos | Una por app remota y sentido. La emite la app que **recibe** las llamadas y solo guarda su sha256; la que llama la guarda en claro. |

Sin clave o con clave incorrecta → `401`. Con una de conexión fuera de su lista → `403`. Se
comparan en tiempo constante.

**Lista de permisos de clipscout** con clave de conexión:

| Método   | Ruta                                    | Para qué                                                             |
| -------- | --------------------------------------- | -------------------------------------------------------------------- |
| `GET`    | `/api/crew/v1/status`                   | Probar la conexión                                                   |
| `GET`    | `/api/crew/v1/imagenes`                 | Fotos para clipkeeper                                                |
| `POST`   | `/api/crew/v1/conexiones`               | Solo la «vuelta» de una conexión que ya existe con esa app y esa URL |
| `POST`   | `/api/crew/v1/conexiones/renovar`       | Pasar a claves de conexión                                           |
| `POST`   | `/api/crew/v1/sesion/validar`           | Inicio de sesión único                                               |
| `POST`   | `/api/crew/v1/sesion/cerrar`            | «Salir» desde otra app                                               |
| `POST`   | `/api/crew/v1/seguir`                   | Seguir a una persona (fase 7, C4)                                    |
| `GET`    | `/api/crew/v1/seguir`                   | Personas seguidas (C4)                                               |
| `DELETE` | `/api/crew/v1/seguir/{id}`              | Dejar de seguir (C4)                                                 |
| `POST`   | `/api/crew/v1/mejorar`                  | Buscar mejor calidad (C5)                                            |
| `GET`    | `/api/crew/v1/mejorar/{trabajo}`        | Progreso y candidatos (C5)                                           |
| `POST`   | `/api/crew/v1/mejorar/{trabajo}/enviar` | Mandar los elegidos (C5)                                             |
| `POST`   | `/api/crew/v1/reenviar`                 | Volver a descargar (C6)                                              |
| `GET`    | `/api/crew/v1/recuento`                 | Cuántos tiene cada sitio de un término (C7)                          |

`GET /conexiones` y `DELETE /conexiones/{id}` piden la clave de administración. clipscout llama a
clipkeeper a `POST /buscar` («¿ya lo tengo?»), `GET /destinos`, `POST /reglas` y `POST /escanear`
(además de `status`, `conexiones`, `conexiones/renovar` y `sesion/*`) y, desde la fase 7, a
`POST /tengo`, `GET /personas` y `POST|GET /esperados`: esas tienen que estar en la lista de
permisos de clipkeeper.

### Alta, vuelta y renovación

- **Alta** (`POST /conexiones`, cuerpo `{app, nombre, url, clave}`; `api_key` se sigue aceptando
  como nombre antiguo de `clave`): con la clave de administración crea o actualiza la conexión;
  `clave` es con la que la receptora llamará a quien se registra. Respuesta
  `{id, creada, clave: "cgc_…"}`: la clave de conexión para llamar a la receptora. Con una clave de
  conexión solo vale si ya existe una conexión con esa `app` y la misma `url`; nunca crea ni
  cambia la URL (`403`).
- **Ida y vuelta** (A conecta con B desde su interfaz): A prueba `GET B/status` con la clave de
  administración de B que pega el usuario, guarda la conexión, genera `kA` y llama
  `POST B/conexiones` con `{app:"A", url, clave:kA, api_key:kA}`; B responde `{clave:kB}`. A guarda
  `kB` y **olvida** la clave de administración de B. Una B antigua no responde `clave`: A sigue con
  la de administración y la migración lo reintenta.
- **Renovar** (`POST /conexiones/renovar`, `{app, url, clave}`): la usan las apps al arrancar (y
  cada hora hasta conseguirlo) para cada conexión cuya clave guardada no empiece por `cgc_`. Con la
  clave de administración se busca la conexión por `app` + `url` (o la única de esa app; si no hay,
  se crea); con una de conexión, la de esa conexión, y **otra `url` da `403 prohibido`** (antes de
  la 2.24 clipscout la aceptaba sin cambiarla). Respuesta `{id, clave:"cgc_…"}` (`id` desde la
  2.24). Una versión vieja responde `404`: se deja como está y se reintenta.
- Cada conexión guarda las **tres últimas** claves de entrada emitidas: si las dos apps renuevan a
  la vez, las dos siguen valiendo. Ajustes → Conexiones → «Revocar su clave» las borra todas.
- Crear una conexión o cambiar su URL desde Ajustes exige sesión de usuario o la clave de
  administración. La autoconexión (`CLIPGEIST_CLAVE`) usa la clave común solo para el primer
  registro.

### Sesiones e inicio de sesión único

- Cookie `clipgeist_sesion` (una por host para las tres apps): testigo opaco
  `<app>.<32 bytes base64url>` con `<app>` ∈ `clipkeeper|clipscout|clonbuster`. `HttpOnly`,
  `SameSite=Lax`, `Path=/`; `Secure` si llega por HTTPS (o `X-Forwarded-Proto: https` con
  `CLIPGEIST_PROXY_CONFIABLE=1`). La app que la emite guarda sha256, usuario, creada, última vez,
  caducidad (30 días; se alarga si quedan menos de 15) y dispositivo.
- Con un testigo de **otra** app: `POST otra/api/crew/v1/sesion/validar` `{testigo}` con la clave
  de conexión → `{ok:true, usuario, caduca}` (ISO 8601) o `{ok:false}`. Se recuerda 60 s; si la
  otra no responde, el último «sí» vale 5 min. Sin conexión con esa app → `401`.
- «Salir» con un testigo de otra: `POST otra/api/crew/v1/sesion/cerrar` `{testigo}` → `{ok:true}`.
- Las cookies firmadas de antes (`<caduca>.<hmac>`) se canjean **una vez** por una sesión nueva.

### Host y origen (todas las peticiones)

- `Host` permitido: IP, `localhost`/`*.localhost`, el nombre del equipo (con o sin `.local`,
  `.lan`, `.home`), `CLIPGEIST_HOSTS` (lista, admite `*.dominio`) y los hosts de las URLs de las
  conexiones y de la propia. Si no, `421` «Esta dirección no está permitida. Añádela en
  CLIPGEIST_HOSTS.». `/api/health` y `/api/salud`, exentos.
- `POST/PUT/PATCH/DELETE` sin `X-Api-Key`: `Sec-Fetch-Site` `same-origin`/`none`, o `Origin`
  (`Referer`) del mismo host, o, sin ninguna de las tres, `X-Clipgeist: 1`. Si no, `403`
  «Petición desde otra web rechazada». La interfaz manda `X-Clipgeist: 1` siempre.

## Endpoints obligatorios

Todas las rutas cuelgan de `/api/crew/v1`.

### `GET /status`

Quién soy. Sirve para el botón **Probar** de una conexión. **Sin clave** es público y responde solo
`crew`, `protocolo`, `app` y `version` (clipscout desde la 2.24, como las otras dos); con una clave
válida, todo; con una incorrecta, `401 clave_invalida` (así «Probar» comprueba la clave).

```json
{
  "crew": "Clipgeist",
  "protocolo": 1,
  "app": "clipkeeper",
  "version": "0.1.0",
  "instancia": "Biblioteca de casa",
  "url": "http://192.168.1.10:8096"
}
```

### `GET /conexiones`

Las apps a las que esta está conectada (sin sus claves).

```json
[{ "id": 1, "app": "clonbuster", "nombre": "clonbuster", "url": "http://…:8095", "activa": true }]
```

### `POST /conexiones`

Registrar una conexión **entrante**: la usa otra app para darse de alta aquí ("ida y vuelta").

```json
{ "app": "clipkeeper", "nombre": "Biblioteca de casa", "url": "http://…:8096", "clave": "cgc_…" }
```

- Si ya existe una conexión con esa `url`, se **actualiza** (nombre y clave) en vez de duplicarse.
- Respuesta: `{"id": 3, "creada": true, "clave": "cgc_…"}` (`creada: false` si se actualizó). Ver
  «Alta, vuelta y renovación».

### `DELETE /conexiones/{id}`

Quitar una conexión (y revocar las claves que se le dieron). Opcional para llamadas entre apps;
siempre disponible desde la propia interfaz. En clipscout, desde la 2.24, una `id` que no existe da
`404 no_encontrado` (antes `200`).

## Flujo «Conectar» (desde la interfaz de la app A)

1. El usuario elige el tipo de app (B), su URL y su clave de API.
2. **Probar**: A llama a `GET {url}/api/crew/v1/status` con la clave de B. Debe responder `200`, con
   `crew == "Clipgeist"` y `app` igual al tipo elegido. Si no, se muestra el motivo.
3. **Guardar**: A guarda la conexión y, si está marcado «Conectar también en sentido contrario»
   (por defecto sí), hace `POST {url}/api/crew/v1/conexiones` en B con **su propia** URL y clave.
   Así B también ve a A sin configurar nada a mano.
4. El estado de cada conexión (verde / rojo, versión remota) se refresca al abrir Ajustes →
   Conexiones.

## Errores (SU-10, fase 5)

Todas las respuestas de error, en las tres apps:

```
{"codigo": "<snake_case>", "detail": "<texto en el idioma de la petición>", "params": {...}}
```

- Idioma por `Accept-Language` (`es` por defecto, `en`). `detail` va SIEMPRE (los scripts lo
  leen); la interfaz traduce por `codigo` y usa `detail` si no lo conoce.
- Códigos comunes (mismo nombre en las tres): `sin_sesion`, `clave_invalida`, `prohibido`,
  `no_encontrado`, `ocupado`, `apagando`, `host_no_permitido`, `origen_rechazado`,
  `demasiados_intentos`, `datos_invalidos`, `disco_no_responde`, `en_uso`, `error_interno`.
- `error_interno` lleva `params.id` (8 hex), que también aparece en el registro de la app.
- clipscout añade los suyos: `cancelado`, `remoto_no_responde`, `no_disponible`,
  `direccion_bloqueada`, `demasiadas_peticiones`, `ajustes_ilegibles`, `ya_hay_usuario`,
  `sin_usuario`, `credenciales_incorrectas`, `copia_no_valida`, `copia_de_otra_app`,
  `copia_mas_nueva` (los tres de las copias, comunes con las otras apps desde la 2.24; antes
  `copia_invalida` y `version_mas_nueva`). Además conserva los campos de antes (`error`, `code`).

## Diagnóstico y salud (SU-11, fase 5)

- `GET /api/salud` (sin sesión): `{ok, app, version}`. `ok:false` (y 503 en clipscout) si la base
  de datos (en clipscout, `crew.json`) o la carpeta de datos fallan.
- `GET /api/diagnostico` (sesión o clave de administración): `{app, version, arranque,
estado: "ok|degradado", comprobaciones: [{nombre, ok, detalle}], ultimos_errores: [{fecha,
codigo, id}]}`. En clipscout: `ajustes`, `carpeta_datos`, `navegador`, `proxy_salida`,
  `gestor_descargas` y `conexion:<app>` por cada conexión (`conexion_<app>` hasta la 2.23).
- `GET /api/diagnostico/registro?lineas=200` → `{lineas: [...]}` (máx. 2.000).
- `GET /api/diagnostico/informe`: zip con `diagnostico.json` y `registro.txt` (últimas 2.000
  líneas) sin rutas absolutas (`<ruta>`), nombres de fichero (`<fichero>`) ni claves (`<clave>`).
- Registro con rotación 5 MB × 3 en la carpeta de datos.

## Copia de la suite (SU-20, fase 5)

- `GET /api/crew/v1/copia[?miniaturas=1]` (clave de administración o sesión; nunca una de
  conexión): zip con `manifiesto.json` `{app, version, esquema, fecha, contenido: [...]}` y los
  datos de la app, sin contraseñas, claves ni sesiones.
- `POST /api/crew/v1/copia/restaurar` (mismo permiso; el zip en el cuerpo): comprueba manifiesto,
  app y versión (otra app: `400 copia_de_otra_app`; no es un zip o está dañada: `400
copia_no_valida`; de una versión más nueva: `409 copia_mas_nueva`), guarda lo
  actual, restaura y responde `reiniciar: true`. Lo que no exista en el equipo nuevo queda «no
  disponible», nunca se borra.
- clipscout: `esquema` 1; `contenido` = `crew.json` (sin secretos), `profiles.json`,
  `estadisticas.json`, `jd-paquetes.json`, `programadas-enviados.json`. No guarda miniaturas en
  disco. Al restaurar se quedan la contraseña, la clave de administración y las claves de conexión
  actuales; una conexión que llega sin clave queda `activa: false, sin_clave: true`.

## Actualizaciones y compatibilidad (SU-13, fase 5)

- Fuente: `https://clipgeist.com/versiones.json`:
  `{"actualizado":"AAAA-MM-DD","apps":{"<app>":{"version","notas","url","minimas":{"<otra>":"x.y.z"}}}}`.
- Cada app lo pide como mucho una vez al día, sin parámetros ni datos (User-Agent `Clipgeist`),
  si `buscar_actualizaciones` está activo (por defecto sí). 404 o sin red: silencio.
- `minimas` de una app = versión mínima de cada app conectada que necesita ESA app; si una
  conectada es más vieja, aviso en Ajustes → Conexiones.
- clipscout: `GET|PUT /api/actualizaciones` (`{activo}`), `POST /api/actualizaciones/comprobar` y
  `GET /api/privacidad` (lo que sale del equipo).

## Versionado

`protocolo` es un entero. Cambios compatibles (campos nuevos) no lo suben; cambios incompatibles
sí, y entonces las rutas pasan a `/api/crew/v2`.

## Próximos endpoints (no implementados aún)

- `GET /archivos/{cid}` — ¿tienes este fichero? (identidad por contenido)
- Webhooks: `archivo.movido`, `archivo.renombrado`, `archivo.papelera`, `video.creado`
- clonbuster: `GET /duplicados?ubicacion=…`
- clipkeeper: `POST /entrada` (llegada desde clipscout)

## Añadido en 2026-11 (clipscout)

### Primer usuario: `POST /api/auth/configurar`

Desde la 2.24, alias de `POST /api/auth/primer-usuario` (el nombre de clipkeeper y clonbuster).

### clipscout → clipkeeper: `POST /api/crew/v1/tengo` («Recoger», 2.24)

«Recoger» pregunta de una vez lo que ya hay de una persona o término (contrato de clipkeeper
0.36, en `FASE6-SPEC`): `{termino, limite}` → `{total, truncado, personas: [{nombre, videos}],
videos: [{titulo, fichero, duracion, origen_url, estado: "ok"|"papelera", …}]}`. Un resultado se da
por tenido si coincide `origen_url`, o la duración ±2 s con título parecido, o (sin título) la
duración ±1 s; lo que está en la papelera de clipkeeper tampoco se vuelve a traer. Un clipkeeper
anterior responde `404`: entonces se pregunta resultado a resultado con `POST /buscar`, como «ya lo
tengo».

### Suite (lanzador común)

- El asistente de escritorio tiene «Permitir acceso desde otros dispositivos»: escribe `red` o
  `local` en `escuchar.txt` de la carpeta de datos y, si existe la carpeta común `../suite/`,
  también en `suite/escuchar.txt` (la lee el lanzador común). Vale al reiniciar.
- La salud que mira el lanzador de escritorio es `/api/salud` (503 si no puede trabajar).
- Desinstalar la app suelta con la suite instalada no toca el programa ni la carpeta de la suite.

### clipscout → clipkeeper: `POST /api/crew/v1/escanear`

clipscout recuerda los paquetes que manda a JDownloader (carpeta relativa a la de descargas de
JDownloader, y la biblioteca de clipkeeper elegida en Ajustes → JDownloader). Cuando JDownloader
marca uno como **terminado**, llama una vez por paquete a clipkeeper:

```
POST /api/crew/v1/escanear
X-Api-Key: <clave de clipkeeper>
{"biblioteca_id": 3, "carpeta": "Viajes/Playa"}
→ 202 {"encolado": true}
```

- Sin clipkeeper conectado no se llama (ni se reintenta).
- Si clipkeeper no responde, se reintenta en las siguientes revisiones (como mucho
  `JD_AVISOS_CLIPKEEPER` veces).
- `carpeta` puede ir vacía si el paquete se descargó en la raíz de la carpeta de JDownloader.

### Autoconexión por entorno (instalación conjunta)

- `CLIPGEIST_CLAVE`: si existe, es la clave de API de clipscout (manda sobre la guardada en
  `data/crew.json`, que no se toca; regenerarla desde Ajustes da 409).
- `CLIPGEIST_CLIPKEEPER_URL`, `CLIPGEIST_CLONBUSTER_URL`: al arrancar, clipscout asegura una
  conexión activa con cada una, con esa misma clave (comprobada con `GET /status`). Idempotente; la
  conexión creada así lleva `"auto": true` en `GET /conexiones`. Una conexión hecha a mano con la
  misma URL no se toca. Si la otra app no responde, se reintenta cada 15 s durante 10 min.
- `CLIPGEIST_CLIPSCOUT_URL`: la URL propia que se anuncia en `/status` si no hay otra en Ajustes.
- `deploy/clipgeist/compose.yaml` levanta las tres apps con estas variables y las URLs internas
  de la red de compose.

## Fase 7 (2026-11): fotos por persona y completar por persona

Contratos C1–C8 de `FASE7-SPEC`. `X-Api-Key` = clave de la app de destino. Lo nuevo es compatible:
una app anterior responde `404` y la otra sigue como antes.

### C1 · clipkeeper `GET /api/crew/v1/personas[?q=]`

`{"personas": [{"id", "nombre", "rol", "alias": [..], "biblioteca_id", "carpeta", "carpeta_fotos",
"videos", "fotos", "foto"}]}`. `carpeta`: la carpeta (relativa a su biblioteca) con la mayoría de sus
vídeos, cuyo último tramo es su nombre o un alias; si no hay, `null` (clipscout usa entonces
`People/<nombre>`). `carpeta_fotos`: ajuste de clipkeeper (fábrica «Fotos»). `q` busca sin acentos ni
mayúsculas en nombre y alias. clipscout la recuerda un minuto y la usa para: detectar personas en lo
que manda (nombre o alias como palabras enteras, o pegado si el nombre tiene dos palabras o más; los
de menos de 3 letras no cuentan), buscar también por los alias, «Mandar a una persona» y proponer la
carpeta de la persona cuando lo buscado es su nombre o un alias.

### C2 · clipkeeper `POST /api/crew/v1/esperados` (ingreso con metadatos)

clipscout lo llama justo después de **cada** envío correcto al gestor de descargas (búsqueda a mano,
Recoger, programadas y seguidas, fotos, mejorar y volver a descargar), en tandas de 500:

```json
{ "biblioteca_id": 1, "carpeta": "People/Ana Pérez",
  "items": [ { "tipo": "video", "origen_url": "https://…", "titulo": "Día de playa",
               "personas": ["Ana Pérez"], "etiquetas": ["Verano"], "duracion": 312.0,
               "sustituye_video_id": null },
             { "tipo": "album", "origen_url": "https://…", "titulo": "Vacaciones",
               "album": "Vacaciones", "personas": ["Ana Pérez"], "n_fotos": 24 } ] }
→ 201 {"ids": [..]}
```

- `biblioteca_id`: la del gestor de descargas (Ajustes → JDownloader) o la que llegó en C4/C5/C6. Sin
  biblioteca no se avisa.
- `carpeta`: la del envío (vídeos) o la de la persona (álbumes: las fotos van a
  `carpeta/<carpeta_fotos>/<album>/`).
- `personas`: las de la regla de la carpeta, las que dice quien llama y las detectadas con C1 en el
  término buscado, el título y la dirección. `etiquetas`: las de la regla.
- Si clipkeeper no está, responde 404 o no responde, el envío ya está hecho y no cambia.
- `GET /api/crew/v1/esperados?estado=pendiente|emparejado|caducado`: clipscout lo usa para
  «¿ya lo tengo?» de álbumes (por `origen_url`).

### C3 · Fotos en disco

`<carpeta de la persona>/<carpeta_fotos>/<Álbum>/<ficheros>`. Nombre de álbum sin
`/ \ : * ? " < > |`, sin `..`, ≤ 80 caracteres, recortado (vacío → `Album`). Un paquete del gestor
por álbum.

### C4 · clipscout «Seguir a una persona»

- `POST /api/crew/v1/seguir` `{"persona", "alias": [], "biblioteca_id", "carpeta", "cada_dias": 7,
"limite": 20}` → `201 {"id"}`. Si ya se sigue a esa persona (sin acentos ni mayúsculas), se
  actualiza y devuelve su id. Sin `carpeta`, `People/<persona>`.
- `GET /api/crew/v1/seguir` → `{"seguidas": [{"id", "persona", "alias", "carpeta", "biblioteca_id",
"cada_dias", "limite", "activa", "ultima", "proxima", "ultimos_enviados": [{"titulo", "url"}],
"ultimo_total", "ultimo_error"}]}`. `ultima` y `proxima` en ISO 8601 (`ultima: null` si no se ha
  lanzado; entonces `proxima` es ahora: se lanza en los 5 minutos siguientes). `ultimos_enviados`:
  lo mandado en la última vuelta (hasta 20).
- `DELETE /api/crew/v1/seguir/{id}` → `{"ok": true}`; 404 si no es una seguida.

Por dentro es una programada de «Recoger» (fase 6) con la persona como término, sus alias (se
buscan también y valen como su nombre), solo lo que lleva el nombre, los más largos, como mucho
`limite` por vuelta, a `carpeta`, y C2 al mandar. Avisos (`programada`, con `seguida: true` y los
primeros títulos) en Actividad.

### C5 · clipscout «Mejorar calidad»

- `POST /api/crew/v1/mejorar` `{"items": [{"video_id", "titulo", "personas", "duracion", "alto",
"biblioteca_id", "carpeta"}]}` (1–200; si no, 400) → `202 {"trabajo"}`.
- `GET /api/crew/v1/mejorar/{trabajo}` → `{"estado": "buscando"|"hecho"|"error", "hechos", "total",
"propuestas": [{"video_id", "candidatos": [{"url", "titulo", "sitio", "duracion", "alto",
"miniatura"}]}]}`. Candidato: la misma persona (o un alias) en el título o la dirección, título
  parecido (la mitad de las palabras del más corto), duración ±3 % (las dos conocidas) y `alto`
  mayor que el actual. El alto se deduce del título o la dirección (720/1080/1440/2160); sin dato,
  no es candidato. Como mucho 3, de más alto a menos. Una búsqueda por persona (los vídeos sin
  persona, por su título). Trabajos en memoria (los 20 últimos); uno que no existe, 404.
- `POST /api/crew/v1/mejorar/{trabajo}/enviar` `{"elegidos": [{"video_id", "url"}]}` → `{"enviados",
"fallos": [{"video_id", "url", "error"}]}`. Solo candidatos propuestos en ese trabajo. Un paquete
  por carpeta, a la carpeta del vídeo, y C2 con `sustituye_video_id`.

### C6 · clipscout `POST /api/crew/v1/reenviar`

`{"items": [{"origen_url", "biblioteca_id", "carpeta", "titulo", "personas", "sustituye_video_id"?}]}`
(1–500) → `{"enviados", "fallos": [{"origen_url", "error"}]}`. Un paquete por carpeta y C2.

### C7 · clipscout `GET /api/crew/v1/recuento?termino=…`

`{"termino", "total": n|null, "sitios": [{"sitio", "total": n|null}], "fecha"}`. Mejor esfuerzo: el
número que enseña la primera página de resultados de cada sitio («1.234 resultados», «Videos
(87)»…), sin navegador; `null` si no lo dice o no responde. `total`: la suma de los conocidos (o
`null`). Caché de 24 h por término (sin acentos ni mayúsculas). Sin término, 400.

### C8 · Fotos en clonbuster

Ver `FASE7-SPEC`: clonbuster analiza las imágenes de las carpetas `carpeta_fotos` y manda los mismos
`eventos` que con vídeos; clipkeeper avisa con `/incremental` también de las fotos nuevas. clipscout
no interviene.

## Añadido en 0.37 (fase 7, clipkeeper)

Rutas nuevas que abre una clave de conexión: `GET /personas`, `POST /esperados`, `GET /esperados`.

### `GET /personas` (C1)

`{"personas": [{"id", "nombre", "rol", "alias": [..], "biblioteca_id", "carpeta": "People/Ana Pérez" | null,
"carpeta_fotos": "Fotos", "videos": n, "fotos": n, "foto": bool}]}`. `carpeta`: la carpeta (relativa a
`biblioteca_id`) con más vídeos de la persona cuyo último tramo es su nombre o un alias (cuentan también sus
álbumes); a igualdad, la que lleva su nombre. Sin ella, `null` (y `biblioteca_id` = la primera biblioteca).
`?q=` sin acentos ni mayúsculas, en nombre y alias. Salen todas las personas.

### `POST /esperados` y `GET /esperados?estado=` (C2, ingreso con metadatos)

Cuerpo `{"biblioteca_id", "carpeta", "items": [{"tipo": "video"|"album", "origen_url", "titulo", "personas",
"etiquetas", "duracion", "sustituye_video_id", "album", "n_fotos"}]}` (hasta 500) → `201 {"ids"}`; 404 si la
biblioteca no existe, 400 si los items no valen. Caducan a los 14 días. Emparejado en cualquier escaneo:

- Vídeo: fichero NUEVO en `carpeta` (o una subcarpeta). Si se conocen las dos duraciones, solo valen las
  de ±3 % o ±5 s (gana la más cercana); si no, el nombre del fichero más parecido al título; si no, el
  único esperado que queda en esa carpeta. Recibe título (solo si el del fichero es un código o no hay),
  personas, etiquetas y `origen_url`. Con `sustituye_video_id`, el fichero pasa a ser la calidad principal
  de ese vídeo (la anterior queda como otra calidad o, si estaba rota o no estaba, se olvida) y la ficha se
  conserva.
- Álbum: fotos nuevas en `carpeta/<carpeta_fotos>/<album saneado>/`; el álbum recibe `origen_url` (y la
  persona si no la tenía).

`GET` devuelve las filas con `estado` (`pendiente|emparejado|caducado`), `emparejado_con` (vídeo o álbum),
`n_fotos`, `album` y, en los álbumes, `fotos_emparejadas` (fotos ya catalogadas en él).

### Fotos (C3, C8)

Estructura `<carpeta de la persona>/<carpeta_fotos>/<Álbum>/<ficheros>`; fuera de ella clipkeeper no
cataloga imágenes. `POST /incremental` de clonbuster lleva también las rutas absolutas de las fotos nuevas.
Los `eventos` de clonbuster (`archivo.movido` / `archivo.borrado`, por ruta y `cid`) se aplican también a
las fotos: a una papelera o fuera de la biblioteca → dejan de verse; de vuelta a una carpeta de fotos →
recuperan su fila y su álbum. Las fotos que aparta clipkeeper van a la papelera común (`id` del diario
`foto-<id>`) y se restauran y eliminan como los lotes de clonbuster.

### clipkeeper llama a clipscout (C4–C7)

- C4 «Seguir» desde la página de persona: `POST /seguir {persona, alias, biblioteca_id, carpeta, cada_dias,
  limite}`, `GET /seguir` (se busca la de esa persona; `ultimos_enviados` puede ser lista o número) y
  `DELETE /seguir/{id}`.
- C5 «Mejorables»: `POST /mejorar` (≤ 200), `GET /mejorar/{trabajo}`, `POST /mejorar/{trabajo}/enviar`.
- C6 «Volver a descargar» (Salud): `POST /reenviar` con `sustituye_video_id` = el vídeo roto o desaparecido.
- C7 «Huecos»: `GET /recuento?termino=<nombre>`; `total` puede ser `null`.

## Fase 7 (2026-11): fotos por persona (clonbuster 0.25.0)

Estructura de fotos en disco (C3): `<carpeta de la persona>/<carpeta_fotos>/<Álbum>/<ficheros>`, p. ej.
`People/Ana Pérez/Fotos/Vacaciones/001.jpg`. Imágenes: `jpg jpeg png webp gif avif heic heif`.

### Fotos en clonbuster (C8)

- clonbuster analiza las fotos de una biblioteca de vídeos cuando están dentro de una carpeta que se
  llama como su ajuste `carpeta_fotos` (fábrica «Fotos», sin distinguir mayúsculas, a cualquier
  profundidad), aunque la biblioteca se diera de alta solo con vídeos. Ajuste «Incluir fotos de las
  carpetas de fotos» (`fotos_carpetas` en `GET|PUT /api/deteccion`), encendido de fábrica. Es un
  ajuste propio: no se lee el `carpeta_fotos` de clipkeeper.
- `POST /api/crew/v1/incremental` acepta también rutas de fotos nuevas; se analizan si están en una
  carpeta de fotos (o si la biblioteca tiene el tipo «fotos»). El resto se ignora como siempre.
- Al apartar, sustituir o restaurar fotos, clonbuster manda los mismos eventos que con vídeos
  (`archivo.movido` con `{origen, destino, cid}`; `archivo.borrado` al eliminar de la papelera).
  Sustituir una foto no llama a `POST /api/crew/v1/heredar` (las fichas son de vídeos).
