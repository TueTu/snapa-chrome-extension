Add-Type -AssemblyName System.Drawing

function New-PromoTile {
    param(
        [int]$Width,
        [int]$Height,
        [string]$OutputPath,
        [bool]$Wide
    )

    $bitmap = New-Object System.Drawing.Bitmap $Width, $Height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    $background = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Rectangle 0, 0, $Width, $Height),
        ([System.Drawing.Color]::FromArgb(246, 249, 252)),
        ([System.Drawing.Color]::FromArgb(222, 244, 237)),
        25
    )
    $graphics.FillRectangle($background, 0, 0, $Width, $Height)

    $accent = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(33, 150, 243))
    $green = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(20, 184, 126))
    $dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(26, 34, 48))
    $muted = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(78, 90, 110))
    $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 255))

    $panelMargin = [Math]::Max(20, [int]($Width * 0.055))
    $panel = New-Object System.Drawing.Rectangle $panelMargin, $panelMargin, ($Width - ($panelMargin * 2)), ($Height - ($panelMargin * 2))
    $panelPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $radius = 22
    $diameter = $radius * 2
    $panelPath.AddArc($panel.X, $panel.Y, $diameter, $diameter, 180, 90)
    $panelPath.AddArc($panel.Right - $diameter, $panel.Y, $diameter, $diameter, 270, 90)
    $panelPath.AddArc($panel.Right - $diameter, $panel.Bottom - $diameter, $diameter, $diameter, 0, 90)
    $panelPath.AddArc($panel.X, $panel.Bottom - $diameter, $diameter, $diameter, 90, 90)
    $panelPath.CloseFigure()
    $graphics.FillPath($white, $panelPath)

    $iconPath = Join-Path $PSScriptRoot "public\icon.png"
    $icon = [System.Drawing.Image]::FromFile($iconPath)

    if ($Wide) {
        $iconSize = 150
        $iconX = 118
        $iconY = [int](($Height - $iconSize) / 2)
        $textX = 330
        $titleFont = New-Object System.Drawing.Font "Segoe UI", 56, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
        $subtitleFont = New-Object System.Drawing.Font "Segoe UI", 30, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
        $bodyFont = New-Object System.Drawing.Font "Segoe UI", 25, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
        $tagFont = New-Object System.Drawing.Font "Segoe UI", 22, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
        $graphics.DrawImage($icon, $iconX, $iconY, $iconSize, $iconSize)
        $graphics.DrawString("Snapa Chat", $titleFont, $dark, $textX, 150)
        $graphics.DrawString("AI chat for reading and research", $subtitleFont, $muted, $textX, 228)
        $graphics.DrawString("Summarize, explain, and ask questions without leaving the page", $bodyFont, $muted, $textX, 286)
        $graphics.FillEllipse($accent, $textX, 370, 22, 22)
        $graphics.DrawString("Stay focused while you read", $tagFont, $dark, ($textX + 36), 363)
        $graphics.FillEllipse($green, ($Width - 185), 105, 70, 70)
        $graphics.FillEllipse($accent, ($Width - 125), ($Height - 145), 48, 48)
    }
    else {
        $iconSize = 62
        $iconX = 42
        $iconY = 48
        $textX = 122
        $titleFont = New-Object System.Drawing.Font "Segoe UI", 30, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
        $subtitleFont = New-Object System.Drawing.Font "Segoe UI", 16, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
        $bodyFont = New-Object System.Drawing.Font "Segoe UI", 14, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
        $tagFont = New-Object System.Drawing.Font "Segoe UI", 13, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
        $graphics.DrawImage($icon, $iconX, $iconY, $iconSize, $iconSize)
        $graphics.DrawString("Snapa Chat", $titleFont, $dark, $textX, 48)
        $graphics.DrawString("AI chat for reading and research", $subtitleFont, $muted, $textX, 90)
        $bodyRect = New-Object System.Drawing.RectangleF 42, 132, 356, 58
        $graphics.DrawString("Summarize, explain, and ask questions without leaving the page", $bodyFont, $muted, $bodyRect)
        $graphics.FillEllipse($accent, 42, 213, 14, 14)
        $graphics.DrawString("Stay focused while you read", $tagFont, $dark, 66, 207)
        $graphics.FillEllipse($green, 348, 38, 36, 36)
        $graphics.FillEllipse($accent, 374, 214, 22, 22)
    }

    $directory = Split-Path $OutputPath
    if (-not (Test-Path $directory)) {
        New-Item -ItemType Directory -Path $directory | Out-Null
    }

    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $icon.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
    $background.Dispose()
    $accent.Dispose()
    $green.Dispose()
    $dark.Dispose()
    $muted.Dispose()
    $white.Dispose()
}

$assetDir = Join-Path $PSScriptRoot "store-assets"
New-PromoTile -Width 440 -Height 280 -OutputPath (Join-Path $assetDir "small-promo-tile.png") -Wide $false
New-PromoTile -Width 1400 -Height 560 -OutputPath (Join-Path $assetDir "marquee-promo-tile.png") -Wide $true

Write-Host "Created store-assets\small-promo-tile.png"
Write-Host "Created store-assets\marquee-promo-tile.png"
