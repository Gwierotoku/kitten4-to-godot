## 临时检验脚本（不属于交付物）
## 工程：广播协调测试 (2).bcm4
##   a：绿旗 → 重复 5 次 { 发送广播「增加」；等待 0.1 秒 }
##   b：当收到「增加」   → 计数器 += 1 → 等待 2 秒      ← 不重入
##   c①：绿旗 → 发送广播「增加d」**并等待** → 发送广播「增加e」→ 发送广播「增加d」**并等待**
##   c②：绿旗 → 等待 0 秒 → 重复 20 次 { 发送广播「增加d」 }
##   c③：当收到「增加e」 → 重复 20 次 { 发送广播「增加d」 }
##   d：当收到「增加d」   → 计数器d += 1 → 等待 2 秒     ← 不重入
##
## 期望（用户给的答案）：计数器 = 1，计数器d = 2
##   · 计数器=1：a 连发 5 次普通广播，b 第一次 +1 后正忙 2 秒 → 后面 4 次被"不重入"挡掉
##   · 计数器d=2：「并等待」真的等到了 d 跑完 → d 空闲后还能再接一轮
extends Node

const 总帧数 := 900          # 15 秒（--fixed-fps 60）

var 帧 := 0
var 上串 := ""
var 事件: Array = []

func _ready() -> void:
	print("BCOORD ===== 开始 =====")
	var 场: Node = (load("res://全局/游戏屏幕.tscn") as PackedScene).instantiate()
	add_child(场)

func _process(_d: float) -> void:
	帧 += 1
	var a := str(K4Global.get("_v_计数器"))
	var b := str(K4Global.get("_v_计数器d"))
	var 串 := a + "/" + b
	if 串 != 上串:
		事件.append({ "秒": 帧 / 60.0, "a": a, "d": b })
		print("BCOORD 帧 %d (%.3f s)  计数器=%s  计数器d=%s" % [帧, 帧 / 60.0, a, b])
		上串 = 串
	if 帧 >= 总帧数:
		_判定()
		get_tree().quit()

func _判定() -> void:
	var a := float(K4Global.get("_v_计数器"))
	var b := float(K4Global.get("_v_计数器d"))
	print("BCOORD 时序：")
	for 项 in 事件:
		print("        %6.3f s  计数器=%s  计数器d=%s" % [项["秒"], 项["a"], 项["d"]])
	if is_equal_approx(a, 1.0) and is_equal_approx(b, 2.0):
		print("BCOORD [通过] 计数器=%s（期望 1）  计数器d=%s（期望 2）" % [a, b])
	else:
		print("BCOORD [失败] 计数器=%s（期望 1）  计数器d=%s（期望 2）" % [a, b])
