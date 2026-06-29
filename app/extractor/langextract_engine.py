"""LangExtract 引擎：把现有 lx.extract 逻辑封装在 Extractor 协议下。"""
from __future__ import annotations

import contextlib
import io
import os
from dataclasses import dataclass
from typing import ClassVar, Literal

import langextract as lx

from ..prompts import EXAMPLES, PROMPT_DESCRIPTION
from .base import Extractor, ExtractionResult


# LangExtract 引擎支持的 LLM 后端
Backend = Literal["gemini", "ollama", "deepseek", "openai"]

# DeepSeek 官方 OpenAI 兼容端点
DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash"


@dataclass
class LangExtractConfig:
    backend: Backend
    model_id: str
    api_key: str | None = None
    base_url: str | None = None
    extraction_passes: int = 1
    max_workers: int = 4
    max_char_buffer: int = 1500


def _build_kwargs(cfg: LangExtractConfig) -> dict:
    common = {
        "prompt_description": PROMPT_DESCRIPTION,
        "examples": EXAMPLES,
        "extraction_passes": cfg.extraction_passes,
        "max_workers": cfg.max_workers,
        "max_char_buffer": cfg.max_char_buffer,
    }

    if cfg.backend == "gemini":
        return {**common, "model_id": cfg.model_id, "api_key": cfg.api_key}

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
            "language_model_params": {"base_url": cfg.base_url},
            "fence_output": True,
            "use_schema_constraints": False,
        }

    raise ValueError(f"未知后端: {cfg.backend}")


class LangExtractEngine(Extractor):
    name: ClassVar[str] = "langextract"

    def build_config(self, backend: str, overrides: dict | None = None) -> LangExtractConfig:
        overrides = overrides or {}

        if backend == "gemini":
            return LangExtractConfig(
                backend="gemini",
                model_id=overrides.get("model") or os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
                api_key=overrides.get("api_key") or os.getenv("GEMINI_API_KEY"),
            )

        if backend == "ollama":
            return LangExtractConfig(
                backend="ollama",
                model_id=overrides.get("model") or os.getenv("OLLAMA_MODEL", "qwen2.5:7b"),
                base_url=overrides.get("base_url") or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
            )

        if backend == "deepseek":
            # 固定走官方 OpenAI 兼容端点，模型默认 v4-flash
            return LangExtractConfig(
                backend="deepseek",
                model_id=overrides.get("model") or os.getenv("DEEPSEEK_MODEL", DEEPSEEK_DEFAULT_MODEL),
                api_key=overrides.get("api_key") or os.getenv("DEEPSEEK_API_KEY"),
                base_url=overrides.get("base_url") or os.getenv("DEEPSEEK_BASE_URL", DEEPSEEK_BASE_URL),
            )

        if backend == "openai":
            return LangExtractConfig(
                backend="openai",
                model_id=overrides.get("model") or os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
                api_key=overrides.get("api_key") or os.getenv("OPENAI_API_KEY"),
                base_url=overrides.get("base_url") or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            )

        raise ValueError(f"未知后端: {backend}")

    def extract(self, text: str, cfg: LangExtractConfig, writer=None) -> ExtractionResult:
        kwargs = _build_kwargs(cfg)
        # writer 为空时丢弃，避免 Windows GBK 终端因 ✓ 等字符编码失败
        sink = writer if writer is not None else io.StringIO()
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            annotated = lx.extract(text_or_documents=text, **kwargs)
        return ExtractionResult(extractions=list(annotated.extractions or []), raw=annotated)

    def render_html(self, result: ExtractionResult) -> str:
        if result.raw is None:
            return ""
        sink = io.StringIO()
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            html_obj = lx.visualize(result.raw)
        # 装了 IPython 时返回 HTML 对象，否则是字符串
        return getattr(html_obj, "data", html_obj)
