#!/bin/bash
set -e

SERVER_URL="http://192.168.3.16:3000"

echo "=========================================================="
echo "🚀 Configurando Estación de Estudiante LabDesk"
echo "🌐 Conectando a Servidor: $SERVER_URL"
echo "=========================================================="

# 1. Instalar librerias necesarias para Electron, fuentes tipograficas, emojis y audio
echo "[1/4] Instalando dependencias del sistema, navegador estándar, audio y fuentes..."
apt-get update -y
apt-get install -y curl wget git nodejs npm xdotool wmctrl pamixer pulseaudio-utils alsa-utils libasound2 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgtk-3-0 libxss1 libgbm1 libxshmfence1 fonts-noto-color-emoji fonts-dejavu-core fonts-liberation
apt-get install -y chromium || apt-get install -y chromium-browser || apt-get install -y firefox-esr || apt-get install -y firefox || true
fc-cache -f 2>/dev/null || true

# 2. Descargar código de student-desktop desde el servidor Windows 10
echo "[2/4] Descargando entorno de escritorio LabDesk..."
mkdir -p /opt/labdesk/student-desktop
curl -sSL "$SERVER_URL/student-desktop.tar.gz" | tar -xz -C /opt/labdesk/student-desktop

# 3. Instalar módulos de Node.js / Electron
echo "[3/4] Instalando paquetes de Node.js y Electron..."
cd /opt/labdesk/student-desktop
npm install

# 4. Configurar URL del servidor, regla WirePlumber de audio USB y auto-arranque en Openbox
echo "[4/4] Configurando audio permanente y autoarranque en Openbox..."
STUDENT_HOME="/home/estudiante"
mkdir -p "$STUDENT_HOME/.config/openbox"
mkdir -p "$STUDENT_HOME/.config/labdesk"
mkdir -p "$STUDENT_HOME/.config/wireplumber/main.lua.d"
mkdir -p /etc/wireplumber/main.lua.d

# Regla WirePlumber de máxima prioridad para USB (2000)
cat << 'EOF' > /etc/wireplumber/main.lua.d/99-usb-priority.lua
table.insert(alsa_monitor.rules, {
  matches = {
    { { "node.name", "matches", "alsa_output.usb*" } },
    { { "node.name", "matches", "alsa_input.usb*" } },
    { { "device.bus", "equals", "usb" } },
  },
  apply_properties = {
    ["priority.driver"] = 2000,
    ["priority.session"] = 2000,
  },
})
EOF
cp /etc/wireplumber/main.lua.d/99-usb-priority.lua "$STUDENT_HOME/.config/wireplumber/main.lua.d/"

# Configurar Openbox con margen inferior de 48px y regla para popups de Chromium
cat <<EOF > "$STUDENT_HOME/.config/openbox/rc.xml"
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <focus>
    <focusNew>yes</focusNew>
    <followMouse>no</followMouse>
    <focusLast>yes</focusLast>
    <underMouse>no</underMouse>
  </focus>
  <margins>
    <top>0</top>
    <bottom>48</bottom>
    <left>0</left>
    <right>0</right>
  </margins>
  <applications>
    <application class="*Chromium*" type="dialog">
      <focus>yes</focus>
    </application>
    <application class="*Google-chrome*" type="dialog">
      <focus>yes</focus>
    </application>
  </applications>
</openbox_config>
EOF

# Políticas de Chromium para forzar Modo Invitado (Guest Mode), habilitar cookies de 3ros y popups
mkdir -p /etc/chromium/policies/managed /etc/opt/chrome/policies/managed 2>/dev/null || true
cat <<EOF > /etc/chromium/policies/managed/labdesk.json
{
  "BrowserGuestModeEnabled": true,
  "BrowserGuestModeEnforced": true,
  "BrowserSignin": 0,
  "PasswordManagerEnabled": false,
  "BlockThirdPartyCookies": false,
  "DefaultCookiesSetting": 1,
  "DefaultPopupsSetting": 1,
  "ThirdPartyCookieDeprecation": 0,
  "CookiesAllowedForUrls": [
    "https://accounts.google.com",
    "https://[*.]google.com",
    "https://[*.]googleusercontent.com",
    "https://[*.]gstatic.com"
  ]
}
EOF
cp -f /etc/chromium/policies/managed/labdesk.json /etc/opt/chrome/policies/managed/labdesk.json 2>/dev/null || true

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

# Evitar archivos conflictivos de ALSA
rm -f "\$HOME/.asoundrc" 2>/dev/null || true

# Iniciar LabDesk Estudiante en bucle
cd /opt/labdesk/student-desktop
while true; do
  npm start -- --no-sandbox
  sleep 2
done &
EOF
chmod +x "$STUDENT_HOME/.config/openbox/autostart"

# Guardar calibración ALSA
amixer -c 1 sset Speaker 75% unmute 2>/dev/null || true
amixer -c 1 sset Mic 80% unmute 2>/dev/null || true
amixer -q sset Master 75% unmute 2>/dev/null || true
amixer -q sset Headphone 75% unmute 2>/dev/null || true
alsactl store 2>/dev/null || true
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
