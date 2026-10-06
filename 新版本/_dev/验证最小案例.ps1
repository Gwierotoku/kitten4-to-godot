# =============================================================================
# 验证最小案例.ps1  ——  对 _out 下的最小案例逐个跑「import + 探针」
# =============================================================================
# 用法（在 新版本 目录下）：
#   pwsh -File _dev\验证最小案例.ps1                      # 全部
#   pwsh -File _dev\验证最小案例.ps1 -案例 碰撞测试 -帧数 60
#
# 为什么必须分两步（import 再 run）：
#   Godot 只有**编辑器/--import** 才会扫描脚本、建立 class_name 全局类缓存
#   （.godot/global_script_class_cache.cfg）并导入贴图。
#   直接 headless 跑主场景会报 "Could not find base class 角色类"、
#   "No loader found for resource: xxx.png" —— 那是**没导入**，不是转换的错。
# =============================================================================
param(
	[string[]]$案例 = @('函数返回值尝试', '克隆体测试', '画笔和嵌套循环测试', '碰撞测试', '射击生存'),
	[int]$帧数 = 120,
	[string]$GodotPath
)

# 不写死本机路径：优先 -GodotPath，其次 $env:K4_GODOT，再查 PATH 与常见位置。
function Resolve-GodotExe {
	param([string]$Override)
	if ($Override -and (Test-Path $Override)) { return (Resolve-Path $Override).Path }
	if ($env:K4_GODOT -and (Test-Path $env:K4_GODOT)) { return $env:K4_GODOT }
	$cmd = Get-Command godot -ErrorAction SilentlyContinue
	if ($cmd) { return $cmd.Source }
	$found = @()
	foreach ($r in @("$env:USERPROFILE\Desktop", "$env:USERPROFILE\Downloads", 'D:\software', 'C:\Program Files')) {
		if (Test-Path $r) {
			$found += @(Get-ChildItem -Path $r -Filter 'Godot*win64*.exe' -Recurse -Depth 3 -File -ErrorAction SilentlyContinue)
		}
	}
	$pick = $found | Where-Object { $_.Name -notmatch 'console|mono' } | Sort-Object { $_.Name } -Descending | Select-Object -First 1
	if ($pick) { return $pick.FullName }
	return $null
}

$godot = Resolve-GodotExe -Override $GodotPath
if (-not $godot) {
	throw '未找到 Godot。请用 -GodotPath 指定 Godot_v4.x-stable_win64.exe，或设置 $env:K4_GODOT。'
}
$根 = Split-Path $PSScriptRoot -Parent
$错误模式 = 'SCRIPT ERROR|Parse Error|stack overflow|Stack overflow|Invalid |Cannot |Trying to |Attempt to |nonexistent|null instance'

foreach ($c in $案例) {
	$p = Join-Path $根 "_out\$c"
	if (-not (Test-Path $p)) { Write-Host "跳过（没有这个工程）: $c"; continue }
	Write-Host ""
	Write-Host "################ $c ################"

	Copy-Item (Join-Path $PSScriptRoot '_探针.gd') (Join-Path $p '_探针.gd') -Force

	$pg = Join-Path $p 'project.godot'
	$文本 = Get-Content $pg -Raw -Encoding UTF8
	if ($文本 -notmatch 'K4Probe') {
		$文本 = $文本 -replace '(\[autoload\]\r?\n)', "`$1K4Probe=`"*res://_探针.gd`"`r`n"
		Set-Content $pg $文本 -Encoding UTF8 -NoNewline
	}

	& $godot --headless --path $p --import *> $null

	$输出 = & $godot --headless --path $p --quit-after $帧数 2>&1
	$输出 | Select-String -Pattern '\[PROBE\]' | ForEach-Object { $_.Line }

	$错 = $输出 | Select-String -Pattern $错误模式
	if ($错) {
		Write-Host "---- 错误 ----"
		$错 | Select-Object -First 25 | ForEach-Object { $_.Line }
	} else {
		Write-Host "---- 无错误 ----"
	}

	Remove-Item (Join-Path $p '_探针.gd') -Force -ErrorAction SilentlyContinue
	Remove-Item (Join-Path $p '_探针.gd.uid') -Force -ErrorAction SilentlyContinue
}
Write-Host ""
Write-Host "全部完成"
