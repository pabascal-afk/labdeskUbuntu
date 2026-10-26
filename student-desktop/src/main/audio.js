// Linux Audio Subsystem Controller (PipeWire / PulseAudio / ALSA)
const { exec } = require('child_process');

class LinuxAudio {
    constructor() {
        this.currentVolume = 50;
        this.isMuted = false;
        this.backend = 'pamixer'; // default fallback
        this.detectBackend();
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

        if (this.backend === 'pamixer') {
            exec(`pamixer --unmute --set-volume ${level}`);
        } else if (this.backend === 'pactl') {
            exec(`pactl set-sink-mute @DEFAULT_SINK@ 0 && pactl set-sink-volume @DEFAULT_SINK@ ${level}%`);
        } else {
            exec(`amixer -q sset Master unmute && amixer -q sset Master ${level}%`);
        }
        return { volume: this.currentVolume, isMuted: false };
    }

    mute() {
        this.isMuted = true;
        if (this.backend === 'pamixer') {
            exec('pamixer -m');
        } else if (this.backend === 'pactl') {
            exec('pactl set-sink-mute @DEFAULT_SINK@ 1');
        } else {
            exec('amixer -q sset Master mute');
        }
        return { volume: this.currentVolume, isMuted: true };
    }

    unmute() {
        this.isMuted = false;
        if (this.backend === 'pamixer') {
            exec('pamixer -u');
        } else if (this.backend === 'pactl') {
            exec('pactl set-sink-mute @DEFAULT_SINK@ 0');
        } else {
            exec('amixer -q sset Master unmute');
        }
        return { volume: this.currentVolume, isMuted: false };
    }

    toggleMute() {
        return this.isMuted ? this.unmute() : this.mute();
    }

    getVolume() {
        return new Promise((resolve) => {
            if (this.backend === 'pamixer') {
                exec('pamixer --get-volume && pamixer --get-mute', (err, stdout) => {
                    if (err) return resolve({ volume: this.currentVolume, isMuted: this.isMuted });
                    const lines = stdout.trim().split('\n');
                    const vol = parseInt(lines[0], 10) || this.currentVolume;
                    const muted = lines[1] === 'true';
                    this.currentVolume = vol;
                    this.isMuted = muted;
                    resolve({ volume: vol, isMuted: muted });
                });
            } else {
                resolve({ volume: this.currentVolume, isMuted: this.isMuted });
            }
        });
    }
}

module.exports = new LinuxAudio();
