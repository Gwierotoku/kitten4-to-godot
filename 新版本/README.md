# 新版本 — Kitten4(.bcm4) → Godot 4 转换器

按《全意义转换-设计规范》重做的转换器。**架构：积木 = 角色类中文方法，控制流 = 生成代码，事件 = 帽子节点。**

> **职责边界**：本工程只负责**项目结构转换 + 代码结构转换**。
> 积木方法的**具体功能实现**由用户在生成工程的 `全局/角色类.gd` 里填写。
> 转换器保证：结构正确、生成的项目能在 Godot 4 里打开、**0 error / 0 warning**、缺口表现为待填的桩。
>
> ⚠ **第九轮之后有一批架构级改动**（主场景变成 `全局/游戏屏幕.tscn`、切屏不换场景、
> 造型节点从"每造型一个 Sprite2D"改成"一个 AnimatedSprite2D"、列表初值 + 超长列表外置、
> 帽子屏幕生命周期……）。**旧产物请重新转换**，只重新导入是不够的。详见文末《第九轮之后》。

---

## 快速开始

**一条命令搞定（转换 + 资源导入 + 真跑 + 统计错误）：**

```powershell
cd 新版本
.\转换并验证.cmd "..\kitten示例项目\游戏-空白作品.bcm4" "_out\空白作品"
```

等价于：

```powershell
& powershell -NoProfile -ExecutionPolicy Bypass -File .\huanzhuang.ps1 `
    -Bcm4 '..\kitten示例项目\游戏-空白作品.bcm4' -Out '_out\空白作品'
