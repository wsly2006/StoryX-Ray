"""LangExtract 引擎：把现有 lx.extract 逻辑封装在 Extractor 协议下。"""
from __future__ import annotations

import contextlib
import io
import logging
import os
import time
from dataclasses import dataclass
from typing import ClassVar, Literal

import langextract as lx
from langextract import factory as lx_factory
from langextract._storyxray_stats import RunStats
from langextract.factory import ModelConfig

from ..prompts import EXAMPLES, PROMPT_DESCRIPTION, SUMMARY_PROMPT, Example
from .base import Extractor, ExtractionResult


def _parse_summary_output(raw: str) -> str:
    """从 LLM 输出里抠 summary。模型可能加 fence、前后废话或直接给纯文本，都要兜住。"""
    if not raw:
        return ""
    import json
    import re

    # 去掉 ```json ... ``` 或 ``` ... ``` 包裹
    fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", raw, re.DOTALL | re.IGNORECASE)
    if fenced:
        raw = fenced.group(1).strip()

    # 优先按 JSON 解析
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict) and isinstance(obj.get("summary"), str):
            return obj["summary"].strip()
    except (ValueError, TypeError):
        pass

    # 兜底：从任意位置抓一段 JSON 对象出来
    m = re.search(r'\{[^{}]*"summary"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"[^{}]*\}', raw, re.DOTALL)
    if m:
        try:
            # 反转义 \n \" 等
            return json.loads('"' + m.group(1) + '"').strip()
        except (ValueError, TypeError):
            return m.group(1).strip()

    # 全都失败：把原文当纯简介返回，胜过报错
    return raw.strip()


def _to_lx_examples(examples: list[Example]) -> list:
    """把 prompts.py 里的中立 Example 结构翻译成 langextract 的类型。"""
    return [
        lx.data.ExampleData(
            text=ex.text,
            extractions=[
                lx.data.Extraction(
                    extraction_class=e.extraction_class,
                    extraction_text=e.extraction_text,
                    attributes=e.attributes or None,
                )
                for e in ex.extractions
            ],
        )
        for ex in examples
    ]


_LX_EXAMPLES = _to_lx_examples(EXAMPLES)


logger = logging.getLogger("storyxray")


# LangExtract 引擎支持的 LLM 后端
Backend = Literal["gemini", "ollama", "deepseek", "openai"]

# DeepSeek 官方 OpenAI 兼容端点
DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
# DeepSeek 实际可用模型：deepseek-v4-flash / deepseek-v4-pro
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


