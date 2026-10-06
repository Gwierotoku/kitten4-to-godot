## 临时检验脚本（不属于交付物，验证完即删）
## 工程：外部图片绘制 —— 用「文字图章」逐像素把外部图片画出来
##
## 作品原本的数据源是 K4 里那块**悬空**的超长文本（转换器把它存进了
## 背景/process_1_/文本/1.txt，390 万字）。这里直接读它喂给 image_data，
## 再手动跑 load 帽子 + 按 B 触发绘制 —— 这样能验"画笔 + 数据"整条链路。
extends Node

func _ready() -> void:
	print("PEN2 ===== 开始 =====")
	await get_tree().process_frame
	var 容器: Node = (load("res://全局/游戏屏幕.tscn") as PackedScene).instantiate()
	get_tree().root.add_child(容器)
	await get_tree().process_frame
	await get_tree().process_frame

	var 屏: Node = 容器.get_node_or_null("背景")
	var 画布: Node = 屏.get_node_or_null("屏幕绘制")
	var 绘制角: Node = 屏.get_node_or_null("基础角色层/绘制")
	var proc: Node = 屏.get_node_or_null("基础角色层/process_1_")
	var load帽: Node = proc.get_node_or_null("当接收到广播_load_3") if proc != null else null
	var B帽: Node = 绘制角.get_node_or_null("当按下_KEY_B_2") if 绘制角 != null else null
	print("PEN2 画布=%s 绘制角=%s load帽=%s B帽=%s" % [str(画布), str(绘制角), str(load帽), str(B帽)])

	# ① 读那份真实数据
	var 数据: String = K4Text.读取("背景/process_1_/文本/1.txt")
	print("PEN2 外置数据长度 = %d 字" % 数据.length())
	if 数据.length() == 0:
		print("PEN2 [失败] 读不到 文本/1.txt")
		get_tree().quit()
		return
	print("PEN2 数据开头: %s" % 数据.substr(0, 80))

	# ② 注入 image_data（作品里是"变量当列表"）
	K4Global.set("_v_image_data", 绘制角.call("文本分割", 数据, " "))
	var 表 = K4Global.get("_v_image_data")
	print("PEN2 注入后 image_data 项数 = %d" % ((表 as Array).size() if 表 is Array else -1))

	# ③ 手动跑 load（它只读 image_data，不会再清空它）
	if load帽 != null:
		load帽.call("启动")
		for i in 120:
			await get_tree().process_frame
		print("PEN2 load 后：rect_quantity=%s  img_w=%s img_h=%s 缩放=%s" % [
			str(K4Global.get("_v_rect_quantity")), str(K4Global.get("_v_img_w")),
			str(K4Global.get("_v_img_h")), str(K4Global.get("_v_缩放"))])
		for 名 in ["rect_x", "rect_y", "rect_string", "rect_size", "rect_h", "rect_s", "rect_l"]:
			var t = K4Global.get("_l_" + 名)
			if t is Array:
				print("PEN2   列表 _l_%s 长度 = %d" % [名, (t as Array).size()])

	# ④ 按 B → 全部擦除 + 广播"绘制"
	var 前: int = (画布.get("指令") as Array).size()
	print("PEN2 按 B 之前 指令数=%d" % 前)
	if B帽 != null:
		var ev := InputEventKey.new()
		ev.keycode = KEY_B
		ev.physical_keycode = KEY_B
		ev.pressed = true
		B帽.call("_input", ev)
	for 轮 in 4:
		for i in 60:
			await get_tree().process_frame
		var 指令 = 画布.get("指令") as Array
		var 类 := {}
		for 条 in 指令:
			类[str(条.get("t", "?"))] = int(类.get(str(条.get("t", "?")), 0)) + 1
		print("PEN2 第 %d 次采样：指令数=%d 分类=%s  i=%s" % [轮 + 1, 指令.size(), str(类), str(K4Global.get("_v_i"))])
	print("PEN2 ===== 结束 =====")
	get_tree().quit()
