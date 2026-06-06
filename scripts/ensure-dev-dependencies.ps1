[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectDir
)

$ErrorActionPreference = 'Stop'

function Assert-CommandAvailable {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,

    [Parameter(Mandatory = $true)]
    [string]$InstallMessage
  )

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw $InstallMessage
  }
}

try {
  $project = (Resolve-Path -LiteralPath $ProjectDir).Path
  $packageJson = Join-Path $project 'package.json'

  if (-not (Test-Path -LiteralPath $packageJson)) {
    throw "package.json was not found in $project."
  }

  Assert-CommandAvailable `
    -Name 'node' `
    -InstallMessage 'Node.js was not found. Please install Node.js 20 LTS or newer first.'

  Assert-CommandAvailable `
    -Name 'npm' `
    -InstallMessage 'npm was not found. Please install Node.js 20 LTS or newer first.'

  $nodeVersionText = (& node --version).Trim()
  $nodeVersion = [Version]($nodeVersionText.TrimStart('v'))

  if ($nodeVersion.Major -lt 20) {
    throw "Node.js 20 LTS or newer is required. Current version: $nodeVersionText."
  }

  $lockFile = Join-Path $project 'package-lock.json'
  $hashSource = if (Test-Path -LiteralPath $lockFile) { $lockFile } else { $packageJson }
  $hashSourceName = Split-Path -Leaf $hashSource
  $dependencyHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $hashSource).Hash
  $expectedMarker = "${hashSourceName}:$dependencyHash"

  $markerFile = Join-Path $project '.amazon-image-studio-deps.hash'
  $nodeModules = Join-Path $project 'node_modules'
  $viteBin = Join-Path $project 'node_modules\.bin\vite.cmd'

  $needInstall = -not (Test-Path -LiteralPath $nodeModules) -or -not (Test-Path -LiteralPath $viteBin)

  if (-not $needInstall) {
    $currentMarker = if (Test-Path -LiteralPath $markerFile) {
      Get-Content -LiteralPath $markerFile -ErrorAction SilentlyContinue | Select-Object -First 1
    } else {
      $null
    }

    $needInstall = $currentMarker -ne $expectedMarker
  }

  if ($needInstall) {
    $npmCommand = if ($hashSourceName -eq 'package-lock.json') { 'ci' } else { 'install' }

    Write-Host "Installing dependencies with npm $npmCommand..."
    Push-Location $project

    try {
      & npm $npmCommand
      if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
      }
    } finally {
      Pop-Location
    }

    Set-Content -LiteralPath $markerFile -Value $expectedMarker -Encoding ASCII
    Write-Host 'Dependencies are ready.'
  } else {
    Write-Host 'Dependencies are already installed.'
  }

  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
