$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataRoot = if ($env:PHONE_NOTIFY_DATA_DIR) { $env:PHONE_NOTIFY_DATA_DIR } elseif (Test-Path -LiteralPath (Join-Path $appRoot 'config.json')) { $appRoot } else { Join-Path $env:LOCALAPPDATA 'PhoneNotify\data' }
$config = Get-Content -LiteralPath (Join-Path $dataRoot 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$receiverPath = Join-Path $appRoot 'receiver.cjs'
$receiverPattern = '(?:^|\s)"?' + [regex]::Escape($receiverPath) + '"?(?:\s|$)'
$workerPath = Join-Path $appRoot 'toast-worker.ps1'
$workerPattern = '(?:^|\s)"?' + [regex]::Escape($workerPath) + '"?(?:\s|$)'
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$popupPath = Join-Path $appRoot 'NotificationPopup.exe'

function Get-ReceiverProcesses {
    @(Get-CimInstance -ClassName Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $_.ExecutablePath -eq $config.nodePath -and $_.CommandLine -match $receiverPattern
    })
}

$receivers = @(Get-ReceiverProcesses)
if ($receivers.Count -eq 0) { Write-Output 'Receiver is already stopped'; exit 0 }
try {
    $stopUrl = 'http://' + $config.host + ':' + $config.port + '/stop/' + $config.token
    Invoke-RestMethod -Uri $stopUrl -Method Post -TimeoutSec 2 | Out-Null
} catch {}
$deadline = (Get-Date).AddSeconds(3)
while ((Get-Date) -lt $deadline) {
    if (@(Get-ReceiverProcesses).Count -eq 0) { Write-Output 'Receiver stopped'; exit 0 }
    Start-Sleep -Milliseconds 150
}

# Only stop processes whose executable and absolute script path match this installation.
foreach ($receiver in @(Get-ReceiverProcesses)) {
    $children = @(Get-CimInstance -ClassName Win32_Process -Filter ("ParentProcessId=" + $receiver.ProcessId + " AND Name='powershell.exe'") | Where-Object {
        $_.ExecutablePath -eq $powershellPath -and $_.CommandLine -match $workerPattern
    })
    foreach ($child in $children) { Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue }
    $popups = @(Get-CimInstance -ClassName Win32_Process -Filter ("ParentProcessId=" + $receiver.ProcessId + " AND Name='NotificationPopup.exe'") | Where-Object { $_.ExecutablePath -eq $popupPath })
    foreach ($popup in $popups) { Stop-Process -Id $popup.ProcessId -ErrorAction SilentlyContinue }
    $clipboardPath = Join-Path $appRoot 'ClipboardWorker.exe'
    $clipboards = @(Get-CimInstance -ClassName Win32_Process -Filter ("ParentProcessId=" + $receiver.ProcessId + " AND Name='ClipboardWorker.exe'") | Where-Object { $_.ExecutablePath -eq $clipboardPath })
    foreach ($clipboard in $clipboards) { Stop-Process -Id $clipboard.ProcessId -ErrorAction SilentlyContinue }
    Stop-Process -Id $receiver.ProcessId -ErrorAction SilentlyContinue
}
if (@(Get-ReceiverProcesses).Count -gt 0) { throw 'Receiver did not stop' }
Write-Output 'Receiver stopped'
