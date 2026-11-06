import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { FloatWin } from '../common/FloatWin';
import { HitWin } from '../common/HitWin';
import {
  WIN_W,
  WIN_H,
  HIT_X,
  HIT_Y,
  HIT_W,
  HIT_H,
  petScreenScale,
  getWallpaperSize,
  clampPetWindow
} from '../common/PetBridge';
import { AbilityCtx } from '../common/AbilityCtx';
import { PetPacks } from '../common/PetPacks';
import { PetSettingsStore } from '../common/PetSettings';

const DOMAIN = 0x7700;
const TAG = 'Pet77';

/**
 * 77 Pet 鸿蒙版入口。
 *
 * 形态：主窗口最小化，只保留两个透明无边框的 TYPE_FLOAT 悬浮窗：
 *   1. 宠物画面窗（384x396）—— 只负责显示，完全不吃鼠标；
 *   2. 点击区窗（240x396）—— 完全透明，只接宠物身体附近的触摸和右键。
 *
 * 为什么拆成两个窗：给 TYPE_FLOAT 设置窗口形状（setWindowMask）会让系统重新合成
 * 整个桌面，宠物每次换动作都会整屏黑一帧。拆开后显示窗永远不碰窗口形状，
 * 点击则由另一块普通透明窗负责，两边都不再触发整屏重绘。
 */
