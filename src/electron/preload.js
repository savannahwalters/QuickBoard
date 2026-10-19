const { contextBridge, ipcRenderer } = require('electron');

const loadDataHandlers = new Set();
const pendingLoadData = [];

ipcRenderer.on('quickboard:load-data', (_event, payload) => {
  if (loadDataHandlers.size === 0) {
    pendingLoadData.push(payload);
    return;
  }
  for (const handler of loadDataHandlers) {
    handler(payload);
  }
});

const validateFilePath = (payload) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid payload: must be an object');
  }
  const filePath = payload.filePath ?? payload.path;
  if (typeof filePath !== 'string' || !filePath.length) {
    throw new Error('Invalid payload: filePath must be a non-empty string');
  }
  // Prevent directory traversal
  if (filePath.includes('..')) {
    throw new Error('Invalid payload: filePath contains invalid characters');
  }
  return filePath;
};

const validateSavePayload = (payload) => {
  const filePath = validateFilePath(payload);
  if (typeof payload.data !== 'string') {
    throw new Error('Invalid payload: data must be a string');
  }
  return filePath;
};

// works with app ts file and renderer ts file to handle menu requests
contextBridge.exposeInMainWorld('quickboard', {
  onRequestSave: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('quickboard:request-save', listener);
    return () => ipcRenderer.removeListener('quickboard:request-save', listener);
  },
  onLoadData: (handler) => {
    loadDataHandlers.add(handler);
    const pending = pendingLoadData.splice(0);
    for (const payload of pending) {
      handler(payload);
    }
    return () => loadDataHandlers.delete(handler);
  },
  sendSaveData: (payload) => {
    let filePath;
    try {
      filePath = validateSavePayload(payload);
    } catch (err) {
      console.error('quickboard: rejected invalid save payload', err);
      return;
    }
    ipcRenderer.send('quickboard:save-data', { filePath, data: payload.data });
  },
  sendSaveBinary: (payload) => {
    let filePath;
    try {
      filePath = validateFilePath(payload);
    } catch (err) {
      console.error('quickboard: rejected invalid binary save payload', err);
      return;
    }
    if (!(payload.data instanceof Uint8Array)) {
      console.error('quickboard: binary save data must be Uint8Array');
      return;
    }
    ipcRenderer.send('quickboard:save-binary', { filePath, data: payload.data });
  },
  requestSave: () => {
    ipcRenderer.send('quickboard:request-save-from-renderer');
  },
  requestSaveAs: () => {
    ipcRenderer.send('quickboard:request-save-as-from-renderer');
  },
  loadIn: () => {
    ipcRenderer.send('quickboard:load-board-into-renderer');
  },
  onThemeChanged: (handler) => {
    const listener = (_event, theme) => handler(theme);
    ipcRenderer.on('quickboard:theme-changed', listener);
    return () => ipcRenderer.removeListener('quickboard:theme-changed', listener);
  },
  getThemeSource: () => ipcRenderer.invoke('quickboard:get-theme-source'),
  setCustomTheme: (theme) => {
    ipcRenderer.send('quickboard:set-custom-theme', theme);
  },
  onShortcut: (handler) => {
    const listener = (_event, option) => handler(option);
    ipcRenderer.on('quickboard:shortcut', listener);
    return () => ipcRenderer.removeListener('quickboard:shortcut', listener);
  },
  onSaveResult: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('quickboard:save-result', listener);
    return () => ipcRenderer.removeListener('quickboard:save-result', listener);
  },
  requestExport: () => {
    ipcRenderer.send('quickboard:request-export-from-renderer');
  },
  onRequestExport: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('quickboard:request-export', listener);
    return () => ipcRenderer.removeListener('quickboard:request-export', listener);
  },
  sendPngExportFrame: async (payload) => {
    if (
      !payload ||
      typeof payload.dirPath !== 'string' ||
      typeof payload.name !== 'string' ||
      !(payload.buffer instanceof Uint8Array) ||
      typeof payload.index !== 'number' ||
      typeof payload.total !== 'number'
    ) {
      console.error('quickboard: invalid PNG export frame payload');
      return { success: false, message: 'Invalid payload' };
    }
    // Prevent path traversal in caller-supplied file name
    if (payload.name.includes('..') || payload.name.includes('/') || payload.name.includes('\\')) {
      console.error('quickboard: rejected frame payload with invalid name');
      return { success: false, message: 'Invalid file name' };
    }
    return ipcRenderer.invoke('quickboard:png-export-frame', {
      dirPath: payload.dirPath,
      name: payload.name,
      buffer: payload.buffer,
      index: payload.index,
      total: payload.total,
    });
  },
  pickExportDir: () => ipcRenderer.invoke('quickboard:pick-export-dir'),
  sendVideoFile: async (payload) => {
    if (
      !payload ||
      typeof payload.dirPath !== 'string' ||
      typeof payload.name !== 'string' ||
      !(payload.buffer instanceof Uint8Array)
    ) {
      console.error('quickboard: invalid video file payload');
      return { success: false, message: 'Invalid payload' };
    }
    if (payload.name.includes('..') || payload.name.includes('/') || payload.name.includes('\\')) {
      console.error('quickboard: rejected video payload with invalid name');
      return { success: false, message: 'Invalid file name' };
    }
    return ipcRenderer.invoke('quickboard:save-video-file', {
      dirPath: payload.dirPath,
      name: payload.name,
      buffer: payload.buffer,
    });
  },
  getAppSettings: () => ipcRenderer.invoke('quickboard:get-app-settings'),
  saveAppSettings: (settings) => ipcRenderer.invoke('quickboard:save-app-settings', settings),
  restoreAppSettingsDefaults: () => ipcRenderer.invoke('quickboard:restore-app-settings-defaults'),
  selectFolder: () => ipcRenderer.invoke('quickboard:select-folder'),
});
