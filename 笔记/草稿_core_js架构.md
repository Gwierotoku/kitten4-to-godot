# core.js 架构笔记（Kitten4 .bcm4 解析 + 积木反编译 → IR）

- 目标文件：`新版本/lib/k4/core.js`（共 3038 行）
- 性质：严格只读分析笔记；本文所有结论均来自 `core.js` 源码本身（行号即该文件行号），不含推测；无法从代码确认的地方标注「未确认」。
- 配套模块：`blocks.js`（只被用到 `BLOCKS.SUPPORTED`，见 L21、L2688-L2691）。

---

## 0. 一分钟总览

core.js 只做三件事：

1. **工程解析**：`parseProject(raw)`（L2346-L2520）把 .bcm4 的 JSON 规范化成 `project` 对象（含 scenes/actors/variables/lists/names）。
2. **反编译**：`BlockModel`（L66-L218）把 Blockly 的 `{blocks, connections, comments}` 变成可遍历图；`Decompiler`（L248 起）把图变成 IR（表达式树 + 语句树）。
3. **素材抽取**：`extractAssets(rawProject)`（L2905-L3022）把内嵌 base64 造型/声音解析成字节。

主管道：

```
raw JSON
  └─ parseProject ──> project {scenes, actors, variables, lists, names, ...}
        ├─ buildProcRegistry ──> procRegistry（全工程自定义积木表）
        ├─ extractAssets     ──> assets {styles, audios, warnings, stats, byIdName}
        └─ 每个 scene / actor: toIR()
              ├─ entityScripts()  ──> {scripts, procs, warnings, model, decompiler, nameStats}
              ├─ entityStyles()   ──> styleInfo {ids, byId, names, files, pivots, paths}
              └─ collectSpareTexts()（悬空 text 块备份）
  └─ projectToIR 返回 IR {project, scenes, warnings, blockTypes, supported, assets, procRegistry}
```

文件自述「不依赖任何宿主 API（无 fs / 无 DOM），可直接在 Node 与浏览器中运行」（L5）。

---

## 1. 模块结构

