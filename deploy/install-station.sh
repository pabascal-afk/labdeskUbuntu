#!/bin/bash
# ==============================================================================
# LabDesk - Instalador Automatizado de Estación de Estudiante (Debian / Ubuntu)
# ==============================================================================
# Este script convierte cualquier PC con Debian 12 o Ubuntu en una estación
# educativa de LabDesk con inicio de sesión automático y modo quiosco protegido.
#
# Uso:
#   sudo bash install-station.sh [URL_SERVIDOR]
# Ejemplo:
#   sudo bash install-station.sh http://192.168.3.16:3000
# ==============================================================================

set -e

if [ "$EUID" -ne 0 ]; then
  echo "❌ Error: Por favor ejecuta este script con privilegios de root (sudo bash install-station.sh)."
  exit 1
fi

SERVER_URL=${1:-"http://192.168.3.16:3000"}

echo "=========================================================="
echo "🚀 Iniciando Instalación de Estación LabDesk Linux"
echo "🌐 Servidor asignado: $SERVER_URL"
echo "=========================================================="

# 1. Actualización de paquetes del sistema
echo "📦 1/6 Actualizando repositorios e instalando dependencias..."
apt-get update -y
apt-get install -y curl wget git xorg openbox lightdm pamixer pulseaudio-utils xdotool nodejs npm

# 2. Crear usuario 'estudiante' si no existe
echo "👤 2/6 Configurando cuenta de usuario 'estudiante'..."
if ! id -u estudiante >/dev/null 2>&1; then
    useradd -m -s /bin/bash estudiante
    echo "estudiante:estudiante" | chpasswd
    usermod -aG audio,video estudiante
    echo "✅ Usuario 'estudiante' creado."
else
    echo "ℹ️ Usuario 'estudiante' ya existe."
fi

# 3. Configurar inicio de sesión automático (Auto-login)
echo "🔑 3/6 Configurando Auto-Login en LightDM..."
mkdir -p /etc/lightdm/lightdm.conf.d
cat <<EOF > /etc/lightdm/lightdm.conf.d/50-labdesk-autologin.conf
[Seat:*]
autologin-user=estudiante
autologin-user-timeout=0
user-session=openbox
EOF

# 4. Deshabilitar cambio de terminales virtuales (Ctrl+Alt+F1...F6) para evitar escape
echo "🛡️ 4/6 Protegiendo estación contra escape de consola..."
cat <<EOF > /etc/X11/xorg.conf.d/20-disable-vt.conf
Section "ServerFlags"
    Option "DontVTSwitch" "true"
    Option "DontZap" "true"
EndSection
EOF

# 5. Configurar sesión de Openbox para autoarranque de LabDesk
echo "🖥️ 5/6 Configurando sesión quiosco de Openbox..."
STUDENT_HOME="/home/estudiante"
mkdir -p "$STUDENT_HOME/.config/openbox"
mkdir -p "$STUDENT_HOME/.config/labdesk"
mkdir -p "$STUDENT_HOME/Documentos/LabDesk"

# Archivo de configuración con la URL del servidor
cat <<EOF > "$STUDENT_HOME/.config/labdesk/config.json"
{
  "serverUrl": "$SERVER_URL",
  "kiosk": true
}
EOF

# Autostart de Openbox
cat <<EOF > "$STUDENT_HOME/.config/openbox/autostart"
# Desactivar protector de pantalla y suspensión de energía
xset s off
xset -dpms
xset s noblank

# Iniciar LabDesk en bucle (auto-reinicio si se cierra)
while true; do
    cd /opt/labdesk/student-desktop
    npm start -- --no-sandbox
    sleep 2
done &
EOF
chmod +x "$STUDENT_HOME/.config/openbox/autostart"

# Bloqueo de atajos en Openbox rc.xml
cat <<EOF > "$STUDENT_HOME/.config/openbox/rc.xml"
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
    <!-- Configuración mínima sin atajos de salida -->
    <keyboard>
        <!-- Deshabilitar Alt+Tab y combinaciones de sistema -->
    </keyboard>
</openbox_config>
EOF

# 6. Copiar aplicación LabDesk a /opt/labdesk
echo "📂 6/6 Instalando aplicación cliente LabDesk en /opt/labdesk..."
mkdir -p /opt/labdesk
cp -r "$(pwd)/../student-desktop" /opt/labdesk/ 2>/dev/null || true

cd /opt/labdesk/student-desktop
if [ -f "package.json" ]; then
    npm install --omit=dev || true
fi

chown -R estudiante:estudiante "$STUDENT_HOME"
chown -R estudiante:estudiante /opt/labdesk

echo "=========================================================="
echo "🎉 ¡Instalación de Estación LabDesk completada con éxito!"
echo "➡️ Reinicia el equipo con 'sudo reboot' para iniciar en LabDesk."
echo "=========================================================="
