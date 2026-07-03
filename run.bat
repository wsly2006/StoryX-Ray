@echo off
setlocal
cd /d "%~dp0"

REM Create venv on first run; also guards against a half-built one.
if not exist ".venv\Scripts\activate.bat" (
    echo [StoryX-Ray] Virtual env not found, creating .venv ...
    python -m venv .venv
    if errorlevel 1 (
        echo [StoryX-Ray] Failed to create virtual env. Make sure python is on PATH.
        pause
        exit /b 1
    )
    call ".venv\Scripts\activate.bat"
    echo [StoryX-Ray] Installing dependencies ...
    python -m pip install --upgrade pip
    pip install -r requirements.txt
    if errorlevel 1 (
        echo [StoryX-Ray] Dependency install failed.
        pause
        exit /b 1
    )
) else (
    call ".venv\Scripts\activate.bat"
)

REM Copy .env from template on first run and open editor so user can fill keys.
if not exist ".env" (
    echo [StoryX-Ray] .env not found, copied from .env.example. Fill in your API key and retry.
    copy ".env.example" ".env" >nul
    notepad ".env"
)

REM Open the browser after a 3s delay so the server has time to start.
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:8765"

echo [StoryX-Ray] Serving at http://127.0.0.1:8765
python -m uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
