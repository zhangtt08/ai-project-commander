#Requires -Version 5.1
<#
  uninstall-shortcuts.ps1 — removes only the shortcuts this installer created.

  A .lnk is deleted only when its target really is the AIProjectCommander.exe launcher, so a
  hand-made shortcut with the same name is never destroyed. Pass -RemoveExe to also delete the
  compiled binary (icons and scripts are kept).

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File desktop\uninstall-shortcuts.ps1
#>
[CmdletBinding()]
param(
  [switch]$RemoveExe,
  [string]$ExePath
)

$ErrorActionPreference = 'Stop'

$desk = $PSScriptRoot
if (-not $ExePath) { $ExePath = Join-Path $desk 'AIProjectCommander.exe' }
$ExeFull = if (Test-Path -LiteralPath $ExePath) { (Resolve-Path -LiteralPath $ExePath).Path } else { $ExePath }

$name = 'AI Project Commander'
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop'))  ("{0}.lnk" -f $name)),
  (Join-Path ([Environment]::GetFolderPath('Programs')) ("{0}.lnk" -f $name))
)

$shell = New-Object -ComObject WScript.Shell
try {
  foreach ($lnk in $targets) {
    if (-not (Test-Path -LiteralPath $lnk)) {
      Write-Host ("absent  : {0}" -f $lnk)
      continue
    }
    $sc = $shell.CreateShortcut($lnk)
    $target = $sc.TargetPath
    if ($target -and ((Resolve-Path -LiteralPath $target -ErrorAction SilentlyContinue).Path -eq $ExeFull -or $target -eq $ExeFull)) {
      Remove-Item -LiteralPath $lnk -Force
      Write-Host ("removed : {0}" -f $lnk)
    } else {
      Write-Host ("kept    : {0}  (points at {1}, not our launcher)" -f $lnk, $target)
    }
  }
} finally {
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
}

if ($RemoveExe) {
  if (Test-Path -LiteralPath $ExePath) {
    Remove-Item -LiteralPath $ExePath -Force
    Write-Host ("removed : {0}" -f $ExePath)
  }
} else {
  Write-Host ("kept    : {0}  (pass -RemoveExe to delete it)" -f $ExePath)
}
Write-Host '完成。数据目录 data\ 与图标脚本均未改动。'
