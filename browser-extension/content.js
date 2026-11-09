(() => {
  if (window.top !== window) return;
  const HOST_ID = '__pet77_browser_host__';
  if (document.getElementById(HOST_ID)) return;

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
  const BASE_W = 320;
  const BASE_H = 180;
  const DEFAULT_VISIBLE_BOUNDS = { left: 0.25, top: 0.12, right: 0.75, bottom: 1 };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let settings = { ...DEFAULTS };
  let packs = null;
  let boundsTable = null;
  let config = null;
  let currentName = '';
  let currentOnce = false;
  let facing = 'left';
  let front = 0;
  let started = false;
  let booting = null;
  let switchToken = 0;
  let squashToken = 0;
  let advanceTimer = 0;
  let whisperTimer = 0;
  let bubbleTimer = 0;
  let petW = BASE_W;
  let petH = BASE_H;
  let visibleBounds = { ...DEFAULT_VISIBLE_BOUNDS };
  let pos = { x: 0, y: 0 };
  let dragActive = false;
  let dragDown = null;
  let dragTarget = null;
  let dragFollowRef = 0;
  let dragFollowToken = 0;
  let dragVel = { x: 0, y: 0 };
  let trail = [];
  let longPressTimer = 0;
  let longPressFired = false;
  let throwRef = 0;
  let throwToken = 0;
  let roam = null;
  let roamRef = 0;
  let menuOpen = false;
  let lastPosSave = 0;
  let pendingPackId = '';

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host {
      all: initial;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    #stage {
      position: fixed;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
      font-family: 'PingFang SC', 'Microsoft YaHei', 'Yuanti SC', sans-serif;
      contain: layout style;
    }
    #pet {
      position: absolute;
      left: 0;
      top: 0;
      width: 320px;
      height: 180px;
      opacity: 1;
      pointer-events: none;
      will-change: transform, opacity;
      filter: drop-shadow(0 5px 9px rgba(0, 0, 0, 0.18));
    }
    video {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      opacity: 0;
      pointer-events: none;
      transition: opacity 55ms linear;
      transform-origin: bottom center;
    }
    video.active {
      opacity: 1;
    }
    video.flip {
      transform: scaleX(-1);
    }
    #hit {
      position: absolute;
      left: 25%;
      top: 12%;
      width: 50%;
      height: 88%;
      pointer-events: auto;
      cursor: grab;
      touch-action: none;
      border-radius: 38% 38% 22% 22%;
    }
    #pet.dragging #hit {
      cursor: grabbing;
    }
    #bubble {
      position: absolute;
      left: 50%;
      bottom: calc(100% - 4px);
      z-index: 5;
      display: none;
      flex-direction: column;
      align-items: center;
      width: max-content;
      max-width: 190px;
      padding: 9px 12px;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 13px;
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 5px 20px rgba(0, 0, 0, 0.18);
      color: #17191d;
      font-size: 13px;
      line-height: 1.5;
      text-align: center;
      white-space: normal;
      word-break: break-word;
      pointer-events: auto;
      cursor: pointer;
      transform: translateX(-50%);
    }
    #bubble.on {
      display: flex;
    }
    #bubble.below {
      top: calc(100% - 4px);
      bottom: auto;
    }
    #bubble::after {
      content: '';
      position: absolute;
      left: 50%;
      top: 100%;
      transform: translateX(-50%);
      border: 7px solid transparent;
      border-top-color: rgba(255, 255, 255, 0.98);
    }
    #bubble.below::after {
      top: auto;
      bottom: 100%;
      border-top-color: transparent;
      border-bottom-color: rgba(255, 255, 255, 0.98);
    }
    #bubble img {
      display: block;
      width: auto;
      max-width: 164px;
      max-height: 120px;
      margin: 0 0 7px;
      border-radius: 8px;
      object-fit: contain;
      pointer-events: none;
    }
    #bubble .text {
      display: block;
    }
    #menu {
      position: fixed;
      inset: 0;
      z-index: 8;
      display: none;
      pointer-events: none;
      font-size: 13px;
      color: #202124;
    }
    #menu.on {
      display: block;
    }
    #menu .menu-panel {
      position: fixed;
      display: none;
      min-width: 176px;
      max-height: calc(100vh - 16px);
      overflow-y: auto;
      padding: 6px;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.98);
      box-shadow: 0 9px 30px rgba(0, 0, 0, 0.2);
      pointer-events: auto;
    }
    #menu .menu-panel.on {
      display: block;
    }
    #menu button {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      min-height: 33px;
      padding: 0 10px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    #menu button:hover {
      background: #f0f3ff;
    }
    #menu button.active {
      color: #315de8;
      font-weight: 600;
    }
    #menu button.branch::after {
      content: '▸';
      margin-left: 12px;
      color: #9aa0a6;
      font-size: 12px;
      flex: none;
    }
    #menu .menu-panel hr {
      height: 1px;
      margin: 5px 4px;
      border: 0;
      background: #eceef3;
    }
    #menu .menu-panel .hint {
      padding: 5px 10px 7px;
      color: #8a9099;
      font-size: 11px;
    }
  `);
  shadow.adoptedStyleSheets = [sheet];
  shadow.innerHTML = `
    <div id="stage">
      <div id="pet">
        <video id="video-a" playsinline muted preload="auto"></video>
        <video id="video-b" playsinline muted preload="auto"></video>
        <div id="hit" title="拖动我；右键打开菜单"></div>
        <div id="bubble" role="status"><img alt="" hidden /><div class="text"></div></div>
      </div>
      <div id="menu" role="menu"></div>
    </div>
  `;

  const stage = shadow.getElementById('stage');
  const pet = shadow.getElementById('pet');
  const hit = shadow.getElementById('hit');
  const bubble = shadow.getElementById('bubble');
  const bubbleImg = bubble.querySelector('img');
  const bubbleText = bubble.querySelector('.text');
  const menu = shadow.getElementById('menu');
  const videos = [shadow.getElementById('video-a'), shadow.getElementById('video-b')];

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const pick = (pool, exclude) => {
    if (!Array.isArray(pool) || !pool.length) return null;
    const filtered = exclude ? pool.filter((item) => item !== exclude) : pool;
    const source = filtered.length ? filtered : pool;
    return source[Math.floor(Math.random() * source.length)];
  };
  const pickSlot = (slot, exclude) => {
    if (typeof slot === 'string') return slot;
    return pick(slot, exclude);
  };
  const slotIncludes = (slot, value) =>
    typeof slot === 'string' ? slot === value : Array.isArray(slot) && slot.includes(value);
  const poolIncludes = (pool, value) => (pool || []).some((slot) => slotIncludes(slot, value));
  const isEventAnim = (events, value) =>
    events ? Object.values(events).some((pool) => poolIncludes(pool, value)) : false;
  const extensionUrl = (path) =>
    chrome.runtime.getURL(path.split('/').map((part) => encodeURIComponent(part)).join('/'));
  const webmUrl = (name) => extensionUrl(`assets/pet/packs/${config.pack}/webm/${name}`);
  const memeUrl = (name) => extensionUrl(`assets/pet/packs/${config.pack}/memes/${name}.png`);

  function normalizeBounds(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    const bounds = {
      left: Number.isFinite(value.left) ? clamp(value.left, 0, 1) : DEFAULT_VISIBLE_BOUNDS.left,
      top: Number.isFinite(value.top) ? clamp(value.top, 0, 1) : DEFAULT_VISIBLE_BOUNDS.top,
      right: Number.isFinite(value.right) ? clamp(value.right, 0, 1) : DEFAULT_VISIBLE_BOUNDS.right,
      bottom: Number.isFinite(value.bottom)
        ? clamp(value.bottom, 0, 1)
        : DEFAULT_VISIBLE_BOUNDS.bottom
    };
    if (bounds.right - bounds.left < 0.05 || bounds.bottom - bounds.top < 0.05) {
      return { ...DEFAULT_VISIBLE_BOUNDS };
    }
    return bounds;
  }

  function normalizeSettings(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    return {
      enabled: value.enabled !== false,
      pack: typeof value.pack === 'string' && value.pack ? value.pack : DEFAULTS.pack,
      scale: Number.isFinite(value.scale) ? clamp(value.scale, 0.6, 1.4) : 1,
      opacity: Number.isFinite(value.opacity) ? clamp(value.opacity, 0.3, 1) : 1,
      whisper: value.whisper !== false,
      pausedHosts: Array.isArray(value.pausedHosts)
        ? value.pausedHosts.filter((item) => typeof item === 'string')
        : [],
      position:
        value.position && Number.isFinite(value.position.rx) && Number.isFinite(value.position.ry)
          ? { rx: clamp(value.position.rx, 0, 1), ry: clamp(value.position.ry, 0, 1) }
          : null
    };
  }

  const isPaused = () => settings.pausedHosts.includes(location.hostname);
  const isShown = () =>
    settings.enabled && !isPaused() && !document.hidden && !document.fullscreenElement;

  function viewportSize() {
    return {
      width: Math.max(1, document.documentElement.clientWidth || innerWidth),
      height: Math.max(1, document.documentElement.clientHeight || innerHeight)
    };
  }

  function bodyRect() {
    const left = visibleBounds.left * petW;
    const top = visibleBounds.top * petH;
    const right = visibleBounds.right * petW;
    const bottom = visibleBounds.bottom * petH;
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
      centerX: (left + right) / 2,
      centerY: (top + bottom) / 2
    };
  }

  function clampRange(value, min, max) {
    return max >= min ? clamp(value, min, max) : (min + max) / 2;
  }

  function offsetLimit() {
    const viewport = viewportSize();
    const body = bodyRect();
    return {
      minX: -body.left,
      maxX: viewport.width - body.right,
      minY: -body.top,
      maxY: viewport.height - body.bottom
    };
  }

  function clampPos(x, y) {
    const limit = offsetLimit();
    return {
      x: clampRange(x, limit.minX, limit.maxX),
      y: clampRange(y, limit.minY, limit.maxY)
    };
  }

  function setPos(x, y, persist = false) {
    pos = clampPos(x, y);
    pet.style.transform = `translate3d(${Math.round(pos.x)}px, ${Math.round(pos.y)}px, 0)`;
    placeBubble();
    if (persist) scheduleSavePosition();
  }

  function scheduleSavePosition() {
    const now = Date.now();
    if (now - lastPosSave < 300) return;
    lastPosSave = now;
    const limit = offsetLimit();
    const rangeX = limit.maxX - limit.minX;
    const rangeY = limit.maxY - limit.minY;
    settings.position = {
      rx: rangeX > 0 ? clamp((pos.x - limit.minX) / rangeX, 0, 1) : 0,
      ry: rangeY > 0 ? clamp((pos.y - limit.minY) / rangeY, 0, 1) : 0
    };
    chrome.storage.local.set({ [STORAGE_KEY]: settings }).catch(() => {});
  }

  function defaultPosition() {
    const limit = offsetLimit();
    return {
      x: limit.maxX - 24,
      y: limit.maxY - 16
    };
  }

  function restorePosition() {
    const limit = offsetLimit();
    if (settings.position) {
      setPos(
        limit.minX + settings.position.rx * (limit.maxX - limit.minX),
        limit.minY + settings.position.ry * (limit.maxY - limit.minY)
      );
    } else {
      const home = defaultPosition();
      setPos(home.x, home.y);
    }
  }

  function goHome() {
    stopRoam();
    stopThrow();
    stopDragFollow();
    const home = defaultPosition();
    setPos(home.x, home.y, true);
    if (config && !dragActive) playIdle();
    return true;
  }

  function resizePet(keepCenter = true) {
    const viewport = viewportSize();
    const previousW = petW;
    const previousH = petH;
    const previousBody = bodyRect();
    const centerX = pos.x + previousBody.centerX;
    const centerY = pos.y + previousBody.centerY;
    petW = Math.round(Math.min(BASE_W * settings.scale, Math.max(180, viewport.width * 0.65)));
    petH = Math.round(petW * (BASE_H / BASE_W));
    pet.style.width = petW + 'px';
    pet.style.height = petH + 'px';
    pet.style.opacity = String(settings.opacity);
    const nextBody = bodyRect();
    if (keepCenter) {
      setPos(centerX - nextBody.centerX, centerY - nextBody.centerY);
    }
    else setPos(pos.x, pos.y);
  }

  function applyFrameBounds(packId) {
    visibleBounds = normalizeBounds(boundsTable && boundsTable[packId]);
    const body = bodyRect();
    hit.style.left = `${visibleBounds.left * 100}%`;
    hit.style.top = `${visibleBounds.top * 100}%`;
    hit.style.width = `${(visibleBounds.right - visibleBounds.left) * 100}%`;
    hit.style.height = `${(visibleBounds.bottom - visibleBounds.top) * 100}%`;
    bubble.style.left = `${((body.left + body.right) / 2 / petW) * 100}%`;
  }

  function applyVisibility() {
    const shown = isShown();
    stage.style.display = shown ? 'block' : 'none';
    if (!shown) {
      videos.forEach((video) => video.pause());
      closeMenu();
      hideBubble();
    } else if (!started) {
      boot();
    } else {
      if (!currentName || !videos[front].getAttribute('src')) {
        switchTo(pick(config.idle), false);
        scheduleWhisper(true);
      } else {
        videos[front].play().catch(() => {});
      }
    }
  }

  function pickCategoryAction(exclude) {
    const categories = (config.categories || []).filter(
      (category) => Array.isArray(category.actions) && category.actions.length
    );
    if (!categories.length) return pick(config.idle, exclude);
    const filtered = categories.filter(
      (category) => !(category.noMirror && facing === 'right')
    );
    const eligible = filtered.length ? filtered : categories;
    const total = eligible.reduce((sum, category) => sum + (category.weight || 0), 0) || 1;
    let roll = Math.random() * total;
    for (const category of eligible) {
      roll -= category.weight || 0;
      if (roll <= 0) return pick(category.actions, exclude);
    }
    return pick(eligible[eligible.length - 1].actions, exclude);
  }

  function clearAdvance() {
    if (advanceTimer) {
      clearTimeout(advanceTimer);
      advanceTimer = 0;
    }
  }

  function waitForVideo(video, url, token) {
    if (video.src !== url) {
      video.src = url;
      video.load();
    }
    if (video.readyState >= 2) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        video.removeEventListener('loadeddata', finish);
        video.removeEventListener('error', finish);
        if (token === switchToken) resolve();
        else resolve();
      };
      video.addEventListener('loadeddata', finish, { once: true });
      video.addEventListener('error', finish, { once: true });
      setTimeout(finish, 900);
    });
  }

  async function switchTo(name, once) {
    if (!name || !config) return;
    const token = ++switchToken;
    const nextIndex = 1 - front;
    const next = videos[nextIndex];
    const previous = videos[front];
    const url = webmUrl(name);
    currentName = name;
    currentOnce = once === true;
    clearAdvance();
    next.loop = !currentOnce;
    await waitForVideo(next, url, token);
    if (token !== switchToken) return;
    try {
      next.currentTime = 0;
      await next.play();
    } catch (error) {
      console.warn('[77 Pet] video play failed', name, error);
    }
    next.classList.add('active');
    previous.classList.remove('active');
    front = nextIndex;
    applyFacing();
    if (currentOnce) {
      const duration = Number.isFinite(next.duration) && next.duration > 0 ? next.duration : 4;
      advanceTimer = setTimeout(() => {
        advanceTimer = 0;
        if (videos[front] === next) handleEnded();
      }, duration * 1000 + 180);
    } else {
      const duration = Number.isFinite(next.duration) && next.duration > 0 ? next.duration : 4;
      advanceTimer = setTimeout(() => {
        advanceTimer = 0;
        if (videos[front] === next) playIdle();
      }, Math.max(1200, duration * 900));
    }
  }

  function handleEnded() {
    if (!config || dragActive) return;
    if (roam) {
      const targetX = roam.targetX;
      stopRoam();
      setPos(targetX, pos.y, true);
    }
    if (poolIncludes(config.turn, currentName)) {
      facing = facing === 'left' ? 'right' : 'left';
      applyFacing();
    }
    if (
      isEventAnim(config.events, currentName) ||
      poolIncludes(config.drag, currentName) ||
      poolIncludes(config.clicks, currentName)
    ) {
      playIdle();
      return;
    }
    playIdle();
  }

  function applyFacing() {
    for (const video of videos) {
      video.classList.toggle('flip', facing === 'right');
    }
  }

  function playIdle() {
    if (!config || dragActive || throwRef || roam) return;
    const weights = config.weights || {};
    const roll = Math.random() * 100;
    const idleEnd = weights.idle || 0;
    const turnEnd = idleEnd + (weights.turn || 0);
    const moveEnd = turnEnd + (weights.move || 0);
    if (roll < idleEnd) {
      switchTo(pick(config.idle, currentName), false);
      return;
    }
    if (roll < turnEnd) {
      switchTo(pick(config.turn, currentName), true);
      return;
    }
    if (roll < moveEnd && startRoam()) return;
    switchTo(pickCategoryAction(currentName), true);
  }

  function startRoam(preferredName = '') {
    const moves = config.moves || [];
    if (!moves.length) return false;
    const move = preferredName
      ? moves.find((item) => item.name === preferredName)
      : moves[Math.floor(Math.random() * moves.length)];
    if (!move) return false;
    const limit = offsetLimit();
    const bias = facing === 'right' ? 1 : -1;
    const distance =
      (move.minDist + Math.random() * (move.maxDist - move.minDist)) *
      Math.max(0.6, petW / BASE_W);
    const margin = Math.max(10, (move.margin || 20) * Math.max(0.6, petW / BASE_W));
    const candidates = [bias, -bias].map((direction) => pos.x + direction * distance);
    const targetX = candidates.find(
      (value) => value >= limit.minX + margin && value <= limit.maxX - margin
    );
    if (targetX === undefined) return false;
    roam = {
      name: move.name,
      startX: pos.x,
      targetX,
      leadSec: move.leadSec || 0,
      tailSec: move.tailSec || 0,
      video: null
    };
    switchTo(move.name, true).then(() => {
      if (!roam || roam.name !== move.name || currentName !== move.name) return;
      roam.video = videos[front];
      driveRoam();
    });
    return true;
  }

  function driveRoam() {
    if (!roam || !roam.video) return;
    const video = roam.video;
    const duration =
      Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 4;
    const useful = Math.max(0.1, duration - roam.leadSec - roam.tailSec);
    const t = video.currentTime || 0;
    let x = roam.startX;
    if (t > roam.leadSec) {
      const progress = clamp((t - roam.leadSec) / useful, 0, 1);
      x = roam.startX + (roam.targetX - roam.startX) * progress;
    }
    setPos(x, pos.y);
    if (t >= duration - roam.tailSec) {
      setPos(roam.targetX, pos.y, true);
      roam = null;
      roamRef = 0;
      return;
    }
    roamRef = requestAnimationFrame(driveRoam);
  }

  function stopRoam() {
    roam = null;
    if (roamRef) {
      cancelAnimationFrame(roamRef);
      roamRef = 0;
    }
  }

  function showBubble(text, memeName) {
    if (!text) return;
    bubble.classList.remove('on', 'below');
    bubbleText.textContent = text;
    if (memeName) {
      bubbleImg.hidden = false;
      bubbleImg.alt = memeName;
      bubbleImg.src = memeUrl(memeName);
      bubbleImg.onerror = () => {
        bubbleImg.hidden = true;
        bubbleImg.removeAttribute('src');
        requestAnimationFrame(placeBubble);
      };
    } else {
      bubbleImg.hidden = true;
      bubbleImg.removeAttribute('src');
    }
    bubble.classList.add('on');
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hideBubble, Math.min(12000, 6000 + text.length * 180));
    requestAnimationFrame(placeBubble);
  }

  function placeBubble() {
    if (!bubble.classList.contains('on')) return;
    const body = bodyRect();
    const topSpace = pos.y + body.top;
    const bottomSpace = viewportSize().height - (pos.y + body.bottom);
    bubble.classList.toggle('below', topSpace < 130 && bottomSpace > 130);
  }

  function hideBubble() {
    bubble.classList.remove('on', 'below');
    if (bubbleTimer) {
      clearTimeout(bubbleTimer);
      bubbleTimer = 0;
    }
  }

  function whisper(force = false) {
    if (!config || !config.whisper) return false;
    if (!force && (!settings.whisper || dragActive || !isShown())) return false;
    const source = config.whisper;
    const memes = Array.isArray(source.memes) ? source.memes : [];
    if (!memes.length) return false;
    const meme = memes[Math.floor(Math.random() * memes.length)];
    const lines = source.texts && source.texts[meme];
    if (!Array.isArray(lines) || !lines.length) return false;
    const text = lines[Math.floor(Math.random() * lines.length)];
    showBubble(text, meme);
    if (config.events.whisper && config.events.whisper.length) {
      switchTo(pick(config.events.whisper, currentName), true);
    }
    return true;
  }

  function scheduleWhisper(first = false) {
    if (whisperTimer) {
      clearTimeout(whisperTimer);
      whisperTimer = 0;
    }
    if (!settings.whisper || !config || !config.whisper || !config.whisper.enabled) return;
    const configured = Math.max(60, config.whisper.intervalSec || 300);
    const wait = first
      ? 9000 + Math.random() * 5000
      : configured * 1000 * (0.85 + Math.random() * 0.3);
    whisperTimer = setTimeout(() => {
      whisperTimer = 0;
      whisper(false);
      scheduleWhisper(false);
    }, wait);
  }

  function squash(depth) {
    if (reducedMotion) return;
    const video = videos[front];
    if (!video) return;
    const start = performance.now();
    const token = ++squashToken;
    const step = (now) => {
      if (token !== squashToken || videos[front] !== video) return;
      const progress = Math.min((now - start) / 240, 1);
      let scale;
      if (progress < 0.42) {
        scale = 1 - (1 - depth) * (progress / 0.42) ** 2;
      } else {
        const p = (progress - 0.42) / 0.58;
        const c1 = 1.70158;
        const c3 = c1 + 1;
        scale = depth + (1 - depth) * (1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2);
      }
      const flip = facing === 'right' ? ' scaleX(-1)' : '';
      video.style.transform = `scaleY(${scale})${flip}`;
      if (progress < 1) requestAnimationFrame(step);
      else video.style.transform = '';
    };
    requestAnimationFrame(step);
  }

  function clickPet() {
    if (!config || dragActive) return;
    stopRoam();
    const name = pick(config.clicks, currentName);
    if (!name) return;
    switchTo(name, true).then(() => squash(0.56));
  }

  function playAction(name) {
    if (!config || !name || dragActive) return;
    stopRoam();
    stopThrow();
    stopDragFollow();
    hideBubble();
    const noMirror = (config.categories || []).some(
      (category) =>
        category.noMirror === true &&
        Array.isArray(category.actions) &&
        category.actions.includes(name)
    );
    if (noMirror && facing === 'right') {
      facing = 'left';
      applyFacing();
    }
    if ((config.moves || []).some((move) => move.name === name) && startRoam(name)) return;
    switchTo(name, true);
  }

  function trimTrail(now) {
    const cutoff = now - 180;
    trail = trail.filter((sample) => sample.t >= cutoff);
  }

  function releaseVelocity() {
    trimTrail(performance.now());
    if (trail.length < 2) return null;
    const first = trail[0];
    const last = trail[trail.length - 1];
    const span = last.t - first.t;
    if (span < 24) return null;
    const vx = ((last.x - first.x) / span) * 1000;
    const vy = ((last.y - first.y) / span) * 1000;
    const speed = Math.hypot(vx, vy);
    if (speed < 480) return null;
    const scale = Math.min(1, 2200 / speed);
    return { vx: vx * scale, vy: vy * scale };
  }

  const SPRING_K = 650;
  const SPRING_C = 52;
  function springStep(velocity, current, target, dt) {
    return velocity + ((target - current) * SPRING_K - velocity * SPRING_C) * dt;
  }

  function startDragFollow() {
    if (dragFollowRef) return;
    const token = ++dragFollowToken;
    let last = performance.now();
    const step = (now) => {
      if (token !== dragFollowToken) return;
      if (!dragTarget) {
        dragFollowRef = 0;
        return;
      }
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      dragVel.x = springStep(dragVel.x, pos.x, dragTarget.x, dt);
      dragVel.y = springStep(dragVel.y, pos.y, dragTarget.y, dt);
      setPos(pos.x + dragVel.x * dt, pos.y + dragVel.y * dt);
      dragFollowRef = requestAnimationFrame(step);
    };
    dragFollowRef = requestAnimationFrame(step);
  }

  function stopDragFollow() {
    dragFollowToken++;
    if (dragFollowRef) {
      cancelAnimationFrame(dragFollowRef);
      dragFollowRef = 0;
    }
    dragTarget = null;
    dragVel = { x: 0, y: 0 };
  }

  function stopThrow() {
    throwToken++;
    if (throwRef) {
      cancelAnimationFrame(throwRef);
      throwRef = 0;
    }
  }

  function startThrow(vx, vy) {
    stopThrow();
    stopRoam();
    const token = ++throwToken;
    let velocityX = vx;
    let velocityY = vy;
    let last = performance.now();
    const step = (now) => {
      if (token !== throwToken) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      velocityY += 1400 * dt;
      let nextX = pos.x + velocityX * dt;
      let nextY = pos.y + velocityY * dt;
      const limit = offsetLimit();
      let bounced = false;
      if (nextX < limit.minX) {
        nextX = limit.minX;
        velocityX = Math.abs(velocityX) * 0.72;
        bounced = true;
      } else if (nextX > limit.maxX) {
        nextX = limit.maxX;
        velocityX = -Math.abs(velocityX) * 0.72;
        bounced = true;
      }
      if (nextY < limit.minY) {
        nextY = limit.minY;
        velocityY = Math.abs(velocityY) * 0.72;
        bounced = true;
      } else if (nextY >= limit.maxY) {
        nextY = limit.maxY;
        velocityX *= Math.max(0, 1 - 2.7 * dt);
        velocityY = Math.abs(velocityY) < 60 ? 0 : -Math.abs(velocityY) * 0.72;
        bounced = true;
      }
      setPos(nextX, nextY);
      const atRest =
        nextY >= limit.maxY - 1 && Math.abs(velocityY) < 1 && Math.abs(velocityX) < 12;
      if (atRest) {
        throwRef = 0;
        setPos(nextX, nextY, true);
        playIdle();
        return;
      }
      if (bounced && Math.hypot(velocityX, velocityY) < 50) {
        throwRef = 0;
        setPos(nextX, nextY, true);
        playIdle();
        return;
      }
      throwRef = requestAnimationFrame(step);
    };
    throwRef = requestAnimationFrame(step);
  }

  function endDrag() {
    dragActive = false;
    pet.classList.remove('dragging');
    const finalTarget = dragTarget;
    stopDragFollow();
    const velocity = releaseVelocity();
    trail = [];
    if (longPressFired) {
      longPressFired = false;
      return;
    }
    if (velocity) {
      startThrow(velocity.vx, velocity.vy);
    } else {
      if (finalTarget) setPos(finalTarget.x, finalTarget.y);
      scheduleSavePosition();
      playIdle();
    }
  }

  function actionLabel(name) {
    return String(name).replace(/\.webm$/i, '');
  }

  function actionGroups() {
    if (!config) return [];
    const groups = [];
    const addGroup = (label, pool) => {
      const names = [...new Set((pool || []).filter((name) => typeof name === 'string' && name))];
      if (!names.length) return;
      groups.push({
        label,
        children: names.map((name) => ({
          label: actionLabel(name),
          onSelect: () => playAction(name)
        }))
      });
    };
    addGroup('待机', config.idle);
    addGroup('转向', config.turn);
    addGroup('拖拽', config.drag);
    addGroup('点击回应', config.clicks);
    addGroup('移动', (config.moves || []).map((move) => move.name));
    for (const category of config.categories || []) {
      addGroup(category.id, category.actions);
    }
    const eventLabels = { balance: '余额档位', whisper: '碎碎念', workStatus: '工作状态' };
    for (const key of Object.keys(config.events || {})) {
      const names = [];
      for (const slot of config.events[key] || []) {
        if (Array.isArray(slot)) names.push(...slot);
        else if (typeof slot === 'string') names.push(slot);
      }
      addGroup(eventLabels[key] || key, names);
    }
    return groups;
  }

  function buildMenu() {
    if (!packs || !config) return null;
    menu.textContent = '';
    const openChild = new WeakMap();

    const hideSubtree = (panel) => {
      panel.classList.remove('on');
      const child = openChild.get(panel);
      if (child) {
        hideSubtree(child);
        openChild.delete(panel);
      }
    };

    const hideChildren = (panel) => {
      const child = openChild.get(panel);
      if (!child) return;
      hideSubtree(child);
      openChild.delete(panel);
    };

    const placePanel = (panel, anchor) => {
      const viewport = viewportSize();
      const anchorRect = anchor.getBoundingClientRect();
      const rect = panel.getBoundingClientRect();
      let left = anchorRect.right + 4;
      if (left + rect.width > viewport.width - 8) {
        left = anchorRect.left - rect.width - 4;
      }
      left = clamp(left, 8, Math.max(8, viewport.width - rect.width - 8));
      let top = anchorRect.top;
      if (top + rect.height > viewport.height - 8) {
        top = viewport.height - rect.height - 8;
      }
      top = clamp(top, 8, Math.max(8, viewport.height - rect.height - 8));
      panel.style.left = Math.round(left) + 'px';
      panel.style.top = Math.round(top) + 'px';
    };

    const showBranch = (panel, item, child) => {
      const previous = openChild.get(panel);
      if (previous && previous !== child) hideSubtree(previous);
      openChild.set(panel, child);
      child.classList.add('on');
      placePanel(child, item);
    };

    const buildPanel = (nodes) => {
      const panel = document.createElement('div');
      panel.className = 'menu-panel';
      menu.appendChild(panel);
      for (const node of nodes) {
        if (!node) continue;
        if (node.kind === 'divider') {
          panel.appendChild(document.createElement('hr'));
          continue;
        }
        if (node.kind === 'hint') {
          const hint = document.createElement('div');
          hint.className = 'hint';
          hint.textContent = node.text;
          panel.appendChild(hint);
          continue;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = node.label;
        if (node.active) button.classList.add('active');
        if (node.children && node.children.length) {
          button.classList.add('branch');
          const child = buildPanel(node.children);
          button.addEventListener('mouseenter', () => showBranch(panel, button, child));
          button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (child.classList.contains('on')) hideChildren(panel);
            else showBranch(panel, button, child);
          });
        } else {
          button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            closeMenu();
            if (node.onSelect) node.onSelect();
          });
        }
        panel.appendChild(button);
      }
      return panel;
    };

    const petNodes = [
      { kind: 'divider' },
      { kind: 'hint', text: '切换宠物' },
      ...(packs.pets || []).map((item) => ({
        label: item.name || item.id,
        active: item.id === config.pack,
        onSelect: () => changePack(item.id)
      }))
    ];
    const groups = actionGroups();
    const nodes = [
      { label: '陪我玩一会', onSelect: () => clickPet() },
      { label: '碎碎念', onSelect: () => whisper(true) },
      ...petNodes,
      ...(groups.length ? [{ kind: 'divider' }, { label: '动作', children: groups }] : []),
      { kind: 'divider' },
      { label: '回右下角', onSelect: () => goHome() },
      { label: '在此网站隐藏', onSelect: () => pauseSite() }
    ];
    const rootPanel = buildPanel(nodes);
    return rootPanel;
  }

  function openMenu(x, y) {
    if (!config) return;
    const rootPanel = buildMenu();
    if (!rootPanel) return;
    menu.classList.add('on');
    rootPanel.classList.add('on');
    menuOpen = true;
    const viewport = viewportSize();
    const rect = rootPanel.getBoundingClientRect();
    const left = clamp(x, 8, Math.max(8, viewport.width - rect.width - 8));
    const top = clamp(y, 8, Math.max(8, viewport.height - rect.height - 8));
    rootPanel.style.left = Math.round(left) + 'px';
    rootPanel.style.top = Math.round(top) + 'px';
  }

  function closeMenu() {
    menu.classList.remove('on');
    menuOpen = false;
  }

  async function pauseSite() {
    const paused = new Set(settings.pausedHosts);
    paused.add(location.hostname);
    settings.pausedHosts = Array.from(paused);
    await chrome.storage.local.set({ [STORAGE_KEY]: settings });
  }

  function changePack(packId) {
    if (!packId || (config && config.pack === packId)) return;
    settings.pack = packId;
    chrome.storage.local.set({ [STORAGE_KEY]: settings }).catch(() => {});
    switchPack(packId);
  }

  function onPointerDown(event) {
    if (event.button !== 0 || !config || !isShown()) return;
    event.preventDefault();
    closeMenu();
    hideBubble();
    dragActive = true;
    longPressFired = false;
    pet.classList.add('dragging');
    stopRoam();
    stopThrow();
    stopDragFollow();
    trail = [];
    dragDown = {
      pointerId: event.pointerId,
      sx: event.clientX,
      sy: event.clientY,
      px: pos.x,
      py: pos.y,
      startedAt: performance.now(),
      moved: 0
    };
    if (config.drag && config.drag.length) switchTo(config.drag[0], false);
    hit.setPointerCapture(event.pointerId);
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      longPressTimer = 0;
      if (!dragActive || !dragDown || dragDown.moved > 6) return;
      longPressFired = true;
      dragActive = false;
      stopDragFollow();
      pet.classList.remove('dragging');
      openMenu(dragDown.sx, dragDown.sy);
    }, 560);
  }

  function onPointerMove(event) {
    if (!dragActive || !dragDown || event.pointerId !== dragDown.pointerId) return;
    const dx = event.clientX - dragDown.sx;
    const dy = event.clientY - dragDown.sy;
    dragDown.moved = Math.max(dragDown.moved, Math.hypot(dx, dy));
    if (dragDown.moved > 6 && longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = 0;
    }
    trail.push({ t: performance.now(), x: event.clientX, y: event.clientY });
    trimTrail(performance.now());
    dragTarget = clampPos(dragDown.px + dx, dragDown.py + dy);
    startDragFollow();
  }

  function onPointerUp(event) {
    if (!dragDown || event.pointerId !== dragDown.pointerId) return;
    const wasClick =
      !longPressFired &&
      dragDown.moved <= 6 &&
      performance.now() - dragDown.startedAt < 500;
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = 0;
    }
    if (hit.hasPointerCapture(event.pointerId)) hit.releasePointerCapture(event.pointerId);
    dragDown = null;
    if (wasClick) {
      dragActive = false;
      pet.classList.remove('dragging');
      stopDragFollow();
      clickPet();
    } else {
      endDrag();
    }
  }

  async function loadPacks() {
    const response = await fetch(extensionUrl('assets/pet/packs.json'));
    if (!response.ok) throw new Error('读取宠物列表失败');
    return response.json();
  }

  async function loadFrameBounds() {
    try {
      const response = await fetch(extensionUrl('assets/pet/frame-bounds.json'));
      if (!response.ok) return {};
      return await response.json();
    } catch (error) {
      return {};
    }
  }

  async function loadPack(packId) {
    const response = await fetch(
      extensionUrl(`assets/pet/packs/${packId}/anim-config.json`)
    );
    if (!response.ok) throw new Error('读取宠物配置失败');
    return response.json();
  }

  async function boot() {
    if (booting) return booting;
    booting = (async () => {
      packs = packs || (await loadPacks());
      boundsTable = boundsTable || (await loadFrameBounds());
      const available = new Set((packs.pets || []).map((item) => item.id));
      if (!available.has(settings.pack)) settings.pack = packs.default || 'blue-maid';
      config = await loadPack(settings.pack);
      applyFrameBounds(settings.pack);
      resizePet(false);
      restorePosition();
      started = true;
      applyVisibility();
      if (isShown()) {
        switchTo(pick(config.idle), false);
        scheduleWhisper(true);
      }
    })().catch((error) => {
      console.warn('[77 Pet] boot failed', error);
      booting = null;
    });
    return booting;
  }

  async function switchPack(packId) {
    if (!packs || !packId) return;
    if (config && config.pack === packId && started) {
      settings.pack = packId;
      return;
    }
    if (pendingPackId === packId) return;
    pendingPackId = packId;
    settings.pack = packId;
    try {
      const next = await loadPack(packId);
      if (pendingPackId !== packId) return;
      stopRoam();
      stopThrow();
      stopDragFollow();
      clearAdvance();
      hideBubble();
      if (whisperTimer) {
        clearTimeout(whisperTimer);
        whisperTimer = 0;
      }
      videos.forEach((video) => {
        video.pause();
        video.classList.remove('active');
        video.removeAttribute('src');
        video.load();
      });
      front = 0;
      currentName = '';
      config = next;
      applyFrameBounds(packId);
      resizePet(true);
      if (isShown()) {
        switchTo(pick(config.idle), false);
        scheduleWhisper(true);
      }
    } catch (error) {
      console.warn('[77 Pet] switch pack failed', packId, error);
    } finally {
      if (pendingPackId === packId) pendingPackId = '';
    }
  }

  function applySettings(nextRaw, previousRaw) {
    const next = normalizeSettings(nextRaw);
    const previous = normalizeSettings(previousRaw);
    settings = next;
    resizePet(true);
    applyVisibility();
    const activePack = config && config.pack ? config.pack : previous.pack;
    if (next.pack !== activePack && started) {
      switchPack(next.pack);
      return;
    }
    if (next.whisper !== previous.whisper) {
      if (!next.whisper) hideBubble();
      scheduleWhisper(true);
    }
    if (isShown() && started && !videos[front].paused) videos[front].play().catch(() => {});
  }

  hit.addEventListener('pointerdown', onPointerDown);
  hit.addEventListener('pointermove', onPointerMove);
  hit.addEventListener('pointerup', onPointerUp);
  hit.addEventListener('pointercancel', onPointerUp);
  hit.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    dragActive = false;
    stopDragFollow();
    pet.classList.remove('dragging');
    openMenu(event.clientX, event.clientY);
  });
  bubble.addEventListener('click', (event) => {
    event.stopPropagation();
    hideBubble();
  });
  window.addEventListener('pointerdown', (event) => {
    if (!menuOpen) return;
    if (!event.composedPath().includes(host)) closeMenu();
  }, true);
  window.addEventListener('resize', () => {
    resizePet(true);
    if (roam) stopRoam();
  });
  document.addEventListener('fullscreenchange', applyVisibility);
  document.addEventListener('visibilitychange', applyVisibility);
  window.addEventListener('pagehide', () => {
    videos.forEach((video) => video.pause());
  });

  for (const video of videos) {
    video.addEventListener('ended', () => {
      if (video === videos[front]) handleEnded();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    const previous = settings;
    applySettings(changes[STORAGE_KEY].newValue, previous);
    if (!started && isShown()) boot();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'pet77:status') {
      sendResponse({
        ok: true,
        pack: config ? config.pack : settings.pack,
        enabled: settings.enabled,
        paused: isPaused()
      });
      return;
    }
    if (message.type === 'pet77:say') {
      sendResponse({ ok: whisper(true) });
      return;
    }
    if (message.type === 'pet77:home') {
      sendResponse({ ok: goHome() });
      return;
    }
    if (message.type === 'pet77:switch-pack') {
      if (!packs || !message.pack) {
        sendResponse({ ok: false });
        return;
      }
      changePack(String(message.pack));
      sendResponse({ ok: true });
    }
  });

  chrome.storage.local
    .get(STORAGE_KEY)
    .then((stored) => {
      settings = normalizeSettings(stored[STORAGE_KEY]);
      resizePet(false);
      restorePosition();
      applyVisibility();
      if (isShown()) boot();
    })
    .catch((error) => console.warn('[77 Pet] storage failed', error));
})();
