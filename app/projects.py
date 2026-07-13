"""工程管理：一个工程包含多个章节，每章各自有原文和抽取结果。

文件布局：
    data/
        projects/{id}.json   ── 单个工程的完整内容（含所有章节）
        index.json           ── 所有工程的概要列表，按时间倒序

新数据模型：
    project = {
      id, name, created_at,
      preset_snapshot,          # 工程级默认预设，可被章节覆盖
      passes, char_buffer,      # 工程级默认抽取参数
      chapters: [
        {
          id: "ch-01",
          title: "第一回 …",
          text: "……",
          status: "pending" | "extracting" | "extracted",
          result: {extractions, html, characters, relationships, events, summary},
          stats:  {calls, prompt_tokens, ..., elapsed_sec, input_chars},
        },
        ...
      ]
    }

老格式（input.text + result 平铺）在 load 时自动升级并写回，
一次性完成迁移，之后代码路径统一走 chapters。
"""
from __future__ import annotations

import json
import re
import secrets
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
PROJECTS_DIR = DATA_DIR / "projects"
INDEX_PATH = DATA_DIR / "index.json"

# id 必须严格校验：HTTP path 段会拼到文件路径，不允许出现 .. 或斜杠
ID_PATTERN = re.compile(r"^p-\d{8}-\d{6}-[a-z0-9]+$")
# 章节 id 由前端/后端约定：ch- 后跟 1-4 位数字，防止路径穿越
CHAPTER_ID_PATTERN = re.compile(r"^ch-\d{1,4}$")

_lock = threading.Lock()


def _ensure_dirs() -> None:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


def generate_id() -> str:
    """p-YYYYMMDD-HHMMSS-xxxx，时间戳便于人肉排序，4 位随机后缀避免秒级冲突。"""
    now = datetime.now()
    return f"p-{now.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"


def is_valid_id(pid: str) -> bool:
    return bool(ID_PATTERN.match(pid))


def is_valid_chapter_id(cid: str) -> bool:
    return bool(CHAPTER_ID_PATTERN.match(cid))


def _project_path(pid: str) -> Path:
    if not is_valid_id(pid):
        raise ValueError("非法 project id")
    return PROJECTS_DIR / f"{pid}.json"


