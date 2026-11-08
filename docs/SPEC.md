# Especificación de clipscout

Contrato funcional de la app. **Manda sobre el código**. Flujo: [AGENTS.md](../AGENTS.md). Reglas
detalladas por función: [FEATURES.md](FEATURES.md). Arquitectura: [ARCHITECTURE.md](ARCHITECTURE.md).
Protocolo: [CREW.md](CREW.md). `DEBE` es obligatorio; `manual` significa que falta un test automático.

## Propósito y límites

Recorre sitios paginados y páginas sueltas y devuelve los ficheros y enlaces encontrados, sin
descargar nada: la descarga se delega en JDownloader. Es dueña del origen de cada vídeo.

## Requisitos

| Id     | Requisito                                                                                            | Verifica                                     |
| ------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| EXP-1  | El explorador recorre según el modo de paginación (`scroll`, plantilla, parámetro, única).           | `pagination`, `crawl.integration`            |
| EXP-2  | Frenar y continuar DEBE retomar sin repetir.                                                         | `tests/` del explorador                      |
| EXP-3  | Nunca hay descartes silenciosos: duplicados agrupados y topes avisados.                              | `dedupe`, `FEATURES.md`                      |
| VID-1  | El análisis de una URL combina sus vías; un dato opcional que falte no elimina el resultado.         | `video-options`, `video-metadata`            |
| BUS-1  | La búsqueda no se relanza al recargar y cada resultado se puede descartar y restaurar.               | manual                                       |
| BUS-2  | Un mismo vídeo sale una vez; los vídeos distintos de un álbum se conservan.                          | `dedupe`                                     |
| JD-1   | Enviar a JDownloader pregunta tipo y nombre de la carpeta, salvo destino fijado.                     | manual                                       |
| JD-2   | La ventana DEBE proponer carpetas existentes y personas o etiquetas del catálogo sin carpeta propia. | `carpetas.test.js`                           |
| JD-3   | El modo discreto de clipkeeper NO DEBE ocultar nada en esa ventana.                                  | `carpetas.test.js`, SPEC de clipkeeper DIS-2 |
| SEG-1  | Toda petición saliente DEBE pasar la validación SSRF, también al resolver y en redirecciones.        | `ssrf`, `security-regressions`               |
| SEG-2  | `trust proxy` nunca es `true`.                                                                       | `security-regressions`                       |
| SEG-3  | La interfaz no usa `innerHTML` y la CSP no admite inline.                                            | ESLint                                       |
| ACC-1  | Sin `ADMIN_PASSWORD` no hay acceso que pedir; con ella, un navegador va a `/login`.                  | `admin-password.test.js`                     |
| ACC-2  | El usuario se acepta sin distinguir mayúsculas; la contraseña sí las distingue.                      | `admin-password.test.js`                     |
| ACC-3  | La sesión es una cookie HttpOnly firmada; HTTP Basic sigue valiendo para clientes de API.            | `admin-password.test.js`                     |
| ACC-4  | Tras 8 fallos por dirección de socket, 429 durante 5 min.                                            | `admin-password.test.js`                     |
| ACC-5  | `/api/health` y el protocolo no piden contraseña.                                                    | `admin-password.test.js`                     |
| CRW-1  | Implementa el protocolo v1 de CREW.md.                                                               | `tests/` de crew                             |
| I18N-1 | Toda cadena existe en `es.js` y `en.js`.                                                             | `i18n.test.js`                               |

## Datos

Sin base de datos. `data/profiles.json`, `data/crew.json` y ajustes, fuera de git y de la imagen.
