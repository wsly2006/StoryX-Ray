@echo off
setlocal
cd /d "%~dp0"

REM 首次运行没有 .venv 时自建；再判 activate.bat 是防止半成品 venv
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

REM 首跑没有 .env 时从模板复制并弹出编辑器；密钥没填直接跑也能进 UI，只是抽取时会 400
if not exist ".env" (
    echo [StoryX-Ray] .env not found, copied from .env.example. Fill in your API key and retry.
    copy ".env.example" ".env" >nul
    notepad ".env"
)

REM 后台起一个子进程等 3 秒再开浏览器，避免服务器还没起来
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:8765"

echo [StoryX-Ray] Serving at http://127.0.0.1:8765
python -m uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
