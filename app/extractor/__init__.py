"""抽取引擎注册表与对外门面。

外部代码只需要：
    from app.extractor import get_extractor, ExtractionResult
    engine = get_extractor()                  # 默认引擎
    cfg = engine.build_config(backend, ...)
    result = engine.extract(text, cfg, writer=...)
    html = engine.render_html(result)
"""
from __future__ import annotations

from .base import Extractor, ExtractionResult
from .langextract_engine import LangExtractEngine


_REGISTRY: dict[str, Extractor] = {}


def register(engine: Extractor) -> None:
    _REGISTRY[engine.name] = engine


def get_extractor(name: str | None = None) -> Extractor:
    """按名取引擎；不传名走默认（当前只有一个）。"""
    if name is None:
        return next(iter(_REGISTRY.values()))
    try:
        return _REGISTRY[name]
    except KeyError as exc:
        raise ValueError(f"未知抽取引擎: {name}") from exc


register(LangExtractEngine())


__all__ = ["Extractor", "ExtractionResult", "get_extractor", "register"]
