"""FastAPI 入口：提供抽取 API 与静态前端。"""
from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import math
import queue
import re
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import projects
from .extractor import get_extractor
from .schemas import (
    Extraction,
    ExtractRequest,
    ExtractResponse,
    RenameRequest,
    SaveProjectRequest,
)


# Windows 终端默认 GBK，LangExtract 内部含中英符号（如 ✓）会编码失败，强制 UTF-8
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

load_dotenv()

# 主 logger + 文件 handler：抽取流程涉及多线程 + stdout 重定向，落盘日志最可靠
_LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
_LOG_DIR.mkdir(exist_ok=True)
_LOG_FILE = _LOG_DIR / "storyxray.log"

_fmt = logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
_file_handler = logging.FileHandler(_LOG_FILE, encoding="utf-8")
_file_handler.setFormatter(_fmt)
_stream_handler = logging.StreamHandler()
_stream_handler.setFormatter(_fmt)

logging.basicConfig(level=logging.INFO, handlers=[_stream_handler, _file_handler], force=True)
# LangExtract 内部用 logging，调 DEBUG 能看到分片/重试/HTTP 细节
logging.getLogger("langextract").setLevel(logging.DEBUG)

logger = logging.getLogger("storyxray")
logger.info("日志写入: %s", _LOG_FILE)

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


def _to_extractions(result) -> list[Extraction]:
    """把引擎返回的 ExtractionResult 中的抽取记录转成 Pydantic 模型列表。"""
    return [
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
        for e in (result.extractions or [])
    ]


class _ProgressWriter:
    """把 langextract 内部的 stdout/stderr 切成进度行，回调出去。

    tqdm 用 \\r 覆盖同一行，所以按 \\r 与 \\n 都切；空白行丢掉。
    """

    def __init__(self, on_line):
        self.on_line = on_line
        self._buf = ""

    def write(self, s):
        if not s:
            return 0
        self._buf += s
        while True:
            # 找最早出现的 \r 或 \n，二者都视作一行结束
            r_pos = self._buf.find("\r")
            n_pos = self._buf.find("\n")
            if r_pos == -1 and n_pos == -1:
                break
            if r_pos == -1:
                pos = n_pos
            elif n_pos == -1:
                pos = r_pos
            else:
                pos = min(r_pos, n_pos)
            line = self._buf[:pos].strip()
            self._buf = self._buf[pos + 1 :]
            if line:
                try:
                    self.on_line(line)
                except Exception:
                    # writer 不能往外抛，否则会破坏 langextract 的执行栈
                    logger.exception("进度回调异常")
        return len(s)

    def flush(self):
        pass


# tqdm 行里抓 n/total 数字对，例如 "30%|███| 3/10 [00:01<00:02]"
_TQDM_PAT = re.compile(r"\b(\d+)\s*/\s*(\d+)\b")


def _parse_progress(line: str) -> dict | None:
    """从一行 tqdm/langextract 输出里抠出 current/total。"""
    m = _TQDM_PAT.search(line)
    if not m:
        return None
    cur, tot = int(m.group(1)), int(m.group(2))
    if tot <= 0 or cur > tot * 10:  # 异常值挡掉，避免 1234/3 这种解析错位
        return None
    return {"current": cur, "total": tot}


def _sse(event: str, payload: dict) -> bytes:
    """打包成 SSE 帧：event + data 一行 JSON + 空行。"""
    data = json.dumps(payload, ensure_ascii=False)
    return f"event: {event}\ndata: {data}\n\n".encode("utf-8")


