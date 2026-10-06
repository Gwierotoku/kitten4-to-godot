## 临时检验脚本（不属于交付物，验证完即删）
## 验证新的「游戏屏幕容器」架构 + 帽子屏幕限定（工程：广播测试 (1).bcm4，2 个屏幕）
##   ① 容器：两个屏幕场景都在树里，只有当前屏幕 visible
##   ② 切屏：切换屏幕到(名) 只改可见性 + 当前屏幕名（不换场景、不销毁状态）
##   ③ 屏幕限定：非当前屏幕里，除绿旗/克隆启动外的帽子**不执行**
##   ④ 绿旗不受屏幕限定（用户确认：点绿旗时各屏幕自己的绿旗脚本都要跑）
extends Node

var 通过 := 0
var 失败 := 0

func 断言(_标题: String, _条件: bool, _详情: String) -> void:
	if _条件:
		通过 += 1
		print("SCREEN [通过] %s  %s" % [_标题, _详情])
	else:
		失败 += 1
		print("SCREEN [失败] %s  %s" % [_标题, _详情])

func _ready() -> void:
	print("SCREEN ===== 开始 =====")
	# 等一帧：root 在 setup children 期间不接受 add_child
	await get_tree().process_frame
	var 容器: Node = (load("res://全局/游戏屏幕.tscn") as PackedScene).instantiate()
	get_tree().root.add_child(容器)
	await get_tree().process_frame
	await get_tree().process_frame

	var A: Node = 容器.get_node_or_null("背景")
	var B: Node = 容器.get_node_or_null("背景_1_")
	print("SCREEN 容器=%s  A=%s  B=%s" % [str(容器), str(A), str(B)])
	断言("① 容器里两个屏幕场景都在树里", A != null and B != null, "A=%s B=%s" % [str(A), str(B)])
	if A == null or B == null:
		get_tree().quit()
		return
	断言("① 初始屏幕 = 顺序里的第一个", K4Global.当前屏幕 == "背景", "当前=%s" % K4Global.当前屏幕)
	断言("① 只有当前屏幕可见", A.visible == true and B.visible == false,
		"A.visible=%s B.visible=%s" % [str(A.visible), str(B.visible)])

	# 等 A 的绿旗那一轮跑完（广播并等待 → 等最慢的 n4 抖 3 秒 → 广播"测试" → n2 抖 1 秒）
	for i in 280:
		await get_tree().process_frame

	# ② 切到 B
	K4Global.切换屏幕到("背景(1)")
	await get_tree().process_frame
	断言("② 切屏后当前屏幕更新", K4Global.当前屏幕 == "背景(1)", "当前=%s" % K4Global.当前屏幕)
	断言("② 切屏只改可见性（状态没被销毁）",
		A.visible == false and B.visible == true and is_instance_valid(A),
		"A.visible=%s B.visible=%s" % [str(A.visible), str(B.visible)])
	断言("② 画布指向新屏幕的 屏幕绘制",
		K4Canvas.画布 != null and K4Canvas.画布 == B.get_node_or_null("屏幕绘制"),
		"画布=%s" % str(K4Canvas.画布))

	# ③ 屏幕限定：A 已经不是当前屏幕 → A 的"广播接收"帽子不该能启动
	var 帽A3: Node = A.get_node_or_null("基础角色层/n3/当接收到广播_测试等待_1")
	var 帽A1: Node = A.get_node_or_null("基础角色层/n1/当开始被点击时_1")
	断言("③ 找得到 A 的帽子", 帽A3 != null and 帽A1 != null, "帽A3=%s 帽A1=%s" % [str(帽A3), str(帽A1)])
	帽A3.call("启动")
	await get_tree().process_frame
	断言("③ 非当前屏幕的**广播帽子**被拦（不执行）", 帽A3.get("_运行中") == false,
		"_运行中=%s" % str(帽A3.get("_运行中")))

	# ④ 绿旗不受屏幕限定：A 不是当前屏幕，它的绿旗仍然能跑
	#   ⚠ 必须**紧接着**查 `_运行中`：A 的接收方此刻被屏幕限定拦住，
	#   所以"广播并等待"会瞬间返回、这一轮很快就结束 —— 等一帧再查就晚了。
	帽A1.call("启动")
	断言("④ 非当前屏幕的**绿旗**照常执行（无屏幕限定）", 帽A1.get("_运行中") == true,
		"_运行中=%s" % str(帽A1.get("_运行中")))
	await get_tree().process_frame

	# ⑤ 切回 A：它的广播帽子现在能跑了
	K4Global.切换屏幕到("背景")
	await get_tree().process_frame
	帽A3.call("启动")
	await get_tree().process_frame
	断言("⑤ 切回当前屏幕后，广播帽子恢复执行", 帽A3.get("_运行中") == true,
		"_运行中=%s" % str(帽A3.get("_运行中")))

	# ⑥ ★即走即取消★（K4 的运行组语义）：帽子正在跑的时候把屏幕切走，
	#    它那轮的协程必须**立刻作废收尾**，不能留个后台循环继续跑。
	await get_tree().process_frame
	断言("⑥ 切走前确实在跑", 帽A3.get("_运行中") == true,
		"_运行中=%s" % str(帽A3.get("_运行中")))
	K4Global.切换屏幕到("背景(1)")
	断言("⑥ 屏幕被切走后，正在跑的协程**立刻被取消**",
		帽A3.get("_运行中") == false and 帽A3.get("_ctx") == null,
		"_运行中=%s _ctx=%s" % [str(帽A3.get("_运行中")), str(帽A3.get("_ctx"))])

	# ⑦ 切回来时，"屏幕激活"不给事件型帽子自动重开（它们只等事件）；
	#    需要"切进来重开一轮"的帽子（当切换到当前屏幕）走 屏幕激活() 覆写。
	K4Global.切换屏幕到("背景")
	await get_tree().process_frame
	断言("⑦ 切回来不会把事件型帽子自动重开", 帽A3.get("_运行中") == false,
		"_运行中=%s" % str(帽A3.get("_运行中")))

	print("SCREEN ===== 结束：通过 %d，失败 %d =====" % [通过, 失败])
	get_tree().quit()
