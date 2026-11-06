/**
 * 桌宠设置：持久化 + 全局状态。
 *
 * 用 preferences（键值库）存，不用文件 —— 设置都是标量，preferences 自带原子写和
 * 默认值兜底，比自己维护 JSON 文件稳。所有读写都在 ArkTS 侧，页面通过 runJavaScript
 * 收设置，这样就只有一处是真相（页面不去猜配置从哪来）。
 *
 * 为什么要独立窗口：和右键菜单一样，宠物窗口只有 384x(216+气泡区)，
 * 设置面板放不下，也会被窗口边界裁掉。
 */
import { hilog } from '@kit.PerformanceAnalysisKit';
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { deviceInfo } from '@kit.BasicServicesKit';
import { window } from '@kit.ArkUI';

const DOMAIN = 0x7700;
const TAG = 'Pet77';
const STORE = 'pet77_settings';
const IS_EMULATOR = deviceInfo.productModel === 'emulator';
/**
 * 旧版把「稳定待机」开关的测试值持久化成了关闭。升级到本版时只纠正一次，
 * 之后用户主动切换仍会正常保留。
 */
const EMULATOR_MOTION_MIGRATED = 'stableMotionEmulatorMigrated';

/** 设置面板窗口尺寸 */
export const SETTINGS_W = 340;
export const SETTINGS_H = 680;

/**
 * 可调项。字段名要和页面里的 settings 对象一致 —— 保存时整份推回页面，
 * 页面只按名字取，不关心存储细节。
 */
export interface PetSettings {
  /** 当前宠物包 id，对应 rawfile/pet/packs/<id> */
  petPack: string;
  /** 宠物缩放：相对屏幕默认占比的倍率（1.0 = 与 Mac 版接近的默认大小） */
  scale: number;
  /** 桌面整体不透明度：气泡和宠物一起变淡，不影响点击 */
  opacity: number;
  /** 随机链里自己走开的权重；0 = 一直待在原地 */
  moveWeight: number;
  /**
   * 稳定待机：静止时定格，主动交互时仍播放。
   * 模拟器默认开启，避免宿主 GPU 在持续合成时偶发整屏黑帧；真机默认关闭。
   */
  stableMotion: boolean;
  /** 碎碎念开关 */
  whisperOn: boolean;
  /** 碎碎念最短间隔（秒）；实际会在这个基础上随机抖动 */
  whisperSec: number;
  /** 是否用 AI 生成碎碎念；关闭或没填 Key 时使用宠物包自带文案 */
  llmOn: boolean;
  /** OpenAI 兼容接口，例如 https://api.openai.com/v1 */
  llmBaseUrl: string;
  /** 模型名，例如 gpt-4o-mini */
  llmModel: string;
  /** API Key（只存本机 Preferences，不上传别处） */
  llmApiKey: string;
}

export const DEFAULT_SETTINGS: PetSettings = {
  petPack: 'blue-maid',
  scale: 1,
  opacity: 1,
  moveWeight: 5,
  stableMotion: IS_EMULATOR,
  whisperOn: true,
  whisperSec: 300,
  llmOn: false,
  llmBaseUrl: 'https://api.openai.com/v1',
  llmModel: 'gpt-4o-mini',
  llmApiKey: ''
};

export class PetSettingsStore {
  private static store: preferences.Preferences | undefined = undefined;
  /** 内存缓存：页面随时可能来问，不该每次都走 IO */
  private static cache: PetSettings | undefined = undefined;
  private static settingsWin: window.Window | undefined = undefined;
  /** 设置页是否已经加载完 */
  static pageReady: boolean = false;
  private static posX: number = -1;
  private static posY: number = -1;
  private static posTimer: number = -1;

  /** 由 EntryAbility.onCreate 调用一次 */
  static init(ctx: common.UIAbilityContext): void {
    try {
      PetSettingsStore.store = preferences.getPreferencesSync(ctx, { name: STORE });
    } catch (e) {
      const err = e as Error;
      hilog.error(DOMAIN, TAG, 'settings store init failed: %{public}s', err.message);
    }
  }

