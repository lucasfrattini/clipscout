#!/usr/bin/env bash
# Compila los instaladores en este equipo, sin gastar minutos de GitHub Actions:
#   Linux   → contenedor Debian 12 (glibc 2.36: el binario sirve en casi cualquier distro actual)
#   Windows → Wine dentro de Docker (imagen tobix/pywine) con PyInstaller e Inno Setup
# Resultado en salida/: <app>-windows.exe, <app>-linux-x64.tar.gz y sus .sha256.
# Uso:  bash empaquetado/compilar.sh [linux|windows|todo]
set -euo pipefail
RAIZ=$(cd "$(dirname "$0")/.." && pwd)
cd "$RAIZ"
QUE=${1:-todo}
APP=$(cd empaquetado && python3 -c "import ajustes_app as A; print(A.APP)")
VERSION=$(cd empaquetado && python3 -c "import ajustes_app as A; print(A.version())")
CACHE=${CLIPGEIST_CACHE:-$HOME/.cache/clipgeist-empaquetado}
mkdir -p "$CACHE" salida
case $APP in
  # numpy ≥ 2.2 llama a crealf(), que Wine aún no tiene: para Windows se fija la 2.1.
  clonbuster) PIP='.[web]' PIN_WIN='numpy==2.1.3' ;;
  clipkeeper) PIP='./backend' ;;
  *) PIP='' ;;
esac
PIN_WIN=${PIN_WIN:-}
echo "▶ $APP $VERSION ($QUE)"

bajar() { [ -s "$CACHE/$2" ] || curl -fL --retry 3 -o "$CACHE/$2" "$1"; }
# Componentes fijados (SU-09): URL y sha256 en empaquetado/componentes.txt. Se baja a la caché con
# el nombre del fichero de la URL y se comprueba la huella SIEMPRE (también lo que ya estaba en
# caché); si no coincide, se borra y se aborta.
componente() {  # $1 = nombre, $2 = plataforma → imprime la ruta del fichero verificado
  local linea url sha fichero
  linea=$(awk -v n="$1" -v p="$2" '$1==n && $2==p {print $3, $4}' empaquetado/componentes.txt)
  [ -n "$linea" ] || { echo "✗ $1 $2 no está en empaquetado/componentes.txt" >&2; exit 1; }
  read -r url sha <<<"$linea"
  fichero="$1-$2-$(basename "$url")"
  bajar "$url" "$fichero" >&2
  if ! echo "$sha  $CACHE/$fichero" | sha256sum -c --status; then
    echo "✗ sha256 de $fichero no coincide con componentes.txt: se borra y se aborta" >&2
    rm -f "$CACHE/$fichero"
    exit 1
  fi
  echo "$CACHE/$fichero"
}
FF=https://github.com/BtbN/FFmpeg-Builds/releases/download/latest

preparar() {
  if [ "$APP" = clipkeeper ]; then (cd frontend && npm ci --no-audit --no-fund --silent && npm run build --silent); fi
  if [ "$APP" = clipscout ]; then  # node_modules es JS puro: el mismo vale para Linux y Windows
    rm -rf "$CACHE/app-$APP" && mkdir -p "$CACHE/app-$APP"
    cp -r server.js package.json package-lock.json src public "$CACHE/app-$APP/"
    (cd "$CACHE/app-$APP" && PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev --no-audit --no-fund --silent)
    # Licencias de terceros (lo instalado + Node y el navegador): Ajustes → Acerca de lo sirve.
    node empaquetado/terceros.js "$CACHE/app-$APP" "$CACHE/app-$APP/TERCEROS.txt"
    rm "$CACHE/app-$APP/package-lock.json"
  fi
}

