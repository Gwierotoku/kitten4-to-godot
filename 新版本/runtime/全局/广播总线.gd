# =============================================================================
# 广播总线.gd  ——  autoload 名 `K4Bus`，extends Node
# =============================================================================
#
# 职责：K4 的「广播 / 当接收到广播 / 广播并等待」。
#
# ★这一版是**自己实现的信号系统**，不用 Godot 的 signal★
#
#   · 监听表：广播名 -> [ { 触发: Callable, 等待: Callable, 屏幕: Node } ]
#   · `发信号`       ：逐个 `触发.call()`（同步点火就走，不等待）
#   · `发信号并等待` ：先把所有 `触发` 点着（并行），再**逐个 `await 等待.call()`**
#                      —— 最慢的那个决定何时继续。
#
# ---------------------------------------------------------------------------
# 【为什么是"触发 + 等待"两个 Callable，而不是一个协程回调】
#   Godot 4 不允许"调用协程函数却不 await"：
#       把 `_收到广播()` 写成协程、`发信号` 里 `cb.call()` 点火 →
#       运行时报 `SCRIPT ERROR: Trying to call an async function without await.`
#   （实测：两条「广播并等待」把错误打出来，且并等待当场失效 → 计数器d 只到 1）。
#   而 K4 的**普通广播**语义就是"发完就走、绝不阻塞发送方"，所以
#   「触发」只能是**同步函数**；需要"等"的那一半单独给一个协程 Callable，
#   由 `发信号并等待` 去 await —— 这样两种语义都干净，也没有让出帧的糊弄。
#
# 为什么不用 Godot 的 signal：
#   ① 信号是全局的：emit 一次必然触发**所有**连接者，没法按屏幕过滤 ——
#      而 K4 的语义是「每个屏幕的广播各自独立」（屏幕 A 的广播不惊动屏幕 B）。
#   ② emit_signal 是"发完就走"，没有任何"等接收方跑完"的钩子。
#
# 【屏幕隔离】监听者属于哪个屏幕，**每次广播时实时求**（`_屏幕根()`），
#   不在注册时快照 —— 帽子注册（_ready 最前面）早于屏幕根脚本 _ready，
#   那一刻 K4Global 里还没登记本屏幕，算出来是上层节点（实测因此把同屏幕的
#   监听者判成了"别的屏幕"，广播全被过滤掉）。
# =============================================================================

extends Node

# 广播名 -> Array[ { "触发": Callable, "等待": Callable, "屏幕": Node } ]
var _表: Dictionary = {}

# 兼容旧调用：由 记录场景() 记下的当前场景
var _当前: Node = null

# -----------------------------------------------------------------------------
# 监听表
# -----------------------------------------------------------------------------
func _登记(_名: String) -> Array:
	if not _表.has(_名):
		_表[_名] = []
	return _表[_名]

## 监听。
##   _触发 = **同步**函数（点火；不能含 await，否则普通广播会报错）
##   _等待 = 协程（可 await）；「广播并等待」会 await 它。不传则视为"立刻可继续"。
##   _屏幕 = 监听者所在的屏幕根（null = 全局监听，任何屏幕的广播都触发）
func 监听(_名: String, _触发: Callable, _等待: Callable = Callable(), _屏幕: Node = null) -> void:
	if not _触发.is_valid():
		return
	var 列 := _登记(_名)
	for 项 in 列:
		if 项["触发"] == _触发:
			项["等待"] = _等待             # 重复监听：更新等待钩子与屏幕归属
			项["屏幕"] = _屏幕
			return
	列.append({ "触发": _触发, "等待": _等待, "屏幕": _屏幕 })

func 取消监听(_名: String, _触发: Callable) -> void:
	if not _表.has(_名):
		return
	var 列: Array = _表[_名]
	for i in range(列.size() - 1, -1, -1):
		if 列[i]["触发"] == _触发:
			列.remove_at(i)

## 该广播名当前的监听者（触发 Callable 数组）
func 监听者(_名: String) -> Array:
	var 出: Array = []
	if not _表.has(_名):
		return 出
	for 项 in (_表[_名] as Array):
		出.append(项["触发"])
	return 出

## 有没有人听这个名字（给"发之前先看看"的场景用）
func 有监听者(_名: String) -> bool:
	return not 监听者(_名).is_empty()

# -----------------------------------------------------------------------------
# 发射
# -----------------------------------------------------------------------------
## 发送广播（不等待）：逐个点火就走。_屏幕 = 发送者所在屏幕（null = 不按屏幕过滤）。
func 发信号(_名: String, _屏幕: Node = null) -> void:
	for 项 in _可触发(_名, _屏幕):
		(项["触发"] as Callable).call()

## 发送广播并等待：等所有（同屏幕的）接收方把**这一轮**跑完。
##   ★先全部点火、再逐个 await★：K4/Scratch 的广播是**同时**启动所有接收方的，
##   不能"点一个等一个"——那样接收方会被串起来，总时长变成各自之和
##   （实测基线：两个接收方抖 1s / 3s，「并等待」应当是 ~3s，不是 ~4s）。
func 发信号并等待(_名: String, _屏幕: Node = null) -> void:
	var 条目 := _可触发(_名, _屏幕)
	if 条目.is_empty():
		return
	var 等待们: Array = []
	for 项 in 条目:
		(项["触发"] as Callable).call()                  # ★先全部点火★
		var w: Callable = 项["等待"]
		if w.is_valid():
			等待们.append(w)
	for w in 等待们:
		await (w as Callable).call()                     # ★再逐个等完★（最慢的说了算）

## 挑出本次广播该触发的监听条目（按屏幕过滤 + 顺手清理已释放的对象）
func _可触发(_名: String, _屏幕: Node) -> Array:
	var 出: Array = []
	if not _表.has(_名):
		return 出
	var 保留: Array = []
	for 项 in (_表[_名] as Array):
		var cb: Callable = 项["触发"]
		var 目标: Object = cb.get_object() if cb.is_valid() else null
		if 目标 == null or not is_instance_valid(目标):
			continue                     # 对象已释放（切屏幕销毁了旧帽子）→ 顺手清理
		保留.append(项)
		# ★屏幕身份实时求★：监听者若带 `_屏幕根()` 就用它（帽子基类有），
		#   否则退回注册时记下的那个。
		var 屏: Node = null
		if 目标.has_method("_屏幕根"):
			屏 = 目标.call("_屏幕根") as Node
		elif 项.has("屏幕"):
			屏 = 项["屏幕"]
		# ★屏幕隔离★：发送者与监听者不在同一屏幕 → 不触发（但保留登记）。
		#   任一方的屏幕为 null（拿不到屏幕根 / 手动全局监听）时不做过滤，保守触发。
		if _屏幕 != null and 屏 != null and 屏 != _屏幕:
			continue
		出.append(项)
	_表[_名] = 保留
	return 出

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
