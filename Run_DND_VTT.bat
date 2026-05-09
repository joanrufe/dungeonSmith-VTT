@echo off
title DND VTT (MiniVTT Base)
echo.
echo  Starting DND VTT Server...
echo.

if not exist "node_modules\" (
    echo Installing dependencies...
    npm install
    echo.
)

echo  Server starting at http://localhost:3000
echo  DM View:     http://localhost:3000/dm
echo  Player View: http://localhost:3000
echo.
echo  The DM password will be shown in this window.
echo.
npm start
pause
