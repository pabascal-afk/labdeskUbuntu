const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const wol = require('wake_on_lan');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const xlsx = require('xlsx');
const AdmZip = require('adm-zip');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const LATEST_AGENT_VERSION = '2.0.0';

// Directorios de almacenamiento
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
const transferDir = path.join(uploadDir, 'transfers');
const turnInDir = path.join(uploadDir, 'turn_ins');
const brandingDir = path.join(uploadDir, 'branding');
const submissionsDir = path.join(uploadDir, 'submissions');
const templatesDir = path.join(uploadDir, 'templates');

[uploadDir, transferDir, turnInDir, brandingDir, submissionsDir, templatesDir].forEach(dir => {
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

const submissionStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const assignId = req.params.id || 'general';
        const targetDir = path.join(submissionsDir, String(assignId));
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        cb(null, targetDir);
    },
    filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        cb(null, `${Date.now()}_${safeName}`);
    }
});
const uploadSubmission = multer({ storage: submissionStorage });

const templateStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, templatesDir),
    filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        cb(null, `${Date.now()}_${safeName}`);
    }
});
const uploadTemplate = multer({ storage: templateStorage });

const uploadRoster = multer({ storage: multer.memoryStorage() });

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

// Sesiones activas de usuarios (token -> { userId, username, fullName, role, loginTime })
const activeSessions = new Map();

// Middleware de autenticación / roles por Token
app.use((req, res, next) => {
    const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
    let token = null;
    if (authHeader) {
        token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
    }
    if (token && activeSessions.has(token)) {
        req.user = activeSessions.get(token);
        return next();
    }
    const isLocalhost = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
    req.user = { userId: null, role: isLocalhost ? 'admin' : 'student', username: isLocalhost ? 'admin_local' : 'guest' };
    next();
});

function requireAuth(allowedRoles = []) {
    return (req, res, next) => {
        if (!req.user || !req.user.userId) {
            // Permitir acceso localhost como administrador por compatibilidad
            if (req.user && req.user.role === 'admin' && (allowedRoles.length === 0 || allowedRoles.includes('admin'))) {
                return next();
            }
            return res.status(401).json({ error: 'Sesión no iniciada. Por favor identifícate como profesor o administrador.' });
        }
        if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Permisos insuficientes para realizar esta acción.' });
        }
        next();
    };
}

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

    // Reenvío de comandos de sistema en tiempo real (ej. start_live_stream / stop_live_stream)
    socket.on('system_command', (data) => {
        if (!data || !data.clientId) return;
        const targetSocket = clientSockets.get(data.clientId);
        if (targetSocket) targetSocket.emit('system_command', { command: data.command, payload: data.payload });
    });

    // Explorador de archivos remoto
    socket.on('fs_request_list', (data) => {
        const targetSocket = clientSockets.get(data.clientId);
        if (targetSocket) targetSocket.emit('fs_list', { path: data.path });
    });

    socket.on('fs_list_result', (data) => {
        io.emit('fs_list_result', data);
    });

    // Telemetría de avance de tareas por estudiantes en tiempo real
    socket.on('student_task_activity', (data) => {
        if (!data || !data.assignmentId || !data.studentId) return;
        const { assignmentId, studentId, clientId, clientName, status, metrics } = data;
        const metricsStr = metrics ? (typeof metrics === 'string' ? metrics : JSON.stringify(metrics)) : null;

        db.run(`INSERT INTO assignment_progress (assignment_id, student_id, client_id, client_name, status, metrics_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(assignment_id, student_id) DO UPDATE SET
                client_id = excluded.client_id,
                client_name = excluded.client_name,
                status = excluded.status,
                metrics_json = excluded.metrics_json,
                updated_at = datetime('now')`,
            [assignmentId, studentId, clientId || null, clientName || null, status || 'working', metricsStr],
            (err) => {
                if (!err) {
                    io.emit('assignment_progress_updated', {
                        assignmentId,
                        studentId,
                        clientId,
                        clientName,
                        status: status || 'working',
                        metrics
                    });
                }
            }
        );
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
        
        db.get('SELECT ((SELECT COUNT(*) FROM turn_ins) + (SELECT COUNT(*) FROM submissions)) as turn_in_count', [], (err2, turnIns) => {
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
// AUTENTICACIÓN Y SESIONES
// ==========================================
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

    db.get("SELECT * FROM users WHERE LOWER(username) = LOWER(?)", [username.trim()], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user || !db.verifyPassword(password, user.password_hash)) {
            return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        }
        const token = crypto.randomBytes(32).toString('hex');
        const sessionData = {
            userId: user.id,
            username: user.username,
            fullName: user.full_name,
            role: user.role
        };
        activeSessions.set(token, sessionData);
        res.json({ success: true, token, user: sessionData });
    });
});

