import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { assembleConfigEntries, listPetPackNames, mediaFile } from './pet-packs.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

test('蓝毛小女仆的配置、配文和素材在同一个目录', () => {
  assert.deepEqual(listPetPackNames(root), ['蓝毛小女仆']);
  const dir = path.join(root, 'vendor', 'pets', '蓝毛小女仆');
  for (const name of ['config.jsonc', 'whisper-fallbacks.json', 'memes', 'webm']) {
    assert.equal(existsSync(path.join(dir, name)), true, name);
  }
  const entries = assembleConfigEntries(root, [{ id: 'main', name: '改名', pack: '蓝毛小女仆' }]);
  const entry = entries['蓝毛小女仆'];
  assert.equal(entry.config.pets[0].name, '改名');
  assert.equal(entry.config.pets[0].pack, '蓝毛小女仆');
  assert.match(entry.config.whisperPrompt, /蓝发小女仆/);
  assert.equal(entry.config.chatMemoryRounds, 5);
  assert.equal(
    mediaFile(root, '蓝毛小女仆', 'webm', '待机呼吸休闲.webm'),
    path.join(dir, 'webm', '待机呼吸休闲.webm'),
  );
  assert.equal(mediaFile(root, '蓝毛小女仆', 'memes', '../config.jsonc'), null);
});
