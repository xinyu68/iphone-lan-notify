# 开发与验证

源码测试前运行 `npm ci --ignore-scripts --no-audit --no-fund`，恢复锁定的图片解码依赖。

## 组成

- `PhoneNotify.cs` / `DesktopSettings.cs` / `ConnectionSettings.cs`：WinForms 托盘与 WebView2 本地设置，接收开关、网络配置和登录自启。
- `AppEnvironment.cs` / `runtime-paths.cjs`：本机配置、数据目录、随机令牌和运行时选择；兼容已有根目录配置。
- `receiver.cjs`：局域网 HTTP 接收，32 KiB 请求限制，异步显示后写入本地记录。
- `notification-workers.cjs`：管理 WPF 卡片与 PowerShell/WinRT 通知中心子进程，异常时恢复。
- `NotificationPopup.cs`：卡片、堆叠和点击打开；最多同时三张，其余排队。
- `NativeNotifications.cs` / `NotificationActivation.cs`：Windows 通知来源注册、ICO、COM 激活和定位。点击卡片清除精确匹配的系统记录，不删除应用历史。
- `app-icon-catalog.*` / `app-icon-cache.cjs`：内置身份与资源、通用在线匹配及缓存。
- `clipboard-transfer.cjs` / `ClipboardWorker.cs`：有界文件上传、独立接收偏好、收件箱元数据，以及专用 STA 进程写入 Windows Unicode/Bitmap/PNG/CF_HDROP 剪贴板。
- `heic-render.cjs` / `inbox-storage.cjs`：HEIC/HEIF 本机解码缓存及包含缓存的收件箱容量统计。原文件不改动，完整尺寸 PNG 用于预览和历史重新复制；最多 16384 像素边长、4000 万像素、50 MiB 输入。转换在独立 Node.js 进程中串行执行，60 秒超时，仅终止自行启动的子进程。
- `public/clipboard-sender.js`：为当前电脑生成 Scriptable 发送代码，读取剪贴板或分享表单输入；它不会在后台持续监听剪贴板。
- `public`：仅供桌面 WebView2 使用的本地 UI，不对手机提供设置网页。旧 `/setup/<token>` 返回 410。
- 收件箱图片预览通过本地 WebView2 消息按需读取；校验记录 ID、文件索引、收件箱路径、文件大小和图片格式，拒绝重解析点。原图重新编码为 PNG，缩略图最多 224×168，放大图最多 1280×960；最多两项解码并行，预览不会把本机收件箱映射为网站目录。`verify-clipboard-preview.cjs` 编译实际 C# 读取代码，验证缩放和无效文件、越界路径等情况，不触碰系统剪贴板。

## 通知接口

```http
POST http://<电脑IPv4>:18766/notify/<本机配对令牌>
Content-Type: application/json

{"appId":"com.tencent.xin","appName":"微信","title":"发送人","body":"通知正文"}
```

也兼容 `{"message":"标题\n正文","appId":"微信"}`。手机生成脚本使用后一种形式。传入的值仅按文字显示；来源名称用于通知归属，Bundle ID 优先用于图标匹配。

成功返回 `{"ok":true,"id":"<16位编号>","accepted":true}`，表示已接收；显示由后台完成，状态随后变为 `shown` 或 `failed`。`GET /health` 不返回通知内容；带令牌的 `status`、`history-check`、`popup-check` 等接口供本机诊断。令牌相当于访问凭据，勿公开。

## 测试

`verify-heic.cjs` 使用合成的 16×12 HEIC 验证解码、缓存复用、原文件不变、容量统计及无效输入。C# 预览测试同时验证 HEIC 缩略图、放大图及复制参数；可选 `--live-clipboard` 测试真实 Windows 图片复制后恢复剪贴板。`verify-bundle.cjs` 使用打包后的 Node.js 在无系统 Node.js PATH 的目录解码同一合成图。

HEIC 原文件及 `inbox/<记录ID>/.heic-cache` 中的完整尺寸 PNG 都计入 1 GiB 收件箱上限；新上传及转换前分别重新统计。首次接收 HEIC 文件仍按文件传输，历史中的单张图片可转为位图重新复制。组件与构建来源见 [HEIC 组件说明](HEIC-CODECS.md)。README 截图使用最新本地 UI 与示例数据，不包含个人通知或配对凭据。

`npm test` 不需要真实手机、不请求真实商店，覆盖格式、历史、缓存、30 个内置图标、Scriptable 失败静默，以及新的数据目录/运行时/首次配置行为。Windows 上会编译独立的环境探针测试实际 C# 配置初始化。

还覆盖剪贴板接收开关、文字记录持久化与重载、长文字全文保存及淘汰清理、二进制和多文件完整性、大小/数量限制、路径与文件名处理、上传过期、提交幂等，以及 Scriptable 的剪贴板/分享输入和可见失败通知。`node verify-clipboard-windows.cjs` 与 `node verify-clipboard-http.cjs` 使用真实 Windows 剪贴板，先在进程内保存快照，完成测试后恢复；不保存或打印用户原剪贴板内容。它们需要交互式 Windows 桌面，不放入无桌面 CI。

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

