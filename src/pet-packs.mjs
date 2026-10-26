/**
 * 每种宠物一个目录：config.jsonc、whisper-fallbacks.json、memes/、webm/。
 * 开发时如果仓库里还有 vendor/pets，优先读那里。
 * 安装包不再携带宠物。用户从 77-pet-packs 下载到用户目录，导入的 zip 也放在同一处。
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parseJsonc } from './jsonc.mjs';
import { mergePetsIntoConfig } from './pets-config.mjs';
import { extractZip } from './zip-pack.mjs';

export function petsDir(root) {
  return path.join(root, 'vendor', 'pets');
}

export function userPacksDir(userDir) {
  return path.join(userDir, 'pet-packs');
}

function packContainers(appRoot, userDir = '') {
  // 仓库里的散文件优先，方便开发时直接改 vendor/pets。
  // 安装包不含散文件，实际读到的是用户目录里解压或导入的宠物。
  const dirs = [petsDir(appRoot)];
  if (userDir) dirs.push(userPacksDir(userDir));
  return dirs;
}

export function listPetPackNames(appRoot, userDir = '') {
  const names = new Set();
  for (const dir of packContainers(appRoot, userDir)) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (existsSync(path.join(dir, entry.name, 'config.jsonc'))) names.add(entry.name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'zh'));
}

function locatePackDir(appRoot, name, userDir = '') {
  for (const dir of packContainers(appRoot, userDir)) {
    const candidate = path.join(dir, name);
    if (existsSync(path.join(candidate, 'config.jsonc'))) return candidate;
  }
  return null;
}

function readObject(file, label) {
  const parsed = parseJsonc(readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(label + ' 不是对象');
  }
  return parsed;
}

export function readAppConfig(root) {
  return readObject(path.join(root, 'vendor', 'assets', 'config.jsonc'), 'config.jsonc');
}

export function readPetPack(root, name, userDir = '') {
  const dir = locatePackDir(root, name, userDir);
  if (!dir) throw new Error('找不到宠物：' + name);
  const parsed = readObject(path.join(dir, 'config.jsonc'), name + ' 的 config.jsonc');
  const pets = (Array.isArray(parsed.pets) ? parsed.pets : []).map((pet) => ({
    ...pet,
    pack: typeof pet.pack === 'string' && pet.pack.trim() ? pet.pack.trim() : name,
  }));
  return { name, dir, config: { ...parsed, pets, animations: normalizeAnimations(parsed.animations) } };
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

/** 生成结果常把分类写成 name/animations。播放端只认 id/actions，缺了就会在初始化时读 undefined.length。 */
function normalizeAnimations(animations) {
  if (!animations || typeof animations !== 'object') return animations;
  const categories = asList(animations.categories).map((cat) => {
    if (!cat || typeof cat !== 'object') return { id: '动作', weight: 0, actions: [] };
    const actions = Array.isArray(cat.actions)
      ? cat.actions
      : Array.isArray(cat.animations)
        ? cat.animations
        : [];
    const weight = Number(cat.weight);
    return {
      ...cat,
      id: String(cat.id || cat.name || '动作'),
      weight: Number.isFinite(weight) ? weight : 0,
      actions,
    };
  });
  const moves = animations.moves && typeof animations.moves === 'object' ? animations.moves : {};
  return {
    ...animations,
    idle: asList(animations.idle),
    turn: asList(animations.turn),
    drag: asList(animations.drag),
    clicks: asList(animations.clicks),
    categories,
    moves: { ...moves, actions: asList(moves.actions) },
    events: animations.events && typeof animations.events === 'object' ? animations.events : {},
  };
}

export function basePets(root, userDir = '') {
  return listPetPackNames(root, userDir).flatMap((name) => readPetPack(root, name, userDir).config.pets);
}

/**
 * 把用户保存的实例合并进各自的宠物目录，得到渲染端要的成品。
 * 键是目录名，渲染端会把它当作素材根去找 webm 和表情包。
 */
export function assembleConfigEntries(root, userPets, userDir = '') {
  const globals = readAppConfig(root);
  const packs = listPetPackNames(root, userDir).map((name) => readPetPack(root, name, userDir));
  const onlyName = packs.length === 1 ? packs[0].name : '';
  const entries = {};
  for (const pack of packs) {
    const baseIds = new Set(pack.config.pets.map((pet) => pet.id));
    const belonging = Array.isArray(userPets)
      ? userPets.filter(
          (pet) => pet.pack === pack.name || (!pet.pack && (baseIds.has(pet.id) || onlyName === pack.name)),
        )
      : pack.config.pets;
    const merged = mergePetsIntoConfig(
      { ...globals, ...pack.config },
      belonging.length > 0 ? belonging : pack.config.pets,
    );
    entries[pack.name] = { name: pack.name, dir: pack.dir, config: merged };
  }
  return entries;
}

export function fallbackBookPath(dir) {
  return path.join(dir, 'whisper-fallbacks.json');
}

