'use strict';

/**
 * Genera TERCEROS.txt: licencias de los componentes de terceros que van en el paquete y en la
 * imagen Docker (SU-09, CS-S11). Sin herramientas externas: lee package-lock.json (solo lo de
 * producción, lo que se instala con `npm ci --omit=dev`) y, de cada paquete, su package.json y su
 * fichero de licencia en node_modules. Al final, Node.js y el navegador de empaquetado/componentes.txt
 * con el enlace a su código fuente exacto.
 *
 * Uso: node empaquetado/terceros.js [raíz con package-lock.json y node_modules] [salida] [componentes]
 *      (por defecto la raíz del repositorio, empaquetado/TERCEROS.txt y empaquetado/componentes.txt;
 *      en Docker se pasa /dev/null como componentes: allí no van ni el Node ni el navegador fijados)
 */
const fs = require('node:fs');
const path = require('node:path');

const LICENCIAS = /^(licen[cs]e|copying|notice)(\.|-|$)/i;

/** Los paquetes de producción del fichero de bloqueo: [{ruta, nombre, version}], ordenados. */
function paquetesDeProduccion(lock) {
  return Object.entries(lock.packages || {})
    .filter(([ruta, p]) => ruta.startsWith('node_modules/') && !p.dev && !p.devOptional)
    .map(([ruta, p]) => ({
      ruta,
      nombre: p.name || ruta.slice(ruta.lastIndexOf('node_modules/') + 'node_modules/'.length),
      version: p.version,
      licencia: p.license,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre) || a.ruta.localeCompare(b.ruta));
}

function textoLicencia(carpeta) {
  let nombres = [];
  try {
    nombres = fs.readdirSync(carpeta).filter(n => LICENCIAS.test(n));
  } catch {
    return '';
  }
  return nombres
    .sort()
    .map(n => {
      try {
        return fs.readFileSync(path.join(carpeta, n), 'utf8').trim();
      } catch {
        return '';
      }
    })
    .filter(Boolean)
    .join('\n\n');
}

/** Líneas de componentes.txt: `nombre plataforma url sha256`. */
function leerComponentes(fichero) {
  return fs
    .readFileSync(fichero, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const [nombre, plataforma, url, sha256] = l.split(/\s+/);
      return { nombre, plataforma, url, sha256 };
    });
}

const FUENTES = {
  node: v => ({
    licencia: 'MIT (con componentes de otras licencias: ver LICENSE de Node.js)',
    fuente: `https://github.com/nodejs/node/tree/v${v}`,
    texto: `https://raw.githubusercontent.com/nodejs/node/v${v}/LICENSE`,
  }),
  'chrome-headless-shell': v => ({
    licencia: 'BSD-3-Clause y otras (LICENSE.headless_shell, junto al ejecutable)',
    fuente: `https://chromium.googlesource.com/chromium/src/+/refs/tags/${v}`,
    texto: `https://chromium.googlesource.com/chromium/src/+/refs/tags/${v}/LICENSE`,
  }),
};

function generar(raiz, { componentes = path.join(__dirname, 'componentes.txt') } = {}) {
  const lock = JSON.parse(fs.readFileSync(path.join(raiz, 'package-lock.json'), 'utf8'));
  const propio = lock.packages?.[''] || {};
  const partes = [
    `Componentes de terceros de ${propio.name || 'clipscout'} ${propio.version || ''}`.trim(),
    '',
    `${propio.name || 'clipscout'} se distribuye con licencia ${propio.license || 'AGPL-3.0-or-later'}`,
    '(fichero LICENSE). Lo que sigue son los componentes de otros autores que incluye, con su',
    'licencia. Generado por empaquetado/terceros.js; no se edita a mano.',
    '',
    'En la imagen Docker, Node.js es el de la imagen oficial «node» y el navegador el paquete',
    '«chromium» de Debian (sus licencias, en /usr/share/doc/chromium/copyright dentro de la imagen).',
    '',
  ];
  const separador = '-'.repeat(78);
  for (const c of leerComponentes(componentes)) {
    const version = (c.url.match(/v?(\d+\.\d+\.\d+(?:\.\d+)?)/) || [])[1] || '';
    const datos = FUENTES[c.nombre]?.(version);
    if (!datos) continue;
    partes.push(
      separador,
      `${c.nombre} ${version} (${c.plataforma}) — ${datos.licencia}`,
      `Descarga: ${c.url}`,
      `sha256: ${c.sha256}`,
      `Código fuente: ${datos.fuente}`,
      `Licencia completa: ${datos.texto}`,
      ''
    );
  }
  for (const p of paquetesDeProduccion(lock)) {
    const carpeta = path.join(raiz, p.ruta);
    let pj = {};
    try {
      pj = JSON.parse(fs.readFileSync(path.join(carpeta, 'package.json'), 'utf8'));
    } catch {
      /* sin instalar: queda lo del fichero de bloqueo */
    }
    const repo = typeof pj.repository === 'string' ? pj.repository : pj.repository?.url || '';
    partes.push(
      separador,
      `${p.nombre} ${pj.version || p.version} — ${pj.license || p.licencia || 'sin licencia declarada'}`
    );
    if (repo) partes.push(`Código fuente: ${repo.replace(/^git\+/, '')}`);
    const texto = textoLicencia(carpeta);
    partes.push('', texto || '(el paquete no incluye fichero de licencia)', '');
  }
  return `${partes.join('\n')}\n`;
}

if (require.main === module) {
  const raiz = path.resolve(process.argv[2] || path.join(__dirname, '..'));
  const salida = path.resolve(process.argv[3] || path.join(__dirname, 'TERCEROS.txt'));
  const componentes = process.argv[4] ? path.resolve(process.argv[4]) : undefined;
  fs.writeFileSync(salida, generar(raiz, componentes ? { componentes } : {}));
  process.stdout.write(`${salida}\n`);
}

module.exports = { generar, paquetesDeProduccion, leerComponentes };
