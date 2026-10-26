/**
 * 通过 GitHub Release 比较版本、挑选当前系统的安装包，并下载到本地。
 */
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const UPDATE_REPO = 'z-juln/77-pet-app';
export const RELEASES_LATEST_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;

export function compareVersions(left, right) {
  const parse = (value) =>
    String(value ?? '')
      .trim()
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .map((part) => {
        const match = /^(\d+)/.exec(part);
        return match ? Number(match[1]) : 0;
      });
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function pickReleaseAsset(assets, platform, arch) {
  const named = (Array.isArray(assets) ? assets : []).filter(
    (item) => item && typeof item.name === 'string' && typeof item.browser_download_url === 'string',
  );
  if (platform === 'darwin') {
    const dmgs = named.filter((item) => /\.dmg$/i.test(item.name));
    const arm64 = dmgs.find((item) => /arm64|aarch64/i.test(item.name));
    const intel = dmgs.find((item) => !/arm64|aarch64/i.test(item.name));
    if (arch === 'arm64') return arm64 || (dmgs.length === 1 ? dmgs[0] : null);
    return intel || (dmgs.length === 1 ? dmgs[0] : null);
  }
  if (platform === 'win32') {
    const exes = named.filter((item) => /\.exe$/i.test(item.name));
    return exes.find((item) => /setup/i.test(item.name)) || exes[0] || null;
  }
  return null;
}

const WEB_LATEST_URL = `https://github.com/${UPDATE_REPO}/releases/latest`;

function versionFromTag(tag) {
  return decodeURIComponent(String(tag || '')).replace(/^v/i, '');
}

export function parseExpandedAssets(html) {
  const assets = [];
  const seen = new Set();
  const pattern = /href="([^"]*\/releases\/download\/[^"]+)"/g;
  for (const match of String(html || '').matchAll(pattern)) {
    const href = match[1];
    const name = decodeURIComponent(href.split('/').pop() || '');
    if (!/\.(dmg|exe|zip)$/i.test(name)) continue;
    const browser_download_url = href.startsWith('http') ? href : `https://github.com${href}`;
    if (seen.has(browser_download_url)) continue;
    seen.add(browser_download_url);
    assets.push({ name, browser_download_url });
  }
  return assets;
}

async function fetchFromApi(fetchImpl) {
  const response = await fetchImpl(RELEASES_LATEST_URL, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': '77-pet-app',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('检查更新失败（' + response.status + '）');
  const data = await response.json();
  const version = versionFromTag(data.tag_name);
  if (!version) return null;
  return {
    version,
    assets: Array.isArray(data.assets) ? data.assets : [],
    htmlUrl:
      typeof data.html_url === 'string' ? data.html_url : `https://github.com/${UPDATE_REPO}/releases/latest`,
  };
}

async function fetchFromWeb(fetchImpl) {
  const latest = await fetchImpl(WEB_LATEST_URL, {
    headers: { 'user-agent': '77-pet-app' },
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  if (latest.status === 404) return null;
  const location = latest.headers.get('location') || '';
  const tagMatch = /\/releases\/tag\/([^/?#]+)/.exec(location);
  if (!tagMatch) throw new Error('检查更新失败（' + latest.status + '）');
  const version = versionFromTag(tagMatch[1]);
  const page = await fetchImpl(`https://github.com/${UPDATE_REPO}/releases/expanded_assets/${tagMatch[1]}`, {
    headers: { 'user-agent': '77-pet-app', 'x-requested-with': 'XMLHttpRequest' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!page.ok) throw new Error('检查更新失败（' + page.status + '）');
  return {
    version,
    assets: parseExpandedAssets(await page.text()),
    htmlUrl: `https://github.com/${UPDATE_REPO}/releases/tag/${version}`,
  };
}

export async function fetchLatestRelease(fetchImpl = fetch) {
  try {
    return await fetchFromApi(fetchImpl);
  } catch (error) {
    try {
      const web = await fetchFromWeb(fetchImpl);
      if (web) return web;
    } catch {
      /* 页面也读不到时，沿用接口的错误 */
    }
    throw error;
  }
}

export async function downloadToFile(url, dest, { fetchImpl = fetch, onProgress } = {}) {
  const response = await fetchImpl(url, {
    headers: { 'user-agent': '77-pet-app', accept: 'application/octet-stream' },
    redirect: 'follow',
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!response.ok || !response.body) throw new Error('下载失败（' + response.status + '）');
  const total = Number(response.headers.get('content-length')) || 0;
  let received = 0;
  let reported = -1;
  const report = (percent) => {
    if (!onProgress || percent === reported) return;
    reported = percent;
    onProgress(percent);
  };
  const stream = Readable.from(
    (async function* () {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        received += value.byteLength;
        if (total > 0) report(Math.min(99, Math.round((received / total) * 100)));
        yield Buffer.from(value);
      }
    })(),
  );
  await pipeline(stream, createWriteStream(dest));
  report(100);
}