### 1.1 UMD/IIFE 包装（L19-L29）

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports && typeof K4_BUNDLED === 'undefined') {
    module.exports = factory(require('./blocks.js'));      // L20-L22
  } else {
    var blocksNS = (typeof K4_BLOCKS !== 'undefined') ? K4_BLOCKS
      : ((root && root.K4 && root.K4.blocks) || null);      // L24-L25
    if (root && root.K4) root.K4.core = factory(blocksNS);  // L26
  }
})(globalThis | self | this, function (BLOCKS) { 'use strict'; ... })   // L28-L30
```

- **Node 分支**（L20-L22）：仅当 `module.exports` 存在且 **`K4_BUNDLED` 未定义**时走，目的是让打包产物（`dist/k4tools.js`）不被 Node 分支拦截（L23 注释）。
- **浏览器/打包分支**（L23-L27）：优先取全局 `K4_BLOCKS`，否则取 `root.K4.blocks`；最终挂到 `root.K4.core`。
- 工厂函数接收唯一依赖 `BLOCKS`（L29），内部 `'use strict'`（L30）。

### 1.2 导出清单（`return {...}`，L3024-L3037）

| 导出名 | 行号 | 说明 |
|---|---|---|
| `parseProject` | L3025 | raw JSON → 规范化 project |
| `projectToIR` | L3026 | 主入口：raw JSON → IR |
| `entityScripts` | L3027 | 单实体工作区 → scripts/procs |
| `collectBlockTypes` | L3028 | 统计积木类型出现次数 |
| `extractAssets` | L3029 | 抽取造型/声音素材 |
| `parseDataUri` | L3030 | data URI → {mime, ext, bytes, ok} |
| `base64ToBytes` | L3031 | 纯 JS base64 解码 |
| `safeFileName` | L3032 | 文件名安全化 |
| `BlockModel` | L3033 | 图模型类 |
| `Decompiler` | L3034 | 反编译器类 |
| `HAT_TYPES` | L3035 | 帽子块类型表（L2125-L2147） |
| `helpers` | L3036 | `{attrOf, fieldOf, shadowType}` |

注意：**`isUuid` / `resolveIRNames` / `toIR` / `buildProcRegistry` / `entityStyles` / `collectSpareTexts` / `keyCodeToName` 等均未导出**（模块内私有）。

### 1.3 基础工具（L32-L60）

| 函数 | 行号 | 职责 |
|---|---|---|
| `isObj(v)` | L36-L38 | 非 null、object、非数组 |
| `attrOf(xml, name)` | L40-L44 | 用 `new RegExp(name + '\\s*=\\s*"([^"]*)"')` 抓 XML 属性 |
| `fieldOf(xml, name)` | L46-L51 | 抓 `<field name="X">…</field>` 文本内容 |
| `shadowType(xml)` | L53-L55 | = `attrOf(xml,'type')` |
| `shadowId(xml)` | L58-L60 | = `attrOf(xml,'id')`；注释点明「影子元素自己的 id 指向**同一个造型选择器对应的真实块**」（L57） |

`attrOf` 未转义 `name`，仅用于固定属性名（`type`/`id`/`elseif`/`else`）——代码事实，无安全考量说明。

---

## 2. BlockModel 类

### 2.1 构造：把 raw.blocks + connections 建成图（L66-L106）

入参 `blockData` 即 `{blocks, connections, comments}`：

- `this.blocks`（L68）、`this.connections`（L69）、`this.comments`（L70）：非对象时退化成 `{}`。
- **`parentOf`**（L72-L91）：双层遍历 `connections[from][to]`，写入
  `parentOf[to] = { parentId: from, kind: info.type === 'next' ? 'next' : 'input', inputName: info.input_name || null, raw: info }`（L83-L88）。
  - 语义：**任意** connection 的目标块都登记为「被装入」。
  - 若同一子块有多个父，后遍历者覆盖（仅有最后一个保留）——代码事实。
- **`nextOf`**（L93-L105）：只挑 `type === 'next'` 的连接，`nextOf[from] = to`。
  - 同一父块有多个 next 目标时，后者覆盖前者（L101-L103）。

### 2.2 方法清单

| 方法 | 行号 | 职责 | 备注 |
|---|---|---|---|
| `get(id)` | L108-L110 | 取块对象或 null | — |
| `typeOf(id)` | L112-L115 | 取块 type 或 null | — |
| `isNested(id)` | L118-L120 | `parentOf` 里有键即「被装入」 | 只要出现在 connections 目标里就算 nested（含值块） |
| `nextId(id)` | L122-L124 | next 后继或 null | — |
| `input(blockId, inputName)` | L127-L185 | **值输入三级回退** | 见 2.3 |
| `statementEntry(blockId, inputName)` | L188-L198 | 语句输入入口块 id | **只查 connections**，不走 shadows、不走 parent_id |
| `topLevelIds()` | L201-L206 | 所有 `!isNested(id)` 的块 id | 供 `entityScripts` 找帽子块（L2564） |
| `statementChain(entryId)` | L209-L218 | 沿 `nextId` 收集整条语句链 | `guard` 上限 100000（L213），防环死循环 |

### 2.3 `input()` 的三级回退（L127-L185）——文件里最关键的读取逻辑之一

返回形态：`{kind:'block', id, block}` \| `{kind:'rawshadow', text}` \| `null`（L126 注释）。

1. **第 1 级：connections 精确反查**（L128-L141）
   - 遍历所有 connection 源，但 `if (keys[i] !== blockId) continue;`（L131）——只处理本块为源的行。
   - 命中条件：`info.type !== 'next' && info.input_name === inputName`（L137）。
   - **输入名必须精确匹配**，不做大小写/别名容错（容错在上层 `valueAny`）。
2. **第 2 级：退化到 `parent_id`**（L144-L166）
   - 前置门槛（L148-L156）：只有本块**一条 input 类连接都没有**（`hasInputRows === false`）时才允许退化。
   - 注释（L144-L147）给出原因：K4 在值输入上也写 `parent_id`；若不作门槛，「语句输入」的孩子（如 `DO0` 里的积木）因 `parent_id` 指向本块，会被误判成本块某个值输入的取值，污染表达式解析。
   - 遍历所有块，跳过 `is_shadow === true`（L161），要求 `cand.parent_id === blockId`（L162），且 `this.parentOf[cand.id]` **不存在**（L163-L164：即该块没有 connection 记录）才作为退化结果返回。
3. **第 3 级：`shadows[inputName]` 的 XML**（L167-L183）
   - 若 `attrOf(xml,'id')` 指向的块存在、`is_shadow === true`、且 `fields` 非空 → 返回**真实影子块** `{kind:'block', id:sid, block:sb}`（L179-L181）。
   - 否则返回 `{kind:'rawshadow', text:xml}`（L182）。
   - 关键注释（L170-L176）：**K4 把影子块的「当前值」另存一份在 `blocks[影子id]` 里**；`shadows` XML 只是**创建时的默认值**，用户改过后不再更新。实例：`text_split` 的 `TEXT_TO_SPLIT` 影子 XML 里还是 `"1,2,3,4"`，而 `blocks[id].fields.TEXT` 才是真实的 100+ 字文本。两种形态都存在（有的影子 `fields` 为空、内容只在 XML 里），所以按「有没有值」选。
4. 全部落空 → `return null`（L184）。

### 2.4 为什么 `statementEntry` 与 `input` 不能混用

- `statementEntry`（L188-L198）只认 connections 的 `input_name`，返回**子块 id 字符串**；`DO0`/`ELSE`/`STACK` 等语句槽全走它。
- `input` 是值槽读取，且带 shadows/parent_id 两条回退。
- 上层对应封装：`Decompiler.blockBody`（L2100-L2104）走 `statementEntry` + `chain`；`Decompiler.value`（L422-L443）走 `BlockModel.input`。

---

## 3. IR 节点类型表

### 3.1 值构造辅助函数（L224-L242）

| 构造函数 | 行号 | 返回形态 | 字段说明 |
|---|---|---|---|
| `lit(v)` | L224-L226 | `{k:'lit', v}` | 原样 |
| `num(v)` | L227-L230 | `{k:'lit', v:Number, num:true}` | `parseFloat`，非有限数则 0；**有 `num:true` 标记** |
| `str(v)` | L231-L233 | `{k:'lit', v:String, str:true}` | null/undefined → `''`；**有 `str:true` 标记** |
| `ref(v)` | L234-L236 | `{k:'ref', name}` | 变量引用（名字） |
| `listRef(v)` | L237-L239 | `{k:'listref', name}` | 列表引用（名字） |
| `op(name, args)` | L240-L242 | `{k:'op', op:name, args:[]}` | 运算/调用节点，`args` 缺省 `[]` |

另有直接手写的字面量节点：

- 布尔字面量：`{k:'lit', v:Boolean, bool:true}`（L914，来自 `logic_boolean`）。
- 空值字面量：`{k:'lit', v:null}`（L917，来自 `logic_null`）。
- 文本字面量（目标选择器）：`{k:'lit', v:'随机位置'|'鼠标指针'|实体名, str:true}`（L374-L377）。
- 空布尔：`{k:'emptybool'}`（L456 `logic_empty` 影子；L619 `logic_empty` 块）。

### 3.2 IR 里出现过的全部 `{k:...}` 取值

**值节点**（出现在 `expr()` / `value()` 返回值、`op.args`、语句节点字段里）：

| k | 首次出现行号 | 说明 |
|---|---|---|
| `lit` | L225 | 字面量（用 `num`/`str`/`bool` 标志区分子类；可为 null） |
| `ref` | L235 | 变量名引用 |
| `listref` | L238 | 列表名引用 |
| `op` | L241 | 运算/取值调用；**语句位置也会出现**（见 L1921 `self_glide_coordinate`） |
| `emptybool` | L456、L619 | 空布尔槽 |
| `unknown` | L1120 | 未支持取值积木的占位：`{k:'unknown', type, inputs, fields}` |
| `args` | L1179、L1189 | 实参打包：`{k:'args', args:[...]}`（`callArgs` 的返回值，被塞进 op 的第三参） |

**语句节点**（`stmt()` / `chain()` 的产物，`scripts[].body` 的元素）：

`nop`(L1313、L2087)、`stub`(L1307)、`forever`(L1323)、`repeat`(L1326)、`repeat_until`(L1329)、`if`(L1332)、`wait`(L1335)、`wait_until`(L1338)、`break`(L1341)、`broadcast_body`(L1350)、`broadcast_body_wait`(L1356)、`broadcast`(L2069)、`broadcast_wait`(L2071)、`show`(L1362、L1975)、`hide`(L1364、L1977)、`fade_in`/`fade_out`(L1368)、`set_costume`(L1406-L1407、L1985)、`next_costume`(L1410-L1414)、`goto_xy`(L1422、L1941、L1944、L1958)、`goto_target`(L1428、L1955)、`face_to`(L1432)、`point_towards`(L1434、L1953)、`change_rotation`(L1436、L1951)、`set_rotation`(L1947)、`set_coord`(L1439、L1906、L1939)、`change_coord`(L1897)、`glide_to`(L1445)、`bounce`(L1451、L1960)、`change_scale`(L1457、L1971)、`set_scale`(L1969)、`flip`(L1462)、`say`(L1468、L1476、L1987)、`say_for`(L1480、L1989)、`think`(L1991)、`think_for`(L1993)、`play_sound`(L1485-L1487、L2016)、`stop_sound`(L1489、L2020)、`set_volume`(L1500、L2022)、`set_volume_or_rate`(L1499)、`change_volume`(L1507、L2024)、`change_volume_or_rate`(L1506)、`set_var`(L1514、L2043)、`change_var`(L1527、L2046)、`list_add`(L1534、L2049)、`list_delete_special`(L1541)、`list_delete`(L2052，不可达，见 §8.2)、`list_insert`(L1549、L2058)、`list_replace`(L1563、L2061)、`list_clear`(L2055)、`list_copy`(L1582)、`list_show`(L2063)、`list_hide`(L2065)、`pen_clear`(L1589、L2028)、`pen_down`(L1591、L1675、L2030)、`pen_up`(L1593、L1677、L2032)、`pen_size`(L1632、L2036)、`pen_change_size`(L1636)、`pen_color`(L1638、L2034)、`pen_change_color`(L1652)、`pen_change_shade`(L1654)、`pen_color_property`(L1657)、`pen_change_property`(L1668)、`pen_stamp`(L1616、L2038)、`text_stamp`(L1603)、`fill_style`(L1619)、`fill_path`(L1627)、`layer`(L1684)、`layer_move`(L1689)、`layer_with_pen`(L1694)、`timer_start`/`timer_stop`/`timer_reset`(L1704-L1707、L1844)、`ask_choose`(L1722)、`destroy_self`(L1732、L1864)、`clone_self`(L1742)、`clone_target`(L1743)、`clone`(L1869)、`cloud_set`(L1760)、`cloud_change`(L1758)、`cloud_list_append`(L1763、L1765)、`set_effect`(L1799)、`change_effect`(L1813)、`call`(L1835、L2076)、`call_remote`(L1833)、`return`(L1839、L2081)、`stop`(L1857、L1860)、`restart`(L1862)、`warp`(L1866)、`tell`/`tell_sync`(L1885)、`move_steps`(L1894、L2004、L2008)、`set_visible`(L1979)、`set_opacity`(L1981)、`change_opacity`(L1983)、`self_glide_coordinate`（**以 `op` 节点出现在语句位置**，L1921）。

> `op` 的 `op` 字段值（如 `add`/`str_split`/`list_item`/`entity_property`/`random_int`/`time_year`/`calculate`/`self_glide_coordinate` …）是运算名，不属于 `k` 的取值域，不在此表。

### 3.3 各节点的字段差异（下游生成器要点）

- `lit`：永远有 `v`；`num:true` 表示数值、`str:true` 表示文本、`bool:true` 表示布尔；`{k:'lit',v:null}` 表示 null（无任何标志）。
- `ref` / `listref`：只有 `name`（字符串，已完成名字解析或保留 uuid，见 §6）。
- `op`：`op`（名字）+ `args`（值节点数组；个别实现里第三参可能是 `{k:'args'}` 对象，见 L1094 `call_remote` 的 `cargs`、L661 的嵌套 op）。
- `unknown`（L1120）：`{k, type, inputs:{输入名→值节点}, fields:{字段名→标量}}`——field 值若形如 `{value:...}` 则取 `.value`（L1117）。
- `stub`（L1307）：`{k, type, inputs, fields, blockId}`，是「未支持语句积木」的统一兜底。
- 语句节点字段命名不统一（`body`/`cond`/`times`/`seconds`/`name`/`value`/`target`/`option`…），生成端必须按 `k` 分支处理。

---

## 4. Decompiler 类

### 4.1 构造与依赖注入（L248-L265）

```js
function Decompiler(options) {
  this.model = null;                                   // L249 由 entityScripts 事后注入（L2562）
  this.warnings = [];                                  // L250
  this.options = options || {};                        // L251
  this.names = this.options.names || null;             // L253 名称注册表（uuid→中文名）
  this.procRegistry = this.options.procRegistry || null; // L259 全工程自定义积木注册表
  this.entName = this.options.entName || '';           // L261 当前实体名
  this.procs = [];                                     // L263 本角色自己拥有、要生成函数的自定义积木
  this._procSeq = 0;                                   // L264 tell_ 序号
}
```

依赖注入语义：

- **`names`**（L252-L253）：来自 `parseProject` 的 `names` 对象，提供 `resolve(kind,id)`、`resolveAny(id)`，把 UUID 换回名字。
- **`procRegistry`**（L254-L259）：`{byDefId:{定义块id→{name,owner,params}}, owners:{名字→owner}}`；注释强调 **Kitten4 自定义积木是跨角色全局的**，调用块的 `def_id` 就是定义块 id，定义块可能挂在别的角色上。
- **`entName`**（L260-L261）：当前实体名，用于判定过程是 local 还是 remote。
- 实际注入点：`entityScripts` L2557-L2561（`names` / `procRegistry` / `entName`），`dec.model = model`（L2562）。

### 4.2 关键方法清单（按职责分组）

**A. 命名/字段解析**

| 方法 | 行号 | 职责 |
|---|---|---|
| `entityName(id)` | L304-L311 | 实体 id → 名；先查 `SELF_ALIASES`（L298：`__self→自己`、`__mouse→鼠标指针`、`__stage→舞台`、`__edge→边缘`），再 `names.resolve('actors', id)` |
| `varName(id)` | L314-L319 | 变量 id → 名（`names.resolve('vars',…)`） |
| `listName(id)` | L321-L326 | 列表 id → 名（`names.resolve('lists',…)`） |
| `cloudName(block)` | L415-L419 | 云变量/云列表：先读字段 `valname`、退化到 `VAR`，再 `resolve('clouds', id)` |
| `field(block, name, dflt)` | L385-L393 | 字段读取，**大小写不敏感容错**（L390 `keys[i].toLowerCase()`）；注释 L384 说明 K4 field 名大小写不完全统一 |
| `目标字段(block, 字段名)` | L372-L378 | 「目标选择器」字段 → 文本字面量节点；`__random→随机位置`、`__pointer/__mouse→鼠标指针`，其余走 `entityName` |
| `textish(node)` | L353-L358 | 尽力把值节点还原成字面文本：`lit` → `String(v)`（null → `''`）、`unknown` → `''`、其它（动态表达式）→ **`null`** |
| `listArgName(blockId, block, names?)` | L344-L351 | 列表名三级：①字段 `VAR`（退化 `LIST`）→ `listName`；②`valueAny(blockId, names \|\| ['VAR','LIST','TARGET'])` 得到 `listref` 节点取 `.name`；③`textish` 后 `listName` |
| `isNumericText(s)` | L549-L551 | 纯数字文本判定（正则含可选指数） |
| `影子取值(xml)` | L530-L537 | **影子**按字段名取值：`NUM`→数字、`TEXT`→文本、空/缺→`num(0)` |
| `字段取值(block)` | L540-L547 | **块**版本：`fields.NUM`→数字、`fields.TEXT`→文本、空/缺→`num(0)` |
| `数值或文本(raw)` | L561-L567 | 与上两者的区别：**按内容**判定（`isNumericText`），空 → `num(0)` |

**B. 值/语句读取**

| 方法 | 行号 | 职责与降级策略 |
|---|---|---|
| `value(blockId, inputName)` | L422-L443 | 单输入名取**值**。①`model.input` 取不到 → 若非影子块则发「值输入名对不上」自检警告（L430-L437，列出该块实际有的输入名），返回 `num(0)`（L438）；②`kind:'block'` → `expr(slot.id)`；③`kind:'rawshadow'` → `shadowValue(text)`；④其它 → `num(0)`（L442） |
| `valueAny(blockId, names)` | L407-L412 | 依次试多个输入名，返回**第一个真实存在**的输入值；全不存在 → `num(0)`。注释（L396-L405）解释为何不能写 `A('VALUE') \|\| A('A')`：`value()` 缺输入时返回的 `num(0)` 是对象、永远 truthy |
| `shadowValue(xml)` | L446-L515 | shadow XML → 值节点，按 `shadowType` 分支：`math_number`/`controller_shadow`（L448-L454：先 `NUM`，缺则走 `影子取值`）、`text`（L455）、`logic_empty`（L456）、`default_value`（L457-L464：`TEXT`→`VALUE`→`NUM`，按内容判定数字/文本）、`lists_get`（L465-L470：`VAR` uuid → `listName` → `listRef`）、`get_current_scene`/`get_sensing_current_scene`（L471）、`broadcast_input`（L472）、`get_current_costume`（L487-L497：**先看影子 id 指向的真实块** `fields.style_id`，缺失才用影子自己的 `style_id`，再 `resolve('styles',…)`）、`get_audios`/`get_whole_audios`（L498-L502：`sound_id` → `resolve('audios',…)`）、`shadow_number`（L503-L508）、`shadow_text`（L509）；**未知类型兜底**（L510-L514）：取 `TEXT`，缺则 `NUM`，按内容判定数字/文本，全无 → `num(0)` |
| `expr(blockId)` | L570-L1121 | **表达式块 → 值节点**。结构：①影子类块提前返回（L579-L599，含 `shadow_text` 的 VALUE 影子处理）；②定义 `A(n)=value(blockId,n)`、`A2(names)=valueAny(...)`、`F(n,dflt)=field(...)`（L601-L603）；③巨大 `switch(t)`（L605-L1081）；④过程调用/返回分支（L1084-L1103，用 mutation 里的过程名）；⑤**默认兜底**（L1105-L1120）：`warn('未支持的取值积木 …')` + 递归收集全部 inputs（L1108-L1112）与 fields（L1113-L1119），返回 `{k:'unknown', type, inputs, fields}` |
| `stmt(blockId)` | L1311-L2097 | **语句块 → IR 语句节点**。结构：`A`/`A2`/`S(inputName)=blockBody` 三个局部包装（L1317-L1319）；巨大 `switch(t)`（L1321-L2091）；**默认兜底**（L2093-L2094）：`warn('未支持的语句积木 …（已生成类型层方法调用桩）')` + `stubStmt`。文件末尾还留了一个永不调用的 `function unused(){return S;}`（L2096） |
| `stubStmt(blockId, block)` | L1291-L1308 | 通用兜底语句：把 `inputNames()` 的全部输入逐个 `value()`（异常吞掉记 null，L1296-L1297）与全部 fields（对象取 `.value`，L1304）打包成 `{k:'stub', type, inputs, fields, blockId}`。注释（L1283-L1289）说明设计目标：**不丢输入**，交由下游「类型层方法表」生成角色类方法调用，未实现的方法由 `角色自带积木.gd` 的桩接住 → 转换永远 100% 成功，缺口表现为「待填的桩」而非「丢失的代码」 |
| `inputNames(blockId, block)` | L1261-L1281 | 该块全部**值输入名**：先扫 `connections[blockId]` 里 `type!=='next'` 的 `input_name`（去重、保序），再补 `block.shadows` 的键（L1274-L1279）。供 `stubStmt` / `ask_and_choose`（L1716）/ `text_join`（L924-L929 用 shadows 键）使用 |
| `blockBody(blockId, inputName)` | L2100-L2104 | 语句输入 → IR 数组：`statementEntry` + `chain`，无入口则 `[]` |
| `chain(entryId)` | L2107-L2114 | 语句链 → IR 数组（展开 next） |

**C. 过程（自定义积木）**

| 方法 | 行号 | 职责 |
|---|---|---|
| `procDefId(block)` | L268-L272 | 从 `block.mutation` 里正则取 `def_id` |
| `procRoute(block)` | L280-L295 | 返回 `{kind:'local'\|'remote'\|'missing', owner, name}`：①`procRegistry.byDefId[defId]` 命中 → owner 同名即 local，否则 remote（L284-L288）；②无 def_id/查不到 → 按 `registry.owners[name]` 同名判断（L290-L293）；③都查不到 → `missing`（L294）。注释（L274-L279）注明 K4 里也可能有悬空引用 |
| `procedureName(block)` | L1123-L1139 | 过程名：①`/<mutation[^<>]*?\bname\s*=\s*"([^"]*)"/`（L1129，**不允许 name= 前出现 `<`**，避免匹配到 `<arg name=…>`）；②退化 `^\s*<mutation[^>]*\bname=`（L1132）；③字段 `NAME`（L1134）；④字段 `custom`（L1136）；否则 null |
| `procedureArgs(block)` | L1148-L1165 | mutation 里全部 `<arg name="X">`（L1151-L1153）；无则退化读 `ARG0..` 字段（L1156-L1162） |
| `callArgs(block)` | L1168-L1190 | 实参列表，返回 `{k:'args', args}`：**样式一** `ARG0/ARG1/…`（上限 16，L1172-L1179，`if (!slot) break`）；若结果为空再试 **样式二（K4 真实）** `a,b,c,…z`（L1181-L1189）。两种样式下 `rawshadow` 走 `shadowValue`，其它落空补 `num(0)` |
| `procedureParamNames(block)` | L1199-L1224 | 形参名：①读 `PARAMS0..`（上限 16），指向 `procedures_2_parameter`/`procedures_2_stable_parameter`/`procedures_parameter`/`procedures_stable_parameter` 的取 `param_name` 字段，否则用 `参数N`（L1201-L1215）；②退化读 mutation 里 `<procedures_2_parameter_shadow name="X">`（L1218-L1221）；③再退化 `procedureArgs`（L1223） |
| `registerProcedure(block)` | L1226-L1234 | 登记函数体：名字（缺则 `过程N`）、参数、`blockBody('STACK')`（缺则 `'DO'`），push `{name, kind:'procedure', params, body}` |
| `registerTellProc(body, target)` | L328-L332 | 「发给角色」的匿名过程：`tell_<自增序号>`，push `{name, body, target, kind:'tell'}`，返回名字 |

