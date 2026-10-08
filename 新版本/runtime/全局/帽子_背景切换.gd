# =============================================================================
# 帽子_背景切换.gd  ——  「当背景切换为 X」
# =============================================================================
#
# 触发方式：屏幕内部的定名信号 屏幕背景切换(背景名: String)。
#   屏幕根脚本（模板/屏幕.gd）在切换背景时发这个信号：
#       屏幕背景切换.emit("背景名")
#   本帽子在 _ready() 里接上它，只有 背景名 == @export 的 背景名 时才启动。
#
# @export var 背景名: String   ← 生成器写目标背景名
#
# 兜底策略（原则一：转换器永不失败）：
#   若屏幕根脚本没有这个信号（例如旧工程），本帽子会在 _process 里
#   轮询 K4Global.当前背景，仍然能工作。
# =============================================================================

class_name 帽子_背景切换
extends 帽子基类

const 信号名 := "屏幕背景切换"

@export var 背景名: String = ""

var _已接信号: bool = false
var _上次背景: String = ""

func _ready() -> void:
	if 角色 != null and not 角色.k4_is_clone:  #k4特性
		if not await 让出帧(): return
		_已启动 = true
		var 屏幕 := _找屏幕()
		if 屏幕 != null and 屏幕.has_signal(信号名):
			var 信号 := 屏幕.get(信号名) as Signal
			if not 信号.is_connected(_在背景切换):
				信号.connect(_在背景切换)
			_已接信号 = true
		_上次背景 = _当前背景()
		set_process(not _已接信号)

func _找屏幕() -> Node:
	var 根: Node = self
	while 根.get_parent() != null:
		根 = 根.get_parent()
	return 根

func _当前背景() -> String:
	if K4Global.有("当前背景"):
		return String(K4Global.取值("当前背景"))
	return ""

# 参数不能叫 背景名（会和 @export 的成员同名 → SHADOWED_VARIABLE_BASE_CLASS）
func _在背景切换(_新背景: String) -> void:
	if _新背景 == 背景名:
		启动()

func _process(_delta: float) -> void:
	if _已接信号:
		return
	if 角色 != null and 角色.k4_is_clone:  #k4特性
		return
	# 兜底轮询：背景名**发生变化**且等于目标 → 启动
	var 现 := _当前背景()
	if 现 != _上次背景:
		_上次背景 = 现
		if 现 == 背景名:
			启动()
