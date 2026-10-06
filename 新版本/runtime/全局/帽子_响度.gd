# =============================================================================
# 帽子_响度.gd  ——  「当响度 > N」
# =============================================================================
#
# 触发方式：同 帽子_条件 —— _process 轮询 + 边沿触发。
#   _条件() = 当前响度 > 阈值
#
# @export var 阈值: float   ← 生成器写 N
#
# 响度怎么来的：Godot 没有麦克风响度节点，这里用**音频总线的峰值电平**
#   （AudioServer.get_bus_peak_volume_left_db）近似。
#   K4 响度是 0~100；这里把 -60dB(静音) ~ 0dB(满) 线性映射到 0~100。
#   想要真正的麦克风响度，请在 角色类.gd 里覆写本文件的 取响度()。
#
# 换算：db 恒定返回 -60 或更低时视为静音 0.0。
# =============================================================================

class_name 帽子_响度
extends 帽子_条件

@export var 阈值: float = 50.0
@export var 总线: String = "Master"

func _条件() -> bool:
	return 取响度() > 阈值

# 可被 角色类.gd 覆写（这里给的是"音频总线峰值"近似实现）
func 取响度() -> float:
	var 设备 := AudioServer.get_bus_index(总线)
	if 设备 < 0:
		设备 = 0
	var 左 := AudioServer.get_bus_peak_volume_left_db(设备, 0)
	var 右 := AudioServer.get_bus_peak_volume_right_db(设备, 0)
	var 峰 := maxf(左, 右)
	if 峰 <= -60.0:
		return 0.0
	return clampf((峰 + 60.0) / 60.0 * 100.0, 0.0, 100.0)
