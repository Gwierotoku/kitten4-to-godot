# =============================================================================
# 按键表.gd  ——  K4 按键的**唯一解析真值**
# =============================================================================
# 「当按下 <键>」（帽子_按键）与「按下 <键> 吗 / 松开 <键> 吗」（自带积木）都走这里，
# 避免两套解析各自漏一半。
#
# ## 键名到底有哪几种写法
#
# K4 的按键字段是**十进制键码字符串**（浏览器的 `keyCode`），实测：
#     {"key":"81","key_event_type":"up"}      ← 81 = 'Q'
#     {"key":"37","key_event_type":"down"}    ← 37 = 左方向键
#     {"key":"any","key_event_type":"down"}   ← 任意键
# 转换器把它翻成 `KEY_Q` / `KEY_LEFT` / `any` 写进生成代码（见 core.js 的 keyCodeToName）。
# 但真实项目里这几种都可能出现，所以这里**全都认**：
#
#     ① 空串                     → 未配置（不触发；**不再**当成空格，也不再当成任意键）
#     ② "any" / "任意" / "任意键" → 任意键
#     ③ "81"（十进制，K4 原始）   → 查 K4键码表（★浏览器的 keyCode ≠ Godot 的 Key 枚举★：
#                                   字母数字在 ASCII 上重合，但方向键/回车/Esc/Tab…
#                                   完全不同 —— 必须查表，不能直接当 Godot 键码用）
#     ④ "KEY_Q" / "KEY_LEFT"     → 查名字表，兜底 OS.find_keycode_from_string
#     ⑤ "q" / "Q" / "空格" / "上" / "left" / "space" → 查名字表（大小写不敏感）
#
# ## 为什么大小写要一起认
# K4 的按键不区分 Shift 大小写（`KEY_A` 一个码），用户手改场景时却可能写成 "a" 或 "A"。
#
# ## ★const 里不能放引擎枚举★
# Godot 4 的常量表达式不接受 `KEY_A` 这类引擎枚举（实测直接解析失败），
# 所以两张表都是 `static var`，并在 `_建表()` 里惰性赋值。
# =============================================================================

class_name 按键表
extends RefCounted

## 任意键的别名（统一小写比较）
const 任意别名: Array = ["any", "任意", "任意键", "__any__", "anykey", "any_key"]

static var _已建表: bool = false
static var _名字表: Dictionary = {}     # 小写名字 / 中文 -> Key
static var _K4表: Dictionary = {}       # 浏览器 keyCode 字符串 -> Key

