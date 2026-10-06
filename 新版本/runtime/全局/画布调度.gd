# =============================================================================
# K4Canvas.gd  ——  autoload 名 `K4Canvas`，extends Node
# =============================================================================
#
# 职责（设计规范 §8.2）：
#   画布节点是**每屏幕一份**（屏幕节点下第一个子节点 = 模板/屏幕绘制.gd），
#   但生成代码里希望"一个名字就能调" → 这里做转发单例。
#
#   · 屏幕根脚本 _ready() 里：K4Canvas.画布 = 屏幕绘制节点
#   · 生成代码里：K4Canvas.落笔(起点, 终点, 颜色, 粗细)
#
# 所有函数都是"转发给 画布，画布 为 null 时直接返回"。
# 笔的状态（落笔/抬笔、颜色、粗细）**存在各角色自己身上**（K4 语义），
# 本单例只做指令转发，不持有角色状态。
# =============================================================================

extends Node

# 当前屏幕的画布节点（模板/屏幕绘制.gd 的实例）
var 画布: Node = null

# 角色节点拿画布的便捷入口（角色基类会调它）
func 取画布() -> Node:
	return 画布

func 设置画布(_节点: Node) -> void:
	画布 = _节点

func 有画布() -> bool:
	return 画布 != null and is_instance_valid(画布)

# -----------------------------------------------------------------------------
# 画笔（K4 画笔积木家族）
# -----------------------------------------------------------------------------
func 落笔(_起点: Vector2, _终点: Vector2, _颜色: Color, _粗细: float) -> void:
	if 有画布() and 画布.has_method("落笔"):
		画布.落笔(_起点, _终点, _颜色, _粗细)

func 抬笔() -> void:
	if 有画布() and 画布.has_method("抬笔"):
		画布.抬笔()

func 全部擦除() -> void:
	if 有画布() and 画布.has_method("全部擦除"):
		画布.全部擦除()

func 设置画笔颜色(_颜色: Color) -> void:
	if 有画布() and 画布.has_method("设置画笔颜色"):
		画布.设置画笔颜色(_颜色)

func 设置画笔粗细(_粗细: float) -> void:
	if 有画布() and 画布.has_method("设置画笔粗细"):
		画布.设置画笔粗细(_粗细)

func 图章(_纹理: Texture2D, _变换: Transform2D) -> void:
	if 有画布() and 画布.has_method("图章"):
		画布.图章(_纹理, _变换)

## 「文字图章 <文本> <字号>」——把一段文字印到画笔层上
## _旋转 由调用角色传进来（文字跟着角色转），_颜色 是该角色自己的画笔颜色。
## _对齐 = K4 的 fields.align（left / center / right）——必须一路转发到画布，
##   否则「图章」的对齐下拉框在中间这一层被吃掉（画布只收到默认 center）。
func 文字图章(_文本: String, _位置: Vector2, _字号: float, _颜色: Color,
		_旋转: float = 0.0, _对齐: String = "center") -> void:
	if 有画布() and 画布.has_method("文字图章"):
		画布.文字图章(_文本, _位置, _字号, _颜色, _旋转, _对齐)

func 设置填充样式(_颜色: Color) -> void:
	if 有画布() and 画布.has_method("设置填充样式"):
		画布.设置填充样式(_颜色)

## 「设置当前为填充 <起点 / 终点>」——K4 的填充多边形起止
func 填充路径(_点: String) -> void:
	if 有画布() and 画布.has_method("填充路径"):
		画布.填充路径(_点)

## 填充路径模式下，角色每移动一次就记一个路径点
func 路径加点(_点: Vector2) -> void:
	if 有画布() and 画布.has_method("路径加点"):
		画布.路径加点(_点)

func 路径中() -> bool:
	if 有画布() and 画布.has_method("路径中"):
		return 画布.路径中()
	return false

func 设置画笔路径(_点: String) -> void:
	if 有画布() and 画布.has_method("设置画笔路径"):
		画布.设置画笔路径(_点)

