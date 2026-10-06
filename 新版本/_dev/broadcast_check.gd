## 临时检验脚本（不属于交付物，验证完即删）
## 验证「广播 / 广播并等待」的协程语义（工程：广播测试.bcm4）：
##   角色 n1（绿旗）：先「广播并等待 测试等待」→ 再「广播 测试」
##   角色 n3（收到 测试等待）：抖动 1 秒 → 执行 = 1
##   角色 n2（收到 测试）：    抖动 1 秒 → 执行 = 2
## 正确行为（并等待真的等）：
##   执行 先变 1，约 1 秒后才变 2  →  n1 等到了 n3 抖动跑完才广播"测试"
## 错误行为（并等待没等 / 只点火）：
##   n2、n3 同时抖动，执行 在 ~1 秒处只跳一次（或被覆盖成某一个值）
extends Node

var 帧 := 0
var 上次串 := "(未读)"
var 事件: Array = []

func _ready() -> void:
	print("BCAST ===== 开始 =====")
	var 场: Node = (load("res://背景/背景.tscn") as PackedScene).instantiate()
	add_child(场)
	# 记录两个接收方角色的抖动轨迹（position.x 变化），用来判断"谁先抖"
	set_process(true)

func _process(_d: float) -> void:
	帧 += 1
	var 值: Variant = K4Global.get("_v_执行")
	if 帧 == 1:
		print("BCAST 帧1 初始 执行 = %s" % str(值))
	if str(值) != 上次串:
		事件.append({ "帧": 帧, "秒": 帧 / 60.0, "值": 值 })
		print("BCAST 帧 %d (%.3f s)  执行 = %s" % [帧, 帧 / 60.0, str(值)])
		上次串 = str(值)
	if 帧 >= 240:
		_判定()
		get_tree().quit()

func _判定() -> void:
	print("BCAST ---- 轨迹 ----")
	var t1 := -1.0
	var t2 := -1.0
	for 项 in 事件:
		var 数 := float(项["值"])
		if 数 == 1.0 and t1 < 0.0:
			t1 = 项["秒"]
		if 数 == 2.0 and t2 < 0.0:
			t2 = 项["秒"]
	print("BCAST 执行=1 出现在 %.3f s ；执行=2 出现在 %.3f s" % [t1, t2])
	if t1 < 0.0 or t2 < 0.0:
		print("BCAST [失败] 两个广播的接收方没有都跑到（t1=%s t2=%s）" % [str(t1), str(t2)])
		return
	var 间隔 := t2 - t1
	print("BCAST 间隔 = %.3f s（抖动时长 1.0 s + 广播并等待应有的等待）" % 间隔)
	if 间隔 >= 0.8:
		print("BCAST [通过] 「广播并等待」真的等到了接收方协程跑完")
	else:
		print("BCAST [失败] 「广播并等待」没有等待：两个接收方几乎同时跑（间隔 %.3f s）" % 间隔)
