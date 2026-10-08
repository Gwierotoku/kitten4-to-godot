# =============================================================================
# 帽子_条件.gd  ——  「当 <条件> 成立」（当 () > () 这一族）
# =============================================================================
#
# 触发方式：_process 轮询 + **边沿触发**（上一帧假、本帧真才启动）。
#
#   生成器子脚本写法：
#       extends 帽子_条件
#       func _条件() -> bool:
#           return 角色.坐标("x") > 100.0     # 原积木: 当()>() @xxx
#       func _积木主体() -> void:
#           var ctx = _上下文()
#           ...
#
#   也可以不改脚本、只在编辑器里填表达式：
#       @export var 条件函数: Callable
#
# 边沿触发的意义：条件连续为真只启动一次；再次为真必须中间出现过一次假。
# =============================================================================

class_name 帽子_条件
extends 帽子基类

# 可选：编辑器里填一个返回 bool 的 Callable（生成器一般不用，走 _条件() 覆写）
@export var 条件函数: Callable = Callable()

var _上次为真: bool = false

func _ready() -> void:
	if 角色 != null and not 角色.k4_is_clone:  #k4特性
		if not await 让出帧(): return
		_已启动 = true
		_上次为真 = _取条件()          # 初始帧不触发（K4 创建当帧不执行）
		set_process(true)

func _process(_delta: float) -> void:
	if not _已启动:
		return
	var 本帧 := _取条件()
	if 本帧 and not _上次为真:
		启动()
	_上次为真 = 本帧

# 子类覆写这个
func _条件() -> bool:
	return false

func _取条件() -> bool:
	if 条件函数.is_valid():
		return bool(条件函数.call())
	return _条件()
