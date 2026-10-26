const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const wol = require('wake_on_lan');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const LATEST_AGENT_VERSION = '2.0.0';

// Directorios de almacenamiento
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
const transferDir = path.join(uploadDir, 'transfers');
const turnInDir = path.join(uploadDir, 'turn_ins');
const brandingDir = path.join(uploadDir, 'branding');

[uploadDir, transferDir, turnInDir, brandingDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Configuraciones de Multer
const brandingStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, brandingDir),
    filename: (req, file, cb) => cb(null, 'wallpaper.jpg')
});
const uploadBranding = multer({ storage: brandingStorage });

const transferStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, transferDir),
    filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        cb(null, `${Date.now()}_${safeName}`);
    }
});
const uploadTransfer = multer({ storage: transferStorage });

const turnInStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, turnInDir),
    filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        cb(null, `${Date.now()}_${safeName}`);
    }
});
const uploadTurnIn = multer({ storage: turnInStorage });

const app = express();
app.use(cors());
app.use(express.json());

// Servir archivos estáticos del dashboard y uploads
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(uploadDir));

// Rutas directas para la Botonera del Profesor (Semiadmin)
app.get(['/profesor', '/botonera'], (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'botonera.html'));
});

// Middleware simple de autenticación / roles
app.use((req, res, next) => {
    // Si viene de localhost o con token de profesor
    const isLocalhost = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
    req.user = { role: isLocalhost ? 'admin' : 'student' };
    next();
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 10 * 1024 * 1024 // 10MB para screenshots
});

const clientSockets = new Map();
const clientScreenshots = new Map();

io.on('connection', (socket) => {
    // Registro del cliente (estación Linux)
    socket.on('register_client', (data) => {
        const id = data.id || socket.id;
        const name = data.name || data.hostname || 'Estación Linux';
        const mac_address = data.mac_address || '00:00:00:00:00:00';
        const ip_address = data.ip_address || socket.handshake.address.replace(/^.*:/, '') || '127.0.0.1';
        const version = data.version || LATEST_AGENT_VERSION;
        const volume = data.volume !== undefined ? data.volume : 50;
        const is_muted = data.is_muted ? 1 : 0;

        clientSockets.set(id, socket);

        // Prevenir duplicados: Eliminar cualquier registro previo huérfano con la misma MAC o misma IP y nombre pero distinto ID
        const cleanupParams = [id];
        const cleanupClauses = [];
        if (mac_address && mac_address !== '00:00:00:00:00:00') {
            cleanupClauses.push('mac_address = ?');
            cleanupParams.push(mac_address);
        }
        if (ip_address && ip_address !== '127.0.0.1') {
            cleanupClauses.push('(ip_address = ? AND name = ?)');
            cleanupParams.push(ip_address, name);
        }

        const proceedRegistration = () => {
            db.run(`INSERT INTO clients (id, name, mac_address, status, ip_address, last_seen, version, volume, is_muted)
                    VALUES (?, ?, ?, 'online', ?, datetime('now'), ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    mac_address = excluded.mac_address,
                    status = 'online',
                    ip_address = excluded.ip_address,
                    version = excluded.version,
                    volume = excluded.volume,
                    is_muted = excluded.is_muted,
                    last_seen = datetime('now')`,
                [id, name, mac_address, ip_address, version, volume, is_muted],
                function(err) {
                    if (err) console.error('Error al registrar cliente:', err.message);
                    
                    // Enviar estado de bloqueo configurado para su sector
                    db.get(`SELECT is_locked, sector_id FROM clients WHERE id = ?`, [id], (err, row) => {
                        if (row && row.is_locked) {
                            db.get(`SELECT value FROM settings WHERE key = 'unlock_pin'`, (err, pinRow) => {
                                socket.emit('system_command', { command: 'lock', payload: { pin: pinRow ? pinRow.value : '2846' } });
                            });
                        }
                    });

                    io.emit('clients_updated');
                }
            );
        };

        if (cleanupClauses.length > 0) {
            db.run(`DELETE FROM clients WHERE id != ? AND (${cleanupClauses.join(' OR ')})`, cleanupParams, (err) => {
                proceedRegistration();
            });
        } else {
            proceedRegistration();
        }

        // Desconexión
        socket.on('disconnect', () => {
            clientSockets.delete(id);
            clientScreenshots.delete(id);
            db.run(`UPDATE clients SET status = 'offline', last_seen = datetime('now') WHERE id = ?`, [id], () => {
                io.emit('clients_updated');
            });
        });

        // Actualización de estado local (volumen, pestaña activa, silenciado)
        socket.on('client_state', (state) => {
            if (!state) return;
            db.run(`UPDATE clients SET 
                    volume = COALESCE(?, volume), 
                    is_muted = COALESCE(?, is_muted), 
                    active_tab = COALESCE(?, active_tab) 
                    WHERE id = ?`,
                [state.volume, state.is_muted !== undefined ? (state.is_muted ? 1 : 0) : null, state.active_tab, id],
                () => io.emit('clients_updated')
            );
        });

        // Desbloqueo local con PIN en pantalla
        socket.on('local_unlock', () => {
            db.run(`UPDATE clients SET is_locked = 0 WHERE id = ?`, [id], () => {
                io.emit('clients_updated');
            });
        });

        // Resultado de script bash
        socket.on('script_result', (result) => {
            io.emit('script_result_dashboard', { clientId: id, ...result });
        });
    });

    // Screenshots
    socket.on('screenshot', (data) => {
        let foundId = null;
        for (const [clientId, s] of clientSockets.entries()) {
            if (s.id === socket.id) { foundId = clientId; break; }
        }
        if (!foundId) return;
        clientScreenshots.set(foundId, data.image);
        io.emit('screenshot_update', { clientId: foundId, image: data.image });
    });

    socket.on('screenshot_paused', () => {
        let foundId = null;
        for (const [clientId, s] of clientSockets.entries()) {
            if (s.id === socket.id) { foundId = clientId; break; }
        }
        if (!foundId) return;
        clientScreenshots.set(foundId, 'PAUSED');
        io.emit('screenshot_update', { clientId: foundId, image: 'PAUSED' });
    });

    // Control Remoto (RDP/VNC)
    socket.on('rdp_input', (data) => {
        const targetSocket = clientSockets.get(data.clientId);
        if (targetSocket) targetSocket.emit('rdp_input', data);
    });

    // Explorador de archivos remoto
    socket.on('fs_request_list', (data) => {
        const targetSocket = clientSockets.get(data.clientId);
        if (targetSocket) targetSocket.emit('fs_list', { path: data.path });
    });

    socket.on('fs_list_result', (data) => {
        io.emit('fs_list_result', data);
    });
});

