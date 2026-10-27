// Hybrid Educational Browser Engine:
// 1. Standard System Browser (Chromium / Chrome / Firefox) for normal navigation (with 48px bottom taskbar margin)
// 2. Locked-down Electron WebContentsView for Captive Exam Mode (Página Cautiva)

const { session, screen, WebContentsView } = require('electron');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const GOOGLE_COMPATIBLE_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const TASKBAR_HEIGHT = 48;
const CAPTIVE_BAR_HEIGHT = 44;

class EducationalBrowser {
    constructor() {
        this.mainWindow = null;
        this.captiveView = null;
        this.isKioskExam = false;
        this.captiveUrl = '';
        this.currentCaptiveUrl = '';
        this.captiveTitle = 'Evaluación en Curso';
        this.customSession = null;
        this.externalBrowserRunning = false;
        this.externalBrowserFocused = false;
        this.externalProcess = null;
        this.profileDir = path.join(os.homedir(), '.config', 'labdesk', 'browser-profile');
    }

    init(mainWindow) {
        this.mainWindow = mainWindow;

        // Crear partición persistente para el Visor Cautivo
        this.customSession = session.fromPartition('persist:student_workspace');
        this.customSession.setUserAgent(GOOGLE_COMPATIBLE_USER_AGENT);

        // Permitir permisos comunes para educación (micrófono, cámara, pantalla completa)
        this.customSession.setPermissionRequestHandler((webContents, permission, callback) => {
            if (['media', 'notifications', 'fullscreen'].includes(permission)) {
                return callback(true);
            }
            callback(false);
        });

        // Configurar márgenes de 48px en Openbox para respetar siempre la barra de tareas de LabDesk
        this.ensureOpenboxMargins();
    }

    getScreenDimensions() {
        try {
            const primary = screen.getPrimaryDisplay();
            return {
                width: primary.bounds.width || 1280,
                height: primary.bounds.height || 800
            };
        } catch (e) {
            return { width: 1280, height: 800 };
        }
    }

    ensureOpenboxMargins() {
        if (process.platform !== 'linux') return;
        try {
            const openboxDir = path.join(os.homedir(), '.config', 'openbox');
            const rcPath = path.join(openboxDir, 'rc.xml');
            fs.mkdirSync(openboxDir, { recursive: true });

            if (fs.existsSync(rcPath)) {
                let xml = fs.readFileSync(rcPath, 'utf8');
                if (xml.includes('<margins>')) {
                    xml = xml.replace(/<bottom>\s*\d+\s*<\/bottom>/g, `<bottom>${TASKBAR_HEIGHT}</bottom>`);
                } else if (xml.includes('</openbox_config>')) {
                    const marginBlock = `
  <margins>
    <top>0</top>
    <bottom>${TASKBAR_HEIGHT}</bottom>
    <left>0</left>
    <right>0</right>
  </margins>
</openbox_config>`;
                    xml = xml.replace('</openbox_config>', marginBlock);
                }
                fs.writeFileSync(rcPath, xml, 'utf8');
            } else {
                const defaultRc = `<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <margins>
    <top>0</top>
    <bottom>${TASKBAR_HEIGHT}</bottom>
    <left>0</left>
    <right>0</right>
  </margins>
</openbox_config>`;
                fs.writeFileSync(rcPath, defaultRc, 'utf8');
            }

            exec('openbox --reconfigure', () => {});
        } catch (err) {
            console.error('Error configurando márgenes de Openbox:', err.message);
        }
    }

    getTabsState() {
        return {
            isKioskExam: this.isKioskExam,
            captiveUrl: this.captiveUrl,
            currentCaptiveUrl: this.currentCaptiveUrl || this.captiveUrl,
            captiveTitle: this.captiveTitle,
            externalBrowserRunning: this.externalBrowserRunning,
            externalBrowserFocused: this.externalBrowserFocused
        };
    }

