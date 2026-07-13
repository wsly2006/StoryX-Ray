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
  saveBar: $("#save-bar"),
  saveBtn: $("#save-btn"),
  progress: $("#progress"),
  progressBar: $("#progress-bar"),
  progressText: $("#progress-text"),
  progressLog: $("#progress-log"),
  htmlWrap: $("#html-frame-wrap"),
  charactersList: $("#characters-list"),
  relationsBody: $("#relations-body"),
  eventsBody: $("#events-body"),
  uploadBtn: $("#upload-btn"),
  uploadInput: $("#upload-input"),
  summaryBtn: $("#summary-btn"),
  summaryStatus: $("#summary-status"),
  summaryContent: $("#summary-content"),
  configBtn: $("#open-config"),
  configSummary: $("#config-summary"),
  configModal: $("#config-modal"),
  configSave: $("#config-save"),
  presetList: $("#preset-list"),
  presetAdd: $("#preset-add"),
  presetEmpty: $("#preset-empty"),
  presetFormWrap: $("#preset-form-wrap"),
  historyBtn: $("#open-history"),
  historyModal: $("#history-modal"),
  historyList: $("#history-list"),
  historyEmpty: $("#history-empty"),
  historySummary: $("#history-summary"),
  statsBtn: $("#open-stats"),
  statsModal: $("#stats-modal"),
  statsSummary: $("#stats-summary"),
  statsTotal: $("#stats-total"),
  statsByBackend: $("#stats-by-backend"),
  statsRecent: $("#stats-recent"),
  statsEmpty: $("#stats-empty"),
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

function showProgress(show) {
  els.progress.hidden = !show;
  if (!show) {
    els.progressBar.style.width = "0%";
    els.progressText.textContent = "";
    els.progressLog.textContent = "";
  }
}

function setProgress(current, total, hint = "") {
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  els.progressBar.style.width = pct + "%";
  els.progressText.textContent = hint
    ? `${pct}% · ${current}/${total} · ${hint}`
    : `${pct}% · ${current}/${total}`;
}

