# Render sample/sample-transcript.html to a PDF and a JPEG with headless Edge (Windows).
# Usage: powershell -File tools/render-sample.ps1
$root = Split-Path $PSScriptRoot -Parent
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$html = 'file:///' + ("$root\sample\sample-transcript.html" -replace '\\', '/')
& $edge --headless=new --disable-gpu --no-pdf-header-footer --virtual-time-budget=8000 "--print-to-pdf=$root\sample\sample-transcript.pdf" $html 2>$null | Out-Null
& $edge --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=8000 --window-size=794,1123 --force-device-scale-factor=2 "--screenshot=$root\sample\sample-transcript.png" $html 2>$null | Out-Null

Add-Type -AssemblyName System.Drawing
$png = [Drawing.Image]::FromFile("$root\sample\sample-transcript.png")
$enc = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
$ep = New-Object Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), 85L
$png.Save("$root\public\sample-transcript.jpg", $enc, $ep)
$png.Dispose()
Remove-Item "$root\sample\sample-transcript.png"
Get-Item "$root\sample\sample-transcript.pdf", "$root\public\sample-transcript.jpg" | Select-Object Name, Length
