import type { PageRuns, Run } from "./extract";

/** A visual line: consecutive runs on one baseline, in content-stream order. */
export interface Line {
  page: number;
  x0: number;
  x1: number;
  y: number;
  size: number;   // dominant size (by characters)
  font: string;   // dominant font (by characters)
  text: string;
  runs: Run[];
}

/**
 * Group runs into lines. The content stream of this PDF already follows reading order within a
 * column, so a new line starts at a pdfjs end-of-line flag, a baseline change, or a jump back to the left.
 */
export function buildLines(page: PageRuns): Line[] {
  const lines: Line[] = [];
  let cur: Run[] = [];
  const flush = () => {
    if (cur.length) lines.push(toLine(cur));
    cur = [];
  };
  for (const r of page.runs) {
    const prev = cur[cur.length - 1];
    if (prev) {
      const newBaseline = Math.abs(r.y - prev.y) > Math.max(1.2, 0.35 * Math.min(r.size, prev.size));
      const jumpedBack = r.x < prev.x + prev.w - 2 && !newBaseline ? r.x < prev.x - 2 : false;
      if (prev.eol || newBaseline || jumpedBack || r.x - (prev.x + prev.w) > 40) flush();
    }
    cur.push(r);
  }
  flush();
  return lines;
}

function toLine(runs: Run[]): Line {
  let text = "";
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (i > 0) {
      const p = runs[i - 1];
      const gap = r.x - (p.x + p.w);
      if (gap > 0.15 * r.size && !text.endsWith(" ") && !r.text.startsWith(" ")) text += " ";
    }
    text += r.text;
  }
  const byFont = new Map<string, number>();
  const bySize = new Map<number, number>();
  for (const r of runs) {
    byFont.set(r.font, (byFont.get(r.font) ?? 0) + r.text.length);
    bySize.set(r.size, (bySize.get(r.size) ?? 0) + r.text.length);
  }
  const top = <K,>(m: Map<K, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return {
    page: runs[0].page,
    x0: Math.min(...runs.map((r) => r.x)),
    x1: Math.max(...runs.map((r) => r.x + r.w)),
    y: runs[0].y,
    size: top(bySize),
    font: top(byFont),
    text: text.replace(/\s+/g, " ").trim(),
    runs,
  };
}
