# StoryX-Ray

> 小说人物关系与剧情结构抽取工具。
> 粘贴一段中文小说，自动识别 **人物 / 关系 / 关键事件**，并把抽取结果对应回原文高亮展示。

## 功能

- 📖 **结构化抽取**：人物、二元关系（含关系类型）、关键事件
- 🎯 **原文溯源**：每条抽取都能定位回原文片段，HTML 高亮展示
- 🔌 **多后端可切换**：
  - Gemini API
  - Ollama 本地模型（无需密钥，离线可用）
  - **DeepSeek V4**（`deepseek-v4-flash` / `deepseek-v4-pro`，国内访问友好，价格便宜）
  - OpenAI 兼容接口（Kimi / 智谱 / 自部署 等通用入口）
- 🧪 **可调参数**：抽取轮数、窗口字符数，便于在召回与速度间权衡

## 目录结构

```
StoryX-Ray/
├── app/
│   ├── main.py          # FastAPI 入口
│   ├── extractor.py     # 抽取引擎与多后端封装
│   ├── prompts.py       # Prompt 与 few-shot 示例
│   ├── schemas.py       # 请求/响应模型
│   └── static/          # 前端单页（HTML/CSS/JS）
├── run.bat              # Windows 一键启动
├── run.sh               # macOS/Linux 一键启动
├── requirements.txt
├── .env.example
└── README.md
```

## 快速开始

### 方式 A：一键启动（推荐）

仓库根目录提供了跨平台启动脚本，首次运行会自动完成 **建虚拟环境 → 装依赖 → 从模板生成 `.env` → 起服务 → 打开浏览器** 全流程。

- **Windows**：双击 [run.bat](./run.bat)，或在终端执行 `run.bat`
- **macOS / Linux**：`./run.sh`（或 `bash run.sh`）

首跑时脚本会在检测不到 `.env` 后自动打开编辑器，填好你所用后端的 API Key 保存即可。之后每次运行都会秒开服务。

> 脚本默认监听 `127.0.0.1:8765`，改端口直接编辑 `run.bat` / `run.sh` 末尾的 `--port` 即可。

### 方式 B：手动启动

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate      # macOS/Linux
pip install -r requirements.txt

cp .env.example .env            # 按需填写 API Key
uvicorn app.main:app --host 127.0.0.1 --port 8765 --reload
```

### 配置密钥

`.env` 里按所用后端填写即可（UI 侧也支持临时覆盖，不落盘）：

```bash
EXTRACT_BACKEND=deepseek
DEEPSEEK_API_KEY=你的密钥
```

| 后端 | 必填项 | 默认模型 | 说明 |
|---|---|---|---|
| `gemini` | `GEMINI_API_KEY` | `gemini-2.5-flash` | Google 官方 API |
| `ollama` | 本地已运行 Ollama | `qwen2.5:7b` | 默认 `http://localhost:11434` |
| `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-v4-flash` | DeepSeek V4，性价比最高；如需更强可换 `deepseek-v4-pro` |
| `openai` | `OPENAI_API_KEY`、`OPENAI_BASE_URL` | `gpt-4o-mini` | Kimi / 智谱 / 自部署 等通用入口 |

服务起来后打开 <http://127.0.0.1:8765> 即可使用。

> ⚠️ **仅供本机使用**：本服务默认无鉴权、无频率限制，请勿监听 `0.0.0.0` 或暴露到公网。
> API Key 会保存在浏览器 `localStorage`，请勿在公共/共享机器上填写。

## 使用建议

- 第一次试跑用 1000–3000 字的片段，确认配置无误后再加大文本
- 对长文本，提高「抽取轮数」可以提升召回但会成倍增加调用次数
- 本地 Ollama 推荐 `qwen2.5:7b` 或更大模型，过小的模型对中文人物关系识别不稳

## API

```http
POST /api/extract
Content-Type: application/json

{
  "text": "……小说原文……",
  "backend": "gemini",
  "model": null,
  "api_key": null,
  "base_url": null,
  "extraction_passes": 1,
  "max_char_buffer": 1500
}
```

返回 `extractions`（详细抽取记录）、`characters`、`relationships`、`events` 与 `html`（高亮视图）。

## 路线图

- [ ] 长篇小说分章节流式抽取
- [ ] 关系网络图可视化（pyvis / d3）
- [ ] 多文档对齐：跨章节的人物消歧
- [ ] 导出为 GraphML / Neo4j Cypher

## 许可

本项目采用 **MIT** 许可，详见 [LICENSE](./LICENSE)。

### 第三方组件

`third_party/langextract/` 是 Google [langextract](https://github.com/google/langextract) 的源码副本，采用 **Apache-2.0** 许可，已按需修改。
- 许可全文：[third_party/langextract/LICENSE](./third_party/langextract/LICENSE)
- 修改说明：[third_party/langextract/MODIFICATIONS.md](./third_party/langextract/MODIFICATIONS.md)
- 概要：见根目录 [NOTICE](./NOTICE)
