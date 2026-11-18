// Pantalla de acceso. Sin dependencias: se sirve antes de haber entrado.
// Si la app aún no tiene usuario, la misma pantalla sirve para crearlo (primer arranque): desde
// otro equipo pide además el código que la app escribe en su registro al arrancar.
const TEXTOS = {
  es: {
    inicia: 'Inicia sesión para entrar.',
    usuario: 'Usuario',
    clave: 'Contraseña',
    entrar: 'Entrar',
    fallo: 'No se pudo entrar.',
    primero: 'Primer arranque: crea el usuario y la contraseña (al menos 8 caracteres).',
    codigo: 'Código de primer arranque (está en el registro de la app)',
    crear: 'Crear usuario',
  },
  en: {
    inicia: 'Sign in to continue.',
    usuario: 'Username',
    clave: 'Password',
    entrar: 'Sign in',
    fallo: 'Could not sign in.',
    primero: 'First start: create the username and password (at least 8 characters).',
    codigo: 'First-start code (shown in the app log)',
    crear: 'Create user',
  },
};
const T = TEXTOS[navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'];
const $ = id => document.getElementById(id);
const CABECERAS = { 'Content-Type': 'application/json', 'X-Clipgeist': '1' };

let primerArranque = false;

function pintar(estado = {}) {
  primerArranque = Boolean(estado.primerArranque);
  $('texto').textContent = primerArranque ? T.primero : T.inicia;
  $('etq-usuario').textContent = T.usuario;
  $('etq-clave').textContent = T.clave;
  $('etq-codigo').textContent = T.codigo;
  $('entrar').textContent = primerArranque ? T.crear : T.entrar;
  $('clave').autocomplete = primerArranque ? 'new-password' : 'current-password';
  $('caja-codigo').hidden = !(primerArranque && estado.pideCodigo);
  // El lanzador de escritorio puede abrir esta pantalla con ?codigo=XXXX-XXXX
  const codigo = new URLSearchParams(location.search).get('codigo');
  if (codigo) $('codigo').value = codigo;
}

pintar();
fetch('/api/auth/estado', { headers: CABECERAS })
  .then(r => r.json())
  .then(pintar)
  .catch(() => {});
// Solo con ratón: en el móvil el foco saca el teclado y desplaza la página.
if (matchMedia('(pointer: fine)').matches) $('usuario').focus();

$('acceso').addEventListener('submit', async ev => {
  ev.preventDefault();
  $('error').textContent = '';
  $('entrar').disabled = true;
  try {
    const cuerpo = { usuario: $('usuario').value, contrasena: $('clave').value };
    if (primerArranque) cuerpo.codigo = $('codigo').value;
    const r = await fetch(primerArranque ? '/api/auth/primer-usuario' : '/api/auth/login', {
      method: 'POST',
      headers: CABECERAS,
      body: JSON.stringify(cuerpo),
    });
    if (r.ok) {
      location.replace('/');
      return;
    }
    $('error').textContent = (await r.json()).detail || T.fallo;
  } catch {
    $('error').textContent = T.fallo;
  }
  $('entrar').disabled = false;
});