**D. 结构/事件**

| 方法 | 行号 | 职责 |
|---|---|---|
| `ifBranches(block)` | L1241-L1255 | `controls_if` 展开：从 mutation 的 `elseif`/`else` 属性解析分支数（L1243-L1245，非法 elseif 归 0），生成 `[{cond: value('IF'+i), body: blockBody('DO'+i)}]`（L1247-L1252），`else=1` 时追加 `{cond:null, body: blockBody('ELSE')}`（L1253）。注释（L1236-L1239）：已核对 `kitten.js mutationToDom` 的变异格式与 `IF0/DO0, IF1/DO1, …, ELSE` 命名 |
| `warn(msg)` | L380-L382 | 警告去重入 `this.warnings` |
| `isHat(block)` | L2169-L2172 | 是否在 `HAT_TYPES` 里 |
| `eventOf(block)` | L2174-L2205 | 帽子块 → 事件对象 `{kind,label,type,blockId, …}`：`key` 加 `key`/`keyRaw`/`keyEvent`（L2178-L2185）；`message` 加 `message`（L2186-L2189，先 `textish(value('message'))` 再退化字段）；`loudness` 加 `value`；`condition_hat` 加 `condition` 与 `body`（L2192-L2196）；`backdrop` 加 `scene`（L2197-L2198）；`clicked` 加 `actor`/`tapType`（L2199-L2202）；`block.disabled === true` → `ev.disabled = true`（L2203） |

**E. 模块级常量**

| 常量 | 行号 | 说明 |
|---|---|---|
| `SELF_ALIASES` | L298 | `__self/__mouse/__stage/__edge` → 中文名（**不含 `__random`/`__pointer`**，见 L369-L370、§8） |
| `HAT_TYPES` | L2125-L2147 | 帽子块表：上半是 Kitten4 真实名（`start_on_click`、`start_on_click_2`、`self_listen`、`on_keydown`、`start_as_a_mirror`、`sprite_on_tap`、`backdrop_on_change`、`when`），下半是 Scratch/推断名（`event_whenflagclicked` 等），kind ∈ flag/key/message/clicked/clone_start/backdrop/condition_hat/loudness/timer |
| `KEY_CODE_NAMES` | L2150-L2154 | 数字键码 → `KEY_*`（方向键/空格/回车/shift/ctrl/alt/esc/tab/backspace） |
| `KEY_LETTERS`/`KEY_DIGITS` | L2155-L2156 | 字母/数字键表 |
| `keyCodeToName(code)` | L2157-L2167 | 空 → `KEY_SPACE`；查表；65-90 → `KEY_A..Z`；48-57 → `KEY_0..9`；已是 `key_` 前缀则大写；否则原样返回 |
| `PROC_DEF_TYPES` | L2265-L2268 | 4 种过程定义块类型 |
| `MIME_EXT` | L2825-L2842 | mime → 扩展名（png/jpg/gif/webp/bmp/svg/mp3/ogg/wav/m4a/aac/webm） |
| `UUID_RE` / `isUuid` | L2530-L2532 | 严格 `8-4-4-4-12` 十六进制 UUID |

### 4.3 `value()` / `expr()` / `stmt()` 的分工与回退链（一句话版）

- `value(id, name)`：**要一个值输入** → 不存在就警告 + `num(0)`；存在则分派 `expr` 或 `shadowValue`。
- `valueAny(id, names)`：**名字不确定时的多候选**包装 → 全不中 `num(0)`。
- `expr(id)`：**块 → 值节点**；未支持 → `{k:'unknown'}`（保留 inputs/fields）。
- `stmt(id)`：**块 → 语句节点**；未支持 → `{k:'stub'}`（保留 inputs/fields/blockId）。
- `shadowValue(xml)`：**纯影子 XML → 值节点**；未支持影子类型 → 取 TEXT/NUM 兜底，再不行 `num(0)`。
- `blockBody/chain`：语句槽/next 链 → 语句节点数组。

---

## 5. 数据流与 IR 顶层结构

### 5.1 `parseProject(raw)`（L2346-L2520）

- 校验（L2347-L2348）：非对象 → `throw '不是有效的 JSON 工程'`；缺 `raw.theatre` → `throw '缺少 theatre 字段，可能不是 Kitten4 工程文件(.bcm4)'`。
- 场景/角色（L2350-L2384）：遍历 `th.scenes`，每个场景用 `parseEntity(...,'scene')`；actor 取自 `th.actors`，用 `raw.scene_id` / `raw.scene` 过滤归属（L2365-L2366），再按 `scene.raw.actors` 顺序排序（L2370-L2374）；`sc.actors = actors`（L2375）。`scenesOrder` 空则用 `Object.keys(scenes)`（L2380）；无场景 → throw（L2382-L2384）。
- 变量/列表（L2386-L2417）：**顶层键 `raw.variables`**（退化 `raw.variable`，L2394）；`type === 'list'` 的进 `lists`，否则 `variables`（L2406）；条目 `{id, name, value, type, is_global, owner=current_entity}`（L2398-L2405）；另有 `raw.list` 兼容分支（L2410-L2417）。
- 云变量（L2418-L2425）：`raw.cloud_variables` → `[{id, name, cvid, value}]`。
- 尺寸/名字（L2427-L2428）：`raw.size`（缺省 480×360）、`raw.project_name || 'k4project'`。
- 名称注册表（L2430-L2506，见 §6）。
- **返回对象**（L2508-L2519）：

