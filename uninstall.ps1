$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot 'PhoneNotify.exe'
Start-Process -FilePath $exe -ArgumentList '--exit' -WindowStyle Hidden -Wait
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$value = (Get-ItemProperty -LiteralPath $run -ErrorAction SilentlyContinue).IPhoneLanNotify
if ($value -eq ('"' + $exe + '" --background')) { Remove-ItemProperty -LiteralPath $run -Name IPhoneLanNotify }
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), (Join-Path $PSScriptRoot 'controls'))) {
    $shortcut = Join-Path $folder ((-join [char[]]@(0x624B,0x673A,0x901A,0x77E5)) + '.lnk')
    if ((Test-Path -LiteralPath $shortcut) -and $shell.CreateShortcut($shortcut).TargetPath -eq $exe) { Remove-Item -LiteralPath $shortcut }
}
$clsid = 'HKCU:\Software\Classes\CLSID\{F493D55B-4C7A-41DB-A632-524394C4B49E}'
$serverKey = Get-Item -LiteralPath ($clsid + '\LocalServer32') -ErrorAction SilentlyContinue
$server = if ($serverKey) { $serverKey.GetValue('') } else { $null }
if ($server -eq ('"' + $exe + '" --toast-activated')) {
    Remove-Item -LiteralPath $clsid -Recurse
    $protocol = 'HKCU:\Software\Classes\xinyu-phone-notify'
    if (Test-Path -LiteralPath $protocol) { Remove-Item -LiteralPath $protocol -Recurse }
}
Write-Output 'Startup, owned desktop shortcut and owned activation registration removed. User history and pairing settings were preserved. You may now delete this application folder; firewall rules can be removed separately with configure-firewall.ps1 -Remove.'