// ==========================================
// REST API ENDPOINTS
// ==========================================

// Autenticación actual
app.get('/api/auth/me', (req, res) => {
    res.json(req.user || { role: 'admin' });
});

// Obtener lista de clientes
app.get('/api/clients', (req, res) => {
    const query = `SELECT id, name, mac_address, status, ip_address, last_seen, 
                          sector_id, position, is_locked, version, role, 
                          volume, is_muted, active_tab 
                   FROM clients 
                   ORDER BY COALESCE(position, 999999) ASC, name ASC`;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Actualizar posición/orden de clientes
app.put('/api/clients/reorder', (req, res) => {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'Array "order" requerido' });

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        const stmt = db.prepare('UPDATE clients SET position = ? WHERE id = ?');
        order.forEach((id, index) => stmt.run(index, id));
        stmt.finalize();
        db.run('COMMIT', (err) => {
            if (err) return res.status(500).json({ error: err.message });
            io.emit('clients_updated');
            res.json({ success: true });
        });
    });
});

// Actualizar datos del cliente (nombre, sector)
app.put('/api/clients/:id', (req, res) => {
    const { name, sector_id } = req.body;
    db.run(`UPDATE clients SET name = COALESCE(?, name), sector_id = ? WHERE id = ?`,
        [name, sector_id !== undefined ? sector_id : null, req.params.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            io.emit('clients_updated');
            res.json({ success: true });
        }
    );
});

// Eliminar un cliente (estación)
app.delete('/api/clients/:id', (req, res) => {
    const id = req.params.id;
    clientSockets.delete(id);
    clientScreenshots.delete(id);
    db.run(`DELETE FROM clients WHERE id = ?`, [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        io.emit('clients_updated');
        res.json({ success: true });
    });
});

// Limpiar duplicados huérfanos (offline que tienen el mismo IP o MAC que un cliente online)
app.post('/api/clients/cleanup-duplicates', (req, res) => {
    db.run(`DELETE FROM clients 
            WHERE status = 'offline' 
            AND id IN (
                SELECT c1.id FROM clients c1 
                JOIN clients c2 ON (
                    (c1.ip_address = c2.ip_address AND c1.ip_address != '127.0.0.1')
                    OR (c1.mac_address = c2.mac_address AND c1.mac_address != '00:00:00:00:00:00')
                    OR (c1.name = c2.name AND c1.name != 'Estación Linux')
                )
                WHERE c1.status = 'offline' AND c2.status = 'online'
            )`, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        const removed = this.changes;
        io.emit('clients_updated');
        res.json({ success: true, removed });
    });
});