```

只要转换，不要验证：

```powershell
$node = 'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
& $node convert.js '..\kitten示例项目\新的作品.bcm4' '_out\新作品' --clean
```

> 资源导入必须跑够：265 个造型里有 165 个 SVG，光栅化慢，一次导不完。
> 判据是 **`.import` 文件数 == 素材文件数**（`huanzhuang.ps1` 会自动重试 3 遍）。
> 没导完就会在运行时刷 `No loader found for resource: ... .svg`。

---

## 目录

```
新版本/
├─ convert.js              CLI：.bcm4 -> Godot 工程
├─ lib/k4/
│  ├─ core.js              解析 + 反编译（含本版新增的修正，见下）
│  ├─ blocks.js            积木目录（来自旧版本）
│  ├─ methodtable.js       ★唯一上游：积木 -> 中文方法名 + 签名 + await
│  ├─ async.js             ★协程分析：扫 runtime 的 await 传染闭包（决定哪里该写 await）
│  └─ emit.js              生成器（帽子脚本 / 角色场景 / 屏幕场景 / 游戏屏幕容器 / 接口 / project.godot）
├─ runtime/                运行时库（GDScript，拷进生成工程）
│  ├─ 全局/角色基类.gd      状态 + 引擎胶水（k4_x/k4_y、_apply_transform、一步()、warp、造型表）
│  ├─ 全局/帽子基类.gd      + 帽子_*.gd（各事件触发；含屏幕限定与屏幕生命周期钩子）
│  ├─ 全局/游戏屏幕.gd      ★游戏屏幕容器：所有屏幕在树里，切屏只改 visible（见第十四轮）
│  ├─ 全局/全局变量.gd       画布调度.gd  广播总线.gd   （autoload）
│  ├─ 全局/大文本.gd        K4Text autoload：读 文本/*.txt 与 文本/列表N.txt（超长文本/列表外置）
│  ├─ 全局/屏幕绘制.gd       每屏幕一份的画布节点
│  ├─ 全局/声音侦测.gd      K4Voice autoload：麦克风响度（声音侦测积木用）
│  └─ 模板/角色类.gd        ★用户写实现的地方，转换器永不覆盖
└─ _dev/                   开发工具与验证资产（说明见 _dev/README.md）
   ├─ vocab.js             反编译器词表提取 + 真实用量统计 + 映射表缺口检查
   ├─ regress.ps1          ★四样本完整回归（新的作品 / 射击生存 / 空白作品b / 切屏测试）★
   └─ *_check.gd|tscn      专项验证脚本（按键 78/78、画笔、印章、屏幕、广播、造型…）
```

---

## 本版相对旧版本修正的 4 个核心问题

| # | 问题 | 后果 | 修正 |
|:-:|:---|:---|:---|
| 1 | `parseProject` 读的是 `raw.variable` / `raw.list`，而 K4 的真实键是 **`variables`**（列表是 `type==="list"` 的条目，没有独立 list 表） | **变量名从未解析成功**，生成代码里全是 uuid | 改读 `raw.variables` + `current_entity`/`is_global` 判归属。19MB 样本：**768 处 `ref` 全部解析成中文名**（166 变量 + 26 列表） |
| 2 | 反编译器对没有专用分支的积木直接 `{k:'unknown_stmt', type}` —— **丢掉全部输入** | 19MB 样本 **130 条语句**变成 TODO 占位，转换事实上有缺口 | 新增 `Decompiler.stubStmt()`：带全部 `inputs` + `fields` 交给下游「类型层方法表」，落地成**桩方法调用**。缺口从"丢失的代码"变成"待填的桩" |
| 3 | IR 里到处散落裸 uuid | 不可读、不可反查 | 新增 `resolveIRNames()` 全树回填（`names.any` 合并索引） |
| 4 | 取值类积木的 `k/op` 词汇与 `blocks.js` 目录名**不是同一套** | 映射表对不上 | 分三层：`IR_METHODS`(语句 k) / `OP_METHODS`(取值 op) / `TYPE_METHODS`(块类型·桩)，前缀族（`cmp_*` / `math_*` / `is_*` / `coord_*`）在生成器里归一 |

---

## 生成工程的形态

```
project.godot                     autoload(K4Global/K4Bus/K4Canvas/K4Text/K4Voice/K4Timer) + 主场景=全局/游戏屏幕.tscn + 60Hz
全局/
  游戏屏幕.tscn                   ★主场景：所有屏幕场景按 K4 顺序实例进来，只显示当前屏幕
  游戏屏幕.gd                     容器脚本：登记屏幕 + 切到第一个屏幕
  角色基类.gd                     库（带版本号覆盖）
  角色变量.gd                     生成：变量 / 列表成员声明（每次覆盖）
  角色自带积木.gd                 生成：自带积木的桩（每次覆盖）
  角色自定义积木.gd               生成：K4 自定义积木的真实现（每次覆盖）
  角色类.gd                       ★你写实现，永不覆盖
  全局变量.gd / 广播总线.gd / 画布调度.gd / 大文本.gd / 声音侦测.gd / 计时器.gd / 大文本.gd
  积木映射.json                    调试反查表（改名 / 桩 / 未映射 / 实参不匹配 / 实参类型转换 / await声明不一致）
屏幕X/
  屏幕X.tscn / .gd                _ready 里向 K4Global 登记自己（切屏只改 visible，不换场景）
  屏幕绘制.gd                     画布（第一个子节点 → 画在角色后面）
  角色custom/<演员>/<造型>.png
  <演员>/<演员>.tscn / .gd        customs = 一个 AnimatedSprite2D（SpriteFrames 每造型一帧）
  <演员>/<帽子名>_N.gd            （点击帽子额外带 .tscn = Area2D + CollisionPolygon2D）
  <演员>/预备块.gd                悬空块备份，不挂载（见《悬空块备份》）
  <演员>/文本/N.txt               >1024 字的字符串外置在这里；列表初值外置叫 列表N.txt（JSON）
```

角色场景里的 `customs`（造型）长这样 —— **一个节点代替以前的"每造型一个 Sprite2D"**：

```
<演员> (Node2D + <演员>.gd)
  └─ customs (AnimatedSprite2D)     sprite_frames = SubResource(SpriteFrames)
                                     frame = 当前造型序号；position = 该造型的 pivot 偏移
  └─ <帽子名>_N (Node2D + 脚本)
```

各造型的 pivot 偏移不在场景里（SpriteFrames 存不下），由角色脚本的两张表提供：
`_造型顺序()`（帧号 → K4 造型名）与 `_造型偏移()`（帧号 → Vector2），切造型时由 `角色基类._应用造型()` 套到 `customs.position` 上。

继承链（全部角色共用一个类，逐层可整体替换）：

```
角色基类  →  角色变量  →  角色自带积木  →  角色自定义积木  →  角色类  →  <角色名>.gd
```

生成的帽子脚本长这样：

```gdscript
# K4-GENERATED  角色=玩家  事件=当开始被点击时  hat=bDzm...
extends 帽子_开始

func _积木主体() -> void:
    var ctx := 角色.新建上下文()
    while true:
        # 原积木: 下一个造型
        角色.下一个造型()
        # 原积木: 等待_秒
        await 角色.等待_秒(ctx, 0.2)
        await 角色.一步(ctx)
```

---

## 已跑通的

| 样本 | 结果 |
|:---|:---|
| `新的作品.bcm4`（190 KB） | 1 屏幕 / 1 角色 / 2 帽子 / 6 造型，34 文件，0.2 MB，160 ms |
| `游戏-空白作品.bcm4`（19 MB） | 1 屏幕 / 37 角色 / 58 帽子 / 266 造型，422 文件，1.86 MB，13 s，**未映射词条 0** |

---

## 最终状态（第八轮结束时）

| 检查项 | 结果 |
|:---|:---|
| `新的作品.bcm4`（190 KB）转换 + 导入 + 真跑 300 帧 | **stderr 0 行 → 0 error / 0 warning** ✅ |
| `游戏-空白作品.bcm4`（19 MB）转换 + 导入 + 真跑 300 帧 | **stderr 0 行 → 0 error / 0 warning** ✅ |
| 19MB 工程规模 | 1 屏幕 / 37 角色 / 58 帽子 / 266 造型 / 422 文件 / 2.14 MB |
| 资源导入 | 265/265 全部有 `.import` |
| 未映射词条 | **0** |
| 变量名解析 | 768/768 处引用都是中文名（旧版全是 uuid） |

### 帽子主体修复（重要）

此前 26 个帽子生成出来是空壳。原因：**很多帽子的主体挂在「语句输入」`DO`/`STACK` 上，而不是 `next` 链上**，
而原代码只读 `next`。修好后仅剩 2 个真正为空的帽子（K4 源文件里本来就是空的）。
条件帽子同时补上了 `_条件()`（由 `当满足条件` 的布尔输入生成）。

### 造型显示策略

K4 里一个角色**同时只显示当前造型**。所以生成的 `.tscn` 里：
**K4 记录的当前造型 `visible = true`，其余全部 `visible = false`**。

- 这样编辑器里打开是正常的、能看
- 切换造型的逻辑交给你的 `角色类.设置造型/下一个造型`（把对应 Sprite2D 的 `visible` 打开即可）
- 如果你想要"默认全部隐藏、完全自己管"，把 `emit.js` 里
  `props.push('visible = ' + (c.name === 当前造型 ? 'true' : 'false'))` 改成恒 `'false'` 即可

> **不建议用 TabContainer**：它是 `Control` 节点，而角色树是 `Node2D`，
> 塞进去会引入布局/坐标两套体系，位置和缩放都得再翻译一次，得不偿失。

---

## 自定义积木（K4 函数）—— 已生成真实主体

**K4 的自定义积木是全局的**：即使在某个角色上定义，任何角色都能调用。
所以它们全部生成到 `全局/角色接口.gd` 的同一个类里（`角色类.gd` 里仍可覆写）。

生成形态：

```gdscript
func 偏移坐标角度(ctx: 角色基类.WarpCtx, 偏移X: Variant, 偏移Y: Variant) -> Variant:
    var 角色 := self        # 过程体以「调用者」身份运行（K4 语义）
    if 角色.是否判断("positive", 偏移X):
        if 角色.是否判断("positive", 偏移Y):
            return 角色.算术运算("op", 角色.数学函数("atan", 角色.算术运算("op", 偏移Y, 偏移X)), ...)
        elif 角色.是否判断("negative", 偏移Y):
            return ...
        else:
            return 0.0
    ...
    return null        # K4 过程可能没有显式 return
```

### 关于「角色上的函数引用了角色变量」

你提的那个问题，处理方式是这样的：

- **K4 的真实语义**：过程体是**以调用者的身份**运行的 —— 跨角色调用时，过程里的
  局部变量会按**调用者**的实体去解析。所以「定义在 A 上、引用了 A 的局部变量」的函数，
  被 B 调用时在 K4 里就会报错。
- **我们的生成方式**：`var 角色 := self` —— `角色` 指向**正在运行的那个角色**，
  与 K4 完全一致。于是：
  - 同一个角色自己调用 → 正常读写自己的局部变量 ✅
  - 别的角色调用 → `get("v_某变量")` 拿到 `null`（Godot 对不存在的属性返回 null，**不崩**），
    比 K4 的"直接报错"宽容一点，但不会静默改错数据
  - 如果那个变量其实是全局变量 → 走 `K4Global.取值(...)`，任何角色调用都正确 ✅
- 名字冲突也已挡住：过程名/参数名都会过 `GD_KEYWORDS` 表（`pass` → `积木_pass`），
  参数名参与保留字判定，不会和局部变量撞（否则 Godot 报 `The member X already exists in parent class`）。

### 协程判定（很重要）

含循环 / 等待类积木的过程**编译出来是协程**，调用点必须 `await`，否则 Godot 直接报
`Function X() is a coroutine, so it must be called with "await"`。

生成器会**深扫过程体（含表达式里的嵌套调用、含跨过程递归，带环守卫）**算出
`是否需要 await`，然后在**语句位置和取值位置都**按需加 `await`：

```gdscript
elif await 角色.可获得buff(ctx, 编号, buff, 角色.算术运算("op", 层数, 30.0)):
角色.列表添加("n0", await 角色.生成敌人数据(ctx, X, Y))
```

---

## 生成代码风格：按 Godot 的写法来

### 变量 / 列表 —— 直接成员访问

```gdscript
K4Global.角色buff = ""                          # 全局变量（autoload 上的真实成员）
K4Global.HP = (K4Global.生命 * 角色.生命上限倍率(ctx))
角色.X偏移 = ((角色.随机整数(-100.0, 100.0) / 1000.0) / 9.0)   # 角色局部变量
while not (K4Global.伤害数字.size() <= 0.0):      # 列表直接用 Array 的 API
```

不再有 `角色.取值("X")` / `角色.设置变量("X", v)` / `K4Global.列表("伤害数字")`。

**局部变量声明挪到了 `全局/角色接口.gd`**（所有角色共用一个类）。原因：生成代码写
`角色.X偏移`，而 `角色` 的静态类型是 `角色类`；成员若声明在派生的 `<角色名>.gd` 里，
Godot 静态检查会报"找不到成员"。每个角色实例各有一份，互不影响；
各角色自己的初值由 `<角色名>.gd` 的 `_ready()` 赋。

变量一律声明成 `var X: Variant = 0` —— K4 是动态类型，让 GDScript 从初值推断类型会造成
`Invalid operands "String" and "float" for "<="` 这类**解析期**错误。

### 基础运算符 —— 内联

| K4 积木 | 生成 |
|:---|:---|
| 加/减/乘/除 | `(a + b)` `(a - b)` `(a * b)` `(a / b)` |
| 幂 | `(a ** b)` |
| 取余 | `fmod(a, b)`（Godot 的 `%` 只吃整数，K4 是浮点语义） |
| 取反 | `(-x)` |
| 与/或/非 | `(a and b)` `(a or b)` `(not x)` |
| 比较 | `(a > b)` `(a <= b)` … |
| 是倍数 | `(fmod(a, b) == 0.0)` |
| 连接 | `(str(a) + str(b))` |
| 转文本/转数字 | `str(x)` / `float(x)` |
| 文本长度 | `str(x).length()` |
| 列表长度/为空/包含/第几项 | `x.size()` / `x.is_empty()` / `x.has(v)` / `(x.find(v) + 1)` |
| 列表添加/清空 | `x.append(v)` / `x.clear()` |

### 唯一必要的例外：K4 弱类型比较

K4 里 `"5" = 5` 为真、`"" = 0` 为真；GDScript 碰到这种会**运行期报错**
（`Invalid operands 'String' and 'float' in operator '=='`）。

所以规则是：

- **两侧都是动态值（Variant）** → 内联原生运算符（最常见，代码干净）
- **一侧类型静态已知、且与另一侧不一致**（例如 `按键 == 0.0` 里的字符串参数、
  `"player" == 5392386` 这种字面量比较）→ 退回语义函数：

  ```gdscript
  角色.等于(按键, 0.0)          # 内部就是 比较("eq", a, b)，按 K4 规则先试数值再试文本
  角色.大于(K4Global.HP, 0.0)
  ```

- 条件位置同理：K4 里 `"computer"` 也是真，而 GDScript 的 `if` 只吃 bool
  → 生成 `if 角色.为真("computer"):`

这 8 个函数（`为真`/`等于`/`不等于`/`小于`/`小于等于`/`大于`/`大于等于`/`比较`）
实现在 `runtime/全局/角色基类.gd`，属于引擎胶水，你可以直接改。

---

## 已知待办（第八轮时；**以文末《已知待办（更新）》为准**）

- [x] ~~自定义积木（K4 函数）目前只生成**签名 + 桩**~~ → **已生成真实主体**（19MB 工程：27/28 有主体，1 个在 K4 源里本来就是空函数）
- [x] ~~接口参数类型统一放宽成 `Variant`（`ctx` 除外）~~ → 改成了**生成期实参类型校正**：
      按形参声明在生成期包 `角色.转文本()` / `角色.转数字()` / `角色.为真()`（见文末第十二轮）
- [ ] 掩码烘焙（碰撞 alpha 掩码 + 2px 采样）未开始
- [ ] 物理等 54 个类型层方法全是桩（按设计，等你在 `角色类.gd` 里填）；
      桩统一签名 `func 名(参数: Array) -> void`
- [ ] `tell/tell_sync`（告诉角色执行…）：调用点已生成（`角色.找("目标").过程名(ctx)`），
      被登记的匿名过程也在过程表里；但其主体是否被 K4 存下来待验证
- [ ] 音频（`音频/<owner>/...`）已导出，但 `播放声音` 等方法还是桩

> 这一份是第八轮时的快照。之后又完成了几项（广播链修复、游戏屏幕容器 + 屏幕生命周期、
> 列表初值 + 超大列表外置、customs 改 AnimatedSprite2D、克隆体不响应运行组激活……），
> **最新清单看文末《已知待办（更新）》。**

---

## 验证时踩到的环境坑（都已内建规避）

1. **autoload 注册名必须是 ASCII** — 中文名会报 `Identifier not declared`
   （编辑器扫描不报，真跑就崩）。现用 `K4Global` / `K4Bus` / `K4Canvas`，**脚本文件名仍保持中文**。
2. **`int(null)` 在 Godot 4.7 会报** `Invalid call. Nonexistent 'int' constructor.`
   —— 桩方法默认返回 `null`。所以循环次数一律走 `range(角色.转整数(...))`。
3. **`--import` 要跑多遍**才能把 265 个造型（大量 SVG）全部导入。
4. **自定义积木名撞 GDScript 关键字会直接语法错**（实测 K4 里有个函数就叫 `pass`
   → `func pass(...)` → `Expected function name after "func"`）。
   现已加 `GD_KEYWORDS` 表，撞名自动改 `积木_pass`。
5. **`var ctx := 角色.新建上下文()` 推不出类型**（`WarpCtx` 是内层类）
   → 生成时显式标注 `var ctx: 角色基类.WarpCtx = ...`。
6. **素材文件名大小写不敏感去重**（`i.png` / `I.png` 在 Windows 上互相覆盖）。
7. **`.ps1` 要带 UTF-8 BOM**，否则 Windows PowerShell 5.1 按 ANSI 读，中文路径会乱码。

---

## 角色的初始状态（transform + 可见性）

K4 每个角色都记录了初始 `x / y / rotation / scale / visible`，现在会写进 `<角色名>.gd`：

```gdscript
func _ready() -> void:
    # K4 记录的初始状态（transform + 可见性）
    k4_x = -150.0
    k4_y = -260.0
    k4_direction = 90.0
    k4_size_percent = 50.0
    k4_visible = false
    初始化()
```

**必须在 `初始化()` 之前设** —— `初始化()` 末尾会调 `_apply_transform()` 把它们落到节点上。

同时修了 runtime 里三处：

| 问题 | 修正 |
|:---|:---|
| **`_apply_transform()` 定义了但从来没人调** | `初始化()` 末尾补上 |
| 方向换算写成 `rotation = -deg_to_rad(k4_direction)`，K4 方向 90（向右）会得到 -90°（向上） | 改成 `deg_to_rad(90.0 - k4_direction)` |
| `_对齐舞台层()` 把舞台层位置写死成 `Vector2(240,180)` | 改成 `get_viewport_rect().size * 0.5`，跟随工程实际舞台尺寸 |

> `rotation` 字段 4 个样本里全是 0。按 Pixi 约定它是**弧度**（0 = 向右），
> 换算公式 `k4_direction = 90 - rad_to_deg(rotation)`；非 0 的工程请实测确认。

---

## 测试用例（4 个，全部 0 error / 0 warning）

| 用例 | 大小 | 规模 | 结果 |
|:---|--:|:---|:---|
| `新的作品.bcm4` | 190 KB | 1 屏幕 / 1 角色 / 2 帽子 / 6 造型 | ✅ stderr 0 行 |
| `pec2txt-phi谱面转换器.bcm4` | 9 MB | 1 角色，纯运算循环 | ✅ stderr 0 行 |
| `游戏-空白作品.bcm4` | 18 MB | 37 角色 / 58 帽子 / 266 造型 / 27 自定义积木 | ✅ stderr 0 行 |
| `Phigros模拟器v2.5(编程猫版).bcm4` | **108 MB** | 79 实体 / 236 素材 | ✅ stderr 0 行 |

一条命令复验任何一个：

```powershell
cd 新版本
.\转换并验证.cmd "..\kitten示例项目\Phigros模拟器v2.5(编程猫版).bcm4" "_out\Phigros"
```

> 108MB 那个工程转换约 1~2 分钟，产物 ~100 MB；注意磁盘余量。

### 这两个新用例各暴露了一个真 bug

1. **Phigros 里有个自定义积木就叫 `初始化`** —— 和 `角色基类` 的方法撞名，生成出
   `Too few arguments for "初始化()" call`。
   → 现在 `BASE_METHODS`（基类已实现的 25 个方法名）也参与**保留字判定**：
   自定义积木会改名成 `积木_初始化`，变量名同样避开。

2. **Phigros 的造型叫 `标题(1)`** —— 生成器把它清洗成 `标题_1_` 做目录名，
   而 `convert.js` 用的是另一套清洗规则（保留括号），两边不一致 →
   `.tscn` 引用 `角色custom/标题_1_/标题.png`，文件却落在 `角色custom/标题(1)/`。
   → `convert.js` 现在直接调 `EMIT.sanitize()`，**两边共用同一套清洗**。

另外把两处"未知取值积木返回 `null`"改成返回 `0.0`（`null` 参与算术会报
`Invalid operands 'float' and 'Nil'`；而带注释的返回值一旦嵌进表达式就是语法错）。

---

## 多屏幕场景"损坏打不开"：节点名里有 `.`

Phigros 里 6 个 `.tscn` 在编辑器里打不开。根因：

**K4 的造型名带点**（`2.0小白点`、`2.0玩家`、`2.0fanhui`），而生成器直接拿造型名当
`Sprite2D` 的**节点名**。Godot 的节点名**不允许 `. : @ / " %`**，编辑器因此拒绝加载整个场景。

> ⚠️ 这个坑 headless 跑不出来：运行期 `ResourceLoader.load()` **容忍**非法节点名，
> 只有编辑器会拒绝。所以"跑起来 0 错误"不等于"编辑器能打开"。

修法：节点名走 `sanitize()`（`2.0小白点` → `n2_0小白点`，与角色目录名一致）+ 同名去重；
**K4 原名单独保留**用于「当前造型」的可见性比较。
`convert.js` 末尾也加了自检：任何 `.tscn` 出现非法节点名就报 error。

### 顺带补的两个校验（现已并入生成期自检）

| 校验 | 作用 |
|:---|:---|
| `.tscn` 静态校验 | 重复兄弟节点名、悬空 `ExtResource`、`ext_resource` 引用的文件是否存在、`parent` 路径是否已声明 |
| 节点名合法性 | 扫节点名里的非法字符（`.` `:` `@` `/` `"` `%` `[` `]`）与空名 |

> 这两项最早是独立的 `_dev/check_tscn.js` / `_dev/check_nodenames.js`；结论已经并进
> `convert.js` 末尾的**生成期自检**（发现非法节点名直接报 error），两个脚本在收尾清理时删掉了。
>
> 它们补的是验证流程的一个盲区：**平时的 headless 跑只加载主场景**，
> 其它屏幕的场景坏了根本发现不了。需要时也可以临时把一个"遍历 load 所有 .tscn"
> 的小脚本挂成最后一个 autoload 来实测（能 100/100 通过）。

### 屏幕切换（已实现）

K4 的「屏幕」就是 Godot 的一个场景 `.tscn`。转换器会：

1. 在 `全局/全局变量.gd` 里生成**屏幕表**（K4 原名 + 清洗后目录名都能查）：

   ```gdscript
   var 当前屏幕: String = ""
   const 屏幕表 := {
       "背景": "res://背景/背景.tscn",
       "背景(1)": "res://背景_1_/背景_1_.tscn",
       "背景_1_": "res://背景_1_/背景_1_.tscn",
       ...
   }
   func 屏幕路径(_名: String) -> String
   ```

2. 每个屏幕的 `屏幕X.gd` 在 `_ready()` 里记下自己：`K4Global.当前屏幕 = "背景(1)"`
3. 生成真正的跳转：

   ```gdscript
   角色.切换屏幕("背景(1)")        # 内部 get_tree().change_scene_to_file(...)
   if (角色.当前屏幕是("背景(1)")):  # check_screen
   ```

`切换屏幕` / `当前屏幕是` 实现在 `角色基类.gd`；`get_current_scene` 取值映射到 `K4Global.当前屏幕`。
`change_scene_to_file` 本身就是帧末执行的，旧树释放时协程随之结束，不需要额外兜底。

> **目标屏幕藏在哪**：K4 把目标屏幕名放在 `switch_to_screen` 的 `screen` 输入里，
> 而那是一个 `get_current_scene` 影子块，名字在影子的 `scene` 字段（uuid，已被回填成屏幕名）。
> 一开始只当成"当前屏幕"处理，Phigros 里 10 处跳转全变成重载当前屏幕；
> 现在优先读那个字段，得到 `切换屏幕("背景(1)")` / `("背景(2)")` / `("背景(3)")` / `("背景")`。

### 其余屏幕相关的桩

`fade_in` / `fade_out`（淡入淡出）现在读 K4 的 `time` 输入（`角色.淡入(ctx, 秒)`）；
`self_clear_effects`、`self_glide_coordinate`、`show_hide_variable`、`show_hide_list`
都有**具名方法**（不再报"未映射"），实现为空桩，等你在需要时补。

## 文本字面量变成 `0.0`：`math_number` 影子也能装文本

用户拿「大陆漂移学说」当新测试用例，发现：

```gdscript
if (角色.等于(K4Global.当前的地图, 0.0)):      # 原本是 <当前的地图 = "主界面">
```

而且同一个文件里 `文本包含(..., "选关")` 的字符串是**对的**、`等于(..., 1.0)`…`(54.0)`
这些**数字**也是对的 —— 只有**文本**的那几个变成了 `0.0`。

### 根因

原始积木是 `logic_compare`，右操作数是一个 `type="math_number"` 的影子，
但**字段名是 `TEXT`**：

```xml
<shadow type="math_number"><field name="TEXT">主界面</field></shadow>
```

K4 的 `math_number` 块/影子带 `allow_text="true"` —— **数字放 `NUM`，文本放 `TEXT`**，
它是同一个"数字积木"兼作文本输入用的。而我们的取值是：

```js
var raw = fieldOf(xml, 'NUM');
if (raw === null) raw = fieldOf(xml, 'TEXT');
return num(raw);            // ← 无条件 num()
```

`fieldOf(xml,'TEXT')` 明明拿到了 `主界面`，却被 `num()` 送进 `parseFloat` → `NaN` → **0**。

### 修法：按内容决定字面量类型（一处收口）

```js
Decompiler.prototype.数值或文本 = function (raw) {
  if (raw === null || raw === undefined) return num(0);
  var s = String(raw);
  if (s.trim() === '') return num(0);        // 空输入在 K4 里就是 0
  return this.isNumericText(s) ? num(s) : str(s);
};
```

三处 `math_number` 系取值全部改走它：

| 位置 | 原来 |
|:---|:---|
| `shadowValue()` 的 `math_number` 影子 | `num(fieldOf NUM ?? TEXT)` |
| `expr()` 的 `math_number` **块** | `num(F('NUM', 0))` |
| `expr()` 的 `shadow_number` / `controller_shadow` | 只读一个字段就 `num()` |

修完「大陆漂移学说」的 `当接收到广播_地图改变_4.gd`：

```gdscript
if (角色.等于(K4Global.当前的地图, "主界面")):
elif (角色.等于(K4Global.当前的地图, "排行榜")):
elif (角色.文本包含(K4Global.当前的地图, "选关")):
    if (角色.等于(K4Global.当前的地图, "选关1")):
        K4Global.教程文本 = "第一章·平原"
...
if (角色.等于(K4Global.当前的地图, 1.0)):      # 数字分支照旧正常
```

该文件里：带字符串的比较 **5** 处、带数字的 **54** 处、残留 `, 0.0)` 的比较 **0** 处。

### 顺手把「丢失检测」做成可信的工具

之前的探针把整个 `.bcm4` 都扫一遍，把 K4 自带的默认影子
（`123` / `abc` / `Hello` / `1,2,3,4`）全报成"丢失"，噪音太大。
`_dev/probe_reach.js` 重写成**从帽子块出发**按连接图走，并且：

- 只算**帽子块**能走到的东西（K4 的游离块/工具箱块同样没有 `parent_id`，
  按 `parent_id` 判断会把它们也当根）；
- **被真实连接覆盖的影子不算**（那时它只是没被用到的默认值）；
- `is_shadow` 的块只在被连接引用时才算；
- 报告里带上**挂在哪个块的哪个输入上**，直接给出定位。

以帽子块为根之后的结果：

| 用例 | 可达文本值 | 生成物里找不到 |
|:---|---:|---:|
| 新的作品 | 0 | 0 |
| pec2txt-phi谱面转换器 | 10 | **2** |
| 游戏-空白作品 | 113 | **0** |
| 大陆漂移学说 | 16 | **1** |

（空白作品从最初的 59 降到 **0**。）

### 还没解决的两个（同一类，位置已定位）

1. `音游谱面转换器 / 背景`：一个 `text_split`，它的 `TEXT_TO_SPLIT` 与 `SPLIT_TEXT`
   接的是**真实 text 块**（内容是带换行的多行串），生成物里找不到这两个串。
   > 后续追查发现**很可疑**：原始工程里只有 **1 个** `text_split` 块，
   > 生成物里却有 **18 处** `文本分割(...)` 调用（参数是 `(列表项, " ")` / `(str(nt1), "%")`
   > 这种看着完全合理的用法）。也就是说那 18 处**不可能**来自同一个块 ——
   > 那条"失踪的长串"更可能是 K4 里**没被使用的模板数据**，或者影子块 id 被复用。
   > 这一条需要你确认「那段 175\n bp … 的文本在 K4 里到底是干嘛用的」才能定论。
2. `大陆漂移学说 / 函数`：一个 `shadow_text` 的 `VALUE` 影子里是 **60+ 个 0** —— 
   ~~内容长得像数字，会被判成 0~~
   **已修**：用户确认它是**字符串**。见下面「按字段名判断类型」。

---

## 第二轮修正：`math_number` 影子按**字段名**判类型（不是按内容猜）

上一轮我用「内容像不像数字」（`isNumericText`）来决定字面量类型，这是**错的**。
用户给了 K4 截图作证：

```
如果 <存档 = 0> 那么
  设置变量 存档 的值为 "000000000000000000000000000000000000000000000000000000000000…"
```

唯一的可靠依据是**字段名**：K4 的 `math_number` 块/影子带 `allow_text="true"`，
**数字放 `NUM`，文本放 `TEXT`**。所以：

```js
Decompiler.prototype.影子取值 = function (xml) {
  var n = fieldOf(xml, 'NUM');
  if (n !== null) return num(n);                 // NUM 字段 = 数字
  var t = fieldOf(xml, 'TEXT');
  if (t === null) return num(0);
  if (String(t).trim() === '') return num(0);    // 空输入在 K4 里就是 0
  return str(t);                                 // TEXT 字段 = 文本
};
```

`math_number` 的块版本同理（看 `fields.NUM` / `fields.TEXT`）。
结果：`"0000…0"`（长度 269）原样出现在生成代码里。

---

## 第三轮修正：三个「只修了一半」和两个云变量 bug

用户让我把残留的两个也啃掉，过程中挖出 4 个新 bug：

### ① `shadow_text` 的取值被**提前返回**截胡

`expr()` 开头有一段提前返回：

```js
if (t === 'default_value' || t === 'shadow_number' || t === 'shadow_text' || ...) {
  if (t === 'shadow_text') return str(this.field(block, 'TEXT', this.field(block, 'VALUE', '')));
```

`shadow_text` 块**自己的 `fields` 是空的**，内容在它的 **`VALUE` 影子**里：

```json
{"type":"shadow_text","fields":{},"shadows":{"VALUE":"<shadow type=\"text\">…"}}
```

→ 两个字段都读不到 → 一律空串。用户报的
`设置 存档 的值为 "0000…0"` 变成 `""` 就是这里。

> ⚠ 我上一轮只改了 `switch` 里那个 `case 'shadow_text'` —— 而这段**提前返回先于 switch**，
> 那个 case 永远到不了。**改错地方了，所以看着"修了"其实没生效。**

### ② 影子块的「当前值」在 `blocks[影子id]` 里，不在 `shadows` 的 XML 里

K4 保存时：

| 存放处 | 内容 |
|:---|:---|
| `shadows[输入名]` 的 XML | **创建时的默认值**（编辑后不更新） |
| `blocks[影子id].fields` | **用户真正输入的值** |

实例（`pec2txt`）：`text_split` 的 `TEXT_TO_SPLIT` 影子
XML 里写的是默认的 `1,2,3,4`，而 `blocks[id].fields.TEXT` 才是真实的长串。
我们一直只读 XML → 拿到的是**默认值**。

修法：`input()` 返回 `rawshadow` 之前先看 `blocks[影子id]` 有没有值：

```js
var sid = attrOf(xml, 'id');
var sb = sid ? this.blocks[sid] : null;
if (sb && sb.is_shadow === true && isObj(sb.fields) && Object.keys(sb.fields).length > 0) {
  return { kind: 'block', id: sid, block: sb };     // 用真值
}
return { kind: 'rawshadow', text: xml };            // 退回 XML（有的影子 fields 是空的）
```

### ③ 云变量的名字没解析（裸 uuid 进了生成代码）

```gdscript
角色.云变量设置("n749e60b5_ad1b_4277_ab94_f372b923988b", …)   # 应该是 "存档"
```

`cloudVars` 在 `projectToIR` 里收集了，却**没注册进 `names` 表**。
补 `names.clouds` + 并入 `names.any`，两个云变量积木改走 `cloudName()`。

### ④ 同一个云变量，设置和取值用了两个名字

修完 ③ 之后：

```gdscript
角色.云变量设置("v_存档", …)      # 设置：走了 varRef → NameSpace 改名
角色.云变量取值("存档")            # 取值：表达式路径，用原名
```

对不上。云变量存在 `K4Global` 的**字符串表**里，不是 GDScript 成员，
所以 `emit.js` 里 `cloud_*` 的 name 参数**不该**走 `varRef`：

```js
if (/^cloud_/.test(k)) {
  argStrings.push(gdStr(String(stmt.name)));      // 直接用 K4 原名
} else {
  var rr = this.varRef(stmt.name, isList);
  argStrings.push(rr.target + '.' + rr.name);
}
```

修完：`云变量设置("存档", …)` / `云变量取值("存档")` / `云变量设置("星星排行榜", …)` 全部一致。

---

## 角色层再拆一层：变量 / 自带积木 / 自定义积木

用户要求把「全局变量和自带函数」也分开。现在继承链是**五层**（数据与行为彻底分离）：

```
角色基类              runtime/全局/角色基类.gd      引擎胶水 + K4 语义（库）
 └ 角色变量            全局/角色变量.gd              ★每次覆盖：变量 / 列表**成员声明**
    └ 角色自带积木      全局/角色自带积木.gd           ★每次覆盖：自带积木的桩
       └ 角色自定义积木  全局/角色自定义积木.gd         ★每次覆盖：K4 自定义积木真实现
          └ 角色类       全局/角色类.gd                ★你写的实现，永不覆盖
             └ <角色名>.gd
```

- **第一层是数据**：全部角色共用一个类，所以各角色的「局部变量 / 列表」必须声明在共同祖先上；
  但它和"自带积木的桩"混在一起时，想整体替换自带积木就得连变量表一起抄。
  分开之后 `角色变量.gd` 就是一份干净的"角色数据表"。
- `角色类.gd`（你的文件）的 `extends` **不用改** —— 它仍然指向 `角色自定义积木`，
  新增的一层在它上面。所以这次**不需要迁移任何用户文件**。

---

## 悬空块备份：`<角色>/预备块.gd`

K4 里会有**没连到任何事件上**的块（写了一半、换过一版、复制过来忘掉的），
它们不参与运行。用户指出：这类块里**可能有大量文本**
（例如 `175\n bp 0.000 185.000…` 那种音游谱面文件信息，"有时作为替换当前运行文本用的"）。

转换器**不把它们变成代码**（本来就不该跑），而是备份进
`<屏幕>/<角色>/预备块.gd`：

```gdscript
# K4-GENERATED  预备块（谱面转换器 的悬空块备份）
# ...
# ⚠ 本脚本**不挂载到任何节点上**（没有任何 .tscn 引用它），纯粹是个"备胎库"。
# 共 1 段。

# ── 1) 原块 id=9nYQwG8PCmFyu03O0WsX，共 4 字 ─────────────────────
const 预备文本_1 := """
line
"""
```

要点：

- **可达性判定**：从「帽子块 + 自定义积木定义块」出发走连接图（`connections` 全走、
  `parent_id` 子块跳过 `is_shadow`），取不到的才算悬空；
- **只收 `type === 'text'` 且 ≥ 16 字**的：K4 自带的默认影子（`123`/`abc`/`Hello`/`1,2,3,4`）
  满工程都是，收进来只是噪音（想全收把阈值改成 1）；
- 文本用 **`"""…"""`** 三引号包（用户建议），反斜杠和 `"""` 都做了转义；
- 这个脚本**不挂进任何 `.tscn`**，所以不会被执行、也不占运行开销；
- 本工程里目前没有符合条件的悬空块（那几个用例都是 0 段）——
  用阈值 1 做过端到端验证：能生成、Godot `--check-only` 语法通过。

---

## `局部列表` 与丢失的长文本：其实是**一个**块

用户看着 Godot 里的

```gdscript
# 原积木: 复制列表
角色.复制列表(角色.局部列表, 角色.局部列表)
```

指出「局部列表？是不是又有没匹配上问题，丢失的文本也是这个部分」——**完全正确，两个症状同一个根因。**

### K4 里它看着是一个块，其实是两层嵌套

K4 编辑器里显示：

```
复制 [ "175\n bp 0.000 185.000…" ] 按 [ "\n" ] 分开成列表 到 [ 输入 ]
```

拆开是：

```
外层 lists_copy:   复制 [ ⟨内层⟩ ] 到 [输入]      ← TARGET 是 lists_get 影子 = 列表「输入」
内层 text_split:         [文本] 按 [分隔符] 分开成列表
```

### 根因：用 `textish()` 去解析**表达式**

```js
var fromList = this.textish(this.valueAny(blockId, ['VALUE', 'VAR']));
var toList   = this.textish(this.valueAny(blockId, ['TARGET', 'LIST']));
```

`textish()` **只认字面量**（`k === 'lit'`），遇到任何表达式一律返回 `null`。而这里：

| 输入 | 实际是什么 | `textish` 结果 |
|:---|:---|:---|
| `VALUE` | `str_split(文本, 分隔符)` 表达式 | `null` |
| `TARGET` | `listref("输入")` 节点 | `null` |

→ 源和目标双双变空串 → `listName('')` 返回 `''` → emitter 的 `varRef('')` 兜底成 `局部列表`；
同时插在 `VALUE` 上的 `text_split` **连同那段 8MB 的谱面文本一起被丢掉**。

### 修法

`list_copy` 的 IR 从「两个列表名」改成「**目标列表名 + 任意值表达式**」：

```js
case 'lists_copy':
  return {
    k: 'list_copy',
    name: this.listArgName(blockId, block, ['TARGET', 'LIST', 'VAR']),   // 走 listref 解析
    value: this.valueAny(blockId, ['VALUE', 'VAR'])                      // ★保留表达式★
  };
```

配套：

| 位置 | 改动 |
|:---|:---|
| `methodtable.js` | `list_copy` → `复制列表(目标列表, 值)`，`ret` 从 `a` 改成 `void` |
| `emit.js` ARG | `list_copy: ['name', 'value']`（`name` 走 `varRef` 得到 `K4Global.输入`） |
| `角色基类.gd` | 新增 `复制列表(_目标, _值)`：就地 `clear()` + `append_array()`（Array 是引用类型，能改到 autoload 上那一份）；并登记进 `BASE_METHODS` |

修完：

```gdscript
角色.复制列表(K4Global.输入, 角色.文本分割("175\n bp 0.000 185.000\n n1 0 118.250…", "\n"))
```

### 顺带发现：那一行有 **800 万字符**

那个"长串"不是几十个字，而是**整个 8MB 的谱面数据**（`pec2txt` 的 .bcm4 一共才 9.07MB）。
生成出来就是**一行 800 万字符**的 GDScript —— Godot 能解析（`CHECK fail=0`），
但编辑器一打开那个脚本就卡死。

> 已修：超长文本现在外置成 `文本/*.txt` + `K4Text.读取("…")`，
> 那个脚本从 8,033,871 字节变成 **339 字节**。详见文末《超长文本外置到 `文本/*.txt`》。




---

## 报"场景似乎无效/损坏"：依赖场景少了 `parent="."`（这一轮的真正元凶）

用户说的「`背景_2_.tscn` 似乎无效/损坏」，根因不在 `背景_2_.tscn` 自己，而在它的**依赖**：

```
ERROR: Invalid scene: node 当角色被点击时_1 does not specify its parent node.
ERROR: Failed to load scene dependency: "res://背景_2_/设置_返回_1_/设置_返回_1_.tscn".
```

`设置_返回_1_.tscn` 第 23 行是：

```ini
[node name="当角色被点击时_1" instance=ExtResource("4")]      ← 没有 parent="."
```

Godot 认为这行是**第二个根节点**（一个 `.tscn` 只能有一个根），于是整个场景 invalid，
引用它的 `背景_2_.tscn` 跟着加载失败 → 编辑器弹"似乎无效/损坏"、屏幕进不去。

生成器里只有一条分支掉了 `parent`（`emit.js` 加帽子节点那段）：

```js
if (h.scene) {                                   // 带场景的帽子 = 点击帽子
  actorTscn.nodes.push({ name: h.name, inst: ... });              // ← 少了 parent:'.'
} else {                                         // 纯脚本帽子
  actorTscn.nodes.push({ name: h.name, type: 'Node2D', parent: '.', ... });
}
```

所以症状只在**有点击帽子的角色**上出现（Phigros 16 处，其它 3 个用例 0 处），
而且**角色自己那一层 `load()` 是成功的**，只有往外引用它的场景才炸 —— 特别难定位。

> 这一类错误 `load()` **永远发现不了**：Godot 的依赖场景是**延迟加载**的。
> 所以验证器现在除了 `load()` 还会 `instantiate()` 每一个 `.tscn`（编辑器打开场景
> 走的就是 instantiate）。另外 `convert.js` 加了静态自检：一个 `.tscn` 里
> 除第一条外任何 `[node ...]` 都必须带 `parent=`。

---

## 报"场景似乎无效/损坏"：解析期错误（同一轮的另一组，性质完全不同）

用户反馈三件事：

1. 控制台：`Failed to load script "res://背景_1_/设置_返回/当角色被点击时_1.gd" with error "Parse error"`
2. `背景_2_.tscn` 在编辑器里"似乎无效/损坏"
3. 场景 1 进不去、Node2D 角色的大小不对

### 根因 1：同一个方法名在两张表里，实参个数不一样（**真正的元凶**）

`停止计时器` 同时存在于两张表里：

| 表 | 位置 | 参数 |
|:---|:---|:---|
| `IR_METHODS`（`set_timer_state` → `k:'timer_stop'`） | 语句层 | **0 个** |
| `TYPE_METHODS`（块类型兜底桩） | 类型层 | **1 个**（`参数: Array`） |

- **调用点**按自己那张表补实参 → 生成 `角色.停止计时器()`（0 个）
- **接口文件**把同名方法合并后声明 → `func 停止计时器(_参数: Variant)`（1 个）

两边不一致，Godot 在**解析期**就报：

```
Parse Error: Too few arguments for "停止计时器()" call. Expected at least 1 but received 0.
```

`停止计时器` 是语句（引擎不会因为解析失败而跳过它），所以**整个脚本加载失败 →
引用它的 `.tscn` 也加载失败 → 编辑器弹"场景文件似乎无效/损坏"、"场景 1 进不去"**。
一个 0/1 的实参差，症状却是"场景损坏"。

**修法：把方法签名抽成唯一真源。** `emit.js` 新增 `buildSignatures()`：

- 把 `IR_METHODS` + `OP_METHODS` + `FAMILY_METHODS` + `TYPE_METHODS` 按**方法名**合并；
- 实参个数取**各表最大值**，同一位置类型不一致就放宽成 `Variant`；
- **接口文件的声明**和**每个调用点的补/截实参**都读这同一张表 → 结构上不可能再不一致。

另外补了一条硬约束：**类型层桩的方法名不能和 IR/OP 方法同名**。桩的调用形态是
`角色.名([...])`（恰好 1 个 Array 实参），IR/OP 是 `角色.名(逐个实参)` —— 同名就是抢签名。
现在 `renamedStubNames()` 会自动把撞名的桩改成 `名_桩`，并记进 `积木映射.json` 的 `桩改名`。
（`fade_in` / `fade_out` / `timer_stop` 三条陈旧的重复条目已从 `TYPE_METHODS` 删掉。）

### 根因 2：参数被"补齐" vs 被"截断"

`call()` 一直有个自动补齐/截断。**补齐**（K4 空输入 → 默认值）是无害的；
**截断**是**真的把实参丢了**，属于方法表写少了。现在：

- 参数元组可以带第 3 项当补齐默认值（`['次','v','2.0']`），补齐不再一律给 `0.0`；
- 截断单独记进 `report.argLoss`，`convert.js` 把它升级成 **✗ 错误**（不再只是 warning）。

顺手修掉两处真实的丢参：

| 方法 | 原声明 | 实际 | 修法 |
|:---|:---|:---|:---|
| `复制列表` | 1 个（列表） | `from`/`to` 2 个 | `params: [源列表, 目标列表]` |
| `列表删除_特殊` | 2 个（列表, 值） | `name`/`index`/`where` 3 个 | `params: [列表, 序号, 方式]` |

以及 `询问并选择`：`ARG` 表里写的是 `['args']`，而 IR 节点上根本没有 `args` 字段，
生成的是 `角色.询问并选择(ctx, 0.0, 0.0)` —— **问题和选项全丢**。现在走专门分支，
生成 `await 角色.询问并选择(ctx, <问题>, [<选项0>, <选项1>])`，并带上可能的子栈。

### 根因 3：验证流程有个**大盲区**（这才是它一直没被发现的原因）

`huanzhuang.ps1` 原来是"跑 300 帧 + 数 stderr"。问题是：

- **跑主场景只加载主场景那一棵树** —— 别的屏幕/角色脚本里的解析错误一个都看不到；
- `--check-only --script` 模式**不注册 autoload**，`K4Global`/`K4Canvas`/`K4Bus` 全部
  `Identifier not found`，检查结果全是假的（踩过这个坑）。

所以现在多了一步 **`=== 4/5 full parse check ===`**：把 `_dev/check_all.gd` 拷成
工程根目录的 `_检查.gd`（配 `_检查.tscn`），**当场景跑**（这样 autoload 正常注册），
在 `_ready()` 里 `load()` 掉每一个 `.gd` 和每一个 `.tscn`，然后删掉临时文件。

判定看两样：

- 脚本里的 `print("FAIL_SCRIPT …")` / `CHECK scripts=N scenes=M fail=K`；
- stderr 里的 `Parse Error|Compile Error|Failed to load script|Invalid`。

> 注意：**解析失败的 GDScript 依然会返回一个资源对象（不是 null）**，
> 所以 `load()==null` 判不出来，要配合 `can_instantiate()` 和 stderr 一起看。
> 另外 `ResourceLoader.load(..., CACHE_MODE_IGNORE)` 会**死锁**，别用。

### 根因 4：舞台尺寸被硬编码成 480×360，而且缩放挂错了节点

「Node2D 角色的大小不对」是两个独立的错：

**(a) 每个 K4 工程有自己的舞台尺寸**，就存在 `.bcm4` 的顶层 `size` 字段：

| 用例 | `size` |
|:---|:---|
| 新的作品 | 620 × 900（竖屏） |
| 游戏-空白作品 | 960 × 720 |
| pec2txt-phi谱面转换器 | 960 × 720 |
| Phigros模拟器 | 1280 × 720 |

转换器**已经**把它写进 `project.godot` 的 `display/window/size/viewport_*`
（配合 `stretch/mode="canvas_items"` + `aspect="keep"`，引擎负责等比缩放加黑边）。
所以「舞台坐标系 == 视口坐标系」，原点在舞台左上角。

**(b) 但 `屏幕绘制.gd` 自己又在乱缩。** 它原来有：

```gdscript
var 系数 := maxf(视口.x / 480.0, 视口.y / 360.0)   # ← 480x360 是硬编码
scale = Vector2(系数, 系数)
```

两个错叠在一起：

1. `480×360` 是 K4 的默认尺寸，不是本工程的尺寸（Phigros 是 1280×720）；
2. **Node2D 的 transform 只影响子节点，不影响兄弟节点**。`屏幕绘制` 是
   「基础角色层」的**兄弟**，把它自己放大，角色根本不会跟着放大 ——
   结果背景板被拉大、角色保持原样，看起来就是"角色大小不对"。

修法：`屏幕绘制` 只负责在 `(0,0)`、`scale = 1` 处按舞台坐标画，
舞台矩形直接用 `get_viewport_rect().size`（= K4 舞台尺寸）。
缩放的活交给 `project.godot` 的 stretch 设置，只有一处真源。
`角色基类._对齐舞台层()` 仍然是 `视口 * 0.5`（= 舞台中心），这个本来就是对的。

> 顺带把画笔坐标也接对了：K4 坐标（原点居中、y 向上）→ 舞台坐标（原点左上、y 向下）
> 走 `角色基类.k4到舞台()`。以前画布既被缩放、又没做原点换算，两层错。

### 根因 5：K4 的计时器有三种状态，被压成了两种

`set_timer_state` 的 `actions` 字段在 4 个样例里只出现过 `start` / `stop` / `reset`，
但原来的映射是 `stop → 停止计时器`、**其余全 → 重置计时器** —— `start` 和 `reset` 撞在一起。
现在三条 IR 各自对应一个方法，实现在 `角色基类.gd`（都在 `BASE_METHODS` 名单里，
所以不会在 `角色接口.gd` 里再声明一遍桩）：

```gdscript
var k4_timer_running: bool = true
func 计时器() -> float
func 开始计时器() -> void      # 继续走
func 停止计时器() -> void      # 冻结
func 重置计时器() -> void      # 归零
```

### 关于「Node2D 角色的大小」还给用户留的活

转换器只保证**坐标系和舞台尺寸正确**：角色 `position = (k4_x, -k4_y)`、
`rotation = deg_to_rad(90 - k4_direction)`、`scale = k4_size_percent / 100`。
造型本身按图片原始像素尺寸显示（`Sprite2D` 默认 `centered = true`，与 K4 中心锚点一致）。
如果某个造型在 K4 里显示得更大/更小，那是造型锚点或「大小」字段的语义差异，
在 `角色类.gd` 里覆写 `_apply_transform()` 或按造型调 `scale` 即可。

---

## 编辑器里也能看到正确排版（把初始 transform 烘进 `.tscn`）

**问题**：`初始化()` / `_apply_transform()` 只在运行时跑，编辑器不执行 `_ready()`。
所以初值只写在 `<角色名>.gd` 里的话，编辑器 2D 视图里：

- `基础角色层` 贴在 `(0,0)`（运行时它会被挪到舞台中心）；
- 每个角色都在 `(0,0)`、大小全是 100% —— 排版完全看不出来。

**修法**：转换器把这些初值**同时写进 `.tscn` 的节点属性**。
运行时那套一行没动（它照旧覆盖一遍），两边用的是**同一组公式 + 同一个取数函数**，
所以编辑器里看到的就是运行时的排版。

`背景.tscn`（空白作品，舞台 960×720）现在长这样：

```ini
[node name="基础角色层" type="Node2D" parent="."]
position = Vector2(480.0, 360.0)          # = 舞台中心，运行时 _对齐舞台层() 设的是同一个值

[node name="背景" parent="基础角色层" instance=ExtResource("3")]
position = Vector2(0.0, 0.0)              # 舞台本身 K4 坐标 (0,0) = 舞台中心

[node name="角色" parent="基础角色层" instance=ExtResource("5")]
position = Vector2(0.0, 0.0)
scale = Vector2(0.2, 0.2)                 # k4_size_percent = 20
visible = false                           # K4 里初始隐藏

[node name="WSAD" parent="基础角色层" instance=ExtResource("14")]
position = Vector2(-360.0, 260.0)
scale = Vector2(0.5, 0.5)
```

要点：

- `.tscn` 是 **Variant 解析器**，属性值只能是字面量 —— 不能写 `deg_to_rad(...)`。
  所以 `rotation` 在生成器里就先算成弧度，且只在非 0 时才写（省得每个节点都带一行）。
- `visible` / `scale` / `rotation` 只在**不等于默认值**时才写，文件干净。
- 数值统一走 `k4Number()`：K4 存的是 float32，读出来常带 `5.68e-14` 这种噪声，
  一律归零并收到 7 位有效数字。`.gd` 里的初值和 `.tscn` 里的属性**走同一个函数**，
  保证两边数值一模一样（以前 `.gd` 里会出现 `k4_x = -3.0888045e-06`）。

> 注意：这里烘的是**K4 记录的初始值**，不是"最终位置"。
> 大多数角色在 K4 里初始就是 `(0,0)` + 隐藏，靠脚本在运行时摆 ——
> 所以编辑器里看到它们叠在舞台中心是**正确的**，不是 bug。
> 打开 `背景.tscn` 后按 `F`（聚焦选中节点）即可定位到舞台。

### 积木映射修正：`self_go_forward` 不是「移到图层」

用户对照 K4 编辑器发现对不上：K4 里舞台（`背景`）的脚本是
「当开始被点击 / 重复执行 / **移动 -2 步**」，生成的却是 `角色.移到图层(1.0)`。

**原始积木（`新的作品` 的舞台，一共就 4 个块）**：

```
start_on_click → repeat_forever → self_go_forward(steps = -2) + math_number(-2)
```

对得上：`self_go_forward` 就是「移动 N 步」，输入名是 **`steps`**（普通数值输入）。
而真正的图层块是 `self_change_layer`（字段 `n`）和 `set_layer` / `set_theatre_layer`
（字段 `layer`，取值 top/peak/front/前）—— 两者完全不同。

错在两处（同一个错误认知）：

| 文件 | 原来 | 现在 |
|:---|:---|:---|
| `core.js` 的 IR 分支 | `case 'self_go_forward': return {k:'layer', dir:1}` | `return {k:'move_steps', steps:A('steps')}` |
| `blocks.js` 别名表 | `add(['self_go_forward','self_go_backward'],'looks','layer','C')` | `add([...],'motion','move_steps','C')` |

`self_go_backward`（后退 N 步）没有样例用到，按对称性映射成
`{k:'move_steps', steps: op('neg', [步数])}` —— **这一条是推断，未经样例验证**。

修正后 4 个用例的调用点：

| 用例 | `角色.移动_步` | `角色.移到图层` |
|:---|---:|---:|
| 新的作品 | 1 | 0 |
| 音游谱面转换器 | 0 | 0 |
| 游戏-空白作品 | 5 | 0 |
| Phigros模拟器 | 38 | 0 |

**共 44 处**以前被静默吞掉的移动，现在都是真调用点了。

> ⚠ 映射对了 ≠ 能动了：`移动_步` 在 `全局/角色接口.gd` 里还是 `pass` 桩
> （它不在 `BASE_METHODS` 里）。要在 `全局/角色类.gd` 里填真实现，
> 模板注释里已经给了现成的三行：
>
> ```gdscript
> func 移动_步(步数: float) -> void:
>     k4_x += 步数 * cos(deg_to_rad(k4_direction))
>     k4_y += 步数 * sin(deg_to_rad(k4_direction))
>     _apply_transform()
> ```

### 本轮验证结果（4 个用例）

`转换并验证.cmd` 现在有 5 步，第 4 步是新增的全量解析检查：

| 用例 | scripts | scenes | parse fail | run stderr | 结论 |
|:---|---:|---:|---:|---:|:---|
| 新的作品 | 24 | 4 | 0 | 0 | ✅ |
| pec2txt-phi谱面转换器 | 24 | 4 | 0 | 0 | ✅ |
| 游戏-空白作品 | 116 | 40 | 0 | 0 | ✅ |
| Phigros模拟器 | 255 | 101 | 0 | 0 | ✅ |

（`scenes` 含检查器自己的 `_检查.tscn`，所以比实际屏幕场景多 1。）

另外用**编辑器模式**逐个打开此前报损坏的场景，全部 0 错误：

```
res://背景_2_/设置_返回_1_/设置_返回_1_.tscn  ->  0
res://背景_2_/背景_2_.tscn                    ->  0
res://背景_1_/背景_1_.tscn                    ->  0
（空白作品）res://背景/背景.tscn               ->  0
```

并且确认了检查器**真的能抓到**这类错误：往工程里塞一个故意缺 `parent=` 的场景，
检查器立刻报 `FAIL_INSTANTIATE res://_坏场景.tscn` / `CHECK … fail=1`。

### ⚠ 一个还没验证过的公式：`rotation`

4 个 K4 样例里所有角色和舞台的 `rotation` 字段**全是 0**
（烘出来 `tscn rotation=0` 行、`.gd` 里也没有非 90 的方向）。
所以这条链一直是"能编译、没被检验"的状态：

```
k4_direction   = 90 - rotation(弧度) * 180 / PI
Godot rotation = deg_to_rad(90 - k4_direction) = rotation(弧度)
```

也就是说：**我们假设 bcm4 的 `rotation` 字段就是弧度，且 K4 的 0 度朝上**。
如果你想确认，随便做个 K4 作品把某个角色转个 45°，转过来看一眼就知道 ——
要是不对，改 `core.js` 的 `k4Direction()` / `emit.js` 的 `actorInitProps()` 一处即可
（`.gd` 和 `.tscn` 两边都从这里取数）。

### 如果你在编辑器里还看到旧的坏场景

`转换并验证.cmd` 是 `--clean`（整个输出目录先删再建），所以磁盘上的文件一定是最新的。
但**编辑器还开着删除前的旧场景**，内存里那份是坏的。处理办法：

1. 关掉 Godot 编辑器（或在编辑器里 `项目 → 重新加载当前项目`）；
2. 保险起见删掉 `<输出目录>/.godot/`（导入缓存 + 脚本类缓存），重新打开工程。

> 判断依据：如果在编辑器场景树里看到带 `.` 的节点名（例如 `n2.0小白点`），
> 那就是**旧一轮**的产物 —— 现在的转换器输出的是 `n2_0小白点`。

---

## 字面量凭空消失：`A('X') || A('Y')` 从来没生效过

用户报「`等于(K4Global.当前的地图, 0.0)`，原本应该是 `"主界面"`」。
一查不是个例，是**一整类**静默 bug。

### 根因 A：`||` 是死代码

反编译器取输入的写法长期是这样：

```js
op('str_contains', [A('VALUE') || A('STRING') || A('A'), A('FIND') || A('B')])
```

而 `A()`（= `value()`）在**输入不存在时返回 `num(0)`** —— 那是个**对象**，永远 truthy。
所以 `||` 后面的名字**一个都没试过**：第一个名字不对，整个取值就退化成 `0` / `""`。

修法：新增 `valueAny(blockId, names)`，**按实际存在的输入名**取第一个命中的：

```js
Decompiler.prototype.valueAny = function (blockId, names) {
  for (var i = 0; i < names.length; i++) {
    if (names[i] && this.model.input(blockId, names[i])) return this.value(blockId, names[i]);
  }
  return num(0);
};
```

### 根因 B：输入名对不上（Kitten4 和 Scratch 是两套名字）

| 块类型 | 我们读的 | 实际有的 |
|:---|:---|:---|
| `text_contain` | `VALUE` / `FIND` | **`TEXT1` / `TEXT2`** |
| `text_split` | `VALUE`/`TEXT_TO_SPLIT`/`SPLIT_TEXT`（3 个） | **`TEXT_TO_SPLIT` / `SPLIT_TEXT`（只有 2 个）** |
| `convert_type` | `VALUE` / `A` | **`original_value`** |
| `divisible_by` | `NUMBER` | **`NUMBER_TO_CHECK`** |
| `cloud_variables_set` | `value` / `n` | **`VALUE`** |
| `lists_get_value` | `index` / `A` | **`INDEX` / `ITEM`** |
| `lists_append`/`lists_delete`/`lists_insert_value` | `TARGET` | **`VAR`**（列表名的影子） |
| `lists_replace` | `ITEM` | **`VALUE`**（`ITEM`/`IS` 是恒为空串的影子） |
| `sync_tell` | `TARGET` | 目标在**字段 `sprite`** 里（实体 uuid） |
| `self_change_pen_color_property_2` | `value` | **`steps`** |

`text_split` 最严重：Kitten4 只有 2 个输入，我们按 Scratch 的 3 个名字取，
于是第 1 个位置恒为 0、剩下两个**整体错位一格** ——
生成 `文本分割(0.0, <文本>)`，**分隔符被当成文本用**。

### 根因 C：两类块被整体丢了内容

- **`shadow_text`**：文本内容在 **VALUE 影子**里（`<shadow type="text"><field name="TEXT">`），
  不在本块的 `fields` 上。原来读 `F('TEXT')` → 读不到 → 一律空串。
  空白作品里 394 个 `shadow_text` 全丢。
- **`stamp`**：Kitten4 的 `stamp` 是**文字图章**（`text` + `size` + `align`），
  不是画笔的「图章」。原来和 `pen_stamp` 一起映射成 `{k:'pen_stamp'}`，
  文本和字号全没了。现在有独立方法 `文字图章(文本, 字号)`。

### 加了一条自检：值输入名对不上就报 warning

`value()` 里现在会在「这个块明明有值输入、我们却问了一个不存在的名字」时记一条：

```
值输入名对不上: 块类型 text_contain 上不存在输入 "VALUE"，它实际有的是 TEXT2/TEXT1（该处取值会退化成 0）
```

跑 `node _dev/probe_inputnames.js` 一次就能把**全部**这类错误列出来
（不需要你告诉我是哪个作品、哪个积木）。修完后 4 个用例都是 **0 条**。

### 结果

| 指标 | 修前 | 修后 |
|:---|---:|---:|
| 输入名对不上（4 用例合计） | 74 条 | **0 条** |
| 空白作品的文本取值缺失 | 59 | **11**（剩下的都是 K4 里**没被用到的默认影子**） |

用户报的那类症状现在长这样：

```gdscript
角色.文本分割(角色.列表取值_特殊(K4Global.伤害数字, "first", 1.0), ",")   # 2 个参数，各就各位
角色.等于(K4Global.角色buff, "")
角色.角色属性("按键", "2")
```

---

## SVG 里的字消失：Godot 的 SVG 导入器不支持 `<text>`

Godot 4 的 SVG 导入器用的是 **ThorVG**，它**不支持 `<text>` 元素** ——
K4 画板导出的 SVG 里文字就是 `<text>`，所以带字的美术资源导进 Godot 后字全没了。

统计：空白作品 165 个 SVG 里 **34 个**含 `<text>`，Phigros 148 个里 **60 个**。

### 修法：转换时用 Edge（Chromium）光栅化成 PNG

本机没有 inkscape / rsvg-convert / resvg / imagemagick，Python 侧也没有 cairosvg；
但 Windows 自带 **Edge**，渲染 SVG 完整，还支持真透明背景。

`lib/k4/svg.js`：

```js
msedge --headless=new --disable-gpu --hide-scrollbars \
       --default-background-color=00000000 \          # 关键：真透明，不然糊一层白底
       --user-data-dir=<临时目录> \                    # 关键：绝不碰你正在用的 Edge 配置
       --window-size=<SVG 内在宽>,<SVG 内在高> \
       --screenshot=<out.png> file:///<in.svg>
```

要点：

- **只**光栅化含 `<text>` 的 SVG —— 其余保持矢量（放大更清晰）；
- 按「内容 sha1 + 目标尺寸」缓存在 `新版本/_cache/svg/`，重复转换不再起进程；
- 尺寸从 SVG 的 `width`/`height` 读，读不到退 `viewBox`，再读不到就放弃；
- **Edge 不可用 / 渲染失败 → 保留原 SVG 并报 ✗ 错误**（不静默降级）；
- 这一步必须在 `EMIT.emitProject` **之前**做 —— 生成器写 `.tscn` 用的就是这个文件名
  （把 `assets.styles[i].path` 和 `scene/actor.styleInfo.files` 一起改掉）。

结果（空白作品）：`34 个含 <text> → 已光栅化成 PNG: 34`，
`.tscn` 里引用的是 `.png`，剩下 131 处仍是不含文字的矢量 SVG。抽检 `E.svg → E.png`（91×92），
「E」字保住了。

> 代价：转换时间增加（每个 SVG 起一次 Edge，约 0.5–1 秒；有缓存后为 0）。
> 空白作品首次转换因此从 ~19 秒变成 ~19 秒 + 34 次渲染。

---

## 角色层拆成两层：自带积木 / 自定义积木

原来的 `全局/角色接口.gd` 把两类完全不同的东西塞在一个类里：

- **自带积木**：K4 内建能力的桩（要你去实现 Godot 侧行为，转换器给不出实现）；
- **自定义积木**：你在 K4 里自己写的函数（转换器**能**给出真实现）。

想整体替换其中一类，就得把另一类一起抄走。现在拆成两层：

```
角色基类              runtime/全局/角色基类.gd      引擎胶水 + K4 语义（库，不受转换影响）
 └ 角色自带积木         全局/角色自带积木.gd          ★每次覆盖：自带积木的桩
    └ 角色自定义积木     全局/角色自定义积木.gd        ★每次覆盖：K4 自定义积木的真实现
       └ 角色类          全局/角色类.gd                ★你写的实现，永不覆盖
          └ <角色名>.gd                              <屏幕>/<角色>/<角色名>.gd
```

于是「整体接管自带积木」是一条干净的路：把 `全局/角色自带积木.gd` 复制成你自己的类、
改 `class_name` 后填实现，再让 `角色类.gd` 去 `extends` 它 —— 不会牵扯自定义积木那层。

**变量 / 列表的声明仍然放在「角色自带积木」这一层**（所有角色共用的那个类），
这样生成代码里的 `角色.v_分数` 静态检查过得去，调试器变量面板里也是中文名。

### 旧工程怎么迁移

`全局/角色类.gd` 是你的文件、永不覆盖，所以老工程里那行 `extends 角色接口` 会找不到基类。
`convert.js` 里加了**唯一一处会动你文件的例外**，并且只改一行：

```js
var fixed = rc.replace(/^(\s*extends\s+)角色接口\s*$/m, '$1角色自定义积木');
```

同时会删掉上一版留下的 `全局/角色接口.gd`(+`.uid`)，两条都会打印 warning 说明。
除了 `extends` 这一行，你写的实现一个字都不会被动。

---

## 锚点：K4 的「旋转中心」和图片中心不重合

K4 里角色的 `x/y` 定位的是**旋转中心**，不是图片中心。默认旋转中心 = 图片中心，
但用户可以拖动它（K4 里叫「中心点」）。转换时必须把这个偏移补上，否则贴图会整体错位。

### 语义（有据可查）

K4 Ultra（打包在 `resources/app/build/kitten.*.js` 里的 PixiJS 应用）里是这么算的：

```js
this.transform_offset.pivot = { x: e / 2 + this.custom_pivot.x, y: t / 2 + this.custom_pivot.y }
```

PixiJS 的 `pivot` 从**左上角**量、**y 向下**，所以 `custom_pivot` 就是
**相对图片中心的像素偏移，x 向右、y 向下**。数据也完全吻合：

| 造型 | pivot | 图片 | pivot ÷ 半宽半高 | 落点 |
|:---|:---|:---|:---|:---|
| `敌人攻击(1).svg` | (-2023.3, 0) | 4047×282 | (-1.00, 0.00) | 左中 |
| `n2.svg` | (0, **+102.4**) | 190×205 | (0.00, **+1.00**) | **下中** |
| `新角色(16).svg` | (-482.7, +8.1) | 962×17 | (-1.00, +0.96) | 左下角 |

### 转换规则

角色原点 = 旋转中心，图片中心要相对原点偏移 `-pivot`（y 同向，不用翻）：

```gdscript
# <角色>.tscn
[node name="敌人攻击_1_" type="Sprite2D" parent="customs"]
texture = ExtResource("13")
visible = false
position = Vector2(2023.2558, 0.0)      # = -pivot，图片中心在旋转中心右边 2023px
```

几个要点：

- **偏移写在各自的 Sprite2D 上**，角色的 `position / rotation / scale` 保持纯 K4 语义；
  偏移在角色局部空间里，所以会跟着 `scale` 一起缩放 —— 正是想要的。
- **pivot 是每个造型各自的**（存在 style 上，不在 actor 上），所以每个 `custom`
  用**自己**的 pivot。同一个角色的多个造型 pivot 一致时，看起来就是"同一个相对偏移"。
- `0.01px` 以下一律当 0：K4 存的 pivot 常带 `1e-6` 级噪声（`0.0000026` 之类），
  不滤掉每个造型都会多出一行没有意义的 `position`。
- `_apply_transform()`（运行时）不需要改：它只负责角色自己的 transform，
  锚点已经烘进 `.tscn` 里的 Sprite2D 了，编辑器里也能直接看到正确的对齐。

---

## SVG 全部转 PNG：`<image>` 内嵌位图会让 Godot 画成**全黑**

用户报「Phigros 屏幕 2 的背景角色，custom 全是黑色，资源确实对上了」。
查下来 Godot 4 的 SVG 导入器（ThorVG）有**两类**东西不认，而且**不报错、直接画黑**：

| 症状 | 元素 | 空白作品 | Phigros |
|:---|:---|---:|---:|
| 字消失 | `<text>` | 34 | 60 |
| **整张变黑** | `<image>` + `data:` URI（内嵌位图） | 53 | **105** |

Phigros 的舞台背景（`空白场景(9).svg` 666KB、`空白场景(15).svg` 2.1MB、
`新角色(13).svg` 4MB …）全都是**把位图 base64 内嵌在 SVG 里**，
ThorVG 渲染出来就是黑的 —— 和用户看到的现象完全对上。

所以默认策略改成：**所有 SVG 一律光栅化成 PNG**（`--svg=vector` 可以退回"只转含文字的"）。

### 为什么要并行，以及为什么一开始并行会挂

第一版用的是一次一个 `spawnSync`，165 个 SVG 花了 **883 秒** ——
瓶颈不是渲染，是**每次都给 Edge 新建 user-data-dir**（冷启动好几秒）。

改成 `lib/k4/svgrender.js`：把任务写成 jobs.json，开 N 个工人并行，
**每个工人一个常驻 profile**（建一次一直复用）。但第一次跑 Phigros 出了两个问题：

1. **17 个任务失败**，而且全是小图 —— 单个跑却完全正常（8 秒出图）。
   根因是 Chromium 的**单实例语义**：同一个 `user-data-dir` 的新进程会被
   已经在跑的那个吸收掉、直接退出、什么也不产出。
2. **总耗时 1471 秒**：超时处理里只 `kill()` 却继续等 `exit`，
   一旦 kill 没生效（Edge 卡在窗口创建上），那个工人就**永远卡住**，整个池子不再推进。

修法两条：

- **硬看门狗**：超时后 `SIGKILL` 并且**不再等 exit 直接收尾**，工人不可能卡死；
- **失败项串行重试**，用**全新 profile**（没有残留进程抢），保证最终一个不落。

### 又踩一个：`xlink:href` vs `href`

「内嵌位图外壳」本来可以直接 base64 解出来当 PNG（毫秒级，还更保真），
但我第一版按 `xlink:href="data:…"` 匹配 —— **一个都没命中**。
看原始文件才发现 K4 画板导出用的是 **SVG2 的 `href`**：

```html
<image id="5a57e42da052334799e6aa781e3c6069" href="data:image/png;base64,…"/>
```

改成不依赖前缀、只认 `data:image/<类型>;base64,` 之后再判断「除 `<image>` 外还有没有别的绘制元素」，
Phigros 148 个 SVG 里 **29 个**是纯外壳，直接抽出来（含那几个 2–4MB 的大背景），
剩 119 个（有矢量叠加或含 `<text>`）才交给浏览器。

### 转换耗时（如实说明）

| 场景 | Phigros |
|:---|---:|
| 全 SVG 串行、每次新建 profile | 883 秒（空白作品 165 个） |
| 并行 + 常驻 profile + 抽取通道（冷缓存） | **1150 秒** |
| 同一工程**第二次**转换（命中缓存） | 约 30 秒 |

也就是说：**每个工程第一次转换要十几分钟**（瓶颈是 119 次 Edge 渲染，
这台机器上并发跑并没有快多少），**之后就是秒级**（结果按内容 sha1 缓存在
`新版本/_cache/svg/`，`--clean` 不会删它）。

想换速度：`--svg=vector` 只转含 `<text>` 的 —— 但那样内嵌位图那批在 Godot 里还是黑的。
真要根治得把上百个 SVG 塞进**一个** Edge 进程里批量渲染再切图（还没做）。




---

## 超长文本外置到 `文本/*.txt`

### 起因

`pec2txt` 那个工程里，一个 `文本分割` 的输入是整个 8 MB 的谱面文件。
取值修好之后，它变成了一行 800 万字符的 GDScript：

```gdscript
角色.复制列表(K4Global.输入, 角色.文本分割("175\n bp 0.000 185.000\n n1 0 118.250…（后面还有 784 万字符）", "\n"))
```

Godot **能解析**（`CHECK fail=0`），但编辑器一打开这个脚本就卡死 ——
语法高亮、代码折叠、解析都要把这一行整个过一遍。

### 做法

超过 **1024 字**的字符串不再内联，落成

```
<脚本所在目录>/文本/<编号>.txt
```

代码里只留一行调用：

```gdscript
# 背景/舞台/当开始被点击时_1.gd
角色.复制列表(K4Global.输入, 角色.文本分割(K4Text.读取("背景/舞台/文本/1.txt"), "\n"))
```

| | 修前 | 修后 |
|:---|---:|---:|
| `背景/舞台/当开始被点击时_1.gd` | 8,033,871 B | **339 B** |
| `背景/舞台/文本/1.txt` | — | 7,845,085 B |

（8,033,871 是**转义后**的字节数：原文里的每个 `\n` / `"` / `\` 在 `.gd` 里都要多占一个字节。
txt 里存的是**原文**，7,845,085 字节。）

### 几个设计选择

**为什么按「脚本所在目录」放**：文本属于哪个角色一目了然，删角色时文本跟着走。
同一个目录内**同内容只存一份**，编号从 1 开始（一个角色的多个脚本共用一个 `文本/`）。

**为什么不直接写 `FileAccess.get_file_as_string()`**：一次调用读一次盘。
那个表达式完全可能落在循环里（K4 里很常见），每次迭代重读 8 MB 是灾难。
所以中间加了一层 autoload `K4Text`（`runtime/全局/大文本.gd`，每次转换都会拷进工程）：

```gdscript
func 读取(路径: String) -> String:
	if _缓存.has(路径):
		return _缓存[路径]
	...
```

读一次就缓存住，顺便把"读不到"集中报错 —— 不然运行时只是一个莫名其妙的空串。
生成代码里传的是**项目内相对路径**（`背景/舞台/文本/1.txt`），
`读取()` 自己补 `res://`；也接受已经带 `res://` / `user://` 的完整路径。

**为什么不用 `"""…"""` 常量内联**：8 MB 的文本照样是一行（或一大段），
编辑器还是要渲染它；而且三引号本身还会被内容里的 `"""` 破掉。
外置成 txt 之后，编辑器连看都不用看它。

**`预备块.gd` 里的悬空文本同样外置**。那里的文本也可能是唯一一份数据，
内联一样会卡编辑器。只是它没法用 `K4Text.读取()` 去填 `const`
（GDScript 的 `const` 要求编译期常量），所以超长的那几段改成在注释里指向 txt 文件。

**阈值 1024**：`lib/k4/emit.js` 顶部的 `TEXT_FILE_LIMIT`。
改小会让目录里多出一堆小文件，改大则保护不到编辑器。

**哪些地方会走外置**：所有字符串字面量 —— 语句实参、表达式、
角色变量 / 列表初值、全局变量初值、悬空块备份。都在同一个通道里，没有例外。

### ⚠ 导出的坑（重要）

`.txt` 不是 Godot 资源，**导出 exe/apk 时默认不会打进 pck** ——
那时运行时 `K4Text.读取()` 会返回空串。

在「项目 → 导出 → 资源 → **导出非资源文件/文件夹的过滤器**」里加上

```
*.txt
```

（或 `文本/*.txt`）再导出。`K4Text.读取()` 打不开时会 `push_error`
打出完整路径和错误码（`错误码 7` = `ERR_FILE_NOT_FOUND`），方便确认是不是这个原因。

### 实测（Godot 侧）

在 `_out/音游谱面转换器` 里挂个临时场景直接调 `K4Text.读取("背景/舞台/文本/1.txt")`：

```
TEXTLEN=7845085          # 与磁盘上的字节数一致（内容全是 ASCII）
HEAD=175\n bp 0.000 185.000\n
TAIL=v 23 504.500000 0.000000
CACHED=true              # 第二次调用命中缓存
ERROR: K4Text：打不开 res://背景/舞台/文本/404.txt（错误码 7）。
MISS=0
MISS2=0                  # 缺失的文件只报一次错，不刷屏
```

### 合成验证：悬空块那条通道

4 个样本的 `spare`（悬空块文本）段数都是 0 —— 也就是说"**既悬空、又超长**"的文本
在真实样本里不存在，这条通道没有真实用例可用。所以用 `_dev/probe_textfile.js`
手工验：往一个真实 IR 的某个角色上挂两段 spare 文本（600 字 + 3 字），
跑一遍 `emitProject`：

```
外置计数 = 3
--- 背景/谱面转换器/文本/2.txt  (600 字节)        ← 悬空块里的 600 字，落盘
--- 背景/谱面转换器/预备块.gd  (508 字节)
    # ── 1) 原块 id=TEST_LONG，共 600 字 → 背景/谱面转换器/文本/2.txt ─────
    #    （已外置成独立文本文件，内容见 背景/谱面转换器/文本/2.txt）
    # ── 2) 原块 id=TEST_SHORT，共 3 字 ─────
    const 预备文本_2 := """
    短文本
    """
```

短的那段照旧内联，长的只留一行指向 txt —— 正是想要的行为。

同一轮还把 `TEXT_FILE_LIMIT` 临时压到 **16**、`collectSpareTexts` 的门槛压到 **1**，
对新作品跑了一次完整流程（`CHECK scripts=27 scenes=4 fail=0` / 0 error / 0 warning），
确认外置在极端设置下也不会生成坏代码（顺带证明了任意长度都能外置：
`Bcm_Phigros_Version2.3` 这 22 字的一行也照样落成了 `文本/1.txt`）。
两个阈值随即改回 1024 / 16。




---

## K4 的列表 / 文本是 **1-based**（以及这一轮修掉的三个取值缺口）

### 语义

和 Scratch 一样：**第 1 项就是第一个元素，第 1 个字符就是首字符**。GDScript 是 0-based，
所以下标换算全部发生在 runtime / 参考实现里 —— **生成代码里传的永远是 K4 语义的序号**。

| 情况 | K4 语义 | GDScript |
|:---|:---|:---|
| 取列表第 n 项 | `列表取值_特殊(L, "first", n)` | `L[n-1]` |
| 取倒数第 n 项 | `列表取值_特殊(L, "last", n)` | `L[size-n]` |
| 值在列表中的位置 | 1-based；**找不到 = 0** | `find()+1`（不是 `-1`） |
| 删列表第 n 项 | 1-based | `remove_at(n-1)` |
| 插到第 n 项**前面** | 1-based | `insert(n-1, v)` |
| 文本第 n 个字符 | 1-based；越界 = `""` | `s[n-1]` |
| 文本第 x 到第 y 个字符 | **含两端** | `s.substr(x-1, y-x+1)` |

`lib/k4/emit.js` 里的 `list_index_of` 早就写成 `(L.find(v) + 1)` 了；其余全部落在
runtime / 参考实现里。

### 列表三个方法的「方式」参数

K4 的「列表取值 / 删除 / 替换」上都有一个下拉：`first` / `last`（删除还有 `all`）。
它的意思是**从哪一头数**，不是"取第一项"：

```gdscript
列表取值_特殊(列表, "first", 3)     # 第 3 项
列表取值_特殊(列表, "last",  3)     # 倒数第 3 项
列表删除_特殊(列表, "all",  0)      # 全部删掉
列表替换(列表, "last", 1, "x")      # 把倒数第 1 项换成 "x"
```

修之前这三个函数各说各话：

| 方法 | 修前 | 后果 |
|:---|:---|:---|
| `列表取值_特殊` | `(列表, 序号, 位置)` —— 参数名反了 | 顺序恰好对，只是形参名误导 |
| `列表删除_特殊` | `(列表, 序号, 方式)` | 与取值**正好相反**，实现时人人都会写错 |
| `列表替换` | `(列表, 序号, 值)` —— **方式整个丢了** | 空白作品里 5 处 `TYPE=last` 被当成 first |

现在统一成 `(列表, 方式, 序号)` / `(列表, 方式, 序号, 值)`。

> 实测证据：`lists_get_value` 在空白作品里 543 处，其中 542 处 `TYPE="first"`，
> 而它们的 INDEX 影子取值是 1 / 2 / 3 / … 各不相同 —— 如果 `TYPE` 是"取第一项"，
> 用户不可能这么填。所以 `TYPE` 只能是"从头数/从尾数"。

### 顺带修掉：`self_move_to` 不是「移到 <目标>」

K4 的 `self_move_to` 是**「移到 x:__ y:__」**（两个数字输入 x / y）；
Scratch 那个「移到 <角色/鼠标>」在 K4 里叫 `self_move_specify`。
以前按 `motion_goto` 处理并且去读一个根本不存在的输入名 `TARGET`
→ **空白作品 124 处全变成 `移到_目标(0.0)`**，两个坐标整个丢掉。

### 顺带修掉：`text_select_changeable` 丢掉了截取范围

K4 的「文本 [X] 的第 [a] 到第 [b] 个字符」（`mutation items="2"` 就是那两个数字槽）。
以前直接降级成 `转文本(文本)`，a / b 全丢 —— 7 处「截取」变成"原样返回整段"。

### 修的时候自己踩的坑：**重复参数名会让整条继承链崩掉**

改 `list_item_special` 的时候只改了 `OP_METHODS` 那份，漏了 `IR_METHODS` 里同名的另一条。
`buildSignatures()` 是**按位置**合并两张表的、参数名取"先遇到的那一份"（IR 表在前），
于是生成出：

```gdscript
func 列表取值_特殊(_列表: Variant, _序号: Variant, _序号: Variant) -> Variant:
#                                          ^^^^^^ 撞名
```

GDScript 对重名参数是**解析错误**，而且**报错完全指不到原因**：

```
SCRIPT ERROR: Parse Error: Could not resolve super class inheritance from "角色自带积木".
   at: GDScript::reload (res://全局/角色自定义积木.gd:15)
SCRIPT ERROR: Parse Error: Could not resolve class "帽子基类".
ERROR: Failed to load script "res://背景/E/E.gd" with error "Parse error".
```

`CHECK scripts=119 scenes=40 fail=110` —— 看着像"全局类注册表坏了"，实际是
`角色自带积木.gd` 一个字面错误顺着 `class_name` 链把 110 个脚本全部带崩。

两处加固：
1. 两张表的同名条目参数顺序/名字必须一致（`methodtable.js` 里加了注释提醒）；
2. `buildSignatures()` 合并完做一次**参数名去重**（重名就加后缀并记进报告）；
3. `convert.js` 新增 **5.57 自检**：扫描每个生成 `.gd` 的函数签名，发现重复参数名直接报错。
   有这条之后，同样的错在转换阶段就会被拦住，不用等到 Godot 里看一堆误导性报错。




---

## 自带积木的参考实现（`为用户的参考自带积木实现.gd`）

`用户正在完成的godot实现功能/为用户的参考自带积木实现.gd`

把「K4 自带积木」那一层的桩逐个填成真实现的参考版本。
`class_name` / `extends` 与生成文件完全一致，**可以直接整文件替换生成工程里的
`全局/角色自带积木.gd`**（想长期用就往上一层放，别被转换器覆盖 —— 文件头写了做法）。

| 分类 | 状态 |
|:---|:---|
| 运动（坐标 / 方向 / 移动 / 滑行 / 反弹 / 大小 / 翻转） | ✅ 实现 |
| 外观（造型 / 显示隐藏 / 透明度 / 淡入淡出 / 图层 / 说话气泡） | ✅ 实现（图形特效只做了透明度 / 颜色 / 亮度） |
| 数据（列表 + 变量全套，1-based） | ✅ 实现 |
| 运算（数学 / 文本 / 逻辑 / 随机 / 类型转换） | ✅ 实现 |
| 侦测（按键 / 鼠标 / 距离 / 碰撞 / 询问并等待） | ⚠ 碰撞用包围盒代替像素级；响度留 0 |
| 画笔（落笔抬笔 / 颜色粗细 / 图章 / 擦除） | ✅ 实现；文字图章要画布补一个方法（文件里写了那两段代码） |
| 声音（播放 / 等待播完 / 停止 / 音量） | ✅ 实现（音符合成未做） |
| 云变量 / 云列表 | ⚠ 做成 `user://` 本地持久化，能存住但不联网 |
| 物理（启用物理 / 施加力 / 密度弹性…） | ❌ 全部留桩，桩体注释写清了为什么不能直译以及建议怎么做 |
| 排行榜 / 计时器监视器 / 录音 / 语音识别 | ❌ 留桩 |

### 最小验证：81 项断言，0 失败

临时场景里直接把 `角色自带积木` 实例化，逐条断言（跑完就删）： 

```
---- 列表：K4 从第 1 项开始 ----
  ok   取值 first 1      得=甲        期=甲
  ok   取值 last 2       得=丙        期=丙
  ok   取值 first 越界    得=          期=
  ok   项序号(无) = 0     得=0.0       期=0.0
  ok   删除第 2 项        得=[1, 3, 4] 期=[1, 3, 4]
  ok   替换倒数第 1 项     得=[1, 9]    期=[1, 9]
  ok   在第 1 项前插入     得=[7, 0, 9] 期=[7, 0, 9]
---- 文本：1-based ----
  ok   取字符 3          得=c         期=c
  ok   截取 2..4         得=bcd       期=bcd
  ok   第几个字符         得=2.0       期=2.0
  ok   最后位置           得=5.0       期=5.0
---- 运动：方向 -> 位移 ----
  ok   方向 90（右）x      得=10.0      期=10.0
  ok   方向 180（上）y     得=10.0      期=10.0
  ok   方向 0（下）y       得=-10.0     期=-10.0
  ok   方向 270（左）x     得=-10.0     期=-10.0
---- 边界反弹 ----
  ok   右边界 方向 90 -> 270   得=270.0  期=270.0
  ok   上边界 方向 180 -> 0    得=0.0    期=0.0

RESULT 共 81 项，失败 0 项
```

同一份文件在 `_out/新作品` 里整文件替换掉生成的桩之后，
`CHECK scripts=27 scenes=4 fail=0` / 0 error / 0 warning / 0 parse fail。

### 顺带把 K4 方向的定义钉死了

以前只有注释里一句没验证过的"顺时针为正"，实际推导出来的定义是：

```
K4 方向：90 = 右，180 = 上，0 = 下，270 / -90 = 左   （从"下"开始逆时针）
移动 n 步：  弧 = deg_to_rad(k4_direction - 90)
             k4_x += n * cos(弧)        k4_y += n * sin(弧)
碰到边缘就反弹：左右边 d' = 360 - d      上下边 d' = 180 - d
```

推导依据是 `角色基类._apply_transform()` 里那句
`rotation = deg_to_rad(90 - k4_direction)`（Godot 的 `rotation` 正值是**顺时针**）：
代入 d=90 得 0（朝右）、d=0 得 +90°（朝下）、d=180 得 -90°（朝上）。
**`角色基类.gd` 注释里写的"顺时针为正"是笔误，公式本身是对的。**

> 参考实现里顺带把几个"生成代码从来没覆盖到"的语义也补上了：
> `取余` 的结果符号跟随除数（GDScript 的 `fmod` 不是）、`转文本(3.0)` 得 `"3"` 而不是 `"3.0"`、
> `随机整数` 含两端、越界取值返回 `""` 而"找不到位置"返回 `0`。




---

## 帽子的触发时机（用户报"没按 S 键就跑了"之后整理的一遍）

### 症状

phi 转换器一进游戏就报：

```
Invalid operands 'String' and 'float' in operator '/'.
  0 - res://背景/谱面转换器/当按下_KEY_S_1.gd:15
  1 - res://全局/帽子基类.gd:118 - at function: 点火
  2 - res://全局/帽子基类.gd:105 - at function: 启动
  3 - res://全局/帽子基类.gd:77  - at function: _ready
```

**"没按 S 键"是主因，"类型不匹配"只是它顺带暴露出来的第二层问题。**

### 根因 1：`_ready` 里"默认就启动"，而按键帽子没覆写

`帽子基类._ready()` 原来是：

```gdscript
if _触发条件满足():
    启动()

func _触发条件满足() -> bool:
    return true          # ← 默认 true
```

只有 `帽子_开始` / `帽子_克隆启动` 覆写了它；`帽子_按键` 既没覆写它、
也没覆写 `_ready()` —— 于是**一挂进场景就把积木体跑了一遍**。

修法：基类默认改成 **`false`**。只有"脚本一挂上就该跑"的两类帽子返回 true。
错误方向选安全的那一边：以后再加新帽子忘了覆写，也只是"不触发"，不会"乱触发"。

### 根因 2：`_运行中` 永远回不到 false —— 事件型帽子**只能触发一次**

`_点火()` 原来是 `call("_积木主体")` 就结束，没人把 `_运行中` 设回 false；
而 `启动()` 开头是 `if _运行中: return`。所以按键/点击/广播帽子
**第一次之后再也不响应**。这是"触发条件对不对"里最要命的一条，只是被根因 1
的表现盖住了。

修法：点火走一层独立协程 `_跑主体()`，跑完比对 ctx 再 `_结束运行()`：

```gdscript
func _跑主体() -> void:
    var 本轮: 角色基类.WarpCtx = _ctx
    await call("_积木主体")
    if _ctx == 本轮:        # 绿旗重启换了新 ctx，旧协程不许抹掉新一轮的状态
        _结束运行()
```

### 根因 3：生成代码自己 `新建上下文()`，绿旗重启作废不掉旧协程

`帽子基类` 的【契约 B】写着生成代码要用 `_上下文()`，但生成器一直写的是
`角色.新建上下文()`。后果：绿旗重启时基类标记的是"新 ctx"，而旧协程手上是另一个对象，
**两个协程会同时跑同一段积木**。

修法：`emitHat` 改成 `var ctx: 角色基类.WarpCtx = _上下文()`（`_条件()` 里保留
`新建上下文()` —— 那里不能调 `_上下文()`，否则会把 `_运行中` 设成 true 挡掉 `启动()`）。

### 修完之后的触发时机表

| K4 帽子 | Godot 侧触发点 | 什么时候**不**触发 |
|:---|:---|:---|
| 当开始被点击时（绿旗） | `帽子基类._ready()` → `_触发条件满足()` = 非克隆体 | 克隆体上不跑 |
| 当作为克隆体启动时 | 同上，`_触发条件满足()` = `k4_is_clone` | 原体上不跑 |
| 当按下 X 键 | `帽子_按键._input()`（键码相等 / 任意键） | 没按键 |
| 当角色被点击时 | `Area2D.input_event` | 没点击 |
| 当接收到广播 | `K4Bus` 动态信号 | 没广播 |
| 当 \<条件\> | `_process` 轮询 + **边沿触发**（上一帧假、本帧真） | 一直是真（不重复跑） |
| 当计时器 > N | 同上，条件 = `角色.计时器() > 阈值` | 同上 |
| 当响度 > N | 同上 | 同上 |
| 当切换到当前屏幕 | 屏幕的 `屏幕已就绪` 信号 | —— |
| 当背景切换为 X | 屏幕的 `屏幕背景切换` 信号（没有就轮询 `K4Global.当前背景`） | 背景名不匹配 |

另外两条横切的语义：

* **同一个帽子不重入**：`启动()` 里 `if _运行中: return` —— 上一轮没跑完时新事件被忽略
  （和 K4/Scratch 一致：按键脚本还在跑，再按不会起第二个）。
* **绿旗 = 重启**：`重启()` 把旧 ctx 标 `_已取消` 并立刻开新一轮；旧协程会在下一个
  `await 角色.一步(ctx)` 处自然退出。

### 根因 4（第二层）：K4 是弱类型，GDScript 不是

第 15 行原来是：

```gdscript
角色.列表添加(K4Global.输出, (角色.列表取值_特殊(K4Global.输入, "first", 1.0) / 1000.0))
```

`列表取值_特殊` 返回的是**字符串** `"175"`。K4 里 `"175" / 1000` 合法（= 0.175），
GDScript 运行期直接报 `Invalid operands 'String' and 'float'`。

`lib/k4/emit.js` 里的 `coerce()` 原来对**动态值（`?`）是原样返回**的 ——
理由是"代码看起来干净"。但变量 / 列表项 / 自定义积木返回值 / 云变量取值
全都是 `?`，也就是"随时可能是字符串"。改成：

| 位置 | 现在生成 |
|:---|:---|
| `- * / **` | `(角色.转数字(a) / 角色.转数字(b))` |
| `+` | 两侧都是数字**字面量**才内联；否则 `角色.算术运算("add", a, b)` |
| `%` | `角色.取余(a, b)`（结果符号跟随除数，`fmod` 不跟） |
| 条件 `if <值>` | `角色.为真(值)`（K4 里 `"0"` 是假，Godot 的 Variant 真值化认为是真） |
| 转文本 / 转数字 | `角色.转文本(x)` / `角色.转数字(x)` |

修完那一行：

```gdscript
角色.列表添加(K4Global.输出, (角色.转数字(角色.列表取值_特殊(K4Global.输入, "first", 1.0)) / 1000.0))
```

顺带发现 `算术运算("add")` 的实现也不是 K4 语义（它是"任一侧是 String 就拼接"，
于是 `"5" + 1` 会得到 `"51"`，而 K4 得 `6`）。已改成"两侧都能当数字就相加，否则拼接"。

**`转文本` / `转数字` / `取余` 从桩层搬到了库层**（`角色基类.gd` + `BASE_METHODS`）：
它们出现在每一个算术表达式里，留在 `角色自带积木.gd` 当桩（`return ""` / `return 0.0`）
的话，任何没实现它们的工程都会**静默算错**，而不是"少个功能"。

### 最小验证：18 项断言，0 失败

```
---- 帽子触发时机 ----
  ok   ★没按键 / 没事件 → 不能自己跑起来      得=0
  ok   第一次触发                        得=1
  ok   ★第二次触发（以前只能跑一次）          得=2
  ok   第三次触发                        得=3
  ok   跑动中重复启动只算一次                得=4
---- 弱类型算术（K4 语义）----
  ok   add 6 + 1                       得=7.0
  ok   ★add "5" + 1 = 6（不是 "51"）    得=6.0
  ok   add "a" + 1 = "a1"              得=a1
  ok   转数字("175") / 1000             得=0.175   ← 用户报的那一行
  ok   转文本(3.0) = "3"                得=3
  ok   取余 -7 mod 3 = 2                得=2.0
  ok   为真("0") = false                得=false

RESULT 共 18 项，失败 0 项
```

> 测试用一个 `extends 帽子_按键` 的假帽子数触发次数，跑完就删掉了。




---

## 第二轮：比较运算的弱类型、K4 的「分割后转数值」、把实现变成模板

### ① 上一轮只修了算术，漏了比较

```
Invalid operands 'String' and 'float' in operator '<='.
  0 - res://全局/角色自定义积木.gd:377 - at function: floorposition的计算
```

377 行是 `if ((time <= 角色.列表取值_特殊(K4Global.cv, "first", K4Global.当前cvi)))`。

`cmp_*` 那段还是老逻辑：**两侧都是 `?` 就内联原生运算符**。
`time`（过程参数）和 `列表取值`（动态）正好都是 `?` → 内联 → 运行期炸。

修法和算术统一：**只有两侧都确定是数字时才内联**，其余一律
`角色.等于 / 不等于 / 小于 / 小于等于 / 大于 / 大于等于()`。

顺带把 `staticKind()` 的"数值型 op"列全了（`math_*` 前缀、`list_index*`、
`str_index*`、`round_mode`、`random_*`…）—— 漏掉的会被当成动态值，
白白退回函数调用，代码变啰嗦。

生成结果：

```gdscript
if (角色.小于等于(time, 角色.列表取值_特殊(K4Global.cv, "first", K4Global.当前cvi))):
```

### ② `角色基类.比较()` 的非数值分支本来是错的

```gdscript
"lt": return an < bn if 双数值 else false     # ← 非数值时一律 false
```

K4/Scratch 的规则是「两侧都能当数字就按数字比，**否则按字符串比（字典序）**」，
`"abc" < "abd"` 应该为真。已修。

### ③ K4 的「文本分割」会把每一项**尝试转成数值**

用户指出的特性（K4 是 JS，走的是 `Number(x)` 那一套）：

> 在 k4 中，列表分割字符串后会自动把里面的值尝试转换为数值类型
> （但 true/false 不会转 bool，当成字符串类型）

所以 `"000,3e5,abc"` 分出来是 `[0, 300000.0, "abc"]`。
这一条很关键：**列表里存的是数字而不是字符串之后，下游就不会再撞弱类型报错** ——
它是"源头"那一半，`角色.转数字()` / `角色.比较()` 是"兜底"那一半，两边都要有。

判定用正则而不是 `String.is_valid_float()`：

```gdscript
_数字正则.compile("^[+-]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][+-]?[0-9]+)?$")
```

因为 `is_valid_float("3e")` 给 `true`、而 `to_float("3e")` 得 `0` ——
会把 `"3e"` 静默吃成 0；而 JS 里 `Number("3e")` 是 NaN，应该原样保留字符串。

| 分出来的项 | K4（JS `Number()`） | 我们的结果 |
|:---|:---|:---|
| `"000"` | `0` | `0.0` |
| `"3e5"` | `300000` | `300000.0` |
| `"3e"` | `NaN` → 保留字符串 | `"3e"` |
| `"1.5"` / `".5"` / `"5."` | `1.5` / `0.5` / `5` | 同 |
| `"abc"` / `"true"` / `"false"` | `NaN` → 保留字符串 | 同 |
| `""` | `0`（JS） | 保留 `""`（见下） |

> 最后一行是我们**故意**和 JS 不同的地方：JS 的 `Number("")` 是 0，
> 但把空项变成 0 会让 `"a,,b"` 这种数据看不出"这里少了一项"。
> 如果发现 K4 确实把它当 0，把 `_分割项转值()` 开头那段去掉即可。

### ④ 参考实现现在成了**生成模板**

`runtime/模板/自带积木.gd`（就是那份实现，改了标题和头部说明）。
`emitBuiltinLayer()` 不再生成桩，改成：

1. 以模板原文为底；
2. 扫出模板里已有的 `func 名(`；
3. 把**映射表里有、模板里没有**的方法补成桩、追加到文件末尾，
   并加一段显眼的注释点名"这些不在模板里"。

于是：

* 开箱就有全部自带积木的可用实现，不用再手动拷；
* 映射表以后新增积木也不会漏（新方法最差是个 `pass`，仍然是"转换器永不失败"）；
* 模板文件万一丢了，也只是退化成原来的纯桩，不会让转换失败。

> ⚠ 因为 `全局/角色自带积木.gd` 现在是模板生成的，**改它会被下次转换覆盖**。
> 要定制：拷模板成你自己的类、改 `class_name`，再让 `角色类.gd` extends 它；
> 或者只把要改的那几个方法写在 `角色类.gd`（那边优先级最高、永不覆盖）。
>
> `用户正在完成的godot实现功能/为用户的参考自带积木实现.gd` 现在是模板的一份拷贝，
> 内容完全一致 —— 方便你单文件翻阅。

### ⑤ 顺带修掉的：`停止("全部")` 会让游戏彻底冻住

模板化之后桩变成真实现，`停止("全部")` 第一次真的被执行到，立刻暴露：

```gdscript
if 选.begins_with("all"):
    get_tree().paused = true     # ← 错
```

一旦暂停，`await get_tree().physics_frame` 就**永远不返回** ——
表现是"游戏冻住"，headless 下 `--quit-after 300` 也跟着卡死（跑帧超时）。
改成递归把整棵树上的角色标 `k4_alive = false`、把帽子的 ctx 标 `_已取消`，
引擎照常跑，只是所有积木不再往下走（这才是 K4 的「停止全部」语义）。

### ⑥ 桩提醒不再刷屏，也不再混进"错误"计数

模板里未实现的积木会 `push_warning`。两个问题：

1. 这些桩完全可能落在每帧循环里 → 刷爆调试器。加 `_桩提醒()` 按**文本去重**，同一句只报一次。
2. 提醒是预期内的，不该和真正的运行期错误算在一起。提醒文本统一加 `[K4-STUB]` 前缀，
   `huanzhuang.ps1` 成对跳过它和紧跟的 `at: push_warning (...)` 那两行，单独统计：

```
  stderr lines      : 0
  error/warn lines  : 0
  stub notices      : 12   (expected, not counted)
  parse-check fails : 0
  OK - 0 error / 0 warning / 0 parse fail
```

### 验证

**弱类型专项：23 项断言，0 失败**

```
---- 文本分割：自动转数值 ----
  ok   000 -> 0                     得=0.0
  ok   3e5 -> 300000                得=300000.0
  ok   ★3e 半截指数 -> 保留字符串     得=3e
  ok   ★true 不转 bool              得=true
  ok   混合  得=["a", 12.0, "b"]
  ok   按行分割后取数字               得=175.0
---- 弱类型比较 ----
  ok   字符串 <= 数字（用户报的那一行）  得=true
  ok   字符串 == 数字（数值相等）       得=true
  ok   字符串 < 字符串（字典序）        得=true
  ok   非数字比较不报错                得=false
---- 弱类型算术 ----
  ok   add "5" + 1 = 6               得=6.0
  ok   转数字("175") / 1000           得=0.175
RESULT 共 23 项，失败 0 项
```

**四个样本重新转换 + 全量检查**：全部 `fail=0`。

| 用例 | scripts | scenes |
|:---|---:|---:|
| 音游谱面转换器 | 27 | 4 |
| 新的作品 | 27 | 4 |
| 大陆漂移学说 | 93 | 29 |
| 游戏-空白作品 | 119 | 40 |

> `run` 那一步在大工程上会超时（跑不完 300 帧）—— 那是**帧率**问题不是错误：
> 桩变成真实现之后每帧真的在算东西了。超时阈值已从 90 秒放宽到 200 秒，
> 并且超时会明确提示"日志可能不全"。
>
> 用户侧反馈：纯运算测试基本通过，**没有出现数组边界问题**。

### 顺手量到的帧率（没解决，先记下来）

`大陆漂移学说`（18 角色 / 51 帽子 / 30 造型）跑到 300 帧要几分钟。
用 `--fixed-fps 60 --quit-after 300` 统一口径量（这个口径下 `新作品` 2.2 秒、
`音游谱面转换器` 7.5 秒、`大陆漂移学说` **95.9 秒**）：

| 帧数 | **模板版**（真实现） | **纯桩版**（对照） |
|---:|---:|---:|
| 1 | 22.3 s | 15.3 s |
| 6 | 27.4 s | 16.1 s |
| 60 | 161.9 s | — |

固定 ~15 秒是 Godot 启动 + 加载本工程的成本，和模板无关。剩下的每帧开销
**定位到了一个具体的文件**：

```
背景/上一页/当开始被点击时_3.gd
    while true:
        while not 角色.为真(角色.碰到角色()):
            角色.增加大小(...)
            await 角色.一步(ctx)
        while not ((not 角色.为真(角色.碰到角色()))):
            ...
```

用一次性排查脚本 `patch_stub_bodies.js`（把排序后的前 N 个 `_积木主体` 清成 `pass`；
脚本已在收尾清理时删掉，做法留在这一句里）
二分出来的（`--fixed-fps 60 --quit-after 300`）：

| 清空前 N 个 | 300 帧耗时 |
|---:|---:|
| 0（不动） | 95.9 s |
| 4 | **8.4 s** |
| 9 / 18 / 36 / 54（全清） | 8.2~8.5 s |

也就是说**只要这一个文件在跑，就多花 87 秒**。把它换成最简单的形式也一样：

| 那个文件的 `_积木主体` | 300 帧耗时 |
|:---|---:|
| 清空成 `pass` | 8.4 s |
| `while true: await 角色.一步(ctx)` | 92.6 s |
| `while true: await get_tree().physics_frame` | 95.2 s |
| `while true: await get_tree().process_frame` | 92.6 s |
| `for _i in range(300): await get_tree().process_frame` | **101.0 s** |

**⚠ 到这里我卡住了，如实说明**：一个每帧只 `await` 一次的循环，
逻辑上不该产生 300 ms/帧的开销，但它是**稳定可复现**的（清掉就恢复、加回来就慢）。
同样的代码在 `新作品`（1 角色）里完全没这个问题。
我试过排除的：`一步()` 的覆盖、warp 预算（`K4_WARP_MS` 从 100 改到 1 只快 8%）、
嵌套 warp 续期预算（已在 `进入warp()` 里修掉——只在 `depth == 0` 时重置预算）、
无限协程 vs 有限循环。

**所以下一步应该在有窗口的环境里验证**（headless 的帧调度和真实不一样）：
把那个文件的 `_积木主体` 改成 `pass`，看编辑器里帧率是否立刻恢复。
如果是，就有明确目标了。

能先拧的旋钮（`runtime/全局/角色基类.gd`）：

```gdscript
const K4_WARP_ITERS := 10000   # warp 里连续跑多少步才强制让出一帧
const K4_WARP_MS := 100        # 或者跑够多少毫秒就强制让出
```

用一次性排查脚本 `patch_slow.js`（给生成工程的 `帽子基类._ready` 插计时探针；脚本已清理）
可以看到"点火到第一个让出点"最多 80 ms —— 不是某一个帽子卡住。

### 找到了：`碰到角色()` 是 O(N²)

用户给的两张截图把范围锁死了：

| 工程 | 结构 | FPS |
|:---|:---|---:|
| `新的作品` | `while true { 下一个造型 ; 等待_秒(0.2) ; 一步 }` | **56** |
| `大陆漂移学说` | `while true { while 没碰到角色 {...} ; while ... {...} ; 一步 }` | **1** |

**关键不是"循环嵌套"，而是"循环体里有没有那层遍历"。**
`新的作品` 的循环体只是换造型 + 等 0.2 秒，所以流畅。

节点数探针（一次性排查脚本 `patch_nodes.js`，已清理）显示：

```
[K4-NODES] n=30  nodes=1437
[K4-NODES] n=90  nodes=1896
[K4-NODES] n=300 nodes=2049      ← 停在克隆上限
```

`大陆漂移学说` 里 **4 处 `克隆自己`、0 处 `删除克隆体`**，克隆体一路堆到
`K4_克隆总量上限 = 512`，于是 **2049 个节点 ≈ 512 × 4**。

而 `碰到角色()` 的朴素实现是"每个角色每帧遍历同层所有兄弟"：

```
512 个克隆体 × 每个每帧遍历 512 个兄弟 ≈ 26 万次迭代/帧
每次迭代 = 2 次属性访问 + 1 次函数调用  →  GDScript 下 100~260ms/帧
```

**实测 262 ms/帧**（270 帧用了 70.8 秒，稳定不衰减），和算出来的完全吻合。
`FPS 1` + `处理 2.58 ms` + `拖动窗口有拖影` 也都是这个原因：时间全花在
协程里的紧循环上，不算 `process`，但把主线程占死了。

（K4/Scratch 的 `touching` 走渲染器的空间索引，不是朴素两两比较 —— 这是
"跑不动的 K4 工程真的搬到 Godot 也会跑不动"里，唯一一个**我们这边**该补的差距。）

**修法**（`runtime/模板/自带积木.gd`）：

1. **同层角色列表每帧只收集一次**（`get_children()` 每次都复制数组）；
2. **中心距平方预筛** —— 两心距离大于两个半径之和就一定不相交，
   直接跳过 `Rect2.intersects`；
3. `包围盒()` 同一帧内缓存。

效果（`--fixed-fps 60 --quit-after 300`）：

| 工程 | 修前 | 修后 |
|:---|---:|---:|
| 大陆漂移学说 | 70 ~ 193 秒（波动极大） | **3.3 秒** |
| 新的作品 | 2.2 秒 | 2.3 秒 |

> 要说清楚的是：**"克隆体只增不减"是原工程的逻辑**（K4 侧同样没写「删除此克隆体」），
> 我没有改它。改的只是"怎么检测碰撞" —— 那是我们自己的实现问题。
>
> 要彻底根治还可以上空间网格/四叉树（把 512 次查询从 O(N) 降到 O(1)），
> 目前这个 20 倍的改进已经够用（3.3 秒 / 300 帧 ≈ 11ms/帧）。

### 走过的弯路（记下来免得再犯）

用 `--fixed-fps 60 --quit-after 300` 做 A/B 时，**结果波动极大**
（同一个版本能测出 68 / 74 / 90 秒），我据此先后误判过：

* ❌ `进入warp()` 的嵌套预算 —— 改回旧版只从 118 秒变 99 秒；
* ❌ `K4_帧warp预算`（全帧共享 warp 预算）—— 从 118 秒变 70~90 秒，**不是主因**；
* ❌ 关掉 `文本分割` 的转数值 —— 88 秒，有改善但不够；
* ❌ 比较 / 条件退回旧策略 —— 157 / 71 秒，纯噪声；
* ❌ `包围盒()` 缓存 —— 112 / 194 秒，**反而更慢**；
* ❌ 把克隆上限压到 32 —— 70 / 57 秒。

**全都不对**，因为省的是"计算"而不是"迭代次数"。
教训：**headless 的耗时测量噪声太大，不能拿它做 A/B 结论** ——
用户截图里的 `FPS` 和 `处理` 两个数字，比我测十次都管用。

唯一保留下来的是 `进入warp()` 的修正（只在 `depth == 0` 时重置预算）——
它本身是对的（嵌套 warp 不该无限续期），只是解决不了这个问题。

### 版本备份 / 回滚

这台机器上没有 git，所以做了个最小的：

```
node _dev/backup.js save [备注]      快照到 _backup/<时间戳>[_备注]/
node _dev/backup.js list             列出快照
node _dev/backup.js restore <名字>   回滚（回滚前会先把当前状态另存一份）
node _dev/backup.js prune [N]        只保留最近 N 份
```

快照只收**源码**（`convert.js` / `lib` / `runtime` / `_dev` / `huanzhuang.ps1` /
`转换并验证.cmd` / `README.md`），整个才 ~0.6 MB，所以改之前随手存一份就行。
已有的两份：

```
20261005-151257_模板化_性能有问题
20261005-153319_定位性能问题之后
```














---

## 第三轮：最小案例（函数返回值 / 克隆体 / 画笔 / 碰撞）

用户给了 4 个"能直观看到结果"的最小案例，并要求**不再动大型工程**。
这一轮把 4 个都真的**跑起来 + 录帧看了画面**，抓到的东西比前两轮加起来都实。

### 工具：怎么"看到"生成工程在跑什么

都在 `_dev/`：

1. **录帧**（必须非 headless —— headless 没有渲染，看不到画面）：
   ```
   & $godot --path _out\<工程> --write-movie _shots\<名>.png --quit-after 180 --fixed-fps 30
   ```
   吐出一串 `<名>00000000.png …`，直接读图。
2. **`_dev/check_all.gd`**（就是 `huanzhuang.ps1` 第 4/5 步用的那个检查脚本）：作为临时
   场景挂进生成工程后，会把 `K4Global` 的每个变量、每个角色的 K4 坐标 / 大小 / scale /
   方向 / 造型 / 画布指令数打到 stdout；批量跑用 `_dev/验证最小案例.ps1`。
   （⚠ 更早的 `_dev/_探针.gd` 已被 `check_all.gd` 取代，收尾清理时删掉了。
   要用 `powershell -ExecutionPolicy Bypass -File` 跑。）
3. **⚠ `--import` 千万别吞输出。**
   `& $godot --headless --path <工程> --import *> $null` 会让 class_name 全局类缓存
   **建不起来**，之后所有运行都报 `Could not find base class "角色类"` ——
   看起来像继承链写坏了，其实是导入没做。
   写成 `... --import 2>&1 | Select-String ...` 就正常。

### 1. 返回值 / 递归 —— ✅ 本来就是对的

`函数返回值尝试` 的三个自定义积木转出来是**普通函数**（不是协程）：

```gdscript
func 递归函数(ctx: 角色基类.WarpCtx, 计数器: Variant) -> Variant:
    var 角色 := self
    if (角色.小于(计数器, 角色.随机整数(300.0, 600.0))):
        return 角色.递归函数(ctx, 角色.算术运算("add", 计数器, 1.0))
    else:
        return 计数器
```

判据是 `bodyNeedsAwait()`：只有过程体里含 `forever/repeat/repeat_until/等待` 才当协程，
所以纯递归不会变成 `await`。
**探针实测：`递归返回值 = 302.0`（300~600 区间内，正确）、`函数返回值 = 11.09`、
`未返回调用次 = 1.0`。302 层递归没有爆栈。**

### 2. 画笔：被 K4 的"背景板角色"盖住了（本轮最实的一个）

`画笔和嵌套循环测试` 录 240 帧**全白**，只有一个紫色角色在动。
可探针显示 `指令数 = 147`、`画笔颜色 = (1,0,0,1)`、`粗细 = 5.0`
—— **画笔一直在画，就是看不见**。层序错了两层：

1. **舞台实体和普通角色混在一层。**
   K4 的"舞台实体"（scene 自己，背景板造型挂在它身上）被当普通角色挂进了
   `基础角色层`，于是背景板（一张铺满舞台的图）正好画在 `屏幕绘制` 上面。
   → 屏幕根加一层 **`舞台层`**，节点顺序变成
   `舞台层 → 屏幕绘制 → 基础角色层 → 克隆体层`，
   正是 K4 的「舞台背景 → 画笔 → 角色」。
   `找("背景")` 由 `角色基类.找()` 兜底到整个屏幕，跨角色查找不受影响。
2. **更阴的一条：`屏幕绘制` 的 `z_index = -100`。**
   Godot 是**先在同一个 CanvasLayer 内按 z_index 全局排序**，z_index 相同的才按树顺序。
   所以"画笔层 z_index=-100"把画笔压到了**所有 z_index=0 的东西底下** ——
   而背景板恰恰就是一个 z_index=0 的普通角色。于是加完 `舞台层` 线**还是**看不见。
   → `屏幕绘制` 一个 z_index 都不碰，层序只用节点顺序表达。

改完后同一段录像：一条完整的红色曲线（含"碰到边缘就反弹"的折返）。

### 3. 碰撞 —— ✅ 跑通，且顺手修了一个静默 bug

`碰撞测试` 的 A / B 初始就重叠，探针实测 `碰撞到_A = true`、`碰撞到_B = true`，
B 的包围盒 `[P:(-180.08,-3.12), S:(206,190)]`。

**`_同层角色()` 的缓存以前是 `static var _同层缓存: Array`** ——
static 在 class_name 脚本里是**全类共享**的：角色 B 在同一帧会直接命中角色 A 缓存的那份列表。
同层时两份恰好一样所以看不出来，一旦"基础角色层"和"克隆体层"各挂一批角色就会串。
→ 改成 `static var _同层缓存表: Dictionary`，键 = 父节点 instance_id。

### 4. 克隆体 —— 数量对，名字错

`克隆体测试` 录出来满屏紫色小点（约 57 个存活克隆体），位置随机、会自己消失 ✓。
但 `k4_clones` 里**一半叫 `@Node2D@14`、`@Node2D@18`…**：
`克隆自己()` 拿 `k4_clones.size() + 1` 当编号，而这个数会因「删除克隆体」**变小**，
新名字和还活着的旧克隆体撞名，Godot 只好改成 `@Node2D@N`。
→ 改用 `static var _克隆序号` 单调递增。

### 5. 外观（looks）：错得最多的一块

| 积木 | 之前 | 实情 | 现在 |
|:---|:---|:---|:---|
| 「大小」 | `k4_size_percent`(100) ↔ `scale`(1.0) | **这条本来就是对的**（探针实测：K4 里 20% 的角色 `scale=(0.2,0.2)`） | 不动 |
| 设置特效 `scope` | 1=透明度 / 2=颜色 / 3=亮度 | **编号整体错位**。K4 用的就是 Scratch VM 的 0-based：0 color / 1 fisheye / 2 whirl / 3 pixelate / 4 mosaic / 5 brightness / 6 ghost（`_dev/probe_effect.js` 在全部样本里只测到 0/1/2/4/6） | 按真编号重写：6→`modulate.a`、5→`modulate.rgb`；0/1/2/3/4 明确留桩（要 shader，不假装做了） |
| 「把特效增加 N」 | **整块没映射**，掉成"参数没解析出来"的桩 | K4 把减号放在 `increase` 字段里（increase/decrease），值一律正数 | core.js 加映射并折成 `_符号`，实现 `增加特效(特效, 符号, 值)` |
| 「翻转」 | 只认 "左右"/"上下"/"leftright" | 实参是 **"x" / "y"**（`flip.axis`）→ 全落进 else 变成水平翻转，"上下翻转"永远没反应 | 认 x / y |
| 「上下翻转」 | 直接改 `customs.scale.y` | 但 `_apply_transform()` 每次都把 `customs.scale` 整个重写 → 活不过一个"移动 10 步" | 加 `k4_flip_y`，在 `_apply_transform()` 里一起烘 |
| 「移到图层 最前/最后」 | 拿 "front"/"最前面" 比 | 实参是**数字 1 / -1**（`layer.dir`）→ 完全没效果 | 认 1 / -1，且只用 `move_child` |
| 「图层前后移 n 层」 | 同时改 `z_index` 和 `move_child` | 两套语义打架，`z_index = ±4096` 还是破坏性的 | 只用 `move_child` |

### 6. 运动：目标选择器读错字段

`射击生存` 每帧刷
`Invalid call. Nonexistent 'String' constructor.`（`移到_目标` / `面向`）。两根因：

1. **`String(x)` 对非 String 会直接抛错**，`str(x)` 不会 ——
   模板里 34 处 `String(_参数)` 全换成 `str(_参数)`。
2. **目标选择器读错字段**（`_dev/probe_block_raw.js` 实测）：
   `self_move_specify` 的目标在 `fields.target`，`self_face_to` 在 `fields.sprite`，
   取值是实体 uuid 或保留值 `__random` / `__pointer`；而这两个**不在 `SELF_ALIASES` 里**
   → 解析成空 → 生成 `移到_目标(0.0)`：**敌人每帧被硬拖到舞台原点**；
   `self_face_to` 更是整块没映射 → `面向_角色([])`。
   → 新增 `Decompiler.目标字段()`，两个块都走它；`face_to` 进 IR_METHODS + `ARG`。

### 7. 顺手修掉的假警报

`开方` 的签名是 `(值, 次=2.0)`，K4 的 `math_root` 本来就只给 1 个实参 ——
以前每次转换都报「实参个数不匹配: 开方 需要2 给了1」。
现在"缺的参数**个个都有默认值**"就不报了。


### 8. 我自己在修这一轮时踩的两个坑（都很隐蔽，记下来）

**① `String(` → `str(` 的批量替换误伤了 `find_keycode_from_string(`。**

模板里有几处 `String(` 是**标识符的一部分**：`OS.find_keycode_from_string(`、
`JSON.parse_string(`、`FileAccess.store_string(`、注释里的 `draw_string(`。
一刀切替换之后它们变成 `find_keycode_from_str(` / `parse_str(` / `store_str(`，
而 Godot 报的是

```
Static function "find_keycode_from_str()" not found in base "GDScriptNativeClass"
Cannot infer the type of "码" variable because the value doesn't have a set type
```

**完全不提是我改坏的**，看起来像 Godot 版本里没有这个 API。
**教训**：批量替换要用 `(?<![A-Za-z0-9_])String\(`（前面不能是标识符字符）。

**② 往模板文件后面追加桩时，缩进必须是 Tab。**

`emitBuiltinLayer()` 会把"映射表里有、模板里还没有"的方法补桩到 `角色自带积木.gd` 末尾。
那两行以前写的是 4 个空格，而模板全篇是 Tab —— GDScript 在同一文件里混用 Tab / 空格
会直接报 `Used tab character for indentation instead of space as used before in the file`，
于是**整个 角色自带积木.gd 加载失败**，五层继承链断掉，所有角色脚本跟着报
`Could not resolve super class inheritance from "角色类"`。
看起来像转换器把继承链写坏了，其实只是两个空格。

顺带把 `xxx_桩` 这类改名后的类型层桩也从"补桩"列表里排除了 ——
它们的调用形态是 `角色.名([...])`（一个 Array 实参），混进这一层会遮蔽真签名。

**③ 定位"继承链断了"的最快办法**

`_dev/check_all.gd` + `check_all.tscn`（改名成 `_检查.gd` / `_检查.tscn` 拷进工程根）：

```
godot --headless --path <工程> res://_检查.tscn
```

它逐个 `load()` 每个 .gd / .tscn，直接打 `FAIL_SCRIPT res://...` ——
**告诉你哪个文件坏了**。只看主场景的运行日志是看不出这一层的
（Godot 只会说"引用它的那个文件解析失败"）。


---

## 第四轮：K4 源码里的运行时真值 + 射击生存的几个字段错

### 9. K4 不是 Scratch VM 换皮 —— 它把积木**编译成 Python**

`kitten.822d814413fb10654fde.js` 里是一张 `t.register("<块类型>", fn)` 的表，
每个 fn 返回一段 Python（`Y("op_name", args)` / `P(...)`）。
所以在 JS 侧搜 `stepThreads` / `sequencer` / `setLayerOrder` 是**搜不到的** ——
那些是 Scratch VM 的名字。用 `_dev/probe_k4src.js <bundle> <关键字>` 直接捞片段。

挖到的、和实现有关的几条：

| 项 | K4 的真值 | 我们原来的写法 | 现在 |
|:---|:---|:---|:---|
| `max_warp_iterations_per_interpreter_step` | `1e4`（另一套配置 `3e4`） | 10000 ✓ | 不变 |
| `warp_interpreter_millisecond_time_limit` | `100`（另一套 `4`） | 100 ✓ | 不变 |
| `max_call_stack_size` | **`1e4` = 10000 层递归** | 没有设置 | 写进 project.godot —— **但 Godot 不认**，见 §10 |
| `per_entity_clone_limit` | **`512`，而且是"每个角色"** | 全场景 512 + 拒绝克隆 | 每角色 512 + **FIFO 淘汰最老的** |
| `entity_max_clones_per_frame` | `300` | 无 | 未做（K4 每帧最多 300 个新克隆体） |

**"执行顺序与图层无关"这条，源码给的答案是：确实无关。**
图层操作编译成 `set_actor_layer_with_pen(position)`；
而每个实体的解释器状态存在 `interpreter_data = { 实体ID: {...} }` 这个**普通对象**里
（键是实体 ID，按插入顺序遍历），克隆体挂在 `original_id_2_clone_id_list[原体ID]` 下 ——
**全是"按实体"的结构，没有任何一处按绘制顺序排**。
所以用户的观察是对的：**积木执行顺序只取决于实体/线程的创建顺序，与图层无关**。
我们的实现天然一致：每个角色一棵独立子树，各跑各的协程。

### 10. `max_call_stack`：键名写对了也**不生效**（实测）

1. **键名**：`debug/gdscript/max_call_stack` 和 `debug/settings/gdscript/max_call_stack`
   **在 ProjectSettings 里都查得到**，但引擎真正读的是**带 `settings/` 的那个**。
   写成前者，值读得出来、却毫无作用。
2. **写对了也没用**：实测 Godot 4.7.2（headless / 窗口模式都一样），
   把值设成 `100 / 500 / 10000 / 100000`，递归都卡在**2047 层**报
   `Stack overflow. Check for infinite recursion in your script.`
   —— GDScript 的递归硬上限 ~2048，跟这个设置无关。

**结论**：K4 里上千层的递归搬到 Godot 会爆栈，靠设置解决不了。
真要支持得做**尾递归改写**（`if 条件: return f(新参数) else: return 终值`
→ `while 条件: 参数 = 新参数` 再 `return 终值`）—— 列进待办。

### 11. 属性是**数字索引**，不是中文名

`get_3` / `get` 的 `attribute` 字段存的是**下标**：

```
get_3: ["x","y","style_index","sensing_direction","style_name","size","volume",
        "color","transparency","brightness","pixelate","wave","twist","grey","ascii","speed"]
get  : 同上，只有下标 3 是 "rotation" 而不是 "sensing_direction"
```

我们以前的 `_读属性` 只认中文名/英文名，**数字进来的全落到 `return 0.0`** ——
于是「<射击手> 的方向」恒等于 0，**炮口方向整个歪掉**（用户实测）。

### 12. 字段名对不上的那几处（最容易被误判成"功能没实现"）

| 块 | 真字段名 | 我们原来读的 | 症状 |
|:---|:---|:---|:---|
| `get_mouse_info` | **`position`** | `scope` | 「鼠标 y」永远变成「鼠标 x」→ `移到x_y(鼠标x-20, 鼠标x)`，角色**只能沿 y=x 对角线动** |
| `mirror`（克隆） | **`sprite`** | 读都没读 | 「克隆 子弹」变成「克隆自己」→ **点了鼠标什么也射不出去** |
| `self_change_effect_3` | 值在 **`shadows.steps`** | `val`/`value` | 增量恒为 0，"增加特效"等于没做 |
| `set_layer_with_pen` | **`position`** = above/below | 当成没参数的桩 | 积木完全无效 |
| `image_stamp` | 无字段 | 没映射 | 整块掉成"参数没解析出来"的桩 |

**共同点**：K4 的字段名和 Scratch 老版/直觉都不一样，而**读不到时反编译器不报错**，
只会静默用默认值 —— 看起来像"某个功能没实现"，其实是**参数被换掉了**。
定位只要一句：`node _dev/probe_block_raw.js <工程.bcm4> <块类型>`，看原始 JSON。

### 13. 画笔层：透明、烘焙、印章

- **画笔层必须是透明的。** `屏幕绘制._draw()` 以前无条件
  `draw_rect(舞台矩形, 舞台底色, true)` —— 等于在画笔层上盖了张不透明白纸，
  而画笔层排在舞台层（背景板）之后，于是**背景图全被盖掉**
  （`射击生存` 的"背景图片消失"就是这个）。
- **烘焙**（`屏幕绘制` 里的 `_烘焙()`）：指令数组只增不减，超过 1200 条就借一个离屏
  `SubViewport` 把「底图 + 全部指令」重画一遍，`await RenderingServer.frame_post_draw`
  之后取 `get_texture().get_image()` 当新底图，再清空指令。
  这是"清晰 + 可整层擦除"和"内存/每帧开销不涨"之间的折中。
- **印章有两套语义，别混**：

  | | 图片印章（`图章` / `image_stamp`） | 文字印章（`文字图章` / `stamp`） |
  |:---|:---|:---|
  | 位置 | 盖上去就不动 | 同左 |
  | 长宽 | 继承角色的大小 | 用传入字号 |
  | **旋转** | **不继承** | **继承调用它的那个角色** |
  | 颜色 | **原纹理色**（不继承任何特效/透明度） | **该角色自己的画笔颜色** |

- **「移到画笔图层 上/下」**：`set_layer_with_pen` 的 `position` = above/below。
  用 z_index 表达（`舞台层 = -100`、`画笔层 = 0`、`角色 = 0` 靠树顺序在画笔之上，
  below 取 `-50` 正好卡在画笔之下、背景之上）。
  这一层**只动 z_index，不动树顺序** —— 树顺序归「移到图层 / 图层前后移」管。


### 14. 诊断时踩的坑：`--quit-after` 在 headless 下**不可靠**

查 `射击生存` 的"卡"时被它带偏了很久：

```
godot --headless --path <工程> --quit-after 400      # 14 秒，正常
godot --headless --path <工程> --quit-after 500      # 12 秒，正常
godot --headless --path <工程> --quit-after 550      # 跑了 5 分钟没退
```

看着像"550 帧左右性能崩溃"。但加 `--print-fps` 一看：

```
Project FPS: 60 (16.66 mspf)      ← 一直是 60，一次都没掉
```

再换 `--fixed-fps 60`：

```
godot --headless --path <工程> --quit-after 1800 --fixed-fps 60    # 3.6 秒跑完
```

**1800 帧（游戏内 30 秒）只用 3.6 秒** —— 脚本层面根本没卡。
是**不带 `--fixed-fps` 时 `--quit-after` 的帧计数在 headless 下不跟着走**
（没有绘制，计数推进方式和窗口模式不同），所以它"不退出"，不是"跑不动"。

**教训（写进验证脚本约定）**：

- headless 自动化验证一律加 **`--fixed-fps 60`**。
  这样"帧数"和"游戏内时间"才可控 —— `等待 10 秒`、`每秒克隆 20 个` 这类积木
  会按固定步长瞬间推完，而不是真的等 10 秒挂在那里。
- 判"是不是卡"要看 **`--print-fps` 的 mspf**，别只看"跑完花了多久"。
- 真正要测和用户感知一致的性能，只能用**窗口模式** + 用户自己的 `FPS` / `处理` 读数
  （这一条和第三轮"别信 headless 计时"是同一个结论，又栽了一次）。

### 15. 第四轮修掉的字段/接线问题一览

| 症状（用户报的） | 根因 | 修法 |
|:---|:---|:---|
| `射击生存` **背景整个变白** | `屏幕绘制._draw()` 无条件铺白底，而画笔层排在舞台层（背景板）之后 | 画笔层**不铺底色**（它是透明层） |
| 点鼠标**射不出子弹** | `mirror`（克隆）块的 `sprite` 字段被忽略，一律生成"克隆自己" | 读 `sprite`：`__self` → `克隆自己()`，uuid → `克隆_角色("名字")` |
| **准星只在 y=x 这条线上动** | `get_mouse_info` 的字段名是 `position`，代码读的是 `scope` → 「鼠标 y」永远退化成「鼠标 x」 | 读 `position` |
| **射击方向是歪的** | `get_3` 的 `attribute` 是**数字下标**（"3" = 方向），而 `_读属性` 只认中文名 → 恒返回 0 | `_读属性` 同时认数字下标和名字（16 项全表） |
| 「增加特效」没效果 | 值在 `shadows.steps`，代码读 `val`/`value` | 加 `steps`；顺便把 `change_effect` 补进 `IR_METHODS`（之前只有 `ARG`，k 查不到 → 生成 `0.0`） |
| 「移到画笔图层 上/下」没效果 | `set_layer_with_pen` 只有 `position` 字段，整块没映射 | 映射成 `layer_with_pen` → `移到画笔图层`（z_index = ±） |
| 「角色印章」没反应 | `image_stamp` 没映射，掉成"参数没解析出来"的桩 | 映射到 `pen_stamp` → `图章()` |
| 「克隆体编号 / 数量」恒为 1 | 反编译器写死 `num(1)` | 走 `克隆体编号()` / `克隆体数量()`（`角色基类` 里已有真实现） |


---

## 第五、六轮：射击生存的三个真根因

用户的原话是"运行一段时间后会自己未响应(可能是什么无限循环,还会堵塞线程)"，
方向猜得很准。三个问题逐个查下来，都是**运行时库**的问题，不是转换器的。

### 16. 「跑一会就未响应」= `一步()` 在"已取消"分支上**不让出**（最值钱的一条）

```gdscript
func 一步(_ctx: WarpCtx) -> void:
	if _ctx._已取消:
		return          # ← 这里不让出：这一帧就永远结束不了
```

**死锁链**（`射击生存` 的克隆体正好会踩到）：

1. 克隆体跑 `删除克隆体()` → `k4_alive = false`，
   而 `自带积木.一步()` 开头就会 `if not k4_alive: _ctx._已取消 = true`
2. 但它**另一个**「当作为克隆体启动」协程还在 `while true: 移动; 一步()` 里转
3. 每次 `一步()` 都走进早退分支 → **立刻返回、永不让出**
4. `queue_free()` 要等**帧末**才真正释放节点 —— 而帧末永远不到 → **主线程被占死**

**为什么表现是竞态**（用户实测：一次卡在 110 帧、一次卡在 40 帧）：
取决于"删除克隆体"和"另一个协程恢复执行"的先后。

**为什么以前没暴露**：只有当**同一个角色有多个协程、其中一个把它删了**时才触发 ——
`射击生存` 的克隆体刚好有 2~4 个「当作为克隆体启动」脚本。

**修法**：被取消的协程也让出一次（`await get_tree().physics_frame` 再 return）。

**实测（Movie Maker + 注入鼠标点击 + 200 帧，同条件）**：

| | 真实耗时 |
|:---|---:|
| 修复前 | **223 秒** / 42.7 秒（两次跑，波动极大） |
| 修复后 | **17.5 秒** |

而且修复前**卡在点击2（99 帧）**，修复后**完整跑完点击0~6（191 帧）**。

### 17. 「子弹时好时坏」= 缺"克隆体出生那一帧不参与碰撞"

`射击生存` 的子弹出生在**射击手身上**（两者初始都在舞台中心 `(0,0)`），
而它有一份「当作为克隆体启动」是 `碰到角色 → 删除克隆体`。

**为什么时好时坏**（算一下就很清楚）：

- 子弹一帧移动 **50px**，自身半径 9.5px
- 射击手造型 300×300 × 59% = 178px，但**不透明部分**只有约 ±33px（橙翼）+ 右侧黑条到 +47px
- **朝上下飞** → 50px 后离开 → 活
- **朝左右飞** → 40.5~59.5 这段和射击手的不透明区重叠 → 判成碰到 → 自删

**所以能不能射出子弹完全取决于鼠标朝向。**

**K4 里为什么不会**：Scratch/K4 的克隆体创建后，drawable 要**下一帧**才建立，
在那之前 `touching` 一律返回 false（"刚出生的东西还不存在"）。
我们没有 drawable 这一层，所以少了这一帧。

**修法**：克隆体记一个 `k4_出生帧 = Engine.get_physics_frames() + 1`，
`碰到角色()` 在这之前直接返回 `""`。普通角色是 0，永不触发。

**实测**：子弹存活 **1/8 → 6/7**（剩下那个是刚出生还没移动的）。

### 18. `角色属性` 的实参顺序反了

`get_3` / `get` 的两个字段是 `sprite`（角色）和 `attribute`（属性，**数字下标**），
而方法签名是 `角色属性(属性, 目标)` —— **顺序正好相反**：

```
改前：角色属性("射击手", "3")   → "射击手"被当属性名、"3"被当角色名
                              → _目标节点("3") → 找("3") 找不到 → 返回 0.0
改后：角色属性("3", "射击手")   → ✓
```

**症状**（实测数据）：蓄力模式画的两条射线**关于"正下方"对称**，而不是关于射击手朝向对称：

```
轮5  射击手dir=60.6  左偏差=20.0
     线1 实际 K4 方向 = 81.1    期望 60.6+20 = 80.6  ✓（修好后）
     线2 实际 K4 方向 = 40.1    期望 60.6-20 = 40.6  ✓
修好前两条线是 26.5 / -26.5 —— 恒等于"正下方 ± 偏差"
```

顺带：`射击生存` 里的炮弹方向也是这个式子，所以修之前**炮弹永远朝正下方飞**。

### 19. 教训：我自己的探针把 K4 方向换算写错了，白怀疑了一轮

排查射线方向时我在探针里写了 `≈K4方向 = -屏角`，于是算出来"差 90°"，
一度以为方向公式坏了。**正确换算是 `K4方向 = 90 - 屏角`**
（K4 方向 90=右 / 0=下 / 180=上，从"下"开始逆时针；屏幕坐标 y 向下）。
改对之后立刻发现射线**一直是对的**。

**教训**：量工具本身也要先验证 —— 同一帧内读"鼠标坐标 / 换算出来的方向 / 角色实际方向"
三个值做自洽性检查，比事后猜要快得多（实测三者差 **0.0**）。

### 20. 关于包围盒碰撞 vs 像素级

一直挂着的那条"像素级碰撞"这轮做了一半：`碰到角色()` 加了 **alpha 掩码比对**
（只在包围盒已经相交时才做，掩码按**贴图 RID** 缓存）。

但用户实测后说"碰撞先不用改" —— 因为**真正卡住行为的不是精度本身，而是上面第 17 条**
（克隆体出生保护）。围盒碰撞对 `射击生存` 的其它判定（敌人碰到就消失等）都够用。

所以现状是：**`碰到角色()` 已经是像素级**，`碰到(目标)` 还是包围盒。
要全量对齐 K4（渲染器空间索引 + 逐像素）才需要上 `Area2D` + 凸包，那条列进待办。


---

## 第七轮：画笔颜色家族 + 收尾复核

### 21. 画笔颜色一共 5 个块，我们只接上了 2 个

K4 的编译目标（`kitten.*.js` 里那张 `t.register` 表）：

| K4 块 | 编译成 | 我们原来 | 现在 |
|:---|:---|:---|:---|
| `self_set_pen_color` | `set_brush_color_to` | ✓ 设置画笔颜色 | 不变 |
| `self_change_pen_color` | `add_brush_color` | ❌ **没映射 → 桩** | `增加画笔颜色` |
| `self_change_pen_shade` | `add_brush_brightness` | ❌ **没映射 → 桩** | `增加画笔明暗` |
| `self_set_pen_color_property` | `set_color_property(scope, 值)` | ❌ **没映射 → 桩** | `设置画笔颜色属性(项, 值)` |
| `self_change_pen_color_property` | `change_color_property(scope, 步)` | ⚠ 错映射成 `pen_change_color`，和「增加画笔颜色」**抢了同一个签名** → `scope` 被截掉、只剩增量 | `增加画笔颜色属性(项, 值)` |

**`scope` 的取值**实测是 `"hue"`（值域 0~360，`fields.scope`），
另外三个按 Scratch 的画笔颜色属性命名：`saturation` / `brightness` / `transparency`。

**实测效果**：`画笔和嵌套循环测试` 里那句 `设置画笔颜色属性(hue, 随机0~359)`
以前是桩，整条曲线**纯红**；接上之后变成**紫→黄→青→橙→品红**的渐变螺旋。
`_out/画笔和嵌套循环测试` 转换报告里的那条 `self_set_pen_color_property` 桩也随之消失。

顺带删掉了模板里那个同名的 `设置画笔颜色属性(_参数)` 桩 ——
**同名函数会冲突**，真实现补上之后必须一起删。

### 22. `新的作品` 的"卡顿"是虚惊

用户报"明显卡顿"，量下来：

```
节点 23   对象 1550   画布指令 0        ← 结构极简
慢帧：帧 1 = 25ms，帧 389 = 464ms
```

**帧 389 那个 464ms 是探针自己的 9000 层递归爆栈测试**（就是 §10 那条已知的
Godot 2047 层上限），不是游戏的问题。用户重跑一次后确认"流畅了"。

**教训**：探针本身会污染性能测量 —— 递归测试、鼠标注入、克隆测试都很重，
要量帧时间就得把它们关掉，或者把采样点放在它们之前。

### 23. 本轮（第五~七轮）非大型测试例的最终状态

七个工程全部重新转换 + `--fixed-fps 60` 跑 600 帧：

| 案例 | 耗时 | 状态 |
|:---|---:|:---|
| 函数返回值尝试 | 1.8 秒 | ✅ 0 错误 |
| 克隆体测试 | 7 秒 | ✅ |
| 画笔和嵌套循环测试 | 2.4 秒 | ✅ 桩已清零 |
| 碰撞测试 | 2.1 秒 | ✅ |
| 射击生存 | 4.9 秒 | ✅ |
| 新的作品 | 2 秒 | ✅ |
| 画笔图层与印章测试 | 2.7 秒 | ✅ |

**已知遗留（都不挡路）**：
- `射击生存` 的转换报告里有一条**桩名显示为空**（`桩（待你在角色类里实现）: `）——
  是 `report.stubs` 的键没兜住空 `type`，属于**报告格式**问题，不影响生成物。
- 图形特效 `0 颜色` / `1 鱼眼` / `2 漩涡` / `3 像素化` / `4 马赛克` 需要 shader，仍是明确留桩。
- `碰到(目标)` 还是包围盒；`碰到角色()` 已经是像素级（见 §20）。


---

## 第八轮：画笔颜色改成 HSL + 填充路径 + 像素确认的预算闸

### 24. ★K4 的画笔颜色是 HSL，不是 HSV★（用户指出）

`hmax 360 / smax 100 / lmax 100 / alphamax 100`。
K4 源码里也有旁证：`_hueToHex(h)` 里写死 `s=1, l=0.5` —— 纯色相 + 满饱和 + 中亮度。

**我原来用的是 `Color.from_hsv`** —— 「设置画笔 亮度 50」被当成 HSV 的 V，
而 K4 的 **L=50 是中灰、V=50 是暗色**，整整差一档。

改成 HSL 之后还有个坑：

**⚠ Godot 4.7 的 `Color` 没有 `from_hsl`（只有 `from_hsv`）**
```
Parse Error: Cannot find member "from_hsl" in base "Color".
Parse Error: Function "from_hsl()" not found in base Color.
```
而且这个错**会让整个 `角色自带积木.gd` 编译失败** —— 五层继承链全断，
所有角色脚本一起报 `Could not resolve class "角色类"`，
**看起来像"转换器把继承链写坏了"，其实是一个不存在的方法。**

→ 自己实现 `_hsl到rgb()`（标准算法），并且**必须自己维护 h/s/l/a 四个分量**
（Godot 的 `Color.h/s/v` 是 HSV，转不回无损的 HSL）。

### 25. 画笔颜色家族的字段真值（扫了全部 bcm4）

用 `_dev/probe_pen_fields.js` 扫**所有**样本（含大型项目，只读不转换）：

```
self_set_pen_color_property      scope = alpha (16次!) / brightness (2) / hue (1)
self_change_pen_color_property_2 scope=hue, increase=increase
set_fill_style                   color  = #D4F566 / #FFFFFF
set_pen_path                     point  = start_point / end_point
self_set_pen_color               color  = #000000 (18次) / #FF0000 / #FFFFFF …
self_set_pen_size                fields = {}   ← 值在 shadows.size
```

**三个要点**：
1. 用得最多的是 **`alpha`**（16 次），不是我猜的 `transparency`
2. 「将画笔 X 增加/减少 N」的**加减号在 `increase` 字段里**（和「把特效增加」同一个套路），值一律正数
3. **`set_pen_path` 的 `point` 是 `start_point` / `end_point`** —— 这不是"画笔路径"，
   而是**填充多边形的起止**（K4 源码：`start_point` → `begin_path`，否则 → `close_path`）

### 26. 五个块全部接上 + 填充路径

| K4 块 | 我们 | 状态 |
|:---|:---|:---|
| `self_set_pen_color` | `设置画笔颜色` | ✅（改成从 RGB 反推 HSL） |
| `self_change_pen_color` | `增加画笔颜色` | ✅ 色相偏移 |
| `self_change_pen_shade` | `增加画笔明暗` | ✅ **新增**（以前整块没映射） |
| `self_set_pen_color_property` | `设置画笔颜色属性(项, 值)` | ✅ **新增** |
| `self_change_pen_color_property` | `增加画笔颜色属性(项, 符号, 值)` | ✅ **新增**（以前错映射成「增加画笔颜色」，scope 被截掉） |
| `set_fill_style` | `设置填充(颜色)` | ✅ **新增**（以前没映射） |
| `set_pen_path` | `设置填充路径(起点/终点)` | ✅ **新增** |

**填充路径的实现**（`屏幕绘制.gd`）：「起点」之后进入路径模式，
角色**每移动一次就记一个点（不需要落笔）**，「终点」闭合 + `draw_colored_polygon` 填充。
`_移动后()` 里用 `elif k4_canvas.call("路径中")` 接的，所以落笔和填充两条路互不干扰。

### 27. 碰撞：**不要**统一到像素级（附实测）

用户问"统一到像素级会不会有性能问题，更差就不做"。实测（`射击生存`）：

```
包围盒() 单次        =  0.70 微秒
碰到角色() 单次均价   =  0.70 微秒   ← 稀疏场景，包围盒预筛把像素比对全挡掉了
_掩码相交() 单次      = 10.74 微秒   ← 像素级确认的真实成本（贵 15 倍）
最坏情况：512 个克隆体两两都比像素 ≈ 2.8 秒/帧
```

**结论：不统一。** 像素比对比包围盒贵一个数量级，密集场景会从"能跑"直接掉到"冻帧"。

**但这个测量同时暴露了我自己引入的风险**：`碰到角色()` 现在带像素确认，
在 512 个克隆体挤在一起的场景（`大陆漂移学说` 那种）里同样会炸。
所以加了一道 **`K4_帧像素确认上限 = 300`** —— 和 `K4_帧warp预算` 同性质的"本帧配额"：
用完就**退回包围盒结论**（即像素级之前的老行为）。
300 × 10.74 微秒 ≈ 最坏 **3.2 毫秒/帧**，有界。

顺带把像素比对从 `Image.get_pixel()`（GDScript 里的变参调用，开销大）
换成**直接按字节索引 `PackedByteArray`**（`(y*宽+x)*4+3` 读 alpha）。

### 28. 本轮结束时七个非大型测试例的状态

全部重新转换 + `--fixed-fps 60` 跑 600 帧：**0 error / 0 parse fail / 桩已清零**
（`射击生存` 报告里那条空的桩名是 §23 记的报告格式问题，不影响生成物）。

---
---

# 第九轮之后：一批架构级改动

> ⚠ **这一段之后有若干轮改了生成工程的架构**（主场景、屏幕切换方式、造型节点结构）。
> 旧产物请**重新转换**，不是重新导入。

## 第十轮：计算积木 / 询问并选择 / 滑行坐标（Phigros 查表带出来）

| 块 | 以前 | 现在 |
|:---|:---|:---|
| 「计算 <算式>」`calculate` | 两张表里都没有 → 取值生成裸 `0.0`（Phigros 16 处） | `op('calculate')` → `自带积木.计算()` → `角色基类._k4算式求值()`（Godot `Expression` + K4 语法归一；**三角函数按度**：`sin/cos/…` 换写成 `k4sin/…`） |
| 「选择的选项 / 选项序号」`get_choice`·`get_choice_index`·`get_choice_or_index` | 走 unknown → `0.0`；序号恒 0 | 迁到 `OP_METHODS`，产出 `op('get_choice')`；运行时 `k4_选项内容 / k4_选项序号` |
| 「询问并选择」的选项 | **写死只取 CHOICE0/CHOICE1**，第 3、4 个选项静默丢掉 | 按 `inputNames` 收 `CHOICE\d+` 并**按序号排序**（避免 CHOICE10 排到 CHOICE2 前） |
| 「滑行坐标」`self_glide_coordinate` | 挂错路径（`value()`）→ 只生成类型层桩，角色纹丝不动 | 挂到 `stmt()`，4 个实参（轴/方向/时间/值）；实现 `Tween + await tween.finished` |
| 「当前场景」孪生块 `get_sensing_current_scene` | 落 `'0.0'` → 比较恒假 | → `K4Global.当前屏幕` |

## 第十一轮：查表 / 积木对照作品带出来的一大批接线 + 若干新机制

**新机制（跨文件，改动时要注意联动）**

| 机制 | 实现 |
|:---|:---|
| **角色组 → Godot group** | `theatre.groups` → `ent.groups` → 角色脚本 `add_to_group("K4组_…")`；运行时 `实体节点们()` 用 `get_nodes_in_group` 取整组。★目标选择器先当**角色名**找、找不到再当**组名**★ |
| **阵营** | `K4阵营_红/绿/蓝` group（单选：先清后加；K4 界面上的"绿色"在数据里是 `camp_yellow`） |
| **声音双索引** | `K4Global.声音顺序` 表 + `_取声音(名/编号)`；`停止声音(名)` 只掐匹配的那个 |
| **屏幕转场** | 转场层挂在 `K4Canvas`（autoload，跨场景存活）；「设置屏幕切换特效」只是**设置下一次**用什么 |
| **声音侦测（麦克风）** | 新 autoload `K4Voice`（`AudioEffectCapture` + RMS→0-100）；`project.godot` 打开 `driver/enable_input=true` |
| **滑动帽子** | `hat:swipe` + `帽子_滑动.gd`（四方向；桌面可用鼠标拖拽模拟） |
| **点击帽子三档** | 生成器补 `_配置点击事件()` / `_配置监听角色()`（以前 core 读出来了、生成器没用） |
| **跨角色变量 / 属性** | 角色脚本 `_K4原名()` / `_变量别名()`；`角色基类._解析变量名()/取值()`；★`角色属性` 的属性是**数字索引**（0=x…15=speed）★ |
| **分裂 vs 克隆** | `clone` 块 = **分裂**（`duplicate` 出普通角色、`k4_is_clone=false`、不跑克隆帽子）；`mirror` 块才是克隆体。★顺序坑：先 `add_child` 再搬状态★ |
| **广播真的发出去** | `角色基类.广播()` → `K4Bus.发信号`（以前 emit 只生成注释 + DO 体，"发广播"这个动作丢失） |

**新接线的积木（摘要）**：时间族（星期/时/分/秒）、`touching_pair`（两个目标都可以是组）、`bump_into_color`、`out_of_boundary`（★「离开边缘」以前错映射成"碰到边缘"★）、`orientation`（屏幕方向）、`voice_volume`、`running_device`、`get_answer`、云列表增删改查 / 排行榜 / 用户名 / 在线用户数、显示隐藏变量/列表、翻译、设置角色阵营 / 可拖拽 / 旋转模式、抖动、围绕旋转、新建对话框、增加宽高缩放、显示隐藏实体（目标可为组）、**图层四档**、`stop` **四档**、`set_scene_transition`。

## 第十二轮：await 精确化 + 广播链三个真 bug + 旧问题清理

### ① 不再无脑 await

以前生成器对**所有**积木方法调用无条件 `await` —— 语义错（把"不等待"的积木变成协程调用）、`REDUNDANT_AWAIT` 噪声，而且"函数体里有 await ⇒ 这个函数也是协程"会**一路传染**上去。

现在：新增 **`lib/k4/async.js`** —— 扫 `runtime/**/*.gd`，按缩进切函数、**剥掉字符串与注释**后检测 `await`、建调用图做传染闭包；`emit.call()` 只对**集合里**的方法写 await；自定义积木走 `Emitter.过程是协程()`（递归 + 环检测，找不到定义时保守 await）。方法表里的 `await:true` 降级为"声明"，并与实现**交叉校验**（不一致写进 `积木映射.json` 的 `await声明不一致` + 转换日志）。

顺带修：`进入warp/退出warp` 是同步函数 → 去掉多余 await；`切换屏幕` 是协程 → **补上**以前漏掉的 await；自动补的桩不再假装协程（改成同步 `pass`）。

实测效果（`射击生存`）：`角色.显示()` / `角色.播放声音("光束4")` / `角色.移动_步(角色.转数字(角色._v_速度))` 不再 await；`await 角色.等待_秒(ctx,0.2)` / `await 角色.一步(ctx)` / `await 角色.广播并等待(...)` 保留。

### ② 广播链三个真 bug（`广播测试.bcm4` 实测出来的）

| # | 症状 | 根因 | 修法 |
|:-:|:---|:---|:---|
| 1 | **广播根本收不到** | 生成器写 `_配置消息()`，而 `帽子_广播` 读 `@export var 消息`（tscn 里也没有）→ `消息 == ""` → 监听从没注册 | `_注册监听()` 优先读 `_配置消息()`，`@export 消息` 留作兼容 |
| 2 | **「广播并等待」其实没等** | `K4Bus.发信号并等待` 在 `emit_signal` **之前**就取协程句柄（帽子还没启动）；`帽子_广播` 又把基类正确的 `await _跑完` 覆写成 `await 启动()`（启动是同步点火） | 先广播 → 让出一帧 → 逐个 `await 目标._等本轮跑完()` |
| 3 | **同帧早到的广播会丢** | 各帽子 `await process_frame` 续体同帧按顺序恢复：靠前的角色先广播，靠后的角色还没 `_已启动` | 注册提到 `_ready` 最前面；事件早到就记 `_待触发`，由基类新增的 `_补触发()` 补上 |

实测（`广播测试 (1).bcm4`，两个接收方抖动 **1 秒 / 3 秒**）：
`执行=1 @1.050s → 执行=3 @3.050s → 执行=2 @4.083s` —— 等待时长由**最慢的接收方**决定
⇒「广播并等待」等的是**所有**接收方；接收方里若套不让出的无限循环，发送方会一直卡住（与 K4 一致）。

### ③ 旧问题清理

- **同名 `case` 死代码**（`core.js` 的 `expr()`/`stmt()` 里 16 组）：删掉不可达副本；两处"藏着更对逻辑"的**合并到先命中的位置** —— `self_set_position`（有 `coordinary` → 单轴，否则双轴）、`get_current_costume`（有 `style_id` → 解析成造型名，否则当前造型）。
- **`this.relax` 只写不读**（机制断线）→ 改造成**真正生效**的实参类型校正：按形参声明在生成期包 `角色.转文本()` / `角色.转数字()` / `角色.为真()`。
  ★必须用 K4 的 `转文本`：`转文本(3.0)` = `"3"`，而 Godot 的 `str(3.0)` = `"3.0"` —— 造型编号/列表序号这类"数字当名字用"的地方差一个 `.0` 就匹配不上★。
- 删死代码：`report.calls/stats`、`num()`、`nextId()`、`esc()`、`Tscn.head`、`K4Bus` 的计数 API。

## 第十三轮：custom（造型）的嵌套输入被吃掉

症状：4 个「切换到造型」生成出来**一模一样**（全是 `设置造型("新角色")`），其中三个本该是嵌套表达式。

根因：`index` 输入有两种形态，旧代码只认第一种、而且顺序反了：

| 形态 | `index` 连到 | 应该生成 |
|:---|:---|:---|
| 下拉框 | **造型选择器影子**（`is_shadow=true` + `style_id`） | 造型名 |
| 嵌套表达式 | **真实功能块**（`get_3` 角色属性 / `math_arithmetic` / 变量） | 那个表达式 |

第二种情况下 K4 **仍然**在 `shadows.index` 的 XML 里留着一份创建时的默认 `style_id` —— 旧代码找不到"影子 id 指向的真实块"就退回去读它，于是三个嵌套块全被替换成默认造型名（静默错位）。
修法：先判 `index` 连的是不是真实功能块 → 是就用 `expr()` 生成表达式；否则才走"造型名解析"。

## 第十四轮：游戏屏幕容器 + 帽子屏幕限定 + 「当切换到当前屏幕」

### ① 帽子整块丢失

K4 的块类型是 **`on_running_group_activated`**，`HAT_TYPES` 里**没登记** → 它既不是帽子也不是已知语句，脚本根本不生成。
补齐三处：`core.js HAT_TYPES`（kind `screen`）、`methodtable HATS`（`hat:screen` → `帽子_屏幕切换`）、`emit.js HAT_KEY/HAT_LABEL`。

### ② 游戏屏幕容器（用户指定的做法）

转换后在 `全局/` 生成 **`游戏屏幕.tscn`**，把所有屏幕场景**按 K4 屏幕顺序**实例进去、只显示第一个；`project.godot` 的 `run/main_scene` 指向它：

```
全局/游戏屏幕.tscn                ← 主场景
  └─ 游戏屏幕 (Node2D + 全局/游戏屏幕.gd)
       ├─ 背景      (背景/背景.tscn 实例)        visible = true
       └─ 背景_1_   (背景_1_/背景_1_.tscn 实例)  visible = false
