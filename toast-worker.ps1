$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$appId = 'Xinyu.IPhoneLanNotify'
$notifiers = @{}
$nativeRegistration = $false
$dataRoot = if ($env:PHONE_NOTIFY_DATA_DIR) { [IO.Path]::GetFullPath($env:PHONE_NOTIFY_DATA_DIR) } else { $PSScriptRoot }
if (!(Test-Path -LiteralPath (Join-Path $dataRoot '.icon-cache'))) { New-Item -ItemType Directory -Path (Join-Path $dataRoot '.icon-cache') -Force | Out-Null }
Add-Type -AssemblyName System.Drawing

function Get-NotificationIcon($message) {
    $fallback = Join-Path $PSScriptRoot 'assets\app-icon.png'
    if ($message.iconSource -ne 'appstore' -or -not $message.iconPath) { if (Test-Path -LiteralPath $fallback) { return $fallback }; return $null }
    try {
        $file = [IO.Path]::GetFullPath([string]$message.iconPath)
        $cache = (Join-Path $dataRoot '.icon-cache') + [IO.Path]::DirectorySeparatorChar
        $bundled = (Join-Path $PSScriptRoot 'assets\app-icons') + [IO.Path]::DirectorySeparatorChar
        if ((-not $file.StartsWith($cache, [StringComparison]::OrdinalIgnoreCase) -and -not $file.StartsWith($bundled, [StringComparison]::OrdinalIgnoreCase)) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) { return $fallback }
        $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
        $output = Join-Path $cache ('native-' + $hash + '.png')
        if (Test-Path -LiteralPath $output -PathType Leaf) { return $output }
        $original = [Drawing.Image]::FromFile($file)
        $scaled = New-Object Drawing.Bitmap($original, 256, 256)
        $bitmap = New-Object Drawing.Bitmap(256, 256)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $shape = New-Object Drawing.Drawing2D.GraphicsPath
        $brush = New-Object Drawing.TextureBrush($scaled)
        try {
            $points = New-Object 'Drawing.PointF[]' 256
            for ($step = 0; $step -lt 256; $step++) {
                $angle = -[Math]::PI / 2 + $step * 2 * [Math]::PI / 256
                $cosine = [Math]::Cos($angle); $sine = [Math]::Sin($angle)
                $points[$step] = New-Object Drawing.PointF((128 + 128 * [Math]::Sign($cosine) * [Math]::Pow([Math]::Abs($cosine), .4)), (128 + 128 * [Math]::Sign($sine) * [Math]::Pow([Math]::Abs($sine), .4)))
            }
            $shape.AddPolygon($points)
            $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $graphics.FillPath($brush, $shape)
            $bitmap.Save($output, [Drawing.Imaging.ImageFormat]::Png)
        } finally { $brush.Dispose(); $shape.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $scaled.Dispose(); $original.Dispose() }
        return $output
    } catch { if (Test-Path -LiteralPath $fallback) { return $fallback }; return $null }
}

function Write-Reply($value) {
    [Console]::WriteLine(($value | ConvertTo-Json -Compress -Depth 4))
    [Console]::Out.Flush()
}

