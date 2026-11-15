param([string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'PhoneNotify\app'), [switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'check-environment.ps1')
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'bundle-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$source = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
$target = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
if ($target -eq [IO.Path]::GetPathRoot($target).TrimEnd('\') -or $target -eq $env:USERPROFILE) { throw 'Choose a dedicated application folder' }
foreach ($entry in $manifest.files) {
    $file = [IO.Path]::GetFullPath((Join-Path $source $entry.path))
    if (!$file.StartsWith($source,[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.sha256) { throw ('Bundle integrity check failed: ' + $entry.path) }
}
$installed = Join-Path $target 'PhoneNotify.exe'
if (Test-Path -LiteralPath $installed) {
    Start-Process -FilePath $installed -ArgumentList '--exit' -WindowStyle Hidden -Wait
    $deadline = (Get-Date).AddSeconds(20)
    do { $running = @(Get-CimInstance Win32_Process -Filter "Name='PhoneNotify.exe'" | Where-Object { $_.ExecutablePath -eq $installed }); if ($running.Count) { Start-Sleep -Milliseconds 250 } } while ($running.Count -and (Get-Date) -lt $deadline)
    if ($running.Count) { throw 'Close the existing application before upgrading' }
}
if (($target + '\') -ne $source) {
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    foreach ($entry in $manifest.files) {
        $output = [IO.Path]::GetFullPath((Join-Path $target $entry.path))
        if (!$output.StartsWith(($target + '\'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid bundle path' }
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($output)) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $source $entry.path) -Destination $output -Force
    }
    Copy-Item -LiteralPath (Join-Path $source 'bundle-manifest.json') -Destination $target -Force
}
& (Join-Path $target 'install-controls.ps1')
Write-Output ('Installed to ' + $target + '. User data is preserved in LOCALAPPDATA\PhoneNotify\data')
if (!$NoLaunch) { Start-Process -FilePath $installed }
