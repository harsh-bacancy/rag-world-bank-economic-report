import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { REGION_NAMES, type DocModel, type Region, type Section } from "@/lib/pdf/types";
import type { Chunk, NaiveChunk, Parent } from "./chunk";

/** One numeric cell of a rebuilt table: the computed source reads these, never the model. */
export interface TableCell {
  tableId: string;
  caption: string;
  chunkId: string | null;
  rowLabel: string;
  group: string | null;
  region: Region | null;
  column: string;          // "2026f", "2026/27f", "25Q4"
  isRevision: boolean;     // difference from January 2026 projections
  raw: string;
  value: number | null;
  pdfPage: number;
  printedPage: string;
}

export interface IndexFile {
  version: 1;
  docHash: string;
  builtAt: string;
  pageCount: number;
  printed: string[];
  sections: Section[];
  parents: Parent[];
  chunks: Chunk[];
  naive: NaiveChunk[];
  cells: TableCell[];
  /** country or economy name (lower case) → region, derived from the regional forecast tables */
  countries: Record<string, Region>;
}

export const INDEX_PATH = path.join(process.cwd(), "data", "index", "index.json");

export async function writeIndex(idx: IndexFile, file = INDEX_PATH) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(idx));
}

let cached: { file: string; idx: IndexFile } | null = null;
export async function readIndex(file = INDEX_PATH): Promise<IndexFile> {
  if (cached?.file === file) return cached.idx;
  let raw: string;
  try { raw = await readFile(file, "utf8"); } catch { throw new Error(`No index at ${path.relative(process.cwd(), file)}. Run: npm run ingest`); }
  const idx = JSON.parse(raw) as IndexFile;
  cached = { file, idx };
  return idx;
}

/** Table cells, flattened, with the chunk that holds each row (for citations). */
export function collectCells(doc: DocModel, chunks: Chunk[]): TableCell[] {
  const out: TableCell[] = [];
  for (const b of doc.blocks) {
    if (b.type !== "table" || !b.table) continue;
    const t = b.table;
    const tableChunks = chunks.filter((c) => c.type === "table" && c.pdfStart === b.pdfStart && c.text.startsWith(t.caption));
    for (const r of t.rows) {
      const holder = tableChunks.find((c) => c.text.includes(`| ${r.label} |`)) ?? null;
      const labels = r.labels ?? t.columns.map((c) => c.label);
      r.values.forEach((raw, i) => {
        if (raw === null) return;
        const v = raw === ".." ? null : Number(raw.replace(/[−–]/g, "-"));
        out.push({
          tableId: t.id, caption: t.caption, chunkId: holder?.id ?? null, rowLabel: r.label, group: r.group, region: r.region,
          column: labels[i], isRevision: t.columns[i]?.isRevision ?? false, raw, value: Number.isFinite(v as number) ? v : null,
          pdfPage: b.pdfStart, printedPage: doc.printed[b.pdfStart - 1] ?? "",
        });
      });
    }
  }
  return out;
}

const ALIASES: Record<string, string[]> = {
  "russian federation": ["russia"], "türkiye": ["turkey", "turkiye"], "viet nam": ["vietnam"], "lao pdr": ["laos"],
  "iran, islamic rep.": ["iran"], "egypt, arab rep.": ["egypt"], "yemen, rep.": ["yemen"], "syrian arab republic": ["syria"],
  "korea, dem. people's rep.": ["north korea"], "congo, dem. rep.": ["drc", "democratic republic of congo", "democratic republic of the congo", "dr congo"],
  "congo, rep.": ["republic of congo"], "micronesia, fed. sts.": ["micronesia"], "gambia, the": ["gambia"], "west bank and gaza": ["gaza", "west bank"],
  "kyrgyz republic": ["kyrgyzstan"], "slovak republic": ["slovakia"], "côte d'ivoire": ["cote d'ivoire", "ivory coast"], "cabo verde": ["cape verde"],
  "united arab emirates": ["uae"], "bosnia and herzegovina": ["bosnia"],
};

/**
 * Country → region from the six regional "economy forecasts" tables (2.2, 2.4, … 2.12). The report's own
 * grouping wins: Pakistan and Afghanistan are in MNA here, not South Asia.
 */
export function deriveCountries(doc: DocModel): Record<string, Region> {
  const out: Record<string, Region> = {};
  const regional = /economy forecasts$/i;
  for (const b of doc.blocks) {
    if (b.type !== "table" || !b.table || !regional.test(b.table.caption)) continue;
    const region = (Object.entries(REGION_NAMES).find(([, n]) => b.table!.caption.includes(n))?.[0] ?? null) as Region | null;
    if (!region) continue;
    for (const r of b.table.rows) {
      const name = r.label.toLowerCase().replace(/\s+\d+(\s+\d+)*$/, "").trim();
      if (!name || /basis|^\(|excluding|gdp/.test(name)) continue;
      out[name] = region;
      for (const a of ALIASES[name] ?? []) out[a] = region;
      const short = name.replace(/,.*$/, "").trim();
      if (short.length > 3 && !out[short]) out[short] = region;
    }
  }
  return out;
}
