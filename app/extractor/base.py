"""抽取引擎的统一协议。

后期会有多种抽取实现（LLM、规则、图模型 等），都遵循这套协议：
build_config 把 UI/env 输入归一成引擎自己的配置；extract 跑抽取；
render_html 把结果渲染成可视化 HTML。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, ClassVar


@dataclass
class ExtractionResult:
    """引擎返回结果的统一容器。

    extractions：用于业务汇总的抽取记录列表，元素需具备
        extraction_class / extraction_text / attributes / char_interval 字段。
    raw：引擎内部对象，仅传给同一引擎的 render_html，外层不读。
    stats：可选的运行统计，结构形如
        {"calls": int, "prompt_tokens": int, "completion_tokens": int,
         "total_tokens": int, "partial": bool, "elapsed_ms_sum": float,
         "elapsed_ms_max": float}
    不支持统计的引擎留空 dict。
    """
    extractions: list = field(default_factory=list)
    raw: Any = None
    stats: dict = field(default_factory=dict)


class Extractor(ABC):
    """抽取引擎协议。

    name：注册表键，唯一标识一个引擎。
    """
    name: ClassVar[str]

    @abstractmethod
    def build_config(self, backend: str, overrides: dict | None = None):
        """从 env + UI overrides 组装引擎自己的配置对象。

        config 是引擎私有结构，外层只负责透传 extraction_passes / max_char_buffer 等
        引擎本身约定的可调字段。
        """

    @abstractmethod
    def extract(self, text: str, cfg, writer=None) -> ExtractionResult:
        """执行抽取。writer 是可选 file-like，用于把内部进度流接出去。"""

    @abstractmethod
    def render_html(self, result: ExtractionResult) -> str:
        """把结果渲染成原文高亮 HTML；不支持时返回空串。"""