```

- `runtime/全局/游戏屏幕.gd`（新）：`_ready` 里登记容器 + 切到 `K4Global.屏幕顺序[0]`。
- `K4Global` 新增：`signal 屏幕切换(名)`、`游戏屏幕`、`屏幕节点{}`、`屏幕顺序[]`、`登记屏幕()`、`屏幕是否当前()`、**`切换屏幕到()`**（只改 `visible` + 当前屏幕名 + `K4Canvas.画布` 指向该屏幕的 `屏幕绘制`，**不再 `change_scene_to_file`**）。
- 屏幕根脚本改为 `K4Global.登记屏幕(名, self)`，**不再抢着设 `当前屏幕`**（容器里所有屏幕都会 `_ready`，谁最后跑谁覆盖 —— 老实现就是这么错的）；没走容器时（单独 run 某个屏幕场景）有兜底。
- 好处：切屏**不销毁**另一组的状态（变量/克隆体/角色位置都留着，这就是 K4 的运行组语义），也才有"广播按屏幕隔离"的前提。

### ③ 帽子屏幕限定（用户确认的语义）

> 除「当开始被点击时」「当作为克隆体启动时」外，**全是仅限当前屏幕执行**的帽子。

实现：`帽子基类` 新增 `_屏幕无关()`（默认 false）+ `_本屏幕当前()`，在 **`启动()` 一处统一拦** —— 按键/点击/滑动/条件/计时器/响度/背景/广播/屏幕切换全都走 `启动()`，一处覆盖。
`帽子_开始` / `帽子_克隆启动` 覆写 `_屏幕无关() → true`（点绿旗时各屏幕自己的绿旗脚本都要跑）。

### ④ 屏幕身份判定（踩了两个坑，很重要）

`屏幕根()` = "本节点属于哪个屏幕"，广播分屏和屏幕限定都靠它。规则：
① 向上找**已登记的屏幕节点**（`K4Global.屏幕节点` 里的那个）；② 还没登记时退回结构判断（游戏屏幕容器的直接子节点 / root 的直接子节点）。

- 坑 1：只按"root 的直接子节点"找 → 屏幕场景挂在别的节点下时对不上，`屏幕是否当前()` 恒 false，**所有帽子被误拦**。
- 坑 2：**不能缓存**结果 —— 帽子的 `_ready`（注册监听）早于屏幕根脚本的 `_ready`，那一刻屏幕还没登记，算出来的是上层节点；缓存下来会让该帽子**永远**判成"别的屏幕"（实测：接收方收不到广播、计数一直 0）。
- 因此广播分屏改为**每次广播时实时问**监听者的 `_屏幕根()`。

## 第十五轮：屏幕生命周期（非全局帽子「即走即取消；切回所在屏幕重新开始」）

起因：`琪露诺的最强刨冰` 切屏后帧时间爆炸（FPS 2、处理 1765ms、节点峰值 22481）。该作品有 **14 个「当切换到当前屏幕」帽子是常驻 `while true`**（其中几个每轮 `克隆自己`）；旧实现只在 `启动()` 时拦一次，**切走不会停已经在跑的协程** → 每切一次屏就多一套脚本叠加。

| 环节 | 实现 |
|:---|:---|
| **取消** | `帽子基类.取消运行()`：`_ctx._已取消 = true` + `_结束运行()`（把 `_运行中` 落回 false 以便切回能重开，并 emit `_跑完` 唤醒正在「广播并等待」的发送方）；`_屏幕无关()` 的（绿旗/克隆启动）直接跳过 |
| **重开** | `帽子基类.屏幕激活()`（默认空）；`帽子_屏幕切换` 覆写为 `启动()` |
| **驱动** | `K4Global.切换屏幕到()`：切走前 `_通知屏幕(旧, false)`、切换后 `_通知屏幕(目标, true)`；遍历用 `find_children("*","",true,false)`（`owned=false` 才能覆盖运行时克隆出来的节点） |
| **★真正生效的地方★** | `一步()` 在 `_已取消` 时只是"让出一帧再返回"，**循环会接着跑下一轮**（实测：切走后计数还在涨）。GDScript 没有取消协程的原语 → **生成器在每个循环末尾补 `if ctx._已取消: break`**（forever / repeat / repeat_until / wait_until 共 5 处）。顺带修好「停止 [这个脚本]」（同一条链，以前也停不下来） |

## 第十六轮：列表初值 / 大列表外置 / customs 改 AnimatedSprite2D

### ① 列表初值（真 bug）

`全局变量.gd` 里全局列表一律生成 `var _l_x: Array = []` —— K4 里带的初值（`[1,"a",2,"b",3,"c"]` 这种数据表）**整个丢掉**（角色局部列表本来就在 `_ready` 里赋值，是好的）。现在小列表内联、超长的走外置。

### ② 超大列表外置（复用超长文本那一套）

超过 `TEXT_FILE_LIMIT`（1024）字符的列表初值落到 `<目录>/文本/列表N.txt`，内容用 **JSON**（列表项有数字也有字符串，按行存会把 `1` 和 `"1"` 混掉）：

```gdscript
var _l_全局列表: Array = []        # 初值太长，_ready 里从外置文件读
func _ready() -> void:
    _l_全局列表 = K4Text.读取列表("全局/文本/列表1.txt")
