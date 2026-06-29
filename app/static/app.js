// StoryX-Ray 前端逻辑：单页交互、调用后端、渲染结果

const $ = (sel) => document.querySelector(sel);
const CONFIG_KEY = "storyxray.config.v1";

const els = {
  text: $("#novel-text"),
  charCount: $("#char-count"),
  backend: $("#backend"),
  model: $("#model"),
  apiKey: $("#api-key"),
  baseUrl: $("#base-url"),
  apiKeyRow: $("#api-key-row"),
  baseUrlRow: $("#base-url-row"),
  passes: $("#passes"),
  charBuffer: $("#char-buffer"),
  runBtn: $("#run-btn"),
  status: $("#status"),
  htmlWrap: $("#html-frame-wrap"),
  charactersList: $("#characters-list"),
  relationsBody: $("#relations-body"),
  eventsBody: $("#events-body"),
  configBtn: $("#open-config"),
  configSummary: $("#config-summary"),
  configModal: $("#config-modal"),
  configSave: $("#config-save"),
};

// 各后端的占位提示与字段可见性
const BACKEND_HINTS = {
  gemini:   { model: "gemini-2.5-flash",  baseUrl: "（无需填写）",               needKey: true,  needBase: false },
  ollama:   { model: "qwen361:latest",    baseUrl: "http://localhost:11434",     needKey: false, needBase: true  },
  deepseek: { model: "deepseek-v4-flash", baseUrl: "https://api.deepseek.com/v1", needKey: true,  needBase: false },
  openai:   { model: "gpt-4o-mini",       baseUrl: "https://api.openai.com/v1",  needKey: true,  needBase: true  },
};
const BACKEND_LABEL = {
  gemini: "Gemini",
  ollama: "Ollama",
  deepseek: "DeepSeek V4",
  openai: "OpenAI 兼容",
};

// 内存里的当前配置，弹窗里的输入框是它的视图
let currentConfig = loadConfig();

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("读取本地配置失败", e);
  }
  return { backend: "ollama", model: "", apiKey: "", baseUrl: "", passes: 1, charBuffer: 1500 };
}

