/**
 * 桌宠宿主：对 Electron 渲染层暴露与原版相同的 /dsh-pet-7340 接口，
 * 碎碎念和对话改走用户自己的 OpenAI 兼容接口。
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { copyFileSync, createReadStream, existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyDownloadedUpdate } from './apply-update.mjs';
import {
  assembleConfigEntries,
  basePets,
  fallbackBookPath,
  importPetZip,
  installBundledPacks,
  isBundledPack,
  listPetPackNames,
  mediaFile,
  readPetPack,
  removeUserPack,
  userPacksDir,
} from './pet-packs.mjs';
import { completeChat, extractChatImage, memeCatalog, validateApiCredentials } from './llm.mjs';
import { CORNER_LABEL, createPetFromTemplate, normalizeUserPet, validateUserPets } from './pets-config.mjs';
import { compareVersions, downloadToFile, fetchLatestRelease, pickReleaseAsset } from './update.mjs';
import { isApiKeyError, pickLocalWhisper } from './whisper-fallback.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ASSETS = path.join(ROOT, 'vendor', 'assets');
const HELPER_MAIN = path.join(ROOT, 'vendor', 'electron-helper', 'main.js');
const USER_DIR = path.join(homedir(), '.dsh-pet-app');
const ROUTE_PREFIX = '/dsh-pet-7340';

const MIME = {
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const SLOTS = [
  [23, '深夜'],
  [19, '晚上'],
  [17, '傍晚'],
  [13, '下午'],
  [11, '中午'],
  [9, '上午'],
  [7, '早上'],
  [5, '清晨'],
  [0, '凌晨'],
];

function timeContext(date = new Date()) {
  const slot = SLOTS.find(([hour]) => date.getHours() >= hour)?.[1] ?? '凌晨';
  const dayKind = date.getDay() === 0 || date.getDay() === 6 ? '周末' : '工作日';
  return (
    '现在是' +
    date.getFullYear() +
    '年' +
    (date.getMonth() + 1) +
    '月' +
    date.getDate() +
    '日 ' +
    WEEKDAYS[date.getDay()] +
    ' ' +
    String(date.getHours()).padStart(2, '0') +
    ':' +
    String(date.getMinutes()).padStart(2, '0') +
    '，' +
    slot +
    '，' +
    dayKind +
    '。'
  );
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function settingsFiles() {
  return {
    projectFile: path.join(ROOT, 'config', 'settings.json'),
    userFile: path.join(USER_DIR, 'settings.json'),
  };
}

const API_KEY_GUIDE_URL = 'https://github.com/chatanywhere/GPT_API_free';

function defaultChoices() {
  const example = readJson(path.join(ROOT, 'config', 'settings.example.json'), {});
  return {
    baseUrl: [example.baseUrl || 'https://api.chatanywhere.tech/v1'],
    model: [example.model || 'deepseek-v4-flash'],
  };
}

function normalizeBaseUrl(url) {
  return String(url ?? '')
    .trim()
    .replace(/\/+$/, '');
}

async function validateSettingsPayload(parsed) {
  const current = loadSettings();
  await validateApiCredentials({
    baseUrl: parsed.baseUrl ?? current.baseUrl,
    model: parsed.model ?? current.model,
    apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : current.apiKey,
  });
}

function loadSettings() {
  const { projectFile, userFile } = settingsFiles();
  if (!existsSync(userFile) && existsSync(projectFile)) {
    mkdirSync(USER_DIR, { recursive: true });
    copyFileSync(projectFile, userFile);
  }
  const saved = readJson(existsSync(userFile) ? userFile : projectFile, {});
  return {
    file: existsSync(userFile) ? userFile : projectFile,
    apiKey: process.env.DSH_PET_API_KEY || saved.apiKey || '',
    baseUrl: process.env.DSH_PET_API_BASE || saved.baseUrl || 'https://api.chatanywhere.tech/v1',
    model: process.env.DSH_PET_MODEL || saved.model || 'deepseek-v4-flash',
    whisperStartupDelaySec: Number(saved.whisperStartupDelaySec ?? 8),
    autoCheckUpdate: saved.autoCheckUpdate !== false,
    updateSeenVersion: typeof saved.updateSeenVersion === 'string' ? saved.updateSeenVersion : '',
  };
}

function saveSettings(next) {
  mkdirSync(USER_DIR, { recursive: true });
  const current = loadSettings();
  const merged = {
    apiKey: typeof next.apiKey === 'string' ? next.apiKey.trim() : current.apiKey,
    baseUrl: (next.baseUrl || current.baseUrl).trim(),
    model: (next.model || current.model).trim(),
    whisperStartupDelaySec: current.whisperStartupDelaySec,
    autoCheckUpdate: typeof next.autoCheckUpdate === 'boolean' ? next.autoCheckUpdate : current.autoCheckUpdate,
    updateSeenVersion:
      typeof next.updateSeenVersion === 'string' ? next.updateSeenVersion : current.updateSeenVersion,
  };
  const { userFile } = settingsFiles();
  mkdirSync(path.dirname(userFile), { recursive: true });
  writeFileSync(userFile, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return merged;
}

function configEntries() {
  return assembleConfigEntries(ROOT, loadUserPets(), USER_DIR);
}

function packChoices() {
  return listPetPackNames(ROOT, USER_DIR).map((name) => {
    const pack = readPetPack(ROOT, name, USER_DIR);
    const pet = pack.config.pets[0] ?? { name, pack: name };
    return { name, label: pet.name || name, template: pet, official: isBundledPack(ROOT, name) };
  });
}

function entryForPet(petId) {
  const entries = Object.values(configEntries());
  return entries.find((entry) => (entry.config.pets ?? []).some((pet) => pet.id === petId)) ?? entries[0] ?? null;
}

function allRuntimePets() {
  return Object.values(configEntries()).flatMap((entry) => entry.config.pets ?? []);
}

function publicConfig() {
  return Object.fromEntries(Object.values(configEntries()).map((entry) => [entry.name, entry.config]));
}

function petsUserPath() {
  return path.join(USER_DIR, 'pets.json');
}

function loadUserPets() {
  const baseList = basePets(ROOT, USER_DIR);
  const baseById = Object.fromEntries(baseList.map((pet) => [pet.id, pet]));
  const saved = readJson(petsUserPath(), null);
  if (saved && Array.isArray(saved.pets) && saved.pets.length > 0) {
    return saved.pets.map((pet) => normalizeUserPet(pet, baseById));
  }
  const displayOverrides = readJson(path.join(USER_DIR, 'display.json'), {});
  return baseList.map((pet) =>
    normalizeUserPet({ ...pet, display: displayOverrides[pet.id] ?? pet.display }, baseById),
  );
}

function saveUserPets(pets) {
  const baseById = Object.fromEntries(basePets(ROOT, USER_DIR).map((pet) => [pet.id, pet]));
  validateUserPets(pets);
  const normalized = pets.map((pet) => normalizeUserPet(pet, baseById));
  mkdirSync(USER_DIR, { recursive: true });
  writeFileSync(petsUserPath(), JSON.stringify({ pets: normalized }, null, 2) + '\n', 'utf8');
  return normalized;
}

function desktopPets(config) {
  return (config.pets ?? []).filter((pet) => pet.display === 'desktop' || pet.display === 'both');
}

function leaf() {
  return { counter: 0, data: null };
}

function ensurePet(state, id) {
  if (!state.pets[id]) state.pets[id] = { say: leaf(), anim: leaf() };
  return state.pets[id];
}

function writeLeaf(target, data) {
  target.counter += 1;
  target.data = data;
}

function memePool(entry) {
  const memes = entry?.config?.memes;
  if (!memes || typeof memes !== 'object' || !entry.dir) return [];
  const dir = path.join(entry.dir, 'memes');
  const pool = [];
  for (const [name, desc] of Object.entries(memes)) {
    const text = typeof desc === 'string' ? desc.trim() : '';
    if (!name || !text) continue;
    if (!existsSync(path.join(dir, name + '.png'))) continue;
    pool.push({ name, desc: text });
  }
  return pool;
}

function systemPrompt(config, petId) {
  const pet = (config.pets ?? []).find((item) => item.id === petId);
  const name = pet?.name || petId;
  const prompt = typeof config.whisperPrompt === 'string' ? config.whisperPrompt : '';
  const nameLine = '你的名字是“' + name + '”。';
  return (prompt ? prompt + '\n' + nameLine : nameLine) + '\n' + timeContext();
}

function memoryFile() {
  return path.join(USER_DIR, 'memory.json');
}

function readMemory() {
  return readJson(memoryFile(), {});
}

function memoryMessages(petId, rounds) {
  const all = readMemory();
  const list = all[petId]?.messages;
  const messages = Array.isArray(list) ? list : [];
  if (!(rounds > 0)) return [];
  return messages.slice(-rounds * 2);
}

function appendMemory(petId, role, content) {
  mkdirSync(USER_DIR, { recursive: true });
  const all = readMemory();
  const bucket = all[petId] ?? { messages: [] };
  const messages = Array.isArray(bucket.messages) ? bucket.messages : [];
  messages.push({ role, content, ts: Date.now() });
  all[petId] = { messages };
  writeFileSync(memoryFile(), JSON.stringify(all, null, 2), 'utf8');
}

function safeJoin(root, rel) {
  const target = path.resolve(root, rel);
  const base = path.resolve(root) + path.sep;
  if (target !== path.resolve(root) && !target.startsWith(base)) return null;
  return target;
}

function readBinary(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('宠物包太大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const payload = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-cache, no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(payload);
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': contentType,
    'access-control-allow-origin': '*',
    'cache-control': 'no-cache',
  });
  res.end(body);
}

function sendFile(req, res, file) {
  if (!existsSync(file)) {
    sendText(res, 404, 'not found');
    return;
  }
  const stat = statSync(file);
  const ext = path.extname(file).toLowerCase();
  const contentType = MIME[ext] ?? 'application/octet-stream';
  const headers = {
    'content-type': contentType,
    'accept-ranges': 'bytes',
    'access-control-allow-origin': '*',
    'cache-control': 'public, max-age=86400',
  };
  const range = req.headers.range;
  if (range) {
    const matched = /bytes=(\d+)-(\d*)/.exec(range);
    if (!matched) {
      res.writeHead(416, headers);
      res.end();
      return;
    }
    const start = Number(matched[1]);
    const end = matched[2] ? Number(matched[2]) : stat.size - 1;
    if (start >= stat.size || end < start) {
      res.writeHead(416, { ...headers, 'content-range': 'bytes */' + stat.size });
      res.end();
      return;
    }
    res.writeHead(206, {
      ...headers,
      'content-range': `bytes ${start}-${end}/${stat.size}`,
      'content-length': end - start + 1,
    });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': stat.size });
  createReadStream(file).pipe(res);
}

