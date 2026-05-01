try {
    homey app run --remote
}
finally {
    Write-Host ""
    Write-Host "Trykk en tast for å lukke vinduet..."
    [void][System.Console]::ReadKey($true)
}
