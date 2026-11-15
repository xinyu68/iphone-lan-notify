$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$taskApp = Join-Path $taskRoot 'PhoneNotify.exe'
$taskData = if ($env:PHONE_NOTIFY_DATA_DIR) { $env:PHONE_NOTIFY_DATA_DIR } elseif (Test-Path -LiteralPath (Join-Path $taskRoot 'config.json')) { $taskRoot } else { Join-Path $env:LOCALAPPDATA 'PhoneNotify\data' }
$taskStateFile = Join-Path $taskData 'controller-state.json'
$taskVerification = Join-Path $taskRoot '.verification'
$taskRunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$taskRunName = 'IPhoneLanNotify'
if (!(Test-Path -LiteralPath $taskVerification)) { New-Item -ItemType Directory -Path $taskVerification | Out-Null }
function Read-DesktopState { Get-Content -LiteralPath $taskStateFile -Raw -Encoding UTF8 | ConvertFrom-Json }
function Read-LoginStartup {
    $property = (Get-ItemProperty -LiteralPath $taskRunKey).PSObject.Properties[$taskRunName]
    $null -ne $property
}
function Inspect-Desktop([string]$operation) {
    $begin = (Get-Date).ToUniversalTime()
    @{operation=$operation} | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $taskVerification 'request.json') -Encoding UTF8
    Start-Process -FilePath $taskApp -ArgumentList '--inspect-ui' -WindowStyle Hidden -Wait
    $resultPath = Join-Path $taskVerification 'desktop-check.json'
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        if ((Test-Path -LiteralPath $resultPath) -and (Get-Item -LiteralPath $resultPath).LastWriteTimeUtc -ge $begin) {
            $result = Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($result.PSObject.Properties['error']) { throw $result.error }
            return $result
        }
        Start-Sleep -Milliseconds 150
    }
    throw ('Embedded UI operation timed out: ' + $operation)
}

$taskInitial = Read-DesktopState
if (!$taskInitial.webReady -or !$taskInitial.ready) { throw 'Open the app with receiving enabled before running this check' }
try {
    $taskSetup = Inspect-Desktop 'setup'
    if ($taskSetup.switches -ne 2 -or !$taskSetup.configured -or !$taskSetup.importShortcutPresent -or !$taskSetup.exportScriptPresent -or !$taskSetup.brandIconLoaded -or !$taskSetup.importQrLoaded -or $taskSetup.horizontalOverflow) { throw 'Embedded settings layout or phone configuration did not load correctly' }
    $taskStartupChanged = Inspect-Desktop 'startup'
    if ((Read-LoginStartup) -eq $taskInitial.startupEnabled -or [bool]::Parse($taskStartupChanged.startup) -eq $taskInitial.startupEnabled) { throw 'Embedded startup switch did not change the actual login entry' }
    $taskStartupRestored = Inspect-Desktop 'startup'
    if ((Read-LoginStartup) -ne $taskInitial.startupEnabled -or [bool]::Parse($taskStartupRestored.startup) -ne $taskInitial.startupEnabled) { throw 'Startup switch did not restore the original preference' }
    $taskOff = Inspect-Desktop 'receiving'
    $taskOffState = Read-DesktopState
    if ([bool]::Parse($taskOff.receive) -or $taskOffState.receiving -or !$taskOffState.webReady -or !$taskOff.configured -or $taskOff.scriptLength -lt 500) { throw 'Settings must remain usable after the receiver is stopped' }
    $taskOn = Inspect-Desktop 'receiving'
    if (![bool]::Parse($taskOn.receive)) { throw 'Embedded receive switch did not restart the receiver' }
    $taskReadyDeadline = (Get-Date).AddSeconds(15)
    while (!(Read-DesktopState).ready) {
        if ((Get-Date) -ge $taskReadyDeadline) { throw 'Notification worker did not recover' }
        Start-Sleep -Milliseconds 150
    }
    [void](Inspect-Desktop 'notifications')
    $taskNotification = Inspect-Desktop 'test'
    if ($taskNotification.records -lt 1) { throw 'Test notification was not recorded through the embedded UI' }
    $taskConfig = Get-Content -LiteralPath (Join-Path $taskData 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $taskOrigin = 'http://' + $taskConfig.host + ':' + $taskConfig.port
    $taskHistory = Invoke-RestMethod -Uri ($taskOrigin + '/status/' + $taskConfig.token) -TimeoutSec 3
    if ($taskHistory.shown -lt 1) { throw 'Embedded UI test did not reach Windows notifications' }
    try { Invoke-WebRequest -UseBasicParsing -Uri ($taskOrigin + '/setup/' + $taskConfig.token) -TimeoutSec 3 | Out-Null; throw 'Old setup page remains available' }
    catch { if ($null -eq $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 410) { throw } }
    [pscustomobject]@{EmbeddedPageLoaded=$true;SharedShortcutQrLoaded=$true;StartupSwitchChangesRegistry=$true;SettingsWorkWhileReceiverOff=$true;ReceiveSwitchRestoresNotifications=$true;EmbeddedTestReachesWindows=$true;LegacySetupHttpStatus=410;FinalState=(Read-DesktopState)} | ConvertTo-Json -Depth 3 -Compress
} finally {
    if ((Read-LoginStartup) -ne $taskInitial.startupEnabled) {
        if ($taskInitial.startupEnabled) { & (Join-Path $taskRoot 'install-startup.ps1') }
        else { & (Join-Path $taskRoot 'install-startup.ps1') -Remove }
    }
    $taskFinal = Read-DesktopState
    if ($taskFinal.preferred -ne $taskInitial.preferred) {
        $restore = if ($taskInitial.preferred) { '--on' } else { '--off' }
        Start-Process -FilePath $taskApp -ArgumentList $restore -WindowStyle Hidden -Wait
    }
}
