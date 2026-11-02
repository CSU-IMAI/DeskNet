param(
  [Parameter(Mandatory = $true)]
  [string]$Repo
)

$ErrorActionPreference = "Stop"
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "未找到 GitHub CLI（gh）。请先安装：winget install --id GitHub.cli"
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root
try {
  gh release create v1.0.0 `
    "DeskNest_1.0.0_x64-setup.exe" `
    "DeskNest-win-x64-portable.zip" `
    "SHA256SUMS.txt" `
    --repo $Repo `
    --title "DeskNest 1.0.0 — Windows 桌面管理器" `
    --notes-file "RELEASE_NOTES.md" `
    --draft
}
finally {
  Pop-Location
}
