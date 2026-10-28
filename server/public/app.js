// LabDesk Teacher Dashboard Client
const socket = io();

let currentClients = [];
let currentSectors = [];
let primarySectorId = localStorage.getItem('labdesk_primary_sector') || 'all';
let activeSectorId = primarySectorId;
let currentActiveRdpClientId = null;
let draggedSectorId = null;

// Variables de sesión y tareas
let authToken = localStorage.getItem('labdesk_token') || null;
let currentUser = null;
let currentFolders = [];
let currentAssignments = [];
let selectedFolderId = null;
let viewingAssignmentId = null;
let currentCourses = [];

// ==========================================
// INICIALIZACIÓN
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    checkAuthStatus();
    setupSocketListeners();
    setupEventListeners();
    fetchSectors();
    fetchClients();
    fetchTurnIns();

    if (window.location.hash === '#tareas') {
        setTimeout(() => openAssignmentsModal(), 400);
    }
});

// ==========================================
// SOCKET.IO LISTENERS
// ==========================================
function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('✅ Conectado al servidor LabDesk');
    });

    socket.on('clients_updated', () => {
        fetchClients();
        fetchSectors();
    });

    socket.on('sectors_updated', () => {
        fetchSectors();
    });

    socket.on('screenshot_update', ({ clientId, image }) => {
        updateCardScreenshot(clientId, image);
        if (currentActiveRdpClientId === clientId && image && image !== 'PAUSED') {
            const rdpImg = document.getElementById('rdp-screen-img');
            if (rdpImg) rdpImg.src = `data:image/jpeg;base64,${image}`;
        }
    });

    socket.on('new_turn_in', (item) => {
        showNotification(`📥 Nueva entrega: ${item.student_name || item.main_student_name} (${item.filename})`);
        fetchTurnIns();
    });

    socket.on('new_submission', (sub) => {
        showNotification(`📥 Nueva entrega: ${sub.main_student_name || 'Estudiante'} (${sub.filename})`);
        fetchTurnIns();
        if (document.getElementById('modal-submissions').classList.contains('show')) {
            refreshCurrentSubmissions();
        }
        if (currentMatrixAssignmentId && document.getElementById('modal-progress-matrix').classList.contains('show')) {
            refreshProgressMatrix();
        }
    });

    socket.on('assignment_progress_updated', () => {
        if (currentMatrixAssignmentId && document.getElementById('modal-progress-matrix').classList.contains('show')) {
            refreshProgressMatrix();
        }
    });

    socket.on('submission_graded', () => {
        if (viewingAssignmentId && document.getElementById('modal-submissions').classList.contains('show')) {
            refreshCurrentSubmissions();
        }
        if (currentMatrixAssignmentId && document.getElementById('modal-progress-matrix').classList.contains('show')) {
            refreshProgressMatrix();
        }
    });

    socket.on('active_assignment_updated', () => {
        if (document.getElementById('modal-assignments').classList.contains('show')) {
            fetchAssignments();
        }
        if (currentMatrixAssignmentId && document.getElementById('modal-progress-matrix').classList.contains('show')) {
            refreshProgressMatrix();
        }
    });

    socket.on('script_result_dashboard', ({ clientId, output, error }) => {
        const outBox = document.getElementById('script-output');
        const outText = document.getElementById('script-output-text');
        if (outBox && outText) {
            outBox.style.display = 'block';
            outText.textContent = `[${clientId}] Salida:\n${output || ''}\n${error ? 'ERROR: ' + error : ''}`;
        }
    });
}

// ==========================================
// EVENT LISTENERS DEL DOM
// ==========================================
function setupEventListeners() {
    // Bloqueo Global
    document.getElementById('btn-lock-all').onclick = () => sendGlobalCommand('lock');
    document.getElementById('btn-unlock-all').onclick = () => sendGlobalCommand('unlock');

    // Audio Global
    document.getElementById('btn-mute-all').onclick = () => sendGlobalCommand('volume_mute');
    document.getElementById('btn-unmute-all').onclick = () => sendGlobalCommand('volume_unmute');

    // Modales
    document.getElementById('btn-open-tabs-modal').onclick = () => { openModal('modal-browser'); loadAdminPresets(); };
    document.getElementById('btn-turn-ins-modal').onclick = () => { openModal('modal-turn-ins'); fetchTurnIns(); };
    document.getElementById('btn-scripts-modal').onclick = () => { openModal('modal-scripts'); fetchScripts(); };
    document.getElementById('btn-power-modal').onclick = () => openModal('modal-power');
    document.getElementById('btn-settings-modal').onclick = () => { openModal('modal-settings'); fetchSettings(); };
    
    // Tareas y Roster Escolar
    const btnAssignments = document.getElementById('btn-assignments-modal');
    if (btnAssignments) btnAssignments.onclick = () => openAssignmentsModal();
    const btnRoster = document.getElementById('btn-roster-modal');
    if (btnRoster) btnRoster.onclick = () => openRosterModal();

    // Editor de Scripts Bash
    const btnNewScript = document.getElementById('btn-new-script');
    if (btnNewScript) btnNewScript.onclick = () => openScriptEditor();
    const btnSaveScript = document.getElementById('btn-save-script');
    if (btnSaveScript) btnSaveScript.onclick = saveScriptFromEditor;

    // Envío de Pestaña / URL
    document.getElementById('btn-send-url').onclick = sendBrowserUrl;

    // Búsqueda y Filtro
    document.getElementById('client-search').oninput = (e) => {
        const query = e.target.value.toLowerCase();
        renderClients(currentClients.filter(c => (c.name || '').toLowerCase().includes(query) || (c.ip_address || '').includes(query)));
    };

    document.getElementById('btn-refresh-grid').onclick = () => {
        fetchClients();
        fetchSectors();
    };

    // Guardar Ajustes
    document.getElementById('btn-save-settings').onclick = saveSettings;

    // Crear Sector (Aula)
    document.getElementById('btn-add-sector').onclick = createSectorPrompt;

    // Limpiar duplicados o desconectados
    const btnCleanup = document.getElementById('btn-cleanup-duplicates');
    if (btnCleanup) btnCleanup.onclick = cleanupDuplicatesPrompt;
}

// ==========================================
// FETCH Y RENDER DE CLIENTES
// ==========================================
async function fetchClients() {
    try {
        const res = await fetch('/api/clients');
        currentClients = await res.json();
        
        // Filtrar por sector activo si corresponde
        let filtered = currentClients;
        if (activeSectorId !== 'all') {
            filtered = currentClients.filter(c => c.sector_id === Number(activeSectorId));
        }

        renderClients(filtered);
        updateStats();
        updateHeaderPrimaryBadge();
    } catch (e) {
        console.error('Error cargando clientes:', e);
    }
}