```

运行库 `大文本.gd` 新增 `读取列表()`（与超长文本同一份缓存，只读一次盘；解析失败报错一次并返回空数组）。
> 导出提醒同超长文本：`.txt` 不是 Godot 资源，导出 exe/apk 要在「资源 → 导出非资源文件」的过滤器里加 `*.txt`。

### ③ customs：每造型一个 Sprite2D → 一个 AnimatedSprite2D（用户要求的优化）

```tscn
[sub_resource type="SpriteFrames" id="SpriteFrames_1"]
animations = [{ "frames": [{"duration":1.0,"texture":ExtResource("1")}, …每造型一帧…], "loop":true, "name":"default", "speed":5.0 }]

[node name="customs" type="AnimatedSprite2D" parent="."]
sprite_frames = SubResource("SpriteFrames_1")
animation = "default"
frame = 0                  # 当前造型 = 帧号
position = Vector2(…)      # 当前造型的 pivot 偏移（编辑器里也能看到正确排版）
```

★**pivot（旋转中心）偏移不能丢**★：SpriteFrames 的帧**不携带位移**，所以生成器额外写两张表到角色脚本，运行时切造型时套用：

```gdscript
func _造型顺序() -> Array:   return ["1", "a", "b", "(2)", "4"]
func _造型偏移() -> Array:   return [Vector2(0,0), Vector2(-0.3928, 1.0489), …]
```

`角色基类` 相应改造：`k4_costumes` 语义从「名 → Sprite2D 节点」变成「名 → **帧号**」，新增 `造型序号()` / `当前纹理()` / `造型纹理()` / `规范化造型名()`；`_收集造型()` 读上面两张表（★老产物"多 Sprite2D"结构仍走兼容分支★）；`_应用造型()` = 设 `frame` + 套 `position`。
`自带积木.gd` 里所有"取当前造型纹理"的地方统一走 `当前纹理()`：`包围盒()`、`_取掩码()`、`_掩码相交()`（改收**节点**、内部取纹理）、`图章()`；`下一个造型()` / `_按编号设置造型()` 改走 `_造型名表`。

**节点收益**（`琪露诺` 实测：51 角色 / 172 造型）：`AnimatedSprite2D` 节点 53 个、造型 `Sprite2D` 子节点 **0** 个 → 静态就少 **172 个节点**；**克隆体**每个再少（该角色造型数 − 1）个节点，密集克隆场景收益成倍。

## 第十七轮：切屏最小案例实测 + 克隆体不响应「运行组被激活」

用 **`切屏测试_custom优化测试.bcm4`**（2 屏幕 / 计数器 / 克隆体 / 造型轮播 / 列表）跑 **14 项断言全通过**：
切进→开始跑、切走→**立刻冻结**（计数器与节点数都不再变）、切到另一屏→它开始跑且可见性正确、切回→**重新跑一轮**（计数器被重置后再增长）、克隆体不泄漏、造型轮播、列表初值正确。

★**又挖出一个真 bug**★：`帽子_屏幕切换._ready` 的初始补触发**没排除克隆体** → 克隆体一出生就自己跑「当切换到当前屏幕」，于是：
- **自我复制**：`当切换到当前屏幕 → 克隆自己`，克隆体又克隆自己 → 屏幕1 节点数 **394 → 754**（这正是"切屏后帧炸"的又一贡献因素）；
- **全局计数器被反复清零**：每个克隆体都执行脚本开头的 `设置 屏幕1计数器 = 0`，把原体正在累加的值清零 → 观测上"计数器不涨"（卡在 2）。

修法（与绿旗 `帽子_开始` 完全对称）：

```gdscript
func _触发条件满足() -> bool:
    return 角色 != null and not 角色.k4_is_clone      # 克隆体不响应运行组激活
