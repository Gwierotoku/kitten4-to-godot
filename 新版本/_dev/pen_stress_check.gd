## 微基准（不属于交付物）：一帧里画 350 个图章 + 350 个文字图章，到底多慢？
##   —— 用来判断"纯画笔作品（每帧重画整张牌桌）"的卡死是**绘制**还是**逻辑**。
## ⚠ 必须**非 headless** 跑（headless 不执行 _draw，测不到东西）。
## 用  --fixed-fps 0（不限帧）跑，读 Engine.get_frames_per_second()。
extends Node2D

const 图章数 := 350
const 文字数 := 350

var 纹: Texture2D = null
var 阶段 := 0
var 帧 := 0
var 阶段帧 := 0
var 阶段用时 := 0.0

func _ready() -> void:
	var p := PlaceholderTexture2D.new()
	p.size = Vector2i(48, 64)
	纹 = p
	print("STRESS ===== 开始（图章 %d + 文字 %d / 帧）=====" % [图章数, 文字数])

func _process(d: float) -> void:
	帧 += 1
	阶段帧 += 1
	阶段用时 += d
	queue_redraw()
	if 阶段帧 >= 120:
		var fps := 阶段帧 / maxf(阶段用时, 0.0001)
		var 名 := "只画图章" if 阶段 == 0 else "图章 + 文字"
		print("STRESS [阶段%d %s]  平均 %.1f FPS  （%.2f ms/帧）" % [阶段, 名, fps, 1000.0 / fps])
		阶段 += 1
		阶段帧 = 0
		阶段用时 = 0.0
		if 阶段 > 1:
			print("STRESS ===== 结束 =====")
			get_tree().quit()

func _draw() -> void:
	for i in 图章数:
		draw_texture(纹, Vector2(20 + (i % 25) * 18, 20 + (i / 25) * 30))
	if 阶段 >= 1:
		for i in 文字数:
			draw_string(ThemeDB.fallback_font, Vector2(20 + (i % 25) * 18, 400 + (i / 25) * 20),
				"10", HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color.BLACK)
