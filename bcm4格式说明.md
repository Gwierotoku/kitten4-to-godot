# `.bcm4` 的 JSON 格式构成

> 本文所有结论都从两个来源核对过：
> 1. **真实工程文件**逐字段核对 —— 样本：`新的作品.bcm4`（0.18 MB，1 场景 1 角色 5 积木）
>    和 `游戏-空白作品.bcm4`（18.17 MB，1 场景 37 角色 7443 积木）
> 2. ★ **K4 Ultra 自己的序列化 / 反序列化代码** —— 在
>    `K4-ULTRA-main/resources/app/build/kitten.822d814413fb10654fde.js` 里，
>    关键位置见第 9 节「代码证据索引」
>
> 第 9 节列出了「只有读源码才能发现的细节」，那些是纯靠反推数据**看不出来**的。

## 0. 一句话总览

`.bcm4` **就是一个 JSON 文件**（不是压缩包、不是二进制）。
它的结构可以分成四组：

```
{
  ── 元信息 ──   version / application_version / project_name / size / work_type
  ── 资产  ──   theatre.styles（造型）/ audio（声音）/ midimusic（MIDI）
  ── 逻辑  ──   theatre.scenes 和 theatre.actors 里的 block_data_json
  ── 界面状态 ── toolbox / painter / workspace_offset（转换时可忽略）
}
```

**权威来源**：这个结构就是 K4 的**保存函数**的返回值（源码位置见第 9 节 A），
不是"大概长这样" —— 是逐字段写出来的。

## 1. 顶层键（真实文件里有 28~29 个）

### 必须用的（6 个）

| 键 | 类型 | 说明 |
| --- | --- | --- |
| `version` | number | 数据格式版本，实测都是 `25` |
| `application_version` | string | K4 版本，如 `"4.11.20"` |
| `project_name` | string | 作品名 → Godot 的 `config/name` |
| `size` | `{width, height}` | **舞台尺寸**，如 `{"width":960,"height":720}` → Godot 视口尺寸 |
| `work_type` | string | 实测 `"KITTEN"` |
| `theatre` | Object | ★ **核心**：场景 / 角色 / 造型全在这里 |

### 资产类（3 个）

| 键 | 说明 |
| --- | --- |
| `theatre.styles` | 造型：`uuid -> {id, name, url, cdn_url, pivot, rotate_center}` |
| `audio` | 声音：`uuid -> {id, name, url, cdn_url, volume, playback_rate, effects}` |
| `audio_order` | 声音显示顺序 |
| `midimusic` / `midi_order` | MIDI 音乐（数组，实测多为空） |

### 界面状态类（**转换时全部忽略**）

| 键 | 说明 |
| --- | --- |
| `toolbox` / `toolbox_order` / `last_toolbox_order` / `hidden_toolbox` | 左侧积木面板的状态 |
| `variables` | 变量**和列表**的定义 + 它们在舞台上的**显示位置** |
| `variable_order` | 变量显示顺序 |
| `painter` | 画笔的界面状态（**含 React 垃圾，见坑 2**） |
| `matrix` / `models` / `ai_lab` | 实测都是 `{}` |
| `workspace_offset`（在每个实体内） | 积木编辑器的滚动位置 |
| `device_widget_type` / `hardware_type` / `is_partial` / `sample_id` / `work_source_label` / `type` / `codemao_value` | 平台元数据 |

## 2. `theatre` —— 工程的内容

```
theatre = {
  scenes_order: ["uuid", ...]      ← 场景顺序，第一个是起始场景
  scenes:  { uuid -> 场景对象 }
  actors:  { uuid -> 角色对象 }
  styles:  { uuid -> 造型对象 }    ← 注意：在 theatre 下面，不在顶层
  groups:  { uuid -> 分组对象 }
  videos:  {}                      ← 实测空
  timer:   {}                      ← 实测空
}
```

### 2.1 场景（`theatre.scenes[uuid]`）