func 屏幕激活() -> void:
    if not _触发条件满足(): return
    启动()
```

## 第十八轮：按键功能重构（`全按键类型.bcm4`）

**症状**（用户报）：转换后的作品**按键没法用**。

**根因：`_配置键名()` 生成出来了、运行时却没人读 —— 断线**

生成器给每个按键帽子写的是：

```gdscript
extends 帽子_按键
func _配置键名() -> String:   return "KEY_Q"
func _配置按键事件() -> String: return "up"
```

而 `帽子_按键.gd` 的 `_input` 读的是 **`@export var 键名`**（场景里从没设过 → 恒为空串），
空串又被当成「任意键」→ **按任何一个键都会触发全部 41 个按键帽子**。
（用户的作品叫《全按键类型》，41 个键各一个帽子，症状就是"按什么都在乱触发"。）

**K4 的数据实况**（`_dev/probe_keys.js` dump 出来的）：

| 块 | 用途 | 字段 |
|:---|:---|:---|
| `on_keydown` | 帽子「当按下 X 键」 | `{"key":"81","key_event_type":"up"}` ← `key` 是**十进制 keyCode**（81='Q'、37=左方向）、`up`=松开 |
| `check_key` | 侦测「按下 X 键吗」 | 同上两个字段 |

**★键码陷阱★**：浏览器的 `keyCode` 与 Godot 的 `Key` 枚举**只有字母数字在 ASCII 上重合**
（65-90 / 48-57）。方向键、回车、Esc、Tab… 全都不同：浏览器 `13`=回车、`37`=左方向，
而 Godot `KEY_ENTER`=4194309、`KEY_LEFT`=4194319 → **必须查映射表，不能直接当 Godot 键码用**。

**重构内容**

| 改动 | 说明 |
|:---|:---|
| **新增 `runtime/全局/按键表.gd`** | K4 按键的**唯一解析真值**：`解析()` / `是任意键()` / `是已配置()` / `当前按下()` / `事件匹配()`。认全五种写法：K4 十进制键码、`KEY_Q`、`q`/`Q`、中文（空格/上/左/回车…）、`any`；并带完整的 **K4 keyCode → Godot Key** 表（含 F1-F12 / 编辑键 / 标点 / 小键盘） |
| **`帽子_按键.gd` 重写** | ① 先读 `_配置键名()`，没有才退回 `@export 键名`（接上断线）；② `_ready` 里**预编译**成键码，`_input` 只做整数比较；③ 同时比对 `keycode` 与 `physical_keycode`（不同键盘布局）；④ 键名空 / 认不出来 → **不触发**（不再退化成"任意键"） |
| **`自带积木.按键按下/松开`** | 改走 `按键表.当前按下()`（与帽子同一套真值）；删掉旧的 `_键码()`（它只认 `KEY_X`，且用 `OS.find_keycode_from_string` 模糊匹配） |
| **`core.js` 的 `keyCodeToName`** | 键码表从 12 项补到 60+ 项；认不出的数字键码原样传出，交给运行时查表 |
| **`帽子基类._触发次数`** | 每点火一轮 +1 —— 给**自动化验证**用（headless 里看不到画面，看计数就知道"这个键有没有触发这个帽子"） |

**验证**：`_dev/key_check.gd` **78/78 通过**（不需要人工按键 —— 直接构造 `InputEventKey` 调 `帽._input()`）：

- 41 个按键帽子全部键名解析成功、0 个"认不出来"；
- 36 种（键名 × 按下/松开档）组合，逐个发 down / up 事件，检查**实际触发的集合与期望完全一致**（不多不少）；
- 「任意键」帽子对任何键都触发，且不干扰具体键帽子的判定；
- **没配置键名的帽子不被任何键触发**（老实现这里会退化成"全触发"）；
- 键名解析 20 个样例：K4 原始十进制（`81`/`37`/`13`/`32`/`48`/`90`）、`KEY_X`、小写、中文、`f1`/`123`/`delete`。

回归：`新的作品` 0 error / 0 warning / 0 parse fail。快照：`_backup/20261006-210942_按键功能重构_按键表_全按键类型78项通过`。

> 按键的**真机手感**（长按自动重复、输入法/键盘布局、窗口焦点）只能人工确认 —— 自动化覆盖的是"哪个键触发哪个帽子"。

## 第十九轮：画笔作品验通（连接表 / 变量当列表 / 列表形参类型）

**起点**：`外部图片绘制.bcm4` —— 用「文字图章」逐像素把外部图片"画"出来。症状是"按 B 开始画，但画面一片空白"。

### ① 块的**真实连接**在 `connections`，不在 `shadows`

K4 的块**分两处存**：
```
theatre.scenes[<id>].block_data_json.blocks      ← 舞台的块
theatre.actors[<id>].block_data_json.blocks      ← 每个角色的块
```
每个块自己的 `shadows` 只是**建块时的默认值**（用户改过之后不再更新）；真正的"哪个槽连了哪个块"在：
```
block_data_json.connections[父块id][子块id] = {"type":"input","input_type":"value","input_name":"TARGET"}
```
实测：`lists_copy.euBY2BCkkjzfqNLyxM78` 的 `shadows.TARGET` 写着 `lists_get(rect_h)`（默认残留），
而 `connections` 里 `TARGET` 连的是 `variables_get(image_data)` —— **两者完全不同**。

> ⚠ 排查这类问题**别只看 `blocks[].shadows`**，否则很容易得出"K4 导出丢了信息"的错误结论（我这一轮就先走了这个弯路）。
> 探针：`_dev/probe_conn.js`（连接）、`_dev/probe_lists_blocks.js`（列表块对账）、`_dev/probe_blockdata.js`（结构总览）、`_dev/probe_find_uuid.js`（全树搜引用）。

### ② 列表积木的目标可以是**变量**（K4 的"变量当列表"）

`image_data` 是 `type=any` 的**全局变量**，值是一个数组；`复制 … 到 image_data` 的目标槽连的是
`variables_get(image_data)`，反编译出来是 `{k:'ref', name:'image_data'}`。
`listArgName()` 以前**只认 `{k:'listref'}`** → 掉到 `textish(ref) = null` → 名字变空 →
生成出**凭空多出来的 `角色._l_局部列表`**，整段数据被静默吞掉（画面自然是空白）。

修法（三处呼应）：
- `listArgName()` 认 `ref`（递归查找也扩到 `ref`）；
- `listName()` 在 lists 表查不到时**再查 vars 表**（该 uuid 只登记在 vars 里）；
- `emit.varRef()`：名字**登记在变量表、却不在列表表** → 按变量处理（`K4Global._v_image_data`），不再造局部列表。

### ③ ★方法表里列表形参的类型标错了（影响所有作品）★

「实参类型校正」（第十二轮加的）会按形参声明把实参包成 `角色.转文本(...)`。
而方法表里**所有列表类方法的"列表"形参都声明成 `'s'`（字符串）** → 生成出：

```gdscript
角色.列表添加(角色.转文本(K4Global._l_rect_x), 值)      ← 列表被转成了字符串！
```

**列表写操作（添加 / 删除 / 插入 / 替换 / 复制目标）全部失效**。这个作品正好把 68715 次 `列表添加`
打在这个坑上（`rect_*` 恒为空）。修法：列表形参改用新标记 **`'a'`**（Array/列表），而校正逻辑只处理
`'s' / 'f' / 'b'` → 自然跳过。方法表里 11 处 `['列表','s']` / `['目标列表','s']` 改成 `'a'`。

### 验证：整张图真的画出来了

`_dev/pen_check4.gd`（**必须非 headless**，脚本内 `get_viewport().get_texture().get_image().save_png()`）：

```
数据 68716 项 → load 用 1109 帧 → rect_quantity=68715、rect_x=68715 项
按 B 绘制    → 1538 帧画完（指令被"烘焙"机制烧成位图，所以 指令 数组只剩残余）
```

![完整绘制结果](_out/外部图片绘制3/_截图_完整.png)

（`_out/外部图片绘制3/_截图_完整.png`：1280×720 的动漫人物，由 `文字图章` 逐块拼出，
颜色来自「设置画笔颜色属性」的 HSL。）

回归：`切屏测试` / `新的作品` / `空白作品`(19MB) / `全按键类型` 全部 **0 error / 0 warning / 0 parse fail**。

> 顺带发现（未做）：这个作品的「当切换到当前屏幕」里用了 **`set_width_height_scale`**（将角色的宽度设置为…），
> 目前仍是未支持的桩；同一批还有 `switch_to_screen`（切屏）、`get_current_scene`（当前屏幕）。

## 第二十轮：custom 造型的「缩放」与"名称形参"类型（`印章custom测试.bcm4`）

用户给的判据很干脆：**"我在 K4 画板上把『头像』造型的缩放设为 0；如果转换后头像和 Z 字型一起出现在画面里，就是 custom 配置有问题。"**

### ① custom 造型的"缩放"是烘进 SVG 尺寸的 —— 内嵌位图抽取时丢了它

K4 数据里造型**没有独立的 scale 字段**（`theatre.styles` 里只有 `pivot` / `rotate_center` / `adaptive`）。
"在画板上把造型缩小/缩到 0" 是**烘进造型自身尺寸**的：

```
头像造型的 SVG: width="3px" height="3.5121951219512204px"     ← 只有 3 像素
```

而这个 SVG 是「外壳 + 内嵌位图」形态（`<image href="data:image/jpeg;base64,…">`），
转换器有一条**快速通道**：直接把内嵌位图抽出来当造型图（`SVG.抽取内嵌位图`）—— 但它
**只取原始位图、完全没管 SVG 声明的尺寸** → 头像变成一张大图挂在画面里 ✗

修法：抽取时**比对"SVG 声明尺寸 vs 位图实际尺寸"**（新增 `svg.js 读位图尺寸()`，认 PNG/JPEG/WebP 文件头）：

| 情况 | 处理 |
|:---|:---|
| 两者一致 | 走快速通道，直接抽取（省掉浏览器） |
| 不一致 | **不抽** → 交给浏览器光栅化，按声明尺寸渲染 |

实测：`印章custom测试` 的头像 → `头像.png` = **3 × 4 像素** ✓（以前是原始大图），
转换报告也变成"直接抽出内嵌位图 **0** 个、浏览器光栅化 **2** 个"。

### ② ★"名称形参"标成 `'s'` 又踩了一次同一个坑★

生成出来是这个：

```gdscript
角色.设置造型(角色.转文本(角色.随机整数(1.0, 6.0)))     ← 随机数被转成字符串 "5"
```

而 K4 的「切换到造型」**既能给编号也能给名字**（界面上显示 "1.骰子（1）…7.头像"）。
`设置造型()` 内部对**数字**走"按编号"、对**字符串**走"按名字匹配" —— 于是 `"5"` 去和
`"骰子（5）"` 比，永远匹配不上 → **造型根本没换**，印章用的还是上一次的造型
（实测：18 个印章里只有前 2 个是骰子，其余全是我脚本遍历时留下的"头像"）。

修法：方法表里这几处的"名称"形参 `'s'` → **`'v'`**（值可以是编号也可以是名字）：

| 积木 | 形参 |
|:---|:---|
| `设置造型` | `名称` |
| `播放声音` | `名称` |
| `播放声音并等待` | `名称` |
| `设置物理贴图` | `造型` |

（和第十九轮的**列表形参**是同一类错误 —— 「实参类型校正」按声明包转换，声明错了就会把
数字/列表/纹理这类**不该转字符串**的实参转掉。加新积木时务必核对形参类型。）

### ③ ★「移动」的上下与斜向全走反了（`自带积木.移动_步`）★

用户看完截图直接指出："**Z 方向不对**"。量化之后一目了然：

```
自检（修前）：方向 0   移动 100 → (0, -100)      期望 (0, +100)   ← K4 里 0 = 向上
             方向 225 移动 100 → (-70.7, +70.7)  期望 (-70.7, -70.7)  ← 225 = 左下
