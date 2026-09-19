@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo First install the LTS version of Node.js from https://nodejs.org/, then open Start.cmd again.
  pause
  exit /b 1
)
node scripts\launch.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
