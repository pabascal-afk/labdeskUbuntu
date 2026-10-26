// LabDesk Teacher Dashboard Client
const socket = io();

let currentClients = [];
let currentSectors = [];
let primarySectorId = localStorage.getItem('labdesk_primary_sector') || 'all';
let activeSectorId = primarySectorId;
let currentActiveRdpClientId = null;
let draggedSectorId = null;

// ==========================================
// INICIALIZACIÓN
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    setupSocketListeners();
    setupEventListeners();
    fetchSectors();
    fetchClients();
    fetchTurnIns();
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
        showNotification(`📥 Nueva entrega: ${item.student_name} (${item.filename})`);
        fetchTurnIns();
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
async function fetchScripts() {
    try {
        const res = await fetch('/api/scripts');
        const scripts = await res.json();
        const container = document.getElementById('scripts-container');
        container.innerHTML = '';

        if (!scripts || scripts.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem; padding:10px;">No hay scripts configurados.</p>';
            return;
        }

        scripts.forEach(s => {
            const card = document.createElement('div');
            card.className = 'script-card';
            card.innerHTML = `
                <div>
                    <h4>${s.icon || '📜'} ${escapeHtml(s.name)}</h4>
                    <p style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">${escapeHtml(s.description || '')}</p>
                </div>
                <div style="margin-top:10px; display:flex; gap:0.5rem; flex-wrap:wrap;">
                    <button class="btn btn-sm btn-primary btn-run-now">▶️ Ejecutar en Todos</button>
                    <button class="btn btn-sm btn-secondary btn-view-code" title="Ver contenido del script">👁️ Ver Código</button>
                </div>
            `;
            const runBtn = card.querySelector('.btn-run-now');
            runBtn.onclick = () => runScriptNow(s.content, s.name);

            const viewBtn = card.querySelector('.btn-view-code');
            viewBtn.onclick = () => {
                const outBox = document.getElementById('script-output');
                const outText = document.getElementById('script-output-text');
                outBox.style.display = 'block';
                outText.textContent = `=== [Código del Script: ${s.name}] ===\n\n${s.content}`;
                outBox.scrollIntoView({ behavior: 'smooth' });
            };

            container.appendChild(card);
        });
    } catch(e) {
        console.error('Error al obtener scripts:', e);
    }
}

async function runScriptNow(content, scriptName) {
    const outBox = document.getElementById('script-output');
    const outText = document.getElementById('script-output-text');
    outBox.style.display = 'block';
    outText.textContent = `[${new Date().toLocaleTimeString()}] Enviando script "${scriptName || 'Bash'}" a los clientes Linux activos...\nEsperando respuesta de las estaciones...\n`;
    outBox.scrollIntoView({ behavior: 'smooth' });
    await sendGlobalCommand('run_script', content);
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
