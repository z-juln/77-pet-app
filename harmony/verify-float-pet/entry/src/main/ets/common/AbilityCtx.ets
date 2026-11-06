import { common } from '@kit.AbilityKit';

/**
 * UIAbilityContext 的全局持有者。
 *
 * 页面里用 getContext(this) 取到的不一定是 UIAbilityContext（实测退出时是 undefined），
 * 所以由 EntryAbility 在 onCreate 时把真正的 context 存进来，页面退出时直接用它。
 */
export class AbilityCtx {
  private static inst: common.UIAbilityContext | undefined = undefined;

  static set(ctx: common.UIAbilityContext): void {
    AbilityCtx.inst = ctx;
  }

  static get(): common.UIAbilityContext | undefined {
    return AbilityCtx.inst;
  }

  static clear(): void {
    AbilityCtx.inst = undefined;
  }
}
