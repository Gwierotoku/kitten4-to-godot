# 草稿：emit.js / methodtable.js 架构笔记

- 分析对象（只读，未修改）：
  - `新版本/lib/k4/methodtable.js` —— 全文 560 行
  - `新版本/lib/k4/emit.js` —— 全文 2421 行
- 本笔记所有事实均来自这两个文件的代码与注释本身；凡代码中无法确证的一律标注「未确认」。
- 行号引用格式：`methodtable.js:26`、`emit.js:1120`（与 read 工具的行号一致；注意用 `Get-Content .Count` 统计会得到偏小的行数 459 / 2113，以 `\n` 计数与 read 的 560 / 2421 为准）。
- 本次只新建了本笔记文件，未运行转换器，未改动被分析文件。

---

## 1. methodtable.js 的表结构

### 1.1 模块形态

UMD 包装（`methodtable.js:7-10`）：Node 下 `module.exports = factory()`，浏览器下挂 `root.K4.methodtable`。工厂函数内 `'use strict'`，返回 8 个导出项（`methodtable.js:550-559`）：

`IR_METHODS` / `OP_METHODS` / `FAMILY_METHODS` / `TYPE_METHODS` / `HATS` / `INLINE_IR` / `RESERVED` / `methodNames()`。

### 1.2 值对象的字段含义

参数/返回类型缩写定义在 `methodtable.js:13-15`：

| 字段 | 含义 |
| --- | --- |
| `name` | 中文方法名（生成到 GDScript 的 `func 名(...)`；同名条目在 `buildSignatures` 里被合并） |
| `params` | 形参数组，每项是元组 `[中文参数名, 类型缩写, 默认值?]`（第 3 项极少见，见下） |
| `ret` | 返回类型：`'void' 'f' 's' 'b' 'a' 'v'`（`methodtable.js:14`） |
| `await` | `true` = 等待方法，生成器必须写 await（`methodtable.js:15`） |
| `cat` | 分类标签，用于接口文件分节与报告归类（`event/control/motion/looks/sound/pen/data/operator/sensing/physics`，以及中文的 `运算 / 运动 / 外观（桩） / 数据（桩）`） |
| `stub` | 仅 `TYPE_METHODS` 使用：标记「类型层桩」（调用形态是 1 个 Array 实参） |
| `uncertain` | 语义/签名未完全确认的标记，共 11 处（如 `flip` `set_visible` `fade` `midi_note` `midi_get` `append` `ask_choose` `touching_entities` `physics2_set_force` `physics2_set_force_in_time` `set_scale`） |
| `inline` | 仅 `OP_METHODS` 使用（10 处）：生成器直接内联、不生成方法调用 |

**参数类型缩写**（`methodtable.js:13`）：`'f'`=float、`'s'`=String、`'b'`=bool、`'a'`=Array、`'v'`=Variant、`'c'`=Callable、`'ctx'`=WarpCtx。

- `ctx` 写在 `params` 第 0 位表示「该调用需要运行上下文」，生成器在 `call()` 里自动插入字面量 `ctx`、不占实参位（`emit.js:1126-1127`、`emit.js:1159`）。
- 第 3 项是**补齐用默认值**，全表只有两处：`math_root_n` 与 `math_root` 的 `['次','v','2.0']`（`methodtable.js:375-376`），消费点在 `emit.js:1146-1147`（掉默认值的话开方会被补成 0.0、退化成 GDEF）。

### 1.3 各表键值形态与条目数（统计以代码为准）

| 表 | 行号 | 键 | 值 | 实测条目数 | 头部注释声称 |
| --- | --- | --- | --- | --- | --- |
| `IR_METHODS` | `methodtable.js:26-239` | IR 操作码（`k`） | 方法对象 | **143** | 124（`methodtable.js:22`） |
| `TYPE_METHODS` | `methodtable.js:248-333` | K4 块类型（如 `self_set_friction`） | 方法对象（全部 `stub: true`） | **51** | 54（`methodtable.js:5`、`243`） |
| `OP_METHODS` | `methodtable.js:350-470` | 取值 op 名（core.js 的 `{k:'op', op:'xxx'}`） | 方法对象（含 `inline`） | **86** | 未声明 |
| `FAMILY_METHODS` | `methodtable.js:474-480` | 中文方法名 | 方法对象 | **5**（比较/数学函数/是否判断/坐标x/坐标y） | 未声明 |
| `HATS` | `methodtable.js:485-495` | `'hat:xxx'` | `{kind, base, needsScene}` | **9** | 9 |
| `INLINE_IR` | `methodtable.js:502-504` | ——（数组） | 字符串 | **20** | 20 |
| `RESERVED` | `methodtable.js:509-540` | ——（数组） | 字符串（附录 C 保留字） | 见下 | 未给数 |

- `INLINE_IR` 的 20 项：`forever, repeat, repeat_until, if, break, warp, def, return, param, lit:str, lit:num, lit:bool, lit:null, lit, mapped-alias, broadcast, broadcast_body, broadcast_body_wait, num0, num1`。注释说明 `warp` 展开成 `角色.进入warp(ctx)` / `角色.退出warp(ctx)`（`methodtable.js:498`）。
- `HATS` 的 9 项：`hat:flag(start/帽子_开始)`、`hat:message(broadcast/帽子_广播)`、`hat:key(key/帽子_按键)`、`hat:clicked(click/帽子_点击, needsScene:true)`、`hat:clone_start(clone/帽子_克隆启动)`、`hat:backdrop(backdrop/帽子_背景切换)`、`hat:condition(condition/帽子_条件)`、`hat:timer(timer/帽子_计时器)`、`hat:loudness(loudness/帽子_响度)`。只有 `click` 需要额外 `.tscn`（要 Area2D，`methodtable.js:484`）。
- `RESERVED` 覆盖：Node2D/CanvasItem 属性、Node/Object 方法、CanvasItem 方法、GDScript 关键字、Node 内置信号（`methodtable.js:510-539`）；判定规则见 `methodtable.js:506-508`（K4 名 ∈ 本表 ∪ `methodNames()` ∪ 自定义积木名 → 加前缀）。
- `methodNames()`（`methodtable.js:542-548`）返回 `{方法名: 'ir'|'type'|'family'}`，是「本次生成的方法名集合」这个动态保留字项的来源。

**条目数与注释不一致的说明**：文件头注释写「IR_METHODS : 124 条」「TYPE_METHODS 54 条」（`methodtable.js:3-6`、`18-24`、`241-247`），实测分别为 143 与 51（正则按键统计，无重复键）。差异原因未确认；**以代码为准**。

### 1.4 `await: true` 全部方法名清单（运行时语义关键）

全文 `await: true` 的**唯一方法条目共 18 条**（另有 2 行是注释，`methodtable.js:15`、`456`）：

`IR_METHODS`（16 条）：

| 方法名 | IR 键 | 行号 |
| --- | --- | --- |
| 广播并等待 | `broadcast_wait` | `methodtable.js:29` |
| 等待_秒 | `wait` | `methodtable.js:35` |
| 等待直到 | `wait_until` | `methodtable.js:36` |
| 调用_同步 | `tell` | `methodtable.js:44` |
| 调用_同步 | `call` | `methodtable.js:48` |
| 调用_同步 | `call_proc` | `methodtable.js:49` |
| 滑行到 | `glide_to` | `methodtable.js:72` |
| 说_秒 | `say_for` | `methodtable.js:92` |
| 想_秒 | `think_for` | `methodtable.js:94` |
| 渐变 | `fade` | `methodtable.js:103` |
| 播放声音并等待 | `play_sound_wait` | `methodtable.js:109` |
| 播放音符 | `midi_note` | `methodtable.js:120` |
| 询问并等待 | `ask` | `methodtable.js:205` |
| 询问并选择 | `ask_choose` | `methodtable.js:206` |
| 淡入 | `fade_in` | `methodtable.js:235` |
| 淡出 | `fade_out` | `methodtable.js:236` |

`OP_METHODS`（2 条）：

| 方法名 | op 键 | 行号 |
| --- | --- | --- |
| 滑行坐标 | `self_glide_coordinate` | `methodtable.js:458` |
| 询问并等待 | `ask` | `methodtable.js:466` |

`TYPE_METHODS`：`await: true` 计数为 **0**（全部 `await: false`；全文 `await:false` 共 183 行）。
`FAMILY_METHODS`：5 条全部 `await: false`。

