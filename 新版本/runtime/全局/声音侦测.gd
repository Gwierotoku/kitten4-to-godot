# =============================================================================
# K4Voice.gd  ——  autoload 名 `K4Voice`，extends Node
# =============================================================================
#
# 职责：K4 的「声音侦测」家族（查表4 带出来的缺口）
#   · 「开启 / 关闭 声音侦测」  enable_voice_detection（fields.state = open | close）
#   · 「当前 音量」            get_voice_volume（0-100）
#
# ★为什么这里必须新增一个 autoload —— 也就是"项目结构要改一下"的那一处★：
#   麦克风采集挂在**一条音频总线**上，而总线是 AudioServer 的全局状态。
#   角色节点会随屏幕切换被销毁，把总线/效果挂在角色身上会重复建、会漏；
#   autoload 天然跨场景存活，正好当这个"全局声音侦测器"。
#
# 另外 project.godot 需要打开输入驱动（转换器已自动写入）：
#     [audio]
#     driver/enable_input=true
#   不开的话麦克风拿不到数据（Godot 默认关闭输入，避免无谓的设备占用）。
#
# 采样：每 _process 从 AudioEffectCapture 的缓冲取样本算 RMS，
#       再线性映射到 0-100（RMS 通常 0~0.3，所以乘 300 做压缩）。
# =============================================================================

extends Node

const 总线名 := "K4VoiceCapture"

var _总线: int = -1
var _采集: AudioEffectCapture = null
var _启用 := false
var _音量: float = 0.0
var _已建总线 := false

## K4 的「开启 / 关闭 声音侦测」
func 设置启用(_开: bool) -> void:
	if _开 and not _已建总线:
		_建总线()
	_启用 = _开
	if _总线 >= 0 and _总线 < AudioServer.bus_count:
		AudioServer.set_bus_mute(_总线, not _启用)
	if not _启用:
		_音量 = 0.0

func _建总线() -> void:
	_已建总线 = true
	_总线 = AudioServer.get_bus_index(总线名)
	if _总线 < 0:
		_总线 = AudioServer.bus_count
		AudioServer.add_bus(_总线)
		AudioServer.set_bus_name(_总线, 总线名)
	_采集 = AudioEffectCapture.new()
	AudioServer.add_bus_effect(_总线, _采集)
	AudioServer.set_bus_mute(_总线, true)      # 默认静音，开启时才收音

func _process(_delta: float) -> void:
	if not _启用 or _采集 == null:
		return
	var 帧 := _采集.get_frames_available()
	if 帧 <= 0:
		return
	var 缓冲 := _采集.get_buffer(帧)
	if 缓冲.is_empty():
		return
	var 平方和 := 0.0
	for v in 缓冲:
		平方和 += v.x * v.x
	var rms := sqrt(平方和 / float(缓冲.size()))
	_音量 = clampf(rms * 300.0, 0.0, 100.0)

func 当前音量() -> float:
	return _音量

func 已启用() -> bool:
	return _启用
