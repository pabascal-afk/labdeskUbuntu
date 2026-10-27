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
echo "🚀 Actualizando LabDesk Estudiante (Motor Híbrido)..."
echo "🌐 Servidor: $SERVER_URL"
echo "=========================================="

# 1. Asegurar herramientas de ventana y navegador estándar si hay sudo sin clave
if ! command -v wmctrl >/dev/null 2>&1 || ! command -v xdotool >/dev/null 2>&1; then
    sudo -n apt-get update -qq 2>/dev/null || true
    sudo -n apt-get install -y -qq wmctrl xdotool 2>/dev/null || true
fi
if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1 && ! command -v google-chrome >/dev/null 2>&1 && ! command -v firefox >/dev/null 2>&1; then
    echo "📦 Instalando navegador estándar..."
    sudo -n apt-get install -y -qq chromium 2>/dev/null || sudo -n apt-get install -y -qq firefox-esr 2>/dev/null || sudo -n apt-get install -y -qq firefox 2>/dev/null || true
fi

# 2. Configurar margen inferior de 48px en Openbox para barra de tareas de LabDesk
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

# 3. Descargar y extraer nueva versión
mkdir -p /opt/labdesk/student-desktop
rm -rf /opt/labdesk/student-desktop/src/renderer/apps/browser 2>/dev/null || true

if curl -fsSL "$SERVER_URL/student-desktop.tar.gz" | tar -xz -C /opt/labdesk/student-desktop; then
    echo "✅ Archivos descargados y extraídos correctamente."
    echo "🔄 Reiniciando interfaz de usuario..."
    pkill -f "electron" || pkill -f "labdesk" || true
    echo "🎉 Actualización completada con éxito."
else
    echo "❌ Error al descargar student-desktop.tar.gz desde $SERVER_URL"
    exit 1
fi`;

    const usbAudioScriptContent = `#!/bin/bash
echo "=========================================="
echo "🎧 Configuración y Reparación de Audio USB"
echo "=========================================="

USER_UID=$(id -u)
export XDG_RUNTIME_DIR="/run/user/$USER_UID"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"

# 1. ELIMINAR CUALQUIER .asoundrc QUE BLOQUEE PIPEWIRE O CAUSE 'DUMMY OUTPUT'
echo "--- [1] Eliminando archivos de bloqueo ALSA ---"
if [ -f "$HOME/.asoundrc" ]; then
    rm -f "$HOME/.asoundrc"
    echo "✅ Archivo conflictivo ~/.asoundrc eliminado (esto elimina el Dummy Output)."
else
    echo "✅ No hay archivo ~/.asoundrc bloqueando el sistema."
fi

# 2. Reiniciar PipeWire y WirePlumber para restaurar el hardware limpio
echo "--- [2] Reiniciando servicios de PipeWire y WirePlumber ---"
systemctl --user restart pipewire wireplumber 2>/dev/null || true
sleep 1.5

# 3. Mostrar estado actual de WirePlumber
echo "--- [3] Estado actual de WirePlumber (wpctl status) ---"
wpctl status 2>/dev/null

# 4. Asignar salida de audífonos USB en WirePlumber
echo "--- [4] Asignando salida de audífonos USB ---"
USB_SINK_ID=$(wpctl status 2>/dev/null | awk '/Sinks:/,/Sources:/' | grep -i -E "usb|generalplus|device" | grep -v -i "dummy" | grep -o -E '[0-9]+' | head -n 1)

if [ -n "$USB_SINK_ID" ]; then
    echo "✅ Audífonos USB detectados con ID: $USB_SINK_ID"
    wpctl set-default "$USB_SINK_ID"
    wpctl set-mute "$USB_SINK_ID" 0
    wpctl set-volume "$USB_SINK_ID" 0.75
    echo "✅ Salida de audio configurada al 75% en audífonos USB."
else
    echo "⚠️ No se detectó Sink USB en WirePlumber. Sinks disponibles:"
    wpctl status 2>/dev/null | awk '/Sinks:/,/Sources:/'
fi

# 5. Asignar micrófono USB en WirePlumber
echo "--- [5] Asignando micrófono USB ---"
USB_SRC_ID=$(wpctl status 2>/dev/null | awk '/Sources:/,/Filters:/' | grep -i -E "usb|generalplus|device" | grep -v -i "monitor" | grep -v -i "dummy" | grep -o -E '[0-9]+' | head -n 1)

if [ -n "$USB_SRC_ID" ]; then
    echo "✅ Micrófono USB detectado con ID: $USB_SRC_ID"
    wpctl set-default "$USB_SRC_ID"
    wpctl set-mute "$USB_SRC_ID" 0
    wpctl set-volume "$USB_SRC_ID" 0.80
    echo "✅ Micrófono USB activado al 80%."
else
    echo "⚠️ No se detectó micrófono USB específico."
fi

# 6. Desmutear canales de hardware ALSA (Generalplus es tarjeta 1)
echo "--- [6] Desmuteando canales de hardware ALSA ---"
amixer -c 1 sset Speaker 75% unmute 2>/dev/null || true
amixer -c 1 sset Mic 80% unmute 2>/dev/null || true
amixer -c 1 sset Master 75% unmute 2>/dev/null || true
amixer -q sset Master 75% unmute 2>/dev/null || true
amixer -q sset Headphone 75% unmute 2>/dev/null || true

# 7. Prueba de audio
echo "--- [7] Emitiendo tono de prueba... ---"
if which paplay >/dev/null 2>&1 && [ -f /usr/share/sounds/freedesktop/stereo/complete.oga ]; then
    paplay /usr/share/sounds/freedesktop/stereo/complete.oga 2>/dev/null || true
elif which pw-play >/dev/null 2>&1 && [ -f /usr/share/sounds/freedesktop/stereo/complete.oga ]; then
    pw-play /usr/share/sounds/freedesktop/stereo/complete.oga 2>/dev/null || true
elif which aplay >/dev/null 2>&1; then
    aplay -D plughw:1,0 /usr/share/sounds/alsa/Front_Center.wav 2>/dev/null || true
fi

echo "=========================================="
echo "🎉 Proceso finalizado. Verifica el sonido en los audífonos."
echo "=========================================="`;

    const defaultScripts = [
        {
            name: '⚡ Actualizar Software Estudiante',
            description: 'Descarga la última versión de LabDesk desde el servidor y reinicia la interfaz en 3 segundos.',
            icon: '⚡',
            content: updateScriptContent
        },
        {
            name: '🎧 Activar Audífonos USB (Salida y Micrófono)',
            description: 'Detecta audífonos USB con micrófono, los establece como predeterminados, desmutea canales y ajusta el volumen.',
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
            } else if (cleanName.includes('Actualizar Software') || cleanName.includes('Audífonos USB')) {
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
