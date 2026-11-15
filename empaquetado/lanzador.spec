# PyInstaller: un directorio con el ejecutable del lanzador y la app de Python dentro.
# Uso (desde empaquetado/):  pyinstaller --noconfirm lanzador.spec
import os
import sys

sys.path.insert(0, os.path.abspath(SPECPATH))  # noqa: F821 (lo define PyInstaller)

from PyInstaller.utils.hooks import collect_all

import ajustes_app as A

datas, binaries, hidden = [("icono.png", ".")], [], ["pystray", "PIL.Image"]
hidden += ["pystray._win32"] if sys.platform == "win32" else ["pystray._xorg", "pystray._appindicator", "pystray._gtk"]
for paquete in A.PAQUETES:  # la app y lo que se importa por nombre (uvicorn)
    d, b, h = collect_all(paquete)
    datas += d
    binaries += b
    hidden += h
datas += getattr(A, "DATOS_EXTRA", [])

a = Analysis(["lanzador.py"], pathex=["."], binaries=binaries, datas=datas, hiddenimports=hidden,
             excludes=["tkinter", "pytest"])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name=A.APP,
          console=sys.platform != "win32",  # en Windows sin ventana negra: se maneja desde la bandeja
          icon="icono.ico" if sys.platform == "win32" else None)
coll = COLLECT(exe, a.binaries, a.datas, name=A.APP)