@app.post("/api/extract/stream")
async def extract_stream(req: ExtractRequest):
    """SSE 版抽取：边跑边推进度。"""
    _validate_base_url(req.base_url)

    engine = get_extractor()
    cfg = engine.build_config(
        backend=req.backend,
        overrides={
            "model": req.model,
            "api_key": req.api_key,
            "base_url": req.base_url,
        },
    )
    cfg.extraction_passes = req.extraction_passes
    cfg.max_char_buffer = req.max_char_buffer

    if req.backend in {"gemini", "openai", "deepseek"} and not cfg.api_key:
        raise HTTPException(
            status_code=400,
            detail=f"{req.backend} 后端需要 API Key，请在 .env 或 UI 中填写。",
        )

    text = req.text
    # 预估总分片数：当前引擎按 max_char_buffer 切片，每片一次 LLM
    estimated_chunks = max(1, math.ceil(len(text) / max(cfg.max_char_buffer, 1)))
    estimated_total = estimated_chunks * max(cfg.extraction_passes, 1)

    logger.info(
        "开始抽取(SSE): engine=%s backend=%s model=%s chars=%d chunks=%d passes=%d",
        engine.name, cfg.backend, cfg.model_id, len(text), estimated_chunks, cfg.extraction_passes,
    )

    # 用线程安全队列把 worker 线程的事件传给 async generator
    # 元素是 (kind, payload) 二元组，kind ∈ {"progress", "done", "error"}
    q: queue.Queue = queue.Queue()
    started_at = time.monotonic()

    def worker():
        t0 = time.monotonic()
        try:
            logger.info(
                "worker 启动: text_len=%d max_char_buffer=%d passes=%d",
                len(text), cfg.max_char_buffer, cfg.extraction_passes,
            )
            writer = _ProgressWriter(lambda line: q.put(("progress", line)))
            result = engine.extract(text, cfg, writer=writer)
            logger.info(
                "worker 完成: 耗时 %.2fs，抽取 %d 条",
                time.monotonic() - t0, len(result.extractions or []),
            )
            q.put(("done", result))
        except Exception as exc:
            # 异常详情可能含密钥片段或内网信息，仅记日志，不回显
            logger.exception("worker 失败: 耗时 %.2fs", time.monotonic() - t0)
            q.put(("error", exc))

    thread = threading.Thread(target=worker, name="extract-worker", daemon=True)
    thread.start()

    async def event_gen():
        # 先发一个 init 事件告诉前端预估总量
        yield _sse("init", {
            "text_length": len(text),
            "estimated_chunks": estimated_chunks,
            "passes": cfg.extraction_passes,
            "estimated_total": estimated_total,
            "model": cfg.model_id,
            "backend": cfg.backend,
        })

        last_progress = None
        while True:
            # 阻塞 get 放线程池，async 主循环不被卡住
            try:
                kind, payload = await asyncio.to_thread(q.get, True, 60)
            except queue.Empty:
                # 60 秒没消息发个心跳，防止反代/浏览器超时断连
                yield b": keepalive\n\n"
                continue

            if kind == "progress":
                parsed = _parse_progress(payload)
                if parsed:
                    # 进度数字解析成功才推；相同的不重复发
                    sig = (parsed["current"], parsed["total"])
                    if sig != last_progress:
                        last_progress = sig
                        yield _sse("progress", {**parsed, "raw": payload})
                else:
                    # 解析不出 n/total 的就当 log 行原样推（如阶段提示）
                    yield _sse("log", {"raw": payload})
                continue

            if kind == "error":
                yield _sse("error", {"detail": "抽取失败，请查看服务端日志"})
                return

            if kind == "done":
                result = payload
                extractions = _to_extractions(result)
                characters, relationships, events = _summarize(extractions)
                try:
                    html = engine.render_html(result)
                except Exception as exc:
                    logger.warning("可视化渲染失败，回退空 HTML: %s", exc)
                    html = ""

                # 保存改成用户手动触发，这里只把抽取耗时与统计回前端
                elapsed = round(time.monotonic() - started_at, 2)
                yield _sse("done", {
                    "extractions": [e.model_dump() for e in extractions],
                    "html": html,
                    "characters": characters,
                    "relationships": relationships,
                    "events": events,
                    "elapsed_sec": elapsed,
                    "stats": result.stats or {},
                })
                return

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # 关掉 nginx 缓冲，事件即时下发
        },
    )


def _build_project(req: SaveProjectRequest) -> dict:
    """把前端发回的草稿组装成完整工程 JSON。id/时间/名字都由后端定。"""
    now = datetime.now()
    name = (req.name or "").strip() or projects.auto_name(req.text, now)
    return {
        "id": projects.generate_id(),
        "name": name,
        "created_at": now.isoformat(timespec="seconds"),
        "input": {
            "text": req.text,
            "preset_snapshot": req.preset_snapshot or {},
            "passes": req.passes,
            "char_buffer": req.char_buffer,
        },
        "result": {
            "extractions": [e.model_dump() for e in req.extractions],
            "html": req.html,
            "characters": req.characters,
            "relationships": req.relationships,
            "events": req.events,
        },
        "stats": {
            "elapsed_sec": req.elapsed_sec,
            "input_chars": len(req.text),
            "characters": len(req.characters),
            "relationships": len(req.relationships),
            "events": len(req.events),
            # 透传前端发回的引擎层统计（token 用量、LLM 调用次数等）
            **(req.stats or {}),
        },
    }


@app.get("/api/projects")
def projects_list() -> list[dict]:
    return projects.list_projects()


