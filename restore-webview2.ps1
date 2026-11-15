$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$dependency = Get-Content -LiteralPath (Join-Path $appRoot 'webview2-dependency.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$cache = Join-Path $appRoot '.packages'
if (!(Test-Path -LiteralPath $cache)) { New-Item -ItemType Directory -Path $cache | Out-Null }
$package = Join-Path $cache ('microsoft.web.webview2.' + $dependency.version + '.nupkg')
if (!(Test-Path -LiteralPath $package)) { Invoke-WebRequest -UseBasicParsing -Uri $dependency.source -OutFile $package }
if ((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash -ne $dependency.sha256) { throw 'WebView2 package hash does not match the pinned dependency' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($package)
$entries = @{'lib/net462/Microsoft.Web.WebView2.Core.dll'='Microsoft.Web.WebView2.Core.dll';'lib/net462/Microsoft.Web.WebView2.WinForms.dll'='Microsoft.Web.WebView2.WinForms.dll';'runtimes/win-x64/native/WebView2Loader.dll'='WebView2Loader.dll'}
try {
    foreach ($entryName in $entries.Keys) {
        $entry = $archive.GetEntry($entryName)
        if ($null -eq $entry) { throw 'Required WebView2 SDK file is missing' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(Join-Path $appRoot $entries[$entryName]),$true)
    }
    $licenses = Join-Path $appRoot 'licenses'
    New-Item -ItemType Directory -Path $licenses -Force | Out-Null
    foreach ($name in @('LICENSE.txt','NOTICE.txt')) {
        $entry = $archive.GetEntry($name)
        if (!$entry) { throw 'WebView2 SDK license metadata is missing' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(Join-Path $licenses ('WebView2-' + $name)),$true)
    }
} finally { $archive.Dispose() }
Write-Output 'Pinned WebView2 SDK restored'
