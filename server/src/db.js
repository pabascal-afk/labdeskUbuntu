const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, '..', 'labdesk.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening LabDesk database:', err.message);
    } else {
        console.log('✅ Connected to SQLite database:', dbPath);
        initSchema();
    }
});

function initSchema() {
    db.serialize(() => {
        // Tabla de clientes (estaciones)
        db.run(`CREATE TABLE IF NOT EXISTS clients (
            id TEXT PRIMARY KEY,
            name TEXT,
            mac_address TEXT,
            status TEXT DEFAULT 'offline',
            ip_address TEXT,
            last_seen DATETIME,
            position INTEGER,
            is_locked INTEGER DEFAULT 0,
            version TEXT DEFAULT '2.0',
            role TEXT DEFAULT 'student',
            assigned_sector_id INTEGER,
            sector_id INTEGER,
            volume INTEGER DEFAULT 50,
            is_muted INTEGER DEFAULT 0,
            active_tab TEXT,
            access_token TEXT
        )`, () => {
            // Marcar todos los clientes offline al iniciar de forma segura
            db.run("UPDATE clients SET status = 'offline'", (err) => {
                if (!err) console.log('✅ Clientes inicializados en estado offline');
            });
        });

        // Tabla de sectores (aulas / salas)
        db.run(`CREATE TABLE IF NOT EXISTS sectors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            icon TEXT DEFAULT '🖥️',
            color TEXT DEFAULT '#3b82f6',
            position INTEGER,
            default_locked BOOLEAN DEFAULT 0,
            default_pause_captures BOOLEAN DEFAULT 0,
            enforce_schedule_enabled BOOLEAN DEFAULT 0,
            enforce_schedule_start TEXT DEFAULT '08:15',
            enforce_schedule_interval INTEGER DEFAULT 95
        )`);

        // Tabla de scripts (Bash para Linux)
        db.run(`CREATE TABLE IF NOT EXISTS scripts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            content TEXT NOT NULL,
            icon TEXT DEFAULT '📜',
            created_at DATETIME DEFAULT (datetime('now')),
            position INTEGER,
            is_shortcut INTEGER DEFAULT 0
        )`, () => {
            ensureDefaultScripts();
        });

        // Tabla de configuraciones globales
        db.run(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`, () => {
            db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('unlock_pin', '2846')`);
            db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('school_name', 'LabDesk Aula Digital')`);
            db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('default_wallpaper', '/uploads/branding.jpg')`);
            
            const defaultPresets = JSON.stringify([
                { name: 'Google Classroom', url: 'https://classroom.google.com', icon: '🎓' },
                { name: 'Google Docs', url: 'https://docs.google.com/document/create', icon: '📄' },
                { name: 'Google Sheets', url: 'https://sheets.google.com/create', icon: '📊' },
                { name: 'Google Slides', url: 'https://slides.google.com/create', icon: '📽️' },
                { name: 'Wikipedia', url: 'https://es.wikipedia.org', icon: '📚' },
                { name: 'Scratch', url: 'https://scratch.mit.edu', icon: '🐱' },
                { name: 'Geogebra', url: 'https://www.geogebra.org/calculator', icon: '📐' },
                { name: 'Formulario / Examen', url: 'https://docs.google.com/forms', icon: '📝' }
            ]);
            db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('custom_browser_presets', ?)`, [defaultPresets]);
        });

        // Tabla de Entregas de Tareas (Buzón de alumnos)
        db.run(`CREATE TABLE IF NOT EXISTS turn_ins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id TEXT NOT NULL,
            client_name TEXT NOT NULL,
            student_name TEXT,
            app_type TEXT NOT NULL,
            filename TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_size INTEGER,
            created_at DATETIME DEFAULT (datetime('now')),
            notes TEXT
        )`);
    });
}

function ensureDefaultScripts() {
    const updateScriptContent = `#!/bin/bash
CONFIG_FILE="$HOME/.config/labdesk/config.json"
SERVER_URL=""
if [ -f "$CONFIG_FILE" ]; then
    SERVER_URL=$(grep -o '"serverUrl": "[^"]*' "$CONFIG_FILE" | cut -d'"' -f4)
fi
if [ -z "$SERVER_URL" ]; then
    SERVER_URL="http://192.168.3.16:3000"
fi

echo "=========================================="
echo "🚀 Actualizando LabDesk Estudiante..."
echo "🌐 Servidor Local: $SERVER_URL"
echo "=========================================="

# 1. Descargar y extraer la nueva versión de LabDesk (rápido, LAN local)
mkdir -p /opt/labdesk/student-desktop
rm -rf /opt/labdesk/student-desktop/src/renderer/apps/browser 2>/dev/null || true

if curl -fsSL "$SERVER_URL/student-desktop.tar.gz" | tar -xz -C /opt/labdesk/student-desktop; then
    echo "✅ Archivos de LabDesk descargados y actualizados correctamente."
else
    echo "❌ Error: No se pudo descargar student-desktop.tar.gz desde $SERVER_URL"
    exit 1
fi

# 2. Configurar margen inferior de 48px en Openbox para la barra de tareas
mkdir -p "$HOME/.config/openbox"
RC_XML="$HOME/.config/openbox/rc.xml"
if [ ! -f "$RC_XML" ]; then
cat << 'EOF' > "$RC_XML"
<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <margins>
    <top>0</top>
    <bottom>48</bottom>
    <left>0</left>
    <right>0</right>
  </margins>
</openbox_config>
EOF
fi
openbox --reconfigure 2>/dev/null || true
echo "✅ Margen de escritorio configurado."

# 3. Blindaje permanente de audio USB y dependencias en segundo plano
(
    # Instalar regla WirePlumber de prioridad 2000 para audífonos USB
    sudo -n mkdir -p /etc/wireplumber/main.lua.d 2>/dev/null || true
    mkdir -p "$HOME/.config/wireplumber/main.lua.d" 2>/dev/null || true
    cat << 'WPEOF' | sudo -n tee /etc/wireplumber/main.lua.d/99-usb-priority.lua >/dev/null 2>&1 || true
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
WPEOF
    [ -f /etc/wireplumber/main.lua.d/99-usb-priority.lua ] && cp -f /etc/wireplumber/main.lua.d/99-usb-priority.lua "$HOME/.config/wireplumber/main.lua.d/" 2>/dev/null || true

    # Limpiar autostart de Openbox para evitar colisiones al encender el PC
    AUTOSTART="$HOME/.config/openbox/autostart"
    if [ -f "$AUTOSTART" ]; then
        sed -i '/pipewire/d' "$AUTOSTART" 2>/dev/null || true
        sed -i '/wireplumber/d' "$AUTOSTART" 2>/dev/null || true
        if ! grep -q "asoundrc" "$AUTOSTART"; then
            sed -i '1a rm -f "$HOME/.asoundrc" 2>/dev/null || true' "$AUTOSTART" 2>/dev/null || true
        fi
    fi
    rm -f "$HOME/.asoundrc" 2>/dev/null || true

    # Guardar hardware ALSA desmuteado
    amixer -c 1 sset Speaker 75% unmute 2>/dev/null || true
    amixer -c 1 sset Mic 80% unmute 2>/dev/null || true
    sudo -n alsactl store 2>/dev/null || true

    # Soporte de emojis completos (evita cuadros vacíos en la interfaz)
    if ! dpkg -s fonts-noto-color-emoji >/dev/null 2>&1; then
        sudo -n apt-get update -qq 2>/dev/null || true
        sudo -n apt-get install -y -qq fonts-noto-color-emoji 2>/dev/null || true
        fc-cache -f 2>/dev/null || true
    fi

    # Dependencias de ventanas
    if ! command -v wmctrl >/dev/null 2>&1 || ! command -v xdotool >/dev/null 2>&1; then
        sudo -n apt-get update -qq 2>/dev/null || true
        sudo -n apt-get install -y -qq wmctrl xdotool 2>/dev/null || true
    fi
) >/dev/null 2>&1 &

# 4. Finalizar y programar relanzamiento limpio en segundo plano
echo "=========================================="
echo "🎉 Actualización completada con éxito."
echo "🔄 Relanzando entorno LabDesk en 2 segundos..."
echo "=========================================="

# Relanzar de forma segura en subshell desvinculada
(
    sleep 2
    pkill -f "electron" 2>/dev/null || true
    sleep 1
    export DISPLAY="\${DISPLAY:-:0}"
    cd /opt/labdesk/student-desktop
    nohup npm start -- --no-sandbox >/dev/null 2>&1 &
) >/dev/null 2>&1 &

exit 0`;

    const usbAudioScriptContent = `#!/bin/bash
echo "=========================================="
echo "🎧 Blindaje y Configuración Permanente de Audio USB"
echo "=========================================="

USER_UID=$(id -u)
export XDG_RUNTIME_DIR="/run/user/$USER_UID"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"

# 1. Regla WirePlumber de prioridad permanente (2000)
sudo -n mkdir -p /etc/wireplumber/main.lua.d 2>/dev/null || true
mkdir -p "$HOME/.config/wireplumber/main.lua.d" 2>/dev/null || true

cat << 'EOF' | sudo -n tee /etc/wireplumber/main.lua.d/99-usb-priority.lua >/dev/null 2>&1 || true
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

if [ -f /etc/wireplumber/main.lua.d/99-usb-priority.lua ]; then
    cp -f /etc/wireplumber/main.lua.d/99-usb-priority.lua "$HOME/.config/wireplumber/main.lua.d/" 2>/dev/null || true
fi
echo "✅ Regla de prioridad USB (2000) instalada en WirePlumber."

# 2. Corregir autostart de Openbox para eliminar pipewire duplicado al encender
AUTOSTART="$HOME/.config/openbox/autostart"
if [ -f "$AUTOSTART" ]; then
    sed -i '/pipewire/d' "$AUTOSTART" 2>/dev/null || true
    sed -i '/wireplumber/d' "$AUTOSTART" 2>/dev/null || true
    if ! grep -q "asoundrc" "$AUTOSTART"; then
        sed -i '1a rm -f "$HOME/.asoundrc" 2>/dev/null || true' "$AUTOSTART" 2>/dev/null || true
    fi
    echo "✅ Autostart de Openbox corregido (sin colisiones al encender el PC)."
fi

# 3. Eliminar cualquier .asoundrc conflictivo
rm -f "$HOME/.asoundrc" 2>/dev/null || true
echo "✅ Archivo conflictivo ~/.asoundrc eliminado."

# 4. Desmutear canales de hardware ALSA
USB_CARD=$(cat /proc/asound/cards 2>/dev/null | grep -i "usb" | awk '{print $1}' | head -n 1)
if [ -n "$USB_CARD" ]; then
    amixer -c "$USB_CARD" sset Speaker 75% unmute 2>/dev/null || true
    amixer -c "$USB_CARD" sset Mic 80% unmute 2>/dev/null || true
    amixer -c "$USB_CARD" sset Master 75% unmute 2>/dev/null || true
fi
amixer -c 1 sset Speaker 75% unmute 2>/dev/null || true
amixer -c 1 sset Mic 80% unmute 2>/dev/null || true
amixer -c 1 sset Master 75% unmute 2>/dev/null || true
amixer -q sset Master 75% unmute 2>/dev/null || true
amixer -q sset Headphone 75% unmute 2>/dev/null || true
sudo -n alsactl store 2>/dev/null || true
echo "✅ Niveles ALSA guardados en /var/lib/alsa/asound.state."

# 5. Reiniciar WirePlumber para aplicar la regla de prioridad
systemctl --user restart wireplumber 2>/dev/null || true
sleep 1.5

# 6. Asignar salida y micrófono en WirePlumber
USB_SINK_ID=$(wpctl status 2>/dev/null | awk '/Sinks:/,/Sources:/' | grep -i -E "usb|generalplus|device" | grep -v -i "dummy" | grep -o -E '[0-9]+' | head -n 1)
if [ -n "$USB_SINK_ID" ]; then
    wpctl set-default "$USB_SINK_ID" 2>/dev/null
    wpctl set-mute "$USB_SINK_ID" 0 2>/dev/null
    wpctl set-volume "$USB_SINK_ID" 0.75 2>/dev/null
    echo "✅ Salida de audífonos USB seleccionada (ID: $USB_SINK_ID, 75%)."
fi

USB_SRC_ID=$(wpctl status 2>/dev/null | awk '/Sources:/,/Filters:/' | grep -i -E "usb|generalplus|device" | grep -v -i "monitor" | grep -v -i "dummy" | grep -o -E '[0-9]+' | head -n 1)
if [ -n "$USB_SRC_ID" ]; then
    wpctl set-default "$USB_SRC_ID" 2>/dev/null
    wpctl set-mute "$USB_SRC_ID" 0 2>/dev/null
    wpctl set-volume "$USB_SRC_ID" 0.80 2>/dev/null
    echo "✅ Micrófono USB seleccionado (ID: $USB_SRC_ID, 80%)."
fi

# 7. Tono de prueba
if which paplay >/dev/null 2>&1 && [ -f /usr/share/sounds/freedesktop/stereo/complete.oga ]; then
    paplay /usr/share/sounds/freedesktop/stereo/complete.oga 2>/dev/null || true
elif which pw-play >/dev/null 2>&1 && [ -f /usr/share/sounds/freedesktop/stereo/complete.oga ]; then
    pw-play /usr/share/sounds/freedesktop/stereo/complete.oga 2>/dev/null || true
fi

echo "=========================================="
echo "🎉 Audio configurado permanentemente. No volverá a fallar tras reiniciar."
echo "=========================================="`;

    const defaultScripts = [
        {
            name: '⚡ Actualizar Software Estudiante',
            description: 'Descarga la última versión de LabDesk desde el servidor, blinda el audio y relanza la interfaz en 3 segundos.',
            icon: '⚡',
            content: updateScriptContent
        },
        {
            name: '🛠️ Blindar y Configurar Audio USB Permanente',
            description: 'Configura WirePlumber con prioridad 2000 para audífonos USB, guarda niveles ALSA y limpia autostart de forma definitiva.',
            icon: '🎧',
            content: usbAudioScriptContent
        },
        {
            name: '🔊 Reiniciar Audio (PipeWire / Pulse)',
            description: 'Restaura el servidor de audio del sistema en caso de problemas de sonido.',
            icon: '🔊',
            content: `#!/bin/bash\n# Reinicia los servicios de audio de usuario en Linux\nsystemctl --user restart pipewire wireplumber 2>/dev/null || pulseaudio -k 2>/dev/null\necho "Audio reiniciado exitosamente."`
        },
        {
            name: '🧹 Limpiar Archivos Temporales',
            description: 'Limpia la caché del navegador y archivos temporales para liberar memoria.',
            icon: '🧹',
            content: `#!/bin/bash\nrm -rf /tmp/* ~/.cache/google-chrome* ~/.cache/chromium* 2>/dev/null\necho "Archivos temporales y cachés limpiadas."`
        },
        {
            name: '🔄 Reiniciar Entorno LabDesk',
            description: 'Reinicia la aplicación del escritorio educativo del estudiante.',
            icon: '🔄',
            content: `#!/bin/bash\nsystemctl --user restart labdesk 2>/dev/null || pkill -f electron || pkill -f labdesk\necho "Entorno de escritorio reiniciado."`
        },
        {
            name: '🌐 Test de Conectividad a Internet',
            description: 'Verifica ping al servidor y a servidores DNS externos.',
            icon: '🌐',
            content: `#!/bin/bash\necho "=== Ping Gateway / DNS ==="\nping -c 2 8.8.8.8 || ping -c 2 1.1.1.1`
        }
    ];

    defaultScripts.forEach((s, idx) => {
        const cleanName = s.name.replace(/^[^\w\s]+/, '').trim();
        db.get(`SELECT id, name FROM scripts WHERE name LIKE ? OR name = ?`, [`%${cleanName}%`, s.name], (err, row) => {
            if (err) return;
            if (!row) {
                db.run(
                    `INSERT INTO scripts (name, description, icon, content, position, is_shortcut) VALUES (?, ?, ?, ?, ?, 1)`,
                    [s.name, s.description, s.icon, s.content, idx],
                    (insErr) => {
                        if (!insErr) console.log(`✅ Default Linux script inserted: ${s.name}`);
                    }
                );
            } else if (cleanName.includes('Actualizar Software') || cleanName.includes('Audio USB') || cleanName.includes('Audífonos USB')) {
                // Mantener los scripts esenciales al día
                db.run(
                    `UPDATE scripts SET name = ?, description = ?, icon = ?, content = ? WHERE id = ?`,
                    [s.name, s.description, s.icon, s.content, row.id]
                );
            }
        });
    });
}

module.exports = db;