```json
{
  "id": "b5e60282-a2d1-478b-802d-a30e77d67e6b",
  "name": "背景",
  "screen_name": "屏幕",          // ★ 「屏幕」—— 多个场景可共用一个屏幕
  "current_style_id": "2575694c-...",
  "styles": ["2575694c-...", ...], // 造型 uuid 列表
  "actors": [...],                 // 这个场景里的角色 id
  "x": 0, "y": 0, "scale": 100, "rotation": 0,
  "rotation_type": 0,
  "draggable": false,
  "visible": true,
  "group_order": [...],
  "block_data_json": { blocks, connections, comments }   // ★ 舞台自己的积木
}
```

场景和角色的字段**几乎一样** —— 差别是场景多了 `screen_name`。
所以在转换器里可以**用同一套代码处理场景和角色**（我的实现就是这么做的）。

### 2.2 角色（`theatre.actors[uuid]`）

```json
{
  "id": "a6a2046b-...",
  "name": "编程猫跳跳",
  "scene": "b5e60282-...",        // ★ 属于哪个场景
  "x": -133.7069227393932,        // ★ y 是「向上为正」
  "y": -187.9917689732144,
  "scale": 96.72806971358581,     // 百分比，100 = 原大小
  "rotation": 0,
  "rotation_type": 0,
  "visible": true,
  "draggable": false,
  "current_style_id": "85b970e6-...",
  "styles": ["103f83da-...", ...],// ★ 造型 uuid 列表（顺序 = 造型编号）
  "lock": false,
  "editable_in_tuition_mode": true,
  "user_change_r_c": false,
  "block_data_json": { blocks, connections, comments }
}
```

### 2.3 造型（`theatre.styles[uuid]`）

```json
{
  "id": "103f83da-6628-4201-86d9-b709e3856538",
  "name": "编程猫跳跳(1)",
  "url": "data:image/png;base64,iVBORw0KGgo...",   // ★ 内嵌，实测 9590 字符
  "cdn_url": "https://creation.codemao.cn/445/kitten/d...",
  "pivot": {"x":0, "y":0},           // 旋转中心偏移（实测 99% 是 0）
  "rotate_center": {"x":0, "y":0}
}
```

**关键**：`url` 是 `data:image/png;base64,...`，所以素材**可以 100% 离线导出**，
不需要联网（这就解决了移植里最大的资源问题）。

## 3. 积木：`block_data_json`（最重要）

这是 Blockly 的序列化格式，形状是：

```
block_data_json = {
  blocks:      { 块id -> 块对象 }
  connections: { 父块id -> { 子块id -> 连接信息 } }
  comments:    { 注释id -> 注释 }        // 实测是 {}
}
```

### 3.1 块对象的完整字段

```json
{
  "type": "self_prev_next_style",     // ★ 积木类型
  "id": "Zuq0nFAYw1H8CqDR2QCB",
  "parent_id": "kJJEN5ZDDCwl75CiTK0v",// ⚠ 不可靠！见坑 1
  "is_shadow": false,                 // 是否是「影子块」（默认值块）
  "is_output": false,                 // 是否是「取值积木」（有返回值）
  "collapsed": null,                  // 是否折叠
  "disabled": null,                   // 是否被「禁用」
  "deletable": true,                  // 界面属性，可忽略
  "movable": true,
  "editable": true,
  "visible": "visible",
  "location": [0, 0],                 // 在画布上的位置
  "comment": null,
  "fields": { "prev_or_next": "next" },   // ★ 下拉框/输入框的值
  "shadows": { ... },                     // ★ 各插槽的默认值（XML 字符串）
  "field_constraints": { ... },
  "field_extra_attr": { ... },
  "mutation": "<mutation .../>"           // ★ 动态结构信息（见 3.4）
}
```

**真正有用的只有 6 个**：`type`、`id`、`fields`、`shadows`、`mutation`、`is_shadow`。

### 3.2 `connections` —— 两种语义

```json
{
  "bDzm26OLitVn7CGUHZw7": {
    "kJJEN5ZDDCwl75CiTK0v": { "type": "next" }
  },
  "kJJEN5ZDDCwl75CiTK0v": {
    "Zuq0nFAYw1H8CqDR2QCB": {
      "type": "input",
      "input_type": "statement",     // statement（语句体）或 value（值）
      "input_name": "DO"
    }
  }
}
```

