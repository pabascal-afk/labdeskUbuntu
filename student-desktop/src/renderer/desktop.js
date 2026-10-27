// LabDesk Desktop Shell Renderer Logic & Hybrid Browser Manager

let openWindows = new Map();
let highestZIndex = 100;
let currentVolume = 50;
let isMuted = false;
let isKioskExamActive = false;
let activeInternalWinId = null;
let browserState = {
    isKioskExam: false,
    captiveUrl: '',
    currentCaptiveUrl: '',
    captiveTitle: 'Evaluación en Curso',
    externalBrowserRunning: false,
    externalBrowserFocused: false
};

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
const SVG_AUDIO_ON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
const SVG_AUDIO_MUTED = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;

async function initAudioControls() {
    const muteBtn = document.getElementById('btn-tray-mute');
    const slider = document.getElementById('tray-vol-slider');
    const volText = document.getElementById('audio-vol-text');
    const popup = document.getElementById('tray-audio-popup');
    const trayWrap = document.getElementById('tray-audio-wrap');
    const usbAutoBtn = document.getElementById('btn-tray-usb-auto');

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

    slider.oninput = (e) => {
        const val = parseInt(e.target.value, 10);
        volText.textContent = `${val}%`;
        currentVolume = val;
        isMuted = false;
        muteBtn.innerHTML = SVG_AUDIO_ON;
        if (window.labdeskAPI) window.labdeskAPI.audio.set(val);
    };

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
    } catch (e) {
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
        if (isKioskExamActive) {
            showTeacherAnnouncement('🔒 Modo Examen activo: El menú de aplicaciones está deshabilitado durante la evaluación.');
            return;
        }
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

async function clearGoogleSessionPrompt() {
    document.getElementById('start-menu').classList.remove('show');
    if (confirm('¿Cerrar sesión de Google y limpiar todas las cuentas y datos de navegación en este puesto?')) {
        if (window.labdeskAPI) {
            await window.labdeskAPI.browser.clearSession();
        }
        showTeacherAnnouncement('🧹 Sesión de Google y datos del navegador eliminados correctamente.');
    }
    syncBrowserBounds();
}

// ==========================================
// GESTOR DE APLICACIONES Y NAVEGADOR HÍBRIDO
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
    files: {
        title: 'Mis Trabajos',
        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
        url: 'apps/files/index.html',
        w: 720,
        h: 500
    }
};

const BROWSER_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:4px;"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>';

function applyBrowserState(state) {
    if (!state) return;
    browserState = state;
    isKioskExamActive = !!state.isKioskExam;

    const captiveOverlay = document.getElementById('captive-exam-overlay');
    const titleLabel = document.getElementById('captive-title-label');
    const urlLabel = document.getElementById('captive-url-label');

    if (isKioskExamActive) {
        // Cerrar menú de inicio y minimizar ventanas internas durante el examen
        document.getElementById('start-menu').classList.remove('show');
        openWindows.forEach((wData) => {
            if (wData.element) wData.element.style.display = 'none';
        });
        activeInternalWinId = null;

        if (titleLabel) titleLabel.textContent = state.captiveTitle || 'Evaluación en Curso';
        if (urlLabel) urlLabel.textContent = state.currentCaptiveUrl || state.captiveUrl || '';
        if (captiveOverlay) captiveOverlay.classList.add('show');
    } else {
        if (captiveOverlay) captiveOverlay.classList.remove('show');
    }

    updateExternalBrowserTaskbar(state);
    syncBrowserBounds();
}

