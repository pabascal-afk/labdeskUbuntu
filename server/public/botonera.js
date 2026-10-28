// LabDesk SemiAdmin - Botonera del Profesor
const socket = io();

let currentSectorId = localStorage.getItem('labdesk_selected_sector') || localStorage.getItem('labdesk_primary_sector') || 'all';
let currentPin = '2846';
let enteredConsolePin = '';
let isConsoleLocked = false;
let roomState = {
    total: 0,
    online: 0,
    locked: 0,
    muted: 0,
    turnIns: 0
};

// Variables de Sesión y Tareas en Botonera
let authToken = localStorage.getItem('labdesk_token') || null;
let currentUser = null;
let botoneraFolders = [];
let botoneraAssignments = [];
let botoneraSelectedFolderId = null;
let botoneraCourses = [];
let botoneraViewingAssignId = null;

// ==============================================================
// INICIALIZACIÓN
// ==============================================================
document.addEventListener('DOMContentLoaded', async () => {
    checkBotoneraAuthStatus();
    checkActiveAssignmentBotonera();
    setupSocket();
    await fetchSectors();
    await updateRoomSummary();
    await fetchPin();

    document.getElementById('sector-select').value = currentSectorId;
    document.getElementById('sector-select').onchange = (e) => {
        currentSectorId = e.target.value;
        localStorage.setItem('labdesk_selected_sector', currentSectorId);
        updateRoomSummary();
    };
});

// ==============================================================
// SOCKET.IO REAL-TIME LISTENERS
// ==============================================================
function setupSocket() {
    socket.on('connect', () => {
        console.log('✅ Botonera conectada al servidor');
    });

    socket.on('clients_updated', () => {
        updateRoomSummary();
        if (isModalOpen('modal-mosaic')) refreshMosaic();
    });

    socket.on('screenshot_update', ({ clientId, image }) => {
        if (isModalOpen('modal-mosaic') && image && image !== 'PAUSED') {
            const imgEl = document.getElementById(`mosaic-thumb-${clientId}`);
            if (imgEl) imgEl.src = `data:image/jpeg;base64,${image}`;
        }
    });

    socket.on('new_turn_in', (item) => {
        updateRoomSummary();
        showToast(`📥 ¡Nueva entrega: ${item?.student_name || 'Alumno'}!`);
    });

    socket.on('new_submission', (sub) => {
        updateRoomSummary();
        showToast(`📥 ¡Nueva entrega: ${sub.main_student_name || 'Alumno'}!`);
        if (isModalOpen('modal-botonera-submissions')) {
            refreshBotoneraSubmissions();
        }
    });

    socket.on('active_assignment_updated', (data) => {
        updateActiveAssignmentBotoneraHUD(data);
        if (isModalOpen('modal-botonera-assignments')) {
            fetchBotoneraAssignments();
        }
        if (isModalOpen('modal-botonera-matrix')) {
            refreshBotoneraProgressMatrix();
        }
    });

    socket.on('assignment_progress_updated', () => {
        if (isModalOpen('modal-botonera-matrix')) {
            refreshBotoneraProgressMatrix();
        }
    });

    socket.on('submission_graded', () => {
        if (isModalOpen('modal-botonera-submissions')) {
            refreshBotoneraSubmissions();
        }
        if (isModalOpen('modal-botonera-matrix')) {
            refreshBotoneraProgressMatrix();
        }
    });
}

// ==============================================================
// RESUMEN Y HUD DEL AULA
// ==============================================================
async function updateRoomSummary() {
    try {
        const url = `/api/teacher/summary?sector_id=${currentSectorId}`;
        const res = await fetch(url);
        const data = await res.json();
        roomState = data;

        // Actualizar HUD
        document.getElementById('hud-online-count').textContent = `${data.online} / ${data.total}`;
        
        // Estado de bloqueo
        const isLocked = data.online > 0 && data.locked === data.online;
        const ledLock = document.getElementById('led-lock');
        const lockText = document.getElementById('hud-lock-text');
        const btnLock = document.getElementById('btn-lock-room');
        const ledBtnLock = document.getElementById('led-btn-lock');

        if (isLocked) {
            ledLock.className = 'led-dot led-red';
            lockText.textContent = 'BLOQUEADA';
            btnLock.classList.add('room-locked');
            if (ledBtnLock) ledBtnLock.classList.add('active');
        } else {
            ledLock.className = 'led-dot led-off';
            lockText.textContent = 'LIBRES';
            btnLock.classList.remove('room-locked');
            if (ledBtnLock) ledBtnLock.classList.remove('active');
        }

        // Estado de audio
        const isMuted = data.online > 0 && data.muted === data.online;
        const ledAudio = document.getElementById('led-audio');
        const audioText = document.getElementById('hud-audio-text');
        const btnMute = document.getElementById('btn-mute-room');
        const ledBtnMute = document.getElementById('led-btn-mute');

        if (isMuted) {
            ledAudio.className = 'led-dot led-red';
            audioText.textContent = 'SILENCIADO';
            btnMute.classList.add('room-muted');
            if (ledBtnMute) ledBtnMute.classList.add('active');
        } else {
            ledAudio.className = 'led-dot led-green';
            audioText.textContent = 'ACTIVO';
            btnMute.classList.remove('room-muted');
            if (ledBtnMute) ledBtnMute.classList.remove('active');
        }

        // Contador de tareas
        document.getElementById('hud-turnin-count').textContent = data.turn_in_count || 0;
        document.getElementById('sub-turnin-count').textContent = `${data.turn_in_count || 0} recibidas`;

    } catch (e) {
        console.error('Error al actualizar resumen de sala:', e);
    }
}

