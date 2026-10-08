# =============================================================================
# 角色基类.gd  ——  Kitten4 → Godot 4 运行时库（库层，带版本号覆盖）
# =============================================================================
#
# 职责：K4 角色的**状态**（坐标 / 方向 / 可见 / 变量 / 列表 / 造型 / 克隆表）
#       + **引擎胶水**（唯一写 position 的 _apply_transform、等待让出点 一步()、
#         warp 预算、跨角色查找 找()）。
#
# 继承链（固定五层，不要改）：
#     角色基类.gd（本文件·库·带版本号覆盖）
#       └─ 角色变量.gd（数据：各角色的局部变量 / 列表成员声明·每次覆盖）
#            └─ 角色自带积木.gd（K4 内建积木的方法签名 + 桩·每次覆盖）
#                 └─ 角色自定义积木.gd（K4 自定义积木的真实现·每次覆盖）
#                      └─ 角色类.gd（用户手写实现·永不覆盖）
#                           └─ <角色名>.gd（角色节点脚本·生成器每次重写）
#
# 为什么变量层 / 自带积木层 / 自定义积木层要分开：
#   前两层分别是"数据"和"待你实现引擎能力的行为"，第三层是"用户自己写的 K4 代码、
#   转换器已给出真实现" —— 三者生命周期不同，分开之后可以各自整文件替换，互不牵扯。
#
# ---------------------------------------------------------------------------
# 【约定】一步() 的 warp 预算（照抄 K4 Ultra）
# ---------------------------------------------------------------------------
#   max_warp_iterations_per_interpreter_step = 10000
#   warp_interpreter_millisecond_time_limit  = 100 (ms)
#   两者先到先得；超出后强制让出一帧，防止 warp 段冻死主线程。
#   warp 上下文（WarpCtx）**必须随协程传递**（K4 自己的 proc_call 最后
#   一个实参就是 is_inside_warp()），所以禁止把 warp 状态存在节点成员变量上。
#
# ---------------------------------------------------------------------------
# 【坐标约定】K4 舞台坐标 → Godot 2D 坐标
# ---------------------------------------------------------------------------
#   K4：480x360 舞台，原点在**舞台中心**，x 向右，**y 向上**。
#   Godot：Node2D 的父节点（基础角色层）原点在**舞台中心**，y 向下。
#   因此：position = Vector2(k4_x, -k4_y)
#   方向：K4 direction 90 = 向右、顺时针为正；Godot rotation 逆时针为正
#        → rotation = -deg_to_rad(k4_direction)
#   摆放时请让「基础角色层」位于 (240, 180)（屏幕中心），
#   本文件由 初始化() 通过 K4Canvas.舞台中心 对齐，取不到则用 (240, 180)。
#
# ---------------------------------------------------------------------------
# 【约定】参数命名：本库所有方法的形参**统一加下划线前缀**
#   （如 一步(_ctx)、找(_名)）。原因见任务书：
#   基类已经占用了 name / position / state / 角色 / 消息 / 键 这类常见名，
#   参数同名会触发 SHADOWED_VARIABLE_BASE_CLASS 警告。
#   下游「角色自带积木.gd / 角色自定义积木.gd」生成器请沿用同一条规则。
# =============================================================================

class_name 角色基类
extends Node2D

# —— K4 舞台常量 ——
const K4_舞台宽 := 480.0
const K4_舞台高 := 360.0
const K4_半宽 := 240.0
const K4_半高 := 180.0

# ★下面这几个常量**照抄 K4 运行时的真实配置**★
#
#   出处：K4 Ultra 打包产物里 ConfigImpl 的默认值（**运行时**那一套，它被
#   解释器直接取用：`M.entity_max_clones_per_frame = e.entity_max_clones_per_frame`）：
#       max_warp_iterations_per_interpreter_step: 30000
#       warp_interpreter_millisecond_time_limit:  4
#       per_entity_clone_limit:                   300
#       entity_max_clones_per_frame:              300
#
#   ⚠ 以前我们用的是自己定的值（warp 段 200ms、克隆上限 512），实测后果：
#     · 一个 warp 段能连跑 **200ms** 不让出 → 单帧 process 冲到 223ms（PICKCAT斗地主）；
#     · 克隆数能超过 K4 的「每帧 300」与「每角色 300」上限 → 用户看到的
#       **"克隆数量远超逻辑上该触发的数量"**。
#   （另有一套 `legacy` 配置里 per_entity_clone_limit 是 512，但那套不作用于运行时。）
const K4_WARP_ITERS := 30000
const K4_WARP_MS := 4

# ★每帧给**所有** warp 段共享的总预算（毫秒）★
#   为什么必须有这一条：
#     K4 是单线程的，同一时刻只有一个 warp 段在跑 —— 所以「每个 warp 段 4ms」
#     在 K4 里就等于「整个程序 4ms」。
#     但 Godot 里几十个角色**同时**各有自己的 warp 段（各自一个协程），
#     各自 4ms 会叠加成"几十毫秒一帧"。
#   所以这里再压一道：一帧里所有 warp 加起来最多跑这么多毫秒，超了就本帧内一律让出。
const K4_帧warp预算 := 16

# ★克隆上限（K4 有**两道**，缺一不可）★
#   ① 每角色**存活**的克隆体上限 300 —— 超了就自动销毁**最老的**（FIFO 淘汰），
#      见 K4 源码 original_id_2_clone_id_list[原体].push(新克隆体) 之后那段循环；
#   ② 每角色**每帧新建**的克隆体上限 300 —— 超了**静默拒绝**（不创建、不排队），
#      见 K4 源码 clone_entity()：
#        if (entities_cloned_times[e] > entity_max_clones_per_frame) → 整个 if 不进。
#   以前我们只有 ①（而且值写成 512），**完全没有 ②** ——
#   warp 里的循环克隆一帧就能创建几百上千个，K4 会卡在 300。
const K4_每角色克隆上限 := 300
const K4_每帧克隆上限 := 300

# =============================================================================
# 内层类：warp 上下文
# =============================================================================
# 生成器会写 `var ctx = 角色.新建上下文()`，
# 类型名对外暴露为 `角色基类.WarpCtx`（本类继承链上的子类同样看得见）。
# 字段语义：
#   depth    —— 嵌套 warp 深度，> 0 表示"在 warp 里"
#   iters    —— 本段 warp 已消耗的迭代预算
#   started  —— 本段 warp 预算的起始时间（毫秒）
#   _已取消  —— 绿旗重启等场景下，把旧协程标记为作废（见 一步()）
class WarpCtx:
	var depth: int = 0
	var iters: int = 0
	var started: int = 0
	var _已取消: bool = false

# =============================================================================
# 状态
# =============================================================================
var k4_x: float = 0.0                  # K4 舞台坐标（原点居中，y 轴向上）
var k4_y: float = 0.0
var k4_direction: float = 90.0         # K4 方向：90 = 向右，顺时针为正
var k4_visible: bool = true
var k4_is_clone: bool = false
var k4_clone_of = null                 # 原体引用（克隆体才有）
var k4_clones: Array = []              # 我产生的克隆体
var k4_alive: bool = true
var k4_canvas: Node = null             # 本屏幕的画布节点（可空）

# 造型 / 变量 / 列表（用户可以在 角色类.gd 里按需扩展）
var k4_costumes: Dictionary = {}       # K4 造型名 -> 造型**序号**（0 基，= SpriteFrames 帧号）
var 造型精灵: AnimatedSprite2D = null   # customs 节点（新结构）；老产物为 null
var _造型名表: Array = []               # 序号 -> K4 造型名（与 SpriteFrames 帧号一一对应）
var _造型偏移表: Array = []             # 序号 -> Vector2（该造型的 pivot 偏移，切造型时套到 customs.position）
var _造型节点表: Dictionary = {}        # 老产物兼容：名 -> Sprite2D 节点
var k4_costume_name: String = ""       # 当前造型名（**K4 原名**）
## ★造型名 ↔ 节点名★ 的兼容映射
##   新结构（AnimatedSprite2D）里没有"节点名"这一层，两者同名；
##   老产物里 K4 造型名可能带括号等字符，被清洗成节点名（"新角色(1)" -> "新角色_1_"），
##   这两张表把两边对上。设置/切换造型按任一种写法都能查到。
var _造型节点名: Dictionary = {}        # K4 原名 -> 节点名
var _造型原名: Dictionary = {}          # 节点名 -> K4 原名
var k4_variables: Dictionary = {}      # 角色局部变量（生成器会插真实成员变量，这里做兜底）
var k4_lists: Dictionary = {}          # 角色局部列表
var k4_size_percent: float = 100.0     # 大小（%）
# ★宽高分别缩放★（K4「设置宽高缩放」积木）
#   K4 的「大小」是统一的百分比（k4_size_percent），而「设置宽高缩放」能在它之上
#   再分别拉伸宽/高。这两个系数默认 1.0（不拉伸），只在那个积木被调用时才变。
#   节点缩放 = k4_size_percent/100 * Vector2(_k4_宽缩放, _k4_高缩放)
#   注意：碰撞盒（包围盒）读的是 Sprite2D 的**局部**尺寸，不受这两个系数影响 ——
#   与 K4 里 drawable 的实际渲染尺寸一致（拉伸后确实碰不到）。
var _k4_宽缩放: float = 1.0
var _k4_高缩放: float = 1.0
# ⚠ 计时器**不在**这里了：K4 的计时器是全作品唯一的，状态在 autoload `K4Timer`
#   （见 全局/计时器.gd）。这里保留同名字段只为兼容用户在 角色类.gd 里的旧写法，
#   角色基类的 计时器()/开始计时器()/停止计时器()/重置计时器() 全部委托到 K4Timer。
var k4_timer: float = 0.0              # 【已废弃·请用 K4Timer.取值()】
var k4_timer_running: bool = true      # 【已废弃·请用 K4Timer.在走】
var k4_pen_down: bool = false          # 画笔状态（各角色各一份，绘制指令进屏幕画布）
var k4_pen_color: Color = Color.BLACK
var k4_pen_size: float = 1.0
var k4_last_pen_point := Vector2.ZERO  # 上一次落笔点（K4 舞台坐标）

