// Linux Audio Subsystem Controller (PipeWire / WirePlumber / PulseAudio / ALSA)
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

function execWithEnv(command, callback) {
    const env = Object.assign({}, process.env);
    const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;
    if (!env.XDG_RUNTIME_DIR) {
        env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
    }
    if (!env.DBUS_SESSION_BUS_ADDRESS) {
        env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${env.XDG_RUNTIME_DIR}/bus`;
    }
    return exec(command, { env }, callback);
}

class LinuxAudio {
    constructor() {
        this.currentVolume = 50;
        this.isMuted = false;
        this.currentSink = null;
        this.currentSource = null;

        // 1. Instalar regla WirePlumber de máxima prioridad (2000) para dispositivos USB
        this.ensureWireplumberRule();

        // 2. Limpiar cualquier archivo conflictivo ~/.asoundrc que rompa PipeWire
        this.cleanConflictingAsoundrc();

        // 3. Auto-seleccionar audífonos USB en segundo plano de forma escalonada
        setTimeout(() => this.autoSelectUsb(), 1000);
        setTimeout(() => this.autoSelectUsb(), 3500);
        setTimeout(() => this.autoSelectUsb(), 8000);

        // 4. Guardián continuo de audio (cada 20s) para auto-recuperar audífonos USB si se conectan/desconectan
        this.startAudioWatchdog();
    }

    cleanConflictingAsoundrc() {
        try {
            const home = process.env.HOME || '/home/estudiante';
            const asoundFile = `${home}/.asoundrc`;
            if (fs.existsSync(asoundFile)) {
                fs.unlinkSync(asoundFile);
            }
        } catch(e) {}
    }

    ensureWireplumberRule() {
        try {
            const home = process.env.HOME || '/home/estudiante';
            const wpDir = path.join(home, '.config', 'wireplumber', 'main.lua.d');
            const ruleFile = path.join(wpDir, '99-usb-priority.lua');
            if (!fs.existsSync(wpDir)) {
                fs.mkdirSync(wpDir, { recursive: true });
            }
            if (!fs.existsSync(ruleFile)) {
                const luaContent = `table.insert(alsa_monitor.rules, {
  matches = {
    { { "node.name", "matches", "alsa_output.usb*" } },
    { { "node.name", "matches", "alsa_input.usb*" } },
    { { "device.bus", "equals", "usb" } },
  },
  apply_properties = {
    ["priority.driver"] = 2000,
    ["priority.session"] = 2000,
  },
})
`;
                fs.writeFileSync(ruleFile, luaContent, 'utf8');
                execWithEnv('systemctl --user restart wireplumber 2>/dev/null || true');
            }
        } catch(e) {}
    }

    startAudioWatchdog() {
        setInterval(() => {
            this.healAudioIfNeeded();
        }, 20000);
    }

    healAudioIfNeeded() {
        execWithEnv(`
            USER_UID=$(id -u)
            export XDG_RUNTIME_DIR="/run/user/$USER_UID"
            export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"

            if grep -qi "usb" /proc/asound/cards 2>/dev/null; then
                STATUS=$(wpctl status 2>/dev/null)
                if echo "$STATUS" | grep -qi "dummy" || ! echo "$STATUS" | awk '/Sinks:/,/Sources:/' | grep -q '\\*.*USB'; then
                    echo "HEAL_NEEDED"
                fi
            fi
        `, (err, stdout) => {
            if (!err && stdout && stdout.includes('HEAL_NEEDED')) {
                console.log('🎧 Guardián de Audio: Reparando y activando audífonos USB automáticamente...');
                this.autoSelectUsb();
            }
        });
    }

    setVolume(level) {
        level = Math.max(0, Math.min(100, parseInt(level, 10)));
        this.currentVolume = level;
        this.isMuted = false;

        const targetSink = this.currentSink ? `"${this.currentSink}"` : '@DEFAULT_SINK@';
        const frac = (level / 100).toFixed(2);

        execWithEnv(`
            if which wpctl >/dev/null 2>&1; then
                wpctl set-mute @DEFAULT_AUDIO_SINK@ 0 2>/dev/null
                wpctl set-volume @DEFAULT_AUDIO_SINK@ ${frac} 2>/dev/null
            fi
            if which pactl >/dev/null 2>&1; then
                pactl set-sink-mute ${targetSink} 0 2>/dev/null
                pactl set-sink-volume ${targetSink} ${level}% 2>/dev/null
            elif which pamixer >/dev/null 2>&1; then
                pamixer --unmute --set-volume ${level} 2>/dev/null
            fi
            amixer -q sset Master ${level}% unmute 2>/dev/null || true
            amixer -q sset Headphone ${level}% unmute 2>/dev/null || true
        `);
        return { volume: this.currentVolume, isMuted: false };
    }

    mute() {
        this.isMuted = true;
        const targetSink = this.currentSink ? `"${this.currentSink}"` : '@DEFAULT_SINK@';
        execWithEnv(`
            if which wpctl >/dev/null 2>&1; then wpctl set-mute @DEFAULT_AUDIO_SINK@ 1 2>/dev/null; fi
            if which pactl >/dev/null 2>&1; then pactl set-sink-mute ${targetSink} 1 2>/dev/null; fi
            if which pamixer >/dev/null 2>&1; then pamixer -m 2>/dev/null; fi
            amixer -q sset Master mute 2>/dev/null || true
        `);
        return { volume: this.currentVolume, isMuted: true };
    }

    unmute() {
        this.isMuted = false;
        const targetSink = this.currentSink ? `"${this.currentSink}"` : '@DEFAULT_SINK@';
        execWithEnv(`
            if which wpctl >/dev/null 2>&1; then wpctl set-mute @DEFAULT_AUDIO_SINK@ 0 2>/dev/null; fi
            if which pactl >/dev/null 2>&1; then pactl set-sink-mute ${targetSink} 0 2>/dev/null; fi
            if which pamixer >/dev/null 2>&1; then pamixer -u 2>/dev/null; fi
            amixer -q sset Master unmute 2>/dev/null || true
        `);
        return { volume: this.currentVolume, isMuted: false };
    }

    toggleMute() {
        return this.isMuted ? this.unmute() : this.mute();
    }

    getVolume() {
        return new Promise((resolve) => {
            // Intentar wpctl
            execWithEnv('wpctl get-volume @DEFAULT_AUDIO_SINK@ 2>/dev/null', (errWp, outWp) => {
                if (!errWp && outWp) {
                    const match = outWp.match(/Volume:\s+([0-9.]+)/);
                    if (match) {
                        const vol = Math.round(parseFloat(match[1]) * 100);
                        this.currentVolume = Math.min(100, Math.max(0, vol));
                        this.isMuted = outWp.includes('[MUTED]');
                        return resolve({ volume: this.currentVolume, isMuted: this.isMuted });
                    }
                }

                // Intentar pactl / pamixer
                execWithEnv('pactl get-sink-volume @DEFAULT_SINK@ 2>/dev/null; pactl get-sink-mute @DEFAULT_SINK@ 2>/dev/null', (err, stdout) => {
                    if (!err && stdout) {
                        const mVol = stdout.match(/(\d+)%/);
                        if (mVol) this.currentVolume = parseInt(mVol[1], 10);
                        this.isMuted = /yes/i.test(stdout);
                        return resolve({ volume: this.currentVolume, isMuted: this.isMuted });
                    }

                    // Fallback pamixer
                    execWithEnv('pamixer --get-volume 2>/dev/null && pamixer --get-mute 2>/dev/null', (err2, out2) => {
                        if (!err2 && out2) {
                            const lines = out2.trim().split('\n');
                            const vol = parseInt(lines[0], 10);
                            if (!isNaN(vol)) this.currentVolume = vol;
                            this.isMuted = lines[1] === 'true';
                        }
                        resolve({ volume: this.currentVolume, isMuted: this.isMuted });
                    });
                });
            });
        });
    }

    getDevices() {
        return new Promise((resolve) => {
            // 1. Intentar con pactl
            const cmdPactl = `pactl list sinks 2>/dev/null; echo "===SOURCES==="; pactl list sources 2>/dev/null; echo "===DEFAULT_SINK==="; pactl get-default-sink 2>/dev/null; echo "===DEFAULT_SOURCE==="; pactl get-default-source 2>/dev/null`;
            execWithEnv(cmdPactl, (err, stdout) => {
                if (!err && stdout && stdout.includes('Sink #')) {
                    const parts = stdout.split('===SOURCES===');
                    const sinksPart = parts[0] || '';
                    const rest1 = parts[1] || '';
                    const parts2 = rest1.split('===DEFAULT_SINK===');
                    const sourcesPart = parts2[0] || '';
                    const rest2 = parts2[1] || '';
                    const parts3 = rest2.split('===DEFAULT_SOURCE===');
                    const defaultSink = (parts3[0] || '').trim();
                    const defaultSource = (parts3[1] || '').trim();

                    const parseBlocks = (str, isSource = false) => {
                        const blocks = str.split(/(?=Sink #|Source #)/g);
                        const items = [];
                        for (const b of blocks) {
                            const idMatch = b.match(/(?:Sink|Source) #(\d+)/);
                            const nameMatch = b.match(/Name:\s+([^\r\n]+)/);
                            const descMatch = b.match(/Description:\s+([^\r\n]+)/);
                            if (idMatch && nameMatch) {
                                const name = nameMatch[1].trim();
                                if (isSource && name.includes('.monitor')) continue;
                                const desc = descMatch ? descMatch[1].trim() : name;
                                const isUsb = /usb|headset|headphone|auricular/i.test(name) || /usb|headset|headphone|auricular/i.test(desc);
                                items.push({
                                    id: idMatch[1],
                                    name,
                                    description: desc,
                                    isUsb,
                                    isDefault: isSource ? (name === defaultSource) : (name === defaultSink)
                                });
                            }
                        }
                        return items;
                    };

                    const outputs = parseBlocks(sinksPart, false);
                    const inputs = parseBlocks(sourcesPart, true);
                    return resolve({ outputs, inputs, defaultSink, defaultSource });
                }

                // 2. Fallback a wpctl status (WirePlumber / PipeWire nativo)
                execWithEnv('wpctl status 2>/dev/null', (errWp, outWp) => {
                    if (!errWp && outWp && outWp.includes('Sinks:')) {
                        const outputs = [];
                        const inputs = [];

                        // Parse Sinks
                        const sinksSection = outWp.split('Sinks:')[1]?.split('Sources:')[0] || '';
                        const sinkLines = sinksSection.split('\n');
                        for (const line of sinkLines) {
                            const match = line.match(/^\s*(?:│\s*)?(\*?)\s*(\d+)\.\s+([^\t\n\r\[]+)/);
                            if (match) {
                                const isDefault = match[1] === '*';
                                const id = match[2];
                                const desc = match[3].trim();
                                const isUsb = /usb|headset|headphone|auricular/i.test(desc);
                                outputs.push({ id, name: id, description: desc, isUsb, isDefault });
                            }
                        }

                        // Parse Sources
                        const sourcesSection = outWp.split('Sources:')[1]?.split('Filters:')[0] || '';
                        const sourceLines = sourcesSection.split('\n');
                        for (const line of sourceLines) {
                            const match = line.match(/^\s*(?:│\s*)?(\*?)\s*(\d+)\.\s+([^\t\n\r\[]+)/);
                            if (match) {
                                const isDefault = match[1] === '*';
                                const id = match[2];
                                const desc = match[3].trim();
                                if (/monitor/i.test(desc)) continue;
                                const isUsb = /usb|headset|headphone|auricular/i.test(desc);
                                inputs.push({ id, name: id, description: desc, isUsb, isDefault });
                            }
                        }

                        if (outputs.length > 0 || inputs.length > 0) {
                            return resolve({ outputs, inputs, defaultSink: '', defaultSource: '' });
                        }
                    }

                    // 3. Fallback a /proc/asound/cards (Kernel ALSA directo)
                    try {
                        if (fs.existsSync('/proc/asound/cards')) {
                            const cardsContent = fs.readFileSync('/proc/asound/cards', 'utf8');
                            const outputs = [];
                            const lines = cardsContent.split('\n');
                            for (let i = 0; i < lines.length; i++) {
                                const m = lines[i].match(/^\s*(\d+)\s+\[([^\]]+)\]:\s+(.+)$/);
                                if (m) {
                                    const cardNum = m[1];
                                    const shortName = m[2];
                                    const longDesc = (lines[i + 1] || m[3]).trim();
                                    const isUsb = /usb/i.test(shortName) || /usb/i.test(longDesc);
                                    outputs.push({
                                        id: cardNum,
                                        name: `card_${cardNum}`,
                                        description: `${isUsb ? '🎧' : '🔊'} ${longDesc}`,
                                        isUsb,
                                        isDefault: cardNum === '0'
                                    });
                                }
                            }
                            return resolve({ outputs, inputs: [], defaultSink: '', defaultSource: '' });
                        }
                    } catch(e) {}

                    resolve({ outputs: [], inputs: [], defaultSink: '', defaultSource: '' });
                });
            });
        });
    }

    setDefaultSink(sinkName) {
        return new Promise((resolve) => {
            this.currentSink = sinkName;
            // Si es un ID numérico (wpctl)
            if (/^\d+$/.test(sinkName)) {
                execWithEnv(`wpctl set-default ${sinkName} 2>/dev/null && wpctl set-mute ${sinkName} 0 2>/dev/null && wpctl set-volume ${sinkName} 0.75 2>/dev/null`, () => resolve(true));
                return;
            }

            // Nombre pactl
            const cmd = `pactl set-default-sink "${sinkName}" 2>/dev/null && pactl set-sink-mute "${sinkName}" 0 2>/dev/null && for id in $(pactl list short sink-inputs 2>/dev/null | cut -f1); do pactl move-sink-input "$id" "${sinkName}" 2>/dev/null || true; done`;
            execWithEnv(cmd, () => resolve(true));
        });
    }

    setDefaultSource(sourceName) {
        return new Promise((resolve) => {
            this.currentSource = sourceName;
            if (/^\d+$/.test(sourceName)) {
                execWithEnv(`wpctl set-default ${sourceName} 2>/dev/null && wpctl set-mute ${sourceName} 0 2>/dev/null && wpctl set-volume ${sourceName} 0.80 2>/dev/null`, () => resolve(true));
                return;
            }
            execWithEnv(`pactl set-default-source "${sourceName}" 2>/dev/null && pactl set-source-mute "${sourceName}" 0 2>/dev/null`, () => resolve(true));
        });
    }

    autoSelectUsb() {
        return new Promise((resolve) => {
            const script = `
                USER_UID=$(id -u)
                export XDG_RUNTIME_DIR="/run/user/$USER_UID"
                export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"

                # 1. Asegurar que NINGÚN archivo .asoundrc bloquee PipeWire
                rm -f "$HOME/.asoundrc" 2>/dev/null || true

                # 2. Si PipeWire o WirePlumber cayeron en Dummy Output, reiniciar para reenganchar hardware
                if which wpctl >/dev/null 2>&1; then
                    STATUS=$(wpctl status 2>/dev/null)
                    if echo "$STATUS" | grep -qi "dummy" || ! echo "$STATUS" | grep -qi "sink"; then
                        systemctl --user restart pipewire wireplumber 2>/dev/null || true
                        sleep 1
                    fi
                fi

                # 3. wpctl (WirePlumber / PipeWire nativo)
                if which wpctl >/dev/null 2>&1; then
                    USB_SINK_ID=$(wpctl status 2>/dev/null | awk '/Sinks:/,/Sources:/' | grep -i -E "usb|generalplus|device" | grep -v -i "dummy" | grep -o -E '[0-9]+' | head -n 1)
                    if [ -n "$USB_SINK_ID" ]; then
                        wpctl set-default "$USB_SINK_ID" 2>/dev/null
                        wpctl set-mute "$USB_SINK_ID" 0 2>/dev/null
                        wpctl set-volume "$USB_SINK_ID" 0.75 2>/dev/null
                    fi

                    USB_SRC_ID=$(wpctl status 2>/dev/null | awk '/Sources:/,/Filters:/' | grep -i -E "usb|generalplus|device" | grep -v -i "monitor" | grep -v -i "dummy" | grep -o -E '[0-9]+' | head -n 1)
                    if [ -n "$USB_SRC_ID" ]; then
                        wpctl set-default "$USB_SRC_ID" 2>/dev/null
                        wpctl set-mute "$USB_SRC_ID" 0 2>/dev/null
                        wpctl set-volume "$USB_SRC_ID" 0.80 2>/dev/null
                    fi
                fi

                # 4. pactl (PulseAudio)
                if which pactl >/dev/null 2>&1; then
                    USB_SINK=$(pactl list short sinks 2>/dev/null | grep -i -E "usb|generalplus" | head -n 1 | awk '{print $2}')
                    if [ -n "$USB_SINK" ]; then
                        pactl set-default-sink "$USB_SINK" 2>/dev/null
                        pactl set-sink-mute "$USB_SINK" 0 2>/dev/null
                        pactl set-sink-volume "$USB_SINK" 75% 2>/dev/null
                        for stream in $(pactl list short sink-inputs 2>/dev/null | cut -f1); do
                            pactl move-sink-input "$stream" "$USB_SINK" 2>/dev/null || true
                        done
                    fi
                    USB_SOURCE=$(pactl list short sources 2>/dev/null | grep -i -E "usb|generalplus" | grep -v "monitor" | head -n 1 | awk '{print $2}')
                    if [ -n "$USB_SOURCE" ]; then
                        pactl set-default-source "$USB_SOURCE" 2>/dev/null
                        pactl set-source-mute "$USB_SOURCE" 0 2>/dev/null
                        pactl set-source-volume "$USB_SOURCE" 80% 2>/dev/null
                    fi
                fi

                # 5. Desmutear y calibrar hardware ALSA
                USB_CARD=$(cat /proc/asound/cards 2>/dev/null | grep -i "usb" | awk '{print $1}' | head -n 1)
                if [ -n "$USB_CARD" ]; then
                    amixer -c "$USB_CARD" sset Speaker 75% unmute 2>/dev/null || true
                    amixer -c "$USB_CARD" sset Mic 80% unmute 2>/dev/null || true
                    amixer -c "$USB_CARD" sset Master 75% unmute 2>/dev/null || true
                fi
                amixer -c 1 sset Speaker 75% unmute 2>/dev/null || true
                amixer -c 1 sset Mic 80% unmute 2>/dev/null || true
                amixer -q sset Master 75% unmute 2>/dev/null || true
                amixer -q sset Headphone 75% unmute 2>/dev/null || true

                # Guardar en ALSA state si es posible
                sudo -n alsactl store 2>/dev/null || true
            `;
            execWithEnv(script, (err) => {
                resolve(!err);
            });
        });
    }
}

module.exports = new LinuxAudio();