extras() {  # $1 = carpeta del programa, $2 = linux|windows
  local d=$1 so=$2
  if [ "$APP" = clipscout ]; then
    mkdir -p "$d/node" && cp -r "$CACHE/app-$APP" "$d/app"
    local zip_node zip_nav
    if [ "$so" = windows ]; then
      zip_node=$(componente node windows)
      unzip -o -q -j "$zip_node" "$(basename "$zip_node" .zip | sed 's/^node-windows-//')/node.exe" -d "$d/node"
      zip_nav=$(componente chrome-headless-shell windows)
    else
      zip_node=$(componente node linux)
      tar -xJf "$zip_node" -C "$d/node" --strip-components=2 "$(basename "$zip_node" .tar.xz | sed 's/^node-linux-//')/bin/node"
      zip_nav=$(componente chrome-headless-shell linux)
    fi
    # Navegador interno fijado (la versión que espera Puppeteer): navegador/ junto al programa.
    # ajustes_app.py lo prefiere al del sistema.
    rm -rf "$d/navegador" && mkdir -p "$d/navegador"
    unzip -o -q "$zip_nav" -d "$d/navegador.tmp" && mv "$d/navegador.tmp"/*/* "$d/navegador/" && rm -rf "$d/navegador.tmp"
  else
    mkdir -p "$d/bin"
    if [ "$so" = windows ]; then
      # Versión «shared»: ffmpeg y ffprobe comparten las DLL (≈ 1/3 del tamaño de la estática).
      bajar "$FF/ffmpeg-master-latest-win64-gpl-shared.zip" ffmpeg-win-shared.zip
      unzip -o -q -j "$CACHE/ffmpeg-win-shared.zip" '*/bin/ffmpeg.exe' '*/bin/ffprobe.exe' '*/bin/*.dll' -d "$d/bin"
    else
      # «shared» también: los binarios buscan sus .so en ../lib (RPATH $ORIGIN/../lib).
      bajar "$FF/ffmpeg-master-latest-linux64-gpl-shared.tar.xz" ffmpeg-linux-shared.tar.xz
      mkdir -p "$d/lib"
      tar -xJf "$CACHE/ffmpeg-linux-shared.tar.xz" -C "$d/bin" --strip-components=2 --wildcards '*/bin/ffmpeg' '*/bin/ffprobe'
      tar -xJf "$CACHE/ffmpeg-linux-shared.tar.xz" -C "$d/lib" --strip-components=2 --wildcards '*/lib/*.so*'
    fi
  fi
}

linux() {
  # Imagen propia mínima: Python 3.12 en Debian 12 + binutils (PyInstaller necesita objdump).
  docker image inspect clipgeist-empaquetado-linux >/dev/null 2>&1 || printf '%s\n' \
    'FROM python:3.12-slim-bookworm' \
    'RUN apt-get update && apt-get install -y --no-install-recommends binutils && rm -rf /var/lib/apt/lists/*' \
    | docker build -q -t clipgeist-empaquetado-linux -
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$RAIZ":/src -v "$CACHE":/cache -w /src \
    clipgeist-empaquetado-linux bash -euc "
      python -m venv /tmp/v
      /tmp/v/bin/pip install -q --cache-dir /cache/pip-linux $PIP pyinstaller pystray Pillow
      cd empaquetado && /tmp/v/bin/pyinstaller --noconfirm --log-level WARN \
        --distpath dist-linux --workpath build/linux lanzador.spec"
  extras "empaquetado/dist-linux/$APP" linux
  (cd empaquetado && DIST=dist-linux python3 humo.py)
  DIST=dist-linux bash empaquetado/linux-tar.sh
  (cd salida && sha256sum "$APP-linux-x64.tar.gz" > "$APP-linux.sha256")
}

windows() {
  local inno
  inno=$(componente innosetup windows)
  inno=$(basename "$inno")
  # Python 3.12, la misma que en Linux.
  docker run --rm -v "$RAIZ":/src -v "$CACHE":/cache -w /src tobix/pywine:3.12 bash -euc "
      # Se instala desde una copia: pip deja build/ y .egg-info de root en el árbol de trabajo.
      cp -r /src /tmp/w && (cd /tmp/w && wine python -m pip install -q --cache-dir 'Z:\\cache\\pip-win' $PIP $PIN_WIN pyinstaller pystray Pillow 2>&1 | grep -v fixme || true)
      cd empaquetado && wine pyinstaller --noconfirm --log-level WARN \
        --distpath dist-win --workpath build/win lanzador.spec 2>&1 | { grep -v 'fixme\|upx' || true; }
      test -f dist-win/$APP/$APP.exe
      chown -R $(id -u):$(id -g) /src/empaquetado /cache"
  extras "empaquetado/dist-win/$APP" windows
  docker run --rm -v "$RAIZ":/src -v "$CACHE":/cache -w /src tobix/pywine:3.12 bash -euc "
      # El instalador de Inno Setup necesita una pantalla aunque sea silencioso: Xvfb.
      xvfb-run -a wine /cache/$inno /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /CURRENTUSER >/dev/null 2>&1
      ISCC=\$(find \"\$WINEPREFIX/drive_c\" -iname ISCC.exe | head -1)
      wine \"\$ISCC\" /Q /DApp=$APP /DNombre=$APP /DVersion=$VERSION /DDist=dist-win 'empaquetado\\instalador.iss' 2>&1 | { grep -v fixme || true; }
      test -f salida/$APP-windows.exe
      chown -R $(id -u):$(id -g) /src/salida /src/empaquetado"
  (cd salida && sha256sum "$APP-windows.exe" > "$APP-windows.sha256")
}

preparar
case $QUE in
  linux) linux ;;
  windows) windows ;;
  *) linux; windows ;;
esac
rm -rf empaquetado/build backend/build
ls -la salida
