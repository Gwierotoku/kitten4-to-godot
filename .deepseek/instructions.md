# 给 DeepSeek Harness / DeepSeek 的说明

本仓库的完整 AI 协作说明见仓库根目录的 **[AGENTS.md](../../AGENTS.md)**，请先完整阅读它。

**速览：**

- 项目：把编程猫 Kitten4 的 `.bcm4` 工程文件转换成可直接运行的 **Godot 4** 工程。
- **结构很乱，先读文档再动手**；唯一的现役实现在 `新版本/`。
- 阅读顺序：`技术路线汇报.md` → `新版本/README.md` → `笔记/*.md` → `bcm4格式说明.md`。
- `新版本/lib/k4/core.js`（163 KB）与 `emit.js`（143 KB）极大，**先按文档定位再改**，不要通读。
- 改完跑回归：`cd 新版本; pwsh -File _dev\regress.ps1`（目标 0 error / 0 warning）。
- 新增 `.ps1` 必须存为 **UTF-8 with BOM**（否则中文在 PowerShell 5.1 下解析失败）。

> 框架设计：**Gwier** ｜ 程序实现：**DeepSeek Harness** ｜ 作者主页：https://space.bilibili.com/689846180
