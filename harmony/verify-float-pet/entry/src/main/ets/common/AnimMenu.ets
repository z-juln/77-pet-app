/**
 * 动画配置的 ArkTS 侧模型。
 *
 * 配置由 pets/gen-anim-config.mjs 从宠物包的 config.jsonc 生成，随包发布在
 * rawfile/pet/packs/<id>/anim-config.json。页面侧（index.html）也用同一份数据跑
 * 状态机，ArkTS 侧读它是为了构建右键菜单 —— 菜单必须列出所有可点播的动画，
 * 而页面里那份是给状态机用的，跨进程取不到。
 */

export interface MoveSpec {
  name: string;
  minDist: number;
  maxDist: number;
  margin: number;
  leadSec: number;
  tailSec: number;
}

export interface CategorySpec {
  id: string;
  weight: number;
  noMirror: boolean;
  actions: Array<string>;
}

export interface EventsSpec {
  balance: Array<string>;
  whisper: Array<string>;
  /** 每个档位可能是单段动画，也可能是候选数组 */
  workStatus: Array<string | Array<string>>;
}

export interface WeightsSpec {
  idle: number;
  turn: number;
  move: number;
}

export interface AnimConfig {
  pack: string;
  whisperPrompt: string;
  memeDescriptions: Record<string, string>;
  idle: Array<string>;
  turn: Array<string>;
  drag: Array<string>;
  clicks: Array<string>;
  moves: Array<MoveSpec>;
  categories: Array<CategorySpec>;
  events: EventsSpec;
  weights: WeightsSpec;
}

/** 菜单里的一个叶子节点：显示名 + 要播的素材文件名 */
export interface MenuLeaf {
  label: string;
  file: string;
}

/** 菜单里的一个分组，例如「小动作」「点击回应」 */
export interface MenuGroup {
  label: string;
  items: Array<MenuLeaf>;
}

/** 事件分组的显示名 */
const EVENT_LABELS: Map<string, string> = new Map<string, string>([
  ['balance', '余额'],
  ['whisper', '碎碎念'],
  ['workStatus', '工作状态']
]);

/** 素材文件名 → 菜单显示名（去掉 .webm 后缀） */
export function displayName(file: string): string {
  return file.endsWith('.webm') ? file.substring(0, file.length - 5) : file;
}

/**
 * 按 Electron 版 buildMenuTree 的同一套顺序构建菜单：
 * 待机 / 转向 / 拖拽 / 点击回应 / 移动，然后是各随机动作分类，最后是事件分组。
 */
export function buildMenu(cfg: AnimConfig | null): Array<MenuGroup> {
  const groups: Array<MenuGroup> = [];
  if (!cfg) {
    return groups;
  }

  const push = (label: string, files: Array<string>): void => {
    if (files.length === 0) {
      return;
    }
    const items: Array<MenuLeaf> = [];
    for (const f of files) {
      items.push({ label: displayName(f), file: f });
    }
    groups.push({ label: label, items: items });
  };

  push('待机', cfg.idle);
  push('转向', cfg.turn);
  push('拖拽', cfg.drag);
  push('点击回应', cfg.clicks);

  const moveNames: Array<string> = [];
  for (const m of cfg.moves) {
    moveNames.push(m.name);
  }
  push('移动', moveNames);

  for (const c of cfg.categories) {
    push(c.id, c.actions);
  }

  if (cfg.events) {
    push(EVENT_LABELS.get('balance') ?? 'balance', cfg.events.balance ?? []);
    push(EVENT_LABELS.get('whisper') ?? 'whisper', cfg.events.whisper ?? []);
    const work: Array<string> = [];
    for (const slot of cfg.events.workStatus ?? []) {
      if (typeof slot === 'string') {
        work.push(slot);
      } else {
        for (const s of slot) {
          work.push(s);
        }
      }
    }
    push(EVENT_LABELS.get('workStatus') ?? 'workStatus', work);
  }

  return groups;
}
