/**
 * 设置面板：独立 TYPE_FLOAT 小窗，从右键菜单的「设置」打开。
 *
 * 所有改动即时生效（拖动滑块就能看到宠物缩放/透明度变化），关掉窗口即保存 ——
 * 没有「保存/取消」按钮，桌宠这种轻交互不该让用户记得点保存。
 */
import { hilog } from '@kit.PerformanceAnalysisKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { PetSettingsStore, PetSettings, DEFAULT_SETTINGS, SETTINGS_W } from '../common/PetSettings';
import { PetPacks, PetPackInfo } from '../common/PetPacks';
import { AbilityCtx } from '../common/AbilityCtx';

const DOMAIN = 0x7700;
const TAG = 'Pet77';

@Entry
@Component
struct SettingsPage {
  @State petPack: string = DEFAULT_SETTINGS.petPack;
  @State petScale: number = DEFAULT_SETTINGS.scale;
  @State petOpacity: number = DEFAULT_SETTINGS.opacity;
  @State moveWeight: number = DEFAULT_SETTINGS.moveWeight;
  @State stableMotion: boolean = DEFAULT_SETTINGS.stableMotion;
  @State whisperOn: boolean = DEFAULT_SETTINGS.whisperOn;
  @State whisperSec: number = DEFAULT_SETTINGS.whisperSec;
  @State llmOn: boolean = DEFAULT_SETTINGS.llmOn;
  @State llmBaseUrl: string = DEFAULT_SETTINGS.llmBaseUrl;
  @State llmModel: string = DEFAULT_SETTINGS.llmModel;
  @State llmApiKey: string = DEFAULT_SETTINGS.llmApiKey;
  /** 已保存提示：改完闪一下，让用户知道生效了（没有保存按钮，需要这个反馈） */
  @State savedAt: string = '';
  @State packs: Array<PetPackInfo> = [];

  aboutToAppear(): void {
    const s = PetSettingsStore.load();
    this.petPack = s.petPack;
    this.petScale = s.scale;
    this.petOpacity = s.opacity;
    this.moveWeight = s.moveWeight;
    this.stableMotion = s.stableMotion;
    this.whisperOn = s.whisperOn;
    this.whisperSec = s.whisperSec;
    this.llmOn = s.llmOn;
    this.llmBaseUrl = s.llmBaseUrl;
    this.llmModel = s.llmModel;
    this.llmApiKey = s.llmApiKey;
    const ctx = AbilityCtx.get();
    if (ctx) {
      this.packs = PetPacks.loadCatalog(ctx);
    }
    PetSettingsStore.pageReady = true;
  }

