// Linux Audio Subsystem Controller (PipeWire / PulseAudio / ALSA)
const { exec } = require('child_process');

class LinuxAudio {
    constructor() {
        this.currentVolume = 50;
        this.isMuted = false;
        this.currentSink = null;
        this.currentSource = null;
        this.backend = 'pamixer'; // default fallback
        this.detectBackend();

        // En entornos escolares con audífonos USB, auto-priorizar USB tras iniciar
        setTimeout(() => {
            this.autoSelectUsb();
        }, 2000);
    }

    detectBackend() {
        exec('which pamixer', (err) => {
            if (!err) {
                this.backend = 'pamixer';
            } else {
                exec('which pactl', (err2) => {
                    if (!err2) this.backend = 'pactl';
                    else this.backend = 'amixer';
                });
            }
        });
    }

    setVolume(level) {
        level = Math.max(0, Math.min(100, parseInt(level, 10)));
        this.currentVolume = level;
        this.isMuted = false;

        const targetSink = this.currentSink ? `"${this.currentSink}"` : '@DEFAULT_SINK@';

        if (this.backend === 'pactl' || this.backend === 'pamixer') {
            exec(`pactl set-sink-mute ${targetSink} 0 2>/dev/null && pactl set-sink-volume ${targetSink} ${level}% 2>/dev/null || pamixer --unmute --set-volume ${level} 2>/dev/null`);
        } else {
            exec(`amixer -q sset Master unmute && amixer -q sset Master ${level}%`);
        }
        return { volume: this.currentVolume, isMuted: false };
    }

    mute() {
        this.isMuted = true;
        const targetSink = this.currentSink ? `"${this.currentSink}"` : '@DEFAULT_SINK@';
        exec(`pactl set-sink-mute ${targetSink} 1 2>/dev/null || pamixer -m 2>/dev/null || amixer -q sset Master mute 2>/dev/null`);
        return { volume: this.currentVolume, isMuted: true };
    }

    unmute() {
        this.isMuted = false;
        const targetSink = this.currentSink ? `"${this.currentSink}"` : '@DEFAULT_SINK@';
        exec(`pactl set-sink-mute ${targetSink} 0 2>/dev/null || pamixer -u 2>/dev/null || amixer -q sset Master unmute 2>/dev/null`);
        return { volume: this.currentVolume, isMuted: false };
    }

    toggleMute() {
        return this.isMuted ? this.unmute() : this.mute();
    }

    getVolume() {
        return new Promise((resolve) => {
            exec('pamixer --get-volume 2>/dev/null && pamixer --get-mute 2>/dev/null', (err, stdout) => {
                if (!err && stdout) {
                    const lines = stdout.trim().split('\n');
                    const vol = parseInt(lines[0], 10);
                    const muted = lines[1] === 'true';
                    if (!isNaN(vol)) this.currentVolume = vol;
                    this.isMuted = muted;
                    return resolve({ volume: this.currentVolume, isMuted: this.isMuted });
                }

                // Fallback pactl
                exec('pactl get-sink-volume @DEFAULT_SINK@ 2>/dev/null; pactl get-sink-mute @DEFAULT_SINK@ 2>/dev/null', (err2, out2) => {
                    if (!err2 && out2) {
                        const mVol = out2.match(/(\d+)%/);
                        if (mVol) this.currentVolume = parseInt(mVol[1], 10);
                        this.isMuted = /yes/i.test(out2);
                    }
                    resolve({ volume: this.currentVolume, isMuted: this.isMuted });
                });
            });
        });
    }

    getDevices() {
        return new Promise((resolve) => {
            const cmd = `pactl list sinks 2>/dev/null; echo "===SOURCES==="; pactl list sources 2>/dev/null; echo "===DEFAULT_SINK==="; pactl get-default-sink 2>/dev/null; echo "===DEFAULT_SOURCE==="; pactl get-default-source 2>/dev/null`;
            exec(cmd, (err, stdout) => {
                if (err || !stdout) {
                    return resolve({ outputs: [], inputs: [], defaultSink: '', defaultSource: '' });
                }

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

                if (defaultSink) this.currentSink = defaultSink;
                if (defaultSource) this.currentSource = defaultSource;

                resolve({
                    outputs,
                    inputs,
                    defaultSink,
                    defaultSource
                });
            });
        });
    }

    setDefaultSink(sinkName) {
        return new Promise((resolve) => {
            this.currentSink = sinkName;
            const cmd = `pactl set-default-sink "${sinkName}" 2>/dev/null && pactl set-sink-mute "${sinkName}" 0 2>/dev/null && for id in $(pactl list short sink-inputs 2>/dev/null | cut -f1); do pactl move-sink-input "$id" "${sinkName}" 2>/dev/null || true; done`;
            exec(cmd, (err) => {
                resolve(!err);
            });
        });
    }

    setDefaultSource(sourceName) {
        return new Promise((resolve) => {
            this.currentSource = sourceName;
            const cmd = `pactl set-default-source "${sourceName}" 2>/dev/null && pactl set-source-mute "${sourceName}" 0 2>/dev/null`;
            exec(cmd, (err) => {
                resolve(!err);
            });
        });
    }

    autoSelectUsb() {
        return new Promise((resolve) => {
            const script = `
                USB_SINK=$(pactl list short sinks 2>/dev/null | grep -i "usb" | head -n 1 | awk '{print $2}')
                if [ -n "$USB_SINK" ]; then
                    pactl set-default-sink "$USB_SINK" 2>/dev/null
                    pactl set-sink-mute "$USB_SINK" 0 2>/dev/null
                    pactl set-sink-volume "$USB_SINK" 75% 2>/dev/null
                    for id in $(pactl list short sink-inputs 2>/dev/null | cut -f1); do
                        pactl move-sink-input "$id" "$USB_SINK" 2>/dev/null || true
                    done
                fi

                USB_SOURCE=$(pactl list short sources 2>/dev/null | grep -i "usb" | grep -v "monitor" | head -n 1 | awk '{print $2}')
                if [ -n "$USB_SOURCE" ]; then
                    pactl set-default-source "$USB_SOURCE" 2>/dev/null
                    pactl set-source-mute "$USB_SOURCE" 0 2>/dev/null
                    pactl set-source-volume "$USB_SOURCE" 80% 2>/dev/null
                fi

                amixer -q sset Master unmute 2>/dev/null || true
                amixer -q sset Headphone unmute 2>/dev/null || true
                amixer -q sset Speaker unmute 2>/dev/null || true
                amixer -q sset PCM unmute 2>/dev/null || true
                amixer -q sset Mic unmute 2>/dev/null || true
            `;
            exec(script, (err) => {
                resolve(!err);
            });
        });
    }
}

module.exports = new LinuxAudio();
