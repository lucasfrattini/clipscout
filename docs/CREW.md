# Protocolo clip crew v1

Cómo se conectan entre sí las apps de **clip crew** (clipscout, clonbuster, clipkeeper). Cada app
es independiente — su base de datos, su contenedor — y habla con las demás solo por esta API.
Inspirado en cómo se enlazan Sonarr, Radarr y Prowlarr.

> Este documento es **idéntico en los tres repositorios** (clipscout, clonbuster y clipkeeper). Si el
> protocolo cambia, se cambia en los tres a la vez.

## Arquitectura de clip crew

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
| `api_key`   | 32 caracteres hex          | Ajustes → General (copiar / regenerar)                              |

## Autenticación

Toda petición entre apps lleva la clave de la app **destino** en la cabecera:

```
X-Api-Key: 0123456789abcdef0123456789abcdef
```

Sin clave o con clave incorrecta → `401`. Las claves se comparan en tiempo constante.

## Endpoints obligatorios

Todas las rutas cuelgan de `/api/crew/v1`.

### `GET /status`

Quién soy. Sirve para el botón **Probar** de una conexión.

```json
{
  "crew": "clip crew",
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
{ "app": "clipkeeper", "nombre": "Biblioteca de casa", "url": "http://…:8096", "api_key": "…" }
```

- Si ya existe una conexión con esa `url`, se **actualiza** (nombre y clave) en vez de duplicarse.
- Respuesta: `{"id": 3, "creada": true}` (o `false` si se actualizó).

### `DELETE /conexiones/{id}`

Quitar una conexión. Opcional para llamadas entre apps; siempre disponible desde la propia interfaz.

## Flujo «Conectar» (desde la interfaz de la app A)

1. El usuario elige el tipo de app (B), su URL y su clave de API.
2. **Probar**: A llama a `GET {url}/api/crew/v1/status` con la clave de B. Debe responder `200`, con
   `crew == "clip crew"` y `app` igual al tipo elegido. Si no, se muestra el motivo.
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