| 形式 | 含义 |
| --- | --- |
| `{"type":"next"}` | **语句顺序**：下一个积木 |
| `{"type":"input","input_name":"DO"}` | 塞进某个**插槽**（`input_type` 说明是语句体还是值） |

**关键**：`connections[父][子]` 的方向是"父 → 子"，
但 `next` 表示"子跟在父后面"，`input` 表示"子在父的插槽里"。

### 3.3 `shadows` —— 插槽的默认值（**三种表达**）

一个插槽里的值可能来自**三处**，必须都处理：

```json
// 情况 1：插槽里塞了一个块
"connections": { "waitId": { "childId": {"type":"input","input_name":"time"} } }

// 情况 2：插槽是空的，用默认值 -> 存在父块的 shadows 里（XML 字符串）
"shadows": {
  "time": "<shadow xmlns=\"...\" type=\"math_number\" id=\"...\" visible=\"visible\">\n  <field constraints=\"-Infinity,Infinity,0,\" name=\"NUM\">0.2</field>\n</shadow>"
}

// 情况 3：什么都没有 -> 按 0 / "" 处理
```

**shadow 里的 `<field name="NUM">0.2</field>` 就是默认值。** 这就是为什么
"等待 0.2 秒"这个积木在 `blocks` 里看不到 `0.2` —— 它在 `shadows` 的 XML 里。

### 3.4 `mutation` —— 动态结构

有些积木的**结构**是可变的，信息放在 `mutation` 字符串里（是 XML）：

```json
// 如果…那么…（有几个 elseif / 有没有 else）
"mutation": "<mutation elseif=\"2\" else=\"1\"></mutation>"
// 对应的输入名：IF0/DO0, IF1/DO1, IF2/DO2, ELSE

// 自定义积木调用（procedure 名 + 参数名 + 定义块 id）
"mutation": "<mutation name=\"生成\" def_id=\"O3vwoMN9gvjvRW3gbheQ\">\n  <procedures_2_parameter_shadow name=\"X\" value=\"0\"></procedures_2_parameter_shadow>\n  ...\n</mutation>"

// 自定义积木定义（有几个参数）
"mutation": "<mutation><arg name=\"PARAMS0\"></arg><arg name=\"PARAMS1\"></arg></mutation>"
```

**`def_id` 是跨角色调用自定义积木的关键**：它等于**定义块的块 id**。

## 4. `variables` —— 变量**和列表**混在一起

这是容易搞错的地方：**K4 没有单独的 lists 键，列表就是 `type:"list"` 的变量**。

```json
// 普通变量
"1c76d619-...": {
  "id": "1c76d619-...",
  "name": "遍历1",
  "type": "any",              // ★ any = 普通变量
  "value": 0,
  "is_global": false,         // 局域变量（属于某个角色）
  "current_entity": "ba90c49e-...",  // 局域时，属于哪个角色
  "theme": "common",
  "scale": 1,
  "position": {"x":-630,"y":230},    // 在舞台上的显示位置（界面用）
  "offset": {"x":0,"y":0},
  "visible": false
}

// 列表
"c1d15882-...": {
  "id": "c1d15882-...",
  "name": "区块位置",
  "type": "list",             // ★ list = 列表
  "value": [],                // 列表的初值
  "is_global": true,
  "theme": "red",
  ...
}
```

实测 19MB 工程：**192 个变量，其中 166 个 `any` + 26 个 `list`**。

**注意**：积木里引用变量用的也是 uuid，所以转换器必须用 `variables` 建
"uuid → 名字"的映射表。

## 5. ⚠️ 三个真实的坑

### 坑 1：`parent_id` 不可靠

角色「编程猫跳跳」里有个块：

```json
"Zuq0nFAYw1H8CqDR2QCB": {
  "type": "self_prev_next_style",
  "parent_id": "kJJEN5ZDDCwl75CiTK0v"     // ← 指向一个「不存在」的 id！
}
```

但 `connections` 里它是 `bDzm26OLitVn7CGUHZw7`（`start_on_click`）的后继：

```json
"bDzm26OLitVn7CGUHZw7": { "kJJEN5ZDDCwl75CiTK0v": {"type":"next"} }
"kJJEN5ZDDCwl75CiTK0v": { "Zuq0nFAYw1H8CqDR2QCB": {"type":"input","input_name":"DO"} }
```

