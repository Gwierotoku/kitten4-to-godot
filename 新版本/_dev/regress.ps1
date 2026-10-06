# 回归验证（串行）：转换 -> 导入素材 -> 真跑 300 帧 -> 全量解析检查
#
#   pwsh -File _dev\regress.ps1
#
# 每轮改动过运行时/生成器之后都应该跑一遍。四个样本覆盖：
#   新的作品   —— 最小基线（1 屏幕 / 1 角色 / 2 帽子）
#   射击生存   —— 克隆体 / 碰撞 / 音效 / 多角色（唯一允许的非零项是既有的音频泄漏）
#   空白作品b  —— 空白工程基线（无角色，只有背景屏幕）
#   切屏测试   —— 多屏幕 / 屏幕容器 / custom 造型
#
# 每个样本的完整输出落在 _dev\regress_log\<样本>.log；末尾打印汇总表。
param(
  # 示例工程目录（默认取仓库内的 开源内容\kitten示例项目）。
  [string]$Bcm4Dir,
  # 额外样本地目录（默认取仓库内的 开源内容\kitten示例项目）；
  # 缺失的样本会被自动跳过，不会中断回归。
  [string]$DownloadDir
)
$ErrorActionPreference = 'Continue'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path      # 新版本\_dev
$ver = Split-Path -Parent $here                              # 新版本
$huang = Join-Path $ver 'huanzhuang.ps1'
$logDir = Join-Path $here 'regress_log'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# 可移植：不写死任何绝对路径。默认按仓库布局推导，可用参数或环境变量覆盖。
$repoRoot = Split-Path -Parent $ver                          # 开源内容
if (-not $Bcm4Dir)     { $Bcm4Dir     = if ($env:K4_BCM4_DIR)     { $env:K4_BCM4_DIR }     else { Join-Path $repoRoot 'kitten示例项目' } }
if (-not $DownloadDir) { $DownloadDir = if ($env:K4_DOWNLOAD_DIR) { $env:K4_DOWNLOAD_DIR } else { Join-Path $repoRoot 'kitten示例项目' } }

$samples = @(
  [pscustomobject]@{ Name = '新的作品';  Bcm4 = (Join-Path $Bcm4Dir     '新的作品.bcm4');              Out = '_out\新作品' },
  [pscustomobject]@{ Name = '射击生存';  Bcm4 = (Join-Path $Bcm4Dir     '射击生存.bcm4');              Out = '_out\射击生存' },
  [pscustomobject]@{ Name = '空白作品b'; Bcm4 = (Join-Path $DownloadDir '空白作品-28.bcm4');           Out = '_out\空白作品b' },
  [pscustomobject]@{ Name = '切屏测试';  Bcm4 = (Join-Path $DownloadDir '切屏测试_custom优化测试.bcm4'); Out = '_out\切屏测试' }
)

$summary = New-Object System.Collections.ArrayList

foreach ($s in $samples) {
  Write-Host ''
  Write-Host ('################ ' + $s.Name + ' ################') -ForegroundColor Cyan
  # 样本缺失就跳过：这几个 .bcm4 是外部素材，不进仓库，别人克隆后不该因此中断。
  if (-not (Test-Path $s.Bcm4)) {
    Write-Host ('  SKIP - 样本不存在: ' + $s.Bcm4) -ForegroundColor Yellow
    Write-Host '         可用 -Bcm4Dir / -DownloadDir 指定样本目录，或设置 $env:K4_BCM4_DIR。'
    [void]$summary.Add([pscustomobject]@{
      Name = $s.Name; Err = '-'; Warn = '-'; Check = '-'; Stub = '-'; Verdict = 'SKIP'
    })
    continue
  }
  $log = Join-Path $logDir ($s.Name + '.log')
  # 从"新版本"目录调用：huanzhuang.ps1 已经把转换统一到脚本目录，这里再对齐一次
  # 调用上下文（PowerShell 5.1 的 Tee-Object 只能写 UTF-16，日志改用 UTF-8 落盘）。
  Push-Location $ver
  try { $text = & $huang -Bcm4 $s.Bcm4 -Out $s.Out *>&1 | Out-String }
  finally { Pop-Location }
  Write-Host $text
  Set-Content -Path $log -Value $text -Encoding UTF8
  $err = 0; $warn = 0; $check = 0; $stub = 0
  foreach ($line in ($text -split "`r?`n")) {
    if ($line -match 'stderr lines\s*:\s*(\d+)') { $err = [int]$Matches[1] }
    if ($line -match 'error/warn lines\s*:\s*(\d+)') { $warn = [int]$Matches[1] }
    if ($line -match 'parse-check fails\s*:\s*(\d+)') { $check = [int]$Matches[1] }
    if ($line -match 'stub notices\s*:\s*(\d+)') { $stub = [int]$Matches[1] }
  }
  # 已知噪音（不是本轮引入的）：Godot 强制退出时音频资源未释放的泄漏告警。
  # 射击生存这一条从第九轮就在，历史基线也是 1 条 —— 单独放行，免得每次都判红。
  $knownNoise = ($warn -le 1) -and ($text -match 'ObjectDB instances were leaked')
  $verdict = 'FAIL'
  if ($text -match 'CHECK 行缺失') { $verdict = 'CHECKER-DEAD' }
  elseif ($text -match 'OK - 0 error / 0 warning / 0 parse fail') { $verdict = 'PASS' }
  elseif ($knownNoise -and $check -eq 0) { $verdict = 'PASS(仅既有音频泄漏)' }
  [void]$summary.Add([pscustomobject]@{
    Name = $s.Name; Err = $err; Warn = $warn; Check = $check; Stub = $stub; Verdict = $verdict
  })
}

Write-Host ''
Write-Host '================ 汇总 ================' -ForegroundColor Cyan
$summary | Format-Table -AutoSize
Write-Host ('日志目录: ' + $logDir)
