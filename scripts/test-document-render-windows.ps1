$ErrorActionPreference = 'Stop'
# Local QA only. Process-scoped pins do not configure production providers.
$pins = @{
  APP_LIBREOFFICE_EXECUTABLE = 'C:\Program Files\LibreOffice\program\soffice.com'
  APP_PDFINFO_EXECUTABLE = (Get-Command pdfinfo.exe).Source
  APP_PDFFONTS_EXECUTABLE = (Get-Command pdffonts.exe).Source
  APP_PDFTOTEXT_EXECUTABLE = (Get-Command pdftotext.exe).Source
  APP_PDFTOPPM_EXECUTABLE = (Get-Command pdftoppm.exe).Source
  APP_ARIAL_FONT_FILE = 'C:\Windows\Fonts\arial.ttf'
}
foreach ($pin in $pins.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($pin.Key, $pin.Value, 'Process')
  [Environment]::SetEnvironmentVariable(($pin.Key + '_SHA256'), (Get-FileHash -LiteralPath $pin.Value -Algorithm SHA256).Hash.ToLower(), 'Process')
}
$env:APP_DOCUMENT_RENDERER_IDENTITY = 'applypack-windows-local-qa-2026-09-20'
$env:APPLYPACK_RENDER_EVIDENCE_DIR = Join-Path (Get-Location) ('evidence/applypack-chunk5-render-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
npm.cmd run test:document-render
exit $LASTEXITCODE
