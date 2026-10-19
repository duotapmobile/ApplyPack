$ErrorActionPreference = 'Stop'
# Local QA only. Process-scoped pins do not configure production providers.
function Resolve-ApplicationPath($Command) {
  $command = $Command
  $path = (Resolve-Path -LiteralPath $command.Source).Path
  # Scoop shims are launcher executables, not the Poppler binary being measured.
  $shim = [IO.Path]::ChangeExtension($path, '.shim')
  if (Test-Path -LiteralPath $shim) {
    $match = Select-String -LiteralPath $shim -Pattern '^path = "(.+)"$' | Select-Object -First 1
    if (!$match) { throw "Cannot resolve executable shim: $($command.Name)" }
    $path = (Resolve-Path -LiteralPath $match.Matches[0].Groups[1].Value).Path
  }
  if ([IO.Path]::GetExtension($path) -ne '.exe') { throw "Actual executable required: $($command.Name)" }
  return $path
}

function Resolve-PopplerToolset {
  $toolNames = @('pdfinfo.exe', 'pdffonts.exe', 'pdftotext.exe', 'pdftoppm.exe')
  $directories = @()
  if (![string]::IsNullOrWhiteSpace($env:APPLYPACK_POPPLER_BIN)) {
    $directories += (Resolve-Path -LiteralPath $env:APPLYPACK_POPPLER_BIN).Path
  } else {
    $commands = @(Get-Command pdfinfo.exe -CommandType Application -All -ErrorAction Stop)
    $directories += $commands | ForEach-Object { Split-Path -Parent (Resolve-ApplicationPath $_) }
  }
  foreach ($directory in ($directories | Select-Object -Unique)) {
    $candidate = @{}
    foreach ($toolName in $toolNames) {
      $path = Join-Path $directory $toolName
      if (!(Test-Path -LiteralPath $path -PathType Leaf)) {
        $candidate = $null
        break
      }
      $candidate[$toolName] = (Resolve-Path -LiteralPath $path).Path
    }
    if ($candidate) { return $candidate }
  }
  throw 'A complete same-directory Poppler toolset is required.'
}

function Assert-ToolVersion([string]$Label, [string]$Output, [string]$Expected) {
  if ([string]::IsNullOrWhiteSpace($Expected)) { return }
  $match = [regex]::Match($Output, '\d+(?:\.\d+){1,3}')
  if (!$match.Success) { throw "Cannot determine $Label version." }
  $actual = (($match.Value.Split('.') | ForEach-Object { [int]$_ }) -join '.')
  $normalizedExpected = (($Expected.Split('.') | ForEach-Object { [int]$_ }) -join '.')
  if ($actual -ne $normalizedExpected -and !$actual.StartsWith($normalizedExpected + '.')) {
    throw "$Label version $actual does not match required version $normalizedExpected."
  }
}

function Invoke-VersionProbe([string]$FilePath, [string]$Arguments) {
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $FilePath
  $startInfo.Arguments = $Arguments
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  if (!$process.Start()) { throw "Could not start version probe: $FilePath" }
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw "Version probe failed for $FilePath with exit code $($process.ExitCode)." }
  return "$stdout`n$stderr"
}

$poppler = Resolve-PopplerToolset
$fontDirectory = [Environment]::GetFolderPath('Fonts')
$fontPins = @{
  APP_DOCUMENT_FONT_FILE = @{ File = 'LiberationSans-Regular.ttf'; Sha256 = '76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8' }
  APP_DOCUMENT_FONT_BOLD_FILE = @{ File = 'LiberationSans-Bold.ttf'; Sha256 = '788abee4c806d660e8aee46689dd8540cd4bb98da03dcc9d171ce3efd99a9173' }
  APP_DOCUMENT_FONT_ITALIC_FILE = @{ File = 'LiberationSans-Italic.ttf'; Sha256 = 'e5bae5c4cde31f22142753855f4f8fb86da6ff39955ed3c0a11248b0d16948b0' }
  APP_DOCUMENT_FONT_BOLD_ITALIC_FILE = @{ File = 'LiberationSans-BoldItalic.ttf'; Sha256 = '698da70fc191cc5f33ad4d6d3fe830fe4624b898ea2e3169955928b7c491f1ee' }
}
$pins = @{
  APP_LIBREOFFICE_EXECUTABLE = 'C:\Program Files\LibreOffice\program\soffice.com'
  APP_PDFINFO_EXECUTABLE = $poppler['pdfinfo.exe']
  APP_PDFFONTS_EXECUTABLE = $poppler['pdffonts.exe']
  APP_PDFTOTEXT_EXECUTABLE = $poppler['pdftotext.exe']
  APP_PDFTOPPM_EXECUTABLE = $poppler['pdftoppm.exe']
}
$fontPins.GetEnumerator() | ForEach-Object { $pins[$_.Key] = Join-Path $fontDirectory $_.Value.File }
foreach ($pin in $pins.GetEnumerator()) {
  if (!(Test-Path -LiteralPath $pin.Value -PathType Leaf)) { throw "Required renderer file is missing: $($pin.Key)" }
  [Environment]::SetEnvironmentVariable($pin.Key, $pin.Value, 'Process')
  $actualHash = (Get-FileHash -LiteralPath $pin.Value -Algorithm SHA256).Hash.ToLower()
  if ($fontPins.ContainsKey($pin.Key) -and $actualHash -ne $fontPins[$pin.Key].Sha256) {
    throw "Approved Liberation Sans 2.1.5 font identity mismatch: $($pin.Key)"
  }
  [Environment]::SetEnvironmentVariable(($pin.Key + '_SHA256'), $actualHash, 'Process')
}
$env:APPLYPACK_LIBERATION_SANS_DIRECTORY = $fontDirectory
$env:APP_DOCUMENT_FONT_MANIFEST_SHA256 = 'd89582771ff8dde19015f5aa3965810d656f93fcb08cee6280497e780de614bb'
Assert-ToolVersion 'LibreOffice' (Invoke-VersionProbe $pins.APP_LIBREOFFICE_EXECUTABLE '--version') $env:APPLYPACK_EXPECTED_LIBREOFFICE_VERSION
Assert-ToolVersion 'Poppler' (Invoke-VersionProbe $pins.APP_PDFINFO_EXECUTABLE '-v') $env:APPLYPACK_EXPECTED_POPPLER_VERSION
if ([string]::IsNullOrWhiteSpace($env:APP_DOCUMENT_RENDERER_IDENTITY)) {
  $env:APP_DOCUMENT_RENDERER_IDENTITY = 'applypack-windows-local-qa-liberation-sans-2.1.5'
}
if ([string]::IsNullOrWhiteSpace($env:APPLYPACK_RENDER_EVIDENCE_DIR)) {
  $env:APPLYPACK_RENDER_EVIDENCE_DIR = Join-Path (Get-Location) ('evidence/applypack-chunk5-render-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
npm.cmd run test:document-render -- --reporter=verbose
if ($LASTEXITCODE -ne 0) { throw "Document render tests failed with exit code $LASTEXITCODE." }
