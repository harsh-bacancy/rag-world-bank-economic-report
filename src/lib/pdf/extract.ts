import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

/**
 * One positioned text run as pdfjs reports it. Coordinates are PDF points with the origin at the
 * bottom-left (y grows upward), exactly as in the content stream.
 */
export interface Run {
  page: number;      // 1-based PDF page index
  x: number;
  y: number;         // baseline
  w: number;
  size: number;      // font size in points
  font: string;      // base font name without the subset prefix, e.g. "AGaramondPro-Regular"
  text: string;
  eol: boolean;      // pdfjs: a line break follows this run
}

export interface PageRuns { page: number; width: number; height: number; runs: Run[] }

export interface Extracted {
  hash: string;
  pageCount: number;
  pages: PageRuns[];
  outline: { title: string; page: number; depth: number }[];
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Read every text run with its real font name. Fonts carry this report's structure (Garamond body,
 * Helvetica headings, Helvetica Light running heads), so the font is kept on every run.
 * Font names only resolve after the page's operator list has been loaded.
 */
export async function extractPdf(path: string): Promise<Extracted> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const bytes = new Uint8Array(await readFile(path));
  const hash = sha256(bytes);
  const doc = await getDocument({ data: bytes.slice(), disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;

  const pages: PageRuns[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const view = page.getViewport({ scale: 1 });
    await page.getOperatorList();
    const tc = await page.getTextContent();
    const names = new Map<string, string>();
    const runs: Run[] = [];
    for (const raw of tc.items) {
      if (!("str" in raw)) continue;
      const it = raw as { str: string; transform: number[]; width: number; fontName: string; hasEOL: boolean };
      if (!names.has(it.fontName)) {
        let name = "?";
        try { name = (page.commonObjs.get(it.fontName) as { name?: string })?.name ?? "?"; } catch { /* unresolved font */ }
        names.set(it.fontName, name.replace(/^[A-Z]{6}\+/, ""));
      }
      if (!it.str.trim()) {
        // an empty run that only carries the end-of-line flag still ends the previous run's line
        if (it.hasEOL && runs.length) runs[runs.length - 1].eol = true;
        continue;
      }
      const [a, b, , , e, f] = it.transform;
      runs.push({ page: p, x: e, y: f, w: it.width, size: Math.round(Math.hypot(a, b) * 10) / 10, font: names.get(it.fontName)!, text: it.str, eol: it.hasEOL });
    }
    pages.push({ page: p, width: view.width, height: view.height, runs });
    page.cleanup();
  }

  const outline: Extracted["outline"] = [];
  const walk = async (items: Awaited<ReturnType<typeof doc.getOutline>> | null, depth: number) => {
    for (const it of items ?? []) {
      let pageNo = -1;
      try {
        const dest = typeof it.dest === "string" ? await doc.getDestination(it.dest) : it.dest;
        if (dest?.[0]) pageNo = (await doc.getPageIndex(dest[0] as never)) + 1;
      } catch { /* unresolvable bookmark */ }
      outline.push({ title: it.title.replace(/\s+/g, " ").trim(), page: pageNo, depth });
      await walk(it.items, depth + 1);
    }
  };
  await walk(await doc.getOutline(), 0);
  await doc.destroy();
  return { hash, pageCount: pages.length, pages, outline };
}
