# 内置应用图标

本目录包含 30 个中国常用 iPhone App 的 App Store 原始 JPEG 图标。应用清单、商店 ID、Bundle ID、名称别名、开发者、Apple CDN 来源 URL、核对时间及 SHA-256 均保存在项目根目录的 `app-icon-catalog.json`。

图标用于识别用户手机通知来源，名称和图标归各自权利人所有。原图未修改，通知窗口与 Windows 通知来源图标在本机渲染时添加连续圆角蒙版。

维护命令（在项目根目录运行）：`node update-bundled-icons.cjs`。更新器固定商店 ID，并核对 Bundle ID 和开发者 ID；先写入经过验证的图像，最后更新清单。未知应用使用运行时查询缓存与默认图标，不自动写入本目录。