@app.get("/api/stats")
def stats_summary() -> dict:
    """所有已保存工程的 token/耗时聚合，用于顶栏「用量统计」弹窗。"""
    items = projects.list_projects()
    total = {
        "projects": 0,
        "calls": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "elapsed_sec": 0.0,
        "partial": False,  # 只要有一条 partial，整体标记 partial
    }
    by_backend: dict[str, dict] = {}
    recent: list[dict] = []
    for it in items:
        s = it.get("stats") or {}
        snap = it.get("preset_snapshot") or {}
        backend = snap.get("backend") or "unknown"
        model = snap.get("model") or ""
        # 未保存过 preset_snapshot 的老工程也计入 unknown 桶
        key = f"{backend}::{model}" if model else backend
        b = by_backend.setdefault(
            key,
            {"backend": backend, "model": model, "projects": 0,
             "calls": 0, "prompt_tokens": 0, "completion_tokens": 0,
             "total_tokens": 0, "elapsed_sec": 0.0},
        )
        b["projects"] += 1
        b["calls"] += int(s.get("calls") or 0)
        b["prompt_tokens"] += int(s.get("prompt_tokens") or 0)
        b["completion_tokens"] += int(s.get("completion_tokens") or 0)
        b["total_tokens"] += int(s.get("total_tokens") or 0)
        b["elapsed_sec"] += float(s.get("elapsed_sec") or 0.0)

        total["projects"] += 1
        total["calls"] += int(s.get("calls") or 0)
        total["prompt_tokens"] += int(s.get("prompt_tokens") or 0)
        total["completion_tokens"] += int(s.get("completion_tokens") or 0)
        total["total_tokens"] += int(s.get("total_tokens") or 0)
        total["elapsed_sec"] += float(s.get("elapsed_sec") or 0.0)
        if s.get("partial"):
            total["partial"] = True

        recent.append({
            "id": it.get("id"),
            "name": it.get("name"),
            "created_at": it.get("created_at"),
            "backend": backend,
            "model": model,
            "calls": int(s.get("calls") or 0),
            "prompt_tokens": int(s.get("prompt_tokens") or 0),
            "completion_tokens": int(s.get("completion_tokens") or 0),
            "total_tokens": int(s.get("total_tokens") or 0),
            "elapsed_sec": float(s.get("elapsed_sec") or 0.0),
            "partial": bool(s.get("partial")),
        })

    total["elapsed_sec"] = round(total["elapsed_sec"], 2)
    for b in by_backend.values():
        b["elapsed_sec"] = round(b["elapsed_sec"], 2)
    # 后端桶按 token 用量倒序，前端拿来直接渲染
    by_backend_list = sorted(by_backend.values(), key=lambda x: x["total_tokens"], reverse=True)
    return {"total": total, "by_backend": by_backend_list, "recent": recent}


@app.post("/api/projects")
def projects_create(body: SaveProjectRequest) -> dict:
    """用户主动保存：前端把刚抽取完的草稿发过来，这里落盘。"""
    project = _build_project(body)
    try:
        summary = projects.save_project(project)
    except Exception:
        logger.exception("工程落盘失败")
        raise HTTPException(status_code=500, detail="保存失败，请查看服务端日志") from None
    # 返回完整工程而不仅是概要，前端可以立刻把它当作"已加载"状态用
    return {"id": project["id"], "name": project["name"], "summary": summary}


@app.get("/api/projects/{pid}")
def projects_get(pid: str) -> dict:
    if not projects.is_valid_id(pid):
        raise HTTPException(status_code=400, detail="非法 project id")
    proj = projects.load_project(pid)
    if not proj:
        raise HTTPException(status_code=404, detail="工程不存在")
    return proj


@app.patch("/api/projects/{pid}")
def projects_rename(pid: str, body: RenameRequest) -> dict:
    if not projects.is_valid_id(pid):
        raise HTTPException(status_code=400, detail="非法 project id")
    summary = projects.rename_project(pid, body.name.strip())
    if not summary:
        raise HTTPException(status_code=404, detail="工程不存在")
    return summary


@app.delete("/api/projects/{pid}")
def projects_delete(pid: str) -> dict:
    if not projects.is_valid_id(pid):
        raise HTTPException(status_code=400, detail="非法 project id")
    if not projects.delete_project(pid):
        raise HTTPException(status_code=404, detail="工程不存在")
    return {"ok": True}


@app.post("/api/extract", response_model=ExtractResponse)
def extract(req: ExtractRequest) -> ExtractResponse:
    """非流式入口，保留给脚本/CLI 用；UI 走 /api/extract/stream。"""
    _validate_base_url(req.base_url)

    engine = get_extractor()
    cfg = engine.build_config(
        backend=req.backend,
        overrides={
            "model": req.model,
            "api_key": req.api_key,
            "base_url": req.base_url,
        },
    )
    cfg.extraction_passes = req.extraction_passes
    cfg.max_char_buffer = req.max_char_buffer

    if req.backend in {"gemini", "openai", "deepseek"} and not cfg.api_key:
        raise HTTPException(
            status_code=400,
            detail=f"{req.backend} 后端需要 API Key，请在 .env 或 UI 中填写。",
        )

    logger.info(
        "开始抽取: engine=%s backend=%s model=%s chars=%d",
        engine.name, cfg.backend, cfg.model_id, len(req.text),
    )

    try:
        result = engine.extract(req.text, cfg)
    except Exception:
        logger.exception("抽取失败")
        raise HTTPException(status_code=500, detail="抽取失败，请查看服务端日志") from None

    extractions = _to_extractions(result)
    characters, relationships, events = _summarize(extractions)

    try:
        html = engine.render_html(result)
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
