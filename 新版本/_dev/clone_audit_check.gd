## 克隆 / 帽子触发审计（不属于交付物）
##   跑 N 帧后统计：
##     · 节点总数 + 每个角色的实例数（原体 / 克隆）
##     · 每个帽子的 `_触发次数`（帽子基类在每次点火时 +1）
##   用来抓"一帧内触发多个不该属于它的帽子 / 克隆数远超逻辑"的问题：
##   正常情况下一顶帽子在一次事件里只点火一次；循环帽子（repeat_forever）也只点火一次。
## ⚠ 先 await 一帧再 add_child（root 在 _ready 期间拒绝挂子节点）。
extends Node

const 观察秒数 := 6.0

func _ready() -> void:
	await get_tree().process_frame
	var 场: Node = (load("res://全局/游戏屏幕.tscn") as PackedScene).instantiate()
	get_tree().root.add_child(场)
	print("AUDIT ===== 开始观察 %.1f 秒 =====" % 观察秒数)
	await get_tree().create_timer(观察秒数).timeout
	_报告()
	get_tree().quit()

func _报告() -> void:
	var 树 := get_tree()
	var 全部 := 树.root.find_children("*", "", true, false)
	var 角色们: Array = []
	var 帽子们: Array = []
	for n in 全部:
		if n is 角色基类:
			角色们.append(n)
		elif n is 帽子基类:
			帽子们.append(n)
	print("AUDIT 帧号=%d  节点总数=%d  角色实例=%d  帽子实例=%d" % [
		Engine.get_process_frames(), 全部.size(), 角色们.size(), 帽子们.size()])
	# 按 K4 原名分组：原体 / 克隆
	var 表 := {}
	for 角 in 角色们:
		var 基 := String(角.call("_K4原名")) if 角.has_method("_K4原名") else String(角.name)
		if 基 == "":
			基 = String(角.name)
		var 键 := 基 + ("  克隆" if bool(角.get("k4_is_clone")) else "  原体")
		表[键] = int(表.get(键, 0)) + 1
	var 键们 := 表.keys()
	键们.sort()
	print("AUDIT 角色实例分布：")
	for k in 键们:
		print("AUDIT   %-28s %d" % [k, 表[k]])
	# 帽子点火次数
	var 触发 := []
	for 帽 in 帽子们:
		var 次 := int(帽.get("_触发次数"))
		if 次 > 0:
			触发.append({ "路": String(帽.get_path()).replace("/root/", ""), "次": 次 })
	触发.sort_custom(func(a, b): return a["次"] > b["次"])
	print("AUDIT 帽子点火次数（只列 >0 的，共 %d 顶）：" % 触发.size())
	for i in mini(30, 触发.size()):
		print("AUDIT   %-52s %d 次" % [触发[i]["路"], 触发[i]["次"]])
	# ★按"出生帧"分组★ —— 抓"同一帧里冒出一堆克隆体"（就是"1 帧触发多个"的症状）
	#   每个克隆体出生时 角色基类 会记 k4_出生帧 = 当前帧 + 1。
	var 按帧 := {}
	for 角 in 角色们:
		if not bool(角.get("k4_is_clone")):
			continue
		var 帧号 := int(角.get("k4_出生帧"))
		按帧[帧号] = int(按帧.get(帧号, 0)) + 1
	var 帧们 := 按帧.keys()
	帧们.sort()
	var 最多 := 0
	for f in 帧们:
		最多 = maxi(最多, int(按帧[f]))
	print("AUDIT 克隆体按出生帧分布：共 %d 个帧里出生过克隆体，单帧最多 %d 个" % [帧们.size(), 最多])
	var 大帧: Array = []
	for f in 帧们:
		if int(按帧[f]) >= 3:
			大帧.append("帧%d=%d个" % [f, 按帧[f]])
	if 大帧.size() > 0:
		print("AUDIT   ⚠ 单帧 ≥3 个克隆的帧：" + ", ".join(大帧.slice(0, 20)))
	else:
		print("AUDIT   没有单帧 ≥3 个克隆的情况")