补充要点：
- `call` / `call_proc` 的 `'调用_同步'` 只是**缺省名**，真实中文名由生成器替换成 K4 自定义积木名（`methodtable.js:45-49`）。
- `tell` 与 `call`/`call_proc` 共用 `调用_同步` 是已知歧义（附录 A.2 与 §5.2 等待白名单冲突，`methodtable.js:45-47`）。
- `ask` 在两表中同名但返回类型不同：IR 版 `ret:'void'`（`methodtable.js:205`），OP 版 `ret:'s'`（`methodtable.js:466`）—— 合并成签名时返回类型会退化为 `'v'`（`emit.js:737-748`）。

### 1.5 关于任务里说的「awk 白名单」

代码中**没有任何名为 `awk` 的字段或标识符**。按语义对应的应是 **await 等待白名单**，它有两处：

1. `methodtable.js` 的 `await: true` 标记（第 1.4 节清单）——「这是等待方法」的唯一上游声明。
2. `emit.js` 的 `AWAIT_KINDS`（`emit.js:302-305`）：`{forever, repeat, repeat_until}` 加上**遍历 `MT.IR_METHODS` 得到的全部 `await:true` 的键**，供 `bodyNeedsAwait` 深扫判断协程传染。

若「awk 白名单」另有所指，则为**未确认**。

### 1.6 生成器如何消费这些表

消费集中在 `emit.js` 的 `buildSignatures()`（`emit.js:664-754`）与各查表点：

1. `renamedStubNames()`（`emit.js:648-662`）：收集 `IR_METHODS`/`OP_METHODS`/`FAMILY_METHODS` 里所有非 `inline` 的**方法名**；若 `TYPE_METHODS` 的条目与其中某个名字相同，就把桩改名为 `名 + '_桩'`。理由：桩的调用形态是 `角色.名([...])`（1 个 Array），IR/OP 是逐个实参，同名会抢同一个签名（`emit.js:645-647`）。
2. `buildSignatures(report)`（`emit.js:664-754`）：
   - 按 `name` 分组（`add`，`emit.js:667-670`），跳过无名与 `inline`。
   - 顺序固定为 IR → OP → FAMILY → TYPE（改名后），因此**同一位置的名字取「先遇到的那一份」**（`emit.js:671-684`）。
   - 判定是否含 `ctx`（`off()` 看 `params[0][1]==='ctx'`，`emit.js:689`），含则统一在最前面补 `['ctx','ctx']`（`emit.js:707`）。
   - 取各条目最大实参数 `maxN` 建槽位（`emit.js:691-694`）；同槽位类型不一致 → 放宽成 `'v'`（`emit.js:701`），默认值取第一个非 undefined 的（`emit.js:702`）；无名字的槽位命名 `参数N`、无类型给 `'a'`（`emit.js:710`）。
   - 参数名去重（重名加 `_2`、`_3`…）并写入 `report.参数改名`（`emit.js:713-735`）。
   - 返回类型：多值 → `'v'`（`emit.js:737-748`）。
   - **`isStub` 判定**：组内条目**全部**带 `stub` → 强制 `params = [['参数','a']]`（`emit.js:740-743`）。
   - 输出 `{name, params, ret, cat, stub}`（`emit.js:745-751`）。
3. 消费点：
   - `Emitter` 构造：`this.sig = buildSignatures(this.report)`（`emit.js:566`）；随后用模板函数名清单做「参数名避让」，把撞名参数改为 `_p_` 前缀（`emit.js:606-629`）。
   - `call()`：非 `BASE_METHODS` 的方法以 `this.sig[m.name]` 为准决定实参个数（`emit.js:1124-1127`）；`BASE_METHODS` 的方法走基类真实签名（`emit.js:1123`）。
   - `emitBuiltinLayer()`：用同一张 `em.sig` 生成接口/桩（`emit.js:2149`）。
   - 其它查表：`stmtLines` 查 `MT.TYPE_METHODS`（`emit.js:1280`）与 `MT.IR_METHODS`（`emit.js:1385`、`1393`）；`opCall` 查 `MT.OP_METHODS`（`emit.js:1084`）；`emitHat`/`emitScene` 查 `MT.HATS`（`emit.js:1483`、`1980`）；`AWAIT_KINDS` 查 `MT.IR_METHODS`（`emit.js:303-305`）；`NameSpace` 用 `MT.RESERVED` 与 `MT.methodNames()`（`emit.js:451-454`）。
   - `MT.INLINE_IR` 在 `emit.js` 中**没有任何引用**（控制流/字面量在 `stmtLines`/`expr` 里硬编码分支）。
   - `积木映射.json` 里写出三张表的条目数（`emit.js:1817-1821`）。

---

## 2. emit.js 模块结构（顶层函数 + 行号）

文件头注释（`emit.js:1-21`）自述架构：**积木 = 角色类方法（中文名）；控制流 = 生成代码；事件 = 帽子节点**，并列出产物清单。

依赖与常量：

| 行号 | 内容 |
| --- | --- |
| `emit.js:24-26` | `require('fs')` / `require('path')` / `require('./methodtable.js')` 作为 `MT` |
| `emit.js:32` | `自带积木模板路径` = `../../runtime/模板/自带积木.gd` |
| `emit.js:34-40` | `读自带积木模板()`（读不到返回 null） |
| `emit.js:47-57` | `HAT_KEY`：core.js 的 `kind` → methodtable 的 `'hat:xxx'` 键（9 项） |
| `emit.js:59-69` | `HAT_LABEL`：`kind` → 中文帽子标签（用于文件名） |
| `emit.js:79-233` | `ARG`：IR 节点字段 → 实参顺序表（`null` = 该位由生成器插 `ctx` 或该块走专门分支；`'@N'` = 取 `args[N]`） |
| `emit.js:236-240` | `OP_TOKEN`：算术/逻辑 op → 中文运算符 token |
| `emit.js:246` | `IDENT_OK = /[A-Za-z0-9_\u0080-\uFFFF]/` |
| `emit.js:250-268` | `BASE_METHODS`：角色基类已实现的方法名（保留字） |
| `emit.js:271-284` | `GD_KEYWORDS`：GDScript 关键字 + 内建函数/类型名 |
| `emit.js:302-305` | `AWAIT_KINDS` |
| `emit.js:385` | `UUID_LIKE` 正则 |
| `emit.js:435-446` | `NS_PREFIXES`：kind → 生成名前缀 |
| `emit.js:497-498` | `TEXT_FILE_LIMIT = 1024`、`TEXT_READER = 'K4Text'` |
| `emit.js:513` / `515` / `519` | `GTYPE`（缩写→GDScript 类型，`ctx` → `角色基类.WarpCtx`）、`GRET`（返回类型）、`GDEF`（默认返回值，`v` → `'0.0'`） |
| `emit.js:1662-1663` | `uidSeq` / `nextId()` |

顶层（非 prototype）函数：

| 行号 | 函数 | 职责 |
| --- | --- | --- |
| `emit.js:34` | `读自带积木模板()` | 读 runtime 模板文本 |
| `emit.js:286` | `sanitize(raw, fallback)` | 标识符清洗 |
| `emit.js:312` | `bodyNeedsAwait(list, procDefs, cache, visiting)` | 深扫积木体判断是否协程（当前**无调用点**，见 §6 末「未使用/遗留」） |
| `emit.js:349` | `staticKind(node)` | 表达式静态类型近似：`'n'/'s'/'b'/'?'` |
| `emit.js:391` | `screenArg(em, argNode, fieldName, ctx)` | 求「屏幕」实参（影子 `scene` 字段 → 显式字段 → `get_current_scene` → 表达式兜底） |
| `emit.js:410` | `procIdent(raw)` | 自定义积木名 → 合法安全函数名 |
| `emit.js:448` | `NameSpace(names, extraReserved)` | 名字分配器 |
| `emit.js:525` | `Emitter(ir, opts)` | 生成器主体构造函数 |
| `emit.js:648` | `renamedStubNames()` | 撞名桩改名表 |
| `emit.js:664` | `buildSignatures(report)` | 签名合并（唯一真源） |
| `emit.js:1449` | `collectProcDefs(ir)` | 收集全工程自定义积木定义（跨角色全局可见） |
| `emit.js:1590` | `num(v)` | 数值字面量（**当前无调用点**） |
| `emit.js:1597` | `k4Number(v)` | float32 噪声归零 + 7 位有效数字 |
| `emit.js:1604` | `k4Direction(r)` | Pixi 弧度 → K4 方向（90 = 向右） |
| `emit.js:1634` | `actorInitProps(ent)` | 角色初始 transform/可见性 → .tscn 属性行 |
| `emit.js:1651` | `literalOf(v)` | 值 → GDScript 字面量（数组一律 `[]`） |
| `emit.js:1665` | `Tscn()` | .tscn 构造器（`ext` / `nodes` / `sub` / `head`） |
| `emit.js:1699` | `emitProject(ir, opts)` | **主入口**，返回 `{files, report, emitter}` |
| `emit.js:1836` | `dedupeObjects(arr)` | 报告去重（用于 argMismatch / argLoss） |
| `emit.js:2048` | `em_file(em, p, c)` | `em.file` 的转发壳 |
| `emit.js:2085` | `emitVarLayer(ir, em)` | 生成 `全局/角色变量.gd` |
| `emit.js:2146` | `emitBuiltinLayer(ir, em)` | 生成 `全局/角色自带积木.gd` |
| `emit.js:2239` | `emitProcLayer(ir, em)` | 生成 `全局/角色自定义积木.gd` |
| `emit.js:2303` | `gdTriple(s)` | GDScript 三引号字符串 |
| `emit.js:2309` | `emitSpareScript(ent, em)` | 生成 `<角色>/预备块.gd` |
| `emit.js:2340` | `emitProjectGodot(em, scenes)` | 生成 `project.godot` |

