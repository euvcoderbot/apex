@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  "C:\Program Files\nodejs\node.exe" scripts\start-local.mjs
) else (
  node scripts\start-local.mjs
)
pause
