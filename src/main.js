const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const scrcpyManager = require('./js/scrcpy-manager');

let mainWindow;
const MirrorSession = require('./main/mirror-session');
const mirror = new MirrorSession(scrcpyManager);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#f5f6fa',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'js', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  let phoneWindow;
  let resize;
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.on('ipc-message', (_event, channel, ratio) => {
    if (!phoneWindow || phoneWindow.isDestroyed()) return;
    if (channel === 'phone-display-ratio') resize.fit(ratio);
    if (channel === 'phone-display-resize' && ratio) resize.pointer(ratio);
    if (channel === 'phone-display-pin' && typeof ratio === 'boolean') phoneWindow.setAlwaysOnTop(ratio);
    if (channel === 'phone-display-minimize') phoneWindow.minimize();
  });
  mainWindow.webContents.on('did-create-window', child => {
    phoneWindow = child;
    resize = require('./main/phone-resize')(child, require('electron').screen);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (url !== 'about:blank' || frameName !== 'phone-display') return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        title: '手机投屏', width: 390, height: 760, minWidth: 200, minHeight: 140,
        resizable: false, frame: false, hasShadow: false, roundedCorners: true, transparent: true, alwaysOnTop: false, autoHideMenuBar: true, backgroundColor: '#00000000',
        webPreferences: { preload: '', contextIsolation: true, nodeIntegration: false }
      }
    };
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mirror.stop();
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  setupIpcHandlers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  mirror.stop();
});

function setupIpcHandlers() {
  require('./main/device-files')(scrcpyManager, () => mainWindow);
  ipcMain.handle('window-minimize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
    return { success: true };
  });

  ipcMain.handle('window-toggle-maximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
      return { success: true, isMaximized: mainWindow.isMaximized() };
    }
    return { success: false, isMaximized: false };
  });

  ipcMain.handle('window-is-maximized', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      return { success: true, isMaximized: mainWindow.isMaximized() };
    }
    return { success: false, isMaximized: false };
  });

  ipcMain.handle('window-close', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
    return { success: true };
  });

  // 设备列表
  ipcMain.handle('list-usb-devices', async () => {
    try {
      return await scrcpyManager.listUsbDevices();
    } catch (error) {
      console.error('Error listing USB devices:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('list-wireless-devices', async () => {
    try {
      return await scrcpyManager.listWirelessDevices();
    } catch (error) {
      console.error('Error listing wireless devices:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-device-ip', async (event, deviceId) => {
    try {
      const ip = await scrcpyManager.getDeviceIpAddress(deviceId);
      return { success: true, ip };
    } catch (error) {
      console.error('Error getting device IP:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('init-wireless', async (event, deviceId) => {
    try {
      await scrcpyManager.enableTcpipMode(deviceId);
      const ip = await scrcpyManager.getDeviceIpAddress(deviceId);
      return { success: true, ip };
    } catch (error) {
      console.error('Error initializing wireless connection:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('discover-wireless', () => scrcpyManager.discoverWireless());

  ipcMain.handle('pair-wireless', async (_event, { address, code }) => {
    try {
      await scrcpyManager.pairWireless(address, code);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('connect-wireless', async (event, ip) => {
    try {
      const result = await scrcpyManager.connectOverWifi(ip);
      return { success: true, result };
    } catch (error) {
      console.error('Error connecting to wireless device:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('disconnect-wireless', async (event, deviceId) => {
    try {
      await scrcpyManager.disconnectDevice(deviceId);
      return { success: true };
    } catch (error) {
      console.error('Error disconnecting wireless device:', error);
      return { success: false, error: error.message };
    }
  });

  // 启动投屏会话 (基于 @yume-chan/scrcpy)
  ipcMain.handle('start-scrcpy', (event, config) => mirror.start(event.sender, config));
  ipcMain.handle('start-scrcpy-wireless', (event, { deviceIp, options }) =>
    mirror.start(event.sender, { deviceId: deviceIp, options }));
  ipcMain.handle('stop-scrcpy', () => mirror.stop());

  // 设备控制 IPC 备用通道
  ipcMain.handle('scrcpy-control', async (event, { action, payload }) => {
    try {
      if (action === 'touch') {
        await scrcpyManager.injectTouch(payload);
      } else if (action === 'keycode') {
        await scrcpyManager.injectKeyCode(payload);
      } else if (action === 'scroll') {
        await scrcpyManager.injectScroll(payload);
      } else if (action === 'back') {
        await scrcpyManager.pressBackOrTurnOnScreen();
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('is-device-locked', async (event, deviceId) => {
    try {
      const isLocked = await scrcpyManager.isDeviceLocked(deviceId);
      return { success: true, isLocked };
    } catch (error) {
      console.error('Error checking device lock status:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('unlock-device', async (event, deviceId, password) => {
    try {
      const unlocked = await scrcpyManager.unlockDevice(deviceId, password);
      return { success: unlocked, message: unlocked ? '设备解锁成功' : '设备解锁失败' };
    } catch (error) {
      console.error('Error unlocking device:', error);
      return { success: false, error: error.message };
    }
  });
}