app.get('/api/auth/me', (req, res) => {
    if (!req.user || !req.user.userId) {
        return res.status(401).json({ authenticated: false });
    }
    res.json({ authenticated: true, user: req.user });
});

app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
    if (authHeader) {
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
        activeSessions.delete(token);
    }
    res.json({ success: true });
});

// ==========================================
// GESTIÓN DE USUARIOS (SOLO ADMINISTRADOR)
// ==========================================
app.get('/api/users', requireAuth(['admin']), (req, res) => {
    db.all("SELECT id, username, full_name, role, created_at FROM users ORDER BY created_at ASC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/users', requireAuth(['admin']), (req, res) => {
    const { username, password, full_name, role } = req.body;
    if (!username || !password || !full_name) {
        return res.status(400).json({ error: 'Campos requeridos: username, password, full_name' });
    }
    const cleanUser = username.trim().toLowerCase();
    const userRole = role === 'admin' ? 'admin' : 'teacher';
    const passHash = db.hashPassword(password);

    db.run("INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)",
        [cleanUser, passHash, full_name.trim(), userRole],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'El nombre de usuario ya existe' });
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, id: this.lastID, username: cleanUser, full_name: full_name.trim(), role: userRole });
        }
    );
});

app.put('/api/users/:id', requireAuth(['admin']), (req, res) => {
    const { full_name, role, password } = req.body;
    const userId = Number(req.params.id);

    if (password && password.trim().length > 0) {
        const passHash = db.hashPassword(password.trim());
        db.run("UPDATE users SET full_name = COALESCE(?, full_name), role = COALESCE(?, role), password_hash = ? WHERE id = ?",
            [full_name, role, passHash, userId],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
            }
        );
    } else {
        db.run("UPDATE users SET full_name = COALESCE(?, full_name), role = COALESCE(?, role) WHERE id = ?",
            [full_name, role, userId],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
            }
        );
    }
});