function saveConfig(cfg) {
  // API Key 也存 localStorage 是个权衡：本地工具方便重启即用；如果担心可改成 sessionStorage
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

function updateConfigSummary() {
  const cfg = currentConfig;
  const modelText = cfg.model || `默认（${BACKEND_HINTS[cfg.backend].model}）`;
  els.configSummary.textContent = `${BACKEND_LABEL[cfg.backend]} · ${modelText}`;
}

function syncBackendFields() {
  const hint = BACKEND_HINTS[els.backend.value];
  els.model.placeholder = `留空使用默认值（${hint.model}）`;
  els.baseUrl.placeholder = `留空使用默认值（${hint.baseUrl}）`;
  els.apiKeyRow.style.display = hint.needKey ? "" : "none";
  els.baseUrlRow.style.display = hint.needBase ? "" : "none";
}

function fillFormFromConfig() {
  const cfg = currentConfig;
  els.backend.value = cfg.backend;
  els.model.value = cfg.model || "";
  els.apiKey.value = cfg.apiKey || "";
  els.baseUrl.value = cfg.baseUrl || "";
  els.passes.value = cfg.passes || 1;
  els.charBuffer.value = cfg.charBuffer || 1500;
  syncBackendFields();
}

function readFormToConfig() {
  return {
    backend: els.backend.value,
    model: els.model.value.trim(),
    apiKey: els.apiKey.value.trim(),
    baseUrl: els.baseUrl.value.trim(),
    passes: Number(els.passes.value) || 1,
    charBuffer: Number(els.charBuffer.value) || 1500,
  };
}

function openConfigModal() {
  fillFormFromConfig();
  els.configModal.hidden = false;
  // 等一帧再聚焦，避免动画期间抢焦点
  requestAnimationFrame(() => els.backend.focus());
}

function closeConfigModal() {
  els.configModal.hidden = true;
}

function setStatus(msg, kind = "") {
  els.status.textContent = msg || "";
  els.status.className = `status ${kind}`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderCharacters(names) {
  if (!names.length) {
    els.charactersList.innerHTML = `<p class="empty-tip">未识别到人物。</p>`;
    return;
  }
  els.charactersList.innerHTML = names
    .map((n) => `<span class="chip">${escapeHtml(n)}</span>`)
    .join("");
}

function renderRelations(rels) {
  if (!rels.length) {
    els.relationsBody.innerHTML = `<tr><td colspan="4" class="empty-tip">未识别到关系。</td></tr>`;
    return;
  }
  els.relationsBody.innerHTML = rels
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(r.person_a)}</td>
        <td>${escapeHtml(r.person_b)}</td>
        <td>${escapeHtml(r.relation)}</td>
        <td class="evidence">${escapeHtml(r.evidence)}</td>
      </tr>`
    )
    .join("");
}

function renderEvents(events) {
  if (!events.length) {
    els.eventsBody.innerHTML = `<tr><td colspan="3" class="empty-tip">未识别到事件。</td></tr>`;
    return;
  }
  els.eventsBody.innerHTML = events
    .map(
      (e) => `
      <tr>
        <td>${escapeHtml((e.participants || []).join("、"))}</td>
        <td>${escapeHtml(e.summary)}</td>
        <td class="evidence">${escapeHtml(e.evidence)}</td>
      </tr>`
    )
    .join("");
}

function renderHtmlHighlight(html) {
  if (!html) {
    els.htmlWrap.innerHTML = `<p class="empty-tip">本次未生成高亮视图。</p>`;
    return;
  }
  // LangExtract 渲染的 HTML 自带样式与 JS，用 iframe 隔离避免污染主页面
  // 注意：sandbox 不能同时开 allow-scripts 和 allow-same-origin——iframe 可借此移除自身 sandbox
  els.htmlWrap.innerHTML = "";
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  els.htmlWrap.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
}

async function runExtraction() {
  const text = els.text.value.trim();
  if (!text) {
    setStatus("请先粘贴小说文本", "error");
    return;
  }

  const cfg = currentConfig;
  const payload = {
    text,
    backend: cfg.backend,
    model: cfg.model || null,
    api_key: cfg.apiKey || null,
    base_url: cfg.baseUrl || null,
    extraction_passes: cfg.passes || 1,
    max_char_buffer: cfg.charBuffer || 1500,
  };

  els.runBtn.disabled = true;
  setStatus("正在调用 LLM 抽取……视模型与文本长度可能需要数十秒", "loading");

  try {
    const resp = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    renderHtmlHighlight(data.html);
    renderCharacters(data.characters || []);
    renderRelations(data.relationships || []);
    renderEvents(data.events || []);

    setStatus(
      `完成：人物 ${data.characters.length} 个，关系 ${data.relationships.length} 条，事件 ${data.events.length} 条`,
      "success"
    );
  } catch (err) {
    console.error(err);
    setStatus(`抽取失败：${err.message}`, "error");
  } finally {
    els.runBtn.disabled = false;
  }
}

// Tab 切换
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $("#tab-" + btn.dataset.tab).classList.add("active");
  });
});

// 弹窗交互
els.configBtn.addEventListener("click", openConfigModal);
els.configModal.querySelectorAll("[data-close]").forEach((el) => {
  el.addEventListener("click", closeConfigModal);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.configModal.hidden) closeConfigModal();
});
els.backend.addEventListener("change", syncBackendFields);
els.configSave.addEventListener("click", () => {
  currentConfig = readFormToConfig();
  saveConfig(currentConfig);
  updateConfigSummary();
  closeConfigModal();
  setStatus(`已保存：${BACKEND_LABEL[currentConfig.backend]} · ${currentConfig.model || "默认模型"}`, "success");
});

els.text.addEventListener("input", () => {
  els.charCount.textContent = els.text.value.length;
});
els.runBtn.addEventListener("click", runExtraction);

// 初始化
updateConfigSummary();
