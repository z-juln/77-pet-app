import { hilog } from '@kit.PerformanceAnalysisKit';
import { PetMenu } from '../common/PetMenu';
import { MenuGroup, MenuLeaf } from '../common/AnimMenu';

const DOMAIN = 0x7700;
const TAG = 'Pet77';

/**
 * 右键菜单页面。
 *
 * 独立 TYPE_FLOAT 窗口承载 —— 宠物窗口只有 384x216，菜单塞进去会被裁掉。
 * 这里做成可滚动的列表：一级是分类，点进去看该分类下的动画，再点就播。
 *
 * 为什么不用 ArkUI 的 Menu/bindMenu：
 *   - MenuItem 只有 onChange 没有 onClick，实测点击不触发动作
 *   - bindContextMenu 只接受 CustomBuilder，不收 MenuElement 数组
 *   - 两种方式都受宿主窗口高度限制
 * 自己画列表反而最简单可控。
 */
@Entry
@Component
struct PetMenuPage {
  @State groups: Array<MenuGroup> = [];
  /** 空串 = 显示分类列表；否则显示该分类下的动画 */
  @State current: string = '';

  aboutToAppear(): void {
    this.groups = PetMenu.groups as Array<MenuGroup>;
    PetMenu.pageReady = true;
    hilog.info(DOMAIN, TAG, 'menu page ready, groups=%{public}d', this.groups.length);
  }

  private items(): Array<MenuLeaf> {
    for (const g of this.groups) {
      if (g.label === this.current) {
        return g.items;
      }
    }
    return [];
  }

  @Builder
  row(label: string, onTap: () => void, accent: boolean) {
    Text(label)
      .fontSize(14)
      .fontColor(accent ? '#2b63ff' : '#2b2b2b')
      .width('100%')
      .padding({ left: 14, right: 14, top: 10, bottom: 10 })
      .onClick(onTap)
  }

  build() {
    Column() {
      if (this.current === '') {
        List() {
          ForEach(this.groups, (g: MenuGroup) => {
            ListItem() {
              this.row(`${g.label}（${g.items.length}）`, () => {
                this.current = g.label;
              }, false)
            }
          }, (g: MenuGroup) => g.label)
        }
        .layoutWeight(1)
      } else {
        List() {
          ListItem() {
            this.row('← 返回', () => {
              this.current = '';
            }, true)
          }
          ForEach(this.items(), (leaf: MenuLeaf) => {
            ListItem() {
              this.row(leaf.label, () => {
                PetMenu.requestPlay(leaf.file);
                this.current = '';
              }, false)
            }
          }, (leaf: MenuLeaf) => leaf.file)
        }
        .layoutWeight(1)
      }
      Divider().color('#e0e0e0')
      this.row('碎碎念', () => {
        PetMenu.requestWhisper();
      }, false)
      Divider().color('#e0e0e0')
      this.row('回到桌面右下角', () => {
        PetMenu.requestHome();
      }, false)
      Divider().color('#e0e0e0')
      this.row('设置', () => {
        PetMenu.requestSettings();
      }, false)
      Divider().color('#e0e0e0')
      this.row('退出桌宠', () => {
        PetMenu.requestQuit();
      }, false)
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#ffffff')
    .borderRadius(10)
    .border({ width: 1, color: '#1a000000' })
    .shadow({ radius: 18, color: '#33000000', offsetY: 6 })
  }
}