    notifyStateChanged() {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('browser_state_changed', this.getTabsState());
        }
    }

    notifyBlockedNavigation(blockedUrl) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('show_announcement', '🚫 Navegación bloqueada: En Modo Examen no se permite abrir sitios externos ni buscadores.');
        }
    }

    // =========================================================
    // 1. NAVEGADOR ESTÁNDAR DEL SISTEMA (MODO NORMAL)
    // =========================================================
    detectBrowserBinary() {
        const candidates = [
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/snap/bin/chromium',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome',
            '/usr/bin/firefox',
            '/usr/bin/firefox-esr'
        ];
        for (const bin of candidates) {
            if (fs.existsSync(bin)) return bin;
        }
        return 'chromium';
    }

    prepareChromiumProfile() {
        try {
            const defaultDir = path.join(this.profileDir, 'Default');
            fs.mkdirSync(defaultDir, { recursive: true });
            const prefsPath = path.join(defaultDir, 'Preferences');
            let prefs = {};
            if (fs.existsSync(prefsPath)) {
                try { prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8')); } catch (e) { prefs = {}; }
            }
            const { width, height } = this.getScreenDimensions();
            const usableHeight = Math.max(400, height - TASKBAR_HEIGHT);

            prefs.browser = prefs.browser || {};
            prefs.browser.has_seen_welcome_page = true;
            prefs.browser.window_placement = {
                bottom: usableHeight,
                left: 0,
                maximized: false,
                right: width,
                top: 0,
                work_area_bottom: usableHeight,
                work_area_left: 0,
                work_area_right: width,
                work_area_top: 0
            };
            prefs.profile = prefs.profile || {};
            prefs.profile.exit_type = 'Normal';
            prefs.profile.exited_cleanly = true;

            fs.writeFileSync(prefsPath, JSON.stringify(prefs), 'utf8');
        } catch (e) {
            console.error('Error preparando perfil de Chromium:', e.message);
        }
    }

    openExternalBrowser(url) {
        if (!url) url = 'https://www.google.com';

        if (this.isKioskExam) {
            console.log('🔒 Ignorando apertura de navegador normal: Modo Examen activo.');
            return;
        }

        const { width, height } = this.getScreenDimensions();
        const usableHeight = Math.max(400, height - TASKBAR_HEIGHT);
        const bin = this.detectBrowserBinary();
        const isFirefox = bin.includes('firefox');

        // Bajar el alwaysOnTop de LabDesk para que el navegador estándar sea visible encima del escritorio
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.setAlwaysOnTop(false);
        }

        if (!isFirefox) {
            this.prepareChromiumProfile();
            const args = [
                `--user-data-dir=${this.profileDir}`,
                `--window-position=0,0`,
                `--window-size=${width},${usableHeight}`,
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-infobars',
                '--disable-session-crashed-bubble',
                '--disable-features=Translate',
                url
            ];

            const child = spawn(bin, args, {
                detached: true,
                stdio: 'ignore',
                env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }
            });
            child.unref();
        } else {
            fs.mkdirSync(this.profileDir, { recursive: true });
            const args = [
                '--profile', this.profileDir,
                '-width', String(width),
                '-height', String(usableHeight),
                url
            ];
            const child = spawn(bin, args, {
                detached: true,
                stdio: 'ignore',
                env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }
            });
            child.unref();
        }

        this.externalBrowserRunning = true;
        this.externalBrowserFocused = true;
        this.notifyStateChanged();

        // Ajustar geometría y foco mediante xdotool / wmctrl tras abrir
        setTimeout(() => this.enforceExternalBrowserBounds(), 600);
        setTimeout(() => this.enforceExternalBrowserBounds(), 1500);
    }

    enforceExternalBrowserBounds() {
        if (process.platform !== 'linux' || this.isKioskExam) return;
        const { width, height } = this.getScreenDimensions();
        const usableHeight = Math.max(400, height - TASKBAR_HEIGHT);

        const cmd = `
            for WID in $(xdotool search --onlyvisible --class "chromium|chrome|firefox|Navigator" 2>/dev/null); do
                wmctrl -i -r "$WID" -b remove,fullscreen,maximized_vert,maximized_horz 2>/dev/null || true
                xdotool windowmove "$WID" 0 0 2>/dev/null || true
                xdotool windowsize "$WID" ${width} ${usableHeight} 2>/dev/null || true
                xdotool windowactivate "$WID" 2>/dev/null || true
                xdotool windowraise "$WID" 2>/dev/null || true
            done
        `;
        exec(cmd, () => {});
    }

    focusExternalBrowser() {
        if (this.isKioskExam) return;
        if (!this.externalBrowserRunning) {
            return this.openExternalBrowser('https://www.google.com');
        }

        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.setAlwaysOnTop(false);
        }

        exec('pgrep -f "chromium|chrome|firefox"', (err, stdout) => {
            if (err || !stdout || !stdout.trim()) {
                this.externalBrowserRunning = false;
                this.openExternalBrowser('https://www.google.com');
            } else {
                this.externalBrowserFocused = true;
                this.enforceExternalBrowserBounds();
                this.notifyStateChanged();
            }
        });
    }

    minimizeExternalBrowser() {
        if (process.platform !== 'linux') return;
        this.externalBrowserFocused = false;
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.focus();
            this.mainWindow.moveTop();
        }
        this.notifyStateChanged();
    }

    killExternalBrowser() {
        return new Promise((resolve) => {
            this.externalBrowserRunning = false;
            this.externalBrowserFocused = false;
            if (process.platform === 'linux') {
                exec('pkill -9 -f "chromium|chrome|firefox" 2>/dev/null || true', () => {
                    this.notifyStateChanged();
                    resolve();
                });
            } else {
                this.notifyStateChanged();
                resolve();
            }
        });
    }

    // =========================================================
    // 2. VISOR CAUTIVO BLINDADO (MODO EXAMEN / PÁGINA CAUTIVA)
    // =========================================================
    isUrlAllowedInCaptive(targetUrl) {
        if (!this.captiveUrl) return true;
        try {
            const parsedTarget = new URL(targetUrl);
            const parsedCaptive = new URL(this.captiveUrl);

            const targetHost = parsedTarget.hostname.toLowerCase();
            const allowedHost = parsedCaptive.hostname.toLowerCase();

            // Bloquear explícitamente el buscador de Google a menos que el examen sea el propio buscador
            if (
                (targetHost.includes('google.') && (parsedTarget.pathname.startsWith('/search') || parsedTarget.pathname.startsWith('/webhp'))) &&
                !(allowedHost.includes('google.') && parsedCaptive.pathname.startsWith('/search'))
            ) {
                return false;
            }

            // 1. Mismo host exacto
            if (targetHost === allowedHost) return true;

            // 2. Subdominios del mismo dominio base (ej. docs.google.com <-> drive.google.com si es examen de Google)
            const getBaseDomain = (host) => {
                const parts = host.split('.');
                return parts.length >= 2 ? parts.slice(-2).join('.') : host;
            };

            // Si el examen es un enlace corto de Google Forms (forms.gle), permitir docs.google.com
            if (allowedHost === 'forms.gle' && (targetHost === 'docs.google.com' || targetHost.endsWith('.googleusercontent.com'))) {
                return true;
            }

            // 3. Permitir siempre el flujo de inicio de sesión de Google (accounts.google.com y recursos estáticos de login)
            const googleAuthHosts = [
                'accounts.google.com',
                'accounts.youtube.com',
                'myaccount.google.com',
                'ogs.google.com',
                'ssl.gstatic.com',
                'www.gstatic.com',
                'fonts.googleapis.com',
                'fonts.gstatic.com',
                'apis.google.com',
                'content.googleapis.com'
            ];
            if (googleAuthHosts.includes(targetHost) || targetHost.endsWith('.googleusercontent.com')) {
                return true;
            }

            // Si el examen está en Google (docs.google.com, classroom.google.com), permitir subdominios de google.com excepto YouTube/Search
            if (allowedHost.endsWith('.google.com') && targetHost.endsWith('.google.com')) {
                if (targetHost === 'www.google.com' || targetHost.includes('youtube.com')) {
                    return false;
                }
                return true;
            }

            // Permitir subdominios directos de la plataforma del examen (ej. moodle, kahoot, quizizz, etc.)
            const baseAllowed = getBaseDomain(allowedHost);
            const baseTarget = getBaseDomain(targetHost);
            if (baseAllowed === baseTarget && !baseAllowed.includes('google.')) {
                return true;
            }

            return false;
        } catch (e) {
            return false;
        }
    }

    async openCaptiveExam(url) {
        if (!url) return;

        // 1. Cerrar por completo el navegador estándar para evitar pestañas o apuntes abiertos
        await this.killExternalBrowser();

        this.isKioskExam = true;
        this.captiveUrl = url;
        this.currentCaptiveUrl = url;
        this.captiveTitle = 'Cargando evaluación...';

        // 2. Fijar ventana principal de LabDesk en modo Kiosk a pantalla completa por encima de todo
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.setKiosk(true);
            this.mainWindow.setFullScreen(true);
            this.mainWindow.setAlwaysOnTop(true, 'screen-saver');
            this.mainWindow.focus();
        }

        // 3. Crear o reutilizar la vista cautiva única
        if (!this.captiveView) {
            this.captiveView = new WebContentsView({
                webPreferences: {
                    session: this.customSession,
                    contextIsolation: true,
                    sandbox: true,
                    nodeIntegration: false
                }
            });

            this.captiveView.webContents.setUserAgent(GOOGLE_COMPATIBLE_USER_AGENT);

            // Manejar intentos de abrir popups o target="_blank"
            this.captiveView.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
                if (this.isUrlAllowedInCaptive(targetUrl)) {
                    // Cargar dentro de la misma vista cautiva sin abrir ventanas nuevas
                    this.captiveView.webContents.loadURL(targetUrl);
                } else {
                    console.log(`🔒 Popup bloqueado en Modo Examen: ${targetUrl}`);
                    this.notifyBlockedNavigation(targetUrl);
                }
                return { action: 'deny' };
            });

            // Filtrar navegación saliente
            this.captiveView.webContents.on('will-navigate', (event, navUrl) => {
                if (this.isKioskExam && !this.isUrlAllowedInCaptive(navUrl)) {
                    console.log(`🔒 Navegación externa bloqueada en Modo Examen: ${navUrl}`);
                    event.preventDefault();
                    this.notifyBlockedNavigation(navUrl);
                }
            });

            this.captiveView.webContents.on('page-title-updated', (e, title) => {
                this.captiveTitle = title || 'Evaluación en Curso';
                this.notifyStateChanged();
            });

            this.captiveView.webContents.on('did-navigate', (e, newUrl) => {
                this.currentCaptiveUrl = newUrl;
                this.notifyStateChanged();
            });

            this.captiveView.webContents.on('did-navigate-in-page', (e, newUrl) => {
                this.currentCaptiveUrl = newUrl;
                this.notifyStateChanged();
            });
        }

        this.captiveView.webContents.loadURL(url);

        try {
            this.mainWindow.contentView.addChildView(this.captiveView);
            this.updateBounds();
        } catch (e) {}

        this.notifyStateChanged();
    }

    setKioskExam(enable, url = '') {
        if (enable && url) {
            return this.openCaptiveExam(url);
        }

        this.isKioskExam = !!enable;
        if (!this.isKioskExam) {
            console.log('🔓 Modo Examen / Página Cautiva DESACTIVADO.');
            this.captiveUrl = '';
            this.currentCaptiveUrl = '';

            if (this.captiveView && this.mainWindow && !this.mainWindow.isDestroyed()) {
                try { this.mainWindow.contentView.removeChildView(this.captiveView); } catch (e) {}
            }

            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                const { width, height } = this.getScreenDimensions();
                this.mainWindow.setKiosk(false);
                this.mainWindow.setFullScreen(false);
                this.mainWindow.setAlwaysOnTop(false);
                this.mainWindow.setBounds({ x: 0, y: 0, width, height });
            }
        }
        this.notifyStateChanged();
    }

    openTab(url, options = {}) {
        if (options.isKiosk) {
            return this.openCaptiveExam(url);
        }
        if (this.isKioskExam) {
            console.log('🔒 Bloqueada apertura de enlace normal: Modo Examen activo.');
            return;
        }
        return this.openExternalBrowser(url);
    }

    goHomeCaptive() {
        if (this.isKioskExam && this.captiveView && this.captiveUrl) {
            this.captiveView.webContents.loadURL(this.captiveUrl);
        }
    }

    reloadCaptive() {
        if (this.isKioskExam && this.captiveView) {
            this.captiveView.webContents.reload();
        }
    }

    updateBounds(bounds) {
        if (!this.isKioskExam || !this.captiveView || !this.mainWindow) return;

        if (bounds && bounds.width > 50 && bounds.height > 50) {
            this.currentBounds = bounds;
        } else {
            const { width, height } = this.getScreenDimensions();
            this.currentBounds = {
                x: 0,
                y: CAPTIVE_BAR_HEIGHT,
                width: width,
                height: Math.max(100, height - CAPTIVE_BAR_HEIGHT - TASKBAR_HEIGHT)
            };
        }

        try {
            this.captiveView.setBounds(this.currentBounds);
        } catch (e) {}
    }

    hideAllTabs() {
        if (this.captiveView && this.mainWindow && !this.mainWindow.isDestroyed()) {
            try { this.mainWindow.contentView.removeChildView(this.captiveView); } catch (e) {}
        }
    }

    showActiveTab() {
        if (this.isKioskExam && this.captiveView && this.mainWindow && !this.mainWindow.isDestroyed()) {
            try {
                this.mainWindow.contentView.addChildView(this.captiveView);
                this.updateBounds();
            } catch (e) {}
        }
    }

    // =========================================================
    // 3. LIMPIEZA UNIFICADA DE SESIÓN (NORMAL + CAUTIVO)
    // =========================================================
    async clearGoogleSession() {
        try {
            await this.killExternalBrowser();
            if (fs.existsSync(this.profileDir)) {
                fs.rmSync(this.profileDir, { recursive: true, force: true });
            }
            if (this.customSession) {
                await this.customSession.clearStorageData();
                await this.customSession.clearCache();
            }
            console.log('🧹 Sesiones de Google y datos de navegación eliminados en ambos entornos.');
            return { success: true };
        } catch (e) {
            console.error('Error limpiando sesión de Google:', e.message);
            return { success: false, error: e.message };
        }
    }
}

module.exports = new EducationalBrowser();
