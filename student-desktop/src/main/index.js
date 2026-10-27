// LabDesk Student Desktop Shell - Main Process
const { app, BrowserWindow, screen, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const audio = require('./audio');
const system = require('./system');
const browser = require('./browser');
const agent = require('./agent');

let mainWindow = null;

// Bloquear múltiples instancias
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(createWindow);
}

function createWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;

    mainWindow = new BrowserWindow({
        x: 0,
        y: 0,
        width: width || 1280,
        height: height || 800,
        kiosk: false,
        fullscreen: false,
        frame: false,
        movable: false,
        resizable: false,
        autoHideMenuBar: true,
        backgroundColor: '#0f172a',
        webPreferences: {
            preload: path.join(__dirname, '..', 'preload', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    // Impedir que el estudiante cierre el escritorio LabDesk con Alt+F4 o Ctrl+W
    mainWindow.on('close', (e) => {
        if (!app.isQuitting) {
            e.preventDefault();
        }
    });

    // Ajustar dimensiones si cambia la resolución del monitor
    screen.on('display-metrics-changed', () => {
        if (mainWindow && !mainWindow.isDestroyed() && !browser.isKioskExam) {
            const b = screen.getPrimaryDisplay().bounds;
            mainWindow.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
        }
    });

    // Cargar la interfaz de escritorio personalizada
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

    // Inicializar módulos
    browser.init(mainWindow);
    agent.init(mainWindow);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

// ==========================================
// IPC HANDLERS PARA EL RENDERER
// ==========================================

// Audio
ipcMain.handle('audio:get', async () => await audio.getVolume());
ipcMain.handle('audio:set', (e, level) => audio.setVolume(level));
ipcMain.handle('audio:toggleMute', () => audio.toggleMute());
ipcMain.handle('audio:getDevices', async () => await audio.getDevices());
ipcMain.handle('audio:setSink', async (e, sinkName) => await audio.setDefaultSink(sinkName));
ipcMain.handle('audio:setSource', async (e, sourceName) => await audio.setDefaultSource(sourceName));
ipcMain.handle('audio:autoSelectUsb', async () => await audio.autoSelectUsb());

// Sistema
ipcMain.handle('system:info', () => ({
    hostname: system.getHostname(),
    ip: system.getIpAddress(),
    mac: system.getMacAddress(),
    docsPath: system.getDocumentsPath()
}));

ipcMain.handle('system:shutdown', () => {
    app.isQuitting = true;
    return system.shutdown();
});
ipcMain.handle('system:reboot', () => {
    app.isQuitting = true;
    return system.reboot();
});

// Control de superposición sobre navegador estándar (para Menú Inicio, Pop-up Audio y Apps internas)
ipcMain.handle('system:setOverlayMode', (e, { active, restoreExternalBrowser }) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (browser.isKioskExam || agent.isLocked) {
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.focus();
        return;
    }
    if (active) {
        mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
        mainWindow.focus();
        mainWindow.moveTop();
    } else {
        mainWindow.setAlwaysOnTop(false);
        if (restoreExternalBrowser && browser.externalBrowserRunning && browser.externalBrowserFocused) {
            browser.focusExternalBrowser();
        }
    }
});

// Navegador Híbrido (Estándar + Visor Cautivo)
ipcMain.handle('browser:getState', () => browser.getTabsState());
ipcMain.handle('browser:openTab', (e, { url, isKiosk }) => browser.openTab(url, { isKiosk }));
ipcMain.handle('browser:focusExternal', () => browser.focusExternalBrowser());
ipcMain.handle('browser:minimizeExternal', () => browser.minimizeExternalBrowser());
ipcMain.handle('browser:closeExternal', () => browser.killExternalBrowser());
ipcMain.handle('browser:goHomeCaptive', () => browser.goHomeCaptive());
ipcMain.handle('browser:reloadCaptive', () => browser.reloadCaptive());
ipcMain.handle('browser:setKioskExam', (e, { enable, url }) => browser.setKioskExam(enable, url));
ipcMain.handle('browser:updateBounds', (e, bounds) => browser.updateBounds(bounds));
ipcMain.handle('browser:hideTabs', () => browser.hideAllTabs());
ipcMain.handle('browser:showTabs', () => browser.showActiveTab());
ipcMain.handle('browser:clearSession', async () => await browser.clearGoogleSession());

// Desbloqueo local
ipcMain.handle('lock:localUnlock', () => agent.notifyLocalUnlock());

// Guardar archivo local en ~/Documentos/LabDesk
ipcMain.handle('files:saveLocal', (e, { filename, content }) => {
    const docsDir = system.getDocumentsPath();
    const filePath = path.join(docsDir, filename);
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true, filePath };
});

// Entregar archivo al profesor (Buzón de tareas)
ipcMain.handle('turnIn:submitFile', async (e, { filename, content, appType, studentName, notes }) => {
    return new Promise((resolve, reject) => {
        const boundary = '----LabDeskBoundary' + Math.random().toString(36).substring(2);
        const serverUrl = new URL(agent.serverUrl + '/api/turn-ins/upload');

        const postData = [];
        
        // Campo clientId
        postData.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="clientId"\r\n\r\n${system.getMacAddress()}\r\n`));
        // Campo clientName
        postData.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="clientName"\r\n\r\n${system.getHostname()}\r\n`));
        // Campo studentName
        postData.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="studentName"\r\n\r\n${studentName || 'Estudiante'}\r\n`));
        // Campo appType
        postData.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="appType"\r\n\r\n${appType || 'documento'}\r\n`));
        // Campo notes
        postData.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="notes"\r\n\r\n${notes || ''}\r\n`));
        
        // Archivo
        postData.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
        postData.push(Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'));
        postData.push(Buffer.from(`\r\n--${boundary}--\r\n`));

        const fullBuffer = Buffer.concat(postData);

        const req = http.request({
            hostname: serverUrl.hostname,
            port: serverUrl.port || 80,
            path: serverUrl.pathname,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': fullBuffer.length
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch(e) { resolve({ success: true }); }
            });
        });

        req.on('error', (err) => resolve({ success: false, error: err.message }));
        req.write(fullBuffer);
        req.end();
    });
});