```

根因在 `移动_步` 把「K4 方向」换算成数学角时写错了符号：

```gdscript
var 弧 := deg_to_rad(k4_direction - 90.0)     # ✗ 反了
var 弧 := deg_to_rad(90.0 - k4_direction)     # ✓ 修后（与 角色基类._apply_transform 配套）
```

K4/Scratch 的方向约定是 **0 = 向上、90 = 向右、180 = 向下、顺时针为正**；
而那段代码上方的注释当年写成了"0 = 向下、180 = 向上"（实现者自己的约定）——
两个错误**互相自洽**，所以平时（水平/垂直移动）看不出来，一到**斜向**就暴露：
Z 字型的斜线本该"左下"，实际走了"左上"，整条 Z 上下颠倒。注释也一并改了。

> ⚠ 还留了一个**待人工确认**：`角色基类._apply_transform` 的 `rotation = deg_to_rad(90 - 方向)`
> 按 Scratch 约定（0 = 上、造型默认朝右）应当是 `方向 - 90` —— 也就是**角色朝向可能反 180°**。
> 无朝向的造型（骰子这类）看不出来，所以先没动；如果你在别的作品里发现"角色朝向不对"
> （例如子弹该朝上却朝下），告诉我，我把它一并改掉。

### 验证（`_dev/stamp_check.gd`，非 headless + 截图）

```
头像造型纹理 = 3×4 px ✓        18 条印章指令全部是骰子纹理(150×157) ✓
自检：方向 0 → y 正（向上）✓   方向 225 → 左下 ✓
位置：段1 y=208（上）→ 斜线 → 段3 y=572（下）✓
```

![印章 custom 测试（修复后）](_out/印章custom测试/_截图_印章_跑之后.png)

（`_out/印章custom测试/_截图_印章_跑之后.png`：18 个**随机点数**的骰子排成端正的 Z 字型；
"头像"造型按 K4 的设定缩到 3×4 像素，所以**没有**出现 —— 与 K4 画板一致。）

### ④ 工具：`_dev/regress.ps1` 四样本回归（以及一个静默的"验证错位"）

新增 [`_dev/regress.ps1`](_dev/regress.ps1)：串行跑 `新的作品` / `射击生存` / `空白作品b` / `切屏测试`，
每个样本走完整 `huanzhuang.ps1` 五步，日志落 `_dev/regress_log/<样本>.log`，末尾打印汇总表。

第一次跑就撞上一个**静默陷阱**：`convert.js` 用 `path.resolve` 解析输出路径 = 相对**当前工作目录**，
而 `huanzhuang.ps1` 第 2~5 步验证的目录是按**脚本所在目录**算的 —— 从项目根调用时，
新产物写到了 `<项目根>\_out\x`，验证跑的却是 `新版本\_out\x` 里**上一次的旧产物**：
输出"全绿"，但绿的是上一次的转换（`空白作品b` 甚至报 124 脚本 / 41 场景，那是该目录里旧的
19MB 空白作品留下的产物）。

修法：`huanzhuang.ps1` 转换前 `Push-Location $here`，并在转换后断言报告里的
"转换完成: `<路径>`" **就是**接下来要验证的那个目录（不一致直接报错，不再静默跑错目标）。

**重跑后的真实结果**（产物 mtime 22:42~22:45；把回归脚本也改好之后又整跑一遍，产物 22:48~22:52 —— 两次都核对过是当次转换）：

| 样本 | 规模 | 结果 |
|:---|:---|:---|
| `新的作品` | 1 屏幕 / 1 角色 / 2 帽子 | **0 error / 0 warning / 0 parse fail**（32 脚本 / 5 场景） |
| `射击生存` | 6 角色 / 12 帽子 / 克隆 / 碰撞 / 音效 | **0 / 0 / 0**（47 脚本 / 10 场景）。首跑出现过 1 条**既有**的 `2 ObjectDB instances were leaked at exit`（音频资源在强制退出时未释放），复跑 0 条 —— 与退出时机有关，**两次解析检查都是 0 失败** |
| `空白作品b` | 1 屏幕 / 1 角色 / 1 帽子 | **0 / 0 / 0**（31 脚本 / 5 场景） |
| `切屏测试` | 2 屏幕 / 2 角色 / 5 帽子 | **0 / 0 / 0**（39 脚本 / 8 场景） |

## 第二十一轮：广播重写（自己实现信号系统）+ 一个 Godot 的硬限制

用户要求把「广播」这块按"自己维护 Callable 数组、发射时逐个 await"重做。
重做中撞上一条 Godot 4 的硬限制，它直接决定了接口长什么样 —— 记在最前面。

### ① ★Godot 4 不允许"调用协程函数却不 await"★

第一版按最直觉的写法做：**监听者的回调本身**就是协程，发射方 `await cb.call()`：

```gdscript
func 发信号并等待(名, 屏幕=null) -> void:
	for cb in 回调们:
		await (cb as Callable).call()      # 看着很干净
