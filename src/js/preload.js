const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deviceFiles', {
  list: (device, parts) => ipcRenderer.invoke('files:list', { device, parts }),
  change: (device, parts, action, names) => ipcRenderer.invoke('files:change', { device, parts, action, names }),
  onProgress: listener => {
    const receive = (_event, data) => listener(data);
    ipcRenderer.on('files:progress', receive);
    return () => ipcRenderer.removeListener('files:progress', receive);
  }
});

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('androidController', {
  // 设备管理
  listUsbDevices: () => ipcRenderer.invoke('list-usb-devices'),
  listWirelessDevices: () => ipcRenderer.invoke('list-wireless-devices'),
  getDeviceIp: (deviceId) => ipcRenderer.invoke('get-device-ip', deviceId),
  
  // 无线连接功能
  initWireless: (deviceId) => ipcRenderer.invoke('init-wireless', deviceId),
  discoverWireless: () => ipcRenderer.invoke('discover-wireless'),
  pairWireless: (address, code) => ipcRenderer.invoke('pair-wireless', { address, code }),
  connectWireless: (ip) => ipcRenderer.invoke('connect-wireless', ip),
  disconnectWireless: (deviceId) => ipcRenderer.invoke('disconnect-wireless', deviceId),
  
  // scrcpy 控制
  startScrcpy: (config) => ipcRenderer.invoke('start-scrcpy', config),
  startScrcpyWireless: (config) => ipcRenderer.invoke('start-scrcpy-wireless', config),
  stopScrcpy: () => ipcRenderer.invoke('stop-scrcpy'),
  sendControl: (action, payload) => ipcRenderer.invoke('scrcpy-control', { action, payload }),

  // 设备解锁功能
  isDeviceLocked: (deviceId) => ipcRenderer.invoke('is-device-locked', deviceId),
  unlockDevice: (deviceId, password) => ipcRenderer.invoke('unlock-device', deviceId, password)
});

contextBridge.exposeInMainWorld('windowControls', {
  pinPhone: pinned => ipcRenderer.send('phone-display-pin', pinned),
  minimizePhone: () => ipcRenderer.send('phone-display-minimize'),
  resizePhone: data => ipcRenderer.send('phone-display-resize', data),
  fitPhone: ratio => ipcRenderer.send('phone-display-ratio', ratio),
  minimize: () => ipcRenderer.invoke('window-minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window-toggle-maximize'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  close: () => ipcRenderer.invoke('window-close')
});

ipcRenderer.on('scrcpy-stream-port', event => {
  if (event.ports[0]) window.postMessage('scrcpy-stream-port', '*', [event.ports[0]]);
});