function renderClients(clients) {
    const grid = document.getElementById('clients-grid');
    grid.innerHTML = '';

    if (clients.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-muted);">
                <h3>No hay estaciones conectadas en este sector</h3>
                <p>Las estaciones de estudiantes con LabDesk aparecerán aquí automáticamente.</p>
                <div style="margin-top: 1rem;">
                    <button class="btn btn-secondary btn-sm" onclick="selectSector('all')">Ver Todos los Equipos</button>
                </div>
            </div>
        `;
        return;
    }

    clients.forEach(client => {
        const isOnline = client.status === 'online';
        const isLocked = client.is_locked === 1;
        const isMuted = client.is_muted === 1;

        const card = document.createElement('div');
        card.className = `client-card ${isLocked ? 'locked' : ''}`;
        card.id = `card-${client.id}`;

        // Opciones del selector de aula para este cliente
        const sectorOptions = [
            `<option value="" ${!client.sector_id ? 'selected' : ''}>📁 Sin Aula (General)</option>`,
            ...currentSectors.map(s => `
                <option value="${s.id}" ${client.sector_id == s.id ? 'selected' : ''}>
                    ${s.icon || '🏫'} ${escapeHtml(s.name)}
                </option>
            `)
        ].join('');

        card.innerHTML = `
            <div class="client-card-header">
                <div class="client-title">
                    <span class="status-dot ${isOnline ? 'online' : 'offline'}"></span>
                    <span class="client-name" title="Doble clic para renombrar" ondblclick="renameClient('${client.id}', '${escapeHtml(client.name)}')">${escapeHtml(client.name)}</span>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                    <span class="client-status-badge">${isOnline ? (isLocked ? '🔒 Bloqueado' : 'Activo') : 'Desconectado'}</span>
                    <button class="btn-card-delete" title="Eliminar este equipo de la lista" onclick="deleteClientPrompt('${client.id}', '${escapeHtml(client.name)}')">✕</button>
                </div>
            </div>

            <div class="client-screen-wrap" onclick="openRdp('${client.id}', '${escapeHtml(client.name)}')">
                <img id="screen-${client.id}" class="client-screen-img" src="/api/clients/${client.id}/screenshot" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                <div class="client-screen-placeholder" style="display:none;">
                    <span>🖥️ Sin Captura</span>
                </div>
                ${isLocked ? '<div class="screen-lock-overlay">🔒 Pantalla Bloqueada</div>' : ''}
            </div>

            <div class="client-card-body">
                <div class="client-info-row">
                    <span>IP: ${client.ip_address || '127.0.0.1'}</span>
                    <span>${client.active_tab ? '🌐 ' + escapeHtml(client.active_tab.substring(0, 16)) : 'Escritorio'}</span>
                </div>

                <!-- Selector de Aula / Sector -->
                <div class="client-sector-row">
                    <span class="sector-label">Aula:</span>
                    <select class="client-sector-select" onchange="assignClientToSector('${client.id}', this.value)" title="Asignar este puesto a un Aula">
                        ${sectorOptions}
                    </select>
                </div>

                <div class="audio-slider-row">
                    <button class="btn btn-sm btn-secondary" onclick="toggleMuteClient('${client.id}', ${isMuted})">${isMuted ? '🔇' : '🔊'}</button>
                    <input type="range" class="audio-slider" min="0" max="100" value="${client.volume || 50}" onchange="setClientVolume('${client.id}', this.value)">
                    <span style="font-size:0.75rem; width:28px;">${client.volume || 50}%</span>
                </div>
            </div>

            <div class="client-card-actions">
                <button class="btn btn-sm ${isLocked ? 'btn-success' : 'btn-warning'}" onclick="toggleLockClient('${client.id}', ${isLocked})">
                    ${isLocked ? '🔓 Abrir' : '🔒 Trabar'}
                </button>
                <button class="btn btn-sm btn-secondary" onclick="openRdp('${client.id}', '${escapeHtml(client.name)}')">
                    🖥️ Control
                </button>
                <button class="btn btn-sm btn-secondary" onclick="openSingleTabPrompt('${client.id}')">
                    🌐 Pestaña
                </button>
                <button class="btn btn-sm btn-secondary" onclick="openSingleScriptPrompt('${client.id}')" title="Ejecutar script en este equipo">
                    📜 Script
                </button>
            </div>
        `;

        grid.appendChild(card);
    });
}

function updateCardScreenshot(clientId, imageBase64) {
    const img = document.getElementById(`screen-${clientId}`);
    if (img) {
        img.src = `data:image/jpeg;base64,${imageBase64}`;
        img.style.display = 'block';
        if (img.nextElementSibling) img.nextElementSibling.style.display = 'none';
    }
}

function updateStats() {
    const total = currentClients.length;
    const online = currentClients.filter(c => c.status === 'online').length;
    let sectorText = '';
    if (activeSectorId !== 'all') {
        const sec = currentSectors.find(s => s.id == activeSectorId);
        if (sec) {
            sectorText = ` en ${sec.name}`;
        }
    }
    document.getElementById('sector-stats').textContent = `${online} de ${total} equipos activos${sectorText}`;
}

function updateHeaderPrimaryBadge() {
    const badge = document.getElementById('primary-aula-badge');
    if (!badge) return;
    if (String(activeSectorId) === String(primarySectorId)) {
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

// ==========================================
// SECTORES (AULAS)
// ==========================================
async function fetchSectors() {
    try {
        const res = await fetch('/api/sectors');
        currentSectors = await res.json();
        renderSectorTabs();
        updateHeaderPrimaryBadge();
    } catch(e) {}
}

function renderSectorTabs() {
    const container = document.getElementById('sector-tabs');
    if (!container) return;
    container.innerHTML = '';

    const isPrimaryAll = String(primarySectorId) === 'all';
    const totalOnline = currentClients.filter(c => c.status === 'online').length;
    const totalClients = currentClients.length;

    // Pestaña "Todos los Equipos"
    const allTab = document.createElement('div');
    allTab.className = `sector-tab-wrapper ${activeSectorId === 'all' ? 'active' : ''} ${isPrimaryAll ? 'primary' : ''}`;
    allTab.innerHTML = `
        <button class="sector-tab-btn" onclick="selectSector('all')">
            ${isPrimaryAll ? '<span class="tab-star-icon" title="Pantalla Principal del Navegador">⭐</span>' : ''}
            <span class="tab-icon">🖥️</span>
            <span class="tab-name">Todos los Equipos</span>
            <span class="tab-count-badge">${totalOnline}/${totalClients}</span>
        </button>
        <div class="sector-tab-actions">
            <button class="tab-action-btn ${isPrimaryAll ? 'active-star' : ''}" title="${isPrimaryAll ? 'Esta es la pantalla principal' : 'Dejar como pantalla principal en este navegador'}" onclick="setPrimarySector('all')">⭐</button>
        </div>
    `;
    container.appendChild(allTab);

    // Pestañas dinámicas de cada Aula
    currentSectors.forEach((sec, idx) => {
        const isPrimary = String(primarySectorId) === String(sec.id);
        const isActive = String(activeSectorId) === String(sec.id);
        const tab = document.createElement('div');
        tab.className = `sector-tab-wrapper ${isActive ? 'active' : ''} ${isPrimary ? 'primary' : ''}`;
        tab.setAttribute('draggable', 'true');
        tab.dataset.sectorId = sec.id;

        tab.innerHTML = `
            <button class="sector-tab-btn" onclick="selectSector('${sec.id}')">
                ${isPrimary ? '<span class="tab-star-icon" title="Pantalla Principal del Navegador">⭐</span>' : ''}
                <span class="tab-icon">${sec.icon || '🏫'}</span>
                <span class="tab-name">${escapeHtml(sec.name)}</span>
                <span class="tab-count-badge">${sec.online_count || 0}/${sec.client_count || 0}</span>
            </button>
            <div class="sector-tab-actions">
                <button class="tab-action-btn" title="Mover pestaña a la izquierda" onclick="moveSector(${sec.id}, -1)">◀</button>
                <button class="tab-action-btn" title="Mover pestaña a la derecha" onclick="moveSector(${sec.id}, 1)">▶</button>
                <button class="tab-action-btn ${isPrimary ? 'active-star' : ''}" title="${isPrimary ? 'Esta es la pantalla principal de este navegador' : 'Dejar como pantalla principal en este navegador'}" onclick="setPrimarySector('${sec.id}')">⭐</button>
                <button class="tab-action-btn" title="Renombrar Aula" onclick="renameSector(${sec.id}, '${escapeHtml(sec.name)}')">✏️</button>
                <button class="tab-action-btn tab-delete" title="Eliminar Aula" onclick="deleteSector(${sec.id}, '${escapeHtml(sec.name)}')">✕</button>
            </div>
        `;

        // Eventos Drag and Drop para mover pestañas
        tab.ondragstart = (e) => {
            draggedSectorId = sec.id;
            tab.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        };
        tab.ondragend = () => {
            draggedSectorId = null;
            tab.classList.remove('dragging');
            document.querySelectorAll('.sector-tab-wrapper').forEach(w => w.classList.remove('drag-over'));
        };
        tab.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            tab.classList.add('drag-over');
        };
        tab.ondragleave = () => {
            tab.classList.remove('drag-over');
        };
        tab.ondrop = (e) => {
            e.preventDefault();
            tab.classList.remove('drag-over');
            if (draggedSectorId && draggedSectorId !== sec.id) {
                reorderDrop(draggedSectorId, sec.id);
            }
        };

        container.appendChild(tab);
    });
}

function selectSector(sectorId) {
    activeSectorId = sectorId;
    renderSectorTabs();
    const title = sectorId === 'all' ? 'Monitor de Sala' : (currentSectors.find(s => s.id == sectorId)?.name || 'Aula');
    document.getElementById('active-sector-title').textContent = title;
    updateHeaderPrimaryBadge();
    fetchClients();
}

// Establecer un Aula como Pantalla Principal de este Navegador
async function setPrimarySector(sectorId) {
    primarySectorId = sectorId;
    localStorage.setItem('labdesk_primary_sector', sectorId);
    
    // Guardar en la base de datos también para persistencia
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ default_sector_id: sectorId })
        });
    } catch(e) {}

    renderSectorTabs();
    updateHeaderPrimaryBadge();

    const name = sectorId === 'all' ? 'Todos los Equipos' : (currentSectors.find(s => s.id == sectorId)?.name || 'Aula');
    showNotification(`⭐ "${name}" establecida como pantalla principal de este navegador.`);
}

// Mover pestaña de Aula (Reordenar con flechas ◀ ▶)
async function moveSector(sectorId, direction) {
    const idx = currentSectors.findIndex(s => s.id == sectorId);
    if (idx === -1) return;

    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= currentSectors.length) return;

    // Intercambiar posiciones
    const temp = currentSectors[idx];
    currentSectors[idx] = currentSectors[targetIdx];
    currentSectors[targetIdx] = temp;

    const order = currentSectors.map(s => s.id);
    await saveSectorsOrder(order);
}

// Reordenar mediante Drag and Drop
async function reorderDrop(sourceId, targetId) {
    const fromIdx = currentSectors.findIndex(s => s.id == sourceId);
    const toIdx = currentSectors.findIndex(s => s.id == targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const [moved] = currentSectors.splice(fromIdx, 1);
    currentSectors.splice(toIdx, 0, moved);

    const order = currentSectors.map(s => s.id);
    await saveSectorsOrder(order);
}

async function saveSectorsOrder(order) {
    renderSectorTabs();
    try {
        await fetch('/api/sectors/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order })
        });
    } catch(e) {
        console.error('Error guardando orden de aulas:', e);
    }
}

async function createSectorPrompt() {
    const name = prompt('Nombre de la nueva Aula / Sector (ej. Aula 1, Laboratorio Ciencias):');
    if (!name || !name.trim()) return;
    await fetch('/api/sectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), icon: '🏫' })
    });
    fetchSectors();
    showNotification(`🏫 Aula "${name}" creada.`);
}

async function renameSector(sectorId, oldName) {
    const name = prompt('Nuevo nombre para el aula:', oldName);
    if (!name || name === oldName || !name.trim()) return;
    await fetch(`/api/sectors/${sectorId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
    });
    fetchSectors();
    showNotification(`Aula renombrada a "${name}".`);
}