正式安装包统一发布到 [Releases](https://github.com/xinyu68/iphone-lan-notify/releases)，README 下载入口固定指向 `releases/latest`。日常推送 main 或 PR 只做测试和构建，Actions 产物用于开发验证。

发新版本时修改 `package.json` 与 `package-lock.json` 的版本，新增 `docs/releases/<版本>.md` 更新说明，提交后用本机 Git 创建并推送 `v<版本>` 标签。标签必须与 package.json 完全一致；已发布的版本和标签不覆盖、不移动。

```powershell
git tag -a v1.2.0 -m 'Release v1.2.0'
git push origin main v1.2.0
```

标签触发 Windows 完整构建；通过后发布 job 仅下载同一次运行的 ZIP 与校验文件。`publish-release.cjs` 核对版本、标签提交及文件摘要，创建草稿、上传两份附件、读回大小和 SHA-256 后再公开并设为 Latest。同名且摘要一致的附件在重跑时复用，内容不一致则停止；不删除或覆盖旧附件。发布 job 单独获得 `contents: write` 和 `actions: read`，普通构建保持只读。`node verify-release.cjs` 用隔离的模拟 API 验证失败不公开及重跑行为，不访问 GitHub、不上传文件。

`build-release.ps1` 使用明确的文件白名单打包，不复制个人配置、历史、日志、截图或 WebView2 个人资料。Node.js 与 WebView2 SDK 的下载地址和 SHA-256 各自固定；ZIP 中包含 Node.js 许可、WebView2 SDK 许可及文件校验清单。发布前运行测试、构建、检查包内容并执行干净目录接收验证。

Windows 10/11 x64 是目标环境。已在开发机器的 Windows 10 19045 验证桌面通知；Windows 11、其他显示缩放、企业组策略和不同 iOS 的真实通知自动化仍需对应环境验证。自动触发所需 iOS 最低版本未作通用承诺，应以手机实际提供的触发器为准。

## 剪贴板接口

所有接口复用配对令牌和 Origin 校验，且必须开启 `clipboardEnabled`。`receiveEnabled` 只控制通知；两个接收开关分别保存。

- `POST /clipboard/<token>`，JSON `{kind:"text",text:"..."}`：返回 `copied:true` 时，文字已经写入 Windows 系统剪贴板。
- 相同端点 `{op:"begin",kind:"image"|"files",files:[{name:"a.pdf",size:123}]}`：预留有界上传任务，返回随机 `id`。
- `PUT /clipboard-upload/<token>?id=<id>&index=0`：二进制请求体，逐文件流式写入暂存目录；长度必须与声明完全一致。
- `POST /clipboard/<token>`，JSON `{op:"commit",id:"..."}`：全部文件上传完成后移动到唯一收件箱目录并写入原生剪贴板。重复提交同一个已完成任务不会再次改写剪贴板。

单文件 50 MiB、单批 100 MiB/20 项，最多 8 个未完成任务；暂存任务 10 分钟过期，收件箱总量上限 1 GiB。文本最大 1 MiB，接收记录保留最近 50 次的文字正文。列表状态最多携带前 4000 个 UTF-16 代码单元，避免截断代理对；长文字全文保存在 `clipboard-text/<id>.txt`，桌面通过本地消息按需读取，关闭接收也可查看。读取前校验记录归属、ID 和文件大小，超出记录数量的全文文件自动清理。旧版只保存元数据的记录显示“旧记录未保存文字内容”。正文不写入运行日志。图片仅接受能解码的 PNG/JPEG，额外限制尺寸和像素总量。文件名清除路径分隔符、控制字符、Windows 保留设备名并去重，不执行文件。收件箱文件保留到用户删除，避免清理后使 CF_HDROP 中的路径失效。

Scriptable 原生文档：[剪贴板](https://docs.scriptable.app/pasteboard/)、[分享参数及大文件限制](https://docs.scriptable.app/args/)、[Data 请求体](https://docs.scriptable.app/request/)。iPhone 真机的授权、分享入口、不同 App 复制内容类型和大文件内存行为仍需用户实测。

接收记录的重新复制通过本机 WebView2 消息 `clipboard-copy` 触发，由桌面控制器校验保留记录及原文件路径后调用独立 `ClipboardWorker.exe`，无需开启接收服务，也不新增历史。长文字读取全文文件，图片使用原文件生成 Bitmap/PNG/文件列表。`node verify-clipboard-preview.cjs --live-clipboard` 可验证实际桌面历史复制；先保存、最后恢复原剪贴板，无法保存快照时取消测试。默认 `npm test` 只验证记录解析和复制参数，不读写系统剪贴板。
