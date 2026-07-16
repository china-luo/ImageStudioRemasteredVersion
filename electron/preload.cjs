const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('imageStudioDesktop', {
  isDesktop: true,
  platform: process.platform,
  selectImageSaveDirectory: () => ipcRenderer.invoke('image-studio:select-image-save-directory'),
  saveImageFile: (file) => ipcRenderer.invoke('image-studio:save-image-file', file),
  finishImageSave: () => ipcRenderer.invoke('image-studio:finish-image-save'),
})
