"""Lanzador de escritorio de Clipgeist (Windows y Linux, sin Docker).

Arranca el servidor de la app, abre el navegador y deja un icono en la bandeja con «Abrir»,
«Carpeta de datos» y «Salir». Con --sin-bandeja solo arranca el servidor (servicio de systemd en
Linux, o un servidor sin escritorio). Lo propio de cada app vive en ajustes_app.py; este fichero
es idéntico en los tres repos.
"""

from __future__ import annotations

import multiprocessing
import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

import ajustes_app as A

ES_WIN = sys.platform == "win32"
CONGELADO = getattr(sys, "frozen", False)
# Junto al ejecutable: ffmpeg (bin/), y en clipscout Node y la app. Dentro del paquete: el icono.
PROGRAMA = Path(sys.executable).parent if CONGELADO else Path(__file__).resolve().parent
RECURSOS = Path(getattr(sys, "_MEIPASS", PROGRAMA))


def carpeta_datos() -> Path:
    if os.environ.get("CLIPGEIST_DATOS"):
        return Path(os.environ["CLIPGEIST_DATOS"]).expanduser()
    if ES_WIN:
        return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "Clipgeist" / A.APP
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "clipgeist" / A.APP


def limites() -> list[Path]:
    """Hasta dónde puede llegar la app: en Windows todas las unidades; en Linux la carpeta
    personal y los puntos de montaje habituales de discos y NAS."""
    if os.environ.get("CLIPGEIST_LIMITES"):
        return [Path(x.strip()) for x in os.environ["CLIPGEIST_LIMITES"].split(",") if x.strip()]
    if ES_WIN:
        return [Path(f"{letra}:\\") for letra in "CDEFGHIJKLMNOPQRSTUVWXYZ" if os.path.exists(f"{letra}:\\")]
    return [Path.home()] + [Path(p) for p in ("/mnt", "/media", "/srv", "/data") if os.path.isdir(p)]


PUERTOS = {"clipscout": "3001", "clonbuster": "8095", "clipkeeper": "8096"}


def conectar_hermanas(datos: Path) -> list[str]:
    """Instalación conjunta: si las otras apps de Clipgeist están instaladas al lado, les da a las tres
    la misma clave (CLIPGEIST_CLAVE) y la dirección de cada una (CLIPGEIST_<APP>_URL), y ellas solas
    se conectan al arrancar. La clave se crea la primera vez en la carpeta de datos común."""
    exe = ".exe" if ES_WIN else ""
    hermanas = []
    for app in PUERTOS:
        if app == A.APP:
            continue
        # Windows: Clipgeist\<app>\<app>.exe · Linux: clipgeist/<app>/programa/<app>
        if (PROGRAMA.parent / app / (app + exe)).is_file() or (PROGRAMA.parent.parent / app / "programa" / app).is_file():
            hermanas.append(app)
    if not hermanas or os.environ.get("CLIPGEIST_CLAVE"):
        return hermanas
    archivo = datos.parent / "clave-clipgeist.txt"
    try:  # las tres arrancan a la vez tras instalar: solo una crea la clave
        with open(archivo, "x", encoding="utf-8") as f:
            import secrets

            f.write(secrets.token_hex(24))
    except FileExistsError:
        pass
    if not ES_WIN:  # solo el dueño: es la clave común del primer registro entre apps
        try:
            os.chmod(archivo, 0o600)
        except OSError:
            pass
    for _ in range(20):
        clave = archivo.read_text(encoding="utf-8").strip()
        if clave:
            break
        time.sleep(0.1)
    os.environ["CLIPGEIST_CLAVE"] = clave
    for app in [A.APP, *hermanas]:
        puerto = A.PUERTO if app == A.APP else PUERTOS[app]
        os.environ.setdefault(f"CLIPGEIST_{app.upper()}_URL", f"http://127.0.0.1:{puerto}")
    return hermanas


