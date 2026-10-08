# =============================================================================
# 画笔"清除"专项检查：每帧 擦除 + 重画 时，画面不允许出现空帧（闪烁）
# =============================================================================
#   ★必须非 headless★：headless 不执行 _draw()，截不到任何东西。
#
#   复现的写法（斗地主就是这样）：
#       while true:
#           角色.全部擦除()            ← 擦掉整层
#           ...画几百个图章 / 文字图章…  ← 重画（warp 预算耗尽时会让出 → 跨帧）
#           await 角色.一步(ctx)
#
#   旧实现：全部擦除() 立刻 指令.clear()，于是"已经擦掉、还没画上"的那一帧
#           渲染出来就是空白 —— 用户看到的闪烁。
#   新实现：擦除只清"写入批次"，显示保持到这一批画到稳定点，再整批原子替换。
#
#   用法：godot --path <工程> --fixed-fps 60 res://_pen_flush.tscn
# =============================================================================
extends Node2D

const 白底阈值 := 128
var 绘制 = null
var 失败数: int = 0


func _ready() -> void:
	call_deferred("_run")


func _出图(_帧数: int = 3) -> void:
	for i in _帧数:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw


## 画面里"非背景"的像素数（测试工程是白底 → 数非白像素）
func _内容像素() -> int:
	var 图 := get_viewport().get_texture().get_image()
	if 图 == null:
		return -1
	var 数据 := 图.get_data()
	var n := 0
	for i in range(0, 数据.size(), 4):
		if 数据[i + 3] < 白底阈值:
			continue
		if 数据[i] < 白底阈值 or 数据[i + 1] < 白底阈值 or 数据[i + 2] < 白底阈值:
			n += 1
	return n


func _画一排(_个数: int) -> void:
	for i in _个数:
		绘制.call("文字图章", "M",
			Vector2(10.0 + float(i % 20) * 22.0, 60.0 + float(i / 20) * 44.0),
			24, Color.BLACK, 0.0, "left")


func _断言(_名: String, _成立: bool, _说明: String) -> void:
	if _成立:
		print("FLUSH [通过] %s" % _名)
	else:
		失败数 += 1
		print("FLUSH [失败] %s —— %s" % [_名, _说明])


func _run() -> void:
	await get_tree().process_frame
	var 脚本 = load("res://屏幕绘制.gd")
	if 脚本 == null:
		print("FLUSH [失败] 载入 res://屏幕绘制.gd 失败")
		get_tree().quit(1)
		return
	绘制 = 脚本.new()
	add_child(绘制)
	await get_tree().process_frame

	# ---- ① 每帧"擦除 + 重画"：擦除之后画面不允许变空 -------------------------
	var 擦除后: Array = []
	var 画完: Array = []
	for 轮 in 4:
		绘制.call("全部擦除")
		# 擦除后只等 2 帧（< 屏幕绘制.提交空闲帧数）：这一批还没开始画，
		# 画面必须**保持上一批的完整内容**，不允许变空。
		await _出图(2)
		擦除后.append(_内容像素())
		_画一排(40)
		# 画完之后等够兜底提交的帧数（画一次就停的工程靠这条显示出来）
		await _出图(6)
		画完.append(_内容像素())
	print("FLUSH ① 擦除后采样 = %s" % str(擦除后))
	print("FLUSH ① 画完后采样 = %s" % str(画完))
	# 第 1 轮之前本来就没内容，所以从第 2 轮起要求"擦除后仍然看得见东西"
	for i in range(1, 擦除后.size()):
		_断言("第 %d 轮：擦除之后画面没有变空" % (i + 1), int(擦除后[i]) > 0,
			"擦除后采样=%d（0 = 就是那个闪烁）" % int(擦除后[i]))
	for i in 画完.size():
		_断言("第 %d 轮：重画之后有内容" % (i + 1), int(画完[i]) > 0,
			"重画后采样=%d" % int(画完[i]))

	# ---- ② "只擦不画"仍然要能清屏 -------------------------------------------------
	#   新实现里"擦除"只清写入批次，画面靠"连续 N 帧没有新指令"的兜底提交来更新，
	#   所以这里要等够（>屏幕绘制.提交空闲帧数）。
	await _出图(6)
	var 清前 := _内容像素()
	绘制.call("全部擦除")
	await _出图(6)
	var 清后 := _内容像素()
	print("FLUSH ② 擦除前=%d 擦除后=%d" % [清前, 清后])
	_断言("只擦不画能清屏", 清前 > 0 and 清后 == 0,
		"擦除前=%d 擦除后=%d（应当先有内容、再被清空）" % [清前, 清后])

	# ---- ③ 累加模式（从不擦除）不受影响：内容只增不减 ------------------------
	var 累加: Array = []
	for 轮 in 3:
		_画一排(20)
		await _出图()
		累加.append(_内容像素())
	print("FLUSH ③ 累加模式采样 = %s" % str(累加))
	var 递增 := true
	for i in range(1, 累加.size()):
		if int(累加[i]) <= int(累加[i - 1]):
			递增 = false
	_断言("累加模式（从不擦除）内容持续增长", 递增, "采样=%s" % str(累加))

	print("FLUSH RESULT 失败 %d 项" % 失败数)
	get_tree().quit(1 if 失败数 > 0 else 0)
