#!/usr/bin/env sh
# Instala esta app de Clipgeist para tu usuario, sin Docker ni root:
#   programa en ~/.local/share/clipgeist/<app>/programa, servicio de systemd de usuario que arranca
#   solo, y un acceso en el menú de aplicaciones. Datos en ~/.local/share/clipgeist/<app>.
# Opciones:  --red   escuchar en toda la red local (0.0.0.0) y no solo en este equipo.
set -eu
AQUI=$(cd "$(dirname "$0")" && pwd)
APP=$(cat "$AQUI/APP")
PUERTO=$(cat "$AQUI/PUERTO")
HOST=127.0.0.1
[ "${1:-}" = "--red" ] && HOST=0.0.0.0
BASE="${XDG_DATA_HOME:-$HOME/.local/share}/clipgeist/$APP"
DEST="$BASE/programa"

if command -v systemctl >/dev/null 2>&1; then systemctl --user stop "$APP" 2>/dev/null || true; fi
mkdir -p "$BASE"
rm -rf "$DEST.nuevo"
cp -a "$AQUI/$APP" "$DEST.nuevo"
rm -rf "$DEST"
mv "$DEST.nuevo" "$DEST"
cp "$AQUI/desinstalar.sh" "$BASE/desinstalar.sh"

mkdir -p "$HOME/.local/share/applications" "$HOME/.local/share/icons"
cp "$AQUI/icono.png" "$HOME/.local/share/icons/clipgeist-$APP.png"
cat > "$HOME/.local/share/applications/clipgeist-$APP.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=$APP
Comment=Clipgeist
Exec=xdg-open http://127.0.0.1:$PUERTO/
Icon=$HOME/.local/share/icons/clipgeist-$APP.png
Categories=AudioVideo;
DESK

if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/$APP.service" <<UNIT
[Unit]
Description=$APP (Clipgeist)
After=network-online.target

[Service]
ExecStart=$DEST/$APP --sin-bandeja --host $HOST --puerto $PUERTO
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now "$APP"
  echo "✓ $APP instalada y en marcha: http://127.0.0.1:$PUERTO/"
  echo "  Para que arranque aunque no inicies sesión:  sudo loginctl enable-linger $USER"
else
  echo "✓ $APP instalada. Sin systemd de usuario: arráncala con"
  echo "    $DEST/$APP --sin-bandeja --host $HOST"
fi
echo "  Desinstalar:  sh $BASE/desinstalar.sh"
