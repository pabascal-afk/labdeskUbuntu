// LabDesk Desktop Shell Renderer Logic & Window Manager

let openWindows = new Map();
let highestZIndex = 100;
let currentVolume = 50;
let isMuted = false;

document.addEventListener('DOMContentLoaded', async () => {
    initClock();
    initSystemInfo();
    initAudioControls();
    initStartMenu();
    initRemoteListeners();
});

// ==========================================
// RELOJ Y SISTEMA
// ==========================================
function initClock() {
    const clockEl = document.getElementById('tray-clock');
    const updateTime = () => {
        const now = new Date();
        clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    updateTime();
    setInterval(updateTime, 1000);
}

async function initSystemInfo() {
    if (window.labdeskAPI) {
        const info = await window.labdeskAPI.system.getInfo();
        document.getElementById('machine-tag').textContent = info.hostname || 'LabDesk';
        document.getElementById('user-machine-name').textContent = `${info.hostname} (${info.ip})`;
    }
}

// ==========================================
// AUDIO
// ==========================================
// SVG Helpers para iconos libres de emojis (evita cajas o tofu)
const SVG_AUDIO_ON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
const SVG_AUDIO_MUTED = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;

async function initAudioControls() {
    const muteBtn = document.getElementById('btn-tray-mute');
    const slider = document.getElementById('tray-vol-slider');
    const volText = document.getElementById('audio-vol-text');
    const popup = document.getElementById('tray-audio-popup');
    const trayWrap = document.getElementById('tray-audio-wrap');
    const usbAutoBtn = document.getElementById('btn-tray-usb-auto');

    // Cargar estado inicial
    muteBtn.innerHTML = SVG_AUDIO_ON;
    if (window.labdeskAPI) {
        const state = await window.labdeskAPI.audio.get();
        currentVolume = state.volume;
        isMuted = state.isMuted;
        slider.value = currentVolume;
        volText.textContent = `${currentVolume}%`;
        muteBtn.innerHTML = isMuted ? SVG_AUDIO_MUTED : SVG_AUDIO_ON;
        refreshAudioDeviceSelectors();
    }

    // Toggle popup
    muteBtn.onclick = (e) => {
        e.stopPropagation();
        const willShow = !popup.classList.contains('show');
        popup.classList.toggle('show');
        if (willShow) refreshAudioDeviceSelectors();
        syncBrowserBounds();
    };

    document.addEventListener('click', (e) => {
        if (!trayWrap.contains(e.target)) {
            if (popup.classList.contains('show')) {
                popup.classList.remove('show');
                syncBrowserBounds();
            }
        }
    });

    // Botón Activar Audífonos USB automático
    if (usbAutoBtn) {
        usbAutoBtn.onclick = async (e) => {
            e.stopPropagation();
            usbAutoBtn.textContent = '⏳ Buscando...';
            if (window.labdeskAPI && window.labdeskAPI.audio.autoSelectUsb) {
                await window.labdeskAPI.audio.autoSelectUsb();
                await refreshAudioDeviceSelectors();
                const state = await window.labdeskAPI.audio.get();
                currentVolume = state.volume;
                slider.value = currentVolume;
                volText.textContent = `${currentVolume}%`;
                muteBtn.innerHTML = SVG_AUDIO_ON;
            }
            usbAutoBtn.textContent = '🎧 Activar USB';
        };
    }

    // Deslizador
    slider.oninput = (e) => {
        const val = parseInt(e.target.value, 10);
        volText.textContent = `${val}%`;
        currentVolume = val;
        isMuted = false;
        muteBtn.innerHTML = SVG_AUDIO_ON;
        if (window.labdeskAPI) window.labdeskAPI.audio.set(val);
    };

    // Doble clic en icono de silencio
    muteBtn.ondblclick = async () => {
        if (window.labdeskAPI) {
            const res = await window.labdeskAPI.audio.toggleMute();
            isMuted = res.isMuted;
            muteBtn.innerHTML = isMuted ? SVG_AUDIO_MUTED : SVG_AUDIO_ON;
        }
    };
}

async function refreshAudioDeviceSelectors() {
    if (!window.labdeskAPI || !window.labdeskAPI.audio.getDevices) return;
    try {
        const { outputs, inputs, defaultSink, defaultSource } = await window.labdeskAPI.audio.getDevices();
        const sinkSelect = document.getElementById('tray-sink-select');
        const sourceSelect = document.getElementById('tray-source-select');

        if (sinkSelect) {
            sinkSelect.innerHTML = '';
            if (!outputs || outputs.length === 0) {
                sinkSelect.innerHTML = '<option value="">Salida por defecto</option>';
            } else {
                outputs.forEach(o => {
                    const opt = document.createElement('option');
                    opt.value = o.name;
                    opt.textContent = `${o.isUsb ? '🎧' : '🔊'} ${o.description}`;
                    if (o.isDefault || o.name === defaultSink) opt.selected = true;
                    sinkSelect.appendChild(opt);
                });
            }
            sinkSelect.onchange = async () => {
                if (sinkSelect.value && window.labdeskAPI.audio.setSink) {
                    await window.labdeskAPI.audio.setSink(sinkSelect.value);
                }
            };
        }

        if (sourceSelect) {
            sourceSelect.innerHTML = '';
            if (!inputs || inputs.length === 0) {
                sourceSelect.innerHTML = '<option value="">Micrófono por defecto</option>';
            } else {
                inputs.forEach(i => {
                    const opt = document.createElement('option');
                    opt.value = i.name;
                    opt.textContent = `${i.isUsb ? '🎤' : '🎙️'} ${i.description}`;
                    if (i.isDefault || i.name === defaultSource) opt.selected = true;
                    sourceSelect.appendChild(opt);
                });
            }
            sourceSelect.onchange = async () => {
                if (sourceSelect.value && window.labdeskAPI.audio.setSource) {
                    await window.labdeskAPI.audio.setSource(sourceSelect.value);
                }
            };
        }
    } catch(e) {
        console.error('Error refreshing audio devices:', e);
    }
}

// ==========================================
// MENÚ DE INICIO
// ==========================================
function initStartMenu() {
    const btnStart = document.getElementById('btn-start');
    const menu = document.getElementById('start-menu');

    btnStart.onclick = (e) => {
        e.stopPropagation();
        menu.classList.toggle('show');
        syncBrowserBounds();
    };

    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target) && e.target !== btnStart) {
            if (menu.classList.contains('show')) {
                menu.classList.remove('show');
                syncBrowserBounds();
            }
        }
    });
}

