/**
 * Código QR propio, sin dependencias ni CDN (asistente de primer arranque, «Úsalo desde el
 * móvil»). Solo lo necesario para una dirección: modo byte (UTF-8), corrección de errores M y
 * versiones 1 a 10 (hasta 213 bytes). Sigue la norma ISO/IEC 18004 paso a paso.
 */

// Por versión (índice 1..10), nivel M: códigos de corrección por bloque y número de bloques.
const ECC_POR_BLOQUE = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOQUES = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const VERSION_MAX = 10;

/** Módulos de datos de una versión (todo menos los patrones fijos). */
function modulosDeDatos(v) {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const alineaciones = Math.floor(v / 7) + 2;
    n -= (25 * alineaciones - 10) * alineaciones - 55;
    if (v >= 7) n -= 36;
  }
  return n;
}

const bytesDeDatos = v => Math.floor(modulosDeDatos(v) / 8) - ECC_POR_BLOQUE[v] * BLOQUES[v];

/* ── Reed-Solomon sobre GF(256), polinomio 0x11D ─────────────────────── */

function multiplicar(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function divisor(grado) {
  const r = new Array(grado).fill(0);
  r[grado - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < grado; i += 1) {
    for (let j = 0; j < grado; j += 1) {
      r[j] = multiplicar(r[j], raiz);
      if (j + 1 < grado) r[j] ^= r[j + 1];
    }
    raiz = multiplicar(raiz, 0x02);
  }
  return r;
}

function resto(datos, div) {
  const r = new Array(div.length).fill(0);
  for (const b of datos) {
    const factor = b ^ r.shift();
    r.push(0);
    for (let i = 0; i < div.length; i += 1) r[i] ^= multiplicar(div[i], factor);
  }
  return r;
}

/* ── Datos: modo byte, relleno, bloques con su corrección, intercalado ── */

function codificarDatos(bytes, v) {
  const bits = [];
  const poner = (valor, n) => {
    for (let i = n - 1; i >= 0; i -= 1) bits.push((valor >>> i) & 1);
  };
  poner(0b0100, 4);
  poner(bytes.length, v <= 9 ? 8 : 16);
  for (const b of bytes) poner(b, 8);
  const capacidad = bytesDeDatos(v) * 8;
  poner(0, Math.min(4, capacidad - bits.length));
  poner(0, (8 - (bits.length % 8)) % 8);
  for (let relleno = 0xec; bits.length < capacidad; relleno ^= 0xec ^ 0x11) poner(relleno, 8);
  const datos = [];
  for (let i = 0; i < bits.length; i += 8) {
    datos.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  }
  // Bloques: los cortos primero; todos llevan la misma cantidad de corrección.
  const nBloques = BLOQUES[v];
  const ecc = ECC_POR_BLOQUE[v];
  const total = Math.floor(modulosDeDatos(v) / 8);
  const cortos = nBloques - (total % nBloques);
  const largoCorto = Math.floor(total / nBloques);
  const div = divisor(ecc);
  const bloques = [];
  for (let i = 0, k = 0; i < nBloques; i += 1) {
    const trozo = datos.slice(k, k + largoCorto - ecc + (i < cortos ? 0 : 1));
    k += trozo.length;
    const correccion = resto(trozo, div);
    if (i < cortos) trozo.push(0);
    bloques.push(trozo.concat(correccion));
  }
  const salida = [];
  for (let i = 0; i < bloques[0].length; i += 1) {
    bloques.forEach((b, j) => {
      if (i !== largoCorto - ecc || j >= cortos) salida.push(b[i]);
    });
  }
  return salida;
}

/* ── Matriz ─────────────────────────────────────────────────────────── */

function posicionesAlineacion(v) {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2;
  const paso = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let p = v * 4 + 17 - 7; r.length < n; p -= paso) r.splice(1, 0, p);
  return r;
}

