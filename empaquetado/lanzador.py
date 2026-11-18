"""Lanzador de escritorio de Clipgeist (Windows y Linux, sin Docker).

Arranca el servidor de la app, abre el navegador y deja un icono en la bandeja con «Abrir»,
«Carpeta de datos» y «Salir». Con --sin-bandeja solo arranca el servidor (servicio de systemd en
Linux, o un servidor sin escritorio). Lo propio de cada app vive en ajustes_app.py; este fichero
es idéntico en los tres repos.

«Salir» es ordenado (CB-13): pregunta a la app si hay algo en marcha (GET /api/estado-trabajos) y,
si lo hay, pide confirmación; luego le pide que se apague (POST /api/apagar: termina el fichero en
curso y cancela el resto) y espera hasta 75 s a que el servidor se cierre. Solo entonces fuerza la
salida. Si la app se apaga por su cuenta (el instalador también llama a /api/apagar), el icono se
quita solo.
"""

from __future__ import annotations

import json
import multiprocessing
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
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


ESPERA_APAGADO = 75.0  # s que se espera a que el servidor se cierre solo antes de forzar
TAMANO_REGISTRO = 5 * 1024 * 1024  # al pasar de 5 MB, registro.log pasa a registro.1.log
# Lo que la app dice que tiene en marcha (GET /api/estado-trabajos → «que»), por si no manda «texto».
EN_MARCHA = {
    "analisis": "Hay un análisis en marcha", "moviendo": "Se están moviendo ficheros",
    "escaneo": "Hay un escaneo en marcha", "busqueda": "Hay una búsqueda en marcha",
    "conversion": "Hay una conversión en marcha", "descarga": "Hay una descarga en marcha",
    "cola": "Hay trabajos en cola",
}


def escucha_en_red(datos: Path) -> bool:
    """CLIPGEIST_ESCUCHAR=red, o «red» en escuchar.txt de la carpeta de datos (lo escribe el
    interruptor «Permitir acceso desde otros dispositivos» de la app; vale al siguiente arranque)."""
    entorno = os.environ.get("CLIPGEIST_ESCUCHAR", "").strip().lower()
    if entorno:
        return entorno == "red"
    try:
        return (datos / "escuchar.txt").read_text(encoding="utf-8").strip().lower() == "red"
    except OSError:
        return False


def llamar(puerto: int, metodo: str, ruta: str, tiempo: float = 5.0) -> dict | None:
    """Pide algo a la propia app desde este equipo (con la cabecera de Clipgeist). None si no
    responde o no entiende la ruta (una versión antigua)."""
    peticion = urllib.request.Request(f"http://127.0.0.1:{puerto}{ruta}", method=metodo,
                                      data=b"" if metodo == "POST" else None, headers={"X-Clipgeist": "1"})
    try:
        with urllib.request.urlopen(peticion, timeout=tiempo) as r:  # noqa: S310 (siempre 127.0.0.1)
            return json.loads(r.read() or b"{}")
    except (OSError, ValueError):
        return None


def en_marcha(puerto: int) -> str | None:
    """Texto de lo que hay en marcha, o None si nada (o si la app no lo sabe decir)."""
    e = llamar(puerto, "GET", "/api/estado-trabajos", 3.0)
    if not e or not e.get("ocupado"):
        return None
    return e.get("texto") or EN_MARCHA.get(e.get("que") or "", "Hay un trabajo en marcha")


def preguntar(titulo: str, texto: str) -> bool | None:
    """Diálogo nativo Sí/No. None si no hay ninguno disponible."""
    if ES_WIN:
        try:
            import ctypes

            # MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2 | MB_SETFOREGROUND | MB_TOPMOST → IDYES = 6
            return ctypes.windll.user32.MessageBoxW(None, texto, titulo, 0x4 | 0x20 | 0x100 | 0x10000 | 0x40000) == 6
        except Exception:  # noqa: BLE001
            return None
    for orden in (["zenity", "--question", "--title", titulo, "--text", texto],
                  ["kdialog", "--title", titulo, "--yesno", texto]):
        if shutil.which(orden[0]):
            try:
                return subprocess.run(orden, timeout=300, check=False).returncode == 0
            except (OSError, subprocess.SubprocessError):
                return None
    return None


def apagar_servidor(puerto: int, hilo: threading.Thread | None, espera: float = ESPERA_APAGADO) -> bool:
    """POST /api/apagar y espera a que el servidor termine. False si no lo pidió o no le dio tiempo."""
    if llamar(puerto, "POST", "/api/apagar") is None:
        return False
    limite = time.monotonic() + espera
    while time.monotonic() < limite:
        if (hilo is not None and not hilo.is_alive()) or (hilo is None and not escuchando(puerto)):
            return True
        time.sleep(0.25)
    return False


