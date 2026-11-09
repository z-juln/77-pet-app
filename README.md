# 77-pet-app

macOS、Windows 与 HarmonyOS 桌宠。素材禁止商用。

桌宠资源不放在这个仓库里，放在 [77-pet-packs](https://github.com/z-juln/77-pet-packs)。安装后第一次打开会拉取默认模板；GitHub 没有及时响应时自动改用 [Gitee 镜像](https://gitee.com/juln/77-pet-packs)。其余模板在配置里按需下载。Gitee 不一定是最新的。

开发与发布规则见 [DEVELOPMENT.md](DEVELOPMENT.md)。每个正式版本都必须同时发布 macOS、Windows、HarmonyOS 和 Chrome / Edge 安装包。

## 网页桌宠

Chrome / Edge 插件在 `browser-extension`。执行 `npm run web:build` 后，在浏览器扩展页加载 `browser-extension/dist`。详见 [browser-extension/README.md](browser-extension/README.md)。
