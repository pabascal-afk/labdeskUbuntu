// LabDesk Weekly Power Scheduler & Wake-on-LAN / RTC Coordinator

function parseHHMM(str, fallback = '00:00') {
    const raw = String(str || fallback).trim();
    const match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
        const fb = String(fallback).match(/^(\d{1,2}):(\d{2})$/) || [null, '0', '0'];
        return { hour: Number(fb[1]), minute: Number(fb[2]) };
    }
    const hour = Math.min(23, Math.max(0, Number(match[1])));
    const minute = Math.min(59, Math.max(0, Number(match[2])));
    return { hour, minute };
}

function formatHHMM(hour, minute) {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatLocalMinuteKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}`;
}

function parseDays(str) {
    if (str === undefined || str === null) return [1, 2, 3, 4, 5];
    const trimmed = String(str).trim();
    if (trimmed === '') return [];
    const set = new Set();
    for (const part of trimmed.split(',')) {
        const n = Number(part.trim());
        if (Number.isInteger(n) && n >= 0 && n <= 6) {
            set.add(n);
        }
    }
    return Array.from(set).sort((a, b) => a - b);
}

function computeNextDateForTime(now, timeStr, allowedDays, minBufferMs = 30000) {
    if (!Array.isArray(allowedDays) || allowedDays.length === 0) return null;
    const { hour, minute } = parseHHMM(timeStr, '07:30');
    const baseTime = now.getTime();
    for (let offset = 0; offset <= 7; offset++) {
        const candidate = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + offset,
            hour,
            minute,
            0,
            0
        );
        if (allowedDays.includes(candidate.getDay()) && candidate.getTime() > baseTime + minBufferMs) {
            return candidate;
        }
    }
    return null;
}

function computeNextWakeDate(now, onTimeStr, allowedDays) {
    return computeNextDateForTime(now, onTimeStr, allowedDays, 30000);
}

function computeNextOffDate(now, offTimeStr, allowedDays) {
    return computeNextDateForTime(now, offTimeStr, allowedDays, 30000);
}

class PowerScheduler {
    constructor() {
        this.db = null;
        this.io = null;
        this.wol = null;
        this.clientSockets = null;
        this.timer = null;
        this.lastWarnKey = null;
        this.lastOffKey = null;
        this.lastOnKey = null;
        this.lastWeekendEnforceKey = null;
        this.config = {
            enabled: true,
            action: 'suspend',
            offTime: '18:30',
            onTime: '07:30',
            days: [1, 2, 3, 4, 5],
            useRtc: true,
            warnMinutes: 2,
            enforceWeekend: false
        };
    }

    start(db, io, wol, clientSockets) {
        this.db = db;
        this.io = io;
        this.wol = wol;
        this.clientSockets = clientSockets;

        this.reloadConfig().catch(() => {});
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => {
            this.tick().catch((err) => {
                console.error('⚠️ Error en PowerScheduler tick:', err.message);
            });
        }, 30000);
        console.log('⏰ PowerScheduler iniciado (L-V 07:30 encendido / 18:30 suspender por defecto)');
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    reloadConfig() {
        return new Promise((resolve) => {
            if (!this.db) return resolve(this.config);
            this.db.all(`SELECT key, value FROM settings WHERE key LIKE 'power_schedule_%'`, [], (err, rows) => {
                if (err || !rows) return resolve(this.config);
                const map = {};
                rows.forEach(r => { map[r.key] = r.value; });

                const offParsed = parseHHMM(map.power_schedule_off_time || '18:30', '18:30');
                const onParsed = parseHHMM(map.power_schedule_on_time || '07:30', '07:30');

                this.config = {
                    enabled: map.power_schedule_enabled !== undefined ? (map.power_schedule_enabled === '1' || map.power_schedule_enabled === 'true') : true,
                    action: map.power_schedule_action === 'shutdown' ? 'shutdown' : 'suspend',
                    offTime: formatHHMM(offParsed.hour, offParsed.minute),
                    onTime: formatHHMM(onParsed.hour, onParsed.minute),
                    days: parseDays(map.power_schedule_days !== undefined ? map.power_schedule_days : '1,2,3,4,5'),
                    useRtc: map.power_schedule_use_rtc !== undefined ? (map.power_schedule_use_rtc === '1' || map.power_schedule_use_rtc === 'true') : true,
                    warnMinutes: map.power_schedule_warn_minutes !== undefined ? Math.max(0, Math.min(30, Number(map.power_schedule_warn_minutes) || 0)) : 2,
                    enforceWeekend: map.power_schedule_enforce_weekend === '1' || map.power_schedule_enforce_weekend === 'true'
                };
                resolve(this.config);
            });
        });
    }

    getStatus(now = new Date()) {
        const nextOff = this.config.enabled ? computeNextOffDate(now, this.config.offTime, this.config.days) : null;
        const nextWake = this.config.enabled ? computeNextWakeDate(now, this.config.onTime, this.config.days) : null;
        return {
            config: this.config,
            nextOff: nextOff ? nextOff.toISOString() : null,
            nextOffLocal: nextOff ? formatLocalMinuteKey(nextOff) : null,
            nextWake: nextWake ? nextWake.toISOString() : null,
            nextWakeLocal: nextWake ? formatLocalMinuteKey(nextWake) : null,
            serverTime: now.toISOString(),
            serverLocalTime: formatLocalMinuteKey(now)
        };
    }

    emitOffToAllConnected(now, reasonLabel = 'horario programado') {
        if (!this.clientSockets || this.clientSockets.size === 0) return 0;
        const nextWake = computeNextWakeDate(now, this.config.onTime, this.config.days);
        const wakeAtEpoch = (this.config.useRtc && nextWake) ? Math.floor(nextWake.getTime() / 1000) : null;
        const action = this.config.action === 'shutdown' ? 'shutdown' : 'suspend';

        let count = 0;
        for (const [, socket] of this.clientSockets.entries()) {
            socket.emit('system_command', {
                command: action,
                payload: { wakeAtEpoch, scheduled: true }
            });
            count++;
        }
        console.log(`🌙 PowerScheduler (${reasonLabel}): enviado '${action}' a ${count} equipo(s). Próximo despertar RTC: ${nextWake ? formatLocalMinuteKey(nextWake) : 'N/A'}`);
        return count;
    }

    sendWolBursts() {
        if (!this.db || !this.wol) return;
        this.db.all(
            `SELECT mac_address FROM clients WHERE mac_address IS NOT NULL AND mac_address != '' AND mac_address != '00:00:00:00:00:00'`,
            [],
            (err, rows) => {
                if (err || !rows || rows.length === 0) return;
                const macs = rows.map(r => r.mac_address);
                const sendPass = (passNum) => {
                    macs.forEach(mac => {
                        try {
                            this.wol.wake(mac, () => {});
                        } catch (e) {}
                    });
                    console.log(`✨ PowerScheduler: ráfaga Wake-on-LAN #${passNum} enviada a ${macs.length} estación(es)`);
                };
                sendPass(1);
                setTimeout(() => sendPass(2), 5000);
                setTimeout(() => sendPass(3), 10000);
            }
        );
    }

    async tick(now = new Date()) {
        if (!this.config.enabled) return;

        const minuteKey = formatLocalMinuteKey(now);
        const hhmm = formatHHMM(now.getHours(), now.getMinutes());
        const day = now.getDay();
        const isActiveDay = this.config.days.includes(day);

        // 1. Aviso previo antes de apagar/suspender
        if (isActiveDay && this.config.warnMinutes > 0) {
            const { hour: offH, minute: offM } = parseHHMM(this.config.offTime, '18:30');
            const todayOff = new Date(now.getFullYear(), now.getMonth(), now.getDate(), offH, offM, 0, 0);
            const warnDate = new Date(todayOff.getTime() - this.config.warnMinutes * 60000);
            if (formatLocalMinuteKey(warnDate) === minuteKey && this.lastWarnKey !== minuteKey) {
                this.lastWarnKey = minuteKey;
                const verb = this.config.action === 'shutdown' ? 'apagará' : 'suspenderá';
                const msg = `Aviso del Laboratorio: este equipo se ${verb} automáticamente en ${this.config.warnMinutes} minuto(s) (${this.config.offTime}). Guarda tu trabajo.`;
                if (this.clientSockets) {
                    for (const [, socket] of this.clientSockets.entries()) {
                        socket.emit('system_command', { command: 'announcement', payload: msg });
                    }
                }
                console.log(`📢 PowerScheduler: aviso previo enviado (${this.config.warnMinutes} min antes de ${this.config.offTime})`);
            }
        }

        // 2. Apagado o suspensión programada (18:30 L-V por defecto)
        if (isActiveDay && hhmm === this.config.offTime && this.lastOffKey !== minuteKey) {
            this.lastOffKey = minuteKey;
            this.emitOffToAllConnected(now, 'cierre diario');
        }

        // 3. Encendido Wake-on-LAN programado (07:30 L-V por defecto)
        if (isActiveDay && hhmm === this.config.onTime && this.lastOnKey !== minuteKey) {
            this.lastOnKey = minuteKey;
            this.sendWolBursts();
        }

        // 4. Protección opcional de fin de semana / días inactivos
        if (!isActiveDay && this.config.enforceWeekend && now.getMinutes() % 5 === 0 && this.lastWeekendEnforceKey !== minuteKey) {
            if (this.clientSockets && this.clientSockets.size > 0) {
                this.lastWeekendEnforceKey = minuteKey;
                this.emitOffToAllConnected(now, 'control fin de semana');
            }
        }
    }
}

module.exports = new PowerScheduler();
module.exports.PowerScheduler = PowerScheduler;
module.exports.parseHHMM = parseHHMM;
module.exports.parseDays = parseDays;
module.exports.computeNextWakeDate = computeNextWakeDate;
module.exports.computeNextOffDate = computeNextOffDate;
