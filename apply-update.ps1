param([Parameter(Mandatory=$true)][string]$AppRoot,[Parameter(Mandatory=$true)][string]$DataRoot,[Parameter(Mandatory=$true)][string]$Stage,[Parameter(Mandatory=$true)][int]$ParentId,[switch]$ValidateOnly)
$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')+[IO.Path]::PathSeparator+[IO.Path]::Combine([Environment]::GetFolderPath('ProgramFiles'),'WindowsPowerShell','Modules')
$ErrorActionPreference='Stop'
$app=[IO.Path]::GetFullPath($AppRoot).TrimEnd('\')
$data=[IO.Path]::GetFullPath($DataRoot).TrimEnd('\')
$stagePath=[IO.Path]::GetFullPath($Stage).TrimEnd('\')
$updates=[IO.Path]::GetFullPath((Join-Path $data '.updates')).TrimEnd('\')
if($app -eq [IO.Path]::GetPathRoot($app).TrimEnd('\') -or $app -eq $env:USERPROFILE -or [IO.Path]::GetDirectoryName($stagePath) -ne $updates -or [IO.Path]::GetFileName($stagePath) -notmatch '^[a-f0-9]{32}$'){throw 'Invalid update paths'}
foreach($directory in @($app,$data,$updates,$stagePath)){if((Get-Item -LiteralPath $directory).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Update path is a link'}}
$result=Join-Path $data 'update-result.json'
$copied=@();$backup=Join-Path $stagePath 'backup';$exited=$false;$appChanged=$false
function Save-Result($value){$body=$value|ConvertTo-Json -Depth 5;$temporary=$result+'.'+[Guid]::NewGuid().ToString('N')+'.tmp';[IO.File]::WriteAllText($temporary,$body,(New-Object Text.UTF8Encoding($false)));if([IO.File]::Exists($result)){[IO.File]::Replace($temporary,$result,$null)}else{[IO.File]::Move($temporary,$result)};$body|Set-Content -LiteralPath (Join-Path $stagePath 'result.json') -Encoding UTF8}
try {
    $meta=Get-Content -LiteralPath (Join-Path $stagePath 'download.json') -Raw -Encoding UTF8|ConvertFrom-Json
    if($meta.version -notmatch '^\d{1,5}\.\d{1,5}\.\d{1,5}$' -or $meta.sha256 -notmatch '^[a-f0-9]{64}$'){throw 'Invalid update metadata'}
    $archive=Join-Path $stagePath 'package.zip'
    if((Get-Item -LiteralPath $archive).Length -ne $meta.size -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $meta.sha256){throw 'Update archive checksum mismatch'}
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $packageName='PhoneNotify-'+$meta.version+'-win-x64'
    $zip=[IO.Compression.ZipFile]::OpenRead($archive)
    try {
        $expanded=0L;$names=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        foreach($entry in $zip.Entries){
            $name=$entry.FullName.Replace('\','/')
            if(!$name.StartsWith(($packageName+'/'),[StringComparison]::Ordinal) -or $name -match '(^|/)\.\.?(/|$)|:|[\x00-\x1f]' -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000){throw 'Unsafe update archive entry'}
            if(!$names.Add($name)){throw 'Duplicate update archive entry'}
            $expanded+=$entry.Length
            if($expanded -gt 650MB -or $entry.Length -gt 200MB -or $zip.Entries.Count -gt 5000){throw 'Update archive is too large'}
        }
    } finally {$zip.Dispose()}
    $unpack=Join-Path $stagePath 'unpacked'
    if(Test-Path -LiteralPath $unpack){throw 'Update has already been prepared'}
    [IO.Compression.ZipFile]::ExtractToDirectory($archive,$unpack)
    $source=Join-Path $unpack $packageName
    $manifest=Get-Content -LiteralPath (Join-Path $source 'bundle-manifest.json') -Raw -Encoding UTF8|ConvertFrom-Json
    if($manifest.version -ne $meta.version -or $manifest.files.Count -lt 10 -or $manifest.files.Count -gt 5000){throw 'Invalid bundle manifest'}
    $seen=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach($entry in $manifest.files){
        $relative=$entry.path.Replace('\','/')
        if($relative -match '(^|/)\.\.?(/|$)|:|[\x00-\x1f]' -or $relative.StartsWith('/') -or !$seen.Add($relative) -or $entry.sha256 -notmatch '^[a-f0-9]{64}$'){throw 'Unsafe bundle manifest path'}
        $first=$relative.Split('/')[0]
        if($first -match '^(config\.json|preferences\.json|runtime\.json|controller-state\.json|receiver\.log|clipboard-receipts\.json|update-result\.json|bundle-manifest\.json|inbox|clipboard-text|\.incoming|\.updates|\.private|\.webview2-profile|\.icon-cache|\.notification-history\.json)$'){throw 'Bundle attempts to overwrite user data'}
        $file=[IO.Path]::GetFullPath((Join-Path $source $entry.path))
        if(!$file.StartsWith(($source+'\'),[StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $file -PathType Leaf) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256){throw 'Bundle file checksum mismatch'}
    }
    foreach($required in @('PhoneNotify.exe','receiver.cjs','package.json','public/desktop.html','updater.cjs','apply-update.ps1','runtime/node.exe')){if(!$seen.Contains($required)){throw ('Missing update file: '+$required)}}
    $package=Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw -Encoding UTF8|ConvertFrom-Json
    if($package.version -ne $meta.version){throw 'Package version mismatch'}
    if($ValidateOnly){Write-Output 'PASS: update archive and manifest validated';return}
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class PhoneNotifyUpdatePath {
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle file,StringBuilder output,uint length,uint flags);
    public static string Resolve(string path) {
        using(var file=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)) {
            var result=new StringBuilder(32768);
            uint count=GetFinalPathNameByHandle(file.SafeFileHandle,result,(uint)result.Capacity,0);
            if(count==0||count>=result.Capacity)throw new IOException("Unable to resolve update process path");
            return result.ToString();
        }
    }
}
'@
    $parent=[Diagnostics.Process]::GetProcessById($ParentId)
    if(!$parent -or ![string]::Equals([PhoneNotifyUpdatePath]::Resolve($parent.MainModule.FileName),[PhoneNotifyUpdatePath]::Resolve((Join-Path $app 'PhoneNotify.exe')),[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected update parent process'}
    @{version=$meta.version}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $stagePath 'ready.json') -Encoding UTF8
    $deadline=(Get-Date).AddSeconds(90)
    while(Get-Process -Id $ParentId -ErrorAction SilentlyContinue){if((Get-Date) -gt $deadline){throw 'Application did not exit; no files installed'};Start-Sleep -Milliseconds 250}
    $exited=$true
    $entries=@($manifest.files)+@([pscustomobject]@{path='bundle-manifest.json'})
    foreach($entry in $entries){
        $destination=[IO.Path]::GetFullPath((Join-Path $app $entry.path))
        if(!$destination.StartsWith(($app+'\'),[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid update destination'}
        $folder=[IO.Path]::GetDirectoryName($destination)
        while($folder.Length -ge $app.Length){if((Test-Path -LiteralPath $folder) -and ((Get-Item -LiteralPath $folder).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Update destination is a link'};if($folder -eq $app){break};$folder=[IO.Path]::GetDirectoryName($folder)}
        if((Test-Path -LiteralPath $destination) -and ((Get-Item -LiteralPath $destination).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Update destination file is a link'}
        $saved=Join-Path $backup $entry.path;$exists=Test-Path -LiteralPath $destination
        if($exists){New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($saved)) -Force|Out-Null;Copy-Item -LiteralPath $destination -Destination $saved}
        $copied+=@{destination=$destination;backup=$saved;existed=$exists}
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force|Out-Null
        $appChanged=$true
        for($attempt=0;;$attempt++){try{Copy-Item -LiteralPath (Join-Path $source $entry.path) -Destination $destination -Force;break}catch{if($attempt -ge 15){throw};Start-Sleep -Milliseconds 300}}
    }
    $env:PHONE_NOTIFY_DATA_DIR=$data
    $newProcess=Start-Process -FilePath (Join-Path $app 'PhoneNotify.exe') -WorkingDirectory $app -WindowStyle Hidden -PassThru
    $deadline=(Get-Date).AddSeconds(60);$healthy=$false
    do{
        Start-Sleep -Milliseconds 300
        try{$state=Get-Content -LiteralPath (Join-Path $data 'controller-state.json') -Raw -Encoding UTF8|ConvertFrom-Json;$healthy=$state.pid -eq $newProcess.Id -and $state.version -eq $meta.version -and $state.webReady -and (!($state.preferred -or $state.clipboardEnabled) -or $state.ready)}catch{}
        $newProcess.Refresh()
    }while(!$healthy -and !$newProcess.HasExited -and (Get-Date) -lt $deadline)
    if(!$healthy){throw 'Updated application did not become ready; restoring previous version'}
    Save-Result @{ok=$true;version=$meta.version;at=[DateTime]::UtcNow.ToString('o')}
    try{
        Remove-Item -LiteralPath $archive -Force
        $unpackFull=[IO.Path]::GetFullPath($unpack)
        if($unpackFull.StartsWith(($stagePath+'\'),[StringComparison]::OrdinalIgnoreCase) -and !((Get-Item -LiteralPath $unpackFull).Attributes -band [IO.FileAttributes]::ReparsePoint)){Remove-Item -LiteralPath $unpackFull -Recurse -Force}
        $keep=0
        foreach($previous in @(Get-ChildItem -LiteralPath $updates -Directory|Sort-Object LastWriteTimeUtc -Descending)){
            if($previous.FullName -eq $stagePath -or $previous.Name -notmatch '^[a-f0-9]{32}$' -or ($previous.Attributes -band [IO.FileAttributes]::ReparsePoint)){continue}
            $previousResult=Join-Path $previous.FullName 'result.json'
            if((Test-Path -LiteralPath $previousResult) -and (Get-Content -LiteralPath $previousResult -Raw -Encoding UTF8|ConvertFrom-Json).ok){$keep++;if($keep -gt 1 -and [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($previous.FullName)) -eq $updates){Remove-Item -LiteralPath $previous.FullName -Recurse -Force}}
        }
    }catch{}
} catch {
    $problem=$_.Exception.Message
    if($newProcess -and !$newProcess.HasExited){
        try{& (Join-Path $app 'stop-receiver.ps1')}catch{}
        Stop-Process -Id $newProcess.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 400
    }
    $rollbackErrors=@()
    if($appChanged){for($i=$copied.Count-1;$i -ge 0;$i--){$entry=$copied[$i];try{if($entry.existed){if(!(Test-Path -LiteralPath $entry.destination -PathType Leaf) -or (Get-FileHash -LiteralPath $entry.backup).Hash -ne (Get-FileHash -LiteralPath $entry.destination).Hash){Copy-Item -LiteralPath $entry.backup -Destination $entry.destination -Force}}else{if(Test-Path -LiteralPath $entry.destination -PathType Leaf){Remove-Item -LiteralPath $entry.destination}}}catch{$rollbackErrors+=$_.Exception.Message}}}
    if($rollbackErrors.Count){$problem+='; rollback incomplete, backup retained: '+($rollbackErrors -join '; ')}
    Save-Result @{ok=$false;error=$problem;version=if($meta){$meta.version}else{''};at=[DateTime]::UtcNow.ToString('o')}
    if($exited){$env:PHONE_NOTIFY_DATA_DIR=$data;Start-Process -FilePath (Join-Path $app 'PhoneNotify.exe') -WorkingDirectory $app -WindowStyle Hidden}
    Write-Error $problem
    exit 1
}
