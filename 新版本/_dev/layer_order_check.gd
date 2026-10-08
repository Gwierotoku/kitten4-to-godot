## 临时检验脚本（不属于交付物）：画笔图层与执行顺序测试 (1)
## 用户给的期望：
##   ① 画面上是「紫色大方块包围淡蓝/红/橙三个方块」，**绿色方块因在紫色图层下方而不可见**
##   ② 同一帧里，黑色方块在左侧产生**一根黑色长条**（不是很短的一个方块）
##   ③ 画面上方出现**蓝色 365 三个数字**（不是只有一个）
## ⚠ 非 headless 跑（截图要真实渲染）
extends Node

func _存图(_名: String) -> void:
	await RenderingServer.frame_post_draw
	var 图 := get_viewport().get_texture().get_image()
	print("LAYER 存图 %s → 错误码 %d" % [_名, 图.save_png("res://" + _名 + ".png")])

func _ready() -> void:
	print("LAYER ===== 开始 =====")
	await get_tree().process_frame
	var 容器: Node = (load("res://全局/游戏屏幕.tscn") as PackedScene).instantiate()
	get_tree().root.add_child(容器)
	var 屏: Node = 容器.get_node_or_null("背景")
	var 层: Node = 屏.get_node_or_null("基础角色层") if 屏 != null else null
	print("LAYER 屏=%s 角色层=%s" % [str(屏), str(层)])
	if 层 == null:
		print("LAYER [失败] 找不到角色层")
		get_tree().quit()
		return
	for i in 6:
		await get_tree().process_frame
	print("LAYER 角色层子节点（同 z_index 时，列表靠后的画在上面）:")
	var 子们 := 层.get_children()
	for i in 子们.size():
		var 子 := 子们[i]
		if not (子 is 角色基类):
			continue
		var 克 = 子.get("k4_clones")
		var 克数 := (克 as Array).size() if 克 != null else -1
		print("LAYER   [%2d] %-12s z=%4d visible=%-5s k4=(%s,%s) 克隆=%d" % [
			i, str(子.name), int(子.get("z_index")), str(子.visible),
			str(子.get("k4_x")), str(子.get("k4_y")), 克数])
		if 克 != null and (克 as Array).size() > 0:
			var 前: Array = []
			for j in mini(8, (克 as Array).size()):
				前.append("(%s,%s)%s" % [str(克[j].get("k4_x")), str(克[j].get("k4_y")),
					str(克[j].get("k4_costume_name"))])
			print("LAYER        克隆体: " + " ".join(前))
	await _存图("_截图_图层_跑之后")
	print("LAYER ===== 结束 =====")
	get_tree().quit()