# =============================================================================
# 【单例化搬迁】以下状态原先声明在「角色自带积木」里（它是角色实例继承链的一层）。
#   架构改成「角色基类 → 角色变量 → 具体角色」+ 全局函数单例之后，
#   这些"每个角色一份"的状态必须留在角色实例上 —— 方法体里统一写 `角色.xxx`。
# =============================================================================
# =============================================================================
# 本文件新增的状态
# =============================================================================
var k4_flip_x: bool = false              # 左右翻转（K4「翻转」积木，axis=x）
var k4_flip_y: bool = false              # 上下翻转（axis=y）
var k4_modulate: Color = Color.WHITE      # 透明度 / 特效累积
var k4_effect: Dictionary = {}            # 特效代码 -> 值（图形特效，见 设置特效）
var k4_回答: Variant = ""                 # 最近一次「询问并等待」的回答
var k4_选项内容: Variant = ""             # 最近一次「询问并选择」选中的**内容**（「选择的选项」积木读它）
var k4_选项序号: float = 0.0              # 最近一次「询问并选择」选中的**序号**（从 1 开始）
var k4_音量: float = 100.0                # 本角色的音量（0-100）
var k4_say_label: Label = null            # 说话气泡
var k4_音频: AudioStreamPlayer = null     # 本角色的声音播放器
var k4_图层: int = 0                      # K4 图层序（越大越靠前）
var k4_列表显示: Dictionary = {}          # 列表名 -> true（监视器开关，仅记录）
# ★K4 的「显示 / 隐藏 变量」和「排行榜」★——K4 会在舞台角落画出监视器；
#   这里只记录开关状态（想真画出来，读 k4_变量显示 / k4_列表显示 / k4_排行榜显示 自搭 UI）
var k4_变量显示: Dictionary = {}          # 变量名（含云变量）-> true
var k4_排行榜: String = ""                # 排行榜对应的云变量名
var k4_排行榜显示: bool = false
# 用户信息 —— K4 是联网云平台，这里本地化。要在 角色类.gd 里改就直接改这两个值。
var k4_用户名: String = "玩家"
var k4_用户ID: String = "local_player"
# ★K4 的「设置 旋转模式为 …」★（自由旋转 / 左右翻转 / 不旋转）
#   实测 fields.rotation_type = "0" | "1" | "2"，映射见 设置旋转模式()
var k4_rotation_style: String = "free"
# ★K4 的「设置 此角色 可拖动 / 不可拖动」★（实测 fields.draggable = "0" | "1"）
var k4_draggable: bool = false
var _k4拖拽中: bool = false
# 询问界面（第一次「询问并等待」时惰性创建）
var _询问层: CanvasLayer = null
var _询问问题: Label = null
var _询问输入: LineEdit = null
var _询问按钮: Button = null
## 角色在 K4 坐标系里的包围盒（用当前造型的贴图尺寸估）
##
## ★同一帧内只算一次，结果缓存★
##   为什么必须缓存：K4 的碰撞是"每个角色去问别人碰没碰到"，
##   一轮下来就是 O(N²)。`大陆漂移学说` 里克隆体堆到 512 个，
##   512 × 512 ≈ 26 万次包围盒计算 —— 每帧 260ms，正好把帧率压到 1
##   （实测 `--fixed-fps 60 --quit-after 300` 要 70 秒）。
##   K4/Scratch 的 `touching` 走的是渲染器的空间索引，不是朴素两两比较；
##   这里用"每帧一算 + 缓存"把 N² 次计算压成 N 次，够用了。
var _包围盒缓存: Rect2 = Rect2()
var _包围盒帧号: int = -1
## ============================================================================
## 画笔颜色：★K4 用的是 HSL，不是 HSV★
## ============================================================================
## 用户明确指出：K4 的颜色是 HSL —— hmax 360 / smax 100 / lmax 100 / alphamax 100。
## K4 内部的 `_hueToHex(h)` 也印证了这点（里面写死 s=1, l=0.5 —— 纯色相 + 满饱和 + 中亮度）。
##
## ⚠ 所以**必须自己维护 HSL 四个分量**：
##   Godot 的 Color 内部是 RGB，而 `Color.h/s/v` 是 **HSV**，和 K4 的 HSL 不是一回事。
##   以前这里用的是 `Color.from_hsv` ——「设置画笔 亮度 50」被当成 HSV 的 V，
##   而 K4 的 L=50 是中灰、V=50 是暗色，整整差一档。
##
##   值域（K4 语义）：h 0~360、s 0~100、l 0~100、a 0~100（100 = 完全不透明）
##   初始值 = 黑（`self_set_pen_color` 的默认就是 #000000）
var k4_笔_h: float = 0.0
var k4_笔_s: float = 0.0
var k4_笔_l: float = 0.0
var k4_笔_a: float = 100.0

# ★克隆体的"出生保护帧"★
#   K4/Scratch 里克隆体创建后，它的 drawable 要**下一帧**才建立，
#   在那之前 touching（碰到角色）一律返回 false。
#   我们没有 drawable 这一层，于是克隆体出生的**第一帧**就会参与碰撞 ——
#   而射击生存 的子弹正好出生在射击手身上（两者都在舞台中心），
#   子弹那份「碰到角色 → 删除克隆体」就会在它还没来得及飞出去时把它删掉。
#   结果：**能不能射出子弹完全取决于鼠标朝向**（朝上下飞 50px 够离开射击手，
#   朝左右飞 50px 还在它的橙色翼里）—— 用户实测的"时好时坏"就是这个。
#   普通角色这里是 0，永远不触发保护。
var k4_出生帧: int = 0

## 「删除此克隆体」的**延迟删除帧号**（-1 = 没有待删）。见 删除自己()。
var _k4待删帧: int = -1

# =============================================================================
# 初始化
# =============================================================================
func 初始化() -> void:
	if k4_clone_of != null:
		k4_is_clone = true
	else:
		k4_clones.clear()
		k4_is_clone = false
	k4_alive = true
	# =========================================================================
	# ★初始状态**只从 .tscn 读**（Godot 编辑器是唯一真源）★
	# =========================================================================
	# 生成器已经把 K4 记录的初始 transform / 可见性烘进 <角色名>.tscn 的节点属性，
	# 所以这里不再由脚本赋值，而是**反读节点当前值**回填 k4_* 状态：
	#   position.x -> k4_x、-position.y -> k4_y、rotation -> k4_direction、
	#   scale.x    -> k4_size_percent、visible -> k4_visible
	# 好处：在 Godot 编辑器里拖一下角色、改个大小，运行时就是那个值 ——
	#       以前 <角色名>.gd 的 _ready() 会把编辑器里的改动又覆盖回去。
	# 注意：.tscn 只写**非默认值**（省文件），所以每个字段都要带默认回退。
	k4_x = position.x
	k4_y = -position.y
	k4_direction = 90.0 - rad_to_deg(rotation)
	k4_size_percent = maxf(0.0, scale.x * 100.0)
	k4_visible = visible
	# ⚠ 这里**不要**重置 _k4_宽缩放 / _k4_高缩放（以前会重置成 1.0）：
	#   克隆体的 初始化() 也要走这一行，一重置就丢掉原体"设置宽高缩放"的系数 ——
	#   而 K4 的克隆体是要**完全继承原体当前状态**的。
	#   这两个系数由 duplicate() 天然复制（普通成员会被一起复制），
	#   原体对它的修改也一直是即时的，所以两边都对。
	_收集造型()
	_对齐舞台层()
	_查找画布()
	_应用造型()
	_apply_transform()
	set_process(true)

func _ready() -> void:
	# 角色节点的 _ready 先于父节点，晚于所有帽子；这里只做一次 idempotent 兜底，
	# 正常流程由 角色脚本.gd 的 _ready() 调 初始化()。
	if k4_costumes.is_empty():
		初始化()

func _process(_delta: float) -> void:
	# 计时器累加已移到 autoload `K4Timer`（全作品一份，见 全局/计时器.gd）。
	# 这里只剩"延迟删除"这一件事 —— 见 删除自己() 的注释。
	if _k4待删帧 >= 0 and Engine.get_process_frames() > _k4待删帧:
		_k4待删帧 = -1
		queue_free()

# =============================================================================
# warp 上下文 / 让出点
# =============================================================================
func 新建上下文() -> WarpCtx:
	return WarpCtx.new()

func 进入warp(_ctx: WarpCtx) -> void:
	# ★只有最外层进入时才重新开始算预算★
	#   K4 里 warp 是可以嵌套的（在 warp 段里又调一个带 warp 的自定义积木），
	#   而 一步() 的让出条件是「iters < 10000 且 距 started 不到 100ms」。
	#   如果每次进入都重置 started，嵌套就会把预算**无限续期** ——
	#   实测 大陆漂移学说 的第一帧因此连续跑了十几秒（60 帧要 160 秒）。
	#   只在 depth==0 时重置：嵌套 warp 仍然共享最外层那 100ms。
	if _ctx.depth == 0:
		_ctx.iters = 0
		_ctx.started = Time.get_ticks_msec()
	_ctx.depth += 1

func 退出warp(_ctx: WarpCtx) -> void:
	_ctx.depth -= 1
	if _ctx.depth < 0:
		_ctx.depth = 0

# 一步() 语义（照抄 K4，再加一道**全帧共享**的预算闸）：
#   ctx.depth > 0 且 ctx.iters < 10000 且 本段用时 < 100ms 且 **本帧所有 warp 加起来 < 8ms**
#       → 只累加预算，不真让出
#   否则 重置 iters/started 并 await 一个物理帧
# 另外：被标记 _已取消 的旧协程在这里退出（绿旗重启用）。
#
# ⚠ 最后那个"全帧共享"的条件是 Godot 特有的，不是 K4 的。
#   去掉它 → 几十个 warp 段各跑 100ms → 几秒一帧（实测 FPS 1）。
static var _warp帧号: int = -1
static var _warp帧起点: int = 0

