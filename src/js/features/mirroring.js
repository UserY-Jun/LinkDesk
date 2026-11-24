import { createPhoneWindow } from './phone-window.js';
import { getState, setState } from '../state/appState.js';
import { clearElement, createElement, setHidden } from '../ui/dom.js';
import { createLoading, createAlert } from '../ui/components.js';
import { WebCodecsVideoDecoder, BitmapVideoFrameRenderer } from '@yume-chan/scrcpy-decoder-webcodecs';
import { ScrcpyVideoCodecId } from '@yume-chan/scrcpy';

class ScreenPlayer {
  constructor() {
    this.canvas = null;
    this.wrapper = null;
    this.placeholder = null;
    this.decoder = null;
    this.port = null;
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.isDragging = false;
    this.initialized = false;
  }

  init({ canvasEl, wrapperEl, placeholderEl }) {
    if (this.initialized) return;
    this.canvas = canvasEl;
    this.wrapper = wrapperEl;
    this.placeholder = placeholderEl;

    this.navigation = document.getElementById('androidNavigation');
    this.detachButton = document.getElementById('detachScreen');
    this.phoneWindow = createPhoneWindow(document.getElementById('screenStage'), this.detachButton, document.getElementById('dockScreen'));
    this.bindMouseEvents();
    this.bindVirtualNavbar();

    // 监听主进程传来的流通道
    window.addEventListener('message', event => {
      if (event.source === window && event.data === 'scrcpy-stream-port' && event.ports[0]) {
        this.attachPort(event.ports[0]);
      }
    });

    this.initialized = true;
  }

  setupDecoder() {
    if (this.decoder) {
      try { this.decoder.dispose(); } catch (e) {}
      this.decoder = null;
    }

    const renderer = new BitmapVideoFrameRenderer(this.canvas);
    this.decoder = new WebCodecsVideoDecoder({
      codec: ScrcpyVideoCodecId.H264,
      renderer
    });

    this.decoder.sizeChanged(({ width, height }) => {
      this.onResolutionChanged(width, height);
    });
  }

  attachPort(port) {
    this.resetScreen();
    this.setupDecoder();
    this.writer = this.decoder.writable.getWriter();
    this.port = port;

    port.onmessage = async (event) => {
      if (port !== this.port) return;
      const msg = event.data;
      if (!msg) return;

      if (msg.type === 'size-changed' && msg.size) {
        this.onResolutionChanged(msg.size.width, msg.size.height);
      } else if (msg.type === 'packet' && msg.buffer) {
        this.navigation.disabled = this.detachButton.disabled = false;
        if (this.placeholder) {
          this.placeholder.style.display = 'none';
        }
        if (this.decoder && this.decoder.writable) {
          const packetData = new Uint8Array(msg.buffer);
          try {
            await this.writer.write({
              type: msg.packetType,
              data: packetData,
              keyframe: msg.keyframe
            });

          } catch (err) {
            // 忽略流关闭期间的微小异常
          }
        }
      } else if (msg.type === 'exited') {
        this.resetScreen();
        setState({ isMirroring: false });
      }
    };

    port.start();
  }

  onResolutionChanged(width, height) {
    if (!width || !height) return;
    this.videoWidth = width;
    this.videoHeight = height;

    this.canvas.width = width;
    this.canvas.height = height;

    if (this.wrapper) {
      this.wrapper.style.aspectRatio = `${width} / ${height}`;
      this.wrapper.style.setProperty('--video-ratio', String(width / height));
    }
  }

