$ErrorActionPreference = 'Stop'
# Local QA only. Process-scoped pins do not configure production providers.
function Resolve-Executable([string]$Name) {
  $command = Get-Command $Name -CommandType Application -ErrorAction Stop | Select-Object -First 1
  $path = (Resolve-Path -LiteralPath $command.Source).Path
  # Scoop shims are launcher executables, not the Poppler binary being measured.
  $shim = [IO.Path]::ChangeExtension($path, '.shim')
  if (Test-Path -LiteralPath $shim) {
    $match = Select-String -LiteralPath $shim -Pattern '^path = "(.+)"$' | Select-Object -First 1
    if (!$match) { throw "Cannot resolve executable shim: $Name" }
    $path = (Resolve-Path -LiteralPath $match.Matches[0].Groups[1].Value).Path
  }
  if ([IO.Path]::GetExtension($path) -ne '.exe') { throw "Actual executable required: $Name" }
  return $path
}
$pins = @{
  APP_LIBREOFFICE_EXECUTABLE = 'C:\Program Files\LibreOffice\program\soffice.com'
  APP_PDFINFO_EXECUTABLE = (Resolve-Executable pdfinfo.exe)
  APP_PDFFONTS_EXECUTABLE = (Resolve-Executable pdffonts.exe)
  APP_PDFTOTEXT_EXECUTABLE = (Resolve-Executable pdftotext.exe)
  APP_PDFTOPPM_EXECUTABLE = (Resolve-Executable pdftoppm.exe)
  APP_DOCUMENT_FONT_FILE = 'C:\Windows\Fonts\LiberationSans-Regular.ttf'
}
foreach ($pin in $pins.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($pin.Key, $pin.Value, 'Process')
  [Environment]::SetEnvironmentVariable(($pin.Key + '_SHA256'), (Get-FileHash -LiteralPath $pin.Value -Algorithm SHA256).Hash.ToLower(), 'Process')
}
$env:APP_DOCUMENT_RENDERER_IDENTITY = 'applypack-windows-local-qa-2026-09-22'
$env:APPLYPACK_RENDER_EVIDENCE_DIR = Join-Path (Get-Location) ('evidence/applypack-chunk5-render-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
npm.cmd run test:document-render
exit $LASTEXITCODE
