import { window } from '@kit.ArkUI';

/** 悬浮窗实例的全局持有者：页面里需要它来做拖拽（moveWindowTo），Ability 创建后写入 */
export class FloatWin {
  private static inst: window.Window | undefined = undefined;

  static set(win: window.Window): void {
    FloatWin.inst = win;
  }

  static get(): window.Window | undefined {
    return FloatWin.inst;
  }

  static clear(): void {
    FloatWin.inst = undefined;
  }
}
