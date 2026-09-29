#Requires -Version 5.1
<#
  build.ps1 — compiles desktop\AIProjectCommander.exe with the C# compiler that ships with
  Windows (.NET Framework 4). No NuGet, no npm, no SDK install (ADR-001).

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File desktop\build.ps1
    powershell ... -File desktop\build.ps1 -ForceIcons     # re-render the icon set first
#>
[CmdletBinding()]
param(
  [switch]$ForceIcons
)

$ErrorActionPreference = 'Stop'
$desk = $PSScriptRoot
$exe  = Join-Path $desk 'AIProjectCommander.exe'
$ico  = Join-Path $desk 'icons\app.ico'
$src  = Join-Path $desk 'Commander.cs'

# --- 1. locate csc.exe (Framework64 first, Framework32 as a fallback) ---
$cscCandidates = @(
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
  (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$csc = $cscCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $csc) { throw 'csc.exe (.NET Framework 4) not found - cannot build the launcher.' }
Write-Host "compiler : $csc"

# --- 2. make sure the icon exists (it is embedded twice: file icon + managed resource) ---
if ($ForceIcons -or -not (Test-Path -LiteralPath $ico)) {
  Write-Host 'icons    : missing, rendering with build-icons.ps1'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $desk 'build-icons.ps1')
  if ($LASTEXITCODE -ne 0) { throw "build-icons.ps1 failed (exit $LASTEXITCODE)" }
}
if (-not (Test-Path -LiteralPath $ico)) { throw "app.ico still missing: $ico" }
$icoBytes = (Get-Item -LiteralPath $ico).Length
Write-Host ("icon     : {0} ({1:N0} bytes)" -f $ico, $icoBytes)

# --- 3. compile ---
# A running launcher keeps the .exe locked, and csc's error in that case is cryptic.
$running = @(Get-Process -Name AIProjectCommander -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) {
  throw ("启动器正在运行 (pid {0})。请先执行 `"{1}`" --exit，或在托盘图标上选「退出」，再重新编译。" -f ($running.Id -join ','), $exe)
}
if (Test-Path -LiteralPath $exe) {
  try { Remove-Item -LiteralPath $exe -Force }
  catch { throw "无法覆盖 $exe ：文件被占用。请先退出正在运行的启动器。" }
}

$cscArgs = @(
  '/target:winexe',                 # no console window behind the app
  '/platform:anycpu',
  '/optimize+',
  '/nologo',
  "/win32icon:$ico",                # Explorer / taskbar / shortcut icon
  "/resource:$ico,app.ico",         # same bytes, readable at runtime for the tray + splash
  '/reference:System.dll',          # Process / HttpWebRequest live here
  '/reference:System.Windows.Forms.dll',
  '/reference:System.Drawing.dll',
  '/reference:System.Management.dll',
  "/out:$exe",
  $src
)

Write-Host 'compiling...'
& $csc $cscArgs
$code = $LASTEXITCODE
if ($code -ne 0) { throw "csc.exe exited with code $code" }
if (-not (Test-Path -LiteralPath $exe)) { throw "compiler reported success but $exe is missing" }

$item = Get-Item -LiteralPath $exe
Write-Host ("built    : {0} ({1:N0} bytes, {2})" -f $item.FullName, $item.Length, $item.LastWriteTime)

# --- 4. prove the icon actually landed in the PE resources ---
Add-Type -AssemblyName System.Drawing
$iconFromExe = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
Write-Host ("exe icon : extracted {0}x{1} from the compiled binary" -f $iconFromExe.Width, $iconFromExe.Height)
$iconFromExe.Dispose()

$asm = [System.Reflection.Assembly]::LoadFile($exe)
$res = $asm.GetManifestResourceNames()
Write-Host ("resource : {0}" -f ($res -join ', '))
if ($res -notcontains 'app.ico') { throw 'embedded app.ico resource is missing from the assembly' }
Write-Host 'OK'