async function deleteSector(sectorId, name) {
    if (!confirm(`¿Eliminar el aula "${name}"?\n\nLos equipos asignados no se borrarán, quedarán en "Sin Aula (General)".`)) return;
    await fetch(`/api/sectors/${sectorId}`, { method: 'DELETE' });
    if (String(activeSectorId) === String(sectorId)) {
        activeSectorId = 'all';
    }
    if (String(primarySectorId) === String(sectorId)) {
        primarySectorId = 'all';
        localStorage.setItem('labdesk_primary_sector', 'all');
    }
    fetchSectors();
    fetchClients();
    showNotification(`🗑️ Aula "${name}" eliminada.`);
}

// Asignar un equipo a un Aula específica
async function assignClientToSector(clientId, sectorId) {
    await fetch(`/api/clients/${clientId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sector_id: sectorId ? Number(sectorId) : null })
    });
    fetchClients();
    fetchSectors();
    showNotification(`✅ Equipo asignado al aula seleccionada.`);
}

// Eliminar un equipo (desvincular del panel)
async function deleteClientPrompt(clientId, clientName) {
    if (confirm(`¿Estás seguro de eliminar el equipo "${clientName}" del panel de control?\n\nSi el equipo vuelve a conectarse, se registrará de nuevo.`)) {
        await fetch(`/api/clients/${clientId}`, { method: 'DELETE' });
        fetchClients();
        fetchSectors();
        showNotification(`🗑️ Equipo "${clientName}" eliminado del panel.`);
    }
}

// Limpiar equipos duplicados o desconectados
async function cleanupDuplicatesPrompt() {
    const offlineCount = currentClients.filter(c => c.status === 'offline').length;
    if (offlineCount === 0) {
        // Ejecutar limpieza de duplicados en segundo plano
        const res = await fetch('/api/clients/cleanup-duplicates', { method: 'POST' });
        const data = await res.json();
        fetchClients();
        fetchSectors();
        if (data.removed > 0) {
            showNotification(`🧹 Se eliminaron ${data.removed} registro(s) duplicados.`);
        } else {
            alert('Todos los equipos están en línea y no se encontraron registros duplicados.');
        }
        return;
    }

    if (confirm(`Hay ${offlineCount} equipo(s) desconectado(s) o duplicados.\n\n¿Deseas eliminarlos para mantener la lista limpia?`)) {
        const res = await fetch('/api/clients/offline/all', { method: 'DELETE' });
        const data = await res.json();
        fetchClients();
        fetchSectors();
        showNotification(`🧹 Se limpiaron ${data.removed || offlineCount} puestos desconectados.`);
    }
}

// ==========================================
// COMANDOS DE CLIENTES
// ==========================================
async function sendCommand(clientId, command, payload = null) {
    await fetch(`/api/clients/${clientId}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, payload })
    });
}

async function sendGlobalCommand(command, payload = null) {
    await fetch('/api/clients/command/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, payload, sector_id: activeSectorId === 'all' ? null : activeSectorId })
    });
}

function toggleLockClient(id, isCurrentlyLocked) {
    sendCommand(id, isCurrentlyLocked ? 'unlock' : 'lock');
}

function setClientVolume(id, volume) {
    sendCommand(id, 'volume_set', { volume: parseInt(volume, 10) });
}

function toggleMuteClient(id, isMuted) {
    sendCommand(id, isMuted ? 'volume_unmute' : 'volume_mute');
}

async function renameClient(id, oldName) {
    const name = prompt('Nuevo nombre para este equipo:', oldName);
    if (!name || name === oldName || !name.trim()) return;
    await fetch(`/api/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
    });
    fetchClients();
}

// ==========================================
// NAVEGACIÓN, PÁGINA CAUTIVA Y ACCESOS DIRECTOS
// ==========================================
const DEFAULT_PRESETS = [
    { name: 'Google Classroom', url: 'https://classroom.google.com', icon: '🎓' },
    { name: 'Google Docs', url: 'https://docs.google.com/document/create', icon: '📄' },
    { name: 'Google Sheets', url: 'https://sheets.google.com/create', icon: '📊' },
    { name: 'Google Slides', url: 'https://slides.google.com/create', icon: '📽️' },
    { name: 'Wikipedia', url: 'https://es.wikipedia.org', icon: '📚' },
    { name: 'Scratch', url: 'https://scratch.mit.edu', icon: '🐱' },
    { name: 'Geogebra', url: 'https://www.geogebra.org/calculator', icon: '📐' },
    { name: 'Formulario / Examen', url: 'https://docs.google.com/forms', icon: '📝' }
];
let adminPresets = [...DEFAULT_PRESETS];

async function loadAdminPresets() {
    try {
        const res = await fetch('/api/settings');
        const settings = await res.json();
        if (settings.custom_browser_presets) {
            adminPresets = JSON.parse(settings.custom_browser_presets);
        }
    } catch(e) {}
    renderAdminPresets();
}

function renderAdminPresets() {
    const grid = document.getElementById('admin-presets-grid');
    const list = document.getElementById('admin-preset-items-list');
    if (!grid) return;

    grid.innerHTML = '';
    if (list) list.innerHTML = '';

    adminPresets.forEach((p, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quick-btn';
        btn.innerHTML = `${p.icon || '🌐'} ${escapeHtml(p.name)}`;
        btn.onclick = () => setQuickUrl(p.url);
        grid.appendChild(btn);

        if (list) {
            const row = document.createElement('div');
            row.className = 'preset-item-row';
            row.innerHTML = `
                <div class="preset-item-info">
                    <span>${p.icon || '🌐'} ${escapeHtml(p.name)}</span>
                    <small>(${escapeHtml(p.url.substring(0, 32))}...)</small>
                </div>
                <button type="button" class="btn-del-preset" title="Eliminar este acceso" onclick="deleteAdminPreset(${idx})">✕</button>
            `;
            list.appendChild(row);
        }
    });
}

function toggleAdminPresetEditor() {
    const panel = document.getElementById('admin-preset-editor-panel');
    if (!panel) return;
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

async function addAdminPreset() {
    const icon = document.getElementById('admin-new-preset-icon').value.trim() || '🌐';
    const name = document.getElementById('admin-new-preset-name').value.trim();
    let url = document.getElementById('admin-new-preset-url').value.trim();

    if (!name || !url) return alert('Por favor ingresa un nombre y una dirección URL.');
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    adminPresets.push({ name, url, icon });
    await saveAdminPresets();

    document.getElementById('admin-new-preset-name').value = '';
    document.getElementById('admin-new-preset-url').value = '';
}

async function deleteAdminPreset(idx) {
    adminPresets.splice(idx, 1);
    await saveAdminPresets();
}

async function resetAdminPresets() {
    if (!confirm('¿Restablecer los accesos directos predeterminados?')) return;
    adminPresets = [...DEFAULT_PRESETS];
    await saveAdminPresets();
}

async function saveAdminPresets() {
    renderAdminPresets();
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ custom_browser_presets: JSON.stringify(adminPresets) })
        });
        showNotification('✅ Accesos directos actualizados.');
    } catch(e) {
        console.error('Error guardando accesos directos:', e);
    }
}

function setQuickUrl(url) {
    document.getElementById('browser-url-input').value = url;
}

async function sendBrowserUrl() {
    let url = document.getElementById('browser-url-input').value.trim();
    if (!url) return alert('Por favor ingresa o selecciona una URL.');
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    const isKiosk = document.getElementById('kiosk-exam-mode').checked;
    const target = document.getElementById('browser-target-select').value;

    const payload = { url, isKiosk };

    if (target === 'all') {
        await sendGlobalCommand('browser_open_url', payload);
    } else {
        const clientsToTarget = activeSectorId === 'all' ? currentClients : currentClients.filter(c => c.sector_id == activeSectorId);
        for (const c of clientsToTarget) {
            await sendCommand(c.id, 'browser_open_url', payload);
        }
    }

    closeModal('modal-browser');
    showNotification(isKiosk ? `🔒 Página Cautiva (Modo Examen) enviada: ${url}` : `🚀 Enlace abierto en estaciones: ${url}`);
}

async function releaseKioskMode() {
    const target = document.getElementById('browser-target-select').value;
    const payload = { enabled: false };

    if (target === 'all') {
        await sendGlobalCommand('browser_kiosk_mode', payload);
    } else {
        const clientsToTarget = activeSectorId === 'all' ? currentClients : currentClients.filter(c => c.sector_id == activeSectorId);
        for (const c of clientsToTarget) {
            await sendCommand(c.id, 'browser_kiosk_mode', payload);
        }
    }

    closeModal('modal-browser');
    showNotification('🔓 Modo examen / Página Cautiva liberado en las estaciones.');
}

function openSingleTabPrompt(clientId) {
    const url = prompt('Ingresa la URL a abrir en este equipo:');
    if (!url || !url.trim()) return;
    const fullUrl = url.startsWith('http') ? url.trim() : 'https://' + url.trim();
    sendCommand(clientId, 'browser_open_url', { url: fullUrl });
}

// ==========================================
// BUZÓN DE TAREAS ENTREGADAS
// ==========================================
async function fetchTurnIns() {
    try {
        const res = await fetch('/api/turn-ins');
        const items = await res.json();
        
        document.getElementById('turn-in-count').textContent = items.length;
        const tbody = document.getElementById('turn-ins-tbody');
        tbody.innerHTML = '';

        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center">No hay tareas entregadas todavía.</td></tr>`;
            return;
        }

        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                <td><strong>${escapeHtml(item.student_name || 'Estudiante')}</strong></td>
                <td>${escapeHtml(item.client_name)}</td>
                <td><span class="badge">${escapeHtml(item.app_type)}</span></td>
                <td>${escapeHtml(item.filename)}</td>
                <td>
                    <a href="${item.file_path}" download="${item.filename}" class="btn btn-sm btn-primary">⬇️ Descargar</a>
                    <button class="btn btn-sm btn-danger" onclick="deleteTurnIn(${item.id})">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch(e) {}
}