func 一步(_ctx: WarpCtx) -> void:
	# ★被取消的协程也必须让出一次★ —— 这一行是"运行一会就未响应"的根因。
	#
	#   死锁链（射击生存里真实发生）：
	#     克隆体执行 删除克隆体() → k4_alive = false（自带积木.一步 会给 ctx 打取消标记）
	#     可是它的**另一个**协程还在 `while true: 移动; 一步()` 里转
	#     → 每次 一步() 都走进下面这个早退分支 → **立刻返回、永不让出**
	#     → 那一帧的主循环永远结束不了（queue_free() 要等帧末才真释放节点，
	#        而帧末永远不到）→ 主线程被占死 = 编辑器和窗口都"未响应"。
	#
	#   为什么表现是"时好时坏"（用户实测：一次卡在 110 帧、一次卡在 40 帧）：
	#   它取决于"删除克隆体"和"另一个协程恢复执行"的先后，是个竞态。
	#
	#   为什么以前没暴露：只有当**同一个角色有多个协程、其中一个把它删了**
	#   的时候才会触发 —— 射击生存的克隆体正好有 2~4 个「当作为克隆体启动」脚本。
	# ★节点可能已经不在场景树里了★
	#   克隆体被「删除克隆体」释放、或切屏时节点被移走之后，它的**其它协程**
	#   还会再恢复一轮 —— 那时 `get_tree()` 是 null，而
	#   `await get_tree().process_frame` 会直接报
	#     Invalid access to property or key 'process_frame' on a base object of type 'null instance'
	#   （用户实测：切屏时正好崩在这一行）。
	#   这时标记取消并**不 await** 直接返回：循环末尾的 `if ctx._已取消: break`
	#   会收尾，而且不会卡死（每次进来都立即返回）。
	# ★必须先确认"自己这个节点还活着"★
	#   `get_tree()` 在节点**已被释放**（previously freed）时，**这一行自己就会报**
	#     Parameter "data.tree" is null.
	#   —— 它的实现要去读节点内部的 tree 指针，而那个对象已经没了。
	#   实测琪露诺：返回主菜单时刷出 **132 条**这个错误，全指向这一行。
	#   （以前写的是"先 get_tree() 再判 null"，那条路对"已释放"根本走不到：
	#     `self` 都没了，取 tree 就已经是错的。）
	#   所以顺序必须是：先 is_instance_valid(self) → 再 get_tree() → 再判 null。
	if not is_instance_valid(self):
		return
	var 树 := get_tree()
	if 树 == null:
		_ctx._已取消 = true
		return
	if _ctx._已取消:
		await 树.process_frame
		return
	if _ctx.depth > 0:
		var 本帧 := Engine.get_process_frames()
		if _warp帧号 != 本帧:
			_warp帧号 = 本帧
			_warp帧起点 = Time.get_ticks_msec()
		var 本帧已用 := Time.get_ticks_msec() - _warp帧起点
		# ★warp 段要在**同一帧内**尽量跑完★（不要按"本段已跑 4ms"就让出）
		#   这一条直接决定"数字/克隆是**一起出现**还是**逐个蹦出来 + 闪烁**"：
		#   K4 的「一步执行」语义就是"这一帧里把这段跑完"。以前这里除了帧预算
		#   还卡了一道 `K4_WARP_MS`（4ms）的**段级**让出 —— 于是一个"循环里克隆 14 个"
		#   的 warp 段会跨 3~5 帧才跑完，画面上就是逐个显示（用户实测琪露诺：
		#   `score_4/当接收到广播_fever_2.gd` 第 19 行 `进入warp` 之后每轮都克隆自己）。
		#   现在只保留两道闸：单段迭代上限 + **本帧所有 warp 共享的总预算**。
		#   后者照样拦得住"warp 里套永远循环"（跑满一帧立刻让出，不会占死主线程）。
		if _ctx.iters < K4_WARP_ITERS and 本帧已用 < K4_帧warp预算:
			_ctx.iters += 1
			return
		# ★预算用完 → 必须**真的让出一帧**★
		#   这个函数的注释一直是这么写的，但这里以前只 `return` 了 ——
		#   于是 warp（一步执行）里的 `重复执行（永远）` **永远不让出**：
		#   一帧之内无限转 → 主线程被占死 → 窗口/编辑器"无响应"。
		#   实测 PICKCAT斗地主（914 行的 while true 正好套在 warp 里）：
		#   启动后 90 秒没有任何输出，只能杀进程。
		_ctx.iters = 0
		_ctx.started = Time.get_ticks_msec()
		await 树.process_frame
		return
	await 树.process_frame

## ★让出点（生成器在"连续很多条语句都没有 await"的地方自动插一句）★
##   生成出来的形式是 `await 角色.让出点(ctx)`。
##
##   语义：
##     · **非 warp（depth == 0）→ 立即返回**，什么都不做。
##       K4 里一个帽子的积木体本来就该在同一帧里一路跑到底，插检查点不能改变这个行为；
##     · warp（一步执行）内 → 走 `一步()`，预算用完才真的让出一帧。
##
##   为什么需要它：实测 PICKCAT斗地主 的循环体 914 行里只有 9 个 `一步()`，
##   两个让出点之间的长段（几十行 + 一堆画笔/列表调用）跑多久都不让出 →
##   单帧 process 冲到 **223ms**，而 warp 预算是 16ms/帧。
##   生成器按"密度 16"补点（见 emit.js 的 K4_让出密度）。
func 让出点(ctx: WarpCtx) -> void:
	if ctx == null:
		return
	if ctx.depth > 0:
		await 一步(ctx)

## ★安全让出一帧（角色版）★
##
##   ⚠ **绝对不要**直接写 `await get_tree().process_frame`：
##     节点一旦被释放（`previously freed`），`get_tree()` **这一行自己就会报**
##       Parameter "data.tree" is null.
##     —— 它的实现要去读节点内部的 tree 指针，而那个对象已经没了。
##     实测琪露诺：返回主菜单时刷出 **132 条**这个错误，全指向 `一步()` 里的 `get_tree()`。
##
##   返回 false = "自己已经没了"，调用方应立刻收尾返回（不要再碰任何成员）。
func 让出帧() -> bool:
	if not is_instance_valid(self):
		return false
	var 树 := get_tree()
	if 树 == null:
		return false
	await 树.process_frame
	return is_instance_valid(self)

# =============================================================================
# 变换（唯一写 position / rotation 的地方）
# =============================================================================
func _apply_transform() -> void:
	position = Vector2(k4_x, -k4_y)          # K4 原点在舞台中心、y 轴向上
	rotation = deg_to_rad(90.0 - k4_direction)  # K4 方向 90 = 向右 = rotation 0
	var 系数 := k4_size_percent / 100.0
	scale = Vector2(系数 * _k4_宽缩放, 系数 * _k4_高缩放)
	visible = k4_visible

# =============================================================================
# 舞台对齐 / 画布 / 造型
# =============================================================================
func _对齐舞台层() -> void:
	# 「基础角色层」的 local (0,0) 必须落在舞台中心。
	var 层 := get_parent()
	if 层 is Node2D and k4_clone_of == null:
		var 容器 := 层 as Node2D
		if 容器.get_parent() != null:
			var 视口 := get_viewport_rect().size
			容器.position = 视口 * 0.5      # K4 舞台原点在中心

func _查找画布() -> void:
	if k4_canvas != null and is_instance_valid(k4_canvas):
		return
	# ① 屏幕脚本 _ready() 里注册的那个（最可靠）。
	#    注意：角色的 _ready() 比屏幕根早，所以第一次初始化时这里通常是 null。
	var 注册: Node = K4Canvas.画布
	if 注册 != null and is_instance_valid(注册):
		k4_canvas = 注册
		return
	# ② 按约定名在屏幕里找。不要一上来就递归找"有 落笔 方法的节点"——
	#    角色自己（角色基类）也有 落笔，递归很容易先撞上某个角色。
	var 根 := 屏幕根()
	if 根 != null:
		var 直接 := 根.get_node_or_null("屏幕绘制")
		if 直接 != null and 直接.has_method("落笔"):
			k4_canvas = 直接
			return
	# ③ 最后才递归猜
	k4_canvas = _在子树里找画布(根)

func _在子树里找画布(_节点: Node) -> Node:
	for 子 in _节点.get_children():
		if 子.has_method("落笔"):
			return 子
	for 子 in _节点.get_children():
		var r := _在子树里找画布(子)
		if r != null:
			return r
	return null