`Emitter.prototype` 方法（按文件顺序）：

`esc`(756)、`file`(757)、`外置文本`(770)、`strLit`(786)、`litOf`(792)、`flushTextFiles`(801)、`collectDecls`(810)、`varRef`(851)、`expr`(874)、`cond`(938)、`opCall`(947)、`operToken`(1112)、`call`(1120)、`stmtLines`(1184)、`body`(1426)、`procCall`(1435)、`hatFileName`(1471)、`emitHat`(1480)、`emitActorScript`(1536)、`emitScene`(1845)。

`Tscn.prototype`：`addExt`(1666)、`node`(1671)、`dump`(1674)。

`module.exports`（`emit.js:2414-2421`）：`emitProject`、`NameSpace`、`sanitize`、`HAT_KEY`、`HAT_LABEL`、`ARG`（**只导出这 6 项**；`BASE_METHODS`、`procIdent`、`buildSignatures`、`Emitter`、`Tscn` 等不导出）。

---

## 3. Emitter 类

### 3.1 构造函数（`emit.js:525-630`）从 ir 提取了什么

| 行号 | 成员 | 说明 |
| --- | --- | --- |
| `emit.js:526-529` | `ir` / `opts` / `project` / `names` | `ir.project`、`ir.project.names` |
| `emit.js:530` | `files` | 产物字典 `路径 -> 内容` |
| `emit.js:531-541` | `report` | 统计对象（见 3.2） |
| `emit.js:543-544` | `textPool` / `curDir` | 超长文本池；当前脚本所在目录（决定 txt 落到哪，初值 `'全局'`） |
| `emit.js:545-557` | `extraReserved` | 追加 `角色/K4Global/K4Bus/K4Canvas/self/ctx`、全部 `BASE_METHODS`、`collectProcDefs(ir)` 的名字、`ir.procRegistry` 的 `procIdent` 名 |
| `emit.js:558` | `ns = new NameSpace(this.names, this.extraReserved)` | 名字分配器 |
| `emit.js:559-564` | `tmpSeq` / `loopSeq` / `procDefs` / `usedProcs` / `relax` / `awaitCache` | 循环序号、过程定义、已用过程、String 参数放宽记录 |
| `emit.js:565` | `stubRenames = renamedStubNames()` | 撞名桩改名表 |
| `emit.js:566-567` | `sig = buildSignatures(this.report)`；`report.桩改名` | 合并后的签名表 |
| `emit.js:573-605` | `_模板已实现` / `_模板真桩` / `_模板函数名` | 扫 `runtime/模板/自带积木.gd`：把函数体去掉 `_桩提醒(...)`、注释行、空的 `pass`/默认 `return` 后仍有代码的判为「已实现」，否则判为「壳子桩」（`emit.js:568-572`、`596-604`） |
| `emit.js:606-629` | `report.参数避让` | 模板里「既是函数名又当参数名」的词（如 `_秒`）会让 Godot 报 SHADOWED_VARIABLE，统一把签名参数改 `_p_` 前缀 |

### 3.2 `report` 统计了什么

初始字段（`emit.js:531-541`）：

| 字段 | 含义 / 写入点 |
| --- | --- |
| `stubs` | 类型层桩：`块类型 -> {方法名, 次数}`（`emit.js:1323-1325`）；另 `stubs.__play_sound_wait = true` 标记声音等待分支（`emit.js:1394`） |
| `unknown` | 完全没有落点的键：`'op:'+op`（`emit.js:1086`）、`'type:'+块类型`（`emit.js:1282`）、`'k:'+k`（`emit.js:1387`）、`'method:?'`（`emit.js:1121`） |
| `renames` | 名字改名记录（来自 `ns.renames`，`emit.js:848`；项形如 `{kind, 原名, 生成名}`，`emit.js:479`） |
| `argMismatch` | 实参个数不匹配（真不匹配才记，`emit.js:1143`） |
| `argLoss` | **实参被截断**（真丢实参 → 方法表参数个数写少了；注释说 convert.js 会升级成 ✗ 错误，`emit.js:1149-1155`） |
| `calls` | 声明了但**全文无写入点** |
| `spare` | 备份成 `预备块.gd` 的悬空文本段数（`emit.js:2042`） |
| `外置文本` | 落到 `文本/*.txt` 的超长字符串个数（`emit.js:780`） |
| `stats` | 声明了但**全文无写入点** |

后续追加的字段：

| 字段 | 行号 | 含义 |
| --- | --- | --- |
| `桩改名` | `emit.js:567` | 撞名桩的改名表 |
| `参数避让` | `emit.js:628` | 因撞模板函数名而加 `_p_` 的参数（`方法 的 X -> _p_X`） |
| `参数改名` | `emit.js:729-730` | 签名合并时重复参数名去重记录（`方法 的 基名 -> 基名_2`） |
| `已实现积木` | `emit.js:1318-1320` | 类型层块在 runtime 模板里**已有真实现**的计数（与 `stubs` 互斥，`emit.js:1317-1327`） |

其中写进 `积木映射.json` 的只有：`改名 / 桩 / 未映射 / 实参个数不匹配 / 实参被截断 / 桩改名`（`emit.js:1822-1827`）；`参数改名`、`参数避让`、`已实现积木`、`外置文本`、`spare` 只留在返回的 `report` 里。

### 3.3 各方法分工（重点）

| 方法 | 行号 | 分工 |
| --- | --- | --- |
| `expr()` | `emit.js:874-935` | 表达式总入口：标量直出（877-879）、`lit`（881-887）、`emptybool` → `""`（888）、`ref`（先当参数匹配，再成员访问，889-897）、`listref`/`listref_from`（898-910）、`args` → `[...]`（911-913）、`unknown`（916-930，含 `get_current_scene`/`get_sensing_current_scene`/`check_screen`）、`op` → `opCall`（933）、其余 `null`（934） |
| `opCall()` | `emit.js:947-1110` | 取值型 op：算术/比较/逻辑内联与弱类型转换（957-1043）、`listref_from`（1046-1059）、自定义积木调用（1062-1072）、变参 `join` 折叠（1076-1082）、OP_METHODS 兜底（1084-1109，未映射记 `unknown` 并返回 `0.0`） |
| `call()` | `emit.js:1120-1180` | 生成一次方法调用（见下） |
| `stmtLines()` | `emit.js:1184-1424` | 语句 → 代码行（见下） |
| `body()` | `emit.js:1426-1432` | 逐条 `stmtLines`；空体给 `pass` |
| `emitHat()` | `emit.js:1480-1532` | 帽子脚本：`extends <HATS.base>` + 配置函数（`_配置键名`/`_配置按键事件`/`_配置消息`/`_条件`）+ `_积木主体()`；上下文必须走 `_上下文()`（`emit.js:1523-1526`） |
| `emitActorScript()` | `emit.js:1536-1587` | 角色脚本：`extends 角色类`、可选 `_造型别名()`、`_ready()` 里 `初始化()` + 本角色变量/列表初值 |
| `emitScene()` | `emit.js:1845-2046` | 屏幕场景：.tscn 节点树（舞台层/屏幕绘制/基础角色层/克隆体层）、每个实体的造型 Sprite2D、帽子脚本与场景、角色 .gd/.tscn、预备块、屏幕 .gd |

#### `call()`（`emit.js:1120-1180`）的补齐/截断、await、告警

