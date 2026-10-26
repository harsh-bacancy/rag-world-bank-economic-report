import type { Run } from "./extract";
import { normalizeText } from "./repair";
import { REGION_NAMES, REGIONS, type Region, type TableColumn, type TableData, type TableRow } from "./types";

/**
 * Rebuild a forecast table from positioned runs. Text extraction outputs cells in reading order, which
 * loses which value belongs to which column. Here:
 *  - a row is a cluster of tokens on one baseline;
 *  - a header row is one with ≥ 3 year-like tokens (2026f, 2026/27f, 25Q4); its x positions are the column anchors,
 *    and a later header row (fiscal-year groups) relabels the columns without moving them;
 *  - columns right of "Percentage-point differences" / "Level differences" are revisions, not levels;
 *  - superscript footnote markers (size < 6) are dropped from labels.
 */
interface Token { text: string; x: number; xEnd: number; y: number; size: number; bold: boolean }

const YEARISH = /^(\d{4}(\/\d{2})?[ef]?|\d{2}Q\d[ef]?)$/;
const NUMERIC = /^([-−–]?\d+(\.\d+)?|\.\.)$/;

function tokenize(runs: Run[]): Token[] {
  const out: Token[] = [];
  for (const r of runs) {
    const text = normalizeText(r.text);
    if (!text) continue;
    // a run may hold several cells ("2.8 2.9 2.9"); estimate each token's x from its character offset
    const parts = [...text.matchAll(/\S+/g)];
    const len = Math.max(1, text.length);
    for (const p of parts) {
      const x = r.x + (r.w * (p.index ?? 0)) / len;
      out.push({ text: p[0], x, xEnd: x + (r.w * p[0].length) / len, y: r.y, size: r.size, bold: /Bold/.test(r.font) });
    }
  }
  return out;
}

function clusterRows(tokens: Token[]): Token[][] {
  const sorted = [...tokens].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Token[][] = [];
  for (const t of sorted) {
    const row = rows[rows.length - 1];
    // superscripts sit ~2pt above their baseline; tolerate that
    if (row && Math.abs(row[0].y - t.y) <= 2.6) row.push(t);
    else rows.push([t]);
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x));
}

export function regionFromLabel(label: string): Region | null {
  const l = label.toLowerCase();
  for (const r of REGIONS) {
    if (l.startsWith(REGION_NAMES[r].toLowerCase())) return r;
    if (new RegExp(`\\b(emde )?${r.toLowerCase()}\\b`).test(l) && /emde|excl|gdp/.test(l)) return r;
  }
  return null;
}

