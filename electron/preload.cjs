const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('imageStudioDesktop', {
  isDesktop: true,
  platform: process.platform,
  selectImageSaveDirectory: () => ipcRenderer.invoke('image-studio:select-image-save-directory'),
  saveImageFile: (file) => ipcRenderer.invoke('image-studio:save-image-file', file),
  finishImageSave: () => ipcRenderer.invoke('image-studio:finish-image-save'),
  fetch: (payload) => ipcRenderer.invoke('image-studio:fetch', payload),
  getSecrets: () => ipcRenderer.invoke('image-studio:secrets-get'),
  setSecrets: (payload) => ipcRenderer.invoke('image-studio:secrets-set', payload),
})