**结论**：
- **不要用 `parent_id` 遍历块图**，它是历史遗留、可能过期
- **`connections` 才是权威**
- 而且 `connections` 里也可能有残留 id → **遍历时必须判断块是否存在**

### 坑 2：`broadcasts` 里 99.97% 是垃圾

19MB 工程的 `raw.broadcasts` 有 **16815 个键**，去重后 **6328 个"广播名"**。

但**积木里真正引用的广播只有 5 个**：`主页`、`刷新`、`新手教程`、`克隆boss`、`Hi`。

为什么？因为 `broadcasts` 里混进了 **React 组件的状态泄漏**：

```json
"broadcasts": {
  "b5e60282-...": ["克隆boss", "新手教程", "刷新", "主页"],   // ← 这个是真的
  "toJSON": ["Hi"],                                          // ← 这是 React 组件的属性
  "ffc899a0-...": ["Hi"],                                    // ← 3 万多个角色的空广播
  ...
}
```

**结论：转换器应该直接扫积木里的广播引用，不要信 `raw.broadcasts`。**
（我的实现就是这么做的 —— 在 `K4Bus` 注册时用的是积木里读出来的名字。）

同理 `painter.color` 也是 React 垃圾：

```json
"painter": {
  "color": {
    "dispatchConfig": null, "_targetInst": null, "nativeEvent": null,
    "type": null, "target": null, "currentTarget": null, "eventPhase": null, ...
  }
}
```

### 坑 3：列表没有独立的顶层键

很多教程会说"变量在 `variables`、列表在 `lists`" —— **K4 不是这样**。
列表就是 `variables` 里 `type:"list"` 的条目。

如果你按 `raw.lists` 去找，会得到 `undefined`。

## 6. 一个完整的积木图例子（5 个块）

这是 `新的作品.bcm4` 里角色「编程猫跳跳」的**全部**积木：

```
blocks（5 个）:
  bDzm26OLitVn7CGUHZw7  start_on_click          ← 帽子（parent_id = null）
  kJJEN5ZDDCwl75CiTK0v  repeat_forever          ← 重复执行
  Zuq0nFAYw1H8CqDR2QCB  self_prev_next_style    ← 下一个造型（fields: prev_or_next=next）
  1A7LUWie502hO2zsV0BG  wait                    ← 等待
  lorR4bUDaQIpVoGk6O8c  math_number (is_shadow) ← 影子块，值 0.2

connections:
  bDzm26OLitVn7CGUHZw7 → kJJEN5ZDDCwl75CiTK0v   next      帽子后面接「重复执行」
  kJJEN5ZDDCwl75CiTK0v → Zuq0nFAYw1H8CqDR2QCB   input/DO  「重复执行」的语句体
  Zuq0nFAYw1H8CqDR2QCB → 1A7LUWie502hO2zsV0BG   next      「下一个造型」后面接「等待」
  1A7LUWie502hO2zsV0BG → lorR4bUDaQIpVoGk6O8c   input/time「等待」的时间参数
```

翻译成人话：

```
当开始运行
  重复执行
    下一个造型
    等待 [0.2] 秒
```

## 7. 转换器读文件的顺序（建议）

```
1. 读 size        → project.godot 的视口尺寸
2. 读 project_name→ project.godot 的 config/name
3. 读 theatre.scenes_order → 场景顺序，第一个是主场景
4. 对每个场景/角色：
   a. 读 styles[] + current_style_id → 导出图片 + 确定当前造型
   b. 读 x/y/scale/rotation/visible   → 建立节点、设坐标
   c. 读 block_data_json             → 生成脚本
5. 建 names 注册表（variables + styles + audio）→ 把 uuid 换成可读名字
6. 忽略：toolbox / broadcasts / painter / workspace_offset / matrix / ai_lab
```

## 8. 字段速查表

