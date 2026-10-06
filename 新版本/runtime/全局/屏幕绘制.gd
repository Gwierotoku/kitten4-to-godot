# =============================================================================
# 屏幕绘制.gd  ——  画笔层（挂在屏幕根下面，画在角色后面、背景板前面）
# =============================================================================
#
# 层序（**z_index 定层，树顺序只在同 z 时兜底**）：
#
#     舞台层    z = -100   ← K4 的舞台实体（scene 自己，背景板的造型挂在它身上）
#     屏幕绘制  z =  -50   ← 本节点，画笔层
#     基础角色层 / 克隆体层  z = 0   ← 角色（默认在画笔**之上**）
#
#   正好复现 K4/Scratch 的「舞台背景 → 画笔 → 角色」。
#   角色用「移到画笔图层 下方」(layer_with_pen=below) 时把 z_index 设成 -75，
#   落在"背景板之上、画笔之下"那道夹缝里。
#
#   ⚠ 历史教训（三条，都很隐蔽）：
#     ① 舞台实体以前和普通角色一起塞在 基础角色层 里，于是背景板（一张铺满舞台
#        的图）正好画在画笔上面 → 画笔一直在画（指令涨到 147 条）却一条线都看不见。
#        解决：单独一层 舞台层（z = -100）。
#     ② 本节点曾经把 z_index 设成 -100 想"沉到最底"，结果被压到所有 z_index=0
#        的东西下面 —— 而当时的背景板恰好就是 z = 0，背景又把画笔盖住了。
#        教训：**夹缝取值必须和相邻层错开**，且要知道背景板自己被放在哪一层。
#        现在背景板在 舞台层(-100)，画笔在 -50，两者明确分开了。
#     ③ 本节点曾经保持 z = 0，与角色**同 z** → 只靠树顺序分先后；
#        同 z 时按树顺序（屏幕绘制 排在 基础角色层 前面 → 画笔先画、角色后画），
#        于是「移到画笔图层 下方」当年也取 -50（与画笔同 z）时仍然画在画笔上面。
#        现在三层各有明确槽位，不再依赖树顺序。
#
#   ⚠ `_draw()` 里**不要铺底色**。画笔层是透明的（Scratch 的 pen skin
#     就是一层透明位图）。以前无条件 draw_rect(舞台矩形, 舞台底色) 等于在画笔层上
#     盖了张不透明白纸，把背景板整个盖掉 —— `射击生存` 的"背景图片消失"就是它。
#
# 指令模型：
#   指令 是 Array[Dictionary]，元素形如
#     { "t": "line",  "a": Vector2, "b": Vector2, "c": Color, "w": float }
#     { "t": "stamp", "tex": Texture2D, "xform": Transform2D }
#     { "t": "text",  "s": String, "p": Vector2, "z": float, "c": Color }
#     { "t": "fill",  "c": Color }
#     { "t": "path",  "点": String }
#   同一帧内多次指令 → 只 queue_redraw() 一次（_脏 标志，在 _process 里消费）。
#
# -----------------------------------------------------------------------------
# 【烘焙】指令数组只增不减，所以要定期把它烧成一张位图底图
# -----------------------------------------------------------------------------
#   K4/Scratch 的画笔是**直接画进位图**的，没有"指令越来越多"这回事；
#   我们为了清晰和可擦除用的是矢量指令重放 —— 代价是画几万条线之后
#   内存和每帧 _draw() 的耗时都线性上涨。
#
#   做法：借一个离屏 SubViewport，把「当前底图 + 全部指令」重画一遍，
#   把结果取回来当新底图，然后清空指令。
#     · SubViewport 的纹理要等这一帧**真正渲染完**才拿得到 → await RenderingServer.frame_post_draw
#     · 烘焙期间新来的指令照常 append 到 指令 里（不会丢）
#     · 烘焙完成后 `指令 = []` 换的是一个**新数组**，画布调度那边是靠
#       `画布.落笔(...)` 进方法的，所以不会拿到旧引用。
# =============================================================================

extends Node2D


