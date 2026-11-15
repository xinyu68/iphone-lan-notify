param([string]$OutputName = 'NotificationPopup.exe')
$ErrorActionPreference = 'Stop'
if ([IO.Path]::GetFileName($OutputName) -ne $OutputName) { throw 'Output must be a filename in this app directory' }
$cuCompiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$cuWpf = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\WPF'
$cuArguments = @('/nologo', '/target:winexe', '/platform:x64', '/codepage:65001', '/langversion:5',
    '/reference:System.dll', '/reference:System.Core.dll', '/reference:System.Xaml.dll', '/reference:System.Web.Extensions.dll',
    ('/reference:' + (Join-Path $cuWpf 'PresentationFramework.dll')),
    ('/reference:' + (Join-Path $cuWpf 'PresentationCore.dll')),
    ('/reference:' + (Join-Path $cuWpf 'WindowsBase.dll')),
    ('/resource:' + (Join-Path $PSScriptRoot 'assets\app-icon.png') + ',PhoneNotifyFallback.png'),
    ('/win32icon:' + (Join-Path $PSScriptRoot 'assets\app.ico')),
    ('/out:' + (Join-Path $PSScriptRoot $OutputName)), (Join-Path $PSScriptRoot 'NotificationPopup.cs'))
& $cuCompiler @cuArguments
if ($LASTEXITCODE -ne 0) { throw 'Custom notification popup build failed' }
Write-Output (Join-Path $PSScriptRoot $OutputName)
