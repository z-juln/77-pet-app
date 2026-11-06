import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { AnimConfig } from './AnimMenu';
import { AlphaMask, PetContentInsets, DEFAULT_PET_CONTENT_INSETS } from './PetBridge';

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

  /**
   * 可见角色在视频画布里的内缩比例。
   * 用待机动画的轮廓作为身体范围，避免把大片透明留白和偶尔冲出画面的特效算成身体。
   */
  static loadContentInsets(ctx: common.UIAbilityContext, pack: string): PetContentInsets {
    const cfg = PetPacks.loadAnimConfig(ctx, pack);
    if (!cfg || !cfg.idle || cfg.idle.length === 0) {
      return DEFAULT_PET_CONTENT_INSETS;
    }
    const masks = PetPacks.loadMasks(ctx, pack);
    const mask = masks.get(cfg.idle[0]);
    if (!mask || mask.rows.length === 0) {
      return DEFAULT_PET_CONTENT_INSETS;
    }
    let minX = mask.w;
    let minY = mask.h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < mask.rows.length; y++) {
      const row = mask.rows[y];
      for (let x = 0; x < mask.w; x++) {
        const digit = parseInt(row.charAt(x >> 2), 16);
        if (((digit >> (3 - (x & 3))) & 1) === 1) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (maxX < 0 || maxY < 0) {
      return DEFAULT_PET_CONTENT_INSETS;
    }
    return {
      left: minX / mask.w,
      top: minY / mask.h,
      right: 1 - (maxX + 1) / mask.w,
      bottom: 1 - (maxY + 1) / mask.h
    };
  }
}
