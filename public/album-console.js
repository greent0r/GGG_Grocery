(() => {
  'use strict';

  const byId = id => document.getElementById(id);
  const SERVICE_UUID = '00002000-0000-1000-8000-00805f9b34fb';
  const CHARACTERISTIC_UUID = '00002001-0000-1000-8000-00805f9b34fb';
  const HEAD = 0x55;
  const FILE_START = 0x03;
  const FILE_NAME = 0x00;
  const FILE_LENGTH = 0x01;
  const FILE_DATA = 0x02;
  const FILE_STOP = 0x04;
  const SCREEN_RESOLUTION_GET = 0x42;
  const CHUNK_SIZE = 192;
  const LEGACY_CONTROL_DELAY = 50;
  const LEGACY_DATA_DELAY = 2;
  const LAST_DEVICE_KEY = 'ggg-album-last-device';

  const state = {
    device: null,
    boundDevice: null,
    server: null,
    characteristic: null,
    listenerCharacteristic: null,
    pending: null,
    transferActive: false,
    legacyTransferActive: false,
    transferToken: 0,
    cancelRequested: false,
    lastUpload: null,
    retryAvailable: false,
  };

  const ui = {};

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function connected() {
    return !!(state.device && state.device.gatt && state.device.gatt.connected && state.characteristic);
  }

  function checksum(bytes, length = bytes.length) {
    let sum = 0;
    for (let i = 0; i < length; i += 1) sum += bytes[i];
    return sum & 0xff;
  }

  function makePacket(channel, payload = new Uint8Array()) {
    const data = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    if (data.length > CHUNK_SIZE || channel < 0 || channel > 255) throw new Error('BLE 命令参数无效');
    const packet = new Uint8Array(data.length + 4);
    packet[0] = HEAD;
    packet[1] = channel;
    packet[2] = data.length;
    packet.set(data, 3);
    packet[packet.length - 1] = checksum(packet, packet.length - 1);
    return packet;
  }

  function validPacket(bytes) {
    return bytes.length >= 4 && bytes[0] === HEAD && bytes[2] + 4 === bytes.length && checksum(bytes, bytes.length - 1) === bytes[bytes.length - 1];
  }

  function setStatus(kind, chipText, lineText, detailText) {
    ui.connectionChip.textContent = chipText;
    ui.connectionChip.className = `album-status-chip ${kind}`;
    ui.statusDot.className = `album-status-dot ${kind}`;
    ui.connectionStatus.textContent = lineText;
    if (detailText !== undefined) ui.deviceName.textContent = detailText;
  }

  function currentConfig() {
    return typeof getDeviceConfig === 'function' ? getDeviceConfig() : { displayName: 'FrameFilm', screenWidth: 600, screenHeight: 400 };
  }

  function updateDeviceView() {
    const config = currentConfig();
    const isConnected = connected();
    ui.deviceType.textContent = isConnected ? config.displayName : '—';
    ui.deviceResolution.textContent = isConnected ? `${config.screenWidth} × ${config.screenHeight}` : '—';
    ui.previewSize.textContent = `${config.screenWidth} × ${config.screenHeight}`;
    if (isConnected && state.device) ui.deviceName.textContent = state.device.name || 'FRAMEFILM 设备';
    syncControls();
  }

  function syncControls() {
    const hasImage = typeof originalImage !== 'undefined' && !!originalImage;
    const busy = state.transferActive || !!(window.ArkDevice && window.ArkDevice.busy && window.ArkDevice.busy());
    ui.connect.disabled = connected() || busy;
    ui.reconnect.disabled = connected() || busy;
    ui.disconnect.hidden = !connected() && !busy;
    ui.upload.disabled = !hasImage || !connected() || busy;
    ui.convert.disabled = !hasImage || busy;
    ui.download.disabled = !hasImage || busy;
    ui.cancel.hidden = !state.transferActive;
    ui.retry.hidden = state.transferActive || !state.retryAvailable;
    if (hasImage) ui.previewPlaceholder.hidden = true;
  }

  function setResult(kind, message) {
    ui.imageResult.className = `album-result ${kind || ''}`;
    ui.imageResult.textContent = message || '';
  }

  function setTransfer(message, progress) {
    ui.transferContainer.hidden = false;
    ui.transferStatus.textContent = message;
    ui.transferProgress.textContent = `${progress}%`;
    ui.transferProgressBar.style.width = `${progress}%`;
  }

  function ensureTransferIsCurrent(token) {
    if (token !== state.transferToken) throw new Error('传输已取消');
    if (!connected()) throw new Error('设备已断开');
  }

  async function writePacket(channel, payload) {
    if (!connected()) throw new Error('请先连接设备');
    await state.characteristic.writeValue(makePacket(channel, payload));
  }

  async function requestPacket(channel, payload, timeout = 5000) {
    if (state.pending) throw new Error('设备查询正在进行');
    let item;
    const response = new Promise((resolve, reject) => {
      item = { channel, resolve, reject, timer: setTimeout(() => reject(new Error('设备未响应')), timeout) };
      state.pending = item;
    });
    try {
      await writePacket(channel, payload);
      return await response;
    } finally {
      clearTimeout(item.timer);
      if (state.pending === item) state.pending = null;
    }
  }

  function finishPending(error, payload) {
    if (!state.pending) return false;
    const item = state.pending;
    state.pending = null;
    clearTimeout(item.timer);
    if (error) item.reject(error);
    else item.resolve(payload);
    return true;
  }

  function onNotification(event) {
    const value = event.target.value;
    if (!value) return;
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (window.ArkDevice && window.ArkDevice.notification(bytes)) return;
    if (!validPacket(bytes) || !state.pending || bytes[1] !== state.pending.channel) return;
    finishPending(null, bytes.slice(3, -1));
  }

  function bindNotifications() {
    if (!state.characteristic || state.listenerCharacteristic === state.characteristic) return;
    state.listenerCharacteristic = state.characteristic;
    state.characteristic.addEventListener('characteristicvaluechanged', onNotification);
  }

  function classifyDevice(name) {
    const upper = String(name || '').toUpperCase();
    if (upper.startsWith('FRAMEFILMARK')) return 'FRAMEFILMARK';
    if (upper.includes('MAX')) return 'FRAMEFILMMAX';
    if (upper.includes('PRO')) return 'FRAMEFILMPRO';
    if (upper.includes('DOCK')) return 'FRAMEFILMDOCK';
    return 'FRAMEFILM';
  }

  async function queryScreenResolution() {
    try {
      const response = await requestPacket(SCREEN_RESOLUTION_GET, new Uint8Array(), 4000);
      if (response.length !== 5 || typeof applyScreenParams !== 'function') return;
      applyScreenParams(response[0], (response[1] << 8) | response[2], (response[3] << 8) | response[4]);
      updateDeviceView();
    } catch (error) {
      console.debug('[GGG album] screen query skipped:', error.message);
    }
  }

  async function reconnectLastDevice() {
    if (!navigator.bluetooth || !navigator.bluetooth.getDevices) throw new Error('当前浏览器不支持已授权设备重连');
    const devices = await navigator.bluetooth.getDevices();
    const savedId = window.localStorage.getItem(LAST_DEVICE_KEY);
    const matching = devices.filter(item => String(item.name || '').toUpperCase().startsWith('FRAMEFILM'));
    const device = matching.find(item => item.id === savedId) || matching[0];
    if (!device) throw new Error('没有找到已授权的 FRAMEFILM 设备，请先连接设备');
    await connectToDevice(device);
  }

  function bindArkTransport() {
    if (!window.ArkDevice) return;
    window.ArkDevice.bind({
      connected: () => connected() && typeof currentDeviceType !== 'undefined' && currentDeviceType === 'FRAMEFILMARK',
      canRun: () => !state.legacyTransferActive,
      write: bytes => state.characteristic.writeValue(bytes),
      disconnect: () => {
        if (state.device && state.device.gatt && state.device.gatt.connected) state.device.gatt.disconnect();
      },
      reconnect: reconnectLastDevice,
    });
  }

  function handleDisconnected() {
    if (state.pending) finishPending(new Error('设备已断开'));
    if (window.ArkDevice) window.ArkDevice.disconnected();
    state.server = null;
    state.characteristic = null;
    state.listenerCharacteristic = null;
    state.legacyTransferActive = false;
    state.transferToken += 1;
    setStatus('idle', '未连接', '设备已断开', '可重新扫描或重连上次设备');
    updateDeviceView();
  }

  function bindDeviceEvents(device) {
    if (state.boundDevice === device) return;
    if (state.boundDevice && state.boundDevice.removeEventListener) state.boundDevice.removeEventListener('gattserverdisconnected', handleDisconnected);
    device.addEventListener('gattserverdisconnected', handleDisconnected);
    state.boundDevice = device;
  }

  async function connectToDevice(device) {
    if (!device || !device.gatt) throw new Error('找不到可连接的设备');
    if (state.transferActive) throw new Error('传输进行中，请先完成或取消传输');
    setStatus('scanning', '连接中', '正在建立蓝牙连接', device.name || 'FRAMEFILM 设备');
    state.device = device;
    bindDeviceEvents(device);
    if (device.gatt.connected && state.characteristic) return;
    if (device.gatt.connected) device.gatt.disconnect();
    state.server = await device.gatt.connect();
    const service = await state.server.getPrimaryService(SERVICE_UUID);
    state.characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
    setDeviceType(classifyDevice(device.name));
    bindNotifications();
    try {
      await state.characteristic.startNotifications();
    } catch (error) {
      if (currentDeviceType === 'FRAMEFILMARK') throw error;
      console.warn('[GGG album] notifications unavailable:', error.message);
    }
    bindArkTransport();
    window.localStorage.setItem(LAST_DEVICE_KEY, device.id || '');
    setStatus('connected', '已连接', `${currentConfig().displayName} 已就绪`, device.name || 'FRAMEFILM 设备');
    updateDeviceView();
    await queryScreenResolution();
  }

  async function scanAndConnect() {
    if (!window.isSecureContext || !navigator.bluetooth) {
      setStatus('error', '不可用', '浏览器不支持 Web Bluetooth', '请使用 HTTPS / localhost 的 Chrome 或 Edge');
      return;
    }
    try {
      setStatus('scanning', '扫描中', '请选择附近的 FRAMEFILM 设备', '蓝牙选择窗口由浏览器打开');
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'FRAMEFILM' }],
        optionalServices: [SERVICE_UUID],
      });
      await connectToDevice(device);
    } catch (error) {
      if (error.name === 'NotFoundError') setStatus('idle', '未连接', '未选择设备', '可以再次点击“连接设备”');
      else setStatus('error', '连接失败', '设备连接失败', error.message || '请检查设备电量与蓝牙状态');
    }
    updateDeviceView();
  }

  async function reconnect() {
    if (state.transferActive) return;
    try {
      await reconnectLastDevice();
    } catch (error) {
      setStatus('error', '重连失败', '无法重连上次设备', error.message);
    }
    updateDeviceView();
  }

  function disconnect() {
    state.transferToken += 1;
    if (window.ArkDevice && window.ArkDevice.busy()) window.ArkDevice.cancel();
    if (state.device && state.device.gatt && state.device.gatt.connected) state.device.gatt.disconnect();
    else handleDisconnected();
  }

  function safeFileName() {
    const raw = ui.fileName.value;
    const normalized = typeof normalizeFilmFileName === 'function' ? normalizeFilmFileName(raw, 'output.film') : (raw || 'output.film');
    if (/^[A-Za-z0-9 _.-]+$/.test(normalized)) {
      ui.fileName.value = normalized;
      return normalized;
    }
    ui.fileName.value = 'photo.film';
    return 'photo.film';
  }

  function buildFilm() {
    if (typeof originalImage === 'undefined' || !originalImage) throw new Error('请先选择照片');
    if (typeof updateImage === 'function') updateImage();
    const data = buildCurrentFilmFile();
    const expected = typeof getFilmFileExpectedSize === 'function' ? getFilmFileExpectedSize(data) : data.length;
    if (data.length !== expected) throw new Error(`Film 文件大小校验失败，应为 ${expected} 字节`);
    return { data, fileName: safeFileName() };
  }

  function convertFilm() {
    try {
      const film = buildFilm();
      setResult('success', `转换完成 · ${film.data.length.toLocaleString()} 字节 · ${film.fileName}`);
    } catch (error) {
      setResult('error', `转换失败 · ${error.message}`);
    }
    syncControls();
  }

  function downloadFilm() {
    try {
      const film = buildFilm();
      downloadFile(film.data, film.fileName);
      setResult('success', `已下载 · ${film.fileName} · ${film.data.length.toLocaleString()} 字节`);
    } catch (error) {
      setResult('error', `下载失败 · ${error.message}`);
    }
  }

  async function uploadLegacy(film, token) {
    state.legacyTransferActive = true;
    await writePacket(FILE_START);
    await delay(LEGACY_CONTROL_DELAY);
    const name = new TextEncoder().encode(film.fileName);
    if (name.length > 63) throw new Error('文件名过长，请使用 63 字节以内的英文文件名');
    await writePacket(FILE_NAME, name);
    await delay(LEGACY_CONTROL_DELAY);
    await writePacket(FILE_LENGTH, new Uint8Array([(film.data.length >>> 24) & 255, (film.data.length >>> 16) & 255, (film.data.length >>> 8) & 255, film.data.length & 255]));
    await delay(LEGACY_CONTROL_DELAY);
    for (let offset = 0; offset < film.data.length; offset += CHUNK_SIZE) {
      ensureTransferIsCurrent(token);
      const chunk = film.data.slice(offset, offset + CHUNK_SIZE);
      await writePacket(FILE_DATA, chunk);
      const sent = Math.min(offset + chunk.length, film.data.length);
      setTransfer(`正在发送 · ${sent.toLocaleString()} / ${film.data.length.toLocaleString()} 字节`, Math.round(sent * 100 / film.data.length));
      await delay(LEGACY_DATA_DELAY);
    }
    await writePacket(FILE_STOP);
    state.legacyTransferActive = false;
  }

  async function uploadFilm(film) {
    if (!connected()) {
      setResult('error', '请先连接墙上相框');
      return;
    }
    if (state.transferActive) return;
    state.transferActive = true;
    state.cancelRequested = false;
    state.transferToken += 1;
    const token = state.transferToken;
    state.lastUpload = { fileName: film.fileName, fileData: film.data.slice() };
    state.retryAvailable = false;
    setTransfer('准备传输…', 0);
    syncControls();
    try {
      if (currentDeviceType === 'FRAMEFILMARK' && window.ArkDevice) {
        await window.ArkDevice.run('BLE 图片上传', async context => {
          await context.uploadFile(film.fileName, film.data, (sent, total) => {
            setTransfer(`正在发送 · ${sent.toLocaleString()} / ${total.toLocaleString()} 字节`, Math.round(sent * 100 / total));
          });
        });
      } else {
        await uploadLegacy(film, token);
      }
      setTransfer('已发送，等待设备保存', 100);
      setResult('success', `已发送 · ${film.fileName} · 等待设备保存`);
      state.retryAvailable = false;
    } catch (error) {
      const cancelled = state.cancelRequested || error.message === '操作已取消' || error.message === '传输已取消';
      setTransfer(cancelled ? '已取消，设备连接已断开' : '传输失败', cancelled ? 0 : 0);
      setResult('error', cancelled ? '传输已取消，可重连后重试' : `传输未完成 · ${error.message}`);
      state.retryAvailable = true;
    } finally {
      state.transferActive = false;
      state.legacyTransferActive = false;
      state.cancelRequested = false;
      syncControls();
    }
  }

  function startUpload() {
    try {
      uploadFilm(buildFilm());
    } catch (error) {
      setResult('error', `上传失败 · ${error.message}`);
    }
  }

  function cancelUpload() {
    if (!state.transferActive) return;
    state.cancelRequested = true;
    state.transferToken += 1;
    if (window.ArkDevice && window.ArkDevice.busy()) window.ArkDevice.cancel();
    else if (state.device && state.device.gatt && state.device.gatt.connected) state.device.gatt.disconnect();
  }

  function retryUpload() {
    if (!state.lastUpload || state.transferActive) return;
    uploadFilm({ fileName: state.lastUpload.fileName, data: state.lastUpload.fileData.slice() });
  }

  function waitForLoadedImage() {
    const started = Date.now();
    const check = () => {
      if (typeof originalImage !== 'undefined' && originalImage) {
        ui.previewPlaceholder.hidden = true;
        syncControls();
        return;
      }
      if (Date.now() - started < 6000) window.setTimeout(check, 80);
    };
    check();
  }

  function openConsole() {
    ui.dialog.showModal();
    window.setTimeout(() => {
      if (typeof updateCanvasScale === 'function') updateCanvasScale();
      syncControls();
    }, 0);
  }

  function closeConsole() {
    if (!state.transferActive) ui.dialog.close();
  }

  function init() {
    ui.dialog = byId('album-console');
    ui.open = byId('album-display');
    ui.close = ui.dialog.querySelector('[data-album-close]');
    ui.connect = byId('album-connect');
    ui.reconnect = byId('album-reconnect');
    ui.disconnect = byId('album-disconnect');
    ui.connectionChip = byId('album-connection-chip');
    ui.statusDot = byId('album-status-dot');
    ui.connectionStatus = byId('album-connection-status');
    ui.deviceName = byId('album-device-name');
    ui.deviceType = byId('album-device-type');
    ui.deviceResolution = byId('album-device-resolution');
    ui.previewSize = byId('album-preview-size');
    ui.previewPlaceholder = document.querySelector('.album-preview-placeholder');
    ui.imageResult = byId('imageResult');
    ui.fileName = byId('fileName');
    ui.convert = byId('album-convert');
    ui.download = byId('album-download');
    ui.upload = byId('album-upload');
    ui.cancel = byId('album-upload-cancel');
    ui.retry = byId('album-upload-retry');
    ui.transferContainer = byId('transfer-container');
    ui.transferStatus = byId('transfer-status');
    ui.transferProgress = byId('transfer-progress');
    ui.transferProgressBar = byId('transfer-progress-bar');

    initConvertTool();
    ui.open.addEventListener('click', openConsole);
    ui.close.addEventListener('click', closeConsole);
    ui.dialog.addEventListener('click', event => { if (event.target === ui.dialog) closeConsole(); });
    ui.connect.addEventListener('click', scanAndConnect);
    ui.reconnect.addEventListener('click', reconnect);
    ui.disconnect.addEventListener('click', disconnect);
    ui.convert.addEventListener('click', convertFilm);
    ui.download.addEventListener('click', downloadFilm);
    ui.upload.addEventListener('click', startUpload);
    ui.cancel.addEventListener('click', cancelUpload);
    ui.retry.addEventListener('click', retryUpload);
    byId('album-rotate').addEventListener('click', () => {
      if (typeof originalImage !== 'undefined' && originalImage) rotateCanvas();
      else setResult('info', '请先选择照片');
    });
    byId('album-reset').addEventListener('click', () => { resetImage(); state.retryAvailable = false; ui.previewPlaceholder.hidden = false; ui.transferContainer.hidden = true; setResult('', ''); syncControls(); });
    byId('imageFile').addEventListener('change', waitForLoadedImage);
    window.addEventListener('ark-device-state', event => {
      if (event.detail && event.detail.busy) setStatus('transfer', '传输中', '正在上传到墙上相框');
      else if (connected()) setStatus('connected', '已连接', `${currentConfig().displayName} 已就绪`);
      syncControls();
    });
    setStatus('idle', '未连接', '等待连接', '请在相框附近操作');
    updateDeviceView();
    syncControls();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
