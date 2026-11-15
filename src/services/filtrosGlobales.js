'use strict';

const crew = require('./crew');
const { palabras } = require('../lib/filtros');

/**
 * «Palabras siempre bloqueadas» (Ajustes → Filtros). Vacío por defecto.
 *
 * Se aplican en TRES sitios, y por eso viven aquí y no en la vista: Buscar (cada resultado llega
 * marcado y la pantalla lo oculta con contador, nunca en silencio), las búsquedas programadas (no
 * se mandan) y cualquier envío a JDownloader (se quitan del envío y se dice cuántos).
 *
 * Se guardan en data/crew.json (`filtros`) y se tienen en memoria: Buscar las consulta en cada
 * tanda de resultados y leer el fichero cada vez sería gastar disco por nada.
 */

let texto = '';
let lista = [];

function aplicar(valor) {
  texto = String(valor || '')
    .slice(0, 4000)
    .trim();
  lista = palabras(texto);
}

/** Al arrancar: lo guardado pasa a memoria. */
async function cargar() {
  const d = await crew.datos();
  aplicar(d.filtros?.bloqueadas || '');
}

function leer() {
  return { bloqueadas: texto, lista: [...lista] };
}

/** Las palabras ya normalizadas, listas para `bloqueadaPor`. */
function bloqueadas() {
  return lista;
}

async function guardar({ bloqueadas: nuevo = '' } = {}) {
  aplicar(nuevo);
  await crew.cambiar(d => {
    d.filtros = { ...(d.filtros || {}), bloqueadas: texto };
  });
  return leer();
}

module.exports = { cargar, leer, guardar, bloqueadas, aplicar };
