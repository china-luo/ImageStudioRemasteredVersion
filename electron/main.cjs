const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow, dialog, shell } = require('electron')

const APP_TITLE = '跨境Image工作台'
const APP_ID = 'com.chinaluo.imagestudio'
const APP_ICON_PATH = path.join(__dirname, '..', 'build', 'icon.ico')

function getAppIconPath() {
  return fs.existsSync(APP_ICON_PATH) ? APP_ICON_PATH : undefined
}

function isExternalUrl(url) {
  return /^https?:\/\//i.test(url)
}

function createMainWindow() {
  let allowClose = false
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    title: APP_TITLE,
    backgroundColor: '#f9fafb',
    autoHideMenuBar: true,
    icon: getAppIconPath(),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The renderer calls user-configured AI providers directly. In the desktop
      // app this avoids browser-only CORS failures while keeping Node disabled.
      webSecurity: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', (event) => {
    if (allowClose || mainWindow.isDestroyed()) return

    event.preventDefault()
    dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: '关闭跨境Image工作台',
      message: '请选择关闭后的操作',
      detail: '退出应用会完全关闭程序；最小化会将窗口收起到任务栏，稍后可从任务栏恢复。',
      buttons: ['退出应用', '最小化', '取消'],
      defaultId: 1,
      cancelId: 2,
      noLink: true,
      normalizeAccessKeys: true,
    }).then(({ response }) => {
      if (mainWindow.isDestroyed()) return
      if (response === 0) {
        allowClose = true
        mainWindow.close()
        return
      }
      if (response === 1) {
        mainWindow.minimize()
      }
    }).catch(() => {
      if (!mainWindow.isDestroyed()) mainWindow.minimize()
    })
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL() && isExternalUrl(url)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  if (!app.isPackaged && process.env.ELECTRON_START_URL) {
    mainWindow.loadURL(process.env.ELECTRON_START_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.setName(APP_TITLE)
app.setAppUserModelId(APP_ID)

app.whenReady().then(() => {
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
