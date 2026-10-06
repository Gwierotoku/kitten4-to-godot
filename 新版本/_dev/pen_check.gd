## 临时检验脚本（不属于交付物，验证完即删）
## 工程：外部图片绘制.bcm4 —— 用「文字图章」逐像素把外部图片画出来
## 流程：屏幕1「背景」里 计时器OS 绿旗加载数据 → 按 B → 全部擦除 + 广播"绘制" → 绘制角色开始画
##
## headless 下看不到画面，所以这里看**画布指令**：
##   · 指令数在涨 = 画笔真的在落东西
##   · 指令分类（text / stamp / line）= 用的是哪种画笔积木
##   · 顺便打印数据规模（rect_quantity / 次数 / 各列表长度），估算要画多久
extends Node

var 画布: Node = null

func _指令数() -> int:
	return (画布.get("指令") as Array).size() if 画布 != null else -1

func _分类() -> Dictionary:
	var 类 := {}
	if 画布 == null:
		return 类
	for 条 in 画布.get("指令"):
		类[str(条.get("t", "?"))] = int(类.get(str(条.get("t", "?")), 0)) + 1
	return 类

func _ready() -> void:
	print("PEN ===== 开始 =====")
	await get_tree().process_frame
	var 容器: Node = (load("res://全局/游戏屏幕.tscn") as PackedScene).instantiate()
	get_tree().root.add_child(容器)
	await get_tree().process_frame
	await get_tree().process_frame

	var 屏: Node = 容器.get_node_or_null("背景")
	if 屏 == null:
		print("PEN [失败] 找不到屏幕 背景")
		get_tree().quit()
		return
	画布 = 屏.get_node_or_null("屏幕绘制")
	var 绘制角: Node = 屏.get_node_or_null("基础角色层/绘制")
	var B帽: Node = 绘制角.get_node_or_null("当按下_KEY_B_2") if 绘制角 != null else null
	print("PEN 画布=%s  绘制角色=%s  B键帽子=%s" % [str(画布), str(绘制角), str(B帽)])
	print("PEN 画布 z_index=%s  基础角色层 z_index=%s" % [
		str(画布.get("z_index")) if 画布 else "?",
		str(屏.get_node_or_null("基础角色层").get("z_index")) if 屏.has_node("基础角色层") else "?"])

	# 等绿旗把数据加载好
	for i in 40:
		await get_tree().process_frame
	print("PEN 加载后：rect_quantity=%s 次数=%s state=%s i=%s" % [
		str(K4Global.get("_v_rect_quantity")), str(K4Global.get("_v_次数")),
		str(K4Global.get("_v_state")), str(K4Global.get("_v_i"))])
	for 名 in ["rect_x", "rect_y", "rect_string", "rect_size", "rect_direction", "rect_h", "rect_s", "rect_l", "rect_dx", "rect_dy"]:
		var 表 = K4Global.get("_l_" + 名)
		if 表 is Array:
			print("PEN   列表 _l_%s 长度 = %d" % [名, (表 as Array).size()])
	var 按键前 := _指令数()
	print("PEN 按 B 之前：指令数=%d" % 按键前)

	if B帽 == null:
		print("PEN [失败] 找不到 B 键帽子")
		get_tree().quit()
		return

	# ★真的按一下 B（走按键机制，顺带验证按键→画笔整条链路）★
	var ev := InputEventKey.new()
	ev.keycode = KEY_B
	ev.physical_keycode = KEY_B
	ev.pressed = true
	B帽.call("_input", ev)
	await get_tree().process_frame
	print("PEN 按 B 之后：B帽 触发次数=%d 运行中=%s" % [
		int(B帽.get("_触发次数")), str(B帽.get("_运行中"))])

	# 让它画一会儿
	for 轮 in 3:
		for i in 40:
			await get_tree().process_frame
		print("PEN 第 %d 次采样：指令数=%d  分类=%s" % [轮 + 1, _指令数(), str(_分类())])
	print("PEN 最终：i=%s（画到第几个矩形）" % str(K4Global.get("_v_i")))
	print("PEN ===== 结束 =====")
	get_tree().quit()