def _build_model_config(cfg: LangExtractConfig) -> tuple[ModelConfig, bool, bool]:
    """组装 ModelConfig + (use_schema_constraints, fence_output)。"""
    if cfg.backend == "gemini":
        return (
            ModelConfig(
                model_id=cfg.model_id,
                provider_kwargs={"api_key": cfg.api_key} if cfg.api_key else {},
            ),
            False,
            None,
        )

    if cfg.backend == "ollama":
        # 本地模型通常不支持 schema 约束，关掉避免报错；放宽 timeout 给 CPU 推理
        return (
            ModelConfig(
                model_id=cfg.model_id,
                provider_kwargs={
                    "model_url": cfg.base_url or "http://localhost:11434",
                    "timeout": 600,
                },
            ),
            False,
            False,
        )

    if cfg.backend in ("openai", "deepseek"):
        # DeepSeek model_id 以 "deepseek" 开头会被 OLLAMA 正则路由命中，
        # 这里显式锁定 provider 类绕开路由
        provider_kwargs: dict = {"api_key": cfg.api_key}
        if cfg.base_url:
            provider_kwargs["base_url"] = cfg.base_url
        return (
            ModelConfig(
                model_id=cfg.model_id,
                provider="OpenAILanguageModel",
                provider_kwargs=provider_kwargs,
            ),
            False,
            True,
        )

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
        # 自己 create 模型实例：这样能挂 RunStats，每次 LLM 调用都会被记录
        model_cfg, use_schema, fence_output = _build_model_config(cfg)
        model = lx_factory.create_model(
            config=model_cfg,
            examples=_LX_EXAMPLES,
            use_schema_constraints=use_schema,
            fence_output=fence_output,
        )
        stats = RunStats()
        model._run_stats = stats  # provider 内部按 hasattr 检测，无侵入

        sink = writer if writer is not None else io.StringIO()
        t0 = time.monotonic()
        logger.info(
            "[lx-timing] lx.extract 开始: backend=%s model=%s passes=%s buffer=%s",
            cfg.backend, cfg.model_id, cfg.extraction_passes, cfg.max_char_buffer,
        )
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            annotated = lx.extract(
                text_or_documents=text,
                model=model,
                prompt_description=PROMPT_DESCRIPTION,
                examples=_LX_EXAMPLES,
                extraction_passes=cfg.extraction_passes,
                max_workers=cfg.max_workers,
                max_char_buffer=cfg.max_char_buffer,
                # 我们自建 model 时已按后端裁剪 schema 约束，避免 lx 再警告
                use_schema_constraints=False,
                # 打开 tqdm，前端进度条依赖 _ProgressWriter 从 tqdm 输出里解析 n/total；
                # 开头的 banner 会以 log 事件落到进度框日志尾，不影响主进度
                show_progress=True,
            )
        elapsed = time.monotonic() - t0
        summary = stats.summary()
        logger.info(
            "[lx-timing] lx.extract 结束: 总耗时 %.2fs，抽取 %d 条，LLM 调用 %d 次"
            "（输入 %d / 输出 %d / 合计 %d tokens，partial=%s）",
            elapsed, len(annotated.extractions or []),
            summary["calls"], summary["prompt_tokens"],
            summary["completion_tokens"], summary["total_tokens"],
            summary["partial"],
        )
        return ExtractionResult(
            extractions=list(annotated.extractions or []),
            raw=annotated,
            stats={**summary, "elapsed_sec": round(elapsed, 2)},
        )

    def render_html(self, result: ExtractionResult) -> str:
        if result.raw is None:
            return ""
        sink = io.StringIO()
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            html_obj = lx.visualize(result.raw)
        # 装了 IPython 时返回 HTML 对象，否则是字符串
        return getattr(html_obj, "data", html_obj)

    def summarize(self, text: str, cfg: LangExtractConfig) -> tuple[str, dict]:
        """让 LLM 输出小说的一段话综合简介。返回 (简介文本, token 统计)。

        直接调 provider 的 infer，不走 lx.extract：简介是单轮生成，不需要分片。
        provider 默认 JSON 模式，SUMMARY_PROMPT 要求模型返回 {"summary": "..."}，
        这里解析出来即可。
        """
        model_cfg, _, _ = _build_model_config(cfg)
        # 保持各 provider 的默认 JSON 输出（OpenAI/Ollama 都强制），
        # 关掉 fence（我们期望裸 JSON，而非 ```json 包裹）
        model = lx_factory.create_model(
            config=model_cfg,
            examples=[],
            use_schema_constraints=False,
            fence_output=False,
        )
        stats = RunStats()
        model._run_stats = stats

        prompt = SUMMARY_PROMPT.format(text=text)
        sink = io.StringIO()
        t0 = time.monotonic()
        logger.info(
            "[lx-timing] summarize 开始: backend=%s model=%s chars=%d",
            cfg.backend, cfg.model_id, len(text),
        )
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            outputs = list(model.infer([prompt]))
        elapsed = time.monotonic() - t0

        raw_output = ""
        if outputs and outputs[0]:
            first = outputs[0][0]
            raw_output = (getattr(first, "output", None) or "").strip()

        summary_text = _parse_summary_output(raw_output)

        summary_stats = stats.summary()
        summary_stats["elapsed_sec"] = round(elapsed, 2)
        logger.info(
            "[lx-timing] summarize 结束: 耗时 %.2fs，输出 %d 字，tokens=%s",
            elapsed, len(summary_text), summary_stats.get("total_tokens"),
        )
        return summary_text, summary_stats
