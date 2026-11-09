# 开发手册

## 发布规则

每个正式版本号必须一次发布所有平台的安装包。不能因为某个平台这次没有功能变化，就只发布其他平台的安装包。

电脑端更新检查读取的是 GitHub 上最新的正式 Release，再按当前系统挑选安装包。如果最新 Release 缺少某个平台的安装包，这个平台仍会看到新版本提醒，但点更新后会提示没有对应安装包。因此，部分发布属于无效发布。

每个正式版本必须包含：

| 平台 | 安装包 |
| --- | --- |
| macOS Apple Silicon | `77.Pet-<版本号>-arm64.dmg` |
| macOS Intel | `77.Pet-<版本号>.dmg` |
| Windows x64 | `77.Pet.Setup.<版本号>.exe` |
| HarmonyOS | `77.Pet-<版本号>-harmony-unsigned.hap` |
| Chrome / Edge | `77.Pet-<版本号>-web-extension.zip` |

## 发布步骤

1. 统一版本号：
   - `package.json`
   - `package-lock.json`
   - `harmony/verify-float-pet/AppScope/app.json5`
   - 鸿蒙 `versionCode` 使用 `1000000 + 主版本 × 10000 + 次版本 × 100 + 修订版本`
2. 更新 `CHANGELOG.md`，写清各平台变化；没有功能变化的平台也要注明同步发布。
3. 构建全部安装包：

   ```bash
   npm run dist
   npm run web:pack
   cd harmony/verify-float-pet
   ./run.sh release
   ```

4. 检查每个包的版本号。以下检查必须全部通过：

   ```bash
   # macOS 应用包
   plutil -p "/Volumes/77 Pet/77 Pet.app/Contents/Info.plist" | rg "CFBundleShortVersionString"

   # HarmonyOS
   unzip -p dist/pet77-<版本号>-unsigned.hap module.json | rg '"versionName"'
   ```

5. 创建 GitHub Release 时，一次上传全部平台安装包。不要先发布一个平台，之后再补。
6. 发布后检查 Release 资产列表，确认五个安装包都存在、文件名含正确版本号、上传状态已完成。
7. 确认全部资产上传完成，再通知用户更新。

## 禁止事项

- 不要只上传 macOS 或只上传 HarmonyOS。
- 不要用不带平台安装包的空 Release 触发电脑端更新提醒。
- 不要在 Release 资产未上传完成时对外宣布新版本。
- 不要把本机签名配置、证书或私钥提交到仓库或上传到 Release。
