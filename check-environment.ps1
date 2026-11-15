param([switch]$InstallWebView2)
$ErrorActionPreference = 'Stop'
$version = [Environment]::OSVersion.Version
if (![Environment]::Is64BitOperatingSystem) { throw 'This build requires Windows x64' }
$framework = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -ErrorAction SilentlyContinue
if (!$framework -or $framework.Release -lt 394802) { throw '.NET Framework 4.6.2 or newer is required; .NET Framework 4.8 is recommended' }
# Discover EdgeUpdate client records by their WebView2 product name rather than relying on a machine-specific registry view.
function Get-WebView2Runtime {
    foreach ($base in @('HKCU:\Software\Microsoft\EdgeUpdate\Clients','HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients','HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients')) {
        if (Test-Path -LiteralPath $base) {
            foreach ($key in Get-ChildItem -LiteralPath $base) {
                $item = Get-ItemProperty -LiteralPath $key.PSPath
                if ($item.name -match 'WebView2' -and $item.pv -and $item.pv -ne '0.0.0.0') { return $item.pv }
            }
        }
    }
    return $null
}
$webview = Get-WebView2Runtime
if (!$webview -and $InstallWebView2) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $installer = Join-Path ([IO.Path]::GetTempPath()) ('PhoneNotify-WebView2-' + [Guid]::NewGuid().ToString('N') + '.exe')
    try {
        Invoke-WebRequest -UseBasicParsing -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $installer
        $signature = Get-AuthenticodeSignature -LiteralPath $installer
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'WebView2 installer is not signed by Microsoft' }
        $process = Start-Process -FilePath $installer -ArgumentList '/silent','/install' -WindowStyle Hidden -PassThru -Wait
        if ($process.ExitCode -ne 0) { throw ('WebView2 installer exit code: ' + $process.ExitCode) }
        $webview = Get-WebView2Runtime
    } finally { if (Test-Path -LiteralPath $installer) { Remove-Item -LiteralPath $installer } }
}
$node = Join-Path $PSScriptRoot 'runtime\node.exe'
if (!(Test-Path -LiteralPath $node)) { $command = Get-Command node.exe -ErrorAction SilentlyContinue; if ($command) { $node = $command.Source } else { throw 'Node.js is missing. Use a complete Windows bundle or run prepare-runtime.ps1' } }
$nodeVersion = & $node --version
if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 20) { throw 'Node.js 20 or later is required' }
[pscustomobject]@{ Windows=$version.ToString(); Architecture='x64'; FrameworkRelease=$framework.Release; WebView2=$webview; Node=$nodeVersion; NodePath=$node } | Format-List
if (!$webview) { throw 'WebView2 Runtime is missing. Run check-environment.ps1 -InstallWebView2 or install it from Microsoft' }