```

跑起来立刻：

```
SCRIPT ERROR: Trying to call an async function without "await".
（两条 —— 正好是 c 里那两处「广播并等待」）
BCOORD [失败] 计数器=1.0  计数器d=1.0      ← 并等待当场失效
```

根因：K4 的**普通广播**语义是"发完就走、绝不阻塞发送方"（生成的 `角色.广播()` 是同步调用），
于是 `发信号` 里那行 `cb.call()` 就构成"调用协程但不 await" → 运行时报错。
**结论（接口被它定死）**：

| 角色 | 必须是什么 | 为什么 |
|:---|:---|:---|
| **触发**回调 | **同步函数**（函数体里不能有 await） | 普通广播要能"点火就走" |
| **等待**回调 | 协程 | 「广播并等待」要能 `await` 它 |

### ② 新接口：`K4Bus.监听(消息, 触发, 等待, 屏幕)`

```gdscript
# 帽子_广播.gd
func _注册监听() -> void:
	if 角色 != null and not 角色.k4_is_clone:  #k4特性
		K4Bus.监听(_消息名(), _收到广播, _等广播本轮跑完)

func _收到广播() -> void:       # 同步：点火（事件早到就记 _待触发，等 _补触发）
func _等广播本轮跑完() -> void:  # 协程：等这一轮真跑完
```

```gdscript
# 广播总线.gd
func 发信号(名, 屏幕=null) -> void:                 # 不等待
	for 项 in _可触发(名, 屏幕):
		(项["触发"] as Callable).call()

func 发信号并等待(名, 屏幕=null) -> void:           # 等待
	var 条目 := _可触发(名, 屏幕)
	var 等待们: Array = []
	for 项 in 条目:
		(项["触发"] as Callable).call()             # ★先全部点火（并行）★
		if (项["等待"] as Callable).is_valid(): 等待们.append(项["等待"])
	for w in 等待们:
		await (w as Callable).call()                # ★再逐个 await★（最慢的说了算）