app.delete('/api/users/:id', requireAuth(['admin']), (req, res) => {
    const userId = Number(req.params.id);
    if (req.user && req.user.userId === userId) {
        return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    }
    db.run("DELETE FROM users WHERE id = ?", [userId], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// ==========================================
// GESTIÓN DE CURSOS Y ROSTER DE ESTUDIANTES
// ==========================================
app.get('/api/courses', (req, res) => {
    db.all(`SELECT c.id, c.name, COUNT(s.id) as student_count, c.created_at
            FROM courses c
            LEFT JOIN students s ON c.id = s.course_id
            GROUP BY c.id
            ORDER BY c.name ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/courses/:id/students', (req, res) => {
    db.all("SELECT id, full_name, identifier FROM students WHERE course_id = ? ORDER BY full_name ASC",
        [req.params.id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

app.delete('/api/courses/:id', requireAuth(['admin']), (req, res) => {
    db.run("DELETE FROM courses WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Plantilla descargable de Excel para carga de alumnos
app.get('/api/roster/template', (req, res) => {
    const wb = xlsx.utils.book_new();
    const data = [
        ['Curso', 'Nombre Completo', 'RUT_o_ID'],
        ['7° Básico A', 'Alonso Contreras Silva', '21.458.912-3'],
        ['7° Básico A', 'Camila Morales Gómez', '21.684.102-5'],
        ['8° Básico B', 'Diego Valenzuela Rojas', '20.912.331-K'],
        ['8° Básico B', 'Valentina Díaz Tapia', '20.841.554-1']
    ];
    const ws = xlsx.utils.aoa_to_sheet(data);
    xlsx.utils.book_append_sheet(wb, ws, 'Nomina_Alumnos');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', 'attachment; filename="plantilla_cursos_alumnos.xlsx"');
    res.send(buffer);
});

// Carga masiva de cursos y estudiantes (Excel .xlsx/.xls o .csv)
app.post('/api/roster/import', requireAuth(['admin']), uploadRoster.single('file'), async (req, res) => {
    if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: 'Debes seleccionar un archivo Excel (.xlsx, .xls) o CSV' });
    }

    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        let coursesCreated = 0;
        let studentsImported = 0;

        const getOrCreateCourse = (courseName) => {
            return new Promise((resolve, reject) => {
                const cleanName = courseName.trim();
                db.get("SELECT id FROM courses WHERE LOWER(name) = LOWER(?)", [cleanName], (err, row) => {
                    if (err) return reject(err);
                    if (row) return resolve(row.id);
                    db.run("INSERT INTO courses (name) VALUES (?)", [cleanName], function(insErr) {
                        if (insErr) return reject(insErr);
                        coursesCreated++;
                        resolve(this.lastID);
                    });
                });
            });
        };

        const insertStudent = (courseId, fullName, identifier) => {
            return new Promise((resolve, reject) => {
                const cleanName = fullName.trim();
                const cleanId = identifier ? String(identifier).trim() : null;
                db.get("SELECT id FROM students WHERE course_id = ? AND LOWER(full_name) = LOWER(?)",
                    [courseId, cleanName],
                    (err, row) => {
                        if (err) return reject(err);
                        if (row) return resolve({ duplicated: true });
                        db.run("INSERT INTO students (course_id, full_name, identifier) VALUES (?, ?, ?)",
                            [courseId, cleanName, cleanId],
                            function(insErr) {
                                if (insErr) return reject(insErr);
                                studentsImported++;
                                resolve({ inserted: true, id: this.lastID });
                            }
                        );
                    }
                );
            });
        };

        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
            if (!rows || rows.length === 0) continue;

            for (const row of rows) {
                let courseName = '';
                let fullName = '';
                let firstName = '';
                let lastName = '';
                let identifier = '';

                for (const [key, val] of Object.entries(row)) {
                    const k = key.trim().toLowerCase();
                    const v = String(val).trim();
                    if (!v) continue;

                    if (/^(curso|nivel|grado|class|course)$/i.test(k) || (!courseName && /curso/i.test(k))) {
                        courseName = v;
                    } else if (/^(nombre\s*completo|estudiante|alumno|student)$/i.test(k)) {
                        fullName = v;
                    } else if (/^(nombre|nombres|first[\s_]?name)$/i.test(k)) {
                        firstName = v;
                    } else if (/^(apellido|apellidos|last[\s_]?name)$/i.test(k)) {
                        lastName = v;
                    } else if (/^(rut|id|dni|matricula|identificador)$/i.test(k)) {
                        identifier = v;
                    }
                }

                if (!fullName && (firstName || lastName)) {
                    fullName = `${firstName} ${lastName}`.trim();
                }

                if (!courseName && !sheetName.toLowerCase().startsWith('sheet') && !sheetName.toLowerCase().startsWith('hoja')) {
                    courseName = sheetName;
                }

                if (!courseName) courseName = 'Curso General';
                if (!fullName) continue;

                const courseId = await getOrCreateCourse(courseName);
                await insertStudent(courseId, fullName, identifier);
            }
        }

        res.json({
            success: true,
            coursesCreated,
            studentsImported,
            message: `Importación exitosa: ${coursesCreated} cursos nuevos creados, ${studentsImported} estudiantes registrados.`
        });
    } catch (err) {
        console.error('Error importando nómina:', err);
        res.status(500).json({ error: 'Error procesando archivo: ' + err.message });
    }
});

// ==========================================
// CARPETAS Y TAREAS (ASIGNACIONES DOCENTES)
// ==========================================
app.get('/api/folders', requireAuth(), (req, res) => {
    const userId = req.user.userId;
    const query = req.user.role === 'admin' && !userId
        ? "SELECT * FROM folders ORDER BY name ASC"
        : "SELECT * FROM folders WHERE user_id = ? ORDER BY name ASC";
    const params = req.user.role === 'admin' && !userId ? [] : [userId];

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/folders', requireAuth(), (req, res) => {
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre de la carpeta es requerido' });
    const userId = req.user.userId || 1;

    db.run("INSERT INTO folders (user_id, name, color) VALUES (?, ?, ?)",
        [userId, name.trim(), color || '#3b82f6'],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: this.lastID, name: name.trim(), color: color || '#3b82f6' });
        }
    );
});

app.delete('/api/folders/:id', requireAuth(), (req, res) => {
    db.run("DELETE FROM folders WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Variable de temporizador de sala en memoria
let activeAssignmentTimer = null;

// Listar tareas
app.get('/api/assignments', requireAuth(), (req, res) => {
    const userId = req.user.userId;
    let query = `
        SELECT a.*, c.name as course_name, u.full_name as teacher_name, f.name as folder_name,
               (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) as submission_count
        FROM assignments a
        JOIN courses c ON a.course_id = c.id
        JOIN users u ON a.user_id = u.id
        LEFT JOIN folders f ON a.folder_id = f.id
    `;
    const params = [];
    if (req.user.role !== 'admin' && userId) {
        query += " WHERE a.user_id = ?";
        params.push(userId);
    }
    query += " ORDER BY a.created_at DESC";

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Crear tarea (con plantilla opcional, temporizador y modo enfoque)
app.post('/api/assignments', requireAuth(), uploadTemplate.single('template_file'), (req, res) => {
    const { folder_id, course_id, title, instructions, app_type, is_group, max_group_size, duration_minutes, strict_mode, allow_auto_submit } = req.body;
    if (!title || !course_id) {
        return res.status(400).json({ error: 'Título y curso son obligatorios' });
    }
    const userId = req.user.userId || 1;
    let templateFilePath = null;
    let templateFilename = null;
    if (req.file) {
        templateFilePath = `/uploads/templates/${req.file.filename}`;
        templateFilename = req.file.originalname;
    }

    db.run(`INSERT INTO assignments (user_id, folder_id, course_id, title, instructions, app_type, is_group, max_group_size, status, template_file_path, template_filename, duration_minutes, strict_mode, allow_auto_submit)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
        [
            userId,
            folder_id || null,
            course_id,
            title.trim(),
            instructions || '',
            app_type || 'any',
            is_group ? 1 : 0,
            max_group_size || 4,
            templateFilePath,
            templateFilename,
            parseInt(duration_minutes, 10) || 0,
            strict_mode ? 1 : 0,
            allow_auto_submit !== undefined ? (allow_auto_submit ? 1 : 0) : 1
        ],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id: this.lastID });
        }
    );
});

