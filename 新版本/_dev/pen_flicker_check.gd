# =============================================================================
# 画笔闪烁实测：统计**相邻帧的画面差异**，找出"整层被刷掉"的尖峰
# =============================================================================
#   用法（★必须非 headless★）：
#       godot --path <工程> --fixed-fps 60 res://_pen_flicker.tscn
#
#   为什么不用"与清屏色不同的像素数"：斗地主用画笔铺满整屏底色，画面上
#   几乎没有"清屏色"，那个判据恒为满值（实测 = 全采样点），量不出东西。
#   改用**帧间差异**：正常绘制每帧只改动画/文字那一小块；一旦"擦掉之后还没画上"
#   被渲染出来，那一帧会有大面积像素与前后帧不同 → 差异尖峰。
#
#   想把问题放大（在快机器上强制"重画跨帧"）：把工程的
#   `全局/角色基类.gd` 里 `const K4_帧warp预算 := 16` 临时改成 `1`。
# =============================================================================
extends Node

const 预热帧数 := 180
const 采样帧数 := 240
const 步长 := 4                 # 采样步长（像素）：全屏逐像素太慢
const 差异阈值 := 24            # 通道差超过它才算"这个点变了"

var 采样序列: Array = []        # 每帧一个 PackedByteArray（采样点的 R/G/B）


func _ready() -> void:
	call_deferred("_run")


func _采样() -> PackedByteArray:
	var 图 := get_viewport().get_texture().get_image()
	if 图 == null:
		return PackedByteArray()
	var 宽 := 图.get_width()
	var 数据 := 图.get_data()
	var 总 := 宽 * 图.get_height()
	var 出 := PackedByteArray()
	出.resize((总 / 步长) * 3)
	var j := 0
	for p in range(0, 总, 步长):
		var i := p * 4
		出[j] = 数据[i]
		出[j + 1] = 数据[i + 1]
		出[j + 2] = 数据[i + 2]
		j += 3
	return 出


func _run() -> void:
	await get_tree().process_frame
	print("FLICKER 预热 %d 帧（等游戏进入绘制循环）…" % 预热帧数)
	for i in 预热帧数:
		await get_tree().process_frame
	for i in 采样帧数:
		await get_tree().process_frame
		await RenderingServer.frame_post_draw
		采样序列.append(_采样())

	var 点数 := 0
	var 差异: Array = []
	for i in range(1, 采样序列.size()):
		var a: PackedByteArray = 采样序列[i - 1]
		var b: PackedByteArray = 采样序列[i]
		点数 = b.size() / 3
		var d := 0
		for k in range(0, b.size(), 3):
			if absi(int(a[k]) - int(b[k])) > 差异阈值 \
				or absi(int(a[k + 1]) - int(b[k + 1])) > 差异阈值 \
				or absi(int(a[k + 2]) - int(b[k + 2])) > 差异阈值:
				d += 1
		差异.append(d)

	var 最大 := 0
	var 合计 := 0
	for v in 差异:
		最大 = maxi(最大, int(v))
		合计 += int(v)
	var 平均 := float(合计) / float(maxi(差异.size(), 1))
	var 尖峰: Array = []
	for i in 差异.size():
		if 点数 > 0 and float(差异[i]) > float(点数) * 0.35:
			尖峰.append(i + 1)
	print("FLICKER 采样 %d 帧  采样点 %d 个/帧" % [采样序列.size(), 点数])
	print("FLICKER 帧间差异  平均=%.0f 个点  最大=%d 个点  最大占比=%.1f%%" % [
		平均, 最大, 100.0 * float(最大) / float(maxi(点数, 1))])
	print("FLICKER 尖峰（差异 > 35%% 采样点）帧数 = %d" % 尖峰.size())
	print("FLICKER 尖峰帧号 = %s" % str(尖峰.slice(0, 40)))
	print("FLICKER 前 30 帧差异 = %s" % str(差异.slice(0, 30)))
	print("FLICKER DONE")
	get_tree().quit(0)
