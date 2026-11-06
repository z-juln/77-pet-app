import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { display, window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { FloatWin } from '../common/FloatWin';
import { HitWin } from '../common/HitWin';
import { WIN_W, WIN_H, HIT_X, HIT_Y, HIT_W, HIT_H } from '../common/PetBridge';
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
    // 主窗口只作为 Ability 的载体存在，加载完立刻最小化，把桌面让给悬浮窗
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, TAG, 'loadContent failed: %{public}s', JSON.stringify(err));
        return;
      }
      windowStage.getMainWindow()
        .then((main) => main.minimize())
        .then(() => this.createFloatWindow())
        .catch((e: BusinessError) => {
          hilog.error(DOMAIN, TAG, 'getMainWindow failed: %{public}s', JSON.stringify(e));
        });
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
        const scale = PetSettingsStore.load().scale;
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
    let screenW = 1920;
    let screenH = 1080;
    try {
      const d = display.getDefaultDisplaySync();
      screenW = d.availableWidth > 0 ? d.availableWidth : d.width;
      screenH = d.availableHeight > 0 ? d.availableHeight : d.height;
    } catch (e) {
      const err = e as BusinessError;
      hilog.warn(DOMAIN, TAG, 'initialPosition display read failed: %{public}s', err.message);
    }
    const saved = PetSettingsStore.loadPosition();
    if (saved[0] !== -1 || saved[1] !== -1) {
      const x = Math.min(Math.max(saved[0], -Math.round(w * 0.45)), screenW - 64);
      const y = Math.min(Math.max(saved[1], 0), Math.max(0, screenH - 80));
      return [x, y];
    }
    return [
      Math.max(24, screenW - w - 48),
      Math.max(0, screenH - h - 24)
    ];
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
