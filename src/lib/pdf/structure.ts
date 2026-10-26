import type { Extracted, Run } from "./extract";
import { buildLines, type Line } from "./lines";
import { appendLine, normalizeText, Vocabulary } from "./repair";
import { rebuildTable, tableToMarkdown } from "./tables";
import { CHAPTER_TITLES, REGION_NAMES, REGIONS, type Block, type ChapterKey, type DocModel, type Kind, type Region, type Section } from "./types";

/**
 * This report's typography (measured with `npm run inspect -- --fonts`):
 *   body            AGaramondPro 11 (main flow) · 10.6 (boxes) · Italic 11 at a chapter's start = chapter summary
 *   h1              HelveticaLTStd-Bold 16 ("South Asia", "Summary", "ANNEX 3.1 …", "References")
 *   h1 (Ch. 2)      HelveticaLTStd-Bold 14 ("Recent developments", "Outlook", "Risks" of the overview)
 *   h2              HelveticaLTStd-Roman 11 ("Recent developments", "Outlook")
 *   h3              AGaramondPro-BoldItalic ≤ 11, short ("Downside risks")
 *   caption         HelveticaLTStd-Bold ≥ 9.5 starting TABLE / FIGURE / BOX
 *   figure text     HelveticaLTStd-Obl 8 (subtitle) · Bold 7 (panel titles) · Roman/Obl 6 (sources, notes)
 *   table cells     HelveticaLTStd 7.6 (+ 4.6 superscripts) · Roman 8 subtitle
 *   chart labels    Helvetica (non-LTStd) and other small fonts → dropped
 *   running heads   HelveticaLTStd-Light 7 · folio HelveticaLTStd-Bold 8 at the page edge
 *   footnotes       AGaramondPro ≤ 8.5
 */
type Role = "running" | "folio" | "title" | "h1" | "h2" | "h3" | "caption" | "figtext" | "tablecell" | "subtitle" | "note" | "body" | "footnote" | "drop";

const isLT = (f: string) => f.startsWith("HelveticaLTStd");
const near = (a: number, b: number, tol = 0.25) => Math.abs(a - b) <= tol;

export function classify(l: Line): Role {
  const f = l.font, s = l.size, t = l.text;
  if (f === "HelveticaLTStd-Light" && near(s, 7, 0.3)) return "running";
  if (f === "HelveticaLTStd-Bold" && near(s, 8, 0.3) && (l.y > 735 || l.y < 50) && /^[0-9ivxlc]+$/i.test(t)) return "folio";
  if ((f.startsWith("AGaramondPro") || f.startsWith("MinionPro")) && s >= 25) return "title";
  if (f === "HelveticaLTStd-Cond" && s >= 20) return "title";
  if (f === "HelveticaLTStd-Bold" && s >= 9.5 && /^(TABLE|FIGURE|BOX)\s+[A-Z]?\d/.test(t)) return "caption";
  if (f === "HelveticaLTStd-Bold" && near(s, 16, 0.6)) return "h1";
  if (f === "HelveticaLTStd-Bold" && near(s, 14, 0.6)) return "h1";
  if (f === "HelveticaLTStd-Roman" && near(s, 11, 0.4) && t.length < 90 && !/[.,;]$/.test(t)) return "h2";
  if (f.startsWith("AGaramondPro-BoldItalic") && s >= 9.9 && s <= 11.2 && t.length < 85 && !/[.;,]$/.test(t)) return "h3";
  if (isLT(f) && near(s, 7.6, 0.3)) return "tablecell";
  if (isLT(f) && s <= 5 && s >= 4.2) return "tablecell"; // superscript markers inside tables
  if (f === "HelveticaLTStd-Roman" && near(s, 8, 0.3)) return "subtitle";
  if (f === "HelveticaLTStd-Obl" && near(s, 8, 0.3)) return "figtext";
  if (f === "HelveticaLTStd-Bold" && near(s, 7, 0.3)) return "figtext";
  if (isLT(f) && near(s, 6, 0.4)) return "note";
  if (f.startsWith("AGaramondPro") && s >= 7.4 && s <= 8.6) return "footnote";
  if ((f.startsWith("AGaramondPro") || f.startsWith("Andes")) && s >= 9.5) return "body";
  return "drop";
}

interface Caption { line: Line; kind: "table" | "figure"; id: string; title: string; flow: Flow; members: Line[] }
type Flow = "main" | "box";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

function regionOf(title: string): Region | null {
  const t = title.toLowerCase().replace(/\s+/g, " ");
  for (const r of REGIONS) if (t === REGION_NAMES[r].toLowerCase()) return r;
  return null;
}

