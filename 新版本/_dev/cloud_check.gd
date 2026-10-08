## 云变量持久化检验（不属于交付物）
##   跑一次：读云变量 → 打印 → 再 +1 写回 → 退出。
##   连续跑两次，第二次读到的值应该比第一次大 1（说明写进了 user:// 并且下次能读回）。
##   用法：把本脚本 + 同名 tscn 拷进工程，跑 `res://_云变量检验.tscn`。
extends Node

func _ready() -> void:
	print("CLOUD [1] _ready 开始")
	await get_tree().process_frame
	print("CLOUD [2] 第一帧过了，开始 load")
	var 场: Node = (load("res://全局/游戏屏幕.tscn") as PackedScene).instantiate()
	print("CLOUD [3] instantiate 好了，add_child")
	get_tree().root.add_child(场)
	print("CLOUD [4] add_child 好了")
	await get_tree().process_frame
	await get_tree().process_frame
	print("CLOUD [5] 两帧过了，找角色")
	var 角: Node = _找一个角色(场)
	print("CLOUD [6] 找到角色 = %s" % str(角))
	if 角 == null:
		print("CLOUD [失败] 没找到角色节点")
		get_tree().quit()
		return
	print("CLOUD [7] 读云变量…")
	# ⚠ 不要写 `var 读 := 角.call(...)`：call() 返回 Variant，`:=` 推断出 Variant 会触发
	#   "The variable type is being inferred from a Variant value"（本工程把该警告当错误）
	var 读 = 角.call("云变量取值", "云变量")
	print("CLOUD 读到 云变量 = %s  (类型 %s)" % [str(读), typeof(读)])
	print("CLOUD [8] 写云变量…")
	角.call("云变量增加", "云变量", 1.0)
	var 读2 = 角.call("云变量取值", "云变量")
	print("CLOUD 加 1 后 = %s  (类型 %s)" % [str(读2), typeof(读2)])
	print("CLOUD 存档文件存在 = %s" % str(FileAccess.file_exists("user://k4_cloud.json")))
	var f := FileAccess.open("user://k4_cloud.json", FileAccess.READ)
	if f != null:
		print("CLOUD 存档内容 = " + f.get_as_text())
		f.close()
	print("CLOUD 用户目录 = " + OS.get_user_data_dir())
	print("CLOUD [9] quit")
	get_tree().quit()

func _找一个角色(_节点: Node) -> Node:
	if _节点 is 角色基类:
		return _节点
	for c in _节点.get_children():
		var r := _找一个角色(c)
		if r != null:
			return r
	return null
