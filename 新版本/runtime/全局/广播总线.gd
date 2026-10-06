# =============================================================================
# K4Bus.gd  ——  autoload 名 `K4Bus`，extends Node
# =============================================================================
#
# 职责：把 K4 的「广播 / 当接收到广播 / 广播并等待」映射到 Godot 的**动态信号**。
#
# 设计要点：
#   ① 广播名 → 信号名：加 `k4_` 前缀 + 转义非法字符（见 安全名）。
#      例：`开始游戏` → `k4_开始游戏`；`ready` → `k4_ready`（避免撞 Node.ready）。
#   ② 信号用 add_user_signal 动态注册，注册前先 has_signal 判重（重复注册会报错）。
#   ③ 监听者用 Signal.connect 注册；监听表另存一份 Callable 列表，供「发信号并等待」用。
#   ④ 「发信号并等待」= 广播后**等所有监听者协程跑完**：
#      每个监听者先用 发信号(名) 广播，广播**本身不等待**；
#      需要等待时用 `await 发信号并等待(名)`：它 await 每个监听者自己的协程。
#      监听者若带 `_监听上下文` 函数，则由它决定"等什么"（内部计数 + 全部空闲信号）。
#   ⑤ 调用方式：直接写 `K4Bus.发信号("名")`。
#      （不要写 `K4Canvas`/autoload 名做变量名，那会和 autoload 单例撞名。）
#
# ---------------------------------------------------------------------------
# 【生成器/帽子约定】触发与等待是**两个**钩子，别混在一起：
#
#     func _注册监听() -> void:            # 基类 _ready 第一帧就调（不等 process_frame）
#         K4Bus.监听("开始游戏", _收到广播)
#
#     func _收到广播() -> void:            # 触发（同步点火，必须**不含 await**）
#         启动()
#
#     _等本轮跑完()                        # 等待钩子，由 帽子基类 提供：
#                                         #   while _运行中: await _跑完
#
# `发信号并等待` 的流程：先 emit_signal（各帽子点火）→ 再对每个监听者
# `await 目标._等本轮跑完()`。这样"体里没有 await 的帽子"立即返回，
# "体里有等待/循环的帽子"被真正等到跑完 —— 正好对应 K4 的语义。
# =============================================================================

extends Node

# 规范名 -> { "信号": StringName, "监听": Array[Callable] }
var _表: Dictionary = {}
var _当前: Node = null

# -----------------------------------------------------------------------------
# 安全名
# -----------------------------------------------------------------------------
func 安全名(_名: String) -> StringName:
	return StringName("k4_" + _转义(_名))

# 把任意 K4 广播名转成合法标识符后缀：
#   非法字符 → _uXXXX（保留可读性与唯一性）；纯 ASCII 保留字加 k4_ 前置
func _转义(_名: String) -> String:
	var 出 := ""
	for i in _名.length():
		var c := _名.unicode_at(i)
		if c == 95 or (c >= 48 and c <= 57 and i > 0) or (c >= 65 and c <= 90) or (c >= 97 and c <= 122) or c >= 128:
			出 += String.chr(c)
		else:
			出 += "_u" + String.num_int64(c)
	if 出 == "":
		出 = "_u" + String.num_int64(95)
	var 首 := 出.unicode_at(0)
	if 首 >= 48 and 首 <= 57:
		出 = "_" + 出
	if _保留字.has(出):
		出 = "k4_" + 出
	return 出

const _保留字 := {
	"ready": true, "renamed": true, "tree_entered": true, "tree_exiting": true,
	"tree_exited": true, "child_entered_tree": true, "child_exiting_tree": true,
	"child_order_changed": true, "property_list_changed": true, "script_changed": true,
	"draw": true, "hidden": true, "item_rect_changed": true, "visibility_changed": true,
	"name": true, "position": true, "rotation": true, "scale": true, "visible": true,
	"if": true, "for": true, "while": true, "class": true, "func": true, "var": true,
	"const": true, "signal": true, "static": true, "await": true, "self": true, "null": true,
}

