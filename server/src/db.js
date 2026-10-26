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
            // Verificar si hay scripts precargados, si no, sembrar scripts Linux por defecto
            db.get(`SELECT COUNT(*) as count FROM scripts`, (err, row) => {
                if (!err && row && row.count === 0) {
                    insertDefaultScripts();
                }
            });
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

function insertDefaultScripts() {
    const defaultScripts = [
        {
            name: 'Reiniciar Audio (PipeWire / Pulse)',
            description: 'Restaura el servidor de audio del sistema en caso de problemas de sonido.',
            icon: '🔊',
            content: `#!/bin/bash\n# Reinicia los servicios de audio de usuario en Linux\nsystemctl --user restart pipewire wireplumber 2>/dev/null || pulseaudio -k 2>/dev/null\necho "Audio reiniciado exitosamente."`
        },
        {
            name: 'Limpiar Archivos Temporales',
            description: 'Limpia la caché del navegador y archivos temporales para liberar memoria.',
            icon: '🧹',
            content: `#!/bin/bash\nrm -rf /tmp/* ~/.cache/google-chrome* ~/.cache/chromium* 2>/dev/null\necho "Archivos temporales y cachés limpiadas."`
        },
        {
            name: 'Reiniciar Entorno LabDesk',
            description: 'Reinicia la aplicación del escritorio educativo del estudiante.',
            icon: '🔄',
            content: `#!/bin/bash\nsystemctl --user restart labdesk 2>/dev/null || pkill -f labdesk\necho "Entorno de escritorio reiniciado."`
        },
        {
            name: 'Test de Conectividad a Internet',
            description: 'Verifica ping al servidor y a servidores DNS externos.',
            icon: '🌐',
            content: `#!/bin/bash\necho "=== Ping Gateway / DNS ==="\nping -c 2 8.8.8.8 || ping -c 2 1.1.1.1`
        }
    ];

    const stmt = db.prepare(`INSERT INTO scripts (name, description, icon, content, position, is_shortcut) VALUES (?, ?, ?, ?, ?, 1)`);
    defaultScripts.forEach((s, idx) => {
        stmt.run(s.name, s.description, s.icon, s.content, idx);
    });
    stmt.finalize();
    console.log('✅ Default Linux scripts populated.');
}

module.exports = db;
