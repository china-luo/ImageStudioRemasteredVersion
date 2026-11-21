param(
  [switch]$RequireBuiltInstaller,
  [string]$InstalledRoot = ''
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$nsiPath = Join-Path $root 'installer\windows-installer.nsi'
$packagePath = Join-Path $root 'package.json'
$releasePath = Join-Path $root 'release'

function Assert-Condition {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

$nsi = Get-Content -LiteralPath $nsiPath -Raw -Encoding UTF8
$package = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$package.version
$appNameMatch = [regex]::Match($nsi, '!define\s+APP_NAME\s+"([^"]+)"')
Assert-Condition $appNameMatch.Success 'NSIS APP_NAME definition not found.'
$appName = $appNameMatch.Groups[1].Value

Assert-Condition ($nsi -match 'InstallDir "\$LOCALAPPDATA\\Programs\\ImageStudioRemasteredVersion"') 'NSIS InstallDir changed unexpectedly.'
Assert-Condition ($nsi -match 'CreateShortcut "\$SMPROGRAMS\\\$\{APP_NAME\}\\\$\{APP_NAME\}\.lnk" "\$INSTDIR\\\$\{APP_EXE\}"') 'Start Menu shortcut assertion failed.'
Assert-Condition ($nsi -match 'CreateShortcut "\$DESKTOP\\\$\{APP_NAME\}\.lnk" "\$INSTDIR\\\$\{APP_EXE\}"') 'Desktop shortcut assertion failed.'
Assert-Condition ($nsi -match 'Delete "\$DESKTOP\\\$\{APP_NAME\}\.lnk"') 'Desktop shortcut uninstall assertion failed.'
Assert-Condition ($nsi -match 'Delete "\$SMPROGRAMS\\\$\{APP_NAME\}\\\$\{APP_NAME\}\.lnk"') 'Start Menu shortcut uninstall assertion failed.'

if ($RequireBuiltInstaller) {
  $unpackedExe = Join-Path $releasePath 'win-unpacked\ImageStudioRemasteredVersion.exe'
  Assert-Condition (Test-Path -LiteralPath $unpackedExe) "Unpacked executable not found: $unpackedExe"
  $installer = Get-ChildItem -LiteralPath $releasePath -Filter "ImageStudioRemasteredVersion-Setup-V$version-*.exe" -File |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  Assert-Condition ($null -ne $installer -and $installer.Length -gt 0) "Built installer not found for version $version."
  Write-Output "INSTALLER=$($installer.FullName)"
  Write-Output "UNPACKED_EXE=$unpackedExe"
}

if ($InstalledRoot) {
  $installedExe = Join-Path $InstalledRoot 'ImageStudioRemasteredVersion.exe'
  $desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) "$appName.lnk"
  $startMenuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) "$appName\$appName.lnk"
  Assert-Condition (Test-Path -LiteralPath $installedExe) "Installed executable not found: $installedExe"
  Assert-Condition (Test-Path -LiteralPath $desktopShortcut) "Desktop shortcut not found: $desktopShortcut"
  Assert-Condition (Test-Path -LiteralPath $startMenuShortcut) "Start Menu shortcut not found: $startMenuShortcut"
  Write-Output "INSTALLED_EXE=$installedExe"
  Write-Output "DESKTOP_SHORTCUT=$desktopShortcut"
  Write-Output "START_MENU_SHORTCUT=$startMenuShortcut"
}

Write-Output 'NSIS_CONFIG=PASS'
