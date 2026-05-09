@echo off
setlocal
title SceneSmith VTT
cd /d "%~dp0"

echo.
echo  Starting SceneSmith VTT Server...
echo  Project folder: %CD%
echo.

if not exist "node_modules\" (
    echo Installing dependencies...
    npm install
    if errorlevel 1 (
        echo.
        echo Dependency install failed.
        pause
        exit /b 1
    )
    echo.
)

set "VTT_PORT=3000"

echo %VTT_PORT%| findstr /r "^[1-9][0-9]*$" >nul
if errorlevel 1 (
    echo Invalid port "%VTT_PORT%". Using 3000.
    set "VTT_PORT=3000"
)
if %VTT_PORT% GTR 65535 (
    echo Invalid port "%VTT_PORT%". Using 3000.
    set "VTT_PORT=3000"
)

echo.
echo  Server starting at http://localhost:%VTT_PORT%
echo  DM View:     http://localhost:%VTT_PORT%/dm
echo  Player View: http://localhost:%VTT_PORT%
echo  Files:       http://localhost:%VTT_PORT%/files
echo.
echo  The DM and Player passwords will be shown in this window.
echo.

npm start -- %VTT_PORT%
pause
