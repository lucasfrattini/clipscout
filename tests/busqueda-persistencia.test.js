'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipscout-persist-'));
process.env.DATA_DIR = dir;
process.env.PROFILES_PATH = path.join(dir, 'profiles.json');
process.env.CREW_PATH = path.join(dir, 'crew.json');
process.env.SECURITY_BLOCK_PRIVATE_ADDRESSES = 'false';
process.env.BROWSER_ENABLED = 'false';
process.env.CRAWL_PAGE_DELAY_MS = '0';
process.env.THROTTLE_MIN_INTERVAL_MS = '0';
process.env.SEARXNG_URL = '';
process.env.BUSQUEDA_PERSISTIR_MS = '50';

const RUTA_FONDO = require.resolve('../src/services/busquedasFondo');
let fondo = require('../src/services/busquedasFondo');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('entradaPendiente: solo los sitios (o enlaces) que no terminaron', () => {
  const ev = (type, extra) => ({ type, ...extra });
  const eventos = [
    ev('sitios', { sitios: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: -1 }] }),
    ev('sitio_fin', { sitio: 1 }),
  ];
  assert.deepEqual(fondo.entradaPendiente({ q: 'playa', abierta: true }, eventos), {
    q: 'playa',
    abierta: true,
    sitios: [0, 2],
  });
  const conWebHecha = [...eventos, ev('sitio_fin', { sitio: -1 })];
  assert.equal(fondo.entradaPendiente({ q: 'x', abierta: true }, conWebHecha).abierta, false);
  // Sin la lista de sitios no había empezado: se repite tal cual.
  assert.deepEqual(fondo.entradaPendiente({ q: 'x' }, []), { q: 'x' });
  // Enlaces pegados: conservan su posición original (su id) al retomarse.
  const urls = ['https://ejemplo.com/a', 'https://ejemplo.com/b', 'https://ejemplo.com/c'];
  const r = fondo.entradaPendiente({ url: urls[0], urls }, [
    ev('sitios', { sitios: [{ id: -2 }, { id: -3 }, { id: -4 }] }),
    ev('sitio_fin', { sitio: -2 }),
  ]);
  assert.deepEqual(r.urls, [urls[1], urls[2]]);
  assert.deepEqual(r.indices, [1, 2]);
});

function crearSitio(retrasoLento) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    const sitio = url.pathname.split('/')[1];
    if (url.pathname.endsWith('/buscar')) {
      res.end([1, 2].map(n => `<a href="/${sitio}/v/${n}">v${n}</a>`).join(''));
    } else {
      setTimeout(
        () => res.end(`<video src="/${sitio}/m/${url.pathname.split('/').pop()}.mp4"></video>`),
        sitio === 'lento' ? retrasoLento : 0
      );
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('tras un reinicio se retoma sola, solo en el sitio que faltaba, sin perder lo ya visto', async t => {
  const server = await crearSitio(400);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const perfil = nombre => ({
    name: nombre,
    config: {
      searchUrl: `${base}/${nombre}/buscar?q={q}`,
      linkPattern: '/v/',
      fileExtensions: '.mp4',
    },
  });
  fs.writeFileSync(
    process.env.PROFILES_PATH,
    JSON.stringify({ profiles: [perfil('rapido'), perfil('lento')] })
  );

  const id = fondo.iniciar({ q: 'playa', paginas: 1 }, { carpeta: 'Viajes' });
  // Se espera a que el rápido termine y el lento siga a medias.
  const vistos = [];
  fondo.suscribir(id, 0, e => vistos.push(e));
  for (let i = 0; i < 100 && !vistos.some(e => e.type === 'sitio_fin' && e.sitio === 0); i++) {
    await new Promise(r => setTimeout(r, 20));
  }
  assert.ok(vistos.some(e => e.type === 'sitio_fin' && e.sitio === 0));
  assert.ok(!vistos.some(e => e.type === 'fin'));

  // «SIGTERM»: foto en el acto y se deja de escribir; la búsqueda vieja muere con el proceso.
  fondo.guardarAlApagar();
  fondo.parar(id);
  const guardado = JSON.parse(fs.readFileSync(path.join(dir, 'busquedas.json'), 'utf8'));
  assert.equal(guardado.busquedas[0].estado, 'curso');
  const antes = guardado.busquedas[0].eventos.length;

  // «Arranque nuevo»: otra instancia del módulo lee el fichero y la retoma.
  delete require.cache[RUTA_FONDO];
  fondo = require('../src/services/busquedasFondo');
  const r = await fondo.restaurar();
  assert.equal(r.retomadas, 1);
  const eventos = [];
  fondo.suscribir(id, 0, e => eventos.push(e));
  for (let i = 0; i < 200 && !eventos.some(e => e.type === 'fin'); i++) {
    await new Promise(r => setTimeout(r, 25));
  }
  assert.equal(eventos.at(-1).type, 'fin');
  assert.deepEqual(
    eventos.map(e => e.seq),
    eventos.map((_, i) => i),
    'la numeración sigue donde iba: quien mira no ve huecos ni repetidos'
  );
  const despues = eventos.slice(antes);
  assert.equal(despues[0].type, 'reanudada');
  const sitiosNuevos = despues.find(e => e.type === 'sitios').sitios.map(s => s.id);
  assert.deepEqual(sitiosNuevos, [1], 'solo el sitio que no había terminado');
  const ficheros = new Set(
    eventos.filter(e => e.type === 'resultados').flatMap(e => e.items.map(i => i.url))
  );
  assert.equal(ficheros.size, 4, 'los dos de cada sitio');
  assert.equal(
    eventos.filter(e => e.type === 'resultados').flatMap(e => e.items).length,
    4,
    'lo encontrado antes del corte no se repite'
  );
  assert.equal(fondo.lista().find(b => b.id === id).carpeta, 'Viajes');

  // Las terminadas siguen visibles tras otro reinicio.
  await fondo.guardarAhora();
  delete require.cache[RUTA_FONDO];
  fondo = require('../src/services/busquedasFondo');
  const otra = await fondo.restaurar();
  assert.deepEqual(otra, { retomadas: 0, terminadas: 1 });
  assert.equal(fondo.lista()[0].estado, 'fin');
});
