# Cambios

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
