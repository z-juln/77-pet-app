import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { assembleConfigEntries, mediaFile } from './pet-packs.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

test('素材路径不能跳出宠物目录', () => {
  assert.equal(mediaFile(root, '蓝毛小女仆', 'memes', '../config.jsonc'), null);
  const maid = path.join(root, 'vendor', 'pets', '蓝毛小女仆', 'config.jsonc');
  if (!existsSync(maid)) return;
  const entries = assembleConfigEntries(root, [{ id: 'main', name: '改名', pack: 'blue-maid' }]);
  assert.equal(entries['blue-maid'].config.pets[0].name, '改名');
});
