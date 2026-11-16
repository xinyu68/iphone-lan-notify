param([string]$OutputName = 'PhoneNotify.exe', [string]$PopupOutputName = 'NotificationPopup.exe')
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$version=(Get-Content -LiteralPath (Join-Path $appRoot 'package.json') -Raw -Encoding UTF8|ConvertFrom-Json).version
if($version -notmatch '^\d{1,5}\.\d{1,5}\.\d{1,5}$' -or @($version.Split('.')|Where-Object{[int]$_ -gt 65534}).Count){throw 'Invalid application version'}
New-Item -ItemType Directory -Path (Join-Path $appRoot '.packages') -Force|Out-Null
$versionSource=Join-Path $appRoot '.packages\AppVersion.g.cs'
$versionCode='[assembly:System.Reflection.AssemblyVersion("'+$version+'.0")][assembly:System.Reflection.AssemblyFileVersion("'+$version+'.0")][assembly:System.Reflection.AssemblyInformationalVersion("'+$version+'")]namespace Xinyu.PhoneNotifications{internal static class AppVersion{internal const string Current="'+$version+'";}}'
[IO.File]::WriteAllText($versionSource,$versionCode,(New-Object Text.UTF8Encoding($false)))
& (Join-Path $appRoot 'build-popup.ps1') -OutputName $PopupOutputName
& (Join-Path $appRoot 'build-clipboard.ps1')
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw '.NET Framework compiler is missing' }
foreach ($dependencyFile in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll')) {
    if (!(Test-Path -LiteralPath (Join-Path $appRoot $dependencyFile))) { & (Join-Path $appRoot 'restore-webview2.ps1'); break }
}
if ([IO.Path]::GetFileName($OutputName) -ne $OutputName) { throw 'Output must be a filename within this app directory' }
$compilerArgs = @('/nologo','/target:winexe','/platform:x64','/codepage:65001','/langversion:5',
    '/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Management.dll',
    '/reference:System.Web.Extensions.dll',('/reference:' + (Join-Path $appRoot 'Microsoft.Web.WebView2.Core.dll')),
    ('/reference:' + (Join-Path $appRoot 'Microsoft.Web.WebView2.WinForms.dll')),('/win32icon:' + (Join-Path $appRoot 'assets\app.ico')),
    ('/out:' + (Join-Path $appRoot $OutputName)),(Join-Path $appRoot 'PhoneNotify.cs'),(Join-Path $appRoot 'DesktopSettings.cs'),(Join-Path $appRoot 'ConnectionSettings.cs'),(Join-Path $appRoot 'ClipboardSettings.cs'),(Join-Path $appRoot 'AppEnvironment.cs'),(Join-Path $appRoot 'NotificationActivation.cs'),(Join-Path $appRoot 'NativeNotifications.cs'))
$compilerArgs += @($versionSource,(Join-Path $appRoot 'UpdateSettings.cs'))
& $compiler @compilerArgs
if ($LASTEXITCODE -ne 0) { throw 'Phone notification controller build failed' }
