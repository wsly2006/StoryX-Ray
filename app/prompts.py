"""人物关系抽取的 prompt 与 few-shot 示例。

示例结构故意用引擎无关的原生 dict/dataclass 表达，避免把 langextract 类型
从这里泄漏出去。未来接自研引擎时，各自的 engine 负责把 EXAMPLES 转成引擎
需要的对象。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


PROMPT_DESCRIPTION = """\
你是一个小说人物关系抽取助手。请从给定的中文小说文本中抽取以下三类信息：

1. character（人物）：文本中出现的人物，使用其在文中最完整的称呼。
2. relationship（人物关系）：两个人物之间的明确关系，extraction_text 是描述关系的原文片段，
   属性中必须给出 person_a、person_b、relation（如 父子、师徒、夫妻、上下级、敌对 等）。
3. event（关键事件）：推动剧情或揭示关系的事件，extraction_text 是事件原文片段，
   属性中给出 participants（涉及人物列表）与 summary（一句话概括）。

要求：
- 严格使用文本中的原始片段作为 extraction_text，不要改写或合并。
- 抽取顺序按其在原文中出现的顺序。
- 不确定的关系不要编造，宁缺毋滥。
"""


@dataclass
class ExampleExtraction:
    """一条抽取样本；对应 langextract 里的 Extraction，但不依赖它。"""
    extraction_class: str
    extraction_text: str
    attributes: dict[str, Any] = field(default_factory=dict)


@dataclass
class Example:
    """一条 few-shot 样本：原文 + 一组抽取。"""
    text: str
    extractions: list[ExampleExtraction] = field(default_factory=list)


EXAMPLES: list[Example] = [
    Example(
        text=(
            "贾母年高，最是怜爱小儿女的，因见宝玉与黛玉日则同行同坐，夜则同息同止，"
            "言和意顺，略无参商，故而对黛玉视如己出。宝玉笑道：「林妹妹，你别恼我。」"
        ),
        extractions=[
            ExampleExtraction(extraction_class="character", extraction_text="贾母"),
            ExampleExtraction(extraction_class="character", extraction_text="宝玉"),
            ExampleExtraction(extraction_class="character", extraction_text="黛玉"),
            ExampleExtraction(
                extraction_class="relationship",
                extraction_text="对黛玉视如己出",
                attributes={
                    "person_a": "贾母",
                    "person_b": "黛玉",
                    "relation": "外祖母与外孙女（视如己出）",
                },
            ),
            ExampleExtraction(
                extraction_class="relationship",
                extraction_text="日则同行同坐，夜则同息同止",
                attributes={
                    "person_a": "宝玉",
                    "person_b": "黛玉",
                    "relation": "青梅竹马",
                },
            ),
            ExampleExtraction(
                extraction_class="event",
                extraction_text="宝玉笑道：「林妹妹，你别恼我。」",
                attributes={
                    "participants": ["宝玉", "黛玉"],
                    "summary": "宝玉向黛玉示好赔笑",
                },
            ),
        ],
    ),
]
