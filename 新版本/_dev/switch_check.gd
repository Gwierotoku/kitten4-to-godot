## 临时检验脚本（不属于交付物，验证完即删）
## 工程：切屏测试_custom优化测试.bcm4（用户给的最小案例）
## 作品结构：
##   屏幕1「背景」
##     · 切屏和列表测试：当切换到当前屏幕 → 屏幕1计数器=0 → 重复执行{ 计数器+1; 克隆自己 }
##                       当作为克隆体启动 → 克隆体_屏幕1_计数器_即切即删 +1 → 删除克隆体
##     · customs测试   ：当切换到当前屏幕 → 克隆自己 → 重复执行{ 下一个造型 }
##                       当作为克隆体启动 → 重复执行{ 克隆体_屏幕2_计数器_不删克隆体 +1 }（不删）
##   屏幕2「背景(1)」
##     · 舞台：当切换到当前屏幕 → 重复执行{ 屏幕2计数器 +1 }
## 要验证（K4 运行组语义）：
##   ① 切进某屏幕 → 它的「当切换到当前屏幕」开始跑
##   ② 切走 → 那个屏幕的常驻脚本**立刻冻结**（不再计数/克隆）
##   ③ 切回 → 重新跑一轮（计数器被重置后再增长）
##   ④ 克隆体不泄漏（"即切即删"的那种被删掉，节点数不暴涨）
##   ⑤ 造型轮播正常（AnimatedSprite2D 的 frame 在变）
extends Node

var 通过 := 0
var 失败 := 0

func 断言(_标题: String, _条件: bool, _详情: String) -> void:
	if _条件:
		通过 += 1
		print("SW [通过] %s  %s" % [_标题, _详情])
	else:
		失败 += 1
		print("SW [失败] %s  %s" % [_标题, _详情])

func _取(_名: String) -> float:
	return float(K4Global.get("_v_" + _名))

func _等帧(_n: int) -> void:
	for i in _n:
		await get_tree().process_frame

func _节点数(_根: Node) -> int:
	return _根.find_children("*", "", true, false).size()