function appendProgressLog(line) {
  // 只留最近 6 行，避免越堆越长
  const prev = els.progressLog.textContent.split("\n").filter(Boolean);
  prev.push(line);
  els.progressLog.textContent = prev.slice(-6).join("\n");
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

// ---------- 简介 ----------
// 当前面板显示的简介文本；点保存时会一并落进草稿
let currentSummary = "";

function renderSummary(text) {
  currentSummary = text || "";
  if (!currentSummary) {
    els.summaryContent.classList.add("empty");
    els.summaryContent.innerHTML = `<p class="empty-tip">抽取完成后，点击「生成简介」让 LLM 输出 150-300 字的综合简介。</p>`;
    els.summaryBtn.textContent = "生成简介";
    return;
  }
  els.summaryContent.classList.remove("empty");
  els.summaryContent.textContent = currentSummary;
  els.summaryBtn.disabled = false;
  els.summaryBtn.textContent = "重新生成";
}

function setSummaryStatus(msg, kind = "") {
  els.summaryStatus.textContent = msg || "";
  els.summaryStatus.className = `summary-status ${kind}`;
}

async function runSummary({ silent = false } = {}) {
  // 优先当前章节的原文（章节页），其次草稿里最近一次抽取的输入
  const chapter = typeof getCurrentChapter === "function" ? getCurrentChapter() : null;
  const text = (chapter?.text || draftPayload?.text || "").trim();
  if (!text) {
    setSummaryStatus("请先抽取或粘贴文本", "error");
    return;
  }
  const preset = activePreset(workingConfig);
  if (!preset) {
    setSummaryStatus("请先在「模型配置」里保存一个预设", "error");
    return;
  }

  els.summaryBtn.disabled = true;
  els.summaryBtn.textContent = "生成中…";
  setSummaryStatus(silent ? "抽取完成，正在自动生成简介…" : "调用 LLM 生成简介…", "loading");

  try {
    const resp = await fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        backend: preset.backend,
        model: preset.model || null,
        api_key: preset.apiKey || null,
        base_url: preset.baseUrl || null,
        // 章节页把简介也交给后端按 pid/cid 落盘，起始页 case 二者为空后端会跳过
        project_id: currentPid || null,
        chapter_id: currentCid || null,
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    renderSummary(data.summary || "");
    // 若当前有草稿（刚抽取完还未保存），把简介塞回草稿，保存时一起落盘
    if (draftPayload) draftPayload.summary = data.summary || "";
    const s = data.stats || {};
    const tokenBit = s.total_tokens ? ` · ${s.total_tokens} tokens${s.partial ? "?" : ""}` : "";
    setSummaryStatus(`已生成（${data.summary.length} 字${tokenBit}）`, "success");
  } catch (err) {
    console.error(err);
    setSummaryStatus(`生成失败：${err.message}`, "error");
  } finally {
    els.summaryBtn.disabled = false;
    els.summaryBtn.textContent = currentSummary ? "重新生成" : "生成简介";
  }
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

// ---------- 关系图（ECharts graph）----------
let graphChart = null;
let graphData = null;      // 最近一次 buildGraphData 的结果，切换布局/边标签时复用
let graphDirty = false;    // 数据变了但当前 tab 没显示，切过来时再画

function buildGraphData(characters, relationships) {
  // 人物度数决定气泡大小和分类；关系中出现但 characters 里漏掉的人物也补进去
  const degree = new Map();
  const known = new Set(characters || []);
  const edges = [];
  for (const r of relationships || []) {
    if (!r.person_a || !r.person_b) continue;
    known.add(r.person_a);
    known.add(r.person_b);
    degree.set(r.person_a, (degree.get(r.person_a) || 0) + 1);
    degree.set(r.person_b, (degree.get(r.person_b) || 0) + 1);
    edges.push({
      source: r.person_a,
      target: r.person_b,
      relation: r.relation || "",
      evidence: r.evidence || "",
    });
  }
  const nodes = Array.from(known).map((name) => {
    const d = degree.get(name) || 0;
    // 度 ≥ 3 主要，≥ 1 次要，0 孤立
    const category = d >= 3 ? 0 : d >= 1 ? 1 : 2;
    return {
      name,
      value: d,
      symbolSize: 22 + Math.min(d, 8) * 4,
      category,
    };
  });
  return { nodes, edges };
}

function renderGraph(characters, relationships) {
  graphData = buildGraphData(characters, relationships);
  graphDirty = true;
  // 只有 tab 当前可见时才立即画，否则容器是 display:none，ECharts 初始化会拿到 0 尺寸
  const pane = document.getElementById("tab-graph");
  if (pane && pane.classList.contains("active")) flushGraph();
}

function flushGraph() {
  const container = document.getElementById("graph-chart");
  if (!container) return;
  if (!graphData || !graphData.nodes.length) {
    if (graphChart) { graphChart.dispose(); graphChart = null; }
    container.innerHTML = `<p class="empty-tip">未识别到人物关系。</p>`;
    graphDirty = false;
    return;
  }
  // 清掉 empty-tip 占位；ECharts 需要一个空的 div
  if (!graphChart) {
    container.innerHTML = "";
    graphChart = echarts.init(container);
  }
  paintGraph();
  graphDirty = false;
}

function paintGraph() {
  if (!graphChart || !graphData) return;
  const layoutEl = document.getElementById("graph-layout");
  const edgeLabelEl = document.getElementById("graph-edge-label");
  const layout = layoutEl ? layoutEl.value : "force";
  const showEdgeLabel = edgeLabelEl ? edgeLabelEl.checked : true;

  const option = {
    tooltip: {
      formatter: (p) => {
        if (p.dataType === "edge") {
          const d = p.data;
          const ev = d.evidence ? `<div style="color:#94a3b8;margin-top:4px;max-width:280px;white-space:normal">${escapeHtml(d.evidence)}</div>` : "";
          return `<b>${escapeHtml(d.source)} — ${escapeHtml(d.target)}</b><br/>${escapeHtml(d.relation)}${ev}`;
        }
        return `<b>${escapeHtml(p.data.name)}</b><br/>关系数：${p.data.value}`;
      },
    },
    legend: [{
      data: ["主要人物", "次要人物", "孤立人物"],
      bottom: 6,
      textStyle: { fontSize: 11, color: "#6b7280" },
      itemGap: 14,
    }],
    animationDuration: 400,
    animationEasingUpdate: "quinticInOut",
    series: [{
      type: "graph",
      layout,
      data: graphData.nodes,
      links: graphData.edges.map((e) => ({
        source: e.source,
        target: e.target,
        relation: e.relation,
        evidence: e.evidence,
        label: { show: showEdgeLabel, formatter: e.relation, fontSize: 10, color: "#475569" },
      })),
      categories: [
        { name: "主要人物", itemStyle: { color: "#4f46e5" } },
        { name: "次要人物", itemStyle: { color: "#22c55e" } },
        { name: "孤立人物", itemStyle: { color: "#94a3b8" } },
      ],
      roam: true,
      draggable: true,
      label: { show: true, position: "right", fontSize: 12, color: "#1f2433" },
      labelLayout: { hideOverlap: true },
      lineStyle: { color: "source", curveness: 0.12, opacity: 0.65, width: 1.5 },
      emphasis: {
        focus: "adjacency",
        lineStyle: { width: 3, opacity: 1 },
        label: { fontWeight: "bold" },
      },
      force: { repulsion: 220, gravity: 0.08, edgeLength: [80, 160], layoutAnimation: true },
      circular: { rotateLabel: true },
    }],
  };
  graphChart.setOption(option, true);
}

// langextract 可视化 HTML 里 .lx-text-window 是固定高度，iframe 拉伸后底部会有大片留白；
// 注入这段 CSS 让 body 变 flex-column、把文本窗口撑到底部，其他控件保持自然高度。
const HIGHLIGHT_FIT_CSS = `
<style id="storyxray-fit">
  html, body { height: 100% !important; margin: 0 !important; }
  body { display: flex !important; flex-direction: column !important; }
  /* langextract 把 legend/text-window/controls 包在这个 wrapper 里，
     必须让 wrapper 自己也是 flex-column 且抢满 body，text-window 才有可分配空间 */
  .lx-animated-wrapper {
    flex: 1 !important;
    min-height: 0 !important;
    display: flex !important;
    flex-direction: column !important;
  }
  /* langextract 源码里给 .lx-text-window 写死了 max-height: 260px，
     必须显式 none 掉，否则 flex:1 会被 max-height 卡住 */
  .lx-text-window {
    flex: 1 !important;
    max-height: none !important;
    min-height: 0 !important;
    overflow: auto !important;
    margin-bottom: 0 !important;
  }
</style>
`;

function renderHtmlHighlight(html) {
  if (!html) {
    els.htmlWrap.innerHTML = `<p class="empty-tip">本次未生成高亮视图。</p>`;
    return;
  }
  // 抽取结果的高亮 HTML 自带样式与 JS，用 iframe 隔离避免污染主页面
  // 走 srcdoc 而非 contentDocument.write：后者在 sandbox（无 allow-same-origin）下会触发跨源拒绝
  els.htmlWrap.innerHTML = "";
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  // 有 </head> 就插进 head，否则整段前置——不管 langextract 未来怎么改结构都能兜底
  const injected = html.includes("</head>")
    ? html.replace("</head>", HIGHLIGHT_FIT_CSS + "</head>")
    : HIGHLIGHT_FIT_CSS + html;
  iframe.srcdoc = injected;
  els.htmlWrap.appendChild(iframe);
}

async function runExtraction() {
  // 章节页触发：拿当前章节的原文（起始页不会走到这里）
  const chapter = getCurrentChapter();
  const text = (chapter?.text || "").trim();
  if (!text) {
    setStatus("当前章节没有原文", "error");
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
    preset_name: preset.name || null,
    extraction_passes: workingConfig.passes || 1,
    max_char_buffer: workingConfig.charBuffer || 1500,
    // 让后端在 done 事件时自动写回章节，省一次 PUT
    project_id: currentPid || null,
    chapter_id: currentCid || null,
  };

  // 记下这次抽取的输入，done 回来时拼草稿要用——response 不会重复带回这些
  lastExtractText = text;
  lastExtractPasses = workingConfig.passes || 1;
  lastExtractCharBuffer = workingConfig.charBuffer || 1500;
  lastExtractSnapshot = {
    name: preset.name || "",
    backend: preset.backend,
    model: preset.model || "",
    base_url: preset.baseUrl || "",
    passes: lastExtractPasses,
    char_buffer: lastExtractCharBuffer,
  };
  // 重新抽取就丢掉之前未保存的草稿
  clearDraft();

  els.runBtn.disabled = true;
  setStatus("正在调用 LLM 抽取……", "loading");
  showProgress(true);
  setProgress(0, 1, "准备中");

  const started = Date.now();

  try {
    const resp = await fetch("/api/extract/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok || !resp.body) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || `HTTP ${resp.status}`);
    }

    await consumeSse(resp.body, started);
  } catch (err) {
    console.error(err);
    setStatus(`抽取失败：${err.message}`, "error");
    showProgress(false);
  } finally {
    els.runBtn.disabled = false;
  }
}

async function consumeSse(stream, started) {
  // 手写 SSE 解析：EventSource 不支持 POST，所以走 fetch+ReadableStream
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  let estimatedTotal = 0;

  const handleEvent = (event, data) => {
    let payload = null;
    try {
      payload = data ? JSON.parse(data) : null;
    } catch (e) {
      console.warn("SSE 解析失败", event, data);
      return;
    }

    if (event === "init") {
      estimatedTotal = payload.estimated_total || 0;
      setProgress(0, estimatedTotal, `${payload.estimated_chunks} 个分片 × ${payload.passes} 轮`);
      return;
    }

    if (event === "progress") {
      // 后端解析出的 current/total 可能是分片维度的，比预估总量小；以两者较大者为基数
      const total = Math.max(payload.total || 0, estimatedTotal);
      setProgress(payload.current, total);
      if (payload.raw) appendProgressLog(payload.raw);
      return;
    }

    if (event === "log") {
      if (payload.raw) appendProgressLog(payload.raw);
      return;
    }

    if (event === "error") {
      throw new Error(payload.detail || "服务端抽取失败");
    }

    if (event === "done") {
      setProgress(estimatedTotal || 1, estimatedTotal || 1, "完成");
      renderHtmlHighlight(payload.html);
      renderCharacters(payload.characters || []);
      renderRelations(payload.relationships || []);
      renderEvents(payload.events || []);
      renderGraph(payload.characters || [], payload.relationships || []);

      const cost = ((Date.now() - started) / 1000).toFixed(1);
      const stats = payload.stats || {};
      // 状态行多塞 token 信息；本地模型若没返回 usage（partial=true）打个问号
      let tokenBit = "";
      if (stats.calls) {
        const totalK = (stats.total_tokens / 1000).toFixed(1);
        const mark = stats.partial ? "?" : "";
        tokenBit = ` · ${stats.calls} 次调用 · ${totalK}k tokens${mark}（输入 ${stats.prompt_tokens} / 输出 ${stats.completion_tokens}）`;
      }
      setStatus(
        `完成（${cost}s）：人物 ${payload.characters.length} 个，关系 ${payload.relationships.length} 条，事件 ${payload.events.length} 条${tokenBit}`,
        "success"
      );

      // 把这次的输入+结果做成一份待保存草稿；点保存按钮才真正落盘
      stashDraft({
        text: lastExtractText,
        preset_snapshot: lastExtractSnapshot,
        passes: lastExtractPasses,
        char_buffer: lastExtractCharBuffer,
        elapsed_sec: Number((payload.elapsed_sec ?? cost)) || 0,
        extractions: payload.extractions || [],
        html: payload.html || "",
        characters: payload.characters || [],
        relationships: payload.relationships || [],
        events: payload.events || [],
        summary: "",
        stats: stats,
      });

      // 抽取完自动跑一次简介：用户选的是"两者都要"，抽取成功即触发；失败静默
      renderSummary("");
      runSummary({ silent: true }).catch(() => {});

      // 进度条停留 1 秒再收，给用户视觉确认
      setTimeout(() => showProgress(false), 1000);
      return;
    }
  };

  // SSE 帧用空行分隔；逐帧从缓冲里切出来
  const flushFrames = () => {
    let sepIdx;
    while ((sepIdx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, sepIdx);
      buf = buf.slice(sepIdx + 2);
      let event = "message";
      let dataLines = [];
      for (const line of frame.split("\n")) {
        if (!line || line.startsWith(":")) continue;  // 注释/心跳行
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      handleEvent(event, dataLines.join("\n"));
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    flushFrames();
  }
  // 流结束时把残留帧再过一次
  buf += "\n\n";
  flushFrames();
}

// Tab 切换
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $("#tab-" + btn.dataset.tab).classList.add("active");
    // 关系图 tab 是隐藏状态时不能 init（容器 0 尺寸），切过来再补画
    if (btn.dataset.tab === "graph") {
      if (graphDirty) flushGraph();
      else if (graphChart) graphChart.resize();
    }
  });
});

