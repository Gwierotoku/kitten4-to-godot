# =============================================================================
# 角色自带积木.gd  ——  「K4 自带积木」那一层的实现（生成模板）
# =============================================================================
#
# ★这个文件是转换器的模板：每次转换都会生成 全局/角色自带积木.gd★
#   所以**不要直接改生成出来的那份**（会被覆盖）。要改成你自己的版本：
#     · 拷本文件成你自己的类，改 class_name，再让 角色类.gd extends 它；或者
#     · 只改你需要的那几个方法 —— 写在 全局/角色类.gd 里（那边优先级最高、永不覆盖）。
#
#   生成器还会做一件事：如果映射表里新增了本模板没有的方法，
#   会在文件末尾追加一段「本模板未覆盖的自带积木」的桩 ——
#   保证"转换器永不失败"（新积木最差也只是个 pass，不会让工程崩）。
#
# 继承链（不要改）：
#     角色基类（runtime · 库）
#       └─ 角色变量（数据：局部变量 / 列表成员声明 · 每次覆盖）
#            └─ 角色自带积木（★本文件★ · 每次覆盖）
#                 └─ 角色自定义积木（K4 自定义积木的真实现 · 每次覆盖）
#                      └─ 角色类（★你手写实现 · 永不覆盖）
#                           └─ <角色名>.gd
#
# -----------------------------------------------------------------------------
# 【约定】K4 的列表 / 文本都是 **1-based**
# -----------------------------------------------------------------------------
#   K4（和 Scratch 一样）第 1 项就是列表的第一个元素、第 1 个字符就是文本的首字符；
#   GDScript 是 0-based。本文件里所有 `序号` 参数**对外都是 K4 语义（从 1 开始）**，
#   函数体内部自己减 1。
#
#   越界规则也照 K4：
#     · 取值越界 → 返回 ""
#     · 「第几项 / 项序号」找不到 → 返回 0（**不是 -1**）
#     · 删除/插入/替换越界 → 什么也不做（不报错）
#
# -----------------------------------------------------------------------------
# 【约定】列表的「方式」参数
# -----------------------------------------------------------------------------
#   K4 的「列表取值 / 删除 / 替换」在积木上都有一个下拉：first / last。
#     first + 序号 n  →  第 n 项（从头数，1-based）
#     last  + 序号 n  →  倒数第 n 项
#   删除还多一个 all（清空）。
#   所以这三个方法的签名都是 `(列表, 方式, 序号)`。
#
#   ⚠ K4 的定义里，TYPE=first 时 INDEX 输入框仍然是可填的，所以生成代码里
#     经常出现 `("first", 1.0)`、`("first", 角色.遍历)` 这种组合 —— 那是正常的，
#     方式决定"从哪头数"，序号决定"数几个"。
#     但也有 `列表取值_特殊(列表, "first", 1.0)` 里的 1.0 是影子默认值的情况，
#     所以实现必须**只用序号当偏移**，不要假设它一定是 1。
#
# -----------------------------------------------------------------------------
# 【约定】K4 方向 / 坐标
# -----------------------------------------------------------------------------
#   K4 坐标：原点在**舞台中心**，x 向右，**y 向上**。Godot：position = (k4_x, -k4_y)。
#   K4 方向 k4_direction（**Scratch/K4 标准**）：0 = 向上、90 = 向右、180 = 向下、
#                       -90/270 = 向左（**顺时针为正**）。
#   ⚠ 这里曾经写成"90 = 向右、180 = 向上、0 = 向下"—— 那是实现者自己的约定，
#     与 K4 实际**相反**，于是"移动"的上下与斜向全走反。
#     实测（印章custom测试 的 Z 字型）：`转动 -135` 从 90 出发后 K4 走向**左下**
#     （方向 225°）；按 Scratch 约定 225° 正是左下 ✓，按旧约定则是左上 ✗。
#   Godot rotation = deg_to_rad(90 - k4_direction)（见 角色基类._apply_transform）。
#     ⚠ 这一条**待人工确认朝向**：按 Scratch 约定（0 = 上、造型默认朝右）它应当是
#       `deg_to_rad(方向 - 90)`。无朝向的造型（骰子等）看不出差别，所以先不动。
#
#   于是「移动 n 步」= 沿 k4_direction 在 K4 坐标系里走：
#       弧 = deg_to_rad(90 - k4_direction)     # K4 方向 → 数学角（0 = 向右，逆时针为正）
#       k4_x += n * cos(弧)
#       k4_y += n * sin(弧)
#
# -----------------------------------------------------------------------------
# 【本文件自己新增的状态】
# -----------------------------------------------------------------------------
#   下面 `var k4_xxx` 都是生成器不会声明的东西（生成器只声明 K4 里的变量/列表）。
#   放在这一层是因为它们属于"自带积木的内部状态"，不该污染 角色变量.gd。
#
# -----------------------------------------------------------------------------
# 【哪些没做 / 只做了近似】
# -----------------------------------------------------------------------------
#   ❌ 物理（启用物理 / 施加力 / 设置密度…）—— 需要和 Godot 的物理服务器协同，
#      而且 K4 的物理是自带引擎，语义不是一一对应。全部留桩，桩体注明。
#   ❌ 播放音符 / 获取音符 —— K4 的音符是合成音源，Godot 要用 AudioStreamGenerator
#      实时合成，属于另一摊工程。
#   ⚠ 响度 / 录音 / 语音识别 —— 需要麦克风输入，留 0。
#   ⚠ 云变量 / 云列表 —— K4 是联网的，这里做成**本地持久化**（user:// 存 JSON），
#      语义对得上"存得住"，但不会跨设备同步。
#   ⚠ 显示列表 / 显示排行榜 / 计时器监视器 —— K4 的舞台 UI 监视器，这里只记录状态。
#   ⚠ 停止() —— Godot 里协程没法自杀，用 "让出点 + 取消标记" 近似。
# =============================================================================

class_name 角色自带积木
extends 角色变量

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

# 声音表缓存：声音名 -> res:// 路径（第一次用到时扫一遍 音频/）
static var _声音表: Dictionary = {}
static var _声音表已建: bool = false
## ⚠ 用**弱引用**存缓存：普通引用会让这个 static 字典一直持着 AudioStream，
##   退出时 Godot 报 "Resource still in use: res://音频/....mp3"。
##   弱引用既能避免反复 load() 的开销，又不会阻止资源被释放。
static var _流缓存: Dictionary = {}

# 询问界面（第一次「询问并等待」时惰性创建）
var _询问层: CanvasLayer = null
var _询问问题: Label = null
var _询问输入: LineEdit = null
var _询问按钮: Button = null

signal _询问提交(答案: String)


# =============================================================================
# 内部工具
# =============================================================================

## 舞台半径（K4 舞台 = 视口，原点在中心）
func _舞台半() -> Vector2:
	return get_viewport_rect().size * 0.5

## 鼠标在 K4 坐标系里的位置
func _鼠标K4() -> Vector2:
	var m := get_viewport().get_mouse_position()
	var 层 := get_parent() as Node2D
	var 原点: Vector2 = 层.global_position if 层 != null else _舞台半()
	return Vector2(m.x - 原点.x, -(m.y - 原点.y))

## 把「目标」实参解析成一个具体的角色节点；解析不到返回 null
func _目标节点(_目标: Variant) -> Node:
	var 名 := str(_目标)
	if 名 == "" or 名 == "__self" or 名 == "自己":
		return self
	return 找(名)

## 当前造型的**纹理** —— 碰撞掩码 / 画笔图章 / 造型尺寸都统一用它。
##   新结构：customs 是 AnimatedSprite2D，纹理 = 当前帧的贴图；
##   老产物：当前可见的那个 Sprite2D 的贴图。两者都由 角色基类.当前纹理() 抹平。
##   （以前这里返回"当前造型的 Sprite2D 节点"，改成 AnimatedSprite2D 之后
##     一个角色只有一个精灵节点，按节点取纹理就没有意义了。）

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

func 包围盒() -> Rect2:
	var 本帧 := Engine.get_process_frames()
	if _包围盒帧号 == 本帧:
		return _包围盒缓存
	_包围盒帧号 = 本帧
	var 纹 := 当前纹理()
	var 尺寸 := Vector2(16.0, 16.0)
	if 纹 != null:
		尺寸 = 纹.get_size() * scale
	# K4 坐标：y 向上。这里只求 min/max，方向不重要。
	_包围盒缓存 = Rect2(Vector2(k4_x - 尺寸.x * 0.5, k4_y - 尺寸.y * 0.5), 尺寸)
	return _包围盒缓存

## 越界了吗（碰到边缘）
func _出界() -> bool:
	var 半 := _舞台半()
	return k4_x < -半.x or k4_x > 半.x or k4_y < -半.y or k4_y > 半.y

## 改完 k4_x/k4_y/k4_direction 之后统一走这里：落节点属性 + 若在落笔就画线
func _移动后() -> void:
	_apply_transform()
	if k4_pen_down:
		画布落笔(Vector2(k4_x, k4_y))
	elif k4_canvas != null and is_instance_valid(k4_canvas) and k4_canvas.has_method("路径中") and k4_canvas.call("路径中"):
		# 填充多边形模式下（「设置当前为填充 起点」之后），移动就记一个路径点 ——
		# K4 这条路**不需要落笔**，所以它在上面的 elif 里。
		K4Canvas.路径加点(k4到舞台(Vector2(k4_x, k4_y)))

## K4 颜色 -> Godot Color。支持 "#RRGGBB" / "#RRGGBBAA" / Color / 0-360 的色相数
func _转颜色(_v: Variant) -> Color:
	if _v is Color:
		return _v
	var s := str(_v).strip_edges()
	if s.begins_with("#"):
		if s.length() == 9:
			return Color.html(s)
		return Color.html(s.substr(0, 7))
	if s.is_valid_float():
		return Color.from_hsv(fposmod(s.to_float(), 360.0) / 360.0, 1.0, 1.0)
	if s.is_valid_html_color():
		return Color.html(s)
	return Color.BLACK

## 秒数一律走 K4 语义（负数当 0）
func _秒(_v: Variant) -> float:
	var s := _转数值(_v)
	return 0.0 if s < 0.0 else s

# 同一个"这个积木还没实现 / 参数没解析出来"的提示**只报一次** ——
# K4 的桩完全可能落在每帧循环里，不去重会把 Godot 的调试器刷爆。
static var _已提醒: Dictionary = {}

func _桩提醒(_文本: String) -> void:
	if _已提醒.has(_文本):
		return
	_已提醒[_文本] = true
	# [K4-STUB] 前缀是给验证脚本（huanzhuang.ps1）认的标记：
	# 这类提醒是"这块积木还没实现 / 参数没解析出来"，属于预期内，
	# 不该和真正的运行期错误混在一个计数里。
	push_warning("[K4-STUB] " + _文本)


# =============================================================================
# 每步让出点：加一层"被停止"检查
# =============================================================================
# K4 的「停止 [这个脚本]」在 GDScript 里没办法直接杀掉协程，所以走标记：
# 停止时把 k4_alive 设为 false，下一次经过 一步() 时把上下文标成已取消。
# 生成代码的循环/等待都会调 一步()，所以效果上就是"跑完当前这一小段就停"。
func 一步(_ctx: 角色基类.WarpCtx) -> void:
	if not k4_alive:
		_ctx._已取消 = true
	await super.一步(_ctx)


# =============================================================================
# 变换：叠加「翻转 / 透明度 / 特效」
# =============================================================================
# 基类的 _apply_transform() 只处理 position / rotation / scale / visible。
# 这里补上翻转和颜色，并且顺手保持说话气泡是"正的"。
func _apply_transform() -> void:
	super._apply_transform()
	# 翻转：只翻造型容器，不动角色自己的 scale（角色 scale 是「大小」积木管的）。
	# ⚠ k4_flip_y 必须在这里一起烘进去 —— 以前「上下翻转」是直接改 容器.scale.y 的，
	#   而本函数每次 _移动后() 都会把 容器.scale 整个重写一遍，
	#   于是上下翻转活不过一个「移动 10 步」。
	var 容器 := get_node_or_null("customs") as Node2D
	if 容器 != null:
		容器.scale = Vector2(-1.0 if k4_flip_x else 1.0, -1.0 if k4_flip_y else 1.0)
	# ★旋转模式★（K4 的「设置 旋转模式为 …」）
	#   必须在基类设完 rotation 之后覆盖，否则下一帧又被转回去。
	match k4_rotation_style:
		"flip":
			# 左右翻转：角色不跟着转，只按"面朝左 / 右"把图片翻过来
			rotation = 0.0
			var 朝左 := absf(fposmod(k4_direction + 180.0, 360.0) - 180.0) > 90.0
			if 容器 != null:
				容器.scale.x = -1.0 if 朝左 else 1.0
		"none":
			# 不旋转：永远保持正立
			rotation = 0.0
	modulate = k4_modulate
	# 气泡挂在角色身上，会被父节点的 rotation/scale 带歪 —— 反向抵消
	if k4_say_label != null and is_instance_valid(k4_say_label):
		k4_say_label.rotation = -rotation
		k4_say_label.scale = Vector2(1.0 / maxf(0.0001, scale.x), 1.0 / maxf(0.0001, scale.y))


# =============================================================================
# event —— 事件
# =============================================================================

## ★K4 的「角色组」和「阵营」都用 Godot 原生 group 承接★（用户提议，采纳）
##   · 角色组：生成器在每个角色脚本的 _ready() 里写 add_to_group("K4组_<组名>")
##   · 阵营：走 设置角色阵营()
##   本函数按"角色名**或**组名"取节点：先当角色找，找不到再当组找 ——
##   K4 的积木（如「将 <新角色组> 在 1 秒内 逐渐显示」）分不清这两者，也不需要分清。
func 实体节点们(_目标: Variant) -> Array:
	var 名 := str(_目标).strip_edges()
	if 名 == "" or 名 == "自己" or 名 == "__self":
		return [self]
	var 找 := _目标节点(_目标)
	if 找 != null:
		return [找]
	var 树 := get_tree()
	if 树 == null:
		return []
	return 树.get_nodes_in_group("K4组_" + 名)

## 「设置 角色阵营为 <红色 / 绿色 / 蓝色 / 无 阵营>」
##   实测 fields.role_camp = camp_red | camp_yellow | camp_blue | no_camp
##   ⚠ K4 内部把界面上的"绿色阵营"存成 `camp_yellow`（按界面 4 种映射即可）。
##   阵营是**单选**：先清掉自己身上所有阵营标签，再加新的。
const _阵营组 := {
	"camp_red": "K4阵营_红",
	"camp_yellow": "K4阵营_绿",
	"camp_blue": "K4阵营_蓝",
}

func 设置角色阵营(_阵营: Variant) -> void:
	for 组名 in _阵营组.values():
		if is_in_group(组名):
			remove_from_group(组名)
	var 新组: String = _阵营组.get(str(_阵营).strip_edges().to_lower(), "")
	if 新组 != "":
		add_to_group(新组)

## 与另一个角色是否同阵营（K4 内部判断敌我要用；虽然不在积木表里，留着给用户直接用）
func 同阵营(_他: Node) -> bool:
	if _他 == null:
		return false
	for 组名 in _阵营组.values():
		if is_in_group(组名) and _他.is_in_group(组名):
			return true
	return false

## 「设置 此角色 <可拖动 / 不可拖动>」
func 设置可拖拽(_可拖: Variant) -> void:
	k4_draggable = _转数值(_可拖) != 0.0
	if not k4_draggable:
		_k4拖拽中 = false

## 鼠标拖拽（配合「设置 此角色 可拖动」）——按下命中包围盒就开始拖，松开结束
func _input(_event: InputEvent) -> void:
	if not k4_draggable:
		return
	if _event is InputEventMouseButton:
		var 鼠 := _event as InputEventMouseButton
		if 鼠.button_index != MOUSE_BUTTON_LEFT:
			return
		if 鼠.pressed:
			_k4拖拽中 = 包围盒().has_point(_鼠标K4())
		else:
			_k4拖拽中 = false
	elif _event is InputEventMouseMotion and _k4拖拽中:
		var 点 := _鼠标K4()
		k4_x = 点.x
		k4_y = 点.y
		_移动后()

## 「设置 旋转模式为 <自由旋转 / 左右翻转 / 不旋转>」
##   实测 fields.rotation_type = "0" | "1" | "2"，三档含义按 K4 界面顺序：
##     0 = 自由旋转（默认）  1 = 左右翻转  2 = 不旋转
##   ⚠ 这张表是从"界面下拉顺序 vs 数据取值"推出来的（实测三个块的值是 2 / 1 / 0，
##     而界面顺序是 自由 / 左右 / 不旋转）。若你实测发现反了，改这张表即可。
const _旋转模式表 := { "0": "free", "1": "flip", "2": "none" }

func 设置旋转模式(_模式: Variant) -> void:
	k4_rotation_style = _旋转模式表.get(str(_模式).strip_edges(), "free")
	_apply_transform()

## 「抖动 <n> 秒」——阻塞式：抖完才继续下一个积木。
##   实现成"左右快速来回偏移"，**不改 k4_x/k4_y**（抖完自动回到原位）。
func 抖动(_秒: Variant) -> void:
	var 总 := _秒(_秒)
	if 总 <= 0.0:
		return
	var 原位置 := position
	var 次数 := int(maxf(4.0, 总 * 12.0))
	var tw := create_tween()
	for i in 次数:
		var 偏移 := 6.0 if (i % 2 == 0) else -6.0
		tw.tween_property(self, "position", 原位置 + Vector2(偏移, 0.0), 总 / float(次数))
	tw.tween_property(self, "position", 原位置, 0.02)
	await tw.finished

## 「围绕 <角色> 旋转 <n> 度」——以目标角色为圆心，把自己沿圆周转 n 度
func 围绕旋转(_目标: Variant, _度: Variant) -> void:
	var 心 := _目标节点(_目标)
	if 心 == null or 心 == self:
		return
	var 度 := _转数值(_度)
	var 相对 := Vector2(k4_x - 心.k4_x, k4_y - 心.k4_y)
	# K4 的 y 轴向上、Godot 的 y 轴向下 —— 角度取反才和 K4 的旋转方向一致
	var 新 := 相对.rotated(deg_to_rad(-度))
	k4_x = 心.k4_x + 新.x
	k4_y = 心.k4_y + 新.y
	k4_direction += 度
	_移动后()

