// Preload ContextBridge for LabDesk Renderer
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('labdeskAPI', {
    audio: {
        get: () => ipcRenderer.invoke('audio:get'),
        set: (level) => ipcRenderer.invoke('audio:set', level),
        toggleMute: () => ipcRenderer.invoke('audio:toggleMute'),
        getDevices: () => ipcRenderer.invoke('audio:getDevices'),
        setSink: (sinkName) => ipcRenderer.invoke('audio:setSink', sinkName),
        setSource: (sourceName) => ipcRenderer.invoke('audio:setSource', sourceName),
        autoSelectUsb: () => ipcRenderer.invoke('audio:autoSelectUsb'),
        onStateChanged: (callback) => ipcRenderer.on('audio_state_changed', (e, data) => callback(data))
    },
    system: {
        getInfo: () => ipcRenderer.invoke('system:info'),
        shutdown: () => ipcRenderer.invoke('system:shutdown'),
        reboot: () => ipcRenderer.invoke('system:reboot'),
        setOverlayMode: (active, restoreExternalBrowser = false) =>
            ipcRenderer.invoke('system:setOverlayMode', { active, restoreExternalBrowser }),
        onAnnouncement: (callback) => ipcRenderer.on('show_announcement', (e, data) => callback(data))
    },
    browser: {
        getState: () => ipcRenderer.invoke('browser:getState'),
        openTab: (url, isKiosk) => ipcRenderer.invoke('browser:openTab', { url, isKiosk }),
        focusExternal: () => ipcRenderer.invoke('browser:focusExternal'),
        minimizeExternal: () => ipcRenderer.invoke('browser:minimizeExternal'),
        closeExternal: () => ipcRenderer.invoke('browser:closeExternal'),
        goHomeCaptive: () => ipcRenderer.invoke('browser:goHomeCaptive'),
        reloadCaptive: () => ipcRenderer.invoke('browser:reloadCaptive'),
        setKioskExam: (enable, url) => ipcRenderer.invoke('browser:setKioskExam', { enable, url }),
        updateBounds: (bounds) => ipcRenderer.invoke('browser:updateBounds', bounds),
        hideTabs: () => ipcRenderer.invoke('browser:hideTabs'),
        showTabs: () => ipcRenderer.invoke('browser:showTabs'),
        clearSession: () => ipcRenderer.invoke('browser:clearSession'),
        onStateChanged: (callback) => ipcRenderer.on('browser_state_changed', (e, data) => callback(data)),
        onRemoteOpenUrl: (callback) => ipcRenderer.on('browser_open_url_event', (e, data) => callback(data))
    },
    lock: {
        onLockStateChanged: (callback) => ipcRenderer.on('screen_lock_state', (e, data) => callback(data)),
        localUnlock: () => ipcRenderer.invoke('lock:localUnlock')
    },
    files: {
        saveLocal: (filename, content) => ipcRenderer.invoke('files:saveLocal', { filename, content })
    },
    turnIn: {
        submitFile: (data) => ipcRenderer.invoke('turnIn:submitFile', data)
    },
    connection: {
        onServerConnectionChanged: (callback) => ipcRenderer.on('server_connection_changed', (e, data) => callback(data))
    }
});
