#!/bin/bash
set -e

SERVER_URL="http://192.168.3.16:3000"

echo "=========================================================="
echo "🚀 Configurando Estación de Estudiante LabDesk"
echo "🌐 Conectando a Servidor: $SERVER_URL"
echo "=========================================================="

# 1. Instalar librerias necesarias para Electron, fuentes tipograficas, emojis y audio
echo "[1/4] Instalando dependencias del sistema, audio y fuentes de emojis..."
apt-get update -y
apt-get install -y curl wget git nodejs npm xdotool pamixer libasound2 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgtk-3-0 libxss1 libgbm1 libxshmfence1 fonts-noto-color-emoji fonts-dejavu-core fonts-liberation

# 2. Descargar código de student-desktop desde el servidor Windows 10
echo "[2/4] Descargando entorno de escritorio LabDesk..."
mkdir -p /opt/labdesk/student-desktop
curl -sSL "$SERVER_URL/student-desktop.tar.gz" | tar -xz -C /opt/labdesk/student-desktop

# 3. Instalar módulos de Node.js / Electron
echo "[3/4] Instalando paquetes de Node.js y Electron..."
cd /opt/labdesk/student-desktop
npm install

# 4. Configurar URL del servidor y auto-arranque en Openbox
echo "[4/4] Configurando autoarranque en Openbox..."
STUDENT_HOME="/home/estudiante"
mkdir -p "$STUDENT_HOME/.config/openbox"
mkdir -p "$STUDENT_HOME/.config/labdesk"

cat <<EOF > "$STUDENT_HOME/.config/labdesk/config.json"
{
  "serverUrl": "$SERVER_URL",
  "kiosk": true
}
EOF

cat <<EOF > "$STUDENT_HOME/.config/openbox/autostart"
#!/bin/bash
xset s off
xset -dpms
xset s noblank

# Iniciar audio
pipewire & wireplumber &

# Iniciar LabDesk en bucle (auto-reinicio si se cierra)
cd /opt/labdesk/student-desktop
while true; do
  npm start -- --no-sandbox
  sleep 2
done &
EOF
chmod +x "$STUDENT_HOME/.config/openbox/autostart"

# Permisos
chown -R estudiante:estudiante "$STUDENT_HOME"
chown -R estudiante:estudiante /opt/labdesk

echo "=========================================================="
echo "🎉 ¡Configuración completada con éxito!"
echo "➡️ Iniciando LabDesk en pantalla..."
echo "=========================================================="

# Lanzar en pantalla si hay sesión X activa
if [ -n "$DISPLAY" ]; then
    su - estudiante -c "DISPLAY=$DISPLAY nohup bash -c 'cd /opt/labdesk/student-desktop && npm start -- --no-sandbox' >/dev/null 2>&1 &"
else
    su - estudiante -c "DISPLAY=:0 nohup bash -c 'cd /opt/labdesk/student-desktop && npm start -- --no-sandbox' >/dev/null 2>&1 &"
fi

echo "✅ Listo. Si no aparece en 5 segundos, reinicia con: sudo reboot"
