const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('imageStudioDesktop', {
  isDesktop: true,
  platform: process.platform,
})
