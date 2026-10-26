import { createHash } from "node:crypto";
import { splitSentences } from "@/lib/pdf/repair";
import { linearizeTable, tableToMarkdown } from "@/lib/pdf/tables";
import { REGION_NAMES, printedLabel, type Block, type BlockType, type ChapterKey, type DocModel, type Kind, type Region, type Section, type TableRow } from "@/lib/pdf/types";

export const CHILD_TOKENS = 280;
export const CHILD_OVERLAP = 40;
export const PARENT_TOKENS = 900;
export const approxTokens = (s: string) => Math.ceil(s.length / 4);
export const textHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** What the model reads: a ~900-token window inside one section. */
export interface Parent {
  id: string;
  sectionId: string;
  type: BlockType;
  text: string;
  pdfStart: number;
  pdfEnd: number;
  tokenCount: number;
  pageBreaks?: { offset: number; page: number }[]; // where a later PDF page begins inside `text` (star-paging)
}

/** What retrieval searches: a ~280-token piece of a parent, carrying its location. */
export interface Chunk {
  id: string;
  parentId: string;
  sectionId: string;
  type: BlockType;
  kind: Kind;
  chapter: ChapterKey;
  region: Region | null;
  boxId: string | null;
  headingPath: string;
  text: string;            // verbatim; citations verify against this
  retrievalText: string;   // heading path + text (+ tables read as prose): embedded and keyword-indexed
  pdfStart: number;
  pdfEnd: number;
  printedStart: string;
  printedEnd: string;
  tokenCount: number;
}

/** The baseline: fixed 1000-character windows over raw page text, no structure, no repair. */
export interface NaiveChunk { id: string; text: string; pdfStart: number; pdfEnd: number; printedStart: string }

interface Unit { text: string; page: number; paraStart: boolean }

export function headingPath(s: Section): string {
  const parts = [...s.path];
  if (s.region) parts[1] = `${parts[1]} (${s.region})`;
  return parts.join(" › ");
}

/** Sentences of a paragraph, each with the PDF page it starts on (paragraphs can cross pages). */
function sentenceUnits(b: Block): Unit[] {
  const out: Unit[] = [];
  let offset = 0;
  splitSentences(b.text).forEach((s, i) => {
    const at = b.text.indexOf(s, offset);
    offset = at >= 0 ? at + s.length : offset;
    const start = at >= 0 ? at : offset;
    let page = b.pdfStart;
    for (const br of b.pageBreaks ?? []) if (br.offset <= start) page = br.page;
    out.push({ text: s, page, paraStart: i === 0 });
  });
  return out;
}

function windows(units: Unit[], target: number, overlap: number): Unit[][] {
  const out: Unit[][] = [];
  let i = 0;
  while (i < units.length) {
    let j = i, tokens = 0;
    while (j < units.length && (j === i || tokens + approxTokens(units[j].text) <= target)) { tokens += approxTokens(units[j].text); j++; }
    out.push(units.slice(i, j));
    if (j >= units.length) break;
    // step back far enough to repeat ~`overlap` tokens
    let back = j, kept = 0;
    while (overlap > 0 && back - 1 > i && kept + approxTokens(units[back - 1].text) <= overlap) { back--; kept += approxTokens(units[back].text); }
    i = back > i ? back : j;
  }
  return out;
}

/** Parents prefer to end at a paragraph boundary once they are past ~60% of the target. */
function parentWindows(units: Unit[]): Unit[][] {
  const out: Unit[][] = [];
  let cur: Unit[] = [];
  let tokens = 0;
  for (const u of units) {
    const t = approxTokens(u.text);
    if (cur.length && (tokens + t > PARENT_TOKENS || (u.paraStart && tokens > 0.6 * PARENT_TOKENS))) { out.push(cur); cur = []; tokens = 0; }
    cur.push(u); tokens += t;
  }
  if (cur.length) out.push(cur);
  return out;
}

const joinUnits = (us: Unit[]) => us.map((u, i) => (i > 0 && u.paraStart ? `\n\n${u.text}` : i > 0 ? ` ${u.text}` : u.text)).join("");

/** Offsets in the joined text where the page changes, for star-paging in the record panel. */
function unitBreaks(us: Unit[]): { offset: number; page: number }[] {
  const out: { offset: number; page: number }[] = [];
  let off = 0;
  us.forEach((u, i) => {
    if (i > 0) off += u.paraStart ? 2 : 1;
    if (i > 0 && u.page !== us[i - 1].page) out.push({ offset: off, page: u.page });
    off += u.text.length;
  });
  return out;
}

