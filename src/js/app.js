import { initFiles } from './features/files.js';
import { initPreferences } from './features/preferences.js';
import { watchNearbyDevices } from './features/nearby-devices.js';
import { getRequiredElementById } from './ui/dom.js';
import { showToast } from './ui/toast.js';
import { showStatus } from './ui/status.js';
import { refreshAllDevices, refreshWirelessDevices, setupWirelessConnection, connectToWirelessDevice } from './features/devices.js';
import { getState, setState, subscribe } from './state/appState.js';
import { screenPlayer, loadDeviceInfo, startMirroring, stopMirroring, unlockDevice } from './features/mirroring.js';

function initWindowControls({ titleBarEl, minimizeBtnEl, maximizeBtnEl, closeBtnEl }) {
  const setMaximizeLabel = (isMaximized) => {
    if (!maximizeBtnEl) return;
    maximizeBtnEl.setAttribute('aria-label', isMaximized ? '还原窗口' : '最大化');
    maximizeBtnEl.title = maximizeBtnEl.getAttribute('aria-label');
  };

  if (!window.windowControls) return;

  if (minimizeBtnEl) minimizeBtnEl.addEventListener('click', () => window.windowControls.minimize());
  if (closeBtnEl) closeBtnEl.addEventListener('click', () => window.windowControls.close());
  if (maximizeBtnEl) {
    maximizeBtnEl.addEventListener('click', async () => {
      const result = await window.windowControls.toggleMaximize();
      if (result && result.success) setMaximizeLabel(result.isMaximized);
    });
  }

  if (titleBarEl) {
    titleBarEl.addEventListener('dblclick', async (event) => {
      if (event.target && event.target.closest && event.target.closest('.titlebar-interactive')) return;
      const result = await window.windowControls.toggleMaximize();
      if (result && result.success) setMaximizeLabel(result.isMaximized);
    });
  }

  window.windowControls.isMaximized().then((result) => {
    if (result && result.success) setMaximizeLabel(result.isMaximized);
  });
}