| 你想找 | 在哪 |
| --- | --- |
| 作品名 | `project_name` |
| 舞台尺寸 | `size.width` / `size.height` |
| 有几个场景 | `theatre.scenes_order.length` |
| 场景名 / 屏幕名 | `theatre.scenes[id].name` / `.screen_name` |
| 角色属于哪个场景 | `theatre.actors[id].scene` |
| 角色坐标 | `theatre.actors[id].x` / `.y`（**y 向上为正**） |
| 角色大小 | `.scale`（百分比） |
| 当前造型 | `.current_style_id` → 去 `theatre.styles` 查 |
| 造型图片 | `theatre.styles[uuid].url`（`data:...;base64`） |
| 造型名 | `theatre.styles[uuid].name` |
| 变量的名字 | `variables[uuid].name`（`type:"any"`） |
| 列表的名字 | `variables[uuid].name`（`type:"list"`） |
| 积木 | `theatre.{scenes,actors}[id].block_data_json.blocks` |
| 积木连接 | `...block_data_json.connections` |
| 插槽默认值 | `blocks[id].shadows[输入名]`（XML） |
| 分支数 / 自定义积木信息 | `blocks[id].mutation`（XML） |
| 脚本入口（帽子块） | `parent_id == null` 且 `!is_shadow` |

---

# 9. ★ 只有读 K4 Ultra 源码才能发现的细节

这一节是「结合反序列化代码」的产出。每一条都附了源码位置，可以自己去核。

## 9.1 序列化契约：哪些字段是"官方承诺"的

**位置 A**（`kitten.*.js` 约 10971~11016 行）是保存函数的返回对象，
逐字段列出了写进 `.bcm4` 的东西：

```js
return {
  hidden_toolbox: { toolbox: [...], blocks: [...] },
  work_source_label, codemao_value, sample_id,
  version: Object(W.e)(),
  application_version: "4.11.19",
  work_type, size, type, project_name,
  theatre: {
    scenes_order, scenes, actors,
    videos: v.videos, styles: c, groups: a, timer: v.timer || {}
  },
  variables, variable_order,
  cloud_variables: p,
  audio, audio_order, midimusic, midi_order,
  matrix, models,
  toolbox, toolbox_order, last_toolbox_order,
  hardware_type, device_widget_type, is_partial, ai_lab,
  broadcasts: V.e.get_save_data(),          // ★ 见 9.3
  painter: { color: ... }                    // ★ 见 9.3
}
```

**这说明**：`version` / `application_version` / `work_type` 都是**写死的常量**
（`application_version` 直接就是字符串 `"4.11.19"`），不是有用的版本信息。
真正要读的只有 `size` / `project_name` / `theatre` / `variables`。

## 9.2 ★ 官方在保存前会「删孤儿」—— 你的转换器不用自己清

**位置 B**（约 11301 行，函数 `ce`）是保存前的净化函数。它做的事：

```js
// 1. 场景的 group_order 里，去掉不存在的分组
// 2. 分组的 actors 里，去掉不存在的角色
// 3. 分组里没被任何场景引用的 -> delete
// 4. ★ 角色：如果它的 id 不在「所有场景 + 所有分组」的引用集合里 -> delete
// 5. ★ 造型：只保留被存活角色引用的
// 6. ★ 变量：只保留 variable_order 里还存在的
// 7. ★ 局域变量：如果它的 current_entity 指向已被删掉的实体 -> delete
```

**这条非常重要**，因为它意味着：

- 规范保存的 `.bcm4` 里**不应该有孤儿数据**（没被场景引用的角色、没人用的造型）
- 所以你**不需要**写"清理不可达数据"的逻辑
- 反过来说：**如果你在文件里看到孤儿，说明这个文件不是规范导出的**
  （比如是运行时内部 dump、或者被外部工具改过）

**但要小心**：第 4 步用的是「场景 + 分组」的引用集合，
所以一个角色可能**合法地不属于任何分组**，只要它被场景引用。
我的转换器按 `actor.scene === 当前场景` 筛角色，这跟官方一致。

## 9.3 ★ `broadcasts` 的真实结构 —— 以及为什么有垃圾

**位置 C**（约 29324 行）：

```js
key: "get_save_data",     value: function() { return this.broadcasts }
key: "get",               value: function() {
    var e = h.a.get_state().theatre_state.current_scene;
    return this.broadcasts[e]        // ★ 按【场景 id】取广播列表
}
```

所以 `broadcasts` 的**设计结构**是：

