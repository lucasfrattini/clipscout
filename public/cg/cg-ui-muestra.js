// Solo de la página de muestra (cg-ui.html): fuera del HTML para que valga con una CSP estricta.
// Solo de la muestra. Los datos son de ejemplo.
document.addEventListener('DOMContentLoaded', () => {
  const $ = s => document.querySelector(s);
  const raiz = document.documentElement;
  document.querySelectorAll('[data-i]').forEach(b => b.append(cgIcono(b.dataset.i)));
  $('#b-estrella').append(cgIcono('estrella'));

  // Tema, acento e idioma (también por la dirección: ?tema=dark&app=clipscout&lang=en).
  const q = new URLSearchParams(location.search);
  function poner(grupo, valor) {
    for (const b of $(grupo).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.value === valor));
  }
  function tema(v) { if (v) raiz.dataset.theme = v; else delete raiz.dataset.theme; poner('#o-tema', v); }
  function acento(v) { raiz.dataset.app = v; poner('#o-acento', v); }
  function idioma(v) { raiz.lang = v; poner('#o-idioma', v); }
  if (q.has('tema')) tema(q.get('tema'));
  if (q.has('app')) acento(q.get('app'));
  if (q.has('lang')) idioma(q.get('lang'));
  $('#o-tema').addEventListener('cg-cambiado', e => tema(e.detail.chip.value));
  $('#o-acento').addEventListener('cg-cambiado', e => acento(e.detail.chip.value));
  $('#o-idioma').addEventListener('cg-cambiado', e => idioma(e.detail.chip.value));
  $('#b-apariencia').addEventListener('click', () => $('#hoja-apariencia').abrir());
  $('#b-buscar').addEventListener('click', () => cgAviso('Aquí iría el buscador.'));

  // Navegación de muestra: solo cambia el destino activo y el título.
  const barra = $('cg-barra-inferior');
  barra.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    barra.activar(a);
    $('cg-cabecera').setAttribute('titulo', a.textContent.trim());
  });

  // Filtros
  const chips = $('#chips');
  chips.addEventListener('cg-filtros', () => $('#hoja-filtros').abrir());
  $('#f-ver').addEventListener('click', () => $('#hoja-filtros').cerrar());
  $('#f-limpiar').addEventListener('click', () => {
    document.querySelectorAll('#hoja-filtros input').forEach(i => (i.checked = false));
    chips.setAttribute('filtros', '0');
  });

  // Tarjetas
  const datos = [
    ['Playa 2024', '12:34', '1,2 GB', '#f59e0b', '#ef4444'],
    ['Cumpleaños de Ana', '4:05', '640 MB', '#ec4899', '#8b5cf6'],
    ['Excursión a la sierra', '27:48', '3,9 GB', '#10b981', '#0ea5e9'],
    ['Concierto en el parque', '1:02:10', '8,1 GB', '#6366f1', '#0f172a'],
    ['Receta de pan', '9:12', '980 MB', '#f97316', '#facc15'],
    ['Partido del domingo', '45:00', '5,4 GB', '#22c55e', '#15803d'],
    ['Viaje a Lisboa', '18:20', '2,2 GB', '#0ea5e9', '#f472b6'],
    ['Primeros pasos', '0:48', '85 MB', '#a855f7', '#f59e0b'],
    ['Nieve en enero', '6:31', '720 MB', '#93c5fd', '#475569'],
    ['Taller de cerámica', '22:15', '2,8 GB', '#b45309', '#fcd34d'],
    ['Atardecer en el puerto', '3:09', '410 MB', '#fb7185', '#7c2d12'],
    ['Ensayo del coro', '31:40', '3,3 GB', '#14b8a6', '#312e81'],
  ];
  const rejilla = $('#rejilla');
  rejilla.innerHTML = datos.map(([t, d, p, a, b], i) =>
    `<a class="tarjeta" href="#v${i + 1}" data-id="${i + 1}">
      <div class="poster" style="--g: linear-gradient(135deg, ${a}, ${b})"><span class="duracion">${d}</span></div>
      <h3>${t}</h3><p>${d} · ${p}</p></a>`).join('');
  rejilla.addEventListener('click', e => {
    const a = e.target.closest('.tarjeta');
    if (!a) return;
    e.preventDefault();
    cgAviso(`Abrir «${a.querySelector('h3').textContent}»`);
  });

  // Selección múltiple + barra de acción
  const acciones = $('#acciones');
  const sel = cgSeleccion(rejilla, { item: '.tarjeta', alCambiar: claves => (acciones.cuenta = claves.length) });
  window.seleccion = sel; // para las pruebas
  acciones.addEventListener('cg-cancelar', e => { e.preventDefault(); sel.limpiar(); });
  $('#a-etiquetar').addEventListener('click', () => cgAviso(`${sel.cuenta} etiquetados`, { tipo: 'ok' }));
  $('#a-papelera').addEventListener('click', () => {
    const idos = sel.elementos;
    idos.forEach(n => n.classList.add('saliendo'));
    setTimeout(() => idos.forEach(n => (n.hidden = true)), 230);
    sel.limpiar();
    $('#total').textContent = rejilla.querySelectorAll('.tarjeta:not([hidden])').length - idos.length;
    cgAviso(`${idos.length} a la papelera`, {
      deshacer: () => {
        idos.forEach(n => { n.hidden = false; n.classList.remove('saliendo'); });
        $('#total').textContent = rejilla.querySelectorAll('.tarjeta:not([hidden])').length;
      },
    });
  });

  // Avisos y confirmaciones
  $('#b-aviso').addEventListener('click', () => cgAviso('Vídeo apartado', { deshacer: () => cgAviso('Recuperado') }));
  $('#b-ok').addEventListener('click', () => cgAviso('Ajustes guardados', { tipo: 'ok' }));
  $('#b-error').addEventListener('click', () => cgAviso('No se pudo leer la carpeta «Vacaciones». Comprueba que el disco está conectado.', { tipo: 'error', accion: { texto: 'Reintentar', fn: () => cgAviso('Reintentando…') } }));
  $('#b-confirmar').addEventListener('click', async () => {
    const si = await cgConfirmar({ titulo: '¿Mover 3 vídeos?', texto: 'Irán a la carpeta «Vacaciones».', aceptar: 'Mover' });
    cgAviso(si ? 'Movidos' : 'Cancelado');
  });
  $('#b-vaciar').addEventListener('click', async () => {
    const si = await cgConfirmar({
      titulo: '¿Vaciar la papelera?',
      texto: 'Se borrarán para siempre 38 vídeos (61 GB). No se puede deshacer.',
      aceptar: 'Vaciar',
      peligro: true,
      mantener: true,
    });
    cgAviso(si ? 'Papelera vaciada' : 'No se ha borrado nada', { tipo: si ? 'ok' : 'info' });
  });
});
