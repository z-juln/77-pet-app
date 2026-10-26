/**
 * 菜单栏入口：配置、设置、关于、退出。碎碎念在桌宠右键菜单里。
 * 宠物窗口本身没有边框，也不能从 Dock 关掉。
 */
'use strict';

const { app, Tray, Menu, BrowserWindow, nativeImage, shell } = require('electron');
const http = require('node:http');
const path = require('node:path');

function origin() {
  const configUrl = process.env.PET77_CONFIG_URL || 'http://127.0.0.1:3080/77-pet/config';
  return new URL(configUrl).origin;
}

function request(method, pathname, body) {
  const payload = body ? JSON.stringify(body) : '';
  const url = new URL(pathname, origin());
  const req = http.request(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: body
        ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
        : undefined,
    },
    () => {},
  );
  req.on('error', (error) => console.error('[77-pet] tray request failed:', error.message));
  if (payload) req.write(payload);
  req.end();
}

function openPetConfig() {
  const win = new BrowserWindow({
    width: 920,
    height: 680,
    minWidth: 760,
    minHeight: 560,
    title: '桌宠配置',
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'pet-config-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'pet-config.html'), { query: { origin: origin() } });
}

let aboutWindow = null;

function openAbout() {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 440,
    height: 520,
    title: '关于',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  aboutWindow = win;
  win.on('closed', () => {
    aboutWindow = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  win.loadFile(path.join(__dirname, 'about.html'), { query: { origin: origin() } });
}

function openSettings() {
  const win = new BrowserWindow({
    width: 440,
    height: 500,
    title: '桌宠设置',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  win.loadFile(path.join(__dirname, 'settings.html'), { query: { origin: origin() } });
}

function trayImage() {
  // 彩色桌宠，只去掉原来的白底。文件名不要带 Template，否则 macOS 会把它画成纯黑剪影。
  // 旁边的 trayIcon@2x.png 会自动作为视网膜图。
  return nativeImage.createFromPath(path.join(__dirname, 'trayIcon.png'));
}

function paintDot(bitmap, pixelWidth, pixelHeight) {
  const copy = Buffer.from(bitmap);
  const radius = Math.max(3, Math.round(pixelWidth * 0.18));
  const cx = pixelWidth - radius - 1;
  const cy = radius + 1;
  for (let y = 0; y < pixelHeight; y += 1) {
    for (let x = 0; x < pixelWidth; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > radius) continue;
      const offset = (y * pixelWidth + x) * 4;
      const ring = dist >= radius - Math.max(1, pixelWidth / 22);
      copy[offset] = ring ? 255 : 48;
      copy[offset + 1] = ring ? 255 : 54;
      copy[offset + 2] = ring ? 255 : 232;
      copy[offset + 3] = 255;
    }
  }
  return copy;
}

function withUpdateBadge(image) {
  if (typeof image.toBitmap !== 'function' || typeof nativeImage.createFromBitmap !== 'function') return image;
  const result = nativeImage.createEmpty();
  const { width, height } = image.getSize();
  for (const scale of image.getScaleFactors()) {
    const pixelWidth = width * scale;
    const pixelHeight = height * scale;
    const bitmap = paintDot(image.toBitmap({ scaleFactor: scale }), pixelWidth, pixelHeight);
    const part = nativeImage.createFromBitmap(bitmap, { width: pixelWidth, height: pixelHeight, scaleFactor: scale });
    result.addRepresentation({ scaleFactor: scale, width: pixelWidth, height: pixelHeight, buffer: part.toPNG() });
  }
  return result.isEmpty() ? image : result;
}

function redDotImage() {
  if (typeof nativeImage.createFromBitmap !== 'function') return undefined;
  const result = nativeImage.createEmpty();
  for (const scale of [1, 2]) {
    const size = 12 * scale;
    const bitmap = Buffer.alloc(size * size * 4);
    const radius = size / 2 - 0.5;
    const center = size / 2;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = x + 0.5 - center;
        const dy = y + 0.5 - center;
        if (dx * dx + dy * dy > radius * radius) continue;
        const offset = (y * size + x) * 4;
        bitmap[offset] = 48;
        bitmap[offset + 1] = 54;
        bitmap[offset + 2] = 232;
        bitmap[offset + 3] = 255;
      }
    }
    const part = nativeImage.createFromBitmap(bitmap, { width: size, height: size, scaleFactor: scale });
    result.addRepresentation({ scaleFactor: scale, width: size, height: size, buffer: part.toPNG() });
  }
  return result.isEmpty() ? undefined : result;
}

function requestJson(method, pathname) {
  return new Promise((resolve) => {
    const url = new URL(pathname, origin());
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.end();
  });
}

function buildMenu(hasUnread) {
  return Menu.buildFromTemplate([
    { label: '桌宠配置', click: openPetConfig },
    { label: '设置 API', click: openSettings },
    { label: '关于', icon: hasUnread ? redDotImage() : undefined, click: openAbout },
    { type: 'separator' },
    {
      label: '退出桌宠',
      click: () => {
        request('POST', '/shutdown');
        setTimeout(() => app.quit(), 150);
      },
    },
  ]);
}

function installTray() {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  const plainIcon = trayImage();
  const badgedIcon = withUpdateBadge(plainIcon);
  const tray = new Tray(plainIcon);
  let unread = false;
  let applied = false;
  const applyUnread = (next) => {
    const value = Boolean(next);
    if (applied && value === unread) return;
    applied = true;
    unread = value;
    tray.setImage(value ? badgedIcon : plainIcon);
    tray.setToolTip(value ? '77-pet 桌宠（有新版本）' : '77-pet 桌宠');
    tray.setContextMenu(buildMenu(value));
  };
  applyUnread(false);
  global.__pet77OnUpdate = (state) => applyUnread(state && state.unread);
  global.__pet77Tray = tray;
  const pull = () => {
    requestJson('GET', '/77-pet/app-update').then((data) => {
      if (data) applyUnread(data.unread);
    });
  };
  pull();
  setInterval(pull, 15000);
}

module.exports = { installTray, withUpdateBadge, redDotImage };