async function fetchSectors() {
    try {
        const res = await fetch('/api/sectors');
        const sectors = await res.json();
        const select = document.getElementById('sector-select');
        select.innerHTML = '<option value="all">🖥️ Toda la Escuela (Todos)</option>';

        sectors.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = `${s.icon || '🏫'} ${s.name}`;
            select.appendChild(opt);
        });
    } catch(e) {}
}

async function fetchPin() {
    try {
        const res = await fetch('/api/settings/pin');
        const data = await res.json();
        currentPin = data.pin || '2846';
    } catch(e) {}
}

// ==============================================================
// DISPARADOR DE ACCIONES DE LA BOTONERA
// ==============================================================
async function triggerAction(command, payload = null) {
    playHapticClick();
    
    try {
        const body = { command, payload, sector_id: currentSectorId === 'all' ? null : currentSectorId };
        const res = await fetch('/api/clients/command/all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        
        let label = 'Comando enviado';
        if (command === 'lock') label = '🔒 ¡Sala Bloqueada!';
        else if (command === 'unlock') label = '🔓 ¡Sala Desbloqueada!';
        else if (command === 'volume_mute') label = '🔇 Sala Silenciada';
        else if (command === 'volume_unmute') label = '🔊 Audio Activado';
        else if (command === 'volume_set') label = `🔊 Volumen fijado en ${payload.volume}%`;
        
        showToast(label);
        setTimeout(updateRoomSummary, 300);
    } catch (e) {
        showToast('❌ Error de conexión');
    }
}

// ==============================================================
// LANZADOR DE ENLACES, PÁGINA CAUTIVA Y ACCESOS DIRECTOS
// ==============================================================
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
let customPresets = [...DEFAULT_PRESETS];

async function loadPresets() {
    try {
        const res = await fetch('/api/settings');
        const settings = await res.json();
        if (settings.custom_browser_presets) {
            customPresets = JSON.parse(settings.custom_browser_presets);
        }
    } catch(e) {}
    renderPresetsBotonera();
}

function renderPresetsBotonera() {
    const grid = document.getElementById('presets-grid-container');
    const list = document.getElementById('preset-items-list');
    if (!grid) return;

    grid.innerHTML = '';
    if (list) list.innerHTML = '';

    customPresets.forEach((p, idx) => {
        // Botón en la cuadrícula de 1-toque
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'preset-pill';
        btn.innerHTML = `${p.icon || '🌐'} ${escapeHtml(p.name)}`;
        btn.onclick = () => pickPreset(p.url);
        grid.appendChild(btn);

        // Fila en el editor
        if (list) {
            const row = document.createElement('div');
            row.className = 'preset-item-row';
            row.innerHTML = `
                <div class="preset-item-info">
                    <span>${p.icon || '🌐'} ${escapeHtml(p.name)}</span>
                    <small>(${escapeHtml(p.url.substring(0, 30))}...)</small>
                </div>
                <button type="button" class="btn-del-preset" title="Eliminar este acceso" onclick="deletePreset(${idx})">✕</button>
            `;
            list.appendChild(row);
        }
    });
}

function togglePresetEditor() {
    const panel = document.getElementById('preset-editor-panel');
    if (!panel) return;
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

async function addNewPreset() {
    const icon = document.getElementById('new-preset-icon').value.trim() || '🌐';
    const name = document.getElementById('new-preset-name').value.trim();
    let url = document.getElementById('new-preset-url').value.trim();

    if (!name || !url) return alert('Por favor ingresa un nombre y una dirección URL.');
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    customPresets.push({ name, url, icon });
    await saveCustomPresets();

    document.getElementById('new-preset-name').value = '';
    document.getElementById('new-preset-url').value = '';
}

async function deletePreset(idx) {
    customPresets.splice(idx, 1);
    await saveCustomPresets();
}

async function resetDefaultPresets() {
    if (!confirm('¿Restablecer los accesos directos predeterminados?')) return;
    customPresets = [...DEFAULT_PRESETS];
    await saveCustomPresets();
}

async function saveCustomPresets() {
    renderPresetsBotonera();
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ custom_browser_presets: JSON.stringify(customPresets) })
        });
    } catch(e) {
        console.error('Error guardando accesos directos:', e);
    }
}

function launchUrl(url, isKiosk = false) {
    triggerAction('browser_open_url', { url, isKiosk });
}

function openLinkModal(isExam = false) {
    playHapticClick();
    loadPresets();
    const titleEl = document.getElementById('link-modal-title');
    const toggleEl = document.getElementById('kiosk-mode-toggle');
    
    if (isExam) {
        titleEl.textContent = '🔒 Página Cautiva (Modo Examen)';
        toggleEl.checked = true;
    } else {
        titleEl.textContent = '🌐 Enviar Enlace a la Sala';
        toggleEl.checked = false;
    }

    document.getElementById('custom-url-input').value = '';
    openModal('modal-link');
}

function pickPreset(url) {
    document.getElementById('custom-url-input').value = url;
}

function sendCustomUrl() {
    let url = document.getElementById('custom-url-input').value.trim();
    if (!url) return alert('Por favor ingresa o selecciona una URL.');
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }

    const isKiosk = document.getElementById('kiosk-mode-toggle').checked;
    launchUrl(url, isKiosk);
    closeModal('modal-link');
    showToast(isKiosk ? `🔒 Examen fijado: ${url}` : `🚀 Enlace abierto: ${url}`);
}