// 关系图工具栏
const graphLayoutEl = document.getElementById("graph-layout");
const graphEdgeLabelEl = document.getElementById("graph-edge-label");
if (graphLayoutEl) graphLayoutEl.addEventListener("change", () => { if (graphChart) paintGraph(); });
if (graphEdgeLabelEl) graphEdgeLabelEl.addEventListener("change", () => { if (graphChart) paintGraph(); });
window.addEventListener("resize", () => { if (graphChart) graphChart.resize(); });

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

// ---------- 历史记录 ----------
let historyCache = [];

// ---------- 未保存草稿 ----------
// 抽取完成 → 草稿暂存到这里；点保存才落盘；新抽取或加载历史时清空
let draftPayload = null;
// 最近一次抽取的输入参数（done 事件本身不带这些信息）
let lastExtractText = "";
let lastExtractPasses = 1;
let lastExtractCharBuffer = 1500;
let lastExtractSnapshot = null;

function stashDraft(payload) {
  // 起始页化之后不再有"保存为工程"按钮：抽取结果由后端按 pid/cid 自动落盘。
  // 保留 draftPayload 是给 runSummary 拿最近一次原文用的
  draftPayload = payload;
}

function clearDraft() {
  draftPayload = null;
}

async function saveDraft() {
  console.log("[StoryX-Ray] 点击保存", { hasDraft: !!draftPayload });
  if (!draftPayload) {
    setStatus("没有待保存的草稿，请先完成一次抽取", "error");
    return;
  }
  // 保存前把最新简介同步进草稿，避免用户"生成简介"后立刻保存时漏掉
  draftPayload.summary = currentSummary || draftPayload.summary || "";
  els.saveBtn.disabled = true;
  els.saveBtn.textContent = "保存中…";
  try {
    const resp = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draftPayload),
    });
    if (!resp.ok) {
      throw new Error((await resp.json().catch(() => ({}))).detail || resp.statusText);
    }
    const data = await resp.json();
    setStatus(`已保存为工程「${data.name}」`, "success");
    clearDraft();
    refreshHistorySummary();
    refreshStatsSummary();
  } catch (err) {
    console.error(err);
    setStatus(`保存失败：${err.message}`, "error");
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = "重试保存";
  }
}

