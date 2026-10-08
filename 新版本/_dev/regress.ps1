# 回归验证（串行）：转换 -> 导入素材 -> 真跑 300 帧 -> 全量解析检查
#
#   pwsh -File _dev\regress.ps1
#
# 每轮改动过运行时/生成器之后都应该跑一遍。四个样本覆盖：
#   新的作品   —— 最小基线（1 屏幕 / 1 角色 / 2 帽子）
#   射击生存   —— 克隆体 / 碰撞 / 音效 / 多角色（唯一允许的非零项是既有的音频泄漏）
#   空白作品b  —— 空白工程基线（脚本/场景最多的那类产物）
#   切屏测试   —— 多屏幕 / 屏幕容器 / custom 造型
#
# 每个样本可给**多个候选源**（`源` 数组），取第一个存在的 —— 样本 .bcm4 经常被手工
# 挪走/删掉，缺源时**跳过并继续**（而不是整轮崩掉）；单样本失败也只影响它自己。
#
# 每个样本的完整输出落在 _dev\regress_log\<样本>.log；末尾打印汇总表。
$ErrorActionPreference = 'Continue'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path      # 新版本\_dev
$ver = Split-Path -Parent $here                              # 新版本
$huang = Join-Path $ver 'huanzhuang.ps1'
$logDir = Join-Path $here 'regress_log'
$样本根 = 'D:\DS-projects\kitten4转Godot项目\kitten示例项目'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$samples = @(
  [pscustomobject]@{
    Name = '新的作品'; Out = '_out\新作品'
    源 = @((Join-Path $样本根 '新的作品.bcm4'))
  },
  [pscustomobject]@{
    Name = '射击生存'; Out = '_out\射击生存'
    源 = @((Join-Path $样本根 '射击生存.bcm4'))
  },
  [pscustomobject]@{
    Name = '空白作品b'; Out = '_out\空白作品b'
    源 = @('D:\Download\空白作品 (3).bcm4',
           'D:\Download\空白作品-28.bcm4',
           (Join-Path $样本根 '大型项目\游戏-空白作品.bcm4'))
  },
  [pscustomobject]@{
    Name = '切屏测试'; Out = '_out\切屏测试'
    源 = @('D:\Download\切屏测试_custom优化测试.bcm4')
  }
)

$summary = New-Object System.Collections.ArrayList

foreach ($s in $samples) {
  Write-Host ''
  Write-Host ('################ ' + $s.Name + ' ################') -ForegroundColor Cyan
  $log = Join-Path $logDir ($s.Name + '.log')

  $src = @($s.源 | Where-Object { Test-Path $_ }) | Select-Object -First 1
  if (-not $src) {
    Write-Host ('  跳过：找不到源文件（' + $s.源.Count + ' 个候选都不存在）') -ForegroundColor Yellow
    $s.源 | ForEach-Object { Write-Host ('    x ' + $_) }
    Set-Content -Path $log -Value ("SKIP: 源文件不存在`r`n" + ($s.源 -join "`r`n")) -Encoding UTF8
    [void]$summary.Add([pscustomobject]@{
      Name = $s.Name; Err = '-'; Warn = '-'; Check = '-'; Stub = '-'; Verdict = 'SKIP(缺源)'
    })
    continue
  }
  if ($src -ne $s.源[0]) { Write-Host ('  源：' + $src + '   （首个候选不存在，用了备选）') }

  # 从"新版本"目录调用：huanzhuang.ps1 已经把转换统一到脚本目录，这里再对齐一次
  # 调用上下文（PowerShell 5.1 的 Tee-Object 只能写 UTF-16，日志改用 UTF-8 落盘）。
  Push-Location $ver
  try {
    $text = & $huang -Bcm4 $src -Out $s.Out *>&1 | Out-String
  } catch {
    $text = "=== 该样本失败（异常，已跳过，不影响其它样本）===" + "`r`n" + $_.Exception.Message
  } finally { Pop-Location }

  Write-Host $text
  Set-Content -Path $log -Value ($text + "`r`n[源] " + $src) -Encoding UTF8

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
