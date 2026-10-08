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

## 运行期检验脚本（第二十三轮新增，`.gd` + 同名 `.tscn` 成对用）

拷进**已转换的工程**根目录，然后
`godot --headless --path <工程> --fixed-fps 60 res://_<脚本>.tscn`。

| 脚本 | 用途 |
|:---|:---|
| `prof_check` | 首帧 / 慢帧剖析：`instantiate` 耗时、每帧耗时（只报 >50ms）、`Performance.TIME_PROCESS`、对象 / 节点 / 孤儿数 —— 定位"卡在脚本还是引擎" |
| `clone_audit_check` | 克隆 / 帽子审计：节点总数、每个角色的**原体 / 克隆**实例数、**每顶帽子的点火次数**（`_触发次数`）、克隆体**按出生帧分布**（抓"一帧冒出多个"） |
| `clone_limit_check` | K4 两道克隆上限：一帧内狂调 `克隆自己()` 1200 次，应只成功 300、存活 300 |
| `cloud_check` | 云变量持久化：读 → +1 → 写，连跑两次看是否递增、存档文件内容 |
| `screen_cycle_check` | 切屏循环：订阅 `K4Global.屏幕切换` 信号记录**每一次**切换（同帧连锁切换也不会漏），跑 900 帧打印序列 |
| `load_cost_check` | 逐个 `load()` 工程里的脚本并计时 —— 实测**编译成本主要看 await 数量**（1007 行 / 166 await = 4.4s；而 8027 行的大文件因为早被 autoload 链加载过所以显示 0ms） |
| `pen_stress_check` | 画笔压力微基准：每帧 350 图章 + 350 文字图章。**必须非 headless**（headless 不执行 `_draw()`） |
| `probe_op_hist.js` | IR 的 op/k 频次直方图。⚠ **必须遍历 `sc.actors[]`** —— 脚本挂在角色上，只走 `sc.scripts`/`sc.procs` 会得到"节点总数 0" |
| `probe_split_ir.js` | 看 `列表取值_特殊` 在 IR 里的实际形态（诊断模式识别为什么没命中） |

### 写这些检验脚本时的三个坑（都踩过）

1. **别用 `:=` 接 `call()` / `load()` / `instantiate()` 的返回值** —— 它们返回 Variant，
   `:=` 推断成 Variant 会触发 `The variable type is being inferred from a Variant value`
   （本工程把该警告**当错误**）→ 脚本加载失败 → 场景没脚本、主循环永不退出，
   看起来像"卡死"。
2. **`root` 在 `_ready` 期间会拒绝 `add_child`** —— 容器根本没进树、屏幕一个都没登记、
   `当前屏幕` 恒为空。必须先 `await get_tree().process_frame` 再 `add_child`。
3. **`convert.js --clean` 会清空输出目录** —— 每次重转之后 `.gd` **和** `.tscn`
   两个都要重新拷（只拷 `.gd` 的话跑起来毫无输出）。

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
