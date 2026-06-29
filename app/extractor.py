"""LangExtract 抽取封装，支持多种后端切换。

后端区分：
- gemini   : 走官方 Gemini API
- ollama   : 走本地 Ollama，无需 API Key
- deepseek : DeepSeek V4 预设（走 OpenAI 兼容协议，默认 deepseek-v4-flash）
- openai   : OpenAI 兼容协议通用入口（Kimi/智谱/自部署 等，需手填 base_url）
"""
from __future__ import annotations

import contextlib
import io
import os
from dataclasses import dataclass
from typing import Literal

import langextract as lx

from .prompts import EXAMPLES, PROMPT_DESCRIPTION


Backend = Literal["gemini", "ollama", "deepseek", "openai"]

# DeepSeek 官方 OpenAI 兼容端点
DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash"


@dataclass
class ExtractConfig:
    backend: Backend
    model_id: str
    api_key: str | None = None
    base_url: str | None = None
    extraction_passes: int = 1
    max_workers: int = 4
    max_char_buffer: int = 1500


def _build_kwargs(cfg: ExtractConfig) -> dict:
    """根据后端组装 lx.extract 的参数。"""
    common = {
        "prompt_description": PROMPT_DESCRIPTION,
        "examples": EXAMPLES,
        "extraction_passes": cfg.extraction_passes,
        "max_workers": cfg.max_workers,
        "max_char_buffer": cfg.max_char_buffer,
    }

    if cfg.backend == "gemini":
        return {
            **common,
            "model_id": cfg.model_id,
            "api_key": cfg.api_key,
        }

    if cfg.backend == "ollama":
        # 本地模型通常不支持 schema 约束，关掉避免报错
        return {
            **common,
            "model_id": cfg.model_id,
            "model_url": cfg.base_url or "http://localhost:11434",
            "fence_output": False,
            "use_schema_constraints": False,
        }

    if cfg.backend in ("openai", "deepseek"):
        # 两者都走 OpenAI 兼容协议，deepseek 仅是 base_url 预设
        return {
            **common,
            "model_id": cfg.model_id,
            "api_key": cfg.api_key,
            "language_model_params": {
                "base_url": cfg.base_url,
            },
            "fence_output": True,
            "use_schema_constraints": False,
        }

    raise ValueError(f"未知后端: {cfg.backend}")


def run_extraction(text: str, cfg: ExtractConfig, writer=None):
    """执行抽取，返回 AnnotatedDocument。

    writer：可选的 file-like，把 langextract 的 stdout/stderr 重定向到这里。
    默认仍然丢弃，给老调用方保留原行为；SSE 路径会传一个解析进度的 writer 进来。
    """
    kwargs = _build_kwargs(cfg)
    sink = writer if writer is not None else io.StringIO()
    with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        return lx.extract(text_or_documents=text, **kwargs)


def render_html(annotated) -> str:
    """把抽取结果渲染成 LangExtract 原生高亮 HTML。

    lx.visualize 直接接受 AnnotatedDocument，绕过 jsonl 写文件那一步。
    它内部也会向 stdout/stderr 打印进度，一并吞掉。
    """
    sink = io.StringIO()
    with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        html_obj = lx.visualize(annotated)
    # 装了 IPython 时返回 HTML 对象，否则是字符串
    return getattr(html_obj, "data", html_obj)


def build_config_from_env(backend: Backend, overrides: dict | None = None) -> ExtractConfig:
    """从环境变量构建配置，UI 传入的 overrides 优先。"""
    overrides = overrides or {}

    if backend == "gemini":
        return ExtractConfig(
            backend="gemini",
            model_id=overrides.get("model") or os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
            api_key=overrides.get("api_key") or os.getenv("GEMINI_API_KEY"),
        )

    if backend == "ollama":
        return ExtractConfig(
            backend="ollama",
            model_id=overrides.get("model") or os.getenv("OLLAMA_MODEL", "qwen2.5:7b"),
            base_url=overrides.get("base_url") or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
        )

    if backend == "deepseek":
        # DeepSeek V4：固定走官方 OpenAI 兼容端点，模型默认 v4-flash
        return ExtractConfig(
            backend="deepseek",
            model_id=overrides.get("model") or os.getenv("DEEPSEEK_MODEL", DEEPSEEK_DEFAULT_MODEL),
            api_key=overrides.get("api_key") or os.getenv("DEEPSEEK_API_KEY"),
            base_url=overrides.get("base_url") or os.getenv("DEEPSEEK_BASE_URL", DEEPSEEK_BASE_URL),
        )

    if backend == "openai":
        return ExtractConfig(
            backend="openai",
            model_id=overrides.get("model") or os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            api_key=overrides.get("api_key") or os.getenv("OPENAI_API_KEY"),
            base_url=overrides.get("base_url") or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        )

    raise ValueError(f"未知后端: {backend}")
