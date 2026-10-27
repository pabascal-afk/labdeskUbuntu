// Educational Browser & Google Workspace Integration Engine
const { session, BrowserWindow, WebContentsView } = require('electron');

const GOOGLE_COMPATIBLE_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

class EducationalBrowser {
    constructor() {
        this.mainWindow = null;
        this.tabs = new Map(); // tabId -> { view, title, url }
        this.activeTabId = null;
        this.isKioskExam = false;
        this.captiveUrl = '';
        this.customSession = null;
        this.currentBounds = null;
    }

    init(mainWindow) {
        this.mainWindow = mainWindow;
        // Crear partición persistente para Google Workspace y navegación
        this.customSession = session.fromPartition('persist:student_workspace');

        // Configurar User-Agent estándar para evitar bloqueo de Google "insecure browser"
        this.customSession.setUserAgent(GOOGLE_COMPATIBLE_USER_AGENT);

        // Permitir permisos comunes para educación (micrófono, cámara si se requiere en Google Meet)
        this.customSession.setPermissionRequestHandler((webContents, permission, callback) => {
            if (['media', 'notifications', 'fullscreen'].includes(permission)) {
                return callback(true);
            }
            callback(false);
        });
    }

    getTabsState() {
        return {
            tabs: Array.from(this.tabs.entries()).map(([id, t]) => ({
                id,
                title: t.title || 'Nueva pestaña',
                url: t.url || ''
            })),
            activeTabId: this.activeTabId,
            isKioskExam: this.isKioskExam,
            captiveUrl: this.captiveUrl
        };
    }