# -----------------------------------------------------------------------------
# 内部类：烘焙用的离屏重绘器
# -----------------------------------------------------------------------------
# 必须定义在**用到它的成员变量之前**（GDScript 解析类型注解时要先看到它）。
class 烘焙器 extends Node2D:
	var 底图: Texture2D = null
	var 待画: Array = []

	func _draw() -> void:
		if 底图 != null:
			draw_texture(底图, Vector2.ZERO)
		for 项 in 待画:
			var t: String = str(项.get("t", ""))
			if t == "line":
				draw_line(项["a"], 项["b"], 项["c"], 项["w"])
			elif t == "stamp":
				var 纹: Texture2D = 项["tex"]
				var 变: Transform2D = 项["xform"]
				draw_set_transform(变.origin, 0.0, Vector2(变.x.length(), 变.y.length()))
				draw_texture(纹, Vector2(-纹.get_width() * 0.5, -纹.get_height() * 0.5))
				draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
			elif t == "text":
				var 位: Vector2 = 项["p"]
				# ★draw_string 的 font_size 必须 > 0★，否则 Godot 每帧刷
				#   `ERROR: Condition "p_size <= 0" is true`（实测见 _dev/_run_空白作品.log）。
				#   K4 里字号 ≤ 0 本来也就是"画不出来"，直接跳过。
				var 号 := int(roundf(float(项.get("z", 0.0))))
				if 号 <= 0:
					continue
				var 转: float = 项.get("r", 0.0)
				if is_zero_approx(转):
					draw_string(ThemeDB.fallback_font, 位, 项["s"],
						HORIZONTAL_ALIGNMENT_LEFT, -1, 号, 项["c"])
				else:
					draw_set_transform(位, 转, Vector2.ONE)
					draw_string(ThemeDB.fallback_font, Vector2.ZERO, 项["s"],
						HORIZONTAL_ALIGNMENT_LEFT, -1, 号, 项["c"])
					draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
			elif t == "fill":
				draw_rect(Rect2(Vector2.ZERO, get_viewport_rect().size), 项["c"], true)
			elif t == "fillpath":
				draw_colored_polygon(项["pts"], 项["c"])


var 指令: Array[Dictionary] = []

var _脏: bool = false
var _落笔中: bool = false
var _当前颜色: Color = Color.BLACK
var _当前粗细: float = 1.0
var _填充样式: Color = Color.WHITE
var _画笔路径: String = ""
var _舞台底色: Color = Color.WHITE

# 烘焙（见文件头）
const 烘焙阈值 := 1200
var _底图: ImageTexture = null
var _烘焙中: bool = false
var _烘焙视口: SubViewport = null
var _烘焙器: 烘焙器 = null


# -----------------------------------------------------------------------------
# 生命周期
# -----------------------------------------------------------------------------
func _ready() -> void:
	# ★用 z_index 把画笔层钉在"舞台背景之上、角色之下"这一层★
	#   舞台层   z = -100（背景实体）
	#   屏幕绘制 z =  -50（← 本节点，画笔）
	#   基础角色层 / 克隆体层 z = 0（角色）
	#   角色用「移到画笔图层 下方」时把自己设成 -75（落在背景与画笔之间）。
	#   ⚠ 这里以前是 0，和角色同为 0 → 只能靠**树顺序**分先后；
	#     而「移到画笔图层 下方」当年也取 -50，和画笔层同 z —— 于是 below
	#     仍然画在画笔上面（同 z 时按树顺序，屏幕绘制排在角色层之前）。
	#     给它一个明确的夹缝槽位之后，三层的相对关系不再依赖树顺序。
	z_index = -50
	position = Vector2.ZERO
	scale = Vector2.ONE
	_舞台底色 = _取舞台色()
	_填充样式 = _舞台底色
	get_viewport().size_changed.connect(_尺寸变了)
	_脏 = true

func _尺寸变了() -> void:
	# 舞台尺寸变了，烘焙出来的底图就不再对齐了 —— 直接丢掉重来
	if _底图 != null:
		_底图 = null
	if _烘焙视口 != null and is_instance_valid(_烘焙视口):
		_烘焙视口.size = Vector2i(舞台矩形().size)
	_脏 = true

# 舞台矩形 = 整个视口（视口尺寸就是 K4 舞台尺寸，见文件头）
func 舞台矩形() -> Rect2:
	return Rect2(Vector2.ZERO, get_viewport_rect().size)

func _取舞台色() -> Color:
	# 屏幕根节点（父节点）若有 舞台底色 属性就用它，否则白底
	var 屏 := get_parent()
	if 屏 != null and 屏.get("舞台底色") != null:
		var c = 屏.get("舞台底色")
		if c is Color:
			return c
	return Color.WHITE


# -----------------------------------------------------------------------------
# 对外指令接口（画布调度.gd 转发到这里）
# -----------------------------------------------------------------------------
func 落笔(_起点: Vector2, _终点: Vector2, _颜色: Color, _粗细: float) -> void:
	_当前颜色 = _颜色
	_当前粗细 = _粗细
	指令.append({ "t": "line", "a": _起点, "b": _终点, "c": _颜色, "w": _粗细 })
	_脏 = true

