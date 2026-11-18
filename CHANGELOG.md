# Cambios

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