- 签名来源：`BASE_METHODS` 里的方法不走合并，直接用 `m.params`；其余取 `this.sig[m.name]`（`emit.js:1123-1125`）。
- `need = params.length - (hasCtx ? 1 : 0)`，`given` 是实参字符串数组（`emit.js:1126-1128`）。
- 个数不等时（`emit.js:1129-1156`）：
  1. **可省略参数判定**：实参少于需要时，逐个检查缺失位的第 3 项默认值；**每个缺失位都有默认值**才算「可省略」，不报 `argMismatch`（`emit.js:1136-1142`）。
  2. **补齐**：缺失位取 `slot[2]`（表里的默认值），否则 `GDEF[类型]`，再否则 `'null'`（`emit.js:1144-1148`）。
  3. **截断**：实参多于需要时按 `need` 截断，多出来的存进 `report.argLoss`（`{方法, 声明, 实给, 丢掉}`，`emit.js:1149-1155`）——注释强调这是「真丢了实参」而不是无害补齐。
- 逐参拼装：`params[i][1] === 'ctx'` 的位置直接写 `ctx`；其余按偏移取 `given`（`emit.js:1157-1167`）。
- **类型自校正**：声明成 `'s'` 但实参不是字符串字面量（首字符不是 `"`）时记 `this.relax[名#下标] = true`（`emit.js:1161-1165`）。注释说「接口文件最后生成，会读到这份记录」，但 `emitBuiltinLayer` 实际没用它（把参数类型一律放宽成 Variant，`emit.js:2203-2208`）——**本文件内无消费点，是否有其它消费者未确认**。
- **无条件 await**：最终返回 `'await ' + target + '.' + name + '(...)'`（`emit.js:1168-1179`）。注释解释：以前只对 `await:true` 的加，属于静态近似，一旦实现里自己 await 就报 `Function X() is a coroutine, so it must be called with "await"`；现在无条件 await（await 同步值立即返回），用确定性换性能。

#### `stmtLines()`（`emit.js:1184-1424`）覆盖的语句

| 分支 | 行号 | 生成形态 |
| --- | --- | --- |
| 无 `k` | `1189` | `pass` |
| `forever` | `1196-1201` | `while true:` + 体 + `await 角色.一步(ctx)` |
| `repeat` | `1202-1209` | `for _k4iN in range(角色.转整数(times)):` + 体 + `await 角色.一步(ctx)` |
| `repeat_until` | `1210-1215` | `while not <cond>:` + 体 + `await 角色.一步(ctx)` |
| `wait_until` | `1219-1224` | 展开成 `while not ...: await 角色.一步(ctx)`（不传 Callable） |
| `if` | `1225-1235` | `if / elif / else` 多分支；无分支给 `pass` |
| `break` | `1236` | `break` |
| `warp` | `1237-1242` | `await 角色.进入warp(ctx)` … `await 角色.退出warp(ctx)` |
| `return` | `1243-1245` | `return <expr>` 或 `return` |
| `broadcast_body` / `broadcast_body_wait` | `1246-1250` | 注释行 + 体 |
| `nop` | `1251` | `pass` |
| `ask_choose` | `1256-1264` | 专门分支：`await 角色.询问并选择(ctx, 问题, [选项...])` |
| `stub` | `1267-1330` | 见下 |
| `set_var` / `change_var` | `1333-1356` | 直接写成员；`change_var` 仅在静态为数字时 `+=`，否则 `角色.算术运算("add", 左, 右)` |
| `tell` / `tell_sync` | `1359-1365` | `await 角色.找("目标").过程名(ctx)` |
| `call` / `call_remote` | `1368-1372` | `procCall(...)`（自带 await） |
| `op` | `1378-1382` | 语句位置的取值 op → `opCall`（返回值已带 await） |
| 其它（IR 语句方法） | `1385-1423` | 查 `MT.IR_METHODS`；未映射 → 注释 + `pass`（`1386-1388`）；`play_sound` 且 `stmt.wait` → 改用 `play_sound_wait`（`1392-1395`）；按 `ARG[k]` 取值后 `call('角色', m, args, ctx)` |

`stub` 分支内部：`switch_to_screen` 生成真调用 `角色.切换屏幕(...)`（`1269-1279`）；未知块类型记 `unknown` 并给注释 + `pass`（`1281-1284`）；`set_width_height_scale` 专门生成 `角色.设置宽高缩放("width"/"height", 值)`（`1294-1303`）；其余走通用数组桩 `await 角色.名([...])`（`1308-1328`），并按「模板里是否已实现」分别记 `report.已实现积木` 或 `report.stubs`（`1317-1327`）。

---

## 4. 生成产物清单（emitProject，`emit.js:1699-1834`）

### 4.1 逐条列出实际写盘的文件（`em.file`/`self.file` 调用点）

| 路径模板 | 行号 | 用途 |
| --- | --- | --- |
| `全局/全局变量.gd` | `1734`（首次）、`1795`（最终覆盖） | 全局变量/列表成员、`当前屏幕`/`当前背景`、`屏幕表`、`屏幕路径()`、`变量前缀`/`列表前缀`、兜底字典 `_变量`/`_列表` 与 `取值/设置/列表/_脚本有/有` |
| `project.godot` | `1831` | 工程配置（见 4.5） |
| `全局/积木映射.json` | `1814-1828` | 调试反查表（见 4.6） |
| `<屏幕目录>/<屏幕目录>.tscn` | `1848`（路径）、`2045`（写盘） | 屏幕场景根（节点树见下） |
| `<屏幕目录>/<屏幕目录>.gd` | `2039` | 屏幕脚本：`_ready` 里 `K4Canvas.设置画布($屏幕绘制)` 与 `K4Global.当前屏幕 = 屏幕名` |
| `<屏幕目录>/<角色目录>/<帽子名>.gd` | `1981-1982` | 每个事件的帽子脚本 |
| `<屏幕目录>/<角色目录>/<帽子名>.tscn` | `1991` | **仅点击帽子**（`needsScene`）生成：`Area2D` + `CollisionPolygon2D` |
| `<屏幕目录>/<角色目录>/<角色名>.gd` | `1999` | 角色脚本（`extends 角色类`） |
| `<屏幕目录>/<角色目录>/<角色名>.tscn` | `2023` | 角色场景：根 + `customs` 下每个造型一个 `Sprite2D` + 帽子节点 |
| `<屏幕目录>/<角色目录>/预备块.gd` | `2003` | 仅 `ent.spare` 非空时生成（悬空块备份） |
| `全局/角色变量.gd` | `1804` | 三级角色层第 1 层（见 4.3） |
| `全局/角色自带积木.gd` | `1805` | 第 2 层 |
| `全局/角色自定义积木.gd` | `1806` | 第 3 层 |
| `<脚本所在目录>/文本/<N>.txt` | `770-783`（登记）、`804`（`flushTextFiles` 落盘） | 超长字符串外置（`> TEXT_FILE_LIMIT = 1024`） |

目录与节点命名规则：
- 屏幕目录 = `sanitize(sc.name, '屏幕')`（`emit.js:1847`）。
- 角色目录：**舞台且角色名与屏幕目录同名时用 `'舞台'`**（避免 `背景/背景/背景.gd` 套娃），否则用角色名；但**节点名始终保留 K4 原名**（跨角色 `角色.找("背景")` 靠名字定位）（`emit.js:1906-1908`）。
- 舞台实体挂 `舞台层`，其它角色挂 `基础角色层`（`emit.js:1909-1911`）。

`emit.js` **只写引用、不写文件本体**的路径（由 runtime / convert.js 提供，`emit.js:19-20` 注释称运行时库由 runtime 提供、convert.js 拷贝）：
- `<屏幕目录>/屏幕绘制.gd`（`emit.js:1854` 只登记 `Script` 扩展资源；`emit.js:1853` 的 `ns.assign('脚本','屏幕绘制','s_')` 结果未被使用）
- `<屏幕目录>/角色custom/<角色目录>/<文件名>`（`emit.js:1951` 只引用贴图；头注释提到 `.png`，代码里没有写 png 的地方）
- `全局/广播总线.gd`、`全局/画布调度.gd`、`全局/大文本.gd`、`全局/计时器.gd`（仅出现在 autoload，`emit.js:2361-2370`）

具体由谁生成这些文件**未确认**（不在本次只读范围内）。

### 4.2 屏幕 .tscn 的节点树（`emit.js:1851-1898`、`2025-2029`）

1. 根节点 `[node name="<屏幕目录>" type="Node2D"]` 挂屏幕脚本（`emit.js:1858`）。
2. `舞台层`（Node2D，`position = 舞台中心`、`z_index = -100`）（`emit.js:1886`）。
3. `屏幕绘制`（Node2D，挂 `屏幕绘制.gd`，**绝不能写 z_index**）（`emit.js:1893`）。
4. `基础角色层`（Node2D，`position = 舞台中心`）（`emit.js:1897`）。
5. `克隆体层`（Node2D）（`emit.js:1898`）。
6. 每个实体（舞台 + `sc.actors`）以 `instance=ExtResource(...)` 实例化到 `舞台层`/`基础角色层`，并把初始 position/rotation/scale/visible 作为属性烘在节点上（`emit.js:2027-2028`，属性由 `actorInitProps()` 生成，`emit.js:1634-1649`）。

