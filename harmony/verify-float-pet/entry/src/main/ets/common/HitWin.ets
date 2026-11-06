import { window } from '@kit.ArkUI';

/** 透明点击区窗口的全局句柄，方便宠物窗口移动时带着它一起走。 */
export class HitWin {
  private static win: window.Window | undefined = undefined;

  static set(next: window.Window): void {
    HitWin.win = next;
  }

  static get(): window.Window | undefined {
    return HitWin.win;
  }

  static clear(): void {
    HitWin.win = undefined;
  }
}