// Eliminar todos los equipos desconectados (offline)
app.delete('/api/clients/offline/all', (req, res) => {
    db.run(`DELETE FROM clients WHERE status = 'offline'`, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        const removed = this.changes;
        io.emit('clients_updated');
        res.json({ success: true, removed });
    });
});

// Screenshot individual
app.get('/api/clients/:id/screenshot', (req, res) => {
    const img = clientScreenshots.get(req.params.id);
    if (!img || img === 'PAUSED') return res.status(404).json({ error: 'No hay captura disponible' });
    const buffer = Buffer.from(img, 'base64');
    res.set('Content-Type', 'image/jpeg');
    res.send(buffer);
});

// Comando a un cliente específico
app.post('/api/clients/:id/command', (req, res) => {
    const clientId = req.params.id;
    const { command, payload } = req.body;

    if (command === 'wake') {
        db.get(`SELECT mac_address FROM clients WHERE id = ?`, [clientId], (err, row) => {
            if (row && row.mac_address) {
                wol.wake(row.mac_address, (error) => {
                    if (error) return res.status(500).json({ error: 'Error enviando paquete WOL' });
                    res.json({ message: 'Paquete Wake-on-LAN enviado' });
                });
            } else {
                res.status(404).json({ error: 'MAC address no encontrada' });
            }
        });
        return;
    }

    const socket = clientSockets.get(clientId);
    if (!socket) return res.status(404).json({ error: 'El equipo está offline' });

    if (command === 'lock') {
        db.get(`SELECT value FROM settings WHERE key = 'unlock_pin'`, (err, pinRow) => {
            const pin = pinRow ? pinRow.value : '2846';
            db.run(`UPDATE clients SET is_locked = 1 WHERE id = ?`, [clientId]);
            io.emit('clients_updated');
            socket.emit('system_command', { command: 'lock', payload: { pin, message: payload?.message } });
            res.json({ success: true });
        });
        return;
    } else if (command === 'unlock') {
        db.run(`UPDATE clients SET is_locked = 0 WHERE id = ?`, [clientId]);
        io.emit('clients_updated');
        socket.emit('system_command', { command: 'unlock' });
        return res.json({ success: true });
    }

    // Audio
    if (['volume_set', 'volume_up', 'volume_down', 'volume_mute', 'volume_unmute'].includes(command)) {
        socket.emit('audio_command', { command, payload });
        return res.json({ success: true });
    }

    // Navegador / Pestañas
    if (['browser_open_url', 'browser_close_tab', 'browser_kiosk_mode'].includes(command)) {
        socket.emit('browser_command', { command, payload });
        return res.json({ success: true });
    }

    // Scripts Bash
    if (command === 'run_script') {
        socket.emit('run_script', payload);
        return res.json({ success: true });
    }

    // Otros comandos de sistema (shutdown, reboot, etc.)
    socket.emit('system_command', { command, payload });
    res.json({ success: true });
});

