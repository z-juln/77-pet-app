import { webview } from '@kit.ArkWeb';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { util } from '@kit.ArkTS';
import { window } from '@kit.ArkUI';
import { display } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { http } from '@kit.NetworkKit';
import { FloatWin } from '../common/FloatWin';
import { HitWin } from '../common/HitWin';
import { PetInput } from '../common/PetInput';
import { PetBridge, WIN_W, WIN_H, WIN_PAD_TOP, HIT_X, HIT_W, HIT_H } from '../common/PetBridge';
import { PetMenu, MENU_W, MENU_H } from '../common/PetMenu';
import { AbilityCtx } from '../common/AbilityCtx';
import { AnimConfig, MenuGroup, buildMenu } from '../common/AnimMenu';
import { PetSettingsStore, PetSettings, SETTINGS_W, SETTINGS_H } from '../common/PetSettings';
import { PetPacks } from '../common/PetPacks';

const DOMAIN = 0x7700;
const TAG = 'Pet77';

/** 拖拽开始前需要累计的位移，避免手抖就切到被抓起的姿势 */
const DRAG_THRESHOLD = 6;
/** 长按多久算「要菜单」；比系统 longClick(500ms) 略长，减少误触 */
const LONG_PRESS_MS = 700;

interface ChatMessage {
  role: string;
  content: string;
}

interface ChatChoice {
  message: ChatMessage;
}

interface ChatResponse {
  choices?: Array<ChatChoice>;
}

interface ChatRequest {
  model: string;
  messages: Array<ChatMessage>;
  temperature: number;
  max_tokens: number;
}

/**
 * 悬浮窗内页面：用 ArkWeb 播 rawfile 里的透明 webm。
 *
 * 状态机在页面侧（index.html）：随机链、点击回应、拖拽姿势、事件动画都由 JS 处理，
 * ArkTS 只负责窗口位移、读配置注入、以及把点击区窗口收到的事件转给页面。
 * 画面窗本身不接鼠标，也不再改窗口形状，所以动画切换不会触发整屏重合成。
 */
@Entry
@Component
struct FloatPet {
  controller: webview.WebviewController = new webview.WebviewController();
  private bridge: PetBridge = new PetBridge();
  /** 页面是否已加载完（可以 runJavaScript 了） */
  private pageLoaded: boolean = false;
  /** 待注入的配置；页面加载完后才发 */
  private pendingConfig: string = '';
  @State lastX: number = 0;
  @State lastY: number = 0;
  @State downX: number = 0;
  @State downY: number = 0;
  /** 按下时的窗口位置：拖拽的弹簧目标 = 它 + 指针屏幕增量 */
  @State downWinX: number = 0;
  @State downWinY: number = 0;
  @State winX: number = 0;
  @State winY: number = 0;
  @State dragging: boolean = false;
  /** 位移已超过阈值，确认是拖拽而不是点击 */
  @State dragConfirmed: boolean = false;
  /** 漫游位移的轮询定时器 */
  private moveTimer: number = -1;
  /** 已发出的窗口移动是否还在途中（避免请求堆积） */
  private moveBusy: boolean = false;
  /** 右键菜单的分组数据，由动画配置推出 */
  @State menuGroups: Array<MenuGroup> = [];
  /** 菜单窗口是否已打开 */
  @State menuShown: boolean = false;
  /** 轮询菜单选择结果的定时器 */
  private menuTimer: number = -1;
  /** 长按计时器：到点就弹菜单 */
  private longTimer: number = -1;
  /** 本次触摸已经被长按消费掉，抬手时不再当点击 */
  private longFired: boolean = false;
  /** 设置窗口是否已打开 */
  @State settingsShown: boolean = false;
  /** 轮询设置变更的定时器 */
  private settingsTimer: number = -1;
  /** 上一次已应用的设置签名，用于只在新值真的变了时才推给页面/窗口 */
  private appliedSettingsKey: string = '';
  /** 当前页面已经加载的宠物包 */
  private appliedPack: string = '';
  /** 碎碎念请求轮询（页面到点后通过 javaScriptProxy 设置标记） */
  private whisperTimer: number = -1;
  /** 同时只发一个模型请求，避免网络慢时排队 */
  private whisperBusy: boolean = false;
  /** 当前宠物包的模型提示词与表情包说明 */
  private whisperPrompt: string = '';
  private memeDescriptions: Record<string, string> = {};
  /** 点击区窗口的事件轮询（16ms 一次，只读内存队列） */
  private inputTimer: number = -1;
  /** 屏幕密度：触摸坐标是 vp，窗口坐标是 px，拖拽增量要按它换算 */
  private density: number = 1;
  /** 画面窗自己收到触摸时的最后坐标（点击区建不出来时仍能操作） */
  private lastTouchX: number = 0;
  private lastTouchY: number = 0;
  /** 设置项「稳定待机」；模拟器默认开启，真机默认关闭 */
  private stableMotion: boolean = false;

