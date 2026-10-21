/**
 * 把已下载的安装包应用到当前应用。
 * macOS 未签名，不能走静默的系统更新，这里直接挂载 dmg 并替换 .app。
 * Windows 使用 NSIS 的静默参数，安装器会在应用退出后覆盖文件。
 */
import { spawn, execFile } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Electron 会把 app.asar 当成目录。打包后的进程若用 fs.rm 删 .app，
 * 会在 app.asar 上报 ENOTDIR。这里改走系统 rm，不经过被改写的 fs。
 */
export async function removeTree(target) {
  if (process.platform === 'win32') {
    const previous = process.noAsar;
    process.noAsar = true;
    try {
      rmSync(target, { recursive: true, force: true });
    } finally {
      process.noAsar = previous;
    }
    return;
  }
  await execFileAsync('/bin/rm', ['-rf', '--', target]);
}

export function macAppBundle(execPath) {
  const marker = '.app/Contents/MacOS/';
  const index = String(execPath || '').replaceAll('\\', '/').indexOf(marker);
  if (index < 0) return null;
  return String(execPath).slice(0, index + '.app'.length);
}

export async function applyDownloadedUpdate({ file, platform, execPath, relaunch }) {
  if (platform === 'darwin') {
    const bundle = macAppBundle(execPath);
    if (!bundle) throw new Error('找不到当前应用，无法自动安装');
    const mount = path.join(tmpdir(), 'dsh-pet-mount-' + Date.now());
    const staging = path.join(tmpdir(), 'dsh-pet-new-' + Date.now() + '.app');
    try {
      await execFileAsync('hdiutil', ['attach', file, '-nobrowse', '-readonly', '-mountpoint', mount]);
      const appName = readdirSync(mount).find((name) => name.endsWith('.app'));
      if (!appName) throw new Error('安装镜像里没有应用');
      await execFileAsync('ditto', [path.join(mount, appName), staging]);
      await removeTree(bundle);
      await execFileAsync('ditto', [staging, bundle]);
      await execFileAsync('xattr', ['-dr', 'com.apple.quarantine', bundle]).catch(() => {});
    } finally {
      await execFileAsync('hdiutil', ['detach', mount, '-force']).catch(() => {});
      await removeTree(staging).catch(() => {});
    }
    relaunch?.();
    return;
  }
  if (platform === 'win32') {
    const installDir = path.dirname(execPath);
    const child = spawn(file, ['/S', `/D=${installDir}`], {
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: true,
    });
    child.unref();
    setTimeout(() => relaunch?.(), 1200);
    return;
  }
  throw new Error('当前系统不支持自动安装');
}
