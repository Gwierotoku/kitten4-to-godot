## 临时检验脚本（不属于交付物，验证完即删）
## 工程：全按键类型.bcm4（41 个按键帽子，覆盖 K4 的所有按键写法）
##
## 为什么能自动验证：直接调 `帽._input(构造的 InputEventKey)`，用帽子的
##   `_触发次数` 观察是否点火 —— headless 下不需要真的按键。
##
## 验证：
##   ① 每个 (键名, 按下/松开档) 只触发**该触发的那几个**帽子（不多不少）
##   ② 按下档与松开档互不串台（K4 的 key_event_type = down | up）
##   ③ 「任意键」帽子对任何键都触发，且不影响具体键帽子的判定
##   ④ 键名认不出来 / 没配置的帽子**不触发**（老实现会退化成"任意键全触发"）
##   ⑤ 按键表 的键名解析：K4 十进制键码 / KEY_X / 小写 / 中文 都能对上
extends Node

var 通过 := 0
var 失败 := 0

func 断言(_标题: String, _条件: bool, _详情: String) -> void:
	if _条件:
		通过 += 1
		print("KEY [通过] %s  %s" % [_标题, _详情])
	else:
		失败 += 1
		print("KEY [失败] %s  %s" % [_标题, _详情])

func _按键帽(_根: Node) -> Array:
	return _根.find_children("*", "", true, false).filter(func(n): return n is 帽子_按键)

func _次数(_帽列: Array) -> Array:
	var 出 := []
	for c in _帽列:
		出.append(int(c.get("_触发次数")))
	return 出

func _发键(_帽列: Array, _码: int, _按下: bool) -> void:
	var ev := InputEventKey.new()
	ev.keycode = _码
	ev.physical_keycode = _码
	ev.pressed = _按下
	for c in _帽列:
		c.call("_input", ev)

func _触发了谁(_帽列: Array, _前: Array) -> Array:
	var 出 := []
	for i in _帽列.size():
		if int(_帽列[i].get("_触发次数")) > int(_前[i]):
			出.append(_帽列[i])
	return 出

## 这一次按键事件**应该**触发哪些帽子：档位相同，且（是任意键 或 解析出的键码 == 本次键码）
func _筛(_帽列: Array, _码: int, _要松开: bool) -> Array:
	var 出 := []
	for c in _帽列:
		if bool(c.get("_要松开")) != _要松开:
			continue
		var c名 := str(c.get("_目标名"))
		if 按键表.是任意键(c名) or 按键表.解析(c名) == _码:
			出.append(c)
	return 出