## 「<角色> 新建对话框 <文本>」——让**指定角色**说话（目标为空 = 自己）
func 新建对话框(_目标: Variant, _文本: Variant) -> void:
	var 名 := str(_目标).strip_edges()
	if 名 == "" or 名 == "自己" or 名 == "__self":
		说(_文本)
		return
	for 角 in 实体节点们(_目标):
		if 角 != null and is_instance_valid(角) and 角.has_method("说"):
			角.call("说", _文本)

## 「将角色的 <宽度 / 高度> <增加 / 减少> <n>」——set_width_height_scale 的姊妹块
##   实参：(_轴, _方向, _值)；_值 是**百分比增量**（和 K4 界面上的数字一致）
func 增加宽高缩放(_轴: Variant, _方向: Variant, _值: Variant) -> void:
	var 轴 := str(_轴).strip_edges().to_lower()
	var 是y := 轴.begins_with("h")
	# 该轴当前的**绝对百分比** = 统一大小 × 该轴系数
	var 当前 := k4_size_percent * (_k4_高缩放 if 是y else _k4_宽缩放)
	设置宽高缩放(轴, 当前 + _转数值(_值) * _符号方向(_方向))

## 「在 <n> 秒内 逐渐显示 / 隐藏」「将 <目标> 显示 / 隐藏」「将 <目标> 在 <n> 秒内 逐渐…」
##   模式：show / hide（瞬变）、grad_show / grad_hide（渐变）
##   ★目标可以是**角色**，也可以是**角色组**★（K4 的组 = Godot 原生 group）
func 显示隐藏实体(_目标: Variant, _模式: Variant, _秒: Variant) -> void:
	var 模 := str(_模式).strip_edges().to_lower()
	var 渐变 := 模.begins_with("grad")
	var 显示 := 模.find("show") >= 0 or 模.find("显示") >= 0
	var 总 := _秒(_秒) if 渐变 else 0.0
	for 角 in 实体节点们(_目标):
		if 角 == null or not is_instance_valid(角):
			continue
		if not 渐变:
			角.set("visible", 显示)
			角.set("k4_visible", 显示)
			continue
		# 渐变：显示时先露出来再淡入；隐藏时淡出后再收起来
		角.set("visible", true)
		角.set("k4_visible", true)
		if 总 <= 0.0:
			角.set("modulate:a", 1.0 if 显示 else 0.0)
			角.set("visible", 显示)
			角.set("k4_visible", 显示)
			continue
		var tw: Tween = 角.call("create_tween")
		tw.tween_property(角, "modulate:a", 1.0 if 显示 else 0.0, 总)
		await tw.finished
		if not 显示:
			角.set("visible", false)
			角.set("k4_visible", false)

## 「把 <文本> 翻译成 <语言>」——语句形态（把译文说出来）
##   ⚠ K4 的翻译走的是**云端服务**，Godot 侧离线做不到真翻译。
##     这里原样把文本说出来（保证不静默失效）。需要真翻译的话，
##     覆写 _翻译占位()：接一个 HTTP 请求 + await 返回即可。
func 翻译(_文本: Variant, _语言: Variant) -> void:
	说(_翻译占位(_文本, _语言))

## 「把 <文本> 翻译成 <语言>」——取值形态
func 翻译结果(_文本: Variant, _语言: Variant) -> Variant:
	return _翻译占位(_文本, _语言)

## 翻译的离线占位：原样返回原文。
##   语言取值：english / chinese / japanese / spanish / french / classical_chinese
func _翻译占位(_文本: Variant, _语言: Variant) -> String:
	return str(_文本)

## 「广播 <消息> 并等待」：等所有（**同屏幕的**）监听者的协程跑完
func 广播并等待(ctx: 角色基类.WarpCtx, _名: Variant) -> void:
	await K4Bus.发信号并等待(str(_名), 屏幕根())

## 「设置 屏幕切换特效为 <方向> <效果>」—— K4 的 `set_scene_transition`
##   实参：(_效果, _方向)，取值见 core.js 的 case 'set_scene_transition'：
##     效果 = slide(移入) / bounce(弹出) / fadeInOut(渐显) / distrot(扭曲) / none(无效果)
##     方向 = up / down / left / right（只有 slide、bounce 才有意义）
##   ★语义是"**下一次切换屏幕**时用这个特效"★，所以这里只记录，不立刻播放；
##   播放发生在 角色基类.切换屏幕()（转场层挂在 K4Canvas 这个 autoload 上，
##   否则 change_scene_to_file 会把转场节点一起销毁）。
##   ⚠ 以前这个块**整块未映射**（生成 `# 未映射积木类型` + pass），
##     于是"渐显/移入/弹出"这些屏幕切换效果全都不生效。
func 设置屏幕切换特效(_效果: Variant, _方向: Variant) -> void:
	K4Canvas.设置转场(str(_效果).strip_edges().to_lower(), str(_方向).strip_edges().to_lower())


# =============================================================================
# control —— 控制
# =============================================================================

## 「停止 <选项>」——K4 是**四档**下拉（用户截图确认）：
##   1. 全部脚本            2. 当前脚本
##   3. 当前角色的其他脚本   4. 其他角色的脚本
## ⚠ 近似实现：GDScript 没有"杀掉协程"的原语，只能靠标记 + 一步() 的检查点，
##   所以"停止"在下一次经过 一步() 时才真正生效（K4 也是这个时机）。
## ⚠ 以前这个函数只有**三档**，而且第 3 档的实现是遍历**兄弟角色** ——
##   那其实是"其他角色的脚本"（第 4 档）的语义，档位整个错位了：
##   于是"停止当前角色的其他脚本"会把别的角色停掉，
##   而"停止其他角色的脚本"（scope=4）直接落到默认的"停止全部"。
func 停止(_选项: Variant) -> void:
	var 选 := str(_选项).to_lower()
	if 选.begins_with("all") or 选 == "全部":
		# K4 的「停止全部」= 所有脚本停止往下跑（角色和画面都还在）。
		# ⚠ **绝对不能用 `get_tree().paused = true`**：
		#   一旦暂停，`await get_tree().process_frame` 就永远不返回 ——
		#   表现是"游戏冻住"，headless 下 `--quit-after N` 也一起卡死（跑 300 帧超时）。
		_停整棵树(get_tree().root)
		return
	if 选.begins_with("this") or 选 == "当前脚本" or 选 == "这个脚本":
		k4_alive = false
		return
	if 选.begins_with("other_sprites") or 选 == "其他角色的脚本":
		# 第 4 档：其他角色（连同它们的克隆体）
		# ★本脚本继续跑★ —— K4 这一档说的是"**其他角色**的脚本"，
		#   停自己那是第 2 档"当前脚本"的事。以前这里顺手写了 k4_alive = false，
		#   结果"停止其他角色的脚本"会把自己也停掉（运行时实测抓到的）。
		_停其他角色()
		return
	# 第 3 档（others）：**当前角色的其他脚本** —— 同理，本脚本不受影响
	_停同角色的其他脚本()

## 停掉**本角色**身上除当前协程以外的其它脚本。
##   节点结构：基础角色层 → 角色 → 帽子（每个帽子 = 一个脚本/协程），
##   所以"本角色的其他脚本"就是自己的**兄弟节点**。
func _停同角色的其他脚本() -> void:
	var 父 := get_parent()
	if 父 == null:
		return
	for 子 in 父.get_children():
		if 子 == self:
			continue
		var 帽 := 子 as 帽子基类
		if 帽 != null and 帽._ctx != null:
			帽._ctx._已取消 = true

## 停掉**其他角色**（含它们的克隆体）的脚本。
##   其他角色 = 同一个「基础角色层」里的兄弟节点。
func _停其他角色() -> void:
	var 层 := get_parent()
	if 层 == null:
		return
	for 节点 in 层.get_children():
		if 节点 == self:
			continue
		_停整棵树(节点)

## 递归把整棵树上的角色脚本标停（「停止全部」用）
func _停整棵树(_节点: Node) -> void:
	var 角 := _节点 as 角色基类
	if 角 != null:
		角.k4_alive = false
	var 帽 := _节点 as 帽子基类
	if 帽 != null and 帽._ctx != null:
		帽._ctx._已取消 = true
	for 子 in _节点.get_children():
		_停整棵树(子)

## 「分裂 <角色> 到 x:<x> y:<y>」—— K4 的 `clone` 积木
##   ★和「克隆」（mirror）不是一回事★（用户注释原话：
##     "分裂是深度复制，像普通角色一样，不是克隆体"）：
##       · 克隆（mirror）→ 产生**克隆体**：k4_is_clone = true，
##         会跑「当作为克隆体启动」，原体被删掉时跟着一起删。
##       · 分裂（clone） → 复制出一个**普通角色实例**：不是克隆体、
##         不跑「当作为克隆体启动」，深度复制源角色**此刻**的状态。
##   实参：(_目标 角色名；空 = 本角色, _x, _y 落点)
static var _分裂序号: int = 0

func 分裂(_目标: Variant, _x: Variant, _y: Variant) -> Node:
	var 源: 角色基类 = self
	var 名 := str(_目标)
	if 名 != "":
		var 找到 := _目标节点(_目标) as 角色基类
		if 找到 != null:
			源 = 找到
	var 父 := 源.get_parent()
	if 父 == null:
		return null
	var 新 := 源.duplicate()
	if 新 == null:
		return null
	# duplicate() 出来的节点可能**没有脚本**（和 克隆自己() 里遇到的是同一个坑）
	if 新.get_script() == null:
		新.set_script(源.get_script())
	_分裂序号 += 1
	新.name = str(源.name) + "_分裂" + str(_分裂序号)
	# 「不是克隆体」：清掉克隆关系，让它就是一个普通角色
	新.set("k4_is_clone", false)
	新.set("k4_clone_of", null)
	新.set("k4_clones", [])
	# ★先入树、再搬状态★ —— 入树会触发克隆体自己的 _ready()（初始化 + 变量初值），
	#   把先搬进去的值覆盖回初值（和 克隆自己() 里是同一个坑，见那边的长注释）。
	父.add_child(新)
	源._克隆搬状态(新)
	# 落点最后设：它要覆盖从源搬过来的位置
	新.set("k4_x", _转数值(_x))
	新.set("k4_y", _转数值(_y))
	新.call("_移动后")
	return 新

## 「删除此克隆体」
func 删除克隆体() -> void:
	删除自己()

## 「克隆 <角色>」——克隆**指定**的那个角色，不是自己
##
## K4 的克隆块（block type `mirror`）带一个 sprite 字段：
##   "__self"   -> 走 克隆自己()
##   实体 uuid  -> 走这里（等价于 Scratch 的 "create clone of <sprite>"）
## ⚠ 以前反编译器忽略了这个字段、一律生成"克隆自己" ——
##   于是 射击生存 里"克隆 炮弹"变成了克隆"射击辅助器"，
##   而射击辅助器没有「当作为克隆体启动时」脚本 → 点鼠标什么也射不出去。
##
## 克隆体继承的是目标角色**当前**的状态（位置/大小/造型/可见性），
## 所以这里**不要**去调 他.初始化()（那会把目标角色重置回初始态）。
func 克隆_角色(_目标: Variant) -> Node:
	var 他 := _目标节点(_目标) as 角色基类
	if 他 == null or 他 == self:
		return 克隆自己()
	return 他.克隆自己()

## 「等待 <秒>」——K4 的等待是**真实时间**，且等待期间能被打断
func 等待_秒(ctx: 角色基类.WarpCtx, _p_秒: Variant) -> void:
	await get_tree().create_timer(_p_秒).timeout
	"""
	var 剩 := _秒(_p_秒)
	if 剩 <= 0.0:
		await 一步(ctx)
		return
	var 终 := Time.get_ticks_msec() + int(剩 * 1000.0)
	while Time.get_ticks_msec() < 终:
		await 一步(ctx)
		if not k4_alive or ctx._已取消:
			return
	"""

## 「等待直到 <条件>」
## 生成代码传进来的通常是**布尔值**（K4 的取值积木），所以这里只能"重取"。
## ⚠ 如果反编译器把条件编译成了 lambda/Callable，这里会直接当成"已满足"。
##   要支持那种写法，把下面的 elif 分支改成 `await _条件.call()`。
func 等待直到(ctx: 角色基类.WarpCtx, _条件: Variant) -> void:
	if _条件 is Callable:
		var 回: Callable = _条件
		while not 为真(回.call()):
			await 一步(ctx)
			if not k4_alive or ctx._已取消:
				return
		return
	# 传进来的是求过值的布尔：没法重求，只能等一帧就当满足
	await 一步(ctx)

## 「调用/同步 <目标> 的 <积木>」——K4 的跨角色同步调用
## 参数一般是 [积木名, 参数数组]；目标为 "__self" 时调自己
func 调用_同步(ctx: 角色基类.WarpCtx, _目标: Variant, _参数: Variant) -> void:
	var 谁 := _目标节点(_目标)
	if 谁 == null:
		return
	var 包: Variant = _参数
	var 名 := ""
	var 实参: Array = []
	if 包 is Array and (包 as Array).size() > 0:
		名 = str(包[0])
		if (包 as Array).size() > 1 and 包[1] is Array:
			实参 = 包[1]
	elif 包 is String:
		名 = str(包)
	if 名 == "" or not 谁.has_method(名):
		return
	var 全: Array = [ctx]
	全.append_array(实参)
	await 谁.callv(名, 全)

## 「重新开始」= K4 的绿旗重跑
func 重新开始() -> void:
	get_tree().paused = false
	# 计时器是 autoload（K4Timer），重载场景**不会**重建它 —— 显式归零，
	# 否则绿旗重跑后计时器还带着上一局的时间（K4 里绿旗是重新计时）。
	K4Timer.重置会话状态()
	var 屏 := get_tree().current_scene
	if 屏 != null:
		get_tree().reload_current_scene()


# =============================================================================
# motion —— 运动
# =============================================================================

## 「<x/y> 坐标」
func 坐标(_轴: Variant) -> float:
	return k4_y if str(_轴).to_lower() == "y" else k4_x

func 坐标x() -> float:
	return k4_x

func 坐标y() -> float:
	return k4_y

## 「把 <x/y> 坐标设为 <值>」
func 将坐标设为(_轴: Variant, _值: Variant) -> void:
	if str(_轴).to_lower() == "y":
		k4_y = _转数值(_值)
	else:
		k4_x = _转数值(_值)
	_移动后()

## 「把 <x/y> 坐标增加 <值>」
##   ★_符号 来自 K4 的 fields.increase（increase / decrease 复选框）★
##     「增加 200」→ +200，「减少 200」→ -200。
##   反编译器原样带出来的是**字符串**（"increase" / "decrease"），
##   也兼容 ±1 与 bool —— 三种写法都归一化。
##
##   ⚠ 以前这个符号**根本没传给运行时**（emit 的 ARG 表漏了 'sign'），
##     于是「把 y 坐标减少 200」生成的是 `将坐标增加("y", 200.0)` —— 方向正好相反。
func 将坐标增加(_轴: Variant, _值: Variant, _符号: Variant = 1) -> void:
	var 增 := _转数值(_值) * _符号方向(_符号)
	if str(_轴).to_lower() == "y":
		k4_y += 增
	else:
		k4_x += 增
	_移动后()

## 把 K4 的「增加 / 减少」符号归一化成 ±1。
##   接受的写法：数字（±1）、bool、字符串（"increase"/"decrease"/"加"/"减"，大小写不限）。
func _符号方向(_符号: Variant) -> float:
	if _符号 is bool:
		return 1.0 if _符号 else -1.0
	if _符号 is float or _符号 is int:
		return -1.0 if float(_符号) < 0.0 else 1.0
	var s := str(_符号).strip_edges().to_lower()
	if s.find("decrease") >= 0 or s.find("减") >= 0 or s == "-1" or s == "false":
		return -1.0
	return 1.0

## 「移到 x:<x> y:<y>」
func 移到x_y(_x: Variant, _y: Variant) -> void:
	k4_x = _转数值(_x)
	k4_y = _转数值(_y)
	_移动后()

## 「移到 <鼠标指针 / 随机位置 / 角色名>」
func 移到_目标(_目标: Variant) -> void:
	var 名 := str(_目标)
	if 名 == "鼠标指针" or 名 == "__mouse":
		var m := _鼠标K4()
		k4_x = m.x
		k4_y = m.y
	elif 名 == "随机位置" or 名 == "__random":
		var 半 := _舞台半()
		k4_x = randf_range(-半.x, 半.x)
		k4_y = randf_range(-半.y, 半.y)
	else:
		var 他 := 找(名) as 角色基类
		if 他 == null:
			return
		k4_x = 他.k4_x
		k4_y = 他.k4_y
	_移动后()

## 「移动 <n> 步」——沿 k4_direction 走（见文件头的方向换算）
func 移动_步(_步数: Variant) -> void:
	var 步 := _转数值(_步数)
	# ★K4 方向 → 数学角（0 = 向右、逆时针为正）= `90 - 方向`★
	#   必须和 角色基类._apply_transform 的 `rotation = deg_to_rad(90 - k4_direction)` 一致。
	var 弧 := deg_to_rad(k4_direction - 90.0)
	k4_x += 步 * cos(弧)
	k4_y += 步 * sin(弧)
	_移动后()

## 「<方向>」——K4 方向 90 = 右
func 方向() -> float:
	return k4_direction

## 「面向 <角度>」
func 设置方向(_角度: Variant) -> void:
	k4_direction = _转数值(_角度)
	_移动后()

## 「旋转 <角度> 度」（顺时针为正，K4 里 d 增大 = 逆时针，所以取正）
func 转动_度(_角度: Variant) -> void:
	k4_direction += _转数值(_角度)
	_移动后()

## 「面向 <鼠标指针 / 角色>」（也兼容传角度）
func 面向(_目标: Variant) -> void:
	if _目标 is float or _目标 is int or (_目标 is String and (_目标 as String).is_valid_float()):
		设置方向(_转数值(_目标))
		return
	var 名 := str(_目标)
	var 点 := Vector2.ZERO
	if 名 == "鼠标指针" or 名 == "__mouse":
		点 = _鼠标K4()
	else:
		var 他 := 找(名) as 角色基类
		if 他 == null:
			return
		点 = Vector2(他.k4_x, 他.k4_y)
	var dx := 点.x - k4_x
	var dy := 点.y - k4_y
	if is_zero_approx(dx) and is_zero_approx(dy):
		return
	k4_direction = rad_to_deg(atan2(dy, dx)) + 90.0
	_移动后()