function releaseKioskFromBotonera() {
    playHapticClick();
    triggerAction('browser_kiosk_mode', { enabled: false });
    closeModal('modal-link');
    showToast('🔓 Modo examen / Página Cautiva liberado');
}

// ==============================================================
// AVISOS EN PANTALLA
// ==============================================================
function openAnnouncementModal() {
    playHapticClick();
    document.getElementById('announcement-text-input').value = '';
    openModal('modal-announcement');
}

function pickAnnouncement(text) {
    document.getElementById('announcement-text-input').value = text;
}

function sendAnnouncement() {
    const text = document.getElementById('announcement-text-input').value.trim();
    if (!text) return alert('Ingresa un texto para el aviso.');

    triggerAction('announcement', text);
    closeModal('modal-announcement');
}

// ==============================================================
// CONTROL DE ENERGÍA
// ==============================================================
function confirmPower(action) {
    playHapticClick();
    let msg = '¿Estás seguro de ejecutar esta acción en la sala?';
    if (action === 'shutdown') msg = '🛑 ¿APAGAR TODOS los computadores de la sala ahora?';
    if (action === 'reboot') msg = '🔄 ¿REINICIAR todos los computadores de la sala?';
    if (action === 'wake') msg = '⚡ ¿Enviar orden de ENCENDIDO (Wake-on-LAN) a la sala?';

    if (confirm(msg)) {
        triggerAction(action);
    }
}

// ==============================================================
// MOSAICO DE PANTALLAS EN VIVO (SUPERVISIÓN)
// ==============================================================
async function openMosaicModal() {
    playHapticClick();
    openModal('modal-mosaic');
    await refreshMosaic();
}

async function refreshMosaic() {
    const grid = document.getElementById('mosaic-grid');
    grid.innerHTML = '<p class="text-center" style="grid-column: 1/-1;">Cargando capturas...</p>';

    try {
        const res = await fetch('/api/clients');
        const clients = await res.json();
        
        let filtered = clients;
        if (currentSectorId !== 'all') {
            filtered = clients.filter(c => c.sector_id === Number(currentSectorId));
        }

        grid.innerHTML = '';
        if (filtered.length === 0) {
            grid.innerHTML = '<p class="text-center text-muted" style="grid-column: 1/-1;">No hay equipos en esta sala.</p>';
            return;
        }

        filtered.forEach(c => {
            const card = document.createElement('div');
            card.className = 'mosaic-card';
            card.innerHTML = `
                <div class="mosaic-thumb">
                    <img id="mosaic-thumb-${c.id}" src="/api/clients/${c.id}/screenshot?t=${Date.now()}" onerror="this.src=''; this.alt='Sin Captura';">
                </div>
                <div class="mosaic-meta">
                    <span>${escapeHtml(c.name)}</span>
                    <span style="color:${c.status === 'online' ? '#10b981' : '#6b7280'}; font-size:10px;">
                        ${c.status === 'online' ? (c.is_locked ? '🔒' : '🟢') : '⚫'}
                    </span>
                </div>
            `;
            grid.appendChild(card);
        });

        document.getElementById('mosaic-stats').textContent = `${filtered.length} pantallas supervisadas`;
    } catch(e) {}
}

// ==============================================================
// BUZÓN DE TAREAS ENTREGADAS
// ==============================================================
function openTurnInsModal() {
    playHapticClick();
    openModal('modal-turnins');
    fetchTurnInsList();
}

async function fetchTurnInsList() {
    const tbody = document.getElementById('turnin-tbody');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Cargando...</td></tr>';

    try {
        const res = await fetch('/api/turn-ins');
        const items = await res.json();

        tbody.innerHTML = '';
        if (items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Aún no se han entregado tareas en esta clase.</td></tr>';
            document.getElementById('turnin-total-label').textContent = 'Total: 0 tareas';
            return;
        }

        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                <td><strong>${escapeHtml(item.student_name || 'Estudiante')}</strong></td>
                <td>${escapeHtml(item.client_name)}</td>
                <td><span style="background:#1e293b; padding:2px 6px; border-radius:4px;">${escapeHtml(item.app_type)}</span></td>
                <td>${escapeHtml(item.filename)}</td>
                <td>
                    <a href="${item.file_path}" download="${item.filename}" class="btn-action" style="padding:4px 10px; font-size:11px; text-decoration:none;">⬇️ Bajar</a>
                </td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById('turnin-total-label').textContent = `Total: ${items.length} tareas`;
    } catch(e) {}
}

// ==============================================================
// SEGURIDAD DEL PROFESOR: PAUSAR BOTONERA CON PIN
// ==============================================================
function lockConsole() {
    playHapticClick();
    isConsoleLocked = true;
    clearConsolePin();
    document.getElementById('console-lock-screen').classList.add('show');
}

function pressConsolePin(num) {
    if (enteredConsolePin.length < 6) {
        enteredConsolePin += num;
        document.getElementById('console-pin-display').value = '•'.repeat(enteredConsolePin.length);
    }
}

function clearConsolePin() {
    enteredConsolePin = '';
    document.getElementById('console-pin-display').value = '';
}

function unlockConsole() {
    if (enteredConsolePin === currentPin) {
        document.getElementById('console-lock-screen').classList.remove('show');
        isConsoleLocked = false;
        clearConsolePin();
        showToast('🔓 Botonera reactivada');
    } else {
        alert('PIN incorrecto.');
        clearConsolePin();
    }
}

