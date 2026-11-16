param([string]$OutputName = 'ClipboardWorker.exe')
$ErrorActionPreference = 'Stop'
if ([IO.Path]::GetFileName($OutputName) -ne $OutputName) { throw 'Output must be a filename in this app directory' }
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:exe /platform:x64 /codepage:65001 /langversion:5 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /reference:System.Core.dll ('/out:' + (Join-Path $PSScriptRoot $OutputName)) (Join-Path $PSScriptRoot 'ClipboardWorker.cs')
if ($LASTEXITCODE -ne 0) { throw 'Clipboard worker build failed' }