function initApp() {
  const $ = getRequiredElementById;
  let page = 'devices', launching = false, stopping = false, timer = null, infoFor = null, initialPick = true;
  const virtualTools = $('virtualNavbar');
  const pages = { devices: $('viewDevices'), mirror: $('viewMirroring'), files: $('viewFiles'), settings: $('viewSettings') };
  const ui = {
    titleBar: getRequiredElementById('titleBar'),
    refreshDevicesBtn: getRequiredElementById('refreshDevicesBtn'),
    windowMinimizeBtn: getRequiredElementById('windowMinimizeBtn'),
    windowMaximizeBtn: getRequiredElementById('windowMaximizeBtn'),
    windowCloseBtn: getRequiredElementById('windowCloseBtn'),

    viewHelp: getRequiredElementById('viewHelp'),

    usbDeviceList: getRequiredElementById('usbDeviceList'),
    wirelessDeviceList: getRequiredElementById('wirelessDeviceList'),

    deviceIpInput: getRequiredElementById('deviceIp'),
    connectWifiBtn: getRequiredElementById('connectWifiBtn'),

    currentDeviceTitle: getRequiredElementById('currentDeviceTitle'),
    deviceInfo: getRequiredElementById('deviceInfo'),
    deviceInfoContent: getRequiredElementById('deviceInfoContent'),

    unlockPassword: getRequiredElementById('unlockPassword'),
    unlockDeviceBtn: getRequiredElementById('unlockDeviceBtn'),
    startMirroringBtn: getRequiredElementById('startMirroringBtn'),
    stopMirroringBtn: getRequiredElementById('stopMirroringBtn'),

    maxResolution: getRequiredElementById('maxResolution'),
    bitRate: getRequiredElementById('bitRate'),
    maxFps: getRequiredElementById('maxFps'),
    rotation: getRequiredElementById('rotation'),
    stayAwake: getRequiredElementById('stayAwake'),
    showTouches: getRequiredElementById('showTouches'),

    statusMessage: getRequiredElementById('statusMessage'),
    toastRegion: getRequiredElementById('toastRegion')
  };

  initWindowControls({
    titleBarEl: ui.titleBar,
    minimizeBtnEl: ui.windowMinimizeBtn,
    maximizeBtnEl: ui.windowMaximizeBtn,
    closeBtnEl: ui.windowCloseBtn
  });

  const onToast = ({ variant, title, message }) => showToast(ui.toastRegion, { variant, title, message });
  const onStatus = (message, type = 'info') => {
    showStatus(ui.statusMessage, message, type);
    if (wireless.open) document.getElementById('wirelessFeedback').textContent = message;
  };

  const wireless = document.getElementById('wirelessDialog');
  const openWireless = () => { if (!wireless.open) wireless.showModal(); scanNearby(); };
  $('openWireless').onclick = openWireless;
  for (const button of document.querySelectorAll('#openHelp,[data-help]')) button.onclick = () => ui.viewHelp.showModal();
  for (const button of document.querySelectorAll('.dialog-close,.dialog-cancel')) button.onclick = () => button.closest('dialog').close();
  const preferences = initPreferences((id, saved) => {
    if (id === 'refreshInterval' || id === 'reset') scheduleRefresh();
    if (id === 'startFolder' || id === 'reset') files.useStartFolderNextTime();
    if (id === 'fileSort' || id === 'hiddenFiles' || id === 'reset') files.render();
    onStatus(!saved ? '设置已应用，但未能保存到本机' : id === 'reset' ? '已恢复默认设置' : '偏好设置已保存', saved ? 'success' : 'warning');
  });
  screenPlayer.getScreenshotMode = () => preferences().screenshotMode;
  screenPlayer.onStatus = onStatus;
  const files = initFiles(preferences, renderStudio);
  const picker = $('devicePicker');
  function devices() {
    return [...(getState().usbDevicesSnapshot || []), ...(getState().wirelessDevicesSnapshot || [])];
  }
  function setDevice(device) {
    initialPick = false;
    setState({ selectedDevice: device ? { id: device.id, type: device.type } : null });
  }
  function go(next) {
    page = next;
    const online = devices().filter(d => d.status === 'device');
    if ((next === 'files' || next === 'mirror') && !getState().selectedDevice && online.length === 1 && !files.isBusy() && !getState().isMirroring) setDevice(online[0]);
    renderStudio();
    document.querySelector('.workspace').scrollTop = 0;
  }
  for (const button of document.querySelectorAll('[data-page],[data-go]')) {
    button.onclick = () => go(button.dataset.page || button.dataset.go);
  }
  picker.onchange = () => setDevice(devices().find(d => d.id === picker.value));
  const onSelectDevice = async (deviceId, type, intent = 'mirror') => {
    if ((launching || stopping || getState().isMirroring || files.isBusy()) && getState().selectedDevice?.id !== deviceId) {
      onStatus('请先结束当前投屏或文件操作，再切换设备'); return;
    }
    if (wireless.open) wireless.close();
    setDevice({ id: deviceId, type });
    go(intent);
    if (intent === 'mirror') await launchMirror();
  };

  const onEnableWifi = async (deviceId, btnEl) => {
    await setupWirelessConnection({
      deviceId,
      onStatus,
      onToast,
      setIpValue: (ip) => { openWireless(); ui.deviceIpInput.value = ip; },
      setButtonLoading: (loading, text) => {
        if (!btnEl) return;
        btnEl.disabled = loading;
        btnEl.textContent = text;
      }
    });
  };

  ui.refreshDevicesBtn.addEventListener('click', () => refresh(true));

  const scanNearby = watchNearbyDevices({
    root: document.getElementById('nearbyDevices'),
    view: wireless,
    refresh: ui.refreshDevicesBtn,
    onPick({ kind, address }) {
      if (kind === 'pairing') {
        document.getElementById('wirelessPairing').open = true;
        const form = document.getElementById('pairForm');
        if (form.elements.pairAddress.value !== address) form.elements.pairCode.value = '';
        form.elements.pairAddress.value = address;
        form.elements.pairCode.focus();
      } else {
        ui.deviceIpInput.value = address;
        ui.connectWifiBtn.click();
      }
    }
  });

  document.getElementById('pairForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = '配对中…';
    try {
      const result = await window.androidController.pairWireless(form.elements.pairAddress.value.trim(), form.elements.pairCode.value);
      if (!result.success) throw new Error(result.error);
      form.reset();
      document.getElementById('wirelessPairing').open = false;
      onStatus('配对成功。如果设备没有自动出现，请输入无线调试主页的连接地址。', 'success');
      ui.deviceIpInput.focus();
      await refreshWirelessDevices({ wirelessDeviceListEl: ui.wirelessDeviceList, onSelectDevice, onEnableWifi });
    } catch (error) {
      onStatus(error.message, 'error');
    } finally {
      button.disabled = false;
      button.textContent = '配对';
    }
  });

  ui.connectWifiBtn.addEventListener('click', () =>
    connectToWirelessDevice({
      deviceIp: ui.deviceIpInput.value,
      onStatus,
      onToast,
      setConnectButtonLoading: (loading, text) => {
        ui.connectWifiBtn.disabled = loading;
        ui.connectWifiBtn.textContent = text;
      },
      refreshWireless: async () => {
        await refreshWirelessDevices({ wirelessDeviceListEl: ui.wirelessDeviceList, onSelectDevice, onEnableWifi });
        wireless.close();
      }
    })
  );

  ui.deviceIpInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    ui.connectWifiBtn.click();
  });

  async function launchMirror() {
    if (!getState().selectedDevice || launching || stopping || getState().isMirroring) return;
    launching = true;
    renderStudio();
    ui.startMirroringBtn.textContent = '连接中…';
    try {
      await startMirroring({
        onStatus, onToast,
        startMirroringBtnEl: ui.startMirroringBtn,
        stopMirroringBtnEl: ui.stopMirroringBtn,
        scrcpyOptionEls: {
          maxResolutionEl: ui.maxResolution, bitRateEl: ui.bitRate, maxFpsEl: ui.maxFps,
          rotationEl: ui.rotation, stayAwakeEl: ui.stayAwake, showTouchesEl: ui.showTouches,
          powerOffOnCloseEl: $('powerOffOnClose')
        }
      });
    } finally {
      launching = false;
      renderStudio();
      ui.startMirroringBtn.textContent = '开始投屏';
    }
  }
  ui.startMirroringBtn.addEventListener('click', launchMirror);

  ui.stopMirroringBtn.onclick = async () => {
    if (stopping) return;
    stopping = true; renderStudio();
    try { await stopMirroring({ onStatus, onToast, stopMirroringBtnEl: ui.stopMirroringBtn }); }
    finally { stopping = false; renderStudio(); }
  };
  ui.unlockDeviceBtn.onclick = async () => {
    const password = ui.unlockPassword.value; ui.unlockPassword.value = '';
    await unlockDevice({ password, unlockBtnEl: ui.unlockDeviceBtn, onStatus, onToast });
  };

  let pickerKey = '';
  function renderStudio() {
    const state = getState(), all = devices(), online = all.filter(d => d.status === 'device');
    if (initialPick && state.usbDevicesSnapshot && state.wirelessDevicesSnapshot && online.length === 1) {
      setDevice(online[0]); return;
    }
    const selected = state.selectedDevice, id = selected?.id || '';
    const busy = launching || stopping || state.isMirroring;
    const model = online.find(d => d.id === id)?.info?.model?.replaceAll('_', ' ') || id;
    const optionsKey = JSON.stringify(online.map(d => [d.id, d.info?.model]));
    if (pickerKey !== optionsKey) {
      picker.replaceChildren(new Option(online.length ? '选择设备' : '无在线设备', ''));
      for (const d of online) picker.add(new Option((d.info?.model?.replaceAll('_', ' ') || 'Android') + ' · ' + d.id, d.id));
      pickerKey = optionsKey;
    }
    picker.value = id;
    picker.disabled = busy || files.isBusy() || !online.length;
    for (const [key, view] of Object.entries(pages)) view.hidden = key !== page;
    for (const button of document.querySelectorAll('[data-page]')) {
      if (button.dataset.page === page) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    document.querySelectorAll('.device-list .device-item').forEach(row => row.classList.toggle('selected', row.dataset.id === id));
    $('deviceCount').textContent = String(all.length);
    $('waitingDevices').hidden = Boolean(all.length || state.usbListError || state.wirelessListError);
    $('waitingTitle').textContent = state.usbDevicesSnapshot && state.wirelessDevicesSnapshot ? '暂无设备' : '正在查找设备…';
    ui.refreshDevicesBtn.disabled = state.isRefreshingDevices;
    ui.currentDeviceTitle.textContent = model || '设备画面';
    ui.startMirroringBtn.hidden = state.isMirroring;
    ui.startMirroringBtn.disabled = !id || busy;
    ui.stopMirroringBtn.hidden = !state.isMirroring;
    ui.stopMirroringBtn.disabled = stopping;
    virtualTools.disabled = !state.isMirroring;
    $('liveDot').hidden = !state.isMirroring;
    $('mirrorState').textContent = stopping ? '正在停止' : state.isMirroring ? '投屏中' : launching ? '连接中' : id ? '就绪' : '待连接';
    $('mirrorState').classList.toggle('online', state.isMirroring);
    // The placeholder can temporarily live in the floating window.
    const hint = document.getElementById('mirrorHint');
    if (hint) hint.textContent = launching ? '正在连接…' : id ? '点击上方开始投屏' : '请先选择设备';
    ui.deviceInfo.hidden = !id;
    if (infoFor !== id) {
      infoFor = id; ui.unlockPassword.value = '';
      if (id) void loadDeviceInfo({ deviceInfoContentEl: ui.deviceInfoContent, deviceId: id, type: selected.type });
    }
    files.sync(id, page === 'files');
  }
  subscribe(renderStudio);
  renderStudio();
  const refresh = (showLoading = false) => refreshAllDevices({
    usbDeviceListEl: ui.usbDeviceList, wirelessDeviceListEl: ui.wirelessDeviceList,
    onSelectDevice, onEnableWifi, onStatus, showLoading
  });
  function scheduleRefresh() {
    clearInterval(timer);
    const seconds = Number(preferences().refreshInterval);
    if (seconds) timer = setInterval(() => refresh(false), seconds * 1000);
  }
  if (window.androidController) void refresh(true);
  else onStatus('设备服务不可用，请重新打开桌面应用', 'error');
  scheduleRefresh();
  window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      if (page === 'files') $('fileRefresh').click(); else ui.refreshDevicesBtn.click();
    }
    if (e.key === 'Escape') {
      document.getElementById('screenStage')?.classList.remove('is-fullscreen');
      if (ui.toastRegion.childElementCount > 0) ui.toastRegion.replaceChildren();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