func _收集造型() -> void:
	k4_costumes.clear()
	_造型节点名.clear()
	_造型原名.clear()
	_造型名表.clear()
	_造型偏移表.clear()
	_造型节点表.clear()
	造型精灵 = null
	var 容器 := get_node_or_null("customs")
	if 容器 == null:
		return

	# =========================================================================
	# ★新结构：customs 是一个 AnimatedSprite2D★（SpriteFrames 每帧一个造型）
	#   帧号 = K4 造型表顺序 = 角色脚本 `_造型顺序()` 的下标；
	#   各造型的 pivot 偏移在 `_造型偏移()` 里（SpriteFrames 的帧不携带位移）。
	# =========================================================================
	if 容器 is AnimatedSprite2D:
		造型精灵 = 容器 as AnimatedSprite2D
		var 名表: Array = []
		if has_method("_造型顺序"):
			名表 = call("_造型顺序")
		var 偏表: Array = []
		if has_method("_造型偏移"):
			偏表 = call("_造型偏移")
		for i in 名表.size():
			var 名 := String(名表[i])
			if 名 == "":
				continue
			k4_costumes[名] = i
			_造型名表.append(名)
			_造型节点名[名] = 名          # 新结构下没有独立节点名
			_造型原名[名] = 名
			_造型偏移表.append(偏表[i] if i < 偏表.size() else Vector2.ZERO)
		if _造型名表.is_empty():
			return
		# 当前造型：优先用 tscn 里烘好的 frame（生成器写的就是 K4 的 current_style）
		if k4_costume_name == "":
			var f: int = 造型精灵.frame
			k4_costume_name = String(_造型名表[f]) if (f >= 0 and f < _造型名表.size()) else String(_造型名表[0])
		else:
			k4_costume_name = 规范化造型名(k4_costume_name)
		return

	# =========================================================================
	# 老产物兼容：customs 下面是"一个造型一个 Sprite2D"
	#   —— 走原来的逻辑，同时把结构抹平成同一套（k4_costumes 存**序号**）。
	#   "当前造型"必须优先取 tscn 里已经 visible = true 的那个：生成器把 K4 的
	#   current_style 烘成了 visible（其余 false）。以前这里直接取 keys()[0] ——
	#   那是字典顺序的第一个，和"哪个可见"毫无关系（症状：舞台背景被切到空白图）。
	# =========================================================================
	var 首个可见节点名 := ""
	var 别名: Dictionary = {}
	if has_method("_造型别名"):
		别名 = call("_造型别名")
	var 序 := 0
	for 子 in 容器.get_children():
		var 节点名 := String(子.name)
		var 原名 := String(别名.get(节点名, 节点名))
		_造型节点名[原名] = 节点名
		_造型原名[节点名] = 原名
		k4_costumes[原名] = 序
		_造型名表.append(原名)
		_造型节点表[原名] = 子
		_造型偏移表.append((子 as Node2D).position if 子 is Node2D else Vector2.ZERO)
		序 += 1
		if 首个可见节点名 == "" and 子 is CanvasItem and (子 as CanvasItem).visible:
			首个可见节点名 = 节点名
	if k4_costume_name == "" and not _造型名表.is_empty():
		if 首个可见节点名 != "":
			k4_costume_name = String(_造型原名.get(首个可见节点名, 首个可见节点名))
		else:
			k4_costume_name = String(_造型名表[0])
	# 若 k4_costume_name 拿到的是节点名（老产物/克隆继承），换回原名
	elif k4_costume_name != "" and _造型原名.has(k4_costume_name):
		k4_costume_name = String(_造型原名[k4_costume_name])

## 把"节点名 / 别名"换回 K4 原名（老产物、克隆继承都可能带着节点名）
func 规范化造型名(_名: String) -> String:
	if _名 == "" or k4_costumes.is_empty():
		return _名
	if k4_costumes.has(_名):
		return _名
	var 真 := String(_造型原名.get(_名, ""))
	return 真 if 真 != "" else _名

## 造型序号（0 基 = SpriteFrames 帧号）；找不到返回 -1
func 造型序号(_名: String = "") -> int:
	var 名 := 规范化造型名(k4_costume_name if _名 == "" else _名)
	return int(k4_costumes.get(名, -1))

## 当前造型的**纹理**（碰撞掩码 / 画笔图章 / 造型尺寸都用它）
func 当前纹理() -> Texture2D:
	if 造型精灵 != null:
		var sf := 造型精灵.sprite_frames
		if sf == null:
			return null
		return sf.get_frame_texture(造型精灵.animation, 造型精灵.frame)
	var 子 = _造型节点表.get(k4_costume_name)
	if 子 is Sprite2D:
		return (子 as Sprite2D).texture
	return null

## 指定造型的纹理（不改变当前造型）
func 造型纹理(_名: String) -> Texture2D:
	# 新结构：从 SpriteFrames 里按帧号取
	if 造型精灵 != null:
		var 序 := 造型序号(_名)
		if 序 < 0:
			return null
		return 造型精灵.sprite_frames.get_frame_texture(造型精灵.animation, 序)
	var 子 = _造型节点表.get(规范化造型名(_名))
	if 子 is Sprite2D:
		return (子 as Sprite2D).texture
	return null

func _应用造型(_名称: String = "") -> void:
	var 原名 := 规范化造型名(k4_costume_name if _名称 == "" else _名称)
	if not k4_costumes.has(原名):
		return                     # 找不到这个造型：什么都不做（K4 里也是没反应）
	k4_costume_name = 原名
	var 序: int = int(k4_costumes[原名])
	# ★新结构：切帧 + 套用该造型的 pivot 偏移★
	if 造型精灵 != null:
		造型精灵.frame = 序
		if 序 >= 0 and 序 < _造型偏移表.size():
			造型精灵.position = _造型偏移表[序]
		return
	# 老产物：切 visible
	for 名 in _造型节点表.keys():
		var 子 = _造型节点表[名]
		if 子 is CanvasItem:
			(子 as CanvasItem).visible = (String(名) == 原名)

# =============================================================================
# 透明 API：画布转发 / 画笔（生成代码可以直接调这些）
# =============================================================================
func 画布落笔(_终点: Vector2) -> void:
	if not k4_pen_down:
		return
	# 初始化时屏幕脚本很可能还没 _ready（Godot 的 _ready 是子先父后），
	# 那时 k4_canvas 是 null。第一次真落笔时再找一次，别把笔画丢了。
	if k4_canvas == null or not is_instance_valid(k4_canvas):
		_查找画布()
	if k4_canvas != null and is_instance_valid(k4_canvas) and k4_canvas.has_method("落笔"):
		# k4_last_pen_point / _终点 都是 K4 坐标（原点在舞台中心、y 向上），
		# 而画布节点待在舞台左上角、用 y 向下的舞台坐标 —— 必须换算。
		k4_canvas.落笔(k4到舞台(k4_last_pen_point), k4到舞台(_终点), k4_pen_color, k4_pen_size)
	k4_last_pen_point = _终点

# K4 坐标（原点在舞台中心、y 轴向上）-> 舞台坐标（原点在舞台左上角、y 轴向下）
func k4到舞台(_点: Vector2) -> Vector2:
	var 尺寸 := get_viewport_rect().size
	return Vector2(尺寸.x * 0.5 + _点.x, 尺寸.y * 0.5 - _点.y)

func 设置画布(_画布: Node) -> void:
	k4_canvas = _画布

# =============================================================================
# 跨角色查找
# =============================================================================
# 在「基础角色层」下按名找角色（先按自己这一层找，再全场景兜底）。
# 安全取整：K4 的计数器可能是 null（桩方法的默认返回）/ 字符串 / 布尔。
# Godot 4 里 int(null) 会直接报错，所以循环次数一律走这里。
# -----------------------------------------------------------------------------
# 变量 / 列表：演员脚本（<角色名>.gd）里声明了**真实成员变量**
# （局部变量 -> v_名字，局部列表 -> l_名字），这样调试器"变量"面板里能看到中文名。
# 生成代码统一走这两个入口按名读写。
# -----------------------------------------------------------------------------
# -----------------------------------------------------------------------------
# K4 语义的比较与算术
#
# 为什么需要它们：K4 是动态类型且会做强制转换（"5" = 5 为真、"a" + 1 得 "a1"），
# 而 GDScript 对**静态已知类型不同**的字面量会直接报解析错
# （Invalid operands "String" and "float" for "==" operator）。
# 所以生成器只在**两侧都是动态值（Variant）**时才内联原生运算符；
# 一旦有一侧是字面量且类型不同，就退回这两个函数走 K4 语义。
# -----------------------------------------------------------------------------
func _转数值(_v: Variant) -> float:
	if _v == null:
		return 0.0
	if _v is bool:
		return 1.0 if _v else 0.0
	if _v is float or _v is int:
		return float(_v)
	if _v is String:
		var s: String = _v
		if s.strip_edges() == "":
			return 0.0
		return s.to_float() if s.is_valid_float() else NAN
	return NAN

# K4 的真值规则（GDScript 的 if 只吃 bool，而 K4 的 "computer" 也是真）
func 为真(_v: Variant) -> bool:
	if _v == null:
		return false
	if _v is bool:
		return _v
	if _v is float or _v is int:
		return float(_v) != 0.0
	if _v is String:
		var s: String = _v
		if s == "" or s == "0" or s.to_lower() == "false":
			return false
		return float(s) != 0.0 if s.is_valid_float() else true
	return true

# 语义明确的比较（只在 K4 的弱类型比较会跟 GDScript 冲突时才生成）
func 等于(_a: Variant, _b: Variant) -> bool:   return 比较("eq", _a, _b)
func 不等于(_a: Variant, _b: Variant) -> bool: return 比较("neq", _a, _b)
func 小于(_a: Variant, _b: Variant) -> bool:   return 比较("lt", _a, _b)
func 小于等于(_a: Variant, _b: Variant) -> bool: return 比较("lte", _a, _b)
func 大于(_a: Variant, _b: Variant) -> bool:   return 比较("gt", _a, _b)
func 大于等于(_a: Variant, _b: Variant) -> bool: return 比较("gte", _a, _b)

func 比较(_运算符: String, _a: Variant, _b: Variant) -> bool:
	# K4/Scratch 的规则：两侧**都能当数字**就按数字比，否则按**字符串**比（字典序）。
	# 以前 lt/lte/gt/gte 在非数值时一律返回 false —— 那是错的（"abc" < "abd" 应该为真）。
	var an := _转数值(_a)
	var bn := _转数值(_b)
	var 双数值 := not is_nan(an) and not is_nan(bn)
	var sa := str(_a)
	var sb := str(_b)
	match _运算符:
		"eq":  return (an == bn) if 双数值 else (sa == sb)
		"neq": return (an != bn) if 双数值 else (sa != sb)
		"lt":  return (an < bn) if 双数值 else (sa < sb)
		"lte": return (an <= bn) if 双数值 else (sa <= sb)
		"gt":  return (an > bn) if 双数值 else (sa > sb)
		"gte": return (an >= bn) if 双数值 else (sa >= sb)
	return false

