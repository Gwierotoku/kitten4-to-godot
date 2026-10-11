# K4-GENERATED  全局变量 / 全局列表
extends Node

# —— 全局变量（真实成员变量，调试器里可见中文名）——
var _v_视角X: Variant = 0
var _v_视角Y: Variant = 0
var _v_缩放: Variant = 0
var _v_角色X: Variant = 0
var _v_角色Y: Variant = 0
var _v_生命: Variant = 0
var _v_伤害: Variant = 0
var _v_减伤: Variant = 0
var _v_移速: Variant = 0
var _v_射速: Variant = 0
var _v_战斗: Variant = 0
var _v_HP: Variant = 0
var _v_击败敌人数: Variant = 0
var _v_敌人数: Variant = 0
var _v_角色击退角度: Variant = 0
var _v_角色击退力度: Variant = 0
var _v_弹速: Variant = 0
var _v_区域: Variant = 0
var _v_允许移动: Variant = 0
var _v_提示显示: Variant = 0
var _v_加成显示: Variant = 0
var _v_穿透: Variant = 0
var _v_反弹: Variant = 0
var _v_展示HP敌人: Variant = 0
var _v_地图: Variant = 0
var _v_地图X: Variant = 0
var _v_地图Y: Variant = 0
var _v_胜利: Variant = 0
var _v_领域: Variant = 0
var _v_敌人属性增长: Variant = 0
var _v_敌人数量增长: Variant = 0
var _v_区块数: Variant = 0
var _v_角色buff: Variant = 0
var _v_获得buff函数遍历2: Variant = 0
var _v_获得buff函数遍历1: Variant = 0
var _v_加成刷新: Variant = 0
var _v_背景变色: Variant = 0
var _v_背景亮度: Variant = 0
var _v_背景遮罩: Variant = 0

# —— 全局列表 ——
var _l_区块位置: Array = []
var _l_区块方向: Array = []
var _l_区块敌人: Array = []
var _l_出场特效: Array = []
var _l_敌人趋势情况: Array = []
var _l_趋势特效: Array = []
var _l_角色造成伤害: Array = []
var _l_伤害数字: Array = []
var _l_敌人造成伤害: Array = []
var _l_区块建筑: Array = []
var _l_加成: Array = []        # 初值太长，_ready 里从外置文件读
var _l_刷新加成: Array = []
var _l_拥有加成: Array = []
var _l_敌人子弹: Array = []
var _l_区块探索: Array = []
var _l_子弹: Array = []
var _l_获得buff缓存: Array = []
var _l_敌人buff替换: Array = []
var _l_计数单位: Array = ["", "万", "亿", "兆", "京", "垓", "秭", "穰", "沟", "涧", "正", "载", "极", "恒河沙", "阿僧祗", "那由他", "不可思议", "无量", "大数"]

# —— 屏幕表（K4 屏幕名 -> Godot 场景路径），转换器生成 ——
var 当前屏幕: String = ""
var 当前背景: String = ""
## ★声音编号表★：编号 = 本表顺序（1 开始），对应 K4 界面上的 "1.倒水声 / 2.猫叫"
var 声音顺序: Array = []

const 屏幕表 = {
	"背景": "res://背景/背景.tscn",
}

func 屏幕路径(_名: String) -> String:
	if 屏幕表.has(_名):
		return 屏幕表[_名]
	return ""

# —— 游戏屏幕容器（转换器生成；主场景就是 全局/游戏屏幕.tscn）——
signal 屏幕切换(名: String)
var 游戏屏幕: Node = null
var 屏幕节点: Dictionary = {}
var 屏幕顺序: Array = ["背景"]

## ★「下一屏 / 上一屏」★ —— K4 的「当前屏幕」取值块有两种特殊值
##   （`__next_scene` / `__prev_scene`，见 emit.js 的 屏幕取值()）。
##   按 屏幕顺序 循环；认不出当前屏幕时退回第一个。
func 下一屏幕() -> String:
	return _相邻屏幕(1)

func 上一屏幕() -> String:
	return _相邻屏幕(-1)

func _相邻屏幕(_步: int) -> String:
	var n = 屏幕顺序.size()
	if n == 0:
		return 当前屏幕
	var i = 屏幕顺序.find(当前屏幕)
	if i < 0:
		i = 0
	return String(屏幕顺序[wrapi(i + _步, 0, n)])