async function refreshHistorySummary() {
  try {
    const resp = await fetch("/api/projects");
    if (!resp.ok) return;
    historyCache = await resp.json();
    els.historySummary.textContent = `${historyCache.length} 条`;
  } catch (e) {
    // 静默忽略：顶栏数字非关键路径
    console.warn("读取历史列表失败", e);
  }
}

function formatHistoryTime(iso) {
  if (!iso) return "";
  // 后端写的是 isoformat(timespec="seconds")，没时区；当本地时间显示
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderHistoryList() {
  els.historyList.innerHTML = "";
  if (!historyCache.length) {
    els.historyEmpty.hidden = false;
    return;
  }
  els.historyEmpty.hidden = true;

  historyCache.forEach((item) => {
    const li = document.createElement("li");
    li.className = "history-item";
    li.dataset.id = item.id;

    const main = document.createElement("div");
    main.className = "history-item-main";

    const title = document.createElement("div");
    title.className = "history-item-title";
    title.textContent = item.name || "(未命名)";

    const snap = item.preset_snapshot || {};
    const stats = item.stats || {};
    const meta = document.createElement("div");
    meta.className = "history-item-meta";
    const backendLabel = BACKEND_LABEL[snap.backend] || snap.backend || "?";
    const modelText = snap.model || "默认模型";
    const elapsed = stats.elapsed_sec ? `${stats.elapsed_sec}s` : "";
    const chars = stats.input_chars
      ? stats.input_chars >= 1000
        ? `${(stats.input_chars / 1000).toFixed(1)}k字`
        : `${stats.input_chars}字`
      : "";
    meta.textContent = [
      formatHistoryTime(item.created_at),
      `${backendLabel} ${modelText}`,
      chars,
      elapsed,
    ].filter(Boolean).join(" · ");

    const stat = document.createElement("div");
    stat.className = "history-item-stat";
    let tokenSuffix = "";
    if (stats.calls && stats.total_tokens) {
      const k = (stats.total_tokens / 1000).toFixed(1);
      tokenSuffix = ` · ${k}k tokens${stats.partial ? "?" : ""}`;
    }
    stat.textContent = `人物 ${stats.characters ?? 0} · 关系 ${stats.relationships ?? 0} · 事件 ${stats.events ?? 0}${tokenSuffix}`;

    main.appendChild(title);
    main.appendChild(meta);
    main.appendChild(stat);

    const actions = document.createElement("div");
    actions.className = "history-item-actions";

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "btn-mini";
    renameBtn.textContent = "改名";
    renameBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      renameHistoryItem(item);
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-mini btn-danger";
    delBtn.textContent = "✕";
    delBtn.title = "删除";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteHistoryItem(item);
    });

    actions.appendChild(renameBtn);
    actions.appendChild(delBtn);

    li.appendChild(main);
    li.appendChild(actions);
    li.addEventListener("click", () => loadHistoryItem(item.id));
    els.historyList.appendChild(li);
  });
}

