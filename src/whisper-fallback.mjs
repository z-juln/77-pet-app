/**
 * API Key 无效时，碎碎念改用本地配文，不再请求模型。
 */

/**
 * @param {unknown} error
 */
export function isApiKeyError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /模型接口 (401|403)\b|invalid[_ ]api[_ ]key|incorrect api key|unauthorized|authentication|api[_ ]key (invalid|incorrect|error)/i.test(
    message,
  );
}

/**
 * @param {Record<string, string[]>} book
 * @param {Array<{name: string}>} pool
 * @param {() => number} [random]
 * @returns {{text: string, image: string} | null}
 */
export function pickLocalWhisper(book, pool, random = Math.random) {
  const named = (pool ?? []).map((item) => item.name);
  const fromPool = named.filter((name) => Array.isArray(book?.[name]) && book[name].length > 0);
  const names =
    fromPool.length > 0
      ? fromPool
      : Object.keys(book ?? {}).filter((name) => Array.isArray(book[name]) && book[name].length > 0);
  if (names.length === 0) return null;
  const name = names[Math.floor(random() * names.length)];
  const lines = book[name];
  const text = lines[Math.floor(random() * lines.length)];
  // 配文的键只有在表情包池里才是一张图。动画名写成键时不能当图，否则气泡会去加载不存在的 png。
  return named.includes(name) ? { text, image: name } : { text, image: '' };
}