## 「<- / 角色> 面向_角色」—— 桩块，等价于 面向
func 面向_角色(_参数: Variant) -> void:
	面向(_参数)

## 「在 <秒> 内滑行到 x:<x> y:<y>」—— 阻塞式滑行
##   ★协程在这里挂起，等动画播完才继续下一个积木★（挂起的是当前协程，
##   不是主线程 —— 画面照常刷新，游戏不会卡死。）
##
##   ⚠ 以前这里是手写 while 循环，而循环体里 `过 += get_process_delta_time()`
##     被**多缩进了一级**，落到 `if ...: return` 之后 = 不可达代码
##     → `过` 恒为 0 → `while 过 < 总` 永不退出：
##     执行到「滑行到」的脚本就卡死在那里（不报错、不继续、也不移动）。
##   现在改成用户指定的做法：Tween 负责插值，协程只 `await tween.finished`。
func 滑行到(ctx: 角色基类.WarpCtx, _p_秒: Variant, _x: Variant, _y: Variant) -> void:
	# ctx 保留在签名里（调用点按位置传参），Tween 版不需要它做让出/取消检查
	var 总 := _秒(_p_秒)
	var 起 := Vector2(k4_x, k4_y)
	var 终 := Vector2(_转数值(_x), _转数值(_y))
	if 总 <= 0.0 or 起.is_equal_approx(终):
		k4_x = 终.x
		k4_y = 终.y
		_移动后()
		return
	var tw := create_tween()
	tw.tween_method(_滑行写点, 起, 终, 总)
	await tw.finished
	# Tween 的末帧理论上就是终值，这里再钉一次，防浮点残差
	k4_x = 终.x
	k4_y = 终.y
	_移动后()

## 「在 <秒> 内，把 <x/y> 坐标 <增加/减少> <值>」—— K4 的 self_glide_coordinate
##   实参：(_轴 "x"/"y", _方向 "increase"/"decrease", _时间 秒, _值 增量)
##   ★同样是阻塞式：await tween.finished，动画播完才继续往下执行★
##   _方向 与「将坐标增加」共用 _符号方向() 归一化（increase/decrease、±1、bool 都认）。
func 滑行坐标(_轴: Variant, _方向: Variant, _时间: Variant, _值: Variant) -> void:
	var 是y := str(_轴).strip_edges().to_lower().begins_with("y")
	var 总 := _秒(_时间)
	var 起 := k4_y if 是y else k4_x
	var 终 := 起 + _转数值(_值) * _符号方向(_方向)
	if 总 <= 0.0 or is_equal_approx(起, 终):
		if 是y:
			k4_y = 终
		else:
			k4_x = 终
		_移动后()
		return
	var tw := create_tween()
	if 是y:
		tw.tween_method(_滑行写y, 起, 终, 总)
	else:
		tw.tween_method(_滑行写x, 起, 终, 总)
	await tw.finished
	if 是y:
		k4_y = 终
	else:
		k4_x = 终
	_移动后()

## Tween 每帧回调：把插值出来的 K4 坐标写回去并同步节点。
##   必须写 k4_x/k4_y 而不是直接 tween 节点的 position —— k4_* 才是权威状态，
##   而且 _移动后() 还要负责"落笔画线 / 填充路径取点"这些副作用。
func _滑行写x(_值: float) -> void:
	k4_x = _值
	_移动后()

func _滑行写y(_值: float) -> void:
	k4_y = _值
	_移动后()

func _滑行写点(_点: Vector2) -> void:
	k4_x = _点.x
	k4_y = _点.y
	_移动后()

## 「碰到边缘就反弹」
func 碰到边缘就反弹() -> void:
	var 半 := _舞台半()
	var 碰 := false
	# 左右边：关于竖直轴镜像 → d' = 360 - d
	if k4_x > 半.x or k4_x < -半.x:
		k4_direction = 360.0 - k4_direction
		k4_x = clampf(k4_x, -半.x, 半.x)
		碰 = true
	# 上下边：关于水平轴镜像 → d' = 180 - d
	if k4_y > 半.y or k4_y < -半.y:
		k4_direction = 180.0 - k4_direction
		k4_y = clampf(k4_y, -半.y, 半.y)
		碰 = true
	if 碰:
		_移动后()

## 「<大小>」——K4 的"大小"是百分比
func 大小() -> float:
	return k4_size_percent

func 大小_缩放() -> float:
	return k4_size_percent / 100.0

## 「把大小设为 <百分比>」
func 设置大小(_百分比: Variant) -> void:
	var v := _转数值(_百分比)
	k4_size_percent = 0.0 if v < 0.0 else v
	# 统一大小是"重新定大小"，会清掉之前的宽高分别缩放（否则两者叠加会越缩越小）
	_k4_清空宽高缩放()
	_移动后()

## 「把大小增加 <百分比>」
func 增加大小(_百分比: Variant) -> void:
	k4_size_percent += _转数值(_百分比)
	if k4_size_percent < 0.0:
		k4_size_percent = 0.0
	_移动后()

## 「<左右 / 上下> 翻转」——K4 的翻转是造型镜像
## ⚠ 实参来自反编译器的 flip.axis，值是 **"x" / "y"**（不是中文，也不是 leftright）。
##   以前只认 "左右"/"上下"/"leftright"/"horizontal"…，于是 'x'/'y' 全落进 else
##   被当成水平翻转 ——「上下翻转」永远没反应。
func 翻转(_方向: Variant) -> void:
	var d := str(_方向).strip_edges().to_lower()
	if d == "y" or d == "上下" or d == "updown" or d == "vertical":
		k4_flip_y = not k4_flip_y
	else:
		k4_flip_x = not k4_flip_x
	_apply_transform()


# =============================================================================
# looks —— 外观
# =============================================================================

## 「显示」
func 显示() -> void:
	k4_visible = true
	_apply_transform()

## 「隐藏」
func 隐藏() -> void:
	k4_visible = false
	_apply_transform()

## 「显示 / 隐藏」（开关型）
func 设置可见(_开关: Variant) -> void:
	k4_visible = 为真(_开关)
	_apply_transform()

## 「<是否可见>」
func 是否可见() -> bool:
	return k4_visible

## 「下一个造型」
func 下一个造型() -> void:
	if _造型名表.is_empty():
		return
	var i := 造型序号(k4_costume_name)
	_应用造型(str(_造型名表[(i + 1) % _造型名表.size()]))

## 「把造型设为 <名称>」
##   支持 **K4 原名**（"新角色(1)"）与 **节点名**（"新角色_1_"）两种写法：
##   生成代码里传进来的是 K4 原名，而 k4_costumes 的键就是原名，
##   所以直接查得到；老产物（键是节点名）也还能用。
##
## ★匹配必须宽容★（用户实测的 14 种边界情况：造型名可以是 "2" / "3.0" / "_5_" /
##   "true" / "check" / "新角色(1)" 这种任意字符串，而实参可能是字符串、整数、
##   浮点甚至布尔）：
##     · 数字经过生成器的 k4Number() 会**丢掉 ".0"**（3.0 → 3），
##       于是 str(实参) 得到 "3"，而造型名是 "3.0" → 以前直接匹配不上；
##     · 布尔 str() 得 "true" / "True"，造型名可能写成任一种。
##   所以把"合理的几种写法"都列出来逐个试，最后再加一层忽略大小写与空格。
func 设置造型(_名称: Variant) -> void:
	# ★数字 = **编号**（第 N 个造型，K4 从 1 开始）；字符串 = 造型名★
	#   用户实测：K4 的造型和声音一样，**既能用编号也能用名字**索引 ——
	#   K4 界面上显示的 "1.新角色 / 2. 2 / 3. 3.0" 里那个数字就是编号。
	#   ⚠ 这和下面的"宽容匹配"是两个不同维度，靠**类型**分开：
	#     · 纯数字实参 → 按序号取第 N 个造型（本分支）
	#     · 字符串实参 → 按名字匹配（宽容匹配处理"名字本身长得像数字"的情况）
	if (_名称 is int or _名称 is float) and not (_名称 is bool):
		_按编号设置造型(int(_名称))
		return
	var 候选 := _造型候选名(_名称)
	# ① 直接命中（键就是 K4 原名）
	for 名 in 候选:
		if k4_costumes.has(名):
			_应用造型(名)
			return
	# ② 节点名 / 原名互查
	for 名 in 候选:
		var 节点名 := String(_造型节点名.get(名, ""))
		if 节点名 != "" and k4_costumes.has(String(_造型原名.get(节点名, 名))):
			_应用造型(String(_造型原名.get(节点名, 名)))
			return
	# ③ 和键、原名逐一比
	for k in k4_costumes.keys():
		if 候选.has(String(k)) or 候选.has(String(_造型原名.get(String(k), ""))):
			_应用造型(String(k))
			return
	# ④ 最后一层：忽略大小写与首尾空格（"True" vs "true" 这类）
	for k in k4_costumes.keys():
		var 键 := String(k).strip_edges().to_lower()
		var 原 := String(_造型原名.get(String(k), "")).strip_edges().to_lower()
		for 名2 in 候选:
			var 目 := String(名2).strip_edges().to_lower()
			if 键 == 目 or 原 == 目:
				_应用造型(String(k))
				return

## 按**编号**设置造型（K4 编号从 1 开始，越界自动夹到两端）。
##   顺序 = `_造型名表`（= SpriteFrames 帧号顺序 = K4 造型列表原顺序），
##   和 K4 界面上的 "1.新角色 / 2. 2 / 3. 3.0" 一致。
func _按编号设置造型(_编号: int) -> void:
	if _造型名表.is_empty():
		return
	var i := clampi(_编号 - 1, 0, _造型名表.size() - 1)
	_应用造型(String(_造型名表[i]))

## 把一个造型实参展开成"可能对应哪些造型名"。
##   例：3（int）→ ["3", "3.0"]、3.0（float）→ ["3.0", "3"]、
##       true → ["true", "True", "1"]
func _造型候选名(_名称: Variant) -> Array:
	var 出: Array = []
	var 主 := str(_名称)
	if 主 != "":
		出.append(主)
	if _名称 is bool:
		# GDScript 的 str(true) 已经是 "true"，这里补上别的常见写法
		if _名称:
			for x in ["true", "True", "TRUE", "1"]:
				if not 出.has(x):
					出.append(x)
		else:
			for x in ["false", "False", "FALSE", "0"]:
				if not 出.has(x):
					出.append(x)
	elif _名称 is float or _名称 is int:
		var f := float(_名称)
		# 整数形态："3.0" -> "3"
		if is_equal_approx(f, roundf(f)) and absf(f) < 1e15:
			var 整 := str(int(f))
			if not 出.has(整):
				出.append(整)
			var 带点 := 整 + ".0"
			if not 出.has(带点):
				出.append(带点)
		# 浮点形态：若 str() 给的是 "3"，补一个 "3.0"
		if 主.find(".") < 0:
			var 补 := 主 + ".0"
			if not 出.has(补):
				出.append(补)
	return 出

## 「<当前造型>」
func 当前造型() -> String:
	return k4_costume_name

## 「把 <透明度> 设为 <值>」
##   ★K4 的透明度语义：0 = 完全不透明（显示），100 = 完全透明（看不见）★
##   正好和 Godot 的 modulate.a 相反，所以要 `1 - v/100`。
##   —— 以前写成 `v/100`：设 0 反而全透明、设 100 反而不透明，方向整个反了。
##   这和 K4 的「幽灵 / 透明度」**特效**（scope=6，见 设置特效）是同一套语义，
##   那边用的是 `1.0 - v/100.0`，两边现在一致了。
func 设置透明度(_值: Variant) -> void:
	k4_modulate.a = clampf(1.0 - _转数值(_值) / 100.0, 0.0, 1.0)
	_apply_transform()

## 「把 <透明度> 增加 <值>」
##   透明度是"越加越透明"，所以 modulate.a 要**减**：
##     增加 20 → alpha 从 1.0 变成 0.8（更透明）
func 增加透明度(_值: Variant) -> void:
	k4_modulate.a = clampf(k4_modulate.a - _转数值(_值) / 100.0, 0.0, 1.0)
	_apply_transform()

## 「把 <特效> 设为 <值>」
##
## ★K4 的特效编号是 0-based，和 Scratch VM 的 EffectTransform 完全一致★
##   实测（_dev/probe_effect.js 扫全量样本）：K4 只用到 0 / 1 / 2 / 4 / 6。
##
##     0  color       颜色（色相旋转，值 = 0~359 度）
##     1  fisheye     鱼眼
##     2  whirl       漩涡
##     3  pixelate    像素化
##     4  mosaic      马赛克
##     5  brightness  亮度（-100 ~ 100）
##     6  ghost       幽灵 / 透明度（0 ~ 100，100 = 全透明）
##
##   ⚠ 这里以前写的是「1=透明度、2=颜色、3=亮度」—— 编号整体错位：
##     K4 里最常用的 scope=1（鱼眼）被当成了透明度，
##     scope=0（颜色，就是"设置特效为 随机0~359"那类用法）直接落进 default 什么也不做。
##     **这是"外观功能不对"里最实的一条。**
##
##   不需要 shader 就能做到的只有两个：
##     · 6 ghost      → modulate.a
##     · 5 brightness → modulate 的 rgb 整体缩放
##     0 color 用 modulate 做不出来（那是色相旋转，不是染色），真做法是给角色挂一个
##     CanvasItem shader；1/2/3/4 也都要 shader。这些都**只记录 + 明确提醒**，
##     不假装做了 —— 否则你会以为"积木生效了但画面没动"是别的原因。
##   ⚠ **K4 的 scope 编号不是 Scratch 的编号**（实测确认）：
##     高考呐 里「将 透明度 特效 增加 5」的块，`fields.scope` = **"1"**，
##     即 **K4 编号 1 == 透明度**；而 Scratch 里 ghost 是 6。
##     所以下面统一把「K4 编号 / 中文名 / 英文名」先折成一个内部码，
##     再按内部码执行 —— 生成代码里传的是 K4 数字编号，中文名只是兼容入口。
func 设置特效(_特效: Variant, _值: Variant) -> void:
	var v := clampf(_转数值(_值), -100.0, 100.0)
	var 码 := _特效码(_特效)
	k4_effect[码] = v
	match 码:
		"ghost":                       # K4 编号 1 / 透明度 / 幽灵（0 显示 → 100 透明）
			k4_modulate.a = clampf(1.0 - v / 100.0, 0.0, 1.0)
		"brightness":                  # K4 编号 2 / 亮度
			var b := clampf(1.0 + v / 100.0, 0.0, 2.0)
			k4_modulate.r = b
			k4_modulate.g = b
			k4_modulate.b = b
		"color":                       # K4 编号 0 / 颜色
			_桩提醒("设置特效(颜色)：modulate 做不了色相旋转，要给角色挂 hue-rotate 的 CanvasItem shader")
		"fisheye":
			_桩提醒("设置特效(波纹)：需要 shader")
		"whirl":
			_桩提醒("设置特效(扭曲)：需要 shader")
		"pixelate":
			_桩提醒("设置特效(像素化)：需要 shader")
		"mosaic":
			_桩提醒("设置特效(马赛克)：需要 shader")
		"black_white":
			_桩提醒("设置特效(黑白)：需要 shader")
		"symbol":
			_桩提醒("设置特效(符号码)：需要 shader")
		_:
			_桩提醒("设置特效：认不出的特效代码「" + 码 + "」")
	_apply_transform()

## 把「K4 数字编号 / 中文名 / 英文名」统一折成内部码。
##   ★数字一律按 **K4 自己的 scope 编号**解释★（生成代码传的就是它）。
##   实测：高考呐 「透明度 特效」 的 scope = "1"。
##   中文/英文名按 K4 UI 的下拉顺序对应（颜色 透明度 亮度 像素化 波纹 扭曲 黑白 符号码）。
func _特效码(_特效: Variant) -> String:
	# 数字 → K4 编号
	if _特效 is float or _特效 is int:
		return _K4特效表.get(int(_特效), "未知" + str(int(_特效)))
	var 原 := str(_特效).strip_edges()
	if 原 == "":
		return "未知"
	# 纯数字字符串也算 K4 编号（生成代码里传的是 "1" 这种字符串）
	if 原.is_valid_int():
		return _K4特效表.get(int(原), "未知" + 原)
	var s := 原.to_lower()
	match s:
		"颜色", "color", "colour":
			return "color"
		"透明度", "幽灵", "ghost", "opacity":
			return "ghost"
		"亮度", "brightness":
			return "brightness"
		"像素化", "pixelate":
			return "pixelate"
		"马赛克", "mosaic":
			return "mosaic"
		"波纹", "鱼眼", "fisheye":
			return "fisheye"
		"扭曲", "漩涡", "whirl":
			return "whirl"
		"黑白":
			return "black_white"
		"符号码":
			return "symbol"
	return s

## K4 的 scope 编号 → 内部码。
##   ⚠ 已实测确认的只有 **1 = 透明度**（高考呐，用户实测）。
##     其余按 K4 UI 下拉顺序推断；如果你发现某个编号对不上，改这一张表即可。
const _K4特效表 := {
	0: "color",         # 颜色
	1: "ghost",         # 透明度  ← 已实测确认
	2: "brightness",    # 亮度
	3: "pixelate",      # 像素化
	4: "fisheye",       # 波纹
	5: "whirl",         # 扭曲
	6: "black_white",   # 黑白
	7: "symbol"         # 符号码
}

## 「清除图形特效」
func 清除特效(_参数: Variant) -> void:
	k4_effect.clear()
	k4_modulate = Color.WHITE
	_apply_transform()

## 「把 <特效> 增加 <值>」
## 实参：(_特效编号, _符号 ±1, _值)
##   ★K4 把减号放在 increase 字段里、值一律是正数，反编译器已经把它折成 _符号★
##   以前这一块根本没有映射，掉进 default 成了"参数没解析出来"的桩 ——
##   「把亮度增加 10」这类积木在生成工程里静默无效（游戏-空白作品 里 70+ 处）。
func 增加特效(_特效: Variant, _符号: Variant, _值: Variant) -> void:
	# 归一化：符号（数字 / bool / "increase"/"decrease" 字符串）与特效码走同一套规则，
	# 读写都用**内部码**做键，避免"设进去是 6、读出来是 1"这种对不上。
	var 码 := _特效码(_特效)
	设置特效(码, _转数值(k4_effect.get(码, 0.0)) + _转数值(_值) * _符号方向(_符号))