  /**
   * 打开右键菜单。
   *
   * 菜单在独立的 TYPE_FLOAT 窗口里渲染 —— 宠物窗口只有 384x216，
   * ArkUI 的 Menu / bindMenu 都会受宿主窗口高度裁剪（实测只能看到 4 项）。
   * 独立窗口可以给足 240x520，菜单完整可见。
   */
  private openMenu(): void {
    if (this.menuGroups.length === 0) {
      hilog.warn(DOMAIN, TAG, 'openMenu: no menu groups');
      return;
    }
    if (this.menuShown) {
      return;
    }
    const win = FloatWin.get();
    if (!win) {
      return;
    }
    const rect = win.getWindowProperties().windowRect;
    PetMenu.open(this.menuGroups, rect.left + rect.width, rect.top);
    this.menuShown = true;
    // 菜单默认贴在宠物右侧、略高一点；贴边时翻到左侧，避免跑出屏幕
    let mx = rect.left + rect.width - 40;
    // 菜单底边和宠物底边对齐；宠物在屏幕下方时菜单向上展开，避免压住任务栏。
    let my = rect.top + rect.height - MENU_H;
    try {
      const disp = display.getDefaultDisplaySync();
      const availW = disp.availableWidth > 0 ? disp.availableWidth : disp.width;
      const availH = disp.availableHeight > 0 ? disp.availableHeight : disp.height;
      const maxX = availW - MENU_W - 8;
      const maxY = availH - MENU_H - 8;
      hilog.info(DOMAIN, TAG, 'menu anchor: pet=%{public}d,%{public}d display=%{public}dx%{public}d',
        rect.left, rect.top, availW, availH);
      if (mx > maxX) {
        mx = Math.max(8, rect.left - MENU_W + 40);
      }
      if (my < 8) {
        my = 8;
      }
      if (my > maxY) {
        my = Math.max(8, maxY);
      }
    } catch (e) {
      const err = e as BusinessError;
      hilog.warn(DOMAIN, TAG, 'get display failed: %{public}s', err.message);
    }
    this.createMenuWindow(mx, my);
    this.startMenuPoll();
  }

  private createMenuWindow(x: number, y: number): void {
    const config: window.Configuration = {
      name: 'pet77_menu',
      windowType: window.WindowType.TYPE_FLOAT,
      ctx: getContext(this) as common.UIAbilityContext
    };
    window.createWindow(config)
      .then((w: window.Window) => {
        PetMenu.setWindow(w);
        return w.setUIContent('pages/PetMenuPage')
          .then(() => {
            w.setWindowBackgroundColor('#00000000');
            w.setWindowDecorVisible(false);
            return w.resize(MENU_W, MENU_H);
          })
          .then(() => w.moveWindowTo(Math.round(x), Math.round(y)))
          .then(() => {
            w.showWindow();
            hilog.info(DOMAIN, TAG, 'menu window shown at %{public}d,%{public}d', x, y);
            // 失焦即关：点桌面其它地方、或系统侧收回焦点时把菜单收起来
            w.on('windowEvent', (ev: window.WindowEventType) => {
              if (ev === window.WindowEventType.WINDOW_INACTIVE) {
                hilog.info(DOMAIN, TAG, 'menu lost focus -> close');
                this.closeMenu();
              }
            });
          });
      })
      .catch((e: BusinessError) => {
        hilog.error(DOMAIN, TAG, 'create menu window failed code=%{public}d %{public}s',
          e.code, e.message);
        this.menuShown = false;
      });
  }

  private startMenuPoll(): void {
    if (this.menuTimer !== -1) {
      return;
    }
    this.menuTimer = setInterval(() => {
      if (!this.menuShown) {
        if (this.menuTimer !== -1) {
          clearInterval(this.menuTimer);
          this.menuTimer = -1;
        }
        return;
      }
      const pick = PetMenu.pendingPlay;
      if (!pick) {
        return;
      }
      PetMenu.pendingPlay = '';
      this.closeMenu();
      if (pick === '__quit__') {
        this.quit();
      } else if (pick === '__settings__') {
        this.openSettings();
      } else if (pick === '__whisper__') {
        this.runPage('window.petWhisper && window.petWhisper();');
      } else if (pick === '__home__') {
        this.goHome();
      } else {
        this.playAnim(pick);
      }
    }, 120);
  }

