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
echo "🌐 Servidor: $SERVER_URL"
echo "=========================================="

mkdir -p /opt/labdesk/student-desktop
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
echo "🎧 Diagnóstico y Reparación de Audio USB"
echo "=========================================="

# 1. Configurar entorno de usuario para PipeWire / PulseAudio
USER_UID=$(id -u)
export XDG_RUNTIME_DIR="/run/user/$USER_UID"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"

# 2. Diagnóstico de Hardware USB y Kernel
echo "--- [1] Dispositivos USB detectados (lsusb) ---"
lsusb | grep -i -E "audio|sound|headset|c-media|realtek|logitech|genius" || lsusb | head -n 8

echo "--- [2] Tarjetas reconocidas por el Kernel (/proc/asound/cards) ---"
cat /proc/asound/cards 2>/dev/null || echo "No se pudo leer /proc/asound/cards"

# 3. Comprobar si faltan utilidades e instalarlas si es posible
if ! which pactl >/dev/null 2>&1 && which apt-get >/dev/null 2>&1; then
    echo "Instalando herramientas de audio necesarias (pulseaudio-utils, alsa-utils)..."
    sudo apt-get update -qq 2>/dev/null
    sudo apt-get install -y pulseaudio-utils alsa-utils 2>/dev/null || true
fi

# 4. Asegurar que el usuario está en el grupo de audio
sudo usermod -aG audio $(whoami) 2>/dev/null || true

SET_DONE=0

# 5. Intentar configurar mediante WirePlumber (wpctl - nativo de PipeWire en Ubuntu)
if which wpctl >/dev/null 2>&1; then
    echo "--- [3] Configurando con WirePlumber (wpctl) ---"
    USB_SINK_ID=$(wpctl status 2>/dev/null | awk '/Sinks:/,/Sources:/' | grep -i "usb" | grep -o -E '[0-9]+' | head -n 1)
    if [ -n "$USB_SINK_ID" ]; then
        echo "✅ Sink USB detectado en PipeWire con ID: $USB_SINK_ID"
        wpctl set-default "$USB_SINK_ID" 2>/dev/null
        wpctl set-mute "$USB_SINK_ID" 0 2>/dev/null
        wpctl set-volume "$USB_SINK_ID" 0.75 2>/dev/null
        SET_DONE=1
    fi

    USB_SRC_ID=$(wpctl status 2>/dev/null | awk '/Sources:/,/Filters:/' | grep -i "usb" | grep -v -i "monitor" | grep -o -E '[0-9]+' | head -n 1)
    if [ -n "$USB_SRC_ID" ]; then
        echo "✅ Micrófono USB detectado con ID: $USB_SRC_ID"
        wpctl set-default "$USB_SRC_ID" 2>/dev/null
        wpctl set-mute "$USB_SRC_ID" 0 2>/dev/null
        wpctl set-volume "$USB_SRC_ID" 0.80 2>/dev/null
    fi
fi

# 6. Intentar configurar mediante PulseAudio / PipeWire-Pulse (pactl)
if which pactl >/dev/null 2>&1; then
    echo "--- [4] Configurando con PulseAudio (pactl) ---"
    USB_SINK=$(pactl list short sinks 2>/dev/null | grep -i "usb" | head -n 1 | awk '{print $2}')
    if [ -n "$USB_SINK" ]; then
        echo "✅ Salida USB pactl: $USB_SINK"
        pactl set-default-sink "$USB_SINK" 2>/dev/null
        pactl set-sink-mute "$USB_SINK" 0 2>/dev/null
        pactl set-sink-volume "$USB_SINK" 75% 2>/dev/null
        for stream in $(pactl list short sink-inputs 2>/dev/null | cut -f1); do
            pactl move-sink-input "$stream" "$USB_SINK" 2>/dev/null || true
        done
        SET_DONE=1
    fi

    USB_SOURCE=$(pactl list short sources 2>/dev/null | grep -i "usb" | grep -v "monitor" | head -n 1 | awk '{print $2}')
    if [ -n "$USB_SOURCE" ]; then
        echo "✅ Micrófono USB pactl: $USB_SOURCE"
        pactl set-default-source "$USB_SOURCE" 2>/dev/null
        pactl set-source-mute "$USB_SOURCE" 0 2>/dev/null
        pactl set-source-volume "$USB_SOURCE" 80% 2>/dev/null
    fi
fi

# 7. Configurar ALSA a nivel Kernel mediante ~/.asoundrc (Garantía directa)
USB_CARD_NUM=$(grep -E 'USB-Audio' /proc/asound/cards 2>/dev/null | head -n 1 | awk '{print $1}')
if [ -n "$USB_CARD_NUM" ]; then
    echo "--- [5] Configurando tarjeta ALSA $USB_CARD_NUM por defecto (~/.asoundrc) ---"
    cat <<EOF > "$HOME/.asoundrc"
pcm.!default {
    type hw
    card $USB_CARD_NUM
}
ctl.!default {
    type hw
    card $USB_CARD_NUM
}
EOF
    amixer -c "$USB_CARD_NUM" sset Master 75% unmute 2>/dev/null || true
    amixer -c "$USB_CARD_NUM" sset Speaker 75% unmute 2>/dev/null || true
    amixer -c "$USB_CARD_NUM" sset Headphone 75% unmute 2>/dev/null || true
    amixer -c "$USB_CARD_NUM" sset PCM 75% unmute 2>/dev/null || true
    amixer -c "$USB_CARD_NUM" sset Mic 80% unmute 2>/dev/null || true
    SET_DONE=1
fi

amixer -q sset Master 75% unmute 2>/dev/null || true
amixer -q sset Headphone 75% unmute 2>/dev/null || true
amixer -q sset Speaker 75% unmute 2>/dev/null || true

# 8. Prueba de sonido (beep corto)
echo "--- [6] Emitiendo tono de prueba de audio... ---"
if which paplay >/dev/null 2>&1 && [ -f /usr/share/sounds/freedesktop/stereo/complete.oga ]; then
    paplay /usr/share/sounds/freedesktop/stereo/complete.oga 2>/dev/null || true
elif which speaker-test >/dev/null 2>&1; then
    speaker-test -t sine -f 440 -l 1 -s 1 2>/dev/null || true
fi

echo "=========================================="
if [ "$SET_DONE" -eq 1 ]; then
    echo "🎉 Audífonos USB configurados y activados exitosamente."
else
    echo "⚠️ ATENCIÓN: No se detectó ninguna tarjeta de audio USB en el kernel."
    echo "Por favor prueba conectando los audífonos en otro puerto USB (de preferencia trasero)."
fi
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
