#!/usr/bin/env bash
# StoryX-Ray one-click launcher (macOS / Linux)
set -e

cd "$(dirname "$0")"

PY="${PYTHON:-python3}"

# 首次运行没有 .venv 时自建
if [ ! -f ".venv/bin/activate" ]; then
    echo "[StoryX-Ray] Virtual env not found, creating .venv ..."
    "$PY" -m venv .venv
    # shellcheck disable=SC1091
    source .venv/bin/activate
    echo "[StoryX-Ray] Installing dependencies ..."
    python -m pip install --upgrade pip
    pip install -r requirements.txt
else
    # shellcheck disable=SC1091
    source .venv/bin/activate
fi

# 首跑没有 .env 时从模板复制，提示用户填写
if [ ! -f ".env" ]; then
    echo "[StoryX-Ray] .env not found, copied from .env.example. Fill in your API key and retry."
    cp .env.example .env
    "${EDITOR:-vi}" .env
fi

# 后台等 3 秒再打开浏览器；跨平台探测：macOS 用 open，Linux 用 xdg-open
(
    sleep 3
    if command -v open >/dev/null 2>&1; then
        open http://127.0.0.1:8765
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open http://127.0.0.1:8765
    fi
) &

echo "[StoryX-Ray] Serving at http://127.0.0.1:8765"
exec python -m uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
