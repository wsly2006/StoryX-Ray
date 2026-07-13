// 章节切分：先按章节头正则识别，识别不到再按大小切
// 输出统一为 [{title, text}]，text 是章节正文（含章节头），供后续抽取直接用
// 挂到 window.Chapters，index.html 里作为普通 <script> 加载

(function () {
  // 匹配中文常见章节头：
  //   第X章 / 第X回 / 第X节 / 第X卷 / 第X篇 / Chapter N
  //   序章 / 楔子 / 引子 / 前言 / 尾声 / 后记 / 番外
  // 章节头必须独占一行，前后允许空白/全角空格；标题可有可无
  const CHAPTER_HEADER_RE = new RegExp(
    '^[\\s\\u3000]*(' +
      '第[一二三四五六七八九十百千零〇两0-9]+[章回节卷篇集部]' +
      '|Chapter\\s+[0-9IVXLCDM]+' +
      '|序章|楔子|引子|前言|尾声|后记|番外(?:篇)?' +
    ')' +
    '[\\s\\u3000]*(.{0,80})$',
    'i'
  );

  // 最少要识别到 2 处才算是"有章节"，否则误伤（比如"第一节课上"之类的正文）
  const MIN_HEADERS_TO_TRUST = 2;

  const DEFAULT_CHUNK_CHARS = 8000;

  function detectChapters(input) {
    const text = (input || '').replace(/\r\n?/g, '\n');
    if (!text.trim()) return null;

    const lines = text.split('\n');
    const heads = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(CHAPTER_HEADER_RE);
      if (!m) continue;
      // 章节头行本身通常较短（<80 字），前一行常为空
      const prevBlank = i === 0 || !lines[i - 1].trim();
      if (!prevBlank && lines[i].length > 80) continue;
      heads.push({
        line: i,
        marker: m[1].trim(),
        title: (m[2] || '').trim(),
      });
    }

    if (heads.length < MIN_HEADERS_TO_TRUST) return null;

    const chapters = [];
    // 章节头之前的内容单独作为"前言"章节
    if (heads[0].line > 0) {
      const preamble = lines.slice(0, heads[0].line).join('\n').trim();
      if (preamble) chapters.push({ title: '前言', text: preamble });
    }

    for (let i = 0; i < heads.length; i++) {
      const cur = heads[i];
      const nextLine = i + 1 < heads.length ? heads[i + 1].line : lines.length;
      const body = lines.slice(cur.line, nextLine).join('\n').trim();
      if (!body) continue;
      const title = cur.title ? `${cur.marker} ${cur.title}`.trim() : cur.marker;
      chapters.push({ title, text: body });
    }

    return chapters.length >= MIN_HEADERS_TO_TRUST ? chapters : null;
  }

  function splitBySize(input, chunkChars) {
    chunkChars = chunkChars || DEFAULT_CHUNK_CHARS;
    const text = (input || '').replace(/\r\n?/g, '\n').trim();
    if (!text) return [];
    if (text.length <= chunkChars) return [{ title: '全文', text }];

    const chunks = [];
    let start = 0;
    let idx = 1;
    while (start < text.length) {
      let end = Math.min(start + chunkChars, text.length);
      if (end < text.length) {
        const win = text.slice(start, end);
        const paragraphBreak = win.lastIndexOf('\n\n');
        const sentenceBreak = Math.max(
          win.lastIndexOf('。'),
          win.lastIndexOf('！'),
          win.lastIndexOf('？'),
          win.lastIndexOf('.')
        );
        // 在窗口后半段找到断点才用，避免切得过短
        const cut = paragraphBreak > chunkChars * 0.5 ? paragraphBreak
                  : sentenceBreak > chunkChars * 0.5 ? sentenceBreak + 1
                  : win.length;
        end = start + cut;
      }
      const body = text.slice(start, end).trim();
      if (body) chunks.push({ title: `第 ${idx} 段`, text: body });
      start = end;
      idx++;
    }
    return chunks;
  }

  /**
   * 综合入口：先章节切，切不到就按大小切。返回 {mode, chapters}
   *   mode ∈ "single" | "chapter" | "size"
   */
  function splitText(text, opts) {
    opts = opts || {};
    const singleThreshold = opts.singleThreshold || DEFAULT_CHUNK_CHARS;
    const chunkChars = opts.chunkChars || DEFAULT_CHUNK_CHARS;

    const clean = (text || '').replace(/\r\n?/g, '\n').trim();
    if (!clean) return { mode: 'single', chapters: [] };

    const byChapter = detectChapters(clean);
    if (byChapter && byChapter.length >= MIN_HEADERS_TO_TRUST) {
      return { mode: 'chapter', chapters: byChapter };
    }

    if (clean.length <= singleThreshold) {
      return { mode: 'single', chapters: [{ title: '全文', text: clean }] };
    }

    return { mode: 'size', chapters: splitBySize(clean, chunkChars) };
  }

  window.Chapters = { detectChapters, splitBySize, splitText, DEFAULT_CHUNK_CHARS };
})();
