$ErrorActionPreference = 'Stop'

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location $root

function Assert-WorkspacePath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if (-not $fullPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to touch path outside workspace: $fullPath"
  }
  return $fullPath
}

function Remove-PathIfExists {
  param([Parameter(Mandatory = $true)][string]$Path)

  $fullPath = Assert-WorkspacePath $Path
  if (Test-Path -LiteralPath $fullPath) {
    Remove-Item -LiteralPath $fullPath -Recurse -Force
  }
}

function Find-MakeNsis {
  $command = Get-Command makensis.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $cacheRoot = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache'
  if (Test-Path -LiteralPath $cacheRoot) {
    $candidate = Get-ChildItem -LiteralPath $cacheRoot -Filter 'makensis.exe' -Recurse -ErrorAction SilentlyContinue |
      Sort-Object Length -Descending |
      Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
  }

  throw 'makensis.exe was not found. Install NSIS 3 or run electron-builder once so it can download the NSIS toolchain.'
}

function Find-Rcedit {
  $command = Get-Command rcedit.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $candidate = Get-ChildItem -LiteralPath (Join-Path $root 'node_modules') -Filter 'rcedit.exe' -Recurse -ErrorAction SilentlyContinue |
    Sort-Object Length -Descending |
    Select-Object -First 1
  if ($candidate) { return $candidate.FullName }

  throw 'rcedit.exe was not found. Run npm install before building the installer.'
}

$packageJson = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$packageJson.version
$releaseDate = '2026-06-12'
$releaseDir = Assert-WorkspacePath (Join-Path $root 'release')
$appDir = Assert-WorkspacePath (Join-Path $releaseDir 'win-unpacked')
$installerPath = Assert-WorkspacePath (Join-Path $releaseDir "ImageStudioRemasteredVersion-Setup-V$version-$releaseDate-x64.exe")
$electronDist = Join-Path $root 'node_modules\electron\dist'
$electronExe = Join-Path $electronDist 'electron.exe'
$iconPng = Join-Path $root 'build\icon.png'
$iconIco = Join-Path $root 'build\icon.ico'

if (-not (Test-Path -LiteralPath $electronExe)) {
  if (-not $env:ELECTRON_MIRROR) {
    $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
  }
  node (Join-Path $root 'node_modules\electron\install.js')
}

if (-not (Test-Path -LiteralPath $electronExe)) {
  throw "Electron runtime was not found at $electronExe"
}

if (-not (Test-Path -LiteralPath $iconPng)) {
  throw "App icon source was not found: $iconPng"
}
if (-not (Test-Path -LiteralPath $iconIco) -or ((Get-Item -LiteralPath $iconIco).LastWriteTimeUtc -lt (Get-Item -LiteralPath $iconPng).LastWriteTimeUtc)) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\create-windows-icon.ps1') -SourcePng $iconPng -OutIco $iconIco
}
if (-not (Test-Path -LiteralPath $iconIco)) {
  throw "App icon ICO was not created: $iconIco"
}

Remove-PathIfExists $appDir
Remove-PathIfExists $installerPath
New-Item -ItemType Directory -Path $appDir -Force | Out-Null

Copy-Item -Path (Join-Path $electronDist '*') -Destination $appDir -Recurse -Force
Rename-Item -LiteralPath (Join-Path $appDir 'electron.exe') -NewName 'ImageStudioRemasteredVersion.exe' -Force
$appExe = Join-Path $appDir 'ImageStudioRemasteredVersion.exe'
$appIcon = Join-Path $appDir 'app-icon.ico'
Copy-Item -LiteralPath $iconIco -Destination $appIcon -Force
$rcedit = Find-Rcedit
& $rcedit $appExe --set-icon $iconIco
if ($LASTEXITCODE -ne 0) {
  throw "rcedit failed with exit code $LASTEXITCODE"
}

$appResourceDir = Join-Path $appDir 'resources\app'
New-Item -ItemType Directory -Path $appResourceDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'dist') -Destination $appResourceDir -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root 'electron') -Destination $appResourceDir -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root 'build') -Destination $appResourceDir -Recurse -Force

$appPackage = [ordered]@{
  name = 'image-studio-remastered-version'
  version = $version
  private = $true
  main = 'electron/main.cjs'
  productName = 'ImageStudioRemasteredVersion'
}
$appPackage | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $appResourceDir 'package.json') -Encoding UTF8

$makeNsis = Find-MakeNsis
$nsisScript = Join-Path $root 'installer\windows-installer.nsi'

& $makeNsis /V2 /INPUTCHARSET UTF8 "/DAPP_VERSION=$version" "/DSOURCE_DIR=$appDir" "/DOUT_FILE=$installerPath" "/DAPP_ICON=$iconIco" $nsisScript
if ($LASTEXITCODE -ne 0) {
  throw "makensis failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path -LiteralPath $installerPath)) {
  throw "Installer was not created: $installerPath"
}

$installer = Get-Item -LiteralPath $installerPath
Write-Output "INSTALLER_PATH=$($installer.FullName)"
Write-Output "INSTALLER_SIZE_MB=$([math]::Round($installer.Length / 1MB, 2))"
