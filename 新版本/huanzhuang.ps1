# Convert + verify in one shot.
#
#   .\huanzhuang.ps1 -Bcm4 '..\kitten...\xxx.bcm4' -Out '_out\xxx'
#   (or use the .cmd wrapper:  转换并验证.cmd "<bcm4>" "<outdir>")
#
# Steps: convert -> import assets (up to 3 passes) -> run 300 frames
#        -> 全量解析检查 (load every .gd / .tscn) -> count errors/warnings
#
# NOTE: this file is intentionally ASCII-only. Windows PowerShell 5.1 reads
# BOM-less files as ANSI, and non-ASCII text here would break parsing.
param(
  [Parameter(Mandatory = $true)][string]$Bcm4,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Frames = 300,
  [switch]$SkipConvert,
  [string]$NodePath,
  [string]$GodotPath
)

$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# ---------------------------------------------------------------- tool lookup
# No machine-specific absolute paths here: resolve node / Godot at runtime.
# Override order:  -NodePath / -GodotPath  ->  $env:K4_NODE / $env:K4_GODOT
#                  ->  PATH  ->  common install locations.
function Resolve-NodeExe {
  param([string]$Override)
  if ($Override -and (Test-Path $Override)) { return (Resolve-Path $Override).Path }
  if ($env:K4_NODE -and (Test-Path $env:K4_NODE)) { return $env:K4_NODE }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @(
      "$env:ProgramFiles\nodejs\node.exe",
      "${env:ProgramFiles(x86)}\nodejs\node.exe",
      "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Resolve-GodotExe {
  param([string]$Override, [string]$StartDir)
  if ($Override -and (Test-Path $Override)) { return (Resolve-Path $Override).Path }
  if ($env:K4_GODOT -and (Test-Path $env:K4_GODOT)) { return $env:K4_GODOT }
  $cmd = Get-Command godot -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  # newest Godot_v*_win64.exe sitting next to the project or in the usual spots
  $roots = New-Object System.Collections.ArrayList
  foreach ($r in @($StartDir, (Split-Path -Parent $StartDir), "$env:USERPROFILE\Desktop",
                   "$env:USERPROFILE\Downloads", 'D:\software', 'C:\Program Files')) {
    if ($r -and (Test-Path $r)) { [void]$roots.Add($r) }
  }
  $found = @()
  foreach ($r in $roots) {
    $found += @(Get-ChildItem -Path $r -Filter 'Godot*win64*.exe' -Recurse -Depth 3 -File -ErrorAction SilentlyContinue)
  }
  $pick = $found |
    Where-Object { $_.Name -notmatch 'console|mono' } |
    Sort-Object { $_.Name } -Descending |
    Select-Object -First 1
  if ($pick) { return $pick.FullName }
  return $null
}

$NODE  = Resolve-NodeExe  -Override $NodePath
$GODOT = Resolve-GodotExe -Override $GodotPath -StartDir $here

if (-not $NODE) {
  throw 'node.exe not found. Install Node.js, or pass -NodePath <path>, or set $env:K4_NODE.'
}
if (-not $GODOT) {
  throw 'Godot not found. Pass -GodotPath <path to Godot_v4.x-stable_win64.exe>, or set $env:K4_GODOT.'
}

function Wait-Proc([System.Diagnostics.Process]$p, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while (-not $p.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 400 }
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force; return $false }
  return $true
}