function clearGoogleSessionPrompt() {
    if (confirm('¿Cerrar sesión de Google y limpiar datos de navegación en este puesto?')) {
        if (window.labdeskAPI) window.labdeskAPI.browser.clearSession();
        alert('Sesión de Google cerrada exitosamente.');
    }
}

// ==========================================
// GESTOR DE VENTANAS (WINDOW MANAGER)
// ==========================================
const APPS_META = {
    writer: {
        title: 'Mini Writer',
        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>',
        url: 'apps/writer/index.html',
        w: 860,
        h: 580
    },
    calc: {
        title: 'Mini Calc',
        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>',
        url: 'apps/calc/index.html',
        w: 880,
        h: 600
    },
    slides: {
        title: 'Mini Slides',
        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line><polygon points="10 7 15 10 10 13 10 7" fill="currentColor"></polygon></svg>',
        url: 'apps/slides/index.html',
        w: 920,
        h: 620
    },
    browser: {
        title: 'Navegador Educativo',
        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>',
        url: 'apps/browser/index.html',
        w: 980,
        h: 640
    },
    files: {
        title: 'Mis Trabajos',
        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
        url: 'apps/files/index.html',
        w: 720,
        h: 500
    }
};

let isKioskExamActive = false;

function applyKioskModeState(isKiosk) {
    isKioskExamActive = !!isKiosk;
    const win = document.getElementById('win_browser');
    if (!win) return;

    const minBtn = win.querySelector('.win-btn-min');
    const maxBtn = win.querySelector('.win-btn-max');
    const closeBtn = win.querySelector('.win-btn-close');

    if (isKioskExamActive) {
        if (minBtn) minBtn.style.display = 'none';
        if (closeBtn) closeBtn.style.display = 'none';
        if (maxBtn) maxBtn.style.display = 'none';

        win.style.width = '100vw';
        win.style.height = 'calc(100vh - 48px)';
        win.style.left = '0px';
        win.style.top = '0px';
        bringToFront(win);
        win.classList.add('window-kiosk-locked');
    } else {
        if (minBtn) minBtn.style.display = 'flex';
        if (closeBtn) closeBtn.style.display = 'flex';
        if (maxBtn) maxBtn.style.display = 'flex';
        win.classList.remove('window-kiosk-locked');
    }
    syncBrowserBounds();
}