## 「移到图层 <最前面 / 最后面>」
## ⚠ 实参来自反编译器的 layer.dir：**1 = 最前面，-1 = 最后面**（不是字符串）。
##   以前拿 "front"/"最前面" 去比，永远不匹配 → 这个积木完全没效果。
##
## K4 的"图层"就是**兄弟节点的顺序**（排在后面的画在上面），所以只用 move_child。
## 不再动 z_index —— z_index 是"相对同一父节点"的覆盖，一旦和
## 舞台层 / 屏幕绘制 的**跨层**顺序混在一起就会互相打架；
## 而且以前用 ±4096 写 z_index 是破坏性的（再也移不回来）。
## ⚠ move_child 是**父节点**的方法（`父.move_child(子, 位置)`）——
##   以前这两处都写成了 `move_child(self, …)`（= 去动自己的子节点），
##   运行期直接报 "Child is not a child of this node"，
##   于是「移至 最上层/最下层/上一层/下一层」四档**从来没生效过**。
func 移到图层(_方向: Variant) -> void:
	var 父 := get_parent()
	if 父 == null:
		return
	var 最前 := _转数值(_方向) > 0.0
	父.move_child(self, 父.get_child_count() - 1 if 最前 else 0)
	k4_图层 = 0

## 「把图层 <前移 / 后移> <n> 层」（实参是数字，正 = 前移）
func 图层前后移(_层数: Variant) -> void:
	var n := int(_转数值(_层数))
	var 父 := get_parent()
	if 父 == null or n == 0:
		return
	k4_图层 += n
	父.move_child(self, clampi(get_index() + n, 0, 父.get_child_count() - 1))

## 「移到画笔图层 <上方 / 下方>」
##
## K4 的层序（从底到顶）：**舞台背景 → 画笔层 → 角色**。
##   above = 角色回到画笔层**之上**（默认状态）
##   below = 角色插到画笔层**之下**（但仍然在舞台背景之上）
##
## 用 z_index 表达。屏幕的场景树里（见生成出来的 背景.tscn）：
##     舞台层      z = -100   （背景板，永远最底）
##     屏幕绘制    z =  -50   （画笔层）
##     基础角色层  z =    0   （角色默认）
## 所以 below 取 **-75**，正好卡在"背景板之上、画笔之下"的那道夹缝里。
##   ⚠ 以前 below 取 -50 —— 和画笔层**同 z**，只能靠树顺序分先后，
##     而屏幕绘制 在 基础角色层 之前 → 同 z 时画笔先画、角色后画，
##     于是 below 依然显示在画笔**上面**（用户实测的现象）。
##
## ⚠ 这里**只动 z_index**，不动树顺序 —— 树顺序归「移到图层 / 图层前后移」管，
##   两套机制（跨层 vs 同层）分开，才不会互相打架。
func 移到画笔图层(_位置: Variant) -> void:
	var s := str(_位置).to_lower()
	z_index = -75 if (s.find("below") >= 0 or s.find("下") >= 0) else 0

## 「设置图层与画笔」——旧名，保留成别名（core.js 现在已经直接映射到 layer_with_pen）
func 设置图层与画笔(_参数: Variant) -> void:
	移到画笔图层(_参数)

## 「设置大小_外观」（K4 的 `set_scale` 落到类型层时的名字）
##
## ★实参形态：**一个数组**★
##   TYPE_METHODS 的桩调用约定是 `角色.名([输入1, 输入2, …])` —— 反编译器给这类块
##   留不下确定的输入顺序/个数，所以统一用数组兜住（见 emit.js 的补桩注释）。
##   于是这里的 `_参数` 是 `[百分比]`，要取 `_参数[0]`。
##   （以前这一层只打印一句 _桩提醒，块完全不生效。）
##
## 注意：正常路径下 `set_scale` 已被反编译器映射到 IR 方法 `设置大小()`，
##   走不到这里；本函数是"字段没解析出来"时的兜底，结果与 `设置大小()` 一致。
##
## ⚠ 这里**不能**转调 `设置大小()` —— 那个方法会清掉宽高分别缩放
##   （它是"重新定大小"的入口）。本函数与「设置宽高缩放」是同一路参数：
##   都直接**覆盖** `_k4_宽缩放 / _k4_高缩放`，连续调用不会互相乘。
func 设置大小_外观(_参数: Variant) -> void:
	var _v := _转数值(_首个(_参数))
	_写轴缩放("width", _v)
	_写轴缩放("height", _v)
	_移动后()

## 「设置宽高缩放」（K4 的 `set_width_height_scale`）
##
## ★这个积木有"宽度 / 高度"下拉框，轴存在 K4 的 `fields.type` 里★
##   实测原始块（高考呐 zundamon，_k4tmp_probe/probe_scale.js）：
##     { "type": "set_width_height_scale",
##       "fields":  { "type": "height" },              ← 下拉框：宽度 / 高度
##       "shadows": { "value": <math_number 40> } }    ← 目标百分比（%）
##   所以生成器现在传的是 **(轴, 百分比)** 两个实参：
##       await 角色.设置宽高缩放("height", 40.0 + abs(sin(计时器()…)) * 5.0)
##
##   ⚠ 以前这里是 `([数值])` 一个数组实参 —— 轴被静默丢掉，
##     「将角色的**高度**设为 X」被当成等比缩放（宽高一起变），形状是错的。
##     数组形态仍然兼容（老产物 / 防御），单值时按"高度"理解。
##
## 语义：百分比是**相对于造型原始尺寸**的。所以
##     节点缩放 = 目标百分比 / k4_size_percent（抵消统一大小那一层）
##   这样"把高度设为 40%"得到的就是原始高度的 40%，与 K4 一致。
func 设置宽高缩放(_轴: Variant, _百分比: Variant) -> void:
	var 轴串 := ""
	var 值 := 0.0
	if _轴 is Array:
		# 兼容旧形态：([值]) / ([宽, 高])
		var _a: Array = _轴
		if _a.size() >= 2:
			_写轴缩放("width", _转数值(_a[0]))
			_写轴缩放("height", _转数值(_a[1]))
			_移动后()
			return
		轴串 = "height"
		值 = _转数值(_a[0]) if _a.size() > 0 else 0.0
	else:
		轴串 = str(_轴).strip_edges().to_lower()
		值 = _转数值(_百分比)
	if 轴串 == "width" or 轴串 == "宽" or 轴串 == "宽度":
		轴串 = "width"
	elif 轴串 == "height" or 轴串 == "高" or 轴串 == "高度":
		轴串 = "height"
	else:
		# 轴缺失：退回等比（老产物里没有轴信息的情况）
		_写轴缩放("width", 值)
		_写轴缩放("height", 值)
		_移动后()
		return
	# 只覆盖被设置的那一轴；另一轴回到"统一大小"那一档
	_写轴缩放(轴串, 值)
	_k4_清一轴("height" if 轴串 == "width" else "width")
	_移动后()

## 把"目标**百分比(%)**"换算成该轴的节点缩放系数。
##
## 两层的乘法关系（这是本积木唯一容易搞错的地方）：
##     节点缩放 = (k4_size_percent / 100) * _k4_宽缩放
##                                          ^^^^^^^^^ 本函数算的是这一层
##   K4 的百分比是**相对于造型原始尺寸**的最终尺寸，所以：
##     · 只设高度时，宽度要回到"统一大小"那一档 → 该轴系数 = 1.0
##     · 被设置的那一轴 → 系数 = 百分比 / k4_size_percent
##   验证：size=45、设置高度 40% → 0.45 * (40/45) = 0.40 ✅
##
##   ⚠ 曾经写成"系数 = 百分比/100"，而 _apply_transform 又乘了 size%/100 →
##     实际缩放变成 (size%/100)² × 百分比，高度差了一倍以上（实测 0.19 而非 0.40）。
func _写轴缩放(_轴: String, _百分比: float) -> void:
	var 系数 := maxf(0.0, _百分比) / maxf(0.0001, k4_size_percent)   # = 百分比 / 统一大小%
	# ★只改自己这一轴★ —— 另一轴留给调用方决定（重置还是保持）。
	#   以前这里顺手把"另一轴"重置成 1.0，于是「设置大小_外观」连续调两次
	#   （先 width 后 height）时，第二次会把第一次的结果清掉 → 只生效一个轴。
	if _轴 == "width":
		_k4_宽缩放 = 系数
	else:
		_k4_高缩放 = 系数

## 取「类型层桩参数数组」里的第一个值（标量直接返回）
func _首个(_参数: Variant) -> Variant:
	if _参数 is Array:
		var _a: Array = _参数
		return _a[0] if _a.size() > 0 else 0.0
	return _参数

## 清掉「设置宽高缩放」留下的分别缩放（回到等比 = 统一大小）
func _k4_清空宽高缩放() -> void:
	_k4_宽缩放 = 1.0
	_k4_高缩放 = 1.0

## 只清一个轴（另一个轴保持原样）——
##   「设置宽高缩放」只覆盖它自己那一轴，另一轴回到"统一大小"那一档。
func _k4_清一轴(_轴: String) -> void:
	if _轴 == "width":
		_k4_宽缩放 = 1.0
	else:
		_k4_高缩放 = 1.0

# -----------------------------------------------------------------------------
# 说话气泡：说 / 想 / 说_秒 / 想_秒
# -----------------------------------------------------------------------------
func _气泡(_文本: String, _思考: bool) -> Label:
	if k4_say_label == null or not is_instance_valid(k4_say_label):
		var l := Label.new()
		l.name = "K4气泡"
		l.z_index = 4096
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		l.add_theme_font_size_override("font_size", 16)
		l.add_theme_color_override("font_color", Color.BLACK)
		l.add_theme_color_override("font_outline_color", Color.WHITE)
		l.add_theme_constant_override("outline_size", 6)
		l.position = Vector2(-60, -70)
		l.custom_minimum_size = Vector2(120, 0)
		add_child(l)
		k4_say_label = l
	k4_say_label.text = ("💭 " + _文本) if _思考 else _文本
	k4_say_label.visible = true
	k4_say_label.rotation = -rotation
	k4_say_label.scale = Vector2(1.0 / maxf(0.0001, scale.x), 1.0 / maxf(0.0001, scale.y))
	return k4_say_label

func _闭嘴() -> void:
	if k4_say_label != null and is_instance_valid(k4_say_label):
		k4_say_label.visible = false

## 「说 <内容>」
func 说(_内容: Variant) -> void:
	_气泡(str(_内容), false)

## 「想 <内容>」
func 想(_内容: Variant) -> void:
	_气泡(str(_内容), true)

## 「说 <内容> <秒>」
func 说_秒(ctx: 角色基类.WarpCtx, _内容: Variant, _p_秒: Variant) -> void:
	_气泡(str(_内容), false)
	await 等待_秒(ctx, _p_秒)
	_闭嘴()

## 「想 <内容> <秒>」
func 想_秒(ctx: 角色基类.WarpCtx, _内容: Variant, _p_秒: Variant) -> void:
	_气泡(str(_内容), true)
	await 等待_秒(ctx, _p_秒)
	_闭嘴()

# -----------------------------------------------------------------------------
# 淡入 / 淡出 / 渐变（K4 的透明度过渡）
# -----------------------------------------------------------------------------
func _渐变到(_目标: float, _秒数: float) -> void:
	var 起 := modulate.a
	if _秒数 <= 0.0:
		k4_modulate.a = _目标
		_apply_transform()
		return
	var 过 := 0.0
	while 过 < _秒数:
		await get_tree().process_frame
		过 += get_process_delta_time()
		var t := clampf(过 / _秒数, 0.0, 1.0)
		k4_modulate.a = lerpf(起, _目标, t)
		_apply_transform()
	k4_modulate.a = _目标
	_apply_transform()

## 「在 <秒> 内淡入」（逐渐显示）
func 淡入(ctx: 角色基类.WarpCtx, _p_秒: Variant) -> void:
	k4_visible = true
	await _渐变到(1.0, _秒(_p_秒))

## 「在 <秒> 内淡出」（逐渐消失，但**不隐藏** —— K4 语义）
func 淡出(ctx: 角色基类.WarpCtx, _p_秒: Variant) -> void:
	k4_visible = true
	await _渐变到(0.0, _秒(_p_秒))

## 「在 <秒> 内渐变到 <目标透明度>」
func 渐变(ctx: 角色基类.WarpCtx, _p_秒: Variant, _目标: Variant) -> void:
	await _渐变到(clampf(_转数值(_目标) / 100.0, 0.0, 1.0), _秒(_p_秒))


# =============================================================================
# sensing —— 侦测
# =============================================================================

## 「到 <角色 / 鼠标指针> 的距离」
func 到_的距离(_目标: Variant) -> float:
	var 名 := str(_目标)
	var 点 := Vector2.ZERO
	if 名 == "鼠标指针" or 名 == "__mouse":
		点 = _鼠标K4()
	elif 名 == "舞台中心" or 名 == "__center":
		点 = Vector2.ZERO
	else:
		var 他 := 找(名) as 角色基类
		if 他 == null:
			return 0.0
		点 = Vector2(他.k4_x, 他.k4_y)
	return Vector2(k4_x - 点.x, k4_y - 点.y).length()

## 「响度」——需要麦克风输入，留 0
func 响度() -> float:
	return 0.0

## 「回答」——最近一次「询问并等待」的答案
func 回答() -> Variant:
	return k4_回答

## =============================================================================
## 「当前 年 / 月 / 日」（K4 的 get_time 块，fields.op = year | month | date）
## =============================================================================
## 以前这三个块被反编译成和「计时器」同一个 op（op('timer')），于是
## 「设置 y = 当前 年」生成出来是 `K4Global._v_y = 角色.计时器()` —— 日期全变秒数。
##
## 这里取**系统日期**。想改成"游戏内固定日期"（比如试卷里那种"距离高考还有 X 天"
## 需要写死 2024 年 6 月 7 日），把下面三行换成常数即可，例如：
##     func 当前年() -> float: return 2024.0
func 当前年() -> float:
	return float(Time.get_datetime_dict_from_system().get("year", 0))

func 当前月() -> float:
	return float(Time.get_datetime_dict_from_system().get("month", 0))

func 当前日() -> float:
	return float(Time.get_datetime_dict_from_system().get("day", 0))

## 「当前 <星期 / 小时 / 分钟 / 秒>」——K4 的 get_time 另外 5 种 op
##   实测（查表4）fields.op = week（星期文本）/ week_num（星期数字）
##                            / hour / minute / second
##   ⚠ 这 5 种以前在 core.js 里**全部落到"当前年"** —— 用户图 2 里
##     「当前 星期」「当前 小时」「当前 分钟」「当前 秒」四个积木静默算错。
##   Godot 的 weekday 是 0=周日 … 6=周六，而 K4 的"星期(数字)"是
##   星期日=7、星期一=1 …（用户截图里 "星期二" = 2 可对上）。
func 当前星期() -> String:
	const 表 := ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"]
	return 表[int(Time.get_datetime_dict_from_system().get("weekday", 0))]

func 当前星期数字() -> float:
	var w := int(Time.get_datetime_dict_from_system().get("weekday", 0))
	return float(7 if w == 0 else w)

func 当前小时() -> float:
	return float(Time.get_datetime_dict_from_system().get("hour", 0))

func 当前分钟() -> float:
	return float(Time.get_datetime_dict_from_system().get("minute", 0))

func 当前秒() -> float:
	return float(Time.get_datetime_dict_from_system().get("second", 0))

## 「按下 <键> 吗」——键名解析统一走 按键表（与「当按下 X 键」帽子同一套真值：
##   K4 原始十进制键码 / "KEY_W" / "w" / "空格" / "any" 都认）
func 按键按下(_键: Variant) -> bool:
	return 按键表.当前按下(_键)

## 「松开 <键> 吗」——K4 的按键侦测有"按下 / 松开"两档
##   （fields.key_event_type = down | up，实测 18 个样本两档都出现）
func 按键松开(_键: Variant) -> bool:
	return not 按键表.当前按下(_键)

## 「碰到 <边缘 / 鼠标指针 / 角色名>」
## ⚠ 用的是**包围盒**判断，不是像素级碰撞。K4 是像素级（带 alpha 掩码），
##   要精确的话得给每个角色挂 Area2D 并烘焙碰撞多边形（见 README 的待办）。
func 碰到(_目标: Variant) -> bool:
	var 名 := str(_目标)
	if 名 == "边缘" or 名 == "__edge":
		return _出界()
	if 名 == "鼠标指针" or 名 == "__mouse":
		return 包围盒().has_point(_鼠标K4())
	var 他 := 找(名) as 角色基类
	if 他 == null or 他 == self:
		return false
	if not 他.k4_visible:
		return false
	return 包围盒().intersects(他.包围盒())

## 「碰到 <角色>」/「碰到角色」——返回碰到的角色名（没有就返回 ""）
##
## ★为什么不能每次都遍历全部兄弟★
##   K4 的写法是"每个角色每帧问一次碰没碰到"。`大陆漂移学说` 的克隆体
##   堆到 512 个（原工程从不删除克隆体），于是 512 × 512 ≈ **26 万次迭代/帧** ——
##   每次迭代要 2 次属性访问 + 1 次函数调用，GDScript 下就是每帧 100~250ms，
##   帧率直接掉到 1（实测 262 ms/帧，而且和"循环嵌套"的结构吻合：
##   单层循环的 `新的作品` 是 56 FPS，因为它的循环体里根本没有这层遍历）。
##
##   这里做两件事把它压下来：
##     ① 同层角色列表**每帧、每层只收集一次**（`get_children()` 每次都复制数组）；
##     ② 先用**中心距平方**预筛，只有可能相交的才真做 Rect2 相交测试。
##   要彻底根治得换成空间网格/四叉树（K4/Scratch 的 touching 走的就是
##   渲染器的空间索引，不是朴素两两比较）—— 那属于下一步。
##
##   ⚠ 缓存必须**按父节点**分开存（字典，键 = 父节点 instance_id）。
##     一开始这里只用一个 `static var _同层缓存: Array`，看着"每帧一次"很省，
##     但 static 在 class_name 脚本里是**全类共享**的：角色 B 在同一帧调用时
##     会直接命中角色 A 缓存的那份列表。同层时两份恰好相同所以看不出问题，
##     可一旦"基础角色层"和"克隆体层"各挂一批角色，跨层的角色就会拿到
##     别人的兄弟列表 —— 碰撞结果静默出错。
static var _同层缓存表: Dictionary = {}
static var _同层缓存帧: int = -1

