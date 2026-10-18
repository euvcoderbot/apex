@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  "C:\Program Files\nodejs\node.exe" scripts\install-local-launcher.mjs
) else (
  node scripts\install-local-launcher.mjs
)
pause