function crearMatriz(v) {
  const tam = v * 4 + 17;
  const m = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const fijo = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const poner = (x, y, oscuro) => {
    m[y][x] = oscuro;
    fijo[y][x] = true;
  };
  for (let i = 0; i < tam; i += 1) {
    poner(6, i, i % 2 === 0);
    poner(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [tam - 4, 3],
    [3, tam - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= tam || y >= tam) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        poner(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const al = posicionesAlineacion(v);
  for (let i = 0; i < al.length; i += 1) {
    for (let j = 0; j < al.length; j += 1) {
      const esquina =
        (i === 0 && j === 0) ||
        (i === 0 && j === al.length - 1) ||
        (i === al.length - 1 && j === 0);
      if (esquina) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          poner(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }
  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i += 1) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const bits = (v << 12) | r;
    for (let i = 0; i < 18; i += 1) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = tam - 11 + (i % 3);
      const b = Math.floor(i / 3);
      poner(a, b, bit);
      poner(b, a, bit);
    }
  }
  return { tam, m, fijo, poner };
}

function ponerFormato(q, mascara) {
  const { tam, poner } = q;
  const datos = (0 << 3) | mascara; // nivel M = 00
  let r = datos;
  for (let i = 0; i < 10; i += 1) r = (r << 1) ^ ((r >>> 9) * 0x537);
  const bits = ((datos << 10) | r) ^ 0x5412;
  const bit = i => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i += 1) poner(8, i, bit(i));
  poner(8, 7, bit(6));
  poner(8, 8, bit(7));
  poner(7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) poner(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i += 1) poner(tam - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) poner(8, tam - 15 + i, bit(i));
  poner(8, tam - 8, true);
}

function ponerDatos(q, datos) {
  const { tam, m, fijo } = q;
  let i = 0;
  for (let derecha = tam - 1; derecha >= 1; derecha -= 2) {
    if (derecha === 6) derecha = 5;
    for (let vert = 0; vert < tam; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = derecha - j;
        const subiendo = ((derecha + 1) & 2) === 0;
        const y = subiendo ? tam - 1 - vert : vert;
        if (!fijo[y][x] && i < datos.length * 8) {
          m[y][x] = ((datos[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i += 1;
        }
      }
    }
  }
}

const MASCARAS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  x => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function aplicarMascara(q, k) {
  for (let y = 0; y < q.tam; y += 1) {
    for (let x = 0; x < q.tam; x += 1) {
      if (!q.fijo[y][x] && MASCARAS[k](x, y)) q.m[y][x] = !q.m[y][x];
    }
  }
}

/** Penalización de la norma (rachas, bloques 2×2, falsos buscadores y equilibrio). */
function penalizacion({ tam, m }) {
  let p = 0;
  const lineas = [];
  for (let i = 0; i < tam; i += 1) {
    lineas.push(m[i]);
    lineas.push(m.map(fila => fila[i]));
  }
  const patron = [true, false, true, true, true, false, true];
  for (const l of lineas) {
    let racha = 1;
    for (let i = 1; i <= tam; i += 1) {
      if (i < tam && l[i] === l[i - 1]) racha += 1;
      else {
        if (racha >= 5) p += racha - 2;
        racha = 1;
      }
    }
    for (let i = 0; i + 7 <= tam; i += 1) {
      if (!patron.every((b, k) => l[i + k] === b)) continue;
      const antes = [1, 2, 3, 4].every(k => i - k < 0 || !l[i - k]);
      const despues = [0, 1, 2, 3].every(k => i + 7 + k >= tam || !l[i + 7 + k]);
      if (antes || despues) p += 40;
    }
  }
  let oscuros = 0;
  for (let y = 0; y < tam; y += 1) {
    for (let x = 0; x < tam; x += 1) {
      if (m[y][x]) oscuros += 1;
      if (y + 1 < tam && x + 1 < tam) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
      }
    }
  }
  const total = tam * tam;
  p += Math.ceil(Math.abs(oscuros * 20 - total * 10) / total - 1) * 10;
  return p;
}

/**
 * Codifica `texto`. Devuelve `{ tam, modulos }` (modulos[y][x] = true si es oscuro). Lanza si no
 * cabe en la versión 10.
 */
export function codificarQR(texto) {
  const bytes = [...new TextEncoder().encode(String(texto))];
  let v = 1;
  while (v <= VERSION_MAX && bytes.length + (v <= 9 ? 2 : 3) > bytesDeDatos(v)) v += 1;
  if (v > VERSION_MAX) throw new Error('Texto demasiado largo para el código QR');
  const datos = codificarDatos(bytes, v);
  let mejor = null;
  for (let k = 0; k < 8; k += 1) {
    const q = crearMatriz(v);
    ponerFormato(q, k);
    ponerDatos(q, datos);
    aplicarMascara(q, k);
    const p = penalizacion(q);
    if (!mejor || p < mejor.p) mejor = { p, q };
  }
  return { tam: mejor.q.tam, modulos: mejor.q.m, version: v };
}

/** Un `<svg>` con el código (un solo `path`), con margen de 4 módulos. Sin innerHTML. */
export function svgQR(texto, { etiqueta = '' } = {}) {
  const { tam, modulos } = codificarQR(texto);
  const NS = 'http://www.w3.org/2000/svg';
  const borde = 4;
  const lado = tam + borde * 2;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${lado} ${lado}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('role', 'img');
  if (etiqueta) svg.setAttribute('aria-label', etiqueta);
  const fondo = document.createElementNS(NS, 'rect');
  fondo.setAttribute('width', String(lado));
  fondo.setAttribute('height', String(lado));
  fondo.setAttribute('fill', '#fff');
  let d = '';
  for (let y = 0; y < tam; y += 1) {
    for (let x = 0; x < tam; x += 1) {
      if (modulos[y][x]) d += `M${x + borde},${y + borde}h1v1h-1z`;
    }
  }
  const camino = document.createElementNS(NS, 'path');
  camino.setAttribute('d', d);
  camino.setAttribute('fill', '#000');
  svg.append(fondo, camino);
  return svg;
}