# -----------------------------------------------------------------------------
# 注册表
#
#   ⚠ 这里**不用 Godot 的 signal 机制**（早先版本用 add_user_signal + connect）：
#     信号是全局的，emit 一次会触发**所有**连接者，没法按屏幕过滤 ——
#     而 K4 的语义是「每个屏幕的广播各自独立」（屏幕 A 的广播不该惊动屏幕 B
#     的脚本）。所以改成自己维护 Callable 列表 + 记录监听者所属屏幕，
#     广播时逐个手动调用、按屏幕筛选。
#   条目结构：{ 规范名: { "监听": [ { "cb": Callable, "屏幕": Node|null } ] } }
# -----------------------------------------------------------------------------
func _登记(_名: String) -> Dictionary:
	var 规范 := 安全名(_名)
	if not _表.has(规范):
		_表[规范] = { "监听": [] }
	return _表[规范]

## 监听。_屏幕 = 监听者所在的屏幕根（null = 全局监听，任何屏幕的广播都触发）。
func 监听(_名: String, _cb: Callable, _屏幕: Node = null) -> void:
	if not _cb.is_valid():
		return
	var 条目 := _登记(_名)
	var 列: Array = 条目["监听"]
	for 项 in 列:
		if 项["cb"] == _cb:
			项["屏幕"] = _屏幕          # 重复监听：更新屏幕归属
			return
	列.append({ "cb": _cb, "屏幕": _屏幕 })

func 取消监听(_名: String, _cb: Callable) -> void:
	var 规范 := 安全名(_名)
	if not _表.has(规范):
		return
	var 列: Array = (_表[规范] as Dictionary)["监听"]
	for i in range(列.size() - 1, -1, -1):
		if 列[i]["cb"] == _cb:
			列.remove_at(i)

## 该广播名当前的监听者（Callable 数组；兼容旧调用）
func 监听者(_名: String) -> Array:
	var 规范 := 安全名(_名)
	if not _表.has(规范):
		return []
	var 出: Array = []
	for 项 in (_表[规范] as Dictionary)["监听"]:
		出.append(项["cb"])
	return 出

# -----------------------------------------------------------------------------
# 广播
# -----------------------------------------------------------------------------
## 发送广播（不等待）。_屏幕 = 发送者所在屏幕；null = 不分屏幕（发给所有监听者）。
##   顺带把"对象已被释放"的监听条目清掉（切屏幕会销毁旧屏幕的帽子）。
func 发信号(_名: String, _屏幕: Node = null) -> void:
	for cb in _可触发(_名, _屏幕):
		(cb as Callable).call()

# 广播并等待：等**所有**（同屏幕的）监听者"跑完"。
#   ★顺序很重要★：必须**先广播**（各帽子点火、`_运行中` 变 true），
#   再去取等待钩子。以前是先 `_运行者()`（在广播之前调 `_监听上下文()`）——
#   那一刻帽子还没启动，拿到的是"已经完成"的空协程，于是等了个寂寞。
func 发信号并等待(_名: String, _屏幕: Node = null) -> void:
	_登记(_名)
	var 可触发 := _可触发(_名, _屏幕)      # ★先取快照★（触发后条目不会变，但对象可能被删）
	var 目标们 := _对象们(可触发)
	for cb in 可触发:
		(cb as Callable).call()             # ★先触发★
	# ★再让出**一帧**★
	#   监听者可能"还没开始跑"：同一帧里靠前的角色广播时，靠后的角色刚把事件
	#   记下、要等自己的 _ready 续体补触发。若立刻去看 `_运行中`，会把
	#   "还没开始"误判成"已经跑完"，于是等了个寂寞（实测：n1 的并等待没等，
	#   两个接收方几乎同时抖动）。让出一帧后，它们都真正跑起来了。
	await get_tree().process_frame
	# 然后逐个等它们这一轮跑完：
	#   同步就能跑完的帽子（体里没有 await）此刻 `_运行中` 已是 false，
	#   等待钩子立即返回；含等待/循环的帽子则真的被等到跑完（最慢的那个说了算）。
	for 目标 in 目标们:
		if 目标 != null and is_instance_valid(目标) and 目标.has_method("_等本轮跑完"):
			await 目标.call("_等本轮跑完")

