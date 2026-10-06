# K4 转换结果全量检查器（临时放进被检查工程根目录运行）
#   用法： godot --headless --path <工程> res://_检查.tscn
# 为什么必须带场景跑：--script / --check-only 模式**不注册 autoload**，
# 于是 K4Global/K4Canvas/K4Bus 全部 "Identifier not found"，检查结果全是假的。
# 作用：load() 每一个 .gd 与 .tscn —— 只跑主场景的验证会漏掉这些。
extends Node

func _ready() -> void:
	call_deferred("_run")

func _run() -> void:
	var scripts: Array = []
	var scenes: Array = []
	var stack: Array = ["res://"]
	while not stack.is_empty():
		var d: String = stack.pop_back()
		var da := DirAccess.open(d)
		if da == null:
			continue
		da.list_dir_begin()
		var n := da.get_next()
		while n != "":
			if n.begins_with("."):
				n = da.get_next()
				continue
			var p: String = ("res://" + n) if d == "res://" else d.path_join(n)
			if da.current_is_dir():
				stack.push_back(p)
			elif n.ends_with(".gd"):
				scripts.append(p)
			elif n.ends_with(".tscn"):
				scenes.append(p)
			n = da.get_next()
		da.list_dir_end()
	scripts.sort()
	scenes.sort()
	var bad := 0
	# 注意：解析失败的 GDScript 依然会返回一个资源对象（不是 null），
	# 所以判定要看 can_instantiate()；而真正的报错文本仍然打在 stderr 上，
	# 验证脚本以 stderr 的 "Parse Error / Compile Error / Failed to load" 为准。
	for p in scripts:
		var r = load(p)
		if r == null or not r.can_instantiate():
			bad += 1
			print("FAIL_SCRIPT " + p)
	for p in scenes:
		var r2 = load(p)
		if r2 == null:
			bad += 1
			print("FAIL_SCENE " + p)
			continue
		# 光 load() 不够：依赖场景是**延迟加载**的，"某个节点没写 parent="
		# 这种错在 load() 阶段不报，只有 instantiate() 才会暴露
		# （编辑器打开场景 = instantiate，所以只有编辑器会弹"场景似乎无效/损坏"）。
		var inst = r2.instantiate()
		if inst == null:
			bad += 1
			print("FAIL_INSTANTIATE " + p)
		else:
			inst.free()
	print("CHECK scripts=%d scenes=%d fail=%d" % [scripts.size(), scenes.size(), bad])
	get_tree().quit(1 if bad > 0 else 0)