## 惰性建表（第一次用到时执行一次）
static func _建表() -> void:
	if _已建表:
		return
	_已建表 = true

	# ── ① 中文 / 英文别名 ──（键用小写存，查表时统一转小写）
	var 别名 := {
		"空格": KEY_SPACE, "空格键": KEY_SPACE,
		"上": KEY_UP, "上箭头": KEY_UP, "向上": KEY_UP,
		"下": KEY_DOWN, "下箭头": KEY_DOWN, "向下": KEY_DOWN,
		"左": KEY_LEFT, "左箭头": KEY_LEFT, "向左": KEY_LEFT,
		"右": KEY_RIGHT, "右箭头": KEY_RIGHT, "向右": KEY_RIGHT,
		"回车": KEY_ENTER, "回车键": KEY_ENTER, "换行": KEY_ENTER,
		"退格": KEY_BACKSPACE, "退格键": KEY_BACKSPACE,
		"制表": KEY_TAB, "制表符": KEY_TAB,
		"退出": KEY_ESCAPE, "上档": KEY_SHIFT, "控制": KEY_CTRL, "换挡": KEY_ALT,
		"删除": KEY_DELETE, "插入": KEY_INSERT,
		"大写锁定": KEY_CAPSLOCK, "起始": KEY_HOME, "结束": KEY_END,
		"上翻页": KEY_PAGEUP, "下翻页": KEY_PAGEDOWN,
	}
	for k in 别名.keys():
		_名字表[String(k).to_lower()] = 别名[k]

	# ── ② 英文键名（Godot 的枚举名小写形式 + 常见别名）──
	#    这些和 KEY_ 枚举名一致，写全是为了不依赖 OS.find_keycode_from_string 的模糊行为
	var 英文 := {
		"space": KEY_SPACE, "spacebar": KEY_SPACE,
		"up": KEY_UP, "down": KEY_DOWN, "left": KEY_LEFT, "right": KEY_RIGHT,
		"enter": KEY_ENTER, "return": KEY_ENTER, "numpad_enter": KEY_KP_ENTER,
		"shift": KEY_SHIFT, "ctrl": KEY_CTRL, "control": KEY_CTRL, "alt": KEY_ALT,
		"escape": KEY_ESCAPE, "esc": KEY_ESCAPE,
		"tab": KEY_TAB, "backspace": KEY_BACKSPACE,
		"delete": KEY_DELETE, "insert": KEY_INSERT,
		"home": KEY_HOME, "end": KEY_END,
		"pageup": KEY_PAGEUP, "pagedown": KEY_PAGEDOWN,
		"capslock": KEY_CAPSLOCK, "numlock": KEY_NUMLOCK, "scrolllock": KEY_SCROLLLOCK,
		"pause": KEY_PAUSE, "print": KEY_PRINT, "menu": KEY_MENU,
		"minus": KEY_MINUS, "equal": KEY_EQUAL, "comma": KEY_COMMA, "period": KEY_PERIOD,
		"slash": KEY_SLASH, "backslash": KEY_BACKSLASH, "semicolon": KEY_SEMICOLON,
		"apostrophe": KEY_APOSTROPHE, "quoteleft": KEY_QUOTELEFT,
		"bracketleft": KEY_BRACKETLEFT, "bracketright": KEY_BRACKETRIGHT,
		"kp_0": KEY_KP_0, "kp_1": KEY_KP_1, "kp_2": KEY_KP_2, "kp_3": KEY_KP_3,
		"kp_4": KEY_KP_4, "kp_5": KEY_KP_5, "kp_6": KEY_KP_6, "kp_7": KEY_KP_7,
		"kp_8": KEY_KP_8, "kp_9": KEY_KP_9,
		"kp_add": KEY_KP_ADD, "kp_subtract": KEY_KP_SUBTRACT,
		"kp_multiply": KEY_KP_MULTIPLY, "kp_divide": KEY_KP_DIVIDE,
		"kp_period": KEY_KP_PERIOD,
	}
	for k in 英文.keys():
		_名字表[String(k)] = 英文[k]

	# ── ③ 字母 / 数字（Godot 里 KEY_A..KEY_Z、KEY_0..KEY_9 与 ASCII 连续）──
	var 字母 := "abcdefghijklmnopqrstuvwxyz"
	for i in 字母.length():
		var 码: int = KEY_A + i
		var ch := 字母[i]
		_名字表[ch] = 码                    # 小写键（查表时统一 lowercase）
		_名字表[ch.to_upper()] = 码          # 大写也存一份（有人直接拿原串查）
	var 数字 := "0123456789"
	for i in 数字.length():
		_名字表[数字[i]] = KEY_0 + i

	# ── ④ 符号键（ASCII 与 Godot Key 重合）──
	for ch in "-=[]\\;',./`":
		_名字表[ch] = ch.unicode_at(0)

	# ── ⑤ F1..F12（Godot 里连续）──
	for i in 12:
		_名字表["f" + str(i + 1)] = KEY_F1 + i

	# ── ⑥ K4/浏览器 keyCode → Godot Key ──
	#    ★只有字母数字在 ASCII 上重合，其余必须查这张表★
	#    （例：浏览器 13=回车 / 37=左方向，而 Godot 的 KEY_ENTER=4194309、KEY_LEFT=4194319）
	_K4表 = {
		"8": KEY_BACKSPACE, "9": KEY_TAB, "12": KEY_CLEAR, "13": KEY_ENTER,
		"16": KEY_SHIFT, "17": KEY_CTRL, "18": KEY_ALT, "19": KEY_PAUSE, "20": KEY_CAPSLOCK,
		"27": KEY_ESCAPE, "32": KEY_SPACE, "33": KEY_PAGEUP, "34": KEY_PAGEDOWN,
		"35": KEY_END, "36": KEY_HOME, "37": KEY_LEFT, "38": KEY_UP,
		"39": KEY_RIGHT, "40": KEY_DOWN, "42": KEY_PRINT,
		"45": KEY_INSERT, "46": KEY_DELETE, "47": KEY_HELP,
		"91": KEY_META, "92": KEY_META, "93": KEY_MENU,
		"112": KEY_F1, "113": KEY_F2, "114": KEY_F3, "115": KEY_F4, "116": KEY_F5,
		"117": KEY_F6, "118": KEY_F7, "119": KEY_F8, "120": KEY_F9, "121": KEY_F10,
		"122": KEY_F11, "123": KEY_F12,
		"144": KEY_NUMLOCK, "145": KEY_SCROLLLOCK,
		"186": KEY_SEMICOLON, "187": KEY_EQUAL, "188": KEY_COMMA, "189": KEY_MINUS,
		"190": KEY_PERIOD, "191": KEY_SLASH, "192": KEY_QUOTELEFT,
		"219": KEY_BRACKETLEFT, "220": KEY_BACKSLASH, "221": KEY_BRACKETRIGHT,
		"222": KEY_APOSTROPHE,
		"96": KEY_KP_0, "97": KEY_KP_1, "98": KEY_KP_2, "99": KEY_KP_3, "100": KEY_KP_4,
		"101": KEY_KP_5, "102": KEY_KP_6, "103": KEY_KP_7, "104": KEY_KP_8, "105": KEY_KP_9,
		"106": KEY_KP_MULTIPLY, "107": KEY_KP_ADD, "109": KEY_KP_SUBTRACT,
		"110": KEY_KP_PERIOD, "111": KEY_KP_DIVIDE,
	}