| 字段 | 行号 | 含义 |
|---|---|---|
| `raw` | L2509 | 原始 JSON 引用 |
| `name` | L2510 | `project_name`（字符串化） |
| `version` | L2511 | `application_version` 或 `version` |
| `work_type` | L2512 | `work_type`，缺省 `'KITTEN'` |
| `size` | L2513 | `{width, height}`，缺省 480×360 |
| `scenesOrder` | L2514 | 场景 id 顺序 |
| `scenes` | L2515 | `{场景id → 场景实体}` |
| `variables` | L2516 | 全局/局部变量数组 |
| `lists` | L2517 | 列表数组 |
| `names` | L2518 | 名称注册表（含 `resolve`/`any`/`resolveAny`/`varScope`/`listScope`） |

### 5.2 实体对象 `parseEntity`（L2300-L2324）

`{kind, id, name, raw, x, y, rotation, scale, visible, draggable, current_style_id, style_names_raw, styles, screen_name, block_data, is_stage, costumes, sounds}`：

- `block_data` = `raw.block_data_json || {blocks:{},connections:{},comments:{}}`（L2317）——**反编译的输入**。
- `costumes`/`sounds` 来自 `collectAssets`（L2321-L2322），键候选：造型 `['styles','costumes','style_list']`、声音 `['audio','sounds','audio_list']`（L2326-L2341，第一个数组命中即用）；每项 `{id,name,url}`，字符串型资源退化为 `{id:a,name:a,url:null}`（L2331）。
- `is_stage` = `kind === 'scene'`（L2318）。

### 5.3 `entityScripts(entity, names, procRegistry)`（L2555-L2604）

1. 建 `BlockModel(entity.block_data)`（L2556）+ `Decompiler`（L2557-L2561），注入 `dec.model`（L2562）。
2. `tops = model.topLevelIds()`（L2564）。
3. **第一遍**：收集过程定义（4 种 def 类型）→ `registerProcedure`，保证调用点在函数定义之前登记（L2566-L2574）。
4. **第二遍**：只取**帽子块**（`dec.isHat`，L2580）→ `eventOf` → body 取法四级回退（L2583-L2594）：
   - ① `model.nextId(id)` 的链（L2583）；
   - ② `blockBody(id,'DO')`（L2586-L2589，注释：很多帽子主体挂在 DO/STACK 而非 next）；
   - ③ `blockBody(id,'STACK')`（L2590-L2593）；
   - ④ `ev.body`（L2594，`condition_hat` 专用）。
   - push `{event, body, hatId}`（L2595）。
5. **名字回填**（L2598-L2601）：对 `scripts[].body` 与 `procs[].body` 递归 `resolveIRNames`，统计 `nameStats`。
6. 返回 `{scripts, warnings, model, decompiler, nameStats}`（L2603）。

### 5.4 `toIR(entity, names, assets, procRegistry)`（L2761-L2797）

- 先跑 `entityScripts`（L2762）与 `entityStyles`（L2763）。
- 当前造型（L2764-L2773）：`current_style_id` → `styleInfo.byId` → `names.resolve('styles',…)` → 最后退化为 `styleInfo.names[0]`。
- **返回单实体 IR**（L2774-L2796）：

| 字段 | 行号 | 含义 |
|---|---|---|
| `kind` | L2775 | `'scene'` \| `'actor'` |
| `id` | L2776 | 实体 id |
| `name` | L2777 | 实体名 |
| `is_stage` | L2778 | 是否舞台 |
| `x`/`y`/`rotation`/`scale`/`visible` | L2779-L2783 | 初始变换与可见性 |
| `current_style_id` | L2784 | 原始 uuid |
| `styles` | L2785 | 原始造型数组 |
| `styleInfo` | L2786 | `{ids, byId, names, files, pivots, paths}`（L2255-L2262） |
| `current_style` | L2787 | 解析后的当前造型**名** |
| `costumes`/`sounds` | L2788-L2789 | `parseEntity` 的 `{id,name,url}` 列表 |
| `scripts` | L2790 | `[{event, body, hatId}]` |
| `procs` | L2791 | `dec.procs`（本角色自定义积木 + tell 过程） |
| `warnings` | L2792 | 该实体的警告 |
| `model` | L2793 | **BlockModel 实例（非纯数据）** |
| `spare` | L2794 | `collectSpareTexts(model)`：悬空 text 块备份 `[{id,text}]` |
| `decompiler` | L2795 | **Decompiler 实例（非纯数据、含循环引用）** |

- **场景**额外挂 `actors` 数组（L2680 `scOut.actors = actorsOut`）。

### 5.5 `projectToIR(rawProject)`（L2631-L2703）——IR 顶层字段

流程：`parseProject` → `extractAssets`（L2640，异常只记 warning，L2662-L2664）→ 合并素材 id→名字（L2648-L2657）→ 收集外链 warning（L2658-L2660）→ `buildProcRegistry`（L2667）→ 逐场景 `toIR`（L2669-L2684，场景自身 + 每个 actor，并汇总 warnings）→ `collectBlockTypes`（L2686）→ `supported` 覆盖率表（L2687-L2692，只有 `BLOCKS.SUPPORTED` 存在才填充）。

**IR 顶层字段（L2694-L2702）**：

| 字段 | 行号 | 含义 |
|---|---|---|
| `project` | L2695 | `parseProject` 的完整 project 对象（含 raw、names、variables、lists…） |
| `scenes` | L2696 | 场景 IR 数组；**每个元素含 `actors` 数组**（L2680） |
| `warnings` | L2697 | 全局警告（`dedupe` 去重，L2799-L2808） |
| `blockTypes` | L2698 | `{积木类型 → 出现次数}`（`collectBlockTypes`，L2607-L2625，遍历场景+角色的 `block_data.blocks`） |
| `supported` | L2699 | `{积木类型 → bool}`（`BLOCKS.SUPPORTED` 命中情况；无 BLOCKS 时为 `{}`） |
| `assets` | L2700 | `extractAssets` 结果，或提取失败时为 `null` |
| `procRegistry` | L2701 | `{byDefId, owners}`（`buildProcRegistry`，L2275-L2298） |

> **注意**：IR 顶层**没有** `actors`、也**没有** `scripts` 字段——`actors` 在 `scenes[i].actors`，`scripts` 在 `scenes[i].scripts` / `scenes[i].actors[j].scripts`。另外 `scenes[i].model` 与 `scenes[i].decompiler` 是 JS 实例（含相互引用），序列化/JSON 输出前需要剔除或专门处理（代码事实，L2793、L2795）。

---

## 6. 命名解析链路（uuid → 中文名）

有**两条**互补的链路：反编译时就地解析（Decompiler 内），以及事后对 IR 全树回填（resolveIRNames）。

### 6.1 `names` 注册表的建立（`parseProject`，L2430-L2506）

| 步骤 | 行号 | 内容 |
|---|---|---|
| 初始化 | L2433 | `{vars:{}, lists:{}, actors:{}, audios:{}, styles:{}, scenes:{}, clouds:{}}` |
| 变量/列表 | L2434-L2435 | `names.vars[id]=name`、`names.lists[id]=name` |
| 云变量 | L2438 | `names.clouds[id]=name`（仅当 `c.id` 存在） |
| 角色 | L2439-L2444 | 遍历 `th.actors`：`names.actors[k]=a.name‖k` |
| 场景 | L2445-L2450 | 遍历 `th.scenes`：`names.scenes[k]=s.name‖k` |
| 声音（项目级） | L2452-L2457 | 遍历 `raw.audio`：`names.audios[k]=v.name‖v.audio_name‖k` |
| 造型/声音（实体级） | L2458-L2478 | 遍历所有场景+角色的 `styles/costumes/style_list` 与 `audio/sounds/audio_list`；字符串型资源自映射（`names.styles[s]=s`，L2465），对象取 `id‖style_id` / `audio_id` |
| `resolve(kind,id)` | L2480-L2485 | 空 id → `''`；命中即返回；**未登记则原样返回 id 字符串**（避免 undefined） |
| `names.any` 合并索引 | L2490-L2496 | 把 7 类表合并成一个 `uuid → 名字` 表，**先到先得（不覆盖已存在）**；注释（L2487-L2489）说明各类 id 不冲突、合并安全，用途是统一回填散落的裸 uuid |
| `resolveAny(id)` | L2497-L2501 | 合并表查询；未命中返回原 id |
| `varScope`/`listScope` | L2503-L2506 | 名字 → `'global'`\|`'local'`（供生成器决定局部成员还是全局 autoload） |

### 6.2 反编译时的就地解析（Decompiler 内）

| 场景 | 行号 | 调用 |
|---|---|---|
| 实体/角色名 | L304-L311 | `entityName` → `SELF_ALIASES` 或 `names.resolve('actors', id)` |
| 变量名 | L314-L319 | `varName` → `resolve('vars', id)` |
| 列表名 | L321-L326 | `listName` → `resolve('lists', id)` |
| 云变量名 | L415-L419 | `cloudName` → `resolve('clouds', id)` |
| 造型（影子） | L495-L496 | `resolve('styles', 造id)` |
| 造型（`set_costume`） | L1407 | `resolve('styles', sid)` |
| 造型（取值块） | L719-L721 | `resolve('styles', fields.style_id)` |
| 声音（影子） | L500-L501 | `resolve('audios', sound_id)` |
| 声音（取值块） | L715-L717 | `resolve('audios', fields.sound_id)` |
| 列表引用（影子） | L465-L470 | `listName(fieldOf(xml,'VAR'))` → `listRef` |
| 目标字段实体名 | L372-L378、L1428、L1432、L1743 | `目标字段`/`entityName` |

### 6.3 `assets.byIdName` 反向补名（`projectToIR`，L2637-L2657）

- `extractAssets` 在抽素材时会产出 `byIdName = {styles:{id→name}, audios:{id→name}}`（L2912、L2957）。
- `projectToIR` 把它合并进 `project.names`，并且**连「值等于 id 自己」的自映射一起覆盖**（L2648-L2657）。
- 注释（L2643-L2647）说明原因：`parseProject` 会先把 `names.styles[id]` 预填成 uuid 自身，于是 `if (!names.styles[id])` 永远为假、真名字进不来，`resolve('styles', uuid)` 返回 uuid；症状是生成 `await 角色.设置造型("491d26ab-…")`，运行时查不到造型。

### 6.4 IR 全树回填 `resolveIRNames`（L2530-L2552）

