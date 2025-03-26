const { contextBridge, ipcRenderer, shell, clipboard } = require('electron');

// Expose protected methods that allow the renderer process to use
// Electron's APIs
contextBridge.exposeInMainWorld('api', {
  openExternal: (url) => {
    shell.openExternal(url);
  },
  copyToClipboard: (text) => {
    clipboard.writeText(text);
    return true;
  },
  // Add function for downloading files
  downloadFile: (url, filename) => {
    ipcRenderer.send('download-file', { url, filename });
    return true;
  },
  // Add function to create and save clip files if needed
  saveClip: (blobUrl, filename) => {
    // This would need implementation in main.js to handle saving files
    ipcRenderer.send('save-clip', { blobUrl, filename });
  }
});

// Add IPC listeners for download events
ipcRenderer.on('download-progress', (event, data) => {
  // Forward the progress to the renderer
  window.postMessage({ type: 'download-progress', data }, '*');
});

ipcRenderer.on('download-complete', (event, data) => {
  // Forward the result to the renderer
  window.postMessage({ type: 'download-complete', data }, '*');
});

ipcRenderer.on('download-error', (event, data) => {
  // Forward the error to the renderer
  window.postMessage({ type: 'download-error', data }, '*');
});

// You could also add IPC listeners here to handle responses from main process
ipcRenderer.on('save-clip-result', (event, result) => {
  // Forward the result to the renderer
  window.postMessage({ type: 'save-clip-result', result }, '*');
});