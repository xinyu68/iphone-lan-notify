param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$valueName = 'IPhoneLanNotify'
$launcher = Join-Path $appRoot 'PhoneNotify.exe'
$scriptHost = Join-Path $env:SystemRoot 'System32\wscript.exe'
$command = '"' + $launcher + '" --background'
$legacyCommand = '"' + $scriptHost + '" //B //nologo "' + (Join-Path $appRoot 'start-hidden.vbs') + '"'
$existing = $null
if (Test-Path -LiteralPath $runKey) {
    $existingProperty = (Get-ItemProperty -LiteralPath $runKey).PSObject.Properties[$valueName]
    if ($null -ne $existingProperty) { $existing = $existingProperty.Value }
}
if ($null -ne $existing -and $existing -cne $command -and $existing -cne $legacyCommand) {
    throw 'An unrelated startup entry already uses IPhoneLanNotify'
}
if ($Remove) {
    if ($null -ne $existing) { Remove-ItemProperty -LiteralPath $runKey -Name $valueName }
    Write-Output 'Login startup disabled'
    exit
}
if (!(Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'Phone notification app is missing' }
if (!(Test-Path -LiteralPath $runKey)) { New-Item -Path $runKey -Force | Out-Null }
New-ItemProperty -LiteralPath $runKey -Name $valueName -Value $command -PropertyType String -Force | Out-Null
if ((Get-ItemPropertyValue -LiteralPath $runKey -Name $valueName) -cne $command) {
    throw 'Startup entry verification failed'
}
Write-Output 'Login startup installed for the current user'