func _ready() -> void:
	print("SW ===== 开始 =====")
	await get_tree().process_frame
	var 容器: Node = (load("res://全局/游戏屏幕.tscn") as PackedScene).instantiate()
	get_tree().root.add_child(容器)
	await get_tree().process_frame
	await get_tree().process_frame

	var A: Node = 容器.get_node_or_null("背景")
	var B: Node = 容器.get_node_or_null("背景_1_")
	print("SW 屏幕 = %s / %s  当前=%s" % [str(A), str(B), str(K4Global.当前屏幕)])
	if A == null or B == null:
		print("SW [失败] 找不到两个屏幕")
		get_tree().quit()
		return

	var 角A: Node = A.get_node_or_null("基础角色层/切屏和列表测试")
	var 角C: Node = A.get_node_or_null("基础角色层/customs测试")
	断言("屏幕1里两个角色都在", 角A != null and 角C != null, "角A=%s 角C=%s" % [str(角A), str(角C)])

	# 诊断：屏幕帽子此刻的状态
	for 角 in [角A, 角C]:
		if 角 == null:
			continue
		for 帽 in 角.get_children():
			if 帽.get("_已启动") != null:
				print("SW 诊断 %s/%s：已启动=%s 运行中=%s ctx=%s 屏幕根=%s 本屏当前=%s" % [
					角.name, 帽.name, str(帽.get("_已启动")), str(帽.get("_运行中")),
					str(帽.get("_ctx")), str(帽.call("_屏幕根")), str(帽.call("_本屏幕当前"))])

	# ① 初始切在屏幕1 → 屏幕1计数器在涨
	var 计1a := _取("屏幕1计数器")
	await _等帧(20)
	var 计1b := _取("屏幕1计数器")
	断言("① 屏幕1的「当切换到当前屏幕」在跑（屏幕1计数器 增长）", 计1b > 计1a,
		"%.0f → %.0f" % [计1a, 计1b])

	# ⑤ 造型轮播（AnimatedSprite2D 的 frame 在变）—— 采样序列 + 手动调用对照
	var 精: Node = 角C.get_node_or_null("customs") if 角C != null else null
	var 序列 := ""
	for i in 6:
		await _等帧(3)
		序列 += str(int(精.get("frame"))) + " "
	var 名0 := str(角C.get("k4_costume_name"))
	var f0: int = int(精.get("frame"))
	角C.call("下一个造型")
	var f1: int = int(精.get("frame"))
	角C.call("下一个造型")
	var f2: int = int(精.get("frame"))
	print("SW 诊断 customs：frame 序列=[%s] 造型名=%s；手动下一个造型 %d → %d → %d" % [序列, 名0, f0, f1, f2])
	断言("⑤ customs 的造型在轮播（frame 在变）", 序列.strip_edges().split(" ").size() > 1 and
		(序列.split(" ")[0] != 序列.split(" ")[1] or 序列.split(" ")[1] != 序列.split(" ")[2]),
		"序列=[%s]" % 序列)
	断言("⑤ 手动『下一个造型』有效", f1 != f0 or f2 != f1, "%d → %d → %d" % [f0, f1, f2])

	# ⑥ 列表初值（用户同时报的问题：列表没有初始值）
	var 全: Variant = K4Global.get("_l_全局列表")
	var 局: Variant = 角A.get("_l_actor_list") if 角A != null else null
	print("SW 诊断 全局列表=%s  actor_list=%s" % [str(全), str(局)])
	断言("⑥ 全局列表初值正确（1 a 2 b 3 c）",
		全 is Array and (全 as Array).size() == 6 and str((全 as Array)[1]) == "a" and float((全 as Array)[0]) == 1.0,
		str(全))
	断言("⑥ 角色局部列表初值正确（4 d 5 e）",
		局 is Array and (局 as Array).size() == 4 and str((局 as Array)[1]) == "d",
		str(局))

	# ④ 克隆体不泄漏
	var 节点A := _节点数(A)
	await _等帧(30)
	var 节点A2 := _节点数(A)
	断言("④ 屏幕1 的节点数没有暴涨（即切即删的克隆体没堆积）", 节点A2 <= 节点A + 20,
		"%d → %d" % [节点A, 节点A2])

	# ② 切到屏幕2 → 屏幕1 冻结
	K4Global.切换屏幕到("背景(1)")
	await _等帧(2)
	var 冻1 := _取("屏幕1计数器")
	var 节1 := _节点数(A)
	await _等帧(30)
	var 冻2 := _取("屏幕1计数器")
	var 节2 := _节点数(A)
	断言("② 切走后屏幕1的计数器**冻结**（即走即取消）", 冻2 == 冻1,
		"%.0f → %.0f" % [冻1, 冻2])
	断言("② 切走后屏幕1不再克隆（节点数冻结）", 节2 == 节1,
		"%d → %d" % [节1, 节2])
	var 计2a := _取("屏幕2计数器")
	await _等帧(20)
	var 计2b := _取("屏幕2计数器")
	断言("② 切到屏幕2后它的「当切换到当前屏幕」在跑", 计2b > 计2a,
		"%.0f → %.0f" % [计2a, 计2b])
	断言("② 屏幕2可见、屏幕1不可见", A.visible == false and B.visible == true,
		"A.visible=%s B.visible=%s" % [str(A.visible), str(B.visible)])

	# ③ 切回屏幕1 → 帽子重跑（计数器被重置）
	K4Global.切换屏幕到("背景")
	await _等帧(5)
	var 回1 := _取("屏幕1计数器")
	断言("③ 切回屏幕1：计数器被重置（小于切走时的值）", 回1 < 冻2,
		"切走时=%.0f 切回后=%.0f" % [冻2, 回1])
	await _等帧(20)
	var 回2 := _取("屏幕1计数器")
	断言("③ 切回后继续增长", 回2 > 回1, "%.0f → %.0f" % [回1, 回2])
	var 计2c := _取("屏幕2计数器")
	await _等帧(10)
	断言("③ 切回来后屏幕2的计数器冻结", _取("屏幕2计数器") == 计2c,
		"%.0f → %.0f" % [计2c, _取("屏幕2计数器")])

	print("SW ===== 结束：通过 %d，失败 %d =====" % [通过, 失败])
	get_tree().quit()
