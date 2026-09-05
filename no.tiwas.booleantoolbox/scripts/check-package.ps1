param(
    [int]$MaximumSizeMB = 10
)

$ErrorActionPreference = 'Stop'
$appDirectory = Split-Path -Parent $PSScriptRoot
Push-Location $appDirectory
try {
    homey app validate --level=publish
    if ($LASTEXITCODE -ne 0) { throw 'Homey publish validation failed.' }

    $buildDirectory = Join-Path $appDirectory '.homeybuild'
    if (-not (Test-Path $buildDirectory)) { throw '.homeybuild was not generated.' }

    $includedFiles = Get-ChildItem -LiteralPath $buildDirectory -Recurse -File
    $forbiddenFiles = $includedFiles | Where-Object {
        $_.FullName -notmatch '[\\/]node_modules[\\/]' -and (
            $_.Name -like '*.test.js' -or
            $_.Name -like '*.bak' -or
            $_.Name -like '*.log' -or
            $_.FullName -match '[\\/](coverage|tests|scripts|\.codex-logs)[\\/]' -or
            $_.FullName -match '\.backup([\\/]|$)'
        )
    }
    if ($forbiddenFiles) {
        $forbiddenFiles.FullName | ForEach-Object { Write-Error "Unexpected development artifact: $_" }
        throw 'Development artifacts were included in the Homey bundle.'
    }

    $manifest = Get-Content (Join-Path $buildDirectory 'app.json') -Raw | ConvertFrom-Json
    $assetReferences = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    function Find-AssetReferences($value) {
        if ($value -is [string]) {
            if ($value -match '^/assets/') { [void]$assetReferences.Add($value) }
            return
        }
        if ($value -is [System.Collections.IEnumerable]) {
            foreach ($item in $value) { Find-AssetReferences $item }
            return
        }
        if ($null -ne $value) {
            foreach ($property in $value.PSObject.Properties) { Find-AssetReferences $property.Value }
        }
    }
    Find-AssetReferences $manifest
    foreach ($assetReference in $assetReferences) {
        $assetPath = Join-Path $buildDirectory $assetReference.TrimStart('/')
        if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf)) {
            throw "Manifest asset is missing from the Homey bundle: $assetReference"
        }
    }

    $sizeBytes = ($includedFiles | Measure-Object -Property Length -Sum).Sum
    $sizeMB = [math]::Round($sizeBytes / 1MB, 2)
    Write-Host "Homey bundle: $($includedFiles.Count) files, $sizeMB MB; $($assetReferences.Count) manifest assets verified"
    if ($sizeMB -gt $MaximumSizeMB) {
        throw "Homey bundle exceeds the $MaximumSizeMB MB limit."
    }
}
finally {
    Pop-Location
}
