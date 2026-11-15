# 手机通知图标

最初使用内置 `image_gen` 工具生成于 2026-11-13；2026-11-15 再用同一内置工具编辑，按用户要求移除中间的铃铛。保留透明背景；未使用 CLI/API 回退

- 原图：`assets/app-icon.png`，1254 × 1254，透明通道保留
- Windows 图标：`assets/app.ico`，包含 16、24、32、48、64、128、256 像素尺寸
- 桌面、可执行文件、窗口及托盘使用同一套图标；关闭接收时托盘在运行时以灰色淡化显示
- 桌面 App 内的品牌图：`public/app-icon.png`

生成提示词原文：

> Use case: logo-brand. Asset type: a finished Windows desktop application icon for a small app that forwards iPhone notifications to a PC. Primary request: redesign the icon into a polished, restrained, modern app identity that remains legible at 16, 24, 32 and 48 pixels. Single square composition. A deep navy rounded-square tile, with one bold white notification-bubble glyph and a small mint-teal directional sync accent integrated into it. Strong simple silhouette, balanced generous padding, precise optical alignment, subtle depth only, high contrast and smooth edges. No lettering, no words, no numbers, no device mockup, no decorative background, no extra icons or icon sheet. Entire icon centered and occupying about 88 percent of the square canvas. Actual transparent alpha outside the rounded-square tile. Deliver one clean production-ready icon, not a presentation.

## 2026-11-15：去掉铃铛

当前只保留白色对话框轮廓、薄荷绿同步箭头和深蓝底。中间留空，不添加替代符号。

- 编辑结果：`app-icon-no-bell.png`，1254×1254；角落 alpha 为 0，透明背景保留
- Windows 多尺寸版本：`app-no-bell.ico`，16/24/32/48/64/128/256px；16、32、48px 的 Windows 加载检查通过
- 应用继续读取的标准文件：`app-icon.png`、`app.ico`；应用内为 `../public/app-icon.png`
- 原素材备份：`app-icon-with-bell.png`、`app-with-bell.ico`
- 桌面快捷方式使用新的 `app-no-bell.ico` 路径，避免继续命中旧图标路径缓存；窗口与托盘加载更新后的标准 ICO，可执行文件重新嵌入新版图标
- `build-icon.ps1` 只将完成的 PNG 缩放打包为 Windows ICO，不进行新的视觉设计

应用使用的图稿和多尺寸 ICO 均保存在本目录，不依赖设计时的个人临时目录。

编辑提示词原文：

> Use case: precise-object-edit / logo-brand. Edit the provided current Windows application icon. Remove ONLY the white bell in the center, including its top knob, bell body and clapper. Fill the removed bell area seamlessly with the same uninterrupted dark navy tile surface and subtle lighting already behind it. Leave the center empty, with no replacement glyph, dots, lettering or extra symbol. Preserve the original large white speech-bubble outline, its tail, the mint-green circular sync arrows, the navy rounded-square tile, proportions, placement, padding, rounded corners, edge quality and visual identity. Keep actual transparent alpha outside the rounded-square tile. Return one clean finished app icon suitable for Windows ICO conversion, without presentation background or mockup.
