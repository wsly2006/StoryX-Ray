"""Pydantic 模型：API 请求/响应结构。"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


Backend = Literal["gemini", "ollama", "deepseek", "openai"]


class ExtractRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=200_000, description="待抽取的小说原文")
    backend: Backend = Field(..., description="LLM 后端")
    model: str | None = Field(default=None, description="模型 ID，留空走环境变量默认值")
    api_key: str | None = Field(default=None, description="API Key，留空走环境变量")
    base_url: str | None = Field(default=None, description="自定义 base_url（Ollama/OpenAI 兼容）")
    extraction_passes: int = Field(default=1, ge=1, le=5, description="多轮抽取次数，提高召回")
    max_char_buffer: int = Field(default=1500, ge=200, le=8000, description="单次请求的最大字符窗口")


class Extraction(BaseModel):
    extraction_class: str
    extraction_text: str
    attributes: dict[str, Any] | None = None
    char_interval: dict[str, Any] | None = None


class ExtractResponse(BaseModel):
    extractions: list[Extraction]
    html: str
    characters: list[str]
    relationships: list[dict[str, Any]]
    events: list[dict[str, Any]]
