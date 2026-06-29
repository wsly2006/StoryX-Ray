// StoryX-Ray 前端逻辑：单页交互、调用后端、渲染结果

const $ = (sel) => document.querySelector(sel);
const CONFIG_KEY = "storyxray.config.v2";
const LEGACY_KEY = "storyxray.config.v1";

const els = {
  text: $("#novel-text"),
  charCount: $("#char-count"),
  backend: $("#backend"),
  model: $("#model"),
  apiKey: $("#api-key"),
  baseUrl: $("#base-url"),
  presetName: $("#preset-name"),
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
  presetList: $("#preset-list"),
  presetAdd: $("#preset-add"),
  presetEmpty: $("#preset-empty"),
  presetFormWrap: $("#preset-form-wrap"),
};

const BACKEND_HINTS = {
  gemini:   { model: "gemini-2.5-flash",  baseUrl: "（无需填写）",                needKey: true,  needBase: false },
  ollama:   { model: "qwen361:latest",    baseUrl: "http://localhost:11434",      needKey: false, needBase: true  },
  deepseek: { model: "deepseek-v4-flash", baseUrl: "https://api.deepseek.com/v1", needKey: true,  needBase: false },
  openai:   { model: "gpt-4o-mini",       baseUrl: "https://api.openai.com/v1",   needKey: true,  needBase: true  },
};
const BACKEND_LABEL = {
  gemini: "Gemini",
  ollama: "Ollama",
  deepseek: "DeepSeek V4",
  openai: "OpenAI 兼容",
};

// 工作配置：包含所有预设和全局参数；弹窗里的列表/表单是它的视图
let workingConfig = loadConfig();
// 弹窗中当前正在编辑的预设 id；null 表示没有可编辑项
let editingId = workingConfig.presets[0]?.id || null;

function genId() {
  // 老浏览器没 crypto.randomUUID，简单回退
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "p-" + Math.random().toString(36).slice(2, 10);
}

function defaultPreset(overrides = {}) {
  return {
    id: genId(),
    name: "默认预设",
    backend: "ollama",
    model: "",
    apiKey: "",
    baseUrl: "",
    ...overrides,
  };
}

function migrateLegacy() {
  // v1: { backend, model, apiKey, baseUrl, passes, charBuffer }
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const old = JSON.parse(raw);
    const preset = defaultPreset({
      name: BACKEND_LABEL[old.backend] || "迁移预设",
      backend: old.backend || "ollama",
      model: old.model || "",
      apiKey: old.apiKey || "",
      baseUrl: old.baseUrl || "",
    });
    return {
      version: 2,
      presets: [preset],
      activeId: preset.id,
      passes: old.passes || 1,
      charBuffer: old.charBuffer || 1500,
    };
  } catch (e) {
    console.warn("迁移旧配置失败", e);
    return null;
  }
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const cfg = JSON.parse(raw);
      if (Array.isArray(cfg.presets) && cfg.presets.length) return cfg;
    }
  } catch (e) {
    console.warn("读取本地配置失败", e);
  }
  // 没 v2 配置：尝试迁移 v1，再不行就建个空白默认
  const migrated = migrateLegacy();
  if (migrated) return migrated;
  const preset = defaultPreset();
  return { version: 2, presets: [preset], activeId: preset.id, passes: 1, charBuffer: 1500 };
}

function saveConfig(cfg) {
  // API Key 也存 localStorage 是个权衡：本地工具方便重启即用；如果担心可改成 sessionStorage
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

function activePreset(cfg = workingConfig) {
  return cfg.presets.find((p) => p.id === cfg.activeId) || cfg.presets[0];
}

function updateConfigSummary() {
  const cfg = workingConfig;
  const preset = activePreset(cfg);
  if (!preset) {
    els.configSummary.textContent = "未配置";
    return;
  }
  const modelText = preset.model || `默认（${BACKEND_HINTS[preset.backend].model}）`;
  els.configSummary.textContent = `${preset.name} · ${BACKEND_LABEL[preset.backend]} · ${modelText}`;
}

function syncBackendFields() {
  const hint = BACKEND_HINTS[els.backend.value];
  els.model.placeholder = `留空使用默认值（${hint.model}）`;
  els.baseUrl.placeholder = `留空使用默认值（${hint.baseUrl}）`;
  els.apiKeyRow.style.display = hint.needKey ? "" : "none";
  els.baseUrlRow.style.display = hint.needBase ? "" : "none";
}

function renderPresetList() {
  const cfg = workingConfig;
  els.presetList.innerHTML = "";
  cfg.presets.forEach((p) => {
    const li = document.createElement("li");
    li.className = "preset-item" + (p.id === editingId ? " editing" : "");
    li.dataset.id = p.id;

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "preset-default";
    radio.checked = p.id === cfg.activeId;
    radio.title = "设为默认";
    radio.addEventListener("click", (e) => {
      e.stopPropagation();
      cfg.activeId = p.id;
      renderPresetList();
    });

    const label = document.createElement("div");
    label.className = "preset-item-label";
    const nameEl = document.createElement("div");
    nameEl.className = "preset-item-name";
    nameEl.textContent = p.name || "(未命名)";
    if (p.id === cfg.activeId) {
      const badge = document.createElement("span");
      badge.className = "preset-item-badge";
      badge.textContent = "默认";
      nameEl.appendChild(badge);
    }
    const metaEl = document.createElement("div");
    metaEl.className = "preset-item-meta";
    metaEl.textContent = `${BACKEND_LABEL[p.backend]} · ${p.model || "默认模型"}`;
    label.appendChild(nameEl);
    label.appendChild(metaEl);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "preset-item-del";
    del.title = "删除该预设";
    del.textContent = "✕";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      removePreset(p.id);
    });

    li.appendChild(radio);
    li.appendChild(label);
    li.appendChild(del);
    li.addEventListener("click", () => selectPreset(p.id));
    els.presetList.appendChild(li);
  });

  // 默认项的删除按钮置灰但仍可点；只剩一条时禁用删除
  els.presetList.querySelectorAll(".preset-item-del").forEach((btn) => {
    btn.disabled = cfg.presets.length <= 1;
  });
}

