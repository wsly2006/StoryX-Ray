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
    preset_name: str | None = Field(default=None, description="预设名，用于保存到工程历史")
    extraction_passes: int = Field(default=1, ge=1, le=5, description="多轮抽取次数，提高召回")
    max_char_buffer: int = Field(default=1500, ge=200, le=8000, description="单次请求的最大字符窗口")
    # 抽取完成后若带 project_id + chapter_id，服务端会把结果自动写回该章节
    project_id: str | None = Field(default=None, description="目标工程 id，仅用于抽取结果落盘")
    chapter_id: str | None = Field(default=None, description="目标章节 id，仅用于抽取结果落盘")


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


class RenameRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)


class SummarizeRequest(BaseModel):
    """生成简介的请求。复用抽取的后端/模型/密钥配置，简介和抽取共享一套预设。"""
    text: str = Field(..., min_length=1, max_length=200_000, description="待生成简介的小说原文")
    backend: Backend = Field(..., description="LLM 后端")
    model: str | None = Field(default=None)
    api_key: str | None = Field(default=None)
    base_url: str | None = Field(default=None)
    # 简介生成完成后可自动写回指定章节
    project_id: str | None = Field(default=None)
    chapter_id: str | None = Field(default=None)


class SummarizeResponse(BaseModel):
    summary: str
    # 用来给顶栏用量统计累加：一次简介调用大概几百 token，可忽略但不遗漏
    stats: dict[str, Any] = Field(default_factory=dict)


class ChapterDraft(BaseModel):
    """创建工程时的章节草稿：只需标题和原文，其他字段服务端补。"""
    title: str = Field(default="", max_length=200)
    text: str = Field(..., min_length=1, max_length=200_000)


class CreateProjectRequest(BaseModel):
    """新建工程：只有骨架（名字 + 章节列表），没有抽取结果。"""
    name: str = Field(default="", max_length=200, description="留空走自动命名")
    chapters: list[ChapterDraft] = Field(..., min_length=1, max_length=500)
    preset_snapshot: dict[str, Any] = Field(default_factory=dict)
    passes: int = Field(default=1, ge=1, le=5)
    char_buffer: int = Field(default=1500, ge=200, le=8000)