async function deleteTurnIn(id) {
    if (!confirm('¿Eliminar esta entrega?')) return;
    await fetch(`/api/turn-ins/${id}`, { method: 'DELETE' });
    fetchTurnIns();
}

// ==========================================
// SCRIPTS BASH
// ==========================================
function openSingleScriptPrompt(clientId) {
    openModal('modal-scripts');
    fetchScripts(clientId);
}

async function fetchScripts(targetClientId = null) {
    try {
        // Actualizar selector de destino de ejecución
        const targetSelect = document.getElementById('scripts-target-select');
        if (targetSelect) {
            const currentVal = targetClientId || targetSelect.value || 'all';
            targetSelect.innerHTML = `<option value="all">🌐 Todos los equipos del sector</option>`;
            
            const relevantClients = (activeSectorId === 'all')
                ? currentClients 
                : currentClients.filter(c => String(c.sector_id) === String(activeSectorId));

            relevantClients.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = `${c.status === 'online' ? '🟢' : '⚪'} ${c.name} (${c.ip_address || 'Sin IP'})`;
                targetSelect.appendChild(opt);
            });

            if (targetClientId && targetSelect.querySelector(`option[value="${targetClientId}"]`)) {
                targetSelect.value = targetClientId;
            } else if (targetSelect.querySelector(`option[value="${currentVal}"]`)) {
                targetSelect.value = currentVal;
            } else {
                targetSelect.value = 'all';
            }
        }

        const res = await fetch('/api/scripts');
        const scripts = await res.json();
        const container = document.getElementById('scripts-container');
        container.innerHTML = '';

        if (!scripts || scripts.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem; padding:15px; grid-column:1/-1;">No hay scripts configurados. Haz clic en <strong>"+ Crear Script"</strong> para agregar uno.</p>';
            return;
        }

        scripts.forEach(s => {
            const card = document.createElement('div');
            card.className = 'script-card';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem;">
                    <div>
                        <h4 style="display:flex; align-items:center; gap:0.4rem; font-size:0.95rem; margin:0;">
                            <span style="font-size:1.2rem;">${s.icon || '📜'}</span>
                            <span>${escapeHtml(s.name)}</span>
                        </h4>
                        <p style="font-size:0.75rem; color:var(--text-muted); margin-top:5px; line-height:1.35;">${escapeHtml(s.description || 'Sin descripción')}</p>
                    </div>
                    <div style="display:flex; gap:0.25rem;">
                        <button class="btn btn-sm btn-secondary btn-edit-script" title="Editar script" style="padding:2px 7px; font-size:0.75rem;">✏️</button>
                        <button class="btn btn-sm btn-danger btn-del-script" title="Eliminar script" style="padding:2px 7px; font-size:0.75rem;">🗑️</button>
                    </div>
                </div>
                <div style="margin-top:12px; display:flex; gap:0.4rem; flex-wrap:wrap; align-items:center;">
                    <button class="btn btn-sm btn-primary btn-run-now" style="flex:1;">▶️ Ejecutar</button>
                    <button class="btn btn-sm btn-secondary btn-view-code" title="Ver código fuente">👁️ Código</button>
                </div>
            `;

            card.querySelector('.btn-run-now').onclick = () => runScriptNow(s.content, s.name);
            card.querySelector('.btn-view-code').onclick = () => viewScriptCode(s);
            card.querySelector('.btn-edit-script').onclick = () => openScriptEditor(s);
            card.querySelector('.btn-del-script').onclick = () => deleteScript(s.id, s.name);

            container.appendChild(card);
        });
    } catch(e) {
        console.error('Error al obtener scripts:', e);
    }
}

function viewScriptCode(script) {
    const outBox = document.getElementById('script-output');
    const outText = document.getElementById('script-output-text');
    outBox.style.display = 'block';
    outText.textContent = `=== [Código del Script: ${script.name}] ===\n\n${script.content}`;
    outBox.scrollIntoView({ behavior: 'smooth' });
}

function openScriptEditor(script = null) {
    const title = document.getElementById('script-editor-title');
    const idInput = document.getElementById('script-edit-id');
    const iconInput = document.getElementById('script-edit-icon');
    const nameInput = document.getElementById('script-edit-name');
    const descInput = document.getElementById('script-edit-desc');
    const contentInput = document.getElementById('script-edit-content');

    if (script) {
        title.textContent = `✏️ Editar Script: ${script.name}`;
        idInput.value = script.id;
        iconInput.value = script.icon || '📜';
        nameInput.value = script.name;
        descInput.value = script.description || '';
        contentInput.value = script.content;
    } else {
        title.textContent = '✨ Nuevo Script Linux (Bash)';
        idInput.value = '';
        iconInput.value = '📜';
        nameInput.value = '';
        descInput.value = '';
        contentInput.value = '#!/bin/bash\n\n# Escribe aquí tus comandos Linux\necho "Ejecutando script..."\n';
    }

    openModal('modal-script-editor');
    if (!script) {
        setTimeout(() => nameInput.focus(), 100);
    }
}

async function saveScriptFromEditor() {
    const id = document.getElementById('script-edit-id').value;
    const icon = document.getElementById('script-edit-icon').value.trim() || '📜';
    const name = document.getElementById('script-edit-name').value.trim();
    const description = document.getElementById('script-edit-desc').value.trim();
    const content = document.getElementById('script-edit-content').value.trim();

    if (!name) {
        alert('Por favor, ingresa un nombre para el script.');
        document.getElementById('script-edit-name').focus();
        return;
    }
    if (!content) {
        alert('Por favor, ingresa el código Bash para el script.');
        document.getElementById('script-edit-content').focus();
        return;
    }

    const payload = {
        name,
        description,
        content,
        icon,
        is_shortcut: 1
    };

    try {
        let res;
        if (id) {
            res = await fetch(`/api/scripts/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            res = await fetch('/api/scripts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }

        const data = await res.json();
        if (res.ok && data.success) {
            closeModal('modal-script-editor');
            showNotification(id ? `Script "${name}" actualizado con éxito.` : `Script "${name}" creado con éxito.`);
            await fetchScripts();
        } else {
            alert('Error al guardar el script: ' + (data.error || 'Error desconocido'));
        }
    } catch (err) {
        alert('Error de conexión al guardar el script: ' + err.message);
    }
}

async function deleteScript(id, name) {
    if (!confirm(`¿Estás seguro de que deseas eliminar el script "${name}"?\n\nEsta acción eliminará el script permanentemente.`)) {
        return;
    }

    try {
        const res = await fetch(`/api/scripts/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok && data.success) {
            showNotification(`Script "${name}" eliminado.`);
            await fetchScripts();
        } else {
            alert('Error al eliminar script: ' + (data.error || 'Error desconocido'));
        }
    } catch(err) {
        alert('Error de conexión al eliminar: ' + err.message);
    }
}

async function runScriptNow(content, scriptName) {
    const targetSelect = document.getElementById('scripts-target-select');
    const targetId = targetSelect ? targetSelect.value : 'all';
    const targetName = targetSelect ? targetSelect.options[targetSelect.selectedIndex]?.text : 'Todos los equipos';

    const outBox = document.getElementById('script-output');
    const outText = document.getElementById('script-output-text');
    outBox.style.display = 'block';
    outText.textContent = `[${new Date().toLocaleTimeString()}] Enviando orden de ejecución "${scriptName || 'Bash'}" a: ${targetName}...\nEsperando respuesta...\n`;
    outBox.scrollIntoView({ behavior: 'smooth' });

    if (targetId === 'all') {
        await sendGlobalCommand('run_script', content);
    } else {
        await sendCommand(targetId, 'run_script', content);
    }
}

// ==========================================
// ENERGÍA
// ==========================================
async function sendPowerAction(action) {
    if (action === 'shutdown' && !confirm('¿Estás seguro de apagar todos los equipos de este sector?')) return;
    if (action === 'reboot' && !confirm('¿Estás seguro de reiniciar todos los equipos de este sector?')) return;
    await sendGlobalCommand(action);
    closeModal('modal-power');
    showNotification(`Comando ${action} enviado.`);
}

// ==========================================
// RDP (CONTROL REMOTO)
// ==========================================
function openRdp(clientId, clientName) {
    currentActiveRdpClientId = clientId;
    document.getElementById('rdp-title').textContent = `🖥️ Control Remoto: ${clientName}`;
    const rdpImg = document.getElementById('rdp-screen-img');
    rdpImg.src = `/api/clients/${clientId}/screenshot?t=${Date.now()}`;
    
    // Configurar listeners de ratón en el lienzo
    rdpImg.onclick = (e) => {
        const rect = rdpImg.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        socket.emit('rdp_input', { clientId, type: 'click', button: 'left', x, y });
    };

    openModal('modal-rdp');
}

function closeRdp() {
    currentActiveRdpClientId = null;
    closeModal('modal-rdp');
}

// ==========================================
// AJUSTES
// ==========================================
async function fetchSettings() {
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        document.getElementById('setting-pin').value = data.unlock_pin || '2846';
    } catch(e) {}
}

async function saveSettings() {
    const pin = document.getElementById('setting-pin').value.trim();
    if (pin) {
        await fetch('/api/settings/pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin })
        });
    }

    const wallFile = document.getElementById('setting-wallpaper').files[0];
    if (wallFile) {
        const formData = new FormData();
        formData.append('image', wallFile);
        await fetch('/api/branding/image', { method: 'POST', body: formData });
    }

    closeModal('modal-settings');
    showNotification('Ajustes guardados correctamente.');
}

// ==========================================
// HELPERS
// ==========================================
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showNotification(msg) {
    const notif = document.createElement('div');
    notif.style.cssText = `
        position: fixed; bottom: 20px; right: 20px;
        background: var(--bg-card); border: 1px solid var(--accent-blue);
        color: white; padding: 12px 20px; border-radius: 8px;
        box-shadow: 0 10px 15px rgba(0,0,0,0.4); z-index: 9999;
        font-size: 0.85rem; font-weight: 500;
    `;
    notif.textContent = msg;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 4000);
}

// ==========================================
// AUTENTICACIÓN Y SESIONES
// ==========================================
async function authFetch(url, options = {}) {
    options.headers = options.headers || {};
    if (authToken) {
        options.headers['Authorization'] = `Bearer ${authToken}`;
    }
    const res = await fetch(url, options);
    if (res.status === 401 && !url.includes('/api/auth/')) {
        openModal('modal-login');
    }
    return res;
}

async function checkAuthStatus() {
    if (!authToken) {
        updateAuthUI(null);
        return;
    }
    try {
        const res = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.ok) {
            const data = await res.json();
            currentUser = data.user;
            updateAuthUI(currentUser);
        } else {
            localStorage.removeItem('labdesk_token');
            authToken = null;
            currentUser = null;
            updateAuthUI(null);
        }
    } catch(e) {
        updateAuthUI(null);
    }
}

function updateAuthUI(user) {
    const navLabel = document.getElementById('nav-user-label');
    const btnRoster = document.getElementById('btn-roster-modal');
    const loginFormArea = document.getElementById('login-form-area');
    const profileArea = document.getElementById('profile-area');
    const loginFooter = document.getElementById('login-footer');

    if (user) {
        if (navLabel) navLabel.innerHTML = `👤 ${escapeHtml(user.fullName || user.username)}`;
        if (loginFormArea) loginFormArea.style.display = 'none';
        if (profileArea) {
            profileArea.style.display = 'block';
            document.getElementById('profile-fullname').textContent = user.fullName || user.username;
            document.getElementById('profile-role').textContent = user.role === 'admin' ? 'Administrador' : 'Profesor';
            document.getElementById('profile-username').textContent = `@${user.username}`;
        }
        if (loginFooter) loginFooter.style.display = 'none';
        if (btnRoster) btnRoster.style.display = user.role === 'admin' ? 'inline-block' : 'none';
    } else {
        if (navLabel) navLabel.innerHTML = `👤 Iniciar Sesión`;
        if (loginFormArea) loginFormArea.style.display = 'block';
        if (profileArea) profileArea.style.display = 'none';
        if (loginFooter) loginFooter.style.display = 'flex';
        if (btnRoster) btnRoster.style.display = 'none';
    }
}

function openLoginOrProfileModal() {
    openModal('modal-login');
}

async function submitLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    const errorEl = document.getElementById('login-error-msg');
    errorEl.style.display = 'none';

    if (!username || !password) {
        errorEl.textContent = 'Ingresa usuario y contraseña';
        errorEl.style.display = 'block';
        return;
    }

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.success && data.token) {
            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem('labdesk_token', authToken);
            updateAuthUI(currentUser);
            closeModal('modal-login');
            showNotification(`¡Bienvenido(a), ${currentUser.fullName}!`);
            document.getElementById('login-password').value = '';
        } else {
            errorEl.textContent = data.error || 'Credenciales inválidas';
            errorEl.style.display = 'block';
        }
    } catch(err) {
        errorEl.textContent = 'Error conectando con el servidor';
        errorEl.style.display = 'block';
    }
}

async function logoutUser() {
    if (authToken) {
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        }).catch(() => {});
    }
    localStorage.removeItem('labdesk_token');
    authToken = null;
    currentUser = null;
    updateAuthUI(null);
    closeModal('modal-login');
    showNotification('Has cerrado sesión exitosamente.');
}

// ==========================================
// GESTIÓN DE CURSOS Y ROSTER (ADMIN)
// ==========================================
function openRosterModal() {
    openModal('modal-roster');
    fetchCourses();
}

async function fetchCourses() {
    try {
        const res = await authFetch('/api/courses');
        currentCourses = await res.json();
        renderCoursesTable(currentCourses);
    } catch(err) {
        console.error('Error cargando cursos:', err);
    }
}

function renderCoursesTable(courses) {
    const tbody = document.getElementById('roster-courses-tbody');
    const totalCoursesEl = document.getElementById('roster-total-courses');
    const totalStudentsEl = document.getElementById('roster-total-students');

    if (!tbody) return;
    if (!courses || courses.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No hay cursos cargados aún. Sube un archivo Excel arriba.</td></tr>';
        if (totalCoursesEl) totalCoursesEl.textContent = '0';
        if (totalStudentsEl) totalStudentsEl.textContent = '0';
        return;
    }

    let totalStudents = 0;
    tbody.innerHTML = courses.map(c => {
        totalStudents += (c.student_count || 0);
        return `
            <tr>
                <td><strong>${escapeHtml(c.name)}</strong></td>
                <td><span class="badge">${c.student_count || 0} alumnos</span></td>
                <td><small style="color:var(--text-muted);">${c.created_at ? new Date(c.created_at).toLocaleDateString() : 'Hoy'}</small></td>
                <td>
                    <button class="btn btn-danger btn-sm" onclick="deleteCourse(${c.id})" style="padding:2px 8px; font-size:0.75rem;">🗑️ Eliminar</button>
                </td>
            </tr>
        `;
    }).join('');

    if (totalCoursesEl) totalCoursesEl.textContent = courses.length;
    if (totalStudentsEl) totalStudentsEl.textContent = totalStudents;
}

async function uploadRosterFile() {
    const fileInput = document.getElementById('roster-file-input');
    const statusEl = document.getElementById('roster-import-status');
    const file = fileInput.files[0];

    if (!file) {
        alert('Selecciona un archivo Excel (.xlsx, .xls) o CSV primero.');
        return;
    }

    statusEl.style.display = 'block';
    statusEl.style.color = '#3b82f6';
    statusEl.textContent = 'Procesando e importando estudiantes...';

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await authFetch('/api/roster/import', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            statusEl.style.color = '#10b981';
            statusEl.textContent = `✅ ${data.message}`;
            fileInput.value = '';
            fetchCourses();
            showNotification('Nómina importada correctamente.');
        } else {
            statusEl.style.color = '#ef4444';
            statusEl.textContent = `❌ ${data.error || 'Error al importar archivo'}`;
        }
    } catch(err) {
        statusEl.style.color = '#ef4444';
        statusEl.textContent = 'Error de conexión con el servidor.';
    }
}

async function deleteCourse(courseId) {
    if (!confirm('¿Estás seguro de eliminar este curso y todos sus estudiantes?')) return;
    try {
        const res = await authFetch(`/api/courses/${courseId}`, { method: 'DELETE' });
        if (res.ok) {
            showNotification('Curso eliminado.');
            fetchCourses();
        }
    } catch(err) {
        console.error('Error eliminando curso:', err);
    }
}

// ==========================================
// TAREAS Y CARPETAS DOCENTES
// ==========================================
async function openAssignmentsModal() {
    if (!currentUser) {
        openModal('modal-login');
        return;
    }
    openModal('modal-assignments');
    await fetchFolders();
    await fetchCourses();
    populateCourseDropdownForAssignments();
    await fetchAssignments();
}

async function fetchFolders() {
    try {
        const res = await authFetch('/api/folders');
        currentFolders = await res.json();
        renderFoldersList(currentFolders);
        populateFolderDropdownForAssignments();
    } catch(err) {
        console.error('Error cargando carpetas:', err);
    }
}

function renderFoldersList(folders) {
    const listEl = document.getElementById('folders-list');
    if (!listEl) return;

    let html = `
        <div class="folder-item ${selectedFolderId === null ? 'active' : ''}" onclick="selectFolder(null)">
            <span>📁 Todas las Tareas</span>
        </div>
    `;

    (folders || []).forEach(f => {
        html += `
            <div class="folder-item ${selectedFolderId === f.id ? 'active' : ''}" onclick="selectFolder(${f.id})">
                <div style="display:flex; align-items:center;">
                    <span class="folder-badge-color" style="background:${f.color || '#3b82f6'};"></span>
                    <span>${escapeHtml(f.name)}</span>
                </div>
                <button type="button" class="btn-folder-delete" onclick="event.stopPropagation(); deleteFolder(${f.id})" title="Eliminar Carpeta">&times;</button>
            </div>
        `;
    });

    listEl.innerHTML = html;
}

function selectFolder(folderId) {
    selectedFolderId = folderId;
    renderFoldersList(currentFolders);
    const titleEl = document.getElementById('current-folder-title');
    if (folderId === null) {
        titleEl.textContent = 'Todas las Tareas';
    } else {
        const f = currentFolders.find(x => x.id === folderId);
        titleEl.textContent = f ? `📁 ${f.name}` : 'Tareas';
    }
    renderAssignmentsCards();
}

async function promptNewFolder() {
    const name = prompt('Nombre de la nueva carpeta (ej. 7° Básico Tecnología):');
    if (!name || !name.trim()) return;

    try {
        const res = await authFetch('/api/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim() })
        });
        if (res.ok) {
            showNotification('Carpeta creada.');
            fetchFolders();
        }
    } catch(err) {
        console.error('Error creando carpeta:', err);
    }
}

async function deleteFolder(folderId) {
    if (!confirm('¿Eliminar esta carpeta? (Las tareas dentro no se borrarán).')) return;
    try {
        const res = await authFetch(`/api/folders/${folderId}`, { method: 'DELETE' });
        if (res.ok) {
            if (selectedFolderId === folderId) selectedFolderId = null;
            fetchFolders();
            fetchAssignments();
        }
    } catch(err) {
        console.error('Error eliminando carpeta:', err);
    }
}

function populateCourseDropdownForAssignments() {
    const sel = document.getElementById('assign-course');
    if (!sel) return;
    sel.innerHTML = '<option value="">Selecciona un curso...</option>';
    (currentCourses || []).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.name} (${c.student_count || 0} alumnos)`;
        sel.appendChild(opt);
    });
}

function populateFolderDropdownForAssignments() {
    const sel = document.getElementById('assign-folder');
    if (!sel) return;
    sel.innerHTML = '<option value="">(Sin Carpeta)</option>';
    (currentFolders || []).forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.name;
        sel.appendChild(opt);
    });
}

