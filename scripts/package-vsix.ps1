param([string]$OutputPath)

$ErrorActionPreference = 'Stop'

$packageScript = Join-Path $PSScriptRoot 'package-vsix.js'
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  & node $packageScript
} else {
  & node $packageScript $OutputPath
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