export default class EntryAbility extends UIAbility {
  private floatWin: window.Window | undefined = undefined;
  private hitWin: window.Window | undefined = undefined;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, TAG, 'onCreate');
    AbilityCtx.set(this.context);
    PetSettingsStore.init(this.context);
  }

  onDestroy(): void {
    AbilityCtx.clear();
    PetSettingsStore.flushPosition();
    const hit = HitWin.get();
    HitWin.clear();
    if (hit) {
      hit.destroyWindow().catch((e: BusinessError) => {
        hilog.warn(DOMAIN, TAG, 'destroy hit window in onDestroy failed: %{public}s', e.message);
      });
    }
    this.hitWin = undefined;
    this.floatWin = undefined;
    FloatWin.clear();
    hilog.info(DOMAIN, TAG, 'onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // 主窗口只作为 Ability 的载体存在。它无法被销毁，所以加载一个透明的空页面，
    // 等窗口状态正常后再缩成透明的小点并最小化 —— 从任务栏恢复也不会弹出任何界面。
    const main = windowStage.getMainWindowSync();
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, TAG, 'loadContent failed: %{public}s', JSON.stringify(err));
        return;
      }
      this.hideMainWindow(main)
        .then(() => main.minimize())
        .then(() => this.createFloatWindow())
        .catch((e: BusinessError) => {
          hilog.error(DOMAIN, TAG, 'minimize main window failed: %{public}s', JSON.stringify(e));
          // 最小化失败也要把悬浮窗建起来，主窗口本身已经是不可见的小点
          this.createFloatWindow();
        });
    });
  }

  /** 把主窗口做成不可见、不可点、不可聚焦的 1x1 透明窗口 */
  private hideMainWindow(main: window.Window): Promise<void> {
    try {
      main.setWindowBackgroundColor('#00000000');
      main.setWindowDecorVisible(false);
      main.setWindowShadowRadius(0);
      main.setWindowCornerRadius(0);
    } catch (e) {
      const err = e as BusinessError;
      hilog.warn(DOMAIN, TAG, 'style main window failed: %{public}s', err.message);
    }
    return Promise.all([
      main.setWindowTouchable(false).catch((e: BusinessError) => {
        hilog.warn(DOMAIN, TAG, 'untouchable main window failed: %{public}s', e.message);
      }),
      main.setWindowFocusable(false).catch((e: BusinessError) => {
        hilog.warn(DOMAIN, TAG, 'unfocusable main window failed: %{public}s', e.message);
      }),
      main.resize(1, 1).catch((e: BusinessError) => {
        hilog.warn(DOMAIN, TAG, 'resize main window failed: %{public}s', e.message);
      }),
      main.moveWindowTo(-10000, -10000).catch((e: BusinessError) => {
        hilog.warn(DOMAIN, TAG, 'move main window failed: %{public}s', e.message);
      })
    ]).then(() => {
      // Promise.all 的元素已经各自吞掉错误，这里只保证顺序
    });
  }

  private createFloatWindow(): void {
    // 窗口 showWindow() 之后立刻读 windowRect 可能还是 1x1 的初始值，
    // 所以这里把算好的尺寸和位置直接传给点击区，不再二次查询。
    let winX = 0;
    let winY = 0;
    let winW = WIN_W;
    let winH = WIN_H;
    const config: window.Configuration = {
      name: 'pet77_float',
      windowType: window.WindowType.TYPE_FLOAT,
      ctx: this.context
    };

    window.createWindow(config)
      .then((win: window.Window) => {
        this.floatWin = win;
        FloatWin.set(win);
        hilog.info(DOMAIN, TAG, 'TYPE_FLOAT created, id=%{public}d',
          win.getWindowProperties().id);
        return win.setUIContent('pages/FloatPet');
      })
      .then(() => {
        const win = this.floatWin;
        if (!win) {
          return Promise.resolve();
        }
        const scale = PetSettingsStore.load().scale * petScreenScale();
        winW = Math.round(WIN_W * scale);
        winH = Math.round(WIN_H * scale);
        return win.resize(winW, winH)
          .then(() => {
            const pos = this.initialPosition(winW, winH);
            winX = pos[0];
            winY = pos[1];
            return win.moveWindowTo(winX, winY);
          });
      })
      .then(() => this.applyWindowSurface())
      .then(() => {
        const win = this.floatWin;
        if (!win) {
          return;
        }
        win.showWindow();
        // 显示层只负责画面，完全不接鼠标；透明区域可以直接点到桌面。
        win.setWindowTouchable(false);
        hilog.info(DOMAIN, TAG, 'float window shown');
        this.createHitWindow(winX, winY, winW);
      })
      .catch((e: BusinessError) => {
        // 201 = 权限校验失败（ACL 未授予）；801 = 设备不支持；1300004 = 窗口类型非法
        hilog.error(DOMAIN, TAG, 'create float window FAILED code=%{public}d msg=%{public}s',
          e.code, e.message);
        this.reportFailure(e);
      });
  }

  /**
   * 点击区窗口。
   *
   * 它是一块完全透明的普通窗口，不设任何窗口形状；只覆盖宠物身体及其头顶气泡
   * 所在的那一竖条（逻辑 240x396，左右各留 72 给桌面点穿）。接到的触摸和右键
   * 通过内存队列转给宠物窗口处理。
   */
  private createHitWindow(winX: number, winY: number, winW: number): void {
    const s = winW / WIN_W;
    const w = Math.max(1, Math.round(HIT_W * s));
    const h = Math.max(1, Math.round(HIT_H * s));
    const x = Math.round(winX + HIT_X * s);
    const y = Math.round(winY + HIT_Y * s);

    const config: window.Configuration = {
      name: 'pet77_hit',
      windowType: window.WindowType.TYPE_FLOAT,
      ctx: this.context
    };
    window.createWindow(config)
      .then((win: window.Window) => {
        this.hitWin = win;
        return win.setUIContent('pages/HitArea')
          .then(() => {
            win.setWindowBackgroundColor('#00000000');
            win.setWindowDecorVisible(false);
            win.setWindowShadowRadius(0);
            win.setWindowCornerRadius(0);
            // 不抢焦点：点宠物不会把你正在用的窗口切走
            return win.setWindowFocusable(false);
          })
          .then(() => win.resize(w, h))
          .then(() => win.moveWindowTo(x, y))
          .then(() => {
            win.showWindow();
            HitWin.set(win);
            hilog.info(DOMAIN, TAG, 'hit window shown at %{public}d,%{public}d %{public}dx%{public}d',
              x, y, w, h);
          });
      })
      .catch((e: BusinessError) => {
        hilog.error(DOMAIN, TAG, 'create hit window FAILED code=%{public}d msg=%{public}s',
          e.code, e.message);
      });
  }

  /**
   * 启动位置：优先恢复上次位置；第一次打开放在右下角，离任务栏留一点距离。
   * 保存的位置可能来自更小的屏幕，所以按当前屏幕范围做一次收敛。
   */
  private initialPosition(w: number, h: number): Array<number> {
    const screen = getWallpaperSize();
    const screenW = screen[0];
    const screenH = screen[1];
    const insets = PetPacks.loadContentInsets(this.context, PetSettingsStore.load().petPack);
    const saved = PetSettingsStore.loadPosition();
    if (saved[0] !== -1 || saved[1] !== -1) {
      return clampPetWindow(saved[0], saved[1], w, h, screenW, screenH, insets);
    }
    return clampPetWindow(screenW - w - 48, screenH - h - 24, w, h, screenW, screenH, insets);
  }

  /**
   * 去掉窗口自带的"卡片"外观：透明底、无装饰、无阴影、无圆角。
   * 注意这里不再调用 setWindowMask —— 每次改窗口形状都会让系统重合成整个桌面。
   */
  private async applyWindowSurface(): Promise<void> {
    const win = this.floatWin;
    if (!win) {
      return;
    }
    win.setWindowBackgroundColor('#00000000');
    win.setWindowDecorVisible(false);
    win.setWindowShadowRadius(0);
    win.setWindowCornerRadius(0);
  }

  /** 失败时把错误码写回主窗口并显示出来，方便一眼看出卡在哪一步 */
  private reportFailure(e: BusinessError): void {
    window.getLastWindow(this.context)
      .then((main) => {
        main.showWindow()
          .then(() => {
            AppStorage.setOrCreate('pet77.floatError', `code=${e.code} ${e.message}`);
          });
      })
      .catch(() => {
        hilog.error(DOMAIN, TAG, 'reportFailure: cannot show main window');
      });
  }
}
