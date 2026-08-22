@echo off
setlocal
set "TOOL_DIR=%~dp0"
cd /d "%TOOL_DIR%"
echo Watching GAS sync progress. Press Ctrl+C to quit.

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

%PY_CMD% "%TOOL_DIR%view-gas-sync-progress.py"
