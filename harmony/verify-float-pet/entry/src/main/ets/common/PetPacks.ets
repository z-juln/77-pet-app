import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { AnimConfig } from './AnimMenu';
import { AlphaMask } from './PetBridge';

const DOMAIN = 0x7700;
const TAG = 'Pet77';

/** 宠物包目录里随包发布的一份元数据 */
export interface PetPackInfo {
  id: string;
  name: string;
  preview: string;
  size?: number;
}

interface PetPackCatalog {
  default: string;
  pets: Array<PetPackInfo>;
}

/**
 * 宠物包资源入口。
 *
 * 所有包共用同一个 index.html 和窗口逻辑，只是素材根目录不同：
 *   resource://rawfile/pet/packs/<id>/webm/...
 *
 * 这样切换宠物不需要重启 Ability，也不需要复制一套页面代码。
 */
export class PetPacks {
  private static catalog: Array<PetPackInfo> = [];

  static loadCatalog(ctx: common.UIAbilityContext): Array<PetPackInfo> {
    if (PetPacks.catalog.length > 0) {
      return PetPacks.catalog;
    }
    try {
      const bytes = ctx.resourceManager.getRawFileContentSync('pet/packs.json');
      const text = util.TextDecoder.create('utf-8').decodeToString(bytes);
      const parsed = JSON.parse(text) as PetPackCatalog;
      PetPacks.catalog = parsed.pets ?? [];
    } catch (e) {
      const err = e as BusinessError;
      hilog.error(DOMAIN, TAG, 'load pack catalog failed: %{public}s', err.message);
    }
    return PetPacks.catalog;
  }

  static defaultPack(ctx: common.UIAbilityContext): string {
    const list = PetPacks.loadCatalog(ctx);
    return list.length > 0 ? list[0].id : 'blue-maid';
  }

  static hasPack(ctx: common.UIAbilityContext, id: string): boolean {
    return PetPacks.loadCatalog(ctx).some((p) => p.id === id);
  }

  static loadAnimConfig(ctx: common.UIAbilityContext, pack: string): AnimConfig | null {
    try {
      const bytes = ctx.resourceManager.getRawFileContentSync(
        `pet/packs/${pack}/anim-config.json`);
      const text = util.TextDecoder.create('utf-8').decodeToString(bytes);
      return JSON.parse(text) as AnimConfig;
    } catch (e) {
      const err = e as BusinessError;
      hilog.error(DOMAIN, TAG, 'load anim config for %{public}s failed: %{public}s',
        pack, err.message);
      return null;
    }
  }

  static loadMasks(ctx: common.UIAbilityContext, pack: string): Map<string, AlphaMask> {
    const out = new Map<string, AlphaMask>();
    try {
      const bytes = ctx.resourceManager.getRawFileContentSync(
        `pet/packs/${pack}/alpha-masks.json`);
      const text = util.TextDecoder.create('utf-8').decodeToString(bytes);
      const parsed = JSON.parse(text) as Record<string, AlphaMask>;
      for (const key of Object.keys(parsed)) {
        out.set(key, parsed[key]);
      }
    } catch (e) {
      const err = e as BusinessError;
      hilog.error(DOMAIN, TAG, 'load alpha masks for %{public}s failed: %{public}s',
        pack, err.message);
    }
    return out;
  }
}