func 算术运算(_运算符: String, _a: Variant, _b: Variant) -> Variant:
	match _运算符:
		"add":
			# K4/Scratch：「两侧都能当数字」就做数值加法，否则拼字符串。
			#   6 + 1 = 7        "5" + 1 = 6        "a" + 1 = "a1"
			# 不能写成「任一侧是 String 就拼接」—— 那样 "5" + 1 会得到 "51"。
			var an := _转数值(_a)
			var bn := _转数值(_b)
			if not is_nan(an) and not is_nan(bn):
				return an + bn
			return str(_a) + str(_b)
		"sub": return _转数值(_a) - _转数值(_b)
		"mul": return _转数值(_a) * _转数值(_b)
		"div": return _转数值(_a) / _转数值(_b)
		"pow": return pow(_转数值(_a), _转数值(_b))
	return 0.0

# -----------------------------------------------------------------------------
# 类型转换 / 取余 —— 放在**库层**（生成代码的基础设施）
# -----------------------------------------------------------------------------
# 生成器会把弱类型的算术写成 `角色.转数字(x)`：
#   K4 里 `"175" / 1000` 合法（= 0.175），而 GDScript 运行期会直接报
#   Invalid operands 'String' and 'float' in operator '/'。
# 所以凡是要"当数字用"的动态值都得先转一次。
# 这三个是**每个算术表达式都可能用到**的东西，必须始终可用 ——
# 所以它们放在库层，而不是等你去 角色自带积木.gd 里填桩（那样会静默算错）。
func 转数字(_值: Variant) -> float:
	var n := _转数值(_值)
	return 0.0 if is_nan(n) else n

func 转文本(_值: Variant) -> String:
	if _值 == null:
		return ""
	if _值 is bool:
		return "true" if _值 else "false"
	if _值 is float:
		# K4 里 3.0 要显示成 "3"（str(3.0) 会得到 "3.0"）
		var f: float = _值
		if is_equal_approx(f, roundf(f)) and absf(f) < 1e15:
			return str(int(f))
		return str(f)
	return str(_值)

# K4 的取余结果符号**跟随除数**（-7 mod 3 = 2、7 mod -3 = -2），
# 而 GDScript 的 fmod 让符号跟随被除数 —— 不能直接用。
func 取余(_a: Variant, _b: Variant) -> Variant:
	var x := _转数值(_a)
	var y := _转数值(_b)
	if y == 0.0:
		return 0.0
	var r := fmod(x, y)
	if r != 0.0 and ((r < 0.0) != (y < 0.0)):
		r += y
	return r

# -----------------------------------------------------------------------------
# K4 的「计算」积木（块类型 calculate -> core.js op('calculate') -> 自带积木.计算）
#   用户在积木里**直接写算式文本**（实测样例："1+2"、"sin1"、"9/11"、"15/16"、"3/4"）。
#   K4 的算式语法和 GDScript 很像，但有三处不一样，求值前必须归一化：
#     ① 函数可以**不带括号**：K4 用户写 `sin1`；而 Godot 的 Expression 只认 `sin(1)`，
#        不补括号就会把 sin1 当成"未定义标识符" → 整个算式求值失败。
#     ② 幂用 `^`：K4/Scratch 的 `2^3` 是 8，而 GDScript/Expression 的 `^` 是**按位异或**
#        （2^3 == 1）—— 不换掉会静默算错，而且不报任何错。
#     ③ 中文全角符号：`（）、×、÷、－` 在中文输入法下很常见，Expression 一律不认。
#   求值失败返回 0.0（K4 里"算不出来就是 0"），只在编辑器里 push_warning，不影响运行。
#   方法名带 `_k4` 前缀：K4 的标识符不可能以 `_` 开头，所以永远不会和用户变量/积木重名。
# -----------------------------------------------------------------------------
## ★把算式里的"变量名"换成它的数值★
##
##   K4 的「计算」积木允许在算式里**直接写变量名**（例：`(14.1249690204859-cr)/15.24`）。
##   实测琪露诺：这样的算式直接送进 Expression 会报
##     Invalid operands to operator -, float and String.
##   （转换器把变量名写成了带引号的 `"cr"`，Expression 就当成字符串字面量了。）
##
##   规则（照 K4）：
##     · 变量名（含中文名）→ 换成它的**数值**；
##     · 值确实是字符串时 → 换成**带引号的字符串**（这样 `+` 仍能当拼接用）；
##     · **函数名 / 常量名不碰**（sin、cos、pi、e、log、sqrt…）；
##     · 认不出来的名字 → 换成 0（K4 里"没有值就是 0"），
##       免得一个名字就让整个算式求值失败、连累后面所有项。
func _k4算式换变量(文本: String) -> String:
	const 保留 := ["pi", "e", "sin", "cos", "tan", "asin", "acos", "atan",
		"k4sin", "k4cos", "k4tan", "k4asin", "k4acos", "k4atan",
		"log", "ln", "sqrt", "abs", "exp", "floor", "ceil", "round", "sign",
		"deg_to_rad", "rad_to_deg", "clamp", "pow", "min", "max", "fmod",
		"true", "false", "not", "and", "or"]
	var re := RegEx.new()
	if re.compile("\"([^\"]*)\"|([A-Za-z_\\x{4e00}-\\x{9fa5}][A-Za-z0-9_\\x{4e00}-\\x{9fa5}]*)") != OK:
		return 文本
	var 出 := ""
	var 上 := 0
	for m in re.search_all(文本):
		出 += 文本.substr(上, m.get_start() - 上)
		上 = m.get_end()
		var 名 := m.get_string(1)
		if 名 == "":
			名 = m.get_string(2)
		if 保留.has(名):
			出 += m.get_string()
			continue
		var 值: Variant = 取值(名)
		if 值 is float or 值 is int:
			出 += str(float(值))
		elif 值 is String:
			var sv := String(值)
			if sv.is_valid_float():
				出 += str(sv.to_float())
			else:
				出 += "\"" + sv.replace("\"", "\\\"") + "\""
		elif 值 == null:
			出 += "0.0"
		else:
			出 += str(_转数值(值))
	出 += 文本.substr(上)
	return 出

func _k4算式求值(文本: String) -> float:
	# ★K4 的三角函数用「度」，不是弧度★ —— 归一化时把函数名换成 k4 前缀，
	#   这里再**展开**成 "sin(deg_to_rad(...))" 这种纯表达式。
	#   实测依据（查表4(2)，用户去掉随机数后专门验算出来的）：
	#     积木里两个 sin(3) 项，
	#       K4 的 "sin(3)"  = 0.05233595624294383  （= sin(3°)）
	#       Godot/JS 的 sin  = 0.1411200080598672  （弧度）
	#     单项差 0.0887840518169234，两项 = 0.1775681036338468，
	#     而"Godot 算出的角色变量 − K4 的核对运算结果" = 0.177568103633836，
	#     吻合到 1e-12 —— 误差就是这么来的。
	#   ⚠ Expression **没有** add_function（那是 Godot 3 之外不存在的 API，我一开始记错了），
	#     所以只能做文本展开。反三角是**返回度**，用 rad_to_deg 包一层。
	# ★先把算式里的"变量名"换成数值★（K4 的「计算」允许直接写变量名）
	#   顺序：换变量 -> 归一化（全角/函数/数字浮点）-> 三角展开
	var s := _k4三角展开(_k4算式归一(_k4算式换变量(文本)))
	if s.strip_edges() == "":
		return 0.0
	var e := Expression.new()
	# 常量走 input_names：算式里写 pi / e 都能用（Godot 的 @GlobalScope 没有 E 常量）
	var 错 := e.parse(s, ["pi", "e"])
	if 错 != OK:
		push_warning("「计算」积木：算式解析失败 \"" + 文本 + "\" -> " + e.get_error_text())
		return 0.0
	var r: Variant = e.execute([PI, 2.718281828459045], null, false)
	if e.has_execute_failed():
		push_warning("「计算」积木：算式求值失败 \"" + 文本 + "\" -> " + e.get_error_text())
		return 0.0
	if r is bool:
		return 1.0 if r else 0.0
	if r is float or r is int:
		var n := float(r)
		# 除零会得到 inf/nan —— 统一按 K4 的"没有值"处理成 0，避免污染后面的算术
		return 0.0 if (is_nan(n) or is_inf(n)) else n
	return _转数值(r)

