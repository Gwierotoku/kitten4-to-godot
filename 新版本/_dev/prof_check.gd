## 首帧/慢帧剖析（不属于交付物）
##   加载主场景，把"加载耗时"和"每一帧的耗时"打出来（只报 >50ms 的帧）。
##   用途：定位"卡死/很慢"到底卡在加载、还是卡在某几帧的脚本上。
## ⚠ 先 await 一帧再 add_child（root 在 _ready 期间拒绝挂子节点）。
extends Node

var 上 := 0
var 帧 := 0
var 起点 := 0

func _ready() -> void:
	print("PROF ===== 开始 =====")
	await get_tree().process_frame
	# ★三段分开计时★：load(场景) / instantiate（建节点树 + 首次加载各节点脚本）/ add_child（跑 _ready）
	var t0 := Time.get_ticks_msec()
	var 场景: PackedScene = load("res://全局/游戏屏幕.tscn")
	var t1 := Time.get_ticks_msec()
	var 场: Node = 场景.instantiate()
	var t2 := Time.get_ticks_msec()
	get_tree().root.add_child(场)
	var t3 := Time.get_ticks_msec()
	print("PROF load(tscn) %d ms ；instantiate %d ms ；add_child（_ready + 首帧启动）%d ms" % [t1 - t0, t2 - t1, t3 - t2])
	上 = Time.get_ticks_msec()
	起点 = 上

func _process(_d: float) -> void:
	帧 += 1
	var 现 := Time.get_ticks_msec()
	var 用 := 现 - 上
	上 = 现
	if 用 > 50:
		print("PROF 第 %d 帧耗时 %d ms（累计 %d ms）  process=%.1fms  对象=%d  节点=%d  孤儿=%d" % [
			帧, 用, 现 - 起点,
			Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0,
			int(Performance.get_monitor(Performance.OBJECT_COUNT)),
			int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT)),
			int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT))])
	if 帧 >= 600:
		print("PROF ===== %d 帧结束，累计 %d ms ；末帧 对象=%d 节点=%d =====" % [
			帧, Time.get_ticks_msec() - 起点,
			int(Performance.get_monitor(Performance.OBJECT_COUNT)),
			int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT))])
		get_tree().quit()
