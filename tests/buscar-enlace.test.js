'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.CRAWL_PAGE_DELAY_MS = '0';
process.env.THROTTLE_MIN_INTERVAL_MS = '0';

const { buscarEnlace, ID_ENLACE } = require('../src/services/busqueda');

/**
 * Un enlace pegado en la caja de Buscar (lo que antes eran el Explorador y Vídeos): si es un
 * listado se recorren sus fichas; si es la página de un vídeo, se saca ese vídeo.
 */

function crearSitio() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (url.pathname === '/categoria') {
      const n = Number(url.searchParams.get('page') || 1);
      const fichas = n === 1 ? [1, 2, 3, 4, 5, 6] : [];
      res.end(
        `<html><body>${fichas.map(i => `<a href="/v/${i}/clip-de-prueba-${i}">c${i}</a>`).join('')}` +
          [2, 3].map(p => `<a href="/categoria?page=${p}">${p}</a>`).join('') +
          '</body></html>'
      );
    } else if (url.pathname.startsWith('/v/')) {
      res.end(
        `<html><body><video src="/m/${url.pathname.split('/')[2]}.mp4"></video></body></html>`
      );
    } else {
      res.end('<html><body><p>Hola</p><video src="/m/suelto.mp4"></video></body></html>');
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function correr(url) {
  const eventos = [];
  const r = await buscarEnlace({ url, paginas: 1 }, { emit: e => eventos.push(e) });
  const urls = eventos.filter(e => e.type === 'resultados').flatMap(e => e.items.map(i => i.url));
  return { r, eventos, urls };
}

test('un listado: recorre sus fichas y saca el vídeo de cada una', async t => {
  const server = await crearSitio();
  t.after(() => server.close());
  const { r, eventos, urls } = await correr(`http://127.0.0.1:${server.address().port}/categoria`);
  assert.equal(r.total, 6);
  assert.ok(urls.every(u => /\/m\/\d\.mp4$/.test(u)));
  assert.equal(eventos[0].sitios[0].id, ID_ENLACE);
  assert.ok(eventos.some(e => e.modo === 'listado'));
});

test('la página de un vídeo: saca ese vídeo', async t => {
  const server = await crearSitio();
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const { r, urls, eventos } = await correr(`${base}/un-video`);
  assert.equal(r.total, 1);
  assert.equal(urls[0], `${base}/m/suelto.mp4`);
  assert.ok(eventos.some(e => e.modo === 'pagina'));
  const item = eventos.find(e => e.type === 'resultados').items[0];
  assert.equal(item.sourceUrl, `${base}/un-video`, 'se descarga la página, como en el resto');
});
