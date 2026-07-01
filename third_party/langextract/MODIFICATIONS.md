# Modifications to vendored langextract

This directory is a vendored copy of Google's langextract, licensed under
Apache License 2.0. Per Section 4(b) of the license, this file describes the
changes made after copying from upstream.

- Upstream: https://github.com/google/langextract
- Vendored from local checkout: `D:/GitHome/fromgithub/langextract/` (as of 2026-06-30)
- All modifications preserve the original copyright headers.

## Changed files

Every insertion is marked in the source with a comment starting with
`# storyxray 插桩` so upstream rebases can locate them mechanically.

### `_storyxray_stats.py` (new)

New module providing `RunStats` — a thread-safe container that accumulates
per-LLM-call statistics (token counts and elapsed time) for one extraction
run. Not part of upstream.

### `annotation.py`

Wraps the inner loop of `_annotate_documents_single_pass` with timing logs:
- `[lx-timing] batch=N infer 完成: <n> 个 prompt 耗时 <t>s`
- `[lx-timing] batch=N 后处理完成: resolve=<r>ms align=<a>ms 总=<t>s`

These emit to the `storyxray` logger. No behavioral change; timing only.

### `providers/openai.py`

`_process_single_prompt` records each `chat.completions.create()` call into
`self._run_stats` (an optional attribute injected by the caller). Extracts
`response.usage.prompt_tokens / completion_tokens / total_tokens` and
elapsed wall time.

### `providers/ollama.py`

`infer` records each HTTP call. Uses Ollama-specific fields
`prompt_eval_count` (input tokens) and `eval_count` (output tokens).

### `providers/gemini.py`

`_process_single_prompt` records each `generate_content()` call. Uses Gemini's
`response.usage_metadata.prompt_token_count / candidates_token_count /
total_token_count`.

## Rationale

Instrumenting inside the provider avoids monkey-patching a pip dependency
and gives a stable seam for future modifications (streaming responses,
alternative alignment algorithms, etc.).
