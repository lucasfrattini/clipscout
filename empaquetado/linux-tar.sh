#!/usr/bin/env bash
# Empaqueta para Linux: <app>-linux-x64.tar.gz con el programa y los scripts de instalación.
set -euo pipefail
cd "$(dirname "$0")"
app=$(python -c "import ajustes_app as A; print(A.APP)")
puerto=$(python -c "import ajustes_app as A; print(A.PUERTO)")
dir=$(mktemp -d)/$app
mkdir -p "$dir" ../salida
cp -a "dist/$app" "$dir/$app"
cp linux/instalar.sh linux/desinstalar.sh icono.png "$dir/"
echo "$app" > "$dir/APP"
echo "$puerto" > "$dir/PUERTO"
cat > "$dir/LEEME.txt" <<TXT
$app (Clipgeist) para Linux x64, sin Docker.

Instalar:     sh instalar.sh          (solo este equipo)
              sh instalar.sh --red    (también desde otros equipos de tu red)
Abrir:        http://127.0.0.1:$puerto/
Desinstalar:  sh ~/.local/share/clipgeist/$app/desinstalar.sh

Más información: https://clipgeist.com/
TXT
tar -C "$(dirname "$dir")" -czf "../salida/$app-linux-x64.tar.gz" "$app"
ls -la ../salida