节点顺序即绘制顺序：舞台背景 → 画笔 → 角色（`emit.js:1859-1875`）。

### 4.3 三级角色层怎么生成

| 层 | 生成函数 | 文件头字面量 | 模板缺失时的形态 |
| --- | --- | --- | --- |
| 角色变量 | `emitVarLayer`（`emit.js:2085-2144`） | `class_name 角色变量`（`2102`）+ `extends 角色基类`（`2103`） | 一定会写（不依赖模板） |
| 角色自带积木 | `emitBuiltinLayer`（`emit.js:2146-2232`） | 以 `runtime/模板/自带积木.gd` 整段为底（`2153`、`2162`）；模板自带 `class_name 角色自带积木` / `extends 角色变量` | 模板读不到时退化成纯桩文件，显式写 `class_name 角色自带积木` + `extends 角色变量`（`emit.js:2163-2170`） |
| 角色自定义积木 | `emitProcLayer`（`emit.js:2239-2289`） | `class_name 角色自定义积木`（`2254`）+ `extends 角色自带积木`（`2255`） | —— |
| （用户层） | runtime `全局/角色类.gd` | 注释明确「★用户文件，永不覆盖」（`emit.js:2056`、`2100`） | —— |
| 角色脚本 | `emitActorScript`（`1536-1587`） | `extends 角色类`（`1540`） | 每个具体角色一个文件 |

完整继承链（源码注释 `emit.js:2095-2101`、`2059-2064`、`2077-2082`）：

```
角色基类（runtime）
 └ 角色变量（每次覆盖）        ← 数据：变量 / 列表成员
    └ 角色自带积木（每次覆盖）  ← 行为：自带积木的桩
       └ 角色自定义积木（每次覆盖）← K4 自定义积木真实现
          └ 角色类（用户文件，永不覆盖）
             └ <角色名>.gd（extends 角色类）
```

各层内容细节：
- **角色变量.gd**：`em.localVars` 排序后写 `var <生成名>: Variant = <初值>`（`emit.js:2111-2114`）、`em.localLists` 写 `var <生成名>: Array = []`（`2115`）；无局部变量时写注释占位（`2110`）；末尾附「归属索引」纯注释（哪个角色拥有哪些成员，`2124-2138`）与全局变量清单注释（`2140-2141`）。
- **角色自带积木.gd**：先铺模板全文，再把 `em.sig` 里**模板没有的**方法补桩（`2174-2227`）：跳过 `BASE_METHODS`（`2176`）、跳过模板已有（`2177`）、跳过 `_桩` 结尾的名字（`2178-2181`）；补的桩形态为 `func 名(ctx, _p_参数: Variant...) -> 返回类型:` + `\tawait get_tree().process_frame` + 非 void 时 `\treturn <GDEF>`（`2202-2226`），按 `cat` 分节排序（`2198-2201`）。
- **角色自定义积木.gd**：`em.procDefs` ∪ `em.usedProcs` 排序后逐条生成 `func <procIdent>(ctx: 角色基类.WarpCtx, _p_<参数>: Variant...) -> Variant:`（`2264-2274`），函数体第一行 `var 角色 := self`（`2276`，K4 语义：过程体以调用者身份运行），结尾补 `return null`（`2282`/`2284`）；无过程时写 `# （本工程没有自定义积木）`（`2263`）。

**桩方法的两个来源**（不要混淆）：
1. **类型层桩**：`TYPE_METHODS` 的块（全部 `stub: true`），签名被 `buildSignatures` 强制成恰好 1 个 Array 参数（`emit.js:740-743`），调用点生成 `await 角色.<名或改名>([实参...])`（`emit.js:1328`），撞名时用 `_桩` 后缀（`emit.js:648-662`、`1285`）。
2. **接口层桩**：`角色自带积木.gd` 里「映射表有、模板没有」的方法（`emit.js:2174-2227`），带协程体（`await get_tree().process_frame`）。

### 4.4 预备块.gd 的规则（`emit.js:2001-2005`、`2309-2338`）

