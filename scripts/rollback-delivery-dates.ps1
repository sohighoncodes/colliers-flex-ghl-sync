param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$scriptId = '1skjylvwi4tHWXF6Ksor26eJFOHVyih36MwfbVB7fKFI4ICS2XB5kO9ml'
$deploymentId = 'AKfycbz8f1M74Vht5Ys4zuP_e7wW-dF70557Hcv1_5dYL5cpW_KjpROGWHmLMM9xmeuJkatSDA'
Write-Output 'Rollback plan: restore scheduled-trigger source from immutable version 8 and webhook deployment to version 7.'
Write-Output 'New GHL fields/values, existing records, credentials, triggers, cursors and webhook URL are preserved.'
if (-not $Apply) {
  Write-Output 'Run this script with -Apply to perform the rollback.'
  exit 0
}

# Work in a fresh directory so the current checkout and any edits are preserved.
$rollbackDir = Join-Path ([IO.Path]::GetTempPath()) ('colliers-rollback-' + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $rollbackDir | Out-Null
Push-Location $rollbackDir
try {
  clasp clone $scriptId 8
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath '.clasp.json')) { throw 'Baseline clone failed; nothing has been pushed.' }
  $project = Get-Content -Raw -LiteralPath '.clasp.json' | ConvertFrom-Json
  if ($project.scriptId -ne $scriptId) { throw 'Unexpected project; stopping.' }
  clasp push --force
  if ($LASTEXITCODE -ne 0) { throw 'Restoring scheduled source failed; inspect before continuing.' }
  clasp redeploy $deploymentId --versionNumber 7 --description 'Colliers v7'
  if ($LASTEXITCODE -ne 0) { throw 'Scheduled source restored; webhook rollback needs retry with version 7.' }
  clasp deployments
  Write-Output "Rollback completed. Baseline checkout retained at $rollbackDir"
} finally {
  Pop-Location
}