export function buildChunks(doc: DocModel): { parents: Parent[]; chunks: Chunk[] } {
  const parents: Parent[] = [];
  const chunks: Chunk[] = [];
  const blocksBySection = new Map<string, Block[]>();
  for (const b of doc.blocks) blocksBySection.set(b.sectionId, [...(blocksBySection.get(b.sectionId) ?? []), b]);

  const addChunk = (p: Parent, s: Section, text: string, retrieval: string, pdfStart: number, pdfEnd: number, region: Region | null = s.region) => {
    const kind: Kind = p.type === "figure" ? (s.kind === "box" ? "box" : "figure") : p.type === "table" ? (s.kind === "statistical_appendix" ? "statistical_appendix" : s.kind === "box" ? "box" : "table") : s.kind;
    const path = headingPath(s);
    chunks.push({
      id: `c${String(chunks.length + 1).padStart(5, "0")}`, parentId: p.id, sectionId: s.id, type: p.type, kind, chapter: s.chapter,
      region, boxId: s.boxId, headingPath: path, text, retrievalText: `${path}${region && region !== s.region ? ` › ${REGION_NAMES[region]} (${region})` : ""}\n${retrieval}`,
      pdfStart, pdfEnd, printedStart: printedLabel(doc, pdfStart), printedEnd: printedLabel(doc, pdfEnd), tokenCount: approxTokens(text),
    });
  };
  const addParent = (s: Section, type: BlockType, text: string, pdfStart: number, pdfEnd: number, pageBreaks?: { offset: number; page: number }[]): Parent => {
    const p: Parent = { id: `p${String(parents.length + 1).padStart(4, "0")}`, sectionId: s.id, type, text, pdfStart, pdfEnd, tokenCount: approxTokens(text), ...(pageBreaks?.length ? { pageBreaks } : {}) };
    parents.push(p);
    return p;
  };

  for (const s of doc.sections) {
    const blocks = blocksBySection.get(s.id) ?? [];
    if (!blocks.length) continue;
    // prose: paragraphs and footnotes, in order, never crossing the section boundary
    const prose = blocks.filter((b) => b.type === "paragraph" || b.type === "footnote").flatMap((b) => {
      const us = sentenceUnits(b);
      if (b.type === "footnote" && us[0]) us[0] = { ...us[0], text: `[Footnote] ${us[0].text}` };
      return us;
    });
    for (const pw of parentWindows(prose)) {
      const p = addParent(s, "paragraph", joinUnits(pw), Math.min(...pw.map((u) => u.page)), Math.max(...pw.map((u) => u.page)), unitBreaks(pw));
      for (const cw of windows(pw, CHILD_TOKENS, CHILD_OVERLAP)) {
        const text = joinUnits(cw).replace(/\n\n/g, " ");
        addChunk(p, s, text, text, Math.min(...cw.map((u) => u.page)), Math.max(...cw.map((u) => u.page)));
      }
    }
    // figures: one element, one parent; split only if long
    for (const b of blocks.filter((x) => x.type === "figure")) {
      const p = addParent(s, "figure", b.text, b.pdfStart, b.pdfEnd);
      if (approxTokens(b.text) <= CHILD_TOKENS * 1.6) addChunk(p, s, b.text, b.text, b.pdfStart, b.pdfEnd);
      else {
        const units = splitSentences(b.text.replace(/\n\n/g, " ")).map((t) => ({ text: t, page: b.pdfStart, paraStart: false }));
        for (const cw of windows(units, CHILD_TOKENS, CHILD_OVERLAP)) addChunk(p, s, `${b.caption}: ${joinUnits(cw)}`, `${b.caption}: ${joinUnits(cw)}`, b.pdfStart, b.pdfEnd);
      }
    }
    // tables: parent = the table (split by row groups when large); children = runs of rows within one region
    for (const b of blocks.filter((x) => x.type === "table")) {
      if (!b.table) {
        const p = addParent(s, "table", b.text, b.pdfStart, b.pdfEnd);
        const units = b.text.split("\n").map((t) => ({ text: t, page: b.pdfStart, paraStart: false }));
        for (const cw of windows(units, CHILD_TOKENS, 0)) addChunk(p, s, cw.map((u) => u.text).join("\n"), `${b.caption}\n${cw.map((u) => u.text).join("\n")}`, b.pdfStart, b.pdfEnd);
        continue;
      }
      const t = b.table;
      const notes = t.notes.join(" ").replace(/\s+/g, " ").trim();
      const groups = splitRows(t.rows, 30);
      for (const g of groups) {
        const parentText = `${tableToMarkdown(t, g)}${notes ? `\n\n${notes}` : ""}`;
        const p = addParent(s, "table", parentText, b.pdfStart, b.pdfEnd);
        for (const rows of splitRows(g, 12)) {
          const region = rows.every((r) => r.region === rows[0].region) ? rows[0].region : s.region;
          addChunk(p, s, tableToMarkdown(t, rows), `${t.caption}${t.subtitle ? ` ${t.subtitle}` : ""}\n${linearizeTable(t, rows).join("\n")}`, b.pdfStart, b.pdfEnd, region ?? s.region);
        }
      }
    }
  }
  return { parents, chunks };
}

/** Split table rows into runs of at most `max`, breaking where the region changes so each run has one region. */
function splitRows(rows: TableRow[], max: number): TableRow[][] {
  const out: TableRow[][] = [];
  let cur: TableRow[] = [];
  for (const r of rows) {
    if (cur.length && (cur.length >= max || r.region !== cur[cur.length - 1].region)) { out.push(cur); cur = []; }
    cur.push(r);
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * The naive baseline the field guide starts from: raw page text in content-stream order (running heads,
 * chart labels and ligatures included), cut every 1000 characters with a 200-character overlap.
 */
export function buildNaiveChunks(pages: { page: number; text: string }[], printed: string[], size = 1000, overlap = 200): NaiveChunk[] {
  let all = "";
  const starts: { offset: number; page: number }[] = [];
  for (const p of pages) { starts.push({ offset: all.length, page: p.page }); all += `${p.text}\n`; }
  const pageAt = (off: number) => { let pg = 1; for (const s of starts) if (s.offset <= off) pg = s.page; return pg; };
  const out: NaiveChunk[] = [];
  for (let i = 0; i < all.length; i += size - overlap) {
    const text = all.slice(i, i + size).trim();
    if (!text) continue;
    const a = pageAt(i), b = pageAt(Math.min(all.length - 1, i + size));
    out.push({ id: `n${String(out.length + 1).padStart(5, "0")}`, text, pdfStart: a, pdfEnd: b, printedStart: printed[a - 1] || `PDF ${a}` });
  }
  return out;
}
