## 临时检验脚本（不属于交付物，验证完即删）
## 外部图片绘制：读作品里那块悬空的长文本 → 裁到前 500 项 → load → 按 B 绘制 → 截图
## ⚠ 必须**非 headless** 跑（截图要真实渲染）
extends Node

var 画布: Node = null

func _存图(_名: String) -> void:
	await RenderingServer.frame_post_draw
	var 图 := get_viewport().get_texture().get_image()
	var 错 := 图.save_png("res://" + _名 + ".png")
	print("PEN3 存图 %s → 错误码 %d" % [_名, 错])

func _ready() -> void:
	print("PEN3 ===== 开始 =====")
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
	print("PEN3 画布=%s 绘制角=%s load帽=%s B帽=%s" % [str(画布), str(绘制角), str(load帽), str(B帽)])

	var 数据: String = K4Text.读取("背景/process_1_/文本/1.txt")
	var 全部: Array = 绘制角.call("文本分割", 数据, " ")
	var 小: Array = []
	for i in mini(500, 全部.size()):
		小.append(全部[i])
	K4Global.set("_v_image_data", 小)
	print("PEN3 数据裁到 %d 项（原始 %d 项）" % [小.size(), 全部.size()])

	load帽.call("启动")
	for i in 40:
		await get_tree().process_frame
	print("PEN3 load 后：rect_quantity=%s 缩放=%s px=%s py=%s" % [
		str(K4Global.get("_v_rect_quantity")), str(K4Global.get("_v_缩放")),
		str(proc.get("_v_px")), str(proc.get("_v_py"))])
	for 名 in ["rect_x", "rect_y", "rect_string", "rect_size", "rect_h", "rect_s", "rect_l"]:
		var t = K4Global.get("_l_" + 名)
		print("PEN3   列表 _l_%s = %d 项" % [名, (t as Array).size() if t is Array else -1])
	if K4Global.get("_l_rect_string") is Array and (K4Global.get("_l_rect_string") as Array).size() > 0:
		print("PEN3   头三个字符 = %s" % str((K4Global.get("_l_rect_string") as Array).slice(0, 3)))
	await _存图("_截图_绘制前")

	var ev := InputEventKey.new()
	ev.keycode = KEY_B
	ev.physical_keycode = KEY_B
	ev.pressed = true
	B帽.call("_input", ev)
	for i in 90:
		await get_tree().process_frame
	print("PEN3 90 帧后：指令=%d i=%s" % [(画布.get("指令") as Array).size(), str(K4Global.get("_v_i"))])
	await _存图("_截图_绘制中")
	for i in 240:
		await get_tree().process_frame
	print("PEN3 330 帧后：指令=%d i=%s" % [(画布.get("指令") as Array).size(), str(K4Global.get("_v_i"))])
	await _存图("_截图_绘制后")
	print("PEN3 ===== 结束 =====")
	get_tree().quit()
