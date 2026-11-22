'use strict';

const http = require('node:http');

/**
 * Dobles para la fase 7: un clipkeeper con personas (C1) y lo esperado (C2), y un gestor de
 * descargas (API local de JDownloader) que apunta lo que recibe. Todo en 127.0.0.1, puerto libre.
 */

function escuchar(servidor) {
  servidor.listen(0, '127.0.0.1');
  return new Promise(r =>
    servidor.once('listening', () => r(`http://127.0.0.1:${servidor.address().port}`))
  );
}

function crearClipkeeper({ personas = [], esperadosEstado = 201 } = {}) {
  const estado = { personas, esperados: [], llamadas: [], esperadosEstado, emparejados: [] };
  const servidor = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', c => (cuerpo += c));
    req.on('end', () => {
      const datos = cuerpo ? JSON.parse(cuerpo) : {};
      const url = new URL(req.url, 'http://x');
      estado.llamadas.push({
        metodo: req.method,
        ruta: url.pathname,
        clave: req.headers['x-api-key'],
        datos,
      });
      const responder = (codigo, json) => {
        res.writeHead(codigo, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (url.pathname === '/api/crew/v1/personas') {
        return responder(200, { personas: estado.personas });
      }
      if (url.pathname === '/api/crew/v1/esperados' && req.method === 'POST') {
        if (estado.esperadosEstado !== 201) {
          return responder(estado.esperadosEstado, { detail: 'no' });
        }
        estado.esperados.push(datos);
        return responder(201, {
          ids: datos.items.map((_, i) => estado.esperados.length * 1000 + i),
        });
      }
      if (url.pathname === '/api/crew/v1/esperados' && req.method === 'GET') {
        const e = url.searchParams.get('estado');
        return responder(200, { esperados: e === 'emparejado' ? estado.emparejados : [] });
      }
      if (url.pathname === '/api/crew/v1/reglas') return responder(200, { ok: true });
      return responder(404, { detail: 'Not Found' });
    });
  });
  return {
    estado,
    servidor,
    arrancar: () => escuchar(servidor),
    cerrar: () => new Promise(r => servidor.close(r)),
  };
}

function crearJd() {
  const estado = { anadidos: [] };
  const servidor = http.createServer((req, res) => {
    const [ruta, query = ''] = req.url.split('?');
    const params = query ? query.split('&').map(p => JSON.parse(decodeURIComponent(p))) : [];
    const responder = data => res.end(JSON.stringify({ data }));
    if (ruta === '/jd/version') return responder(1);
    if (ruta === '/config/get') return responder('/output');
    if (ruta === '/linkgrabberv2/addLinks') {
      estado.anadidos.push(params[0]);
      return responder({ id: estado.anadidos.length });
    }
    return responder([]);
  });
  return {
    estado,
    servidor,
    arrancar: () => escuchar(servidor),
    cerrar: () => new Promise(r => servidor.close(r)),
  };
}

/** Un servidor de páginas HTML fijas: `{ruta: html}`. */
function crearSitio(paginas) {
  const peticiones = [];
  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    peticiones.push(url);
    const html = paginas[url.pathname + url.search] ?? paginas[url.pathname];
    if (html === undefined) {
      res.statusCode = 404;
      return res.end('no');
    }
    res.setHeader('Content-Type', typeof html === 'object' ? 'application/json' : 'text/html');
    return res.end(typeof html === 'object' ? JSON.stringify(html) : html);
  });
  return {
    peticiones,
    servidor,
    arrancar: () => escuchar(servidor),
    cerrar: () => new Promise(r => servidor.close(r)),
  };
}

module.exports = { crearClipkeeper, crearJd, crearSitio };
