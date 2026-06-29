"""FastAPI 入口：提供抽取 API 与静态前端。"""
from __future__ import annotations

import ipaddress
import logging
import sys
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .extractor import build_config_from_env, render_html, run_extraction
from .schemas import Extraction, ExtractRequest, ExtractResponse


# Windows 终端默认 GBK，LangExtract 内部含中英符号（如 ✓）会编码失败，强制 UTF-8
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("storyxray")

app = FastAPI(title="StoryX-Ray", description="小说人物关系抽取工具")

STATIC_DIR = Path(__file__).resolve().parent / "static"

# 仅允许前端 base_url 指向这些主机，避免被当成 SSRF 跳板访问内网/云元数据
_ALLOWED_BASE_HOSTS = {
    "api.deepseek.com",
    "api.openai.com",
    "generativelanguage.googleapis.com",
    "localhost",
    "127.0.0.1",
}


def _validate_base_url(url: str | None) -> None:
    """前端传入的 base_url 必须在白名单内。留空走 .env 默认值不走这里。"""
    if not url:
        return
    try:
        parsed = urlparse(url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="base_url 不是合法 URL") from exc

    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="base_url 仅支持 http/https")

    host = (parsed.hostname or "").lower()
    if not host:
        raise HTTPException(status_code=400, detail="base_url 缺少主机名")

    # 显式 IP 字面量：只放行环回，挡掉内网与云元数据（如 169.254.169.254）
    try:
        ip = ipaddress.ip_address(host)
        if not ip.is_loopback:
            raise HTTPException(status_code=400, detail="base_url 不允许指向非环回 IP")
        return
    except ValueError:
        pass

    if host not in _ALLOWED_BASE_HOSTS:
        raise HTTPException(
            status_code=400,
            detail=f"base_url 主机不在白名单内：{host}",
        )


def _summarize(extractions: list[Extraction]) -> tuple[list[str], list[dict], list[dict]]:
    """把抽取结果按类别拆成人物/关系/事件三组，供前端 chip 与表格使用。"""
    characters: list[str] = []
    seen_chars: set[str] = set()
    relationships: list[dict] = []
    events: list[dict] = []

    for ex in extractions:
        cls = ex.extraction_class
        attrs = ex.attributes or {}

        if cls == "character":
            name = ex.extraction_text.strip()
            if name and name not in seen_chars:
                seen_chars.add(name)
                characters.append(name)

        elif cls == "relationship":
            relationships.append(
                {
                    "person_a": attrs.get("person_a", ""),
                    "person_b": attrs.get("person_b", ""),
                    "relation": attrs.get("relation", ""),
                    "evidence": ex.extraction_text,
                }
            )

        elif cls == "event":
            events.append(
                {
                    "participants": attrs.get("participants", []),
                    "summary": attrs.get("summary", ""),
                    "evidence": ex.extraction_text,
                }
            )

    return characters, relationships, events


@app.post("/api/extract", response_model=ExtractResponse)
def extract(req: ExtractRequest) -> ExtractResponse:
    _validate_base_url(req.base_url)

    cfg = build_config_from_env(
        backend=req.backend,
        overrides={
            "model": req.model,
            "api_key": req.api_key,
            "base_url": req.base_url,
        },
    )
    cfg.extraction_passes = req.extraction_passes
    cfg.max_char_buffer = req.max_char_buffer

    # 校验密钥：本地后端不需要，云端必需
    if req.backend in {"gemini", "openai", "deepseek"} and not cfg.api_key:
        raise HTTPException(
            status_code=400,
            detail=f"{req.backend} 后端需要 API Key，请在 .env 或 UI 中填写。",
        )

    logger.info("开始抽取: backend=%s model=%s chars=%d", cfg.backend, cfg.model_id, len(req.text))

    try:
        annotated = run_extraction(req.text, cfg)
    except Exception:
        # 异常详情可能含密钥片段或内网信息，仅记日志，不回显
        logger.exception("抽取失败")
        raise HTTPException(status_code=500, detail="抽取失败，请查看服务端日志") from None

    extractions = [
        Extraction(
            extraction_class=e.extraction_class,
            extraction_text=e.extraction_text,
            attributes=e.attributes,
            char_interval=(
                {"start_pos": e.char_interval.start_pos, "end_pos": e.char_interval.end_pos}
                if e.char_interval
                else None
            ),
        )
        for e in (annotated.extractions or [])
    ]

    characters, relationships, events = _summarize(extractions)

    try:
        html = render_html(annotated)
    except Exception as exc:
        logger.warning("可视化渲染失败，回退空 HTML: %s", exc)
        html = ""

    return ExtractResponse(
        extractions=extractions,
        html=html,
        characters=characters,
        relationships=relationships,
        events=events,
    )


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
