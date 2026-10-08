## 验证 K4 的两道克隆上限（不属于交付物）
##   一帧之内连调 `克隆自己()` 1200 次，看：
##     · 成功创建的个数应被 `K4_每帧克隆上限`（300）截断；
##     · 之后存活的克隆体数应被 `K4_每角色克隆上限`（300）截断。
##   对照 K4 源码：clone_entity() 里
##     if (entities_cloned_times[e] > entity_max_clones_per_frame) → 什么都不做。
extends Node

func _ready() -> void:
	await get_tree().process_frame
	var 场: Node = (load("res://全局/游戏屏幕.tscn") as PackedScene).instantiate()
	get_tree().root.add_child(场)
	await get_tree().process_frame
	await get_tree().process_frame
	var 角: Node = _找原体(场)
	if 角 == null:
		print("CLONELIMIT [失败] 没找到角色")
		get_tree().quit()
		return
	var 限制帧 := int(角.get("K4_每帧克隆上限")) if "K4_每帧克隆上限" in 角 else -1
	var 造 := 0
	for i in 1200:
		var c = 角.call("克隆自己")
		if c != null:
			造 += 1
	var 活 := (角.get("k4_clones") as Array).size()
	print("CLONELIMIT 一帧内尝试创建 1200 个：成功 %d 个" % 造)
	print("CLONELIMIT 调用后 k4_clones 存活数 = %d" % 活)
	print("CLONELIMIT 答案：每帧上限应为 300、每角色存活上限应为 300")
	print("CLONELIMIT [%s] 每帧截断=%s 存活截断=%s" % [
		"通过" if (造 <= 300 and 活 <= 300) else "失败",
		str(造 == 300), str(活 == 300)])
	get_tree().quit()

func _找原体(_节点: Node) -> Node:
	if _节点 is 角色基类 and not bool(_节点.get("k4_is_clone")):
		return _节点
	for c in _节点.get_children():
		var r := _找原体(c)
		if r != null:
			return r
	return null
