#!/usr/bin/env node
/**
 * 生成各动画的 alpha 轮廓位图（用于窗口遮罩 = 逐像素命中测试）。
 *
 * 为什么要轮廓而不是包围盒：
 *   setWindowMask 同时决定「画什么」和「哪里能点到」。用包围盒时宠物周围那一圈
 *   透明空气仍然会拦截点击，桌面上就点不到宠物身后的图标。用真实 alpha 轮廓后，
 *   alpha=0 的像素既不可见、也不吃事件 —— 这就是所谓的 alpha 级点击穿透。
 *
 * 为什么离线算而不是运行时读 canvas：
 *   ArkWeb 里 <video> 来自 resource://rawfile，drawImage 后 canvas 被标记为
 *   cross-origin tainted，getImageData 直接抛 SecurityError。所以离线用 ffmpeg
 *   把整段动画的 alpha 并集算出来，落成 JSON 随包发布。
 *
 * 输出：alpha-masks.json
 *   { "idle.webm": { "w": 96, "h": 54, "rows": ["00ff..", ...] }, ... }
 *   每行是 w 位、按位展开成 hex（bit i 表示第 i 个像素是否不透明）。
 *
 * 用法：
 *   node gen-alpha-mask.mjs
 *   node gen-alpha-mask.mjs --pack ~/somewhere --out ./alpha-masks.json
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CANVAS_W = 640;
const CANVAS_H = 360;
/** 遮罩位图分辨率；窗口 384x216，取 1/4 做命中判定，每格约 4x4 屏幕像素 */
const MASK_W = 96;
const MASK_H = 54;
/** alpha 低于此值视为透明（VP9 编码噪声在 0~7 之间） */
const ALPHA_THRESHOLD = 24;
/** 采样帧率：越高并集越贴近真实轮廓，但越慢 */
const FPS = 8;

function parseArgs(argv) {
  const opts = {
    pack: join(
      process.env.HOME ?? '',
      'Desktop/workspace/77-pet-packs/pets/blue-maid/webm',
    ),
    out: join(process.cwd(), 'alpha-masks.json'),
  };
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    const value = argv[i + 1];
    if (key === 'pack') opts.pack = value;
    else if (key === 'out') opts.out = value;
    else throw new Error(`unknown option: ${argv[i]}`);
  }
  return opts;
}

/** 把一段 webm 的所有帧 alpha 求并集，缩到 MASK_W x MASK_H 的位图 */
function unionAlphaMask(webmPath) {
  // 直接缩放到遮罩分辨率再取 rgba，避免在 Node 里做 640x360 的全量缩放
  const buf = execFileSync(
    'ffmpeg',
    [
      '-v', 'error',
      '-c:v', 'libvpx-vp9',
      '-i', webmPath,
      '-vf', `fps=${FPS},scale=${MASK_W}:${MASK_H}:flags=area`,
      '-pix_fmt', 'rgba',
      '-f', 'rawvideo',
      '-',
    ],
    { maxBuffer: 1024 * 1024 * 256 },
  );

  const frameSize = MASK_W * MASK_H * 4;
  const frames = Math.floor(buf.length / frameSize);
  if (frames === 0) return null;

  // 并集：任意一帧不透明，该像素就不透明（防止动作幅度大的姿势被裁掉）
  const solid = new Uint8Array(MASK_W * MASK_H);
  for (let f = 0; f < frames; f++) {
    const base = f * frameSize;
    for (let p = 0; p < MASK_W * MASK_H; p++) {
      if (buf[base + p * 4 + 3] > ALPHA_THRESHOLD) solid[p] = 1;
    }
  }

  const rows = [];
  for (let y = 0; y < MASK_H; y++) {
    let hex = '';
    for (let x = 0; x < MASK_W; x += 4) {
      let nibble = 0;
      for (let b = 0; b < 4; b++) {
        if (solid[y * MASK_W + x + b]) nibble |= 1 << (3 - b);
      }
      hex += nibble.toString(16);
    }
    rows.push(hex);
  }
  return { w: MASK_W, h: MASK_H, rows };
}

const opts = parseArgs(process.argv);
const entries = readdirSync(opts.pack).filter((f) => f.endsWith('.webm')).sort();
if (entries.length === 0) {
  console.error(`no .webm found in ${opts.pack}`);
  process.exit(1);
}

const out = {};
let skipped = 0;
for (const file of entries) {
  try {
    const mask = unionAlphaMask(join(opts.pack, file));
    if (!mask) {
      skipped++;
      continue;
    }
    out[file] = mask;
    const solidCount = mask.rows.reduce(
      (n, r) => n + [...r].reduce((m, ch) => m + ch.split('').reduce((k, d) => k + (parseInt(d, 16) !== 0 ? 1 : 0), 0), 0),
      0,
    );
    console.error(`${file.padEnd(32)} ok`);
    void solidCount;
  } catch (e) {
    console.error(`${file.padEnd(32)} FAILED ${e.message}`);
    skipped++;
  }
}

writeFileSync(opts.out, JSON.stringify(out, null, 0));
const bytes = (await import('node:fs')).statSync(opts.out).size;
console.error(`\n${Object.keys(out).length} 段动画 → ${opts.out} (${(bytes / 1024).toFixed(0)} KB), 跳过 ${skipped}`);
