"""Lo propio de clipscout para el lanzador de escritorio (lanzador.py es común a las tres apps).

clipscout es Node: el paquete lleva node(.exe) en node/ y la app en app/, junto al lanzador, que la
arranca como proceso hijo. Para leer páginas con JavaScript usa el navegador fijado que va en el
paquete (navegador/, la versión que espera Puppeteer, con su sha256 en componentes.txt); si no está,
el Chrome, Edge o Chromium del equipo; y si no hay ninguno, funciona sin navegador (solo HTML)."""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

APP = NOMBRE = "clipscout"
PUERTO = "3001"
SALUD = "/api/salud"  # la honesta (503 si no puede trabajar), como en las otras dos
PAQUETES: list[str] = []
_proceso = None


def version() -> str:
    return json.loads((Path(__file__).parent.parent / "package.json").read_text())["version"]


def navegador(programa: Path | None = None) -> str | None:
    if os.environ.get("PUPPETEER_EXECUTABLE_PATH"):
        return os.environ["PUPPETEER_EXECUTABLE_PATH"]
    if programa is not None:
        propio = programa / "navegador" / ("chrome-headless-shell" + (".exe" if sys.platform == "win32" else ""))
        if propio.is_file():
            return str(propio)
    if sys.platform == "win32":
        bases = [os.environ.get(v) for v in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA")]
        for base in filter(None, bases):
            for rel in (r"Google\Chrome\Application\chrome.exe", r"Microsoft\Edge\Application\msedge.exe",
                        r"Chromium\Application\chrome.exe"):
                if (Path(base) / rel).is_file():
                    return str(Path(base) / rel)
        return None
    for nombre in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"):
        if shutil.which(nombre):
            return shutil.which(nombre)
    return None


def arrancar(datos, host, puerto, programa, **_):
    global _proceso
    node = programa / "node" / ("node.exe" if sys.platform == "win32" else "node")
    env = {**os.environ, "NODE_ENV": "production", "PORT": str(puerto), "HOST": host,
           "CREW_PATH": str(datos / "crew.json"), "PROFILES_PATH": str(datos / "profiles.json"),
           "DATA_DIR": str(datos),
           "BROWSER_USER_DATA_DIR": str(datos / "navegador"), "PUPPETEER_SKIP_DOWNLOAD": "true"}
    nav = navegador(programa)
    if nav:
        env["PUPPETEER_EXECUTABLE_PATH"] = nav
    else:
        env["BROWSER_ENABLED"] = "false"
    salida = None if (sys.stdout is None or sys.stdout.isatty()) else sys.stdout
    _proceso = subprocess.Popen([str(node), "server.js"], cwd=programa / "app", env=env,
                                stdout=salida, stderr=salida,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    _proceso.wait()


def parar():
    """Último recurso: el lanzador ya ha pedido POST /api/apagar y esperado (apagado ordenado)."""
    if _proceso and _proceso.poll() is None:
        _proceso.terminate()
