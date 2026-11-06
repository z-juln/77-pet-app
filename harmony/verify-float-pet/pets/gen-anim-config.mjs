#!/usr/bin/env node
/**
 * 从宠物包的 config.jsonc 生成鸿蒙侧可用的动画配置 anim-config.json。
 *
 * 为什么不直接抄 config.jsonc：
 *   1. 它是 JSONC（带注释），ArkTS 的 JSON.parse 读不了
 *   2. 鸿蒙侧只需要动画相关字段，人设/表情包/提示词都不需要
 *   3. 素材名要和 alpha-masks.json 的 key 对齐
 *
 * 输出结构：
 *   {
 *     "idle": [...], "turn": [...], "drag": [...], "clicks": [...],
 *     "moves": [{ "name": "...", "minDist": 60, "maxDist": 240, ... }],
 *     "categories": [{ "id": "小动作", "weight": 20, "noMirror": false, "actions": [...] }],
 *     "events": { "balance": [...], "whisper": [...], "workStatus": [...] },
 *     "weights": { "idle": 10, "turn": 5, "move": 5 },
 *     "physics": { "gravity": 1400, "restitution": 0.78, ... },
 *     "whisper": { "enabled": true, "intervalSec": 300,
 *                  "texts": { "<表情包名>": ["...", ...] },
 *                  "memes": ["<表情包名>", ...] }
 *   }
 *
 * 碎碎念文本来自 whisper-fallbacks.json（不调模型时的本地配文），键与 memes/ 下的
 * png 文件名一一对应 —— 抽到哪张图就用那张图那组文案，图文天然对得上。
 * 纯 ArkTS 环境没有 LLM 可用，所以直接走本地配文，不接模型。
 *
 * 用法：node gen-anim-config.mjs [--pack <dir>] [--out <file>]
 */

import { readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

function parseArgs(argv) {
  const opts = {
    pack: join(process.env.HOME ?? '', 'Desktop/workspace/77-pet-packs/pets/blue-maid'),
    out: '',
    copyWebm: '',
  };
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    const value = argv[i + 1];
    if (key === 'pack') opts.pack = value;
    else if (key === 'out') opts.out = value;
    else if (key === 'copy-webm') opts.copyWebm = value;
    else throw new Error(`unknown option: ${argv[i]}`);
  }
  return opts;
}

/** 去掉 JSONC 的注释（够用即可：整行 // 与尾随 //，字符串内的 // 需保护） */
function stripJsonc(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += c;
  }
  // 去掉尾随逗号
  return out.replace(/,(\s*[}\]])/g, '$1');
}

const opts = parseArgs(process.argv);
const cfgPath = join(opts.pack, 'config.jsonc');
const raw = readFileSync(cfgPath, 'utf8');
const cfg = JSON.parse(stripJsonc(raw));

const webmDir = join(opts.pack, 'webm');
const available = new Set(readdirSync(webmDir).filter((f) => f.endsWith('.webm')));

/** 把配置里的动画名（不含扩展名）补成带 .webm 的文件名；缺失的记下来告警 */
const missing = [];
function toFile(name) {
  const file = `${name}.webm`;
  if (!available.has(file)) missing.push(name);
  return file;
}

const anims = cfg.animations ?? {};
const movesDefault = anims.moves?.default ?? {};
const moves = (anims.moves?.actions ?? []).map((a) => ({
  name: toFile(a.name),
  minDist: a.params?.minDist ?? movesDefault.minDist,
  maxDist: a.params?.maxDist ?? movesDefault.maxDist,
  margin: a.params?.margin ?? movesDefault.margin,
  leadSec: a.params?.leadSec ?? movesDefault.leadSec,
  tailSec: a.params?.tailSec ?? movesDefault.tailSec,
}));

