@Entry
@Component
struct Index {
  build() {
    // 这个页面只作为 Ability 的载体，不能出现任何可见内容。
    // 悬浮窗创建失败时把原因写进 hilog（TAG=Pet77），不再弹主窗口。
    Stack()
      .width('100%')
      .height('100%')
      .backgroundColor(Color.Transparent)
  }
}