func 抬笔() -> void:
	_落笔中 = false

## 「全部擦除」——只清画笔画的东西，**不碰舞台背景**
func 全部擦除() -> void:
	指令.clear()
	_底图 = null          # 连烘焙好的底图一起擦掉
	_落笔中 = false
	_脏 = true

func 设置画笔颜色(_颜色: Color) -> void:
	_当前颜色 = _颜色

func 设置画笔粗细(_粗细: float) -> void:
	_当前粗细 = _粗细

## 「图章 / 角色印章」：把一张纹理按变换印上去。
## ⚠ 这里刻意**不接收角色身上的 modulate/特效** —— K4 的印章用的是**原纹理的颜色**，
##   所以调用方（自带积木.图章）只传纹理和「位置 + 长宽」两件事。
func 图章(_纹理: Texture2D, _变换: Transform2D) -> void:
	if _纹理 == null:
		return
	指令.append({ "t": "stamp", "tex": _纹理, "xform": _变换 })
	_脏 = true

## 「文字图章 <文本> <字号>」
## ⚠ 旋转跟着**调用它的那个角色**走（K4 语义）—— 角色转到哪，字就转到哪。
##   颜色则由调用方传进来（= 该角色自己的画笔颜色，每个角色一份）。
## ★_对齐★ = K4 的 fields.align（left / center / right）。
##   用 draw_string 的 HORIZONTAL_ALIGNMENT_* 表达：Godot 会以 p_position 为
##   左/中/右基准排版，与 K4 下拉框的三种语义一一对应。
func 文字图章(_文本: String, _位置: Vector2, _字号: float, _颜色: Color,
		_旋转: float = 0.0, _对齐: String = "center") -> void:
	指令.append({ "t": "text", "s": _文本, "p": _位置, "z": _字号,
		"c": _颜色, "r": _旋转, "a": _对齐 })
	_脏 = true

func 设置填充样式(_颜色: Color) -> void:
	_填充样式 = _颜色
	_脏 = true

# -----------------------------------------------------------------------------
# 填充多边形（K4 的「设置当前为填充 起点 / 终点」）
# -----------------------------------------------------------------------------
# K4 的这条路是 turtle 风格的：
#   「设置当前为填充 起点」→ begin_path()：开始记录路径点
#   之后角色每次移动，路径上就多一个点（不需要落笔！）
#   「设置当前为填充 终点」→ close_path()：闭合 + 用填充色填上
# ⚠ 以前这两个块**整块没映射**（掉成"设置画笔路径"的桩），所以填充完全走不通。
var _路径中: bool = false
var _路径点: PackedVector2Array = PackedVector2Array()

func 填充路径(_点: String) -> void:
	if _点 == "start_point":
		_路径中 = true
		_路径点 = PackedVector2Array()
	else:
		if _路径中 and _路径点.size() >= 3:
			指令.append({ "t": "fillpath", "pts": _路径点, "c": _填充样式 })
		_路径中 = false
		_路径点 = PackedVector2Array()
	_脏 = true

func 路径加点(_点: Vector2) -> void:
	if not _路径中:
		return
	# 同一个点连着来就跳过（路径点太密没意义，还会让多边形退化）
	if _路径点.size() > 0 and _路径点[_路径点.size() - 1].distance_squared_to(_点) < 0.01:
		return
	_路径点.append(_点)
	_脏 = true

func 路径中() -> bool:
	return _路径中

func 设置画笔路径(_点: String) -> void:
	_画笔路径 = _点
	_脏 = true

# 绘制前的状态（供角色侧查询）
func 取画笔颜色() -> Color:
	return _当前颜色

func 取画笔粗细() -> float:
	return _当前粗细

func 取填充样式() -> Color:
	return _填充样式

func 取画笔路径() -> String:
	return _画笔路径

func 指令数() -> int:
	return 指令.size()

func 已烘焙() -> bool:
	return _底图 != null


# -----------------------------------------------------------------------------
# 每帧：最多重绘一次 + 需要时烘焙
# -----------------------------------------------------------------------------
func _process(_delta: float) -> void:
	if _脏:
		_脏 = false
		queue_redraw()
	if not _烘焙中 and 指令.size() >= 烘焙阈值:
		# 走 call() 点火：_烘焙() 是协程，直接调会触发 MISSING_AWAIT 警告
		call("_烘焙")


