// Pantalla de acceso (ADMIN_PASSWORD). Sin dependencias: se sirve antes de haber entrado.
const TEXTOS = {
  es: ['Inicia sesión para entrar.', 'Usuario', 'Contraseña', 'Entrar', 'No se pudo entrar.'],
  en: ['Sign in to continue.', 'Username', 'Password', 'Sign in', 'Could not sign in.'],
};
const [inicia, usuario, clave, entrar, fallo] =
  TEXTOS[navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'];
const $ = id => document.getElementById(id);

$('texto').textContent = inicia;
$('etq-usuario').textContent = usuario;
$('etq-clave').textContent = clave;
$('entrar').textContent = entrar;
// Solo con ratón: en el móvil el foco saca el teclado y desplaza la página.
if (matchMedia('(pointer: fine)').matches) $('usuario').focus();

$('acceso').addEventListener('submit', async ev => {
  ev.preventDefault();
  $('error').textContent = '';
  $('entrar').disabled = true;
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: $('usuario').value, contrasena: $('clave').value }),
    });
    if (r.ok) {
      location.replace('/');
      return;
    }
    $('error').textContent = (await r.json()).detail || fallo;
  } catch {
    $('error').textContent = fallo;
  }
  $('entrar').disabled = false;
});
