/**
 * 去掉 JSONC 注释（// 与块注释），不碰字符串里的内容。
 * @param {string} text
 * @returns {string}
 */
export function stripJsonc(text) {
  let out = '';
  let i = 0;
  let quote = '';
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === quote) quote = '';
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * @param {string} text
 * @returns {unknown}
 */
export function parseJsonc(text) {
  return JSON.parse(stripJsonc(text));
}
