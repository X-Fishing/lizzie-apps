Add-Type -AssemblyName System.Drawing

function New-LizzieIcon {
    param([int]$Size, [string]$OutPath)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    # Background #1a0a2e
    $bgColor = [System.Drawing.Color]::FromArgb(26, 10, 46)
    $g.Clear($bgColor)

    # Logo color: rose pink (matches the reference logo)
    $logoColor = [System.Drawing.Color]::FromArgb(232, 165, 181)
    $pen = New-Object System.Drawing.Pen($logoColor, ($Size * 0.045))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Flat
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Flat
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Miter

    # Drawing two interlocking Z shapes (Lizzie monogram)
    # Coordinates are based on a normalized 1.0 unit square, scaled to icon size
    $u = [double]$Size

    function P { param($x, $y) [System.Drawing.PointF]::new([single]($x * $u), [single]($y * $u)) }

    # First Z (upper-left position)
    $z1 = @(
        (P 0.20 0.22),
        (P 0.62 0.22),
        (P 0.22 0.58),
        (P 0.64 0.58)
    )
    $g.DrawLines($pen, $z1)

    # Second Z (lower-right position, interlocked)
    $z2 = @(
        (P 0.36 0.42),
        (P 0.78 0.42),
        (P 0.38 0.78),
        (P 0.80 0.78)
    )
    $g.DrawLines($pen, $z2)

    $pen.Dispose()
    $g.Dispose()

    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "Wrote $OutPath ($Size x $Size)"
}

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
New-LizzieIcon -Size 192 -OutPath (Join-Path $dir "icon-192.png")
New-LizzieIcon -Size 512 -OutPath (Join-Path $dir "icon-512.png")
