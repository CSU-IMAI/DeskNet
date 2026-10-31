$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path (Join-Path $root "node_modules"))) {
  throw "未找到 node_modules，请先运行 npm install"
}

$target = Join-Path $root "src-tauri\target"
$buildTarget = $target

# tauri-winres / windres 在含空格的目标路径上会错误拆分参数。
# 项目路径含空格时，用无空格的 junction 指回真实 target 目录。
if ($root -match "\s") {
  $junction = Join-Path $env:USERPROFILE "DeskNestBuildTarget"
  $resolvedTarget = (Resolve-Path -LiteralPath $target -ErrorAction SilentlyContinue)
  if (-not $resolvedTarget) {
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    $resolvedTarget = Resolve-Path -LiteralPath $target
  }
  $reuse = $false
  if (Test-Path -LiteralPath $junction) {
    $existing = Get-Item -LiteralPath $junction -Force
    if (-not ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw "构建辅助目录已存在且不是 junction：$junction"
    }
    $linkTarget = @($existing.Target)[0]
    if ($linkTarget -and ((Resolve-Path -LiteralPath $linkTarget).Path -eq $resolvedTarget.Path)) {
      $reuse = $true
    } else {
      & cmd.exe /c rmdir "$junction"
      if ($LASTEXITCODE -ne 0) { throw "无法移除旧的构建 junction：$junction" }
    }
  }
  if (-not $reuse) {
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    New-Item -ItemType Junction -Path $junction -Target $target | Out-Null
  }
  $buildTarget = $junction
  Write-Host "检测到路径包含空格，构建目标目录切换到 $junction" -ForegroundColor DarkGray
}

$env:CARGO_TARGET_DIR = $buildTarget
$cli = Join-Path $root "node_modules\@tauri-apps\cli\tauri.js"
& node $cli build --bundles nsis
if ($LASTEXITCODE -ne 0) {
  throw "Tauri 构建失败（退出码 $LASTEXITCODE）"
}

$release = Join-Path $buildTarget "release"
$artifacts = Join-Path $root "artifacts"
New-Item -ItemType Directory -Force -Path $artifacts | Out-Null

$installer = Get-ChildItem (Join-Path $release "bundle\nsis") -Filter "*.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if ($installer) {
  Copy-Item $installer.FullName (Join-Path $artifacts $installer.Name) -Force
  Write-Host "安装包：$(Join-Path $artifacts $installer.Name)" -ForegroundColor Green
}

$binary = Get-ChildItem $release -Filter "*.exe" |
  Where-Object { $_.Name -notmatch "build-script" } |
  Sort-Object Length -Descending |
  Select-Object -First 1
if ($binary) {
  $portable = Join-Path $artifacts "DeskNest-win-x64-portable"
  if (Test-Path $portable) { Remove-Item $portable -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $portable | Out-Null
  Copy-Item $binary.FullName (Join-Path $portable $binary.Name) -Force
  $loader = Join-Path $release "WebView2Loader.dll"
  if (Test-Path $loader) {
    Copy-Item $loader (Join-Path $portable "WebView2Loader.dll") -Force
  }
  $zip = Join-Path $artifacts "DeskNest-win-x64-portable.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Compress-Archive -Path (Join-Path $portable "*") -DestinationPath $zip
  Write-Host "便携版：$zip" -ForegroundColor Green
}
