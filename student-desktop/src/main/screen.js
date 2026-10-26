// Linux Screen Capture Engine for Teacher Live Monitoring
const { desktopCapturer, screen } = require('electron');

class ScreenCapture {
    constructor() {
        this.interval = 2500;
        this.timer = null;
        this.isCapturing = true;
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

            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: { width: Math.round(width * 0.4), height: Math.round(height * 0.4) }
            });

            if (sources.length > 0 && this.onFrameCallback) {
                const jpegBuffer = sources[0].thumbnail.toJPEG(65);
                const base64 = jpegBuffer.toString('base64');
                this.onFrameCallback(base64);
            }
        } catch (e) {
            // Silenciar errores temporales de capturador
        }

        this.scheduleNext();
    }

    setStreamingMode(isLive) {
        this.interval = isLive ? 1000 : 2500;
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
