import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN = 0x7700;
const TAG = 'Pet77';

/** 遮罩位图分辨率：源画布 640x360 的 1/6，每格约 4x4 窗口像素 */
const MASK_W = 96;
const MASK_H = 54;

/** 视频画布宽度（源 640x360 按 0.6 缩放） */
export const WIN_W = 384;
/** 视频画布高度 */
export const VIDEO_H = 216;
/**
 * 头顶气泡区高度：窗口 = 视频 + 这一块。
 * 气泡里放一张表情包 + 两行以内文字，180 够用且留了箭头和上下间距。
 */
export const WIN_PAD_TOP = 180;
/** 窗口高度 = 视频 + 气泡区 */
export const WIN_H = VIDEO_H + WIN_PAD_TOP;

/**
 * 点击区窗口相对宠物窗口的位置和尺寸（逻辑坐标）。
 *
 * 只覆盖中间 240 宽的一条：宠物身体和头顶气泡都在里面，左右各 72 让给桌面。
 * 这块窗口是普通透明窗，不设窗口形状，所以不会引发整屏重合成。
 */
export const HIT_X = 72;
export const HIT_Y = 0;
export const HIT_W = 240;
export const HIT_H = WIN_H;

/** 一段动画的轮廓位图：rows[y] 是长度 MASK_W/4 的 hex，每位 1 表示不透明 */
export interface AlphaMask {
  w: number;
  h: number;
  rows: Array<string>;
}

/** 气泡矩形（窗口坐标，原点在窗口左上角）：用于把气泡区也纳入遮罩 */
export interface BubbleRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class PetBridge {
  /** 最新上报的动画名，由 EntryAbility 取走并换算成遮罩 */
  static pending: string | null = null;
  /** 已经应用过的动画名，避免重复设置遮罩 */
  static applied: string = '';
  /** 页面是否已完成配置加载 */
  static pageReady: boolean = false;
  /** 页面请求的窗口坐标 [x, y]；由 FloatPet 的轮询消费 */
  static pendingMove: Array<number> | null = null;
  /**
   * 当前气泡在窗口内的矩形（null = 没显示）。
   *
   * 为什么要报给 ArkTS：setWindowMask 同时决定「画哪里」和「哪里能点到」——
   * 气泡画在宠物头顶的窗口区域内，但那里不在身体轮廓里，不并进遮罩就会被裁掉。
   * 页面侧拿 DOM 实测宽高最准，所以由页面量完上报，ArkTS 只负责合成。
   */
  static bubbleRect: BubbleRect | null = null;
  /** 已应用的遮罩签名，避免同一组（动画 + 气泡）反复重设 */
  static maskKey: string = '';
  /**
   * 页面到点要一句碎碎念。true = 用户手动触发（忽略自动开关），false = 定时触发。
   * 网络请求放在 ArkTS 侧做，页面只负责显示结果。
   */
  static whisperRequested: boolean | null = null;

  /** 页面切换动画时上报素材文件名 */
  reportMotion(name: string): void {
    if (name && name.length > 0) {
      PetBridge.pending = name;
    }
  }

  /** 页面完成启动（配置已加载、首帧已播） */
  ready(count: number): void {
    PetBridge.pageReady = true;
    hilog.info(DOMAIN, TAG, 'pet page ready, motions=%{public}d', count);
  }

  /** 页面请求窗口移动到某处；漫游时每帧上报一次，由 ArkTS 侧节流消费 */
  requestMove(x: number, y: number): void {
    PetBridge.pendingMove = [x, y];
  }

  /**
   * 页面上报气泡矩形（窗口坐标）；空参数表示气泡收起了。
   *
   * 气泡显隐或尺寸变化都会调一次，点击时用它判断「点气泡收起」还是
   * 「点宠物回应」。窗口形状不跟随气泡变化。
   */
  reportBubble(x: number, y: number, w: number, h: number): void {
    if (w <= 0 || h <= 0) {
      PetBridge.bubbleRect = null;
    } else {
      PetBridge.bubbleRect = { x: x, y: y, w: w, h: h };
    }
    // 气泡区已经固定包含在遮罩顶部，显隐时不再改动窗口形状，避免整屏闪黑。
    hilog.info(DOMAIN, TAG, 'bubble rect %{public}d,%{public}d %{public}dx%{public}d',
      Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  /** 页面请求生成一句碎碎念；ArkTS 侧决定走模型还是本地文案 */
  requestWhisper(force: boolean): void {
    PetBridge.whisperRequested = force === true;
    hilog.info(DOMAIN, TAG, 'whisper requested, force=%{public}s', JSON.stringify(force));
  }

  /** 事件动画播完（余额/碎碎念），后续由 ArkTS 决定是否续播 */
  onEventEnd(name: string): void {
    hilog.info(DOMAIN, TAG, 'event anim ended: %{public}s', name);
  }
}

/**
 * 把轮廓位图放大成窗口遮罩，并把气泡矩形一起并进来。
 *
 * 源画布 640x360 → 视频区 384x216 是等比缩放，所以遮罩位图的每个格子直接覆盖
 * 一块矩形视频像素，逐格填充即可。为了不让边缘看起来被啃掉、也让细小的
 * 手指/发梢不至于点不到，这里做一次「膨胀」：格子不透明时，向外扩一圈。
 *
 * 视频画在窗口**底部**（顶部 WIN_PAD_TOP 是气泡区），所以视频轮廓整体下移
 * WIN_PAD_TOP 再合成；气泡自身是实心矩形，直接叠加在顶部区域。
 */
export function buildMaskFromAlpha(
  mask: AlphaMask | null,
  bubble: BubbleRect | null,
  outW: number = WIN_W,
  outH: number = WIN_H
): Array<Array<number>> {
  const targetW = Math.max(1, Math.round(outW));
  const targetH = Math.max(1, Math.round(outH));
  const out: Array<Array<number>> = [];
  // 先全部置零，再逐块点亮
  for (let y = 0; y < targetH; y++) {
    const row: Array<number> = [];
    for (let x = 0; x < targetW; x++) {
      row.push(0);
    }
    out.push(row);
  }

  if (!mask || mask.rows.length !== MASK_H) {
    // 拿不到轮廓时退化成保守的中间区域，至少不把宠物本身裁掉
    const x0 = Math.floor(targetW * 0.25);
    const x1 = Math.ceil(targetW * 0.75);
    const y0 = Math.floor(targetH - VIDEO_H * targetH / WIN_H);
    for (let y = Math.max(0, y0); y < targetH; y++) {
      for (let x = x0; x < x1; x++) {
        out[y][x] = 1;
      }
    }
    applyBubble(out, bubble, targetW, targetH);
    return out;
  }

  // 先解出 96x54 的布尔位图
  const solid: Array<Array<boolean>> = [];
  for (let y = 0; y < MASK_H; y++) {
    const line: Array<boolean> = [];
    const hex = mask.rows[y];
    for (let x = 0; x < MASK_W; x++) {
      const digit = parseInt(hex.charAt(x >> 2), 16);
      line.push(((digit >> (3 - (x & 3))) & 1) === 1);
    }
    solid.push(line);
  }

  // 膨胀一格：把宠物边缘的透明缝隙补上，避免轮廓被吃得坑坑洼洼
  const grown: Array<Array<boolean>> = [];
  for (let y = 0; y < MASK_H; y++) {
    const line: Array<boolean> = [];
    for (let x = 0; x < MASK_W; x++) {
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (let dx = -1; dx <= 1 && !hit; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny < 0 || ny >= MASK_H || nx < 0 || nx >= MASK_W) {
            continue;
          }
          if (solid[ny][nx]) {
            hit = true;
          }
        }
      }
      line.push(hit);
    }
    grown.push(line);
  }