func _k4算式归一(文本: String) -> String:
	var t := 文本.strip_edges()
	# 全角 -> 半角（中文输入法下用户就是这么写的）
	t = t.replace("（", "(").replace("）", ")").replace("［", "[").replace("］", "]")
	t = t.replace("×", "*").replace("÷", "/").replace("－", "-").replace("＋", "+")
	t = t.replace("＊", "*").replace("／", "/").replace("％", "%").replace("＾", "^")
	t = t.replace("，", ",").replace("　", " ").replace("π", "pi")
	# K4 的 ln 是自然对数，Expression 里叫 log
	t = t.replace("ln", "log")
	# K4 写的 arcsin/arccos/arctan，Expression 里叫 asin/acos/atan
	t = t.replace("arcsin", "asin").replace("arccos", "acos").replace("arctan", "atan")
	# 幂：Expression 的 ^ 是按位异或，** 才是乘方
	t = t.replace("^", "**")
	# 不带括号的函数调用：sin1 -> sin(1)、cos 2 -> cos(2)、sqrt9 -> sqrt(9)
	#   只处理"函数名 + 可选空格 + 一个数字"这种最常见形态（K4 用户基本这么写）
	var re := RegEx.new()
	if re.compile("(?<![A-Za-z0-9_])(asin|acos|atan|sinh|cosh|tanh|sin|cos|tan|log|sqrt|abs|exp|floor|ceil|round|sign)(\\s*)(-?[0-9]+(?:\\.[0-9]+)?)") == OK:
		t = re.sub(t, "$1($3)", true)
	# ★把三角函数换成带 k4 前缀的自定义函数（度语义，见 _k4算式求值 里的说明）★
	#   必须先反三角、后正三角：否则 asin 里的 "sin" 会被后一条规则抢先替换
	#   变成 "a k4sin"。（(?![A-Za-z0-9_]) 也顺手挡住了 sinh/cosh/tanh）
	var re反 := RegEx.new()
	if re反.compile("(?<![A-Za-z0-9_])(asin|acos|atan)(?![A-Za-z0-9_])") == OK:
		t = re反.sub(t, "k4$1", true)
	var re正 := RegEx.new()
	if re正.compile("(?<![A-Za-z0-9_])(sin|cos|tan)(?![A-Za-z0-9_])") == OK:
		t = re正.sub(t, "k4$1", true)
	# ★把整数字面量全部变成浮点★（必须放在最后一步）
	#
	#   为什么必须这么干：Godot 的 `Expression` 里 **`5/64` 是整除 = 0**，
	#   而 K4/JS 里是 0.078125。实测最小用例 `运算 (2).bcm4`：
	#     算式  1+2-4*6+(3+2)/8^2+cos(65)
	#     我们  -20.5773817382593
	#     K4    -20.4992567382593
	#     差    -0.078125  ← 正好是 (3+2)/8^2 = 5/64 被整除成 0 的那一项
	#   单项验证（Expression 直接跑）：
	#     `(3+2)/64` → 0        ★错★
	#     `8**2`     → 64       ✓ 幂本身没问题
	#     `5/8**2`   → 0        ★错★
	#   把数字写成 `1.0` / `64.0` 之后，`/` 就是浮点除法，与 K4 一致。
	#   （后面的 `(?![0-9.])` 保证不会破坏已有的 `1.5` 或再重复加 `.0`；
	#     前面的 `(?<![0-9A-Za-z_.])` 保证不会碰 `pi2` 这类标识符里的数字。）
	var re数 := RegEx.new()
	if re数.compile("(?<![0-9A-Za-z_.])([0-9]+)(?![0-9.])") == OK:
		t = re数.sub(t, "$1.0", true)
	return t

## 把归一化后的 k4sin(...) / k4asin(...) 等**展开**成纯表达式：
##   k4sin(x)  -> sin(deg_to_rad(x))
##   k4asin(x) -> rad_to_deg(asin(clamp(x,-1,1)))
## 需要自己做**括号配对**，因为参数本身可能含括号或嵌套调用：
##   k4sin(1+2)*3    -> sin(deg_to_rad(1+2))*3
##   k4sin(k4cos(2)) -> sin(deg_to_rad(cos(deg_to_rad(2))))
func _k4三角展开(文本: String) -> String:
	const 名表 := ["k4asin", "k4acos", "k4atan", "k4sin", "k4cos", "k4tan"]
	var 出 := ""
	var i := 0
	var n := 文本.length()
	while i < n:
		var 命中 := ""
		for 名 in 名表:
			if i + 名.length() <= n and 文本.substr(i, 名.length()) == 名:
				命中 = 名
				break
		if 命中 == "" or (i > 0 and _是标识符字符(文本[i - 1])):
			出 += 文本[i]
			i += 1
			continue
		var j := i + 命中.length()
		while j < n and 文本[j] == " ":
			j += 1
		if j >= n or 文本[j] != "(":
			出 += 文本[i]
			i += 1
			continue
		# 括号配对
		var 深 := 0
		var k := j
		while k < n:
			if 文本[k] == "(":
				深 += 1
			elif 文本[k] == ")":
				深 -= 1
				if 深 == 0:
					break
			k += 1
		if k >= n:      # 括号不闭合，原样输出，交给 Expression 报错
			出 += 文本[i]
			i += 1
			continue
		var 参 := _k4三角展开(文本.substr(j + 1, k - j - 1))
		match 命中:
			"k4sin":  出 += "sin(deg_to_rad(" + 参 + "))"
			"k4cos":  出 += "cos(deg_to_rad(" + 参 + "))"
			"k4tan":  出 += "tan(deg_to_rad(" + 参 + "))"
			"k4asin": 出 += "rad_to_deg(asin(clamp(" + 参 + ",-1,1)))"
			"k4acos": 出 += "rad_to_deg(acos(clamp(" + 参 + ",-1,1)))"
			"k4atan": 出 += "rad_to_deg(atan(" + 参 + "))"
		i = k + 1
	return 出

func _是标识符字符(_c: String) -> bool:
	return _c != "" and ((_c >= "a" and _c <= "z") or (_c >= "A" and _c <= "Z") or
		(_c >= "0" and _c <= "9") or _c == "_")

# -----------------------------------------------------------------------------
# 屏幕（K4 的「屏幕」= Godot 的一个场景 .tscn）
#   屏幕表 / 当前屏幕 / 屏幕路径 都在 K4Global 上（转换器按工程生成）。
# -----------------------------------------------------------------------------
## 「发送广播」——K4 的 self_broadcast / self_broadcast_and_wait。
##   K4 的广播块**自带一段脚本**（语义 = 先把消息发出去，再立刻执行那段脚本），
##   生成器把那段脚本放进了帽子的体里，所以这里只负责**真的把信号发出去**。
##   ⚠ 以前 emit 只生成了注释 + 体，**没有"发广播"这个动作** ——
##     「发送广播」的接收方永远收不到（用户实测："广播没发出去"）。
##   「发送广播并等待」走 自带积木.广播并等待()（它会 await 所有监听者的协程）。
func 广播(_名) -> void:
	# ★带上"我在哪个屏幕"★：K4 的广播每个屏幕各自独立（K4Bus 按屏幕过滤监听者）
	K4Bus.发信号(str(_名), 屏幕根())

func 切换屏幕(_名) -> void:
	# ★屏幕切换 = 在**游戏屏幕容器**里换显示哪一个屏幕场景★
	#   所有屏幕场景一开始就都在树里（`全局/游戏屏幕.tscn`），切换只改可见性 +
	#   当前屏幕名 + 画布指向，**不再 change_scene_to_file** ——
	#   这样每个屏幕的角色/变量/克隆体都保留着（K4 的运行组也是这个语义），
	#   广播也天然按屏幕隔离（K4Bus 用屏幕根做身份）。
	if K4Canvas.has_method("转场入场"):
		await K4Canvas.转场入场()
	K4Global.切换屏幕到(String(_名))

func 当前屏幕是(_名) -> bool:
	var a: String = K4Global.屏幕路径(String(_名))
	if a == "":
		return String(_名) == K4Global.当前屏幕
	return a == K4Global.屏幕路径(K4Global.当前屏幕)

## K4 变量名 -> 生成出来的成员名。
##   ★为什么需要这层解析★：跨角色访问（K4 的「<角色> 的 <变量名>」积木）传来的是
##   K4 **原名**（"i"），而成员名带命名空间前缀（局部变量 `_v_`、局部列表 `_l_`，
##   见 emit.js 的 NS_PREFIXES）—— 直接 get("i") 永远拿不到 `_v_i`。
##   症状就是"跨角色读变量读不到（null / 0），看起来变量不属于那个角色"。
##   映射表由生成器写在各角色脚本的 _变量别名() 里（K4 原名 -> 成员名）。
func _解析变量名(_名: String) -> String:
	if has_method("_变量别名"):
		var 表: Variant = call("_变量别名")
		if 表 is Dictionary and (表 as Dictionary).has(_名):
			return str((表 as Dictionary)[_名])
	# 兜底：该变量没有归属信息（映射表里没有）时按命名空间前缀猜。
	# 变量名里含非法标识符字符的话生成器已清洗过，这里的猜法会落空 ——
	# 那种情况由上面的映射表覆盖。
	if get("_v_" + _名) != null:
		return "_v_" + _名
	if get("_l_" + _名) != null:
		return "_l_" + _名
	return _名

func 取值(_名: String) -> Variant:
	var v: Variant = get(_解析变量名(_名))
	if v != null:
		return v
	# 兜底：也可能读的是全局变量（它们在 autoload K4Global 上，同样带前缀）
	if K4Global.get("_v_" + _名) != null:
		return K4Global.get("_v_" + _名)
	if K4Global.get("_l_" + _名) != null:
		return K4Global.get("_l_" + _名)
	return K4Global.取值(_名)

func 列表(_名: String) -> Array:
	var 键 := _解析变量名(_名)
	var v: Variant = get(键)
	if v is Array:
		return v
	var a: Array = []
	set(键, a)
	return a

# K4 的「复制 <值> 到 <列表>」。
# 值通常是另一个列表，或者 text_split 的结果（「把文本按分隔符分开成列表」）——
# K4 编辑器里那是一个**嵌套块**，外层是「复制…到…」、内层是「…分开成列表」。
# Array 是引用类型，所以就地 clear + append_array 就能改到调用方持有的那一份
#（目标常常是 autoload 上的全局列表 K4Global.xxx）。
func 复制列表(_目标: Variant, _值: Variant) -> void:
	if _目标 == null or not (_目标 is Array):
		return
	var 目标: Array = _目标
	目标.clear()
	if _值 is Array:
		目标.append_array(_值)
	elif _值 != null:
		目标.append(_值)

func 转整数(_值: Variant) -> int:
	if _值 == null:
		return 0
	if _值 is bool:
		return 1 if _值 else 0
	if _值 is String:
		var s: String = _值
		return int(s.to_float()) if s.is_valid_float() else 0
	return int(_值)

func 找(_名: String) -> Node:
	var 层 := get_parent()
	if 层 != null:
		var 命中 := _在子树里找名(层, _名)
		if 命中 != null:
			return 命中
	# ② 兜底：在**整个屏幕**里找。为什么需要这一步 ——
	#    K4 的「舞台实体」（scene 自己，背景板造型挂在它身上）挂在 **舞台层**，
	#    它不在 基础角色层 里，所以上面那一步找不到它。
	#    ⚠ 必须从屏幕的**子节点**开始找，不能把屏幕根自己算进去：
	#    场景根节点常常和某个角色同名（舞台就叫「背景」），
	#    否则 找("背景") 会命中屏幕根，跨角色调用就打到没有该方法的对象上。
	var 屏 := 屏幕根()
	if 屏 != null:
		for 子 in 屏.get_children():
			if _节点匹配(子, _名):
				return 子
			var r := _在子树里找名(子, _名)
			if r != null:
				return r
	return null

