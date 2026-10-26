import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SEARCHABLE_KINDS, type Region, type Section } from "@/lib/pdf/types";
import type { Chunk, NaiveChunk, Parent } from "@/lib/pipeline/chunk";
import type { TableCell } from "@/lib/pipeline/index-file";
import type { Corpus, Hit, SearchFilter, Store } from "./types";

/** Server-only client with the service-role key. Never import from a client component. */
export function supabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (see START_HERE.md)");
  return createClient(url, key, { auth: { persistSession: false } });
}

const toChunk = (r: Record<string, unknown>): Chunk => ({
  id: r.id as string, parentId: r.parent_id as string, sectionId: r.section_id as string, type: r.type as Chunk["type"], kind: r.kind as Chunk["kind"],
  chapter: r.chapter as Chunk["chapter"], region: (r.region as Region) ?? null, boxId: (r.box_id as string) ?? null, headingPath: r.heading_path as string,
  text: r.text as string, retrievalText: r.retrieval_text as string, pdfStart: r.pdf_start as number, pdfEnd: r.pdf_end as number,
  printedStart: r.printed_start as string, printedEnd: r.printed_end as string, tokenCount: r.token_count as number,
});

/** Postgres store: pgvector HNSW + tsvector GIN, RRF fused in SQL (`gep_hybrid_search`). */
export class SupabaseStore implements Store {
  readonly name = "supabase" as const;
  private sb = supabaseAdmin();

  async denseAvailable(corpus: Corpus) {
    if (corpus === "chunks_text_only") return false; // the heading-path ablation runs on the local store only
    const table = corpus === "naive" ? "gep_naive_chunks" : "gep_chunks";
    const { count } = await this.sb.from(table).select("id", { count: "exact", head: true }).is("embedding", null);
    return (count ?? 1) === 0;
  }

  async search(q: { text: string; vector: number[] | null; filter?: SearchFilter; k: number; channel: "keyword" | "dense" | "hybrid"; corpus: Corpus }): Promise<Hit[]> {
    if (q.corpus === "chunks_text_only") throw new Error("chunks_text_only is an ablation of the local store; run it with STORE=local");
    const vec = q.vector ? JSON.stringify(q.vector) : null;
    const { data, error } = q.corpus === "naive"
      ? await this.sb.rpc("gep_naive_search", { p_query_text: q.text, p_query_embedding: vec, p_match_count: q.k, p_channel: q.channel })
      : await this.sb.rpc("gep_hybrid_search", {
          p_query_text: q.text, p_query_embedding: vec, p_match_count: q.k, p_regions: q.filter?.regions?.length ? q.filter.regions : null,
          p_chapter: q.filter?.chapter ?? null, p_box: q.filter?.boxId ?? null, p_kinds: q.filter?.kinds ?? SEARCHABLE_KINDS, p_channel: q.channel,
        });
    if (error) throw error;
    return ((data ?? []) as Record<string, unknown>[]).map((r, i) => ({ id: r.chunk_id as string, score: r.rrf_score as number, rank: i + 1, keywordRank: (r.fts_rank as number) ?? null, denseRank: (r.sem_rank as number) ?? null }));
  }

  async chunks(ids: string[]) {
    if (!ids.length) return [];
    const { data, error } = await this.sb.from("gep_chunks").select("*").in("id", ids);
    if (error) throw error;
    const m = new Map((data ?? []).map((r) => [r.id as string, toChunk(r)]));
    return ids.map((id) => m.get(id)!).filter(Boolean);
  }
  async naive(ids: string[]): Promise<NaiveChunk[]> {
    if (!ids.length) return [];
    const { data, error } = await this.sb.from("gep_naive_chunks").select("id, text, pdf_start, pdf_end, printed_start").in("id", ids);
    if (error) throw error;
    const m = new Map((data ?? []).map((r) => [r.id as string, { id: r.id, text: r.text, pdfStart: r.pdf_start, pdfEnd: r.pdf_end, printedStart: r.printed_start } as NaiveChunk]));
    return ids.map((id) => m.get(id)!).filter(Boolean);
  }
  async parents(ids: string[]): Promise<Parent[]> {
    if (!ids.length) return [];
    const { data, error } = await this.sb.from("gep_parents").select("*").in("id", ids);
    if (error) throw error;
    const m = new Map((data ?? []).map((r) => [r.id as string, { id: r.id, sectionId: r.section_id, type: r.type, text: r.text, pdfStart: r.pdf_start, pdfEnd: r.pdf_end, tokenCount: r.token_count } as Parent]));
    return ids.map((id) => m.get(id)!).filter(Boolean);
  }
  async sections(): Promise<Section[]> {
    const { data, error } = await this.sb.from("gep_sections").select("*").order("pdf_start");
    if (error) throw error;
    return (data ?? []).map((r) => ({ id: r.id, parentId: r.parent_id, level: r.level, title: r.title, path: r.path, chapter: r.chapter, region: r.region, boxId: r.box_id, kind: r.kind, pdfStart: r.pdf_start, pdfEnd: r.pdf_end }));
  }
  async cells(f: { tableIds?: string[]; rowLabels?: string[] }): Promise<TableCell[]> {
    let q = this.sb.from("gep_table_cells").select("*");
    if (f.tableIds) q = q.in("table_id", f.tableIds);
    if (f.rowLabels) q = q.in("row_label", f.rowLabels);
    const { data, error } = await q.limit(5000);
    if (error) throw error;
    return (data ?? []).map((r) => ({ tableId: r.table_id, caption: r.caption, chunkId: r.chunk_id, rowLabel: r.row_label, group: r.row_group, region: r.region, column: r.col, isRevision: r.is_revision, raw: r.raw, value: r.value, pdfPage: r.pdf_page, printedPage: r.printed_page }));
  }
  private async meta<T>(key: string): Promise<T> {
    const { data, error } = await this.sb.from("gep_meta").select("value").eq("key", key).single();
    if (error) throw error;
    return data.value as T;
  }
  countries() { return this.meta<Record<string, Region>>("countries"); }
  printed() { return this.meta<string[]>("printed"); }
}
