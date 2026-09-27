@echo off
title Last Rocket - big-screen rehearsal (close this window to stop)
cd /d "%~dp0"
echo.
echo   BIG-SCREEN REHEARSAL: 14 bots play automatic 3-minute rounds.
echo   Big screen:   http://localhost:3100/screen
echo   Host console: http://localhost:3100/host
echo   Close this window to stop. The real game and its saves are not touched.
echo.
start "" /min cmd /c "ping -n 4 127.0.0.1 >nul & explorer http://localhost:3100/screen"
node scripts\screen-demo.ts 14 3
echo.
echo   The rehearsal has stopped. Press any key to close this window.
pause >nul
