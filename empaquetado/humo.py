"""Prueba de humo del paquete: arranca el ejecutable ya construido, espera a que responda por HTTP
y lo para. Uso (desde empaquetado/):  python humo.py"""
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

import ajustes_app as A

exe = Path(os.environ.get("DIST", "dist")) / A.APP / (A.APP + (".exe" if sys.platform == "win32" else ""))
datos = Path(tempfile.mkdtemp())
puerto = "18" + A.PUERTO[-3:]
p = subprocess.Popen([str(exe), "--sin-bandeja", "--puerto", puerto],
                     env={**os.environ, "CLIPGEIST_DATOS": str(datos)},
                     # Grupo propio: al acabar se para TAMBIÉN el servidor hijo (node, uvicorn); matar
                     # solo el lanzador lo dejaba huérfano con el puerto ocupado y la siguiente
                     # prueba fallaba.
                     **({} if sys.platform == "win32" else {"start_new_session": True}))
ok = False
ultimo = None
try:
    for _ in range(90):
        time.sleep(1)
        if p.poll() is not None:
            break
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{puerto}{A.SALUD}", timeout=3)
            ok = True
        except urllib.error.HTTPError as e:
            if e.code >= 500:  # arrancando: /api/salud dice 503 hasta que puede trabajar
                ultimo = e.code
                continue
            ok = True
        except OSError:
            continue
        break
finally:
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(p.pid)], capture_output=True)
    else:
        import signal
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
log = datos / "registro.log"
if log.exists():
    print(log.read_text(errors="replace")[-4000:])
print("prueba de humo:", "OK" if ok else f"FALLA (última respuesta: {ultimo})")
sys.exit(0 if ok else 1)
