/**
 * 菜单栏入口：改 API、退出。碎碎念在桌宠右键菜单里。
 * 宠物窗口本身没有边框，也不能从 Dock 关掉。
 */
'use strict';

const { app, Tray, Menu, BrowserWindow, nativeImage, shell } = require('electron');
const http = require('node:http');
const path = require('node:path');

function origin() {
  const configUrl = process.env.DSH_PET_CONFIG_URL || 'http://127.0.0.1:3080/dsh-pet-7340/config';
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
  req.on('error', (error) => console.error('[dsh-pet] tray request failed:', error.message));
  if (payload) req.write(payload);
  req.end();
}

function openPetConfig() {
  const win = new BrowserWindow({
    width: 720,
    height: 560,
    title: '桌宠配置',
    resizable: false,
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

function openAbout() {
  const win = new BrowserWindow({
    width: 440,
    height: 280,
    title: '关于',
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: {
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
  win.loadFile(path.join(__dirname, 'about.html'));
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

function installTray() {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  const tray = new Tray(trayImage());
  tray.setToolTip('dsh-pet 桌宠');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '桌宠配置', click: openPetConfig },
      { label: '设置 API', click: openSettings },
      { label: '关于', click: openAbout },
      { type: 'separator' },
      {
        label: '退出桌宠',
        click: () => {
          request('POST', '/shutdown');
          setTimeout(() => app.quit(), 150);
        },
      },
    ]),
  );
  global.__dshPetTray = tray;
}

module.exports = { installTray };