## 屏幕根脚本 _ready 时登记自己
func 登记屏幕(_名: String, _节点: Node) -> void:
	屏幕节点[_名] = _节点

## 这个节点是不是"当前正在显示的屏幕"（帽子基类用它做屏幕限定）
func 屏幕是否当前(_节点: Node) -> bool:
	if _节点 == null:
		return false
	var 现 = 屏幕节点.get(当前屏幕, null)
	if 现 == null:
		return true          # 还没登记 / 不走容器（单独跑一个屏幕场景）→ 不拦
	return _节点 == 现

## 切到某个屏幕：只改可见性 + 当前屏幕名 + 画布指向，**不换场景**
## ★K4 的运行组语义（用户确认）★：
##   切走 = 该屏幕里**非全局**帽子的运行中协程「即走即取消」（不留后台循环）；
##   切进 = 调用它们的 屏幕激活()，「当切换到当前屏幕」在这里重新跑一轮。
func 切换屏幕到(_名: String) -> void:
	var 目标 = 屏幕节点.get(_名, null)
	if 目标 == null:
		push_warning("切换屏幕：找不到屏幕 " + _名)
		return
	var 旧 = 屏幕节点.get(当前屏幕, null)
	if 旧 != null and 旧 != 目标 and is_instance_valid(旧):
		_通知屏幕(旧, false)          # 切走：取消非全局帽子的协程
	当前屏幕 = _名
	for k in 屏幕节点.keys():
		var n = 屏幕节点[k]
		if n != null and is_instance_valid(n) and n is CanvasItem:
			(n as CanvasItem).visible = (str(k) == _名)
	var 画 = 目标.get_node_or_null("屏幕绘制")
	if 画 != null:
		K4Canvas.设置画布(画)
	屏幕切换.emit(_名)
	if is_instance_valid(目标):
		_通知屏幕(目标, true)         # 切进：需要重开的帽子重新跑一轮

## 屏幕生命周期：_激活=false → 该屏幕被切走（取消运行中协程）；true → 它成为当前屏幕
func _通知屏幕(_屏幕: Node, _激活: bool) -> void:
	if _屏幕 == null or not is_instance_valid(_屏幕):
		return
	for n in _屏幕.find_children("*", "", true, false):
		if n is 帽子基类:
			if _激活:
				(n as 帽子基类).屏幕激活()
			else:
				(n as 帽子基类).取消运行()

# —— 超长列表初值：从外置文件读（K4Text 会缓存，只读一次盘）——
func _ready() -> void:
	_l_加成 = K4Text.读取列表("全局/文本/列表1.txt")

const 变量前缀 = "_v_"
const 列表前缀 = "_l_"

# 兜底容器：没插入真实成员的变量放这里（转换器已插入的走成员）
var _变量: Dictionary = {}
var _列表: Dictionary = {}

func 取值(_p_名: String) -> Variant:
	if _变量.has(_p_名):
		return _变量[_p_名]
	var _p_成员: String = 变量前缀 + _p_名
	if _脚本有(_p_成员):
		return get(_p_成员)
	if _列表.has(_p_名):
		return _列表[_p_名]
	return null

func 设置(_p_名: String, _p_值: Variant) -> void:
	if _变量.has(_p_名):
		_变量[_p_名] = _p_值
		return
	var _p_成员: String = 变量前缀 + _p_名
	if _脚本有(_p_成员):
		set(_p_成员, _p_值)
		return
	_变量[_p_名] = _p_值

func 列表(_p_名: String) -> Array:
	if _列表.has(_p_名):
		return _列表[_p_名]
	var _p_成员: String = 列表前缀 + _p_名
	if _脚本有(_p_成员):
		var _p_旧 = get(_p_成员)
		if _p_旧 is Array:
			return _p_旧
	var _p_新: Array = []
	_列表[_p_名] = _p_新
	if _脚本有(_p_成员):
		set(_p_成员, _p_新)
	return _p_新

func _脚本有(_p_名: String) -> bool:
	var _p_脚本 = get_script()
	if _p_脚本 == null:
		return false
	for _p_项 in _p_脚本.get_script_property_list():
		if String(_p_项["name"]) == _p_名:
			return true
	return false

func 有(_p_名: String) -> bool:
	if _变量.has(_p_名) or _列表.has(_p_名):
		return true
	return _脚本有(变量前缀 + _p_名) or _脚本有(列表前缀 + _p_名)
