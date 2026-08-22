@echo off
setlocal
set "TOOL_DIR=%~dp0"
cd /d "%TOOL_DIR%"
echo GAS sync start: UID 1 to 80000.
echo Progress file: data\gas-sync-state.json
echo Failed UID file: data\gas-sync-failed.txt
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
  echo Install Python 3 first, or enable the Python launcher.
  echo.
  pause
  exit /b 1
)

echo Using: %PY_CMD%
echo.
%PY_CMD% "%TOOL_DIR%sync-gas-users.py" --start 1140 --end 75000 --resume --retries 3 --save-every 100 --status-every 1 --delay-ms 1000

if errorlevel 1 (
  echo.
  echo ERROR: sync script exited with code %errorlevel%.
  echo Keep this window open and send me the error text above.
  echo.
  pause
  exit /b %errorlevel%
)

echo.
echo Sync finished. Press any key to close.
pause >nul
