## 脚本加载耗时剖析（不属于交付物）
##   逐个 load() 工程里的 .gd，打印各自的加载/编译耗时（降序）。
##   用途：定位"启动慢"到底被哪个脚本吃掉，决定生成器该怎么拆/该怎么减。
## ⚠ 用 `=` 而不是 `:=` 接 load()（返回 Variant 会被当成警告错误）。
extends Node

const 目标 := [
	"res://全局/角色自定义积木.gd",
	"res://全局/角色自带积木.gd",
	"res://全局/角色基类.gd",
	"res://全局/帽子基类.gd",
	"res://全局/角色变量.gd",
	"res://全局/全局变量.gd",
	"res://全局/广播总线.gd",
	"res://全局/画布调度.gd",
	"res://背景/屏幕绘制.gd",
	"res://背景/画笔/当开始被点击时_1.gd",
	"res://背景/画笔/画笔.gd",
]

func _ready() -> void:
	print("LOAD ===== 开始逐个 load =====")
	var 结果: Array = []
	for 路 in 目标:
		if not ResourceLoader.exists(路):
			print("LOAD   %-46s 不存在" % 路)
			continue
		var t0 := Time.get_ticks_msec()
		var r = load(路)
		var 用 := Time.get_ticks_msec() - t0
		print("LOAD   %-46s %6d ms  %s" % [路, 用, "OK" if r != null else "失败"])
		结果.append({ "路": 路, "用": 用 })
	print("LOAD ===== 结束 =====")
	get_tree().quit()
