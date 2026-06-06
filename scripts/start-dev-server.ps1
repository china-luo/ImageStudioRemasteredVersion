[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectDir
)

$ErrorActionPreference = 'Stop'

$project = (Resolve-Path -LiteralPath $ProjectDir).Path
Set-Location -LiteralPath $project

& npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
exit $LASTEXITCODE