// Comandos masivos a todos o por sector
app.post('/api/clients/command/all', (req, res) => {
    const { command, payload, sector_id } = req.body;

    let filterClause = '';
    const params = [];
    if (sector_id && sector_id !== 'all') {
        filterClause = ' WHERE sector_id = ?';
        params.push(Number(sector_id));
    }

    if (command === 'wake') {
        db.all(`SELECT mac_address FROM clients ${filterClause}`, params, (err, rows) => {
            if (!err && rows) {
                rows.forEach(r => { if (r.mac_address) wol.wake(r.mac_address); });
            }
        });
        return res.json({ success: true, message: 'Paquetes Wake-on-LAN enviados' });
    }

    db.all(`SELECT id FROM clients ${filterClause}`, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const allowedIds = (sector_id && sector_id !== 'all') ? new Set(rows.map(r => r.id)) : null;

        const targets = [];
        for (const [id, socket] of clientSockets.entries()) {
            if (!allowedIds || allowedIds.has(id)) {
                targets.push({ id, socket });
            }
        }

        if (command === 'lock') {
            db.get(`SELECT value FROM settings WHERE key = 'unlock_pin'`, (err, pinRow) => {
                const pin = pinRow ? pinRow.value : '2846';
                db.run(`UPDATE clients SET is_locked = 1 ${filterClause}`, params);
                io.emit('clients_updated');
                targets.forEach(t => t.socket.emit('system_command', { command: 'lock', payload: { pin, message: payload?.message } }));
                res.json({ success: true, count: targets.length });
            });
            return;
        }

        if (command === 'unlock') {
            db.run(`UPDATE clients SET is_locked = 0 ${filterClause}`, params);
            io.emit('clients_updated');
            targets.forEach(t => t.socket.emit('system_command', { command: 'unlock' }));
            return res.json({ success: true, count: targets.length });
        }

        if (['volume_set', 'volume_up', 'volume_down', 'volume_mute', 'volume_unmute'].includes(command)) {
            if (command === 'volume_mute') db.run(`UPDATE clients SET is_muted = 1 ${filterClause}`, params);
            if (command === 'volume_unmute') db.run(`UPDATE clients SET is_muted = 0 ${filterClause}`, params);
            if (command === 'volume_set' && payload?.volume !== undefined) db.run(`UPDATE clients SET volume = ? ${filterClause}`, [payload.volume, ...params]);
            io.emit('clients_updated');
            targets.forEach(t => t.socket.emit('audio_command', { command, payload }));
            return res.json({ success: true, count: targets.length });
        }

        if (['browser_open_url', 'browser_close_tab', 'browser_kiosk_mode'].includes(command)) {
            targets.forEach(t => t.socket.emit('browser_command', { command, payload }));
            return res.json({ success: true, count: targets.length });
        }

        if (command === 'announcement') {
            targets.forEach(t => t.socket.emit('system_command', { command: 'announcement', payload }));
            return res.json({ success: true, count: targets.length });
        }

        if (command === 'run_script') {
            targets.forEach(t => t.socket.emit('run_script', payload));
            return res.json({ success: true, count: targets.length });
        }

        targets.forEach(t => t.socket.emit('system_command', { command, payload }));
        res.json({ success: true, count: targets.length });
    });
});

// Resumen del aula para la Botonera del Profesor
app.get('/api/teacher/summary', (req, res) => {
    const sector_id = req.query.sector_id;
    let clientQuery = 'SELECT COUNT(*) as total, SUM(CASE WHEN status="online" THEN 1 ELSE 0 END) as online, SUM(CASE WHEN is_locked=1 THEN 1 ELSE 0 END) as locked, SUM(CASE WHEN is_muted=1 THEN 1 ELSE 0 END) as muted FROM clients';
    const params = [];
    if (sector_id && sector_id !== 'all') {
        clientQuery += ' WHERE sector_id = ?';
        params.push(Number(sector_id));
    }

    db.get(clientQuery, params, (err, stats) => {
        if (err) return res.status(500).json({ error: err.message });
        
        db.get('SELECT COUNT(*) as turn_in_count FROM turn_ins', [], (err2, turnIns) => {
            res.json({
                total: stats ? (stats.total || 0) : 0,
                online: stats ? (stats.online || 0) : 0,
                locked: stats ? (stats.locked || 0) : 0,
                muted: stats ? (stats.muted || 0) : 0,
                turn_in_count: turnIns ? (turnIns.turn_in_count || 0) : 0
            });
        });
    });
});

// ==========================================
// SECTORES (AULAS)
// ==========================================
app.get('/api/sectors', (req, res) => {
    const query = `
        SELECT s.*, 
               COUNT(c.id) as client_count,
               SUM(CASE WHEN c.status = 'online' THEN 1 ELSE 0 END) as online_count
        FROM sectors s
        LEFT JOIN clients c ON c.sector_id = s.id
        GROUP BY s.id
        ORDER BY COALESCE(s.position, 999999) ASC, s.id ASC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Reordenar pestañas de Aulas
app.put('/api/sectors/reorder', (req, res) => {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'Array "order" requerido' });

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        const stmt = db.prepare('UPDATE sectors SET position = ? WHERE id = ?');
        order.forEach((id, index) => stmt.run(index, id));
        stmt.finalize();
        db.run('COMMIT', (err) => {
            if (err) return res.status(500).json({ error: err.message });
            io.emit('sectors_updated');
            res.json({ success: true });
        });
    });
});

app.post('/api/sectors', (req, res) => {
    const { name, icon, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre es requerido' });
    db.run(`INSERT INTO sectors (name, icon, color) VALUES (?, ?, ?)`,
        [name, icon || '🖥️', color || '#3b82f6'],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            io.emit('sectors_updated');
            res.json({ id: this.lastID, success: true });
        }
    );
});

app.put('/api/sectors/:id', (req, res) => {
    const { name, icon, color } = req.body;
    db.run(`UPDATE sectors SET name = COALESCE(?, name), icon = COALESCE(?, icon), color = COALESCE(?, color) WHERE id = ?`,
        [name, icon, color, req.params.id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            io.emit('sectors_updated');
            res.json({ success: true });
        }
    );
});

app.delete('/api/sectors/:id', (req, res) => {
    db.run(`DELETE FROM sectors WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        db.run(`UPDATE clients SET sector_id = NULL WHERE sector_id = ?`, [req.params.id]);
        io.emit('sectors_updated');
        io.emit('clients_updated');
        res.json({ success: true });
    });
});