func _确保烘焙视口() -> void:
	if _烘焙视口 != null and is_instance_valid(_烘焙视口):
		return
	_烘焙视口 = SubViewport.new()
	_烘焙视口.name = "画笔烘焙视口"
	_烘焙视口.size = Vector2i(舞台矩形().size)
	_烘焙视口.transparent_bg = true
	_烘焙视口.disable_3d = true
	_烘焙视口.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(_烘焙视口)
	_烘焙器 = 烘焙器.new()
	_烘焙器.name = "烘焙器"
	_烘焙视口.add_child(_烘焙器)


func _烘焙() -> void:
	if _烘焙中 or 指令.size() < 烘焙阈值:
		return
	_烘焙中 = true
	_确保烘焙视口()
	_烘焙器.底图 = _底图
	_烘焙器.待画 = 指令.duplicate()
	_烘焙器.queue_redraw()
	# 等这一帧真正画完，SubViewport 的纹理才是最新的
	await RenderingServer.frame_post_draw
	var 图 := _烘焙视口.get_texture().get_image()
	if 图 != null and 图.get_width() > 0 and 图.get_height() > 0:
		_底图 = ImageTexture.create_from_image(图)
		指令.clear()
		_烘焙器.待画 = []
		_烘焙器.底图 = _底图
	_烘焙中 = false
	_脏 = true


# -----------------------------------------------------------------------------
# 派发
# -----------------------------------------------------------------------------
func _draw() -> void:
	# ★不要在这里铺底色★（见文件头 ③）。
	if _底图 != null:
		draw_texture(_底图, Vector2.ZERO)
	for 项 in 指令:
		var t: String = str(项.get("t", ""))
		match t:
			"line":
				draw_line(项["a"], 项["b"], 项["c"], 项["w"])
			"stamp":
				_画图章(项)
			"text":
				_画文字(项)
			"fill":
				# 「填充样式」在 K4 里就是"把画笔层整层刷成那个颜色"，
				# 所以这里**确实**要铺满 —— 它会盖住背景板，这正是 K4 的行为。
				draw_rect(舞台矩形(), 项["c"], true)
			"fillpath":
				# 「设置当前为填充 起点/终点」之间走过的轨迹 → 闭合多边形填充
				draw_colored_polygon(项["pts"], 项["c"])
			"path":
				# 画笔路径：K4 的"设置画笔路径"是**记录型**指令，
				# 具体多边形/折线怎么落笔需要用户自己实现（见设计规范 §9.1 画笔类桩）。
				pass
			_:
				pass

func _画文字(_项: Dictionary) -> void:
	# ★字号必须 > 0★：draw_string 的 font_size ≤ 0 会让 Godot 每帧刷
	#   `ERROR: Condition "p_size <= 0" is true. Returning: false`
	#   （实测：空白作品 600 帧里刷了 6 次，都指向这里）。
	#   K4 的字号来自角色变量，初始为 0 是常见情况，0 号字本来就看不见 → 跳过。
	var 号 := int(roundf(float(_项.get("z", 0.0))))
	if 号 <= 0:
		return
	# K4 的图章对齐（fields.align）→ Godot 的水平对齐
	var 对 := String(_项.get("a", "center")).to_lower()
	var 横 := HORIZONTAL_ALIGNMENT_CENTER
	if 对 == "left":
		横 = HORIZONTAL_ALIGNMENT_LEFT
	elif 对 == "right":
		横 = HORIZONTAL_ALIGNMENT_RIGHT
	var 位: Vector2 = _项["p"]
	var 转: float = _项.get("r", 0.0)
	if is_zero_approx(转):
		draw_string(ThemeDB.fallback_font, 位, _项["s"],
			横, -1, 号, _项["c"])
		return
	# 以印章点为原点旋转（文字的旋转中心就是印下去的那个点）
	draw_set_transform(位, 转, Vector2.ONE)
	draw_string(ThemeDB.fallback_font, Vector2.ZERO, _项["s"],
		横, -1, 号, _项["c"])
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

func _画图章(_项: Dictionary) -> void:
	var 纹: Texture2D = _项["tex"]
	var 变: Transform2D = _项["xform"]
	# K4 的图章没有旋转：把变换矩阵里的旋转剥掉，只留平移和缩放
	var 缩 := Vector2(变.x.length(), 变.y.length())
	var 位 := 变.origin
	draw_set_transform(位, 0.0, 缩)
	# 图章以角色中心为锚点（K4 造型默认中心锚点）
	# draw_texture 用的是本节点的 modulate（默认白）→ 原纹理颜色，不带角色特效
	draw_texture(纹, Vector2(-纹.get_width() * 0.5, -纹.get_height() * 0.5))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
