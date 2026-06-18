@echo off
cd /d "%~dp0"
echo JobFlow Web — setup
echo.

where npm >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js / npm not found.
    echo Install from https://nodejs.org/ then run this script again.
    pause
    exit /b 1
)

if not exist .env.local (
    echo Creating .env.local from .env.example — add your Supabase keys!
    copy /Y .env.example .env.local >nul
)

call npm.cmd install
if errorlevel 1 pause & exit /b 1

echo.
echo Done. Next:
echo   1. Edit .env.local with Supabase URL + anon key
echo   2. Run supabase/schema.sql in Supabase SQL Editor
echo   3. npm run dev
echo.
pause
