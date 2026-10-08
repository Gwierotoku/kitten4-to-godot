## 切屏往返测试（不属于交付物）—— 验证"返回主菜单"那批 data.tree is null 报错是否消失
##   来回切 背景 ↔ 背景(2) 几次，最后停在主菜单，看 stderr 有没有
##     Parameter "data.tree" is null.  /  previously freed
extends Node

func _ready() -> void:
	await get_tree().process_frame
	var 场: Node = (load("res://全局/游戏屏幕.tscn") as PackedScene).instantiate()
	get_tree().root.add_child(场)
	await get_tree().process_frame
	await get_tree().process_frame
	print("SWAP ===== 开始切屏往返 =====")
	for i in 3:
		K4Global.切换屏幕到("背景(2)")
		print("SWAP 第 %d 轮 → 背景(2)，当前=%s" % [i + 1, String(K4Global.当前屏幕)])
		await get_tree().create_timer(0.8).timeout
		K4Global.切换屏幕到("背景")
		print("SWAP 第 %d 轮 → 背景(主菜单)，当前=%s" % [i + 1, String(K4Global.当前屏幕)])
		await get_tree().create_timer(0.8).timeout
	await get_tree().create_timer(1.5).timeout
	print("SWAP ===== 结束（对象=%d 节点=%d）=====" % [
		int(Performance.get_monitor(Performance.OBJECT_COUNT)),
		int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT))])
	get_tree().quit()
