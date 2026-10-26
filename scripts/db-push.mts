/**
 * Copy the local index (and cached embeddings) into Supabase. Run after `npm run ingest` and after running
 * supabase/migrations/0001_init.sql once in the SQL editor. Idempotent: rows are replaced.
 *   npm run db:push
 */
import { readIndex } from "@/lib/pipeline/index-file";
import { embedTexts } from "@/lib/pipeline/embed";
import { supabaseAdmin } from "@/lib/store/supabase";

const sb = supabaseAdmin();
const idx = await readIndex();
const batch = async (table: string, rows: Record<string, unknown>[], size = 200) => {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + size));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  console.log(`· ${table}: ${rows.length}`);
};

const vChunks = await embedTexts(idx.chunks.map((c) => c.retrievalText), "RETRIEVAL_DOCUMENT", { fetchMissing: false });
const vNaive = await embedTexts(idx.naive.map((c) => c.text), "RETRIEVAL_DOCUMENT", { fetchMissing: false });
const vec = (v: number[] | null) => (v ? JSON.stringify(v) : null);

await sb.from("gep_table_cells").delete().neq("id", -1);
await batch("gep_meta", [{ key: "doc_hash", value: idx.docHash }, { key: "printed", value: idx.printed }, { key: "countries", value: idx.countries }, { key: "built_at", value: idx.builtAt }]);
await batch("gep_sections", idx.sections.map((s) => ({ id: s.id, parent_id: s.parentId, level: s.level, title: s.title, path: s.path, chapter: s.chapter, region: s.region, box_id: s.boxId, kind: s.kind, pdf_start: s.pdfStart, pdf_end: s.pdfEnd })));
await batch("gep_parents", idx.parents.map((p) => ({ id: p.id, section_id: p.sectionId, type: p.type, text: p.text, pdf_start: p.pdfStart, pdf_end: p.pdfEnd, token_count: p.tokenCount })));
await batch("gep_chunks", idx.chunks.map((c, i) => ({ id: c.id, parent_id: c.parentId, section_id: c.sectionId, type: c.type, kind: c.kind, chapter: c.chapter, region: c.region, box_id: c.boxId, heading_path: c.headingPath, text: c.text, retrieval_text: c.retrievalText, pdf_start: c.pdfStart, pdf_end: c.pdfEnd, printed_start: c.printedStart, printed_end: c.printedEnd, token_count: c.tokenCount, embedding: vec(vChunks[i]) })), 100);
await batch("gep_naive_chunks", idx.naive.map((c, i) => ({ id: c.id, text: c.text, pdf_start: c.pdfStart, pdf_end: c.pdfEnd, printed_start: c.printedStart, embedding: vec(vNaive[i]) })), 100);
await batch("gep_table_cells", idx.cells.map((c) => ({ table_id: c.tableId, caption: c.caption, chunk_id: c.chunkId, row_label: c.rowLabel, row_group: c.group, region: c.region, col: c.column, is_revision: c.isRevision, raw: c.raw, value: c.value, pdf_page: c.pdfPage, printed_page: c.printedPage })), 500);
console.log(`done. embeddings present: chunks ${vChunks.filter(Boolean).length}/${idx.chunks.length}, naive ${vNaive.filter(Boolean).length}/${idx.naive.length}`);
