// Educational Browser & Google Workspace Integration Engine
const { session, BrowserWindow, WebContentsView } = require('electron');

const GOOGLE_COMPATIBLE_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

class EducationalBrowser {
    constructor() {
        this.mainWindow = null;
        this.tabs = new Map();
        this.activeTabId = null;
        this.isKioskExam = false;
        this.customSession = null;
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

    openTab(url, options = {}) {
        if (!url) url = 'https://www.google.com';
        const tabId = options.tabId || `tab_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

        if (options.isKiosk) {
            this.isKioskExam = true;
        }

        // Si ya existe la vista, navegar
        if (this.tabs.has(tabId)) {
            const view = this.tabs.get(tabId);
            view.webContents.loadURL(url);
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
        view.webContents.loadURL(url);

        // Notificar cambios de título y URL a la barra de pestañas del renderer
        view.webContents.on('page-title-updated', (e, title) => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('browser_tab_updated', { tabId, title, url: view.webContents.getURL() });
            }
        });

        view.webContents.on('did-navigate', (e, newUrl) => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('browser_tab_navigated', { tabId, url: newUrl });
            }
        });

        this.tabs.set(tabId, view);
        this.setActiveTab(tabId);

        return tabId;
    }

    setActiveTab(tabId) {
        if (!this.mainWindow || !this.tabs.has(tabId)) return;

        // Ocultar la pestaña anterior si la hay
        if (this.activeTabId && this.tabs.has(this.activeTabId)) {
            const prevView = this.tabs.get(this.activeTabId);
            try { this.mainWindow.contentView.removeChildView(prevView); } catch(e) {}
        }

        const activeView = this.tabs.get(tabId);
        this.activeTabId = tabId;

        // Añadir a la ventana y posicionar debajo de la barra de pestañas del navegador
        try {
            this.mainWindow.contentView.addChildView(activeView);
            this.updateBounds();
        } catch(e) {}
    }

    updateBounds(bounds) {
        if (!this.activeTabId || !this.tabs.has(this.activeTabId)) return;
        const view = this.tabs.get(this.activeTabId);

        if (bounds) {
            this.currentBounds = bounds;
        } else if (!this.currentBounds) {
            const [w, h] = this.mainWindow.getSize();
            // Área por defecto de la ventana del navegador
            this.currentBounds = { x: 50, y: 90, width: w - 100, height: h - 160 };
        }

        view.setBounds(this.currentBounds);
    }

    closeTab(tabId) {
        if (!this.tabs.has(tabId)) return;
        const view = this.tabs.get(tabId);
        try { this.mainWindow.contentView.removeChildView(view); } catch(e) {}
        this.tabs.delete(tabId);

        if (this.activeTabId === tabId) {
            const nextKey = this.tabs.keys().next().value;
            if (nextKey) {
                this.setActiveTab(nextKey);
            } else {
                this.activeTabId = null;
            }
        }
    }

    hideAllTabs() {
        if (this.activeTabId && this.tabs.has(this.activeTabId)) {
            const activeView = this.tabs.get(this.activeTabId);
            try { this.mainWindow.contentView.removeChildView(activeView); } catch(e) {}
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