// ==============================================================
// HELPERS, AUDIO HÁPTICO Y TOAST
// ==============================================================
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
function isModalOpen(id) { return document.getElementById(id).classList.contains('show'); }

function showToast(msg) {
    const banner = document.getElementById('toast-banner');
    banner.textContent = msg;
    banner.classList.add('show');
    setTimeout(() => banner.classList.remove('show'), 2500);
}

// Sonido sutil sintético de clic mecánico
function playHapticClick() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(140, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.04);
        gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.04);
    } catch(e) {}
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ==============================================================
// AUTENTICACIÓN Y SESIONES EN LA BOTONERA
// ==============================================================
async function authFetch(url, options = {}) {
    options.headers = options.headers || {};
    if (authToken) {
        options.headers['Authorization'] = `Bearer ${authToken}`;
    }
    const res = await fetch(url, options);
    if (res.status === 401 && !url.includes('/api/auth/')) {
        openModal('modal-botonera-login');
    }
    return res;
}

async function checkBotoneraAuthStatus() {
    if (!authToken) {
        updateBotoneraAuthUI(null);
        return;
    }
    try {
        const res = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.ok) {
            const data = await res.json();
            currentUser = data.user;
            updateBotoneraAuthUI(currentUser);
        } else {
            localStorage.removeItem('labdesk_token');
            authToken = null;
            currentUser = null;
            updateBotoneraAuthUI(null);
        }
    } catch(e) {
        updateBotoneraAuthUI(null);
    }
}

function updateBotoneraAuthUI(user) {
    const hudUserLabel = document.getElementById('hud-user-label');
    const formArea = document.getElementById('botonera-login-form-area');
    const profileArea = document.getElementById('botonera-profile-area');
    const bottomBar = document.getElementById('botonera-login-bottom');

    if (user) {
        if (hudUserLabel) hudUserLabel.textContent = user.fullName || user.username;
        if (formArea) formArea.style.display = 'none';
        if (profileArea) {
            profileArea.style.display = 'block';
            document.getElementById('botonera-profile-name').textContent = user.fullName || user.username;
            document.getElementById('botonera-profile-role').textContent = user.role === 'admin' ? 'Administrador' : 'Profesor';
            document.getElementById('botonera-profile-user').textContent = `@${user.username}`;
        }
        if (bottomBar) bottomBar.style.display = 'none';
    } else {
        if (hudUserLabel) hudUserLabel.textContent = 'Ingresar';
        if (formArea) formArea.style.display = 'block';
        if (profileArea) profileArea.style.display = 'none';
        if (bottomBar) bottomBar.style.display = 'flex';
    }
}

function openBotoneraLoginModal() {
    openModal('modal-botonera-login');
}

async function submitBotoneraLogin() {
    const username = document.getElementById('botonera-login-user').value.trim();
    const password = document.getElementById('botonera-login-pass').value.trim();
    const errEl = document.getElementById('botonera-login-err');
    errEl.style.display = 'none';

    if (!username || !password) {
        errEl.textContent = 'Ingresa usuario y contraseña';
        errEl.style.display = 'block';
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
            updateBotoneraAuthUI(currentUser);
            closeModal('modal-botonera-login');
            showToast(`¡Bienvenido(a), ${currentUser.fullName}!`);
            document.getElementById('botonera-login-pass').value = '';
        } else {
            errEl.textContent = data.error || 'Credenciales incorrectas';
            errEl.style.display = 'block';
        }
    } catch(err) {
        errEl.textContent = 'Error de conexión con el servidor';
        errEl.style.display = 'block';
    }
}

async function logoutBotoneraUser() {
    if (authToken) {
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        }).catch(() => {});
    }
    localStorage.removeItem('labdesk_token');
    authToken = null;
    currentUser = null;
    updateBotoneraAuthUI(null);
    closeModal('modal-botonera-login');
    showToast('Sesión cerrada');
}

// ==============================================================
// SINCRONIZACIÓN DE TAREA ACTIVA EN EL HUD DE LA BOTONERA
// ==============================================================
async function checkActiveAssignmentBotonera() {
    try {
        const res = await fetch('/api/assignments/active');
        const data = await res.json();
        if (data && data.active && data.assignment) {
            updateActiveAssignmentBotoneraHUD(data.assignment);
        } else {
            updateActiveAssignmentBotoneraHUD(null);
        }
    } catch(e) {}
}

function updateActiveAssignmentBotoneraHUD(data) {
    const subLabel = document.getElementById('btn-sub-active-assignment');
    const deckBtn = document.getElementById('btn-deck-tasks');
    if (!subLabel || !deckBtn) return;

    if (data && data.title) {
        subLabel.textContent = `🟢 ${data.title}`;
        deckBtn.style.borderColor = 'var(--led-green)';
    } else {
        subLabel.textContent = 'Asignar a Sala';
        deckBtn.style.borderColor = '#3b82f6';
    }
}

// ==============================================================
// GESTIÓN Y ASIGNACIÓN DE TAREAS EN LA BOTONERA
// ==============================================================
async function openBotoneraAssignmentsModal() {
    if (!currentUser) {
        openBotoneraLoginModal();
        return;
    }
    openModal('modal-botonera-assignments');
    await fetchBotoneraFolders();
    await fetchBotoneraCourses();
    populateBotoneraCourseDropdown();
    await fetchBotoneraAssignments();
}

async function fetchBotoneraFolders() {
    try {
        const res = await authFetch('/api/folders');
        botoneraFolders = await res.json();
        renderBotoneraFoldersList(botoneraFolders);
        populateBotoneraFolderDropdown();
    } catch(err) {
        console.error('Error cargando carpetas en botonera:', err);
    }
}

