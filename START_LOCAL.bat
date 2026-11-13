@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Install Node.js 24 or newer, then run this file again.
 pause
 exit /b 1
)
echo Installing the exact project dependencies...
call npm ci
if errorlevel 1 goto failed
echo Building EVADER for local play...
call npm run build
if errorlevel 1 goto failed
echo.
echo Open http://localhost:3000 in your browser. Keep this window open.
call npm start
if errorlevel 1 goto failed
exit /b 0
:failed
echo Setup or startup failed. Read the error above.
pause
exit /b 1