// Editar tarea (con actualización opcional de plantilla, temporizador y modo enfoque)
app.put('/api/assignments/:id', requireAuth(), uploadTemplate.single('template_file'), (req, res) => {
    const { folder_id, course_id, title, instructions, app_type, is_group, max_group_size, duration_minutes, strict_mode, allow_auto_submit } = req.body;
    let templateFilePath = null;
    let templateFilename = null;
    if (req.file) {
        templateFilePath = `/uploads/templates/${req.file.filename}`;
        templateFilename = req.file.originalname;
    }

    db.run(`UPDATE assignments SET
            folder_id = COALESCE(?, folder_id),
            course_id = COALESCE(?, course_id),
            title = COALESCE(?, title),
            instructions = COALESCE(?, instructions),
            app_type = COALESCE(?, app_type),
            is_group = COALESCE(?, is_group),
            max_group_size = COALESCE(?, max_group_size),
            duration_minutes = COALESCE(?, duration_minutes),
            strict_mode = COALESCE(?, strict_mode),
            allow_auto_submit = COALESCE(?, allow_auto_submit),
            template_file_path = COALESCE(?, template_file_path),
            template_filename = COALESCE(?, template_filename)
            WHERE id = ?`,
        [
            folder_id,
            course_id,
            title,
            instructions,
            app_type,
            is_group !== undefined ? (is_group ? 1 : 0) : null,
            max_group_size,
            duration_minutes !== undefined ? parseInt(duration_minutes, 10) : null,
            strict_mode !== undefined ? (strict_mode ? 1 : 0) : null,
            allow_auto_submit !== undefined ? (allow_auto_submit ? 1 : 0) : null,
            templateFilePath,
            templateFilename,
            req.params.id
        ],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

// Eliminar tarea
app.delete('/api/assignments/:id', requireAuth(), (req, res) => {
    db.run("DELETE FROM assignments WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Helper para obtener tarea activa completa
function getActiveAssignmentDetails(callback) {
    db.get(`SELECT a.*, c.name as course_name, u.full_name as teacher_name
            FROM assignments a
            JOIN courses c ON a.course_id = c.id
            JOIN users u ON a.user_id = u.id
            WHERE a.status = 'active'
            ORDER BY a.created_at DESC LIMIT 1`, [], (err, assignment) => {
        if (err || !assignment) return callback(err, null);

        if (assignment.time_limit_end) {
            const msRemaining = new Date(assignment.time_limit_end).getTime() - Date.now();
            assignment.seconds_remaining = Math.max(0, Math.floor(msRemaining / 1000));
        } else {
            assignment.seconds_remaining = null;
        }

        db.all("SELECT id, full_name, identifier FROM students WHERE course_id = ? ORDER BY full_name ASC",
            [assignment.course_id],
            (sErr, students) => {
                if (sErr) return callback(sErr, null);
                assignment.students = students || [];
                callback(null, assignment);
            }
        );
    });
}

// Activar tarea (Asignar a la sala en tiempo real con temporizador sincronizado)
app.post('/api/assignments/:id/activate', requireAuth(), (req, res) => {
    const assignId = req.params.id;
    if (activeAssignmentTimer) {
        clearTimeout(activeAssignmentTimer);
        activeAssignmentTimer = null;
    }

    // Cerrar cualquier tarea activa previa
    db.run("UPDATE assignments SET status = 'closed', time_limit_end = NULL WHERE status = 'active'", (err) => {
        if (err) return res.status(500).json({ error: err.message });

        db.get("SELECT * FROM assignments WHERE id = ?", [assignId], (gErr, assignRow) => {
            if (gErr || !assignRow) return res.status(404).json({ error: 'Tarea no encontrada' });

            const duration = assignRow.duration_minutes || 0;
            let timeLimitEnd = null;
            if (duration > 0) {
                timeLimitEnd = new Date(Date.now() + duration * 60 * 1000).toISOString();
                // Programar fin de tiempo
                activeAssignmentTimer = setTimeout(() => {
                    io.emit('assignment_time_up', { assignmentId: assignId });
                    activeAssignmentTimer = null;
                }, duration * 60 * 1000);
            }

            // Marcar la nueva tarea como activa
            db.run("UPDATE assignments SET status = 'active', time_limit_end = ? WHERE id = ?", [timeLimitEnd, assignId], (actErr) => {
                if (actErr) return res.status(500).json({ error: actErr.message });
                getActiveAssignmentDetails((detErr, activeData) => {
                    if (activeData) {
                        io.emit('active_assignment_updated', activeData);
                    }
                    res.json({ success: true, assignment: activeData });
                });
            });
        });
    });
});

// Desactivar tarea activa
app.post('/api/assignments/:id/deactivate', requireAuth(), (req, res) => {
    if (activeAssignmentTimer) {
        clearTimeout(activeAssignmentTimer);
        activeAssignmentTimer = null;
    }
    db.run("UPDATE assignments SET status = 'closed', time_limit_end = NULL WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        io.emit('active_assignment_updated', null);
        res.json({ success: true });
    });
});

// Obtener tarea activa (Endpoint público para estaciones y mini editores)
app.get('/api/assignments/active', (req, res) => {
    getActiveAssignmentDetails((err, activeData) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!activeData) return res.json({ active: false });
        res.json({ active: true, assignment: activeData });
    });
});

// Matriz de avance y semáforo en tiempo real de una tarea
app.get('/api/assignments/:id/progress-matrix', requireAuth(), (req, res) => {
    const assignId = req.params.id;
    db.get(`SELECT a.*, c.name as course_name FROM assignments a JOIN courses c ON a.course_id = c.id WHERE a.id = ?`, [assignId], (aErr, assignment) => {
        if (aErr || !assignment) return res.status(404).json({ error: 'Tarea no encontrada' });

        db.all("SELECT id, full_name, identifier FROM students WHERE course_id = ? ORDER BY full_name ASC", [assignment.course_id], (sErr, students) => {
            if (sErr) return res.status(500).json({ error: sErr.message });

            db.all("SELECT * FROM assignment_progress WHERE assignment_id = ?", [assignId], (pErr, progressRows) => {
                if (pErr) return res.status(500).json({ error: pErr.message });

                db.all("SELECT * FROM submissions WHERE assignment_id = ? ORDER BY created_at DESC", [assignId], (subErr, submissions) => {
                    if (subErr) return res.status(500).json({ error: subErr.message });

                    const progressMap = new Map();
                    (progressRows || []).forEach(p => progressMap.set(p.student_id, p));

                    const summary = {
                        total: students.length,
                        not_started: 0,
                        working: 0,
                        submitted: 0,
                        graded: 0,
                        returned: 0,
                        percent_completed: 0
                    };

                    const matrix = (students || []).map(student => {
                        // Buscar si tiene entrega
                        const sub = (submissions || []).find(s => {
                            if (s.main_student_name === student.full_name) return true;
                            try {
                                const names = JSON.parse(s.student_names);
                                if (Array.isArray(names) && names.includes(student.full_name)) return true;
                            } catch(e) {}
                            return false;
                        });

                        const prog = progressMap.get(student.id);

                        let status = 'not_started';
                        let clientName = prog ? prog.client_name : null;
                        let metrics = null;
                        if (prog && prog.metrics_json) {
                            try { metrics = JSON.parse(prog.metrics_json); } catch(e) { metrics = prog.metrics_json; }
                        }

                        if (sub) {
                            if (sub.status === 'returned') {
                                status = 'returned';
                            } else if (sub.status === 'graded') {
                                status = 'graded';
                            } else {
                                status = 'submitted';
                            }
                            clientName = sub.client_name || clientName;
                        } else if (prog && prog.status === 'working') {
                            status = 'working';
                        }

                        summary[status] = (summary[status] || 0) + 1;

                        return {
                            id: student.id,
                            full_name: student.full_name,
                            identifier: student.identifier,
                            status,
                            client_name: clientName,
                            metrics,
                            submission: sub ? {
                                id: sub.id,
                                filename: sub.filename,
                                file_path: sub.file_path,
                                app_type: sub.app_type,
                                grade: sub.grade,
                                feedback: sub.feedback,
                                status: sub.status,
                                return_count: sub.return_count,
                                created_at: sub.created_at
                            } : null
                        };
                    });

                    const completedCount = (summary.submitted || 0) + (summary.graded || 0);
                    summary.percent_completed = summary.total > 0 ? Math.round((completedCount / summary.total) * 100) : 0;

                    res.json({
                        assignment,
                        summary,
                        students: matrix
                    });
                });
            });
        });
    });
});

// ==========================================
// SUBMISSIONS (ENTREGAS DE ALUMNOS)
// ==========================================
app.post('/api/assignments/:id/turn-in', uploadSubmission.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
    const assignmentId = req.params.id;
    const { clientId, clientName, courseName, studentNames, mainStudentName, appType, notes } = req.body;

    let parsedStudentNames = [];
    if (studentNames) {
        try {
            parsedStudentNames = typeof studentNames === 'string' && studentNames.startsWith('[')
                ? JSON.parse(studentNames)
                : String(studentNames).split(',').map(s => s.trim()).filter(Boolean);
        } catch(e) {
            parsedStudentNames = [String(studentNames).trim()];
        }
    }
    const mainStudent = mainStudentName || (parsedStudentNames.length > 0 ? parsedStudentNames[0] : 'Estudiante');
    const filePath = `/uploads/submissions/${assignmentId}/${req.file.filename}`;

    db.run(`INSERT INTO submissions (assignment_id, client_id, client_name, course_name, student_names, main_student_name, app_type, filename, file_path, file_size, notes, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`,
        [
            assignmentId,
            clientId || 'station',
            clientName || 'Puesto Estudiante',
            courseName || '',
            JSON.stringify(parsedStudentNames),
            mainStudent,
            appType || 'documento',
            req.file.originalname,
            filePath,
            req.file.size,
            notes || ''
        ],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            const submissionItem = {
                id: this.lastID,
                assignment_id: assignmentId,
                client_id: clientId,
                client_name: clientName,
                course_name: courseName,
                student_names: parsedStudentNames,
                main_student_name: mainStudent,
                app_type: appType,
                filename: req.file.originalname,
                file_path: filePath,
                url: filePath,
                status: 'submitted',
                created_at: new Date().toISOString()
            };

            // Actualizar progreso a 'submitted' para los estudiantes del grupo
            db.all("SELECT id, full_name FROM students WHERE course_id = (SELECT course_id FROM assignments WHERE id = ?)", [assignmentId], (stErr, allStudents) => {
                if (!stErr && allStudents) {
                    const matchedStudents = allStudents.filter(s => {
                        return s.full_name === mainStudent || parsedStudentNames.includes(s.full_name);
                    });
                    matchedStudents.forEach(st => {
                        db.run(`INSERT INTO assignment_progress (assignment_id, student_id, client_id, client_name, status, updated_at)
                                VALUES (?, ?, ?, ?, 'submitted', datetime('now'))
                                ON CONFLICT(assignment_id, student_id) DO UPDATE SET
                                client_id = excluded.client_id,
                                client_name = excluded.client_name,
                                status = 'submitted',
                                updated_at = datetime('now')`,
                            [assignmentId, st.id, clientId, clientName]
                        );
                    });
                }
            });

            io.emit('new_submission', submissionItem);
            io.emit('new_turn_in', submissionItem);
            io.emit('assignment_progress_updated', { assignmentId, status: 'submitted' });
            res.json({ success: true, submission: submissionItem });
        }
    );
});

// Listar entregas de una tarea
app.get('/api/assignments/:id/submissions', (req, res) => {
    db.all("SELECT * FROM submissions WHERE assignment_id = ? ORDER BY created_at DESC", [req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const formatted = (rows || []).map(r => {
            try { r.student_names = JSON.parse(r.student_names); } catch(e) {}
            return r;
        });
        res.json(formatted);
    });
});

// Calificar entrega
app.post('/api/submissions/:id/grade', requireAuth(), (req, res) => {
    const { grade, feedback } = req.body;
    const submissionId = req.params.id;

    db.run("UPDATE submissions SET grade = ?, feedback = ?, status = 'graded' WHERE id = ?",
        [grade !== undefined ? String(grade).trim() : null, feedback || '', submissionId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });

            db.get("SELECT * FROM submissions WHERE id = ?", [submissionId], (sErr, sub) => {
                if (sub) {
                    io.emit('submission_graded', { submissionId, grade, feedback, assignmentId: sub.assignment_id });
                    db.run("UPDATE assignment_progress SET status = 'graded' WHERE assignment_id = ? AND student_id IN (SELECT id FROM students WHERE full_name = ?)",
                        [sub.assignment_id, sub.main_student_name]
                    );
                }
                res.json({ success: true, grade, feedback });
            });
        }
    );
});

