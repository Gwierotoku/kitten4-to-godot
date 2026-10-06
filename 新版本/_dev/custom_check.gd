## 临时检验脚本（不属于交付物，验证完即删）
## 工程：custom测试 (1).bcm4
##   「切换到造型」的 index 输入有 4 种形态，转换器必须各自生成正确的表达式：
##     ① 下拉框（造型选择器影子）            → 造型名
##     ② 嵌套：<自己> 的 <造型编号>(get_3)   → 编号（数字当名字用，走 K4 的 转文本）
##     ③ 嵌套：<角色> 的 <造型名称>(get_3)   → 那个角色的造型名
##     ④ 嵌套：变量 + 0（math_arithmetic）   → 表达式结果
##   本脚本把生成代码里那 4 个调用**逐个复现**，看它们是否都算得出东西、
##   并且 设置造型 之后角色仍停在一个**有效造型**上（不静默失败、不报错）。
extends Node

var 通过 := 0
var 失败 := 0

func 断言(_标题: String, _条件: bool, _详情: String) -> void:
	if _条件:
		通过 += 1
		print("CUSTOM [通过] %s  %s" % [_标题, _详情])
	else:
		失败 += 1
		print("CUSTOM [失败] %s  %s" % [_标题, _详情])

func _找角色(_场: Node, _原名: String) -> Node:
	var 层 := _场.get_node_or_null("基础角色层")
	if 层 == null:
		return null
	for 角 in 层.get_children():
		if 角.has_method("_K4原名") and str(角.call("_K4原名")) == _原名:
			return 角
	return null

func _造型名们(_角: Node) -> Array:
	var 表: Variant = _角.get("k4_costumes")
	if 表 is Dictionary:
		return (表 as Dictionary).keys()
	return []

func _当前造型(_角: Node) -> String:
	return str(_角.get("k4_costume_name"))

func _ready() -> void:
	print("CUSTOM ===== 开始 =====")
	var 场: Node = (load("res://背景/背景.tscn") as PackedScene).instantiate()
	add_child(场)
	await get_tree().process_frame

	var A: Node = _找角色(场, "新角色")
	var B: Node = _找角色(场, "新角色(1)")
	print("CUSTOM 角色 A=%s  B=%s" % [str(A), str(B)])
	if A == null:
		print("CUSTOM [失败] 找不到角色「新角色」")
		get_tree().quit()
		return
	print("CUSTOM A 的造型 = %s　当前 = %s" % [str(_造型名们(A)), _当前造型(A)])
	if B != null:
		print("CUSTOM B 的造型 = %s　当前 = %s" % [str(_造型名们(B)), _当前造型(B)])

	# ── ① 下拉框：造型名 ──
	A.call("设置造型", "新角色")
	断言("① 设置造型(造型名)", _造型名们(A).has(_当前造型(A)), "当前=%s" % _当前造型(A))

	# ── ② 嵌套：自己的造型编号（生成代码是 设置造型(转文本(角色属性("2","自己")))）──
	var 编号: Variant = A.call("角色属性", "2", "自己")
	var 编号文本: String = A.call("转文本", 编号)
	print("CUSTOM ② A 的造型编号 = %s → 转文本 = \"%s\"" % [str(编号), 编号文本])
	断言("② 造型编号经 K4 转文本后是整数形式（不是 \"2.0\"）",
		not 编号文本.contains("."), "转文本=%s" % 编号文本)
	A.call("设置造型", 编号文本)
	断言("② 设置造型(造型编号) 命中有效造型", _造型名们(A).has(_当前造型(A)),
		"当前=%s" % _当前造型(A))

	# ── ③ 嵌套：别的角色的造型名称 ──
	var 目标名 := "新角色(1)"
	if B != null:
		var 名称: Variant = A.call("角色属性", "4", 目标名)
		var 名称文本: String = A.call("转文本", 名称)
		print("CUSTOM ③ 「%s」的造型名称 = \"%s\"" % [目标名, 名称文本])
		断言("③ 跨角色取造型名称拿到了非空文本", 名称文本 != "", "名称=%s" % 名称文本)
		A.call("设置造型", 名称文本)
		断言("③ 设置造型(其它角色的造型名称) 之后仍是有效造型（找不到就保持不变，不静默清空）",
			_造型名们(A).has(_当前造型(A)), "当前=%s" % _当前造型(A))
	else:
		print("CUSTOM ③ 没找到第二个角色，跳过")

	# ── ④ 嵌套：变量 + 0 ──
	var 变量值: Variant = K4Global.get("_v_变量")
	var 算式: Variant = A.call("算术运算", "add", 变量值, 0.0)
	var 算式文本: String = A.call("转文本", 算式)
	print("CUSTOM ④ 变量 = %s → 变量+0 = \"%s\"" % [str(变量值), 算式文本])
	A.call("设置造型", 算式文本)
	断言("④ 设置造型(变量+0) 之后仍是有效造型",
		_造型名们(A).has(_当前造型(A)), "当前=%s" % _当前造型(A))

	# ── ⑤ 最后：帽子跑完整套之后（不干预），角色必须仍停在有效造型上 ──
	await get_tree().process_frame
	断言("⑤ 造子脚本整套跑完后造型仍有效", _造型名们(A).has(_当前造型(A)),
		"当前=%s" % _当前造型(A))

	print("CUSTOM ===== 结束：通过 %d，失败 %d =====" % [通过, 失败])
	get_tree().quit()
