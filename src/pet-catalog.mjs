/**
 * 从 77-pet-packs 拉宠物模板。GitHub 没有及时响应时，安装默认模板会改用 Gitee。
 * 清单在 catalog.json，每种模板的文件表在 pets/<id>/manifest.json。
 */
import { createHash } from 'node:crypto';
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { userPacksDir } from './pet-packs.mjs';

export const GITEE_STALE_NOTE = 'Gitee 不一定是最新的，作者可能会忘记同步。';
export const CATALOG_SOURCES = {
  github: {
    id: 'github',
    catalog: 'https://raw.githubusercontent.com/z-juln/77-pet-packs/master/catalog.json',
    petBase: 'https://raw.githubusercontent.com/z-juln/77-pet-packs/master/pets/',
  },
  gitee: {
    id: 'gitee',
    catalog: 'https://gitee.com/juln/77-pet-packs/raw/master/catalog.json',
    petBase: 'https://gitee.com/juln/77-pet-packs/raw/master/pets/',
  },
};

const GITHUB_STALL_MS = 8_000;

export class CatalogStallError extends Error {
  constructor(message = 'GitHub 响应很慢') {
    super(message);
    this.name = 'CatalogStallError';
    this.stalled = true;
  }
}

export function catalogSourceId(source) {
  return source === 'gitee' ? 'gitee' : 'github';
}

export function rawPetUrl(id, file, source = 'github') {
  const pet = petId(id);
  if (!pet) throw new Error('宠物 id 无效');
  return (
    CATALOG_SOURCES[catalogSourceId(source)].petBase +
    pet +
    '/' +
    safeRelative(file).split('/').map((part) => encodeURIComponent(part)).join('/')
  );
}

export function petId(value) {
  const id = String(value || '').trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return '';
  return id;
}

export function safeRelative(file) {
  const normalized = String(file || '').replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (!normalized || normalized.startsWith('/') || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('宠物文件路径无效');
  }
  return normalized;
}

function previewName(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim();
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) return '';
  return name;
}

export function parseCatalog(data, source = 'github') {
  const pets = Array.isArray(data?.pets) ? data.pets : [];
  const id = catalogSourceId(source);
  return pets
    .filter((pet) => pet && petId(pet.id) && typeof pet.revision === 'string')
    .map((pet) => {
      const petKey = petId(pet.id);
      const preview = previewName(pet.preview);
      const label = typeof pet.name === 'string' && pet.name.trim() ? pet.name.trim() : petKey;
      return {
        id: petKey,
        name: label,
        label: typeof pet.label === 'string' && pet.label.trim() ? pet.label.trim() : label,
        revision: pet.revision,
        bytes: Number(pet.bytes) || 0,
        preview,
        previewUrl: preview ? rawPetUrl(petKey, preview, id) : '',
        default: pet.default === true,
      };
    });
}

function packFiles(dir, prefix = '') {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store' || entry.name === 'manifest.json' || entry.name === 'default') continue;
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...packFiles(full, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort((a, b) => a.localeCompare(b, 'zh'));
}

/** 与 77-pet-packs 的 catalog revision 同一算法：路径 + 文件内容的 sha256 前 16 位。 */
export function contentRevision(dir) {
  const hash = createHash('sha256');
  for (const file of packFiles(dir)) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(path.join(dir, file)));
  }
  return hash.digest('hex').slice(0, 16);
}

export function catalogState(userDir, pet) {
  const dir = path.join(userPacksDir(userDir), pet.id);
  const originPath = path.join(userPacksDir(userDir), pet.id + '.origin');
  const installed = existsSync(path.join(dir, 'config.jsonc'));
  const origin = installed && existsSync(originPath) ? readFileSync(originPath, 'utf8').trim() : '';
  let current = origin.startsWith('catalog:') ? origin.slice('catalog:'.length) : '';
  if (installed && origin !== 'import' && current !== pet.revision) {
    current = contentRevision(dir);
    if (current === pet.revision) writeFileSync(originPath, 'catalog:' + pet.revision);
  }
  return {
    ...pet,
    installed,
    imported: origin === 'import',
    update: installed && origin !== 'import' && current !== pet.revision,
  };
}

function limitsFor(source) {
  if (source === 'gitee') {
    return {
      headerMs: 20_000,
      idleMs: 30_000,
      fail: () => new Error('Gitee 镜像没有及时响应'),
    };
  }
  return {
    headerMs: GITHUB_STALL_MS,
    idleMs: GITHUB_STALL_MS,
    fail: () => new CatalogStallError(),
  };
}

export function isTransportStall(error) {
  if (!error || error.stalled) return Boolean(error?.stalled);
  const name = error.name || '';
  if (name === 'TimeoutError' || name === 'AbortError') return true;
  return /timeout|aborted|network|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|socket/i.test(String(error.message || error));
}