async function loadHistoryItem(pid) {
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(pid)}`);
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || resp.statusText);
    const proj = await resp.json();
    // 把输入填回去；结果直接渲染到右侧
    els.text.value = proj.input?.text || "";
    els.charCount.textContent = els.text.value.length;
    const result = proj.result || {};
    renderHtmlHighlight(result.html || "");
    renderCharacters(result.characters || []);
    renderRelations(result.relationships || []);
    renderEvents(result.events || []);
    renderGraph(result.characters || [], result.relationships || []);
    renderSummary(result.summary || "");
    // 加载的是已存工程，不是新抽取，自然没有待保存草稿
    clearDraft();
    setStatus(`已加载工程「${proj.name}」（${proj.input?.text?.length || 0} 字，只读视图；重新抽取会创建新工程）`, "success");
    closeHistoryModal();
  } catch (err) {
    console.error(err);
    setStatus(`加载工程失败：${err.message}`, "error");
  }
}

async function renameHistoryItem(item) {
  const next = prompt("输入新名称：", item.name || "");
  if (next === null) return;
  const name = next.trim();
  if (!name || name === item.name) return;
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || resp.statusText);
    await refreshHistorySummary();
    renderHistoryList();
  } catch (err) {
    alert(`改名失败：${err.message}`);
  }
}

async function deleteHistoryItem(item) {
  if (!confirm(`确定删除工程「${item.name}」？此操作不可撤销。`)) return;
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || resp.statusText);
    await refreshHistorySummary();
    refreshStatsSummary();
    renderHistoryList();
  } catch (err) {
    alert(`删除失败：${err.message}`);
  }
}

async function openHistoryModal() {
  els.historyModal.hidden = false;
  await refreshHistorySummary();
  renderHistoryList();
}

function closeHistoryModal() {
  els.historyModal.hidden = true;
}

// ---------- 用量统计 ----------
const BACKEND_LABEL_FULL = { ...BACKEND_LABEL, unknown: "未知（旧工程）" };

function formatTokens(n) {
  if (!n) return "0";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

function formatElapsed(sec) {
  if (!sec) return "0s";
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return `${m}m${String(s).padStart(2, "0")}s`;
}

async function refreshStatsSummary() {
  try {
    const resp = await fetch("/api/stats");
    if (!resp.ok) return;
    const data = await resp.json();
    const t = data.total || {};
    // 顶栏只用最紧凑的形式：合计 tokens
    els.statsSummary.textContent = t.total_tokens
      ? `${formatTokens(t.total_tokens)} tokens${t.partial ? "?" : ""}`
      : "— tokens";
    els.statsSummary._cache = data;
  } catch (e) {
    console.warn("读取用量统计失败", e);
  }
}

function renderStats(data) {
  const t = data.total || {};
  if (!t.projects) {
    els.statsTotal.innerHTML = "";
    els.statsByBackend.innerHTML = "";
    els.statsRecent.innerHTML = "";
    els.statsEmpty.hidden = false;
    return;
  }
  els.statsEmpty.hidden = true;

  const mark = t.partial ? "?" : "";
  els.statsTotal.innerHTML = `
    <div class="stats-metric"><div class="metric-value">${t.projects}</div><div class="metric-label">工程数</div></div>
    <div class="stats-metric"><div class="metric-value">${t.calls}</div><div class="metric-label">LLM 调用</div></div>
    <div class="stats-metric"><div class="metric-value">${formatTokens(t.total_tokens)}${mark}</div><div class="metric-label">合计 tokens</div></div>
    <div class="stats-metric"><div class="metric-value">${formatTokens(t.prompt_tokens)}</div><div class="metric-label">输入 tokens</div></div>
    <div class="stats-metric"><div class="metric-value">${formatTokens(t.completion_tokens)}</div><div class="metric-label">输出 tokens</div></div>
    <div class="stats-metric"><div class="metric-value">${formatElapsed(t.elapsed_sec)}</div><div class="metric-label">累计耗时</div></div>
  `;

  els.statsByBackend.innerHTML = (data.by_backend || []).map((b) => {
    const label = BACKEND_LABEL_FULL[b.backend] || b.backend;
    const modelText = b.model ? escapeHtml(b.model) : `<span class="muted">默认</span>`;
    return `
      <tr>
        <td>${escapeHtml(label)}<div class="cell-sub">${modelText}</div></td>
        <td class="num">${b.projects}</td>
        <td class="num">${b.calls}</td>
        <td class="num">${b.prompt_tokens.toLocaleString()}</td>
        <td class="num">${b.completion_tokens.toLocaleString()}</td>
        <td class="num strong">${b.total_tokens.toLocaleString()}</td>
        <td class="num">${formatElapsed(b.elapsed_sec)}</td>
      </tr>`;
  }).join("");

  els.statsRecent.innerHTML = (data.recent || []).slice(0, 20).map((r) => {
    const label = BACKEND_LABEL_FULL[r.backend] || r.backend;
    const mk = r.partial ? "?" : "";
    return `
      <tr>
        <td>${escapeHtml(r.name || "(未命名)")}<div class="cell-sub">${formatHistoryTime(r.created_at)}</div></td>
        <td>${escapeHtml(label)}${r.model ? `<div class="cell-sub">${escapeHtml(r.model)}</div>` : ""}</td>
        <td class="num">${r.calls}</td>
        <td class="num">${r.prompt_tokens.toLocaleString()}</td>
        <td class="num">${r.completion_tokens.toLocaleString()}</td>
        <td class="num strong">${r.total_tokens.toLocaleString()}${mk}</td>
        <td class="num">${formatElapsed(r.elapsed_sec)}</td>
      </tr>`;
  }).join("");
}

async function openStatsModal() {
  els.statsModal.hidden = false;
  // 先渲染上次缓存的数据避免空白闪一下，再拉最新
  if (els.statsSummary._cache) renderStats(els.statsSummary._cache);
  try {
    const resp = await fetch("/api/stats");
    if (!resp.ok) throw new Error(resp.statusText);
    const data = await resp.json();
    els.statsSummary._cache = data;
    renderStats(data);
    // 顺手也把顶栏的数字更到最新
    const t = data.total || {};
    els.statsSummary.textContent = t.total_tokens
      ? `${formatTokens(t.total_tokens)} tokens${t.partial ? "?" : ""}`
      : "— tokens";
  } catch (e) {
    console.warn("拉取用量统计失败", e);
  }
}

function closeStatsModal() { els.statsModal.hidden = true; }

els.statsBtn.addEventListener("click", openStatsModal);
els.statsModal.querySelectorAll("[data-close]").forEach((el) => {
  el.addEventListener("click", closeStatsModal);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.statsModal.hidden) closeStatsModal();
});

// 历史弹窗已被起始页替换，绑定跳过；相关函数保留供后续复用
// els.historyBtn.addEventListener("click", openHistoryModal);

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

// 旧输入框/保存按钮已由起始页 + 章节页替换；下方步骤 B/C 会重新绑定 runBtn/summaryBtn
// els.text.addEventListener("input", ...);  els.runBtn/saveBtn/summaryBtn 绑定挪到 setupProjectPage()

function newProject() {
  // 有未保存草稿时先确认，避免误清
  if (draftPayload && !confirm("当前有未保存的抽取结果，是否放弃并新建？")) return;
  els.text.value = "";
  els.charCount.textContent = "0";
  clearDraft();
  setStatus("");
  // 右侧结果全部复位
  renderHtmlHighlight("");
  renderCharacters([]);
  renderRelations([]);
  renderEvents([]);
  renderGraph([], []);
  renderSummary("");
  setSummaryStatus("");
  showProgress(false);
  // 切回原文高亮 tab，感觉像刚打开页面
  document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
  document.querySelector('.tab[data-tab="highlight"]').classList.add("active");
  document.getElementById("tab-highlight").classList.add("active");
  els.text.focus();
}
// 老的"新建工程"按钮已删掉，起始页的 #landing-new-btn 由步骤 B 绑定
// document.getElementById("new-project-btn").addEventListener("click", newProject);

// ---------- 导入 txt ----------
// 后端 ExtractRequest.text 的 max_length，客户端提前挡一次避免用户白等一次上传
const MAX_TEXT_CHARS = 200_000;

async function readTxtWithFallback(file) {
  // Windows 常见中文文本是 GBK/GB18030；先按 UTF-8 试解，若出现替换符则回退 GBK
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("gbk").decode(buf);
  } catch {
    // 极老浏览器可能不识 gbk 标签，退回带替换符的 UTF-8 结果，胜过报错
    return utf8;
  }
}

async function importTxtFile(file) {
  if (!file) return;
  // 后缀白名单：MIME 在 Windows 上经常是空的，name 检查更稳
  if (!/\.txt$/i.test(file.name)) {
    setStatus("仅支持 .txt 文件", "error");
    return;
  }
  // 提前用文件大小挡一手：中文一字 3 字节，200k 字对应约 600KB；给到 2MB 兜住 BOM/换行/英文混合
  if (file.size > 2 * 1024 * 1024) {
    setStatus(`文件过大（${(file.size / 1024).toFixed(0)} KB），请裁剪到 2MB 以内`, "error");
    return;
  }

  const hasContent = els.text.value.trim().length > 0;
  const hasDraft = !!draftPayload;
  if ((hasContent || hasDraft) && !confirm("导入将覆盖当前输入" + (hasDraft ? "和未保存的抽取结果" : "") + "，是否继续？")) {
    return;
  }

  try {
    let text = await readTxtWithFallback(file);
    // 去掉 UTF-8 BOM 与统一换行，避免 LLM 分片时把 \r\n 当额外字符浪费窗口
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    text = text.replace(/\r\n?/g, "\n");

    if (text.length > MAX_TEXT_CHARS) {
      if (!confirm(`文件 ${text.length} 字超过上限 ${MAX_TEXT_CHARS}，将截断到前 ${MAX_TEXT_CHARS} 字导入。是否继续？`)) return;
      text = text.slice(0, MAX_TEXT_CHARS);
    }

    els.text.value = text;
    els.charCount.textContent = text.length;
    clearDraft();
    // 右侧结果一并复位——导入的新文本和旧抽取不匹配，留着会误导
    renderHtmlHighlight("");
    renderCharacters([]);
    renderRelations([]);
    renderEvents([]);
    renderGraph([], []);
    renderSummary("");
    setSummaryStatus("");
    setStatus(`已导入「${file.name}」（${text.length} 字），点击「开始抽取」即可`, "success");
  } catch (err) {
    console.error(err);
    setStatus(`导入失败：${err.message}`, "error");
  }
}

// 旧的 txt 导入/拖拽已迁移到新建工程弹窗，见步骤 B

// ============================================================
// 步骤 B+C：起始页 + 新建工程向导 + 工程页 + 章节路由
// ============================================================

// 当前正在查看的工程 & 章节；起始页时都是 null
let currentPid = null;
let currentCid = null;
let currentProject = null;

const pageLanding = document.getElementById("page-landing");
const pageProject = document.getElementById("page-project");

function showPage(name) {
  pageLanding.hidden = name !== "landing";
  pageProject.hidden = name !== "project";
}

function getCurrentChapter() {
  if (!currentProject || !currentCid) return null;
  return (currentProject.chapters || []).find((c) => c.id === currentCid) || null;
}

// ---------- 起始页 ----------
const landingGrid = document.getElementById("landing-grid");
const landingEmpty = document.getElementById("landing-empty");

async function loadLanding() {
  currentPid = null; currentCid = null; currentProject = null;
  showPage("landing");
  landingGrid.innerHTML = "";
  try {
    const resp = await fetch("/api/projects");
    if (!resp.ok) throw new Error(resp.statusText);
    const items = await resp.json();
    renderProjectCards(items);
    refreshStatsSummary();
  } catch (err) {
    console.warn("加载工程列表失败", err);
    landingEmpty.hidden = false;
    landingEmpty.textContent = `加载失败：${err.message}`;
  }
}

function renderProjectCards(items) {
  landingEmpty.hidden = items && items.length > 0;
  landingGrid.innerHTML = "";
  (items || []).forEach((it) => {
    const card = document.createElement("div");
    card.className = "project-card";
    card.dataset.pid = it.id;

    const title = document.createElement("div");
    title.className = "project-card-title";
    title.textContent = it.name || "(未命名)";

    const meta = document.createElement("div");
    meta.className = "project-card-meta";
    const chars = it.input_chars || 0;
    const charsText = chars >= 1000 ? `${(chars / 1000).toFixed(1)}k字` : `${chars}字`;
    const parts = [
      formatHistoryTime(it.created_at),
      `${it.chapter_count || 1} 章`,
      charsText,
    ];
    meta.textContent = parts.filter(Boolean).join(" · ");

    const prog = document.createElement("div");
    prog.className = "project-card-progress";
    const total = it.chapter_count || 1;
    const done = it.extracted_count || 0;
    const pct = Math.round((done / Math.max(total, 1)) * 100);
    prog.innerHTML = `<span style="width:${pct}%"></span>`;

    const progLabel = document.createElement("div");
    progLabel.className = "project-card-meta";
    progLabel.textContent = `已抽取 ${done}/${total}`;

    const actions = document.createElement("div");
    actions.className = "project-card-actions";
    const renameBtn = document.createElement("button");
    renameBtn.type = "button"; renameBtn.className = "btn-mini"; renameBtn.textContent = "改名";
    renameBtn.addEventListener("click", (e) => { e.stopPropagation(); renameProject(it); });
    const delBtn = document.createElement("button");
    delBtn.type = "button"; delBtn.className = "btn-mini"; delBtn.textContent = "✕"; delBtn.title = "删除";
    delBtn.addEventListener("click", (e) => { e.stopPropagation(); deleteProject(it); });
    actions.appendChild(renameBtn); actions.appendChild(delBtn);

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(prog);
    card.appendChild(progLabel);
    card.appendChild(actions);
    card.addEventListener("click", () => { location.hash = `#/p/${it.id}`; });
    landingGrid.appendChild(card);
  });
}

