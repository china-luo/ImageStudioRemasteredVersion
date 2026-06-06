@echo off
setlocal

for %%I in ("%~dp0.") do set "PROJECT_DIR=%%~fI"
set "PID_FILE=%PROJECT_DIR%\.amazon-image-studio-dev.pid"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$project = (Resolve-Path -LiteralPath '%PROJECT_DIR%').Path;" ^
  "$appName = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('5Lqa6ams6YCK5Zu+54mH5bel5L2c5Y+w'));" ^
  "$pidFile = '%PID_FILE%';" ^
  "$stopped = $false;" ^
  "if (Test-Path -LiteralPath $pidFile) {" ^
  "  $rawPid = (Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1);" ^
  "  $pidValue = 0;" ^
  "  if ([int]::TryParse($rawPid, [ref]$pidValue)) {" ^
  "    $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue;" ^
  "    if ($proc) {" ^
  "      Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue;" ^
  "      $stopped = $true;" ^
  "    }" ^
  "  }" ^
  "  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue;" ^
  "}" ^
  "$listeners = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue;" ^
  "foreach ($listener in $listeners) {" ^
  "  $owner = $listener.OwningProcess;" ^
  "  if (-not $owner) { continue }" ^
  "  $procInfo = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $owner) -ErrorAction SilentlyContinue;" ^
  "  $commandLine = [string]$procInfo.CommandLine;" ^
  "  if ($commandLine -like ('*' + $project + '*')) {" ^
  "    Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue;" ^
  "    $stopped = $true;" ^
  "  } else {" ^
  "    Write-Host ('Port 5173 is used by another process, skipped PID ' + $owner);" ^
  "  }" ^
  "}" ^
  "if ($stopped) { Write-Host ($appName + ' dev server stopped.') } else { Write-Host ('No ' + $appName + ' dev server was found.') }"

endlocal
