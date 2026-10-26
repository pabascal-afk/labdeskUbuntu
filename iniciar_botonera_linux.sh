#!/bin/bash
# ========================================================
# LabDesk - Lanzador de la Botonera del Profesor en Linux
# ========================================================
SERVER_URL=${1:-"http://localhost:3000/botonera"}

echo "========================================================"
echo "  LabDesk - Botonera de Control de Sala para Profesores"
echo "========================================================"
echo "Abriendo consola en: $SERVER_URL"

if command -v chromium &>/dev/null; then
    chromium --app="$SERVER_URL" &
elif command -v google-chrome &>/dev/null; then
    google-chrome --app="$SERVER_URL" &
elif command -v xdg-open &>/dev/null; then
    xdg-open "$SERVER_URL" &
else
    echo "No se encontró navegador compatible. Abre manualmente: $SERVER_URL"
fi