function toggleAssignmentForm(show) {
    const formCard = document.getElementById('assignment-form-card');
    const isVisible = formCard.style.display !== 'none';
    const willShow = show !== undefined ? show : !isVisible;

    formCard.style.display = willShow ? 'block' : 'none';
    if (willShow) {
        document.getElementById('assignment-edit-id').value = '';
        document.getElementById('assign-title').value = '';
        document.getElementById('assign-instructions').value = '';
        document.getElementById('assign-group-check').checked = false;
        document.getElementById('assign-group-size-wrap').style.display = 'none';
        if (selectedFolderId) {
            document.getElementById('assign-folder').value = selectedFolderId;
        }
        document.getElementById('assign-title').focus();
    }
}

function toggleCustomDuration(val) {
    const customInput = document.getElementById('assign-duration-custom');
    if (!customInput) return;
    customInput.style.display = val === 'custom' ? 'inline-block' : 'none';
    if (val === 'custom') customInput.focus();
}

let currentMatrixAssignmentId = null;
let currentPreviewSubmission = null;

async function fetchAssignments() {
    try {
        const res = await authFetch('/api/assignments');
        currentAssignments = await res.json();
        renderAssignmentsCards();
    } catch(err) {
        console.error('Error obteniendo tareas:', err);
    }
}

