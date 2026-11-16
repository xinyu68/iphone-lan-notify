$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $appRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$restore = $false
foreach ($name in @('libheif-js','pngjs')) {
    $manifest = Join-Path $appRoot ('node_modules\' + $name + '\package.json')
    if (!(Test-Path -LiteralPath $manifest)) { $restore = $true; break }
    $installed = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($installed.version -ne $package.dependencies.$name) { $restore = $true; break }
}
if ($restore) {
    Push-Location $appRoot
    try { & npm.cmd ci --ignore-scripts --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'HEIC dependency restore failed' } }
    finally { Pop-Location }
}
Write-Output 'Pinned HEIC and PNG codecs ready'
$sourceRoot = Join-Path $appRoot 'licenses\codec-sources'
New-Item -ItemType Directory -Path $sourceRoot -Force | Out-Null
foreach ($source in (Get-Content -LiteralPath (Join-Path $appRoot 'codec-sources.json') -Raw -Encoding UTF8 | ConvertFrom-Json)) {
    $destination = Join-Path $sourceRoot $source.name
    if (!(Test-Path -LiteralPath $destination)) {
        $temporary = $destination + '.download'
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $source.url -OutFile $temporary
            if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $source.sha256) { throw 'Codec source checksum mismatch' }
            Move-Item -LiteralPath $temporary -Destination $destination
        } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
    }
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $source.sha256) { throw 'Codec source checksum mismatch' }
}
Write-Output 'Corresponding codec sources verified for redistribution'