  /**
   * 开设置窗口。
   *
   * 定位到宠物窗口的左下角对齐：关掉菜单这一刻宠物在哪，设置就贴在它旁边出来，
   * 用户不需要再去找窗口。贴边时往回收，避免跑出屏幕。
   */
  private openSettings(): void {
    if (this.settingsShown) {
      return;
    }
    const petWin = FloatWin.get();
    if (!petWin) {
      return;
    }
    const rect = petWin.getWindowProperties().windowRect;
    let x = rect.left + rect.width + 8;
    let y = rect.top + rect.height - SETTINGS_H;
    try {
      const disp = display.getDefaultDisplaySync();
      const availW = disp.availableWidth > 0 ? disp.availableWidth : disp.width;
      const availH = disp.availableHeight > 0 ? disp.availableHeight : disp.height;
      const maxX = availW - SETTINGS_W - 8;
      const maxY = availH - SETTINGS_H - 8;
      if (x > maxX) {
        x = Math.max(8, rect.left - SETTINGS_W - 8);
      }
      if (y > maxY) {
        y = Math.max(8, maxY);
      }
      if (y < 8) {
        y = 8;
      }
    } catch (e) {
      const err = e as BusinessError;
      hilog.warn(DOMAIN, TAG, 'get display failed: %{public}s', err.message);
    }
    this.settingsShown = true;
    const config: window.Configuration = {
      name: 'pet77_settings',
      windowType: window.WindowType.TYPE_FLOAT,
      ctx: getContext(this) as common.UIAbilityContext
    };
    window.createWindow(config)
      .then((w: window.Window) => {
        PetSettingsStore.setWindow(w);
        return w.setUIContent('pages/SettingsPage')
          .then(() => {
            w.setWindowBackgroundColor('#00000000');
            w.setWindowDecorVisible(false);
            return w.resize(SETTINGS_W, SETTINGS_H);
          })
          .then(() => w.moveWindowTo(Math.round(x), Math.round(y)))
          .then(() => {
            w.showWindow();
            hilog.info(DOMAIN, TAG, 'settings window shown at %{public}d,%{public}d', x, y);
            w.on('windowEvent', (ev: window.WindowEventType) => {
              if (ev === window.WindowEventType.WINDOW_INACTIVE) {
                // 点外面就把设置收起来（与菜单同一套语义），销毁前顺手把值落盘
                this.closeSettings();
              }
            });
          });
      })
      .catch((e: BusinessError) => {
        this.settingsShown = false;
        hilog.error(DOMAIN, TAG, 'create settings window failed: %{public}s', e.message);
      });
  }

  private closeSettings(): void {
    this.settingsShown = false;
    const w = PetSettingsStore.getWindow();
    PetSettingsStore.clearWindow();
    if (w) {
      w.destroyWindow()
        .catch((e: BusinessError) => {
          hilog.warn(DOMAIN, TAG, 'destroy settings window failed: %{public}s', e.message);
        });
    }
  }

  /**
   * 轮询设置变更并应用。
   *
   * 为什么轮询而不是设置页直接调 ArkTS：设置页在另一个窗口里，跨窗口拿不到
   * FloatPet 的实例。轮询一个内存中的标记位（不是 IO）开销可以忽略。
   *
   * 缩放只改窗口尺寸，不缩放页面内容 —— 视频本身就是矢量感的位图，
   * 窗口放大后 Web 会按 CSS 尺寸重新布局，视觉上是等比放大的。
   */
  private startSettingsPoll(): void {
    if (this.settingsTimer !== -1) {
      return;
    }
    this.settingsTimer = setInterval(() => {
      if (!PetSettingsStore.pendingApply) {
        return;
      }
      PetSettingsStore.pendingApply = false;
      this.applySettings();
    }, 150);
  }

  /** 页面到点后会置一个标记，这里取走并决定走模型还是本地文案 */
  private startWhisperPoll(): void {
    if (this.whisperTimer !== -1) {
      return;
    }
    this.whisperTimer = setInterval(() => {
      const force = PetBridge.whisperRequested;
      if (force === null || this.whisperBusy) {
        return;
      }
      PetBridge.whisperRequested = null;
      this.generateWhisper(force);
    }, 120);
  }