export function buildDocModel(ex: Extracted): DocModel {
  const warnings: string[] = [];
  const pagesLines = ex.pages.map((p) => buildLines(p));

  // ---- printed page labels from folios -----------------------------------------------------------
  const printed = pagesLines.map((ls) => ls.find((l) => classify(l) === "folio")?.text ?? "");
  for (let i = 0; i < printed.length; i++) {
    if (!printed[i] && i + 1 >= 23) printed[i] = String(i + 1 - 22); // chapter pages are offset by 22
  }

  // ---- chapter page ranges from the bookmarks, checked against title pages ------------------------
  const find = (re: RegExp) => ex.outline.find((o) => re.test(o.title))?.page ?? -1;
  const starts = { ES: find(/^Executive Summary/), "1": find(/^Ch\. 1/), "2": find(/^Ch\. 2/), "3": find(/^Ch\. 3/), "4": find(/^Ch\. 4/), SA: find(/^Statistical/) };
  for (const [k, v] of Object.entries(starts)) if (v < 0) warnings.push(`bookmark for ${k} not found`);
  let conventionsPage = Infinity;
  const frontTitleAt = new Map<number, string>();
  pagesLines.forEach((ls, i) => {
    for (const l of ls) {
      if (l.font === "HelveticaLTStd-Cond" && l.size >= 20) frontTitleAt.set(i + 1, l.text);
      if (classify(l) === "h1" && /^Data and Forecast Conventions/.test(l.text)) conventionsPage = Math.min(conventionsPage, i + 1);
    }
  });
  const abbreviationsPage = [...frontTitleAt.entries()].find(([, t]) => /^Abbreviations/.test(t))?.[0] ?? starts["1"];
  const chapterOf = (p: number): ChapterKey => {
    if (p >= conventionsPage) return "BM";
    if (p >= starts.SA) return "SA";
    if (p >= starts["4"]) return "4";
    if (p >= starts["3"]) return "3";
    if (p >= starts["2"]) return "2";
    if (p >= starts["1"]) return "1";
    if (p >= starts.ES && p < abbreviationsPage) return "ES";
    return "FM";
  };

  // ---- boxes: every page of a box carries its caption ("… (continued)") ---------------------------
  const boxOnPage = new Map<number, { id: string; title: string; captionY: number }>();
  pagesLines.forEach((ls, i) => {
    for (const l of ls) {
      const m = classify(l) === "caption" ? /^BOX\s+(\d+\.\d+)\s+(.+?)(\s+\(continued\))?$/.exec(normalizeText(l.text)) : null;
      if (m) boxOnPage.set(i + 1, { id: m[1], title: m[2], captionY: l.y });
    }
  });

  // ---- vocabulary for hyphen repair ----------------------------------------------------------------
  const vocab = new Vocabulary();
  for (const ls of pagesLines) for (const l of ls) if (classify(l) === "body") vocab.add(normalizeText(l.text));

  // ---- sections ------------------------------------------------------------------------------------
  const sections: Section[] = [];
  const blocks: Block[] = [];
  const ids = new Set<string>();
  const byId = new Map<string, Section>();
  const newSection = (parent: Section | null, title: string, level: number, kind: Kind, page: number, extra: Partial<Section> = {}): Section => {
    let id = parent ? `${parent.id}/${slug(title)}` : slug(title);
    for (let n = 2; ids.has(id); n++) id = `${parent ? `${parent.id}/` : ""}${slug(title)}-${n}`;
    ids.add(id);
    const s: Section = {
      id, parentId: parent?.id ?? null, level, title, path: [...(parent?.path ?? []), title],
      chapter: extra.chapter ?? parent?.chapter ?? "FM", region: extra.region !== undefined ? extra.region : parent?.region ?? null,
      boxId: extra.boxId !== undefined ? extra.boxId : parent?.boxId ?? null, kind, pdfStart: page, pdfEnd: page,
    };
    sections.push(s); byId.set(id, s);
    return s;
  };
  const touch = (s: Section, page: number) => {
    for (let cur: Section | undefined = s; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      cur.pdfStart = Math.min(cur.pdfStart, page);
      cur.pdfEnd = Math.max(cur.pdfEnd, page);
    }
  };

  let chapter: ChapterKey | null = null;
  let chapterRoot: Section | null = null;
  let seenH1InChapter = false;
  const stacks: Record<Flow, Section[]> = { main: [], box: [] };
  let currentBoxId: string | null = null;

  // paragraphs in progress, one per flow
  type Para = { section: Section; text: string; start: number; end: number; lastY: number; lastX: number; size: number; type: "paragraph" | "footnote"; breaks: { offset: number; page: number }[] };
  const paras: Record<Flow, Para | null> = { main: null, box: null };
  const skipNote: Record<Flow, boolean> = { main: false, box: false };
  let blockSeq = 0;
  const pushBlock = (b: Omit<Block, "id">) => {
    const text = b.text.trim();
    if (!text) return;
    blocks.push({ ...b, text, id: `b${String(++blockSeq).padStart(5, "0")}` });
    touch(byId.get(b.sectionId)!, b.pdfStart);
    touch(byId.get(b.sectionId)!, b.pdfEnd);
  };
  const flush = (flow: Flow) => {
    const p = paras[flow];
    if (p && p.text.trim()) {
      if (p.type === "footnote") {
        for (const item of splitFootnotes(p.text)) pushBlock({ sectionId: p.section.id, type: "footnote", text: item, pdfStart: p.start, pdfEnd: p.end });
      } else pushBlock({ sectionId: p.section.id, type: "paragraph", text: p.text, pdfStart: p.start, pdfEnd: p.end, ...(p.breaks.length ? { pageBreaks: p.breaks } : {}) });
    }
    paras[flow] = null;
  };
  const top = (flow: Flow) => stacks[flow][stacks[flow].length - 1] ?? chapterRoot!;

  const openChapter = (key: ChapterKey, page: number) => {
    flush("main"); flush("box");
    chapter = key;
    seenH1InChapter = false;
    const kind: Kind = key === "ES" ? "executive_summary" : key === "SA" ? "statistical_appendix" : key === "BM" ? "back_matter" : key === "FM" ? "front_matter" : "body";
    chapterRoot = newSection(null, CHAPTER_TITLES[key], 0, kind, page, { chapter: key, region: null, boxId: null });
    stacks.main = [chapterRoot];
    stacks.box = [];
    currentBoxId = null;
  };
  const openHeading = (flow: Flow, title: string, level: number, page: number) => {
    flush(flow);
    const stack = stacks[flow];
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1];
    let kind: Kind = parent.kind === "chapter_summary" ? "body" : parent.kind;
    let region: Region | null | undefined;
    if (/^References$/i.test(title)) { kind = "references"; region = null; }
    else if (/^ANNEX\s+\d/i.test(title)) { kind = "annex"; region = null; }
    else if (chapter === "SA") kind = "statistical_appendix";
    else if (chapter === "BM") kind = /Selected|Publications/i.test(title) ? "references" : "back_matter";
    if (chapter === "2" && level === 1 && flow === "main") region = regionOf(title);
    if (flow === "main" && level === 1 && parent === chapterRoot && kind === "body" && chapterRoot && chapterRoot.kind !== "body") kind = chapterRoot.kind;
    const s = newSection(parent, title, level, kind, page, region !== undefined ? { region } : {});
    stack.push(s);
    return s;
  };

  for (let pi = 0; pi < pagesLines.length; pi++) {
    const page = pi + 1;
    const key = chapterOf(page);
    if (key !== chapter) openChapter(key, page);
    if (chapter === "FM" || chapter === "BM") {
      const t = frontTitleAt.get(page);
      if (t && chapterRoot) {
        flush("main");
        const kind: Kind = /^Foreword/i.test(t) ? "foreword" : chapter === "BM" ? "back_matter" : "front_matter";
        stacks.main = [chapterRoot, newSection(chapterRoot, t, 1, kind, page)];
      }
      if (chapter === "BM" && page === ex.pageCount) {
        flush("main");
        stacks.main = [chapterRoot!, newSection(chapterRoot!, "Back cover", 1, "back_matter", page)];
      }
    }

    const lines = pagesLines[pi];
    const roles = lines.map(classify);

    // ---- box geometry on this page --------------------------------------------------------------
    const box = boxOnPage.get(page);
    let boxMinY = Infinity;
    if (box) {
      if (currentBoxId !== box.id) {
        flush("box");
        currentBoxId = box.id;
        const boxRoot = newSection(chapterRoot, `Box ${box.id}: ${box.title}`, 1, "box", page, { boxId: box.id, region: null });
        stacks.box = [boxRoot];
      }
      for (let i = 0; i < lines.length; i++) if (roles[i] === "body" && near(lines[i].size, 10.6, 0.25)) boxMinY = Math.min(boxMinY, lines[i].y);
      if (boxMinY === Infinity) boxMinY = 0; // a page that is all figure
    } else if (currentBoxId) {
      flush("box");
      currentBoxId = null;
      stacks.box = [];
    }
    const flowOf = (l: Line, role: Role): Flow => {
      if (!box) return "main";
      if (role === "body") return near(l.size, 10.6, 0.25) ? "box" : "main";
      if (role === "footnote" || role === "h1" || role === "h2" || role === "h3") return l.y >= boxMinY - 25 && l.y <= box.captionY + 2 ? "box" : "main";
      return "main";
    };

    // ---- captions and the figure/table lines that belong to them ---------------------------------
    const captions: Caption[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (roles[i] !== "caption") continue;
      const text = normalizeText(lines[i].text);
      const m = /^(TABLE|FIGURE)\s+([A-Z]?[\d.]+)\s*(.*)$/.exec(text);
      if (!m) continue; // BOX captions are handled above
      const id = m[2].replace(/\.$/, "");
      captions.push({ line: lines[i], kind: m[1] === "TABLE" ? "table" : "figure", id, title: m[3], flow: /^B/.test(id) ? "box" : "main", members: [] });
    }
    // the Statistical Appendix tables have a heading instead of a TABLE caption
    if (chapter === "SA") {
      const h = lines.find((l, i) => roles[i] === "h1");
      if (h && lines.some((_, i) => roles[i] === "tablecell")) captions.push({ line: h, kind: "table", id: `SA-${printed[pi] || page}`, title: normalizeText(h.text), flow: "main", members: [] });
    }
    const ownerOf = (l: Line): Caption | null => {
      let best: Caption | null = null, bestDy = Infinity;
      for (const c of captions) {
        const dy = c.line.y - l.y;
        if (dy < -4) continue;
        const overlap = l.x0 >= c.line.x0 - 40;
        const score = dy + (overlap ? 0 : 400);
        if (score < bestDy) { bestDy = score; best = c; }
      }
      return best;
    };

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const role = roles[i];
      if (role === "running" || role === "folio" || role === "drop" || role === "title" || role === "caption") continue;
      if (role === "tablecell" || role === "figtext" || role === "note" || role === "subtitle") {
        const c = ownerOf(l);
        if (c) c.members.push(l);
        continue;
      }
      if (chapter === "SA" && role === "h1" && captions.some((c) => c.line === l)) continue;

      const flow = flowOf(l, role);
      if (flow === "box" && !stacks.box.length) continue;
      const text = normalizeText(l.text);
      if (!text) continue;

      if (role === "h1" || role === "h2" || role === "h3") {
        // a heading that wraps onto a second line continues the previous heading
        const prev = i > 0 ? lines[i - 1] : null;
        const st = stacks[flow];
        const last = st[st.length - 1];
        const level = role === "h1" ? 1 : role === "h2" ? 2 : 3;
        if (prev && roles[i - 1] === role && prev.y - l.y < 1.6 * l.size && last && last.level === level && !paras[flow]) {
          last.title = `${last.title} ${text}`;
          last.path[last.path.length - 1] = last.title;
          if (chapter === "2" && level === 1 && flow === "main") last.region = regionOf(last.title);
          continue;
        }
        if (flow === "main" && role === "h1") seenH1InChapter = true;
        if (flow === "main" && /^Data and Forecast Conventions/.test(text)) continue;
        openHeading(flow, text, level, page);
        continue;
      }

      const isFootnote = role === "footnote";
      // author notes ("Note: This chapter was prepared by …") wrap over several lines and carry no content
      if (isFootnote) {
        if (/Note:\s+This (chapter|box) was (prepared|written)/.test(text)) { skipNote[flow] = true; continue; }
        if (skipNote[flow] && !/^(\d{1,2}|[a-h])\.?\s+[A-Z]/.test(text)) continue;
      }
      skipNote[flow] = false;

      // chapter summary: the italic opening of a chapter, before its first h1
      if (flow === "main" && !isFootnote && ["1", "2", "3", "4"].includes(chapter!) && !seenH1InChapter && l.font.includes("Italic") && near(l.size, 11, 0.3)) {
        const t = top("main");
        if (t.kind !== "chapter_summary") { flush("main"); stacks.main = [chapterRoot!, newSection(chapterRoot, "Chapter summary", 1, "chapter_summary", page)]; }
      }

      const type = isFootnote ? "footnote" : "paragraph";
      const p = paras[flow];
      const section = top(flow);
      if (p && p.type === type && p.section === section) {
        const samePage = p.end === page;
        const sameColumn = Math.abs(p.lastX - l.x0) < 30;
        const gap = p.lastY - l.y;
        const endsSentence = /[.:!?]["”’)]?$/.test(p.text);
        const bullet = /^[•▪●]/.test(text);
        let newPara: boolean;
        if (type === "footnote") newPara = /^(\d{1,2}|[a-h])\.?\s+[A-Z]/.test(text);
        else if (bullet) newPara = true;
        else if (samePage && sameColumn && gap > 0 && gap < 1.5 * l.size) newPara = false;
        else if (samePage && sameColumn && gap > 0) newPara = true;           // blank-line gap
        else newPara = endsSentence && /^[A-Z“"(]/.test(text);                 // column or page change
        if (!newPara) {
          if (page !== p.end) p.breaks.push({ offset: p.text.length + 1, page });
          p.text = appendLine(p.text, text, vocab);
          p.end = page; p.lastY = l.y; p.lastX = l.x0;
          continue;
        }
        flush(flow);
      } else if (p) {
        flush(flow);
      }
      paras[flow] = { section, text, start: page, end: page, lastY: l.y, lastX: l.x0, size: l.size, type, breaks: [] };
    }

    // ---- emit this page's figures and tables -----------------------------------------------------
    for (const c of captions) {
      const flow: Flow = c.flow === "box" && stacks.box.length ? "box" : "main";
      const section = top(flow);
      const caption = c.kind === "table" && c.id.startsWith("SA-") ? `Statistical Appendix — ${c.title} (p. ${printed[pi]})` : `${c.kind === "table" ? "Table" : "Figure"} ${c.id} ${c.title}`.trim();
      if (c.kind === "table") {
        const runs: Run[] = c.members.filter((m) => classify(m) !== "subtitle" || !/^\(/.test(m.text)).flatMap((m) => m.runs);
        const subtitle = c.members.find((m) => classify(m) === "subtitle" && /^\(/.test(m.text))?.text ?? null;
        const table = rebuildTable(c.id, caption, runs, { subtitle: subtitle ? normalizeText(subtitle) : null, region: section.region });
        if (!table.rows.length) warnings.push(`table ${c.id} on PDF ${page}: no year columns, kept as text`);
        const notes = table.notes.join(" ").replace(/\s+/g, " ").trim();
        if (table.rows.length) {
          pushBlock({ sectionId: section.id, type: "table", text: `${tableToMarkdown(table)}${notes ? `\n\n${notes}` : ""}`, pdfStart: page, pdfEnd: page, caption, table });
        } else {
          // no year columns (country lists, regression output): keep the text, top to bottom, so it is still searchable
          const rowsText = [...c.members].sort((a, b) => b.y - a.y || a.x0 - b.x0).map((m) => normalizeText(m.text)).join("\n");
          pushBlock({ sectionId: section.id, type: "table", text: `${caption}\n${rowsText}`, pdfStart: page, pdfEnd: page, caption });
        }
      } else {
        const subtitle = c.members.filter((m) => m.font === "HelveticaLTStd-Obl" && near(m.size, 8)).map((m) => normalizeText(m.text));
        const panels = c.members.filter((m) => m.font === "HelveticaLTStd-Bold" && near(m.size, 7)).map((m) => normalizeText(m.text));
        const notes = c.members.filter((m) => classify(m) === "note").map((m) => normalizeText(m.text));
        let sub = "";
        for (const s of subtitle) sub = appendLine(sub, s, vocab);
        const text = [caption, sub, panels.length ? `Panels: ${mergePanels(panels).join("; ")}` : "", notes.join(" ")].filter(Boolean).join("\n\n");
        pushBlock({ sectionId: section.id, type: "figure", text, pdfStart: page, pdfEnd: page, caption });
      }
    }
  }
  flush("main"); flush("box");

  // drop sections that hold nothing, so the outline only shows real places
  const used = new Set<string>();
  for (const b of blocks) for (let s: Section | undefined = byId.get(b.sectionId); s; s = s.parentId ? byId.get(s.parentId) : undefined) used.add(s.id);
  const kept = sections.filter((s) => used.has(s.id));
  return { hash: ex.hash, pageCount: ex.pageCount, printed, sections: kept, blocks, warnings };
}

/** Panel titles wrap ("B. Share of economies and GDP with" / "potential growth…"); rejoin lines that don't start with "X." */
function mergePanels(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (/^[A-H]\.\s/.test(l) || !out.length) out.push(l);
    else out[out.length - 1] = `${out[out.length - 1]} ${l}`;
  }
  return out;
}

/** "1 Debt refers to …" / "a. These events …" → one item each; author notes ("This chapter was prepared by") are dropped. */
function splitFootnotes(text: string): string[] {
  return text
    .split(/\s(?=(?:\d{1,2}|[a-h])\.?\s+[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s && !/Note:\s+This (chapter|box) was (prepared|written)/.test(s));
}
