param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if (!$SkipBuild) { & (Join-Path $PSScriptRoot 'build-app.ps1') }
& (Join-Path $PSScriptRoot 'restore-webview2.ps1')
& (Join-Path $PSScriptRoot 'prepare-runtime.ps1')
& (Join-Path $PSScriptRoot 'prepare-codecs.ps1')
$name = 'PhoneNotify-' + $version + '-win-x64'
$destination = Join-Path $PSScriptRoot ('dist\' + $name)
if (Test-Path -LiteralPath $destination) { throw 'Build output exists. Move the previous dist folder before creating another bundle' }
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$files = @('PhoneNotify.exe','NotificationPopup.exe','ClipboardWorker.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll','receiver.cjs','updater.cjs','apply-update.ps1','runtime-paths.cjs','clipboard-transfer.cjs','inbox-storage.cjs','heic-render.cjs','package.json','package-lock.json','notification-format.cjs','notification-history.cjs','notification-workers.cjs','app-icon-cache.cjs','app-icon-catalog.cjs','app-icon-catalog.json','NativeNotifications.cs','toast-worker.ps1','stop-receiver.ps1','configure-firewall.ps1','check-environment.ps1','install.ps1','uninstall.ps1','install-controls.ps1','install-startup.ps1','start.cmd','stop.cmd','README.md','LICENSE','THIRD_PARTY_NOTICES.md','node-runtime.json')
foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $destination $file) }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'codec-sources.json') -Destination $destination
foreach ($directory in @('assets','public','runtime','docs','licenses')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $directory) -Destination $destination -Recurse }
New-Item -ItemType Directory -Path (Join-Path $destination 'node_modules') | Out-Null
foreach ($name in @('libheif-js','pngjs')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('node_modules\' + $name)) -Destination (Join-Path $destination 'node_modules') -Recurse }
$entries = @(Get-ChildItem -LiteralPath $destination -Recurse -File | ForEach-Object { [ordered]@{path=$_.FullName.Substring($destination.Length + 1).Replace('\','/');sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()} })
[ordered]@{version=$version;files=$entries} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $destination 'bundle-manifest.json') -Encoding UTF8
$archive = $destination + '.zip'
Compress-Archive -LiteralPath $destination -DestinationPath $archive
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($archive + '.sha256'), ($hash + '  ' + [IO.Path]::GetFileName($archive) + "`n"), (New-Object Text.UTF8Encoding($false)))
Write-Output $archive