async function renameProject(item) {
  const next = prompt("输入新名称：", item.name || "");
  if (next === null) return;
  const name = next.trim();
  if (!name || name === item.name) return;
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || resp.statusText);
    loadLanding();
  } catch (err) { alert(`改名失败：${err.message}`); }
}

async function deleteProject(item) {
  if (!confirm(`确定删除工程「${item.name}」？此操作不可撤销。`)) return;
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || resp.statusText);
    loadLanding();
  } catch (err) { alert(`删除失败：${err.message}`); }
}

// ---------- 新建工程弹窗 ----------
const newModal = document.getElementById("new-modal");
const newName = document.getElementById("new-name");
const newTextArea = document.getElementById("new-text");
const newCharCount = document.getElementById("new-char-count");
const newUploadBtn = document.getElementById("new-upload-btn");
const newUploadInput = document.getElementById("new-upload-input");
const stepInput = document.getElementById("new-step-input");
const stepPreview = document.getElementById("new-step-preview");
const previewModeLabel = document.getElementById("preview-mode-label");
const previewCountLabel = document.getElementById("preview-count-label");
const previewToggleBtn = document.getElementById("preview-toggle-mode");
const previewList = document.getElementById("preview-list");
const btnNewBack = document.getElementById("new-back");
const btnNewNext = document.getElementById("new-next");
const btnNewCreate = document.getElementById("new-create");

