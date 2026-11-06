import { PetInput } from '../common/PetInput';

/**
 * 透明点击区。
 *
 * 显示层窗口不接收鼠标，避免整窗挡住桌面；这个更小的窗口负责接住宠物身体
 * 附近的触摸和右键，再把屏幕坐标转给宠物窗口处理。页面本身完全不画东西。
 */
@Entry
@Component
struct HitArea {
  /** 抬手事件偶尔只带 changedTouches，这里记住最后一次坐标兜底 */
  private lastX: number = 0;
  private lastY: number = 0;

  build() {
    Stack()
      .width('100%')
      .height('100%')
      .backgroundColor(Color.Transparent)
      .onTouch((event: TouchEvent) => {
        const list = event.changedTouches.length > 0 ? event.changedTouches : event.touches;
        if (list.length === 0) {
          return;
        }
        const p = list[0];
        if (event.type === TouchType.Down || event.type === TouchType.Move) {
          this.lastX = p.displayX;
          this.lastY = p.displayY;
        }
        const x = event.type === TouchType.Down || event.type === TouchType.Move
          ? p.displayX : this.lastX;
        const y = event.type === TouchType.Down || event.type === TouchType.Move
          ? p.displayY : this.lastY;
        if (event.type === TouchType.Down) {
          PetInput.push('down', x, y);
        } else if (event.type === TouchType.Move) {
          PetInput.push('move', x, y);
        } else if (event.type === TouchType.Up) {
          PetInput.push('up', x, y);
        } else if (event.type === TouchType.Cancel) {
          PetInput.push('cancel', x, y);
        }
      })
      .onMouse((event: MouseEvent) => {
        if (event.button === MouseButton.Right && event.action === MouseAction.Press) {
          PetInput.push('right', 0, 0);
        }
      })
  }
}
