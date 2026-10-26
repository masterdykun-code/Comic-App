# Optional local OCR aid for source review. Does not modify images or contact any service.
# Windows PowerShell 5.1 + built-in Windows OCR, not a content generator.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] | Out-Null
$taskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod } | Select-Object -First 1
function Await-Result($Operation, $ResultType) {
    $task = $taskMethod.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.Wait() | Out-Null
    $task.Result
}
$catalogRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../catalog/library-expansion-v2'))
$outputPath = Join-Path $catalogRoot 'image-credit-ocr-aid.json'
$prior = @{}
if (Test-Path -LiteralPath $outputPath) {
    foreach ($entry in (Get-Content -LiteralPath $outputPath -Raw | ConvertFrom-Json)) { $prior[$entry.file] = $entry }
}
$language = New-Object Windows.Globalization.Language('en-US')
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
if ($null -eq $engine) { throw 'Local English OCR engine unavailable' }
$count = 0
foreach ($item in (Get-ChildItem -LiteralPath (Join-Path $catalogRoot 'assets') -Filter '*.jpg' | Sort-Object Name)) {
    if ($prior.ContainsKey($item.Name)) { continue }
    $file = Await-Result ([Windows.Storage.StorageFile]::GetFileFromPathAsync($item.FullName)) ([Windows.Storage.StorageFile])
    $stream = Await-Result ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $bitmap = $null
    try {
        $decoder = Await-Result ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Await-Result ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $result = Await-Result ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        $lines = @($result.Lines | ForEach-Object { $_.Text })
        $flags = @($lines | Where-Object { $_ -match '(?i)drawn by|assisted by|gregg|dirks|copyright|newell|howarth|opper|mccay|grant.dart' })
        $prior[$item.Name] = [ordered]@{ file = $item.Name; aidOnly = $true; legalVerification = $false; firstLines = @($lines | Select-Object -First 4); creditCandidates = $flags; lastLines = @($lines | Select-Object -Last 3) }
        $count++
        if ($count % 10 -eq 0) { Write-Output "Local image-credit OCR reviewed $count additional scans (aid only)." }
    } finally {
        if ($null -ne $bitmap) { $bitmap.Dispose() }
        $stream.Dispose()
    }
}
@($prior.Values | Sort-Object file) | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outputPath -Encoding UTF8
Write-Output "OCR aid saved for $($prior.Count) scans; no image changes or remote calls. OCR is not proof of licensing."
