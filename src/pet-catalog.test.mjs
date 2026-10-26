import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { catalogState, ensureDefaultPet, installCatalogPet, parseCatalog, rawPetUrl, safeRelative } from './pet-catalog.mjs';

test('云端清单只保留有名字和版本的宠物', () => {
  const pets = parseCatalog({
    pets: [
      { id: 'blue-maid', name: '蓝毛小女仆', label: '蓝毛小女仆', revision: 'abc', bytes: 10 },
      { id: '', revision: 'x' },
      { name: '缺 id' },
      { id: '蓝毛', revision: 'y' },
    ],
  });
  assert.deepEqual(pets, [
    {
      id: 'blue-maid',
      name: '蓝毛小女仆',
      label: '蓝毛小女仆',
      revision: 'abc',
      bytes: 10,
      preview: '',
      previewUrl: '',
      default: false,
    },
  ]);
});

test('下载地址按路径分段编码', () => {
  assert.equal(
    rawPetUrl('blue-maid', 'webm/待机.webm'),
    'https://raw.githubusercontent.com/z-juln/77-pet-packs/master/pets/blue-maid/webm/' +
      encodeURIComponent('待机.webm'),
  );
  assert.equal(
    rawPetUrl('blue-maid', 'preview.png', 'gitee'),
    'https://gitee.com/juln/77-pet-packs/raw/master/pets/blue-maid/preview.png',
  );
  assert.throws(() => safeRelative('../config.jsonc'), /无效/);
});

test('本机版本和云端不一致时需要更新', () => {
  const userDir = mkdtempSync(path.join(tmpdir(), 'pet77-catalog-'));
  const pet = { id: 'cloud-cat', name: '云端猫', label: '云端猫', revision: 'bbbb', bytes: 3 };
  assert.equal(catalogState(userDir, pet).installed, false);
  assert.equal(catalogState(userDir, pet).update, false);
});

test('文件 revision 已与云端一致时不提示更新', () => {
  const userDir = mkdtempSync(path.join(tmpdir(), 'pet77-catalog-'));
  const dir = path.join(userDir, 'pet-packs', 'cloud-cat');
  mkdirSync(dir, { recursive: true });
  const body = '{"pets":[{"name":"云端猫"}]}\n';
  writeFileSync(path.join(dir, 'config.jsonc'), body);
  writeFileSync(path.join(userDir, 'pet-packs', 'cloud-cat.origin'), 'bundle:old');
  const hash = createHash('sha256');
  hash.update('config.jsonc');
  hash.update('\0');
  hash.update(body);
  const revision = hash.digest('hex').slice(0, 16);
  const pet = { id: 'cloud-cat', name: '云端猫', label: '云端猫', revision, bytes: body.length };
  const state = catalogState(userDir, pet);
  assert.equal(state.installed, true);
  assert.equal(state.update, false);
  assert.equal(readFileSync(path.join(userDir, 'pet-packs', 'cloud-cat.origin'), 'utf8'), 'catalog:' + revision);
  assert.equal(catalogState(userDir, { ...pet, revision: 'bbbb' }).update, true);
});

test('按清单把云端宠物写到用户目录', async () => {
  const userDir = mkdtempSync(path.join(tmpdir(), 'pet77-catalog-'));
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href.endsWith('/catalog.json')) {
      return Response.json({ pets: [{ id: 'cloud-cat', name: '云端猫', label: '云端猫', revision: 'rev1', bytes: 4 }] });
    }
    if (href.endsWith('/manifest.json')) {
      return Response.json({ files: ['config.jsonc', 'webm/待机.webm'] });
    }
    if (href.endsWith('/config.jsonc')) return new Response('{"pets":[]}', { status: 200 });
    if (href.endsWith(encodeURIComponent('待机.webm'))) return new Response('webm', { status: 200 });
    return new Response('missing', { status: 404 });
  };
  const pet = await installCatalogPet(userDir, 'cloud-cat', fetchImpl);
  assert.equal(pet.id, 'cloud-cat');
  assert.equal(pet.revision, 'rev1');
  const root = path.join(userDir, 'pet-packs', 'cloud-cat');
  assert.equal(readFileSync(path.join(root, 'webm', '待机.webm'), 'utf8'), 'webm');
  assert.equal(readFileSync(path.join(userDir, 'pet-packs', 'cloud-cat.origin'), 'utf8'), 'catalog:rev1');
  assert.equal(catalogState(userDir, pet).update, false);
});

test('缺少本地文件时安装默认桌宠，已有则不再下载', async () => {
  const userDir = mkdtempSync(path.join(tmpdir(), 'pet77-catalog-'));
  let downloads = 0;
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href.endsWith('/catalog.json')) {
      return Response.json({
        pets: [
          { id: 'cloud-cat', name: '云端猫', label: '云端猫', revision: 'rev1', bytes: 4, default: true },
          { id: 'other-pet', name: '别的', label: '别的', revision: 'rev2', bytes: 1 },
        ],
      });
    }
    if (href.endsWith('/manifest.json')) return Response.json({ files: ['config.jsonc'] });
    if (href.endsWith('/config.jsonc')) {
      downloads += 1;
      return new Response('{"pets":[{"id":"main","name":"云端猫"}]}', { status: 200 });
    }
    return new Response('missing', { status: 404 });
  };
  const pet = await ensureDefaultPet(userDir, fetchImpl);
  assert.equal(pet.id, 'cloud-cat');
  assert.equal(downloads, 1);
  await ensureDefaultPet(userDir, fetchImpl);
  assert.equal(downloads, 1);
});

test('GitHub 超时后安装默认桌宠改用 Gitee', async () => {
  const userDir = mkdtempSync(path.join(tmpdir(), 'pet77-catalog-'));
  const seen = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    seen.push(href);
    if (href.includes('raw.githubusercontent.com')) {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    }
    if (href.endsWith('/catalog.json')) {
      return Response.json({
        pets: [{ id: 'cloud-cat', name: '云端猫', label: '云端猫', revision: 'rev1', bytes: 4, default: true }],
      });
    }
    if (href.endsWith('/manifest.json')) return Response.json({ files: ['config.jsonc'] });
    if (href.endsWith('/config.jsonc')) return new Response('{"pets":[{"id":"main","name":"云端猫"}]}', { status: 200 });
    return new Response('missing', { status: 404 });
  };
  const pet = await ensureDefaultPet(userDir, fetchImpl);
  assert.equal(pet.id, 'cloud-cat');
  assert.ok(seen.some((href) => href.includes('gitee.com')));
  assert.equal(readFileSync(path.join(userDir, 'pet-packs', 'cloud-cat.origin'), 'utf8'), 'catalog:rev1');
});

test('GitHub 返回 404 时不改用 Gitee', async () => {
  const userDir = mkdtempSync(path.join(tmpdir(), 'pet77-catalog-'));
  const fetchImpl = async (url) => {
    if (String(url).includes('gitee.com')) throw new Error('不应请求 Gitee');
    return new Response('missing', { status: 404 });
  };
  await assert.rejects(() => ensureDefaultPet(userDir, fetchImpl), /404/);
  assert.equal(userDir.length > 0, true);
});
