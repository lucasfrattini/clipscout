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

| Método | Ruta                              | Para qué                                                             |
| ------ | --------------------------------- | -------------------------------------------------------------------- |
| `GET`  | `/api/crew/v1/status`             | Probar la conexión                                                   |
| `GET`  | `/api/crew/v1/imagenes`           | Fotos para clipkeeper                                                |
| `POST` | `/api/crew/v1/conexiones`         | Solo la «vuelta» de una conexión que ya existe con esa app y esa URL |
| `POST` | `/api/crew/v1/conexiones/renovar` | Pasar a claves de conexión                                           |
| `POST` | `/api/crew/v1/sesion/validar`     | Inicio de sesión único                                               |
| `POST` | `/api/crew/v1/sesion/cerrar`      | «Salir» desde otra app                                               |

`GET /conexiones` y `DELETE /conexiones/{id}` piden la clave de administración. clipscout llama a
clipkeeper a `POST /buscar` («¿ya lo tengo?»), `GET /destinos`, `POST /reglas` y `POST /escanear`
(además de `status`, `conexiones`, `conexiones/renovar` y `sesion/*`): esas tienen que estar en la
lista de permisos de clipkeeper.

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
  se crea); con una de conexión, la de esa conexión. Respuesta `{clave:"cgc_…"}`. Una versión
  vieja responde `404`: se deja como está y se reintenta.
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

Quién soy. Sirve para el botón **Probar** de una conexión.

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

Quitar una conexión. Opcional para llamadas entre apps; siempre disponible desde la propia interfaz.

## Flujo «Conectar» (desde la interfaz de la app A)

1. El usuario elige el tipo de app (B), su URL y su clave de API.
2. **Probar**: A llama a `GET {url}/api/crew/v1/status` con la clave de B. Debe responder `200`, con
   `crew == "Clipgeist"` y `app` igual al tipo elegido. Si no, se muestra el motivo.
3. **Guardar**: A guarda la conexión y, si está marcado «Conectar también en sentido contrario»
   (por defecto sí), hace `POST {url}/api/crew/v1/conexiones` en B con **su propia** URL y clave.
   Así B también ve a A sin configurar nada a mano.
4. El estado de cada conexión (verde / rojo, versión remota) se refresca al abrir Ajustes →
   Conexiones.

## Errores

JSON `{"detail": "mensaje legible en español"}` con el código HTTP adecuado (400, 401, 404, 409,
502 si la app remota no responde).

## Versionado

`protocolo` es un entero. Cambios compatibles (campos nuevos) no lo suben; cambios incompatibles
sí, y entonces las rutas pasan a `/api/crew/v2`.

## Próximos endpoints (no implementados aún)

- `GET /archivos/{cid}` — ¿tienes este fichero? (identidad por contenido)
- Webhooks: `archivo.movido`, `archivo.renombrado`, `archivo.papelera`, `video.creado`
- clonbuster: `GET /duplicados?ubicacion=…`
- clipkeeper: `POST /entrada` (llegada desde clipscout)

## Añadido en 2026-11 (clipscout)

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