- 触发条件：`ent.spare` 非空（`emit.js:2002`）；段数累加进 `report.spare`（`2042`）。
- 文件**故意不挂载到任何节点上**（没有任何 .tscn 引用它），只当「备胎库」（`emit.js:2298-2299`、`2315`）。
- 每段输出注释头（序号、原块 id、字数、是否外置）+ `const 预备文本_N := """..."""`（`emit.js:2326-2335`）；超过 1024 字的段落**不内联**，改为外置 txt 并在注释里给路径（`2319-2321`、`2329-2332`）。
- 三引号转义规则见 `gdTriple`（`emit.js:2302-2307`）：`\` 与 `"""` 转义，前后各留一个换行。

### 4.5 project.godot 写了什么（`emit.js:2340-2412`）

| 段 | 行号 | 内容 |
| --- | --- | --- |
| 头 | `2348-2349` | `; K4-GENERATED`、`config_version=5` |
| `[application]` | `2351-2356` | `config/name=<工程名>`、`run/main_scene=<第一个屏幕的 res://<屏幕目录>/<屏幕目录>.tscn>`（`2341-2345`，无屏幕则为空串）、`config/features=PackedStringArray("4.4", "GL Compatibility")`、`run/max_fps=60` |
| `[autoload]` | `2358-2370` | `K4Global="*res://全局/全局变量.gd"`、`K4Bus="*res://全局/广播总线.gd"`、`K4Canvas="*res://全局/画布调度.gd"`、`K4Text="*res://全局/大文本.gd"`、`K4Timer="*res://全局/计时器.gd"` |
| `[display]` | `2372-2377` | `window/size/viewport_width=<工程宽>`、`window/size/viewport_height=<工程高>`（取 `em.project.size.width/height`，缺省 480×360 见 `emit.js:2346`）、`window/stretch/mode="canvas_items"`、`window/stretch/aspect="keep"` |
| `[debug]` | `2398-2400` | `settings/gdscript/max_call_stack=10000` |
| `[physics]` | `2402-2404` | `common/physics_ticks_per_second=60` |
| `[rendering]` | `2406-2410` | `renderer/rendering_method="gl_compatibility"`（含 `.mobile`）、`textures/canvas_textures/default_texture_filter=0` |

### 4.6 积木映射.json 的结构（`emit.js:1812-1828`）

写入前先对 `argMismatch` / `argLoss` 去重（`emit.js:1812-1813`，去重实现 `1836-1843`）。JSON 顶层字段：

```
{
  "源文件": em.project.name,
  "版本": em.project.version,
  "方法表条数": { "IR": <MT.IR_METHODS 键数>, "OP": <MT.OP_METHODS 键数>, "类型层": <MT.TYPE_METHODS 键数> },
  "改名": em.report.renames,
  "桩": em.report.stubs,
  "未映射": em.report.unknown,
  "实参个数不匹配": em.report.argMismatch,
  "实参被截断": em.report.argLoss,
  "桩改名": em.report.桩改名
}
```

（`methodtable.js` 实际会被数出 IR=143 / OP=86 / 类型层=51。）

---

## 5. 命名空间与冲突处理

### 5.1 `sanitize(raw, fallback)`（`emit.js:286-297`）

1. 逐字符检查 `IDENT_OK = /[A-Za-z0-9_\u0080-\uFFFF]/`（`emit.js:246`）：**ASCII 字母/数字/下划线与 U+0080 以上的字符（即中文等）保留**，其余一律替换成 `_`（`emit.js:289-293`）。
2. 去掉**开头连续的 `_`**（`emit.js:294`），结果为空则用 `fallback || 'x'`。
3. 以数字开头时前面加 `'n'`（`emit.js:295`）。

### 5.2 `NameSpace.assign(kind, rawName, prefix)`（`emit.js:460-482`）

- 先去重缓存：`byKey = kind + '\u0000' + 原名`，已分配过就直接返回（`emit.js:461-462`）。
- `base = sanitize(rawName, kind)`（`emit.js:463`）。
- **生成名 = `NS_PREFIXES[kind] + base`**（`emit.js:468`）。`prefix` 形参保留只为兼容调用点，**实际前缀一律查表**（注释 `emit.js:466-467`）。
- `NS_PREFIXES`（`emit.js:435-446`）：

| kind | 前缀 | kind | 前缀 |
| --- | --- | --- | --- |
| `变量` | `_v_` | `局部` | `_t_` |
| `列表` | `_l_` | `积木参数` | `_p_` |
| `参数` | `_p_` | `全局变量`/`全局` | `_v_` |
| `全局列表` | `_l_` | `局部变量` | `_v_` |
| | | `局部列表` | `_l_` |

- **重名处理**：`_takenMap` 是**整个 NameSpace 共享**的已用集合；若生成名已被占用，依次尝试 `名_2`、`名_3`…（`emit.js:469-473`）。
- **改名审计**：`out !== base` 时把 `{kind, 原名, 生成名}` 追加进 `ns.renames`（`emit.js:477-480`），最终写进 `report.renames`（`emit.js:848`）→ `积木映射.json.改名`。
- **隔离原理**（注释 `emit.js:416-434`）：K4 变量与参数都在同一个类里（变量成员在 `角色变量.gd`、参数在 `角色自带积木.gd`），K4 允许两者同名 → Godot 报 `There is already a variable named 名 in this scope` 或参数遮蔽成员静默算错；而 **K4 的标识符不允许以 `_` 开头、Godot 允许**，所以所有生成名统一带 `_` 前缀，构造性地与 K4 侧一切名字隔离。`ctx` 是唯一例外（两边都写 `ctx`，它不是 K4 名字，`emit.js:433`）。
- 中文名**原样保留**：`\u0080-\uFFFF` 在 `IDENT_OK` 里，所以 `_v_分数`、`_l_背包` 这类中文成员名在 GDScript 合法（调试器里可见中文名，注释 `emit.js:2079-2092`）。

### 5.3 `procIdent(raw)`（`emit.js:410-414`）

`sanitize(raw, '过程')` 后，若命中 `GD_KEYWORDS`（`emit.js:271-284`）或 `BASE_METHODS`（`emit.js:250-268`），加前缀 `'积木_'`。
- `GD_KEYWORDS` 覆盖 GDScript 关键字（`if/for/func/await/…`）与内建函数/类型名（`sign/abs/len/str/int/float/…`、`Vector2/Node2D/…`）。
- `BASE_METHODS` 覆盖角色基类已实现的方法（`初始化/新建上下文/进入warp/退出warp/一步/找/转整数/取值/列表/比较/算术运算/为真/复制列表/转文本/转数字/取余/等于…/克隆自己/删除自己/设置画布/标为克隆/自己的名字/计时器/重置计时器/开始计时器/停止计时器/当前年/当前月/当前日/按键按下/按键松开/设置音量或速率/增加音量或速率/克隆体编号/克隆体数量/画布落笔`），原因见 `emit.js:246-249`、`254-258`、`262-267`。

### 5.4 其它命名冲突点

- **帽子文件名**（`hatFileName`，`emit.js:1471-1478`）：`HAT_LABEL[kind]` + `_<键或消息>` + `_<序号>`，整体再过 `sanitize`；重名靠序号天然区分。
- **参数名去重**（`emit.js:713-735`）：合并签名时同位置重名 → `基名_2`，记 `report.参数改名`。
- **参数名避开模板函数名**（`emit.js:606-629`）：模板里 `func _秒(_v)` 与参数 `_秒` 撞车 → SHADOWED_VARIABLE，统一加 `_p_`，记 `report.参数避让`。
- **类型层桩撞名改名**（`emit.js:648-662`）：`名` → `名_桩`，记 `report.桩改名`，并写进 json。
- **造型节点名**（`emit.js:1551-1555`、`1929-1932`）：`sanitize(原名,'custom')`，重名加 `_2`；因为名字被清洗过，角色脚本额外生成 `_造型别名()` 的「节点名 → K4 原名」映射（`emit.js:1542-1563`）。
- **保留字表**：`NameSpace` 构造时把 `MT.RESERVED` + `MT.methodNames()` + `extraReserved` 填进 `this.reserved`（`emit.js:450-455`），但**本文件内没有任何地方读取 `this.reserved`**（`assign` 只用 `_takenMap` 前缀去重）。是否有其它模块读取 `ns.reserved` **未确认**。

---

## 6. 散落注释里的关键坑（实测结论清单）

### 6.1 methodtable.js 侧

1. `methodtable.js:3-6`：表分两层——`IR_METHODS`（IR 操作码，多块类型共享）与 `TYPE_METHODS`（无 IR 语义的块，全是桩）。
2. `methodtable.js:18-24`：头部计数（153 唯一 IR 键 = HATS 9 + INLINE_IR 20 + IR_METHODS 124 + unsupported 1）与实测条目数（IR 143 / TYPE 51）不一致，原因未确认。
3. `methodtable.js:55-59`：`change_coord` 的「增加/减少」是同一积木上的复选框，K4 放在 `fields.increase`，core.js 折成 `sign(±1)`；ARG 表曾漏 `sign`，导致「减少 200」被生成成增加（方向反）。
4. `methodtable.js:78-80`：附录 A.4 把 `set_visible` 同时挂在「显示」与「隐藏」两行，故单独给 `设置可见`。
5. `methodtable.js:101-102`：`change_effect` 的 IR 名与 OP 侧入口 `self_change_effect_3` 是两个名字。
6. `methodtable.js:113-117`：`audio_key = volume|rate`，只有 rate 走 `设置音量或速率`（→ pitch_scale），实参顺序是 `(项, 值)`。
7. `methodtable.js:141-143`：`text_stamp` 的对齐来自 `fields.align`；以前只有 (文本, 字号)，对齐被截断丢掉 → 所有图章都按居中画。
8. `methodtable.js:151-155`：`list_delete_special` 的顺序定为 `(列表, 方式, 序号)`；曾出现它与 `列表取值_特殊` **顺序相反**的情况，极易写错。
9. `methodtable.js:158-160`：`list_replace` 曾丢 `方式` → TYPE=last 的替换被当 first 处理。
10. `methodtable.js:167-169`：`IR_METHODS` 与 `OP_METHODS` 的同名条目参数顺序必须一致，因为 `buildSignatures` 按**位置**合并、名字取先遇到的；不一致会撞出重复参数名。
11. `methodtable.js:226-232`：`set_timer_state` 三种 actions → 拆成 `timer_start`/`timer_stop`/`timer_reset` 三条 IR；三者都实现在 `runtime/全局/角色基类.gd` 且登记在 `BASE_METHODS`，所以自带积木层不再给它们声明桩。
12. `methodtable.js:250-252`：`fade_in`/`fade_out`/`timer_stop` 曾经在两张表都有条目 → 同名抢同一签名（IR 逐个实参 vs 桩 1 个 Array）→ Godot 解析期 `Too few arguments`；已删除，**别再往 TYPE_METHODS 加回来**。
13. `methodtable.js:254-255`：`self_glide_coordinate` 留在 TYPE_METHODS 只能生成「实参打包成数组」的桩，而那个桩什么也不做（角色纹丝不动）→ 已迁到 OP_METHODS。
14. `methodtable.js:295-298`：`clone_index`/`clone_count` 曾误登记在 TYPE_METHODS，而 emit 查的是 OP_METHODS → 记 unknown 并生成裸 `0.0`，**克隆体编号/数量静默变 0**。
15. `methodtable.js:301-304`：`get_stage_info` 两张表同名会导致调用点补 `([...])` 而签名声明 `(_项)` → 解析期实参错误；已迁到 OP_METHODS。
16. `methodtable.js:311-314`：`get_choice`/`get_choice_index`/`get_choice_or_index` 留 TYPE_METHODS 没用（取值路径只查 OP_METHODS，桩语句路径会补成 `([...])`）→ 已迁。
17. `methodtable.js:322-326`：`set_width_height_scale` 的轴在 `fields.type`（width/height），签名必须是 `(轴, 百分比)`，不能退化成通用桩的 `([...])`；实测结构见 `_k4tmp_probe/probe_scale.js`。
18. `methodtable.js:328-329`：`TYPE_METHODS.set_scale` 与 A.3 的 `set_scale` 重名 → 加后缀叫 `设置大小_外观`（注明见 §12 待拍板）。
19. `methodtable.js:345-347`：前缀族（`cmp_X`/`math_X`/`is_X`/`coord_X`）由生成器按前缀归一，不逐条列表。
20. `methodtable.js:412-414`：K4 的「当前 年/月/日」以前和 `get_timer` 一起映成 `op('timer')` → **日期全变成计时器**。
21. `methodtable.js:424-426`：按键侦测有「按下/松开」下拉（`fields.key_event_type`）→ 产出 `key_released`。
22. `methodtable.js:431-434`：询问并选择的配套取值 `get_choice`/`get_choice_index`。
23. `methodtable.js:447-450`：`get_stage_info` 以前走 TYPE_METHODS 桩恒返回 0 → **用舞台宽高算坐标的积木全错**。
24. `methodtable.js:451-454`：`calculate` 块曾在两张表里都没有 → 取值走 unknown → 生成裸 `0.0`（Phigros 里 16 处）。
25. `methodtable.js:455-458`：`self_glide_coordinate` 的 `await: true` 含义是「Tween + await tween.finished」——挂起的是当前脚本（协程）而不是主线程，画面照常刷新，动画播完才继续下一个积木。
26. `methodtable.js:506-508`：保留字判定规则 = K4 名 ∈ `RESERVED` ∪ `methodNames()` ∪ 自定义积木名 → 加前缀。

### 6.2 emit.js 侧（GDScript 语法限制 / 语义陷阱）

27. `emit.js:4-6`：架构三句话——积木 = 角色类方法（中文名）、控制流 = 生成代码、事件 = 帽子节点。
28. `emit.js:28-31`：自带积木层以 runtime 模板为底、只补缺的方法成桩 —— 目的是「转换器永不失败」。
29. `emit.js:246-249`：角色基类已实现的方法名必须当保留字，否则自定义积木/变量撞上会报 `Too few arguments for "初始化()" call` 或成员遮蔽。
30. `emit.js:254-258`：`转文本/转数字/取余` 是生成代码的基础设施，必须放**库层**；留在桩层（`return ""`/`return 0.0`）会让任何未实现它们的工程**静默算错**。
31. `emit.js:270-284`：自定义积木名撞 GDScript 关键字/内建名会让生成物直接语法错误（→ `procIdent` 加 `积木_`）。
32. `emit.js:300-311`：会真正让出帧的语句 = 循环 + await 方法；`bodyNeedsAwait` 必须**深扫表达式**，因为 `elif 角色.可获得buff(...)` 这种条件里的过程调用也会让整个函数变成协程。
33. `emit.js:371-373`：`staticKind` 的数值型清单要列全，否则值会被当「动态值」→ 退回 `角色.等于()`/`角色.转数字()`（正确但啰嗦）。
34. `emit.js:416-434`：★命名隔离前缀★ —— 变量 `_v_`、列表 `_l_`、参数/积木参数 `_p_`、局部 `_t_`；根因是 K4 变量与参数会落在同一个类里（`There is already a variable named 名 in this scope`）；依据是 K4 不允许 `_` 开头而 Godot 允许。
35. `emit.js:493-497`：超长文本内联会让编辑器卡死（实际见过 800 万字符一个字面量）→ 外置成 txt。
36. `emit.js:517-518`：`GDEF` 里 `v` 用 `0.0` 而不是 `null` —— `null` 参与算术会报 `Invalid operands 'float' and 'Nil'`。
37. `emit.js:568-572`：只看「函数名存在」判断桩是不够的，模板里有不少函数壳子本身就是桩（例如 `显示隐藏计时器`）。
38. `emit.js:606-614`：参数名撞函数名 → `The local function parameter "_秒" is shadowing an already-declared function`，一次转换几百条会刷满日志、埋掉真错误 → 加 `_p_` 前缀（调用点按位置传参不受影响）。
39. `emit.js:632-643`：签名合并是唯一真源；以前调用点按自己那张表的条数补、接口按合并结果声明 → Godot **解析期** `Too few arguments for "停止计时器()" call`，整个 .tscn 加载失败（表现为「场景似乎无效/损坏」）。
40. `emit.js:645-647`：桩是 `角色.名([...])`（1 个 Array），IR/OP 是逐个实参，同名抢签名 → 桩自动改名 `_桩`。
41. `emit.js:713-718`：按位置合并 + 名字取先遇到的 → 可能撞出重复参数名 → GDScript `Duplicate parameter name`，症状是「整个 class_name 链解析不了」（例：`list_item_special` 曾生成 `(_列表, _序号, _序号)`）。
42. `emit.js:759-767`：外置文本放在脚本所在目录（角色删了文本跟着走），同目录同内容只存一份、编号从 1 起；**不用** `FileAccess.get_file_as_string()` 的原因是一次调用读一次盘，落在循环里就是灾难。
43. `emit.js:825-827`：局部变量必须声明在**所有角色共用的类**（角色自带积木/角色变量）里；声明在派生的 `<角色名>.gd` 会让 Godot 静态检查报「找不到成员」。
44. `emit.js:859-861`：有引用没声明的局部成员要兜底登记，否则运行时报找不到 `角色.n0`。
45. `emit.js:889-893`：过程体里 `ref` 先按**参数**匹配 —— 反编译器对参数和变量用的是同一种 ref 节点。
46. `emit.js:915-921`：`get_sensing_current_scene` 是 `get_current_scene` 的孪生块（外观/侦测两个分类各一个），含义都是「我现在在哪个屏幕」；以前只认前者，后者落 `0.0` → 拿它比屏幕名永远为假。
47. `emit.js:930`：K4 里「没有值」就是 0（`null` 参与算术会报 Nil）。
48. `emit.js:937-945`：K4 真值规则（`0`/`"0"`/`""`/`"false"` 都假）与 Godot 不同（非空字符串一律真）→ 动态值一律包 `角色.为真()`。
49. `emit.js:962-972`：动态值必须显式转换（K4 里 `"175" / 1000` 合法，GDScript 报 `Invalid operands 'String' and 'float' in operator '/'`）；举例：phi 转换器里 `列表取值_特殊(输入,"first",1.0) / 1000.0` 就是这么炸的。
50. `emit.js:982-989`：K4 的 `+` 是「两侧都能当数字就相加，否则拼字符串」（`"5"+1=6`，`"a"+1="a1"`）→ 只有两侧都是**数字字面量**才内联 `+`。
51. `emit.js:994-995`：K4 取余符号**跟随除数**（`-7 mod 3 = 2`），GDScript 的 `fmod` 不是 → 走 `角色.取余()`。
52. `emit.js:1001-1002`：K4 的 `转文本(3.0)` 得 `"3"`，GDScript 的 `str(3.0)` 得 `"3.0"`。
53. `emit.js:1023-1029`：只有两侧都确定是数字才内联比较运算符；其余走 `角色.等于/小于…`，因为 `"175" == 175` 在 GDScript 是 false（不报错但语义错）、`"175" <= 175` 直接报错。
54. `emit.js:1067-1071`：自定义积木调用**一律 await**；以前靠「过程体是否含循环/等待」判断是静态近似，失手就报 `Function X() is a coroutine, so it must be called with "await"`。
55. `emit.js:1075-1082`：`join` 是变参，K4 可能给 3 个以上文本 → 折叠成嵌套二元调用。
56. `emit.js:1129-1155`：实参个数不等的两种口径——① 缺的每一位都有默认值 = 可省略参数，不报；② 截断 = **真丢实参**，记 `argLoss` 并由 convert.js 升级成错误。
57. `emit.js:1169-1179`：★无条件 await★ 的理由（避免静态近似失手导致整个脚本失败）与代价（一次协程开销）——「用确定性换性能」。
58. `emit.js:1216-1218`：`wait_until` 直接展开成 `while`，因为反编译器给的是**布尔表达式**而不是可调用对象（避免生成 lambda）。
59. `emit.js:1253-1255`：`ask_choose` 曾因 ARG 写 `['args']` 而 IR 节点上没有 args 字段 → 生成 `角色.询问并选择(ctx, 0.0, 0.0)`，问题和选项全丢。
60. `emit.js:1286-1293`：`set_width_height_scale` 的实测结构（`fields.type` 是轴、`shadows.value` 是百分比）→ 必须显式带出轴，否则「将角色的高度设为 X」被当成等比缩放。
61. `emit.js:1312-1317`：报告口径——类型层块若在 runtime 模板里已有真实现，**不能**报成「待实现」，否则每次转换都挂假缺口、掩盖真桩。
62. `emit.js:1341-1348`：「增加 X」不能无脑 `+=`：K4 里 `数字 + 文本` 合法，GDScript 报 `Invalid operands 'float' and 'String' in operator '+'`，而该错误会**打断整个脚本的宏执行**（后面的积木全不跑）。
63. `emit.js:1373-1377`：语句位置的 `k:'op'` 以前没有分支 → 落进「未映射语句积木」生成 `pass`（K4 的「滑行坐标」就是这么丢的，日志里只有一行「未映射词条 k:op」）。
64. `emit.js:1402-1408`：云变量/云列表的名字**不要**走 `varRef`/`NameSpace`（会被改名，导致「设置」用一个名字、「取值」用另一个，运行期对不上）。
65. `emit.js:1523-1526`：帽子必须用 `_上下文()`，不能用 `角色.新建上下文()` —— 绿旗重启要靠旧协程手上的 ctx 标记作废，否则会出现两个协程同时跑同一段积木。
66. `emit.js:1542-1546`：造型名被清洗成合法节点名后，运行时的 `设置造型(原名)` 查不到 → 生成 `_造型别名()` 映射（节点名 → K4 原名）。
67. `emit.js:1567-1571`：初始 transform / 可见性不再由脚本赋值，`.tscn` 是唯一真源（编辑器里改即生效）。
68. `emit.js:1594-1601`：K4 存 float32、读出来带 1e-13 级噪声 → `k4Number` 归零（`|n| < 1e-4` 当 0）并收到 7 位有效数字，`.gd` 初值与 `.tscn` 属性走同一函数保证一致。
69. `emit.js:1610-1624`：烘进 `.tscn` 的原因（编辑器不执行 `_ready()`，否则 2D 视图里角色全堆在 (0,0)、大小全 100%）；`.tscn` 是 Variant 解析器，属性必须是**字面量**（rotation 先算成弧度）；公式必须与 `runtime/全局/角色基类.gd._apply_transform()` 一致（`position=(k4_x,-k4_y)`、`rotation=deg_to_rad(90-k4_direction)`、`scale=k4_size_percent/100`）。
70. `emit.js:1626-1633`：`.tscn` 是唯一初始状态真源，且只在偏离默认值时才写属性，所以初始化反读时每个字段都带默认回退。
71. `emit.js:1859-1875`：★节点顺序 = 绘制顺序★（舞台层 → 屏幕绘制 → 基础角色层）；以前没有舞台层，背景板盖住画笔层，实测症状是画笔指令数组一直在涨但屏幕上一条线都看不到（录像全白）。
72. `emit.js:1879-1892`：`屏幕绘制` **绝对不能**写 `z_index`（哪怕 -100）：Godot 先按 z_index 全局排序、相同才按树顺序，写负值会把画笔压到所有 z_index=0 的东西底下（背景板又盖回来）。
73. `emit.js:1906-1908`：舞台目录名用「舞台」避免套娃，但**节点名必须保留 K4 原名**（跨角色 `角色.找("背景")` 靠名字定位）。
74. `emit.js:1927-1928`：Godot 节点名不允许 `. : @ / " %` 和空名，否则**编辑器打不开这个场景**（运行期 `load()` 反而容忍）。
75. `emit.js:1943-1945`：K4 里一个角色同时只显示当前造型 → 其余 `visible = false`。
76. `emit.js:1955-1961`：K4 的 pivot 是相对图片中心的偏移、y 向下（与 Godot 同向）→ Sprite2D 的 `position = -pivot`，每个造型各自带偏移。
77. `emit.js:1963-1966`：pivot 常带 1e-6 级噪声 → 0.01px 以下当 0，避免每个造型多一行无意义 position。
78. `emit.js:2013-2016`：实例化帽子的节点行**必须带 `parent:'.'`**，否则 Godot 当成第二个根节点报 `Invalid scene: node X does not specify its parent node`，整个场景加载失败（症状只在有点击帽子的角色上出现）。
79. `emit.js:2059-2064`：拆「自带积木 / 自定义积木」两层的原因：前者是引擎能力的桩、后者是用户 K4 代码的真实现，混在一起就无法整体替换。
80. `emit.js:2077-2082`：变量/列表声明单独一层的原因：它是数据不是行为，且必须声明在共同祖先上（全部角色共用一个类）。
81. `emit.js:2116-2123`：同名变量（本工程的 `x/y/t/a/j/n`）在 K4 里是**多个独立变量**，这里共用同一个成员名 —— 成员是「每实例一份」，值互不影响，初值由各角色 `_ready()` 赋。
82. `emit.js:2150-2151`：`BASE_METHODS` 里的方法子类**不能再声明**，否则报 `The function signature doesn't match the parent`。
83. `emit.js:2178-2181`：补桩时必须跳过 `xxx_桩`，否则会生成一个**签名错误**的同名方法把真的那个遮蔽掉。
84. `emit.js:2203-2208`：接口层参数类型统一放宽成 `Variant`（`ctx` 除外），因为反编译器给不出调用点确切类型，收紧会同时造成解析期与运行期的实参类型错误。
85. `emit.js:2212-2219`：★缩进必须是 Tab★ —— 模板全篇 Tab，混用空格会报 `Used tab character for indentation instead of space as used before in the file`，**整个 角色自带积木.gd 加载失败**，继承链断掉，所有角色脚本跟着报 `Could not resolve super class inheritance from 角色类`（看起来像继承链写坏了，其实只是缩进）。
86. `emit.js:2220-2223`：★桩体也必须是协程★ —— 调用点无条件 await，桩若完全同步，在「重复执行」里会一帧跑满几十万次卡死；让桩 `await get_tree().process_frame` 语义上等价于「这一步没效果，但下一次循环等下一帧」。
87. `emit.js:2234-2238`：自定义积木是**全局**的，且过程体以调用者身份运行（`var 角色 := self`，K4 里跨角色调用时局部变量按调用者实体解析）。
88. `emit.js:2291-2299`：`预备块.gd` 故意不挂载到任何节点上，只当备胎库（里面可能是唯一一份数据）。
89. `emit.js:2302-2306`：三引号字符串要转义 `\` 与 `"""`，前后各留一个换行（避免结尾 `"` 与闭合符连成 `""""`，也让 Godot 正确去掉公共缩进）。
90. `emit.js:2363-2367`：导出 exe/apk 时必须在导出预设的「非资源文件过滤器」里加 `*.txt`，否则外置文本不会打进 pck、运行时读出空串。
91. `emit.js:2379-2397`：递归上限实测 —— 键名必须是 `settings/gdscript/max_call_stack`（带中间 `settings/`）；**Godot 4.7.2 非编辑器运行时该设置根本不生效**，递归硬上限 ~2047/2048 层（`Stack overflow`），而 K4 的 `max_call_stack_size` 是 10000，**这个差距靠设置消不掉**，要跑上千层递归得在转换器做尾递归改写。
92. `emit.js:1918`、`2007-2009`：角色 .tscn 的脚本 id 先写占位 `__ACTOR__`，落地前回填真实 `ExtResource` id。
93. `emit.js:1900-1901`：舞台本身也当作一个「角色」处理（`entities = [sc].concat(sc.actors)`）。

### 6.3 代码中「写了但没有消费点」的遗留项（仅本文件内可确认）

| 项 | 行号 | 状态 |
| --- | --- | --- |
| `bodyNeedsAwait` | 定义 `emit.js:312-346` | 本文件内**无调用点**（仅自身递归调用，`emit.js:320`）；因为 `call()` 改成无条件 await 后不再需要 |
| `AWAIT_KINDS` | `emit.js:302-305` | 只被 `bodyNeedsAwait` 使用，因而实际未被使用 |
| `report.calls` | 声明 `emit.js:537` | 无写入点 |
| `report.stats` | 声明 `emit.js:540` | 无写入点 |
| `this.relax` | 写入 `emit.js:1164` | 本文件内无读取点（`emit.js:1802` 注释说「接口文件会读」；`emitBuiltinLayer` 实际把参数类型一律放宽成 Variant，`emit.js:2207`） |
| `this.reserved` | 写入 `emit.js:450-455` | 本文件内无读取点 |
| `MT.INLINE_IR` | `methodtable.js:502-504` | `emit.js` 中无引用 |
| `num()` | 定义 `emit.js:1590-1592` | 无调用点（实际都用 `gdNum`/`k4Number`） |
| `nextId()` / `uidSeq` | `emit.js:1662-1663` | 无调用点 |
| `Emitter.prototype.esc` | `emit.js:756` | 无调用点 |
| `Tscn.head` | `emit.js:1665` | 只初始化，未使用（`sub` 只在 `dump` 里读取，从未被 push） |
| `this.opts` | `emit.js:527` | 只赋值，未读取 |
| `canvasScript`（`ns.assign('脚本','屏幕绘制','s_')` 的返回值） | `emit.js:1853` | 赋值后未使用，暗示 `屏幕绘制.gd` 不由 emit 生成 |

---

## 附：本次核对的统计数字（可复现口径）

- 文件行数（按 `\n` 计数）：`emit.js` 2421、`methodtable.js` 560。
- 表条目（正则 `^\s+标识符:\s*\{` 按键统计，无重复键）：IR_METHODS 143、TYPE_METHODS 51、OP_METHODS 86、FAMILY_METHODS 5。
- 其它计数：`HATS` 9、`INLINE_IR` 20、`uncertain:true` 11、`inline:true` 10、`stub:true` 50、`await:false` 183、`await:true` 方法条目 18。
- `cat` 分布（按出现次数）：physics 33、looks 26、sensing 26、operator 26、data 23、motion 18、pen 17、control 11、sound 10、运算 3、数据（桩）2、运动 2、event 1、外观（桩）1。