- `UUID_RE`（L2530）：严格 `8-4-4-4-12` 十六进制。
- `isUuid(v)`（L2532）：字符串 + 正则。
- `resolveIRNames(node, names, stats)`（L2534-L2552）：数组递归（L2535-L2538）；对象的每个键，若值是 UUID 字符串 → `names.resolveAny(v)`，**变了才写回**并 `stats.resolved++`，没变则记 `stats.unresolved[v]++`（L2544-L2547）；对象/数组继续递归（L2548-L2550）。
- 调用点：`entityScripts` L2600-L2601，只作用于 `scripts[s].body` 与 `procs[pi].body`；**`event` 对象本身不在回填范围内**（代码事实：L2600 传的是 `scripts[s].body`），因此事件对象里的字段依赖 `eventOf` 里的即时解析（L2188、L2198、L2200）。
- 统计结果挂在返回值的 `nameStats`（L2599、L2603）。
- 由于正则严格，形如 `n749e60b5_…` 的云变量 id（注释中出现的形态，L1749、L2437）**不满足该正则**，不会走这条回填，只能靠 `cloudName` 在反编译阶段解析——该 id 形态是否真实存在于工程中**未确认**（仅见于注释举例）。

---

## 7. 素材抽取 `extractAssets`（L2905-L3022）

### 7.1 入参 / 出参

- **入参**：`rawProject`（原始 .bcm4 JSON；非对象时直接返回带 `['输入不是有效工程']` 警告的空结果，L2916-L2918）。
- **数据源**：`rawProject.theatre.styles`（L2978）与 `rawProject.audio`（L2979）。
- **出参**（L3015-L3021）：

| 字段 | 行号 | 含义 |
|---|---|---|
| `styles` | L3016 | 造型项数组 |
| `audios` | L3017 | 声音项数组 |
| `warnings` | L3018 | 去重后的警告文本 |
| `stats` | L3019 | `{total, inline, external, empty, failed, bytes}`（初始 L2910） |
| `byIdName` | L3020 | `{styles:{id→name}, audios:{id→name}}`，供名称注册表（L2911-L2912） |

**每个素材项**（L2958-L2974）：`{id, name, owner, file, dir, path, mime, ext, bytes(Uint8Array), size, cdn, pivot, adaptive, volume, playback_rate}`；`pivot` 取 `entry.pivot || entry.rotate_center`（L2970），`volume`/`playback_rate` 缺省 1（L2972-L2973）。

### 7.2 单条抽取逻辑 `take(kind,id,entry,dir)`（L2921-L2976）

1. `stats.total++`（L2922）。
2. `url === ''` → `stats.empty++` + 警告，返回 null（L2925-L2929）。
3. `url` 不以 `data:` 开头 → `stats.external++` + 「是外链…需要联网下载，本次未导出」警告（只截前 80 字符），返回 null（L2930-L2935）。
4. `stats.inline++` → `parseDataUri(url)`；失败 → `stats.failed++` + 警告（L2936-L2942）。
5. **按角色分目录**（L2943-L2946）：`kindKey = dir === 'assets/sounds' ? 'audios' : 'styles'`；`owner = ownerOf[kindKey][id] || 'common'`；子目录 = `dir + '/' + owner`。注释（L2943、L2981-L2983）：不同角色可能有同名造型，放同一目录会互相覆盖（举例「蓝雀」「蓝雀1」在两个角色里都叫这个名字）。
6. **重名去重**（L2947-L2955）：基名 `safeFileName(name, kind+'_'+id前8位)`，扩展名来自 data URI；`used[子目录/文件名.toLowerCase()]` 已被占用且占用者不是同一 id 时，依次尝试 `base_2.ext`、`base_3.ext`…（L2950-L2954）；随后登记 `used[...] = id`。
7. 累计 `stats.bytes`（L2956）、登记 `byIdName[kindKey][id]`（L2957）。

### 7.3 角色归属计算（L2984-L3004）

- 收集所有 `theatre.scenes` 与 `theatre.actors` 实体（L2984-L2990）。
- 每个实体的 `owner` 名 = `safeFileName(ent.name || ent.id || 'unknown', 'unknown')`（L2992）。
- 造型 id 来源：`ent.styles`（字符串或对象取 `id||style_id`，L2993-L2996）；声音 id 来源：`ent.audio`/`ent.sounds`/`ent.audio_list`（L2997-L3003）。
- **首个登记者胜出**（`if (id && !ownerOf.styles[id])`，L2995 / L3001）；没有归属的素材落到 `common`（L2945）。

### 7.4 相关工具

| 函数 | 行号 | 说明 |
|---|---|---|
| `MIME_EXT` | L2825-L2842 | mime → 扩展名映射；未知 mime 取子类型并清洗（L2866） |
| `safeFileName(name, fallback)` | L2845-L2851 | 去 `\ / : * ? " < > \|` 与控制字符换 `_`；空白换 `_`；空/`.`/`..` → fallback（缺省 `'asset'`）；**保留中文**（L2844 注释） |
| `parseDataUri(uri)` | L2854-L2870 | 正则 `^data:([^;,]+)?(;charset=…)?(;base64)?,(.*)$`（`s` 标志）；base64 → `base64ToBytes`，否则 `decodeURIComponent` + `textToBytes`；返回 `{mime, ext, bytes, ok}`（`ok = bytes && length>0`） |
| `base64ToBytes(b64)` | L2874-L2892 | 纯 JS 解码，不依赖 `Buffer`/`atob`（L2872 注释）；剔除非 base64 字符、去 `=`、按位拼装 |
| `textToBytes(s)` | L2894-L2898 | 逐字符 `charCodeAt & 0xff` |

素材格式的注释依据（L2813-L2822）：经核对 7 个官方样例，**所有造型/声音都是内嵌 base64 data URI，外链数 0**（113 个造型 + 23 个声音），可 100% 离线提取；`raw.theatre.styles[uuid] = {id,name,url,cdn_url,pivot,rotate_center,adaptive}`、`raw.audio[uuid] = {id,name,url,cdn_url,volume,playback_rate,effects}`。

---

## 8. 「注释即文档」：代码里散落的关键实测结论清单

> 以下每条都是从注释里提取的**实测/核对结论**，格式为「结论（行号）」。这是本文件最有价值的部分。

### 8.1 序列化格式与数据来源（文件头，L7-L17）

1. workspace 序列化格式为 `Blockly.json.workspace_to_json` → `{blocks, connections, comments}`，每个 block 含 `type,id,is_shadow,collapsed,disabled,deletable,movable,editable,visible,location,shadows,fields,field_constraints,field_extra_attr,comment,mutation,parent_id,is_output`（L8-L11）。
2. `connections[源块id][目标块id] = {type:"next"}` 表示语句/socket 连接（L12）。
3. `connections[父块id][子块id] = {type:"input", input_name:"IF0"}` 表示值输入连接（L13）。
4. `shadows[输入名]` 是 XML 字符串，如 `<shadow type="math_number" …><field name="NUM">3</field></shadow>`（L14）。
5. `controls_if` 变异形如 `<mutation elseif="n" else="1"></mutation>`，输入名为 `IF0/DO0/IF1/DO1/…/ELSE`（L15）。
6. 上述结论来自对 K4 Ultra 打包产物 `resources/app/build/kitten.822d814413fb10654fde.js` 的核对（L7）。

### 8.2 影子块 / 值输入（最容易丢数据的地方）

7. **影子元素的 id 指向同一造型选择器对应的真实块**（L57）。
8. K4 在**值输入**上也会写 `parent_id`，因此只有本块「没有任何 input 类连接」时才允许用 `parent_id` 回退，否则语句输入的孩子会被误判成值输入、污染表达式解析（L144-L147）。
9. **影子块的「当前值」K4 另存一份在 `blocks[影子id]` 里**，`shadows` XML 只是创建时的默认值，用户改过后不再更新（L170-L171）。
10. 实例（pec2txt）：`text_split` 的 `TEXT_TO_SPLIT` 影子 XML 里还是默认的 `"1,2,3,4"`，而 `blocks[id].fields.TEXT` 才是真正输入的 100+ 字文本；以前只读 XML → 真实内容整个丢掉（L172-L175）。
11. 影子的两种形态都存在（有的影子 `fields` 为空、内容只在 XML 里），所以按「有没有值」选（L176）。
12. `math_number`/`controller_shadow` 影子 `NUM` 缺时用 `TEXT`，而 **`TEXT` 字段就是文本**，不能按「内容像不像数字」猜——`"000000…0"` 是文本，`parseFloat` 会变成 0（L449-L452）。
13. `lists_get` 影子里的 `VAR` 是列表 uuid，必须换成列表名，否则运行时报 `list_len: Nonexistent function 'size' in base 'String'`（L466-L468）。
14. **同一个造型选择器 K4 存了两份，影子那份可能是过期的**；两者的区别是**影子元素带 id，那个 id 就是真实块的 id**；规则：影子有 id 且该 id 的真实块存在 → 以真实块的 `fields` 为准，否则才用影子自己的字段（L477-L486）。
15. 实例（高考呐(1) 加油，块 `dIp6rjPo3…`）：`set_costume` 的 `shadows.index` 影子写的是旧造型「新角色」，而真实块 `fW1gf7Vgrd…`（`parent_id == dIp6rjPo3…`）的 `fields.style_id` 才是当前造型「新角色(1)」；以前一律读影子字段 → 「切换到造型」永远切到过期造型（L478-L486）。
16. K4 里 `get_audios`/`get_whole_audios` 存的是声音 uuid，必须换回名字才能去 `assets/sounds` 找文件（L499）。
17. **「数字或文本」的影子要按字段名判断，不要按内容猜**：`math_number` 带 `allow_text="true"`，数字在 `NUM`、文本在 `TEXT`（L517-L528）。
18. 证据：`如果 <当前的地图 = "主界面">` 的右操作数影子是 `<shadow type="math_number"><field name="TEXT">主界面</field></shadow>`，而 `如果 <存档 = 0>` 左边那个 0 在 `NUM`（L523-L525）。
19. 曾经按内容判断（`isNumericText`），导致 `"000000…0"` 这种**文本**被 `parseFloat` 成 0，而用户明确说了它是字符串（L527-L528）。
20. `math_number` 块同时装数字与文本；以前无条件 `num(F('NUM',0))`，文本值的块 `NUM` 不存在 → `num(0)`；典型症状 `如果 <当前的地图 = "主界面">` → `等于(..., 0.0)`（L606-L612）。
21. 任何一处无条件 `num()` 都会让文本静默变成 0（`parseFloat("主界面")=NaN→0`）——代码照样编译、照样跑，只是永远比较不相等，这是最难发现的一类丢失（L556-L559）。
22. 空输入在 K4 里就是 0，不能变成 `""`（否则 `移动_步("")` 之类的会变味）（L535、L564）。
23. `shadow_text` 的文本内容在 **VALUE 影子**里而不在本块 `fields` 上，形如 `{"type":"shadow_text","fields":{},"shadows":{"VALUE":"<shadow type=\"text\">…"}}`；用户报的「设置 存档 的值为 "0000…0"」变成 `""` 就是这里（L583-L587）。
24. `shadow_text` 的提前返回**先于 switch** 执行，所以只改 switch 里的 `case 'shadow_text'` 是没用的（那个分支永远到不了）（L588-L589）。
25. 空白作品里 **394 个 `shadow_text`** 因为读不到字段而全部丢失（L733）。
26. `value()` 在输入不存在时返回 `num(0)`——那是个**对象**、永远 truthy，所以 `A('VALUE') || A('A')` 这种写法从来没生效过，后面的名字全是死代码，一旦第一个名字不对就静默退化成 0（L396-L405）。
27. 自检警告的典型症状：生成结果变成 `0.0`/`""`；实例——`self_go_forward` 被当成「移到图层」、`text_contain` 的输入其实叫 `TEXT1/TEXT2`、`text_split` 是 `TEXT_TO_SPLIT/SPLIT_TEXT`（L424-L429）。
28. **K4 与 Kitten4 存在两套输入名**，必须按实际存在的取：`original_value / VALUE`、`TEXT1+TEXT2 / VALUE+FIND`、`NUMBER_TO_CHECK / NUMBER`、`VAR / TARGET` 等（L403-L405）。

