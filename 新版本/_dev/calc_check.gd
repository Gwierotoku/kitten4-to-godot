## 「计算」积木算式求值检验（不属于交付物）
##   最小用例 运算 (2).bcm4 的算式是 `1+2-4*6+(3+2)/8^2+cos(65)`，
##   K4 里存的答案字段是 -20.4992567382593 —— 两者相等即通过。
## ⚠ 先 await 一帧再 add_child（root 在 _ready 期间拒绝挂子节点）。
extends Node

func _ready() -> void:
	await get_tree().process_frame
	var 场: Node = (load("res://全局/游戏屏幕.tscn") as PackedScene).instantiate()
	get_tree().root.add_child(场)
	await get_tree().process_frame
	await get_tree().process_frame
	var 算式 := "1+2-4*6+(3+2)/8^2+cos(65)"
	var 答 = K4Global._v_答案
	# 直接问 _k4算式求值 要结果（它挂在角色基类上，场里第一个角色就是舞台）
	var 角: Node = _首个角色(场)
	print("CALC 角色 = %s" % str(角))
	if 角 != null:
		var 直 = 角.call("_k4算式求值", 算式)
		print("CALC 直接求值        = %s" % str(直))
		var 归一 = 角.call("_k4算式归一", 算式)
		var 展开 = 角.call("_k4三角展开", 归一)
		print("CALC 归一化后        = %s" % str(归一))
		print("CALC 三角展开后      = %s" % str(展开))
		# ★算式里带变量名★（琪露诺那个 `(14.1249690204859- cr)/15.24` 就是这种）
		#   手工造一个角色变量 cr=3.5，然后分别试"裸名字"和"带引号"两种形态
		if 角 != null:
			角.set("_v_cr", 3.5)
			for 试 in ["1+答案", "答案*2", "1+\"答案\"", "abs(答案)", "(14.1249690204859-答案)/15.24"]:
				print("CALC 变量式 %-30s -> %s" % [试, str(角.call("_k4算式求值", 试))])
		for 单项 in ["(3+2)/8**2", "5/8**2", "8**2", "(3+2)/64", "1+2-4*6+0.078125", "cos(deg_to_rad(65))"]:
			var e := Expression.new()
			var 错 := e.parse(单项, [])
			var 值 = e.execute([], null, false) if 错 == OK else 0.0
			print("CALC 单项 %-24s parse=%s 值=%s %s" % [单项, str(错), str(值), e.get_error_text()])
	print("CALC 积木算出的 t    = %s" % str(K4Global._v_t))
	print("CALC K4 里存的答案   = %s" % str(答))
	var a := float(K4Global._v_t)
	var b := float(答)
	var ok := absf(a - b) < 1e-9
	print("CALC [%s] t=%s  答案=%s  差=%s" % ["通过" if ok else "失败", str(a), str(b), str(a - b)])
	get_tree().quit()

func _首个角色(_节点: Node) -> Node:
	if _节点 is 角色基类:
		return _节点
	for c in _节点.get_children():
		var r := _首个角色(c)
		if r != null:
			return r
	return null
