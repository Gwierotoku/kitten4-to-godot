# `_dev/` 说明（开发期脚本与验证资产）

> 收尾清理过一轮：一次性探针 / 补丁 / 临时日志都删掉了，**保留下来的都是"还有用"的**。
> 删除清单见文末。

## 生产流程用到的（★不要删、不要改名★）

| 文件 | 用途 |
|:---|:---|
| `check_all.gd` / `check_all.tscn` | `huanzhuang.ps1` 第 4/5 步的检查脚本：拷进生成工程跑一遍，统计 `error / warning / parse fail` |
| `验证最小案例.ps1` | 对 `_out` 下的最小案例批量跑「import + 检查」 |
| `regress.ps1` | ★四样本完整回归★：`新的作品` / `射击生存` / `空白作品b` / `切屏测试`，串行走完 `huanzhuang.ps1` 五步并打印汇总表；日志落 `regress_log/<样本>.log`。**改动运行时或生成器之后就跑它** |

> ⚠ 两个与"跑验证"有关的陷阱（都踩过，见笔记坑清单 12 / 15）：
> ① `convert.js` 的输出路径是相对**当前工作目录**解析的，所以不要从别的目录直接调 `convert.js` 再手工验证 ——
>    用 `huanzhuang.ps1` / `regress.ps1`（它们已把工作目录统一到 `新版本/` 并核对过报告路径）；
>    判"这次验证的确实是新产物"要看 `_out/<工程>/project.godot` 的**修改时间**。
> ② 采样脚本别去 `set()` 或手动 `启动()` 被测对象（绿旗帽子本来就会自动跑一轮，两轮会交错）。

## 回归验证资产（`*_check.gd` + 同名 `.tscn`）

用法：把 `.gd` / `.tscn` 拷进 `_out/<工程>/` 根目录（`.tscn` 里的脚本 path 写的是 `res://_xxx.gd`，拷的时候要改成对应名字），然后

```powershell
& $godot --headless --path <工程> --fixed-fps 60 --quit-after <帧数> res://_xxx.tscn
```

看 stdout 里的 `[通过] / [失败]` 行。

| 文件 | 验证什么 | 最近结果 |
|:---|:---|:---|
| `broadcast_check.*` | 广播基本收发 | 通过 |
| `broadcast_wait_check.*` | 「广播并等待」等**所有**接收方（最慢的决定） | 通过（1.050 / 3.050 / 4.083 s） |
| `broadcast_scope_check.*` | 广播**按屏幕隔离** | 3/3 |
| `custom_check.*` | 造型嵌套输入 / 造型切换 | 7/7 |
| `screen_check.*` | 游戏屏幕容器 + 帽子屏幕限定 + 「即走即取消」 | 13/13 |
| `screen_lifecycle_check.*` | 屏幕生命周期（切走取消 / 切回重开 / 绿旗不受影响） | 5/5 |
| `style_check.*` | customs 的 AnimatedSprite2D 结构 + 逐造型 pivot 偏移 | 16/16 |
| `switch_check.*` | 切屏最小案例（计数器冻结/重置、克隆不泄漏、造型轮播、列表初值） | 14/14 |
| `key_check.*` | 按键：41 个帽子的键名解析 + 构造 `InputEventKey` 逐个验 down/up 的**实际触发集合** | 78/78 |
| `pen_check4.*` | 画笔作品端到端（68716 项数据 → 68715 个矩形 → 整张图） | 通过（★必须**非** headless★） |
| `stamp_check.*` | 印章作品：custom 造型尺寸（头像 3×4px）+ 18 条印章的坐标与纹理 | 通过（★必须**非** headless，要截图★） |

## 工具

| 文件 | 用途 |
|:---|:---|
| `backup.js` | 快照：`node _dev/backup.js save <名字>` / `restore <名字>`（存 `_backup/`，默认只备份转换器自己的文件） |
| `vocab.js` | 从 `core.js` 抽 k/op 词表并与 `methodtable.js` 对账（"未映射 0"这条结论靠它） |
| `fixbom.js` | **补** UTF-8 BOM（不是去掉）：`node _dev/fixbom.js <文件…>`。`.ps1` 由 PowerShell 5.1 执行，无 BOM 会按 ANSI 读 → 中文乱码甚至语法错；**用编辑器/写入工具改过 `.ps1` 之后跑一次**（幂等） |
| `probe_*.js` | **K4 真值来源**：字段名 / 块类型的实证探针（`node _dev/probe_xxx.js <bcm4>`）。⚠ `core.js` 的注释会引用它们的**文件名**，**不要改名**，否则注释里的"实测来源"就悬空了 |
| `逻辑审计报告.md` | 循环 / warp 的只读静态审计报告（含 P1/P2/P3 清单） |

## 收尾清理删掉了什么（一次性、或已并入别处）

- **临时日志**：`_check_空白作品.log`、`_run_空白作品.log`
- **已并入 README 的追加稿**：`README追加_第三～八轮.md`（7 个）
- **一次性补丁 / 审计脚本**：`patch_*.js`（6 个）、`audit_fields.js`、`audit_blocktypes.js`
- **结论已并进生产代码的一次性校验**：`check_tscn.js`、`check_nodenames.js`
  （`.tscn` 静态校验与节点名合法性现在由 `convert.js` 末尾的生成期自检负责）
- **一次性验证 / 探针**：`fix*_check.gd|tscn`（8 组）、`var_check`、`smallvar_check`、`slide_check`、
  `probe_layout`、`_探针.gd`（已被 `check_all.gd` 取代）、`screen_debug`、`kluono_probe`、`查调用栈设置.gd`
- **`_out/` 下的过期产物**：空目录 `空白作品`（曾被 Godot 占用删不掉）、`空白作品.godot.bak`、
  与 `新作品` 重复的 `新的作品`