func _同层角色() -> Array:
	var 层 := get_parent()
	if 层 == null:
		return []
	var 本帧 := Engine.get_process_frames()
	if _同层缓存帧 != 本帧:
		_同层缓存表.clear()
		_同层缓存帧 = 本帧
	var 键 := 层.get_instance_id()
	if _同层缓存表.has(键):
		return _同层缓存表[键]
	var 列表: Array = []
	var n := 层.get_child_count()
	for i in n:
		var 角 := 层.get_child(i) as 角色基类
		if 角 != null and 角.k4_visible:
			列表.append(角)
	_同层缓存表[键] = 列表
	return 列表

## ============================================================================
## 「碰到角色」的像素级判定
## ============================================================================
## 为什么必须做：K4/Scratch 的 touching 是**像素级**（渲染器拿造型的 alpha 掩码
## 做空间索引），而我们是**包围盒**。这个差距不是"精度差一点"，是会**改变行为**：
##
##   射击生存 的子弹（造型 19px 的小圆）从舞台中心出生，射击手（178px 的坦克）
##   也在中心。子弹一帧移动 50px 后，**像素上早就离开射击手了**
##   （射击手的不透明部分只有中心 ~30px 半径的黑圆），
##   但我们的包围盒半径有 89px → 判成"还碰着" →
##   子弹那份「碰到角色 → 删除克隆体」立刻把它删掉 → **子弹永远射不出去**。
##
## 做法：只对"包围盒确实相交"的那几对做像素级检查（预筛挡住绝大多数对），
## 掩码按**贴图 RID** 缓存，同一张贴图只解一次。
static var _掩码缓存: Dictionary = {}

## 取造型的 alpha 掩码。
## 返回一个字典：{ 数据: PackedByteArray, 宽: int, 高: int }，拿不到就返回 null。
##
## ★为什么缓存的是 `get_data()` 出来的原始字节，而不是 Image 本身★
##   `Image.get_pixel()` 在 GDScript 里是**变参函数调用**，每次都有打包/解包开销；
##   而碰撞检测一秒可能要查几十万次像素。按 `(y*宽 + x)*4 + 3` 直接读
##   PackedByteArray 的第 3 个分量（RGBA8 的 alpha）快得多。
##   实测（射击生存，子弹 × 射击手 这一对）：
##     get_pixel 版 ≈ 待填   字节版 ≈ 待填
static func _取掩码(_纹: Texture2D):
	if _纹 == null:
		return null
	var 键 := _纹.get_rid()
	if _掩码缓存.has(键):
		return _掩码缓存[键]
	var 图: Image = _纹.get_image()
	if 图 == null:
		_掩码缓存[键] = null
		return null
	if 图.get_format() != Image.FORMAT_RGBA8:
		var 转 := Image.new()
		转.copy_from(图)
		转.convert(Image.FORMAT_RGBA8)
		图 = 转
	var 包 := {
		"数据": 图.get_data(),
		"宽": 图.get_width(),
		"高": 图.get_height()
	}
	_掩码缓存[键] = 包
	return 包

## 两个造型纹理的 alpha 掩码是否真的有重叠像素。
## 拿不到掩码时**退回 true**（宁可误判成"碰到"，也不要漏判 —— 那会让
## "碰到就删除"这类积木失效，反而更不像 K4）。
func _掩码相交(_我: Node2D, _他: Node2D) -> bool:
	if _我 == null or _他 == null:
		return true
	var 我包 = _取掩码(_我.当前纹理())
	var 他包 = _取掩码(_他.当前纹理())
	if 我包 == null or 他包 == null:
		return true
	var 我数: PackedByteArray = 我包["数据"]
	var 他数: PackedByteArray = 他包["数据"]
	var 我宽: int = 我包["宽"]
	var 我高: int = 我包["高"]
	var 他宽: int = 他包["宽"]
	var 他高: int = 他包["高"]
	if 我宽 < 1 or 我高 < 1 or 他宽 < 1 or 他高 < 1:
		return true
	var 我尺 := Vector2(我宽, 我高)
	var 他尺 := Vector2(他宽, 他高)
	var 我变换 := _我.get_global_transform()
	var 他逆 := _他.get_global_transform().affine_inverse()
	# 采样步长：长边最多采 24 个点（≤576 点），小造型自动采到 1px
	var 步 := maxi(1, int(maxf(我尺.x, 我尺.y) / 24.0))
	var y := 0
	while y < 我高:
		var x := 0
		while x < 我宽:
			# 我这一点的 alpha（RGBA8 第 4 个字节）
			if 我数[(y * 我宽 + x) * 4 + 3] > 127:
				var 舞台点: Vector2 = 我变换 * (Vector2(x, y) - 我尺 * 0.5)
				var 他像素: Vector2 = 他逆 * 舞台点 + 他尺 * 0.5
				if 他像素.x >= 0.0 and 他像素.y >= 0.0 and 他像素.x < 他尺.x and 他像素.y < 他尺.y:
					var hx := int(他像素.x)
					var hy := int(他像素.y)
					if 他数[(hy * 他宽 + hx) * 4 + 3] > 127:
						return true
			x += 步
		y += 步
	return false

## ★每帧像素确认的次数上限★
##
## 为什么必须有这一道：`_掩码相交()` 实测**单次 10.74 微秒**（子弹 127x128 × 射击手 300x300），
## 而包围盒判定只要 0.7 微秒 —— 贵 15 倍。
## 稀疏场景完全无所谓（包围盒预筛把绝大多数对都挡掉了），但**密集场景会炸**：
##   512 个克隆体挤在一起时，通过包围盒预筛的对可能有好几万，
##   不设上限就是 **2.8 秒/帧**（实测推算）。
## 所以这里给一个和 `K4_帧warp预算` 同样性质的"本帧配额"：
##   用完之后退回**包围盒结论**（继承像素级之前的老行为，宁可略粗也不冻帧）。
## 300 次 × 10.74 微秒 ≈ 最坏 3.2 毫秒/帧，是有界的。
const K4_帧像素确认上限 := 300
static var _像素帧号: int = -1
static var _像素本帧计数: int = 0

func _还可以做像素确认() -> bool:
	var 本帧 := Engine.get_process_frames()
	if _像素帧号 != 本帧:
		_像素帧号 = 本帧
		_像素本帧计数 = 0
	if _像素本帧计数 >= K4_帧像素确认上限:
		return false
	_像素本帧计数 += 1
	return true

## ★本轮补齐（查表4 带出来的缺口）★

## 「<a> 碰到 <b>」——两个目标都可以是**角色名**或**角色组名**
##   K4 的组 = Godot 原生 group（生成期给每个角色 add_to_group("K4组_…")），
##   所以这里先"展开"：组名 → 组内所有角色，再做两两包围盒相交。
##   以前 core.js 产出的是 `touching_entities`，而 emit 的 ARG 表把它写成空数组
##   → 两个目标在生成期被丢光，用户图 3 的「碰到 侦测组 / 运算组 / 侦测 / 运算」
##     全都变成了无参的 `碰到角色()`（"碰到任意角色"），目标一个都没生效。
func 碰到目标(_目标: Variant, _目标2: Variant) -> bool:
	# 隐藏时碰不到任何东西；克隆体出生头一帧也不参与（K4/Scratch 语义，
	# 这两条的理由见 碰到角色() 的长注释）
	if not k4_visible:
		return false
	if k4_出生帧 > 0 and Engine.get_process_frames() <= k4_出生帧:
		return false
	var 甲 := 实体节点们(_目标)
	var 乙 := 实体节点们(_目标2)
	if 甲.is_empty() or 乙.is_empty():
		return false
	for a in 甲:
		if a == null or not is_instance_valid(a) or not a.get("k4_visible"):
			continue
		var 盒A: Rect2 = a.包围盒()
		for b in 乙:
			if b == null or not is_instance_valid(b) or b == a:
				continue
			if not b.get("k4_visible"):
				continue
			if 盒A.intersects(b.包围盒()):
				return true
	return false

## 「离开 <n> 边缘」——K4 的 self_out_of_boundary
##   实测 fields.boundary = 0/1/2/3/4：0 = 任意一边，1 = 上，2 = 下，3 = 左，4 = 右
##   ⚠ 以前 core.js 把它生成成 `碰到("边缘")` —— 判定**正好相反**：
##     角色站在舞台中间时"离开边缘"应为真，按"碰到边缘"算则恒为假。
func 离开边缘(_边: Variant) -> bool:
	var 半 := _舞台半()
	var b := str(_边).strip_edges()
	if b == "" or b == "0" or b == "任意" or b == "any":
		return k4_x < -半.x or k4_x > 半.x or k4_y < -半.y or k4_y > 半.y
	if b == "1" or b == "上" or b == "top":
		return k4_y > 半.y
	if b == "2" or b == "下" or b == "bottom":
		return k4_y < -半.y
	if b == "3" or b == "左" or b == "left":
		return k4_x < -半.x
	if b == "4" or b == "右" or b == "right":
		return k4_x > 半.x
	return false

## 「碰到 <颜色>」——K4 的 bump_into_color（用户自己标注"功能空着也没事"）
##   真正的 K4 语义是"某个像素碰到了指定颜色的像素"，要读渲染结果做采样。
##   这里给一个**不崩、可判定**的近似：自己的中心点是否落在目标的包围盒里。
##   想要像素级精度，把中间换成 viewport.get_texture().get_image() 采样即可。
func 碰到颜色(_目标: Variant, _颜色: Variant) -> bool:
	for 他 in 实体节点们(_目标):
		if 他 == null or not is_instance_valid(他) or 他 == self:
			continue
		if not 他.get("k4_visible"):
			continue
		if (他.包围盒() as Rect2).has_point(Vector2(k4_x, k4_y)):
			return true
	return false

## 「屏幕方向 <X / Y>」——K4 的 get_orientation（手机重力 / 倾斜感应）
##   桌面端通常没有重力计，Input.get_gravity() 恒为 (0, 9.8)：
##   那种情况返回 0（= 未倾斜），语义稳定、不会乱跳。
func 屏幕方向(_轴: Variant) -> float:
	var 重 := Input.get_gravity()
	if absf(重.x) < 0.05 and absf(重.y) < 0.05:
		return 0.0
	return 重.x if str(_轴).strip_edges().to_upper().begins_with("X") else 重.y

## 「开启 / 关闭 声音侦测」——K4 的 enable_voice_detection（fields.state = open | close）
##   真正的麦克风采集在 autoload `K4Voice` 上
##   （它要占一条音频总线、还需要 project.godot 打开输入驱动，见那个文件）。
func 开启声音侦测(_开关: Variant) -> void:
	var 开 := str(_开关).strip_edges().to_lower().find("open") >= 0 or _转数值(_开关) != 0.0
	K4Voice.设置启用(开)

## 「当前 音量」——K4 的 get_voice_volume（麦克风音量，0-100）
func 当前音量() -> float:
	return K4Voice.当前音量()

func 碰到角色() -> Variant:
	# ★隐藏的角色碰不到任何东西★（Scratch / K4 语义）
	#   这条直接决定"子弹能不能射出来"：
	#   子弹的克隆体出生时是**隐藏**的（visible=false），它的
	#   「当作为克隆体启动」里有"碰到角色 → 删除自己"。
	#   如果不判自己的可见性，它一出生就被判成"碰到射击手"
	#   （两者初始都在舞台中心）然后立刻自删。
	if not k4_visible:
		return ""
	# ★克隆体出生的头一帧不参与碰撞★
	#   K4/Scratch 的克隆体创建后 drawable 要下一帧才建立，那之前 touching 恒为 false。
	#   没有这条时，子弹（出生在射击手身上）会在飞出 50px 前就被
	#   「碰到角色 → 删除克隆体」删掉 —— 表现为"能不能射出子弹看鼠标朝向"。
	if k4_出生帧 > 0 and Engine.get_process_frames() <= k4_出生帧:
		return ""
	var 我 := 包围盒()
	var 我半 := maxf(我.size.x, 我.size.y) * 0.5
	for 节点 in _同层角色():
		var 兄弟 := 节点 as 角色基类
		if 兄弟 == null or 兄弟 == self:
			continue
		var 他盒: Rect2 = 兄弟.包围盒()
		# ① 中心距平方预筛：两心距离 > 两个半径之和 → 一定不相交，跳过 Rect2 测试
		var 阈: float = 我半 + maxf(他盒.size.x, 他盒.size.y) * 0.5
		var dx: float = 兄弟.k4_x - k4_x
		var dy: float = 兄弟.k4_y - k4_y
		if dx * dx + dy * dy > 阈 * 阈:
			continue
		if 我.intersects(他盒):
			# ② 包围盒相交了，再做**像素级**确认（见上面 _掩码相交 的说明）。
			#    预筛 + Rect2 已经挡住了绝大多数对；
			#    再加一道**每帧配额**（K4_帧像素确认上限），
			#    密集场景用完配额就退回包围盒结论，保证帧时间有界。
			if not _还可以做像素确认():
				return str(兄弟.name)
			if _掩码相交(self, 兄弟):
				return str(兄弟.name)
	return ""

## 「<目标> 的 <属性>」
func 属性(_目标: Variant, _属性: Variant) -> Variant:
	var 名 := str(_目标)
	if 名 == "舞台" or 名 == "__stage":
		return 舞台信息(_属性)
	var 他 := _目标节点(_目标)
	if 他 == null:
		return 0.0
	return _读属性(他, str(_属性))

## 「<角色> 的 <属性>」——注意实参顺序是 (属性, 目标)
func 角色属性(_属性: Variant, _目标: Variant) -> Variant:
	var 他 := _目标节点(_目标)
	if 他 == null:
		return 0.0
	return _读属性(他, str(_属性))

## ★K4 的「角色的属性」是用**数字索引**传进来的，不是中文名★
##
## 表来自 K4 源码里 get_3 / get 的代码生成器（实测 _dev/probe_block_raw.js：
## get_3 的 fields.attribute = "3"）：
##   get_3: ["x","y","style_index","sensing_direction","style_name","size","volume",
##           "color","transparency","brightness","pixelate","wave","twist","grey","ascii","speed"]
##   get  : 同上，只有索引 3 是 "rotation" 而不是 "sensing_direction"
##
## ⚠ 以前这里只认中文名 / 英文名，数字进来的全部落到最后 return 0.0 ——
##   于是「<射击手> 的方向」恒等于 0，炮口方向整个歪掉
##   （用户实测原话："射击方向是歪的"）。
func _读属性(_节点: Node, _属性: String) -> Variant:
	var 键 := _属性.strip_edges()
	match 键:
		"0", "x", "x坐标", "X坐标", "横坐标":
			return _节点.get("k4_x")
		"1", "y", "y坐标", "Y坐标", "纵坐标":
			return _节点.get("k4_y")
		"2", "造型编号", "style_index":
			return _造型编号(_节点)
		"3", "方向", "朝向", "direction", "rotation", "sensing_direction":
			return _节点.get("k4_direction")
		"4", "造型", "costume", "style_name":
			return _节点.get("k4_costume_name")
		"5", "大小", "size":
			return _节点.get("k4_size_percent")
		"6", "音量", "volume":
			return _节点.get("k4_音量")
		"7", "颜色", "color":
			return _特效值(_节点, "0")
		"8", "透明度", "transparency":
			return _特效值(_节点, "6")
		"9", "亮度", "brightness":
			return _特效值(_节点, "5")
		"10", "像素化", "pixelate":
			return _特效值(_节点, "3")
		"11", "波浪", "wave":
			return _特效值(_节点, "1")
		"12", "扭曲", "twist":
			return _特效值(_节点, "2")
		"13", "黑白", "灰色", "grey", "gray":
			return _特效值(_节点, "4")
		"15", "速度", "speed":
			return 0.0
		"可见", "显示", "visible":
			return _节点.get("k4_visible")
		"名字", "name":
			return str(_节点.name)
	if _节点.has_method("取值"):
		return _节点.call("取值", _属性)
	return 0.0

## 「造型编号」——K4 是 1-based（= SpriteFrames 帧号 + 1）
func _造型编号(_节点: Node) -> int:
	if _节点.has_method("造型序号"):
		var 序: int = int(_节点.call("造型序号", _节点.get("k4_costume_name")))
		if 序 >= 0:
			return 序 + 1
	return 1

## 读某个特效的当前值（特效编号见 设置特效 的说明）
func _特效值(_节点: Node, _码: String) -> float:
	var 效 = _节点.get("k4_effect")
	if 效 is Dictionary:
		return float((效 as Dictionary).get(_码, 0.0))
	return 0.0

## 「鼠标 x」「鼠标 y」
func 鼠标x() -> float:
	return _鼠标K4().x

func 鼠标y() -> float:
	return _鼠标K4().y

## 「鼠标 <x / y / 按下 / 松开>」
func 鼠标信息(_项: Variant) -> Variant:
	match str(_项).to_lower():
		"x":
			return _鼠标K4().x
		"y":
			return _鼠标K4().y
		"down", "pressed":
			return Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)
		"up", "released":
			return not Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)
	return 0.0

func 鼠标按下() -> bool:
	return Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)

func 鼠标松开() -> bool:
	return not Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)

## 「舞台的 <宽 / 高 / 信息>」
func 舞台信息(_项: Variant) -> Variant:
	var 尺 := get_viewport_rect().size
	match str(_项).to_lower():
		"宽", "width", "w":
			return 尺.x
		"高", "height", "h":
			return 尺.y
	return 0.0

## 桩块：舞台信息_桩
func 舞台信息_桩(_参数: Variant) -> Variant:
	return 0.0

