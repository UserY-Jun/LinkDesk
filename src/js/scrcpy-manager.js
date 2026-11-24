const { app } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const net = require('net');

const isWirelessSerial = serial => serial.includes(':') || serial.includes('._adb-tls-connect._tcp');

class ScrcpyManager {
  constructor() {
    this.platform = process.platform;
    this.arch = process.arch;
    this.currentSession = null;
    this.resourcesDir = this.resolveResourcesDir();
    this.adbPath = this.resolveAdbPath();
    this.serverPath = this.resolveServerPath();
  }

  resolveResourcesDir() {
    return (app && app.isPackaged)
      ? process.resourcesPath
      : path.join(__dirname, '..', '..', 'resources');
  }

  resolveServerPath() {
    return path.join(this.resourcesDir, 'scrcpy-server');
  }

  resolveAdbPath() {
    let folder = '';
    if (this.platform === 'win32') {
      folder = this.arch === 'x64' ? 'win64' : 'win32';
    } else if (this.platform === 'darwin') {
      folder = this.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
    } else {
      folder = 'linux';
    }

    const execName = this.platform === 'win32' ? 'adb.exe' : 'adb';
    const bundled = path.join(this.resourcesDir, 'bin', folder, execName);

    if (fs.existsSync(bundled)) {
      if (this.platform !== 'win32') {
        try {
          fs.chmodSync(bundled, 0o755);
        } catch (e) {
          console.warn('chmod adb warning:', e.message);
        }
      }
      return bundled;
    }

    // System fallback
    return 'adb';
  }

  getAdbPath() {
    return this.adbPath;
  }

  getScrcpyServerPath() {
    return this.serverPath;
  }

