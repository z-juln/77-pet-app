# 77 Pet 安卓版（车机 + 手机）

同一 APK。运行时识别设备：车机走现有 BYD 车机行为；明确为手机时用手机文案与布局。

## 构建

```bash
./build-apk.sh
```

输出：

```text
android/dist/77.Pet-0.0.6-byd-car.apk
```

依赖本机 Android SDK 和 JDK 17。默认读取：

```text
/opt/homebrew/share/android-commandlinetools
/opt/homebrew/opt/openjdk@17
```

## 安装

车机打开开发者模式和 USB / 无线调试，连接后执行：

```bash
./install-apk.sh
```

或者手动安装：

```bash
adb install -r dist/77.Pet-0.0.6-byd-car.apk
adb shell appops set app.pet77.car SYSTEM_ALERT_WINDOW allow
adb shell am start -n app.pet77.car/.MainActivity
```

第一次打开需要在系统里允许「显示在其他应用上层」。部分 BYD 车机还会限制后台服务，需要在系统设置里允许 77 Pet 自启动或加入后台白名单。

## 交互

- 拖动宠物：按住身体移动，松手按拖动速度甩出去，带重力、边缘反弹和落地 Q 弹。
- 点击宠物：随机播放一次点击回应，并压扁回弹。
- 长按宠物或鼠标右键：打开菜单。
- 菜单：碎碎念、动作（待机 / 转向 / 拖拽 / 点击回应 / 移动 / 分类动作 / 事件动画）、切换宠物、回到初始位置、设置、关于、退出桌宠。
- 自动行为：待机、转向、随机走动、自动碎碎念。

设置里可以改宠物、大小、透明度、自动碎碎念开关和间隔、自动走动频率。个别车机持续合成透明视频会闪屏时，可以打开「稳定待机」。主界面和菜单都有「关于」入口。

## 实现说明

- 画面用 WebView 渲染宠物包里的透明 WebM，状态机在 `assets/pet/index.html`，与鸿蒙版同源。
- 宠物素材构建时从 `harmony/verify-float-pet/entry/src/main/resources/rawfile/pet/packs` 同步，不复制进安卓目录。
- 碎碎念只用宠物包自带的本地文案和表情包，不调用模型。网络仅用于检查/下载应用更新。
- 「关于」可检查 GitHub Release、下载 `*-byd-car.apk` 并调起安装；素材来源说明含 GitHub / Gitee。
- 悬浮窗只移动位置，不逐帧改窗口形状或大小，避免车机 GPU 整屏闪烁。

