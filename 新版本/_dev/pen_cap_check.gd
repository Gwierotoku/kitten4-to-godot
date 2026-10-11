# =============================================================================
# 画笔「线帽」专项检查：线段的**两端（起点 / 结束点）必须是圆头**
# =============================================================================
#   K4/Scratch 的笔刷是**圆头**的：画一条线，两端各凸出一个"半径 = 粗细/2"的半圆。
#   而 Godot 的 draw_line 两端是**平的** —— 所以「结束点也有点」必须显式补 draw_circle。
#
#   判据（最干净的一条）：在**终点外侧**（x > 终点.x）数颜色像素 ——
#     方头 → 0（齐平，什么都不凸出）
#     圆头 → 约 π·(粗细/2)²/2 个（半个圆）
#   起点外侧同理。
#
#   ★必须非 headless★：headless 不执行 _draw()，截不到画面。
#   用法：godot --path <工程> res://_pen_cap.tscn
# =============================================================================
extends Node2D

const 粗细 := 40.0
const 起x := 120.0
const 终x := 420.0
const 线y := 300.0
var 失败数: int = 0


func _ready() -> void:
	call_deferred("_run")


func _出图(_帧数: int = 4) -> void:
	for i in _帧数:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw


func _断言(_名: String, _成立: bool, _说明: String) -> void:
	if _成立:
		print("CAP [通过] %s" % _名)
	else:
		失败数 += 1
		print("CAP [失败] %s —— %s" % [_名, _说明])


func _run() -> void:
	await get_tree().process_frame
	# 画布脚本在产物里的位置有两种：根目录（手工测）或 背景/（转换器产物）
	var 脚本 = load("res://屏幕绘制.gd")
	if 脚本 == null:
		脚本 = load("res://背景/屏幕绘制.gd")
	if 脚本 == null:
		print("CAP [失败] 载入 屏幕绘制.gd 失败")
		get_tree().quit(1)
		return
	var 绘制 = 脚本.new()
	add_child(绘制)
	await get_tree().process_frame

	# 画一条水平粗线（落笔接口直接给起终点，不经过角色）
	绘制.call("落笔", Vector2(起x, 线y), Vector2(终x, 线y), Color(1, 0, 0), 粗细)
	await _出图(6)

	var 图 := get_viewport().get_texture().get_image()
	if 图 == null:
		print("CAP [失败] 拿不到画面")
		get_tree().quit(1)
		return
	图.save_png("res://_线帽截图.png")
	var 数据 := 图.get_data()
	var 宽 := 图.get_width()
	var 高 := 图.get_height()

	var 最小x := 999999
	var 最大x := -1
	var 外侧终点 := 0
	var 外侧起点 := 0
	var 总数 := 0
	for y in 高:
		for x in 宽:
			var i := (y * 宽 + x) * 4
			if 数据[i + 3] < 128:
				continue
			if 数据[i] > 180 and 数据[i + 1] < 80 and 数据[i + 2] < 80:
				总数 += 1
				最小x = mini(最小x, x)
				最大x = maxi(最大x, x)
				if float(x) > 终x:
					外侧终点 += 1
				if float(x) < 起x:
					外侧起点 += 1

	var 半圆面积 := PI * (粗细 / 2.0) * (粗细 / 2.0) / 2.0
	print("CAP 红色像素 = %d，x 范围 = [%d, %d]（线 %.0f→%.0f，粗细 %.0f）"
		% [总数, 最小x, 最大x, 起x, 终x, 粗细])
	print("CAP 起点外侧 = %d 个像素，终点外侧 = %d 个像素（方头都应为 0；圆头各约 %.0f）"
		% [外侧起点, 外侧终点, 半圆面积])

	_断言("起点是圆头（向左凸出半圆）", float(最小x) < 起x - 2.0,
		"最小 x = %d，没有超出起点 %.0f（方头）" % [最小x, 起x])
	_断言("结束点也是圆头（向右凸出半圆）", float(外侧终点) > 半圆面积 * 0.4,
		"终点外侧只有 %d 个像素（约 %.0f 才算圆头，0 = 方头）" % [外侧终点, 半圆面积])
	_断言("线体本身画出来了", 总数 > int((终x - 起x) * 粗细 * 0.7),
		"红色像素只有 %d，线没画出来" % 总数)

	print("CAP RESULT 失败 %d 项" % 失败数)
	get_tree().quit(1 if 失败数 > 0 else 0)