function renderBotoneraFoldersList(folders) {
    const listEl = document.getElementById('botonera-folders-list');
    if (!listEl) return;

    let html = `
        <div class="botonera-folder-item ${botoneraSelectedFolderId === null ? 'active' : ''}" onclick="selectBotoneraFolder(null)">
            <span>📁 Todas las Tareas</span>
        </div>
    `;

    (folders || []).forEach(f => {
        html += `
            <div class="botonera-folder-item ${botoneraSelectedFolderId === f.id ? 'active' : ''}" onclick="selectBotoneraFolder(${f.id})">
                <div style="display:flex; align-items:center;">
                    <span class="botonera-folder-badge-color" style="background:${f.color || '#3b82f6'};"></span>
                    <span>${escapeHtml(f.name)}</span>
                </div>
                <button type="button" class="btn-botonera-del" onclick="event.stopPropagation(); deleteBotoneraFolder(${f.id})" title="Eliminar Carpeta">&times;</button>
            </div>
        `;
    });

    listEl.innerHTML = html;
}

function selectBotoneraFolder(folderId) {
    botoneraSelectedFolderId = folderId;
    renderBotoneraFoldersList(botoneraFolders);
    const heading = document.getElementById('botonera-folder-heading');
    if (folderId === null) {
        heading.textContent = 'Todas las Tareas';
    } else {
        const f = botoneraFolders.find(x => x.id === folderId);
        heading.textContent = f ? `📁 ${f.name}` : 'Tareas';
    }
    renderBotoneraAssignmentsCards();
}

async function promptBotoneraNewFolder() {
    const name = prompt('Nombre de la nueva carpeta (ej: 8° Básico Ciencias):');
    if (!name || !name.trim()) return;

    try {
        const res = await authFetch('/api/folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim() })
        });
        if (res.ok) {
            showToast('Carpeta creada');
            fetchBotoneraFolders();
        }
    } catch(err) {
        console.error('Error creando carpeta:', err);
    }
}

async function deleteBotoneraFolder(folderId) {
    if (!confirm('¿Eliminar esta carpeta?')) return;
    try {
        const res = await authFetch(`/api/folders/${folderId}`, { method: 'DELETE' });
        if (res.ok) {
            if (botoneraSelectedFolderId === folderId) botoneraSelectedFolderId = null;
            fetchBotoneraFolders();
            fetchBotoneraAssignments();
        }
    } catch(err) {
        console.error('Error eliminando carpeta:', err);
    }
}

async function fetchBotoneraCourses() {
    try {
        const res = await authFetch('/api/courses');
        botoneraCourses = await res.json();
    } catch(e) {}
}

