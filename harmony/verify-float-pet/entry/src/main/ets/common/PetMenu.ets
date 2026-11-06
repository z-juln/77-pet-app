/**
 * 右键菜单窗口的全局状态与桥接。
 *
 * 为什么要独立窗口：菜单渲染在 384x216 的宠物悬浮窗里会被窗口高度裁掉
 * （实测 13 项分类只显示得出 4 项，翻页也点不到）。独立开一个足够高的
 * TYPE_FLOAT 窗口承载菜单，就能完整显示，而且菜单不会因为宠物窗口小而缩水。
 */
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';

const DOMAIN = 0x7700;
const TAG = 'Pet77';

/** 菜单窗口尺寸 */
export const MENU_W = 240;
export const MENU_H = 680;

export class PetMenu {
  /** 菜单窗口实例，由 EntryAbility 创建后写入 */
  private static win: window.Window | undefined = undefined;

  /** 菜单页面是否已加载完 */
  static pageReady: boolean = false;

  /** 待显示的菜单数据（分组），页面加载完后由页面取走 */
  static groups: Array<Object> = [];
  /** 菜单显示时的屏幕坐标（相对宠物窗口） */
  static anchorX: number = 0;
  static anchorY: number = 0;

  static setWindow(win: window.Window): void {
    PetMenu.win = win;
  }

  static getWindow(): window.Window | undefined {
    return PetMenu.win;
  }

  static clearWindow(): void {
    PetMenu.win = undefined;
    PetMenu.pageReady = false;
  }

  /** 打开菜单：把分组数据交出去，页面自己渲染 */
  static open(groups: Array<Object>, x: number, y: number): void {
    PetMenu.groups = groups;
    PetMenu.anchorX = x;
    PetMenu.anchorY = y;
  }

  /** 页面点了某一项：把素材名转给宠物窗口去播 */
  static pendingPlay: string = '';

  static requestPlay(file: string): void {
    PetMenu.pendingPlay = file;
    hilog.info(DOMAIN, TAG, 'menu request play: %{public}s', file);
  }

  static requestQuit(): void {
    PetMenu.pendingPlay = '__quit__';
    hilog.info(DOMAIN, TAG, 'menu request quit');
  }

  /** 菜单里点了「设置」：由 FloatPet 开设置窗口 */
  static requestSettings(): void {
    PetMenu.pendingPlay = '__settings__';
    hilog.info(DOMAIN, TAG, 'menu request settings');
  }

  static requestWhisper(): void {
    PetMenu.pendingPlay = '__whisper__';
    hilog.info(DOMAIN, TAG, 'menu request whisper');
  }

  static requestHome(): void {
    PetMenu.pendingPlay = '__home__';
    hilog.info(DOMAIN, TAG, 'menu request home');
  }
}
