#Requires -Version 5.1
<#
  build-icons.ps1 — renders the whole desktop icon set from icons\icon-1024.png
  and assembles a real multi-size Windows app icon (icons\app.ico).

  Uses only System.Drawing (ships with .NET Framework / Windows PowerShell), so it
  adds no dependency to the project (ADR-001). Run:  powershell -NoProfile -File desktop\build-icons.ps1

  Geometry notes (measured from the generated 1024x1024 source art):
    - the badge ring's outer box is (225,221)..(798,802) -> square crop (221,221) 582x582
    - the squircle corner radius is ~135px of that 582px crop -> 0.232
    - the "Qoder AI 生成" watermark sits at x>790,y>845, i.e. OUTSIDE the crop,
      so cropping to the badge removes it.
  Constants are scaled by (sourceWidth / 1024) so a re-generated source still works.
#>
[CmdletBinding()]
param(
  [string]$Source,
  [string]$OutDir,
  [string]$WorkDir
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not $Source)   { $Source   = Join-Path $PSScriptRoot 'icons\icon-1024.png' }
if (-not $OutDir)   { $OutDir   = Join-Path $PSScriptRoot 'icons' }
if (-not $WorkDir)  { $WorkDir  = Join-Path ([System.IO.Path]::GetTempPath()) 'ai-commander-icons' }

if (-not (Test-Path -LiteralPath $Source)) { throw "source icon not found: $Source" }
New-Item -ItemType Directory -Force -Path $OutDir  | Out-Null
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
Get-ChildItem -LiteralPath $WorkDir -File -ErrorAction SilentlyContinue | Remove-Item -Force

# --- measured source geometry (in 1024x1024 space) ---
$SrcCropX = 221.0
$SrcCropY = 221.0
$SrcCropW = 582.0
$CornerRatio = 0.232            # squircle radius / badge size
$MaskableFit = 0.76             # badge size inside the maskable canvas (safe zone)
$PngSizes      = @(192, 512)    # deliverables for the PWA / favicon links
$IcoSizes      = @(16, 24, 32, 48, 64, 128, 256)
$MaskableSizes = @(512)

$src = New-Object System.Drawing.Bitmap $Source
try {
  $k = $src.Width / 1024.0
  $cropRect = New-Object System.Drawing.RectangleF `
    ($SrcCropX * $k), ($SrcCropY * $k), ($SrcCropW * $k), ($SrcCropW * $k)
  Write-Host ("source   : {0} ({1}x{2}, pixel format {3})" -f $Source, $src.Width, $src.Height, $src.PixelFormat)
  Write-Host ("crop rect: {0}" -f $cropRect)

  # GraphicsPath.AddArc and friends only have float overloads -- pass every number as
  # [single] explicitly so PowerShell cannot fail overload resolution on an int.
  function New-RoundedPath {
    param([single]$S)
    $r = [single]$CornerRatio * $S
    $d = [single]2 * $r
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc([single]0, [single]0, $d, $d, [single]180, [single]90)
    $p.AddArc($S - $d, [single]0, $d, $d, [single]270, [single]90)
    $p.AddArc($S - $d, $S - $d, $d, $d, [single]0, [single]90)
    $p.AddArc([single]0, $S - $d, $d, $d, [single]90, [single]90)
    $p.CloseFigure()
    return $p
  }

  function New-BadgeBmp {
    param([int]$Size)
    $s = [single]$Size
    $bmp = New-Object System.Drawing.Bitmap ([int]$Size), ([int]$Size), ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $p = $null
    try {
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $g.CompositingMode   = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
      $g.Clear([System.Drawing.Color]::Transparent)
      $p = New-RoundedPath $s
      $g.SetClip($p)
      $dest = New-Object System.Drawing.RectangleF ([single]0), ([single]0), $s, $s
      $g.DrawImage($src, $dest, $cropRect, [System.Drawing.GraphicsUnit]::Pixel)
      $g.ResetClip()
    } finally {
      if ($p) { $p.Dispose() }
      $g.Dispose()
    }
    return $bmp
  }

  function New-MaskableBmp {
    param([int]$Size)
    $s = [single]$Size
    $bmp = New-Object System.Drawing.Bitmap ([int]$Size), ([int]$Size), ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $badge = $null
    try {
      # Adaptive-icon background: a light blue-grey field derived from the measured ring
      # colour (155,171,189), so the near-white badge still reads once Windows masks the
      # canvas to a circle. The source corners are too close to the badge fill to use.
      $top = [System.Drawing.Color]::FromArgb([int]255, [int]238, [int]242, [int]248)
      $bot = [System.Drawing.Color]::FromArgb([int]255, [int]212, [int]221, [int]233)
      $field = New-Object System.Drawing.RectangleF
      $field.X = [single]0
      $field.Y = [single]0
      $field.Width = $s
      $field.Height = $s
      $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($field, $top, $bot, [single]90)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $g.FillRectangle($brush, [single]0, [single]0, $s, $s)
      $brush.Dispose()
      $badge = New-BadgeBmp ([int]($s * $MaskableFit))
      $bw = [single]$badge.Width
      $g.DrawImage($badge, ($s - $bw) / [single]2, ($s - $bw) / [single]2, $bw, [single]$badge.Height)
    } finally {
      if ($badge) { $badge.Dispose() }
      $g.Dispose()
    }
    return $bmp
  }

  $png = [System.Drawing.Imaging.ImageFormat]::Png
  $bmpFmt = [System.Drawing.Imaging.ImageFormat]::Bmp
  $made = @()

  foreach ($size in $PngSizes) {
    $b = New-BadgeBmp $size
    $out = Join-Path $OutDir ("icon-{0}.png" -f $size)
    $b.Save($out, $png); $b.Dispose(); $made += $out
  }
  foreach ($size in $MaskableSizes) {
    $b = New-MaskableBmp $size
    $out = Join-Path $OutDir ("maskable-{0}.png" -f $size)
    $b.Save($out, $png); $b.Dispose(); $made += $out
  }
  # ICO payloads: 32bpp BMP for the small entries (max shell compatibility),
  # PNG for 256 (the modern Vista+ convention).
  foreach ($size in $IcoSizes) {
    $b = New-BadgeBmp $size
    if ($size -ge 256) { $b.Save((Join-Path $WorkDir ("ico-{0}.png" -f $size)), $png) }
    else               { $b.Save((Join-Path $WorkDir ("ico-{0}.bmp" -f $size)), $bmpFmt) }
    $b.Dispose()
  }
  # favicon-sized copies are handy for <link rel="icon"> at 32/48 without shipping the .ico
  foreach ($size in @(32, 48)) {
    $b = New-BadgeBmp $size
    $out = Join-Path $OutDir ("icon-{0}.png" -f $size)
    $b.Save($out, $png); $b.Dispose(); $made += $out
  }
} finally {
  $src.Dispose()
}

$made | ForEach-Object { Write-Host ("wrote {0}" -f $_) }

# --- ICO container (pure stdlib python: needs real pixel access for the DIB entries) ---
$py = Join-Path $PSScriptRoot 'make-ico.py'
Write-Host "building app.ico ..."
& python $py --work $WorkDir --out (Join-Path $OutDir 'app.ico') --sizes ($IcoSizes -join ',')
if ($LASTEXITCODE -ne 0) { throw "make-ico.py failed with exit code $LASTEXITCODE" }
Write-Host "icons ready in $OutDir"