func _ready() -> void:
	print("KEY ===== 开始 =====")
	await get_tree().process_frame
	var 容器: Node = (load("res://全局/游戏屏幕.tscn") as PackedScene).instantiate()
	get_tree().root.add_child(容器)
	await get_tree().process_frame
	await get_tree().process_frame

	var 屏: Node = 容器.get_node_or_null("背景")
	var 舞台: Node = 屏.get_node_or_null("舞台层/背景") if 屏 != null else null
	if 舞台 == null:
		print("KEY [失败] 找不到舞台角色")
		get_tree().quit()
		return
	var 帽列 := _按键帽(舞台)
	print("KEY 找到 %d 个按键帽子" % 帽列.size())
	# 期望数量随作品变（旧版 41、补了空格之后 42）—— 这里只要求"够多且每个都能解析"，
	# 键位覆盖由下面的逐键比对逐项验证。
	断言("① 按键帽子数量符合预期（≥41）", 帽列.size() >= 41, "实际 %d" % 帽列.size())

	# 先看每个帽子编译出来的键名，有没有"认不出来"的
	var 坏的 := []
	var 名字集 := {}
	for c in 帽列:
		var 名 := str(c.get("_目标名"))
		if not bool(c.get("_已配置")):
			坏的.append(名)
		名字集[名 + "|" + str(c.get("_要松开"))] = true
	断言("① 所有帽子的键名都解析成功（没有认不出来的）", 坏的.is_empty(),
		"认不出来: %s" % str(坏的))
	print("KEY 去重后的键名档位组合 = %d 种" % 名字集.size())

	# ② 每个键名档位：发 down / up 各一次，比对"该触发的集合"
	for 键 in 名字集.keys():
		var 段: Array = str(键).split("|")
		var 名 := str(段[0])
		var 要松开 := str(段[1]) == "true"
		var 任意 := 按键表.是任意键(名)
		var 码 := KEY_Q if 任意 else 按键表.解析(名)
		if 码 == KEY_NONE:
			断言("② 键名 %s 能解析出键码" % 名, false, "解析失败")
			continue

		# 期望集合：★按**键码**算★（本次发的是 码 的 down / up），
		#   档位相同 且（是任意键 或 解析出的键码 == 码）
		var 按下期望 := _筛(帽列, 码, false)
		var 松开期望 := _筛(帽列, 码, true)

		# 按下事件
		var 前 := _次数(帽列)
		_发键(帽列, 码, true)
		var 按下触发 := _触发了谁(帽列, 前)
		# 松开事件
		前 = _次数(帽列)
		_发键(帽列, 码, false)
		var 松开触发 := _触发了谁(帽列, 前)

		断言("② [%s %s] 按下事件恰好触发应有的帽子" % [名, "松开档" if 要松开 else "按下档"],
			按下触发.size() == 按下期望.size() and 按下触发 == 按下期望,
			"触发 %d 个，期望 %d 个" % [按下触发.size(), 按下期望.size()])
		断言("② [%s %s] 松开事件恰好触发应有的帽子" % [名, "松开档" if 要松开 else "按下档"],
			松开触发.size() == 松开期望.size() and 松开触发 == 松开期望,
			"触发 %d 个，期望 %d 个" % [松开触发.size(), 松开期望.size()])

	# ④ 没配置键名的帽子：不该被任何键触发
	var 空帽 := 帽子_按键.new()
	舞台.add_child(空帽)
	await get_tree().process_frame
	断言("④ 空键名的帽子 self 判定为未配置", bool(空帽.get("_已配置")) == false,
		"已配置=%s" % str(空帽.get("_已配置")))
	var 前2 := _次数(帽列)
	_发键(帽列 + [空帽], KEY_Q, true)
	_发键(帽列 + [空帽], KEY_Q, false)
	断言("④ 空键名的帽子不被任何键触发", int(空帽.get("_触发次数")) == 0,
		"触发次数=%d" % int(空帽.get("_触发次数")))
	空帽.queue_free()

	# ⑤ 键名解析的几种写法
	var 样例 := [
		["KEY_Q", KEY_Q], ["KEY_LEFT", KEY_LEFT], ["KEY_SPACE", KEY_SPACE],
		["q", KEY_Q], ["Q", KEY_Q], ["空格", KEY_SPACE], ["上", KEY_UP], ["左", KEY_LEFT],
		["left", KEY_LEFT], ["space", KEY_SPACE], ["enter", KEY_ENTER],
		["81", KEY_Q], ["37", KEY_LEFT], ["13", KEY_ENTER], ["32", KEY_SPACE],  # K4 原始十进制
		["48", KEY_0], ["57", KEY_9], ["65", KEY_A], ["90", KEY_Z],
		["f1", KEY_F1], ["123", KEY_F12], ["delete", KEY_DELETE],
	]
	var 错 := []
	for s in 样例:
		var 实 := 按键表.解析(s[0])
		if 实 != s[1]:
			错.append("%s→%d(应 %d)" % [s[0], 实, s[1]])
	断言("⑤ 键名解析覆盖 K4 原始键码 / KEY_X / 小写 / 中文", 错.is_empty(), str(错))
	断言("⑤ 空串与任意键都能正确识别",
		按键表.是已配置("") == false and 按键表.是任意键("any") and 按键表.是任意键("任意"),
		"空=%s any=%s" % [str(按键表.是已配置("")), str(按键表.是任意键("any"))])

	print("KEY ===== 结束：通过 %d，失败 %d =====" % [通过, 失败])
	get_tree().quit()
