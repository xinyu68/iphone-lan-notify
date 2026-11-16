# 第三方组件与资源

- **libheif-js 1.23.5 / libheif / libde265**：用于 HEIC/HEIF 本机解码，遵循其 LGPL 条款。发行包保留 `node_modules/libheif-js/LICENSE`、`node_modules/libheif-js/libheif-wasm/LICENSE`，并在 `licenses/codec-sources` 附带对应源码和构建脚本。模块未修改，可用兼容版本替换；本项目许可不限制用户为调试这些 LGPL 组件的修改而进行逆向工程。版本、源码提交及构建方法见 [HEIC 组件说明](docs/HEIC-CODECS.md) 和 `codec-sources.json`。
- **pngjs 7.0.0**：MIT，用于将解码像素写为 PNG；许可保留在发行包 `node_modules/pngjs/LICENSE`。

项目自有源代码采用 MIT 许可证；以下第三方组件、应用图标、名称和商标不因本项目的 LICENSE 改变其许可或权利归属。

- **Node.js**：发行包在 `runtime/LICENSE` 中附带官方许可及所含第三方声明。下载版本和官方发行包 SHA-256 固定在 `node-runtime.json`；运行时不提交到源码仓库。
- **Microsoft Edge WebView2 SDK**：版本、NuGet 来源及 SHA-256 见 `webview2-dependency.json`，按 Microsoft 提供的许可条款分发其运行所需库。SDK 包内的许可文件保存在发行包 `licenses` 目录。
- **Microsoft Edge WebView2 Runtime / .NET Framework**：由 Microsoft 提供，遵循其相应条款。WebView2 Runtime 缺失时从 Microsoft 官方渠道安装；本项目不修改系统运行时。
- **30 个内置 App 图标**：来自 Apple App Store 返回的应用开发者图稿，用于辨识手机通知来源；应用图标、名称与商标归各自权利人所有，不属于本项目 MIT 授权范围。商店条目、开发者、原始 CDN URL、取得时间和 SHA-256 见 `app-icon-catalog.json`。本项目与 Apple 或这些应用开发者不存在官方关联。Apple 接口说明：https://performance-partners.apple.com/search-api
- **Scriptable 与 iOS 快捷指令**：用户自行安装并按其各自条款使用；本项目只提供转发脚本和配置说明。

如需重新分发资源或用于其他用途，应自行确认相应组件与图稿的使用条件。
