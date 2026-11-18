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
rm -f "$HOME/.local/share/applications/clipgeist-$APP.desktop" "$HOME/.local/share/icons/clipgeist-$APP.png"
# Con la suite de Clipgeist instalada (carpeta común «suite» al lado) el programa y los datos son
# también suyos: aquí solo se quita lo de la instalación suelta; nunca se toca la carpeta de la suite.
SUITE="$(dirname "$AQUI")/suite"
if [ -d "$SUITE/programa" ]; then
  echo "✓ Quitado el servicio propio de $APP. El programa y los datos siguen: los usa Clipgeist."
  echo "  Para quitar $APP, desinstala desde Clipgeist:  sh $SUITE/desinstalar.sh"
  exit 0
fi
rm -rf "$AQUI/programa"
if [ "${1:-}" = "--datos" ]; then rm -rf "$AQUI"; echo "✓ $APP desinstalada, datos incluidos."
else echo "✓ $APP desinstalada. Tus datos siguen en $AQUI (bórralos con --datos)."; fi
