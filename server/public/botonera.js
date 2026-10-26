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

// ==============================================================
// INICIALIZACIÓN
// ==============================================================
document.addEventListener('DOMContentLoaded', async () => {
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

    socket.on('new_turn_in', () => {
        updateRoomSummary();
        showToast('📥 ¡Nueva tarea entregada por un alumno!');
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
