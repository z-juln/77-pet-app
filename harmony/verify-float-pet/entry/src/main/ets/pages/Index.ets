@Entry
@Component
struct Index {
  @StorageLink('pet77.floatError') floatError: string = '';

  build() {
    Column({ space: 12 }) {
      Text('77 Pet · 桌面桌宠')
        .fontSize(22)
        .fontWeight(FontWeight.Bold)

      if (this.floatError === '') {
        Text('悬浮窗创建中…（若长时间无反应，见 hilog 的 Pet77 日志）')
          .fontSize(14)
      } else {
        Text('悬浮窗创建失败')
          .fontSize(18)
          .fontColor(Color.Red)
        Text(this.floatError)
          .fontSize(14)
          .fontColor(Color.Red)
      }
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
  }
}