def escuchando(puerto: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", puerto)) == 0


def a_registro(datos: Path) -> None:
    """Sin consola (Windows) stdout es None y cualquier print rompería: todo va a un fichero."""
    if sys.stdout is not None and sys.stdout.isatty():
        return
    f = open(datos / "registro.log", "a", buffering=1, encoding="utf-8", errors="replace")  # noqa: SIM115
    f.write(f"\n--- {time.strftime('%Y-%m-%d %H:%M:%S')} {A.NOMBRE} ---\n")
    sys.stdout = sys.stderr = f


def bandeja(url: str, datos: Path) -> bool:
    """Icono en la bandeja. False si no hay escritorio o pystray no está: el servidor sigue."""
    try:
        import pystray
        from PIL import Image
    except Exception as e:  # noqa: BLE001
        print("sin bandeja:", e)
        return False

    def abrir_datos() -> None:
        if ES_WIN:
            os.startfile(datos)  # noqa: S606
        else:
            import subprocess

            subprocess.Popen(["xdg-open", str(datos)])

    def salir(icono) -> None:
        icono.stop()

    menu = pystray.Menu(
        pystray.MenuItem(f"Abrir {A.NOMBRE}", lambda: webbrowser.open(url), default=True),
        pystray.MenuItem("Carpeta de datos", abrir_datos),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Salir", salir),
    )
    try:
        icono = pystray.Icon(A.APP, Image.open(RECURSOS / "icono.png"), A.NOMBRE, menu)
        icono.run()  # bloquea hasta «Salir»
    except Exception as e:  # noqa: BLE001
        print("sin bandeja:", e)
        return False
    return True


def main() -> None:
    import argparse

    p = argparse.ArgumentParser(prog=A.APP, description=f"{A.NOMBRE} (Clipgeist)")
    p.add_argument("--sin-bandeja", action="store_true", help="solo el servidor, sin icono ni navegador")
    # Por defecto solo este equipo; CLIPGEIST_ESCUCHAR=red (o --host 0.0.0.0) abre a la red local.
    red = os.environ.get("CLIPGEIST_ESCUCHAR", "").strip().lower() == "red"
    p.add_argument("--host", default=os.environ.get("CLIPGEIST_HOST") or ("0.0.0.0" if red else "127.0.0.1"),
                   help="0.0.0.0 para usarla desde otros equipos de la red")
    p.add_argument("--puerto", type=int, default=int(os.environ.get("CLIPGEIST_PUERTO", A.PUERTO)))
    p.add_argument("--no-abrir", action="store_true", help="no abrir el navegador al arrancar")
    args = p.parse_args()

    datos = carpeta_datos()
    datos.mkdir(parents=True, exist_ok=True)
    a_registro(datos)
    os.chdir(datos)
    # ffmpeg/ffprobe incluidos: junto al programa (instalador de una app) o en «comun», compartido
    # por las apps del instalador de Clipgeist (Windows: Clipgeist\comun; Linux: clipgeist/comun).
    for bin_ in (PROGRAMA / "bin", PROGRAMA.parent / "comun" / "bin", PROGRAMA.parent.parent / "comun" / "bin"):
        if bin_.is_dir():
            os.environ["PATH"] = str(bin_) + os.pathsep + os.environ.get("PATH", "")
            break
    url = f"http://127.0.0.1:{args.puerto}/"
    hermanas = conectar_hermanas(datos)
    if hermanas:
        print("Clipgeist: conectando con", ", ".join(hermanas))

    if escuchando(args.puerto):  # ya está abierta (o el puerto lo usa otra cosa): solo mostrarla
        if not args.sin_bandeja:
            webbrowser.open(url)
        return

    contexto = {"datos": datos, "host": args.host, "puerto": args.puerto, "limites": limites(),
                "programa": PROGRAMA, "recursos": RECURSOS}
    if args.sin_bandeja:
        A.arrancar(**contexto)
        return

    hilo = threading.Thread(target=A.arrancar, kwargs=contexto, daemon=True)
    hilo.start()
    for _ in range(120):
        if escuchando(args.puerto) or not hilo.is_alive():
            break
        time.sleep(0.25)
    if not args.no_abrir and hilo.is_alive():
        webbrowser.open(url)
    if not bandeja(url, datos):
        hilo.join()
    parar = getattr(A, "parar", None)
    if parar:
        parar()
    os._exit(0)  # los hilos del servidor no se paran solos


if __name__ == "__main__":
    multiprocessing.freeze_support()  # procesos «spawn» dentro del .exe (clonbuster)
    main()
