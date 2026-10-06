## 临时检验脚本（不属于交付物，验证完即删）
## 工程：广播测试 (1).bcm4
##   角色 n1（绿旗）：先「广播并等待 测试等待」→ 再「广播 测试」
##   角色 n3（收到 测试等待）：抖动 **1 秒** → 执行 = 1
##   角色 n4（收到 测试等待）：抖动 **3 秒** → 执行 = 3
##   角色 n2（收到 测试）：    抖动 1 秒   → 执行 = 2
##
## 要验证的语义（用户原话）：广播的等待是**等所有**接收方都执行完才走下一步。
##   ✅ 正确：执行=1 @~1.0s → 执行=3 @~3.0s →（n1 这时才广播"测试"）→ 执行=2 @~4.0s
##   ❌ 只等第一个/不等待：执行=2 会早于 执行=3（n2 在 1~2 秒就抖完了）
extends Node

var 帧 := 0
var 上次串 := ""
var 事件: Array = []

func _ready() -> void:
	print("BWAIT ===== 开始 =====")
	var 场: Node = (load("res://背景/背景.tscn") as PackedScene).instantiate()
	add_child(场)

func _process(_d: float) -> void:
	帧 += 1
	var 值: Variant = K4Global.get("_v_执行")
	var 串 := str(值)
	if 串 != 上次串:
		事件.append({ "秒": 帧 / 60.0, "值": float(值) })
		print("BWAIT 帧 %d (%.3f s)  执行 = %s" % [帧, 帧 / 60.0, 串])
		上次串 = 串
	if 帧 >= 330:
		_判定()
		get_tree().quit()

func _判定() -> void:
	var t1 := -1.0
	var t2 := -1.0
	var t3 := -1.0
	for 项 in 事件:
		var 数: float = 项["值"]
		if 数 == 1.0 and t1 < 0.0:
			t1 = 项["秒"]
		if 数 == 2.0 and t2 < 0.0:
			t2 = 项["秒"]
		if 数 == 3.0 and t3 < 0.0:
			t3 = 项["秒"]
	print("BWAIT n3(抖1s)→执行1 @ %.3f s ；n4(抖3s)→执行3 @ %.3f s ；n2(广播\"测试\"后) →执行2 @ %.3f s" % [t1, t3, t2])
	var 通过 := true
	if t1 < 0.0 or t2 < 0.0 or t3 < 0.0:
		print("BWAIT [失败] 三个接收方没有都跑到（t1=%.3f t2=%.3f t3=%.3f）" % [t1, t2, t3])
		通过 = false
	else:
		if absf((t3 - t1) - 2.0) > 0.4:
			print("BWAIT [失败] 两个接收方完成时刻应差 2 秒（1s / 3s 抖动），实测 %.3f s" % (t3 - t1))
			通过 = false
		if t2 < t3 + 0.5:
			print("BWAIT [失败] 「广播并等待」没等**所有**接收方：n2 在 %.3f s 就跑了，而 n4 到 %.3f s 才抖完" % [t2, t3])
			通过 = false
	if 通过:
		print("BWAIT [通过] 并等待等到了**全部**接收方：最慢的 n4 抖完（3 秒）之后才继续广播\"测试\"")
