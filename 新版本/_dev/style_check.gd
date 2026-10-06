## 临时检验脚本（不属于交付物，验证完即删）
## 验证 customs 改成 AnimatedSprite2D 之后：
##   ① 造型表/偏移表被正确读入（k4_costumes / _造型偏移）
##   ② 切造型 = 换帧 + **套用该造型自己的 pivot 偏移**（位置不能错）
##   ③ 下一个造型 / 按编号 / 造型编号 都还对
##   ④ 纹理相关的功能（包围盒、像素掩码、图章）不报错
##   ⑤ 节点数比"每造型一个 Sprite2D"少
extends Node

var 通过 := 0
var 失败 := 0

func 断言(_标题: String, _条件: bool, _详情: String) -> void:
	if _条件:
		通过 += 1
		print("STYLE [通过] %s  %s" % [_标题, _详情])
	else:
		失败 += 1
		print("STYLE [失败] %s  %s" % [_标题, _详情])

func _ready() -> void:
	print("STYLE ===== 开始 =====")
	await get_tree().process_frame
	var 场: Node = (load("res://背景/背景.tscn") as PackedScene).instantiate()
	get_tree().root.add_child(场)
	await get_tree().process_frame
	await get_tree().process_frame

	var 角: Node = 场.get_node_or_null("基础角色层/customs测试")
	if 角 == null:
		print("STYLE [失败] 找不到角色 customs测试")
		get_tree().quit()
		return
	var 精: Node = 角.get_node_or_null("customs")
	断言("① customs 是 AnimatedSprite2D", 精 is AnimatedSprite2D, str(精))
	断言("① customs 下没有子节点（节点树被压平）", 精 != null and 精.get_child_count() == 0,
		"子节点数=%d" % (精.get_child_count() if 精 else -1))
	var 顺序表: Array = 角.call("_造型顺序") if 角.has_method("_造型顺序") else []
	var 偏移表: Array = 角.call("_造型偏移") if 角.has_method("_造型偏移") else []
	print("STYLE 造型顺序 = %s" % str(顺序表))
	print("STYLE 造型偏移 = %s" % str(偏移表))
	断言("① 造型表读入正确", 角.get("k4_costumes").size() == 顺序表.size() and 顺序表.size() == 5,
		"k4_costumes=%d" % 角.get("k4_costumes").size())
	# ⚠ 这个角色自带「重复执行 → 下一个造型」的帽子，造型一直在变 ——
	#   所以不能断言"初始造型 == 第 0 个"，要断言"当前造型名合法、且帧号与它一致"。
	var 当前名 := str(角.get("k4_costume_name"))
	断言("① 当前造型名是合法造型（帧号与名字一致）",
		顺序表.has(当前名) and int(精.get("frame")) == int(角.get("k4_costumes")[当前名]),
		"当前=%s 帧=%d" % [当前名, int(精.get("frame"))])

	# ② 逐个造型切过去：帧号 + 偏移必须与表一致
	for i in 顺序表.size():
		角.call("设置造型", String(顺序表[i]))
		var 帧: int = int(精.get("frame"))
		var 位: Vector2 = 精.get("position")
		var 应位: Vector2 = 偏移表[i]
		断言("② 切到「%s」：帧=%d 偏移=%s" % [str(顺序表[i]), i, str(应位)],
			帧 == i and 位.is_equal_approx(应位),
			"实际 帧=%d 偏移=%s" % [帧, str(位)])

	# ③ 下一个造型 / 按编号 / 造型编号
	角.call("设置造型", String(顺序表[0]))
	角.call("下一个造型")
	断言("③ 下一个造型 → 帧 1", int(精.get("frame")) == 1, "帧=%d" % int(精.get("frame")))
	角.call("设置造型", 3)
	断言("③ 按编号 3 → 帧 2（K4 编号从 1 开始）", int(精.get("frame")) == 2, "帧=%d" % int(精.get("frame")))
	var 编号: Variant = 角.call("角色属性", "2", "自己")
	断言("③ 造型编号 = 3（1 基）", int(编号) == 3, "编号=%s" % str(编号))
	var 名: Variant = 角.call("角色属性", "4", "自己")
	断言("③ 造型名称 = 当前造型名", str(名) == str(顺序表[2]), "名称=%s" % str(名))

	# ④ 纹理相关功能
	var 纹: Variant = 角.call("当前纹理")
	断言("④ 当前纹理拿得到（第 3 帧）", 纹 != null and 纹 is Texture2D, str(纹))
	var 盒: Rect2 = 角.call("包围盒")
	断言("④ 包围盒非空", 盒.size.x > 0.0 and 盒.size.y > 0.0, str(盒))
	if 纹 is Texture2D:
		断言("④ 包围盒尺寸 = 当前帧纹理尺寸（× 角色缩放）",
			盒.size.is_equal_approx((纹 as Texture2D).get_size() * 角.get("scale")),
			"盒=%s 纹理=%s" % [str(盒.size), str((纹 as Texture2D).get_size())])
	角.call("图章")          # 画笔图章：不应报错
	print("STYLE 图章调用完成（无错误即通过）")

	print("STYLE ===== 结束：通过 %d，失败 %d =====" % [通过, 失败])
	get_tree().quit()
