# Especificación de clipscout

Contrato funcional de la app. **Manda sobre el código**. Flujo: [AGENTS.md](../AGENTS.md). Funciones
y uso: [README](../README.md). Arquitectura: [ARCHITECTURE.md](ARCHITECTURE.md). Cambios por versión:
[CHANGELOG.md](../CHANGELOG.md).
Protocolo: [CREW.md](CREW.md). `DEBE` es obligatorio; `manual` significa que falta un test automático.

## Propósito y límites

Recorre sitios paginados y páginas sueltas y devuelve los ficheros y enlaces encontrados, sin
descargar nada: la descarga se delega en JDownloader. Es dueña del origen de cada vídeo.

## Requisitos

| Id     | Requisito                                                                                                                                                               | Verifica                                     |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| EXP-1  | El explorador recorre según el modo de paginación (`scroll`, plantilla, parámetro, única).                                                                              | `pagination`, `crawl.integration`            |
| EXP-2  | Frenar y continuar DEBE retomar sin repetir.                                                                                                                            | `tests/` del explorador                      |
| EXP-3  | Nunca hay descartes silenciosos: duplicados agrupados y topes avisados.                                                                                                 | `dedupe`                                     |
| VID-1  | El análisis de una URL combina sus vías; un dato opcional que falte no elimina el resultado.                                                                            | `video-options`, `video-metadata`            |
| BUS-1  | La búsqueda no se relanza al recargar y cada resultado se puede descartar y restaurar.                                                                                  | manual                                       |
| BUS-2  | Un mismo vídeo sale una vez; los vídeos distintos de un álbum se conservan.                                                                                             | `dedupe`                                     |
| BUS-3  | `?prellenar=texto` DEBE dejar el texto escrito sin lanzar la búsqueda; `?q=` sí la lanza.                                                                               | manual                                       |
| BUS-4  | Los filtros de Buscar (contener, descartar, idioma, bloqueadas) ocultan con contador y se ven.                                                                          | `filtros.test.js`, manual                    |
| BUS-5  | Cada resultado lleva su relevancia; ordenar por ella y «frase exacta» (oculta con contador).                                                                            | `filtros.test.js`                            |
| BUS-6  | Pasado el máximo de búsquedas a la vez, la siguiente espera en cola y arranca sola; se puede quitar.                                                                    | `busqueda-cola.test.js`                      |
| BUS-7  | Las búsquedas en marcha o en cola se retoman solas tras un reinicio (SIGTERM guarda antes de salir).                                                                    | `busqueda-persistencia.test.js`              |
| BUS-8  | Un resultado sin duración se completa después con una petición HTTP ligera a su ficha (evento `duracion`).                                                              | `duraciones.test.js`                         |
| BUS-9  | Un álbum (ficha con varios ficheros) se pliega en un resultado con contador y se despliega; filtros por fichero.                                                        | `albumes.test.js`                            |
| JD-4   | Lo que JDownloader da por caído se sustituye por el fichero directo (fresco, con la ficha de origen).                                                                   | `jd-directo.test.js`                         |
| JD-5   | Actividad muestra los paquetes mandados y su estado; reintentar fallidos y vaciar el capturador (confirmando).                                                          | `jd-directo.test.js`, manual                 |
| JD-6   | Un paquete que JDownloader termina hace que clipkeeper escanee su carpeta (una vez; sin clipkeeper, nada).                                                              | `jd-clipkeeper.test.js`                      |
| SIT-1  | Estadísticas por sitio persistentes (búsquedas, resultados, con duración, bloqueos, JD, ya lo tenías).                                                                  | `estadisticas.test.js`                       |
| BUS-10 | «También en toda la web» está desmarcada por defecto (Buscar y programadas); se respeta si se marcó.                                                                    | `programadas.test.js`, manual                |
| RES-1  | Copia diaria de data/*.json con N días; ver, descargar y restaurar (guardando antes lo actual).                                                                         | `respaldos.test.js`                          |
| CRW-2  | Con CLIPGEIST_CLAVE y CLIPGEIST_*_URL se conecta sola a las otras apps (idempotente, sin tocar lo manual).                                                              | `autoconexion.test.js`                       |
| FIL-1  | Las palabras siempre bloqueadas se aplican a Buscar, a las programadas y a todo envío a JD.                                                                             | `filtros.test.js`                            |
| JD-1   | Enviar a JDownloader pregunta tipo y nombre de la carpeta, salvo destino fijado.                                                                                        | manual                                       |
| JD-2   | La ventana DEBE proponer carpetas existentes y personas o etiquetas del catálogo sin carpeta propia.                                                                    | `carpetas.test.js`                           |
| JD-3   | El modo discreto de clipkeeper NO DEBE ocultar nada en esa ventana.                                                                                                     | `carpetas.test.js`, SPEC de clipkeeper DIS-2 |
| SEG-1  | Toda petición saliente DEBE pasar la validación SSRF, también al resolver y en redirecciones.                                                                           | `ssrf`, `security-regressions`               |
| SEG-2  | `trust proxy` nunca es `true`.                                                                                                                                          | `security-regressions`                       |
| SEG-3  | La interfaz no usa `innerHTML` y la CSP no admite inline.                                                                                                               | ESLint                                       |
| ACC-1  | Sin usuario solo se atiende al propio equipo; desde fuera, primer arranque con el código del registro.                                                                  | `fase1-seguridad.test.js`                    |
| ACC-2  | El usuario se acepta sin distinguir mayúsculas; la contraseña sí las distingue.                                                                                         | `admin-password.test.js`                     |
| ACC-3  | Sesión en el servidor: testigo opaco en cookie HttpOnly/Lax; «Salir» la borra; sin HTTP Basic.                                                                          | `admin-password`, `fase1-seguridad`          |
| ACC-4  | Tras 8 fallos por dirección de socket (login y código de primer arranque), 429 durante 5 min.                                                                           | `admin-password.test.js`                     |
| ACC-6  | La contraseña se pone, cambia o quita en Ajustes → Acceso (scrypt); ADMIN_PASSWORD manda si existe.                                                                     | `acceso-ajustes.test.js`                     |
| ACC-5  | `/api/health` y el protocolo no piden contraseña.                                                                                                                       | `admin-password.test.js`                     |
| ACC-7  | crew.json ilegible y sin copia buena: app CERRADA (503), fichero intacto; nunca abierta.                                                                                | `ajustes-corruptos.test.js`                  |
| DAT-1  | data/*.json: temporal único + rename y `.bak` de la anterior; si se daña, vuelve el `.bak`.                                                                             | `ajustes-corruptos.test.js`                  |
| ACC-8  | Cookie firmada de 2.17: se canjea una vez por una sesión nueva (2 min de margen); después, 401.                                                                         | `fase1-varios`, `fase1-actualizacion`        |
| ACC-9  | Cambiar la contraseña cierra las demás sesiones; Ajustes → Seguridad lista y cierra sesiones.                                                                           | `fase1-seguridad.test.js`                    |
| CRW-3  | Clave de conexión `cgc_`: solo las rutas de su lista de permisos (CREW.md); revocable; guardada con sha256.                                                             | `fase1-seguridad.test.js`                    |
| CRW-4  | Conexiones con clave de administración ajena se renuevan solas (al arrancar y cada hora); una vieja (404) sigue.                                                        | `fase1-actualizacion.test.js`                |
| CRW-5  | Testigo de otra app conectada: se valida con ella (60 s de caché, 5 min si no responde); sin conexión, 401.                                                             | `fase1-seguridad.test.js`                    |
| SEG-4  | Host no permitido → 421 (salvo /api/health); lo que cambia algo sin clave exige origen propio o X-Clipgeist.                                                            | `fase1-seguridad.test.js`                    |
| SEG-5  | El navegador interno corta toda petición a la red local (privadas, loopback, enlace local).                                                                             | `fase1-varios.test.js`                       |
| SEG-6  | Navegador aislado (sandbox) salvo en contenedor o como root; perfil temporal por arranque; sin extensiones.                                                             | `fase1-varios.test.js`                       |
| SEG-7  | Carpeta de datos 700 y ficheros 600 (también los existentes); la copia descargada va sin secretos.                                                                      | `fase1-varios`, `fase1-actualizacion`        |
| PRG-1  | Una programada manda cada vídeo una vez (identidad del enlace y repetidos), en la vuelta y entre vueltas.                                                               | `programadas.test.js`                        |
| CRW-1  | Implementa el protocolo v1 de CREW.md.                                                                                                                                  | `tests/` de crew                             |
| I18N-1 | Toda cadena existe en `es.js` y `en.js`.                                                                                                                                | `i18n.test.js`                               |
| APG-1  | `POST /api/apagar` (sesión, clave o el propio equipo con `X-Clipgeist: 1`): 503 a lo nuevo, espera escrituras.                                                          | `fase2-apagado.test.js`                      |
| APG-2  | Al apagar (y con SIGTERM) se guarda la cola de búsquedas para reanudarla y se sale con 0.                                                                               | `fase2-apagado.test.js`                      |
| APG-3  | `GET /api/estado-trabajos` dice si hay algo en marcha (`que`: guardando, busqueda, programada, exploracion, cola).                                                      | `fase2-apagado.test.js`                      |
| DAT-2  | Con `DATA_DIR`, `crew.json` y `profiles.json` van dentro; sin él nada cambia; nunca se mueven solos (aviso).                                                            | `fase2-apagado.test.js`                      |
| DAT-3  | Sustituir un fichero reintenta ante EPERM/EBUSY/EACCES (Windows), también en el guardado síncrono.                                                                      | `fase2-apagado.test.js`                      |
| WIN-1  | Ningún proceso hijo abre ventana en Windows (`windowsHide`).                                                                                                            | `fase2-apagado.test.js`                      |
| ASI-1  | Asistente de primer arranque solo en instalación nueva (sin usuario, sitios ni conexiones).                                                                             | `fase2-asistente.test.js`, `npm run e2e`     |
| ASI-2  | «Usar la misma cuenta que…»: se valida en la otra app y se crea aquí con lo tecleado; nunca se copian resúmenes.                                                        | `fase2-asistente.test.js`                    |
| ASI-3  | QR generado en el navegador sin dependencias ni CDN.                                                                                                                    | `fase2-asistente.test.js`                    |
| PAQ-1  | Descargas del empaquetado fijadas con sha256 en `empaquetado/componentes.txt`; si no coincide, se aborta.                                                               | `fase2-asistente.test.js`                    |
| PAQ-2  | `TERCEROS.txt` con las licencias de terceros, en el paquete y en Docker; Ajustes → Acerca de lo enlaza.                                                                 | `fase2-asistente.test.js`                    |
| UI-1   | Navegación: Buscar · Actividad · Ajustes (abajo en el móvil, lateral en escritorio); `#/explorer` y `#/video` siguen.                                                   | `fase3-interfaz`, `npm run e2e`              |
| UI-2   | A 390×844: primer contenido < 160 px, ningún control visible < 44 px, sin desplazamiento horizontal.                                                                    | `npm run e2e`                                |
| UI-3   | `public/cg/` es copia byte a byte del paquete común (md5 de `cg-ui.css` y `cg-ui.js`).                                                                                  | `cg-ui.test.js`                              |
| UI-4   | Actividad reúne la cola de búsquedas, los paquetes enviados y las programadas, con las mismas rutas de la API.                                                          | `npm run e2e`                                |
| UI-5   | Ajustes en 4 secciones (Búsqueda · Descargas · Clipgeist · Sistema); las direcciones viejas llevan a la nueva.                                                          | `fase3-interfaz.test.js`                     |
| UI-6   | Iconos de las otras apps con la máquina desde la que se ve la página si la guardada es local o sin dominio.                                                             | `fase3-interfaz.test.js`                     |
| BUS-11 | Selección múltiple de resultados (pulsación larga, casilla, «Todos») y envío desde la barra de acción.                                                                  | `npm run e2e`                                |
| BUS-12 | «Ya lo tengo» y lo ya enviado se ocultan por defecto con contador y nunca entran en «Descargar todo».                                                                   | `fase3-interfaz`, `npm run e2e`              |
| BUS-13 | `POST /api/ajustes/jdownloader/enviados`: qué fichas van en algún paquete y cuándo (memoria de lo enviado).                                                             | `fase3-interfaz.test.js`                     |
| BUS-14 | La lista de resultados reutiliza las filas ya pintadas: solo se crean las nuevas o las que cambian.                                                                     | manual                                       |
| BUS-15 | `busquedas.json` es solo el índice; los eventos de cada búsqueda se AÑADEN a `busquedas/<id>.jsonl`; la 2.21 se migra sin perder la cola; un índice ilegible se aparta. | `fase4-busquedas-formato.test.js`            |
| BUS-16 | Retomar tras un reinicio sigue cada sitio por sus fichas pendientes (sin repetir listado ni fichas terminadas), con la clave estable del sitio.                         | `fase4-reanudar`, `fase4-sitios`             |
| BUS-17 | `?resumen=1&desde=0` en el stream de una búsqueda manda lo ocurrido resumido y sigue en directo.                                                                        | `fase4-busquedas-formato.test.js`            |
| BUS-18 | Los repetidos se agrupan por cubos (miniatura, nombre, duración) y en vivo (`duplicados` con `parcial`).                                                                | `dedupe`, `fase4-sitios`                     |
| BUS-19 | Profundidad Rápida / Normal / A fondo, «los N primeros», deslizar una fila (quitar / descargar) y «Descargar en» entero.                                                | `fase4-buscar-modelo`, `npm run e2e`         |
| BUS-20 | Si lo buscado coincide con una carpeta, persona o etiqueta del catálogo, esa carpeta se propone sola.                                                                   | `carpetas.test.js`                           |
| PRG-2  | Una programada en curso al reiniciar no se relanza: se recoge el resultado de su búsqueda.                                                                              | `fase4-programadas.test.js`                  |
| SIT-2  | Salud por sitio: dos búsquedas seguidas sin nada lo marcan en Ajustes y Actividad; «Volver a configurar» conserva nombre y posición.                                    | `fase4-sitios.test.js`                       |
| PRX-1  | El proxy de salida se prueba (al arrancar, cada minuto, antes de buscar); caído, sus sitios fallan al momento y se avisa.                                               | `proxy-salida.test.js`                       |
| JD-7   | Un caído se sustituye tras 2 revisiones (claro) o 4 (pasajero) y se desactiva, no se borra; con el gestor en pausa no se arranca.                                       | `jd-directo`, `jdownloader`                  |
| SEG-8  | Cada redirección se valida antes de seguirla, también con proxy de salida.                                                                                              | `fase4-seguridad.test.js`                    |
| SEG-9  | `/api/thumbnail` y `/api/media` solo con firma, dominio de un sitio configurado o clave de administración; `/api/media` con tope.                                       | `fase4-seguridad`, `media-route`             |
| UI-7   | Una sesión caducada lleva a la pantalla de acceso y, al entrar, de vuelta a donde se estaba.                                                                            | manual                                       |
| UI-8   | Cada vista se carga al abrirla (al arrancar, solo Buscar) y no se repiten llamadas a la API.                                                                            | `npm run e2e`                                |
| ESC-1  | Con el lanzador de escritorio, caché de miniaturas de 64 MB que se vacía tras 10 min sin uso.                                                                           | `thumbnails.test.js`                         |
| API-1  | Todos los errores de la API llevan `error` y `detail`.                                                                                                                  | `respaldos.test.js`, manual                  |

## Datos

Sin base de datos. Todo en la carpeta de datos (`DATA_DIR`; sin él, `data/` del programa): `profiles.json`, `crew.json`, `sesiones.json` (sesiones abiertas: solo resúmenes de los testigos; no entra en las copias), `busquedas.json` y `busquedas/<id>.jsonl` (índice y eventos de las búsquedas en curso y recientes), `estadisticas.json` (cifras y salud por sitio), `firma-intermediario.key` (firma de las direcciones de miniaturas y vídeo), `programadas-enviados.json` (lo ya enviado por las programadas) y ajustes, fuera de git y de la imagen.
