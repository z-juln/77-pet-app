# 77-pet-app

macOS、Windows、HarmonyOS、安卓（BYD 车机 / 手机）与 Chrome / Edge 网页桌宠。素材禁止商用。

桌宠资源不放在这个仓库里，放在 [77-pet-packs](https://github.com/z-juln/77-pet-packs)。安装后第一次打开会拉取默认模板；GitHub 没有及时响应时自动改用 [Gitee 镜像](https://gitee.com/juln/77-pet-packs)。其余模板在配置里按需下载。Gitee 不一定是最新的。

开发与发布规则见 [DEVELOPMENT.md](DEVELOPMENT.md)。每个正式版本都必须同时发布 macOS、Windows、HarmonyOS、BYD 安卓车机和 Chrome / Edge 安装包。

## 网页桌宠

Chrome / Edge 插件在 `browser-extension`。执行 `npm run web:build` 后，在浏览器扩展页加载 `browser-extension/dist`。详见 [browser-extension/README.md](browser-extension/README.md)。

## 安卓版（BYD 车机 + 手机）

安卓版在 `android`。同一 APK，运行时区分车机与手机。拖动、甩动、重力反弹、自动走动、点击回应、自动碎碎念和动作菜单都在。

```bash
cd android
./build-apk.sh
```

安装包输出到 `android/dist/77.Pet-<版本号>-byd-car.apk`。连接设备后也可以直接执行：

```bash
cd android
./install-apk.sh
```

第一次打开需要允许「显示在其他应用上层」；部分车机还需要在系统设置里允许自启动或关闭后台限制，否则系统会把桌宠服务回收。

右键/长按菜单包含：碎碎念、动作分类点播、切换宠物、回到初始位置、设置、关于、退出桌宠。主界面也有关于入口，可检查更新并下载安装 APK。