const out = {
  pack: basename(opts.pack),
  whisperPrompt: cfg.whisperPrompt ?? '',
  memeDescriptions: cfg.memes ?? {},
  idle: (anims.idle ?? []).map(toFile),
  turn: (anims.turn ?? []).map(toFile),
  drag: (anims.drag ?? []).map(toFile),
  clicks: (anims.clicks ?? []).map(toFile),
  moves,
  categories: (anims.categories ?? []).map((c) => ({
    id: c.id,
    weight: c.weight,
    noMirror: c.noMirror === true,
    actions: (c.actions ?? []).map(toFile),
  })),
  events: {
    balance: (anims.events?.balance ?? []).map((s) => toFile(s)),
    whisper: (anims.events?.whisper ?? []).map((s) => toFile(s)),
    workStatus: (anims.events?.workStatus ?? []).map((s) =>
      Array.isArray(s) ? s.map(toFile) : toFile(s),
    ),
  },
  weights: {
    idle: cfg.animationWeights?.idle ?? 10,
    turn: cfg.animationWeights?.turn ?? 5,
    move: cfg.animationWeights?.move ?? 5,
  },
  physics: {
    gravity: cfg.physics?.gravity ?? 1400,
    restitution: cfg.physics?.restitution ?? 0.78,
    groundFriction: cfg.physics?.groundFriction ?? 2.5,
    ceilingBounce: cfg.physics?.ceilingBounce !== false,
    throwPower: cfg.physics?.throwPower ?? 1,
  },
  whisper: buildWhisper(opts.pack, cfg),
};

/**
 * 碎碎念数据：文本（按表情包分组）+ 可用表情包列表 + 周期。
 *
 * 只保留「既有 png 又有文案」的条目 —— 缺图会图裂、缺文案会没话说，
 * 两者都不完整的直接剔掉比运行时报错好。
 */
function buildWhisper(packDir, cfg) {
  const memesDir = join(packDir, 'memes');
  let pngs = [];
  try {
    pngs = readdirSync(memesDir).filter((f) => f.endsWith('.png'));
  } catch {
    console.error('警告：找不到 memes 目录，碎碎念将不带图');
  }
  const haveImg = new Set(pngs.map((f) => basename(f, '.png')));

  let fallbacks = {};
  try {
    fallbacks = JSON.parse(readFileSync(join(packDir, 'whisper-fallbacks.json'), 'utf8'));
  } catch {
    console.error('警告：找不到 whisper-fallbacks.json，碎碎念将没有文本');
  }

  const keys = [...haveImg].filter((k) => Array.isArray(fallbacks[k]) && fallbacks[k].length > 0).sort();

  // 周期：宠物包 config 里的 eventsRefreshSec.whisper，缺省 300 秒（与 Electron 版兜底一致）
  const interval = cfg.eventsRefreshSec?.whisper;
  const intervalSec = typeof interval === 'number' && interval > 0 ? interval : 300;

  return {
    enabled: true,
    intervalSec,
    memes: keys,
    texts: Object.fromEntries(keys.map((k) => [k, fallbacks[k]])),
  };
}

if (missing.length) {
  console.error(`警告：config 引用了不存在的素材 ${missing.length} 个：`);
  console.error('  ' + missing.join(', '));
}

const outPath = opts.out || join(opts.pack, 'anim-config.json');
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.error(`→ ${outPath}`);

if (opts.copyWebm) {
  mkdirSync(opts.copyWebm, { recursive: true });
  let n = 0;
  for (const f of available) {
    copyFileSync(join(webmDir, f), join(opts.copyWebm, f));
    n++;
  }
  console.error(`→ 复制 ${n} 个 webm 到 ${opts.copyWebm}`);

  // 表情包：与 webm 同级放在 pet/memes/ 下。只复制配置里真正用到的（有文案的那些），
  // 没文案的图抽到了也没话说，不占体积。
  const memesOut = join(opts.copyWebm, '..', 'memes');
  mkdirSync(memesOut, { recursive: true });
  let m = 0;
  for (const key of out.whisper.memes) {
    const src = join(opts.pack, 'memes', `${key}.png`);
    try {
      copyFileSync(src, join(memesOut, `${key}.png`));
      m++;
    } catch {
      console.error(`警告：表情包缺失 ${key}.png`);
    }
  }
  console.error(`→ 复制 ${m} 张表情包到 ${memesOut}`);
}
