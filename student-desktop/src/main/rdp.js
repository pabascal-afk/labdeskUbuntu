// Remote Desktop Input Dispatcher for Linux (xdotool / uinput)
const { exec } = require('child_process');
const { screen } = require('electron');

class LinuxRdpInput {
    constructor() {
        this.hasXdotool = false;
        this.checkXdotool();
    }

    checkXdotool() {
        exec('which xdotool', (err) => {
            this.hasXdotool = !err;
        });
    }

    handleInput(data) {
        if (!data || !this.hasXdotool) return;

        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.size;

        try {
            if (data.type === 'move') {
                const px = Math.round(data.x * width);
                const py = Math.round(data.y * height);
                exec(`xdotool mousemove ${px} ${py}`);
            } else if (data.type === 'click') {
                const px = Math.round(data.x * width);
                const py = Math.round(data.y * height);
                const btn = data.button === 'right' ? 3 : (data.button === 'middle' ? 2 : 1);
                exec(`xdotool mousemove ${px} ${py} click ${btn}`);
            } else if (data.type === 'dblclick') {
                const px = Math.round(data.x * width);
                const py = Math.round(data.y * height);
                const btn = data.button === 'right' ? 3 : 1;
                exec(`xdotool mousemove ${px} ${py} click --repeat 2 --delay 100 ${btn}`);
            } else if (data.type === 'scroll') {
                const dir = data.delta > 0 ? 5 : 4; // 4 = scroll up, 5 = scroll down
                exec(`xdotool click ${dir}`);
            } else if (data.type === 'key') {
                const safeKey = data.key.replace(/[^a-zA-Z0-9_\-]/g, '');
                if (safeKey) exec(`xdotool key ${safeKey}`);
            }
        } catch (e) {
            console.error('Error ejecutando input RDP:', e.message);
        }
    }
}

module.exports = new LinuxRdpInput();
