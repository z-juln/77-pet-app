import assert from 'node:assert/strict';
import test from 'node:test';

import { extractChatImage, validateApiCredentials } from './llm.mjs';
import { parseJsonc, stripJsonc } from './jsonc.mjs';

test('jsonc 去掉注释但保留字符串', () => {
  const parsed = parseJsonc(`{
    // 行注释
    "name": "http://example.com",
    "note": "不要删掉 // 这个"
  }`);
  assert.equal(parsed.name, 'http://example.com');
  assert.equal(parsed.note, '不要删掉 // 这个');
  assert.equal(stripJsonc('{"a":1} /* x */').includes('x'), false);
});

test('Key 校验遇到超时会重试，通过后不再继续请求', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }
    return new Response('{"choices":[{"message":{"content":"ok"}}]}', { status: 200 });
  };
  try {
    await validateApiCredentials({ baseUrl: 'https://example.com/v1', apiKey: 'sk-test', model: 'm' });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('Key 无效时不重试', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('unauthorized', { status: 401 });
  };
  try {
    await assert.rejects(
      () => validateApiCredentials({ baseUrl: 'https://example.com/v1', apiKey: 'sk-bad', model: 'm' }),
      /API Key 无效/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('对话配图只接受池内名称', () => {
  const pool = [{ name: '可爱', desc: '卖萌' }];
  assert.deepEqual(extractChatImage('你好呀\n[图:可爱]', pool), { text: '你好呀', image: '可爱' });
  assert.deepEqual(extractChatImage('你好呀\n[图:不存在]', pool), { text: '你好呀\n[图:不存在]' });
});
