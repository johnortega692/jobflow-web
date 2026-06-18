@echo off
cd /d "%~dp0"
echo JobFlow PDF API
echo.

call "%~dp0..\..\scripts\resolve_python.bat" 2>nul
if errorlevel 1 (
    where py >nul 2>&1 && py -3 -c "import pip" >nul 2>&1 && for /f "delims=" %%i in ('py -3 -c "import sys; print(sys.executable)"') do set "PYTHON_EXE=%%i"
)
if not defined PYTHON_EXE (
    where python >nul 2>&1 && set "PYTHON_EXE=python"
)
if not defined PYTHON_EXE (
    echo ERROR: Python not found.
    pause
    exit /b 1
)

echo Using: %PYTHON_EXE%
if not exist requirements.txt (
    echo ERROR: Run from jobflow-web\api folder
    pause
    exit /b 1
)

"%PYTHON_EXE%" -m pip install -r requirements.txt -q
if errorlevel 1 (
    echo ERROR: pip install failed.
    pause
    exit /b 1
)

set "API_PORT=8765"
set CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174

netstat -ano | findstr ":%API_PORT%" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo.
    echo Port %API_PORT% is already in use — the API may already be running.
    echo Open: http://localhost:%API_PORT%/health
    echo If that works, you do not need to start this again.
    echo Otherwise close the other terminal or end that Python process.
    echo.
    pause
    exit /b 0
)

echo.
echo JobFlow PDF API on http://localhost:%API_PORT%
echo Test in browser: http://localhost:%API_PORT%/health
echo Keep this window open while using Export PDF.
echo Press Ctrl+C to stop.
echo.

REM Use server:app (not main:app) — parent folder has main.py for the desktop app.
if defined JOBFLOW_API_RELOAD (
    "%PYTHON_EXE%" -m uvicorn server:app --reload --host 127.0.0.1 --port %API_PORT%
) else (
    "%PYTHON_EXE%" -m uvicorn server:app --host 127.0.0.1 --port %API_PORT%
)
if errorlevel 1 (
    echo.
    echo API stopped with an error. See messages above.
)
pause
