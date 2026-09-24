@echo off
title AI Project Commander Launcher
cd /d "%~dp0"

echo ============================================
echo   AI Project Commander - starting...
echo ============================================

rem Remove the URL left over from a previous run
if exist "data\server-url.txt" del /q "data\server-url.txt" >nul 2>&1

rem Start the server in its own minimized window (close that window to stop)
start "AI-Project-Commander-Server" /min cmd /c "node src\server\cli.js start"

rem Wait until the server writes its real URL (port may auto-shift if 8787 is busy)
set /a tries=0
:waiturl
if exist "data\server-url.txt" goto open
timeout /t 1 /nobreak >nul
set /a tries+=1
if %tries% lss 40 goto waiturl
echo.
echo Server did not start within 40 seconds. Check the server window for errors.
pause
exit /b 1

:open
set /p APPURL=<data\server-url.txt
echo.
echo   URL: %APPURL%
echo   Opening your browser...
echo   (the server keeps running in the minimized window - close it to stop)
start "" %APPURL%
timeout /t 3 /nobreak >nul
exit /b 0