```

**为什么不是"点一个等一个"**：K4/Scratch 的广播是**同时**启动所有接收方的；
边点火边等会把接收方串起来，总时长变成各自之和 —— 两个接收方抖 1s / 3s 时，
应当是 ~3s，串行会变成 ~4s（实测基线见下）。

屏幕隔离（**每次广播时实时**问监听者的 `_屏幕根()`）与"对象已释放就顺手清理"都保留；
整块仍然是自己维护 Callable 表，没有用 Godot 的 signal。

### ③ 验证

**A. 最小用例 `广播协调测试 (2).bcm4`**（检验脚本 `_dev/broadcast_coord_check.gd`）
a 连发 5 次「增加」、b 每次 +1 后抖 2 秒；c/d 一组走「增加d / 增加e」：

```
BCOORD 帧 1 (0.017 s)    计数器=1.0  计数器d=1.0
BCOORD 帧 122 (2.033 s)  计数器=1.0  计数器d=2.0
BCOORD [通过] 计数器=1.0（期望 1）  计数器d=2.0（期望 2）
```

- **计数器=1**：普通广播连发 5 次，而接收方正忙（抖 2 秒）→ 不重入，只 +1 一次
- **计数器d=2**：「并等待」真的等到了 d 跑完 → d 空闲后还能再接一轮

**B. 既有基线不变**（`_dev/broadcast_wait_check.gd`，两个接收方抖 1s / 3s）：

```
1.050 s → 执行 1 ； 3.050 s → 执行 3 ； 4.083 s → 执行 2      [通过]
```

与重写前**一字不差** —— "等所有接收方（最慢的那个决定何时继续）"的语义保住了。

### ④ 顺手把回归脚本做健壮 + 本轮全量回归

`_dev/regress.ps1` 的样本源改成**多候选 + 缺源跳过**：样本 `.bcm4` 常被手工挪走/删掉
（这次 `空白作品-28.bcm4` 就没了，旧脚本直接整轮崩掉），现在缺源只跳过它自己，
单样本失败也不再影响后面的样本。

**四样本回归（本轮改动后）**：

| 样本 | 规模 | 结果 |
|:---|:---|:---|
| `新的作品` | 1 屏幕 / 1 角色 / 2 帽子 | **0 / 0 / 0**（32 脚本 / 5 场景） |
| `射击生存` | 6 角色 / 12 帽子 / 克隆 / 碰撞 / 音效 | 0 / 1（既有音频泄漏，脚本已放行）/ 0（47 脚本 / 10 场景） |
| `空白作品b`（改用了备选源 `空白作品 (3).bcm4`） | 1 屏幕 / 0 角色 / 42 帽子 | **0 / 0 / 0**（71 脚本 / 4 场景） |
| `切屏测试` | 2 屏幕 / 2 角色 / 5 帽子 | **0 / 0 / 0**（39 脚本 / 8 场景） |

## 第二十二轮：画笔图层顺序 / 同帧克隆显示 / 文本族（`画笔图层与执行顺序测试 (1).bcm4`）

用户给的判据是他 K4 里跑出来的画面：

- 紫色大方块**包围**淡蓝、红、橙三个方块，**绿色方块因在紫色图层下方而不可见**
- 同一帧里，黑色方块在左侧是**一根黑色长条**（不是很短的一个方块）
- 上方出现蓝色 **365**（不是只有一个数字）

### ① 角色节点顺序取错了（影响所有多角色工程）

`core.js` 建"每个屏幕的演员列表"时：

```js
var aorder = Array.isArray(sc.raw.actors) ? sc.raw.actors : null;
if (aorder) { actors.sort(... aorder.indexOf(...) ...); }     // ← 空数组也是 truthy
```

K4 导出的 `scene.actors` **经常是空数组**，于是 `sort` 的比较函数恒返回 0，顺序退回
`theatre.actors` 的**字典键顺序** = **角色创建顺序**，跟真实图层毫无关系。

K4 真正的图层顺序在 **`scene.group_order`**（K4 把每个角色包在一个"图层组"里，
`theatre.groups[组id].actors` 是组成员），而 `group_order` 就是**编辑器左侧面板从上到下**的顺序：

```
group_order = [score(3), 黑色, 橙, 绿, 紫, 淡蓝, 红]      ← 与 K4 面板截图逐行对上
```

Godot 里同一父节点下**越靠后添加的画得越上面**，所以生成时按它**倒序**排。
改完这个用例的角色层顺序变成 `绿 < 紫 < 淡蓝 < 红 < 橙`（自下而上）——
"紫压住绿、淡蓝在紫上面"就自然成立了。

> 这条影响面很大：**初始叠放、谁先执行、所有"移到图层/移到画笔下方"的结果**都依赖它。

### ② `移到画笔图层("below")` 还要排到最下

K4 源码（`kitten.js` 的 `set_layer_with_pen`）里 below 分支是 `s(o, 0)` —— **把自己排到最底**，
所以后执行的在更下面。之前只改 `z_index`（三个角色同层），同层内的先后就退回了节点顺序。

### ③ `text_select_changeable` 单槽块被当成"截取"

K4 这个块有两种槽数：单槽「第 NUM0 个字符」/ 双槽「第 NUM0 到 NUM1 个字符」。
之前一律生成 `str_substring(文本, NUM0, NUM1)`，单槽块的 `NUM1` 读不到、默认成 0 →
**"取第 i 个字符"变成"取前 i 个字符"**（`score="365"`：i=1 得 `"3"` ✓、i=2 得 `"36"` ✗，
造型编号算成 36）。现在按输入名里有没有 `NUM1` 分派。

### ④ 文本族积木一律走 `转文本()`（不是 `str()`）

K4 里数字 365 的文本是 `"365"`，而 `str(365.0)` 是 `"365.0"` —— 字符数从 3 变 5：

```gdscript
重复 (score 的长度) 次        # 于是多跑两轮、克隆出 5 个数字
```

修了两处：`emit.js` 把 `str_len` 内联成 `str(x).length()`（改成走 `角色.文本长度()`），
以及 `自带积木.gd` 的文本族（长度 / 取字符 / 包含 / 截取 / 第几个字符 / 最后位置 / 大小写 / 去空格 / 分割 / 连接）。

### ⑤ `删除自己()` 要留一帧给渲染

数字角色的克隆体脚本是「当作为克隆体启动时 → **显示** → **删除克隆体**」。
Godot 的 `queue_free()` 在**本帧末尾**就把节点摘掉 → 那一帧什么都看不到 →
**365 一个数字都显示不出来**。K4 里"删除此克隆体"在当帧仍会被画出来。

改法：`删除自己()` 只记一个"待删帧号"，由 `_process` 在**再下一帧**才 `queue_free()`，
保证"显示"的那一帧一定被渲染过。

### 验证

`_dev/layer_order_check.gd`（非 headless + 截图）跑同一用例，最终截图与用户给的 K4 画面一致：

| 判据 | 结果 | 证据 |
|:---|:---|:---|
| 绿不可见 | ✅ | 绿色像素 **0**；角色层顺序 `绿(0) < 紫(1) < 淡蓝(2)` |
| 紫包围淡蓝 / 红 / 橙 | ✅ | 淡蓝 11664 px、红 11664 px、橙 11556 px 都可见 |
| 蓝色 365 | ✅ | `#55B0FF` 4936 px；克隆数 = 3、造型编号 3/6/5（正是 "3""6""5"） |
| 黑色长条 | ✅ | 5 个克隆体落在 y = 185 / 85 / -15 / -115 / -215 |

![画笔图层与执行顺序测试](_out/画笔图层与执行顺序测试/_截图_图层_跑之后.png)

## 现在的架构（一句话版）

```
.bcm4 ──core.js──▶ IR ──emit.js──▶ 生成工程
                                   ├─ project.godot（主场景 = 全局/游戏屏幕.tscn）
                                   ├─ 全局/游戏屏幕.tscn|.gd   ← 所有屏幕都在里面，只显示当前屏幕
                                   ├─ 全局/角色基类 · 角色变量 · 角色自带积木 · 角色自定义积木 · 角色类
                                   │     └ 造型 = 一个 AnimatedSprite2D + _造型顺序()/_造型偏移()
                                   ├─ 全局/积木映射.json（改名/桩/未映射/实参不匹配/实参类型转换/await声明不一致）
                                   └─ <屏幕>/<角色>/帽子脚本（extends 帽子_XXX）
```

## 第二十三轮：运行期性能大修（斗地主卡死 / K4 常量真值 / 整数优先 / 切屏）

一次把"转换产物跑起来像套虚拟机"的问题从根上处理。都有实测数字。

### ① PICKCAT斗地主「启动即卡死」—— warp 预算用完不让出

`角色基类.一步()` 的 warp 分支，注释一直写着"预算用完就 **await 一个物理帧**"，
代码却只 `return`：

```gdscript
_ctx.iters = 0
_ctx.started = Time.get_ticks_msec()
return                    # ← 少了 await 树.process_frame
```

斗地主的 `当开始被点击时_1.gd` **第 6 行就是 `角色.进入warp(ctx)`** ——
整个 1006 行积木体（含 914 行的 `while true`）都在 warp 里，于是**一帧之内无限转**，
主线程被占死（编辑器里就是"无响应"，FPS/帧时间/对象数全都刷不出来）。

| | 修复前 | 修复后 |
|:---|:---|:---|
| `--quit-after 1` | **90 秒退不出** | **30.1 秒退出** |
| `add_child`（`_ready` + 首帧启动） | 卡死 | **3 ms** |

### ② ★K4 的 4 个运行时常量，我们全写错了★（本轮最大发现）

出处：K4 打包产物里 **运行时那套** ConfigImpl 的默认值
（它被解释器直接取用：`M.entity_max_clones_per_frame = e.entity_max_clones_per_frame`）：

| 常量 | K4 真值 | 我们原来的值 | 后果 |
|:---|:---|:---|:---|
| `warp_interpreter_millisecond_time_limit` | **4 ms** | 200 ms | 一个 warp 段连跑 200ms 不让出 → **单帧 process 冲到 223.6ms** |
| `max_warp_iterations_per_interpreter_step` | 30000 | 20000 | warp 迭代预算偏小 |
| `per_entity_clone_limit` | **300** | 512 | 存活克隆数能超过 K4 |
| `entity_max_clones_per_frame` | **300** | **完全没有** | **一帧能克隆几百上千个**（K4 会卡在 300） |

K4 的两道克隆闸（`runtime/全局/角色基类.gd` 已照抄）：

- 每角色**存活**上限 300 → 超了 **FIFO 淘汰最老的**；
- 每角色**每帧新建**上限 300 → 超了**静默拒绝**（`clone_entity()` 里整个 `if` 不进）。

实测（`_dev/clone_limit_check.gd`，一帧内狂调 1200 次）：

```
CLONELIMIT 一帧内尝试创建 1200 个：成功 300 个
CLONELIMIT 调用后 k4_clones 存活数 = 300
CLONELIMIT [通过] 每帧截断=true 存活截断=true
```

**这就是「克隆数量远超逻辑上该触发的数量」的根因** —— 不是帽子多发，是我们没有上限。

### ③ 让出点加密（IR 层）+ IR 层合并

- **让出点加密**：warp 预算只在调用 `一步()` 的那一刻检查，而斗地主的循环体 914 行里
  只有 9 个 `一步()`，中间的长段跑多久都不让出。生成器现在在"连续 16 条都不含**真正
  让出点**"之后补一句 `await 角色.让出点(ctx)`；运行端 `让出点()` **非 warp 时立即返回**
  （语义不变），warp 内才真去查预算。
  > 判据必须是"**真的**让出点"（`一步` / `让出点` / `等待_秒`），不能是"有没有 await" ——
  > 斗地主 166 个 await 大多落在同步的自定义积木调用上（await 一个立刻返回的协程
  > **并不会让出**），按 await 计数只补出 1 个检查点，单帧照样 223ms。
- **IR 层合并**：`列表取值_特殊(文本分割(X,Y), 方式, N)` → 一步 `角色.文本分割取值(...)`
  （斗地主 **484 处**）；运行端按 `(文本, 分隔符)` 做小容量缓存，且**不把数组交给调用方**
  （所以调用方改不坏缓存）。
  > 坑：IR 里 `args[0]` 外面还包着一层 `listref_from`（`core.js` 的 `lists_get_value`
  > 就是这么生成的，而 `expr()` 会把它透明展开）—— 不剥壳一条都匹配不上。

### ④ 整数优先数值（与 K4/JS 的显示规则一致）

- 字面量生成 `5` 而不是 `5.0`（`str(5)` 天然是 `"5"`，列表/调试器里也不再是 `5.0`）；
- **护栏 1**：超出 JS 安全整数（2^53-1）就退回 float 字面量 —— 斗地主里真有 `1e20`，
  int64 装不下，GDScript 会直接报字面量越界；
- **护栏 2**：**除法两侧显式 `float()`**（斗地主生成 362 处）—— 否则整数化之后
  `5 / 2` 会变成整除 2，而 K4（JS）是 2.5。

### 性能总账（PICKCAT斗地主，600 帧 headless）

| 指标 | 最初 | 现在 |
|:---|---:|---:|
| 单帧最大 `process` | **223.6 ms** | **6.2 ms** |
| 600 帧里的慢帧数 | 几十个 | 3 |
| 平均帧时间 | 50–145 ms（~10-20 FPS） | **17 ms（≈59 FPS）** |
| `instantiate`（含脚本编译） | 15053 ms | 10929 ms |

### ⑤ 顺带修掉的

- **切屏 / 下一屏上一屏**：`__next_scene` / `__prev_scene` 以前被当成"当前屏幕"→ 切屏原地
  打转。现在按 `屏幕顺序` 循环（`K4Global.下一屏幕()/上一屏幕()`），实测
  `背景 → 背景(1) → 背景(2) → 背景`。
- **`get_tree()` 为 null 崩溃**：克隆体被删 / 切屏移走后，它的**其它协程**还会恢复一轮 →
  `一步()` / `等待_秒()` / `帽子_广播` 三处加防护（标记取消、直接收尾）。
- **克隆体帽子"继承"了原体的运行状态**：`duplicate()` 会连脚本成员一起复制
  （`_运行中` / `_待触发` / `_ctx`），而它们不叫 `k4_` 前缀、`_克隆搬状态()` 管不到 ——
  于是克隆体可能一出生就跑一遍**不属于它的**那轮事件，或者被"不重入"永久挡死。
  新增 `帽子基类.重置运行状态()`，由 `克隆自己()` 在入树前调用。
- **云变量持久化**：连跑三次实测逐次 +2、存档 `user://k4_cloud.json` 保留
  （`_dev/cloud_check.gd`）。

## 已知待办（更新）

- [x] ~~接口参数类型统一放宽成 Variant~~ → 改成**生成期实参类型校正**（`角色.转文本 / 转数字 / 为真`）
- [x] ~~列表没有初始值~~ → 已修；超大列表走 `文本/列表N.txt`（JSON）+ `K4Text.读取列表()`
- [x] ~~造型节点树太深~~ → customs 改 `AnimatedSprite2D`（+ pivot 偏移表）
- [x] ~~「当切换到当前屏幕」帽子丢失 / 切屏会销毁另一屏状态~~ → `游戏屏幕.tscn` 容器 + 屏幕生命周期（即走即取消 / 切回重开）
- [x] ~~广播收不到 / 并等待没等 / 同帧丢事件~~ → 见第十二轮；**第二十一轮又整体重写**成自定义信号系统（Callable 表 + "触发同步 / 等待协程"两个回调 + 逐个 await），并记下 Godot 4「调用协程函数却不 await 会报错」这条硬限制
- [x] ~~按键没法用（41 个帽子全变成"任意键"）~~ → 见第十八轮：`_配置键名()` 断线修好 + 新增 `按键表.gd` 统一解析
- [ ] **掩码烘焙**（碰撞 alpha 掩码 + 2px 采样）未开始
- [ ] 类型层那批方法仍是桩（按设计，等你在 `全局/角色类.gd` 里填）
- [ ] `tell/tell_sync`（告诉角色执行…）主体是否被 K4 存下来待验证
- [ ] 音频方法（播放声音等）仍是桩
- [x] ~~「内嵌图大小未正确应用」~~ → 第二十轮①：`印章custom测试` 的「头像」（SVG 声明 3×3.5px、内嵌的却是整张大图）已复现并修好 —— 抽取内嵌位图前比对尺寸，不符就走浏览器光栅化
- [ ] **待人工确认**：`角色基类._apply_transform` 的 `rotation = deg_to_rad(90 - 方向)`，按 Scratch 约定（0=上、造型默认朝右）应为 `方向 - 90` —— 角色朝向可能整体反 180°（无朝向的造型看不出来）
- [ ] 列表类写操作遇到"目标解析不到"时仍会凭空造 `_l_局部列表`，应改成 `push_warning` + 跳过（常见形态已在第十九轮修好，兜底未补）
- [ ] `琪露诺的最强刨冰`：切屏帧时间已修（即走即取消 + 克隆体不响应），**克隆/碰撞的性能优化**留待下一轮

---

# 第二十四轮：函数单例架构 + 文字图章对齐 + 画笔清除防闪

> 三件事：① 修「文字图章」的**居左 / 居中 / 居右**；② 修「每帧清空画笔 + 重画」的**闪烁**；
> ③ **架构更新** —— 角色实例那一侧瘦身，所有积木实现收进全局**函数单例**（autoload `K4Func`）。
> 验收：`_dev/regress.ps1` 四样本回归全绿 + 生成期自检 + 三个新增专项检查脚本。

## ① 文字图章：三种对齐（以前画在**完全相同**的位置）

链路本来就是通的（`core.js` 读 `fields.align` → `methodtable` 带 `对齐` 形参 →
`emit.js` 的 `ARG` → 模板 `文字图章(…, _对齐)` → `画布调度` → `屏幕绘制`），
断点在最底层那一行：

```gdscript
draw_string(ThemeDB.fallback_font, 位, 文本, 横, -1, 号, 颜色)
#                                              ^^^ width = -1
```

**Godot 在 `width < 0` 时会忽略 alignment 参数**
（官方 issue [#94394](https://github.com/godotengine/godot/issues/94394)
"Alignment setting in draw_string doesn't do anything"）——
实测三种对齐的墨迹包围盒**一模一样**，全部按左对齐画。

修法：自己用 `Font.get_string_size()` 量文本宽度，把起点挪到 K4 的基准上，再一律用左对齐画。
逻辑只写一份（`烘焙器.文字对齐起点()`），**绘制路径与烘焙路径共用** —— 否则"烘焙前/后"位置会跳。

| K4 的 `fields.align` | 语义 |
|:---|:---|
| `left` | 文本**左缘**落在印章点 |
| `center` | 文本**中心**落在印章点 |
| `right` | 文本**右缘**落在印章点 |

**证据**（`_dev/pen_align_check.gd`，★必须非 headless★）：

| | left 盒 | center 盒 | right 盒 |
|:---|:---|:---|:---|
| 修前 | `P:(204,65) S:(169,35)` | `P:(204,65) S:(169,35)` | `P:(204,65) S:(169,35)` |
| 修后 | `P:(204,65)` | `P:(115,65)` | `P:(27,65)` |

```
ALIGN [通过] left   墨迹左缘 ≈ 基准    实测=  204.00 期望=  200.00 偏差=  4.00
ALIGN [通过] center 墨迹中心 ≈ 基准    实测=  199.50 期望=  200.00 偏差=  0.50
ALIGN [通过] right  墨迹右缘 ≈ 基准    实测=  196.00 期望=  200.00 偏差=  4.00
ALIGN [通过] left-right  间距 ≈ 宽     实测=  177.00 期望=  177.00 偏差=  0.00
ALIGN RESULT 失败 0 项
```

（±4px 是字形自身的左右边距 bearing，不是对齐误差。）

## ② 画笔清除：不再闪（显示批次 / 写入批次 + 原子提交）

**症状**：斗地主那种「每帧 `全部擦除()` + 重画整屏」的写法会闪。

**根因**：`全部擦除()` 立刻 `指令.clear()`，而重画常常**跨帧**（warp 预算耗尽会让出），
于是"已经擦掉、还没画上"的那一帧被渲染出来 —— 就是那一闪。

**修法**（`runtime/全局/屏幕绘制.gd`）：

- 「擦除」只清**写入批次**（这正是 K4 的"把绘制任务清空"），**画面保持不变**；
- 写入批次画到稳定点后，整批**原子替换**显示（乒乓互换，零拷贝）。
  两条提交路径：
  - **下一次「全部擦除」**到来 → 「每帧擦除重画」走这条，延迟只有一帧；
  - 连续 `提交空闲帧数`（= 4 帧 ≈ 67ms）没有新指令 → 「只擦不画 / 画完就不动」走这条。
- **从没调用过擦除**的工程是"累加模式"：新指令直接进显示批次，行为与以前完全一致。
- 烘焙改成对"当前正在累积的那一批"生效，并加了**批次版本号**防护
  （烘焙是异步的，期间被擦除/提交过就作废，否则会把上一批的画面写回底图）。

**证据**（`_dev/pen_flush_check.gd`，非 headless；同一份检查只换 `屏幕绘制.gd`）：

| | 擦除后画面内容量（4 轮） | 含义 |
|:---|:---|:---|
| 修改前 | `[0, 0, 0, 0]` | 每轮擦除后都有一帧空白 → 闪 |
| 修改后 | `[0, 7080, 7080, 7080]` | 只有第 1 轮是 0（本来就没内容） |

同脚本还断言了另外两条语义没丢：**只擦不画仍能清屏**、**累加模式内容只增不减**。

> ⚠ 斗地主工程的端到端实测本轮**跳过**（用户指示）。该工程在当前条件下没复现出闪烁
> （在固定帧率下绘制没有跨帧），同构场景由上面的专项脚本覆盖。

## ③ 架构更新：角色瘦身 + 全局函数单例 `K4Func`

### 新架构（两张图）

```
函数单例那一侧（autoload `K4Func`，全局唯一）
  角色自带积木  全局/角色自带积木.gd   ← K4 内建积木的实现（模板生成 · 每次覆盖 · 3000+ 行）
    └─ 角色自定义积木  全局/角色自定义积木.gd  ← K4 自定义积木的真实现（每次覆盖）
         └─ 函数单例  全局/函数单例.gd    ← ★你写实现的地方 · 永不覆盖★

角色实例那一侧（每个角色一份）
  角色基类  全局/角色基类.gd   ← 状态（k4_x / 画笔颜色 / 克隆表…）+ 引擎胶水
    └─ 角色变量  全局/角色变量.gd    ← 数据：局部变量 / 列表成员声明（每次覆盖）
         └─ <角色名>.gd      ← 初值 + 角色组 + 造型表（每次覆盖）
```

**调用约定**：所有积木方法的第一参数都是 `角色: 角色变量`（"这次跑在哪个角色上"），
调用点一律写单例：

```gdscript
K4Func.下一个造型(角色)
await K4Func.等待_秒(角色, ctx, 0.2)
await K4Func.一步(角色, ctx)
K4Func.移动_步(角色, 10)
# 跨角色：K4Func.包围盒(别的角色) / K4Func.过程名(角色.找("目标"), ctx)
```

**住在单例上 vs 留在角色上**，不是人肉维护的清单，而是按"名字在不在
`runtime/模板/自带积木.gd` / 本工程自定义积木的方法表里"自动判定
（`lib/k4/emit.js` 的 `走单例()`）：模板里的积木实现 → `K4Func.名(角色, …)`；
角色基类的引擎胶水（`算术运算` / `转数字` / `找` / `进入warp` / `新建上下文` /
`让出点` / `切换屏幕` / `广播`…）→ 仍然是 `角色.名(…)`。

### 为什么（用户给的三条目标）

| 目标 | 做法 |
|:---|:---|
| 角色继承链变短 | 从 6 层（基类→变量→自带积木→自定义积木→角色类→具体角色）降到 **3 层**（基类→变量→具体角色） |
| 减少传递链 | 积木调用从"逐层在角色实例上找方法"变成"单例上一跳"；`角色类` 这一层整个取消 |
| 减少实例规模 | 每个角色脚本不再继承那 3000+ 行模板；方法实现全局只有一份 |

### 迁移（旧产物请重新转换）

- **`全局/角色类.gd` 这一层取消了**。转换器**不直接删**它（里面可能有你手写的实现）——
  会改名成 `全局/角色类.gd.旧架构备份` 并提示：把实现搬到 `全局/函数单例.gd`。
- `全局/函数单例.gd` 只在**不存在**时写入模板，之后**永不覆盖**（与旧的 `角色类.gd` 同一角色）。
- 角色脚本的第一行从 `extends 角色类` 变成 `extends 角色变量`；
  `project.godot` 的 autoload 多了一项 `K4Func="*res://全局/函数单例.gd"`。
  （autoload 名必须 ASCII —— 中文名会报 `Identifier not declared`，这条老规矩没变。）
- 帽子里 `@onready var 角色: 角色类` → `角色变量`；「可拖拽」的输入回调
  改由 `角色基类._input()` 转发到 `K4Func.拖拽输入(角色, _event)`
  （Godot 的生命周期回调不能带参数，所以不能直接叫 `_input`）。

### 迁移工具（新增，可复用）

`_dev/迁移_单例化.js` —— 把 `runtime/模板/自带积木.gd` 自动改造成"第一参数是角色"的版本：

```
node _dev/迁移_单例化.js --分析              # 列出"裸名字"里需要人工分类的（内建/单例自己的/角色的）
node _dev/迁移_单例化.js --生成              # 生成 _dev/out/自带积木_单例版.gd（含改动统计与搬迁清单）
node _dev/迁移_单例化.js --明细              # 连"已分类"的也打印
```

它做四件事：① 287 个函数签名插入 `角色: 角色变量`；② 角色状态成员前加 `角色.`；
③ 模板方法的调用点插入 `角色` 首参（含跨行调用、`self`→`角色`、`super.名`→`角色.名`）；
④ 把方法当 Callable 用的地方补 `.bind(角色)`（`tween_method` / `signal.connect`）。
**改动统计**（本轮）：签名 287 / 成员前缀 299 / 基类方法前缀 105 / 内建方法前缀 30 /
内建属性前缀 17 / 调用插参 281 / `self` 21 / `super` 2 / 方法引用绑定 4 / **跨角色改写 5**。

> 踩过的三个坑（都写进脚本注释了）：
> ① 函数内的局部 `var` 不能被当成成员（否则会把局部声明从模板里删掉）；
> ② `func 名(` 这一行的名字后面也跟 `(`，会被误判成"方法调用"再插一次参数；
> ③ 模板里有"形参与方法同名"的写法（`func 抖动(角色, _秒): var 总 := _秒(_秒)`）——
>    这种位置一定是**调方法**，不能按局部变量跳过。

### 本轮回归结果（`_dev/regress.ps1`）

| 样本 | 规模 | 结果 |
|:---|:---|:---|
| `新的作品` | 1 屏幕 / 1 角色 / 2 帽子 | **0 error / 0 warning / 0 parse fail**（32 脚本 / 5 场景） |
| `射击生存` | 6 角色 / 12 帽子 / 克隆 / 碰撞 / 音效 | 0 / 1（**既有**音频泄漏，与旧架构基线一致）/ 0 |
| `空白作品b` | 1 屏幕 / 42 帽子 | **0 / 0 / 0**（71 脚本 / 4 场景） |
| `切屏测试` | 2 屏幕 / 2 角色 / 5 帽子 | **0 / 0 / 0**（39 脚本 / 8 场景） |

### 待办（本轮新增）

- [x] ~~「文字图章」的多行文本~~ → **Kitten4 的文字图章本就不支持换行**（单行设计），
      不是本项目的缺口。当前只保证**单行**的三种对齐正确，这已覆盖 K4 的完整语义，无需再做。
- [ ] 单例化之后 `runtime/全局/角色基类.gd` 里仍留着一批"引擎胶水"，
      其中有些（如 `包围盒` 的邻居们）其实更适合搬到单例 —— 本轮只保证等价迁移，没有重新归置。
- [ ] 斗地主工程的闪烁端到端实测（按用户指示跳过）：需要在**能复现跨帧重画**的条件下再验一次。