function renderAssignmentsCards() {
    const container = document.getElementById('assignments-cards-container');
    if (!container) return;

    let filtered = currentAssignments;
    if (selectedFolderId !== null) {
        filtered = currentAssignments.filter(a => a.folder_id === selectedFolderId);
    }

    if (!filtered || filtered.length === 0) {
        container.innerHTML = '<p class="text-center" style="color:var(--text-muted); padding:30px;">No hay tareas en esta sección. Haz clic en <strong>+ Nueva Tarea</strong> para crear una.</p>';
        return;
    }

    container.innerHTML = filtered.map(a => {
        const isActive = a.status === 'active';
        const appLabel = a.app_type === 'writer' ? 'Mini Writer' : (a.app_type === 'calc' ? 'Mini Calc' : (a.app_type === 'slides' ? 'Mini Slides' : 'Cualquier Editor'));
        const modeLabel = a.is_group ? `👥 Grupal (Hasta ${a.max_group_size})` : '👤 Individual';

        return `
            <div class="assignment-card ${isActive ? 'active-room' : ''}">
                <div class="assignment-card-top">
                    <div class="assignment-title-area">
                        <h4>
                            ${isActive ? '<span class="badge-active-pulse">● ASIGNADA EN SALA</span>' : ''}
                            <span>${escapeHtml(a.title)}</span>
                        </h4>
                        <div class="assignment-meta-row" style="margin-top:4px; display:flex; flex-wrap:wrap; gap:8px;">
                            <span>🏫 <strong>${escapeHtml(a.course_name)}</strong></span>
                            <span>💻 ${appLabel}</span>
                            <span>${modeLabel}</span>
                            ${a.duration_minutes > 0 ? `<span class="badge" style="background:#2563eb; color:white; font-size:0.75rem;">⏳ ${a.duration_minutes} min</span>` : ''}
                            ${a.strict_mode ? `<span class="badge" style="background:#dc2626; color:white; font-size:0.75rem;">🔒 Modo Enfoque</span>` : ''}
                            ${a.template_filename ? `<span class="badge" style="background:#059669; color:white; font-size:0.75rem;">📁 Plantilla</span>` : ''}
                            ${a.folder_name ? `<span>📁 ${escapeHtml(a.folder_name)}</span>` : ''}
                        </div>
                    </div>
                    <div>
                        <button class="btn btn-sm btn-danger" onclick="deleteAssignment(${a.id})" title="Eliminar Tarea" style="padding:2px 8px;">🗑️</button>
                    </div>
                </div>

                ${a.instructions ? `<div class="assignment-instructions-box">${escapeHtml(a.instructions)}</div>` : ''}

                <div class="assignment-actions-row">
                    <div>
                        ${isActive ? `
                            <button class="btn btn-sm btn-warning" onclick="deactivateAssignment(${a.id})">
                                ⏹️ Finalizar Asignación
                            </button>
                        ` : `
                            <button class="btn btn-sm btn-primary" onclick="activateAssignment(${a.id})">
                                🚀 Asignar a la Sala
                            </button>
                        `}
                    </div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        <button class="btn btn-sm btn-secondary" onclick="openProgressMatrix(${a.id}, '${escapeHtml(a.title)}', '${escapeHtml(a.course_name)}')">
                            📊 Matriz en Vivo
                        </button>
                        <button class="btn btn-sm btn-secondary" onclick="viewSubmissions(${a.id}, '${escapeHtml(a.title)}', '${escapeHtml(a.course_name)}', '${escapeHtml(a.teacher_name)}')">
                            📥 Entregas (${a.submission_count || 0})
                        </button>
                        <button class="btn btn-sm btn-success" onclick="exportGradesExcel(${a.id})" title="Exportar Notas a Excel">
                            📗 Excel
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function saveAssignment() {
    const id = document.getElementById('assignment-edit-id').value;
    const title = document.getElementById('assign-title').value.trim();
    const course_id = document.getElementById('assign-course').value;
    const folder_id = document.getElementById('assign-folder').value || null;
    const app_type = document.getElementById('assign-app').value;
    const is_group = document.getElementById('assign-group-check').checked;
    const max_group_size = Number(document.getElementById('assign-max-group').value) || 4;
    const instructions = document.getElementById('assign-instructions').value.trim();

    if (!title || !course_id) {
        alert('Por favor ingresa un título y selecciona el curso asignado.');
        return;
    }

    let duration = document.getElementById('assign-duration').value;
    if (duration === 'custom') {
        duration = document.getElementById('assign-duration-custom').value || 0;
    }
    const strict_mode = document.getElementById('assign-strict-check').checked ? 1 : 0;

    const formData = new FormData();
    formData.append('title', title);
    formData.append('course_id', course_id);
    if (folder_id) formData.append('folder_id', folder_id);
    formData.append('app_type', app_type);
    formData.append('is_group', is_group ? 1 : 0);
    formData.append('max_group_size', max_group_size);
    formData.append('instructions', instructions);
    formData.append('duration_minutes', parseInt(duration, 10) || 0);
    formData.append('strict_mode', strict_mode);

    const fileInput = document.getElementById('assign-template-file');
    if (fileInput && fileInput.files && fileInput.files[0]) {
        formData.append('template_file', fileInput.files[0]);
    }

    try {
        const url = id ? `/api/assignments/${id}` : '/api/assignments';
        const method = id ? 'PUT' : 'POST';
        const res = await authFetch(url, {
            method,
            body: formData
        });

        if (res.ok) {
            showNotification(id ? 'Tarea actualizada.' : 'Tarea creada correctamente con opciones Pro.');
            toggleAssignmentForm(false);
            fetchAssignments();
        } else {
            const err = await res.json();
            alert('Error al guardar: ' + (err.error || 'No se pudo guardar la tarea'));
        }
    } catch(err) {
        console.error('Error guardando tarea:', err);
    }
}

async function deleteAssignment(id) {
    if (!confirm('¿Seguro que deseas eliminar esta tarea y sus entregas asociadas?')) return;
    try {
        const res = await authFetch(`/api/assignments/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showNotification('Tarea eliminada.');
            fetchAssignments();
        }
    } catch(err) {
        console.error('Error eliminando tarea:', err);
    }
}

