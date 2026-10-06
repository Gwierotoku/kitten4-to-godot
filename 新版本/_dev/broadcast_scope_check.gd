## 临时检验脚本（不属于交付物，验证完即删）
## 验证「广播每个屏幕各自独立」+「同屏广播照常工作」
##   做法：装**完整屏幕 A**（里面 n1 是绿旗，会广播"测试等待"），
##         再单独把**屏幕 B 的 n3**（收"测试等待"的角色）挂到另一个屏幕根下。
##   期望：A 的 n1 广播 → A 的 n3 被触发（同屏正常）
##                        → B 的 n3 **不被触发**（跨屏隔离）
extends Node

var 通过 := 0
var 失败 := 0

func 断言(_标题: String, _条件: bool, _详情: String) -> void:
	if _条件:
		通过 += 1
		print("SCOPE [通过] %s  %s" % [_标题, _详情])
	else:
		失败 += 1
		print("SCOPE [失败] %s  %s" % [_标题, _详情])

func _ready() -> void:
	print("SCOPE ===== 开始 =====")
	# ★必须等一帧★：root 在"setting up children"期间拒绝 add_child
	#   （否则报 "Parent node is busy setting up children" 且两个屏幕都挂不上，
	#    第一版就是这么误判的）。
	await get_tree().process_frame
	# ★两个"屏幕"必须各自直接挂在 root 下★ —— 运行时的屏幕根就是
	#   `get_tree().root` 的直接子节点（角色基类.屏幕根() 这么定义的）。
	#   如果把它们都挂在检查脚本节点下，两者会被解析成同一个屏幕根，
	#   测出来的"隔离"就没有意义了。
	var 根 := get_tree().root
	# 屏幕 A：完整场景（含绿旗角色 n1）
	var 场A: Node = (load("res://背景/背景.tscn") as PackedScene).instantiate()
	根.add_child(场A)
	# 屏幕 B：只挂一个"收 测试等待"的角色（它自己不会广播）
	var 屏B := Node2D.new()
	屏B.name = "背景_1_"
	根.add_child(屏B)
	var n3B: Node = (load("res://背景_1_/n3_1_/n3_1_.tscn") as PackedScene).instantiate()
	屏B.add_child(n3B)

	# 等 A 的 n1 把"测试等待"广播出去（帽子 _ready 后一帧启动），再看两边状态
	for i in 5:
		await get_tree().process_frame

	var 帽A3: Node = 场A.get_node_or_null("基础角色层/n3/当接收到广播_测试等待_1")
	var 帽B3: Node = n3B.get_node_or_null("当接收到广播_测试等待_1")
	print("SCOPE 帽A3=%s  帽B3=%s" % [str(帽A3), str(帽B3)])
	断言("同屏广播仍工作：A 的 n3 帽子已在运行", 帽A3 != null and 帽A3.get("_运行中") == true,
		"_运行中=%s" % str(帽A3.get("_运行中") if 帽A3 else "?"))
	断言("跨屏隔离：B 的 n3 帽子**没有**被 A 的广播惊动",
		帽B3 != null and 帽B3.get("_运行中") == false,
		"_运行中=%s" % str(帽B3.get("_运行中") if 帽B3 else "?"))

	# 再加一个"反向"验证：从 B 自己的屏幕里广播，B 的 n3 必须被触发
	var 角B: Node = n3B
	角B.call("广播", "测试等待")
	await get_tree().process_frame
	断言("同屏（B 自己）广播能触发 B 的 n3", 帽B3 != null and 帽B3.get("_运行中") == true,
		"_运行中=%s" % str(帽B3.get("_运行中") if 帽B3 else "?"))

	print("SCOPE ===== 结束：通过 %d，失败 %d =====" % [通过, 失败])
	get_tree().quit()