  /**
   * 确保本地 ADB 守护进程已启动
   */
  async ensureAdbServer() {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: 5037 }, () => {
        socket.end();
        resolve(true);
      });

      socket.on('error', () => {
        try {
          const adbProcess = spawn(this.adbPath, ['start-server'], {
            stdio: 'ignore',
            detached: true
          });
          adbProcess.on('close', () => setTimeout(resolve, 400));
          adbProcess.on('error', () => resolve(false));
        } catch (e) {
          resolve(false);
        }
      });
    });
  }

  /**
   * 获取 @yume-chan/adb AdbServerClient
   */
  async getAdbClient() {
    await this.ensureAdbServer();
    const { AdbServerClient } = await import('@yume-chan/adb');
    const { AdbServerNodeTcpConnector } = await import('@yume-chan/adb-server-node-tcp');
    return new AdbServerClient(new AdbServerNodeTcpConnector({ host: '127.0.0.1', port: 5037 }));
  }

  /**
   * 执行 adb 基础命令
   */
  async execAdb(args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.adbPath, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`ADB command failed (${code}): ${stderr}`));
      });

      proc.on('error', (err) => {
        reject(new Error(`Execute adb failed: ${err.message}`));
      });
    });
  }

  /**
   * 获取所有连接设备列表
   */
  async listDevices() {
    try {
      const client = await this.getAdbClient();
      const rawDevices = await client.getDevices(['device', 'unauthorized', 'offline']);
      return rawDevices.map((d) => {
        const isWifi = isWirelessSerial(d.serial);
        return {
          id: d.serial,
          status: d.state,
          type: isWifi ? 'wireless' : 'usb',
          info: {
            model: d.model || 'Android Device',
            product: d.product || ''
          }
        };
      });
    } catch (e) {
      console.warn('AdbClient getDevices failed, fallback to execAdb:', e.message);
      try {
        const output = await this.execAdb(['devices', '-l']);
        const lines = output.split('\n').slice(1);
        const devices = [];

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('*')) {
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 2) {
              const id = parts[0];
              const status = parts[1];
              const info = {};
              for (let i = 2; i < parts.length; i++) {
                const [k, v] = parts[i].split(':');
                if (k && v) info[k] = v;
              }
              const isWifi = isWirelessSerial(id);
              devices.push({ id, status, info, type: isWifi ? 'wireless' : 'usb' });
            }
          }
        }
        return devices;
      } catch (err) {
        console.error('List devices error:', err);
        throw new Error('无法读取设备，请检查 ADB 服务和 USB 连接');
      }
    }
  }

  async listUsbDevices() {
    const devices = await this.listDevices();
    return devices.filter((d) => d.type === 'usb');
  }

  async listWirelessDevices() {
    const devices = await this.listDevices();
    return devices.filter((d) => d.type === 'wireless');
  }

  async getDeviceIpAddress(deviceId) {
    try {
      const output = await this.execAdb(['-s', deviceId, 'shell', 'ip -f inet addr show wlan0 || ip -f inet addr show eth0']);
      const match = output.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
      if (match && match[1]) {
        return match[1];
      }
      throw new Error('未检测到设备有效 IP 地址，请确保设备已连接 WiFi。');
    } catch (e) {
      console.error('获取设备 IP 失败:', e.message);
      throw e;
    }
  }

  async enableTcpipMode(deviceId, port = 5555) {
    await this.execAdb(['-s', deviceId, 'tcpip', String(port)]);
    await new Promise((r) => setTimeout(r, 1000));
    return true;
  }

  async discoverWireless() {
    const client = await this.getAdbClient();
    const services = await client.mDns.getServices();
    const found = new Map();
    for (const entry of services) {
      // ADB versions use tabs or padded spaces between columns.
      const columns = [entry.name, entry.service, entry.address].filter(Boolean).join(' ').trim().split(/\s+/);
      const [name, service, address] = columns;
      const match = /^_adb-tls-(pairing|connect)\._tcp\.?$/.exec(service);
      if (!match || !address) continue;
      found.set(service + address, { name, address, kind: match[1] });
    }
    return [...found.values()];
  }

  async pairWireless(address, code) {
    const match = /^(\d+\.\d+\.\d+\.\d+|\[[a-fA-F0-9:]+\]):(\d{1,5})$/.exec(String(address));
    if (!match || !net.isIP(match[1].replace(/^\[|\]$/g, '')) || +match[2] < 1 || +match[2] > 65535) {
      throw new Error('请输入配对弹窗里的 IP 地址和端口');
    }
    if (!/^\d{6}$/.test(code)) throw new Error('配对码应为六位数字');
    try {
      const client = await this.getAdbClient();
      await client.wireless.pair(address, code);
    } catch {
      throw new Error('配对失败，请确认手机与电脑在同一 WiFi，并使用弹窗中最新的配对地址和配对码');
    }
  }

  async connectOverWifi(deviceIp) {
    const ip = deviceIp.includes(':') ? deviceIp : `${deviceIp}:5555`;
    const res = await this.execAdb(['connect', ip]);
    if (!/^(already )?connected to /im.test(res)) {
      throw new Error(`连接失败: ${res}`);
    }
    return res;
  }

  async disconnectDevice(deviceId) {
    await this.execAdb(['disconnect', deviceId]);
    return true;
  }

  async isDeviceLocked(deviceId) {
    try {
      const res = await this.execAdb([
        '-s', deviceId, 'shell',
        'dumpsys window | grep -E "mDreamingLockscreen=true|mShowingLockscreen=true"'
      ]);
      return res.trim().length > 0;
    } catch (e) {
      return false;
    }
  }

  async unlockDevice(deviceId, password = '') {
    try {
      const locked = await this.isDeviceLocked(deviceId);
      if (!locked) return true;

      await this.execAdb(['-s', deviceId, 'shell', 'input keyevent KEYCODE_WAKEUP']);
      await new Promise((r) => setTimeout(r, 400));
      await this.execAdb(['-s', deviceId, 'shell', 'input swipe 500 1500 500 500']);
      await new Promise((r) => setTimeout(r, 400));

      if (password && password.length > 0) {
        const sanitized = password.replace(/([^a-zA-Z0-9])/g, '\\$1');
        await this.execAdb(['-s', deviceId, 'shell', `input text ${sanitized}`]);
        await new Promise((r) => setTimeout(r, 200));
        await this.execAdb(['-s', deviceId, 'shell', 'input keyevent KEYCODE_ENTER']);
        await new Promise((r) => setTimeout(r, 800));
      }

      const stillLocked = await this.isDeviceLocked(deviceId);
      return !stillLocked;
    } catch (e) {
      console.error('解锁失败:', e);
      return false;
    }
  }

  /**
   * 启动 @yume-chan/scrcpy 投屏会话
   */
  async startSession({ deviceId, options = {}, onPacket, onSizeChanged, onExited }) {
    if (this.currentSession) {
      await this.stopSession();
    }

    const client = await this.getAdbClient();
    const devices = await client.getDevices();
    const device = devices.find((d) => d.serial === deviceId) || { serial: deviceId };
    const adb = await client.createAdb(device);

    const { AdbScrcpyClient, AdbScrcpyOptions3_2 } = await import('@yume-chan/adb-scrcpy');
    const { Consumable } = await import('@yume-chan/stream-extra');
    const { DefaultServerPath } = await import('@yume-chan/scrcpy');

    // 推送 scrcpy-server.jar 到设备
    const serverBuffer = fs.readFileSync(this.serverPath);
    const serverStream = new Consumable.ReadableStream({
      async start(controller) {
        await controller.enqueue(new Uint8Array(serverBuffer));
        controller.close();
      }
    });
    await AdbScrcpyClient.pushServer(adb, serverStream, DefaultServerPath);

    // 计算比特率
    let videoBitRate = 4000000;
    if (typeof options.bitRate === 'string') {
      const val = parseFloat(options.bitRate);
      if (options.bitRate.toUpperCase().endsWith('M')) videoBitRate = val * 1000000;
      else if (options.bitRate.toUpperCase().endsWith('K')) videoBitRate = val * 1000;
      else if (!isNaN(val)) videoBitRate = val;
    } else if (typeof options.bitRate === 'number') {
      videoBitRate = options.bitRate;
    }

    const scrcpyOptions = new AdbScrcpyOptions3_2({
      maxSize: parseInt(options.maxResolution || options.maxSize || '0', 10),
      videoBitRate,
      maxFps: parseInt(options.maxFps || '0', 10),
      stayAwake: options.stayAwake ?? true,
      showTouches: options.showTouches ?? false,
      captureOrientation: ({ '1': '@0', '2': '@90' })[options.rotation],
      powerOffOnClose: options.powerOffOnClose === true,
      tunnelForward: false,
      audio: false, // 优先画面低延迟
      video: true,
      control: true,
      sendDummyByte: true,
      cleanup: true
    });

    const scrcpyClient = await AdbScrcpyClient.start(adb, DefaultServerPath, scrcpyOptions);
    const session = this.currentSession = {
      scrcpyClient,
      options: scrcpyOptions,
      closed: false
    };

    const videoStream = await scrcpyClient.videoStream;
    if (videoStream) {
      if (videoStream.width && videoStream.height) {
        onSizeChanged?.({ width: videoStream.width, height: videoStream.height });
      }

      videoStream.sizeChanged((size) => {
        onSizeChanged?.(size);
      });

      (async () => {
        try {
          const reader = videoStream.stream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done || session.closed) break;
            if (onPacket && value) {
              onPacket({
                type: value.type,
                data: value.data,
                keyframe: value.keyframe
              });
            }
          }
        } catch (e) {
          console.warn('Scrcpy video stream ended:', e?.message || e);
        }
      })();
    }

    scrcpyClient.exited.finally(() => {
      if (this.currentSession === session) this.currentSession = null;
      onExited?.();
    }).catch(console.warn);

    return { success: true };
  }

  async injectTouch(touch) {
    if (!this.currentSession?.scrcpyClient?.controller) return;
    const { AndroidMotionEventAction, AndroidMotionEventButton, ScrcpyPointerId } = await import('@yume-chan/scrcpy');

    let action;
    if (touch.action === 'down') action = AndroidMotionEventAction.Down;
    else if (touch.action === 'move') action = AndroidMotionEventAction.Move;
    else if (touch.action === 'up') action = AndroidMotionEventAction.Up;
    else return;

    await this.currentSession.scrcpyClient.controller.injectTouch({
      action,
      pointerId: ScrcpyPointerId.Finger,
      pointerX: Math.round(touch.x),
      pointerY: Math.round(touch.y),
      videoWidth: Math.round(touch.width),
      videoHeight: Math.round(touch.height),
      pressure: touch.pressure ?? 1.0,
      actionButton: AndroidMotionEventButton.Primary,
      buttons: touch.action === 'up' ? 0 : AndroidMotionEventButton.Primary
    });
  }

  async injectKeyCode(keyName) {
    if (!this.currentSession?.scrcpyClient?.controller) return;
    const { AndroidKeyCode, AndroidKeyEventAction } = await import('@yume-chan/scrcpy');

    const controller = this.currentSession?.scrcpyClient.controller;
    if (!controller) return;
    let keyCode;
    const lower = String(keyName).toLowerCase();
    if (lower === 'back') keyCode = AndroidKeyCode.AndroidBack;
    else if (lower === 'home') keyCode = AndroidKeyCode.AndroidHome;
    else if (lower === 'appswitch' || lower === 'recents') keyCode = AndroidKeyCode.AndroidAppSwitch;
    else if (lower === 'power') keyCode = AndroidKeyCode.Power;
    else if (lower === 'volumeup') keyCode = AndroidKeyCode.VolumeUp;
    else if (lower === 'volumedown') keyCode = AndroidKeyCode.VolumeDown;
    else if (typeof keyName === 'number') keyCode = keyName;
    else return;

    await controller.injectKeyCode({
      repeat: 0, metaState: 0,
      keyCode,
      action: AndroidKeyEventAction.Down
    });
    await controller.injectKeyCode({
      repeat: 0, metaState: 0,
      keyCode,
      action: AndroidKeyEventAction.Up
    });
  }

  async injectScroll(scroll) {
    if (!this.currentSession?.scrcpyClient?.controller) return;
    await this.currentSession.scrcpyClient.controller.injectScroll({
      pointerX: Math.round(scroll.x),
      pointerY: Math.round(scroll.y),
      videoWidth: Math.round(scroll.width),
      videoHeight: Math.round(scroll.height),
      scrollX: scroll.scrollX,
      scrollY: scroll.scrollY,
      buttons: 0
    });
  }

  async pressBackOrTurnOnScreen() {
    if (!this.currentSession?.scrcpyClient?.controller) return;
    await this.currentSession.scrcpyClient.controller.pressBackOrTurnOnScreen();
  }

  async stopSession() {
    if (this.currentSession) {
      this.currentSession.closed = true;
      try {
        await this.currentSession.scrcpyClient.close();
      } catch (e) {
        console.warn('Close scrcpyClient error:', e?.message || e);
      }
      this.currentSession = null;
      return { success: true };
    }
    return { success: false, message: '无运行中的投屏会话' };
  }

  cleanup() {
    if (this.currentSession) {
      this.stopSession();
    }
  }
}

module.exports = new ScrcpyManager();