// Devolver entrega para corregir
app.post('/api/submissions/:id/return', requireAuth(), (req, res) => {
    const { feedback } = req.body;
    const submissionId = req.params.id;

    db.run("UPDATE submissions SET feedback = ?, status = 'returned', return_count = COALESCE(return_count, 0) + 1 WHERE id = ?",
        [feedback || 'Por favor revisa y corrige las observaciones indicadas por el profesor.', submissionId],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });

            db.get("SELECT * FROM submissions WHERE id = ?", [submissionId], (sErr, sub) => {
                if (!sub) return res.status(404).json({ error: 'Entrega no encontrada' });

                // Actualizar status a 'returned' en assignment_progress
                db.run("UPDATE assignment_progress SET status = 'returned' WHERE assignment_id = ? AND student_id IN (SELECT id FROM students WHERE full_name = ?)",
                    [sub.assignment_id, sub.main_student_name]
                );

                const returnData = {
                    submissionId: sub.id,
                    assignmentId: sub.assignment_id,
                    clientId: sub.client_id,
                    clientName: sub.client_name,
                    mainStudentName: sub.main_student_name,
                    studentNames: sub.student_names,
                    appType: sub.app_type,
                    filename: sub.filename,
                    filePath: sub.file_path,
                    url: sub.file_path,
                    feedback: feedback || sub.feedback,
                    returnedAt: new Date().toISOString()
                };

                // Emitir por WebSocket a todas las estaciones
                io.emit('assignment_returned', returnData);
                io.emit('assignment_progress_updated', { assignmentId: sub.assignment_id, status: 'returned' });

                res.json({ success: true, submission: returnData });
            });
        }
    );
});

