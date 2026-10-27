// Lock Screen & Kiosk Lock Logic
let activePin = '2846';
let enteredPin = '';

document.addEventListener('DOMContentLoaded', () => {
    if (!window.labdeskAPI) return;

    window.labdeskAPI.lock.onLockStateChanged((data) => {
        const lockEl = document.getElementById('lockscreen');
        if (data.locked) {
            activePin = data.pin || '2846';
            document.getElementById('lock-msg').textContent = data.message || 'La estación ha sido bloqueada temporalmente por el profesor.';
            clearPin();
            lockEl.classList.add('show');
        } else {
            lockEl.classList.remove('show');
        }
        if (window.syncBrowserBounds) window.syncBrowserBounds();
    });
});

function pressPin(digit) {
    if (enteredPin.length < 6) {
        enteredPin += digit;
        updatePinDisplay();
    }
}

function clearPin() {
    enteredPin = '';
    updatePinDisplay();
}

function updatePinDisplay() {
    document.getElementById('pin-display').value = '•'.repeat(enteredPin.length);
}

function submitPin() {
    if (enteredPin === activePin) {
        document.getElementById('lockscreen').classList.remove('show');
        if (window.labdeskAPI) window.labdeskAPI.lock.localUnlock();
        clearPin();
    } else {
        alert('PIN incorrecto. Solicita asistencia al profesor.');
        clearPin();
    }
}