function Get-NotificationSource([string]$identifier, [string]$displayName, [string]$iconPath) {
    if ($identifier -notmatch '^Xinyu\.IPhoneLanNotify(?:\.Source\.[a-f0-9]{24})?$') {
        throw 'Invalid notification source identity'
    }
    if ([string]::IsNullOrWhiteSpace($displayName)) { $displayName = 'iPhone' }
    if ($nativeRegistration) {
        $null = [Xinyu.PhoneNotifications.Native.ToastSourceRegistration]::RegisterSource($PSScriptRoot, $identifier, $displayName, $iconPath)
    } else {
        $appKey = "HKCU:\Software\Classes\AppUserModelId\$identifier"
        New-Item -Path $appKey -Force | Out-Null
        New-ItemProperty -Path $appKey -Name DisplayName -Value $displayName -PropertyType String -Force | Out-Null
        if ($iconPath -and (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
            New-ItemProperty -Path $appKey -Name IconUri -Value $iconPath -PropertyType String -Force | Out-Null
            New-ItemProperty -Path $appKey -Name IconBackgroundColor -Value '#00000000' -PropertyType String -Force | Out-Null
        }
    }
    if (-not $notifiers.ContainsKey($identifier)) {
        $notifiers[$identifier] = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($identifier)
    }
    return $notifiers[$identifier]
}

try {
    $nativeSource = Join-Path $PSScriptRoot 'NativeNotifications.cs'
    if (Test-Path -LiteralPath $nativeSource) { Add-Type -Path $nativeSource; $nativeRegistration = $true }
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
    $null = Get-NotificationSource $appId (-join [char[]]@(0x624B,0x673A,0x901A,0x77E5)) (Join-Path $PSScriptRoot 'assets\app-icon.png')
    Write-Reply @{ op = 'ready'; ok = $true; nativeActivation = $nativeRegistration }
} catch {
    Write-Reply @{ op = 'ready'; ok = $false; error = $_.Exception.Message }
    exit 1
}

while ($null -ne ($line = [Console]::ReadLine())) {
    $message = $null
    try {
        $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line))
        $message = $json | ConvertFrom-Json
        if ($message.op -eq 'remove') {
            $targetId = [string]$message.notificationId
            $targetApp = [string]$message.notifierAppId
            if ($targetId -notmatch '\A[a-f0-9]{16}\z' -or $targetApp -notmatch '\AXinyu\.IPhoneLanNotify(?:\.Source\.[a-f0-9]{24})?\z') { throw 'Invalid notification removal identity' }
            [Windows.UI.Notifications.ToastNotificationManager]::History.Remove($targetId, 'iphone', $targetApp)
            Write-Reply @{ id = $message.id; ok = $true; notificationId = $targetId; removed = $true }
            continue
        }
        if ($message.op -eq 'history') {
            $identifiers = @($appId) + @(Get-ChildItem -LiteralPath 'HKCU:\Software\Classes\AppUserModelId' -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match '^Xinyu\.IPhoneLanNotify\.Source\.[a-f0-9]{24}$' } | ForEach-Object { $_.PSChildName })
            $history = @(foreach ($identifier in ($identifiers | Select-Object -Unique)) {
                foreach ($entry in [Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($identifier)) { $entry }
            })
            $details = @($history | ForEach-Object {
                $node = $_.Content.SelectSingleNode('/toast')
                $logo = $_.Content.SelectSingleNode('/toast/visual/binding/image[@placement="appLogoOverride"]')
                $expiry = if ($_.ExpirationTime) { $_.ExpirationTime.ToString('o') } else { $null }
                @{ id = $_.Tag; activationType = $node.GetAttribute('activationType'); launch = $node.GetAttribute('launch'); hasAppIcon = ($null -ne $logo); expiresAt = $expiry; displayTimestamp = $node.GetAttribute('displayTimestamp') }
            })
            Write-Reply @{ id = $message.id; ok = $true; historyCount = $history.Count; tags = @($history | ForEach-Object { $_.Tag }); details = $details }
            continue
        }
        $title = [Security.SecurityElement]::Escape([string]$message.title)
        $body = [Security.SecurityElement]::Escape([string]$message.body)
        $identifier = if ($message.notifierAppId) { [string]$message.notifierAppId } else { $appId }
        $iconPath = Get-NotificationIcon $message
        $notifier = Get-NotificationSource $identifier ([string]$message.appName) $iconPath
        if ([string]$message.id -notmatch '^[a-f0-9]{16}$') { throw 'Invalid notification ID' }
        if ($message.op -eq 'refresh') {
            $present = @([Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($identifier) | Where-Object { $_.Tag -eq [string]$message.id -and $_.Group -eq 'iphone' })
            if (-not $present.Count) { Write-Reply @{ id = $message.id; ok = $true; skipped = $true }; continue }
        }
        $launch = if ($nativeRegistration) { 'notification=' + [string]$message.id } else { 'xinyu-phone-notify://notification/' + [string]$message.id }
        $activationType = if ($nativeRegistration) { 'foreground' } else { 'protocol' }
        $timestamp = if ($message.at) { ' displayTimestamp="' + ([DateTimeOffset]::Parse([string]$message.at)).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss'Z'", [Globalization.CultureInfo]::InvariantCulture) + '"' } else { '' }
        $audio = '<audio silent="true"/>'
        $xml = '<toast duration="short" activationType="' + $activationType + '" launch="' + $launch + '"' + $timestamp + '><visual><binding template="ToastGeneric"><text>' + $title + '</text><text>' + $body + '</text><text placement="attribution">&#x6765;&#x81EA; iPhone</text></binding></visual>' + $audio + '</toast>'
        $document = New-Object Windows.Data.Xml.Dom.XmlDocument
        $document.LoadXml($xml)
        $toast = [Windows.UI.Notifications.ToastNotification]::new($document)
        $toast.Tag = ([string]$message.id).Substring(0, [Math]::Min(16, ([string]$message.id).Length))
        $toast.Group = 'iphone'
        $toast.ExpirationTime = if ($message.expirationTime) { [DateTimeOffset]::Parse([string]$message.expirationTime) } else { [DateTimeOffset]::Now.AddHours(1) }
        $toast.SuppressPopup = $true
        $notifier.Show($toast)
        Write-Reply @{ id = $message.id; ok = $true; nativePopupSuppressed = $toast.SuppressPopup }
    } catch {
        Write-Reply @{ id = $message.id; ok = $false; error = $_.Exception.Message }
    }
}
