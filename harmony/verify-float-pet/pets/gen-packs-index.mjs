#!/usr/bin/env node
/**
 * 生成鸿蒙端的宠物包目录（packs.json）。
 *
 * 宠物包本体已经在 rawfile/pet/packs/<id>/ 下，这里只汇总设置页需要的信息：
 * id、显示名、预览图。顺序尽量跟随 77-pet-packs/catalog.json，保证默认宠物稳定。
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function parseArgs(argv) {
  const opts = { root: '', out: '', catalog: '' };
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    const value = argv[i + 1];
    if (key === 'root') opts.root = value;
    else if (key === 'out') opts.out = value;
    else if (key === 'catalog') opts.catalog = value;
    else throw new Error(`unknown option: ${argv[i]}`);
  }
  if (!opts.root || !opts.out) throw new Error('--root and --out are required');
  return opts;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const opts = parseArgs(process.argv);
const catalog = readJson(opts.catalog || join(opts.root, '..', 'catalog.json'));
const preferred = Array.isArray(catalog?.pets) ? catalog.pets.map((p) => p.id) : [];
const available = readdirSync(opts.root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(opts.root, d.name, 'config.jsonc')))
  .map((d) => d.name);

const ids = [
  ...preferred.filter((id) => available.includes(id)),
  ...available.filter((id) => !preferred.includes(id)).sort(),
];

const pets = ids.map((id) => {
  const dir = join(opts.root, id);
  const manifest = readJson(join(dir, 'manifest.json')) ?? {};
  const preview = existsSync(join(dir, 'preview.png')) ? 'preview.png' : '';
  const webmDir = join(dir, 'webm');
  let bytes = 0;
  if (existsSync(webmDir)) {
    for (const f of readdirSync(webmDir)) {
      if (f.endsWith('.webm')) bytes += statSync(join(webmDir, f)).size;
    }
  }
  return {
    id,
    name: manifest.name || manifest.label || id,
    preview,
    size: bytes,
  };
});

const defaultPack =
  typeof catalog?.default === 'string' && pets.some((p) => p.id === catalog.default)
    ? catalog.default
    : pets[0]?.id ?? 'blue-maid';

writeFileSync(
  opts.out,
  JSON.stringify({ default: defaultPack, pets }, null, 2),
);
console.error(`→ ${opts.out} (${pets.length} packs: ${pets.map((p) => p.id).join(', ')})`);