### 8.3 命名 / 实体 / 过程

29. K4 字段里存的是 **UUID**，生成可读 GDScript 必须换回名字（L252、L2431-L2432）。
30. Kitten4 的自定义积木是**跨角色全局**的：调用块 mutation 里的 `def_id` 就是定义块的块 id，而定义块可能挂在别的角色上（L254-L258、L2270-L2273）。
31. `def_id` 结论已用 **19MB 官方示例**核对过（L2273）。
32. `procRoute` 的三种结果：本角色定义（直接调用）、别的角色定义（运行时转发）、找不到定义（K4 里也可能有悬空引用）（L274-L279）。
33. K4 的特殊实体指代：`__self`/`__mouse`/`__stage`/`__edge`（L297-L298）。
34. `__random`/`__pointer` **不在** `SELF_ALIASES` 里，必须单独翻译，否则解析成空串 → 生成 `移到_目标(0.0)`，角色每帧被拖到舞台原点（L369-L370）。
35. 「移到 <目标>」「面向 <目标>」的目标放在**字段**里（不是输入框），取值是实体 uuid / `__self` / `__mouse` / `__stage` / `__edge` / `__random` / `__pointer`；实测 `self_move_specify → fields.target`、`self_face_to → fields.sprite`（L361-L368）。
36. `procedureName` 不能直接匹配第一个 `name="..."`，因为 `<mutation><arg name="参数"></arg></mutation>` 里的 name 属于参数；只允许 `<mutation …>` 标签自身带 name（即 name= 之前不能出现 `<`）（L1125-L1127）。
37. K4 的 `procedures_defnoreturn` 变异形如 `<mutation><arg name="参数1"></arg></mutation>`，语句体输入名固定 `STACK`，调用块参数输入名固定 `ARG0/ARG1…`（L1141-L1146）。
38. Kitten4 的 def 块把参数放在 `PARAMS0..` 输入里，连的是 `procedures_2_parameter` / `procedures_2_stable_parameter` 块，参数名在该块的 `param_name` 字段；mutation 里也会写一份 `<procedures_2_parameter_shadow name="X">`（L1192-L1197）。
39. 调用块实参两种命名：`ARG0..` 与 **K4 真实的 `a, b, c, … z`**（L1167、L1180）。
40. 变量/列表的**顶层键是 `variables`（不是 `variable`）**，且没有独立 `list` 顶层键——列表是 `variables` 里 `type==="list"` 的条目；局部变量靠 `is_global===false` + `current_entity` 标记归属（L2386-L2389）。
41. 旧版本读 `raw.variable`/`raw.list` 两个键都不存在，导致**变量名从未解析成功、生成代码里全是 uuid**（L2390-L2391）。
42. 云变量也是 `uuid → {name,…}`，必须一并登记，免得积木里出现裸 uuid（`云变量设置("n749e60b5_…")`）（L2418、L2436-L2437）。
43. 造型/声音名字来源：项目级 `audio` 表 + 各实体的 `styles`/`audio` 列表（L2451）。
44. `parseProject` 会先把 `names.styles[id]` 预填成 **uuid 自身**（自映射），于是 `if (!names.styles[id])` 永远为假、真名字永远进不来，`resolve('styles', uuid)` 返回 uuid；症状：生成 `await 角色.设置造型("491d26ab-…")`，运行时查不到造型（L2643-L2647）。
45. 素材提取时把 id→名字 合并进名称注册表，是为了让「K4 积木与当前造型字段里存的 uuid」换回可读名字（L2641-L2642）。
46. IR 名字回填的动机：反编译过程中很多积木字段拿到的是裸 uuid，与其在几十个构造点分别处理，不如做一次全树回填（L2522-L2528）。
47. 合并索引的假设是「各类 id 不会互相冲突，合并安全」（L2487-L2488）。
48. 变量/列表归属索引是按**名字**查的，供生成器决定「局部成员」还是「全局 autoload」（L2502）。

### 8.4 事件 / 帽子块

49. `HAT_TYPES` 上半部分是 **Kitten4 真实使用的名字**（已用 7 个官方样例工程统计确认），下半部分是 Scratch/推断名，保留兼容（L2120-L2123）。
50. K4 里「按键」字段是**数字键码**（L2149）。
51. K4 的按键帽子有「按下 / 松开」下拉框（`fields.key_event_type = down | up`），**实测 18 个样本里 down/up 都出现过**；以前没读这个字段 →「当松开 X 键」也被当成"按下"触发（帽子_按键._input 不区分事件类型）（L2182-L2184）。
52. 很多帽子（当收到消息 / 当满足条件 / 当作为克隆体启动 …）的主体挂在**语句输入 DO/STACK** 上，而不是 next 链上；只读 next 会得到空主体（L2584-L2585）。
53. 第一遍收集自定义积木定义，是为了保证调用点在函数定义之前就被登记（L2566）。

### 8.5 语句积木的具体坑（按文件出现顺序）

