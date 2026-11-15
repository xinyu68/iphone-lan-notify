$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$controlsRoot = Join-Path $appRoot 'controls'
$desktop = [Environment]::GetFolderPath('Desktop')
$scriptHost = Join-Path $env:SystemRoot 'System32\wscript.exe'
$shell = New-Object -ComObject WScript.Shell
$appPath = Join-Path $appRoot 'PhoneNotify.exe'
$appName = -join [char[]]@(0x624B,0x673A,0x901A,0x77E5)
$legacyControls = @(
    @{ Name=(-join [char[]]@(0x5F00,0x542F,0x624B,0x673A,0x901A,0x77E5)); Script='start-hidden.vbs' },
    @{ Name=(-join [char[]]@(0x5173,0x95ED,0x624B,0x673A,0x901A,0x77E5)); Script='stop-hidden.vbs' }
)
if (!(Test-Path -LiteralPath $appPath -PathType Leaf)) { throw 'Build PhoneNotify.exe first' }
if (!(Test-Path -LiteralPath $controlsRoot)) { New-Item -ItemType Directory -Path $controlsRoot | Out-Null }
foreach ($folder in @($controlsRoot, $desktop)) {
    $shortcutPath = Join-Path $folder ($appName + '.lnk')
    if (Test-Path -LiteralPath $shortcutPath) {
        if ($shell.CreateShortcut($shortcutPath).TargetPath -ne $appPath) { throw 'An unrelated app shortcut already exists' }
    }
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $appPath
    $shortcut.WorkingDirectory = $appRoot
    $shortcut.Description = 'Control receiving iPhone notifications'
    $iconPath = Join-Path $appRoot 'assets\app.ico'
    $updatedIcon = Join-Path $appRoot 'assets\app-no-bell.ico'
    if (Test-Path -LiteralPath $updatedIcon) { $iconPath = $updatedIcon }
    if (Test-Path -LiteralPath $iconPath) { $shortcut.IconLocation = $iconPath + ',0' }
    $shortcut.Save()
    foreach ($legacy in $legacyControls) {
        $legacyPath = Join-Path $folder ($legacy.Name + '.lnk')
        if (Test-Path -LiteralPath $legacyPath) {
            $existing = $shell.CreateShortcut($legacyPath)
            $expected = '//B //nologo "' + (Join-Path $appRoot $legacy.Script) + '"'
            if ($existing.TargetPath -ne $scriptHost -or $existing.Arguments -ne $expected) { throw 'An unrelated shortcut has a legacy control name' }
            Remove-Item -LiteralPath $legacyPath
        }
    }
}
[pscustomobject]@{DesktopShortcut=(Join-Path $desktop ($appName + '.lnk'));LegacyControlsRemoved=$true} | ConvertTo-Json -Compress