    notifyStateChanged() {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('browser_state_changed', this.getTabsState());
        }
    }

    setKioskExam(enable, url = '') {
        this.isKioskExam = !!enable;
        this.captiveUrl = enable ? url : '';
        console.log(`🔒 Modo Examen/Página Cautiva: ${this.isKioskExam ? 'ACTIVADO (' + this.captiveUrl + ')' : 'DESACTIVADO'}`);

        if (this.isKioskExam) {
            // En modo examen, cerrar todas las pestañas abiertas excepto la del examen
            const entries = Array.from(this.tabs.entries());
            if (entries.length > 1) {
                const keepTabId = this.activeTabId || entries[0][0];
                for (const [id, t] of entries) {
                    if (id !== keepTabId) {
                        try { this.mainWindow.contentView.removeChildView(t.view); } catch(e) {}
                        this.tabs.delete(id);
                    }
                }
            }
        }
        this.notifyStateChanged();
    }

    openTab(url, options = {}) {
        if (!url) url = 'https://www.google.com';

        // Si es modo quiosco / examen
        if (options.isKiosk) {
            this.setKioskExam(true, url);
        } else if (this.isKioskExam) {
            // Si el modo examen está activo y no se especifica explícitamente forzar, BLOQUEAR creación de nuevas pestañas
            console.log('🔒 Bloqueada creación de nueva pestaña: Modo Examen (Página Cautiva) activo.');
            return this.activeTabId;
        }

        const tabId = options.tabId || `tab_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        // Si ya existe la vista, navegar
        if (this.tabs.has(tabId)) {
            const entry = this.tabs.get(tabId);
            entry.url = url;
            entry.view.webContents.loadURL(url);
            this.setActiveTab(tabId);
            return tabId;
        }

        // Crear una nueva WebContentsView
        const view = new WebContentsView({
            webPreferences: {
                session: this.customSession,
                contextIsolation: true,
                sandbox: true,
                nodeIntegration: false
            }
        });

        view.webContents.setUserAgent(GOOGLE_COMPATIBLE_USER_AGENT);

        // Control de ventanas emergentes (target="_blank")
        view.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
            if (this.isKioskExam) {
                console.log(`🔒 Popup bloqueado en Modo Examen: ${targetUrl}`);
                return { action: 'deny' };
            }
            // En modo normal, abrir en una nueva pestaña dentro del navegador educativo
            this.openTab(targetUrl);
            return { action: 'deny' };
        });

        // Control de navegación externa en modo examen
        view.webContents.on('will-navigate', (event, navUrl) => {
            if (this.isKioskExam && this.captiveUrl) {
                try {
                    const targetHost = new URL(navUrl).hostname;
                    const allowedHost = new URL(this.captiveUrl).hostname;
                    const isGoogleAuth = allowedHost.includes('google.com') && targetHost.includes('google.com');
                    if (targetHost !== allowedHost && !isGoogleAuth) {
                        console.log(`🔒 Navegación externa rechazada en modo examen: ${navUrl}`);
                        event.preventDefault();
                    }
                } catch(e) {
                    event.preventDefault();
                }
            }
        });

        // Notificar cambios de título y URL a la barra de pestañas del renderer
        view.webContents.on('page-title-updated', (e, title) => {
            const t = this.tabs.get(tabId);
            if (t) {
                t.title = title;
                t.url = view.webContents.getURL();
                this.notifyStateChanged();
            }
        });

        view.webContents.on('did-navigate', (e, newUrl) => {
            const t = this.tabs.get(tabId);
            if (t) {
                t.url = newUrl;
                this.notifyStateChanged();
            }
        });

        view.webContents.on('did-navigate-in-page', (e, newUrl) => {
            const t = this.tabs.get(tabId);
            if (t) {
                t.url = newUrl;
                this.notifyStateChanged();
            }
        });

        view.webContents.loadURL(url);

        this.tabs.set(tabId, { view, title: 'Cargando...', url });
        this.setActiveTab(tabId);

        return tabId;
    }

    setActiveTab(tabId) {
        if (!this.mainWindow || !this.tabs.has(tabId)) return;

        // Ocultar la pestaña anterior si la hay
        if (this.activeTabId && this.tabs.has(this.activeTabId) && this.activeTabId !== tabId) {
            const prev = this.tabs.get(this.activeTabId);
            try { this.mainWindow.contentView.removeChildView(prev.view); } catch(e) {}
        }

        this.activeTabId = tabId;
        const current = this.tabs.get(tabId);

        // Añadir a la ventana y posicionar debajo de la barra de pestañas del navegador
        try {
            this.mainWindow.contentView.addChildView(current.view);
            this.updateBounds();
        } catch(e) {}

        this.notifyStateChanged();
    }

    closeTab(tabId) {
        // En modo examen cautivo no se permite cerrar la pestaña de examen
        if (this.isKioskExam) {
            console.log('🔒 Bloqueado cierre de pestaña: Modo Examen activo');
            return;
        }

        if (!this.tabs.has(tabId)) return;
        const entry = this.tabs.get(tabId);
        try { this.mainWindow.contentView.removeChildView(entry.view); } catch(e) {}
        this.tabs.delete(tabId);

        if (this.activeTabId === tabId) {
            const remainingKeys = Array.from(this.tabs.keys());
            if (remainingKeys.length > 0) {
                this.setActiveTab(remainingKeys[remainingKeys.length - 1]);
            } else {
                this.activeTabId = null;
                // Si cerró todas las pestañas, abrir una en blanco / Google
                this.openTab('https://www.google.com');
            }
        } else {
            this.notifyStateChanged();
        }
    }

    navigate(url) {
        if (!this.activeTabId || !this.tabs.has(this.activeTabId)) {
            return this.openTab(url);
        }
        if (this.isKioskExam) {
            console.log('🔒 Navegación manual bloqueada: Modo Examen activo');
            return;
        }
        const entry = this.tabs.get(this.activeTabId);
        entry.url = url;
        entry.view.webContents.loadURL(url);
    }

    goBack() {
        if (this.activeTabId && this.tabs.has(this.activeTabId)) {
            const entry = this.tabs.get(this.activeTabId);
            if (entry.view.webContents.canGoBack()) entry.view.webContents.goBack();
        }
    }

    goForward() {
        if (this.activeTabId && this.tabs.has(this.activeTabId)) {
            const entry = this.tabs.get(this.activeTabId);
            if (entry.view.webContents.canGoForward()) entry.view.webContents.goForward();
        }
    }

    reload() {
        if (this.activeTabId && this.tabs.has(this.activeTabId)) {
            const entry = this.tabs.get(this.activeTabId);
            entry.view.webContents.reload();
        }
    }

    updateBounds(bounds) {
        if (!this.activeTabId || !this.tabs.has(this.activeTabId)) return;
        const entry = this.tabs.get(this.activeTabId);

        if (bounds) {
            this.currentBounds = bounds;
        } else if (!this.currentBounds) {
            const [w, h] = this.mainWindow.getSize();
            // Área por defecto de la ventana del navegador
            this.currentBounds = { x: 50, y: 90, width: w - 100, height: h - 160 };
        }

        entry.view.setBounds(this.currentBounds);
    }

    hideAllTabs() {
        if (this.activeTabId && this.tabs.has(this.activeTabId)) {
            const entry = this.tabs.get(this.activeTabId);
            try { this.mainWindow.contentView.removeChildView(entry.view); } catch(e) {}
        }
    }

    showActiveTab() {
        if (this.activeTabId && this.tabs.has(this.activeTabId)) {
            this.setActiveTab(this.activeTabId);
        }
    }

    async clearGoogleSession() {
        if (this.customSession) {
            await this.customSession.clearStorageData();
            console.log('🧹 Sesión de Google y cookies limpiadas.');
        }
    }
}

module.exports = new EducationalBrowser();