async function activateAssignment(id) {
    try {
        const res = await authFetch(`/api/assignments/${id}/activate`, { method: 'POST' });
        if (res.ok) {
            showNotification('🚀 Tarea asignada en la sala con temporizador sincronizado.');
            fetchAssignments();
        }
    } catch(err) {
        console.error('Error activando tarea:', err);
    }
}

async function deactivateAssignment(id) {
    try {
        const res = await authFetch(`/api/assignments/${id}/deactivate`, { method: 'POST' });
        if (res.ok) {
            showNotification('⏹️ Asignación cerrada en la sala.');
            fetchAssignments();
        }
    } catch(err) {
        console.error('Error cerrando asignación:', err);
    }
}

// ==========================================
// MATRIZ Y SEMÁFORO DE AVANCE EN VIVO
// ==========================================
async function openProgressMatrix(assignmentId, title, course) {
    currentMatrixAssignmentId = assignmentId;
    document.getElementById('matrix-modal-title').textContent = `📊 Matriz en Vivo: ${title || 'Tarea'}`;
    openModal('modal-progress-matrix');
    await refreshProgressMatrix();
}

async function refreshProgressMatrix() {
    if (!currentMatrixAssignmentId) return;
    try {
        const res = await authFetch(`/api/assignments/${currentMatrixAssignmentId}/progress-matrix`);
        if (!res.ok) return;
        const data = await res.json();
        renderProgressMatrixData(data);
    } catch(err) {
        console.error('Error actualizando matriz de avance:', err);
    }
}

function renderProgressMatrixData(data) {
    const { assignment, summary, students } = data;

    // Resumen
    document.getElementById('matrix-total-count').textContent = summary.total || 0;
    document.getElementById('matrix-notstarted-count').textContent = summary.not_started || 0;
    document.getElementById('matrix-working-count').textContent = summary.working || 0;
    document.getElementById('matrix-submitted-count').textContent = (summary.submitted || 0) + (summary.graded || 0);
    document.getElementById('matrix-returned-count').textContent = summary.returned || 0;

    const percent = summary.percent_completed || 0;
    document.getElementById('matrix-percent-label').textContent = `${percent}%`;
    document.getElementById('matrix-progress-bar').style.width = `${percent}%`;

    const activeTag = document.getElementById('matrix-active-tag');
    if (activeTag) {
        activeTag.style.display = assignment.status === 'active' ? 'inline-block' : 'none';
    }

    // Grid de Estudiantes
    const grid = document.getElementById('matrix-grid-container');
    if (!grid) return;

    if (!students || students.length === 0) {
        grid.innerHTML = '<p class="text-center" style="grid-column:1/-1; color:var(--text-muted); padding:30px;">No hay alumnos registrados en la nómina de este curso.</p>';
        return;
    }

    grid.innerHTML = students.map(s => {
        let statusBadge = '';
        let borderColor = 'rgba(255,255,255,0.08)';
        let bgCard = 'rgba(15, 23, 42, 0.6)';
        let extraInfo = '';

        if (s.status === 'graded') {
            statusBadge = `<span class="badge" style="background:#10b981; color:white;">🟢 Calificado (${s.submission?.grade || 'OK'})</span>`;
            borderColor = '#10b981';
            bgCard = 'rgba(16, 185, 129, 0.12)';
        } else if (s.status === 'submitted') {
            statusBadge = `<span class="badge" style="background:#10b981; color:white;">🟢 Entregado</span>`;
            borderColor = '#10b981';
            bgCard = 'rgba(16, 185, 129, 0.08)';
        } else if (s.status === 'returned') {
            statusBadge = `<span class="badge" style="background:#ea580c; color:white;">🟠 En Corrección</span>`;
            borderColor = '#ea580c';
            bgCard = 'rgba(234, 88, 12, 0.12)';
        } else if (s.status === 'working') {
            statusBadge = `<span class="badge" style="background:#ca8a04; color:white;">🟡 Trabajando</span>`;
            borderColor = '#ca8a04';
            bgCard = 'rgba(202, 138, 4, 0.12)';
        } else {
            statusBadge = `<span class="badge" style="background:#475569; color:#cbd5e1;">⚪ Sin Iniciar</span>`;
        }

        if (s.client_name) {
            extraInfo += `<small style="display:block; color:#94a3b8; margin-top:4px;">💻 PC: ${escapeHtml(s.client_name)}</small>`;
        }
        if (s.metrics) {
            if (s.metrics.words !== undefined) extraInfo += `<small style="display:block; color:#60a5fa;">📝 ${s.metrics.words} palabras</small>`;
            if (s.metrics.cells !== undefined) extraInfo += `<small style="display:block; color:#60a5fa;">📊 ${s.metrics.cells} celdas</small>`;
            if (s.metrics.slidesCount !== undefined) extraInfo += `<small style="display:block; color:#60a5fa;">📽️ ${s.metrics.slidesCount} diapositivas</small>`;
        }

        return `
            <div style="background:${bgCard}; border:1px solid ${borderColor}; border-radius:8px; padding:10px 12px; display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px;">
                        <strong style="font-size:0.9rem; color:#f8fafc;">${escapeHtml(s.full_name)}</strong>
                        ${statusBadge}
                    </div>
                    ${s.identifier ? `<small style="color:#64748b; font-size:0.75rem;">ID: ${escapeHtml(s.identifier)}</small>` : ''}
                    ${extraInfo}
                </div>
                ${s.submission ? `
                    <div style="margin-top:8px; display:flex; justify-content:flex-end; gap:6px;">
                        <button class="btn btn-sm btn-primary" onclick="previewSubmissionObject(${JSON.stringify(s.submission).replace(/"/g, '&quot;')})">
                            👁️ Ver / Calificar
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

