// LabDesk Student Agent - Socket.IO Client
const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');
const os = require('os');
const audio = require('./audio');
const system = require('./system');
const screenCapture = require('./screen');
const browser = require('./browser');
const rdp = require('./rdp');

class LabDeskAgent {
    constructor() {
        this.socket = null;
        this.serverUrl = process.env.LABDESK_SERVER_URL || this.loadServerConfig();
        this.mainWindow = null;
        this.isLocked = false;
        this.clientId = system.getMachineId();
    }

    loadServerConfig() {
        const configPath = path.join(os.homedir(), '.config', 'labdesk', 'config.json');
        try {
            if (fs.existsSync(configPath)) {
                const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                if (cfg.serverUrl) return cfg.serverUrl;
            }
        } catch(e) {}
        return 'http://localhost:3000';
    }

    init(mainWindow) {
        this.mainWindow = mainWindow;
        console.log(`🔌 Conectando agente a LabDesk Server: ${this.serverUrl}`);

        this.socket = io(this.serverUrl, {
            reconnection: true,
            reconnectionDelay: 2000,
            reconnectionAttempts: Infinity
        });

        this.setupSocketEvents();

        // Iniciar captura periódica de pantalla para enviar al servidor
        screenCapture.start((base64Image) => {
            if (this.socket && this.socket.connected) {
                this.socket.emit('screenshot', { image: base64Image });
            }
        });
    }

    setupSocketEvents() {
        this.socket.on('connect', async () => {
            console.log('✅ Agente conectado al servidor');
            const audioState = await audio.getVolume();
            const machineId = system.getMachineId();
            this.clientId = machineId;

            this.socket.emit('register_client', {
                id: machineId,
                name: system.getHostname(),
                mac_address: system.getMacAddress(),
                ip_address: system.getIpAddress(),
                volume: audioState.volume,
                is_muted: audioState.isMuted,
                version: '2.0.0'
            });

            this.sendToRenderer('server_connection_changed', { connected: true, serverUrl: this.serverUrl });
        });

        this.socket.on('disconnect', () => {
            console.log('⚠️ Desconectado del servidor LabDesk');
            this.sendToRenderer('server_connection_changed', { connected: false });
        });

        // Comandos de Sistema
        this.socket.on('system_command', (data) => {
            const { command, payload } = data;
            if (command === 'lock') {
                this.setLocked(true, payload?.pin, payload?.message);
            } else if (command === 'unlock') {
                this.setLocked(false);
                browser.setKioskExam(false);
            } else if (command === 'shutdown') {
                system.shutdown();
            } else if (command === 'reboot') {
                system.reboot();
            } else if (command === 'start_live_stream') {
                screenCapture.setStreamingMode(true);
            } else if (command === 'stop_live_stream') {
                screenCapture.setStreamingMode(false);
            } else if (command === 'announcement') {
                this.sendToRenderer('show_announcement', payload);
            }
        });

        // Comandos de Audio
        this.socket.on('audio_command', (data) => {
            const { command, payload } = data;
            let result = null;
            if (command === 'volume_set' && payload?.volume !== undefined) {
                result = audio.setVolume(payload.volume);
            } else if (command === 'volume_mute') {
                result = audio.mute();
            } else if (command === 'volume_unmute') {
                result = audio.unmute();
            } else if (command === 'volume_up') {
                result = audio.setVolume(audio.currentVolume + 5);
            } else if (command === 'volume_down') {
                result = audio.setVolume(audio.currentVolume - 5);
            } else if (command === 'audio_usb_auto') {
                audio.autoSelectUsb().then(async () => {
                    const state = await audio.getVolume();
                    this.sendToRenderer('audio_state_changed', state);
                    this.socket.emit('client_state', state);
                });
            }

            if (result) {
                this.sendToRenderer('audio_state_changed', result);
                this.socket.emit('client_state', result);
            }
        });

        // Comandos de Navegador y Pestañas
        this.socket.on('browser_command', (data) => {
            const { command, payload } = data;
            if (command === 'browser_open_url' && payload?.url) {
                this.sendToRenderer('browser_open_url_event', payload);
            } else if (command === 'browser_kiosk_mode') {
                browser.setKioskExam(!!payload?.enabled, payload?.url || '');
            } else if (command === 'browser_close_tab' && payload?.tabId) {
                browser.closeTab(payload.tabId);
            }
        });

        // Ejecución de Scripts Bash
        this.socket.on('run_script', async (scriptContent) => {
            console.log('⚙️ Ejecutando script Bash recibido del profesor...');
            const result = await system.runBashScript(scriptContent);
            this.socket.emit('script_result', result);
        });

        // Entrada RDP
        this.socket.on('rdp_input', (data) => {
            rdp.handleInput(data);
        });
    }

    setLocked(locked, pin, message) {
        this.isLocked = locked;
        this.sendToRenderer('screen_lock_state', { locked, pin: pin || '2846', message: message || 'Atención a la pizarra' });
    }

    notifyLocalUnlock() {
        this.isLocked = false;
        browser.setKioskExam(false);
        if (this.socket && this.socket.connected) {
            this.socket.emit('local_unlock');
        }
    }

    sendToRenderer(channel, payload) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send(channel, payload);
        }
    }
}

module.exports = new LabDeskAgent();