# -----------------------------------------------------------------------------
# 查询
# -----------------------------------------------------------------------------

## 是不是「任意键」
static func 是任意键(_名: Variant) -> bool:
	return 任意别名.has(str(_名).strip_edges().to_lower())

## 这个键名能不能解析出具体按键（空 / 不认识 → false）
static func 是已配置(_名: Variant) -> bool:
	var 名 := str(_名).strip_edges()
	if 名 == "":
		return false
	if 是任意键(名):
		return true
	return 解析(名) != KEY_NONE

## 键名 → Godot 的 Key 码；认不出来返回 KEY_NONE
##   ⚠ 「任意键」没有具体码，返回 KEY_NONE（用 是任意键() 单独判断）
static func 解析(_名: Variant) -> int:
	var 名 := str(_名).strip_edges()
	if 名 == "" or 是任意键(名):
		return KEY_NONE
	_建表()

	# ① 十进制（K4 原始 keyCode：字母数字与 Godot 重合，其余查表）
	if 名.is_valid_int():
		if _K4表.has(名):
			return int(_K4表[名])
		var n := int(名)
		if (n >= 65 and n <= 90) or (n >= 48 and n <= 57):
			return n
		return KEY_NONE

	# ② KEY_XXX
	var 大 := 名.to_upper()
	if 大.begins_with("KEY_"):
		var 短 := 大.substr(4).to_lower()
		if _名字表.has(短):
			return int(_名字表[短])
		var 码 := OS.find_keycode_from_string(大)
		return 码 if 码 != KEY_NONE else KEY_NONE

	# ③ 名字表（中文 / 英文 / 单字符，大小写不敏感）
	var 低 := 名.to_lower()
	if _名字表.has(低):
		return int(_名字表[低])
	if _名字表.has(名):
		return int(_名字表[名])

	# ④ 多字符单词：交给引擎兜底（"Left" / "Space" 这类）
	if 名.length() > 1:
		var 码2 := OS.find_keycode_from_string(名)
		if 码2 != KEY_NONE:
			return 码2

	# ⑤ 单字符：可打印字符本身就等于 Key 码（ASCII）
	if 名.length() == 1:
		var u := 名.unicode_at(0)
		if u > 0:
			return u
	return KEY_NONE

## 这个键现在按着吗（侦测积木用）
static func 当前按下(_名: Variant) -> bool:
	if 是任意键(_名):
		return Input.is_anything_pressed()
	var 码 := 解析(_名)
	if 码 == KEY_NONE:
		return false
	# 逻辑键码 + 物理键码都问一遍：不同键盘布局下两者可能只有一个对上
	return Input.is_key_pressed(码) or Input.is_physical_key_pressed(码)

## 收到的按键事件是否匹配（帽子触发用）。
##   调用方**先把键名解析好**（`解析()` / `是任意键()`）再传进来 —— 帽子是 `_ready`
##   时编译一次、`_input` 只做整数比较，不必每次按键都解析字符串。
##   _要松开 = false → 只认按下；true → 只认松开（K4 的 key_event_type）
static func 事件匹配(_事件: InputEventKey, _码: int, _是任意: bool, _要松开: bool) -> bool:
	if _事件 == null:
		return false
	# 按下事件 pressed=true；想要"松开"时只认 pressed=false，反之亦然
	if _事件.pressed == _要松开:
		return false
	if _是任意:
		return true
	if _码 == KEY_NONE:
		return false
	return _事件.keycode == _码 or _事件.physical_keycode == _码