async function readJson(fetchImpl, url, source) {
  const limits = limitsFor(source);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.headerMs);
  try {
    const response = await fetchImpl(url, {
      headers: { 'user-agent': '77-pet-app', accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) throw new Error('读取宠物列表失败（' + response.status + '）');
    return response.json();
  } catch (error) {
    if (error instanceof Error && /读取宠物列表失败/.test(error.message)) throw error;
    if (controller.signal.aborted || isTransportStall(error)) throw limits.fail();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPetCatalog(fetchImpl = fetch, source = 'github') {
  const id = catalogSourceId(source);
  return parseCatalog(await readJson(fetchImpl, CATALOG_SOURCES[id].catalog, id), id);
}

async function installDefaultFrom(userDir, source, fetchImpl) {
  const pet = (await fetchPetCatalog(fetchImpl, source)).find((item) => item.default);
  if (!pet) return null;
  const configPath = path.join(userPacksDir(userDir), pet.id, 'config.jsonc');
  if (!existsSync(configPath)) {
    console.log('[77-pet] 正在安装默认桌宠「' + (pet.label || pet.id) + '」');
    await installCatalogPet(userDir, pet.id, fetchImpl, source);
  }
  return pet;
}

export async function ensureDefaultPet(userDir, fetchImpl = fetch) {
  try {
    return await installDefaultFrom(userDir, 'github', fetchImpl);
  } catch (error) {
    if (!(error instanceof CatalogStallError) && !isTransportStall(error)) throw error;
    console.log('[77-pet] GitHub 没有及时响应，改用 Gitee 镜像。' + GITEE_STALE_NOTE);
    return await installDefaultFrom(userDir, 'gitee', fetchImpl);
  }
}

async function downloadFile(fetchImpl, url, dest, source) {
  const limits = limitsFor(source);
  const controller = new AbortController();
  const headerTimer = setTimeout(() => controller.abort(), limits.headerMs);
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { 'user-agent': '77-pet-app' },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted || isTransportStall(error)) throw limits.fail();
    throw error;
  } finally {
    clearTimeout(headerTimer);
  }
  if (!response.ok || !response.body) throw new Error('下载失败（' + (response.status || '空响应') + '）');
  mkdirSync(path.dirname(dest), { recursive: true });
  const reader = response.body.getReader();
  const out = createWriteStream(dest);
  try {
    while (true) {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(limits.fail()), limits.idleMs);
      });
      let piece;
      try {
        piece = await Promise.race([reader.read(), timeout]);
      } finally {
        clearTimeout(timer);
      }
      if (piece.done) break;
      if (!out.write(piece.value)) {
        await new Promise((resolve, reject) => {
          out.once('drain', resolve);
          out.once('error', reject);
        });
      }
    }
  } catch (error) {
    reader.cancel().catch(() => {});
    out.destroy();
    throw error;
  }
  await new Promise((resolve, reject) => {
    out.once('error', reject);
    out.end(resolve);
  });
}

export async function installCatalogPet(userDir, id, fetchImpl = fetch, source = 'github') {
  const trimmed = petId(id);
  if (!trimmed) throw new Error('宠物 id 无效');
  const idSource = catalogSourceId(source);
  const catalog = await fetchPetCatalog(fetchImpl, idSource);
  const pet = catalog.find((item) => item.id === trimmed);
  if (!pet) throw new Error('云端没有这个模板');
  const originPath = path.join(userPacksDir(userDir), trimmed + '.origin');
  if (existsSync(originPath) && readFileSync(originPath, 'utf8').trim() === 'import') {
    throw new Error('这是你自己的模板，云端不会覆盖');
  }
  const manifest = await readJson(fetchImpl, rawPetUrl(trimmed, 'manifest.json', idSource), idSource);
  const files = Array.isArray(manifest.files) ? manifest.files.map(safeRelative) : [];
  if (!files.includes('config.jsonc')) throw new Error('云端模板缺少配置');
  const staging = mkdtempSync(path.join(tmpdir(), 'pet77-catalog-'));
  try {
    for (const file of files) {
      await downloadFile(fetchImpl, rawPetUrl(trimmed, file, idSource), path.join(staging, file), idSource);
    }
    const dest = path.join(userPacksDir(userDir), trimmed);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(userPacksDir(userDir), { recursive: true });
    try {
      renameSync(staging, dest);
    } catch (error) {
      if (error?.code !== 'EXDEV') throw error;
      cpSync(staging, dest, { recursive: true });
      rmSync(staging, { recursive: true, force: true });
    }
    writeFileSync(originPath, 'catalog:' + pet.revision);
    return pet;
  } finally {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  }
}
