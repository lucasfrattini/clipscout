#!/usr/bin/env sh
# Quita el programa, el servicio y el acceso del menú. Los datos se quedan salvo con --datos.
set -eu
AQUI=$(cd "$(dirname "$0")" && pwd)
APP=$(basename "$AQUI")
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now "$APP" 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/$APP.service"
  systemctl --user daemon-reload 2>/dev/null || true
fi
rm -rf "$AQUI/programa"
rm -f "$HOME/.local/share/applications/clipgeist-$APP.desktop" "$HOME/.local/share/icons/clipgeist-$APP.png"
if [ "${1:-}" = "--datos" ]; then rm -rf "$AQUI"; echo "✓ $APP desinstalada, datos incluidos."
else echo "✓ $APP desinstalada. Tus datos siguen en $AQUI (bórralos con --datos)."; fi
