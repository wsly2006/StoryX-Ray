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
  iframe.srcdoc = html;
  els.htmlWrap.appendChild(iframe);
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
    preset_name: preset.name || null,
    extraction_passes: workingConfig.passes || 1,
    max_char_buffer: workingConfig.charBuffer || 1500,
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
        stats: stats,
      });

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
  draftPayload = payload;
  els.saveBar.hidden = false;
  els.saveBtn.disabled = false;
  els.saveBtn.textContent = "保存为工程";
}

function clearDraft() {
  draftPayload = null;
  els.saveBar.hidden = true;
  // 保存成功后顺手还原按钮，避免下次显示时仍停在"保存中…"
  els.saveBtn.disabled = false;
  els.saveBtn.textContent = "保存为工程";
}

async function saveDraft() {
  console.log("[StoryX-Ray] 点击保存", { hasDraft: !!draftPayload });
  if (!draftPayload) {
    setStatus("没有待保存的草稿，请先完成一次抽取", "error");
    return;
  }
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

els.historyBtn.addEventListener("click", openHistoryModal);
els.historyModal.querySelectorAll("[data-close]").forEach((el) => {
  el.addEventListener("click", closeHistoryModal);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.historyModal.hidden) closeHistoryModal();
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
els.saveBtn.addEventListener("click", saveDraft);

// 初始化
updateConfigSummary();
refreshHistorySummary();