# 本角色所在的「屏幕」= 场景根。
# 从自己沿父链往上走，走到 root（视口）就停 —— autoload 是 root 的子节点，
# 绝不能用"一直往上走"的方式找根，否则会跨到 autoload 甚至别的场景去
# （以前 _查找画布() 就是这么写的，结果在 视口 的孩子里撞上了 K4Canvas 这个
#  转发单例，把 k4_canvas 指成了它 —— 能用，但不是画布节点本身）。
func 屏幕根() -> Node:
	var 树 := get_tree()
	if 树 == null:
		return null          # 还没入树（例如 _ready 之前 / 已被 release）—— 调用方按"拿不到屏幕"处理
	# ① 优先认**已登记的屏幕节点**（屏幕脚本 _ready 里登记的那个）——
	#    这样屏幕场景挂在容器下、root 下、或别的节点下都能对上
	#    （帽子基类._屏幕根() 用同一套规则，两者的结果必须一致）。
	var 表: Dictionary = {}
	if K4Global != null and K4Global.get("屏幕节点") != null:
		表 = K4Global.屏幕节点
	var 根: Node = self
	while 根 != null:
		for k in 表.keys():
			if 表[k] == 根:
				return 根
		根 = 根.get_parent()
	# ② 还没登记 → 退回结构判断
	var 容器: Node = (K4Global.游戏屏幕 if K4Global != null else null)
	根 = self
	while 根.get_parent() != null:
		var 父 := 根.get_parent()
		if 父 == 树.root:
			return 根                                  # 旧架构：屏幕场景直接挂 root
		if 容器 != null and is_instance_valid(容器) and 父 == 容器:
			return 根                                  # 游戏屏幕容器架构
		根 = 父
	return 根

func _在子树里找名(_节点: Node, _名: String) -> Node:
	for 子 in _节点.get_children():
		if _节点匹配(子, _名):
			return 子
	for 子 in _节点.get_children():
		var r := _在子树里找名(子, _名)
		if r != null:
			return r
	return null

## 这个节点在 K4 里是不是叫 `_名`。
##   ★两种名字都要认★：Godot 的节点名必须是合法标识符，而 K4 的角色名可以叫
##   「变量独立性2(1)」—— 生成器把它清洗成节点名（"变量独立性2(1)" -> "变量独立性2_1_"），
##   并在角色脚本里写下 `_K4原名()` 保留原名。
##   K4 的「<角色> 的 <属性>」「告诉 <角色> 执行 …」传来的都是**原名**，
##   只比节点名的话这类积木会直接找不到目标（症状：跨角色读变量恒为 0）。
func _节点匹配(_节点: Node, _名: String) -> bool:
	if String(_节点.name) == _名:
		return true
	if _节点.has_method("_K4原名"):
		return str(_节点.call("_K4原名")) == _名
	return false

# =============================================================================
# 克隆（整个角色子树实例化一份，挂到同一个「克隆体层 / 基础角色层」下）
# =============================================================================
# 克隆体命名的全局序号。
# ★不能用 k4_clones.size() + 1 当编号★
#   那个数会因为「删除克隆体」而变小，于是新名字和**还活着的**旧克隆体撞名，
#   Godot 只好把它改成 @Node2D@123 —— 实测 克隆体测试 的 57 个克隆里
#   一半叫 @Node2D@N，调试器/编辑器里完全看不懂谁是谁。
static var _克隆序号: int = 0
# ★「每角色每帧克隆上限」用的计数★（见 K4_每帧克隆上限 的注释）
static var _克隆帧号: int = -1
static var _克隆本帧次数: Dictionary = {}

func 克隆自己() -> Node:
	# ★K4 的「每实体每帧克隆上限」：超了就**静默拒绝**★
	#   K4 源码 clone_entity()：
	#     if (entities_cloned_times[e] > entity_max_clones_per_frame) → 整个 if 不进
	#     即：不创建、不排队、不删旧的，直接什么都不做。
	#   为什么必须照抄：warp 里的循环克隆一帧能创建几百上千个，而 K4 会卡在 300 ——
	#   不补这一道，作品里的克隆数就会**远超逻辑上该触发的数量**。
	var 本帧 := Engine.get_process_frames()
	if _克隆帧号 != 本帧:
		_克隆帧号 = 本帧
		_克隆本帧次数.clear()
	var 我 := get_instance_id()
	var 本帧已克隆 := int(_克隆本帧次数.get(我, 0))
	if 本帧已克隆 >= K4_每帧克隆上限:
		return null
	_克隆本帧次数[我] = 本帧已克隆 + 1
	# 记下克隆开始时刻 —— 结束时要把这段耗时从 warp 预算里扣掉（见函数末尾的注释）
	var 克隆开始 := Time.get_ticks_msec()
	var 新体 := duplicate(DUPLICATE_USE_INSTANTIATION)
	if 新体 == null:
		return null
	var 体 := 新体 as Node2D
	if 体 == null:
		return null
	# ★必须显式把脚本补上★
	#   实测（_k4tmp_probe 的克隆诊断）：duplicate() 复制出来的节点
	#   `get_script()` 是 **null** —— 于是克隆体没有任何 k4_ 状态、也没有
	#   积木方法，`体.set("k4_出生帧", …)` 直接报
	#   "Invalid assignment of property or key ... on a base object of type 'Node2D'"。
	#   （脚本是运行时 set_script 挂上的节点尤其如此；即使来自 .tscn，
	#     显式补一次也无害且更稳。）
	if 体.get_script() == null:
		var 自身脚本 = get_script()
		if 自身脚本 != null:
			体.set_script(自身脚本)
	_克隆序号 += 1
	体.name = str(name) + "_克隆" + str(_克隆序号)
	# =========================================================================
	# ★把"原体当前的全部 K4 状态"同步给克隆体★
	# =========================================================================
	# K4/Scratch 的克隆体是"原体此刻的快照"：位置 / 方向 / 大小 / 造型 /
	# 可见性 / 特效 / 图层 / 画笔颜色…… 全部继承**当前值**。
	# 为什么必须显式同步：Godot 的 duplicate() 会复制**节点属性**
	# （position/scale/rotation/visible/modulate…），但**脚本成员的当前值不会
	# 自动带过去** —— 克隆体上那些 `k4_*` 是脚本里声明时的初始值。
	# 于是"原体已经移到 (100,50)、大小 30%"，克隆体却按初始态出生。
	# 这里按属性名逐个搬一遍，语义就是"完全继承当前状态"。
	# ── 第 1 次搬状态（入树**前**）──
	_克隆搬状态(体)
	# ★帽子的"运行时状态"要清掉★（见 帽子基类.重置运行状态 的注释）
	#   duplicate() 把原体帽子的 `_运行中` / `_待触发` / `_ctx` 也复制过来了：
	#   不清的话克隆体会"替原体跑一轮事件"，或者自己的帽子被"不重入"永远挡住。
	_重置帽子状态(体)
	# 出生保护：这一帧（以及下一帧）不参与碰撞，等价于 Scratch 的
	# "克隆体 drawable 还没建立" 那一帧。见 k4_出生帧 的注释。
	# ⚠ 用 set() 而不是 `体.k4_出生帧 = ...`：体的静态类型是 Node2D，
	#   直接点属性在部分情况下会报 "Invalid assignment of property or key
	#   'k4_出生帧' ... on a base object of type 'Node2D'"。
	体.set("k4_出生帧", Engine.get_process_frames() + 1)
	# ★先入树，再搬第 2 次状态★
	#   克隆体入树的瞬间 Godot 会调用**它自己的 _ready()** —— 而角色脚本的 _ready
	#   会执行 `初始化()` 并把**本角色的变量初值**重新赋一遍（<角色名>.gd 末尾那几行）。
	#   如果只搬一次（入树前），那次 _ready 会把刚搬进去的值**全部覆盖回初值**：
	#   实测 原体 _v_y=500 → 克隆出来却是 74（初值），看起来就像"克隆体不继承角色变量"。
	#   所以顺序必须是：入树（让它自己 _ready 跑完）→ 再搬一次原体此刻的状态。
	# ★★入树**之前**就要把它标成克隆体★★
	#
	#   因为 `add_sibling()` 会**立刻触发克隆体自己的 `_ready()`**，而 `帽子基类` /
	#   `帽子_广播` 的 `_ready` 里要判断 `角色.k4_is_clone` 来决定"要不要注册监听、
	#   要不要响应事件"。以前这一步放在入树**之后** →
	#   克隆体的 `_ready` 看到的还是 `false` → **每个克隆体都注册了广播监听** →
	#   广播一来"克隆体又克隆自己" → **指数增长**
	#   （实测琪露诺：连发 30 次「fever」→ 克隆数从 151 涨到 950+、对象数破 11548）。
	#
	#   注意入树后还要**再标一次**：`_克隆搬状态()` 会把 `k4_` 前缀的成员（含
	#   `k4_is_clone` / `k4_clone_of`）从原体一起搬过来，会把这里的值覆盖掉。
	体.set("k4_is_clone", true)
	体.set("k4_clone_of", self)
	add_sibling(体)
	_克隆搬状态(体)
	# 关系字段放到最后再确认一次：它们是"生命周期"标记，不能被上面的搬状态覆盖
	if 体.has_method("标为克隆"):
		体.标为克隆(self)
	else:
		体.set("k4_is_clone", true)
		体.set("k4_clone_of", self)
	k4_clones.append(体)
	# 超出「每个角色」的克隆上限 → 销毁**最老的**（照抄 K4 的 FIFO 淘汰：
	# original_id_2_clone_id_list[原体] 超长时从头上 dispose_clone）。
	# 注意是 while 不是 if：一次多出来的可能不止一个。
	while k4_clones.size() > K4_每角色克隆上限:
		var 最老 = k4_clones.pop_front()
		if 最老 != null and is_instance_valid(最老):
			最老.queue_free()
	# ★把"克隆本身的耗时"从 warp 预算里扣掉★
	#
	#   为什么必须扣：Godot 的 `duplicate()` 要**深拷贝整棵节点树 + 重新实例化子场景**
	#   （角色的帽子都是子节点），比 K4/Scratch 的克隆慢 1~2 个数量级 —— 一次克隆
	#   就可能吃掉几毫秒。而 K4 里"一步执行"的循环**经常是"每轮克隆一个"**
	#   （琪露诺的 `score_4/当接收到广播_fever_2`：`进入warp` 之后循环 文字长度(fever) 次，
	#     每轮 `克隆自己()` + `一步()`；`ice_1_/当接收到广播_特效` 同理 7~14 个）。
	#   实测（_dev/kirino_check.gd）：不扣的话 8 个克隆会摊到 4~6 帧（20→22→23→24→26…），
	#   画面上就是**数字/克隆逐个蹦出来 + 闪烁**；这正是用户报的第三个问题。
	#
	#   扣掉之后：克隆耗时不计入 warp 预算，warp 段能在**同一帧**把整轮克隆跑完
	#   （整帧确实变长、会掉几帧，但画面是对的 —— 这正是 K4 的表现）。
	#   `K4_WARP_ITERS` 那道迭代上限仍然在，所以"warp 里套永远循环"依旧会被拦住。
	_warp帧起点 += (Time.get_ticks_msec() - 克隆开始)
	return 体

