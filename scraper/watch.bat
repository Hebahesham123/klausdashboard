@echo off
rem GAD Marketplace watcher - runs the scraper continuously (every minute).
cd /d "%~dp0"
:loop
node src/index.js
echo Watcher exited, restarting in 10s...
timeout /t 10 /nobreak >nul
goto loop
