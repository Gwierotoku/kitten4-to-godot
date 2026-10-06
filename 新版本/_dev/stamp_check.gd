## 临时检验脚本（不属于交付物，验证完即删）
## 印章custom测试：绿旗 → 用骰子造型画 Z 字型（图像印章）→ 显示"头像"造型（K4 里缩放为 0）
## 预期：画面上只有 Z 字型，**不该看到头像**（头像造型只有 3×4 像素）
## ⚠ 非 headless 跑（截图要真实渲染）
extends Node

func _存图(_名: String) -> void:
	await RenderingServer.frame_post_draw
	var 图 := get_viewport().get_texture().get_image()
	print("STAMP 存图 %s → 错误码 %d" % [_名, 图.save_png("res://" + _名 + ".png")])

func _ready() -> void:
	print("STAMP ===== 开始 =====")
	await get_tree().process_frame
	var 容器: Node = (load("res://全局/游戏屏幕.tscn") as PackedScene).instantiate()
	get_tree().root.add_child(容器)
	await get_tree().process_frame
	await get_tree().process_frame

	var 屏: Node = 容器.get_node_or_null("背景")
	var 骰子: Node = 屏.get_node_or_null("基础角色层/骰子") if 屏 != null else null
	var 绿旗: Node = 骰子.get_node_or_null("当开始被点击时_1") if 骰子 != null else null
	var 画布: Node = 屏.get_node_or_null("屏幕绘制") if 屏 != null else null
	print("STAMP 画布=%s 骰子=%s 绿旗帽=%s" % [str(画布), str(骰子), str(绿旗)])
	if 骰子 == null or 绿旗 == null:
		print("STAMP [失败] 找不到节点")
		get_tree().quit()
		return

	# 逐个造型的纹理尺寸（检查 custom 配置）
	var 顺序: Array = 骰子.call("_造型顺序")
	for i in 顺序.size():
		骰子.call("设置造型", String(顺序[i]))
		var 纹: Texture2D = 骰子.call("当前纹理")
		print("STAMP   造型 %-8s 纹理尺寸=%s  customs.scale=%s" % [
			str(顺序[i]), str(纹.get_size()) if 纹 != null else "无", str(骰子.get_node("customs").get("scale"))])

	await _存图("_截图_印章_跑之前")
	# ⚠ 不要手动 set 坐标 / 手动 启动()：绿旗帽子在场景加载后会**自动触发**，
	#   中途插手会把那一轮打断（实测：头两个印章从 K4 真实初始位置出发、
	#   其余从我 set 的 (0,0) 出发 → Z 错位、头两个"位置不对"）。
	#   这里只等它自己跑完。
	for i in 150:
		await get_tree().process_frame
	print("STAMP 跑完：当前造型=%s 位置=(%s, %s) 方向=%s 画布指令=%d" % [
		str(骰子.get("k4_costume_name")), str(骰子.get("k4_x")), str(骰子.get("k4_y")),
		str(骰子.get("k4_direction")),
		(画布.get("指令") as Array).size() if 画布 != null else -1])
	# ★坐标换算自检：K4 坐标 → 画布本地坐标，看 x / y 的单调方向对不对★
	print("STAMP 视口=%s" % str(get_viewport().get_visible_rect().size))
	print("STAMP 画布 position=%s scale=%s rotation=%s" % [
		str(画布.get("position")), str(画布.get("scale")), str(画布.get("rotation"))])
	print("STAMP 角色层 position=%s" % str(屏.get_node("基础角色层").get("position")))
	for 点 in [Vector2(0, 0), Vector2(100, 0), Vector2(0, 100), Vector2(0, -100)]:
		print("STAMP 换算 k4%s → 画布本地 %s" % [str(点), str(骰子.call("k4到舞台", 点))])
	# 把 18 条指令的位置摊出来（画布本地坐标 + 屏幕坐标）
	var 指令: Array = 画布.get("指令") if 画布 != null else []
	for i in mini(18, 指令.size()):
		var 条 = 指令[i]
		var 本 := Vector2.ZERO
		if 条.get("xform") is Transform2D:
			本 = (条.get("xform") as Transform2D).origin
		var 尺 := "?"
		if 条.get("tex") is Texture2D:
			尺 = str((条.get("tex") as Texture2D).get_size())
		print("STAMP   指令 %2d: 画布本地=%s 屏幕=%s 纹理=%s" % [
			i, str(本), str(画布.global_position + 本), 尺])
	await _存图("_截图_印章_跑之后")
	print("STAMP ===== 结束 =====")
	get_tree().quit()
