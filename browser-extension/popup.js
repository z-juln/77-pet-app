const STORAGE_KEY = 'pet77WebSettings';
const DEFAULTS = {
  enabled: true,
  pack: 'blue-maid',
  scale: 1,
  opacity: 1,
  whisper: true,
  pausedHosts: [],
  position: null
};

const el = {
  enabled: document.getElementById('enabled'),
  siteToggle: document.getElementById('siteToggle'),
  pack: document.getElementById('pack'),
  scale: document.getElementById('scale'),
  scaleValue: document.getElementById('scaleValue'),
  opacity: document.getElementById('opacity'),
  opacityValue: document.getElementById('opacityValue'),
  whisper: document.getElementById('whisper'),
  say: document.getElementById('say'),
  home: document.getElementById('home'),
  status: document.getElementById('status')
};

let tab = null;
let host = '';
let pageReady = false;
let settings = { ...DEFAULTS };

function normalize(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: value.enabled !== false,
    pack: typeof value.pack === 'string' && value.pack ? value.pack : DEFAULTS.pack,
    scale: Number.isFinite(value.scale) ? Math.min(Math.max(value.scale, 0.6), 1.4) : 1,
    opacity: Number.isFinite(value.opacity) ? Math.min(Math.max(value.opacity, 0.3), 1) : 1,
    whisper: value.whisper !== false,
    pausedHosts: Array.isArray(value.pausedHosts)
      ? value.pausedHosts.filter((item) => typeof item === 'string')
      : [],
    position:
      value.position && Number.isFinite(value.position.rx) && Number.isFinite(value.position.ry)
        ? { rx: value.position.rx, ry: value.position.ry }
        : null
  };
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  settings = normalize(stored[STORAGE_KEY]);
}

async function saveSettings() {
  settings = normalize(settings);
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

async function ask(message) {
  if (!tab || !tab.id || !pageReady) return null;
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    pageReady = false;
    renderPageState();
    return null;
  }
}

async function candidateTabs() {
  const groups = await Promise.all([
    chrome.tabs.query({ active: true, currentWindow: true }),
    chrome.tabs.query({ active: true, lastFocusedWindow: true }),
    chrome.tabs.query({ active: true })
  ]);
  const seen = new Set();
  return groups
    .flat()
    .filter((item) => item && item.id !== undefined && /^https?:/i.test(item.url || ''))
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

async function statusOf(candidate) {
  try {
    const status = await chrome.tabs.sendMessage(candidate.id, { type: 'pet77:status' });
    return status && status.ok ? status : null;
  } catch {
    return null;
  }
}

async function findPetTab() {
  const candidates = await candidateTabs();
  for (const candidate of candidates) {
    const status = await statusOf(candidate);
    if (status) return { tab: candidate, status };
  }
  for (const candidate of candidates) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: candidate.id },
        files: ['content.js']
      });
    } catch {
      continue;
    }
    const status = await statusOf(candidate);
    if (status) return { tab: candidate, status };
  }
  return { tab: candidates[0] || null, status: null };
}

function renderPageState() {
  const paused = Boolean(host && settings.pausedHosts.includes(host));
  el.siteToggle.textContent = paused ? '恢复在此网站显示' : '在此网站隐藏';
  el.siteToggle.disabled = !pageReady || !host;
  el.say.disabled = !pageReady || paused || !settings.enabled;
  el.home.disabled = !pageReady || paused || !settings.enabled;
  el.status.textContent = pageReady
    ? paused
      ? '当前网站已隐藏桌宠'
      : ''
    : '当前页面不支持桌宠，或请在普通网页中打开';
}

function render() {
  el.enabled.checked = settings.enabled;
  el.whisper.checked = settings.whisper;
  el.scale.value = String(Math.round(settings.scale * 100));
  el.scaleValue.value = Math.round(settings.scale * 100) + '%';
  el.opacity.value = String(Math.round(settings.opacity * 100));
  el.opacityValue.value = Math.round(settings.opacity * 100) + '%';
  if (el.pack.options.length) el.pack.value = settings.pack;
  renderPageState();
}

async function loadPacks() {
  const response = await fetch(chrome.runtime.getURL('assets/pet/packs.json'));
  if (!response.ok) throw new Error('读取宠物列表失败');
  return response.json();
}

async function init() {
  await loadSettings();
  const target = await findPetTab();
  tab = target.tab;
  host = hostFromUrl(tab && tab.url ? tab.url : '');

  try {
    const packs = await loadPacks();
    el.pack.textContent = '';
    for (const pet of packs.pets || []) {
      const option = document.createElement('option');
      option.value = pet.id;
      option.textContent = pet.name || pet.id;
      el.pack.appendChild(option);
    }
    if (!el.pack.options.length) throw new Error('没有可用宠物');
    if (!Array.from(el.pack.options).some((option) => option.value === settings.pack)) {
      settings.pack = packs.default || el.pack.options[0].value;
    }
  } catch (error) {
    el.status.textContent = error instanceof Error ? error.message : String(error);
    el.pack.disabled = true;
  }

  const status = target.status;
  pageReady = Boolean(status && status.ok);
  if (status && status.pack) settings.pack = status.pack;
  render();
}

el.enabled.addEventListener('change', async () => {
  settings.enabled = el.enabled.checked;
  await saveSettings();
  render();
});

el.whisper.addEventListener('change', async () => {
  settings.whisper = el.whisper.checked;
  await saveSettings();
});

el.pack.addEventListener('change', async () => {
  settings.pack = el.pack.value;
  await saveSettings();
  const result = await ask({ type: 'pet77:switch-pack', pack: settings.pack });
  if (!result || !result.ok) el.status.textContent = '当前页面暂时没有响应';
});

el.scale.addEventListener('input', async () => {
  settings.scale = Number(el.scale.value) / 100;
  el.scaleValue.value = el.scale.value + '%';
  await saveSettings();
});

el.opacity.addEventListener('input', async () => {
  settings.opacity = Number(el.opacity.value) / 100;
  el.opacityValue.value = el.opacity.value + '%';
  await saveSettings();
});

el.siteToggle.addEventListener('click', async () => {
  if (!host) return;
  const paused = new Set(settings.pausedHosts);
  if (paused.has(host)) paused.delete(host);
  else paused.add(host);
  settings.pausedHosts = Array.from(paused);
  await saveSettings();
  render();
});

el.say.addEventListener('click', async () => {
  const result = await ask({ type: 'pet77:say' });
  el.status.textContent = result && result.ok ? '' : '当前页面暂时没有响应';
});

el.home.addEventListener('click', async () => {
  const result = await ask({ type: 'pet77:home' });
  el.status.textContent = result && result.ok ? '' : '当前页面暂时没有响应';
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STORAGE_KEY]) return;
  settings = normalize(changes[STORAGE_KEY].newValue);
  render();
});

init().catch((error) => {
  el.status.textContent = error instanceof Error ? error.message : String(error);
});
