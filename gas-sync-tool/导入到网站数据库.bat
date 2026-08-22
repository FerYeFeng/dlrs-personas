@echo off
setlocal
set "TOOL_DIR=%~dp0"
cd /d "%TOOL_DIR%"
echo Importing data\gas-users.json into D:\dlrs-personas\data\db.json

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

%PY_CMD% "%TOOL_DIR%import-gas-users.py" --source "%TOOL_DIR%data\gas-users.json" --target-db "D:\dlrs-personas\data\db.json"

if errorlevel 1 (
  echo.
  echo ERROR: import script exited with code %errorlevel%.
  pause
  exit /b %errorlevel%
)

echo.
pause
