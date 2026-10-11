# =============================================================================
# 分裂 / 克隆体专项观察（测试用，不属于转换产物）
# =============================================================================
#   跑法：挂成 autoload（SplitProbe="*res://_分裂观察.gd"），正常启动主场景。
#
#   这个最小案例（分裂_克隆体问题.bcm4）干的事：
#     · 新角色   ：把自己的克隆体编号记进列表「克隆体」，分裂一个，然后循环等
#                  到"我是最小编号 且 克隆体数量 > 30"，再逐个删除自己；
#     · 新角色_1_：每帧清空 console，遍历「克隆体」列表长度，
#                  把 (新角色 第 n 号克隆体的 x) + "," + (… y) 追加进 console。
#
#   本脚本检查：
#     ① 分裂体数量受控（共享 300 预算，不允许指数爆炸）
#     ② console 有内容，且坐标对**互不相同**（说明真的读到了不同克隆体的属性）
#     ③ ★编号只增不减★ + 一个复制体活着期间编号**不变**
#        这两条合起来才保证"引用不会错位"：作品里存下来的编号永远指向同一个
#        克隆体，而且删除别人不会让它的编号变小。这里**每帧**都查（_process）。
#     ④ 全程没有脚本错误（交给 run.err 看）
# =============================================================================
extends Node

const 上限 := 300
var 失败数: int = 0

# ---- 编号稳定性状态 ----
var _编号历史: Dictionary = {}      # instance_id -> 首次看到的编号
var _最大编号: int = 0              # 历史上出现过的最大编号
var _编号错误: int = 0              # 编号变化 / 撞号 的次数
var _见过复制体: int = 0            # 累计见过的复制体实例数


func _ready() -> void:
	call_deferred("_run")


## 每帧查：编号变了 / 新复制体的编号不大于历史最大值 → 都是"引用会错位"的前兆
func _process(_delta: float) -> void:
	var 栈: Array = [get_tree().root]
	while not 栈.is_empty():
		var 节点: Node = 栈.pop_back()
		if 节点.has_method("克隆体编号") and 节点.has_method("取克隆体"):
			var id := 节点.get_instance_id()
			var 号 := int(节点.call("克隆体编号"))
			if _编号历史.has(id):
				if int(_编号历史[id]) != 号:
					_编号错误 += 1
					print("SPLIT [失败] 编号变了：%s 从 %d 变成 %d（编号必须只增不减、活着期间不变）"
						% [节点.name, int(_编号历史[id]), 号])
			else:
				_编号历史[id] = 号
				if 号 > 0:
					_见过复制体 += 1
					if 号 <= _最大编号:
						_编号错误 += 1
						print("SPLIT [失败] 新复制体 %s 拿到编号 %d，却不大于历史最大值 %d"
							% [节点.name, 号, _最大编号])
					_最大编号 = maxi(_最大编号, 号)
		for c in 节点.get_children():
			栈.append(c)


func _统计角色() -> Dictionary:
	var 总 := 0
	var 克隆 := 0
	var 分裂 := 0
	var 本体 := 0
	var 栈: Array = [get_tree().root]
	while not 栈.is_empty():
		var 节点: Node = 栈.pop_back()
		if 节点.has_method("克隆体编号") and 节点.has_method("取克隆体"):
			总 += 1
			if 节点.get("k4_is_clone") == true:
				克隆 += 1
			elif 节点.get("k4_是复制体") == true:
				分裂 += 1
			else:
				本体 += 1
		for c in 节点.get_children():
			栈.append(c)
	return { "总": 总, "克隆": 克隆, "分裂": 分裂, "本体": 本体 }


func _断言(_名: String, _成立: bool, _说明: String) -> void:
	if _成立:
		print("SPLIT [通过] %s" % _名)
	else:
		失败数 += 1
		print("SPLIT [失败] %s —— %s" % [_名, _说明])


func _跑几帧(_n: int) -> void:
	for i in _n:
		await get_tree().process_frame


func _run() -> void:
	await _跑几帧(60)

	var 峰值 := 0
	var 克隆峰值 := 0
	var 采样: Array = []
	for 轮 in 12:
		await _跑几帧(30)
		var s := _统计角色()
		采样.append(s)
		峰值 = maxi(峰值, int(s["总"]))
		克隆峰值 = maxi(克隆峰值, int(s["克隆"]))

	print("SPLIT 角色统计采样 = %s" % str(采样))
	print("SPLIT 峰值角色总数 = %d（预算上限 %d）；峰值克隆体数 = %d" % [峰值, 上限, 克隆峰值])
	print("SPLIT 编号统计：累计见过复制体 %d 个，历史最大编号 %d，编号错误 %d 次"
		% [_见过复制体, _最大编号, _编号错误])

	# ---- 编号断言（本轮的硬要求）----
	_断言("编号只增不减、且活着期间不变", _编号错误 == 0,
		"出现 %d 次编号异常（编号变小 / 改变了 / 新号不大于历史最大值）" % _编号错误)
	_断言("复制体确实拿到了编号", _最大编号 > 0 or _见过复制体 == 0,
		"一个正编号都没分配出去（最大编号 %d）" % _最大编号)

	# ---- 规模断言 ----
	_断言("分裂没有指数爆炸", 峰值 <= 上限,
		"峰值 %d 个角色，超过共享预算 %d" % [峰值, 上限])
	_断言("确实分裂出了复制体", 峰值 >= 3,
		"峰值只有 %d 个角色，分裂没生效" % 峰值)

	# ---- console 断言（只有带 console 列表的工程才判）----
	var 列表 = K4Global.get("_l_console")
	if 列表 is Array:
		var 项数 := (列表 as Array).size()
		var 前几项: Array = []
		for i in mini(项数, 30):
			前几项.append(str((列表 as Array)[i]))
		print("SPLIT console 项数 = %d" % 项数)
		print("SPLIT console 内容 = %s" % str(前几项))
		_断言("console 有内容", 项数 > 0, "console 是空的")
		var 不同 := {}
		for 项 in 前几项:
			不同[项] = 1
		_断言("console 里的坐标对互不相同", 不同.size() >= mini(3, 前几项.size()),
			"只有 %d 种不同的取值（说明克隆体属性读取没生效，全读成同一个）" % 不同.size())
	else:
		print("SPLIT （本工程没有 console 列表，跳过 console 相关断言）")

	# ---- 本体编号恒 0 ----
	var 有编号的复制体 := 0
	var 本体编号错 := 0
	var 栈: Array = [get_tree().root]
	while not 栈.is_empty():
		var 节点: Node = 栈.pop_back()
		if 节点.has_method("克隆体编号"):
			var 号 := float(节点.call("克隆体编号"))
			if 节点.get("k4_是复制体") == true and 号 > 0.0:
				有编号的复制体 += 1
			if 节点.get("k4_是复制体") != true and 号 != 0.0:
				本体编号错 += 1
		for c in 节点.get_children():
			栈.append(c)
	print("SPLIT 当前有正编号的复制体 = %d，编号不为 0 的本体 = %d" % [有编号的复制体, 本体编号错])
	_断言("本体的克隆体编号恒为 0", 本体编号错 == 0, "有 %d 个本体的编号不是 0" % 本体编号错)

	print("SPLIT RESULT 失败 %d 项" % 失败数)
	get_tree().quit(1 if 失败数 > 0 else 0)
