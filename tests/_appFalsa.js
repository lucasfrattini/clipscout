'use strict';

const http = require('node:http');

/**
 * Doble de otra app de Clipgeist (clipkeeper o clonbuster) con el protocolo de la fase 1: status,
 * alta de conexión, renovar, y validar/cerrar sesiones. `vieja: true` imita una versión anterior a
 * las claves de conexión (sin /renovar ni /sesion, y sin `clave` en el alta).
 *
 * `admin` es su clave de administración; `entradas` las claves de conexión que ha dado (para que
 * clipscout la llame); `paraLlamar` la clave con la que llama ella a clipscout; `llamadas` lo que
 * ha recibido.
 */
function crearAppFalsa({ app = 'clipkeeper', admin = 'admin-de-la-otra', vieja = false } = {}) {
  const estado = {
    admin,
    entradas: new Set(),
    paraLlamar: null,
    llamadas: [],
    sesiones: new Map(), // testigo → usuario
    cerradas: [],
    caida: false,
  };
  let n = 0;
  const servidor = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', c => {
      cuerpo += c;
    });
    req.on('end', () => {
      const datos = cuerpo ? JSON.parse(cuerpo) : {};
      const clave = req.headers['x-api-key'];
      estado.llamadas.push({ metodo: req.method, ruta: req.url, clave, datos });
      const responder = (codigo, json) => {
        res.writeHead(codigo, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (estado.caida) {
        req.socket.destroy();
        return;
      }
      const esAdmin = clave === estado.admin;
      const valida = esAdmin || estado.entradas.has(clave);
      if (!valida) return responder(401, { detail: 'clave' });
      if (req.url === '/api/crew/v1/status') {
        return responder(200, { crew: 'Clipgeist', protocolo: 1, app, instancia: app });
      }
      if (req.url === '/api/crew/v1/conexiones' && req.method === 'POST') {
        estado.paraLlamar = datos.clave || datos.api_key;
        if (vieja) return responder(200, { id: 1, creada: true });
        n += 1;
        const nueva = `cgc_${app}_${n}`.padEnd(47, 'x');
        estado.entradas.add(nueva);
        return responder(200, { id: 1, creada: true, clave: nueva });
      }
      if (vieja) return responder(404, { detail: 'Not Found' });
      if (req.url === '/api/crew/v1/conexiones/renovar') {
        estado.paraLlamar = datos.clave;
        n += 1;
        const nueva = `cgc_${app}_${n}`.padEnd(47, 'x');
        estado.entradas.add(nueva);
        return responder(200, { clave: nueva });
      }
      if (req.url === '/api/crew/v1/sesion/validar') {
        const usuario = estado.sesiones.get(datos.testigo);
        return responder(
          200,
          usuario ? { ok: true, usuario, caduca: '2099-01-01' } : { ok: false }
        );
      }
      if (req.url === '/api/crew/v1/sesion/cerrar') {
        estado.cerradas.push(datos.testigo);
        estado.sesiones.delete(datos.testigo);
        return responder(200, { ok: true });
      }
      return responder(404, { detail: 'Not Found' });
    });
  });
  return {
    estado,
    servidor,
    async arrancar() {
      servidor.listen(0, '127.0.0.1');
      await new Promise(r => servidor.once('listening', r));
      return `http://127.0.0.1:${servidor.address().port}`;
    },
    cerrar: () => new Promise(r => servidor.close(r)),
  };
}

module.exports = { crearAppFalsa };
