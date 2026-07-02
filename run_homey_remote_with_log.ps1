param(
    [string]$LogDirectory = (Join-Path $PSScriptRoot ".homey-run-logs"),
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$appDir = Join-Path $PSScriptRoot "no.tiwas.booleantoolbox"
if (-not (Test-Path (Join-Path $appDir "app.json"))) {
    throw "Could not find Homey app manifest at '$appDir'."
}

New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logFile = Join-Path $LogDirectory "homey-app-run-$timestamp.log"
$homeyArgs = @("app", "run", "--remote")
if ($SkipBuild) {
    $homeyArgs += "--skip-build"
}
$exitCode = 0

$header = @(
    "Homey remote run log",
    "Started: $(Get-Date -Format o)",
    "AppDir:  $appDir",
    "Command: homey $($homeyArgs -join ' ')",
    ""
)

$header | Tee-Object -FilePath $logFile

Push-Location $appDir
try {
    & homey @homeyArgs 2>&1 | Tee-Object -FilePath $logFile -Append
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
    "`nEnded: $(Get-Date -Format o)" | Tee-Object -FilePath $logFile -Append
    "Log file: $logFile" | Tee-Object -FilePath $logFile -Append
}

exit $exitCode