54. K4 的广播块自带 `DO` 语句输入（广播 + 紧随其后的一段脚本）（L1347）。
55. K4 的「切换到造型 X」把选中的造型放在 `index` 输入里，而且是 `type=get_current_costume` 的影子（`style_id` 字段是造型 uuid）（L1374-L1377）。
56. 实例（高考呐 加油）：`set_costume` 的 `shadows.index` = `<shadow type="get_current_costume"><field name="style_id">491d26ab-…</field></shadow>`，而 `shadowValue()` 把这种影子一律当成"读取当前造型" → 生成 `await 角色.设置造型(await 角色.当前造型())` 自赋值，等于什么都没切换（用户实测原话："custom 读的是自己的当前造型"）（L1376-L1381）。
57. `set_costume` 的真源顺序：真实块 `fields.style_id` → 影子 field → inputs 表达式（L1384-L1387）。
58. 没有造型引用说明挂的是**内嵌表达式**（比如 `变量 i + 0`）（L1399）。
59. **K4 的 `self_move_to` 是「移到 x: y:」两个数字输入**，不是 Scratch 的「移到 <角色/鼠标>」（那个是 `self_move_specify`）；以前按 `motion_goto` 处理成 `goto_target` 并去读 `TARGET`，输入名不存在 → 空白作品里 **124 处**全变成 `移到_目标(0.0)`，坐标整个丢掉（L1417-L1421）。
60. `self_move_specify` 的目标在选择器字段 `target`（`__random`/`__pointer`/实体 uuid…）；以前走 `textish`，两个特殊值不在 `SELF_ALIASES` → 空 → `移到_目标(0.0)`，敌人每帧被硬拖到舞台原点（实测 射击生存）（L1424-L1427）。
61. `self_face_to` 的字段名是 `sprite`（不是 `target`）；以前整块没映射 → 掉进 default 变成空参桩 `面向_角色([])`（L1430-L1431）。
62. `set_volume_or_rate` 的下拉字段 `audio_key = volume | rate`（**实测 `set_volume_or_rate_2` 里是 `"rate"`**）；选 rate 是"播放速率"（→ `AudioStreamPlayer.pitch_scale`）；volume 时仍产出老的 `set_volume`（IR_METHODS 里的 设置音量），只有 rate 走新方法，这样不破坏既有映射（L1492-L1496）。
63. Kitten4 的 `lists_replace`：`VAR`(列表影子) + `INDEX`(序号) + `VALUE`(新值)，另有 `ITEM`/`IS` 两个恒为空串的影子（有人用有人不用）；以前只读 `ITEM`，读不到（L1556-L1557）。
64. `lists_replace` 的 **`TYPE` 一定要带上**（和 `lists_get_value`/`lists_delete` 同一个下拉，值 `first`/`last`，即"从头数第 n 项"还是"从倒数第 n 项"）；以前没读 `TYPE`，`TYPE=last` 的 **5 处**被当成 first（L1559-L1561）。
65. K4 的「复制 <值> 到 <列表>」看起来是**一个**块，其实是**两层嵌套**：外层 `lists_copy`、内层 `text_split`（`[文本] 按 [分隔符] 分开成列表`）；`<值>` 槽里插的常常是 `text_split`，它必须是**任意表达式**，不能当列表名解析（L1570-L1575）。
66. 以前写 `this.textish(this.valueAny(blockId,['VALUE','VAR']))`——`textish` 只认字面量，表达式一律返回 null，于是源/目标双双变空串，生成 `复制列表(角色.局部列表, 角色.局部列表)`（用户看到的"局部列表"），同时插在 `VALUE` 里的 `text_split` 连同那段长文本**一起被丢掉**（L1577-L1580）。
67. Kitten4 的 `stamp` 是**文字图章**（`text` + `size` + `align` 字段），不是画笔的「图章」；以前和 `pen_stamp` 一起映射成 `{k:'pen_stamp'}`，文本和字号全被丢掉（空白作品 **61 处**、Phigros 多处）（L1595-L1597）。
68. `stamp` 的 `align` 实测 `fields.align = "left" | "center" | "right"`（18 个样本里 left/center 都有）；以前没读，所有文字图章都按居中画（L1598-L1599）。
69. `image_stamp` = 把**当前角色的造型**原样印到画笔层上（K4 里叫角色印章），和画笔分类的「图章」(`pen_stamp`) 是同一件事，只是 K4 给了两个入口块（L1610-L1611）。
70. 印章语义要点（用户明确过）：印章**不跟着角色动**、只继承角色的长宽（大小），**不继承角色身上的效果/透明度**，用**原纹理的颜色**；由 `自带积木.图章()` → `屏幕绘制._画图章()` 保证（画布节点自己没有角色的 modulate，`draw_texture` 用默认白色调制）（L1612-L1615）。
71. `set_fill_style` 的字段名是 `color`（和画笔的 `set_pen_color` 一样）（L1618）。
72. `set_pen_path`：K4 源码里 `point === "start_point"` → `begin_path`，其它 → `close_path`；这**不是"画笔路径"，而是填充多边形的起止**（起点 = 开始记录路径点；终点 = 闭合 + 用填充色填上）；以前整块没映射，"设置填充"这条路完全走不通（L1621-L1625）。
73. Kitten4 的 `self_change_pen_size` 输入名是 `steps`（Scratch 是 `size`/`value`）（L1635）。
74. K4 一共 **5 个**画笔颜色块与对应关系：`self_set_pen_color`→`pen_color`、`self_change_pen_color`→`pen_change_color`、`self_change_pen_shade`→`pen_change_shade`、`self_set_pen_color_property`→`pen_color_property`、`self_change_pen_color_property`→`pen_change_property`（L1640-L1645）。
75. 以前 `self_change_pen_color` / `self_change_pen_shade` / `self_set_pen_color_property` **三个根本没映射**（掉成"参数没解析出来"的桩），而 `self_change_pen_color_property` 又被错映射成 `pen_change_color`——和"增加画笔颜色"抢了同一个签名，结果 scope 被截掉、只剩下增量（L1646-L1650）。
76. 加减号在 `increase` 字段里：**实测**（`_dev/probe_pen_fields.js` 扫全量）`scope=hue, increase=increase`；和「把 <特效> 增加 <值>」是同一个套路——值一律正数，符号单独给（L1663-L1665）。
77. `set_layer_with_pen` 的字段 `position = "above" / "below"`（实测 `_dev/probe_block_raw.js`）（L1691-L1692）。
78. K4 的 `set_timer_state` 的 `actions` 只有三种取值 `start / stop / reset`（已在 4 个样例核对过）（L1701-L1702）。
79. `ask_and_choose` 的选项个数是**动态**的：K4 按用户实际填了几个选项生成 `CHOICE0..CHOICEn`（实测 Phigros模拟器v2.5：一个块同时有 CHOICE0/1/2/3，共 4 个选项）（L1710-L1712）。
80. 以前**写死只取 CHOICE0 和 CHOICE1** → 第 3、4 个选项被静默丢掉，玩家永远选不到（界面上只剩前两项，选对了也判错）；改成按 `inputNames` 里实际存在的 `CHOICEn` 收集并按**序号排序**（依赖对象键序会错位：`CHOICE10` 会排到 `CHOICE2` 前面）（L1713-L1715）。
81. K4 的「克隆」块带 `sprite` 字段，可指定克隆谁：`"__self"` → 克隆自己，实体 uuid → 克隆那个角色（Scratch 的 `create clone of <sprite>`）（L1734-L1736）。
82. 实例（射击生存）：以前一律返回 `clone_self`，于是"克隆 炮弹"被生成成 `角色.克隆自己()`，克隆出来的是**射击辅助器**，而它没有「当作为克隆体启动时」脚本 → 点了鼠标什么也射不出去；实测该工程 3 个 `mirror`：1 个 `__self`、2 个 uuid（L1737-L1740）。
83. `cloud_variables_set` 的名字字段里存的是 **uuid**，要换回中文名（以前直接 `String()`，生成 `云变量设置("n749e60b5_…")`）（L1748-L1749）。
84. Kitten4 的云变量赋值输入名是 `VALUE`（小写 `value`/`n` 是 Scratch 写法）；以前写 `A('value') || A('n') || A('VALUE')`，第一个就命中不了，而 `A()` 返回的 `num(0)` 是对象、永远 truthy，后面的名字全成了死代码（L1752-L1754）。
85. MIDI 演奏：Godot 端**无内置 MIDI 合成器**，`midi_play_num_note` 直接走 `stubStmt`（L1767-L1769）。
86. 物理引擎积木：Godot 端**未内置 Box2D**，一长串 `physics2_*`/`self_*_physics` 等类型全部走 `stubStmt`（L1771-L1793）。
87. 「把 <特效> 增加 <值>」= K4 的 `self_change_effect_3`：**K4 把减号放在 `increase` 字段里**（`increase`/`decrease`），值一律是正数；以前没映射这一块 → 掉进 default 变成"参数没解析出来"的桩 → "把亮度增加 10"这类积木在生成工程里静默无效（L1803-L1806）。
88. 实测（`_dev/probe_effect.js`）：游戏-空白作品里 `self_change_effect_3` 有 **70+ 处**（L1807）。
89. 值放在 **`shadows.steps`** 里（实测 `self_change_effect_3` 的 shadows 键就叫 `"steps"`，不是 `val`/`value`）；以前只找 `val`/`value` → 永远读不到，增量恒为 0（L1816-L1818）。
90. K4 的「停止」用 `fields.scope`，取值是**数字 1/2/3**（实测 18 个样本，`_k4tmp_probe/probe_raw.js`）；以前读的是 `STOP_OPTION`（K4 里根本没有这个字段）→ 永远落到默认 `'all'`，于是「停止 [这个脚本]」和「停止 [这个角色]」全都变成"停止全部"；运行时（自带积木.停止）认 `all / this / others`（L1847-L1851）。
91. 取值按 K4/Scratch 的下拉顺序：**1 = 全部，2 = 这个脚本，3 = 其它脚本（该角色的其它脚本）**（L1854）。
92. `tell`/`sync_tell` 的目标角色名 Kitten4 放在**字段 `sprite`** 里（实体 uuid，要换回名字），不是输入 `TARGET`；以前读 `TARGET` 读不到，`textish` 拿到 `num(0)` 后变成字符串 `"0"`，于是注册出一个「发给名叫 0 的角色」的假过程（L1873-L1876），并有 `tgt === '0' → ''` 的兜底（L1881）。
93. K4 的「滑行坐标」`self_glide_coordinate` 结构和 `self_change_coordinate`（「把 x 坐标增加 N」）**完全同族**：`fields = {coordinary, increase}`、`inputs = {time, value}`，只多一个 time，且要求"边移动边等"（阻塞式滑行）（L1911-L1915）。
94. 它是**语句块**，必须挂在 `stmt()` 上——挂到 `value()` 永远走不到，只会继续落进「未支持的语句积木」+ 类型层桩（实参打包成数组，运行时什么也不做）（L1916-L1918）。
95. 实参顺序对应 methodtable 的 `OP_METHODS.self_glide_coordinate`（轴 / 方向 / 时间 / 值），实现见 `自带积木.滑行坐标()`：Tween + await（L1919-L1920）。
96. **实测修正**（`_dev/probe_block_raw.js` 游戏-空白作品.bcm4）：K4 的 `self_set_position` 是**单轴**「把 x / y 坐标设为 值」，`fields = {coordinary:"x"}`、`shadows = {value:100}`；以前当双轴「移到 x y」处理 → `A('x')`/`A('y')` 一个都取不到 → 生成 `移到x_y(0, 0)`，**7 处**坐标设置全变成"瞬移回原点"；双轴的是 `self_move_to`（L1929-L1936）。
97. **实测修正**（同探针）：①`set_scale` 块类型是 `set_scale`（不是 `self_set_scale`）②值在 `shadows.scale`（不是 `VALUE`）；以前两条都写错 → 这些语句保留原始 type → emit 按 type 落到 `TYPE_METHODS` 的桩「设置大小_外观」→ 只打印一句 `_桩提醒` 就不管了；症状：空白作品里 **102 处**「设置大小为 X%」全部静默失效（L1963-L1968）。
98. K4 的「移动 N 步 / 后退 N 步」**不是**"移到图层"，以前错映射成 `layer`，生成的 `角色.移到图层(1.0)` 把步数整个丢掉（L1994-L1996）。
99. 证据（新的作品的舞台）：原始积木只有 4 个——`start_on_click → repeat_forever → self_go_forward(steps = -2)` + `math_number(-2)`，而 K4 编辑器里这个角色的脚本正是「当开始被点击 / 重复执行 / 移动 -2 步」；另外 `self_go_forward` 的输入名叫 `steps`（普通数值输入），而真正的图层块 `self_change_layer`/`set_layer` 用的是 `layer`/`n` 字段（L1997-L2002）。
100. 后退 = 朝反方向移动：步数取负（`move_steps` 内部按 cos/sin 前进）（L2006）。
101. `logic_boolean` 的字段是 `BOOL`（`'true'`/`'false'` 字符串）（L914）。
102. K4 里取负也叫 `math_single`，`OP` 为 `NEG`（L868）。
103. `math_round` 带上 op 名，由 `K4Lib.取整模式` 做等效实现（rounddown/roundup/roundeven）（L875）。
104. Kitten4 的开方积木默认 2 次根，也可以指定次数（L880）。
105. `text_join` 的输入是 `ADD0/ADD1/ADD2…`，**个数看实际有哪些，别信 `STEPS` 字段**（那些块 fields 是空的，数量信息在 mutation 里）；Scratch 老版则是 `STEPS` 字段 + `ADD0…`（L920-L922）。
106. `text_split`：Kitten4 只有**两个**输入 `TEXT_TO_SPLIT`(要分割的文本) / `SPLIT_TEXT`(分隔符)；以前按 Scratch 的 `(VALUE, TEXT_TO_SPLIT, SPLIT_TEXT)` 三个名字取，于是第 1 个位置恒为 0、剩下两个还整体错位一格 → 生成 `文本分割(0.0, <文本>)`，分隔符反而被当成文本（L853-L857）。
107. `text_select_changeable`（「文本 [STRING] 的第 [NUM0] 到 [NUM1] 个字符」）的突变 `items="2"` 就是那两个可变数字槽；以前直接降级成 `to_string(STRING)` → 前后两个数字整个丢掉，**7 处**「截取」全变成"原样返回整段文本"（L781-L784）。
108. 它的参数照 `str_substring` 的 5 元组给（第 3/5 个是 `FROM_START`/`FROM_END` 标志，这个块没有那个下拉，恒为 `FROM_START`）（L785-L786）。
109. `get_mouse_info` 的字段名是 **`position`**，不是 `scope`（实测 `_dev/probe_block_raw.js`）；以前写成 `F('scope','x')` → 永远读不到 → 默认值恒为 `'x'`，于是"鼠标 y"被生成成"鼠标 x"（`移到x_y(鼠标x - 20, 鼠标x)`），角色只能沿 `y = x` 这条对角线动——用户实测原话："准星只在 y=x 方向上移动"（L792-L798）。
110. `get_current_clone_index` 以前写死 `num(1)`，所有克隆体都自称 1 号；`get_clone_num` 是克隆体数量（L802-L807）。
111. `get_stage_info`（「舞台的 <宽/高>」）用 `fields.info`，取值 `width`/`height`（实测 `fields.info = "height" | "width"`）；以前整块返回 `num(0)`，任何用"舞台宽度/高度"算坐标的积木都拿到 0；运行时 `自带积木.舞台信息("width"/"height")` 已实现（读视口尺寸）（L814-L820）。
112. K4 的「计算」积木（算式求值）：`fields` 空、`shadows.input` 是**一个文本框**；实测（Phigros模拟器v2.5(编程猫版)，**16 处**）input 取值为 `"1+2"`/`"sin1"`/`"9/11"`/`"15/16"`/`"3/4"`/`"6/11"`/`"7/11"`——是**算式求值**而不是原样显示文本，否则没人会写 `"1+2"` 给玩家看（L822-L828）。
113. 以前这个类型在 `value()` 里没有分支 → 落进「未支持的取值积木」→ 按空值生成 `0.0`：分数 / 进度比 / 判定比例**全部算成 0**，而且一个字都不报（只在转换日志里留一行 warn）；实现链路：`自带积木.计算()` → `角色基类.算式求值()`（Godot Expression + K4 语法预处理）（L829-L832）。
114. 询问并选择配套取值块三个类型：`get_choice` → 选中的**内容**；`get_choice_index` → 选中的**序号（从 1 开始，和列表序号同规则）**；`get_choice_or_index` → **同一个块**用 `fields.type` 区分（`select_content` / `select_index`）；实测（Phigros模拟器v2.5）：`fields.type = "select_content" | "select_index"`（L1039-L1044）。
115. 以前这三个类型在 `value()` 里都没有分支 → 生成 `0.0`：询问结果恒为 0，所有"选对了吗"的判断永远走 else 分支（L1045-L1046）。
116. `math_root` 的 `DEGREE`/`N`、`math_number_property` 的 `PROPERTY`、`logic_compare` 的 `OP`（EQ/NEQ/LT/LTE/GT/GTE）等字段各自映射（L879-L903）——文件名与字段来自 7 个官方样例工程统计（L1344）。
117. 未知表达式块会带上全部输入与字段一起进 IR（否则 `check_screen` 这类判断积木没法生成）（L1105-L1119）。

