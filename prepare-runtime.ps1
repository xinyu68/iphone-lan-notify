$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$spec = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'node-runtime.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$directory = Join-Path $PSScriptRoot '.packages'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
$archive = Join-Path $directory ('node-' + $spec.version + '-win-x64.zip')
if (!(Test-Path -LiteralPath $archive)) { Invoke-WebRequest -UseBasicParsing -Uri $spec.source -OutFile $archive }
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $spec.sha256) { throw 'Node.js archive checksum mismatch' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
$runtime = Join-Path $PSScriptRoot 'runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
try {
    foreach ($name in @('node.exe','LICENSE')) {
        $entry = $zip.GetEntry('node-' + $spec.version + '-win-x64/' + $name)
        if (!$entry) { throw 'Incomplete Node.js archive' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $runtime $name), $true)
    }
} finally { $zip.Dispose() }
Write-Output ('Prepared verified Node.js ' + $spec.version)