export function mediaFile(root, assetRoot, kind, relativePath, userDir = '') {
  if (!relativePath || relativePath.includes('..')) return null;
  if (!assetRoot || assetRoot.includes('..') || assetRoot.includes('/') || assetRoot.includes('\\')) return null;
  const direct = locatePackDir(root, assetRoot, userDir);
  if (direct) {
    const file = path.join(direct, kind, relativePath);
    if (existsSync(file)) return file;
  }
  if (assetRoot === 'main') {
    for (const name of listPetPackNames(root, userDir)) {
      const dir = locatePackDir(root, name, userDir);
      const file = dir ? path.join(dir, kind, relativePath) : '';
      if (file && existsSync(file)) return file;
    }
  }
  const legacy = path.join(root, 'vendor', 'assets', kind, relativePath);
  return existsSync(legacy) ? legacy : null;
}

function bundledZipDir(appRoot) {
  const packed = path.join(appRoot, 'vendor', 'pet-packs');
  const marker = path.sep + 'app.asar' + path.sep;
  if (!packed.includes(marker)) return packed;
  const unpacked = packed.replace(marker, path.sep + 'app.asar.unpacked' + path.sep);
  return existsSync(unpacked) ? unpacked : packed;
}

function moveDir(from, to) {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(path.dirname(to), { recursive: true });
  try {
    renameSync(from, to);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

function inspectPack(dir) {
  let root = dir;
  if (!existsSync(path.join(root, 'config.jsonc'))) {
    const children = readdirSync(dir, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, 'config.jsonc')),
    );
    if (children.length !== 1) throw new Error('压缩包里需要有 config.jsonc');
    root = path.join(dir, children[0].name);
  }
  const parsed = readObject(path.join(root, 'config.jsonc'), '宠物包 config.jsonc');
  const pet = Array.isArray(parsed.pets) ? parsed.pets[0] : null;
  const name = String(pet?.pack || pet?.name || '').trim();
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    throw new Error('宠物包需要在 pets 里写上名称');
  }
  return { name, root };
}

function placePack(root, name, userDir, origin) {
  const destRoot = userPacksDir(userDir);
  mkdirSync(destRoot, { recursive: true });
  const dest = path.join(destRoot, name);
  const replaced = existsSync(dest);
  moveDir(root, dest);
  writeFileSync(path.join(destRoot, name + '.origin'), origin);
  return { name, replaced };
}

export function isBundledPack(appRoot, name) {
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return false;
  if (existsSync(path.join(bundledZipDir(appRoot), name + '.zip'))) return true;
  return existsSync(path.join(petsDir(appRoot), name, 'config.jsonc'));
}

/** 删掉用户目录里的非内置种类。内置 zip 或仓库目录里的种类会拒绝。 */
export function removeUserPack(appRoot, userDir, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed || trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error('模板名称无效');
  }
  if (isBundledPack(appRoot, trimmed)) throw new Error('内置宠物不能删除');
  const root = userPacksDir(userDir);
  const dest = path.join(root, trimmed);
  if (!existsSync(dest)) throw new Error('找不到这个模板');
  rmSync(dest, { recursive: true, force: true });
  rmSync(path.join(root, trimmed + '.origin'), { force: true });
  rmSync(path.join(root, trimmed + '.zip.stamp'), { force: true });
  return { name: trimmed };
}

export function importPetZip(buffer, userDir) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'pet77-import-'));
  try {
    extractZip(buffer, tmp);
    const { name, root } = inspectPack(tmp);
    return placePack(root, name, userDir, 'import');
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  }
}

/** 安装包里的 zip 解压到用户目录。用户后来导入的同名宠物不会被盖掉。 */
export function installBundledPacks(appRoot, userDir) {
  const zipDir = bundledZipDir(appRoot);
  if (!existsSync(zipDir)) return [];
  const installed = [];
  mkdirSync(userPacksDir(userDir), { recursive: true });
  for (const file of readdirSync(zipDir)) {
    if (!file.endsWith('.zip')) continue;
    const zipPath = path.join(zipDir, file);
    const stat = statSync(zipPath);
    const marker = 'bundle:' + stat.size + ':' + Math.floor(stat.mtimeMs);
    const stampPath = path.join(userPacksDir(userDir), file + '.stamp');
    if (existsSync(stampPath) && readFileSync(stampPath, 'utf8') === marker) continue;
    const tmp = mkdtempSync(path.join(tmpdir(), 'pet77-bundle-'));
    try {
      extractZip(readFileSync(zipPath), tmp);
      const { name, root } = inspectPack(tmp);
      const originPath = path.join(userPacksDir(userDir), name + '.origin');
      const current = existsSync(originPath) ? readFileSync(originPath, 'utf8') : '';
      if (current !== 'import') {
        placePack(root, name, userDir, marker);
        installed.push(name);
      }
      writeFileSync(stampPath, marker);
    } finally {
      if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
    }
  }
  return installed;
}