  /** 把当前值写回存储并通知宠物窗口 */
  private commit(): void {
    const next: PetSettings = {
      petPack: this.petPack,
      scale: this.petScale,
      opacity: this.petOpacity,
      moveWeight: this.moveWeight,
      stableMotion: this.stableMotion,
      whisperOn: this.whisperOn,
      whisperSec: this.whisperSec,
      llmOn: this.llmOn,
      llmBaseUrl: this.llmBaseUrl.trim(),
      llmModel: this.llmModel.trim(),
      llmApiKey: this.llmApiKey.trim()
    };
    PetSettingsStore.save(next);
    PetSettingsStore.pendingApply = true;
    const now = new Date();
    this.savedAt = `已保存 ${now.getHours().toString().padStart(2, '0')}:${
      now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    hilog.info(DOMAIN, TAG, 'settings changed: %{public}s', JSON.stringify(next));
  }

  /** 关掉设置窗（外层由 FloatPet 的轮询负责销毁窗口） */
  private close(): void {
    this.commit();
    const win = PetSettingsStore.getWindow();
    if (!win) {
      return;
    }
    // 先交还窗口句柄：WINDOW_INACTIVE 也可能走 FloatPet.closeSettings，
    // 不清掉会重复 destroy，日志里报一次“窗口状态异常”。
    PetSettingsStore.clearWindow();
    win.destroyWindow().catch((e: BusinessError) => {
      hilog.warn(DOMAIN, TAG, 'close settings failed: %{public}s', e.message);
    });
  }

  @Builder
  sectionTitle(text: string) {
    Text(text)
      .fontSize(12)
      .fontColor('#8a8a8a')
      .width('100%')
      .margin({ top: 14, bottom: 4 })
  }

  /** 一行「标签 + 当前值」 */
  @Builder
  valueRow(label: string, value: string) {
    Row() {
      Text(label)
        .fontSize(14)
        .fontColor('#1f1f1f')
      Blank()
      Text(value)
        .fontSize(14)
        .fontColor('#3a6ff5')
    }
    .width('100%')
    .margin({ top: 10 })
  }

  build() {
    Column() {
      // 标题栏
      Row() {
        Text('桌宠设置')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor('#1f1f1f')
        Blank()
        Text('✕')
          .fontSize(16)
          .fontColor('#8a8a8a')
          .padding(4)
          .onClick(() => this.close())
      }
      .width('100%')
      .height(40)
      .padding({ left: 16, right: 12 })

      Scroll() {
        Column() {
          this.sectionTitle('宠物')

          ForEach(this.packs, (pack: PetPackInfo) => {
            Row() {
              Column() {
                Text(pack.name)
                  .fontSize(14)
                  .fontWeight(this.petPack === pack.id ? FontWeight.Medium : FontWeight.Normal)
                  .fontColor(this.petPack === pack.id ? '#2b63ff' : '#1f1f1f')
                Text(pack.id)
                  .fontSize(10)
                  .fontColor('#9a9a9a')
                  .margin({ top: 2 })
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)

              if (this.petPack === pack.id) {
                Text('✓')
                  .fontSize(16)
                  .fontColor('#2b63ff')
              }
            }
            .width('100%')
            .padding({ top: 8, bottom: 8 })
            .onClick(() => {
              if (this.petPack === pack.id) {
                return;
              }
              this.petPack = pack.id;
              this.commit();
            })
          }, (pack: PetPackInfo) => pack.id)

          this.sectionTitle('外观')

          this.valueRow('大小', `${Math.round(this.petScale * 100)}%`)
          Slider({ value: this.petScale, min: 0.6, max: 1.4, step: 0.1 })
            .width('100%')
            .selectedColor('#3a6ff5')
            .onChange((v: number) => {
              this.petScale = v;
              this.commit();
            })

          this.valueRow('不透明度', `${Math.round(this.petOpacity * 100)}%`)
          Slider({ value: this.petOpacity, min: 0.3, max: 1, step: 0.05 })
            .width('100%')
            .selectedColor('#3a6ff5')
            .onChange((v: number) => {
              this.petOpacity = v;
              this.commit();
            })

          this.sectionTitle('行为')

          this.valueRow('走动的频率', this.moveWeight === 0 ? '不走动' : `${Math.round(this.moveWeight)}`)
          Slider({ value: this.moveWeight, min: 0, max: 30, step: 1 })
            .width('100%')
            .selectedColor('#3a6ff5')
            .onChange((v: number) => {
              this.moveWeight = v;
              this.commit();
            })

          Row() {
            Column() {
              Text('稳定待机')
                .fontSize(14)
                .fontColor('#1f1f1f')
              Text('静止时定格，避免模拟器整屏闪烁；真机建议关闭')
                .fontSize(11)
                .fontColor('#8a8a8a')
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Toggle({ type: ToggleType.Switch, isOn: this.stableMotion })
              .selectedColor('#3a6ff5')
              .onChange((on: boolean) => {
                this.stableMotion = on;
                this.commit();
              })
          }
          .width('100%')
          .margin({ top: 14 })

          Row() {
            Column() {
              Text('碎碎念')
                .fontSize(14)
                .fontColor('#1f1f1f')
              Text('按时随机说一句话（带表情包）')
                .fontSize(11)
                .fontColor('#8a8a8a')
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Toggle({ type: ToggleType.Switch, isOn: this.whisperOn })
              .selectedColor('#3a6ff5')
              .onChange((on: boolean) => {
                this.whisperOn = on;
                this.commit();
              })
          }
          .width('100%')
          .margin({ top: 14 })

          if (this.whisperOn) {
            this.valueRow('碎碎念间隔',
              this.whisperSec >= 60 ? `${Math.round(this.whisperSec / 60)} 分钟` : `${Math.round(this.whisperSec)} 秒`)
            Slider({ value: this.whisperSec, min: 30, max: 1800, step: 30 })
              .width('100%')
              .selectedColor('#3a6ff5')
              .onChange((v: number) => {
                this.whisperSec = v;
                this.commit();
              })
          }

          this.sectionTitle('AI 碎碎念')

          Row() {
            Column() {
              Text('用模型生成一句话')
                .fontSize(14)
                .fontColor('#1f1f1f')
              Text('关闭或没填 Key 时，使用宠物包自带文案')
                .fontSize(11)
                .fontColor('#8a8a8a')
                .margin({ top: 2 })
            }
            .alignItems(HorizontalAlign.Start)
            .layoutWeight(1)

            Toggle({ type: ToggleType.Switch, isOn: this.llmOn })
              .selectedColor('#3a6ff5')
              .onChange((on: boolean) => {
                this.llmOn = on;
                this.commit();
              })
          }
          .width('100%')
          .margin({ top: 14 })

          if (this.llmOn) {
            Text('接口地址')
              .fontSize(12)
              .fontColor('#6f6f6f')
              .width('100%')
              .margin({ top: 12 })
            TextInput({ text: this.llmBaseUrl, placeholder: 'https://api.openai.com/v1' })
              .fontSize(13)
              .width('100%')
              .onChange((v: string) => {
                this.llmBaseUrl = v;
              })
              .onBlur(() => this.commit())
              .onSubmit(() => this.commit())

            Text('模型')
              .fontSize(12)
              .fontColor('#6f6f6f')
              .width('100%')
              .margin({ top: 10 })
            TextInput({ text: this.llmModel, placeholder: 'gpt-4o-mini' })
              .fontSize(13)
              .width('100%')
              .onChange((v: string) => {
                this.llmModel = v;
              })
              .onBlur(() => this.commit())
              .onSubmit(() => this.commit())

            Text('API Key')
              .fontSize(12)
              .fontColor('#6f6f6f')
              .width('100%')
              .margin({ top: 10 })
            TextInput({ text: this.llmApiKey, placeholder: 'sk-...' })
              .type(InputType.Password)
              .fontSize(13)
              .width('100%')
              .onChange((v: string) => {
                this.llmApiKey = v;
              })
              .onBlur(() => this.commit())
              .onSubmit(() => this.commit())
          }

          Text(this.savedAt)
            .fontSize(11)
            .fontColor('#8a8a8a')
            .width('100%')
            .margin({ top: 16 })
        }
        .width('100%')
        .padding({ left: 16, right: 16, bottom: 16 })
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#f7f7f8')
    .borderRadius(12)
    .clip(true)
  }
}