```json
"broadcasts": {
  "<场景id>": ["广播名1", "广播名2", ...]     // 每个场景一个数组
}
```

而且广播名是**从积木里扫出来的**（位置 C 附近）：

```js
// 从 JSON 积木里扫
"broadcasts_from_json": 遍历 blocks，收集 type === "broadcast_input" 的 fields.MESSAGE
// 从 XML 里扫
"broadcasts_from_xml":  正则 /<field name="MESSAGE">(.+?)<\/field>/g
```

**关键点**：广播名的**权威存储位置是 `broadcast_input` 这个影子积木的 `MESSAGE` 字段**，
不是 `broadcasts` 这个汇总表。

而且 **K4 自己也知道这张表会脏** —— 它有个方法就叫：

```js
key: "remove_unused_broadcasts", value: function() {
    this.update_broadcasts_from_ws_data(), Object(y.l)(y.a.events)
}
```

**这解释了我在 19MB 工程里看到的现象**：
`raw.broadcasts` 有 16815 个键、去重后 6328 个"广播名"，
但**积木里真正引用的只有 5 个**（`主页`、`刷新`、`新手教程`、`克隆boss`、`Hi`）。

**结论（比原来更明确了）**：
- `broadcasts` 是**给编辑器用的缓存表**，按场景分组
- 它**可能没被清理**（`remove_unused_broadcasts` 只在"开始运行"时调用，见位置 D）
- **转换器必须扫积木**（`broadcast_input` 的 `MESSAGE` 字段），不要信这张表

## 9.4 ★ 连接是「两遍」建立的，而且官方对非法连接的处理是「丢弃」

**位置 E**（约 121982 行，`json_to_workspace_headless`）：

```js
// 第一遍：把所有块都创建出来
r && Object.keys(r).forEach(id => { json_to_block_headless(r[id], t, false); a.push(id) })

// 第二遍：建立连接
Object.keys(i).forEach(from => {
  Object.keys(i[from]).forEach(to => {
    var a = i[from][to];
    var c = t.get_block_by_id(from);      // 父块
    var u = t.get_block_by_id(to);        // 子块
    if (c && u) {
      if (a.type === "next") { l = c.next_connection;     _ = u.previous_connection }
      else { var d = c.get_input(a.input_name); l = d && d.connection;
             _ = u.output_connection || u.previous_connection }
      if (!l || !_) return u.is_shadow()
        ? (u.dispose(), void console.error("Connected connection not found. Shadow block disposed."))
        : void console.error("Connected connection not found.");
      ...
    } else console.error("Connected block not found. ")   // ★ 块不存在 -> 只报错，跳过
  })
})
```

**三个可以学到的点**：

1. **块不存在时，官方只是 `console.error` 然后跳过** ——
   所以「`connections` 里有残留 id」是**官方认可会发生的情况**。
   你的转换器必须判断块是否存在（我的 `BlockModel.next()` 里那个
   `return this.block(to) ? to : null` 就是在做这件事）。

2. **`next` 连接的两端是**：父块的 `next_connection` ↔ 子块的 `previous_connection`。
   **`input` 连接的两端是**：父块的 `get_input(input_name).connection` ↔
   子块的 `output_connection`（取值块）**或** `previous_connection`（语句块）。
   → 这解释了为什么 `input_type` 有 `"value"` 和 `"statement"` 两种。

3. **连接是「延迟」处理的**：如果 `_.context` 存在（说明这个连接点已经被占了），
   就推到 `s` 数组里**第二轮再连**。这是在处理"积木图里连接顺序"的问题。

## 9.5 ★ `NUM` 和 `TEXT` 的兼容规则（数字字段可能存文本）

**位置 F**（约 121945 行，`parse_block_data`）：

```js
if (is_field_number(t)) {
  // ★ 数字字段：如果 fields.NUM 不存在、而 fields.TEXT 存在 -> 当成文本字段读
  void 0 === e.fields.NUM && void 0 !== e.fields.TEXT && (n = "TEXT", t.set_allow_text(!0));
  ...
  var a = e.fields[n];
  if (void 0 !== a) void 0 !== t.call_validator(a) && "FieldImage" !== t.field_type && t.set_value(a)
}
```

