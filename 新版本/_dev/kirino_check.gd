## 琪露诺三问题检验（不属于交付物）
##   ① 发一次 `fever` 广播 → 克隆体是**同一帧一起出现**还是**逐帧蹦**（= 数字一起显示 / 逐个闪烁）
##   ② 连发 30 次广播（模拟"狂按 ZXCV"）→ 克隆数与对象数是否被 K4 两道上限闸住
##   ③ 顺手暴露 `previously freed` / `null instance` 这类运行期报错
##
## ⚠ 必须**非 headless** 跑：要看画面并截图。
## ⚠ 先 await 一帧再 add_child（root 在 _ready 期间拒绝挂子节点）。
extends Node2D

const 广播名 := "fever"
const 测试Fever := "12345678"     # 8 位 → 循环 8 轮 → 期望"同一帧"出现 8 个克隆
const 连发次数 := 200     # 故意超过"每角色存活 300"的上限，看会不会封顶

var 帧 := 0
var 上次克隆 := 0

func _ready() -> void:
	await get_tree().process_frame
	var 场: Node = (load("res://全局/游戏屏幕.tscn") as PackedScene).instantiate()
	get_tree().root.add_child(场)
	await get_tree().process_frame
	await get_tree().process_frame
	K4Global._v_fever = 测试Fever
	# ★分数数字（num_1_）走的是「结束」广播★：同样是 `进入warp` + 循环里
	#   `设置造型(取字符(score,i))` + `克隆自己()` —— 每个克隆体的「当克隆体启动时」
	#   是 60 帧飞入动画，所以它们**必须同一帧出生**才会"一起飞"。
	K4Global._v_score = "382716"
	K4Global._v_push = "12"
	# ★`fever` / `特效` 的监听者全在**第二个屏幕** `背景(2)`★ ——
	#   而主场景启动时当前屏幕是 `背景`，非当前屏幕的帽子按 K4 语义**不响应**。
	#   （第一版就是这么得到"克隆 0"的：广播发了，但没人听。）
	K4Global.切换屏幕到("背景(2)")
	print("K4CHK ===== 就绪（fever=%s）当前屏幕=%s 对象=%d 节点=%d" % [测试Fever,
		String(K4Global.当前屏幕),
		int(Performance.get_monitor(Performance.OBJECT_COUNT)),
		int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT))])

func _process(_d: float) -> void:
	帧 += 1
	if 帧 == 20:
		var 前 := _数克隆()
		K4Bus.发信号(广播名)
		var 后 := _数克隆()
		print("K4CHK 【单次】发出「%s」：克隆 %d → %d（**同一帧**新增 %d）" % [广播名, 前, 后, 后 - 前])
	# 第 60 帧发「结束」→ 分数数字（num_1_ 的 6+2 位）
	if 帧 == 60:
		var 前2 := _数克隆()
		K4Bus.发信号("结束")
		var 后2 := _数克隆()
		print("K4CHK 【分数】发出「结束」（score=382716 / push=12）：克隆 %d → %d（**同一帧**新增 %d）" % [前2, 后2, 后2 - 前2])
	if 帧 >= 90 and 帧 < 90 + 连发次数:
		K4Bus.发信号(广播名)
	var 现 := _数克隆()
	if 现 != 上次克隆:
		print("K4CHK 第 %d 帧 克隆=%d 对象=%d" % [帧, 现,
			int(Performance.get_monitor(Performance.OBJECT_COUNT))])
		上次克隆 = 现
	if 帧 == 170:
		var img := get_viewport().get_texture().get_image()
		img.save_png("res://_截图_fever.png")
		print("K4CHK 已截图 res://_截图_fever.png")
	# ★广播后那几帧逐帧截图★ —— 用来判断数字是"一起出现"还是"逐个蹦"
	#   （静态单帧看不出这个，必须看连续帧）
	if 帧 in [20, 21, 22, 23, 25, 28, 34, 45, 60, 61, 62, 64, 68, 75]:
		var im := get_viewport().get_texture().get_image()
		im.save_png("res://_截图_帧%02d.png" % 帧)
		print("K4CHK 截图 帧%02d 克隆=%d" % [帧, 现])
	if 帧 >= 260:
		print("K4CHK ===== 结束：克隆=%d 对象=%d 节点=%d" % [现,
			int(Performance.get_monitor(Performance.OBJECT_COUNT)),
			int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT))])
		get_tree().quit()

func 数克隆() -> int:
	return _数克隆()

func _数克隆() -> int:
	var n := 0
	for x in get_tree().root.find_children("*", "", true, false):
		if x is 角色基类 and bool(x.get("k4_is_clone")):
			n += 1
	return n