  bindMouseEvents() {
    if (!this.canvas) return;

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // 右键映射为 Android 返回键
      this.sendKey('back');
    });

    this.canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.canvas.focus();
      if (e.button === 0) { // 左键按下
        this.canvas.setPointerCapture(e.pointerId);
        this.isDragging = true;
        this.sendTouch('down', e.clientX, e.clientY);
      } else if (e.button === 1) { // 中键映射为 Home 键
        this.sendKey('home');
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (this.isDragging) {
        this.sendTouch('move', e.clientX, e.clientY);
      }
    });

    this.canvas.addEventListener('pointerup', (e) => {
      if (this.isDragging && e.button === 0) {
        this.isDragging = false;
        this.sendTouch('up', e.clientX, e.clientY);
      }
    });

    this.canvas.addEventListener('lostpointercapture', e => {
      if (this.isDragging) this.sendTouch('up', e.clientX, e.clientY);
      this.isDragging = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.sendScroll(e.clientX, e.clientY, -e.deltaX / 80, -e.deltaY / 80);
    }, { passive: false });
  }

  bindVirtualNavbar() {
    const btnBack = document.getElementById('btnNavBack');
    const btnHome = document.getElementById('btnNavHome');
    const btnAppSwitch = document.getElementById('btnNavAppSwitch');
    const btnPower = document.getElementById('btnNavPower');
    const btnVolDown = document.getElementById('btnNavVolDown');
    const btnVolUp = document.getElementById('btnNavVolUp');
    const btnScreenshot = document.getElementById('btnNavScreenshot');
    const btnFullscreen = document.getElementById('btnNavFullscreen');

    btnBack?.addEventListener('click', () => this.sendKey('back'));
    btnHome?.addEventListener('click', () => this.sendKey('home'));
    btnAppSwitch?.addEventListener('click', () => this.sendKey('appswitch'));
    btnPower?.addEventListener('click', () => this.sendKey('power'));
    btnVolDown?.addEventListener('click', () => this.sendKey('volumedown'));
    btnVolUp?.addEventListener('click', () => this.sendKey('volumeup'));

    btnScreenshot?.addEventListener('click', () => this.takeScreenshot());
    btnFullscreen?.addEventListener('click', () => this.toggleFullscreen());
  }

  sendTouch(action, clientX, clientY, pressure = 1.0) {
    if (!this.port || !this.videoWidth || !this.videoHeight || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.videoWidth / rect.width;
    const scaleY = this.videoHeight / rect.height;

    const x = Math.max(0, Math.min(this.videoWidth, (clientX - rect.left) * scaleX));
    const y = Math.max(0, Math.min(this.videoHeight, (clientY - rect.top) * scaleY));

    try {
      this.port.postMessage({
        type: 'touch',
        touch: {
          action,
          x,
          y,
          width: this.videoWidth,
          height: this.videoHeight,
          pressure
        }
      });
    } catch (e) {}
  }

  sendScroll(clientX, clientY, scrollX, scrollY) {
    if (!this.port || !this.videoWidth || !this.videoHeight || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.videoWidth / rect.width;
    const scaleY = this.videoHeight / rect.height;

    const x = Math.max(0, Math.min(this.videoWidth, (clientX - rect.left) * scaleX));
    const y = Math.max(0, Math.min(this.videoHeight, (clientY - rect.top) * scaleY));

    try {
      this.port.postMessage({
        type: 'scroll',
        scroll: {
          x,
          y,
          width: this.videoWidth,
          height: this.videoHeight,
          scrollX,
          scrollY
        }
      });
    } catch (e) {}
  }

  sendKey(keyName) {
    if (this.port) {
      try {
        this.port.postMessage({ type: 'keycode', keyName });
      } catch (e) {}
    } else if (window.androidController?.sendControl) {
      window.androidController.sendControl('keycode', keyName);
    }
  }

  takeScreenshot() {
    if (!this.canvas || !this.videoWidth) return;
    this.canvas.toBlob(async blob => {
      if (!blob) return this.onStatus?.('无法读取当前画面', 'error');
      if (this.getScreenshotMode?.() !== 'file' && navigator.clipboard && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          this.onStatus?.('截图已复制到剪贴板', 'success');
          return;
        } catch { /* Use the PNG download if clipboard access isn't available. */ }
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'LinkDesk-' + Date.now() + '.png';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.onStatus?.('已开始保存 PNG 截图', 'success');
    }, 'image/png');
  }

  toggleFullscreen() {
    const stage = document.getElementById('screenStage');
    if (!stage) return;
    stage.classList.toggle('is-fullscreen');
  }

  resetScreen() {
    this.phoneWindow?.dock();
    this.navigation.disabled = this.detachButton.disabled = true;
    this.isDragging = false;
    this.writer?.releaseLock();
    this.writer = null;
    this.videoWidth = this.videoHeight = 0;
    if (this.placeholder) {
      this.placeholder.style.display = 'flex';
    }
    if (this.decoder) {
      try { this.decoder.dispose(); } catch (e) {}
      this.decoder = null;
    }
    if (this.port) {
      try { this.port.close(); } catch (e) {}
      this.port = null;
    }
  }
}

export const screenPlayer = new ScreenPlayer();

export function buildScrcpyOptions({
  maxResolutionEl,
  bitRateEl,
  maxFpsEl,
  rotationEl,
  stayAwakeEl,
  showTouchesEl,
  powerOffOnCloseEl
}) {
  return {
    maxResolution: maxResolutionEl ? maxResolutionEl.value : '1280',
    bitRate: bitRateEl ? bitRateEl.value : '4M',
    maxFps: maxFpsEl ? maxFpsEl.value : '30',
    rotation: rotationEl ? rotationEl.value : '0',
    stayAwake: stayAwakeEl ? stayAwakeEl.checked : true,
    showTouches: showTouchesEl ? showTouchesEl.checked : false,
    powerOffOnClose: Boolean(powerOffOnCloseEl?.checked)
  };
}

export async function loadDeviceInfo({ deviceInfoContentEl, deviceId, type }) {
  if (!deviceInfoContentEl) return;
  clearElement(deviceInfoContentEl);
  deviceInfoContentEl.appendChild(createLoading());

  try {
    clearElement(deviceInfoContentEl);
    const list = createElement('div', { className: 'kv-list' });

    const addRow = (k, v) => {
      const row = createElement('div', { className: 'kv-row' });
      row.appendChild(createElement('div', { className: 'kv-key', text: k }));
      row.appendChild(createElement('div', { className: 'kv-val', text: v }));
      list.appendChild(row);
    };

    addRow('设备 ID', deviceId);
    addRow('连接方式', type === 'usb' ? 'USB 数据线' : 'WiFi 无线');

    deviceInfoContentEl.appendChild(list);
  } catch (error) {
    clearElement(deviceInfoContentEl);
    deviceInfoContentEl.appendChild(createAlert({ variant: 'error', message: `获取设备信息失败: ${error.message || String(error)}` }));
  }
}

export function syncMirroringView({
  currentDeviceTitleEl,
  noDeviceMsgEl,
  mirroringOptionsEl,
  deviceInfoEl,
  mirroringEmptyEl
}) {
  const { selectedDevice } = getState();
  const viewEl = document.getElementById('viewMirroring');
  const layoutEl = document.getElementById('mirroringLayout');
  setHidden(mirroringOptionsEl, !selectedDevice);
  setHidden(deviceInfoEl, !selectedDevice);

  if (!selectedDevice) {
    if (currentDeviceTitleEl) currentDeviceTitleEl.textContent = '未连接设备';
    setHidden(noDeviceMsgEl, false);
    setHidden(layoutEl, true);
    setHidden(mirroringEmptyEl, false);
    if (viewEl) viewEl.classList.remove('has-device');
    return;
  }

  if (currentDeviceTitleEl) currentDeviceTitleEl.textContent = `设备: ${selectedDevice.id}`;
  setHidden(noDeviceMsgEl, true);
  setHidden(layoutEl, false);
  setHidden(mirroringEmptyEl, true);
  if (viewEl) viewEl.classList.add('has-device');
}

export async function startMirroring({
  onStatus,
  onToast,
  startMirroringBtnEl,
  stopMirroringBtnEl,
  scrcpyOptionEls
}) {
  const { selectedDevice } = getState();
  if (!selectedDevice) {
    onStatus('请先选择一个设备', 'error');
    onToast({ variant: 'warning', title: '未选择设备', message: '请先在“设备”页选择设备' });
    return;
  }

  try {
    onStatus('正在建立低延迟投屏链路...');
    if (startMirroringBtnEl) startMirroringBtnEl.disabled = true;

    // 初始化画布与播放器
    const canvasEl = document.getElementById('screenCanvas');
    const wrapperEl = document.getElementById('screenWrapper');
    const placeholderEl = document.getElementById('screenPlaceholder');

    screenPlayer.init({ canvasEl, wrapperEl, placeholderEl });

    const options = buildScrcpyOptions(scrcpyOptionEls);

    const result = await window.androidController.startScrcpy({
      deviceId: selectedDevice.id,
      options
    });

    if (result && result.success) {
      setState({ isMirroring: true });
      if (stopMirroringBtnEl) stopMirroringBtnEl.disabled = false;
      onStatus('投屏已连接，正在硬解画面', 'success');
      onToast({ variant: 'success', title: '投屏已启动', message: selectedDevice.id });
      return;
    }

    onStatus(`启动投屏失败: ${result && result.error ? result.error : '未知错误'}`, 'error');
    onToast({ variant: 'error', title: '启动失败', message: result && result.error ? result.error : '未知错误' });
  } catch (error) {
    onStatus(`投屏错误: ${error.message || String(error)}`, 'error');
    onToast({ variant: 'error', title: '投屏错误', message: error.message || String(error) });
  } finally {
    if (startMirroringBtnEl) startMirroringBtnEl.disabled = getState().isMirroring;
  }
}

export async function stopMirroring({ onStatus, onToast, stopMirroringBtnEl }) {
  try {
    onStatus('正在停止投屏...');
    if (stopMirroringBtnEl) stopMirroringBtnEl.disabled = true;

    screenPlayer.resetScreen();
    const result = await window.androidController.stopScrcpy();

    setState({ isMirroring: false });
    onStatus('投屏已停止', 'success');
    onToast({ variant: 'success', title: '投屏已停止' });
  } catch (error) {
    onStatus(`停止投屏错误: ${error.message || String(error)}`, 'error');
    onToast({ variant: 'error', title: '停止错误', message: error.message || String(error) });
  } finally {
    const { isMirroring } = getState();
    if (stopMirroringBtnEl) stopMirroringBtnEl.disabled = !isMirroring;
  }
}

export async function unlockDevice({ password, onStatus, onToast, unlockBtnEl }) {
  const { selectedDevice } = getState();
  if (!selectedDevice) {
    onStatus('请先选择一个设备', 'error');
    onToast({ variant: 'warning', title: '未选择设备', message: '请先在“设备”页选择设备' });
    return;
  }

  try {
    if (unlockBtnEl) unlockBtnEl.disabled = true;
    onStatus('正在解锁设备...');

    const result = await window.androidController.unlockDevice(selectedDevice.id, password || '');
    if (result && result.success) {
      onStatus('设备解锁成功', 'success');
      onToast({ variant: 'success', title: '解锁成功' });
      return;
    }

    onStatus(`设备解锁失败: ${result?.error || result?.message || '请检查密码'}`, 'error');
    onToast({ variant: 'error', title: '解锁失败', message: result?.error || result?.message || '请检查密码' });
  } catch (error) {
    onStatus(`解锁错误: ${error.message || String(error)}`, 'error');
    onToast({ variant: 'error', title: '解锁错误', message: error.message || String(error) });
  } finally {
    if (unlockBtnEl) unlockBtnEl.disabled = false;
  }
}
