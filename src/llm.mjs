/**
 * OpenAI 兼容对话。碎碎念与聊天都走这里。
 */

const IMG_TAG = /\[图[:：]\s*([^\]\n]+?)\s*\]\s*$/;

/**
 * @param {Array<{name: string, desc: string}>} pool
 */
export function memeCatalog(pool) {
  return pool.map((m) => '- ' + m.name + '：' + m.desc).join('\n');
}

/**
 * 对话配图：模型在末尾写 [图:名称]，命中表情包池才采纳。
 * @param {string} text
 * @param {Array<{name: string, desc: string}>} pool
 */
export function extractChatImage(text, pool) {
  const matched = IMG_TAG.exec(text);
  if (!matched) return { text };
  const name = String(matched[1] ?? '').trim();
  const hit = pool.find((item) => item.name === name);
  const body = text.slice(0, matched.index).trim();
  if (!hit || !body) return { text };
  return { text: body, image: hit.name };
}

/**
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string} opts.system
 * @param {Array<{role: 'user' | 'assistant' | 'system', content: string}>} opts.messages
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<string>}
 */
export async function completeChat(opts) {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const response = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + opts.apiKey,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [{ role: 'system', content: opts.system }, ...opts.messages],
      temperature: 1,
      max_tokens: opts.maxTokens ?? 512,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error('模型接口 ' + response.status + '：' + raw.slice(0, 400));
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('模型接口返回的不是 JSON');
  }
  const message = data?.choices?.[0]?.message ?? {};
  const content = typeof message.content === 'string' ? message.content.trim() : '';
  if (content) return content;
  throw new Error('模型未返回文本');
}

const VALIDATE_ATTEMPTS = 3;
const VALIDATE_TIMEOUT_MS = 8_000;

/**
 * @param {unknown} error
 */
function retryableCredentialError(error) {
  if (!(error instanceof Error)) return true;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true;
  return /timeout|aborted|fetch failed|network|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(error.message);
}

/**
 * 保存前探测接口与 Key 是否可用。
 * 这个网关有时单次请求会挂住，所以用很短的超时，失败再换一次新连接。
 * @param {{baseUrl: string, apiKey: string, model: string}} opts
 */
export async function validateApiCredentials(opts) {
  const baseUrl = String(opts.baseUrl ?? '').trim().replace(/\/+$/, '');
  const apiKey = String(opts.apiKey ?? '').trim();
  const model = String(opts.model ?? '').trim();
  if (!baseUrl) throw new Error('请填写接口地址');
  if (!model) throw new Error('请填写模型');
  if (!apiKey) throw new Error('请填写 API Key');

  let lastError = new Error('接口响应超时，请再试一次');
  for (let attempt = 0; attempt < VALIDATE_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + apiKey,
          connection: 'close',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          temperature: 0,
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
      });
      const raw = await response.text();
      if (response.ok) return;
      if (response.status === 401 || response.status === 403) {
        throw new Error('API Key 无效');
      }
      const detail = raw.replace(/\s+/g, ' ').trim().slice(0, 160);
      const message = '模型接口 ' + response.status + (detail ? '：' + detail : '');
      if (response.status !== 408 && response.status !== 429 && response.status < 500) {
        throw Object.assign(new Error(message), { retryable: false });
      }
      lastError = new Error(message);
    } catch (error) {
      if (error instanceof Error && error.retryable === false) throw new Error(error.message);
      if (error instanceof Error && error.message === 'API Key 无效') throw error;
      if (!retryableCredentialError(error) && error instanceof Error) throw error;
      lastError = new Error('接口响应超时，请再试一次');
    }
  }
  throw lastError;
}
