'use strict';

/**
 * Fase 7 · FO-1…FO-5: álbumes por sitio (plantilla en el perfil), extractor de fotos a tamaño
 * completo con paginación y sin miniaturas ni anuncios, fuente «Web» (SearXNG de imágenes, con el
 * filtro por nombre), «Mandar a una persona» (un paquete por álbum en
 * <persona>/<Fotos>/<álbum> + lo esperado, C2/C3) y «¿ya lo tengo?». Todo contra servidores locales.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-f7-fotos-'));
process.env.DATA_DIR = dir;
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.HTTP_RETRIES = '1';
delete process.env.CLIPGEIST_CLAVE;

const config = require('../src/config');
const crew = require('../src/services/crew');
const jd = require('../src/services/jdownloader');
const paquetes = require('../src/services/paquetesJd');
const personas = require('../src/services/personas');
const fotos = require('../src/services/fotos');
const ajustesBusqueda = require('../src/services/ajustesBusqueda');
const { writeProfiles } = require('../src/services/profiles');
const { createApp } = require('../src/app');
const { crearClipkeeper, crearJd, crearSitio } = require('./_fase7Falsos');

const RESULTADOS = `<!doctype html><html><body>
  <nav><a href="/">Inicio</a> <a href="/acerca">Acerca</a></nav>
  <div class="item"><a href="/album/vacaciones" title="Vacaciones"><img src="/img/thumbs/vac.jpg" alt="Vacaciones"></a>
    <span>24 fotos</span></div>
  <div class="item"><a href="/album/playa"><img data-src="/img/thumbs/playa.jpg" alt="Día de playa"></a> 12 photos</div>
  <div class="item"><a href="/video/1">Un vídeo</a></div>
</body></html>`;

const ALBUM_1 = `<!doctype html><html><body>
  <img src="/logo.png" alt="logo">
  <a href="/fotos/001.jpg"><img src="/img/thumbs/001.jpg"></a>
  <a href="/fotos/002.jpg?v=1"><img src="/img/thumbs/002.jpg"></a>
  <img data-src="/fotos/003.jpg" width="1200" height="800">
  <img src="/fotos/pequena.jpg" width="120" height="90">
  <img src="https://ads.example.net/banner-728.jpg">
  <img src="https://otro.example.org/suelta.jpg">
  <img srcset="/fotos/005-400.jpg 400w, /fotos/005-1600.jpg 1600w" src="/fotos/005-400.jpg">
  <a href="/album/vacaciones?page=2" rel="next">Siguiente</a>
</body></html>`;
const ALBUM_2 = `<!doctype html><html><body>
  <a href="/fotos/006.jpg"><img src="/img/thumbs/006.jpg"></a>
  <a href="/album/vacaciones">1</a>
</body></html>`;

let sitio;
let base;
let ck;
let jdFalso;
let servidor;
let app;

before(async () => {
  sitio = crearSitio({
    '/buscar-albumes': RESULTADOS,
    '/album/vacaciones': ALBUM_1,
    '/album/vacaciones?page=2': ALBUM_2,
    '/album/playa':
      '<html><body><a href="/fotos/p1.png"><img src="/img/thumbs/p1.png"></a></body></html>',
    '/search': {
      results: [
        {
          title: 'Ana Pérez en la playa',
          url: 'https://ejemplo.com/galeria/ana',
          img_src: 'https://ejemplo.com/i/ana-1.jpg',
          thumbnail_src: 'https://ejemplo.com/i/ana-1-t.jpg',
        },
        {
          title: 'Otra cosa',
          url: 'https://ejemplo.com/x',
          img_src: 'https://ejemplo.com/i/x.jpg',
        },
        {
          title: 'Foto',
          url: 'https://ejemplo.com/anaperez',
          img_src: 'https://ejemplo.com/i/2.jpg',
        },
      ],
    },
  });
  base = await sitio.arrancar();
  ck = crearClipkeeper({
    personas: [
      {
        id: 1,
        nombre: 'Ana Pérez',
        rol: 'actriz',
        alias: [],
        biblioteca_id: 3,
        carpeta: 'People/Ana Pérez',
        carpeta_fotos: 'Fotos',
      },
    ],
  });
  jdFalso = crearJd();
  const urlCk = await ck.arrancar();
  await jd.guardar({ url: await jdFalso.arrancar(), autostart: false, biblioteca: 3 });
  await crew.guardarConexion({ app: 'clipkeeper', url: urlCk, api_key: 'clave-ck' });
  await writeProfiles([
    {
      name: 'Ejemplo — álbumes',
      config: { searchUrl: `${base}/buscar?q={q}`, albumSearchUrl: `${base}/buscar-albumes?q={q}` },
    },
    { name: 'Sin álbumes', config: { searchUrl: 'https://otro.example/buscar?q={q}' } },
  ]);
  servidor = createApp().listen(0, '127.0.0.1');
  await new Promise(r => servidor.once('listening', r));
  app = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  paquetes.parar();
  config.busqueda.searxngUrl = '';
  await Promise.all([sitio.cerrar(), ck.cerrar(), jdFalso.cerrar()]);
  servidor.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('FO-1: álbumes de una página de resultados: portada, título y nº de fotos', () => {
  const lista = fotos.albumesDeHtml(RESULTADOS, `${base}/buscar-albumes?q=x`);
  assert.deepEqual(
    lista.map(a => [new URL(a.url).pathname, a.titulo, a.n_fotos, new URL(a.thumbnail).pathname]),
    [
      ['/album/vacaciones', 'Vacaciones', 24, '/img/thumbs/vac.jpg'],
      ['/album/playa', 'Día de playa', 12, '/img/thumbs/playa.jpg'],
    ]
  );
  // Con patrón propio del sitio, solo lo que casa con él.
  const conPatron = fotos.albumesDeHtml(RESULTADOS, `${base}/b`, { patron: '/album/playa' });
  assert.equal(conPatron.length, 1);
});

test('FO-2: fotos a tamaño completo; fuera miniaturas, iconos, pequeñas y anuncios', () => {
  const r = fotos.fotosDeHtml(ALBUM_1, `${base}/album/vacaciones`);
  assert.deepEqual(
    r.fotos.map(f => new URL(f).pathname),
    ['/fotos/001.jpg', '/fotos/002.jpg', '/fotos/003.jpg', '/fotos/005-1600.jpg']
  );
  assert.equal(r.siguiente, `${base}/album/vacaciones?page=2`);
});

test('FO-2: el álbum entero, siguiendo su paginación sin repetir', async () => {
  const r = await fotos.extraerAlbum(`${base}/album/vacaciones`);
  assert.equal(r.paginas, 2);
  assert.deepEqual(
    r.fotos.map(f => new URL(f).pathname),
    ['/fotos/001.jpg', '/fotos/002.jpg', '/fotos/003.jpg', '/fotos/005-1600.jpg', '/fotos/006.jpg']
  );
});

test('C3: nombre de álbum saneado', () => {
  assert.equal(fotos.nombreAlbum('Viaje: a/b "c" <d>|e?*'), 'Viaje a b c d e');
  assert.equal(fotos.nombreAlbum('../..'), 'Album');
  assert.equal(fotos.nombreAlbum('x'.repeat(100)).length, 80);
});

test('FO-1/FO-4: buscar álbumes en los sitios con plantilla y en la web (filtro por nombre)', async () => {
  config.busqueda.searxngUrl = base;
  await ajustesBusqueda.guardar({ palabraFotos: 'verano' });
  const r = await (
    await fetch(`${app}/api/fotos/buscar?q=${encodeURIComponent('Ana Pérez')}`)
  ).json();
  assert.deepEqual(
    r.sitios.map(s => [s.nombre, s.total]),
    [['Ejemplo', 2]],
    'el sitio sin plantilla no sale'
  );
  const web = r.albumes.find(a => a.origen === 'web');
  assert.ok(web, 'hay álbum de la web');
  assert.deepEqual(web.fotos, ['https://ejemplo.com/i/ana-1.jpg', 'https://ejemplo.com/i/2.jpg']);
  assert.ok(
    r.albumes.every(a => !a.thumbnail || a.thumbnailFirma),
    'portadas firmadas'
  );
  const consulta = sitio.peticiones.find(u => u.pathname === '/search');
  assert.equal(consulta.searchParams.get('q'), 'Ana Pérez verano', 'la palabra extra del ajuste');
  assert.equal(consulta.searchParams.get('categories'), 'images');
  await ajustesBusqueda.guardar({ palabraFotos: '' });
  assert.equal((await ajustesBusqueda.leer()).palabraFotos, '');
});

test('FO-3: mandar a una persona = un paquete por álbum en su carpeta de fotos, y C2', async () => {
  personas.olvidar();
  jdFalso.estado.anadidos.length = 0;
  ck.estado.esperados.length = 0;
  const r = await fetch(`${app}/api/fotos/mandar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      persona: { nombre: 'Ana Pérez' },
      albumes: [
        { url: `${base}/album/vacaciones`, titulo: 'Vacaciones', n_fotos: 5 },
        { url: `${base}/album/playa`, titulo: 'Día: de playa', n_fotos: 1 },
      ],
    }),
  });
  assert.equal(r.status, 202);
  const { trabajo } = await r.json();
  const t = await fotos.esperar(trabajo);
  assert.equal(t.estado, 'hecho');
  assert.deepEqual(
    t.resultados.map(x => [x.album, x.enviados]),
    [
      ['Vacaciones', 5],
      ['Día de playa', 1],
    ]
  );
  assert.deepEqual(
    jdFalso.estado.anadidos.map(a => [
      a.packageName,
      a.destinationFolder,
      a.links.split('\n').length,
    ]),
    [
      ['Vacaciones', '/output/People/Ana Pérez/Fotos/Vacaciones', 5],
      ['Día de playa', '/output/People/Ana Pérez/Fotos/Día de playa', 1],
    ]
  );
  assert.equal(jdFalso.estado.anadidos[0].sourceUrl, `${base}/album/vacaciones`);
  assert.deepEqual(
    ck.estado.esperados.map(e => [
      e.biblioteca_id,
      e.carpeta,
      e.items[0].tipo,
      e.items[0].album,
      e.items[0].n_fotos,
    ]),
    [
      [3, 'People/Ana Pérez', 'album', 'Vacaciones', 5],
      [3, 'People/Ana Pérez', 'album', 'Día de playa', 1],
    ]
  );
  assert.deepEqual(ck.estado.esperados[0].items[0].personas, ['Ana Pérez']);
});

test('FO-5: ¿ya lo tengo? por la dirección y por cuántas fotos se mandaron', async () => {
  const r = await (
    await fetch(`${app}/api/fotos/tengo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        albumes: [
          { url: `${base}/album/vacaciones/`, n_fotos: 5 },
          { url: `${base}/album/playa`, n_fotos: 9 },
          { url: `${base}/album/nuevo`, n_fotos: 3 },
        ],
      }),
    })
  ).json();
  assert.deepEqual(
    r.albumes.map(a => a.estado),
    ['tengo', 'faltan', null]
  );
  ck.estado.emparejados.push({ tipo: 'album', origen_url: `${base}/album/nuevo`, n_fotos: 3 });
  const [nuevo] = await fotos.yaLoTengo([{ url: `${base}/album/nuevo`, n_fotos: 3 }]);
  assert.equal(nuevo.estado, 'tengo', 'lo emparejó clipkeeper');
});

test('FO-3: sin persona, sin álbumes o con fotos sueltas de un álbum que no es de la web', async () => {
  const mal = await fetch(`${app}/api/fotos/mandar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ persona: {}, albumes: [{ url: `${base}/album/playa` }] }),
  });
  assert.equal(mal.status, 400);
  const limpios = fotos.limpiarAlbumes([
    { url: 'https://ejemplo.com/a', fotos: ['https://ejemplo.com/1.jpg'] },
    {
      url: 'https://ejemplo.com/w',
      origen: 'web',
      fotos: ['https://ejemplo.com/1.jpg', 'javascript:x'],
    },
    { url: 'nada' },
  ]);
  assert.deepEqual(
    limpios.map(a => a.fotos),
    [null, ['https://ejemplo.com/1.jpg']]
  );
});

test('FO-1: la plantilla de álbumes se guarda en el perfil del sitio y se valida', async () => {
  const poner = body =>
    fetch(`${app}/api/ajustes/sitios-albumes/1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.equal((await poner({ albumSearchUrl: 'https://otro.example/albumes' })).status, 400);
  assert.equal((await poner({ dominio: 'nada.example', albumSearchUrl: '' })).status, 409);
  const r = await poner({
    dominio: 'otro.example',
    albumSearchUrl: 'https://otro.example/albumes?q={q}',
  });
  assert.equal(r.status, 200);
  const sitios = await (await fetch(`${app}/api/ajustes/sitios`)).json();
  assert.equal(sitios.sitios[1].albumSearchUrl, 'https://otro.example/albumes?q={q}');
  const disp = await (await fetch(`${app}/api/fotos/disponible`)).json();
  assert.equal(disp.sitios.length, 2);
  await poner({ dominio: 'otro.example', albumSearchUrl: '' });
  assert.equal((await (await fetch(`${app}/api/fotos/disponible`)).json()).sitios.length, 1);
});