## 挑出本次广播该触发的监听者（按屏幕过滤 + 清理失效条目）
func _可触发(_名: String, _屏幕: Node) -> Array:
	var 规范 := 安全名(_名)
	var 出: Array = []
	if not _表.has(规范):
		return 出
	var 列: Array = (_表[规范] as Dictionary)["监听"]
	var 保留: Array = []
	for 项 in 列:
		var cb: Callable = 项["cb"]
		var 目标: Object = cb.get_object() if cb.is_valid() else null
		if 目标 == null or not is_instance_valid(目标):
			continue                     # 对象已释放（切屏幕销毁了旧帽子）→ 顺手清理
		保留.append(项)
		# ★屏幕身份**实时求**★
		#   不能在注册时算：帽子的 _ready（注册）早于屏幕根脚本的 _ready，
		#   那一刻 K4Global 里还没登记本屏幕，算出来的是上层节点（实测就是
		#   因此把同屏幕的监听者判成了"别的屏幕"，广播全被过滤掉）。
		#   监听者若带 `_屏幕根()` 就用它（帽子基类有）；否则退回注册时记的。
		var 屏: Node = null
		if 目标.has_method("_屏幕根"):
			屏 = 目标.call("_屏幕根") as Node
		elif 项.has("屏幕"):
			屏 = 项["屏幕"]
		# ★屏幕隔离★：发送者与监听者不在同一屏幕 → 不触发（但保留登记）。
		#   任一方的屏幕为 null（拿不到屏幕根 / 手动全局监听）时不做过滤，保守触发。
		if _屏幕 != null and 屏 != null and 屏 != _屏幕:
			continue
		出.append(cb)
	(_表[规范] as Dictionary)["监听"] = 保留
	return 出

func _对象们(_cb列: Array) -> Array:
	var 出: Array = []
	var 见过 := {}
	for cb in _cb列:
		var 目标: Object = (cb as Callable).get_object()
		if 目标 == null or not is_instance_valid(目标) or 见过.has(目标):
			continue
		见过[目标] = true
		出.append(目标)
	return 出

# -----------------------------------------------------------------------------
# 计数 API（`_进` / `_出` / `全部空闲` / `等待全部空闲` / `_空闲` 信号）已删除。
#
#   它们当年是配合"先收集协程句柄、再 await"那套写法用的计数器，但：
#     · 生成代码从来不调它们（emit 只生成 角色.广播 / 角色.广播并等待）；
#     · 「广播并等待」现在的等待对象是**每个监听帽子自己的** `_等本轮跑完()`
#       （等 `_跑完` 信号），比"全局计数到 0"更精确 —— 嵌套广播时也不会互相干扰。
#   所以整组是死代码，已清掉。
# -----------------------------------------------------------------------------

# -----------------------------------------------------------------------------
# 当前场景
# -----------------------------------------------------------------------------
func 当前场景() -> Node:
	var t := get_tree()
	if t == null:
		return null
	var 现 := t.current_scene
	if 现 != null:
		return 现
	if t.root != null:
		return t.root
	return null

func 切换场景(_路径: String) -> void:
	var t := get_tree()
	if t == null:
		return
	var 错 := t.change_scene_to_file(_路径)
	if 错 != OK:
		push_warning("K4Bus.切换场景 失败：" + _路径 + "（err=" + str(错) + "）")

func 记录场景(_场景: Node) -> void:
	_当前 = _场景