function updateExternalBrowserTaskbar(state) {
    const container = document.getElementById('taskbar-apps');
    let item = document.getElementById('taskbar-item-external-browser');

    if (state.externalBrowserRunning && !state.isKioskExam) {
        if (!item) {
            item = document.createElement('div');
            item.id = 'taskbar-item-external-browser';
            item.className = 'taskbar-item';
            item.innerHTML = `<span>${BROWSER_ICON_SVG}</span> <span>Navegador Web</span>`;
            item.onclick = () => {
                if (browserState.externalBrowserFocused && !activeInternalWinId) {
                    window.labdeskAPI.browser.minimizeExternal();
                } else {
                    // Minimizar ventanas internas de LabDesk para ver el navegador estándar
                    openWindows.forEach((wData, wId) => {
                        wData.element.style.display = 'none';
                        const tItem = document.querySelector(`.taskbar-item[data-win-id="${wId}"]`);
                        if (tItem) tItem.classList.remove('active');
                    });
                    activeInternalWinId = null;
                    window.labdeskAPI.browser.focusExternal();
                }
            };
            container.prepend(item);
        }
        const isBrowserActive = state.externalBrowserFocused && !activeInternalWinId;
        item.classList.toggle('active', isBrowserActive);
    } else if (item) {
        item.remove();
    }
}

function goHomeCaptive() {
    if (window.labdeskAPI) {
        window.labdeskAPI.browser.goHomeCaptive();
    }
}

function reloadCaptive() {
    if (window.labdeskAPI) {
        window.labdeskAPI.browser.reloadCaptive();
    }
}

function openApp(appKey, customUrl = null) {
    document.getElementById('start-menu').classList.remove('show');

    if (isKioskExamActive) {
        showTeacherAnnouncement('🔒 Modo Examen (Página Cautiva) activo: Solo se permite la ventana de evaluación.');
        syncBrowserBounds();
        return;
    }

    // Si es el navegador en modo normal, lanzar el navegador estándar del sistema (Chromium/Firefox)
    if (appKey === 'browser') {
        openWindows.forEach((wData, wId) => {
            wData.element.style.display = 'none';
            const tItem = document.querySelector(`.taskbar-item[data-win-id="${wId}"]`);
            if (tItem) tItem.classList.remove('active');
        });
        activeInternalWinId = null;

        if (window.labdeskAPI) {
            window.labdeskAPI.browser.openTab(customUrl || 'https://www.google.com', false);
        }
        syncBrowserBounds();
        return;
    }

    const meta = APPS_META[appKey];
    if (!meta) return;

    const winId = `win_${appKey}`;

    if (openWindows.has(winId)) {
        const winEl = openWindows.get(winId).element;
        if (winEl.style.display === 'none') winEl.style.display = 'flex';
        bringToFront(winEl);
        return;
    }

    createWindowElement(winId, meta, customUrl);
}

function openGoogleApp(googleUrl) {
    openApp('browser', googleUrl);
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

    win.querySelector('.win-btn-close').onclick = () => closeWindow(winId);
    win.querySelector('.win-btn-min').onclick = () => minimizeWindow(winId);
    win.querySelector('.win-btn-max').onclick = () => toggleMaximizeWindow(winId);

    setupWindowDrag(win);
    win.onmousedown = () => bringToFront(win);

    container.appendChild(win);
    openWindows.set(winId, { element: win, meta, isMaximized: false });

    addTaskbarItem(winId, meta);
    bringToFront(win);
}

