import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseJsonc } from './jsonc.mjs';
import { isApiKeyError, pickLocalWhisper } from './whisper-fallback.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const book = JSON.parse(readFileSync(path.join(root, 'src', 'whisper-fallbacks.json'), 'utf8'));
const config = parseJsonc(readFileSync(path.join(root, 'vendor', 'assets', 'config.jsonc'), 'utf8'));

test('每个表情包都有 10 条不超过 20 字的配文', () => {
  const names = Object.keys(config.memes);
  assert.deepEqual(Object.keys(book).sort(), names.sort());
  for (const name of names) {
    const lines = book[name];
    assert.equal(lines.length, 10, name);
    assert.equal(new Set(lines).size, 10, name);
    for (const line of lines) {
      assert.equal(typeof line, 'string');
      assert.ok(line.trim().length > 0, name);
      assert.ok([...line].length <= 20, name + ' / ' + line);
    }
  }
});

test('本地配文从池子里抽一句和对应的图', () => {
  const pool = [{ name: '可爱' }, { name: '死掉了' }];
  const picked = pickLocalWhisper(book, pool, () => 0);
  assert.deepEqual(picked, { text: book['可爱'][0], image: '可爱' });
});

test('只有鉴权失败才算 Key 无效', () => {
  assert.equal(isApiKeyError(new Error('模型接口 401：unauthorized')), true);
  assert.equal(isApiKeyError(new Error('Incorrect API key provided')), true);
  assert.equal(isApiKeyError(new Error('模型接口 500：busy')), false);
  assert.equal(isApiKeyError(new Error('模型接口返回的不是 JSON')), false);
});
