try {
    Write-Host "Validerer app..." -ForegroundColor Cyan
    $validateOutput = homey app validate 2>&1 | Tee-Object -Variable teeBuffer
    $validateExit = $LASTEXITCODE
    $combined = ($teeBuffer | Out-String)
    $passed = $validateExit -eq 0 -and $combined -match 'App validated successfully against'

    Write-Host ""
    if ($passed) {
        Write-Host "Validering OK — fortsetter automatisk." -ForegroundColor Green
        homey app run --remote
    } else {
        Write-Host "Validering feilet (exit $validateExit)." -ForegroundColor Red
        Write-Host ""
        $answer = Read-Host "Vil du likevel kjøre appen? (Y/N)"
        if ($answer -match '^(y|yes|j|ja)$') {
            homey app run --remote
        } else {
            Write-Host "Avbrutt." -ForegroundColor Yellow
        }
    }
}
finally {
    Write-Host ""
    Write-Host "Trykk en tast for å lukke vinduet..."
    [void][System.Console]::ReadKey($true)
}