def escuchando(puerto: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", puerto)) == 0


def a_registro(datos: Path) -> None:
    """Sin consola (Windows) stdout es None y cualquier print rompería: todo va a un fichero."""
    if sys.stdout is not None and sys.stdout.isatty():
        return
    registro = datos / "registro.log"
    try:  # rotación sencilla: una copia anterior y la actual
        if registro.stat().st_size > TAMANO_REGISTRO:
            os.replace(registro, datos / "registro.1.log")
    except OSError:
        pass
    f = open(registro, "a", buffering=1, encoding="utf-8", errors="replace")  # noqa: SIM115
    f.write(f"\n--- {time.strftime('%Y-%m-%d %H:%M:%S')} {A.NOMBRE} ---\n")
    sys.stdout = sys.stderr = f


def bandeja(url: str, datos: Path, puerto: int, hilo: threading.Thread) -> bool:
    """Icono en la bandeja. False si no hay escritorio o pystray no está: el servidor sigue.
    Vuelve al pulsar «Salir» (ya confirmado) o cuando el servidor se cierra por su cuenta."""
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

    confirmar_hasta = [0.0]  # sin diálogo nativo: un segundo «Salir» antes de 15 s confirma

    def salir(icono) -> None:
        que = en_marcha(puerto)
        if que and time.monotonic() > confirmar_hasta[0]:
            texto = (f"{que}. ¿Salir de {A.NOMBRE}? Se termina lo que esté a medias con el fichero en curso "
                     "y lo demás sigue la próxima vez.")
            respuesta = preguntar(A.NOMBRE, texto)
            if respuesta is False:
                return
            if respuesta is None:
                confirmar_hasta[0] = time.monotonic() + 15
                try:
                    icono.notify(f"{que}. Pulsa «Salir» otra vez para cerrar.", A.NOMBRE)
                except Exception:  # noqa: BLE001
                    pass
                return
        icono.stop()

    menu = pystray.Menu(
        pystray.MenuItem(f"Abrir {A.NOMBRE}", lambda: webbrowser.open(url), default=True),
        pystray.MenuItem("Carpeta de datos", abrir_datos),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Salir", salir),
    )
    try:
        icono = pystray.Icon(A.APP, Image.open(RECURSOS / "icono.png"), A.NOMBRE, menu)

        def vigilar() -> None:  # el servidor se cerró solo (instalador, error): fuera el icono
            hilo.join()
            icono.stop()

        threading.Thread(target=vigilar, daemon=True).start()
        icono.run()  # bloquea hasta «Salir» o hasta que el servidor se cierra
    except Exception as e:  # noqa: BLE001
        print("sin bandeja:", e)
        return False
    return True


def main() -> None:
    import argparse

    datos = carpeta_datos()
    p = argparse.ArgumentParser(prog=A.APP, description=f"{A.NOMBRE} (Clipgeist)")
    p.add_argument("--sin-bandeja", action="store_true", help="solo el servidor, sin icono ni navegador")
    # Por defecto solo este equipo; CLIPGEIST_ESCUCHAR=red, escuchar.txt con «red» (o --host 0.0.0.0)
    # abre a la red local.
    red = escucha_en_red(datos)
    p.add_argument("--host", default=os.environ.get("CLIPGEIST_HOST") or ("0.0.0.0" if red else "127.0.0.1"),
                   help="0.0.0.0 para usarla desde otros equipos de la red")
    p.add_argument("--puerto", type=int, default=int(os.environ.get("CLIPGEIST_PUERTO", A.PUERTO)))
    p.add_argument("--no-abrir", action="store_true", help="no abrir el navegador al arrancar")
    args = p.parse_args()

    datos.mkdir(parents=True, exist_ok=True)
    a_registro(datos)
    os.chdir(datos)
    os.environ["CLIPGEIST_LANZADOR"] = "1"  # la app sabe que es la de escritorio (asistente: acceso desde la red)
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
    if not bandeja(url, datos, args.puerto, hilo):
        try:
            hilo.join()
        except KeyboardInterrupt:  # Ctrl+C en la consola: también ordenado
            pass
    cerrar(args.puerto, hilo)


def cerrar(puerto: int, hilo: threading.Thread) -> None:
    """Apagado ordenado; solo si no llega a tiempo (o la app no lo sabe hacer) se fuerza."""
    if hilo.is_alive() and not apagar_servidor(puerto, hilo):
        print(f"{A.NOMBRE}: el servidor no se cerró solo; se fuerza la salida.", flush=True)
    parar = getattr(A, "parar", None)
    if parar:
        parar()
    os._exit(0)  # los hilos que queden (y el icono) no se paran solos


if __name__ == "__main__":
    multiprocessing.freeze_support()  # procesos «spawn» dentro del .exe (clonbuster)
    main()