# -----------------------------------------------------------------------------
# 屏幕切换特效（K4 的「设置 屏幕切换特效为 <方向> <效果>」= set_scene_transition）
# -----------------------------------------------------------------------------
# 为什么转场层建在**本节点**上：本文件是 autoload，`change_scene_to_file` 换场景时
# 只有 autoload 不会被销毁 —— 转场层若建在场景里，切场景的瞬间它自己先没了，
# 表现就是"黑幕闪一下/根本没看到转场"。
#
# 语义：K4 的这个积木是"**设置**下一次切换用的特效"，不是立刻播放；
#   真正播放的时机在 角色基类.切换屏幕()：先把屏幕盖住 -> 换场景 -> 新场景就绪后揭幕。
# -----------------------------------------------------------------------------
var 转场效果: String = "none"
var 转场方向: String = "up"

var _转场层: CanvasLayer = null
var _转场块: ColorRect = null
var _待揭幕 := false
var _上次场景: Node = null

func 设置转场(_效果: String, _方向: String) -> void:
	转场效果 = _效果
	转场方向 = _方向

func 有转场() -> bool:
	return 转场效果 != "" and 转场效果 != "none"

func _确保转场层() -> void:
	if _转场层 != null and is_instance_valid(_转场层):
		return
	_转场层 = CanvasLayer.new()
	_转场层.name = "K4转场层"
	_转场层.layer = 4096          # 盖在所有内容（含画笔层）之上
	_转场块 = ColorRect.new()
	_转场块.name = "黑幕"
	_转场块.color = Color(0, 0, 0, 0)
	_转场块.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_转场层.add_child(_转场块)
	add_child(_转场层)

func _视口大小() -> Vector2:
	var 视 := get_viewport()
	if 视 == null:
		return Vector2(480, 360)
	return 视.get_visible_rect().size

## 换场景**之前**调用：把屏幕盖住（渐显 / 从指定方向推入）。
## 返回时动画已播完，可以安全切换场景。
func 转场入场() -> void:
	if not 有转场():
		return
	_确保转场层()
	var 效果 := 转场效果
	转场效果 = "none"                 # 一次性：K4 里这个设置只对下一次切换生效
	var 尺寸 := _视口大小()
	_转场块.size = 尺寸
	var 秒 := 0.22
	# ⚠ 归一成小写再比：K4 的取值是驼峰（fadeInOut），生成器一路 toLowerCase 下来
	#   会变成 "fadeinout"，直接 match 驼峰会全部落到 default 分支。
	#   注意必须**先赋值再 match**：`match 效果.to_lower():` 在 Godot 4.7 里会报
	#   "Expected indented block after match pattern block"（match 表达式不支持方法调用）。
	var 效果键 := 效果.to_lower()
	var tw := create_tween()
	match 效果键:
		"slide", "bounce":
			var 起点 := Vector2.ZERO
			match 转场方向:
				"up":    起点 = Vector2(0.0, -尺寸.y)
				"down":  起点 = Vector2(0.0, 尺寸.y)
				"left":  起点 = Vector2(-尺寸.x, 0.0)
				"right": 起点 = Vector2(尺寸.x, 0.0)
			_转场块.color = Color(0, 0, 0, 1)
			_转场块.position = 起点
			if 效果 == "bounce":
				tw.set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
			tw.tween_property(_转场块, "position", Vector2.ZERO, 秒 * 1.6)
		_:
			# fadeInOut（渐显）和 distrot（扭曲）都退化成"黑幕淡入"。
			# ⚠ K4 的「扭曲」要写屏幕扭曲 shader 才像，这里宁可效果近似，
			#   也不要"什么都不发生"（那样用户会以为积木没接线）。
			_转场块.color = Color(0, 0, 0, 0)
			_转场块.position = Vector2.ZERO
			tw.tween_property(_转场块, "color:a", 1.0, 秒)
	await tw.finished
	# 记下**旧**场景，之后靠 current_scene 变化来判断"新场景已就绪"
	_上次场景 = get_tree().current_scene
	_待揭幕 = true

func _process(_delta: float) -> void:
	if not _待揭幕:
		return
	var 当前 := get_tree().current_scene
	if 当前 == null or 当前 == _上次场景:
		return
	_待揭幕 = false
	# 再等一帧，让新场景的 _ready 都跑完再揭幕
	await get_tree().process_frame
	if _转场块 == null or not is_instance_valid(_转场块):
		return
	var tw := create_tween()
	tw.tween_property(_转场块, "color:a", 0.0, 0.22)