**这意味着**：一个数字输入框里，用户是可以**输入文本**的
（`set_allow_text(true)`），这时值会存到 `fields.TEXT` 而不是 `fields.NUM`。

**对你的转换器的要求**：读数字字段时要写成

```js
const raw = b.fields.NUM !== undefined ? b.fields.NUM : b.fields.TEXT;
```

只读 `NUM` 会漏掉"用户在数字框里填了文字"的情况。
（我的实现里到处都在用 `F('NUM', ...)` + 回退 `F('TEXT', ...)`，就是因为这个。）

**另外** `call_validator` 的语义（位置 G，约 76302 行）：

```js
call_validator(e) {
  if (null != e) {
    if (!this.validator_) return e;         // 没校验器 -> 原值
    var t = this.validator_.call(this, e);
    if (null != t) return t;                // 校验器给了新值 -> 用新值
  }
  // 走到了这里 = 校验失败 -> 返回 undefined
  // 调用方写的是 `void 0 !== t.call_validator(a) && t.set_value(a)`
  // 所以校验失败的值会被【丢弃】！
}
```

**所以**：`.bcm4` 里理论上不该有"非法字段值" ——
如果校验失败，那个值根本不会被设进去。如果你看到非法值，说明文件被外部改过。

## 9.6 `field_constraints` / `field_extra_attr` 到底是什么（纯界面）

**位置 F** 同一段：

```js
// field_constraints -> 传给输入框的 min/max/precision/mod
var i = e.field_constraints[n];
void 0 !== i && (t.set_constraints(i.min, i.max, i.precision), null !== i.mod && (t.mod_ = i.mod));

// field_extra_attr.controller_type -> 决定输入框长什么样
"SLIDER"        -> set_controller_option({type: SLIDER, left_text, right_text})
"COLOR_PICKER"  -> set_controller_option({type: COLOR_PICKER, color_format, line})
否则            -> set_controller_option({type: ANGLE_SCALE})
```

**结论**：这两个字段**纯粹是编辑器 UI 状态**，跟积木语义无关。
- `field_constraints`：滑块的上下限、精度
- `field_extra_attr.controller_type`：这个输入用**滑块**还是**取色器**还是**角度盘**

**转换时可以完全忽略它们。**（我之前把它们归到"可忽略"是对的，
但现在能说清**为什么**了。）

不过有一个**例外**值得注意：

```js
if (is_field_default_value(t))
  if (void 0 !== (r = e.field_extra_attr && e.field_extra_attr[n]) && void 0 !== r.has_been_edited) {
    var o = r.has_been_edited;
    t.set_has_been_edited(o)
  }
```

`has_been_edited` 标记这个"默认值输入框"**是否被用户改过**。
这解释了我在 `default_value` 影子块里看到的：

```xml
<shadow type="default_value"><field has_been_edited="false" name="TEXT">0</field></shadow>
```

**`has_been_edited="false"` 说明这个 `0` 只是占位默认值**
（用户没改）。读值的时候仍然按 `0` 处理就行，但它提示了
「这个值是默认的、不是用户意图」。

## 9.7 `scope` 字段（我原来的文档漏了）

**位置 H**（约 128507 行）：

```js
this.workspaces[e.id] = new I(e.id, e.scope, t)   // (entity_id, scope, workspace_offset)
```

workspace 的构造参数是 `(entity_id, scope, workspace_offset)` ——
而 workspace 是**按实体 id** 建的。

**两个结论**：
1. **每个实体（场景/角色）只有一个 workspace**，
   所以 `block_data_json` 就是一个完整的积木图，不存在"多个脚本文件"的概念。
   （K4 里"多个脚本"是靠**多个帽子积木**表达的，不是多个 workspace。）
2. 实体上可能有个 `scope` 字段 —— 我在两个样本里没见到它实际出现，
   但它是官方的构造参数之一。**读的时候按可选字段处理。**

## 9.8 `workspace_offset` 确实是滚动位置

**位置 H** 附近（约 128216~128224 行）：

```js
key: "set_workspace_offset", value: function(e) { this.workspace_offset = e }
key: "get_workspace_offset", value: function() { return this.workspace_offset }
```