# -----------------------------------------------------------------------------
# 计算（K4 的 calculate 积木）
# =============================================================================
## 「计算 <算式>」—— K4 的 `calculate` 积木（取值类）。
##   K4 里它是一个**算式输入框**：用户直接写算式文本，积木给出数值结果。
##   实测样例（Phigros模拟器v2.5，16 处）："1+2"、"sin1"、"9/11"、"15/16"、"3/4"。
##   解析在 角色基类.算式求值()（Godot Expression + K4 语法预处理，见那里的注释）。
##   ⚠ 以前 core.js 没有 calculate 分支 → 落到"未支持的取值积木"按空值处理 →
##     生成裸 `0.0`：分数、进度比、判定比例**全部算成 0**，且只在转换日志里留一行警告。
func 计算(_算式: Variant) -> float:
	return _k4算式求值(str(_算式))

# =============================================================================
# 询问并等待 / 询问并选择
# -----------------------------------------------------------------------------
# 惰性建一个 CanvasLayer 输入框。要换成你自己的 UI（更漂亮的对话框）时，
# 只要保留 `_询问提交` 这个信号和 询问并等待() 的等待逻辑即可。
func _确保询问界面() -> void:
	if _询问层 != null and is_instance_valid(_询问层):
		return
	_询问层 = CanvasLayer.new()
	_询问层.name = "K4询问层"
	_询问层.layer = 100
	var 板 := PanelContainer.new()
	板.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	板.position = Vector2(-180, -180)
	板.custom_minimum_size = Vector2(360, 0)
	_询问层.add_child(板)
	var 列 := VBoxContainer.new()
	板.add_child(列)
	_询问问题 = Label.new()
	_询问问题.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	列.add_child(_询问问题)
	_询问输入 = LineEdit.new()
	_询问输入.custom_minimum_size = Vector2(340, 0)
	列.add_child(_询问输入)
	_询问按钮 = Button.new()
	_询问按钮.text = "确定"
	列.add_child(_询问按钮)
	_询问按钮.pressed.connect(_提交询问)
	_询问输入.text_submitted.connect(func(_t: String) -> void: _提交询问())
	# 挂到当前场景（autoload 里挂不到"当前屏幕"上面）
	var 树 := get_tree()
	if 树 == null:
		return
	if 树.current_scene != null:
		树.current_scene.add_child.call_deferred(_询问层)
	elif 树.root != null:
		树.root.add_child.call_deferred(_询问层)

func _提交询问() -> void:
	if _询问输入 == null:
		return
	_询问提交.emit(_询问输入.text)

## 「询问 <问题> 并等待」——返回玩家的输入
func 询问并等待(ctx: 角色基类.WarpCtx, _问题: Variant) -> Variant:
	_确保询问界面()
	if _询问层 == null:
		return ""
	# 等界面真的挂进场景树（call_deferred）
	while not _询问层.is_inside_tree():
		await get_tree().process_frame
	_询问问题.text = str(_问题)
	_询问输入.text = ""
	_询问层.visible = true
	_询问输入.grab_focus()
	var 答: String = await _询问提交
	_询问层.visible = false
	k4_回答 = 答
	return 答

## 「询问 <问题> 并从 <选项> 里选一个」——返回被选中的那个选项文本
## K4 的选项在实参里是数组或逗号分隔的字符串，两种都认。
func 询问并选择(ctx: 角色基类.WarpCtx, _问题: Variant, _选项: Variant) -> void:
	var 列: Array = []
	if _选项 is Array:
		列 = _选项
	else:
		for s in str(_选项).split(",", false):
			列.append(s.strip_edges())
	if 列.is_empty():
		return
	var 答: Variant = await 询问并等待(ctx, str(_问题) + "（可选：" + ", ".join(列.map(func(x): return str(x))) + "）")
	# 选一个最接近的（完全相等才算命中）
	# ★「选择的选项」/「选择的选项序号」两个取值块读的就是下面这几个字段★
	#   以前只写 k4_回答 —— 序号恒为 0。默认落在第 1 项（和 K4 一致）。
	k4_回答 = 列[0]
	k4_选项内容 = 列[0]
	k4_选项序号 = 1.0
	for i in 列.size():
		if str(列[i]) == str(答):
			k4_回答 = 列[i]
			k4_选项内容 = 列[i]
			k4_选项序号 = float(i + 1)
			return

## 「选择的选项」——「询问并选择」的配套取值块，返回上一次被选中的**内容**
##   （K4 的 get_choice / get_choice_or_index(select_content)，实参 0 个）
func 获取选项() -> Variant:
	return k4_选项内容

## 「选择的选项序号」—— 返回上一次被选中的**序号**（从 1 开始）
##   ⚠ 以前这里恒 `return 0.0`，而且 core.js 根本没接线（走 unknown → 0.0）——
##     双重失效：玩家选第几项都读到 0，「选对了吗」的判断永远走 else 分支。
func 获取选项序号() -> float:
	return k4_选项序号

## 兼容保留：万一还有生成代码里留着 `获取选项或序号(...)` 这个调用点
func 获取选项或序号(_参数: Variant = null) -> Variant:
	return k4_选项内容

# -----------------------------------------------------------------------------
# 监视器（K4 在舞台上画的列表 / 排行榜 / 计时器）
# -----------------------------------------------------------------------------
# ⚠ 这些只记录"用户想显示什么"，真正的 UI 需要你自己做一个 CanvasLayer。
#   转成 Godot 后的常见做法：用 全局/角色类.gd 里的一个 VBoxContainer + Label，
#   每帧从 K4Global.列表(名) 里取内容刷新。
func 显示列表(_列表: Variant) -> void:
	k4_列表显示[str(_列表)] = true

func 隐藏列表(_列表: Variant) -> void:
	k4_列表显示.erase(str(_列表))

# 注：显示隐藏列表 / 显示隐藏变量 / 显示排行榜 的**真实现**在文件后面
#     「变量 / 列表 / 排行榜 的显示监视器」那一段。
#     （它们以前是这里的桩，参数都解析不出来；现在 core.js 会把
#       变量名和 show/hide 开关都传下来，所以桩必须让位给真实现。）
func 显示隐藏计时器(_参数: Variant) -> void:
	_桩提醒("显示隐藏计时器：K4 的计时器监视器，需要你自己实现")

# 麦克风 / 语音那几块
func 自己询问(_参数: Variant) -> void:
	_桩提醒("自己询问：需要 Godot 的文本输入 UI，请参考 询问并等待()")

func 自己询问并录音(_参数: Variant) -> void:
	_桩提醒("自己询问并录音：需要麦克风录音（AudioEffectRecord），未实现")

func 自己询问并监听(_参数: Variant) -> void:
	_桩提醒("自己询问并监听：需要语音识别，未实现")


# =============================================================================
# sound —— 声音
# =============================================================================
# K4 的声音名 -> 文件：转换器把音频放在 res://音频/<角色>/ 下，
# 文件名就是 K4 里的声音文件名（不含扩展名）。这里第一次用到时扫一遍建索引。

func _建声音表() -> void:
	if _声音表已建:
		return
	_声音表已建 = true
	_扫目录("res://音频")

func _扫目录(_路径: String) -> void:
	var d := DirAccess.open(_路径)
	if d == null:
		return
	d.list_dir_begin()
	var n := d.get_next()
	while n != "":
		if n.begins_with("."):
			n = d.get_next()
			continue
		var 全 := _路径.path_join(n)
		if d.current_is_dir():
			_扫目录(全)
		else:
			var 基 := n.get_basename()
			if not _声音表.has(基):
				_声音表[基] = 全
		n = d.get_next()
	d.list_dir_end()

func _找声音(_名: String) -> AudioStream:
	_建声音表()
	# ① 精确命中
	if _声音表.has(_名):
		return _载声音(_声音表[_名])
	# ② 规范化命中（★这条是必须的★）
	#    K4 里的声音名带空格/括号（比如 "827454048-1-208 (1)"），而落盘的文件名
	#    经过了 sanitize —— 空格和括号会变成下划线（"827454048-1-208_(1).mp3"）。
	#    原来的兜底是"文件名包含声音名"的子串判断，而
	#       "827454048-1-208_(1)".find("827454048-1-208 (1)") == -1   → 匹配失败，
	#    于是 K4 里明明有声音，运行时却报"找不到声音"。
	#    这里把两边都剥成"只留字母数字与中文"，差异就消失了。
	var 规范 := _规范名(_名)
	if 规范 != "":
		for k in _声音表.keys():
			if _规范名(str(k)) == 规范:
				return _载声音(_声音表[k])
	# ③ 最后才退到子串匹配
	for k in _声音表.keys():
		if str(k).find(_名) >= 0 or _规范名(str(k)).find(规范) >= 0:
			return _载声音(_声音表[k])
	return null

## 按"名字**或**编号"取音频流 —— K4 的双索引语义（用户实测，和造型完全一致）：
##   数字实参 → 编号（查 K4Global.声音顺序，K4 从 1 开始，对应界面上的 "1.倒水声"）
##   其它实参 → 名字
func _取声音(_名称: Variant) -> AudioStream:
	if (_名称 is int or _名称 is float) and not (_名称 is bool):
		var 名 := _按编号取声音名(int(_名称))
		if 名 == "":
			return null
		return _找声音(名)
	return _找声音(str(_名称))

## 编号 -> 声音名。表由转换器生成在 K4Global 上（顺序 = K4 的 audio_order）。
func _按编号取声音名(_编号: int) -> String:
	var 表: Variant = K4Global.get("声音顺序")
	if not (表 is Array) or (表 as Array).is_empty():
		return ""
	var i := clampi(_编号 - 1, 0, (表 as Array).size() - 1)
	return str((表 as Array)[i])

## 「停止 <某个声音>」——K4 的「停止 1.倒水声」
##   ⚠ 每个角色只有一个播放器，所以这里只在"当前播放的确实是那个声音"时才停。
##     要真正做多音轨并存，得把 k4_音频 换成一组播放器（另一摊工程）。
func 停止声音(_名称: Variant) -> void:
	if k4_音频 == null or not is_instance_valid(k4_音频):
		return
	var 想停 := _取声音(_名称)
	if 想停 == null:
		return
	if k4_音频.stream == 想停:
		k4_音频.stop()

## 取音频流（带弱引用缓存，避免反复 load() 累积引用、又不持有资源）
func _载声音(_路径: String) -> AudioStream:
	if _流缓存.has(_路径):
		var 弱 = _流缓存[_路径]
		var 有 = 弱.get_ref() if 弱 is WeakRef else null
		if 有 != null:
			return 有
	# ★用 CACHE_MODE_IGNORE★：走引擎的常驻缓存时，那份额外的引用在进程退出时
	#   可能还没被回收，Godot 就报
	#     "Resource still in use: res://音频/xxx.mp3"
	#   自己管缓存（下面的弱引用表）之后，引用只挂在正在使用它的播放器上，
	#   播放器一 stop()/stream = null 就干净了。
	var s := ResourceLoader.load(_路径, "", ResourceLoader.CACHE_MODE_IGNORE) as AudioStream
	if s != null:
		_流缓存[_路径] = weakref(s)
	return s

## 声音/素材名的规范化：去掉空格、下划线、括号、连字符等一切分隔符后比较。
##   "827454048-1-208 (1)" 与 "827454048-1-208_(1)" → 都变成 "82745404812081"
func _规范名(_名: String) -> String:
	var 出 := ""
	for i in _名.length():
		var c := _名[i]
		if (c >= "0" and c <= "9") or (c >= "a" and c <= "z") or (c >= "A" and c <= "Z"):
			出 += c.to_lower()
		elif c.unicode_at(0) > 127:
			出 += c      # 中文等直接保留
	return 出

func _播放器() -> AudioStreamPlayer:
	if k4_音频 == null or not is_instance_valid(k4_音频):
		k4_音频 = AudioStreamPlayer.new()
		k4_音频.name = "K4声音"
		add_child(k4_音频)
		k4_音频.volume_db = linear_to_db(clampf(k4_音量 / 100.0, 0.0, 1.0))
	return k4_音频

## 「播放声音 <名称 / 编号>」
func 播放声音(_名称: Variant) -> void:
	var 流 := _取声音(_名称)
	if 流 == null:
		_桩提醒("播放声音：找不到声音 " + str(_名称) + "（应该在 res://音频/ 下）")
		return
	var p := _播放器()
	p.stream = 流
	p.volume_db = linear_to_db(clampf(k4_音量 / 100.0, 0.0, 1.0))
	p.play()

## 「播放声音 <名称> 直到播完」
func 播放声音并等待(ctx: 角色基类.WarpCtx, _名称: Variant) -> void:
	var 流 := _取声音(_名称)
	if 流 == null:
		_桩提醒("播放声音并等待：找不到声音 " + str(_名称))
		return
	var p := _播放器()
	p.stream = 流
	p.play()
	# 注意：用 await p.finished 会被 start() 打断，所以轮询 playing
	while p.playing:
		await get_tree().process_frame
		if not k4_alive or ctx._已取消:
			# ★被打断时必须把播放器停掉★
			#   否则它停在"正在播放"状态一直持有 AudioStreamMP3 与
			#   AudioStreamPlaybackMP3 —— 退出时 Godot 报
			#     "2 ObjectDB instances were leaked" +
			#     "Resource still in use: res://音频/....mp3"
			#   （实测就是这一条路径：角色被删除/绿旗重启打断了这段等待。）
			p.stop()
			return

## 「停止所有声音」
func 停止所有声音() -> void:
	var 树 := get_tree()
	if 树 == null:
		return
	_停子树(树.root)

func _停子树(_节点: Node) -> void:
	if _节点 is AudioStreamPlayer:
		(_节点 as AudioStreamPlayer).stop()
	for c in _节点.get_children():
		_停子树(c)

## 「把音量设为 <值>」——K4 是 0-100
func 设置音量(_值: Variant) -> void:
	k4_音量 = clampf(_转数值(_值), 0.0, 100.0)
	var p := _播放器()
	p.volume_db = linear_to_db(clampf(k4_音量 / 100.0, 0.0, 1.0))

## 「把音量增加 <值>」
func 增加音量(_值: Variant) -> void:
	设置音量(k4_音量 + _转数值(_值))

## 「把 <音量 / 播放速率> 设为 <值>」
##   ★K4 的音量积木带一个下拉框（fields.audio_key = volume | rate）★
##     rate 是"播放速率/音调"，对应 Godot 的 AudioStreamPlayer.pitch_scale（100 = 原速）。
##     以前这个字段被丢掉 → 选"播放速率"的积木被当成"设置音量"执行。
func 设置音量或速率(_项: Variant, _值: Variant) -> void:
	if str(_项).to_lower().find("rate") >= 0:
		_播放器().pitch_scale = maxf(0.01, _转数值(_值) / 100.0)
	else:
		设置音量(_值)

## 「把 <音量 / 播放速率> 增加 <值>」
func 增加音量或速率(_项: Variant, _值: Variant) -> void:
	if str(_项).to_lower().find("rate") >= 0:
		var p := _播放器()
		p.pitch_scale = maxf(0.01, p.pitch_scale + _转数值(_值) / 100.0)
	else:
		增加音量(_值)

## 「演奏音符 <参数>」 / 「<音符>」
## ❌ 未实现：K4 的音符块是实时合成音源，Godot 侧要用 AudioStreamGenerator
##    自己算波形（音高 / 时值 / 音色）。属于另一摊工程，这里只留桩。
func 播放音符(ctx: 角色基类.WarpCtx, _参数: Variant) -> void:
	_桩提醒("演奏音符：未实现（需要 AudioStreamGenerator 实时合成）")

func 播放音符_序号(_参数: Variant) -> void:
	_桩提醒("播放音符_序号：未实现")

func 获取音符(_参数: Variant) -> Variant:
	return 0.0


# =============================================================================
# pen —— 画笔
# =============================================================================

## 「落笔」：开始记线。真正画线在 画布落笔()（角色基类转发给屏幕画布）
func 落笔() -> void:
	k4_pen_down = true
	k4_last_pen_point = Vector2(k4_x, k4_y)
	K4Canvas.设置画笔颜色(k4_pen_color)
	K4Canvas.设置画笔粗细(k4_pen_size)

## 「抬笔」
func 抬笔() -> void:
	k4_pen_down = false
	K4Canvas.抬笔()

## 「全部擦除」
func 全部擦除() -> void:
	K4Canvas.全部擦除()

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

## ⚠ Godot 4.7 的 Color **没有 `from_hsl`**（只有 `from_hsv`）——
##   实测报错：`Cannot find member "from_hsl" in base "Color"`，
##   而且这个错会让**整个 角色自带积木.gd 编译失败**，
##   连累五层继承链全断（所有角色脚本都报 "Could not resolve class 角色类"）。
##   所以 HSL -> RGB 只能自己算（标准算法，h 0~360、s/l/a 0~1）。
static func _色相分量(p: float, q: float, t: float) -> float:
	var T := fposmod(t, 1.0)
	if T < 1.0 / 6.0:
		return p + (q - p) * 6.0 * T
	if T < 1.0 / 2.0:
		return q
	if T < 2.0 / 3.0:
		return p + (q - p) * (2.0 / 3.0 - T) * 6.0
	return p

static func _hsl到rgb(h: float, s: float, l: float, a: float) -> Color:
	if s <= 0.0:
		return Color(l, l, l, a)
	var q := (l * (1.0 + s)) if l < 0.5 else (l + s - l * s)
	var p := 2.0 * l - q
	var H := fposmod(h, 360.0) / 360.0
	return Color(
		_色相分量(p, q, H + 1.0 / 3.0),
		_色相分量(p, q, H),
		_色相分量(p, q, H - 1.0 / 3.0),
		a)

func _刷新画笔颜色() -> void:
	k4_pen_color = _hsl到rgb(
		k4_笔_h,
		clampf(k4_笔_s / 100.0, 0.0, 1.0),
		clampf(k4_笔_l / 100.0, 0.0, 1.0),
		clampf(k4_笔_a / 100.0, 0.0, 1.0))
	K4Canvas.设置画笔颜色(k4_pen_color)