function populateBotoneraCourseDropdown() {
    const sel = document.getElementById('b-assign-course');
    if (!sel) return;
    sel.innerHTML = '<option value="">Selecciona curso...</option>';
    (botoneraCourses || []).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.name} (${c.student_count || 0} alumnos)`;
        sel.appendChild(opt);
    });
}

function populateBotoneraFolderDropdown() {
    const sel = document.getElementById('b-assign-folder');
    if (!sel) return;
    sel.innerHTML = '<option value="">(Sin Carpeta)</option>';
    (botoneraFolders || []).forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.name;
        sel.appendChild(opt);
    });
}

function toggleBotoneraAssignmentForm(show) {
    const form = document.getElementById('botonera-assign-form');
    const isVisible = form.style.display !== 'none';
    const willShow = show !== undefined ? show : !isVisible;

    form.style.display = willShow ? 'block' : 'none';
    if (willShow) {
        document.getElementById('botonera-assign-id').value = '';
        document.getElementById('b-assign-title').value = '';
        document.getElementById('b-assign-instructions').value = '';
        document.getElementById('b-assign-group-check').checked = false;
        document.getElementById('b-assign-group-wrap').style.display = 'none';
        if (botoneraSelectedFolderId) {
            document.getElementById('b-assign-folder').value = botoneraSelectedFolderId;
        }
        document.getElementById('b-assign-title').focus();
    }
}

async function fetchBotoneraAssignments() {
    try {
        const res = await authFetch('/api/assignments');
        botoneraAssignments = await res.json();
        renderBotoneraAssignmentsCards();
    } catch(err) {
        console.error('Error cargando tareas en botonera:', err);
    }
}

let currentBotoneraMatrixId = null;
let currentBotoneraPreviewSub = null;

function toggleBotoneraCustomDuration(val) {
    const customInput = document.getElementById('b-assign-duration-custom');
    if (!customInput) return;
    customInput.style.display = val === 'custom' ? 'inline-block' : 'none';
    if (val === 'custom') customInput.focus();
}

function renderBotoneraAssignmentsCards() {
    const container = document.getElementById('botonera-assignments-cards');
    if (!container) return;

    let filtered = botoneraAssignments;
    if (botoneraSelectedFolderId !== null) {
        filtered = botoneraAssignments.filter(a => a.folder_id === botoneraSelectedFolderId);
    }

    if (!filtered || filtered.length === 0) {
        container.innerHTML = '<p class="text-center text-muted" style="padding:30px;">No hay tareas creadas aquí. Pulsa <strong>+ Nueva Tarea</strong> para comenzar.</p>';
        return;
    }

    container.innerHTML = filtered.map(a => {
        const isActive = a.status === 'active';
        const appLabel = a.app_type === 'writer' ? 'Mini Writer' : (a.app_type === 'calc' ? 'Mini Calc' : (a.app_type === 'slides' ? 'Mini Slides' : 'Cualquier Editor'));
        const modeLabel = a.is_group ? `👥 Grupal (Hasta ${a.max_group_size})` : '👤 Individual';

        return `
            <div class="botonera-assignment-card ${isActive ? 'active-room' : ''}">
                <div class="botonera-assignment-card-top">
                    <div>
                        <h4 style="margin:0; font-size:15px; font-weight:700; display:flex; align-items:center; gap:8px;">
                            ${isActive ? '<span class="badge-active-pulse">● ASIGNADA EN SALA</span>' : ''}
                            <span>${escapeHtml(a.title)}</span>
                        </h4>
                        <div class="botonera-assignment-meta-row" style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px;">
                            <span>🏫 <strong>${escapeHtml(a.course_name)}</strong></span>
                            <span>💻 ${appLabel}</span>
                            <span>${modeLabel}</span>
                            ${a.duration_minutes > 0 ? `<span class="badge" style="background:#2563eb; color:white; font-size:10px; padding:2px 6px; border-radius:4px;">⏳ ${a.duration_minutes}m</span>` : ''}
                            ${a.strict_mode ? `<span class="badge" style="background:#dc2626; color:white; font-size:10px; padding:2px 6px; border-radius:4px;">🔒 Enfoque</span>` : ''}
                            ${a.template_filename ? `<span class="badge" style="background:#059669; color:white; font-size:10px; padding:2px 6px; border-radius:4px;">📁 Plantilla</span>` : ''}
                            ${a.folder_name ? `<span>📁 ${escapeHtml(a.folder_name)}</span>` : ''}
                        </div>
                    </div>
                    <div>
                        <button class="btn-botonera-del" onclick="deleteBotoneraAssignment(${a.id})" title="Eliminar Tarea">🗑️</button>
                    </div>
                </div>

                ${a.instructions ? `<div class="botonera-assignment-instructions">${escapeHtml(a.instructions)}</div>` : ''}

                <div class="botonera-assignment-actions">
                    <div>
                        ${isActive ? `
                            <button class="btn-action" style="background:#eab308; color:#0f172a; font-size:12px; font-weight:700; padding:6px 14px;" onclick="deactivateBotoneraAssignment(${a.id})">
                                ⏹️ Finalizar Asignación
                            </button>
                        ` : `
                            <button class="btn-action btn-send" style="font-size:12px; font-weight:700; padding:6px 14px;" onclick="activateBotoneraAssignment(${a.id})">
                                🚀 Asignar a la Sala
                            </button>
                        `}
                    </div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        <button class="btn-action" style="font-size:12px; padding:6px 10px;" onclick="openBotoneraProgressMatrix(${a.id}, '${escapeHtml(a.title)}', '${escapeHtml(a.course_name)}')">
                            📊 Matriz
                        </button>
                        <button class="btn-action" style="font-size:12px; padding:6px 10px;" onclick="viewBotoneraSubmissions(${a.id}, '${escapeHtml(a.title)}', '${escapeHtml(a.course_name)}', '${escapeHtml(a.teacher_name)}')">
                            📥 Entregas (${a.submission_count || 0})
                        </button>
                        <button class="btn-action btn-send" style="font-size:12px; padding:6px 10px;" onclick="exportBotoneraGradesExcel(${a.id})" title="Exportar Notas a Excel">
                            📗 Excel
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function saveBotoneraAssignment() {
    const id = document.getElementById('botonera-assign-id').value;
    const title = document.getElementById('b-assign-title').value.trim();
    const course_id = document.getElementById('b-assign-course').value;
    const folder_id = document.getElementById('b-assign-folder').value || null;
    const app_type = document.getElementById('b-assign-app').value;
    const is_group = document.getElementById('b-assign-group-check').checked;
    const max_group_size = Number(document.getElementById('b-assign-max-group').value) || 4;
    const instructions = document.getElementById('b-assign-instructions').value.trim();

    if (!title || !course_id) {
        alert('Ingresa un título y selecciona el curso asignado.');
        return;
    }

    let duration = document.getElementById('b-assign-duration').value;
    if (duration === 'custom') {
        duration = document.getElementById('b-assign-duration-custom').value || 0;
    }
    const strict_mode = document.getElementById('b-assign-strict-check').checked ? 1 : 0;

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

    const fileInput = document.getElementById('b-assign-template-file');
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
            showToast(id ? 'Tarea actualizada' : 'Tarea creada correctamente con opciones Pro');
            toggleBotoneraAssignmentForm(false);
            fetchBotoneraAssignments();
        } else {
            const err = await res.json();
            alert('Error al guardar: ' + (err.error || 'No se pudo guardar la tarea'));
        }
    } catch(err) {
        console.error('Error guardando tarea en botonera:', err);
    }
}