def _load_index() -> list[dict]:
    if not INDEX_PATH.exists():
        return []
    try:
        return json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_index(items: list[dict]) -> None:
    INDEX_PATH.write_text(
        json.dumps(items, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _empty_result() -> dict:
    return {
        "extractions": [],
        "html": "",
        "characters": [],
        "relationships": [],
        "events": [],
        "summary": "",
    }


def _chapter_id(index: int) -> str:
    """1-based 转 ch-01 ~ ch-9999。"""
    return f"ch-{index:02d}"


def make_chapter(
    index: int,
    title: str,
    text: str,
    *,
    result: dict | None = None,
    stats: dict | None = None,
    status: str = "pending",
) -> dict:
    """统一构造章节字典，保证字段齐全。"""
    return {
        "id": _chapter_id(index),
        "title": (title or "").strip() or f"第 {index} 章",
        "text": text or "",
        "status": status,
        "result": result or _empty_result(),
        "stats": stats or {},
    }


def _is_legacy(project: dict) -> bool:
    """老格式判定：无 chapters 字段但有 input.text。"""
    return "chapters" not in project and isinstance(project.get("input"), dict)


def _migrate_legacy(project: dict) -> dict:
    """老格式转新：把 input.text + result 打成一章。就地改，返回同一对象。"""
    input_blk = project.get("input") or {}
    result = project.get("result") or {}
    # 兜住老结果里没有的字段
    merged_result = {**_empty_result(), **result}
    stats = project.get("stats") or {}
    chapter = make_chapter(
        1,
        title=project.get("name") or "第 1 章",
        text=input_blk.get("text") or "",
        result=merged_result,
        stats=stats,
        # 老工程只要有抽取结果就当已完成
        status="extracted" if result.get("extractions") or result.get("characters") else "pending",
    )
    project["chapters"] = [chapter]
    project["preset_snapshot"] = input_blk.get("preset_snapshot") or {}
    project["passes"] = input_blk.get("passes") or 1
    project["char_buffer"] = input_blk.get("char_buffer") or 1500
    # 老字段清掉，后续代码只看新格式
    project.pop("input", None)
    project.pop("result", None)
    # 顶层 stats 沿用作为工程聚合快照，保持兼容顶栏统计
    return project


def _summarize(project: dict) -> dict:
    """索引里存轻量概要：章节数、已抽取章节数、总字数、token 用量聚合。"""
    chapters = project.get("chapters") or []
    total_chars = sum(len(c.get("text") or "") for c in chapters)
    extracted = sum(1 for c in chapters if c.get("status") == "extracted")
    # 聚合各章节 token/耗时——顶栏"用量统计"要用
    agg = {"calls": 0, "prompt_tokens": 0, "completion_tokens": 0,
           "total_tokens": 0, "elapsed_sec": 0.0, "partial": False}
    for c in chapters:
        s = c.get("stats") or {}
        agg["calls"] += int(s.get("calls") or 0)
        agg["prompt_tokens"] += int(s.get("prompt_tokens") or 0)
        agg["completion_tokens"] += int(s.get("completion_tokens") or 0)
        agg["total_tokens"] += int(s.get("total_tokens") or 0)
        agg["elapsed_sec"] += float(s.get("elapsed_sec") or 0.0)
        if s.get("partial"):
            agg["partial"] = True
    agg["elapsed_sec"] = round(agg["elapsed_sec"], 2)
    return {
        "id": project["id"],
        "name": project["name"],
        "created_at": project["created_at"],
        "chapter_count": len(chapters),
        "extracted_count": extracted,
        "input_chars": total_chars,
        "preset_snapshot": project.get("preset_snapshot", {}),
        "stats": agg,
    }


def _write_project(project: dict) -> None:
    path = _project_path(project["id"])
    path.write_text(
        json.dumps(project, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _upsert_index(project: dict) -> dict:
    idx = _load_index()
    idx = [it for it in idx if it.get("id") != project["id"]]
    summary = _summarize(project)
    idx.insert(0, summary)
    _save_index(idx)
    return summary


def create_project(name: str, chapters: list[dict], preset_snapshot: dict | None,
                   passes: int, char_buffer: int) -> dict:
    """新建空工程：只有章节骨架，没有抽取结果。返回完整工程对象。"""
    _ensure_dirs()
    now = datetime.now()
    project = {
        "id": generate_id(),
        "name": (name or "").strip() or auto_name_from_chapters(chapters, now),
        "created_at": now.isoformat(timespec="seconds"),
        "preset_snapshot": preset_snapshot or {},
        "passes": passes,
        "char_buffer": char_buffer,
        "chapters": [
            make_chapter(i + 1, ch.get("title", ""), ch.get("text", ""))
            for i, ch in enumerate(chapters or [])
        ],
    }
    with _lock:
        _write_project(project)
        _upsert_index(project)
    return project


def list_projects() -> list[dict]:
    _ensure_dirs()
    return _load_index()


def load_project(pid: str) -> dict | None:
    """读取工程；若为老格式自动升级并写回。"""
    if not is_valid_id(pid):
        return None
    path = _project_path(pid)
    if not path.exists():
        return None
    try:
        project = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None

    if _is_legacy(project):
        with _lock:
            _migrate_legacy(project)
            _write_project(project)
            _upsert_index(project)

    # 补章节字段：极端情况下 chapters 缺失时给个空章节，避免下游崩溃
    if not project.get("chapters"):
        project["chapters"] = [make_chapter(1, project.get("name", ""), "")]

    return project


def save_chapter_result(pid: str, cid: str, result: dict, stats: dict | None = None,
                         status: str = "extracted") -> dict | None:
    """把一次抽取的结果写到指定章节，同步更新索引。返回更新后的工程摘要。"""
    if not is_valid_id(pid) or not is_valid_chapter_id(cid):
        return None
    with _lock:
        project = load_project(pid)
        if not project:
            return None
        target = next((c for c in project["chapters"] if c["id"] == cid), None)
        if not target:
            return None
        target["result"] = {**_empty_result(), **(result or {})}
        target["stats"] = {
            **(target.get("stats") or {}),
            **(stats or {}),
            "input_chars": len(target.get("text") or ""),
        }
        target["status"] = status
        _write_project(project)
        return _upsert_index(project)


def save_chapter_summary(pid: str, cid: str, summary: str, stats: dict | None = None) -> dict | None:
    """只更新简介字段，简介是可独立生成的产物。"""
    if not is_valid_id(pid) or not is_valid_chapter_id(cid):
        return None
    with _lock:
        project = load_project(pid)
        if not project:
            return None
        target = next((c for c in project["chapters"] if c["id"] == cid), None)
        if not target:
            return None
        target["result"] = {**_empty_result(), **(target.get("result") or {})}
        target["result"]["summary"] = summary or ""
        # 简介 token 也累计进章节 stats，方便用量统计口径一致
        if stats:
            s = dict(target.get("stats") or {})
            for k in ("calls", "prompt_tokens", "completion_tokens", "total_tokens"):
                s[k] = int(s.get(k) or 0) + int(stats.get(k) or 0)
            s["elapsed_sec"] = round(float(s.get("elapsed_sec") or 0.0) + float(stats.get("elapsed_sec") or 0.0), 2)
            if stats.get("partial"):
                s["partial"] = True
            target["stats"] = s
        _write_project(project)
        return _upsert_index(project)


def rename_project(pid: str, new_name: str) -> dict | None:
    with _lock:
        proj = load_project(pid)
        if not proj:
            return None
        proj["name"] = new_name
        _write_project(proj)
        return _upsert_index(proj)


def rename_chapter(pid: str, cid: str, new_title: str) -> dict | None:
    if not is_valid_id(pid) or not is_valid_chapter_id(cid):
        return None
    with _lock:
        proj = load_project(pid)
        if not proj:
            return None
        target = next((c for c in proj["chapters"] if c["id"] == cid), None)
        if not target:
            return None
        target["title"] = new_title
        _write_project(proj)
        return _upsert_index(proj)


def delete_project(pid: str) -> bool:
    if not is_valid_id(pid):
        return False
    path = _project_path(pid)
    with _lock:
        existed = path.exists()
        if existed:
            path.unlink()
        idx = _load_index()
        new_idx = [it for it in idx if it.get("id") != pid]
        if len(new_idx) != len(idx):
            _save_index(new_idx)
            existed = True
        return existed


def auto_name(text: str, when: datetime | None = None) -> str:
    """兼容保留：老代码路径万一还调到，就给个默认名。"""
    when = when or datetime.now()
    chars = len(text)
    size = f"{chars / 1000:.1f}k字" if chars >= 1000 else f"{chars}字"
    preview = text.strip().replace("\n", " ")[:16]
    return f"{when.strftime('%Y-%m-%d %H:%M')} · {size}" + (f" · {preview}" if preview else "")


def auto_name_from_chapters(chapters: list[dict], when: datetime | None = None) -> str:
    when = when or datetime.now()
    total = sum(len(c.get("text") or "") for c in (chapters or []))
    size = f"{total / 1000:.1f}k字" if total >= 1000 else f"{total}字"
    n = len(chapters or [])
    return f"{when.strftime('%Y-%m-%d %H:%M')} · {n} 章 · {size}"


def make_preset_snapshot(
    backend: str,
    model: str,
    base_url: str | None,
    passes: int,
    char_buffer: int,
    preset_name: str | None = None,
) -> dict:
    """从抽取请求里抽出可公开的预设信息——不含 api_key。"""
    return {
        "name": preset_name or "",
        "backend": backend,
        "model": model,
        "base_url": base_url or "",
        "passes": passes,
        "char_buffer": char_buffer,
    }