## RGB -> HSL，用于「把画笔颜色设为 #RRGGBB」之后同步回我们的 HSL 状态
func _从颜色更新HSL(_c: Color) -> void:
	var 大 := maxf(_c.r, maxf(_c.g, _c.b))
	var 小 := minf(_c.r, minf(_c.g, _c.b))
	var l := (大 + 小) * 0.5
	var h := 0.0
	var s := 0.0
	if 大 > 小:
		var d := 大 - 小
		s = d / (2.0 - 大 - 小) if l > 0.5 else d / (大 + 小)
		if is_equal_approx(大, _c.r):
			h = (_c.g - _c.b) / d + (6.0 if _c.g < _c.b else 0.0)
		elif is_equal_approx(大, _c.g):
			h = (_c.b - _c.r) / d + 2.0
		else:
			h = (_c.r - _c.g) / d + 4.0
		h /= 6.0
	k4_笔_h = h * 360.0
	k4_笔_s = s * 100.0
	k4_笔_l = l * 100.0
	k4_笔_a = _c.a * 100.0

## 「把画笔颜色设为 <颜色>」——K4 传 "#RRGGBB"（也可能是 0~360 的色相数字）
func 设置画笔颜色(_颜色: Variant) -> void:
	_从颜色更新HSL(_转颜色(_颜色))
	_刷新画笔颜色()

## 「把画笔颜色增加 <值>」（色相偏移，0-360）
func 增加画笔颜色(_值: Variant) -> void:
	k4_笔_h = fposmod(k4_笔_h + _转数值(_值), 360.0)
	_刷新画笔颜色()

## 「把画笔明暗增加 <值>」
## K4 的 self_change_pen_shade → add_brush_brightness（以前**整块没映射**）
## 对应 HSL 的 L 分量
func 增加画笔明暗(_值: Variant) -> void:
	k4_笔_l = clampf(k4_笔_l + _转数值(_值), 0.0, 100.0)
	_刷新画笔颜色()

## 画笔颜色属性的项名 → 归一化。
##
## ★取值来自全量扫描（_dev/probe_pen_fields.js，扫了所有 bcm4）★
##   实测到的 scope：alpha(16 次) / brightness(2) / hue(1)
##   —— 注意是 **alpha** 而不是 transparency，而且 K4 把它当 HSL 的**亮度**叫 brightness。
func _画笔属性项(_项: Variant) -> String:
	match str(_项).strip_edges().to_lower():
		"hue", "色相", "颜色", "颜色值":
			return "hue"
		"saturation", "饱和度", "饱和":
			return "saturation"
		"brightness", "lightness", "value", "亮度", "明度", "明暗":
			return "brightness"
		"alpha", "transparency", "透明度", "不透明度":
			return "alpha"
	return ""

## 「把画笔 <属性> 设为 <值>」
## K4 的 self_set_pen_color_property → set_color_property(scope, val)
## ⚠ 这个块以前**整块没映射**，掉成了"参数没解析出来"的类型层桩 ——
##   用户的测试例「画笔和嵌套循环测试」里那个 `self_set_pen_color_property`
##   就是它（每轮循环都调一次，颜色却一直不变，整条曲线纯红）。
func 设置画笔颜色属性(_属性: Variant, _值: Variant) -> void:
	var 项 := _画笔属性项(_属性)
	if 项 == "":
		_桩提醒("设置画笔颜色属性：认不出的属性项「" + str(_属性) + "」")
		return
	var v := _转数值(_值)
	match 项:
		"hue":
			k4_笔_h = fposmod(v, 360.0)
		"saturation":
			k4_笔_s = clampf(v, 0.0, 100.0)
		"brightness":
			k4_笔_l = clampf(v, 0.0, 100.0)
		"alpha":
			k4_笔_a = clampf(v, 0.0, 100.0)
	_刷新画笔颜色()

## 「将画笔 <属性> [增加/减少] <值>」
## K4 的 self_change_pen_color_property → change_color_property(scope, steps)
##
## ⚠ 两个坑：
##   ① 它以前被错映射成 pen_change_color，和「增加画笔颜色」**抢了同一个签名**，
##      结果 scope 被截掉、只剩一个增量（色相偏移）。
##   ② K4 把加减号放在 **increase 字段**里（increase / decrease），值一律正数 ——
##      和「把 <特效> 增加 <值>」那一块完全一样。
func 增加画笔颜色属性(_属性: Variant, _符号: Variant, _值: Variant) -> void:
	var 项 := _画笔属性项(_属性)
	if 项 == "":
		_桩提醒("增加画笔颜色属性：认不出的属性项「" + str(_属性) + "」")
		return
	var 减 := str(_符号).to_lower().find("decrease") >= 0 or str(_符号).find("减") >= 0
	var v := _转数值(_值) * (-1.0 if 减 else 1.0)
	match 项:
		"hue":
			k4_笔_h = fposmod(k4_笔_h + v, 360.0)
		"saturation":
			k4_笔_s = clampf(k4_笔_s + v, 0.0, 100.0)
		"brightness":
			k4_笔_l = clampf(k4_笔_l + v, 0.0, 100.0)
		"alpha":
			k4_笔_a = clampf(k4_笔_a + v, 0.0, 100.0)
	_刷新画笔颜色()

## 「把画笔粗细设为 <值>」
func 设置画笔粗细(_值: Variant) -> void:
	k4_pen_size = maxf(0.0, _转数值(_值))
	K4Canvas.设置画笔粗细(k4_pen_size)

## 「把画笔粗细增加 <值>」
func 增加画笔粗细(_值: Variant) -> void:
	设置画笔粗细(k4_pen_size + _转数值(_值))

## 「图章」/「图片图章（角色印章）」：把当前造型印到画布上
##
## ★语义（用户明确过，和 K4/Scratch 的印章一致）★
##   · 印章是"盖上去的一层像素" —— **不会跟着角色动**（角色再移动，印子留在原地）
##   · 只继承角色的**长宽**（= K4 的「大小」），**不继承角色的旋转**
##   · **不继承角色身上的任何特效 / 透明度**，用的是**原纹理的颜色**
##   实现上只把「纹理 + 位置 + 缩放」交给画笔层；画笔层自己没有角色的
##   modulate / 色相特效，`draw_texture` 用默认白色调制 —— 所以天然就是原纹理色。
func 图章() -> void:
	var 纹 := 当前纹理()
	if 纹 == null:
		return
	var 缩 := Vector2(absf(scale.x), absf(scale.y))
	var 变 := Transform2D(0.0, 缩, 0.0, k4到舞台(Vector2(k4_x, k4_y)))
	K4Canvas.图章(纹, 变)

## 「文字图章 <文本> <字号>」——K4 原文是「图章 <文本> <字号>」带一个对齐下拉框
##
## ★和图片印章的区别（用户明确过）★
##   · **旋转继承调用它的那个角色** —— 角色转到哪，字就转到哪
##   · 颜色用**该角色自己的画笔颜色**（每个角色一份，互相独立）
##   · 图片印章则相反：不继承旋转、不继承特效、用原纹理色
##
## ★_对齐★ 来自 K4 的 fields.align（"left" / "center" / "right"，
##   实测 18 个样本里 left 与 center 都出现过）。以前没读这个字段，
##   于是所有文字图章都按"居中"画 —— 左对齐的排版全是错的。
func 文字图章(_文本: Variant, _字号: Variant, _对齐: Variant = "center") -> void:
	var 画布: Node = K4Canvas.取画布()
	if 画布 == null or not 画布.has_method("文字图章"):
		_桩提醒("文字图章：画布还没有『文字图章』方法")
		return
	画布.call("文字图章", str(_文本), k4到舞台(Vector2(k4_x, k4_y)),
		_转数值(_字号), k4_pen_color, rotation, str(_对齐).to_lower())

## 「图片图章」——和 图章() 是同一件事（core.js 已把它直接映射到 pen_stamp）。
## 保留这个入口是为了兼容"映射表还没更新"的手工调用。
func 图片图章(_参数: Variant) -> void:
	图章()

## 「设置填充 <颜色>」
func 设置填充样式(_参数: Variant) -> void:
	K4Canvas.设置填充样式(_转颜色(_参数))

## 「设置填充 <颜色>」的别名（core.js 映射的是 fill_style → 设置填充）
func 设置填充(_颜色: Variant) -> void:
	设置填充样式(_颜色)

## 「设置当前为填充 <起点 / 终点>」
## K4 的 `set_pen_path`（field point = start_point / end_point）→ begin_path / close_path。
## 起点：开始记录路径点（之后角色每移动一次记一个，**不需要落笔**）；
## 终点：闭合多边形并用填充色填上。
## ⚠ 这两个块以前**整块没映射**，所以"设置填充"这条路完全走不通。
func 设置填充路径(_点: Variant) -> void:
	var s := str(_点).to_lower()
	var 起 := s.find("start") >= 0 or s.find("起") >= 0
	K4Canvas.填充路径("start_point" if 起 else "end_point")
	if 起:
		# 起点这一刻的位置就是第一个路径点
		K4Canvas.路径加点(k4到舞台(Vector2(k4_x, k4_y)))

## 「设置画笔路径」——K4 的老块（记录型指令），保留兼容
func 设置画笔路径(_参数: Variant) -> void:
	K4Canvas.设置画笔路径(str(_参数))

# 注：「设置画笔颜色属性」的真实现已挪到上面的 pen 段（和 增加画笔颜色 / 增加画笔明暗 放一起）。
#     这里以前是一个"参数没解析出来"的桩，会和真实现**同名冲突**，已删除。


# =============================================================================
# data —— 数据（★列表全部按 K4 的 1-based 语义★）
# =============================================================================

## 取列表的"第 n 项"下标（0-based）。越界返回 -1。
## 方式 first = 从头数，last = 从尾数。
func _下标(_列表: Variant, _方式: Variant, _序号: Variant) -> int:
	if not (_列表 is Array):
		return -1
	var a: Array = _列表
	var n := int(_转数值(_序号))
	if str(_方式).to_lower() == "last":
		n = a.size() - n + 1
	# K4 从 1 开始
	var i := n - 1
	if i < 0 or i >= a.size():
		return -1
	return i

## 「列表 <列表> 的 <方式> <序号> 项」（取值）
func 列表取值_特殊(_列表: Variant, _方式: Variant, _序号: Variant) -> Variant:
	var i := _下标(_列表, _方式, _序号)
	if i < 0:
		return ""
	return (_列表 as Array)[i]

## 「列表 <列表> 的第 <序号> 项」（旧的取值形态，同样是 1-based）
func 列表第几项的值(_列表: Variant, _序号: Variant) -> Variant:
	return 列表取值_特殊(_列表, "first", _序号)

## 「删除列表 <列表> 的 <方式> <序号> 项 / 全部」
func 列表删除_特殊(_列表: Variant, _方式: Variant, _序号: Variant) -> void:
	if not (_列表 is Array):
		return
	var a: Array = _列表
	if str(_方式).to_lower() == "all":
		a.clear()
		return
	var i := _下标(a, _方式, _序号)
	if i >= 0:
		a.remove_at(i)

## 「删除列表 <列表> 的第 <序号> 项」
func 列表删除(_列表: Variant, _序号: Variant) -> void:
	列表删除_特殊(_列表, "first", _序号)

## 「把列表 <列表> 的 <方式> <序号> 项替换成 <值>」
func 列表替换(_列表: Variant, _方式: Variant, _序号: Variant, _值: Variant) -> void:
	var i := _下标(_列表, _方式, _序号)
	if i < 0:
		return
	var a: Array = _列表
	a[i] = _值

## 「在列表 <列表> 的第 <序号> 项前插入 <值>」
func 列表插入(_列表: Variant, _序号: Variant, _值: Variant) -> void:
	if not (_列表 is Array):
		return
	var a: Array = _列表
	var i := int(_转数值(_序号)) - 1        # 1-based
	if i < 0:
		i = 0
	if i > a.size():
		i = a.size()
	a.insert(i, _值)

## 「把 <值> 加入列表 <列表>」（加到末尾）
func 列表添加(_列表: Variant, _值: Variant) -> void:
	if not (_列表 is Array):
		return
	var a: Array = _列表
	a.append(_值)

## 「删除列表 <列表> 的全部项」
func 列表清空(_列表: Variant) -> void:
	if not (_列表 is Array):
		return
	var a: Array = _列表
	a.clear()

## 「列表 <列表> 的长度」
func 列表长度(_列表: Variant) -> float:
	return float((_列表 as Array).size()) if _列表 is Array else 0.0

## 「列表 <列表> 是否为空」
func 列表是否为空(_列表: Variant) -> bool:
	return (_列表 as Array).is_empty() if _列表 is Array else true

## 「列表 <列表> 是否包含 <值>」
func 列表包含(_列表: Variant, _值: Variant) -> bool:
	return (_列表 as Array).has(_值) if _列表 is Array else false

## 「<值> 在列表 <列表> 中的位置」——**1-based**，找不到返回 0
func 列表第几项(_列表: Variant, _值: Variant) -> float:
	if not (_列表 is Array):
		return 0.0
	var i: int = (_列表 as Array).find(_值)
	return float(i + 1) if i >= 0 else 0.0

## 「<值> 在列表 <列表> 中的位置」（同义词）
func 列表项序号(_列表: Variant, _值: Variant) -> float:
	return 列表第几项(_列表, _值)

## 「<值> 在列表 <列表> 中**最后**出现的位置」——**1-based**，找不到返回 0
func 列表最后位置(_列表: Variant, _值: Variant) -> float:
	if not (_列表 is Array):
		return 0.0
	var a: Array = _列表
	var i := a.rfind(_值)
	return float(i + 1) if i >= 0 else 0.0

# -----------------------------------------------------------------------------
# 变量
# -----------------------------------------------------------------------------
## 「把变量 <名> 设为 <值>」——传进来的名是**生成后的成员名**（v_xxx / K4Global.v_xxx 已在调用点解析）
## 这里兜底处理：名字对得上就按成员走，对不上就当全局名。
func 设置变量(_名: Variant, _值: Variant) -> void:
	var 名 := str(_名)
	if 名.begins_with("v_") or 名.begins_with("l_"):
		set(名, _值)
	else:
		K4Global.设置(名, _值)

## 「把变量 <名> 增加 <值>」
func 增加变量(_名: Variant, _值: Variant) -> void:
	var 名 := str(_名)
	var 旧: Variant = get(名) if (名.begins_with("v_") or 名.begins_with("l_")) else K4Global.取值(名)
	var 新 = 算术运算("add", 旧, _值)
	if 名.begins_with("v_") or 名.begins_with("l_"):
		set(名, 新)
	else:
		K4Global.设置(名, 新)

# -----------------------------------------------------------------------------
# 云变量 / 云列表 —— 本地持久化版本
# -----------------------------------------------------------------------------
# ⚠ K4 的云变量是联网的（跨设备同步）。这里做成 user:// 存 JSON：
#   语义上"存得住"，但不会和别人共享。要真联网就换成 HTTPRequest。
const _云存档 := "user://k4_cloud.json"

static var _云: Dictionary = {}
static var _云已载: bool = false

func _云加载() -> void:
	if _云已载:
		return
	_云已载 = true
	if FileAccess.file_exists(_云存档):
		var f := FileAccess.open(_云存档, FileAccess.READ)
		if f != null:
			var t := f.get_as_text()
			f.close()
			var d = JSON.parse_string(t)
			if d is Dictionary:
				_云 = d

func _云存盘() -> void:
	var f := FileAccess.open(_云存档, FileAccess.WRITE)
	if f == null:
		return
	f.store_string(JSON.stringify(_云))
	f.close()

## 「云变量 <名>」
func 云变量取值(_名: Variant) -> Variant:
	_云加载()
	return _云.get(str(_名), 0.0)

## 「把云变量 <名> 设为 <值>」
func 云变量设置(_名: Variant, _值: Variant) -> void:
	_云加载()
	_云[str(_名)] = _值
	_云存盘()

## 「把云变量 <名> 增加 <值>」
func 云变量增加(_名: Variant, _值: Variant) -> void:
	_云加载()
	var 名 := str(_名)
	_云[名] = 算术运算("add", _云.get(名, 0.0), _值)
	_云存盘()

## 桩块
func 设置云变量(_参数: Variant) -> void:
	_桩提醒("设置云变量：参数没解析出来，请改用 云变量设置()")

## 「云列表 <名>」
func 云列表(_名: Variant) -> Array:
	_云加载()
	var 名 := str(_名)
	if not (_云.get(名) is Array):
		_云[名] = []
	return _云[名]

## 「把 <值> 加入云列表 <名>」
func 云列表添加(_名: Variant, _值: Variant) -> void:
	var a := 云列表(_名)
	a.append(_值)
	_云存盘()

# ── 云列表的其余操作（同一份 user:// 存档，全部落盘）─────────────────────────

## 「云列表 <名> 的第 <n> 项 / 最后一项」——取值
##   实测 K4 的 fields.TYPE = "nth" | "last"，序号输入名是 INDEX（从 1 开始）
func 云列表第几项(_名: Variant, _类型: Variant, _序号: Variant) -> Variant:
	var a := 云列表(_名)
	if a.is_empty():
		return 0.0
	var i := _云列表下标(_类型, _序号, a.size())
	return a[i] if (i >= 0 and i < a.size()) else 0.0

## 「插入 <值> 到 云列表 的第 <n> 项」
##   ⚠ 以前这个块和"添加到末尾"共用同一个分支 → 选第 4 项也永远插在最后
func 云列表插入(_名: Variant, _序号: Variant, _值: Variant) -> void:
	var a := 云列表(_名)
	var i := clampi(int(roundf(_转数值(_序号))) - 1, 0, a.size())
	a.insert(i, _值)
	_云存盘()

## 「删除 云列表 的 <第 n 项 / 最后一项 / 所有项>」
func 云列表删除(_名: Variant, _类型: Variant, _序号: Variant) -> void:
	var a := 云列表(_名)
	if a.is_empty():
		return
	var t := str(_类型).to_lower()
	if t == "all" or t == "所有" or t == "所有项" or t == "全部":
		a.clear()
	else:
		var i := _云列表下标(_类型, _序号, a.size())
		if i >= 0 and i < a.size():
			a.remove_at(i)
	_云存盘()

## 「替换 云列表 的 <第 n 项 / 最后一项> 为 <值>」
func 云列表替换(_名: Variant, _类型: Variant, _序号: Variant, _值: Variant) -> void:
	var a := 云列表(_名)
	if a.is_empty():
		return
	var i := _云列表下标(_类型, _序号, a.size())
	if i >= 0 and i < a.size():
		a[i] = _值
	_云存盘()