function exportGradesExcel(assignmentId) {
    if (!assignmentId) return;
    window.location.href = `/api/assignments/${assignmentId}/export-grades`;
}

// ==========================================
// BANDEJA DE ENTREGAS Y DESCARGA ZIP
// ==========================================
async function viewSubmissions(assignmentId, title, course, teacher) {
    viewingAssignmentId = assignmentId;
    document.getElementById('sub-assignment-name').textContent = title;
    document.getElementById('sub-assignment-meta').textContent = `${course} • Profesor: ${teacher}`;
    openModal('modal-submissions');
    await refreshCurrentSubmissions();
}

async function refreshCurrentSubmissions() {
    if (!viewingAssignmentId) return;
    try {
        const res = await fetch(`/api/assignments/${viewingAssignmentId}/submissions`);
        const submissions = await res.json();
        renderSubmissionsTable(submissions);
    } catch(err) {
        console.error('Error obteniendo entregas:', err);
    }
}

function renderSubmissionsTable(submissions) {
    const tbody = document.getElementById('submissions-tbody');
    if (!tbody) return;

    if (!submissions || submissions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No hay entregas para esta tarea todavía.</td></tr>';
        return;
    }

    tbody.innerHTML = submissions.map(s => {
        let studentText = s.main_student_name || 'Estudiante';
        if (s.student_names && Array.isArray(s.student_names) && s.student_names.length > 1) {
            studentText = `<strong>👥 ${escapeHtml(s.student_names.join(', '))}</strong>`;
        } else {
            studentText = `<strong>👤 ${escapeHtml(studentText)}</strong>`;
        }

        const dateStr = s.created_at ? new Date(s.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'Hoy';

        let statusBadge = '<span class="badge" style="background:#10b981; color:white;">Entregado</span>';
        if (s.status === 'graded') {
            statusBadge = '<span class="badge" style="background:#059669; color:white;">Calificado</span>';
        } else if (s.status === 'returned') {
            statusBadge = '<span class="badge" style="background:#ea580c; color:white;">Devuelto</span>';
        }

        const gradeDisplay = s.grade ? `<strong style="color:#60a5fa; font-size:1rem;">${escapeHtml(s.grade)}</strong>` : '<span style="color:var(--text-muted);">-</span>';

        return `
            <tr>
                <td><small>${dateStr}</small></td>
                <td>${studentText}</td>
                <td><small>${escapeHtml(s.client_name || s.client_id)}</small></td>
                <td>${statusBadge}</td>
                <td>${gradeDisplay}</td>
                <td><small>${escapeHtml(s.filename)}</small></td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="previewSubmissionObject(${JSON.stringify(s).replace(/"/g, '&quot;')})">👁️ Ver/Calificar</button>
                    <a href="${s.file_path}" class="btn btn-sm btn-secondary" download="${escapeHtml(s.filename)}">⬇️</a>
                    <button class="btn btn-sm btn-danger" onclick="deleteSubmissionRecord(${s.id})">🗑️</button>
                </td>
            </tr>
        `;
    }).join('');
}

function downloadAllSubmissionsZip() {
    if (!viewingAssignmentId) return;
    window.location.href = `/api/assignments/${viewingAssignmentId}/download-all`;
}

function previewSubmissionObject(submission) {
    currentPreviewSubmission = submission;
    const frame = document.getElementById('preview-iframe');
    const pre = document.getElementById('preview-text');
    const titleEl = document.getElementById('preview-title');
    const downloadBtn = document.getElementById('preview-download-btn');

    titleEl.textContent = `👁️ ${submission.filename} - ${submission.main_student_name || 'Estudiante'}`;
    downloadBtn.href = submission.file_path;
    downloadBtn.download = submission.filename;

    // Cargar nota y feedback previos
    const gradeInput = document.getElementById('preview-grade-input');
    const feedbackInput = document.getElementById('preview-feedback-input');
    if (gradeInput) gradeInput.value = submission.grade || '';
    if (feedbackInput) feedbackInput.value = submission.feedback || '';

    if (submission.filename.endsWith('.html') || submission.filename.endsWith('.htm')) {
        frame.style.display = 'block';
        pre.style.display = 'none';
        frame.src = submission.file_path;
    } else {
        frame.style.display = 'none';
        pre.style.display = 'block';
        pre.textContent = 'Cargando contenido...';
        fetch(submission.file_path)
            .then(res => res.text())
            .then(txt => {
                try {
                    const parsed = JSON.parse(txt);
                    pre.textContent = JSON.stringify(parsed, null, 2);
                } catch(e) {
                    pre.textContent = txt;
                }
            })
            .catch(() => {
                pre.textContent = 'No se pudo previsualizar el archivo.';
            });
    }

    openModal('modal-preview');
}

async function savePreviewGrade() {
    if (!currentPreviewSubmission) return;
    const grade = document.getElementById('preview-grade-input').value.trim();
    const feedback = document.getElementById('preview-feedback-input').value.trim();

    try {
        const res = await authFetch(`/api/submissions/${currentPreviewSubmission.id}/grade`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grade, feedback })
        });
        if (res.ok) {
            showNotification('✅ Calificación y retroalimentación guardadas con éxito.');
            currentPreviewSubmission.grade = grade;
            currentPreviewSubmission.feedback = feedback;
            currentPreviewSubmission.status = 'graded';
            if (viewingAssignmentId) refreshCurrentSubmissions();
            if (currentMatrixAssignmentId) refreshProgressMatrix();
        } else {
            alert('Error al guardar calificación.');
        }
    } catch(err) {
        console.error('Error calificando entrega:', err);
    }
}

async function returnPreviewSubmission() {
    if (!currentPreviewSubmission) return;
    const feedback = document.getElementById('preview-feedback-input').value.trim();
    if (!confirm('¿Deseas devolver esta entrega al alumno para que realice correcciones? Se le notificará instantáneamente.')) return;

    try {
        const res = await authFetch(`/api/submissions/${currentPreviewSubmission.id}/return`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feedback })
        });
        if (res.ok) {
            showNotification('↩️ Entrega devuelta al estudiante para su corrección.');
            closeModal('modal-preview');
            if (viewingAssignmentId) refreshCurrentSubmissions();
            if (currentMatrixAssignmentId) refreshProgressMatrix();
        } else {
            alert('Error al devolver entrega.');
        }
    } catch(err) {
        console.error('Error devolviendo entrega:', err);
    }
}

async function deleteSubmissionRecord(id) {
    if (!confirm('¿Eliminar esta entrega permanentemente?')) return;
    try {
        const res = await authFetch(`/api/submissions/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showNotification('Entrega eliminada.');
            refreshCurrentSubmissions();
            fetchAssignments();
        }
    } catch(err) {
        console.error('Error eliminando entrega:', err);
    }
}

