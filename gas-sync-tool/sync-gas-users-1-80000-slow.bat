@echo off
setlocal
set "TOOL_DIR=%~dp0"
cd /d "%TOOL_DIR%"
echo Slow full GAS scan: UID 1 to 80000.
echo Default speed: one request every 6-12 seconds.
echo It stops immediately if WAF returns 468.
echo Progress file: data\gas-sync-state.json
echo.

set "PY_CMD="
where py >nul 2>nul
if not errorlevel 1 set "PY_CMD=py -3"
if "%PY_CMD%"=="" (
  where python >nul 2>nul
  if not errorlevel 1 set "PY_CMD=python"
)
if "%PY_CMD%"=="" (
  echo ERROR: Python was not found.
  pause
  exit /b 1
)

%PY_CMD% "%TOOL_DIR%sync-gas-users.py" --start 1 --end 80000 --resume --retries 1 --save-every 20 --status-every 1 --delay-ms 6000 --jitter-ms 6000 --max-checks 2000 --skip-cached --stop-on-block

echo.
echo This batch only checks up to 2000 UIDs per run.
echo Run it again tomorrow or later to continue from the saved progress.
pause