function openApp(appKey, customUrl = null) {
    if (isKioskExamActive && appKey !== 'browser') {
        showTeacherAnnouncement('🔒 Modo Examen (Página Cautiva) activo: Solo se permite la ventana de evaluación.');
        return;
    }
    document.getElementById('start-menu').classList.remove('show');
    const meta = APPS_META[appKey];
    if (!meta) return;

    const winId = `win_${appKey}`;

    // Si ya existe la ventana, traer al frente
    if (openWindows.has(winId)) {
        const winEl = openWindows.get(winId).element;
        bringToFront(winEl);
        if (winEl.style.display === 'none') winEl.style.display = 'flex';
        return;
    }

    createWindowElement(winId, meta, customUrl);
}

function openGoogleApp(googleUrl) {
    openApp('browser');
    if (window.labdeskAPI) {
        window.labdeskAPI.browser.openTab(googleUrl);
    }
}

function createWindowElement(winId, meta, initialUrl) {
    const container = document.getElementById('windows-container');
    const win = document.createElement('div');
    win.className = 'window';
    win.id = winId;
    win.style.width = `${meta.w}px`;
    win.style.height = `${meta.h}px`;
    win.style.left = `${Math.max(40, (window.innerWidth - meta.w) / 2 + (openWindows.size * 20))}px`;
    win.style.top = `${Math.max(30, (window.innerHeight - meta.h) / 2 + (openWindows.size * 20))}px`;
    win.style.zIndex = ++highestZIndex;

    win.innerHTML = `
        <div class="window-header">
            <div class="window-title">
                <span>${meta.icon}</span>
                <span>${meta.title}</span>
            </div>
            <div class="window-controls">
                <button class="win-btn win-btn-min" title="Minimizar">─</button>
                <button class="win-btn win-btn-max" title="Maximizar">□</button>
                <button class="win-btn win-btn-close" title="Cerrar">✕</button>
            </div>
        </div>
        <div class="window-body">
            <iframe class="window-iframe" src="${initialUrl || meta.url}"></iframe>
        </div>
    `;

    // Eventos de control de ventana
    win.querySelector('.win-btn-close').onclick = () => closeWindow(winId);
    win.querySelector('.win-btn-min').onclick = () => minimizeWindow(winId);
    win.querySelector('.win-btn-max').onclick = () => toggleMaximizeWindow(winId);

    // Arrastre por la barra de título
    setupWindowDrag(win);

    win.onmousedown = () => bringToFront(win);

    container.appendChild(win);

    // Añadir a la barra de tareas
    addTaskbarItem(winId, meta);

    if (winId === 'win_browser') {
        // En el navegador, abrir maximizado por defecto para mejor experiencia visual
        win.style.width = '100vw';
        win.style.height = 'calc(100vh - 48px)';
        win.style.left = '0px';
        win.style.top = '0px';
        openWindows.set(winId, { element: win, meta, isMaximized: true, prevLeft: '40px', prevTop: '30px' });
        if (isKioskExamActive) {
            applyKioskModeState(true);
        }
        setTimeout(syncBrowserBounds, 120);
    } else {
        openWindows.set(winId, { element: win, meta, isMaximized: false });
    }
}

