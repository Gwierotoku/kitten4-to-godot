# =============================================================================
# 帽子_点击.gd  ——  「当角色被点击时」
# =============================================================================
#
# 触发方式：Area2D 的 input_event。按设计规范 §1 补丁 3：
#   「当角色被点击时」这个帽子自带 .tscn：Node2D + Area2D + CollisionPolygon2D。
#   本文件在 _ready() 里把 Area2D 的 input_event 接到 _on_area_input_event。
#
# 摆放约定：
#   · 点击帽子的第一个子节点应为 Area2D（CollisionPolygon2D 挂在它下面）；
#   · 若没有，本文件会**自己建一个 Area2D + 圆**，保证「点击积木能跑」——
#     原则一：转换器永不失败，宁可退化也不能没反应。
#   · input_pickable = true + input_ray_pickable = true，且
#     project.godot 里 physics/common/enable_object_picking 默认就是 true。
#
# 若点击帽子的 .tscn 里已经给了 Area2D，本文件优先用它（不重复建）。
# =============================================================================

class_name 帽子_点击
extends 帽子基类

var _区域: Area2D = null
# 要监听的**别的**角色（K4 允许"A 的脚本监听 B 被点击"）；为空 = 监听自己
var _监听节点: 角色类 = null

## 生成器覆写：K4 的「当 X 被 点击 / 按下 / 放开」是**哪一档**
##   取值：mouse_click（默认）/ mouse_down / mouse_up
##   ⚠ 以前生成器从没写过这个函数，运行时也无条件只认 `鼠.pressed` ——
##     于是「当 X 被放开」变成了按下就触发。
func _配置点击事件() -> String:
	return "mouse_click"

## 生成器覆写：要监听**哪个角色**（K4 原名）；空 = 自己
func _配置监听角色() -> String:
	return ""

func _ready() -> void:
	if 角色 != null and not 角色.k4_is_clone:  #k4特性
		await get_tree().process_frame
		_已启动 = true
		var 目标名 := _配置监听角色()
		if 目标名 != "":
			var 找到 := 角色.找(目标名)
			if 找到 != null and 找到 != 角色:
				_监听节点 = 找到 as 角色类
				return          # 监听别人 → 走 _input + 包围盒命中，不建 Area2D
		_区域 = _找区域()
		if _区域 == null:
			_区域 = _造区域()
		var 信号 := _区域.input_event
		if not 信号.is_connected(_on_area_input_event):
			信号.connect(_on_area_input_event)

func _找区域() -> Area2D:
	for 子 in get_children():
		if 子 is Area2D:
			return 子 as Area2D
	return null

func _造区域() -> Area2D:
	var 区 := Area2D.new()
	区.name = "点击区域"
	区.input_pickable = true
	区.input_ray_pickable = true
	区.collision_layer = 1
	区.collision_mask = 1
	区.monitoring = false
	区.monitorable = false
	var 形 := CollisionShape2D.new()
	形.name = "点击形状"
	var 圆 := CircleShape2D.new()
	圆.radius = 24.0
	形.shape = 圆
	区.add_child(形)
	add_child(区)
	return 区

## K4 的「点击 / 按下 / 放开」三档 → 鼠标事件的匹配规则
func _输入匹配(_event: InputEvent) -> bool:
	if not (_event is InputEventMouseButton):
		return false
	var 鼠 := _event as InputEventMouseButton
	if 鼠.button_index != MOUSE_BUTTON_LEFT:
		return false
	var 档 := _配置点击事件().to_lower()
	if 档 == "mouse_down" or 档 == "down" or 档 == "按下":
		return 鼠.pressed
	if 档 == "mouse_up" or 档 == "up" or 档 == "mouse_release" or 档 == "放开" or 档 == "松开":
		return not 鼠.pressed
	# K4 的「点击」= 按下即触发（保持原行为；把松开也算上会让一次点击跑两遍）
	return 鼠.pressed

# Area2D 的 input_event 回调（签名固定，不能改）
func _on_area_input_event(_viewport: Node, _event: InputEvent, _shape_idx: int) -> void:
	if _输入匹配(_event):
		启动()

## 监听**别的角色**时走这里。
##   Area2D 只能盖在自己身上，做不到"A 的节点监听 B 的点击"，
##   所以改用全局鼠标事件 + 目标角色的包围盒命中测试。
func _input(_event: InputEvent) -> void:
	if _监听节点 == null or not _已启动:
		return
	if not _输入匹配(_event):
		return
	var k4点: Vector2 = 角色.call("_鼠标K4")
	if _监听节点.包围盒().has_point(k4点):
		启动()
