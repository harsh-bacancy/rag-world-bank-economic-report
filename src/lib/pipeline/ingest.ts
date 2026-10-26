import { loadExtracted, SOURCE_PDF } from "@/lib/pdf/cache";
import { buildDocModel } from "@/lib/pdf/structure";
import { hasGeminiKey } from "@/lib/gemini/client";
import { buildChunks, buildNaiveChunks } from "./chunk";
import { embedTexts, saveEmbeddings } from "./embed";
import { collectCells, deriveCountries, writeIndex, type IndexFile } from "./index-file";

export interface IngestReport {
  pages: number; sections: number; parents: number; chunks: number; naive: number; cells: number; countries: number;
  embedded: { chunks: number; chunksTextOnly: number; naive: number; of: number } | null;
  warnings: string[]; ms: number;
}

/**
 * PDF → runs (pdfjs, fonts kept) → repaired lines → outline + blocks (paragraphs, footnotes, figures, rebuilt tables)
 * → parent/child chunks with location metadata → naive baseline chunks → table cells → embeddings (cached) → index.
 * The only model calls are embeddings, ~8 batched requests for the full index, and only for text not seen before.
 */
export async function ingest(opts: { pdf?: string; embed?: boolean; ablation?: boolean; log?: (s: string) => void } = {}): Promise<IngestReport> {
  const t0 = Date.now();
  const log = opts.log ?? (() => {});
  log("extract: reading runs with fonts (cached by file hash)");
  const ex = await loadExtracted(opts.pdf ?? SOURCE_PDF);
  log("structure: repair, outline, boxes, figures, tables");
  const doc = buildDocModel(ex);
  log("chunk: parents (~900 tokens) and children (~280 tokens) inside sections");
  const { parents, chunks } = buildChunks(doc);
  const naive = buildNaiveChunks(ex.pages.map((p) => ({ page: p.page, text: p.runs.map((r) => r.text + (r.eol ? "\n" : " ")).join("") })), doc.printed);
  const cells = collectCells(doc, chunks);
  const countries = deriveCountries(doc);

  const idx: IndexFile = { version: 1, docHash: doc.hash, builtAt: new Date().toISOString(), pageCount: doc.pageCount, printed: doc.printed, sections: doc.sections, parents, chunks, naive, cells, countries };
  await writeIndex(idx);
  log(`index: ${chunks.length} chunks, ${parents.length} parents, ${naive.length} naive chunks, ${cells.length} table cells → data/index/index.json`);

  let embedded: IngestReport["embedded"] = null;
  if (opts.embed !== false) {
    if (!hasGeminiKey()) log("embed: GOOGLE_GENERATIVE_AI_API_KEY not set — dense retrieval stays off until you add it and re-run ingest (cached text costs 0 calls)");
    log("embed: chunks (heading path + text), chunks without the heading path (ablation), naive chunks");
    const progress = (what: string) => (done: number, total: number) => log(`embed ${what}: ${done}/${total} new`);
    // free tier: ~90 texts a minute, so the full set (~2,450 texts) takes about half an hour the first time; cached afterwards
    const a = await embedTexts(chunks.map((c) => c.retrievalText), "RETRIEVAL_DOCUMENT", { onProgress: progress("chunks") });
    const n = await embedTexts(naive.map((c) => c.text), "RETRIEVAL_DOCUMENT", { onProgress: progress("naive chunks") });
    const b = opts.ablation === false ? [] : await embedTexts(chunks.map((c) => c.text), "RETRIEVAL_DOCUMENT", { onProgress: progress("chunks without heading path (ablation)") });
    await saveEmbeddings();
    embedded = { chunks: a.filter(Boolean).length, chunksTextOnly: b.filter(Boolean).length, naive: n.filter(Boolean).length, of: chunks.length };
  }
  return { pages: doc.pageCount, sections: doc.sections.length, parents: parents.length, chunks: chunks.length, naive: naive.length, cells: cells.length, countries: Object.keys(countries).length, embedded, warnings: doc.warnings, ms: Date.now() - t0 };
}
