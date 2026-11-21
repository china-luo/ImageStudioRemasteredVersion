@echo off
setlocal

for %%I in ("%~dp0.") do set "PROJECT_DIR=%%~fI"
set "APP_URL=http://127.0.0.1:5173/"
set "PID_FILE=%PROJECT_DIR%\.amazon-image-studio-dev.pid"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$project = (Resolve-Path -LiteralPath '%PROJECT_DIR%').Path;" ^
  "$appName = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('6Leo5aKDSW1hZ2Xlt6XkvZzlj7A='));" ^
  "$serverTitle = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('6Leo5aKDSW1hZ2Xlt6XkvZzlj7DlvIDlj5HmnI3liqHlmag='));" ^
  "$projectMatch = $project;" ^
  "$pidFile = '%PID_FILE%';" ^
  "$existing = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1;" ^
  "if ($existing) {" ^
  "  $procInfo = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $existing.OwningProcess) -ErrorAction SilentlyContinue;" ^
  "  $commandLine = [string]$procInfo.CommandLine;" ^
  "  if ($commandLine -like ('*' + $projectMatch + '*')) {" ^
  "    Start-Process '%APP_URL%';" ^
  "    Write-Host ($appName + ' is already running at %APP_URL%');" ^
  "    exit 0;" ^
  "  }" ^
  "  Write-Host ('Port 5173 is already used by another process. Please close it first. PID: ' + $existing.OwningProcess);" ^
  "  exit 1;" ^
  "}" ^
  "$ensureScript = Join-Path $project 'scripts\ensure-dev-dependencies.ps1';" ^
  "& powershell -NoProfile -ExecutionPolicy Bypass -File $ensureScript -ProjectDir $project;" ^
  "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE; }" ^
  "$cmd = 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort';" ^
  "$process = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $cmd) -WorkingDirectory $project -WindowStyle Hidden -PassThru;" ^
  "Set-Content -LiteralPath $pidFile -Value $process.Id -Encoding ASCII;" ^
  "Start-Sleep -Seconds 3;" ^
  "Start-Process '%APP_URL%';" ^
  "Write-Host ('Started ' + $appName + ' at %APP_URL%');"

if errorlevel 1 (
  echo.
  echo Failed to start Cross-border Image Studio.
  pause
  exit /b 1
)

endlocal