## (类型, 序号) -> 0 基下标；last = 最后一项，序号从 1 开始（K4 语义）
func _云列表下标(_类型: Variant, _序号: Variant, _长度: int) -> int:
	var t := str(_类型).to_lower()
	if t == "last" or t == "最后" or t == "最后一项":
		return _长度 - 1
	return clampi(int(roundf(_转数值(_序号))) - 1, 0, maxi(0, _长度 - 1))

# ── 变量 / 列表 / 排行榜 的「显示监视器」────────────────────────────────────
#   K4 会在舞台角落画出变量和列表的实时值。这里记录开关状态；
#   要真的画出来，读 k4_变量显示 / k4_列表显示 / k4_排行榜显示 自己搭个 UI 即可。

## 「显示 / 隐藏 变量 <名>」（云变量也走这条）
func 显示隐藏变量(_名: Variant, _开关: Variant) -> void:
	k4_变量显示[str(_名)] = _是显示(_开关)

## 「显示 / 隐藏 列表」
func 显示隐藏列表(_名: Variant, _开关: Variant) -> void:
	k4_列表显示[str(_名)] = _是显示(_开关)

## 「显示排行榜」——K4 的排行榜就是**某个云变量**的展示
func 显示排行榜(_名: Variant) -> void:
	k4_排行榜 = str(_名)
	k4_排行榜显示 = true

## 「隐藏排行榜」
func 隐藏排行榜() -> void:
	k4_排行榜显示 = false

## 「排行榜 <show / hide> 是否显示着」
func 排行榜是否显示(_项: Variant) -> bool:
	var 想 := str(_项).to_lower()
	var 应是 := 想.find("show") >= 0 or 想.find("显示") >= 0
	return k4_排行榜显示 == 应是

func _是显示(_开关: Variant) -> bool:
	var s := str(_开关).to_lower()
	if s.find("hide") >= 0 or s.find("隐藏") >= 0 or s == "false" or s == "0":
		return false
	return true

# ── 用户 / 设备（K4 是联网云平台，这里全部本地化）─────────────────────────────

## 「用户名」—— 本地化：固定一个名字。想接真实账号就在 角色类.gd 覆写
func 用户名() -> String:
	return k4_用户名

## 「用户ID」
func 用户ID() -> String:
	return k4_用户ID

## 「在线用户数」—— 单机恒为 1（联机才有多人）
func 在线用户数() -> float:
	return 1.0

## 「运行设备」—— 返回 "mobile" / "pc"
func 运行设备() -> String:
	if OS.has_feature("mobile") or OS.has_feature("android") or OS.has_feature("ios"):
		return "mobile"
	return "pc"

## 「运行设备为 <手机 / 电脑>」
##   实测 K4 的 fields.device = "mobile"（还有 pc 一类）
func 运行设备为(_设备: Variant) -> bool:
	var d := str(_设备).to_lower()
	if d.find("mobile") >= 0 or d.find("手机") >= 0 or d.find("android") >= 0 or d.find("ios") >= 0:
		return 运行设备() == "mobile"
	if d.find("pc") >= 0 or d.find("电脑") >= 0 or d.find("computer") >= 0:
		return 运行设备() == "pc"
	return false


# =============================================================================
# operator —— 运算
# =============================================================================

## 「<a> 除以 <b> 的余数」——K4/Scratch 的结果符号**跟随除数**
func 取余(_a: Variant, _b: Variant) -> Variant:
	var x := _转数值(_a)
	var y := _转数值(_b)
	if y == 0.0:
		return 0.0
	var r := fmod(x, y)
	if r != 0.0 and ((r < 0.0) != (y < 0.0)):
		r += y
	return r

## 「<a> 是 <b> 的倍数吗」
func 是倍数(_a: Variant, _b: Variant) -> bool:
	var y := _转数值(_b)
	if y == 0.0:
		return false
	return is_zero_approx(fmod(_转数值(_a), y))

## 「取整 <模式> <值>」
##   round_round     = 四舍五入
##   round_rounddown = 向下取整（floor）
##   round_roundup   = 向上取整（ceiling）
func 取整(_模式: Variant, _值: Variant) -> float:
	var v := _转数值(_值)
	match str(_模式).to_lower():
		"round_round", "round", "四舍五入":
			return roundf(v)
		"round_rounddown", "rounddown", "floor", "向下取整":
			return floorf(v)
		"round_roundup", "roundup", "ceiling", "向上取整":
			return ceilf(v)
	return roundf(v)

## 「<函数> <值>」——数学函数
func 数学函数(_函数: Variant, _值: Variant) -> float:
	var v := _转数值(_值)
	match str(_函数).to_lower():
		"abs", "绝对值":
			return absf(v)
		"floor", "向下取整":
			return floorf(v)
		"ceiling", "ceil", "向上取整":
			return ceilf(v)
		"sqrt", "平方根":
			return sqrt(maxf(0.0, v))
		"sin":
			return sin(deg_to_rad(v))
		"cos":
			return cos(deg_to_rad(v))
		"tan":
			return tan(deg_to_rad(v))
		"asin":
			return rad_to_deg(asin(clampf(v, -1.0, 1.0)))
		"acos":
			return rad_to_deg(acos(clampf(v, -1.0, 1.0)))
		"atan":
			return rad_to_deg(atan(v))
		"ln", "log":
			return log(v) if v > 0.0 else 0.0
		"log10":
			return log(v) / log(10.0) if v > 0.0 else 0.0
		"e^", "exp":
			return exp(v)
		"10^", "pow10":
			return pow(10.0, v)
		"pow", "幂":
			return pow(v, 2.0)
	return 0.0

## 「<函数> <值>」——三角函数（K4 用**度**）
func 三角函数(_函数: Variant, _值: Variant) -> float:
	var v := _转数值(_值)
	match str(_函数).to_lower():
		"sin":
			return sin(deg_to_rad(v))
		"cos":
			return cos(deg_to_rad(v))
		"tan":
			return tan(deg_to_rad(v))
	return 0.0

## 「<值> 的 <次> 次方根」
func 开方(_值: Variant, _次: Variant) -> float:
	var v := _转数值(_值)
	var n := _转数值(_次)
	if n == 0.0:
		return 0.0
	if v < 0.0 and absf(fmod(n, 2.0)) == 1.0:
		return -pow(-v, 1.0 / n)     # 奇次根，负数的解
	return pow(maxf(0.0, v), 1.0 / n)

## 「<属性> <值>」——数学属性判断
func 数学属性(_属性: Variant, _值: Variant) -> bool:
	var v := _转数值(_值)
	match str(_属性).to_lower():
		"even", "偶数":
			return is_zero_approx(fmod(v, 2.0))
		"odd", "奇数":
			return not is_zero_approx(fmod(v, 2.0))
		"prime", "质数":
			var n := int(v)
			if n < 2:
				return false
			var i := 2
			while i * i <= n:
				if n % i == 0:
					return false
				i += 1
			return true
		"whole", "整数":
			return is_equal_approx(v, roundf(v))
		"positive", "正数":
			return v > 0.0
		"negative", "负数":
			return v < 0.0
		"zero", "零":
			return is_zero_approx(v)
	return false

## 「<值> 是 <正数 / 负数 / 零>」
func 是否判断(_属性: Variant, _值: Variant) -> bool:
	return 数学属性(_属性, _值)

## 「<值> 不成立」（逻辑非）
func 不成立(_值: Variant) -> bool:
	return not 为真(_值)

## 「<值> 取反」——数值取负
func 取反(_值: Variant) -> float:
	return -_转数值(_值)

## 「<运算符> <a> <b>」——逻辑运算
func 逻辑运算(_运算符: Variant, _a: Variant, _b: Variant) -> bool:
	match str(_运算符).to_lower():
		"and", "与":
			return 为真(_a) and 为真(_b)
		"or", "或":
			return 为真(_a) or 为真(_b)
	return false

## 「<值> 是空的吗」
func 空判断(_值: Variant) -> bool:
	if _值 == null:
		return true
	if _值 is String:
		return (_值 as String).strip_edges() == ""
	if _值 is Array:
		return (_值 as Array).is_empty()
	if _值 is float or _值 is int:
		return is_zero_approx(_转数值(_值))
	return false

# -----------------------------------------------------------------------------
# 文本（★全部 1-based★）
# -----------------------------------------------------------------------------

## 「连接 <a> <b>」（把两个值拼起来）
func 连接(_a: Variant, _b: Variant) -> String:
	return str(_a) + str(_b)

## 「连接_续 <a> <b>」（K4 的追加型连接，语义同 连接）
func 连接_续(_a: Variant, _b: Variant) -> String:
	return str(_a) + str(_b)

## 「<文本> 的字符数」
func 文本长度(_文本: Variant) -> float:
	return float(str(_文本).length())

## 「<文本> 是空的吗」
func 文本是否为空(_文本: Variant) -> bool:
	return str(_文本).is_empty()

## 「<文本> 包含 <子串> 吗」
func 文本包含(_文本: Variant, _子串: Variant) -> bool:
	return str(_文本).find(str(_子串)) >= 0

## 「<文本> 的第 <序号> 个字符」——**1-based**，越界返回 ""
func 文本取字符(_文本: Variant, _序号: Variant) -> String:
	var s := str(_文本)
	var i := int(_转数值(_序号)) - 1
	if i < 0 or i >= s.length():
		return ""
	return s[i]

## 「<值> 在 <文本> 中第几个字符」——**1-based**，找不到返回 0
func 文本第几个字符(_文本: Variant, _值: Variant) -> float:
	var i := str(_文本).find(str(_值))
	return float(i + 1) if i >= 0 else 0.0

## 「<值> 在 <文本> 中最后出现的位置」——**1-based**，找不到返回 0
func 文本最后位置(_文本: Variant, _值: Variant) -> float:
	var i := str(_文本).rfind(str(_值))
	return float(i + 1) if i >= 0 else 0.0

## 「<文本> 的第 <起> 到第 <止> 个字符」（含两端，1-based）
func 文本截取(_文本: Variant, _起: Variant, _止: Variant) -> String:
	var s := str(_文本)
	var a := int(_转数值(_起))
	var b := int(_转数值(_止))
	if a > b:
		var t := a
		a = b
		b = t
	if a < 1:
		a = 1
	if b > s.length():
		b = s.length()
	if a > s.length() or b < 1:
		return ""
	return s.substr(a - 1, b - a + 1)

## 「<文本> 的 <大写 / 小写>」
func 文本大小写(_模式: Variant, _文本: Variant) -> String:
	match str(_模式).to_lower():
		"upper", "uppercase", "大写":
			return str(_文本).to_upper()
		"lower", "lowercase", "小写":
			return str(_文本).to_lower()
	return str(_文本)

## 「去掉 <文本> 两端的空格」
func 去除空格(_文本: Variant) -> String:
	return str(_文本).strip_edges()

## 「把 <文本> 按 <分隔符> 分开成列表」
##
## ★K4 的特性：分开之后每一项会**尝试转成数值**★
##   这就是为什么 K4 的列表监视器里显示的是数字而不是字符串，
##   也是 `"000,3e5,abc"` 分出来得到 `[0, 300000.0, "abc"]` 的原因。
##   只转**数值** —— `"true"` / `"false"` 不会变成 bool，仍然是字符串。
##
##   这条规则对下游影响很大：列表里存的是数字而不是字符串之后，
##   它参与算术/比较就不会撞上 GDScript 的
##   `Invalid operands 'String' and 'float'`。
##   （另一半保障是 `角色.转数字()` / `角色.比较()` —— 两边都要有。）
func 文本分割(_文本: Variant, _分隔符: Variant) -> Array:
	var 分 := str(_分隔符)
	var 出: Array = []
	if 分 == "":
		# K4 里分隔符为空 = 每个字符一项
		var s0 := str(_文本)
		for i in s0.length():
			出.append(_分割项转值(s0[i]))
		return 出
	for 项 in str(_文本).split(分):
		出.append(_分割项转值(项))
	return 出

## 分割出来的一项 -> 值。
## 判定用正则而不是 String.is_valid_float()：后者对 "3e" 这种半截指数会
## 给出 true、但 to_float() 得 0，于是 "3e" 被静默吃成 0；
## 而 K4（JS）里 Number("3e") 是 NaN —— 应该原样保留字符串。
## 这个正则就是 JS 数字字面量那一套：可选符号 + (数字[.数字] | .数字) + 可选指数。
static var _数字正则: RegEx = null

func _分割项转值(_s: String) -> Variant:
	var t := _s.strip_edges()
	if t.is_empty():
		return _s
	if _数字正则 == null:
		_数字正则 = RegEx.new()
		_数字正则.compile("^[+-]?([0-9]+\\.?[0-9]*|\\.[0-9]+)([eE][+-]?[0-9]+)?$")
	if _数字正则.search(t) == null:
		return _s
	return t.to_float()

## 「把 <值> 转成文字」
func 转文本(_值: Variant) -> String:
	if _值 == null:
		return ""
	if _值 is bool:
		return "true" if _值 else "false"
	if _值 is float:
		# K4 里 3.0 要显示成 "3"，别显示成 "3.0"
		var f: float = _值
		if is_equal_approx(f, roundf(f)) and absf(f) < 1e15:
			return str(int(f))
		return str(f)
	return str(_值)

## 「把 <值> 转成数字」
func 转数字(_值: Variant) -> float:
	var n := _转数值(_值)
	return 0.0 if is_nan(n) else n

## 「把 <值> 转成 <类型>」
func 转换类型(_类型: Variant, _值: Variant) -> Variant:
	match str(_类型).to_lower():
		"number", "数字", "float":
			return 转数字(_值)
		"string", "文本", "text":
			return 转文本(_值)
		"boolean", "布尔", "bool":
			return 为真(_值)
	return _值

## 「<起> 到 <止> 之间的随机小数」
func 随机小数(_起: Variant, _止: Variant) -> float:
	var a := _转数值(_起)
	var b := _转数值(_止)
	if a > b:
		var t := a
		a = b
		b = t
	return randf_range(a, b)

## 「<起> 到 <止> 之间的随机整数」——**含两端**（Scratch/K4 语义）
func 随机整数(_起: Variant, _止: Variant) -> float:
	var a := int(roundf(_转数值(_起)))
	var b := int(roundf(_转数值(_止)))
	if a > b:
		var t := a
		a = b
		b = t
	return float(randi_range(a, b))


# =============================================================================
# physics —— 物理（全部未实现）
# =============================================================================
# ❌ K4 的物理是它自带的一套（Box2D 风格）引擎积木，和 Godot 的
#    PhysicsServer2D / RigidBody2D 不是一一对应：
#      · K4 的"角色"同时是视觉对象和刚体，而 Godot 里通常要拆成
#        Node2D（外观）+ RigidBody2D（物理）+ CollisionShape2D（碰撞）
#      · K4 的"角色重力/世界重力/摩擦/弹性/密度/柔韧度"要映射到
#        PhysicsMaterial + RigidBody2D 的一组属性，并且**单位不同**
#      · 更麻烦的是 K4 的坐标系（原点居中、y 向上）和刚体位置要双向同步
#    所以这里全部留桩 —— 需要你自己按具体游戏设计做，不是一个"翻译"能解决的。
#
#    要做的话，建议的落点：
#      1. 给角色场景加一个 RigidBody2D 子节点（freeze = true 起步）
#      2. 启用物理 → freeze = false；关闭物理 → freeze = true
#      3. 位置同步：_physics_process 里把 rigid.global_position 换算回
#         k4_x / k4_y（注意 y 取反），再 角色基类._apply_transform()
#      4. 设置质量/密度/弹性/摩擦 → 对应 RigidBody2D.mass、
#         PhysicsMaterial.friction / bounce、RigidBody2D.gravity_scale
# =============================================================================

func 启用物理(_参数: Variant) -> void:
	_桩提醒("启用物理：未实现（见本文件 physics 一节的说明）")

func 关闭物理(_参数: Variant) -> void:
	_桩提醒("关闭物理：未实现")

func 设置物理类型(_参数: Variant) -> void:
	_桩提醒("设置物理类型：未实现")

func 设置物理贴图(_参数: Variant) -> void:
	_桩提醒("设置物理贴图：未实现")

func 设置物理边界(_参数: Variant) -> void:
	_桩提醒("设置物理边界：未实现")

func 设置碰撞分组(_参数: Variant) -> void:
	_桩提醒("设置碰撞分组：未实现")

func 禁止与_碰撞(_参数: Variant) -> void:
	_桩提醒("禁止与…碰撞：未实现")

func 是否超出边界(_参数: Variant) -> bool:
	return _出界()

func 获取物理属性(_参数: Variant) -> Variant:
	return 0.0

func 设置质量(_参数: Variant) -> void:
	_桩提醒("设置质量：未实现")

func 设置密度(_参数: Variant) -> void:
	_桩提醒("设置密度：未实现")

func 设置弹性(_参数: Variant) -> void:
	_桩提醒("设置弹性：未实现")

func 设置摩擦系数(_参数: Variant) -> void:
	_桩提醒("设置摩擦系数：未实现")

func 设置静摩擦系数(_参数: Variant) -> void:
	_桩提醒("设置静摩擦系数：未实现")

func 设置粗糙度(_参数: Variant) -> void:
	_桩提醒("设置粗糙度：未实现")

func 设置柔韧度(_参数: Variant) -> void:
	_桩提醒("设置柔韧度：未实现")

func 设置空气阻力(_参数: Variant) -> void:
	_桩提醒("设置空气阻力：未实现")

func 设置速度(_参数: Variant) -> void:
	_桩提醒("设置速度：未实现")

func 设置速度向量(_参数: Variant) -> void:
	_桩提醒("设置速度向量：未实现")

func 设置重力(_参数: Variant) -> void:
	_桩提醒("设置重力：未实现")

func 设置角色重力(_参数: Variant) -> void:
	_桩提醒("设置角色重力：未实现")

func 按方向设置重力(_参数: Variant) -> void:
	_桩提醒("按方向设置重力：未实现")

func 启用力(_参数: Variant) -> void:
	_桩提醒("启用力：未实现")

func 施加力(_参数: Variant) -> void:
	_桩提醒("施加力：未实现")

func 启用角度约束(_参数: Variant) -> void:
	_桩提醒("启用角度约束：未实现")

func 允许旋转(_参数: Variant) -> void:
	_桩提醒("允许旋转：未实现（直接写 rotation 是另一回事）")
