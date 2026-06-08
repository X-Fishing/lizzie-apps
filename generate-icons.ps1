Add-Type -AssemblyName System.Drawing

# Gera os icones do PWA (icon-192.png / icon-512.png).
# Diamante rose sobre fundo ameixa (#1a0a2e), mesma identidade do splash/topbar.
# Conteudo mantido dentro da zona segura central para icones "maskable".

function New-LizzieIcon {
    param([int]$Size, [string]$OutPath)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.PixelOffsetMode = 'HighQuality'

    # Fundo full-bleed (importante para maskable)
    $bg = [System.Drawing.Color]::FromArgb(26, 10, 46)
    $g.Clear($bg)

    $u = [double]$Size
    function Pt { param($x, $y) [System.Drawing.PointF]::new([single]($x * $u), [single]($y * $u)) }

    # Contorno do diamante (brilhante) — dentro de ~0.25..0.75 / 0.30..0.70
    $gem = [System.Drawing.PointF[]]@(
        (Pt 0.37 0.30),
        (Pt 0.63 0.30),
        (Pt 0.75 0.41),
        (Pt 0.50 0.70),
        (Pt 0.25 0.41)
    )

    # Preenchimento em gradiente rose (mais claro em cima)
    $rectF = New-Object System.Drawing.RectangleF(0, [single](0.28 * $u), [single]$u, [single](0.44 * $u))
    $c1 = [System.Drawing.Color]::FromArgb(245, 200, 214)  # rose claro
    $c2 = [System.Drawing.Color]::FromArgb(214, 130, 160)  # rose profundo
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rectF, $c1, $c2, [single]90)
    $g.FillPolygon($brush, $gem)

    # Facetas (linhas na cor do fundo)
    $pen = New-Object System.Drawing.Pen($bg, [single]($Size * 0.014))
    $pen.LineJoin = 'Round'
    $g.DrawLine($pen, (Pt 0.25 0.41), (Pt 0.75 0.41))   # cintura (girdle)
    $g.DrawLine($pen, (Pt 0.37 0.30), (Pt 0.31 0.41))   # bisel esquerdo
    $g.DrawLine($pen, (Pt 0.63 0.30), (Pt 0.69 0.41))   # bisel direito
    $g.DrawLine($pen, (Pt 0.50 0.30), (Pt 0.50 0.41))   # mesa -> cintura
    $g.DrawLine($pen, (Pt 0.31 0.41), (Pt 0.50 0.70))   # pavilhao esquerdo
    $g.DrawLine($pen, (Pt 0.69 0.41), (Pt 0.50 0.70))   # pavilhao direito
    $g.DrawLine($pen, (Pt 0.50 0.41), (Pt 0.50 0.70))   # eixo central

    # Contorno externo claro para nitidez
    $penO = New-Object System.Drawing.Pen($c1, [single]($Size * 0.012))
    $penO.LineJoin = 'Round'
    $g.DrawPolygon($penO, $gem)

    $pen.Dispose(); $penO.Dispose(); $brush.Dispose(); $g.Dispose()
    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Output "Wrote $OutPath ($Size x $Size)"
}

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
New-LizzieIcon -Size 192 -OutPath (Join-Path $dir 'icon-192.png')
New-LizzieIcon -Size 512 -OutPath (Join-Path $dir 'icon-512.png')
