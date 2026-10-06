extends Node
## K4-GENERATED 运行时库 · 超长文本读取器
##
## 这是 autoload，名字固定为 K4Text（必须 ASCII）。
##
## 为什么需要它：
##   K4 的文本积木可以塞进**整块数据**（谱面文件、存档串…），实际见过一个字面量
##   800 万字符。这种字符串内联进 .gd 的话，编辑器一打开那个脚本就卡死。
##   所以转换器把超过 1024 字的文本单独写进
##       <角色目录>/文本/<编号>.txt
##   代码里只留一行：
##       K4Text.读取("背景/舞台/文本/1.txt")
##
## 为什么要经过这一层、而不是直接写 FileAccess.get_file_as_string()：
##   · 一次调用读一次盘。万一那个表达式落在循环里（K4 里完全可能），
##     每次迭代都要重新读 8 MB 文件。这里读一次就缓存住。
##   · 路径统一按「项目内相对路径」写，不用在每个调用点重复 res:// 前缀。
##   · 读失败集中在这里报错 —— 不然只是一个莫名其妙的空字符串。
##
## ⚠ 导出提醒：.txt 不是 Godot 资源，**导出 exe/apk 时默认不会打进 pck**。
##   在「项目 → 导出 → 资源 → 导出非资源文件/文件夹的过滤器」里加上
##       *.txt
##   （或直接写 文本/*.txt）后再导出，否则运行时读出来是空串。

## 路径 -> 内容。命中后不再读盘。
var _缓存: Dictionary = {}


## 读一个**项目内相对路径**（也接受 res:// 或 user:// 开头的完整路径）。
## 路径为空或读不到时返回空字符串，并只报一次错。
func 读取(路径: String) -> String:
	if 路径.is_empty():
		return ""
	if _缓存.has(路径):
		return _缓存[路径]

	var 全路径 := 路径
	if not 全路径.begins_with("res://") and not 全路径.begins_with("user://"):
		全路径 = "res://" + 全路径

	var 文件 := FileAccess.open(全路径, FileAccess.READ)
	if 文件 == null:
		push_error("K4Text：打不开 %s（错误码 %d）。可能是导出时没有把 *.txt 打进 pck。" %
			[全路径, FileAccess.get_open_error()])
		_缓存[路径] = ""
		return ""

	var 文本 := 文件.get_as_text()
	文件.close()
	_缓存[路径] = 文本
	return 文本


## 内容是否已经读过（调试用；不触发读盘）
func 已加载(路径: String) -> bool:
	return _缓存.has(路径)


## 读一个**外置的列表初值**（内容是 JSON 数组文本），返回 Array。
## K4 的列表初值可能很大（成对数据表），转换器把它落到 文本/列表N.txt。
## 用 JSON 而不是"一行一项"：列表项有数字也有字符串，按行存会把 1 和 "1" 混掉。
func 读取列表(路径: String) -> Array:
	var 文本 := 读取(路径)
	if 文本.strip_edges().is_empty():
		return []
	var 数据: Variant = JSON.parse_string(文本)
	if 数据 is Array:
		return 数据
	push_error("K4Text：%s 不是 JSON 数组（列表初值解析失败），按空列表处理" % 路径)
	return []


## 丢掉缓存。（理论上用不上 —— 文本文件在运行期不会变。）
func 清空缓存() -> void:
	_缓存.clear()