// Sincronizar posición exacta del motor de navegación con la ventana flotante
function syncBrowserBounds() {
    const win = document.getElementById('win_browser');
    if (!win || !window.labdeskAPI) return;

    if (win.style.display === 'none') {
        window.labdeskAPI.browser.hideTabs();
        return;
    }

    // Si el menú de inicio o el popup de audio están abiertos, ocultar la vista nativa del navegador
    // para que NO tape el menú de inicio ni los controles de volumen/dispositivos
    const startMenu = document.getElementById('start-menu');
    const isStartMenuOpen = startMenu && startMenu.classList.contains('show');

    const audioPopup = document.getElementById('tray-audio-popup');
    const isAudioPopupOpen = audioPopup && audioPopup.classList.contains('show');

    const lockOverlay = document.getElementById('screen-lock');
    const isLocked = lockOverlay && lockOverlay.classList.contains('show');

    if (isStartMenuOpen || isAudioPopupOpen || isLocked) {
        window.labdeskAPI.browser.hideTabs();
        return;
    }

    // Si otra ventana está por encima (mayor z-index), ocultar la vista nativa para que no tape las otras apps
    let isCovered = false;
    const myZ = parseInt(win.style.zIndex || '0', 10);
    openWindows.forEach((wData, wId) => {
        if (wId !== 'win_browser' && wData.element && wData.element.style.display !== 'none') {
            const otherZ = parseInt(wData.element.style.zIndex || '0', 10);
            if (otherZ > myZ) isCovered = true;
        }
    });

    if (isCovered) {
        window.labdeskAPI.browser.hideTabs();
        return;
    }

    // Calcular coordenadas exactas relativas a la pantalla de la ventana
    const winRect = win.getBoundingClientRect();
    const titleBarHeight = 38;

    // Intentar medir el contenedor webview-placeholder dentro del iframe con precisión de píxel
    const iframe = win.querySelector('.window-iframe');
    try {
        if (iframe && iframe.contentDocument) {
            const placeholder = iframe.contentDocument.getElementById('webview-placeholder');
            if (placeholder) {
                const pRect = placeholder.getBoundingClientRect();
                const x = Math.max(0, Math.round(winRect.left + pRect.left));
                const y = Math.max(0, Math.round(winRect.top + titleBarHeight + pRect.top));
                const width = Math.max(50, Math.round(pRect.width));
                const height = Math.max(50, Math.round(pRect.height));

                window.labdeskAPI.browser.updateBounds({ x, y, width, height });
                window.labdeskAPI.browser.showTabs();
                return;
            }
        }
    } catch(e) {}

    const browserControlsHeight = isKioskExamActive ? 82 : 112;
    const x = Math.max(0, Math.round(winRect.left));
    const y = Math.max(0, Math.round(winRect.top + titleBarHeight + browserControlsHeight));
    const width = Math.max(50, Math.round(winRect.width));
    const height = Math.max(50, Math.round(winRect.height - titleBarHeight - browserControlsHeight));

    window.labdeskAPI.browser.updateBounds({ x, y, width, height });
    window.labdeskAPI.browser.showTabs();
}
window.syncBrowserBounds = syncBrowserBounds;
window.addEventListener('resize', syncBrowserBounds);

function bringToFront(winEl) {
    winEl.style.zIndex = ++highestZIndex;
    const winId = winEl.id;
    document.querySelectorAll('.taskbar-item').forEach(item => {
        item.classList.toggle('active', item.dataset.winId === winId);
    });
    syncBrowserBounds();
}

function closeWindow(winId) {
    if (isKioskExamActive && winId === 'win_browser') {
        showTeacherAnnouncement('🔒 La ventana de evaluación no se puede cerrar durante el examen.');
        return;
    }
    if (!openWindows.has(winId)) return;
    const winEl = openWindows.get(winId).element;
    winEl.remove();
    openWindows.delete(winId);

    const taskItem = document.querySelector(`.taskbar-item[data-win-id="${winId}"]`);
    if (taskItem) taskItem.remove();

    if (winId === 'win_browser' && window.labdeskAPI) {
        window.labdeskAPI.browser.hideTabs();
    }
}

function minimizeWindow(winId) {
    if (isKioskExamActive && winId === 'win_browser') {
        return;
    }
    if (!openWindows.has(winId)) return;
    const winEl = openWindows.get(winId).element;
    winEl.style.display = 'none';

    const taskItem = document.querySelector(`.taskbar-item[data-win-id="${winId}"]`);
    if (taskItem) taskItem.classList.remove('active');

    syncBrowserBounds();
}

function toggleMaximizeWindow(winId) {
    if (!openWindows.has(winId)) return;
    const data = openWindows.get(winId);
    const winEl = data.element;

    if (data.isMaximized) {
        winEl.style.width = `${data.meta.w}px`;
        winEl.style.height = `${data.meta.h}px`;
        winEl.style.left = data.prevLeft;
        winEl.style.top = data.prevTop;
        data.isMaximized = false;
    } else {
        data.prevLeft = winEl.style.left;
        data.prevTop = winEl.style.top;
        winEl.style.width = '100vw';
        winEl.style.height = 'calc(100vh - 48px)';
        winEl.style.left = '0px';
        winEl.style.top = '0px';
        data.isMaximized = true;
    }
    if (winId === 'win_browser') {
        setTimeout(syncBrowserBounds, 60);
    }
}

