@echo off
title Last Rocket to the Moon - game server (keep this window open)
cd /d "%~dp0"
echo.
echo   LAST ROCKET TO THE MOON - game server
echo   Keep this window open while people play. Closing it stops the game.
echo   The host console opens in your browser in a few seconds.
echo.
start "" /min cmd /c "ping -n 7 127.0.0.1 >nul & explorer http://localhost:3000/host"
node src\main.ts
echo.
echo   The game server has stopped. Press any key to close this window.
pause >nul