### 8.6 素材 / 悬空块 / 其它

118. 经核对 7 个官方样例：所有造型/声音都是**内嵌 base64 data URI**，没有一条外链（113 个造型 + 23 个声音，**外链数 0**），所以素材可以 100% 离线提取、不需要联网（L2813-L2815）。
119. 素材结构：`raw.theatre.styles[<uuid>] = {id,name,url:"data:image/png;base64,…",cdn_url,pivot:{x,y},rotate_center:{x,y},adaptive}`；`raw.audio[<uuid>] = {id,name,url:"data:audio/mpeg;base64,…",cdn_url,volume,playback_rate,effects}`（L2818-L2822）。
120. Kitten4 的造型 id 是工程级的，但**不同角色完全可以用同名造型**（「蓝雀」「蓝雀1」在两个角色里都叫这个名字），按角色分目录才不会互相覆盖（L2982-L2983）。
121. **★锚点：K4 的「旋转中心」是相对图片中心的像素偏移，x 向右、y 向下**（依据 K4 Ultra 里 pixi 的 `pivot = 图宽/2 + custom.x`、`图高/2 + custom.y`）（L2248-L2249）。
122. 生成代码靠「造型名 → 文件名」映射去 `assets/styles/` 找文件；Kitten4 的角色名通常和造型名不一样，**必须按 id 查表，不能拿角色名去猜**（L2211-L2214）。
123. 实体造型索引优先按 id 建（id 才是工程内唯一的），名字只作为退路（L2224）。
124. 资源（图片/声音）信息**不同版本字段名不同**，做兼容（L2320）。
125. 悬空块（"预备块"）在 K4 里很常见：用户写了一大段文本、后来换成别的就不再用的，或从别处复制过来忘在那儿的；它们不影响运行，但里面可能有唯一数据（用户说"有时作为替换当前运行文本用的"）（L2707-L2711）。
126. 转换器不把它们变成代码（本来就不该运行），而是备份进 `<角色>/预备块.gd`（那个脚本**不挂载到任何节点上**），需要时自己复制回去（L2712-L2714）。
127. 只收 `type === 'text'` 且长度 **>= 16** 的：K4 自带的默认影子（`123` / `abc` / `Hello` / `1,2,3,4`）满工程都是，收进来只是噪音；要全收就把它改成 1（L2716-L2717、L2750-L2751）。
128. 可达性分析的入口是帽子块 + 自定义积木定义块（定义块不挂在帽子上）（L2726-L2727）。
129. `parent_id` 的「子块」要跳过影子（影子只通过连接才可达）（L2737）。
130. `file_name` 安全化**保留中文**，只去掉路径与非法字符（L2844）。
131. `base64ToBytes` 是纯 JS 实现，Node 与浏览器通用、不依赖 `Buffer`/`atob`（L2872）。
132. `BlockModel.statementChain` 的 `guard` 上限 100000 是防环保护（L213）。
133. `get_time` 在文件中有两处 `case`（L679 与 L1015），第二处注释自己承认是"兜底分支（另一处 switch 里已有同样的处理）"（L1016）。
134. 文件头声明「由于多来源交叉验证的存在，本文件在无法运行 Node 的环境下也保持了可静态审查的结构」（L17）。
135. L2705 的注释「兼容 K4 老版命名（entityScripts 的旧签名）」**悬空**——它后面紧跟的其实是 `collectSpareTexts` 的文档注释，未见对应的兼容代码（代码事实；该注释意图**未确认**）。

---

## 9. 代码可直接验证的「重复 case / 死代码」清单

`switch (t)` 的分支在 JS 里**先命中者胜**，同一 `case` 值出现两次时后面那段永不执行。以下取自代码（不是推测），接手前需要知道：

1. `expr()` 中 `case 'get_current_costume'` 出现两次：L704-L705（返回 `op('self_costume')`）先命中，L718-L721（想把 `style_id` 解析成造型名）**不可达**。
2. `expr()` 中 `case 'shadow_number'`：L580-L599 的提前返回分支先处理，L722-L729 **不可达**。
3. `expr()` 中 `case 'shadow_text'`：L582-L593 提前返回先处理，L730-L738 **不可达**。
4. `expr()` 中 `case 'get_time'` 出现两次：L679-L690 先命中，L1015-L1021 **不可达**。
5. `expr()` 中 `case 'lists_length'` 出现两次：L660-L661 先命中，L1065-L1066 **不可达**。
6. `expr()` 中 `case 'controller_shadow'`：L580 的提前返回先处理，L837-L843 **不可达**。
7. `stmt()` 中 `case 'self_set_position'` 出现两次：L1437-L1442 先命中，L1928-L1942（那段带「★实测修正★」注释的单轴/双轴判断）**不可达**。
8. `stmt()` 中 `case 'self_move_to'` 出现两次：L1417-L1422 先命中，L1956-L1958 **不可达**（两者实现等价）。
9. `stmt()` 中 `case 'self_change_scale'` 出现两次：L1452-L1460 先命中，L1970-L1971 **不可达**。
10. `stmt()` 中 `case 'variables_set'` / `'data_setvariableto'` 出现两次：L1511-L1517（用 `varName` 解析）先命中，L2041-L2043（`String(field('VAR'))`，不解析名字）**不可达**。
11. `stmt()` 中 `case 'procedures_callnoreturn'` 出现两次：L1828-L1836（带 `procRoute` 远端转发）先命中，L2074-L2079 **不可达**。
12. `stmt()` 中列表家族重复：`lists_add` L1531 先于 L2047；`lists_delete` L1538 先于 L2050；`lists_insert` L1547 先于 L2056；`lists_replace` L1554 先于 L2059 —— 后者（`list_delete` k 值等）**不可达**。
13. `stmt()` 中画笔家族重复：`pen_clear` L1588 先于 L2027；`pen_down`/`pen_up` L1590/L1592 先于 L2029/L2031（实现等价）。
14. `case 'self_bounce_off_edge'`（L1450）与 `case 'self_bounce'`（L1959）返回相同 `{k:'bounce'}`；`clone`（L1868）与 `mirror`（L1733）是两个不同块类型，不是重复。
15. `stmt()` 里 `function unused(){ return S; }`（L2096）是永不执行的声明，只是为避免 `S` 未被使用的 lint 提示。

---

## 10. 明确「未确认」的点

1. `connections` 中同一子块被多个父块指向时 `parentOf` 的覆盖顺序是否有实际影响——代码上「后者覆盖前者」，是否在真实工程中出现**未确认**。
2. 云变量 id 形如 `n749e60b5_…`（注释举例）不符合 `UUID_RE`，是否真实存在该形态**未确认**（若存在，`resolveIRNames` 不会回填）。
3. `raw.list` 兼容分支（L2410-L2417）对应的 K4 版本是否存在**未确认**（注释只说"万一某版本确实另有顶层 list 表"）。
4. `L2705` 悬空注释所指的「entityScripts 旧签名兼容」代码是否存在**未确认**（当前文件里没看到）。
5. `BLOCKS.SUPPORTED` 的具体内容由 `blocks.js` 提供，本笔记未读该文件，`supported` 字段的实际取值覆盖率**未确认**。
6. `Decompiler.prototype.expr` 里 `case 'text_select_changeable'` 之外的文本家族块（如 `text_charAt` 的 `WHERE` 语义）是否正确，仅按代码注释与字段名记录，**未与 K4 运行结果交叉验证**。

---

## 11. 给接手者的最短路径

- 想改「读某个块」：先看 `value()/valueAny()`（值）还是 `blockBody/chain`（语句），再在 `expr()`（L605-L1081）或 `stmt()`（L1321-L2091）里找 case；**注意 §9 的死代码**，同名 case 要改前面那个。
- 想改命名：动 `parseProject` 的 `names`（L2433-L2506）或 `resolveIRNames`（L2534-L2552）；反编译期解析走 `entityName/varName/listName/cloudName`。
- 想知道为什么某个积木生成出 `0.0` / 空串 / 桩：查 `this.warnings`（`warn()` L380）——`value()` 会打印「值输入名对不上…它实际有的是…」（L434-L435），`stmt()` 会打印「未支持的语句积木…」（L2093），`expr()` 会打印「未支持的取值积木…」（L1106）。
- 想扩素材：`extractAssets` + `MIME_EXT` + `entityStyles` 的 `pivots`（旋转中心为「相对图片中心的像素偏移，x 右 y 下」）。
