# 开发与验证

## 组成

- `PhoneNotify.cs` / `DesktopSettings.cs` / `ConnectionSettings.cs`：WinForms 托盘与 WebView2 本地设置，接收开关、网络配置和登录自启。
- `AppEnvironment.cs` / `runtime-paths.cjs`：本机配置、数据目录、随机令牌和运行时选择；兼容已有根目录配置。
- `receiver.cjs`：局域网 HTTP 接收，32 KiB 请求限制，异步显示后写入本地记录。
- `notification-workers.cjs`：管理 WPF 卡片与 PowerShell/WinRT 通知中心子进程，异常时恢复。
- `NotificationPopup.cs`：卡片、堆叠和点击打开；最多同时三张，其余排队。
- `NativeNotifications.cs` / `NotificationActivation.cs`：Windows 通知来源注册、ICO、COM 激活和定位。点击卡片清除精确匹配的系统记录，不删除应用历史。
- `app-icon-catalog.*` / `app-icon-cache.cjs`：内置身份与资源、通用在线匹配及缓存。
- `public`：仅供桌面 WebView2 使用的本地 UI，不对手机提供设置网页。旧 `/setup/<token>` 返回 410。

## 通知接口

```http
POST http://<电脑IPv4>:18766/notify/<本机配对令牌>
Content-Type: application/json

{"appId":"com.tencent.xin","appName":"微信","title":"发送人","body":"通知正文"}
```

也兼容 `{"message":"标题\n正文","appId":"微信"}`。手机生成脚本使用后一种形式。传入的值仅按文字显示；来源名称用于通知归属，Bundle ID 优先用于图标匹配。

成功返回 `{"ok":true,"id":"<16位编号>","accepted":true}`，表示已接收；显示由后台完成，状态随后变为 `shown` 或 `failed`。`GET /health` 不返回通知内容；带令牌的 `status`、`history-check`、`popup-check` 等接口供本机诊断。令牌相当于访问凭据，勿公开。

## 测试

`npm test` 不需要真实手机、不请求真实商店，覆盖格式、历史、缓存、30 个内置图标、Scriptable 失败静默，以及新的数据目录/运行时/首次配置行为。Windows 上会编译独立的环境探针测试实际 C# 配置初始化。

完成 `build-app.ps1` 后，可按需运行：

```powershell
node verify-startup.cjs
node verify-custom-popup.cjs
node verify-appearance.cjs
node verify-clear-on-card-open.cjs
```

生成完整发行包后，运行 `node verify-bundle.cjs <包目录>` 检查文件清单，并在带中文和空格的临时目录启动包内 Node.js/接收端，确认系统 PATH 不含 Node.js 时仍能显示真实卡片、保存系统通知和独立用户历史。它会临时显示固定测试通知。

这些检查使用隔离临时目录，可能短暂显示带固定测试文本的卡片和系统记录。不要在无人值守 CI 中把真实桌面交互检查当成可保证成功的单元测试。`verify.cjs`、`verify-appearance.cjs --live`、`verify-scriptable.cjs --live` 则会向当前配置的真实接收端发送测试通知；使用前确认目标。`verify-desktop.ps1` 会切换真实应用的设置，供手动回归使用。

`PHONE_NOTIFY_DATA_DIR` 必须是绝对路径，可用于独立测试。不要让测试配置指向个人通知数据。自动测试中的旧式根目录 `config.json` 保持兼容，便于在不注册正式主应用的情况下验证接收器。

图标维护：`node update-bundled-icons.cjs` 按固定 ID、Bundle ID 和开发者 ID 核对后更新图稿；它会访问真实 App Store。`node warm-app-icons.cjs <应用名称>` 按需预缓存。

## 发行与验证范围

`build-release.ps1` 使用明确的文件白名单打包，不复制个人配置、历史、日志、截图或 WebView2 个人资料。Node.js 与 WebView2 SDK 的下载地址和 SHA-256 各自固定；ZIP 中包含 Node.js 许可、WebView2 SDK 许可及文件校验清单。发布前运行测试、构建、检查包内容并执行干净目录接收验证。

Windows 10/11 x64 是目标环境。已在开发机器的 Windows 10 19045 验证桌面通知；Windows 11、其他显示缩放、企业组策略和不同 iOS 的真实通知自动化仍需对应环境验证。自动触发所需 iOS 最低版本未作通用承诺，应以手机实际提供的触发器为准。
