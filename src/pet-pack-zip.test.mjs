import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { importPetZip, installBundledPacks, isBundledPack, listPetPackNames, readPetPack, removeUserPack } from './pet-packs.mjs';
import { crc32, extractZip, zipDirectory } from './zip-pack.mjs';

function storedZip(name, data) {
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + nameBuf.length, 12);
  eocd.writeUInt32LE(30 + nameBuf.length + data.length, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]);
}

test('zip 能原样解压，并拒绝跳出目录', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-pet-zip-'));
  try {
    const pack = path.join(dir, 'src');
    mkdirSync(path.join(pack, 'memes'), { recursive: true });
    writeFileSync(path.join(pack, 'config.jsonc'), '{ "pets": [] }\n');
    writeFileSync(path.join(pack, 'memes', 'a.png'), Buffer.from('png'));
    const zipPath = path.join(dir, 'pack.zip');
    await zipDirectory(pack, zipPath);
    const out = path.join(dir, 'out');
    extractZip(readFileSync(zipPath), out);
    assert.equal(readFileSync(path.join(out, 'config.jsonc'), 'utf8'), '{ "pets": [] }\n');
    assert.equal(readFileSync(path.join(out, 'memes', 'a.png')).toString(), 'png');
    assert.throws(() => extractZip(storedZip('../evil.txt', Buffer.from('no')), path.join(dir, 'slip')), /不安全路径/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('导入的 zip 成为用户目录里的新宠物，且不会被安装包覆盖', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-pet-import-'));
  try {
    const appRoot = path.join(dir, 'app');
    const source = path.join(appRoot, 'vendor', 'pets', '外来猫');
    mkdirSync(path.join(source, 'memes'), { recursive: true });
    const config = '{ "pets": [{ "id": "main", "name": "外来猫", "pack": "外来猫" }] }\n';
    writeFileSync(path.join(source, 'config.jsonc'), config);
    writeFileSync(path.join(source, 'memes', 'a.png'), Buffer.from('png'));
    const zipDir = path.join(appRoot, 'vendor', 'pet-packs');
    mkdirSync(zipDir, { recursive: true });
    await zipDirectory(source, path.join(zipDir, '外来猫.zip'));
    const userDir = path.join(dir, 'user');

    const imported = importPetZip(readFileSync(path.join(zipDir, '外来猫.zip')), userDir);
    assert.equal(imported.name, '外来猫');
    assert.equal(readPetPack(appRoot, '外来猫', userDir).config.pets[0].name, '外来猫');
    writeFileSync(path.join(userDir, 'pet-packs', '外来猫', 'config.jsonc'), config.replace('外来猫"', '改过的猫"'));

    assert.deepEqual(installBundledPacks(appRoot, userDir), []);
    assert.match(readFileSync(path.join(userDir, 'pet-packs', '外来猫', 'config.jsonc'), 'utf8'), /改过的猫/);
    assert.equal(listPetPackNames(appRoot, userDir).includes('外来猫'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('分类写成 name/animations 时读出来仍是 id/actions', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-pet-cat-'));
  try {
    const userDir = path.join(dir, 'user');
    const pack = path.join(userDir, 'pet-packs', '企鹅');
    mkdirSync(pack, { recursive: true });
    writeFileSync(
      path.join(pack, 'config.jsonc'),
      JSON.stringify({
        pets: [{ id: 'main', name: '企鹅', pack: '企鹅' }],
        animations: {
          idle: ['待机'],
          categories: [{ name: '唱跳', animations: ['唱跳舞台'], weight: 15 }],
        },
      }),
    );
    const category = readPetPack(path.join(dir, 'app'), '企鹅', userDir).config.animations.categories[0];
    assert.equal(category.id, '唱跳');
    assert.deepEqual(category.actions, ['唱跳舞台']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('只能删除用户自己的宠物种类', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-pet-remove-'));
  try {
    const appRoot = path.join(dir, 'app');
    const userDir = path.join(dir, 'user');
    mkdirSync(path.join(appRoot, 'vendor', 'pet-packs'), { recursive: true });
    writeFileSync(path.join(appRoot, 'vendor', 'pet-packs', '官方.zip'), '');
    const custom = path.join(userDir, 'pet-packs', '外来猫');
    mkdirSync(custom, { recursive: true });
    writeFileSync(path.join(custom, 'config.jsonc'), '{}\n');
    writeFileSync(path.join(userDir, 'pet-packs', '外来猫.origin'), 'import');
    assert.equal(isBundledPack(appRoot, '官方'), true);
    assert.equal(isBundledPack(appRoot, '外来猫'), false);
    assert.throws(() => removeUserPack(appRoot, userDir, '官方'), /内置/);
    removeUserPack(appRoot, userDir, '外来猫');
    assert.equal(existsSync(custom), false);
    assert.equal(existsSync(path.join(userDir, 'pet-packs', '外来猫.origin')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
