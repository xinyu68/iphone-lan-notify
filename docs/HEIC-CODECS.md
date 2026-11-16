# HEIC 解码组件与对应源码

HEIC/HEIF 在本机的独立 Node.js 进程中解码，无外部转换服务，不依赖 Windows 图片扩展。应用源码采用 MIT；下列上游库各自保留其许可。

| 组件 | 固定版本或提交 | 许可及来源 |
| --- | --- | --- |
| libheif-js | 1.23.5 / `d8ec4bc3bc5bf8055975577bccbbc7e1d7313c2d` | LGPL-3.0；[包装源码](https://github.com/catdad-experiments/libheif-js/tree/d8ec4bc3bc5bf8055975577bccbbc7e1d7313c2d) |
| libheif-emscripten | v1.23.5 / `5c8968a44e9c68ae677e24790d77d001ed7fe7cc` | [上游构建脚本](https://github.com/catdad-experiments/libheif-emscripten/tree/5c8968a44e9c68ae677e24790d77d001ed7fe7cc) |
| libheif | `413e2a87e6a70b3eccc3a3adc5801179dd2d9e00` | LGPL-3.0；[源码](https://github.com/strukturag/libheif/tree/413e2a87e6a70b3eccc3a3adc5801179dd2d9e00) |
| libde265 | 1.0.15 | LGPL-3.0；[源码](https://github.com/strukturag/libde265/tree/v1.0.15) |
| pngjs | 7.0.0 | MIT；[源码](https://github.com/pngjs/pngjs/tree/v7.0.0) |

`package-lock.json` 固定 npm 包完整性；`codec-sources.json` 固定对应源码下载地址与 SHA-256。完整 ZIP 在 `licenses/codec-sources` 附带前四项源码归档，许可证保留在源码与 `node_modules/libheif-js` 中；pngjs 为未压缩的 JavaScript 源码，随其 MIT 许可直接分发。

本项目直接使用未修改的上游 `libheif-js/wasm-bundle`。其包装脚本 `scripts/install.js` 引用 libheif-emscripten v1.23.5 的编译产物。对应构建仓库的 `.github/workflows/emscripten.yml` 使用 Emscripten 3.1.61、Node.js 24 和 TypeScript 5，通过 libheif 的 `scripts/install-ci-linux.sh`、`scripts/prepare-ci.sh`、`scripts/run-ci.sh` 构建，WASM 目标设置 `USE_WASM=1 USE_UNSAFE_EVAL=0 USE_TYPESCRIPT=1`。原始 `build-emscripten.sh` 默认启用 libde265 1.0.15，AOM 与 OpenJPEG 默认禁用。源码归档含这些脚本及原始许可；构建方法以对应提交为准。

需要重建或调试库时，解压源码，按构建仓库工作流在 Linux/Emscripten 环境重建，再按 libheif-js 包装步骤生成模块。将兼容模块放回 `node_modules/libheif-js` 即可使用；应用运行时不校验或限制替换后的模块哈希。PNG 编码器同样是独立可替换模块。所有转换都在运行时调用，不静态链接到应用 EXE。

`test-fixtures/sample.heic` 是使用 Pillow/HEIF 编码器生成的 16×12 纯色合成测试图，不含照片、元数据或个人内容。README 截图中的缩略图也是本地绘制的示意图。
