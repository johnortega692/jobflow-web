@echo off
cd /d "%~dp0"
echo JobFlow Web — current folder:
cd
echo.

if not exist package.json (
    echo ERROR: package.json not found in this folder.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm not found. Install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Use npm.cmd so PowerShell execution policy cannot block npm.ps1
set "NPM=npm.cmd"
if not exist "%ProgramFiles%\nodejs\npm.cmd" set "NPM=npm"

if not exist node_modules (
    echo Installing dependencies...
    call %NPM% install
    if errorlevel 1 pause & exit /b 1
)

if not exist .env.local (
    echo WARNING: .env.local missing — copy from .env.example and add Supabase keys.
)

echo.
echo Starting dev server at http://localhost:5173
echo Press Ctrl+C to stop.
echo.
call %NPM% run dev
