$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$cuSource = Join-Path $PSScriptRoot 'app-icon-no-bell.png'
$cuOutput = Join-Path $PSScriptRoot 'app-no-bell.ico'
$cuSizes = @(16,24,32,48,64,128,256)
$cuFrames = New-Object 'System.Collections.Generic.List[byte[]]'
$cuImage = [Drawing.Image]::FromFile($cuSource)
try {
    foreach ($cuSize in $cuSizes) {
        $cuBitmap = New-Object Drawing.Bitmap($cuSize,$cuSize,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $cuGraphics = [Drawing.Graphics]::FromImage($cuBitmap)
        $cuStream = New-Object IO.MemoryStream
        try {
            $cuGraphics.Clear([Drawing.Color]::Transparent)
            $cuGraphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
            $cuGraphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
            $cuGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $cuGraphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $cuGraphics.DrawImage($cuImage,(New-Object Drawing.Rectangle(0,0,$cuSize,$cuSize)))
            $cuBitmap.Save($cuStream,[Drawing.Imaging.ImageFormat]::Png)
            $cuFrames.Add($cuStream.ToArray())
        } finally { $cuStream.Dispose(); $cuGraphics.Dispose(); $cuBitmap.Dispose() }
    }
    $cuWriter = New-Object IO.BinaryWriter([IO.File]::Create($cuOutput))
    try {
        $cuWriter.Write([uint16]0); $cuWriter.Write([uint16]1); $cuWriter.Write([uint16]$cuSizes.Count)
        $cuOffset = 6 + 16 * $cuSizes.Count
        for ($cuIndex=0; $cuIndex -lt $cuSizes.Count; $cuIndex++) {
            $cuEdge = if ($cuSizes[$cuIndex] -eq 256) {0} else {$cuSizes[$cuIndex]}
            $cuWriter.Write([byte]$cuEdge); $cuWriter.Write([byte]$cuEdge)
            $cuWriter.Write([byte]0); $cuWriter.Write([byte]0)
            $cuWriter.Write([uint16]1); $cuWriter.Write([uint16]32)
            $cuWriter.Write([uint32]$cuFrames[$cuIndex].Length); $cuWriter.Write([uint32]$cuOffset)
            $cuOffset += $cuFrames[$cuIndex].Length
        }
        foreach ($cuFrame in $cuFrames) { $cuWriter.Write($cuFrame) }
    } finally { $cuWriter.Dispose() }
    foreach ($cuSize in @(16,32,48)) {
        $cuIcon = New-Object Drawing.Icon($cuOutput,$cuSize,$cuSize)
        try { if ($cuIcon.Width -ne $cuSize -or $cuIcon.Height -ne $cuSize) {throw 'Windows selected an unexpected icon size'} } finally {$cuIcon.Dispose()}
    }
    [pscustomobject]@{SourceWidth=$cuImage.Width;SourceHeight=$cuImage.Height;Icon=$cuOutput;Sizes=$cuSizes;WindowsLoadCheck='PASS'} | ConvertTo-Json -Compress
} finally { $cuImage.Dispose() }
