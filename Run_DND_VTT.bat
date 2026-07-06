@echo off
setlocal
title DungeonSmith VTT
cd /d "%~dp0"

set "VTT_PORT=3000"
set "PYTHON_CMD=py -3"

echo.
echo  Starting DungeonSmith VTT Server...
echo  Project folder: %CD%
echo.

where py >nul 2>nul
if errorlevel 1 (
    echo Python was not found. Install Python, then run this again.
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo Creating Python virtual environment...
    %PYTHON_CMD% -m venv .venv
    if errorlevel 1 (
        echo.
        echo Virtual environment creation failed.
        pause
        exit /b 1
    )
)

echo Installing Python dependencies...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo Dependency install failed.
    pause
    exit /b 1
)

echo.
echo  Server starting at http://localhost:%VTT_PORT%
echo  DM View:      http://localhost:%VTT_PORT%/dm
echo  Player View:  http://localhost:%VTT_PORT%
echo  Files:        http://localhost:%VTT_PORT%/dmadmin
echo.
echo  The DM and Player passwords will be shown in this window.
echo.

set "VTT_PORT=%VTT_PORT%"
".venv\Scripts\python.exe" app.py
pause
