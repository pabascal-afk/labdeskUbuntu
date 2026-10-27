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
echo "🎧 Configurando Audífonos USB en Linux"
echo "=========================================="

# 1. Asegurar servicios PipeWire / PulseAudio activos
systemctl --user restart pipewire pipewire-pulse wireplumber 2>/dev/null || pulseaudio -k 2>/dev/null || true
sleep 1

# 2. Localizar y configurar salida de audífonos USB
USB_SINK=$(pactl list short sinks 2>/dev/null | grep -i "usb" | head -n 1 | awk '{print $2}')
if [ -n "$USB_SINK" ]; then
    echo "✅ Audífonos USB encontrados: $USB_SINK"
    pactl set-default-sink "$USB_SINK"
    pactl set-sink-mute "$USB_SINK" 0
    pactl set-sink-volume "$USB_SINK" 75%

    # Redirigir aplicaciones activas (Chrome, Chromium, Electron)
    for id in $(pactl list short sink-inputs 2>/dev/null | cut -f1); do
        pactl move-sink-input "$id" "$USB_SINK" 2>/dev/null || true
    done
    echo "✅ Salida de audio configurada al 75% en audífonos USB."
else
    echo "⚠️ No se detectaron audífonos USB conectados."
    echo "Dispositivos de salida actuales:"
    pactl list short sinks 2>/dev/null
    pactl set-sink-mute @DEFAULT_SINK@ 0 2>/dev/null || true
    pactl set-sink-volume @DEFAULT_SINK@ 75% 2>/dev/null || true
fi

# 3. Localizar y configurar micrófono USB
USB_SOURCE=$(pactl list short sources 2>/dev/null | grep -i "usb" | grep -v "monitor" | head -n 1 | awk '{print $2}')
if [ -n "$USB_SOURCE" ]; then
    echo "✅ Micrófono USB encontrado: $USB_SOURCE"
    pactl set-default-source "$USB_SOURCE"
    pactl set-source-mute "$USB_SOURCE" 0
    pactl set-source-volume "$USB_SOURCE" 80%
    echo "✅ Micrófono USB activado al 80%."
else
    echo "⚠️ No se detectó micrófono USB."
fi

# 4. Desmutear canales ALSA a nivel hardware
amixer -q sset Master unmute 2>/dev/null || true
amixer -q sset Headphone unmute 2>/dev/null || true
amixer -q sset Speaker unmute 2>/dev/null || true
amixer -q sset PCM unmute 2>/dev/null || true
amixer -q sset Mic unmute 2>/dev/null || true

echo "=========================================="
echo "🎉 ¡Configuración de audio completada!"
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
