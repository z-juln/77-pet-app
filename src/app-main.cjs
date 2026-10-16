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
    onRelaunch() {
      app.relaunch();
      app.exit(0);
    },
  });
  process.env.DSH_PET_CONFIG_URL = `http://127.0.0.1:${server.port}/dsh-pet-7340/config`;
  process.env.DSH_PET_HOST_PID = String(process.pid);
  process.env.DSH_PET_SCALE = process.env.DSH_PET_SCALE || '1';
  process.env.DSH_PET_PETS = JSON.stringify(server.pets);
  process.env.DSH_PET_TRAY_ICON = server.trayIcon;
  require('../vendor/electron-helper/main.js');
}

boot().catch((error) => {
  console.error('[dsh-pet] 启动失败：', error);
  app.exit(1);
});