保存时是 `get_workspace_offset()` 的返回值，实现在
`new I(entity_id, scope, workspace_offset)` 里，而 `I` 是 **Blockly workspace**
的包装类。所以它就是**积木编辑器滚到哪里了**。**确认可忽略。**

## 9.9 `reset_element_ids`：官方自己会重生成 id

**位置 I**（约 122070 行）：

```js
reset_element_ids(e) {
  var t = JSON.stringify(e);
  function n(e, t, n) { return e.replace(new RegExp(escapeRegExp(t), "g"), n) }
  Object.keys(e.blocks).forEach(id => { t = n(t, id, gen_uid()) });      // 所有块 id 换新
  Object.keys(e.comments).forEach(id => { t = n(t, id, gen_uid()) });    // 所有注释 id 换新
  return JSON.parse(t)
}
```

**两点**：
1. K4 的 id 生成函数是 `gen_uid()`
2. **它用的是"字符串全局替换"**（`JSON.stringify` 后暴力 replace）——
   这说明 id 在 JSON 里**只出现在键和引用处**，不会有歧义。
   这也侧面印证了格式的简单性。
3. 这个函数用于**复制粘贴**（粘贴时给新块分配新 id）。
   如果你要做"把一个角色的脚本复制到另一个角色"，可以直接用这个思路。

## 9.10 注释（`comments`）的完整结构

**位置 J**（约 121972 行 `json_to_comment_headless`）：

```js
if (e.parent_id) {                    // ★ 注释可以挂在某个块上
    var r = t.get_block_by_id(e.parent_id);
    if (!r) throw Error("Comment parent block not found");   // ★ 这里会抛异常！
}
// 注释字段：
//   text, pinned, size: [w, h], location: [x, y],
//   auto_layout, color_theme, parent_id, id
```

**注意**：`blocks[id].comment` 存的是**注释 id**，
真正的注释在 `block_data_json.comments[注释id]` 里。
而且注释的 `parent_id` 指向**块 id**（不是块对象）。

我在两个样本里 `comments` 都是 `{}`，所以没影响到转换。
但如果你的工程里有注释，**注意 `parent_id` 找不到块时官方会抛异常**
（不像连接那样只是 `console.error`）。

---

# 10. 代码证据索引

想自己核对的话，都在这个文件里：
`K4-ULTRA-main/resources/app/build/kitten.822d814413fb10654fde.js`

| # | 内容 | 大约行号 | 方法名（用这个搜更可靠） |
| --- | --- | --- | --- |
| A | **保存函数**（写 `.bcm4` 的完整契约） | 10940~11016 | 搜 `broadcasts: V.e.get_save_data()` |
| B | **保存前删孤儿** | 11301~11352 | `function ce(e)` |
| C | **广播的存储与扫描** | 29292~29332 | `get_broadcasts_from_json` / `get_save_data` / `remove_unused_broadcasts` |
| D | 清除无用广播的调用点 | 67556 | 搜 `remove_unused_broadcasts()` |
| E | **块图反序列化（两遍连接）** | 121982~122020 | `json_to_workspace_headless` |
| E2 | 单个块的反序列化 | 121933~121968 | `json_to_block_headless` |
| F | **字段解析（NUM/TEXT、constraints）** | 121937~121968 | `parse_block_data` |
| G | 字段校验器语义 | 76302~76307 | `call_validator` |
| H | workspace 构造（含 `scope`） | 128178, 128507 | 搜 `this.entity_id = t, this.scope = n` |
| I | id 重生成（复制粘贴用） | 122070~122082 | `reset_element_ids` |
| J | 注释反序列化 | 121972~121981 | `json_to_comment_headless` |
| K | 默认文档模板（官方 schema） | 135348~135385 | 搜 `stage_type: E.StageType.Vertical` |

## 用这份索引能自己查什么

- **想确认某个字段是不是"官方承诺的"** → 去 A 看它有没有在保存函数的返回里
- **想知道某个字段能不能忽略** → 去 F/H 看它是喂给编辑器的还是喂给运行时的
- **想理解某个连接异常** → 去 E 看官方的两遍连接逻辑和错误处理
- **想确认某类积木的字段名** → 去 F 看 `parse_block_data` 怎么读 `fields`

