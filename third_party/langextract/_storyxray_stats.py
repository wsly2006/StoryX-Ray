"""抽取一次运行的统计：每次 LLM 调用的 token 数与耗时。

设计为 thread-safe，OpenAI provider 用线程池并发跑 chunk，所以 record 必须加锁。
按运行（一次 lx.extract）创建一个实例，挂到 language model 上 (`model._run_stats`)，
provider 内部插桩点检测到属性就把 usage 写进来。运行结束后由调用方读 `summary()`。
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field


@dataclass
class LlmCall:
    """单次 LLM 调用的统计。tokens 字段任意可能为 None：本地模型/未返回 usage 时。"""

    elapsed_ms: float
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    # 后端标识，方便区分多模型混跑（目前一次抽取只用一个，预留）
    backend: str | None = None
    model: str | None = None


@dataclass
class RunStats:
    """一次抽取所有 LLM 调用的累加。"""

    calls: list[LlmCall] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    started_at: float = field(default_factory=time.monotonic)

    def record(self, call: LlmCall) -> None:
        with self._lock:
            self.calls.append(call)

    def summary(self) -> dict:
        """聚合成前端可消费的字段。total 仅在所有调用都有 usage 时才有意义。"""
        with self._lock:
            calls = list(self.calls)
        prompt = sum((c.prompt_tokens or 0) for c in calls)
        completion = sum((c.completion_tokens or 0) for c in calls)
        total = sum((c.total_tokens or 0) for c in calls)
        # 有任一调用没拿到 usage 就标 partial=True，前端可以打个问号
        partial = any(c.total_tokens is None for c in calls)
        return {
            "calls": len(calls),
            "prompt_tokens": prompt,
            "completion_tokens": completion,
            "total_tokens": total,
            "partial": partial,
            "elapsed_ms_sum": sum(c.elapsed_ms for c in calls),
            "elapsed_ms_max": max((c.elapsed_ms for c in calls), default=0.0),
        }