function selectPreset(id) {
  // 切换编辑目标前，把当前表单内容写回正在编辑的预设，避免切走丢失
  flushFormToPreset();
  editingId = id;
  fillFormFromPreset(id);
  renderPresetList();
}

function addPreset() {
  flushFormToPreset();
  const preset = defaultPreset({ name: `预设 ${workingConfig.presets.length + 1}` });
  workingConfig.presets.push(preset);
  editingId = preset.id;
  fillFormFromPreset(preset.id);
  renderPresetList();
  // 新建后聚焦名称，方便立刻命名
  requestAnimationFrame(() => els.presetName.focus());
}

function removePreset(id) {
  const cfg = workingConfig;
  if (cfg.presets.length <= 1) return;
  const idx = cfg.presets.findIndex((p) => p.id === id);
  if (idx < 0) return;
  cfg.presets.splice(idx, 1);
  // 被删的若是默认，把默认转到第一项
  if (cfg.activeId === id) cfg.activeId = cfg.presets[0].id;
  // 被删的若正在编辑，切到第一项
  if (editingId === id) {
    editingId = cfg.presets[0].id;
    fillFormFromPreset(editingId);
  }
  renderPresetList();
}

function fillFormFromPreset(id) {
  const p = workingConfig.presets.find((x) => x.id === id);
  if (!p) {
    els.presetEmpty.hidden = false;
    els.presetFormWrap.hidden = true;
    return;
  }
  els.presetEmpty.hidden = true;
  els.presetFormWrap.hidden = false;
  els.presetName.value = p.name || "";
  els.backend.value = p.backend;
  els.model.value = p.model || "";
  els.apiKey.value = p.apiKey || "";
  els.baseUrl.value = p.baseUrl || "";
  syncBackendFields();
}

function flushFormToPreset() {
  // 把当前表单值写回 editingId 指向的预设；用于切换/新增/保存前
  if (!editingId) return;
  const p = workingConfig.presets.find((x) => x.id === editingId);
  if (!p) return;
  p.name = els.presetName.value.trim() || "(未命名)";
  p.backend = els.backend.value;
  p.model = els.model.value.trim();
  p.apiKey = els.apiKey.value.trim();
  p.baseUrl = els.baseUrl.value.trim();
}

function openConfigModal() {
  // 打开时若 editingId 失效，重置到默认项
  if (!workingConfig.presets.find((p) => p.id === editingId)) {
    editingId = workingConfig.activeId || workingConfig.presets[0]?.id || null;
  }
  els.passes.value = workingConfig.passes || 1;
  els.charBuffer.value = workingConfig.charBuffer || 1500;
  renderPresetList();
  if (editingId) fillFormFromPreset(editingId);
  els.configModal.hidden = false;
  requestAnimationFrame(() => els.presetName.focus());
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

  const preset = activePreset(workingConfig);
  if (!preset) {
    setStatus("请先在「模型配置」里新增并保存一个预设", "error");
    return;
  }

  const payload = {
    text,
    backend: preset.backend,
    model: preset.model || null,
    api_key: preset.apiKey || null,
    base_url: preset.baseUrl || null,
    extraction_passes: workingConfig.passes || 1,
    max_char_buffer: workingConfig.charBuffer || 1500,
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
els.presetAdd.addEventListener("click", addPreset);

// 表单实时回写：用户在右侧改了字段，左侧列表的名字/概要也即时更新
["input", "change"].forEach((evt) => {
  [els.presetName, els.backend, els.model, els.apiKey, els.baseUrl].forEach((el) => {
    el.addEventListener(evt, () => {
      flushFormToPreset();
      renderPresetList();
    });
  });
});

els.configSave.addEventListener("click", () => {
  flushFormToPreset();
  workingConfig.passes = Number(els.passes.value) || 1;
  workingConfig.charBuffer = Number(els.charBuffer.value) || 1500;
  saveConfig(workingConfig);
  updateConfigSummary();
  closeConfigModal();
  const preset = activePreset(workingConfig);
  setStatus(`已保存：默认预设「${preset.name}」· ${BACKEND_LABEL[preset.backend]}`, "success");
});

els.text.addEventListener("input", () => {
  els.charCount.textContent = els.text.value.length;
});
els.runBtn.addEventListener("click", runExtraction);

// 初始化
updateConfigSummary();
