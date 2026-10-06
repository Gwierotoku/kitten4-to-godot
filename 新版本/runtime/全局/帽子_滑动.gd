# =============================================================================
# 帽子_滑动.gd  ——  「当在手机中向 上 / 下 / 左 / 右 滑动」
# =============================================================================
#
# K4 的 `on_swipe`（用户截图确认）：
#   fields.type = "up" | "down" | "left" | "right"
#   生成器在帽子脚本里覆写 _配置方向() 把方向带进来。
#
# ⚠ 以前 K4 的这个类型**完全没有对应实现**（HAT_TYPES 里没登记、也没有这个模板），
#   四个方向的滑动事件整块不生成 —— 在生成目录里连它的 blockId 都搜不到。
#
# 识别方式：记录按下位置，松开时算位移向量；主轴方向占优且超过阈值才算滑动。
#   · InputEventScreenTouch  手机上的真实滑动
#   · InputEventMouseButton  桌面调试时用鼠标拖拽同样能触发
#     （K4 写的是"在手机中"，但桌面版没理由不能用鼠标测）
# =============================================================================

class_name 帽子_滑动
extends 帽子基类

## 判定为滑动所需的最小位移（像素）。
## K4 没暴露这个阈值，取 40px：太小会把手抖/误触点当成滑动，太大又滑不动。
const _滑动阈值 := 40.0

var _按下位置 := Vector2.ZERO
var _按下中 := false

## 生成器覆写：要监听哪个方向的滑动（up / down / left / right）
func _配置方向() -> String:
	return "up"

func _input(_event: InputEvent) -> void:
	if 角色 != null and not 角色.k4_is_clone:  #k4特性
		if not _已启动:
			return
		if _event is InputEventScreenTouch:
			var 触 := _event as InputEventScreenTouch
			if 触.pressed:
				_按下位置 = 触.position
				_按下中 = true
			elif _按下中:
				_按下中 = false
				_判定(触.position - _按下位置)
			return
		if _event is InputEventMouseButton:
			var 鼠 := _event as InputEventMouseButton
			if 鼠.button_index != MOUSE_BUTTON_LEFT:
				return
			if 鼠.pressed:
				_按下位置 = 鼠.position
				_按下中 = true
			elif _按下中:
				_按下中 = false
				_判定(鼠.position - _按下位置)

## 位移向量 -> 方向；和 _配置方向() 一致才触发
func _判定(_位移: Vector2) -> void:
	if _位移.length() < _滑动阈值:
		return
	var 方向 := ""
	if absf(_位移.x) > absf(_位移.y):
		方向 = "right" if _位移.x > 0.0 else "left"
	else:
		方向 = "down" if _位移.y > 0.0 else "up"
	if 方向 == _配置方向().strip_edges().to_lower():
		启动()