$proj = if ([System.IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path $here $Out }

if (-not $SkipConvert) {
  Write-Host '=== 1/5 convert ===' -ForegroundColor Cyan
  # 坑（2026/10/6 实测）：convert.js 用 path.resolve 解析输出路径，也就是相对
  # **当前工作目录**；而第 2~5 步验证的目录是按**脚本所在目录**算的（$proj）。
  # 两者不一致时（例如从项目根目录调用），转换会把新产物写到 A，而验证跑的是 B
  # 里上一次留下的旧产物 —— 结果全绿，却根本没验证到这次转换。所以这里先切到
  # 脚本目录，并在转换后核对报告里的输出路径。
  Push-Location $here
  try {
    $convOut = @(& $NODE (Join-Path $here 'convert.js') $Bcm4 $Out --clean 2>&1 | ForEach-Object { [string]$_ })
  } finally { Pop-Location }
  $convOut | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) { throw 'convert failed' }
  $done = @($convOut | Where-Object { $_ -match '^转换完成: ' })
  if ($done.Count -gt 0) {
    $reported = ($done[-1] -replace '^转换完成: ', '').Trim()
    if ($reported.TrimEnd('\', '/') -ne $proj.TrimEnd('\', '/')) {
      throw ('convert 写到了别处 —— 报告是 {0}，验证却要跑 {1}' -f $reported, $proj)
    }
  }
}

Push-Location $proj
try {
  Write-Host '=== 2/5 import assets (up to 3 passes) ===' -ForegroundColor Cyan
  $exts = @('.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif')
  for ($i = 1; $i -le 3; $i++) {
    & $GODOT --headless --import --path . 2>&1 | Out-Null
    $all = @(Get-ChildItem -Recurse -File | Where-Object { $exts -contains $_.Extension })
    $miss = @($all | Where-Object { -not (Test-Path ($_.FullName + '.import')) })
    Write-Host ("  pass {0}: assets {1}, missing .import {2}" -f $i, $all.Count, $miss.Count)
    if ($miss.Count -eq 0) { break }
  }

  Write-Host '=== 3/5 run ===' -ForegroundColor Cyan
  Remove-Item run.log, run.err -ErrorAction SilentlyContinue
  $p = Start-Process $GODOT -ArgumentList '--headless', '--path', '.', '--quit-after', "$Frames" `
    -PassThru -RedirectStandardOutput 'run.log' -RedirectStandardError 'run.err'
  if (-not (Wait-Proc $p 200)) { Write-Host '  (timeout, killed - log may be truncated)' -ForegroundColor Yellow }

  Write-Host '=== 4/5 full parse check (every .gd / .tscn) ===' -ForegroundColor Cyan
  # 跑主场景只会加载主场景那一棵树 —— 别的屏幕/角色脚本里的**解析期**错误
  # （例如 "Too few arguments"）完全看不到，编辑器里却会报
  # "场景文件 xxx 似乎无效/损坏"。所以这里逐个 load() + instantiate()。
  # 注意：必须**当场景跑**（--script / --check-only 不注册 autoload，
  # K4Global/K4Canvas/K4Bus 会全部 "Identifier not found"，检查结果全是假的）。
  Copy-Item (Join-Path $here '_dev\check_all.gd') (Join-Path $proj '_检查.gd') -Force
  Copy-Item (Join-Path $here '_dev\check_all.tscn') (Join-Path $proj '_检查.tscn') -Force
  & $GODOT --headless --import --path . 2>&1 | Out-Null
  Remove-Item check.log, check.err -ErrorAction SilentlyContinue
  $cp = Start-Process $GODOT -ArgumentList '--headless', '--path', '.', 'res://_检查.tscn' `
    -PassThru -RedirectStandardOutput 'check.log' -RedirectStandardError 'check.err'
  if (-not (Wait-Proc $cp 180)) { Write-Host '  (timeout, killed)' -ForegroundColor Yellow }
  $checkLine = @(Get-Content check.log -Encoding UTF8 -ErrorAction SilentlyContinue |
    Where-Object { $_ -match '^CHECK ' })
  $checkFail = @(Get-Content check.log -Encoding UTF8 -ErrorAction SilentlyContinue |
    Where-Object { $_ -match '^FAIL_' })
  $checkErr = @(Get-Content check.err -Encoding UTF8 -ErrorAction SilentlyContinue |
    Where-Object { $_ -match 'Parse Error|Compile Error|Failed to load script|Invalid scene|does not specify|Failed to load scene' })
  Remove-Item '_检查.gd', '_检查.gd.uid', '_检查.tscn', '_检查.tscn.uid' -ErrorAction SilentlyContinue
  if ($checkLine.Count -gt 0) { Write-Host ('  ' + $checkLine[-1]) }
  else { Write-Host '  CHECK 行缺失 —— 检查器没跑起来！' -ForegroundColor Red }
  $checkFail | Select-Object -First 15 | ForEach-Object { Write-Host ('    ' + $_) -ForegroundColor Yellow }
  $checkErr | Sort-Object -Unique | Select-Object -First 15 | ForEach-Object { Write-Host ('    ' + $_) -ForegroundColor Yellow }

  Write-Host '=== 5/5 result ===' -ForegroundColor Cyan
  $err = @(Get-Content run.err -Encoding UTF8 -ErrorAction SilentlyContinue)
  # Unimplemented built-in blocks push_warning("[K4-STUB] ..."), which is
  # expected noise. Skip that line plus the "at: push_warning (...)" line
  # that always follows it, so they never count as failures.
  $bad = New-Object System.Collections.ArrayList
  $stub = New-Object System.Collections.ArrayList
  $skipNext = $false
  foreach ($line in $err) {
    if ($line -match '\[K4-STUB\]') { $skipNext = $true; [void]$stub.Add($line); continue }
    if ($skipNext -and $line -match 'at: push_warning') { $skipNext = $false; continue }
    $skipNext = $false
    if ($line -match 'ERROR|SCRIPT ERROR|WARNING') { [void]$bad.Add($line) }
  }
  $checkBad = $checkErr.Count + $checkFail.Count
  Write-Host ("  stderr lines      : {0}" -f $err.Count)
  Write-Host ("  error/warn lines  : {0}" -f $bad.Count)
  Write-Host ("  stub notices      : {0}   (expected, not counted)" -f $stub.Count)
  Write-Host ("  parse-check fails : {0}" -f $checkBad)
  if ($bad.Count -eq 0 -and $checkBad -eq 0) {
    Write-Host '  OK - 0 error / 0 warning / 0 parse fail' -ForegroundColor Green
    # 全过就把临时日志删掉，别把工程目录弄脏（编辑器文件系统面板会看到它们）
    Remove-Item run.log, run.err, check.log, check.err -ErrorAction SilentlyContinue
  }
  else {
    Write-Host '  first 15 (run):' -ForegroundColor Yellow
    $bad | Select-Object -First 15 | ForEach-Object { Write-Host ('    ' + $_) }
    Write-Host ("  （日志留在 {0}）" -f $proj)
  }
  Write-Host ''
  Write-Host ("  project : {0}" -f $proj)
  Write-Host ("  mapping : {0}" -f (Join-Path $proj '全局\积木映射.json'))
  Write-Host ("  edit me : {0}   (never overwritten)" -f (Join-Path $proj '全局\角色类.gd'))
}
finally { Pop-Location }
