import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { macAppBundle, removeTree } from './apply-update.mjs';
import { compareVersions, fetchLatestRelease, parseExpandedAssets, pickReleaseAsset } from './update.mjs';

test('版本号按数字段比较，并忽略 v 前缀', () => {
  assert.equal(compareVersions('0.0.2', '0.0.1'), 1);
  assert.equal(compareVersions('v0.1.0', '0.0.9'), 1);
  assert.equal(compareVersions('0.0.1', '0.0.1'), 0);
  assert.equal(compareVersions('0.0.1', '0.1.0'), -1);
});

test('按系统和架构挑选 Release 安装包', () => {
  const assets = [
    { name: 'DSH Pet-0.0.2-arm64.dmg', browser_download_url: 'https://example.com/arm.dmg' },
    { name: 'DSH Pet-0.0.2.dmg', browser_download_url: 'https://example.com/intel.dmg' },
    { name: 'DSH Pet-0.0.2-arm64.dmg.blockmap', browser_download_url: 'https://example.com/arm.blockmap' },
    { name: 'DSH Pet Setup 0.0.2.exe', browser_download_url: 'https://example.com/setup.exe' },
    { name: 'DSH.Pet-0.0.2-arm64.zip', browser_download_url: 'https://example.com/arm.zip' },
  ];
  assert.equal(pickReleaseAsset(assets, 'darwin', 'arm64').browser_download_url, 'https://example.com/arm.dmg');
  assert.equal(pickReleaseAsset(assets, 'darwin', 'x64').browser_download_url, 'https://example.com/intel.dmg');
  assert.equal(pickReleaseAsset(assets, 'win32', 'x64').browser_download_url, 'https://example.com/setup.exe');
  assert.equal(pickReleaseAsset(assets, 'linux', 'x64'), null);
});

test('只有一个 dmg 时 macOS 两个架构都用它', () => {
  const assets = [{ name: 'DSH Pet-0.0.2.dmg', browser_download_url: 'https://example.com/only.dmg' }];
  assert.equal(pickReleaseAsset(assets, 'darwin', 'arm64').name, 'DSH Pet-0.0.2.dmg');
});

test('删除应用目录时把 app.asar 当普通文件', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-pet-rm-'));
  const resources = path.join(dir, 'Contents', 'Resources');
  mkdirSync(resources, { recursive: true });
  writeFileSync(path.join(resources, 'app.asar'), 'not-a-directory');
  await removeTree(dir);
  assert.equal(existsSync(dir), false);
});

test('从可执行文件路径还原 macOS 应用包', () => {
  assert.equal(
    macAppBundle('/Applications/DSH Pet.app/Contents/MacOS/DSH Pet'),
    '/Applications/DSH Pet.app',
  );
  assert.equal(macAppBundle('/usr/local/bin/electron'), null);
});

test('GitHub 没有正式版时返回空', async () => {
  const release = await fetchLatestRelease(async () => new Response('{}', { status: 404 }));
  assert.equal(release, null);
});

test('API 被限流时改从 Release 页面读取安装包', async () => {
  const release = await fetchLatestRelease(async (url) => {
    const href = String(url);
    if (href.includes('api.github.com')) return new Response('{}', { status: 403 });
    if (href.endsWith('/releases/latest')) {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://github.com/z-juln/dsh-pet-app/releases/tag/0.0.2' },
      });
    }
    return new Response(
      '<a href="/z-juln/dsh-pet-app/releases/download/0.0.2/DSH.Pet-0.0.2-arm64.dmg">a</a>' +
        '<a href="/z-juln/dsh-pet-app/releases/download/0.0.2/DSH.Pet-0.0.2-arm64.dmg.blockmap">b</a>',
      { status: 200 },
    );
  });
  assert.equal(release.version, '0.0.2');
  assert.equal(release.assets.length, 1);
  assert.equal(
    release.assets[0].browser_download_url,
    'https://github.com/z-juln/dsh-pet-app/releases/download/0.0.2/DSH.Pet-0.0.2-arm64.dmg',
  );
});

test('页面里的下载链接会去掉校验文件', () => {
  const assets = parseExpandedAssets(
    '<a href="/z-juln/dsh-pet-app/releases/download/0.0.2/DSH.Pet.Setup.0.0.2.exe">x</a>',
  );
  assert.equal(assets[0].name, 'DSH.Pet.Setup.0.0.2.exe');
});

test('解析最新 Release 的版本号和安装包', async () => {
  const release = await fetchLatestRelease(async () =>
    Response.json({
      tag_name: 'v0.0.2',
      html_url: 'https://github.com/z-juln/dsh-pet-app/releases/tag/0.0.2',
      assets: [{ name: 'DSH Pet-0.0.2-arm64.dmg', browser_download_url: 'https://example.com/a.dmg' }],
    }),
  );
  assert.equal(release.version, '0.0.2');
  assert.equal(release.assets.length, 1);
});
