# Quiet build script for the Smart (Components) Toolkit Widget (Windows).
# Run from the repo root or anywhere — it cd's into the desktop app folder.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here   # apps/dashboard-desktop/
Set-Location $root

Write-Host '==> Installing dependencies (if needed)' -ForegroundColor Cyan
npm install --silent --no-audit --no-fund

Write-Host '==> Building installer (msi + nsis)' -ForegroundColor Cyan
npm run release:windows --silent

$bundles = Join-Path $root 'src-tauri\target\release\bundle'
Write-Host ''
Write-Host '==> Done. Installers:' -ForegroundColor Green
Get-ChildItem -Path $bundles -Recurse -Include *.msi,*.exe -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Host ('  ' + $_.FullName) }