// 当前预览的章节草稿，创建时用
let previewChapters = [];
let previewMode = "single";

function openNewModal() {
  newName.value = "";
  newTextArea.value = "";
  newCharCount.textContent = "0 字";
  previewChapters = [];
  previewMode = "single";
  stepInput.hidden = false; stepPreview.hidden = true;
  btnNewBack.hidden = true; btnNewNext.hidden = false; btnNewCreate.hidden = true;
  newModal.hidden = false;
  requestAnimationFrame(() => newName.focus());
}
function closeNewModal() { newModal.hidden = true; }

newModal.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeNewModal));

newTextArea.addEventListener("input", () => {
  newCharCount.textContent = `${newTextArea.value.length} 字`;
});

newUploadBtn.addEventListener("click", () => newUploadInput.click());
newUploadInput.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (!/\.txt$/i.test(file.name)) { alert("仅支持 .txt 文件"); return; }
  if (file.size > 2 * 1024 * 1024) { alert(`文件过大（${(file.size / 1024).toFixed(0)} KB），请裁剪到 2MB 以内`); return; }
  try {
    let text = await readTxtWithFallback(file);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    text = text.replace(/\r\n?/g, "\n");
    if (text.length > MAX_TEXT_CHARS * 100) text = text.slice(0, MAX_TEXT_CHARS * 100);
    newTextArea.value = text;
    newCharCount.textContent = `${text.length} 字`;
    if (!newName.value.trim()) newName.value = file.name.replace(/\.txt$/i, "");
  } catch (err) { alert(`读取失败：${err.message}`); }
});

btnNewNext.addEventListener("click", () => {
  const text = newTextArea.value;
  if (!text.trim()) { alert("请粘贴或导入文本"); return; }
  const split = window.Chapters.splitText(text);
  previewMode = split.mode;
  previewChapters = split.chapters.map((c) => ({ title: c.title, text: c.text, removed: false }));
  renderPreview();
  stepInput.hidden = true; stepPreview.hidden = false;
  btnNewBack.hidden = false; btnNewNext.hidden = true; btnNewCreate.hidden = false;
});
btnNewBack.addEventListener("click", () => {
  stepInput.hidden = false; stepPreview.hidden = true;
  btnNewBack.hidden = true; btnNewNext.hidden = false; btnNewCreate.hidden = true;
});

function renderPreview() {
  const active = previewChapters.filter((c) => !c.removed);
  const modeText = { single: "全文单章", chapter: "按章节切分", size: "按字数切分" }[previewMode] || previewMode;
  previewModeLabel.textContent = `切分方式：${modeText}`;
  previewCountLabel.textContent = `${active.length} 段，共 ${active.reduce((a, c) => a + c.text.length, 0)} 字`;
  previewList.innerHTML = "";
  previewChapters.forEach((ch, i) => {
    const li = document.createElement("li");
    li.className = "preview-item" + (ch.removed ? " removed" : "");
    const title = document.createElement("input");
    title.type = "text"; title.className = "preview-item-title"; title.value = ch.title;
    title.addEventListener("input", () => { previewChapters[i].title = title.value; });
    const chars = document.createElement("span");
    chars.className = "preview-item-chars"; chars.textContent = `${ch.text.length} 字`;
    const del = document.createElement("button");
    del.type = "button"; del.className = "preview-item-del";
    del.textContent = ch.removed ? "撤销" : "✕";
    del.title = ch.removed ? "撤销移除" : "移除本段";
    del.addEventListener("click", () => { previewChapters[i].removed = !previewChapters[i].removed; renderPreview(); });
    li.appendChild(title); li.appendChild(chars); li.appendChild(del);
    previewList.appendChild(li);
  });
}

previewToggleBtn.addEventListener("click", () => {
  // 章节 → 字数 → 单章 → 章节 循环。字数模式没识别到章节时也允许切
  const text = newTextArea.value;
  if (previewMode === "chapter") {
    previewMode = "size";
    previewChapters = window.Chapters.splitBySize(text).map((c) => ({ title: c.title, text: c.text, removed: false }));
  } else if (previewMode === "size") {
    previewMode = "single";
    previewChapters = [{ title: "全文", text: text.trim(), removed: false }];
  } else {
    const detected = window.Chapters.detectChapters(text);
    if (detected && detected.length >= 2) {
      previewMode = "chapter";
      previewChapters = detected.map((c) => ({ title: c.title, text: c.text, removed: false }));
    } else {
      previewMode = "size";
      previewChapters = window.Chapters.splitBySize(text).map((c) => ({ title: c.title, text: c.text, removed: false }));
    }
  }
  renderPreview();
});

btnNewCreate.addEventListener("click", async () => {
  const active = previewChapters.filter((c) => !c.removed && c.text.trim());
  if (!active.length) { alert("至少保留一段"); return; }
  const preset = activePreset(workingConfig);
  const snapshot = preset ? {
    name: preset.name || "", backend: preset.backend, model: preset.model || "",
    base_url: preset.baseUrl || "",
    passes: workingConfig.passes || 1, char_buffer: workingConfig.charBuffer || 1500,
  } : {};
  btnNewCreate.disabled = true; btnNewCreate.textContent = "创建中…";
  try {
    const resp = await fetch("/api/projects", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.value.trim(),
        chapters: active.map((c) => ({ title: c.title, text: c.text })),
        preset_snapshot: snapshot,
        passes: workingConfig.passes || 1,
        char_buffer: workingConfig.charBuffer || 1500,
      }),
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || resp.statusText);
    const proj = await resp.json();
    closeNewModal();
    location.hash = `#/p/${proj.id}`;
  } catch (err) {
    alert(`创建失败：${err.message}`);
  } finally {
    btnNewCreate.disabled = false; btnNewCreate.textContent = "创建";
  }
});