// Exportar libro de calificaciones y entregas a Excel (.xlsx)
app.get('/api/assignments/:id/export-grades', requireAuth(), (req, res) => {
    const assignId = req.params.id;
    db.get(`SELECT a.*, c.name as course_name, u.full_name as teacher_name 
            FROM assignments a 
            JOIN courses c ON a.course_id = c.id 
            JOIN users u ON a.user_id = u.id 
            WHERE a.id = ?`, [assignId], (aErr, assignment) => {
        if (aErr || !assignment) return res.status(404).json({ error: 'Tarea no encontrada' });

        db.all("SELECT id, full_name, identifier FROM students WHERE course_id = ? ORDER BY full_name ASC", [assignment.course_id], (sErr, students) => {
            if (sErr) return res.status(500).json({ error: sErr.message });

            db.all("SELECT * FROM submissions WHERE assignment_id = ? ORDER BY created_at ASC", [assignId], (subErr, submissions) => {
                if (subErr) return res.status(500).json({ error: subErr.message });

                const rows = (students || []).map((student, idx) => {
                    const sub = (submissions || []).find(s => {
                        if (s.main_student_name === student.full_name) return true;
                        try {
                            const names = JSON.parse(s.student_names);
                            if (Array.isArray(names) && names.includes(student.full_name)) return true;
                        } catch(e) {}
                        return false;
                    });

                    let estado = 'Sin Iniciar';
                    let fecha = '';
                    let nota = '';
                    let feedback = '';
                    let grupo = 'Individual';
                    let pc = '';
                    let archivo = '';

                    if (sub) {
                        pc = sub.client_name || '';
                        archivo = sub.filename || '';
                        fecha = sub.created_at || '';
                        nota = sub.grade || '';
                        feedback = sub.feedback || '';

                        if (sub.status === 'graded') estado = 'Calificado';
                        else if (sub.status === 'returned') estado = 'Devuelto para Corregir';
                        else estado = 'Entregado';

                        try {
                            const parsedNames = JSON.parse(sub.student_names);
                            if (Array.isArray(parsedNames) && parsedNames.length > 1) {
                                grupo = parsedNames.join(', ');
                            }
                        } catch(e) {}
                    }

                    return {
                        'N°': idx + 1,
                        'RUT / ID': student.identifier || '',
                        'Nombre del Estudiante': student.full_name,
                        'Curso': assignment.course_name,
                        'Estado': estado,
                        'Nota': nota,
                        'Retroalimentación': feedback,
                        'Fecha de Entrega': fecha,
                        'Grupo': grupo,
                        'Estación': pc,
                        'Archivo': archivo
                    };
                });

                const wb = xlsx.utils.book_new();
                const ws = xlsx.utils.json_to_sheet(rows);

                // Auto-ancho de columnas
                ws['!cols'] = [
                    { wch: 6 },  // N°
                    { wch: 15 }, // RUT
                    { wch: 32 }, // Nombre
                    { wch: 15 }, // Curso
                    { wch: 22 }, // Estado
                    { wch: 10 }, // Nota
                    { wch: 45 }, // Retroalimentación
                    { wch: 22 }, // Fecha
                    { wch: 35 }, // Grupo
                    { wch: 16 }, // Estación
                    { wch: 30 }  // Archivo
                ];

                xlsx.utils.book_append_sheet(wb, ws, "Calificaciones");
                const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

                const safeTitle = (assignment.title || 'Tarea').replace(/[^a-zA-Z0-9_\-]/g, '_');
                res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.set('Content-Disposition', `attachment; filename="Calificaciones_${safeTitle}.xlsx"`);
                res.send(buffer);
            });
        });
    });
});