  static load(): PetSettings {
    if (PetSettingsStore.cache) {
      return PetSettingsStore.cache;
    }
    const s = PetSettingsStore.store;
    if (!s) {
      PetSettingsStore.cache = PetSettingsStore.fresh();
      return PetSettingsStore.cache;
    }
    // 逐项兜底：旧版本存的缺字段、或手改坏了，都不该让桌宠起不来
    const stableMotion = PetSettingsStore.emulatorStableMotion(s);
    const out: PetSettings = {
      petPack: PetSettingsStore.text(s.getSync('petPack', DEFAULT_SETTINGS.petPack) as string,
        DEFAULT_SETTINGS.petPack),
      scale: PetSettingsStore.num(s.getSync('scale', DEFAULT_SETTINGS.scale) as number, DEFAULT_SETTINGS.scale, 0.5, 1.5),
      opacity: PetSettingsStore.num(s.getSync('opacity', DEFAULT_SETTINGS.opacity) as number, DEFAULT_SETTINGS.opacity, 0.2, 1),
      moveWeight: PetSettingsStore.num(s.getSync('moveWeight', DEFAULT_SETTINGS.moveWeight) as number, DEFAULT_SETTINGS.moveWeight, 0, 50),
      stableMotion: stableMotion,
      whisperOn: (s.getSync('whisperOn', DEFAULT_SETTINGS.whisperOn) as boolean) === true,
      whisperSec: PetSettingsStore.num(s.getSync('whisperSec', DEFAULT_SETTINGS.whisperSec) as number, DEFAULT_SETTINGS.whisperSec, 30, 3600),
      llmOn: (s.getSync('llmOn', DEFAULT_SETTINGS.llmOn) as boolean) === true,
      llmBaseUrl: PetSettingsStore.text(s.getSync('llmBaseUrl', DEFAULT_SETTINGS.llmBaseUrl) as string,
        DEFAULT_SETTINGS.llmBaseUrl),
      llmModel: PetSettingsStore.text(s.getSync('llmModel', DEFAULT_SETTINGS.llmModel) as string,
        DEFAULT_SETTINGS.llmModel),
      llmApiKey: PetSettingsStore.text(s.getSync('llmApiKey', DEFAULT_SETTINGS.llmApiKey) as string,
        DEFAULT_SETTINGS.llmApiKey)
    };
    PetSettingsStore.cache = out;
    return out;
  }

