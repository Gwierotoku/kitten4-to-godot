## 临时检验脚本（不属于交付物，验证完即删）
## 外部图片绘制：用**完整数据**（68716 项）跑一遍，等它画完再截图
## ⚠ 必须非 headless（截图要真实渲染）
extends Node

var 画布: Node = null

func _存图(_名: String) -> void:
	await RenderingServer.frame_post_draw
	var 图 := get_viewport().get_texture().get_image()
	print("PEN4 存图 %s → 错误码 %d" % [_名, 图.save_png("res://" + _名 + ".png")])

func _ready() -> void:
	print("PEN4 ===== 开始 =====")
	await get_tree().process_frame
	var 容器: Node = (load("res://全局/游戏屏幕.tscn") as PackedScene).instantiate()
	get_tree().root.add_child(容器)
	await get_tree().process_frame
	await get_tree().process_frame

	var 屏: Node = 容器.get_node_or_null("背景")
	画布 = 屏.get_node_or_null("屏幕绘制")
	var 绘制角: Node = 屏.get_node_or_null("基础角色层/绘制")
	var proc: Node = 屏.get_node_or_null("基础角色层/process_1_")
	var load帽: Node = proc.get_node_or_null("当接收到广播_load_3")
	var B帽: Node = 绘制角.get_node_or_null("当按下_KEY_B_2")

	var 数据: String = K4Text.读取("背景/process_1_/文本/1.txt")
	var 全部: Array = 绘制角.call("文本分割", 数据, " ")
	K4Global.set("_v_image_data", 全部)
	print("PEN4 数据 %d 项（完整）" % 全部.size())

	load帽.call("启动")
	# load 是"每帧一轮"的循环，69000 项要跑不少帧
	var 目标 := 0
	var 载帧 := 0
	for i in 6000:
		载帧 = i + 1
		await get_tree().process_frame
		目标 = int(K4Global.get("_v_rect_quantity"))
		if 目标 > 0 and (K4Global.get("_l_rect_x") as Array).size() >= 目标:
			break
	print("PEN4 load 完成：用了 %d 帧，rect_quantity=%s，rect_x=%d 项" % [
		载帧, str(K4Global.get("_v_rect_quantity")), (K4Global.get("_l_rect_x") as Array).size()])
	await _存图("_截图_加载后")

	var ev := InputEventKey.new()
	ev.keycode = KEY_B
	ev.physical_keycode = KEY_B
	ev.pressed = true
	B帽.call("_input", ev)

	var 帧 := 0
	while 帧 < 200000:
		await get_tree().process_frame
		帧 += 1
		if 帧 % 5000 == 0:
			print("PEN4 绘制进度 i=%s / %s" % [str(K4Global.get("_v_i")), str(K4Global.get("_v_rect_quantity"))])
		if int(K4Global.get("_v_i")) >= int(K4Global.get("_v_rect_quantity")):
			break
	for i in 30:
		await get_tree().process_frame
	print("PEN4 画完：用了 %d 帧，指令数=%d" % [帧, (画布.get("指令") as Array).size()])
	await _存图("_截图_完整")
	print("PEN4 ===== 结束 =====")
	get_tree().quit()
