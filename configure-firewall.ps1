param([Parameter(Mandatory=$true)][string]$NodePath, [ValidateRange(1024,65535)][int]$Port = 18766, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this command as administrator' }
$exe = [IO.Path]::GetFullPath($NodePath)
if ([IO.Path]::GetFileName($exe) -ne 'node.exe' -or !(Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Expected an existing node.exe' }
$sha = [Security.Cryptography.SHA256]::Create()
try { $identity = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($exe.ToLowerInvariant())))).Replace('-','').Substring(0,16) } finally { $sha.Dispose() }
$name = 'PhoneNotify-' + $identity + '-' + $Port
$existing = Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue
if ($existing) {
    $filter = $existing | Get-NetFirewallApplicationFilter
    if ($filter.Program -ne $exe) { throw 'Firewall rule belongs to another executable' }
    $existing | Remove-NetFirewallRule
}
if (!$Remove) {
    New-NetFirewallRule -Name $name -DisplayName ('PhoneNotify LAN receiver (' + $Port + ')') -Group 'PhoneNotify' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Program $exe -Profile Private -RemoteAddress LocalSubnet | Out-Null
}