  private static num(v: number, fallback: number, lo: number, hi: number): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return fallback;
    }
    return Math.min(Math.max(v, lo), hi);
  }

  private static text(v: string, fallback: string): string {
    return typeof v === 'string' && v.length > 0 ? v : fallback;
  }

  /**
   * 模拟器在持续合成透明悬浮窗时会偶发整屏黑帧，所以首次升级到带此修复的版本时
   * 强制打开稳定待机。用单独的标记位保证只迁移一次，不覆盖用户之后的主动选择。
   */
  private static emulatorStableMotion(s: preferences.Preferences): boolean {
    const saved = (s.getSync('stableMotion', DEFAULT_SETTINGS.stableMotion) as boolean) === true;
    if (!IS_EMULATOR || (s.getSync(EMULATOR_MOTION_MIGRATED, false) as boolean) === true) {
      return saved;
    }
    try {
      s.putSync('stableMotion', true);
      s.putSync(EMULATOR_MOTION_MIGRATED, true);
      s.flush();
      hilog.info(DOMAIN, TAG, 'emulator stableMotion migrated to true');
    } catch (e) {
      const err = e as Error;
      hilog.warn(DOMAIN, TAG, 'emulator stableMotion migration failed: %{public}s', err.message);
    }
    return true;
  }

  /** 一份全新的默认设置（ArkTS 不支持对象展开，手动逐字段构造） */
  private static fresh(): PetSettings {
    return {
      petPack: DEFAULT_SETTINGS.petPack,
      scale: DEFAULT_SETTINGS.scale,
      opacity: DEFAULT_SETTINGS.opacity,
      moveWeight: DEFAULT_SETTINGS.moveWeight,
      stableMotion: DEFAULT_SETTINGS.stableMotion,
      whisperOn: DEFAULT_SETTINGS.whisperOn,
      whisperSec: DEFAULT_SETTINGS.whisperSec,
      llmOn: DEFAULT_SETTINGS.llmOn,
      llmBaseUrl: DEFAULT_SETTINGS.llmBaseUrl,
      llmModel: DEFAULT_SETTINGS.llmModel,
      llmApiKey: DEFAULT_SETTINGS.llmApiKey
    };
  }

  static save(next: PetSettings): void {
    PetSettingsStore.cache = next;
    const s = PetSettingsStore.store;
    if (!s) {
      hilog.error(DOMAIN, TAG, 'settings save skipped: store missing');
      return;
    }
    s.putSync('scale', next.scale);
    s.putSync('petPack', next.petPack);
    s.putSync('opacity', next.opacity);
    s.putSync('moveWeight', next.moveWeight);
    s.putSync('stableMotion', next.stableMotion);
    if (IS_EMULATOR) {
      s.putSync(EMULATOR_MOTION_MIGRATED, true);
    }
    s.putSync('whisperOn', next.whisperOn);
    s.putSync('whisperSec', next.whisperSec);
    s.putSync('llmOn', next.llmOn);
    s.putSync('llmBaseUrl', next.llmBaseUrl);
    s.putSync('llmModel', next.llmModel);
    s.putSync('llmApiKey', next.llmApiKey);
    s.flush()
      .then(() => {
        hilog.info(DOMAIN, TAG, 'settings saved: %{public}s', JSON.stringify(next));
      })
      .catch((e: Error) => {
        hilog.error(DOMAIN, TAG, 'settings flush failed: %{public}s', e.message);
      });
  }

  /** 上次退出时的窗口位置；-1 表示还没记录过，调用方应使用默认角落。 */
  static loadPosition(): Array<number> {
    const s = PetSettingsStore.store;
    if (!s) {
      return [-1, -1];
    }
    const x = s.getSync('posX', -1) as number;
    const y = s.getSync('posY', -1) as number;
    return [typeof x === 'number' ? x : -1, typeof y === 'number' ? y : -1];
  }

  /**
   * 记住窗口位置。拖动/漫游时每帧都会经过这里，所以只更新内存，
   * 等移动停下 1.2 秒再落盘，避免高频写 Preferences。
   */
  static rememberPosition(x: number, y: number): void {
    PetSettingsStore.posX = Math.round(x);
    PetSettingsStore.posY = Math.round(y);
    if (PetSettingsStore.posTimer !== -1) {
      return;
    }
    PetSettingsStore.posTimer = setTimeout(() => {
      PetSettingsStore.posTimer = -1;
      PetSettingsStore.flushPosition();
    }, 1200);
  }

  static flushPosition(): void {
    if (PetSettingsStore.posTimer !== -1) {
      clearTimeout(PetSettingsStore.posTimer);
      PetSettingsStore.posTimer = -1;
    }
    const s = PetSettingsStore.store;
    if (!s || (PetSettingsStore.posX === -1 && PetSettingsStore.posY === -1)) {
      return;
    }
    try {
      s.putSync('posX', PetSettingsStore.posX);
      s.putSync('posY', PetSettingsStore.posY);
      s.flush();
    } catch (e) {
      const err = e as Error;
      hilog.error(DOMAIN, TAG, 'save position failed: %{public}s', err.message);
    }
  }

  /** 设置页改完提交：通知宠物窗口应用新值 */
  static pendingApply: boolean = false;

  static setWindow(win: window.Window): void {
    PetSettingsStore.settingsWin = win;
  }

  static getWindow(): window.Window | undefined {
    return PetSettingsStore.settingsWin;
  }

  static clearWindow(): void {
    PetSettingsStore.settingsWin = undefined;
    PetSettingsStore.pageReady = false;
  }
}
