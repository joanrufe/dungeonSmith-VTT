@echo off
setlocal
title Build SceneSmith VTT
cd /d "%~dp0"

set "BUILD_ROOT=dist"
set "BUILD_DIR=%BUILD_ROOT%\SceneSmithVTT"
set "PYTHON_CMD=py -3"

echo.
echo  Building SceneSmith VTT Python runtime...
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
    if errorlevel 1 goto :fail
)

echo Installing Python dependencies...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :fail

echo.
echo Checking Python syntax...
".venv\Scripts\python.exe" -m py_compile app.py
if errorlevel 1 goto :fail

echo.
echo Creating slim runtime build...
if exist "%BUILD_DIR%" (
    rmdir /s /q "%BUILD_DIR%"
)
mkdir "%BUILD_DIR%"

copy "app.py" "%BUILD_DIR%\" >nul
copy "requirements.txt" "%BUILD_DIR%\" >nul
copy "Run_DND_VTT.bat" "%BUILD_DIR%\" >nul

robocopy "public" "%BUILD_DIR%\public" /E >nul
if errorlevel 8 goto :fail
robocopy "data" "%BUILD_DIR%\data" /E >nul
if errorlevel 8 goto :fail

echo Creating build virtual environment...
%PYTHON_CMD% -m venv "%BUILD_DIR%\.venv"
if errorlevel 1 goto :fail

echo Installing production Python dependencies in build folder...
"%BUILD_DIR%\.venv\Scripts\python.exe" -m pip install -r "%BUILD_DIR%\requirements.txt"
if errorlevel 1 goto :fail

echo.
echo Build complete.
echo Slim build folder: %BUILD_DIR%
echo It excludes Node.js files, node_modules, repo-only notes, and source archives.
pause
exit /b 0

:fail
echo.
echo Build failed.
pause
exit /b 1
