"""工程管理：把每次抽取的输入+结果落盘成 JSON，并维护轻量索引。

文件布局：
    data/
        projects/{id}.json   ── 单次工程的完整内容
        index.json           ── 所有工程的概要列表，按时间倒序

索引存在的意义：列表接口只读 index.json 一个文件即可，
不必把每个工程（含原文+高亮 HTML）都打开一遍。索引和文件
内容由 _lock 保证一致；多 worker 部署时索引可能短暂落后，
但单文件方案本身就不为高并发设计。
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

_lock = threading.Lock()


def _ensure_dirs() -> None:
    PROJECTS_DIR.mkdir(parents=True, exist_ok=True)


def generate_id() -> str:
    """p-YYYYMMDD-HHMMSS-xxxx，时间戳便于人肉排序，4 位随机后缀避免秒级冲突。"""
    now = datetime.now()
    return f"p-{now.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"


def is_valid_id(pid: str) -> bool:
    return bool(ID_PATTERN.match(pid))


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
        # 索引损坏时返回空列表而不是崩溃；下一次保存会重写
        return []


def _save_index(items: list[dict]) -> None:
    INDEX_PATH.write_text(
        json.dumps(items, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _summarize(project: dict) -> dict:
    """索引里只存轻量字段，避免列表接口把所有原文都拉一遍。"""
    return {
        "id": project["id"],
        "name": project["name"],
        "created_at": project["created_at"],
        "stats": project.get("stats", {}),
        "preset_snapshot": project.get("input", {}).get("preset_snapshot", {}),
    }


def save_project(project: dict) -> dict:
    """落盘工程并把概要插到索引头部，返回概要。"""
    _ensure_dirs()
    pid = project["id"]
    path = _project_path(pid)
    with _lock:
        path.write_text(
            json.dumps(project, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        idx = _load_index()
        # 同 id 若已存在（极端情况下 id 撞了或被覆盖），先去掉旧条目
        idx = [it for it in idx if it.get("id") != pid]
        idx.insert(0, _summarize(project))
        _save_index(idx)
    return _summarize(project)


def list_projects() -> list[dict]:
    _ensure_dirs()
    return _load_index()


def load_project(pid: str) -> dict | None:
    if not is_valid_id(pid):
        return None
    path = _project_path(pid)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def rename_project(pid: str, new_name: str) -> dict | None:
    with _lock:
        proj = load_project(pid)
        if not proj:
            return None
        proj["name"] = new_name
        _project_path(pid).write_text(
            json.dumps(proj, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        idx = _load_index()
        for it in idx:
            if it.get("id") == pid:
                it["name"] = new_name
                break
        _save_index(idx)
        return _summarize(proj)


def delete_project(pid: str) -> bool:
    """删除工程文件与索引条目，二者任一存在即返回 True。"""
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
    """自动命名：YYYY-MM-DD HH:MM · 12k字 · 文本前 16 字预览"""
    when = when or datetime.now()
    chars = len(text)
    if chars >= 1000:
        size = f"{chars / 1000:.1f}k字"
    else:
        size = f"{chars}字"
    preview = text.strip().replace("\n", " ")[:16]
    suffix = f" · {preview}" if preview else ""
    return f"{when.strftime('%Y-%m-%d %H:%M')} · {size}{suffix}"


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
