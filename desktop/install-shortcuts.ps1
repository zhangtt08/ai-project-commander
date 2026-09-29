#Requires -Version 5.1
<#
  install-shortcuts.ps1 — creates the "AI Project Commander" Desktop shortcut and Start-Menu
  entry, both pointing straight at the compiled launcher exe with the app icon.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File desktop\install-shortcuts.ps1
    ... -NoStartMenu        (desktop shortcut only)
#>
[CmdletBinding()]
param(
  [switch]$NoStartMenu,
  [string]$ExePath
)

$ErrorActionPreference = 'Stop'

$desk = $PSScriptRoot
if (-not $ExePath) { $ExePath = Join-Path $desk 'AIProjectCommander.exe' }
if (-not (Test-Path -LiteralPath $ExePath)) {
  throw "找不到可执行文件：$ExePath`n请先运行 desktop\build.ps1 生成它。"
}
$ExePath = (Resolve-Path -LiteralPath $ExePath).Path

# The launcher resolves the project root from its own location, but a sane working
# directory keeps `node` and any relative paths behaving exactly like 启动.bat.
$root = (Resolve-Path -LiteralPath (Join-Path $desk '..')).Path
$name = 'AI Project Commander'
$description = 'AI Project Commander - AI 编码项目控制面（本地服务 + Edge 应用窗口）'

function New-AppShortcut {
  param([string]$Dir, [string]$FileName)

  if (-not (Test-Path -LiteralPath $Dir)) {
    New-Item -ItemType Directory -Force -Path $Dir | Out-Null
  }
  $lnkPath = Join-Path $Dir $FileName
  $shell = New-Object -ComObject WScript.Shell
  try {
    $sc = $shell.CreateShortcut($lnkPath)
    $sc.TargetPath = $ExePath
    $sc.WorkingDirectory = $root
    $sc.Arguments = ''
    $sc.IconLocation = "$ExePath,0"
    $sc.Description = $description
    $sc.Save()
  } finally {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
  }

  if (-not (Test-Path -LiteralPath $lnkPath)) { throw "shortcut was not created: $lnkPath" }
  $verify = (New-Object -ComObject WScript.Shell).CreateShortcut($lnkPath)
  Write-Host ("created : {0}" -f $lnkPath)
  Write-Host ("  target: {0}" -f $verify.TargetPath)
  Write-Host ("  icon  : {0}" -f $verify.IconLocation)
  Write-Host ("  workd : {0}" -f $verify.WorkingDirectory)
  if ($verify.TargetPath -ne $ExePath) { throw "shortcut target mismatch: $lnkPath" }
  return $lnkPath
}

$created = @()
$created += New-AppShortcut -Dir ([Environment]::GetFolderPath('Desktop')) -FileName ("{0}.lnk" -f $name)
if (-not $NoStartMenu) {
  $created += New-AppShortcut -Dir ([Environment]::GetFolderPath('Programs')) -FileName ("{0}.lnk" -f $name)
}

Write-Host ''
Write-Host '快捷方式已创建，双击「AI Project Commander」即可启动。'
Write-Host '（首次启动会自动拉起本地服务并打开应用窗口；右下角托盘图标可停止服务。）'
$created
