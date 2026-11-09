'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Servidor de pruebas en 127.0.0.1 y sin Chromium (ver crawl.integration.test.js).
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.CRAWL_PAGE_DELAY_MS = '0';
process.env.THROTTLE_MIN_INTERVAL_MS = '0';
process.env.HTTP_RETRY_BASE_DELAY_MS = '0';

const {
  configurarSitio,
  plantillaDesdeUrl,
  plantillaDeFormulario,
  plantillaOpenSearch,
  portadaDe,
  extensionesDeVideo,
} = require('../src/services/autoSitio');

/**
 * Alta de un sitio con solo su dirección: lo que antes se configuraba a mano (dirección de
 * búsqueda, paginación, patrón, tipo de fichero) sale solo y llega PROBADO.
 */

test('la dirección de una búsqueda real se convierte en plantilla con {q}', () => {
  assert.equal(
    plantillaDesdeUrl('https://ejemplo.com/search/ana-perez/', 'Ana Pérez'.normalize()),
    null,
    'con acentos distintos no se inventa dónde va'
  );
  assert.equal(
    plantillaDesdeUrl('https://ejemplo.com/search/ana-lopez/', 'ana lopez'),
    'https://ejemplo.com/search/{q}/'
  );
  assert.equal(
    plantillaDesdeUrl('https://ejemplo.com/buscar?q=ana+lopez&orden=1', 'Ana Lopez'),
    'https://ejemplo.com/buscar?q={q}&orden=1'
  );
  assert.equal(
    plantillaDesdeUrl('https://ejemplo.com/?s=ana%20lopez', 'ana lopez'),
    'https://ejemplo.com/?s={q}'
  );
  assert.equal(plantillaDesdeUrl('https://ejemplo.com/', 'ana'), null);
});

test('el formulario de búsqueda del HTML: campo correcto, ocultos incluidos, nunca POST', () => {
  const html = `
    <form action="/login" method="post"><input name="q"></form>
    <form action="/newsletter"><input type="text" name="email"></form>
    <form action="/buscar"><input type="hidden" name="tipo" value="video">
      <input type="search" name="k" placeholder="Buscar"></form>`;
  assert.equal(
    plantillaDeFormulario(html, 'https://ejemplo.com/'),
    'https://ejemplo.com/buscar?tipo=video&k={q}'
  );
  assert.equal(
    plantillaDeFormulario('<form method="post"><input name="q"></form>', 'https://ejemplo.com/'),
    null
  );
});

test('OpenSearch: la plantilla html, sin los parámetros opcionales', () => {
  const xml = `<OpenSearchDescription>
    <Url type="application/rss+xml" template="https://ejemplo.com/rss?q={searchTerms}"/>
    <Url type="text/html" template="https://ejemplo.com/search?q={searchTerms}&amp;p={startPage?}"/>
  </OpenSearchDescription>`;
  assert.equal(plantillaOpenSearch(xml), 'https://ejemplo.com/search?q={q}');
});

test('direcciones y extensiones', () => {
  assert.equal(portadaDe('ejemplo.com'), 'https://ejemplo.com/');
  assert.equal(portadaDe('http://www.ejemplo.com/algo?x=1'), 'http://www.ejemplo.com/');
  assert.throws(() => portadaDe(''), /dirección/);
  assert.equal(extensionesDeVideo('.jpg, .webm'), '.webm');
  assert.match(extensionesDeVideo('.jpg'), /\.mp4/);
});

/** Un sitio con portada + formulario, listado paginado y fichas con su vídeo. */
function crearSitio({ conVideo = true } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const html = cuerpo => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<html><body>${cuerpo}</body></html>`);
    };
    if (url.pathname === '/') {
      return html('<a href="/ayuda">ayuda</a><form action="/resultados"><input name="q"></form>');
    }
    if (url.pathname === '/resultados') {
      const q = url.searchParams.get('q') || '';
      const pagina = Number(url.searchParams.get('page') || '1');
      const fichas = q && pagina <= 2 ? [1, 2, 3, 4, 5].map(n => n + (pagina - 1) * 5) : [];
      return html(`<h1>Resultados de ${q}</h1>
        ${fichas.map(n => `<a href="/v/${n}/clip-de-prueba-${n}">clip ${n}</a>`).join('')}
        <a href="/ayuda">ayuda</a><a href="/contacto">contacto</a>
        <nav>${[2, 3].map(p => `<a href="/resultados?q=${encodeURIComponent(q)}&page=${p}">${p}</a>`).join('')}</nav>`);
    }
    if (url.pathname.startsWith('/v/')) {
      const n = url.pathname.split('/')[2];
      return html(
        `<title>Clip ${n}</title>${conVideo ? `<video src="/media/clip-${n}.mp4"></video>` : ''}`
      );
    }
    res.writeHead(404);
    res.end('no');
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('alta de punta a punta: encuentra el buscador, la paginación y el patrón, y lo prueba', async t => {
  const server = await crearSitio();
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const r = await configurarSitio({ url: base, termino: 'playa' });

  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.via, 'formulario');
  assert.match(r.config.searchUrl, /\/resultados\?q=\{q\}/);
  assert.match(r.config.linkPattern, /v/);
  assert.ok(r.prueba.ficheros > 0, 'la prueba llegó hasta los vídeos');
  assert.match(r.prueba.ejemplos[0].url, /\.mp4$/);
});

test('alta: si las fichas no tienen vídeo, no se da por buena y dice por qué', async t => {
  const server = await crearSitio({ conVideo: false });
  t.after(() => server.close());
  const r = await configurarSitio({
    url: `http://127.0.0.1:${server.address().port}`,
    termino: 'playa',
  });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'sin_ficheros');
});