async function deleteBotoneraAssignment(id) {
    if (!confirm('¿Eliminar esta tarea y sus entregas?')) return;
    try {
        const res = await authFetch(`/api/assignments/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Tarea eliminada');
            fetchBotoneraAssignments();
        }
    } catch(err) {
        console.error('Error eliminando tarea:', err);
    }
}

async function activateBotoneraAssignment(id) {
    try {
        const res = await authFetch(`/api/assignments/${id}/activate`, { method: 'POST' });
        if (res.ok) {
            showToast('🚀 Tarea asignada en la sala.');
            fetchBotoneraAssignments();
        }
    } catch(err) {
        console.error('Error activando tarea:', err);
    }
}

async function deactivateBotoneraAssignment(id) {
    try {
        const res = await authFetch(`/api/assignments/${id}/deactivate`, { method: 'POST' });
        if (res.ok) {
            showToast('⏹️ Asignación cerrada en la sala.');
            fetchBotoneraAssignments();
        }
    } catch(err) {
        console.error('Error cerrando asignación:', err);
    }
}

// ==============================================================
// MATRIZ Y SEMÁFORO DE AVANCE EN TIEMPO REAL (BOTONERA)
// ==============================================================
async function openBotoneraProgressMatrix(assignId, title, course) {
    currentBotoneraMatrixId = assignId;
    document.getElementById('b-matrix-title').textContent = `📊 Matriz en Vivo: ${title || 'Tarea'}`;
    openModal('modal-botonera-matrix');
    await refreshBotoneraProgressMatrix();
}

async function refreshBotoneraProgressMatrix() {
    if (!currentBotoneraMatrixId) return;
    try {
        const res = await authFetch(`/api/assignments/${currentBotoneraMatrixId}/progress-matrix`);
        if (!res.ok) return;
        const data = await res.json();
        renderBotoneraProgressMatrixData(data);
    } catch(err) {
        console.error('Error actualizando matriz en botonera:', err);
    }
}

function renderBotoneraProgressMatrixData(data) {
    const { assignment, summary, students } = data;

    document.getElementById('b-mat-total').textContent = summary.total || 0;
    document.getElementById('b-mat-notstarted').textContent = summary.not_started || 0;
    document.getElementById('b-mat-working').textContent = summary.working || 0;
    document.getElementById('b-mat-submitted').textContent = (summary.submitted || 0) + (summary.graded || 0);
    document.getElementById('b-mat-returned').textContent = summary.returned || 0;

    const percent = summary.percent_completed || 0;
    document.getElementById('b-mat-percent').textContent = `${percent}%`;
    document.getElementById('b-mat-bar').style.width = `${percent}%`;

    const activeBadge = document.getElementById('b-matrix-active-badge');
    if (activeBadge) {
        activeBadge.style.display = assignment.status === 'active' ? 'inline-block' : 'none';
    }

    const grid = document.getElementById('b-matrix-grid');
    if (!grid) return;

    if (!students || students.length === 0) {
        grid.innerHTML = '<p class="text-center text-muted" style="grid-column:1/-1; padding:20px;">No hay alumnos registrados en el curso.</p>';
        return;
    }

    grid.innerHTML = students.map(s => {
        let badgeHtml = '';
        let borderCol = 'rgba(255,255,255,0.08)';
        let bg = 'rgba(15, 23, 42, 0.6)';

        if (s.status === 'graded') {
            badgeHtml = `<span class="badge" style="background:#10b981; color:white; font-size:10px;">🟢 Calificado (${s.submission?.grade || 'OK'})</span>`;
            borderCol = '#10b981';
            bg = 'rgba(16, 185, 129, 0.12)';
        } else if (s.status === 'submitted') {
            badgeHtml = `<span class="badge" style="background:#10b981; color:white; font-size:10px;">🟢 Entregado</span>`;
            borderCol = '#10b981';
            bg = 'rgba(16, 185, 129, 0.08)';
        } else if (s.status === 'returned') {
            badgeHtml = `<span class="badge" style="background:#ea580c; color:white; font-size:10px;">🟠 En Corrección</span>`;
            borderCol = '#ea580c';
            bg = 'rgba(234, 88, 12, 0.12)';
        } else if (s.status === 'working') {
            badgeHtml = `<span class="badge" style="background:#ca8a04; color:white; font-size:10px;">🟡 Trabajando</span>`;
            borderCol = '#ca8a04';
            bg = 'rgba(202, 138, 4, 0.12)';
        } else {
            badgeHtml = `<span class="badge" style="background:#475569; color:#cbd5e1; font-size:10px;">⚪ Sin Iniciar</span>`;
        }

        let details = '';
        if (s.client_name) details += `<small style="display:block; color:var(--text-dim); font-size:10px;">PC: ${escapeHtml(s.client_name)}</small>`;
        if (s.metrics?.words) details += `<small style="display:block; color:var(--led-blue); font-size:10px;">📝 ${s.metrics.words} palabras</small>`;

        return `
            <div style="background:${bg}; border:1px solid ${borderCol}; border-radius:6px; padding:8px 10px; display:flex; flex-direction:column; justify-content:space-between;">
                <div>
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:4px;">
                        <strong style="font-size:12px; color:#f8fafc;">${escapeHtml(s.full_name)}</strong>
                        ${badgeHtml}
                    </div>
                    ${details}
                </div>
                ${s.submission ? `
                    <div style="margin-top:6px; display:flex; justify-content:flex-end;">
                        <button class="btn-action" style="padding:2px 8px; font-size:10px;" onclick="previewBotoneraSubmissionObject(${JSON.stringify(s.submission).replace(/"/g, '&quot;')})">
                            👁️ Ver/Calificar
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

function exportBotoneraGradesExcel(assignId) {
    if (!assignId) return;
    window.location.href = `/api/assignments/${assignId}/export-grades`;
}

// ==============================================================
// BANDEJA DE ENTREGAS Y DESCARGA ZIP EN LA BOTONERA
// ==============================================================
async function viewBotoneraSubmissions(assignId, title, course, teacher) {
    botoneraViewingAssignId = assignId;
    document.getElementById('b-sub-task-name').textContent = title;
    document.getElementById('b-sub-task-meta').textContent = `${course} • Profesor: ${teacher}`;
    openModal('modal-botonera-submissions');
    await refreshBotoneraSubmissions();
}

async function refreshBotoneraSubmissions() {
    if (!botoneraViewingAssignId) return;
    try {
        const res = await fetch(`/api/assignments/${botoneraViewingAssignId}/submissions`);
        const submissions = await res.json();
        renderBotoneraSubmissionsTable(submissions);
    } catch(err) {
        console.error('Error obteniendo entregas en botonera:', err);
    }
}

function renderBotoneraSubmissionsTable(submissions) {
    const tbody = document.getElementById('b-submissions-tbody');
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

        const dateStr = s.created_at ? new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';

        let statusBadge = '<span class="badge" style="background:#10b981; color:white; font-size:10px; padding:2px 6px; border-radius:4px;">Entregado</span>';
        if (s.status === 'graded') {
            statusBadge = '<span class="badge" style="background:#059669; color:white; font-size:10px; padding:2px 6px; border-radius:4px;">Calificado</span>';
        } else if (s.status === 'returned') {
            statusBadge = '<span class="badge" style="background:#ea580c; color:white; font-size:10px; padding:2px 6px; border-radius:4px;">Devuelto</span>';
        }

        const gradeDisplay = s.grade ? `<strong style="color:var(--led-blue); font-size:13px;">${escapeHtml(s.grade)}</strong>` : '<span style="color:var(--text-dim);">-</span>';

        return `
            <tr>
                <td><small>${dateStr}</small></td>
                <td>${studentText}</td>
                <td><small>${escapeHtml(s.client_name || s.client_id)}</small></td>
                <td>${statusBadge}</td>
                <td>${gradeDisplay}</td>
                <td><small>${escapeHtml(s.filename)}</small></td>
                <td>
                    <button class="btn-action" style="padding:2px 8px; font-size:11px;" onclick="previewBotoneraSubmissionObject(${JSON.stringify(s).replace(/"/g, '&quot;')})">👁️ Calificar</button>
                    <a href="${s.file_path}" class="btn-action" download="${escapeHtml(s.filename)}" style="padding:2px 8px; font-size:11px; text-decoration:none;">⬇️</a>
                    <button class="btn-botonera-del" onclick="deleteBotoneraSubmissionRecord(${s.id})">🗑️</button>
                </td>
            </tr>
        `;
    }).join('');
}

function downloadBotoneraSubmissionsZip() {
    if (!botoneraViewingAssignId) return;
    window.location.href = `/api/assignments/${botoneraViewingAssignId}/download-all`;
}

function previewBotoneraSubmissionObject(submission) {
    currentBotoneraPreviewSub = submission;
    const frame = document.getElementById('b-preview-frame');
    const pre = document.getElementById('b-preview-text');
    const titleEl = document.getElementById('b-preview-title');
    const downloadBtn = document.getElementById('b-preview-download-btn');

    titleEl.textContent = `👁️ ${submission.filename} (${submission.main_student_name || 'Estudiante'})`;
    downloadBtn.href = submission.file_path;
    downloadBtn.download = submission.filename;

    const gradeInput = document.getElementById('b-preview-grade-input');
    const feedbackInput = document.getElementById('b-preview-feedback-input');
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

    openModal('modal-botonera-preview');
}

async function saveBotoneraPreviewGrade() {
    if (!currentBotoneraPreviewSub) return;
    const grade = document.getElementById('b-preview-grade-input').value.trim();
    const feedback = document.getElementById('b-preview-feedback-input').value.trim();

    try {
        const res = await authFetch(`/api/submissions/${currentBotoneraPreviewSub.id}/grade`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grade, feedback })
        });
        if (res.ok) {
            showToast('✅ Calificación guardada');
            currentBotoneraPreviewSub.grade = grade;
            currentBotoneraPreviewSub.feedback = feedback;
            currentBotoneraPreviewSub.status = 'graded';
            if (botoneraViewingAssignId) refreshBotoneraSubmissions();
            if (currentBotoneraMatrixId) refreshBotoneraProgressMatrix();
        } else {
            alert('Error al guardar nota.');
        }
    } catch(err) {
        console.error('Error guardando nota:', err);
    }
}

async function returnBotoneraPreviewSubmission() {
    if (!currentBotoneraPreviewSub) return;
    const feedback = document.getElementById('b-preview-feedback-input').value.trim();
    if (!confirm('¿Devolver trabajo al estudiante para corrección?')) return;

    try {
        const res = await authFetch(`/api/submissions/${currentBotoneraPreviewSub.id}/return`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ feedback })
        });
        if (res.ok) {
            showToast('↩️ Tarea devuelta al estudiante');
            closeModal('modal-botonera-preview');
            if (botoneraViewingAssignId) refreshBotoneraSubmissions();
            if (currentBotoneraMatrixId) refreshBotoneraProgressMatrix();
        } else {
            alert('Error al devolver entrega.');
        }
    } catch(err) {
        console.error('Error devolviendo entrega:', err);
    }
}

async function deleteBotoneraSubmissionRecord(id) {
    if (!confirm('¿Eliminar esta entrega permanentemente?')) return;
    try {
        const res = await authFetch(`/api/submissions/${id}`, { method: 'DELETE' });
        if (res.ok) {
            showToast('Entrega eliminada');
            refreshBotoneraSubmissions();
            fetchBotoneraAssignments();
        }
    } catch(err) {
        console.error('Error eliminando entrega en botonera:', err);
    }
}