export function rebuildTable(id: string, caption: string, runs: Run[], opts: { subtitle?: string | null; region?: Region | null } = {}): TableData {
  const notes: string[] = [];
  const cellRuns: Run[] = [];
  let revisionX = Infinity;
  for (const r of runs) {
    const t = normalizeText(r.text);
    if (!t) continue;
    if (/^(Percentage-point differences|Level differences)/i.test(t)) { revisionX = Math.min(revisionX, r.x - 15); continue; }
    if (/^from January \d{4} projections$/i.test(t) || /^\d{4} projections$/.test(t) || /^differences from January/i.test(t)) continue;
    if (r.size <= 6.5 && r.size >= 5.5 && /Helvetica/.test(r.font)) { notes.push(t); continue; }
    cellRuns.push(r);
  }

  const rows = clusterRows(tokenize(cellRuns));
  let anchors: { x: number; label: string }[] = [];
  const out: TableRow[] = [];
  let group: string | null = null;
  let region: Region | null = opts.region ?? null;
  let pendingLabel: string[] = [];
  let lastRowY = Infinity;
  let columns: TableColumn[] = [];
  let headerLabels: string[] = [];

  const isSup = (t: Token) => t.size < 6;
  for (const row of rows) {
    const years = row.filter((t) => YEARISH.test(t.text) && !isSup(t));
    if (years.length >= 3) {
      const relabel = anchors.length > 0;
      if (!relabel) {
        anchors = years.map((t) => ({ x: (t.x + t.xEnd) / 2, label: t.text }));
        columns = anchors.map((a, i) => ({ label: a.label, isRevision: a.x > revisionX || anchors.slice(0, i).some((b) => b.label === a.label) }));
        headerLabels = anchors.map((a) => a.label);
      } else {
        // a fiscal-year group header: same columns, new year labels; keep it as a group label too
        for (const t of years) {
          const k = nearest(anchors, (t.x + t.xEnd) / 2);
          if (k >= 0) anchors[k].label = t.text;
        }
      }
      const words = row.filter((t) => !YEARISH.test(t.text) && !isSup(t)).map((t) => t.text).join(" ");
      if (relabel) group = words || (group ?? "").replace(/ \(continued\)$/, "") + " (continued)";
      else if (words) group = words;
      pendingLabel = [];
      lastRowY = row[0].y;
      continue;
    }
    if (!anchors.length) continue; // title lines above the header

    const firstAnchor = Math.min(...anchors.map((a) => a.x));
    const values: (string | null)[] = anchors.map(() => null);
    const labelParts: string[] = [];
    for (const t of row) {
      if (isSup(t)) continue;
      const cx = (t.x + t.xEnd) / 2;
      if (NUMERIC.test(t.text) && cx > firstAnchor - 22) {
        const k = nearest(anchors, cx);
        if (k >= 0 && values[k] === null) values[k] = t.text.replace(/[−–]/g, "-");
        continue;
      }
      labelParts.push(t.text);
    }
    let label = labelParts.join(" ").replace(/\s+\d(\s+\d)*$/, "").trim();
    const hasValues = values.some((v) => v !== null);
    if (!hasValues) {
      // the second half of a label that wraps around its values row ("Emerging market and / developing economies")
      if (label && out.length && lastRowY - row[0].y < 7 && /^[a-z]/.test(label)) {
        out[out.length - 1].label = `${out[out.length - 1].label} ${label}`;
        lastRowY = row[0].y;
        continue;
      }
      // a group header ("Calendar-year basis", "Memo items: GDP") or the first half of a wrapped label
      if (label) {
        if (lastRowY - row[0].y < 11 && pendingLabel.length) pendingLabel.push(label);
        else pendingLabel = [label];
      }
      lastRowY = row[0].y;
      continue;
    }
    if (!label && pendingLabel.length) label = pendingLabel.join(" ");
    else if (pendingLabel.length && row[0].y - 0 > 0 && lastRowY - row[0].y < 11 && /^[a-z(]/.test(label)) label = `${pendingLabel.join(" ")} ${label}`;
    else if (pendingLabel.length) group = pendingLabel.join(" ");
    pendingLabel = [];
    const r = regionFromLabel(label);
    if (r) region = r;
    if (/^memo/i.test(group ?? "") && !r && !opts.region) region = null;
    const labels = anchors.map((a) => a.label);
    out.push({ label: label || "(unlabelled)", group, region, values, ...(labels.join() !== headerLabels.join() ? { labels } : {}) });
    lastRowY = row[0].y;
  }
  // a trailing label-only line just after a values row completes a wrapped label ("Emerging market and / developing economies")
  return { id, caption, subtitle: opts.subtitle ?? null, columns, rows: out, notes };
}

function nearest(anchors: { x: number }[], x: number): number {
  let best = -1, dist = Infinity;
  anchors.forEach((a, i) => { const d = Math.abs(a.x - x); if (d < dist) { dist = d; best = i; } });
  return dist <= 30 ? best : -1;
}

const colLabel = (c: TableColumn, label = c.label) => (c.isRevision ? `Δ${label} vs Jan-2026` : label);
const rowLabels = (t: TableData, r: TableRow) => r.labels ?? t.columns.map((c) => c.label);

/** Markdown rendering: what the model reads and what citations verify against. */
export function tableToMarkdown(t: TableData, rows = t.rows): string {
  const head = `| ${t.subtitle ? t.subtitle.replace(/\|/g, "/") : ""} | ${t.columns.map((c) => colLabel(c)).join(" | ")} |`;
  const sep = `|---|${t.columns.map(() => "---").join("|")}|`;
  const lines = [`${t.caption}`, head, sep];
  let g: string | null = null;
  let labels = t.columns.map((c) => c.label).join();
  for (const r of rows) {
    const own = rowLabels(t, r);
    if ((r.group && r.group !== g) || own.join() !== labels) {
      // a group whose columns are relabelled (fiscal years) repeats the labels in its group row
      const cells = own.join() !== t.columns.map((c) => c.label).join() ? own.map((l, i) => colLabel(t.columns[i], l)) : t.columns.map(() => " ");
      lines.push(`| *${r.group ?? ""}* | ${cells.join(" | ")} |`);
      g = r.group; labels = own.join();
    }
    lines.push(`| ${r.label} | ${r.values.map((v) => v ?? "").join(" | ")} |`);
  }
  return lines.join("\n");
}

/** Linearized rows for retrieval only: "South Asia, EMDE SAR, GDP: 2026f 6.3; revision vs January 2026 projections for 2026f: +0.1 pp". */
export function linearizeTable(t: TableData, rows = t.rows): string[] {
  return rows.map((r) => {
    const levels: string[] = [];
    const revs: string[] = [];
    const own = rowLabels(t, r);
    // commodity price rows report level differences (US$, index points), not percentage points
    const levels_ = /index|US\$|per barrel|price/i.test(r.label);
    r.values.forEach((v, i) => {
      if (v === null || v === "..") return;
      const c = t.columns[i];
      if (c.isRevision) revs.push(`${own[i]} ${v.startsWith("-") ? v : `+${v}`}${levels_ ? "" : " pp"}`);
      else levels.push(`${own[i]} ${v}`);
    });
    const where = [r.region ? REGION_NAMES[r.region] : null, r.group].filter(Boolean).join(", ");
    return `${where ? `${where} — ` : ""}${r.label}: ${levels.join("; ")}${revs.length ? `; difference from January 2026 projections: ${revs.join("; ")}` : ""}`;
  });
}
