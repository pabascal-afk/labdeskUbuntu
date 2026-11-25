// Linux System Integrations & Power Management
const os = require('os');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class LinuxSystem {
    getMachineId() {
        const configDir = path.join(os.homedir(), '.config', 'labdesk');
        const idFile = path.join(configDir, 'device-id.txt');
        try {
            if (fs.existsSync(idFile)) {
                const saved = fs.readFileSync(idFile, 'utf8').trim();
                if (saved && saved.length >= 6) return saved;
            }
        } catch(e) {}

        // 1. Intentar leer machine-id del sistema Linux (/etc/machine-id)
        try {
            if (fs.existsSync('/etc/machine-id')) {
                const mid = fs.readFileSync('/etc/machine-id', 'utf8').trim();
                if (mid && mid.length >= 8) {
                    try {
                        if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
                        fs.writeFileSync(idFile, mid, 'utf8');
                    } catch(e) {}
                    return mid;
                }
            }
        } catch(e) {}

        // 2. Intentar obtener la MAC de la interfaz de red física
        const mac = this.getMacAddress();
        if (mac && mac !== '00:00:00:00:00:00') {
            try {
                if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
                fs.writeFileSync(idFile, mac, 'utf8');
            } catch(e) {}
            return mac;
        }

        // 3. Generar un identificador persistente único para este equipo
        const fallback = 'station_' + Math.random().toString(36).substring(2, 10);
        try {
            if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(idFile, fallback, 'utf8');
        } catch(e) {}
        return fallback;
    }

    getMacAddress() {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
                    return iface.mac;
                }
            }
        }
        return '00:00:00:00:00:00';
    }

    getIpAddress() {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (!iface.internal && iface.family === 'IPv4') {
                    return iface.address;
                }
            }
        }
        return '127.0.0.1';
    }

    getHostname() {
        return os.hostname();
    }

    getDocumentsPath() {
        const docsPath = path.join(os.homedir(), 'Documentos', 'LabDesk');
        if (!fs.existsSync(docsPath)) {
            try { fs.mkdirSync(docsPath, { recursive: true }); } catch(e) {}
        }
        return docsPath;
    }

    scheduleRtcWake(wakeAtEpoch) {
        return new Promise((resolve) => {
            const epoch = Number(wakeAtEpoch);
            if (!Number.isFinite(epoch) || epoch <= Math.floor(Date.now() / 1000) + 30) {
                return resolve(false);
            }
            console.log(`⏰ Programando despertar RTC para epoch ${epoch} (${new Date(epoch * 1000).toLocaleString()})`);
            const cmd = `sudo -n /usr/sbin/rtcwake -m no -t ${epoch} 2>/dev/null || sudo -n /sbin/rtcwake -m no -t ${epoch} 2>/dev/null || sudo -n rtcwake -m no -t ${epoch} 2>/dev/null || (echo 0 | sudo -n tee /sys/class/rtc/rtc0/wakealarm >/dev/null 2>&1 && echo ${epoch} | sudo -n tee /sys/class/rtc/rtc0/wakealarm >/dev/null 2>&1)`;
            exec(cmd, (err) => {
                if (err) {
                    console.warn('⚠️ No se pudo programar alarma RTC local (se usará Wake-on-LAN desde el servidor):', err.message);
                } else {
                    console.log('✅ Alarma RTC configurada correctamente.');
                }
                resolve(!err);
            });
        });
    }

    async shutdown(options = {}) {
        if (options && options.wakeAtEpoch) {
            await this.scheduleRtcWake(options.wakeAtEpoch);
        }
        console.log('🛑 Apagando el sistema...');
        exec('sudo -n /sbin/poweroff || sudo -n systemctl poweroff || systemctl poweroff || sudo poweroff || poweroff');
    }

    async suspend(options = {}) {
        if (options && options.wakeAtEpoch) {
            await this.scheduleRtcWake(options.wakeAtEpoch);
        }
        console.log('🌙 Suspendiendo el sistema (modo dormir)...');
        exec('sudo -n systemctl suspend || systemctl suspend || sudo -n /usr/sbin/pm-suspend');
    }

    reboot() {
        console.log('🔄 Reiniciando el sistema...');
        exec('sudo -n /sbin/reboot || sudo -n systemctl reboot || systemctl reboot || sudo reboot || reboot');
    }

    runBashScript(scriptContent) {
        return new Promise((resolve) => {
            const tempScript = path.join(os.tmpdir(), `labdesk_cmd_${Date.now()}.sh`);
            try {
                fs.writeFileSync(tempScript, scriptContent, { mode: 0o755 });
                exec(`/bin/bash "${tempScript}"`, (err, stdout, stderr) => {
                    try { fs.unlinkSync(tempScript); } catch(e) {}
                    resolve({
                        output: stdout,
                        error: err ? (stderr || err.message) : null,
                        code: err ? err.code : 0
                    });
                });
            } catch (e) {
                resolve({ output: '', error: e.message, code: 1 });
            }
        });
    }
}

module.exports = new LinuxSystem();
