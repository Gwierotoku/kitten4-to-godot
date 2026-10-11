# =============================================================================
# 透明度特效 / 画笔落点 专项观察（测试用，不属于转换产物）
# =============================================================================
#   案例 alpha_drawpoint.bcm4 里两个角色：
#     · 消失：重复执行 { 将 透明度 特效增加 1 }  → 每帧 alpha 递减，100 帧后全透明
#     · 圆  ：设置画笔颜色 #cc66cc；重复 100 次 { 落笔; 画笔粗细+1; 抬笔 }
#             ★角色全程不移动★ → K4/Scratch 的笔刷是圆头，
#             原地落笔应当画出一个**直径 = 画笔粗细的圆点**（并逐帧变大）。
#
#   本脚本检查：
#     ① 「透明度」特效值逐帧 +1，且 alpha == clamp(1 - 值/100)
#        （用户要求"相应的 effect 值要能对上"）
#     ② 原地落笔真的画出了东西，且紫色面积随画笔粗细增长（点越来越大）
#   ★必须非 headless★：headless 不执行 _draw()，数不到像素。
# =============================================================================
extends Node

var 失败数: int = 0
var 画布: Node = null
var 消失: Node = null
var 圆: Node = null


func _ready() -> void:
	call_deferred("_run")


func _找节点(_判据: String, _值: String = "") -> Node:
	var 栈: Array = [get_tree().root]
	while not 栈.is_empty():
		var n: Node = 栈.pop_back()
		if _判据 == "角色" and n.has_method("_K4原名") and String(n.call("_K4原名")) == _值:
			return n
		if _判据 == "画布" and n.has_method("取画笔粗细") and n.has_method("指令数"):
			return n
		for c in n.get_children():
			栈.append(c)
	return null


## 画面上紫色（#cc66cc = 204,102,204）像素数
func _紫色像素() -> int:
	var 图 := get_viewport().get_texture().get_image()
	if 图 == null:
		return -1
	var 数据 := 图.get_data()
	var n := 0
	for i in range(0, 数据.size(), 4):
		if 数据[i + 3] < 128:
			continue
		if absi(数据[i] - 204) <= 24 and absi(数据[i + 1] - 102) <= 24 and absi(数据[i + 2] - 204) <= 24:
			n += 1
	return n


func _断言(_名: String, _成立: bool, _说明: String) -> void:
	if _成立:
		print("AP [通过] %s" % _名)
	else:
		失败数 += 1
		print("AP [失败] %s —— %s" % [_名, _说明])


func _等(_n: int) -> void:
	for i in _n:
		await get_tree().process_frame


func _run() -> void:
	await _等(30)
	画布 = _找节点("画布")
	消失 = _找节点("角色", "消失")
	圆 = _找节点("角色", "圆")
	if 画布 == null or 消失 == null or 圆 == null:
		print("AP [失败] 找不到节点：画布=%s 消失=%s 圆=%s" % [str(画布), str(消失), str(圆)])
		get_tree().quit(1)
		return

	var 采样: Array = []
	for i in 12:
		await _等(8)
		await RenderingServer.frame_post_draw
		# 最后一次采样时留一张截图（给"点确实画出来了"留证据）
		if i == 11:
			var 图 := get_viewport().get_texture().get_image()
			if 图 != null:
				图.save_png("res://_点截图.png")
		var 效 = 消失.get("k4_effect")
		var 值 := float((效 as Dictionary).get("ghost", -1.0)) if 效 is Dictionary else -1.0
		var 模 = 消失.get("k4_modulate")
		采样.append({
			"ghost": 值,
			"alpha": float((模 as Color).a) if 模 is Color else -1.0,
			"紫": _紫色像素(),
			"粗细": float(画布.call("取画笔粗细")),
			"指令": int(画布.call("指令数")),
		})

	print("AP 采样（每 8 帧一次）:")
	for i in 采样.size():
		var s: Dictionary = 采样[i]
		print("   [%2d] ghost=%6.1f alpha=%.3f 紫=%6d 画笔粗细=%5.1f 画布指令=%d"
			% [i, float(s["ghost"]), float(s["alpha"]), int(s["紫"]), float(s["粗细"]), int(s["指令"])])

	# ---- ① 透明度特效值与表现要对得上 ----
	var 递增 := true
	for i in range(1, 采样.size()):
		# ★只增不减即可，封顶后持平是正常的★（K4 的透明度上限是 100）
		if float(采样[i]["ghost"]) < float(采样[i - 1]["ghost"]):
			递增 = false
	_断言("透明度特效只增不减（封顶后持平）", 递增 and float(采样[-1]["ghost"]) > 0.0,
		"ghost 序列 = %s" % str(采样.map(func(s): return s["ghost"])))

	var 最大偏差 := 0.0
	for s in 采样:
		var 期望 := clampf(1.0 - float(s["ghost"]) / 100.0, 0.0, 1.0)
		最大偏差 = maxf(最大偏差, absf(期望 - float(s["alpha"])))
	print("AP alpha 与 clamp(1-ghost/100) 的最大偏差 = %.4f" % 最大偏差)
	_断言("alpha 与「透明度特效值」对得上", 最大偏差 <= 0.02,
		"最大偏差 %.4f（说明特效值没有真正作用到角色透明度上）" % 最大偏差)

	# ---- ② 原地落笔要画出点，而且越来越大 ----
	var 紫序列: Array = []
	for s in 采样:
		紫序列.append(int(s["紫"]))
	var 有内容 := false
	for v in 紫序列:
		if int(v) > 0:
			有内容 = true
	_断言("原地落笔画出了东西", 有内容, "紫色像素始终为 0：%s" % str(紫序列))

	var 增长 := false
	for i in range(1, 紫序列.size()):
		if int(紫序列[i]) > int(紫序列[i - 1]):
			增长 = true
	_断言("点随画笔粗细变大", 增长, "紫色像素没有增长过：%s" % str(紫序列))
	print("AP 画笔粗细序列 = %s" % str(采样.map(func(s): return s["粗细"])))

	print("AP RESULT 失败 %d 项" % 失败数)
	get_tree().quit(1 if 失败数 > 0 else 0)
