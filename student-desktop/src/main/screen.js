// Linux Screen Capture Engine for Teacher Live Monitoring
const { desktopCapturer, screen } = require('electron');

class ScreenCapture {
    constructor() {
        this.interval = 2500;
        this.timer = null;
        this.isCapturing = true;
        this.isStreaming = false;
        this.onFrameCallback = null;
    }

    start(onFrame) {
        this.onFrameCallback = onFrame;
        this.scheduleNext();
    }

    scheduleNext() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.capture(), this.interval);
    }

    async capture() {
        if (!this.isCapturing) {
            this.scheduleNext();
            return;
        }

        try {
            const primaryDisplay = screen.getPrimaryDisplay();
            const { width, height } = primaryDisplay.size;

            // En modo stream interactivo (RDP docente), aumentamos resolución a 85% y calidad para máxima nitidez
            const scale = this.isStreaming ? 0.85 : 0.4;
            const quality = this.isStreaming ? 75 : 65;

            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) }
            });

            if (sources.length > 0 && this.onFrameCallback) {
                const jpegBuffer = sources[0].thumbnail.toJPEG(quality);
                const base64 = jpegBuffer.toString('base64');
                this.onFrameCallback(base64);
            }
        } catch (e) {
            // Silenciar errores temporales de capturador
        }

        this.scheduleNext();
    }

    setStreamingMode(isLive) {
        this.isStreaming = !!isLive;
        this.interval = isLive ? 800 : 2500;
        if (isLive) {
            this.scheduleNext();
        }
    }

    pause() {
        this.isCapturing = false;
    }

    resume() {
        this.isCapturing = true;
    }

    stop() {
        if (this.timer) clearTimeout(this.timer);
    }
}

module.exports = new ScreenCapture();
