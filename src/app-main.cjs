/**
 * 正式应用入口：宿主和透明窗口在同一个 Electron 进程里。
 * macOS / Windows 安装包都从这里启动，不再依赖系统里的 node。
 */
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app } = require('electron');

async function boot() {
  const { start } = await import(pathToFileURL(path.join(__dirname, 'host.mjs')).href);
  const server = await start({
    launchHelper: false,
    packaged: app.isPackaged,
    execPath: process.execPath,
    onRelaunch() {
      app.relaunch();
      app.exit(0);
    },
    onUpdateState(state) {
      if (typeof global.__pet77OnUpdate === 'function') global.__pet77OnUpdate(state);
    },
  });
  process.env.PET77_CONFIG_URL = `http://127.0.0.1:${server.port}/77-pet/config`;
  process.env.PET77_HOST_PID = String(process.pid);
  process.env.PET77_SCALE = process.env.PET77_SCALE || '1';
  process.env.PET77_PETS = JSON.stringify(server.pets);
  process.env.PET77_TRAY_ICON = server.trayIcon;
  require('../vendor/electron-helper/main.js');
}

boot().catch((error) => {
  console.error('[77-pet] 启动失败：', error);
  app.exit(1);
});