function addTaskbarItem(winId, meta) {
    const container = document.getElementById('taskbar-apps');
    const item = document.createElement('div');
    item.className = 'taskbar-item active';
    item.dataset.winId = winId;
    item.innerHTML = `<span>${meta.icon}</span> <span>${meta.title}</span>`;

    item.onclick = () => {
        const winEl = openWindows.get(winId).element;
        if (winEl.style.display === 'none') {
            winEl.style.display = 'flex';
            bringToFront(winEl);
        } else if (winEl.style.zIndex == highestZIndex) {
            minimizeWindow(winId);
        } else {
            bringToFront(winEl);
        }
    };

    container.appendChild(item);
}

function setupWindowDrag(winEl) {
    const header = winEl.querySelector('.window-header');
    let isDragging = false;
    let startX, startY, initialX, initialY;

    header.onmousedown = (e) => {
        if (e.target.closest('.window-controls')) return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        initialX = winEl.offsetLeft;
        initialY = winEl.offsetTop;
        document.body.style.cursor = 'move';
    };

    document.onmousemove = (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        winEl.style.left = `${Math.max(0, initialX + dx)}px`;
        winEl.style.top = `${Math.max(0, initialY + dy)}px`;
        if (winEl.id === 'win_browser') {
            syncBrowserBounds();
        }
    };

    document.onmouseup = () => {
        if (isDragging) {
            isDragging = false;
            document.body.style.cursor = 'default';
            if (winEl.id === 'win_browser') {
                syncBrowserBounds();
            }
        }
    };
}

// ==========================================
// LISTENERS REMOTOS DEL PROFESOR
// ==========================================
function initRemoteListeners() {
    if (!window.labdeskAPI) return;

    // Estado del servidor
    window.labdeskAPI.connection.onServerConnectionChanged(({ connected }) => {
        const dot = document.getElementById('conn-dot');
        dot.className = `status-dot ${connected ? 'dot-online' : 'dot-offline'}`;
    });

    // Estado y pestañas del navegador
    window.labdeskAPI.browser.onStateChanged((state) => {
        applyKioskModeState(state.isKioskExam);
    });

    // Orden remota del docente para abrir una pestaña o página cautiva
    window.labdeskAPI.browser.onRemoteOpenUrl((payload) => {
        openApp('browser');
        if (payload.url) {
            window.labdeskAPI.browser.openTab(payload.url, payload.isKiosk);
        }
        if (payload.isKiosk) {
            applyKioskModeState(true);
        }
    });

    // Cambios de audio
    window.labdeskAPI.audio.onStateChanged((state) => {
        currentVolume = state.volume;
        isMuted = state.isMuted;
        document.getElementById('tray-vol-slider').value = currentVolume;
        document.getElementById('audio-vol-text').textContent = `${currentVolume}%`;
        document.getElementById('btn-tray-mute').textContent = isMuted ? '🔇' : '🔊';
    });

    // Avisos del profesor en pantalla
    window.labdeskAPI.system.onAnnouncement((msg) => {
        showTeacherAnnouncement(msg);
    });
}

function showTeacherAnnouncement(msg) {
    let banner = document.getElementById('teacher-announcement-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'teacher-announcement-banner';
        banner.style.cssText = `
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            background: linear-gradient(135deg, #1e3a8a, #2563eb);
            color: white; border: 2px solid #60a5fa;
            border-radius: 12px; padding: 16px 28px;
            font-size: 16px; font-weight: 600;
            box-shadow: 0 20px 25px -5px rgba(0,0,0,0.7);
            z-index: 99999; display: flex; align-items: center; gap: 12px;
            animation: slideDown 0.3s ease;
        `;
        document.body.appendChild(banner);
    }
    banner.innerHTML = `<span>📢</span> <span>${escapeHtml(msg || 'Aviso del Profesor')}</span>`;
    setTimeout(() => {
        if (banner) banner.remove();
    }, 8000);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
