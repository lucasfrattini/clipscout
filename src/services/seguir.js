'use strict';

const crew = require('./crew');
const programadas = require('./programadas');
const { normalizar } = require('../lib/filtros');

/**
 * NU-5 «Seguir a una persona» (contrato C4). Lo pide clipkeeper desde la página de la persona: por
 * dentro es una búsqueda programada de «Recoger» (fase 6) con su nombre y todos sus alias, que
 * manda a su carpeta lo que no tengo (sin repetidos, los más largos, como mucho `limite` por
 * vuelta) cada `cada_dias`, y avisa a clipkeeper de lo que llegará (C2). Los avisos de lo mandado
 * son los de siempre (Actividad → Avisos).
 *
 * Una persona se sigue una sola vez: volver a pedirlo actualiza la que hay.
 */

const clave = s =>
  normalizar(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const numero = (v, def, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};

/** `{id, creada}`. */
async function seguir(cuerpo = {}) {
  const persona = String(cuerpo.persona || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  if (!persona) throw new crew.ErrorCrew('Falta la persona a seguir.');
  const alias = Array.isArray(cuerpo.alias) ? cuerpo.alias : [];
  const biblioteca = Number(cuerpo.biblioteca_id);
  const carpeta = String(cuerpo.carpeta || '').trim() || `People/${persona}`;
  const { programadas: lista = [] } = await programadas.listar();
  const previa = lista.find(p => p.seguida && clave(p.persona || p.termino) === clave(persona));
  const p = await programadas.guardar({
    ...(previa ? { id: previa.id } : {}),
    termino: persona,
    persona,
    alias,
    carpeta,
    bibliotecaId: Number.isInteger(biblioteca) ? biblioteca : null,
    cadaDias: numero(cuerpo.cada_dias, 7, 1, 90),
    n: numero(cuerpo.limite, 20, 1, 200),
    soloConNombre: true,
    orden: 'largos',
    sinDuracion: true,
    activa: true,
    seguida: true,
  });
  return { id: p.id, creada: !previa };
}

/** Lo que ve clipkeeper de cada persona seguida. */
function publica(p) {
  const ultima = p.ultimaVez || null;
  const proxima = ultima
    ? new Date(Date.parse(ultima) + p.cadaDias * 86400000).toISOString()
    : new Date().toISOString(); // nunca se lanzó: en la próxima vuelta del reloj (≤ 5 min)
  return {
    id: p.id,
    persona: p.persona || p.termino,
    alias: p.alias || [],
    carpeta: p.carpeta || '',
    biblioteca_id: p.bibliotecaId ?? null,
    cada_dias: p.cadaDias,
    limite: p.n,
    activa: p.activa !== false,
    ultima,
    proxima,
    ultimos_enviados: (p.ultimo?.mandados || []).map(m => ({ titulo: m.titulo, url: m.url })),
    ultimo_total: p.ultimo?.enviados ?? null,
    ultimo_error: p.ultimo?.error || null,
  };
}

async function listar() {
  const { programadas: lista = [] } = await programadas.listar();
  return { seguidas: lista.filter(p => p.seguida).map(publica) };
}

async function quitar(id) {
  const { programadas: lista = [] } = await programadas.listar();
  if (!lista.some(p => p.id === id && p.seguida)) {
    throw new crew.ErrorCrew('No se sigue a esa persona.', 404);
  }
  await programadas.quitar(id);
  return { ok: true };
}

module.exports = { seguir, listar, quitar, publica };
