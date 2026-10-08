## 临时检验脚本（不属于交付物）：切屏与云变量持久化测试
## 期望：启动后屏幕在 1→2→3→1 之间来回切换（K4Global.当前屏幕 依次变化）
##      —— K4 里"切到下一屏 / 上一屏"用的是 `get_current_scene` 的
##         `__next_scene` / `__prev_scene` 特殊值。
## ⚠ `root` 在 `_ready` 期间会**拒绝 add_child**（实测：容器没进树、
##    屏幕节点一个都没登记、当前屏幕恒为空）—— 必须先 await 一帧。
extends Node

const 总帧数 := 900          # 15 秒 @60fps

var 帧 := 0
var 序列: Array = []

func _ready() -> void:
	print("CYCLE ===== 开始 =====")
	# ★用容器自己发的「屏幕切换」信号记录★：切屏可以在**同一帧内**连锁发生
	#   （切到 A → A 的帽子立刻切到 B），只在 _process 里采样会漏掉中间那一步。
	K4Global.屏幕切换.connect(_切了)
	await get_tree().process_frame
	var 容器: Node = (load("res://全局/游戏屏幕.tscn") as PackedScene).instantiate()
	get_tree().root.add_child(容器)
	print("CYCLE 容器就绪：游戏屏幕=%s  屏幕节点=%s  当前屏幕=%s" % [
		str(K4Global.游戏屏幕), str(K4Global.屏幕节点.keys()), String(K4Global.当前屏幕)])

func _切了(名: String) -> void:
	序列.append(名)
	print("CYCLE [切换] %d 次  %s  (帧 %d)" % [序列.size(), 名, Engine.get_process_frames()])

func _process(_d: float) -> void:
	帧 += 1
	var 现 := String(K4Global.当前屏幕)
	if 序列.is_empty() or String(序列[序列.size() - 1]) != 现:
		序列.append(现)
		print("CYCLE 帧 %d (%.2f s)  当前屏幕 = %s" % [帧, 帧 / 60.0, 现])
	if 帧 >= 总帧数:
		var 串 := ""
		for i in 序列.size():
			if i > 0:
				串 += " → "
			串 += String(序列[i])
		print("CYCLE 序列 = " + 串)
		var 切换数 := 序列.size() - 1
		if 切换数 >= 4:
			print("CYCLE [通过] 发生 %d 次屏幕切换（期望 1→2→3→1 循环）" % 切换数)
		else:
			print("CYCLE [失败] 只发生 %d 次屏幕切换" % 切换数)
		get_tree().quit()
