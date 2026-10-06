## 临时检验脚本（不属于交付物，验证完即删）
## 完整验证 K4 的运行组语义（用户确认的 B 方案）：
##   「非全局帽子即走即取消；切回所在屏幕重新开始」
## 做法：运行时**动态造一个**「当切换到当前屏幕 + 重复执行」的帽子挂到角色上，
##       用它的计数器来证明三件事：
##   ① 切进本屏幕 → 帽子重新开始跑（计数在涨）
##   ② 切走 → 那一轮**立刻被取消**，计数**停止增长**（不留后台循环）
##   ③ 再切回来 → 又**重新开始一轮**（计数继续涨）
extends Node

var 通过 := 0
var 失败 := 0

func 断言(_标题: String, _条件: bool, _详情: String) -> void:
	if _条件:
		通过 += 1
		print("LIFE [通过] %s  %s" % [_标题, _详情])
	else:
		失败 += 1
		print("LIFE [失败] %s  %s" % [_标题, _详情])

func _ready() -> void:
	print("LIFE ===== 开始 =====")
	await get_tree().process_frame
	var 容器: Node = (load("res://全局/游戏屏幕.tscn") as PackedScene).instantiate()
	get_tree().root.add_child(容器)
	await get_tree().process_frame
	await get_tree().process_frame

	var A: Node = 容器.get_node_or_null("背景")
	var B: Node = 容器.get_node_or_null("背景_1_")
	var 角: Node = A.get_node_or_null("基础角色层/n1")
	if 角 == null:
		print("LIFE [失败] 找不到角色 n1")
		get_tree().quit()
		return

	# 动态造一个和作品里同款的帽子：extends 帽子_屏幕切换 + 重复执行（每帧计数）
	#   ⚠ 循环末尾的 `if ctx._已取消: break` 必须与**生成器的输出**一致 ——
	#     这是「即走即取消」真正生效的地方（一步() 在取消时只是让出一帧就返回，
	#     循环会接着跑下一轮）。这里手写它，等于复刻生成代码。
	var 源码 := "extends 帽子_屏幕切换\n" \
		+ "var 计数: int = 0\n" \
		+ "func _积木主体() -> void:\n" \
		+ "\tvar ctx: 角色基类.WarpCtx = _上下文()\n" \
		+ "\twhile true:\n" \
		+ "\t\t计数 += 1\n" \
		+ "\t\tawait 角色.一步(ctx)\n" \
		+ "\t\tif ctx._已取消: break\n"
	var 脚本 := GDScript.new()
	脚本.source_code = 源码
	var 错 := 脚本.reload()
	if 错 != OK:
		print("LIFE [失败] 动态脚本编译失败: %s" % str(错))
		get_tree().quit()
		return
	var 帽 := Node2D.new()
	帽.name = "测试屏幕帽"
	帽.set_script(脚本)
	角.add_child(帽)
	await get_tree().process_frame
	await get_tree().process_frame

	# ① 切进 A（当前屏幕）→ 屏幕激活 → 帽子开始跑
	K4Global.切换屏幕到("背景")
	for i in 20:
		await get_tree().process_frame
	var 计数1: int = int(帽.get("计数"))
	断言("① 切进本屏幕后，帽子重新开始跑（计数在涨）", 计数1 > 5 and 帽.get("_运行中") == true,
		"计数=%d _运行中=%s" % [计数1, str(帽.get("_运行中"))])

	# ② 切走 → 即走即取消：计数必须**停住**
	K4Global.切换屏幕到("背景(1)")
	断言("② 切走后立刻取消（_运行中=false）", 帽.get("_运行中") == false,
		"_运行中=%s" % str(帽.get("_运行中")))
	var 停下时: int = int(帽.get("计数"))
	for i in 30:
		await get_tree().process_frame
	var 停后: int = int(帽.get("计数"))
	断言("② 取消后计数**不再增长**（没留下后台循环）", 停后 == 停下时,
		"停下时=%d 30帧后=%d" % [停下时, 停后])

	# ③ 切回来 → 重新开始一轮
	K4Global.切换屏幕到("背景")
	for i in 20:
		await get_tree().process_frame
	var 计数3: int = int(帽.get("计数"))
	断言("③ 切回来后又重新开始跑（计数继续涨）", 计数3 > 停后 and 帽.get("_运行中") == true,
		"切回前=%d 切回后=%d _运行中=%s" % [停后, 计数3, str(帽.get("_运行中"))])

	# ④ 绿旗（全局帽子）不受影响：切走它也该继续跑
	#   ⚠ 不能拿 n1 现成的绿旗来判：它的脚本会"广播并等待"，而 A 的接收方被
	#     取消后它会立刻跑完 —— 那是**自然结束**，不是被取消。所以这里同样
	#     动态造一个 `extends 帽子_开始` 的常驻循环帽子，用计数判断。
	var 源码2 := "extends 帽子_开始\n" \
		+ "var 计数: int = 0\n" \
		+ "func _积木主体() -> void:\n" \
		+ "\tvar ctx: 角色基类.WarpCtx = _上下文()\n" \
		+ "\twhile true:\n" \
		+ "\t\t计数 += 1\n" \
		+ "\t\tawait 角色.一步(ctx)\n"
	var 脚本2 := GDScript.new()
	脚本2.source_code = 源码2
	if 脚本2.reload() == OK:
		var 绿旗 := Node2D.new()
		绿旗.name = "测试绿旗帽"
		绿旗.set_script(脚本2)
		角.add_child(绿旗)
		K4Global.切换屏幕到("背景")          # 确保 A 是当前屏幕
		for i in 20:
			await get_tree().process_frame
		绿旗.call("启动")
		await get_tree().process_frame
		var 绿前: int = int(绿旗.get("计数"))
		K4Global.切换屏幕到("背景(1)")        # 切走
		for i in 20:
			await get_tree().process_frame
		var 绿后: int = int(绿旗.get("计数"))
		断言("④ 绿旗是全局帽子：切走后**不被取消**，计数继续涨", 绿后 > 绿前,
			"切走前=%d 切走后=%d _运行中=%s" % [绿前, 绿后, str(绿旗.get("_运行中"))])
	else:
		print("LIFE ④ 绿旗动态脚本编译失败，跳过")

	print("LIFE ===== 结束：通过 %d，失败 %d =====" % [通过, 失败])
	get_tree().quit()