// ---------- 工程页 ----------
const chapterList = document.getElementById("chapter-list");
const chapterProgress = document.getElementById("chapter-progress");
const chapterTitleEl = document.getElementById("chapter-title");
const chapterStatusEl = document.getElementById("chapter-status");
const chapterTextEl = document.getElementById("chapter-text");
const projectTitleEl = document.getElementById("project-title");
const projectMetaEl = document.getElementById("project-meta");
const projectLayout = document.querySelector(".project-layout");

async function loadProject(pid) {
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(pid)}`);
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || resp.statusText);
    currentProject = await resp.json();
    currentPid = currentProject.id;
    currentCid = currentProject.chapters[0]?.id || null;
    renderProject();
    showPage("project");
  } catch (err) {
    alert(`加载工程失败：${err.message}`);
    location.hash = "#/";
  }
}

function renderProject() {
  if (!currentProject) return;
  projectTitleEl.textContent = currentProject.name || "(未命名)";
  const total = currentProject.chapters.length;
  const total_chars = currentProject.chapters.reduce((a, c) => a + (c.text || "").length, 0);
  const done = currentProject.chapters.filter((c) => c.status === "extracted").length;
  projectMetaEl.textContent = `${total} 章 · ${total_chars} 字 · 已抽取 ${done}/${total}`;
  // 单章工程隐藏侧栏
  const sidebar = document.getElementById("chapter-sidebar");
  if (total <= 1) {
    projectLayout.classList.add("single-chapter");
    sidebar.hidden = true;
  } else {
    projectLayout.classList.remove("single-chapter");
    sidebar.hidden = false;
  }
  renderChapterSidebar();
  renderChapterView();
}

function renderChapterSidebar() {
  chapterList.innerHTML = "";
  const total = currentProject.chapters.length;
  const done = currentProject.chapters.filter((c) => c.status === "extracted").length;
  chapterProgress.textContent = `${done} / ${total}`;
  currentProject.chapters.forEach((ch) => {
    const li = document.createElement("li");
    li.className = "chapter-item" + (ch.id === currentCid ? " active" : "") + ` status-${ch.status || "pending"}`;
    li.dataset.cid = ch.id;
    const mark = document.createElement("span");
    mark.className = "chapter-item-mark";
    mark.textContent = ch.status === "extracted" ? "✓" : ch.status === "extracting" ? "…" : "○";
    const title = document.createElement("span");
    title.className = "chapter-item-title"; title.textContent = ch.title || ch.id;
    const chars = document.createElement("span");
    chars.className = "chapter-item-chars"; chars.textContent = `${(ch.text || "").length}`;
    li.appendChild(mark); li.appendChild(title); li.appendChild(chars);
    li.addEventListener("click", () => selectChapter(ch.id));
    chapterList.appendChild(li);
  });
}

function selectChapter(cid) {
  // 抽取中不允许切走，避免 SSE 状态错乱
  if (extracting) { alert("正在抽取本章，请等待完成"); return; }
  currentCid = cid;
  renderChapterSidebar();
  renderChapterView();
}

function renderChapterView() {
  const ch = getCurrentChapter();
  if (!ch) return;
  chapterTitleEl.textContent = ch.title || ch.id;
  chapterStatusEl.textContent = ch.status === "extracted" ? "已抽取" : ch.status === "extracting" ? "抽取中…" : "未抽取";
  chapterStatusEl.className = `chapter-status status-${ch.status || "pending"}`;
  chapterTextEl.textContent = ch.text || "";
  const r = ch.result || {};
  renderHtmlHighlight(r.html || "");
  renderCharacters(r.characters || []);
  renderRelations(r.relationships || []);
  renderEvents(r.events || []);
  renderGraph(r.characters || [], r.relationships || []);
  renderSummary(r.summary || "");
  setSummaryStatus(""); setStatus("");
  const runBtn = document.getElementById("run-btn");
  runBtn.textContent = r.characters?.length ? "重新抽取本章" : "开始抽取本章";
}

// ---------- 抽取过程中的状态锁 ----------
// runExtraction 已改为读章节；这里加一层包装：标记 extracting、完成后刷新侧栏
let extracting = false;
const _origRunExtraction = runExtraction;
runExtraction = async function () {
  const ch = getCurrentChapter();
  if (!ch) return;
  extracting = true;
  ch.status = "extracting";
  renderChapterSidebar();
  renderChapterView();
  try {
    await _origRunExtraction();
    // 后端 done 事件已把结果落盘，重新拉一次工程刷新章节状态/统计
    const resp = await fetch(`/api/projects/${encodeURIComponent(currentPid)}`);
    if (resp.ok) {
      currentProject = await resp.json();
      renderProject();
      refreshStatsSummary();
    }
  } finally {
    extracting = false;
  }
};

document.getElementById("run-btn").addEventListener("click", () => runExtraction());
document.getElementById("summary-btn").addEventListener("click", () => runSummary());
document.getElementById("landing-new-btn").addEventListener("click", openNewModal);
document.getElementById("back-to-landing").addEventListener("click", () => { location.hash = "#/"; });
document.getElementById("brand-home").addEventListener("click", () => { location.hash = "#/"; });
document.getElementById("brand-home").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); location.hash = "#/"; }
});

document.getElementById("rename-project-btn").addEventListener("click", async () => {
  if (!currentProject) return;
  const next = prompt("输入新名称：", currentProject.name || "");
  if (next === null) return;
  const name = next.trim();
  if (!name || name === currentProject.name) return;
  try {
    const resp = await fetch(`/api/projects/${encodeURIComponent(currentPid)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || resp.statusText);
    currentProject.name = name;
    projectTitleEl.textContent = name;
  } catch (err) { alert(`改名失败：${err.message}`); }
});

// Esc 关闭新建弹窗
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !newModal.hidden) closeNewModal();
});

// ---------- 路由 ----------
function handleRoute() {
  const hash = location.hash || "#/";
  const m = hash.match(/^#\/p\/(p-[\w-]+)$/);
  if (m) {
    const pid = m[1];
    if (pid !== currentPid) loadProject(pid);
    return;
  }
  loadLanding();
}
window.addEventListener("hashchange", handleRoute);

// 初始化：refreshHistorySummary 已删除（历史弹窗被起始页替换）
updateConfigSummary();
handleRoute();
