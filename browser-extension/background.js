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

async function injectPet(tabId) {
  if (!Number.isInteger(tabId)) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
  } catch {
    // chrome://、扩展商店和部分受保护页面不允许注入。
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (!stored[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULTS });
  }
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((tab) => (tab.id === undefined ? undefined : injectPet(tab.id)))
  );
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') injectPet(tabId);
});