// ==========================================
// SCRIPTS BASH
// ==========================================
app.get('/api/scripts', (req, res) => {
    db.all(`SELECT * FROM scripts ORDER BY COALESCE(position, 999999) ASC, id ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/scripts', (req, res) => {
    const { name, description, content, icon, is_shortcut } = req.body;
    if (!name || !content) return res.status(400).json({ error: 'Nombre y contenido requeridos' });
    db.run(`INSERT INTO scripts (name, description, content, icon, is_shortcut) VALUES (?, ?, ?, ?, ?)`,
        [name, description || '', content, icon || '📜', is_shortcut ? 1 : 0],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, success: true });
        }
    );
});

app.put('/api/scripts/:id', (req, res) => {
    const { name, description, content, icon, is_shortcut } = req.body;
    db.run(`UPDATE scripts SET name = ?, description = ?, content = ?, icon = ?, is_shortcut = ? WHERE id = ?`,
        [name, description, content, icon, is_shortcut ? 1 : 0, req.params.id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

app.delete('/api/scripts/:id', (req, res) => {
    db.run(`DELETE FROM scripts WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ==========================================
// BUZÓN DE ENTREGAS DE TAREAS (ESTUDIANTES)
// ==========================================
app.get('/api/turn-ins', (req, res) => {
    db.all(`SELECT * FROM turn_ins ORDER BY created_at DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/turn-ins/upload', uploadTurnIn.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
    const { clientId, clientName, studentName, appType, notes } = req.body;

    db.run(`INSERT INTO turn_ins (client_id, client_name, student_name, app_type, filename, file_path, file_size, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [clientId || 'unknown', clientName || 'Puesto Estudiante', studentName || 'Estudiante', appType || 'document', req.file.originalname, `/uploads/turn_ins/${req.file.filename}`, req.file.size, notes || ''],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            const item = {
                id: this.lastID,
                client_id: clientId,
                client_name: clientName,
                student_name: studentName,
                app_type: appType,
                filename: req.file.originalname,
                url: `/uploads/turn_ins/${req.file.filename}`,
                created_at: new Date().toISOString()
            };
            io.emit('new_turn_in', item);
            res.json({ success: true, item });
        }
    );
});

app.delete('/api/turn-ins/:id', (req, res) => {
    db.get(`SELECT file_path FROM turn_ins WHERE id = ?`, [req.params.id], (err, row) => {
        if (row && row.file_path) {
            const fullPath = path.join(__dirname, '..', 'public', row.file_path);
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        }
        db.run(`DELETE FROM turn_ins WHERE id = ?`, [req.params.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
});

// ==========================================
// CONFIGURACIONES Y BRANDING
// ==========================================
app.get('/api/settings', (req, res) => {
    db.all(`SELECT key, value FROM settings`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const obj = {};
        if (rows) rows.forEach(r => { obj[r.key] = r.value; });
        res.json(obj);
    });
});

app.post('/api/settings', (req, res) => {
    const settings = req.body;
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        const stmt = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
        for (const [k, v] of Object.entries(settings)) {
            stmt.run(k, String(v));
        }
        stmt.finalize();
        db.run('COMMIT', (err) => {
            if (err) return res.status(500).json({ error: err.message });
            io.emit('settings_updated', settings);
            res.json({ success: true, settings });
        });
    });
});

app.get('/api/settings/pin', (req, res) => {
    db.get(`SELECT value FROM settings WHERE key = 'unlock_pin'`, (err, row) => {
        res.json({ pin: row ? row.value : '2846' });
    });
});

app.post('/api/settings/pin', (req, res) => {
    const { pin } = req.body;
    db.run(`INSERT INTO settings (key, value) VALUES ('unlock_pin', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [pin], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, pin });
    });
});

app.post('/api/branding/image', uploadBranding.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se subió imagen' });
    io.emit('branding_updated', { url: '/uploads/branding/wallpaper.jpg' });
    res.json({ success: true, url: '/uploads/branding/wallpaper.jpg' });
});

app.get('/api/branding/status', (req, res) => {
    const exists = fs.existsSync(path.join(brandingDir, 'wallpaper.jpg'));
    res.json({ exists, url: exists ? '/uploads/branding/wallpaper.jpg' : null });
});

// Arrancar servidor
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 LabDesk Server escuchando en http://0.0.0.0:${PORT}`);
});