function homePage() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>dsh-pet</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f3ee;color:#2b2b2b;font-family:"PingFang SC","Microsoft YaHei",sans-serif}
  main{max-width:520px;padding:32px}
  h1{font-weight:600;font-size:28px}
  p{line-height:1.7}
  code{background:#fff;padding:2px 6px;border-radius:6px}
</style></head>
<body><main>
  <h1>桌宠正在桌面上</h1>
  <p>右键宠物可以点播动作、碎碎念，或和它说话。菜单栏图标里可以改 API，或退出。</p>
  <p>动画、物理和菜单来自 <a href="https://github.com/PC2005-cloud/dsh-pet">PC2005-cloud/dsh-pet</a>。素材允许开源使用，禁止商用。</p>
  <p>配置文件：<code>${USER_DIR}</code></p>
</main></body></html>`;
}

/**
 * @param {{port?: number, launchHelper?: boolean}} [options]
 */
/** 托盘图标要真实文件路径。asar 里的图 nativeImage 读不到，解包后的副本可以。 */
function trayIconPath() {
  const packed = path.join(ASSETS, 'logo.png');
  const marker = path.sep + 'app.asar' + path.sep;
  if (packed.includes(marker)) {
    const unpacked = packed.replace(marker, path.sep + 'app.asar.unpacked' + path.sep);
    if (existsSync(unpacked)) return unpacked;
  }
  return packed;
}

export async function start(options = {}) {
  if (options.packaged) installBundledPacks(ROOT, USER_DIR);
  const launchHelper = options.launchHelper !== false;
  const onRelaunch = options.onRelaunch;
  const state = {
    sections: { balance: leaf(), workStatus: leaf() },
    pets: {},
  };
  let configVersion = String(Date.now());
  let helper = null;
  let shuttingDown = false;
  let expectExit = false;
  let whisperTimer = null;
  let updateTimer = null;
  let announcedKeyFallback = false;

  const runtimePets = () => allRuntimePets();

  const publicState = () => ({
    sections: state.sections,
    pets: state.pets,
    configVersion,
  });

  const publishSay = (petId, text, image) => {
    const pet = ensurePet(state, petId);
    writeLeaf(pet.say, image ? { text, image } : { text });
  };

  const showLocalWhisper = (petId, reason, quiet = false) => {
    const entry = entryForPet(petId);
    const book = entry ? readJson(fallbackBookPath(entry.dir), {}) : {};
    const pool = entry?.config.whisperImageEnabled === true ? memePool(entry) : [];
    const picked = pickLocalWhisper(book, pool);
    if (!picked) return { ok: false, reason: 'fallback-empty', message: '没有本地配文' };
    if (!quiet && !announcedKeyFallback) {
      announcedKeyFallback = true;
      console.error('[dsh-pet] ' + reason + '，碎碎念改用本地配文');
    }
    publishSay(petId, picked.text, picked.image);
    return { ok: true, fallback: true };
  };

  const generateWhisper = async (petId) => {
    const settings = loadSettings();
    const entry = entryForPet(petId);
    const config = entry?.config ?? {};
    const pet = (config.pets ?? []).find((item) => item.id === petId);
    if (pet?.whisperUseModel === false) return showLocalWhisper(petId, '已关闭模型', true);
    if (!settings.apiKey) return showLocalWhisper(petId, '还没有填写 API Key');
    const pool = config.whisperImageEnabled === true ? memePool(entry) : [];
    const meme = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : undefined;
    const userText = meme
      ? '随便说一句日常碎碎念，一句就好，20 字以内。\n这次会配一张表情包一起显示，图的内容是：' +
        meme.name +
        '（' +
        meme.desc +
        '）。\n请让这句话和这张图的情绪/场景自然契合，像是配合画面说出来的；不要描述画面本身。'
      : '随便说一句日常碎碎念，一句就好，20 字以内。';
    try {
      const text = await completeChat({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        system: systemPrompt(config, petId),
        messages: [{ role: 'user', content: userText }],
        maxTokens: 128,
        timeoutMs: 30_000,
      });
      publishSay(petId, text, meme?.name);
      return { ok: true };
    } catch (error) {
      if (!isApiKeyError(error)) throw error;
      return showLocalWhisper(petId, 'API Key 无效');
    }
  };

  const generateReply = async (petId, userText) => {
    const settings = loadSettings();
    const entry = entryForPet(petId);
    const config = entry?.config ?? {};
    if (!settings.apiKey) return { ok: false, reason: 'provider-missing', message: '还没有填写 API Key' };
    const rounds = Number(config.chatMemoryRounds);
    const history = memoryMessages(petId, Number.isFinite(rounds) ? rounds : 5);
    const limit = Math.floor(Number(config.chatImageLimit));
    let pool = config.chatImageEnabled === true ? memePool(entry) : [];
    if (limit > 0) pool = pool.slice(0, limit);
    const instruction =
      pool.length === 0
        ? userText
        : userText +
          '\n\n[配图] 回复结尾可选附一张表情包给用户看，从下列清单里挑最贴合当前语境的：\n' +
          memeCatalog(pool) +
          '\n挑中就在回复最后另起一行写 [图:名称]（名称原样照抄）；没有合适的就完全不要写这个标记。';
    const raw = await completeChat({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      system: systemPrompt(config, petId),
      messages: [...history.map((item) => ({ role: item.role, content: item.content })), { role: 'user', content: instruction }],
      maxTokens: 512,
      timeoutMs: 60_000,
    });
    const picked = pool.length > 0 ? extractChatImage(raw, pool) : { text: raw };
    appendMemory(petId, 'user', userText);
    appendMemory(petId, 'assistant', picked.text);
    publishSay(petId, picked.text, picked.image);
    return { ok: true };
  };

  const scheduleWhisper = () => {
    const config = Object.values(configEntries())[0]?.config ?? {};
    const seconds = Number(config.eventsRefreshSec?.whisper);
    const periodMs = (Number.isFinite(seconds) && seconds > 0 ? seconds : 300) * 1000;
    const startup = loadSettings().whisperStartupDelaySec;
    const arm = (delay) => {
      whisperTimer = setTimeout(async () => {
        try {
          const pets = runtimePets().filter((pet) => pet.whisperEnabled !== false);
          for (const pet of pets) await generateWhisper(pet.id);
        } catch (error) {
          console.error('[dsh-pet] 碎碎念失败：', error instanceof Error ? error.message : error);
        }
        arm(periodMs);
      }, delay);
    };
    arm((Number.isFinite(startup) && startup >= 0 ? startup : 8) * 1000);
  };

  const electronPath = () => {
    const fromEnv = process.env.DSH_PET_ELECTRON_PATH;
    if (fromEnv && existsSync(fromEnv)) return fromEnv;
    const resolved = require('electron');
    if (typeof resolved === 'string' && existsSync(resolved)) return resolved;
    throw new Error('找不到 Electron，请先在项目里执行 npm install');
  };

  const startHelper = () => {
    if (!launchHelper || shuttingDown) return;
    const pets = desktopPets({ pets: runtimePets() });
    if (pets.length === 0) {
      console.warn('[dsh-pet] 没有 display 为 desktop/both 的宠物，不打开窗口');
      return;
    }
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    env.DSH_PET_CONFIG_URL = `http://127.0.0.1:${port}/dsh-pet-7340/config`;
    env.DSH_PET_HOST_PID = String(process.pid);
    env.DSH_PET_SCALE = process.env.DSH_PET_SCALE || '1';
    env.DSH_PET_PETS = JSON.stringify(pets.map((pet) => ({ id: pet.id, size: pet.size })));
    env.DSH_PET_TRAY_ICON = trayIconPath();
    expectExit = false;
    helper = spawn(electronPath(), [HELPER_MAIN], { env, stdio: 'inherit' });
    helper.on('exit', (code, signal) => {
      console.log(`[dsh-pet] 窗口进程退出 code=${code} signal=${signal}`);
      helper = null;
      if (!expectExit && !shuttingDown && code && code !== 0) {
        console.error('[dsh-pet] 窗口异常退出，不再自动拉起。可重新运行 npm start。');
      }
    });
  };

  const restartHelper = async () => {
    if (onRelaunch) {
      await onRelaunch();
      return;
    }
    expectExit = true;
    if (helper && helper.exitCode === null && !helper.killed) {
      helper.kill('SIGTERM');
      await new Promise((resolve) => helper.once('exit', resolve));
    }
    configVersion = String(Date.now());
    startHelper();
  };

  const currentVersion = readJson(path.join(ROOT, 'package.json'), {}).version || '0.0.0';
  const updateState = {
    latest: null,
    phase: 'idle',
    message: '',
    percent: 0,
    checking: null,
  };

  const updateSnapshot = () => {
    const settings = loadSettings();
    const latest = updateState.latest;
    const hasUpdate = Boolean(latest && compareVersions(latest.version, currentVersion) > 0);
    const unread = Boolean(settings.autoCheckUpdate && hasUpdate && settings.updateSeenVersion !== latest.version);
    return {
      current: currentVersion,
      latest: latest?.version || '',
      hasUpdate,
      autoCheck: settings.autoCheckUpdate,
      unread,
      phase: updateState.phase,
      message: updateState.message,
      percent: updateState.percent,
      releaseUrl: latest?.htmlUrl || 'https://github.com/z-juln/dsh-pet-app/releases/latest',
    };
  };

  const notifyUpdate = () => {
    options.onUpdateState?.(updateSnapshot());
  };

  const checkForUpdate = async () => {
    if (updateState.phase === 'downloading' || updateState.phase === 'installing') return updateSnapshot();
    if (updateState.checking) return updateState.checking;
    updateState.phase = 'checking';
    updateState.message = '';
    notifyUpdate();
    updateState.checking = (async () => {
      try {
        const release = await fetchLatestRelease();
        updateState.latest = release;
        updateState.phase = 'idle';
        const snap = updateSnapshot();
        updateState.message = snap.hasUpdate ? '发现新版本 ' + snap.latest : release ? '已是最新版本' : '还没有发布版本';
        notifyUpdate();
        return updateSnapshot();
      } catch (error) {
        updateState.phase = 'error';
        const raw = error instanceof Error ? error.message : String(error);
        updateState.message = /timeout|aborted/i.test(raw)
          ? '检查更新超时'
          : /403|429/.test(raw)
            ? '检查更新过于频繁，请稍后再试'
            : raw;
        notifyUpdate();
        return updateSnapshot();
      } finally {
        updateState.checking = null;
      }
    })();
    return updateState.checking;
  };

  const installUpdate = async () => {
    const snap = updateSnapshot();
    if (!snap.hasUpdate || !updateState.latest) return { ...snap, ok: false, message: '没有可安装的新版本' };
    if (!options.packaged) {
      return {
        ...snap,
        ok: false,
        message: '当前是开发运行，不能自动替换应用。请到 Release 页面下载安装包。',
      };
    }
    if (updateState.phase === 'downloading' || updateState.phase === 'installing') {
      return { ...snap, ok: false, message: '正在更新' };
    }
    const asset = pickReleaseAsset(updateState.latest.assets, process.platform, process.arch);
    if (!asset) return { ...updateSnapshot(), ok: false, message: '这个系统没有对应的安装包' };
    const dest = path.join(tmpdir(), 'dsh-pet-update-' + asset.name.replace(/[^\w.\-]+/g, '_'));
    updateState.phase = 'downloading';
    updateState.percent = 0;
    updateState.message = '正在下载';
    notifyUpdate();
    let lastPercent = -1;
    try {
      await downloadToFile(asset.browser_download_url, dest, {
        onProgress(percent) {
          if (percent !== 100 && percent - lastPercent < 2) return;
          lastPercent = percent;
          updateState.percent = percent;
          updateState.message = '正在下载 ' + percent + '%';
          notifyUpdate();
        },
      });
      updateState.phase = 'installing';
      updateState.message = '正在安装，完成后会自动重启';
      notifyUpdate();
      await applyDownloadedUpdate({
        file: dest,
        platform: process.platform,
        execPath: options.execPath || process.execPath,
        relaunch: () => onRelaunch?.(),
      });
      updateState.phase = 'done';
      updateState.message = '安装完成，正在重启';
      notifyUpdate();
      return { ...updateSnapshot(), ok: true, message: updateState.message };
    } catch (error) {
      updateState.phase = 'error';
      const raw = error instanceof Error ? error.message : String(error);
      updateState.message = /timeout|aborted/i.test(raw) ? '下载超时' : raw;
      notifyUpdate();
      return { ...updateSnapshot(), ok: false, message: updateState.message };
    }
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
          'access-control-allow-headers': 'content-type',
        });
        res.end();
        return;
      }
      if (url.pathname === '/' || url.pathname === '/health') {
        if (url.pathname === '/health') {
          sendJson(res, 200, { ok: true, name: 'dsh-pet-app' });
          return;
        }
        sendText(res, 200, homePage(), 'text/html; charset=utf-8');
        return;
      }
      if (url.pathname === '/shutdown' && req.method === 'POST') {
        sendJson(res, 200, { ok: true });
        setTimeout(() => void stop('shutdown'), 30);
        return;
      }
      if (!url.pathname.startsWith(ROUTE_PREFIX)) {
        sendText(res, 404, 'not found');
        return;
      }
      const rest = decodeURIComponent(url.pathname.slice(ROUTE_PREFIX.length + 1));
      const method = req.method ?? 'GET';
      if (rest === 'pet-skill' && method === 'GET') {
        const template = readFileSync(path.join(ROOT, 'vendor', 'pet-skill', 'SKILL.md'), 'utf8');
        const address = server.address();
        const port = address && typeof address === 'object' ? address.port : 3080;
        const text = template
          .replaceAll('{{ORIGIN}}', 'http://127.0.0.1:' + port)
          .replaceAll('{{PACK_DIR}}', userPacksDir(USER_DIR));
        sendText(res, 200, text, 'text/markdown; charset=utf-8');
        return;
      }
      if (rest === 'pet-packs/import' && method === 'POST') {
        try {
          const buf = await readBinary(req, 512 * 1024 * 1024);
          const result = importPetZip(buf, USER_DIR);
          sendJson(res, 200, { ok: true, ...result, packs: packChoices() });
        } catch (error) {
          sendJson(res, 200, {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      const body = method === 'POST' || method === 'PUT' ? await readBody(req) : '';

      if (rest === 'config' && method === 'GET') {
        sendJson(res, 200, publicConfig());
        return;
      }
      if (rest === 'state' && method === 'GET') {
        sendJson(res, 200, publicState());
        return;
      }
      if (rest === 'app-settings' && method === 'GET') {
        const settings = loadSettings();
        const choices = defaultChoices();
        sendJson(res, 200, {
          baseUrl: settings.baseUrl,
          model: settings.model,
          apiKey: settings.apiKey,
          choices,
          defaultBaseUrl: choices.baseUrl[0] ?? '',
          apiKeyGuideUrl: API_KEY_GUIDE_URL,
        });
        return;
      }
      if (rest === 'app-settings/validate' && method === 'POST') {
        const parsed = JSON.parse(body || '{}');
        try {
          await validateSettingsPayload(parsed);
          sendJson(res, 200, { ok: true });
        } catch (error) {
          sendJson(res, 200, {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      if (rest === 'app-settings' && method === 'PUT') {
        const parsed = JSON.parse(body || '{}');
        try {
          await validateSettingsPayload(parsed);
        } catch (error) {
          sendJson(res, 200, {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        const saved = saveSettings(parsed);
        sendJson(res, 200, {
          ok: true,
          baseUrl: saved.baseUrl,
          model: saved.model,
          apiKey: saved.apiKey,
        });
        return;
      }
      if (rest === 'app-update' && method === 'GET') {
        sendJson(res, 200, updateSnapshot());
        return;
      }
      if (rest === 'app-update/check' && method === 'POST') {
        sendJson(res, 200, await checkForUpdate());
        return;
      }
      if (rest === 'app-update/auto-check' && method === 'POST') {
        const parsed = JSON.parse(body || '{}');
        const enabled = parsed.enabled !== false;
        saveSettings({ autoCheckUpdate: enabled });
        if (enabled) {
          sendJson(res, 200, await checkForUpdate());
        } else {
          notifyUpdate();
          sendJson(res, 200, updateSnapshot());
        }
        return;
      }
      if (rest === 'app-update/seen' && method === 'POST') {
        const latest = updateState.latest?.version;
        if (latest) saveSettings({ updateSeenVersion: latest });
        notifyUpdate();
        sendJson(res, 200, updateSnapshot());
        return;
      }
      if (rest === 'app-update/install' && method === 'POST') {
        sendJson(res, 200, await installUpdate());
        return;
      }
      if (rest === 'balance' && method === 'POST') {
        writeLeaf(state.sections.balance, {
          ok: false,
          provider: 'custom-api',
          reason: 'unsupported',
          message: '当前接入的是自备 API Key，没有账户余额接口',
          manual: true,
        });
        sendJson(res, 200, { ok: true });
        return;
      }
      if (rest === 'whisper' && method === 'POST') {
        const petId = url.searchParams.get('pet') || 'main';
        try {
          sendJson(res, 200, await generateWhisper(petId));
        } catch (error) {
          sendJson(res, 200, {
            ok: false,
            reason: 'generate-error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      if (rest === 'chat') {
        const petId = url.searchParams.get('pet') || 'main';
        if (method === 'GET') {
          const rounds = Number(entryForPet(petId)?.config.chatMemoryRounds);
          sendJson(res, 200, {
            ok: true,
            rounds: Number.isFinite(rounds) ? rounds : 5,
            messages: memoryMessages(petId, Number.isFinite(rounds) ? rounds : 5),
          });
          return;
        }
        if (method === 'POST') {
          const parsed = JSON.parse(body || '{}');
          const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
          if (!text) {
            sendJson(res, 200, { ok: false, reason: 'bad-request', message: '消息为空' });
            return;
          }
          if (text.length > 2000) {
            sendJson(res, 200, { ok: false, reason: 'bad-request', message: '消息过长（限 2000 字）' });
            return;
          }
          try {
            sendJson(res, 200, await generateReply(petId, text));
          } catch (error) {
            sendJson(res, 200, {
              ok: false,
              reason: 'generate-error',
              message: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        }
      }
      if (rest === 'pet-packs/remove' && method === 'POST') {
        try {
          const parsed = JSON.parse(body || '{}');
          const name = String(parsed.name || '').trim();
          const kept = loadUserPets().filter((pet) => pet.pack !== name);
          removeUserPack(ROOT, USER_DIR, name);
          const packs = packChoices();
          const fallback = packs.find((pack) => pack.official)?.template || packs[0]?.template;
          if (kept.length === 0 && !fallback) throw new Error('没有可保留的宠物');
          const next = kept.length > 0 ? kept : [createPetFromTemplate(fallback, [])];
          const saved = saveUserPets(next);
          sendJson(res, 200, { ok: true, name, pets: saved, packs });
          void restartHelper();
        } catch (error) {
          sendJson(res, 200, {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      if (rest === 'pet-config' && method === 'GET') {
        const packs = packChoices();
        sendJson(res, 200, {
          pets: loadUserPets(),
          template: packs[0]?.template ?? null,
          packs,
          corners: Object.entries(CORNER_LABEL).map(([value, label]) => ({ value, label })),
        });
        return;
      }
      if (rest === 'pet-config' && method === 'PUT') {
        const parsed = JSON.parse(body || '{}');
        try {
          const saved = saveUserPets(parsed.pets);
          sendJson(res, 200, { ok: true, pets: saved });
          void restartHelper();
        } catch (error) {
          sendJson(res, 200, {
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      if (rest === 'pet-display' && method === 'POST') {
        const parsed = JSON.parse(body || '{}');
        const petId = typeof parsed.id === 'string' ? parsed.id : '';
        const display = String(parsed.display ?? '');
        if (!petId || !['web', 'desktop', 'both', 'none'].includes(display)) {
          sendJson(res, 400, { error: 'invalid pet display' });
          return;
        }
        const pets = loadUserPets();
        const index = pets.findIndex((pet) => pet.id === petId);
        if (index < 0) {
          sendJson(res, 404, { error: 'pet not found' });
          return;
        }
        pets[index] = { ...pets[index], display };
        saveUserPets(pets);
        sendJson(res, 200, publicConfig());
        void restartHelper();
        return;
      }
      if (rest === 'reload' && method === 'POST') {
        sendJson(res, 200, { reloading: true });
        void restartHelper();
        return;
      }
      if (rest === 'anim' && method === 'POST') {
        const petId = url.searchParams.get('pet') || 'main';
        const parsed = JSON.parse(body || '{}');
        const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
        if (!name) {
          sendJson(res, 200, { ok: false, reason: 'bad-request', message: '缺少动画名' });
          return;
        }
        writeLeaf(ensurePet(state, petId).anim, { name });
        sendJson(res, 200, { ok: true });
        return;
      }

      const [scope, ...restParts] = rest.split('/');
      if (scope === 'font' || scope === 'pic' || scope === 'thumb') {
        const file = resolveAsset(scope, restParts);
        if (!file) {
          sendText(res, 404, 'not found');
          return;
        }
        sendFile(req, res, file);
        return;
      }
      sendText(res, 404, 'not found');
    } catch (error) {
      if (!res.headersSent) sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  const port = await listen(server, options.port ?? 3080);
  console.log(`[dsh-pet] 宿主 http://127.0.0.1:${port}/dsh-pet-7340/config`);
  const scheduleUpdateCheck = () => {
    if (options.checkUpdates === false) return;
    const run = () => {
      if (loadSettings().autoCheckUpdate) void checkForUpdate();
    };
    setTimeout(run, 4000);
    updateTimer = setInterval(run, 60 * 60 * 1000);
  };

  scheduleWhisper();
  scheduleUpdateCheck();
  if (launchHelper) startHelper();

  async function stop(reason = 'stop') {
    if (shuttingDown) return;
    shuttingDown = true;
    expectExit = true;
    console.log('[dsh-pet] 收尾（' + reason + '）');
    if (whisperTimer) clearTimeout(whisperTimer);
    if (updateTimer) clearInterval(updateTimer);
    if (helper && helper.exitCode === null) {
      helper.kill('SIGTERM');
      await new Promise((resolve) => helper.once('exit', resolve));
    }
    await new Promise((resolve) => server.close(() => resolve()));
    if (reason === 'shutdown') process.exit(0);
  }

  process.on('SIGINT', () => void stop('SIGINT').then(() => process.exit(0)));
  process.on('SIGTERM', () => void stop('SIGTERM').then(() => process.exit(0)));
  const pets = desktopPets({ pets: runtimePets() }).map((pet) => ({ id: pet.id, size: pet.size }));
  return { port, stop, publicState, pets, trayIcon: trayIconPath() };
}

function resolveAsset(scope, parts) {
  if (scope === 'font') {
    return safeJoin(path.join(ASSETS, 'fonts'), parts.join('/'));
  }
  if (scope === 'pic') {
    if (parts[0] === 'memes') {
      const segs = parts.slice(1);
      const rooted = segs.length >= 2;
      const rootName = rooted ? segs[0] : 'main';
      const rel = (rooted ? segs.slice(1) : segs).join('/');
      return mediaFile(ROOT, rootName, 'memes', rel, USER_DIR);
    }
    const file = safeJoin(path.join(ASSETS, 'pic'), parts.join('/'));
    return file && existsSync(file) ? file : null;
  }
  if (scope === 'thumb') {
    const rootName = parts[0] || 'main';
    const fileName = parts.slice(1).join('/');
    const ext = path.extname(fileName).toLowerCase();
    if (ext !== '.webm' && ext !== '.mov') return null;
    return mediaFile(ROOT, rootName, ext.slice(1), fileName, USER_DIR);
  }
  return null;
}

function listen(server, preferred) {
  return new Promise((resolve, reject) => {
    const tryPort = (port, left) => {
      const onError = (error) => {
        if (error && error.code === 'EADDRINUSE' && left > 0) {
          tryPort(port + 1, left - 1);
          return;
        }
        reject(error);
      };
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', onError);
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : port);
      });
    };
    tryPort(preferred, 25);
  });
}
