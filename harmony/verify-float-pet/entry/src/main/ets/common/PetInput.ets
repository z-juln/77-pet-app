export interface PetInputEvent {
  kind: string;
  x: number;
  y: number;
}

/**
 * 点击区窗口 → 宠物窗口的事件队列。
 *
 * 两个窗口在同一个应用进程里，但不能互相拿页面实例，所以用这个极小的
 * 内存队列转发按下、移动、抬起和右键。队列上限很短，拖拽时只会合并掉
 * 来不及消费的中间移动点，不会丢最后一次抬手。
 */
export class PetInput {
  private static queue: Array<PetInputEvent> = [];

  static push(kind: string, x: number, y: number): void {
    if (PetInput.queue.length >= 32) {
      PetInput.queue.shift();
    }
    PetInput.queue.push({ kind: kind, x: x, y: y });
  }

  static take(): PetInputEvent | null {
    const next = PetInput.queue.shift();
    return next ?? null;
  }
}