  // 版面坐标固定为 384x396（视频在下、气泡在上），输出时再按当前窗口物理尺寸缩放。
  // 不能直接按 384x396 生成：设置里放大宠物后窗口会变，遮罩尺寸不匹配会被系统拒绝，
  // 表现为宠物突然消失或点击不再命中。
  for (let y = 0; y < targetH; y++) {
    const logicalY = y * WIN_H / targetH;
    if (logicalY < WIN_PAD_TOP) {
      continue;
    }
    const videoY = Math.max(0, logicalY - WIN_PAD_TOP);
    const my = Math.min(MASK_H - 1, Math.floor(videoY / VIDEO_H * MASK_H));
    for (let x = 0; x < targetW; x++) {
      const logicalX = x * WIN_W / targetW;
      const mx = Math.min(MASK_W - 1, Math.floor(logicalX / WIN_W * MASK_W));
      if (grown[my][mx]) {
        out[y][x] = 1;
      }
    }
  }

  applyBubble(out, bubble, targetW, targetH);
  return out;
}

/**
 * 把一组动画轮廓合并成一张固定遮罩。
 *
 * 鸿蒙每次调用 setWindowMask 都会让整个桌面重新合成一次，实测会出现整屏黑一帧。
 * 所以运行中不能跟着动画换遮罩：这里先算出「所有动画可能出现的区域」并集，
 * 整个会话只设置一次。代价是轮廓内部的一点透明区域也会拦截点击，但不会再闪屏。
 */
export function unionAlphaMasks(masks: Map<string, AlphaMask>): AlphaMask | null {
  const solid: Array<Array<boolean>> = [];
  for (let y = 0; y < MASK_H; y++) {
    const line: Array<boolean> = [];
    for (let x = 0; x < MASK_W; x++) {
      line.push(false);
    }
    solid.push(line);
  }

  let any = false;
  masks.forEach((mask: AlphaMask) => {
    if (mask.rows.length !== MASK_H) {
      return;
    }
    for (let y = 0; y < MASK_H; y++) {
      const hex = mask.rows[y];
      for (let x = 0; x < MASK_W; x++) {
        const digit = parseInt(hex.charAt(x >> 2), 16);
        if (((digit >> (3 - (x & 3))) & 1) === 1) {
          solid[y][x] = true;
          any = true;
        }
      }
    }
  });

  if (!any) {
    return null;
  }

  const rows: Array<string> = [];
  for (let y = 0; y < MASK_H; y++) {
    let line = '';
    for (let x = 0; x < MASK_W; x += 4) {
      let digit = 0;
      for (let bit = 0; bit < 4; bit++) {
        digit = (digit << 1) | (solid[y][x + bit] ? 1 : 0);
      }
      line += digit.toString(16);
    }
    rows.push(line);
  }
  return { w: MASK_W, h: MASK_H, rows: rows };
}

/** 把气泡矩形刷成不透明（含一圈 padding，让圆角和阴影不被切） */
function applyBubble(
  out: Array<Array<number>>,
  bubble: BubbleRect | null,
  targetW: number,
  targetH: number
): void {
  if (!bubble) {
    return;
  }
  const pad = 8;
  const sx = targetW / WIN_W;
  const sy = targetH / WIN_H;
  const x0 = Math.max(0, Math.floor((bubble.x - pad) * sx));
  const y0 = Math.max(0, Math.floor((bubble.y - pad) * sy));
  const x1 = Math.min(targetW - 1, Math.ceil((bubble.x + bubble.w + pad) * sx));
  const y1 = Math.min(targetH - 1, Math.ceil((bubble.y + bubble.h + pad) * sy));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      out[y][x] = 1;
    }
  }
}