// Descargar todas las entregas de una tarea comprimidas en ZIP
app.get('/api/assignments/:id/download-all', (req, res) => {
    const assignmentId = req.params.id;
    db.get("SELECT title FROM assignments WHERE id = ?", [assignmentId], (aErr, assignment) => {
        if (aErr || !assignment) return res.status(404).json({ error: 'Tarea no encontrada' });

        db.all("SELECT * FROM submissions WHERE assignment_id = ?", [assignmentId], (sErr, submissions) => {
            if (sErr) return res.status(500).json({ error: sErr.message });
            if (!submissions || submissions.length === 0) {
                return res.status(404).json({ error: 'No hay entregas para descargar' });
            }

            try {
                const zip = new AdmZip();
                submissions.forEach((sub) => {
                    const relativePath = sub.file_path.startsWith('/') ? sub.file_path.slice(1) : sub.file_path;
                    const fullDiskPath = path.join(__dirname, '..', 'public', relativePath);
                    if (fs.existsSync(fullDiskPath)) {
                        let namesStr = sub.main_student_name || 'Alumno';
                        try {
                            const parsed = JSON.parse(sub.student_names);
                            if (Array.isArray(parsed) && parsed.length > 0) {
                                namesStr = parsed.join('_y_');
                            }
                        } catch(e) {}

                        const cleanCourse = (sub.course_name || 'Curso').replace(/[^a-zA-Z0-9_\-]/g, '_');
                        const cleanNames = namesStr.replace(/[^a-zA-Z0-9_\-]/g, '_');
                        const cleanOrig = sub.filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
                        const entryName = `${cleanCourse}__${cleanNames}__${cleanOrig}`;
                        zip.addLocalFile(fullDiskPath, '', entryName);
                    }
                });

                const zipBuffer = zip.toBuffer();
                const safeTitle = assignment.title.replace(/[^a-zA-Z0-9_\-]/g, '_');
                res.set('Content-Type', 'application/zip');
                res.set('Content-Disposition', `attachment; filename="Entregas_${safeTitle}.zip"`);
                res.send(zipBuffer);
            } catch (zErr) {
                console.error('Error generando ZIP:', zErr);
                res.status(500).json({ error: 'Error generando archivo ZIP: ' + zErr.message });
            }
        });
    });
});

// Eliminar entrega individual
app.delete('/api/submissions/:id', (req, res) => {
    db.get("SELECT file_path FROM submissions WHERE id = ?", [req.params.id], (err, row) => {
        if (row && row.file_path) {
            const relativePath = row.file_path.startsWith('/') ? row.file_path.slice(1) : row.file_path;
            const fullDiskPath = path.join(__dirname, '..', 'public', relativePath);
            if (fs.existsSync(fullDiskPath)) fs.unlinkSync(fullDiskPath);
        }
        db.run("DELETE FROM submissions WHERE id = ?", [req.params.id], (delErr) => {
            if (delErr) return res.status(500).json({ error: delErr.message });
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