// Sincronizar capas (Menú Inicio / Audio / Ventanas Internas / Visor Cautivo)
function syncBrowserBounds() {
    if (!window.labdeskAPI) return;

    const startMenu = document.getElementById('start-menu');
    const isStartMenuOpen = startMenu && startMenu.classList.contains('show');

    const audioPopup = document.getElementById('tray-audio-popup');
    const isAudioPopupOpen = audioPopup && audioPopup.classList.contains('show');

    const lockOverlay = document.getElementById('lockscreen');
    const isLocked = lockOverlay && lockOverlay.classList.contains('show');

    // Caso 1: Modo Examen (Página Cautiva) Activo
    if (isKioskExamActive) {
        if (isStartMenuOpen || isAudioPopupOpen || isLocked) {
            window.labdeskAPI.browser.hideTabs();
            return;
        }

        const area = document.getElementById('captive-webview-area');
        if (area) {
            const rect = area.getBoundingClientRect();
            const x = Math.max(0, Math.round(rect.left));
            const y = Math.max(44, Math.round(rect.top));
            const width = Math.max(100, Math.round(rect.width || window.innerWidth));
            const height = Math.max(100, Math.round(rect.height || (window.innerHeight - 92)));

            window.labdeskAPI.browser.updateBounds({ x, y, width, height });
            window.labdeskAPI.browser.showTabs();
        }
        return;
    }

    // Caso 2: Modo Normal (Convivencia con navegador estándar y apps de LabDesk)
    let hasVisibleInternalWindow = false;
    openWindows.forEach((wData) => {
        if (wData.element && wData.element.style.display !== 'none') {
            hasVisibleInternalWindow = true;
        }
    });

    const needsLabDeskOnTop = isStartMenuOpen || isAudioPopupOpen || isLocked || hasVisibleInternalWindow;
    window.labdeskAPI.system.setOverlayMode(needsLabDeskOnTop, !needsLabDeskOnTop);
}
window.syncBrowserBounds = syncBrowserBounds;
window.addEventListener('resize', syncBrowserBounds);

function bringToFront(winEl) {
    winEl.style.zIndex = ++highestZIndex;
    const winId = winEl.id;
    activeInternalWinId = winId;

    document.querySelectorAll('.taskbar-item').forEach(item => {
        item.classList.toggle('active', item.dataset.winId === winId);
    });
    syncBrowserBounds();
}

function closeWindow(winId) {
    if (!openWindows.has(winId)) return;
    const winEl = openWindows.get(winId).element;
    winEl.remove();
    openWindows.delete(winId);

    const taskItem = document.querySelector(`.taskbar-item[data-win-id="${winId}"]`);
    if (taskItem) taskItem.remove();

    if (activeInternalWinId === winId) {
        activeInternalWinId = null;
    }
    updateExternalBrowserTaskbar(browserState);
    syncBrowserBounds();
}

function minimizeWindow(winId) {
    if (!openWindows.has(winId)) return;
    const winEl = openWindows.get(winId).element;
    winEl.style.display = 'none';

    const taskItem = document.querySelector(`.taskbar-item[data-win-id="${winId}"]`);
    if (taskItem) taskItem.classList.remove('active');

    if (activeInternalWinId === winId) {
        activeInternalWinId = null;
    }
    updateExternalBrowserTaskbar(browserState);
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
        } else if (activeInternalWinId === winId) {
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
    };

    document.onmouseup = () => {
        if (isDragging) {
            isDragging = false;
            document.body.style.cursor = 'default';
        }
    };
}

// ==========================================
// LISTENERS REMOTOS DEL PROFESOR
// ==========================================
function initRemoteListeners() {
    if (!window.labdeskAPI) return;

    window.labdeskAPI.connection.onServerConnectionChanged(({ connected }) => {
        const dot = document.getElementById('conn-dot');
        dot.className = `status-dot ${connected ? 'dot-online' : 'dot-offline'}`;
    });

    window.labdeskAPI.browser.onStateChanged((state) => {
        applyBrowserState(state);
    });

    window.labdeskAPI.browser.onRemoteOpenUrl((payload) => {
        if (!payload || !payload.url) return;
        if (payload.isKiosk) {
            window.labdeskAPI.browser.openTab(payload.url, true);
        } else {
            openApp('browser', payload.url);
        }
    });

    window.labdeskAPI.audio.onStateChanged((state) => {
        currentVolume = state.volume;
        isMuted = state.isMuted;
        document.getElementById('tray-vol-slider').value = currentVolume;
        document.getElementById('audio-vol-text').textContent = `${currentVolume}%`;
        const muteBtn = document.getElementById('btn-tray-mute');
        if (muteBtn) muteBtn.innerHTML = isMuted ? SVG_AUDIO_MUTED : SVG_AUDIO_ON;
    });

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
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