  /**
   * 生成一句碎碎念。
   *
   * 模型是可选项：没开、没填 Key、请求失败，都静默回落宠物包自带文案。
   * 桌宠不是聊天窗口，失败不该弹错误框打断用户。
   */
  private async generateWhisper(force: boolean): Promise<void> {
    const s = PetSettingsStore.load();
    if (!s.llmOn || s.llmApiKey.length === 0 || s.llmBaseUrl.length === 0 || s.llmModel.length === 0) {
      this.runPage(`window.petWhisperFallback && window.petWhisperFallback(${force});`);
      return;
    }
    const memeKeys = Object.keys(this.memeDescriptions);
    const memeName = memeKeys.length > 0
      ? memeKeys[Math.floor(Math.random() * memeKeys.length)] : '';
    const memeDesc = memeName.length > 0 ? this.memeDescriptions[memeName] : '';
    const system = `${this.whisperPrompt}${memeName.length > 0
      ? `\n当前配图：${memeName}（${memeDesc}）。请让这句话和画面相配。` : ''}` +
      '\n只输出一句话，20 字以内，不要引号、不要解释、不要提 AI。';

    let base = s.llmBaseUrl;
    while (base.endsWith('/')) {
      base = base.substring(0, base.length - 1);
    }
    const url = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
    const messages: Array<ChatMessage> = [
      { role: 'system', content: system },
      { role: 'user', content: '现在说一句。' }
    ];
    const body: ChatRequest = {
      model: s.llmModel,
      messages: messages,
      temperature: 0.9,
      max_tokens: 60
    };
    const req = http.createHttp();
    this.whisperBusy = true;
    try {
      const res = await req.request(url, {
        method: http.RequestMethod.POST,
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${s.llmApiKey}`
        },
        extraData: JSON.stringify(body),
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 12000,
        readTimeout: 20000
      });
      if (res.responseCode !== 200) {
        hilog.warn(DOMAIN, TAG, 'whisper http status %{public}d', res.responseCode);
        this.runPage(`window.petWhisperFallback && window.petWhisperFallback(${force});`);
        return;
      }
      const raw = typeof res.result === 'string' ? res.result : JSON.stringify(res.result);
      const parsed = JSON.parse(raw) as ChatResponse;
      const choices = parsed.choices ?? [];
      let text = choices.length > 0 ? choices[0].message.content.trim() : '';
      text = text.replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').replace(/\s+/g, ' ');
      if (text.length > 60) {
        text = text.substring(0, 60);
      }
      if (text.length === 0) {
        this.runPage(`window.petWhisperFallback && window.petWhisperFallback(${force});`);
        return;
      }
      hilog.info(DOMAIN, TAG, 'whisper generated: %{public}s', text);
      this.runPage(`window.petShowWhisper && window.petShowWhisper(${JSON.stringify(text)},` +
        `${JSON.stringify(memeName)});`);
    } catch (e) {
      const err = e as BusinessError;
      hilog.warn(DOMAIN, TAG, 'whisper request failed: %{public}s', err.message);
      this.runPage(`window.petWhisperFallback && window.petWhisperFallback(${force});`);
    } finally {
      req.destroy();
      this.whisperBusy = false;
    }
  }

  private applySettings(): void {
    const s = PetSettingsStore.load();
    const key = `${s.petPack}|${s.scale}|${s.opacity}|${s.moveWeight}|${s.stableMotion}|` +
      `${s.whisperOn}|${s.whisperSec}`;
    if (key === this.appliedSettingsKey) {
      return;
    }
    this.appliedSettingsKey = key;
    this.stableMotion = s.stableMotion;

    // 宠物包切换：重读这个包的动画配置，页面原地换素材，不重建窗口。
    if (s.petPack !== this.appliedPack) {
      this.appliedPack = s.petPack;
      this.pendingConfig = this.loadAnimConfig(s.petPack);
      if (this.pageLoaded) {
        this.switchPagePack();
      }
    }

    // 1) 推给页面：透明度、走动权重、碎碎念（这些是页面状态机的事）
    if (this.pageLoaded) {
      this.controller.runJavaScript(
        `window.petSettings && window.petSettings(${JSON.stringify(s)});`)
        .catch((e: BusinessError) => {
          hilog.error(DOMAIN, TAG, 'push settings failed: %{public}s', e.message);
        });
    }

    // 2) 缩放：改窗口尺寸。窗口右上角对齐，保证宠物的脚不移位
    const win = FloatWin.get();
    if (!win) {
      return;
    }
    const rect = win.getWindowProperties().windowRect;
    const newW = Math.round(WIN_W * s.scale);
    const newH = Math.round(WIN_H * s.scale);
    if (newW === rect.width && newH === rect.height) {
      return;
    }
    // 底边对齐：高度变化量换算成顶部的上移量
    const newTop = rect.top + (rect.height - newH);
    const hit = HitWin.get();
    win.resize(newW, newH)
      .then(() => {
        // 点击区跟着一起缩放，并重新贴回宠物身体那一竖条
        if (hit) {
          return hit.resize(Math.round(HIT_W * s.scale), Math.round(HIT_H * s.scale));
        }
        return Promise.resolve();
      })
      .then(() => this.moveWindowsTo(rect.left, newTop, newW))
      .then(() => {
        PetSettingsStore.rememberPosition(rect.left, newTop);
        this.runPage(`window.petSyncPos && window.petSyncPos(${rect.left},${newTop});`);
        hilog.info(DOMAIN, TAG, 'window resized to %{public}dx%{public}d (scale %{public}s)',
          newW, newH, s.scale.toFixed(2));
      })
      .catch((e: BusinessError) => {
        hilog.error(DOMAIN, TAG, 'resize for scale failed: %{public}s', e.message);
      });
  }

  private closeMenu(): void {
    this.menuShown = false;
    const w = PetMenu.getWindow();
    PetMenu.clearWindow();
    if (w) {
      w.destroyWindow()
        .catch((e: BusinessError) => {
          hilog.warn(DOMAIN, TAG, 'destroy menu window failed: %{public}s', e.message);
        });
    }
  }

  /** 把宠物收回右下角，并同步页面里的漫游起点 */
  private goHome(): void {
    const win = FloatWin.get();
    if (!win) {
      return;
    }
    const rect = win.getWindowProperties().windowRect;
    let screenW = 1920;
    let screenH = 1080;
    try {
      const d = display.getDefaultDisplaySync();
      screenW = d.availableWidth > 0 ? d.availableWidth : d.width;
      screenH = d.availableHeight > 0 ? d.availableHeight : d.height;
    } catch (e) {
      const err = e as BusinessError;
      hilog.warn(DOMAIN, TAG, 'home display read failed: %{public}s', err.message);
    }
    const x = Math.max(24, screenW - rect.width - 48);
    const y = Math.max(0, screenH - rect.height - 24);
    this.moveWindowsTo(x, y, rect.width)
      .then(() => {
        PetSettingsStore.rememberPosition(x, y);
        this.runPage(`window.petSyncPos && window.petSyncPos(${x},${y});`);
      })
      .catch((e: BusinessError) => {
        hilog.warn(DOMAIN, TAG, 'go home failed: %{public}s', e.message);
      });
  }

  aboutToAppear(): void {
    const win = FloatWin.get();
    if (!win) {
      hilog.error(DOMAIN, TAG, 'FloatPet: float window missing');
      return;
    }
    try {
      const d = display.getDefaultDisplaySync();
      this.density = d.densityPixels > 0 ? d.densityPixels : 1;
    } catch (e) {
      const err = e as BusinessError;
      hilog.warn(DOMAIN, TAG, 'read density failed: %{public}s', err.message);
    }
    const rect = win.getWindowProperties().windowRect;
    this.winX = rect.left;
    this.winY = rect.top;
    this.startMoveLoop();
    this.startInputPoll();
    this.startSettingsPoll();
    this.startWhisperPoll();
    // 启动时把已存的设置应用一次（缩放/透明度在上次退出前是什么就恢复成什么）
    this.applySettings();
  }

  /** 点播一段指定动画（一次性播完回状态机） */
  private playAnim(file: string): void {
    if (!this.pageLoaded) {
      return;
    }
    this.controller.runJavaScript(
      `window.petApi && window.petApi.play('${file}');`)
      .catch((e: BusinessError) => {
        hilog.error(DOMAIN, TAG, 'playAnim failed: %{public}s', e.message);
      });
  }

  private quit(): void {
    hilog.info(DOMAIN, TAG, 'quit requested');
    this.closeMenu();
    this.closeSettings();
    this.cancelLongPress();
    PetSettingsStore.flushPosition();
    if (this.moveTimer !== -1) {
      clearInterval(this.moveTimer);
      this.moveTimer = -1;
    }
    const hit = HitWin.get();
    HitWin.clear();
    const win = FloatWin.get();
    FloatWin.clear();
    // 先销毁两块悬浮窗，再把整个 Ability 退掉 —— 只销毁窗口会留下无界面的进程
    const kill = (w: window.Window | undefined): Promise<void> => {
      if (!w) {
        return Promise.resolve();
      }
      return w.destroyWindow().catch((e: BusinessError) => {
        hilog.warn(DOMAIN, TAG, 'destroyWindow failed: %{public}s', e.message);
      });
    };
    kill(hit)
      .then(() => kill(win))
      .then(() => {
        const ctx = AbilityCtx.get();
        if (!ctx) {
          hilog.error(DOMAIN, TAG, 'terminateSelf skipped: no ability context');
          return;
        }
        return ctx.terminateSelf();
      })
      .catch((e: BusinessError) => {
        hilog.error(DOMAIN, TAG, 'terminateSelf failed: %{public}s', e.message);
      });
  }

  aboutToDisappear(): void {
    this.cancelLongPress();
    if (this.inputTimer !== -1) {
      clearInterval(this.inputTimer);
      this.inputTimer = -1;
    }
    if (this.moveTimer !== -1) {
      clearInterval(this.moveTimer);
      this.moveTimer = -1;
    }
    if (this.menuTimer !== -1) {
      clearInterval(this.menuTimer);
      this.menuTimer = -1;
    }
    if (this.settingsTimer !== -1) {
      clearInterval(this.settingsTimer);
      this.settingsTimer = -1;
    }
    if (this.whisperTimer !== -1) {
      clearInterval(this.whisperTimer);
      this.whisperTimer = -1;
    }
  }

  /**
   * 消费页面发来的窗口位移请求。
   *
   * 为什么轮询而不是页面直接调 ArkTS 方法：漫游时页面按视频进度每帧算目标坐标，
   * 每帧一次跨语言调用开销大且容易堆积。这里让页面只写「最新目标」，由 ArkTS
   * 以固定节拍取走 —— 天然丢帧合并，窗口移动永远不会落后于动画。
   */
  private startMoveLoop(): void {
    if (this.moveTimer !== -1) {
      return;
    }
    this.moveTimer = setInterval(() => {
      const target = PetBridge.pendingMove;
      if (!target) {
        return;
      }
      const win = FloatWin.get();
      if (!win) {
        return;
      }
      PetBridge.pendingMove = null;
      const x = Math.round(target[0]);
      const y = Math.round(target[1]);
      const rect = win.getWindowProperties().windowRect;
      if (x === rect.left && y === rect.top) {
        return;
      }
      // 拖拽是实时输入，不能等上一次窗口移动完成；始终提交最新位置，
      // 让窗口服务自己合并中间帧。漫游/抛掷保持串行，避免请求堆积。
      if (this.dragConfirmed) {
        this.winX = x;
        this.winY = y;
        this.moveWindowsToLive(x, y, rect.width);
        return;
      }
      if (this.moveBusy) {
        return;
      }
      this.moveBusy = true;
      this.winX = x;
      this.winY = y;
      this.moveWindowsTo(x, y, rect.width)
        .then(() => {
          PetSettingsStore.rememberPosition(x, y);
        })
        .catch((e: BusinessError) => {
          hilog.error(DOMAIN, TAG, 'roam move failed: %{public}s', e.message);
        })
        .finally(() => {
          this.moveBusy = false;
        });
    }, 16);
  }

  /**
   * 读动画配置。必须在 ArkTS 侧读：resource://rawfile 下 fetch 不可用
   * （实测 "TypeError: Failed to fetch"），页面自己拿不到这个 json。
   */
  private loadAnimConfig(pack: string): string {
    try {
      const ctx = AbilityCtx.get();
      if (!ctx) {
        return '';
      }
      const cfg = PetPacks.loadAnimConfig(ctx, pack);
      if (!cfg) {
        return '';
      }
      this.whisperPrompt = cfg.whisperPrompt ?? '';
      this.memeDescriptions = cfg.memeDescriptions ?? {};
      this.menuGroups = buildMenu(cfg);
      hilog.info(DOMAIN, TAG, 'pack %{public}s menu groups=%{public}d',
        pack, this.menuGroups.length);
      // 压成单行再注入，避免换行在 runJavaScript 里出问题
      return JSON.stringify(cfg);
    } catch (e) {
      const err = e as BusinessError;
      hilog.error(DOMAIN, TAG, 'load anim config failed: %{public}s', err.message);
      return '';
    }
  }

  /** 把新宠物包的配置推给页面；窗口位置和屏幕边界保持当前值 */
  private switchPagePack(): void {
    if (!this.pageLoaded || this.pendingConfig.length === 0) {
      return;
    }
    const win = FloatWin.get();
    let originX = 0;
    let originY = 0;
    let windowW = WIN_W;
    let windowH = WIN_H;
    let screenW = 0;
    let screenH = 0;
    if (win) {
      const rect = win.getWindowProperties().windowRect;
      originX = rect.left;
      originY = rect.top;
      windowW = rect.width;
      windowH = rect.height;
    }
    try {
      const d = display.getDefaultDisplaySync();
      screenW = d.availableWidth > 0 ? d.availableWidth : d.width;
      screenH = d.availableHeight > 0 ? d.availableHeight : d.height;
    } catch (e) {
      const err = e as BusinessError;
      hilog.warn(DOMAIN, TAG, 'read display failed: %{public}s', err.message);
    }
    const cfg = `Object.assign(${this.pendingConfig},{stableMotion:${this.stableMotion},` +
      `originX:${originX},originY:${originY},` +
      `screenW:${screenW},screenH:${screenH},windowW:${windowW},windowH:${windowH}})`;
    this.controller.runJavaScript(`window.petPackSwitch && window.petPackSwitch(${cfg});`)
      .then(() => {
        // 换包后重新推一次设置（透明度/碎碎念等页面状态）
        this.appliedSettingsKey = '';
        this.applySettings();
        hilog.info(DOMAIN, TAG, 'pet pack switched on page');
      })
      .catch((e: BusinessError) => {
        hilog.error(DOMAIN, TAG, 'switch pet pack failed: %{public}s', e.message);
      });
  }

  /** 把事件转给页面侧状态机 */
  private callPage(code: string): void {
    this.runPage(`window.petApi && window.petApi.${code};`);
  }

  /** 执行普通页面脚本（“叫一声 / 回家”这类不属于 petApi 的动作） */
  private runPage(js: string): void {
    if (!this.pageLoaded) {
      hilog.warn(DOMAIN, TAG, 'runPage skipped, page not loaded: %{public}s', js);
      return;
    }
    this.controller.runJavaScript(js)
      .catch((e: BusinessError) => {
        hilog.error(DOMAIN, TAG, 'runJavaScript failed: %{public}s', e.message);
      });
  }

  private injectConfig(): void {
    if (!this.pageLoaded || this.pendingConfig.length === 0) {
      return;
    }
    // 把窗口当前位置一起给页面：漫游要从真实位置起算，否则会跳
    const win = FloatWin.get();
    let originX = 0;
    let originY = 0;
    if (win) {
      const rect = win.getWindowProperties().windowRect;
      originX = rect.left;
      originY = rect.top;
    }
    let screenW = 0;
    let screenH = 0;
    try {
      const d = display.getDefaultDisplaySync();
      screenW = d.availableWidth > 0 ? d.availableWidth : d.width;
      screenH = d.availableHeight > 0 ? d.availableHeight : d.height;
      hilog.info(DOMAIN, TAG,
        'display %{public}dx%{public}d available %{public}dx%{public}d density %{public}s',
        d.width, d.height, d.availableWidth, d.availableHeight, JSON.stringify(d.densityPixels));
    } catch (e) {
      const err = e as BusinessError;
      hilog.warn(DOMAIN, TAG, 'read display failed: %{public}s', err.message);
    }
    const rect = win ? win.getWindowProperties().windowRect : undefined;
    const cfg = `Object.assign(${this.pendingConfig},{stableMotion:${this.stableMotion},` +
      `originX:${originX},originY:${originY},` +
      `screenW:${screenW},screenH:${screenH},windowW:${rect ? rect.width : 0},` +
      `windowH:${rect ? rect.height : 0}})`;
    this.controller.runJavaScript(`window.petBoot && window.petBoot(${cfg});`)
      .then(() => {
        // 启动早期页面还没加载时 applySettings 只能改窗口，设置值本身没进页面。
        // 页面就绪后强制再应用一次，保证上次保存的透明度/碎碎念/走动权重真的恢复。
        this.appliedSettingsKey = '';
        this.applySettings();
        hilog.info(DOMAIN, TAG, 'anim config injected, origin=%{public}d,%{public}d',
          originX, originY);
      })
      .catch((e: BusinessError) => {
        hilog.error(DOMAIN, TAG, 'inject config failed: %{public}s', e.message);
      });
  }

  /** 开始长按计时；位移或抬手都会取消 */
  private startLongPress(): void {
    this.cancelLongPress();
    this.longTimer = setTimeout(() => {
      this.longTimer = -1;
      this.longFired = true;
      hilog.info(DOMAIN, TAG, 'long press -> open menu');
      this.openMenu();
    }, LONG_PRESS_MS);
  }

  private cancelLongPress(): void {
    if (this.longTimer !== -1) {
      clearTimeout(this.longTimer);
      this.longTimer = -1;
    }
  }

  /**
   * 同时移动画面窗和点击区窗。
   *
   * 两个窗保持固定的相对位置；点击区是不可见窗口，晚一帧无所谓，
   * 所以这里不 await 它，避免拖拽时多等一次窗口服务往返。
   */
  private moveWindowsTo(x: number, y: number, windowW: number): Promise<void> {
    const win = FloatWin.get();
    if (!win) {
      return Promise.resolve();
    }
    // 用调用方给的目标宽度算偏移：窗口刚 resize 完时 getWindowProperties
    // 可能还返回旧尺寸，直接读会算错点击区的位置。
    const s = windowW / WIN_W;
    const hit = HitWin.get();
    if (hit) {
      hit.moveWindowToAsync(Math.round(x + HIT_X * s), y)
        .catch((e: BusinessError) => {
          hilog.warn(DOMAIN, TAG, 'hit window move failed: %{public}s', e.message);
        });
    }
    return win.moveWindowToAsync(x, y);
  }

  /** 拖拽专用：直接提交最新位置，不等待上一次移动结束 */
  private moveWindowsToLive(x: number, y: number, windowW: number): void {
    const win = FloatWin.get();
    if (!win) {
      return;
    }
    // 拖拽开始后触摸目标已经锁定在点击区上，指针离开点击区仍会继续收到
    // 移动和抬手事件；这段时间不再搬透明点击窗，减少一半窗口合成。
    win.moveWindowTo(x, y)
      .catch((e: BusinessError) => {
        hilog.warn(DOMAIN, TAG, 'float window live move failed: %{public}s', e.message);
      });
  }

  /** 点击区窗口的事件轮询：16ms 一次，只读内存队列 */
  private startInputPoll(): void {
    if (this.inputTimer !== -1) {
      return;
    }
    this.inputTimer = setInterval(() => {
      for (let i = 0; i < 12; i++) {
        const ev = PetInput.take();
        if (!ev) {
          break;
        }
        this.handlePetEvent(ev.kind, ev.x, ev.y);
      }
    }, 16);
  }

  /**
   * 统一点击/拖拽入口。
   *
   * 坐标来自触摸事件，单位是 vp；窗口位置和尺寸是 px，所以先乘密度再参与
   * 窗口位移计算，否则高 DPI 屏上宠物会跟不上指针。
   */
  private handlePetEvent(kind: string, vpX: number, vpY: number): void {
    const win = FloatWin.get();
    if (!win) {
      return;
    }
    if (kind === 'right') {
      this.openMenu();
      return;
    }

    const sx = vpX * this.density;
    const sy = vpY * this.density;
    const rect = win.getWindowProperties().windowRect;

    if (kind === 'down') {
      // 菜单/设置开着时，点宠物等于点「外面」：先收起，不触发宠物动作
      if (this.menuShown) {
        this.closeMenu();
        return;
      }
      if (this.settingsShown) {
        this.closeSettings();
        return;
      }
      // 触摸侧没有右键，用长按作为菜单入口；鼠标右键仍走 onMouse。
      this.longFired = false;
      this.startLongPress();
      this.lastX = sx;
      this.lastY = sy;
      this.downX = sx;
      this.downY = sy;
      this.dragging = true;
      this.dragConfirmed = false;
      // 按下时的窗口位置也记下来：拖拽的弹簧目标 = 这个位置 + 指针增量
      this.downWinX = rect.left;
      this.downWinY = rect.top;
      return;
    }

    if (kind === 'move' && this.dragging) {
      // 超过阈值才认定拖拽：切到「被抓起」姿势，之后才开始跟手
      if (!this.dragConfirmed) {
        const totalX = Math.abs(sx - this.downX);
        const totalY = Math.abs(sy - this.downY);
        if (totalX < DRAG_THRESHOLD && totalY < DRAG_THRESHOLD) {
          return;
        }
        this.cancelLongPress();
        // 长按已经把菜单弹出来了，但用户其实是在拖：把菜单收掉，别让两个交互打架
        if (this.longFired && this.menuShown) {
          hilog.info(DOMAIN, TAG, 'drag started after long press -> close menu');
          this.longFired = false;
          this.closeMenu();
        }
        this.dragConfirmed = true;
        // 把按下点和当时的窗口位置一起交给页面：之后由页面按「指针屏幕增量」推目标，
        // 窗口被逐帧移动也不会污染坐标
        this.callPage(`dragStart(${this.downX},${this.downY},${this.downWinX},${this.downWinY})`);
      }
      this.lastX = sx;
      this.lastY = sy;
      // 窗口移动交给页面的弹簧跟随（顺带积累甩出速度），这里不直接 moveWindowTo
      this.callPage(`dragMove(${sx},${sy})`);
      return;
    }

    if (kind === 'up' || kind === 'cancel') {
      const wasDragging = this.dragConfirmed;
      const wasLong = this.longFired;
      this.cancelLongPress();
      this.dragging = false;
      this.dragConfirmed = false;
      this.longFired = false;
      if (wasDragging) {
        // 松手：页面据此决定是甩出去还是原地放下
        this.callPage('dragEnd()');
      } else if (!wasLong && kind === 'up') {
        this.handleTap(sx, sy, rect.left, rect.top, rect.width, rect.height);
      }
    }
  }

  /**
   * 抬手判定：点在气泡上就收气泡；点在头顶空白处什么都不做；
   * 点在宠物身体上才播点击回应。
   */
  private handleTap(sx: number, sy: number,
    winX: number, winY: number, winW: number, winH: number): void {
    if (winW <= 0 || winH <= 0) {
      return;
    }
    // 屏幕 px → 页面逻辑坐标（384x396），气泡矩形就是按这个坐标系上报的
    const lx = (sx - winX) * WIN_W / winW;
    const ly = (sy - winY) * WIN_H / winH;
    const bubble = PetBridge.bubbleRect;
    if (bubble && lx >= bubble.x - 6 && lx <= bubble.x + bubble.w + 6 &&
      ly >= bubble.y - 6 && ly <= bubble.y + bubble.h + 6) {
      this.runPage('window.petHideBubble && window.petHideBubble();');
      return;
    }
    // 气泡区（视频上方那一块）的空白处不触发宠物动作
    if (ly < WIN_PAD_TOP) {
      return;
    }
    this.callPage('click()');
  }

  /**
   * 画面窗自己的触摸兜底。
   *
   * 正常情况下画面窗被设成不可触摸，事件全部来自点击区窗口；如果哪天点击区
   * 没建起来，这里仍能保证宠物可点可拖。
   */
  private onTouchEvent(event: TouchEvent): void {
    const list = event.changedTouches.length > 0 ? event.changedTouches : event.touches;
    if (list.length === 0) {
      return;
    }
    const p = list[0];
    if (event.type === TouchType.Down) {
      this.lastTouchX = p.displayX;
      this.lastTouchY = p.displayY;
      this.handlePetEvent('down', p.displayX, p.displayY);
    } else if (event.type === TouchType.Move) {
      this.lastTouchX = p.displayX;
      this.lastTouchY = p.displayY;
      this.handlePetEvent('move', p.displayX, p.displayY);
    } else if (event.type === TouchType.Up) {
      this.handlePetEvent('up', this.lastTouchX, this.lastTouchY);
    } else if (event.type === TouchType.Cancel) {
      this.handlePetEvent('cancel', this.lastTouchX, this.lastTouchY);
    }
  }

  build() {
    Stack() {
      Web({ src: $rawfile('pet/index.html'), controller: this.controller })
        .fileAccess(true)
        .javaScriptAccess(true)
        .domStorageAccess(true)
        // ArkWeb 的 CSS 视口会比窗口物理像素小，但页面自己会按实际 innerWidth
        // 把逻辑场景缩放铺满，所以这里不要再设 initialScale，否则会和页面内
        // 的 transform 叠加，出现内容被推到窗口外的情况。
        .initialScale(100)
        .zoomAccess(false)
        .imageAccess(true)
        .mixedMode(MixedMode.All)
        .darkMode(WebDarkMode.Off)
        .forceDarkAccess(false)
        .javaScriptProxy({
          object: this.bridge,
          name: 'petHost',
          methodList: ['reportMotion', 'ready', 'onEventEnd', 'requestMove', 'reportBubble',
            'requestWhisper'],
          controller: this.controller
        })
        .backgroundColor(Color.Transparent)
        .width('100%')
        .height('100%')
        .onPageEnd(() => {
          hilog.info(DOMAIN, TAG, 'pet page loaded');
          this.pageLoaded = true;
          this.pendingConfig = this.loadAnimConfig(PetSettingsStore.load().petPack);
          this.injectConfig();
        })
        .onErrorReceive((ev) => {
          hilog.error(DOMAIN, TAG, 'web error: %{public}s', ev.error.getErrorInfo());
        })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Color.Transparent)
    .onTouch((e: TouchEvent) => this.onTouchEvent(e))
    .onMouse((e: MouseEvent) => {
      // 右键弹菜单。触摸事件里拿不到鼠标按键，所以单独监听鼠标。
      hilog.info(DOMAIN, TAG, 'mouse button=%{public}d action=%{public}d', e.button, e.action);
      if (e.button === MouseButton.Right && e.action === MouseAction.Press) {
        this.openMenu();
      }
    })
  }
}