## 递归把克隆体身上所有帽子的"运行时状态"清回未启动
##   （见 帽子基类.重置运行状态 的注释：duplicate() 会把 _运行中 / _待触发 / _ctx 一起复制）
func _重置帽子状态(_节点: Node) -> void:
	# ⚠ 这里**不能**写 `if _节点 is 帽子基类`：`角色基类` 与 `帽子基类` 会形成
	#   **循环类型依赖** —— 运行时表现为启动时刷 700+ 条
	#     Parse Error: Could not resolve class "角色自定义积木" / "帽子基类"
	#   紧接着 autoload `全局变量.gd` 加载失败、整个工程起不来（实测琪露诺 755 条）。
	#   ★特别阴的是：`--check-only` 单独检查每个文件都 OK★ —— 那种检查走的是
	#   **编辑器类缓存**，看不出运行时的解析顺序问题。
	#   改用"有没有这个方法"来判断（鸭子类型），类型依赖就解掉了。
	if _节点.has_method("重置运行状态"):
		_节点.call("重置运行状态")
	for c in _节点.get_children():
		_重置帽子状态(c)

## 把"原体（self）此刻的状态"搬到克隆体身上。搬两类成员：
##   · `k4_`        引擎胶水状态（位置 / 外观 / 特效 / 音频 / 图层 …）
##   · `_v_` `_l_`  **K4 的角色变量 / 角色列表**
##     （前缀由 emit.js 的 NS_PREFIXES 分配；K4 的标识符不可能以 `_` 开头，
##      所以这是转换器自己的专有前缀，不会误伤用户命名）
##   ⚠ 原来这里只认 `k4_` —— 克隆体的角色变量因此**从来没被复制过**，
##     全部停在声明初值（角色变量.gd 里的 0.0 / []），而不是原体此刻的值。
##   ⚠ 本函数在 克隆自己() 里**被调用两次**（入树前 + 入树后），
##     原因见那边的注释：入树会触发克隆体自己的 _ready()，把值覆盖回初值。
func _克隆搬状态(体: Node) -> void:
	# 为什么必须显式同步：Godot 的 duplicate() 会复制**节点属性**
	# （position/scale/rotation/visible/modulate…），但**脚本成员的当前值不会
	# 自动带过去** —— 克隆体上那些成员是脚本里声明时的初始值。
	# 于是"原体已经移到 (100,50)、大小 30%"，克隆体却按初始态出生。
	# 这里按属性名逐个搬一遍，语义就是"完全继承当前状态"。
	var 属性集 := 体.get_property_list()
	for i in 属性集.size():
		var 名 := String(属性集[i].get("name", ""))
		var 是引擎状态 := 名.begins_with("k4_")
		var 是角色变量 := 名.begins_with("_v_") or 名.begins_with("_l_")
		if not 是引擎状态 and not 是角色变量:
			continue
		# 这几个是"关系/生命周期"字段，由 标为克隆() 与出生保护负责，
		# 不能从原体照搬（照搬会让克隆体以为自己就是原体/带着原体的克隆列表）。
		if 是引擎状态 and (名 == "k4_clones" or 名 == "k4_clone_of" or 名 == "k4_alive" or 名 == "k4_出生帧"):
			continue
		# ★值类型要**深拷贝**★
		#   Dictionary / Array 是引用类型，直接 set 会让克隆体和原体**共享同一份**
		#   —— 表现就是"改克隆体的特效 / 列表，原体的跟着变"。
		#   K4 的克隆体是"原体此刻的快照"，效果值和列表都必须各实例独立。
		var 值 = get(名)
		if 值 is Dictionary:
			体.set(名, (值 as Dictionary).duplicate(true))
		elif 值 is Array:
			体.set(名, (值 as Array).duplicate(true))
		else:
			体.set(名, 值)

func 标为克隆(_原体) -> void:
	k4_is_clone = true
	k4_clone_of = _原体
	k4_clones.clear()

func 删除自己() -> void:
	if k4_is_clone and k4_clone_of != null and is_instance_valid(k4_clone_of):
		k4_clone_of.k4_clones.erase(self)
	k4_alive = false
	# 把自己（含克隆体子树）里的声音播放器停掉再做 freed。
	#   否则停在"正在播放"的 AudioStreamPlayer 会一直持有 AudioStreamMP3 /
	#   AudioStreamPlaybackMP3，退出时报 "ObjectDB instances were leaked" +
	#   "Resource still in use: res://音频/....mp3"。
	_停本子树声音(self)
	# ★不是立刻 queue_free，而是**下一帧再删**★
	#   K4 的「删除此克隆体」在当帧仍会被画出来；而 Godot 的 queue_free()
	#   在本帧末尾就把节点摘掉 → 那一帧什么都看不到。
	#   实测 画笔图层与执行顺序测试 的数字显示器：克隆体的脚本正是
	#   「当作为克隆体启动时 → 显示 → 删除克隆体」——一帧都不留，
	#   于是 365 **一个数字都显示不出来**（K4 里是看得到的）。
	#   这里只记一个"删除帧号"，由 _process 在再下一帧才真删，
	#   保证"显示"的那一帧一定被渲染过。
	_k4待删帧 = Engine.get_process_frames() + 1
	set_process(true)

## 递归停掉本子树里所有 AudioStreamPlayer（删除角色/克隆体时清理音频资源）
func _停本子树声音(_节点: Node) -> void:
	if _节点 is AudioStreamPlayer:
		(_节点 as AudioStreamPlayer).stop()
	for c in _节点.get_children():
		_停本子树声音(c)

## 角色被移出场景树时，确保它的声音播放器已停止且不再持有音频流。
##   ★为什么必须做★：停在"正在播放"的 AudioStreamPlayer 会一直持有
##   AudioStreamMP3 + AudioStreamPlaybackMP3；进程强制退出（--quit-after /
##   关窗口）时 Godot 报
##     "2 ObjectDB instances were leaked" +
##     "Resource still in use: res://音频/....mp3"
##   把 stream 置空 + stop() 之后，引用在当时就断开了，退出时不再有残留。
func _exit_tree() -> void:
	_清音频(self)

func _清音频(_节点: Node) -> void:
	if _节点 is AudioStreamPlayer:
		var p := _节点 as AudioStreamPlayer
		p.stop()
		p.stream = null
		# 主动释放播放器实例：进程退出时若它还挂在"已播放"状态，
		# Godot 会报 "N ObjectDB instances were leaked at exit"。
		p.free()
		return
	for c in _节点.get_children():
		_清音频(c)

# =============================================================================
# 计时器 —— ★全局单例★
#   K4/Scratch 的计时器是**整个作品唯一一份**：任何角色读到的是同一个值，
#   「开始 / 停止 / 重置」也影响所有角色。
#   状态实现在 autoload `K4Timer`（全局/计时器.gd），这里只是转发。
#   （以前状态存在角色基类上 = 每个角色/克隆体各一份，语义是错的。）
# =============================================================================
func 计时器() -> float:
	return K4Timer.取值()

func 开始计时器() -> void:
	K4Timer.开始()

func 停止计时器() -> void:
	K4Timer.停止()

func 重置计时器() -> void:
	K4Timer.重置()

# =============================================================================
# 取值兜底（生成代码照常调用，返回默认值）
# =============================================================================
func 克隆体编号() -> float:
	if not k4_is_clone or k4_clone_of == null:
		return 0.0
	return float(k4_clone_of.k4_clones.find(self) + 1)

func 克隆体数量() -> float:
	if k4_clone_of != null:
		return float(k4_clone_of.k4_clones.size())
	return float(k4_clones.size())

func 自己的名字() -> String:
	return String(name)

# =============================================================================
# 输入入口：把「可拖拽」的鼠标事件转发给函数单例
# =============================================================================
#   单例化之后，"拖拽"这套逻辑住在 角色自带积木.拖拽输入(角色, _event) 里
#   （它是积木实现，跟着单例走）。而 Godot 的输入回调必须挂在**角色节点**上 ——
#   而且回调不能带参数，所以这里做一层转发：把 self 传给单例。
#
#   ⚠ K4Func 是 autoload（函数单例）。理论上极早期可能还没就绪 → 判空返回。
#   ⚠ 只有 `k4_draggable` 为真的角色才吃这个事件（K4 的「设置可拖拽」）。
func _input(_event: InputEvent) -> void:
	if not k4_draggable:
		return
	if K4Func == null:
		return
	K4Func.拖拽输入(self, _event)
