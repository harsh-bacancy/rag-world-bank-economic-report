import { SEARCHABLE_KINDS } from "@/lib/pdf/types";
import type { Chunk } from "@/lib/pipeline/chunk";
import { embedTexts } from "@/lib/pipeline/embed";
import { readIndex, type IndexFile } from "@/lib/pipeline/index-file";
import { BM25, cosine, rrf } from "@/lib/retrieval/bm25";
import type { Corpus, Hit, SearchFilter, Store } from "./types";

/**
 * The zero-setup store: the JSON index in memory, BM25 + cosine + RRF in TypeScript. Same contract and the
 * same RRF constant as the Supabase store, so results are comparable.
 */
export class LocalStore implements Store {
  readonly name = "local" as const;
  private idx!: IndexFile;
  private byChunk = new Map<string, Chunk>();
  private bm25 = new Map<Corpus, BM25>();
  private vectors = new Map<Corpus, (number[] | null)[]>();
  private ready: Promise<void> | null = null;

  private init() {
    return (this.ready ??= (async () => {
      this.idx = await readIndex();
      this.byChunk = new Map(this.idx.chunks.map((c) => [c.id, c]));
      this.bm25.set("chunks", new BM25(this.idx.chunks.map((c) => c.id), this.idx.chunks.map((c) => c.retrievalText)));
      this.bm25.set("chunks_text_only", new BM25(this.idx.chunks.map((c) => c.id), this.idx.chunks.map((c) => c.text)));
      this.bm25.set("naive", new BM25(this.idx.naive.map((c) => c.id), this.idx.naive.map((c) => c.text)));
      // vectors come from the embedding cache only; a missing key never triggers calls here
      this.vectors.set("chunks", await embedTexts(this.idx.chunks.map((c) => c.retrievalText), "RETRIEVAL_DOCUMENT", { fetchMissing: false }));
      this.vectors.set("chunks_text_only", await embedTexts(this.idx.chunks.map((c) => c.text), "RETRIEVAL_DOCUMENT", { fetchMissing: false }));
      this.vectors.set("naive", await embedTexts(this.idx.naive.map((c) => c.text), "RETRIEVAL_DOCUMENT", { fetchMissing: false }));
    })());
  }

  async denseAvailable(corpus: Corpus) {
    await this.init();
    const v = this.vectors.get(corpus) ?? [];
    return v.length > 0 && v.every(Boolean);
  }

  private allow(filter: SearchFilter | undefined, corpus: Corpus) {
    if (corpus === "naive") return () => true;
    const kinds = new Set(filter?.kinds ?? SEARCHABLE_KINDS);
    return (id: string) => {
      const c = this.byChunk.get(id)!;
      if (!kinds.has(c.kind)) return false;
      if (filter?.regions?.length && !(c.region && filter.regions.includes(c.region))) return false;
      if (filter?.chapter && c.chapter !== filter.chapter) return false;
      if (filter?.boxId && c.boxId !== filter.boxId) return false;
      return true;
    };
  }

  async search(q: { text: string; vector: number[] | null; filter?: SearchFilter; k: number; channel: "keyword" | "dense" | "hybrid"; corpus: Corpus }): Promise<Hit[]> {
    await this.init();
    const allow = this.allow(q.filter, q.corpus);
    const ids = q.corpus === "naive" ? this.idx.naive.map((c) => c.id) : this.idx.chunks.map((c) => c.id);
    const depth = Math.max(q.k, 30) * 2;
    const kw = q.channel !== "dense" ? this.bm25.get(q.corpus)!.search(q.text, depth, allow) : [];
    let dense: { id: string; score: number }[] = [];
    if (q.channel !== "keyword") {
      const vecs = this.vectors.get(q.corpus)!;
      if (q.vector && vecs.every(Boolean)) {
        dense = ids.map((id, i) => ({ id, score: allow(id) ? cosine(q.vector!, vecs[i]!) : -2 })).filter((x) => x.score > -2).sort((a, b) => b.score - a.score).slice(0, depth);
      } else if (q.channel === "dense") {
        throw new Error("Dense retrieval needs embeddings: set GOOGLE_GENERATIVE_AI_API_KEY and run `npm run ingest`.");
      }
    }
    const kwRank = new Map(kw.map((x, i) => [x.id, i + 1]));
    const dRank = new Map(dense.map((x, i) => [x.id, i + 1]));
    const fused = q.channel === "keyword" ? kw : q.channel === "dense" ? dense : rrf(dense.length ? [kw, dense] : [kw]);
    return fused.slice(0, q.k).map((x, i) => ({ id: x.id, score: x.score, rank: i + 1, keywordRank: kwRank.get(x.id) ?? null, denseRank: dRank.get(x.id) ?? null }));
  }

  async chunks(ids: string[]) { await this.init(); return ids.map((id) => this.byChunk.get(id)).filter((c): c is Chunk => !!c); }
  async naive(ids: string[]) { await this.init(); const m = new Map(this.idx.naive.map((c) => [c.id, c])); return ids.map((id) => m.get(id)!).filter(Boolean); }
  async parents(ids: string[]) { await this.init(); const m = new Map(this.idx.parents.map((p) => [p.id, p])); return ids.map((id) => m.get(id)!).filter(Boolean); }
  async sections() { await this.init(); return this.idx.sections; }
  async cells(f: { tableIds?: string[]; rowLabels?: string[] }) {
    await this.init();
    return this.idx.cells.filter((c) => (!f.tableIds || f.tableIds.includes(c.tableId)) && (!f.rowLabels || f.rowLabels.includes(c.rowLabel)));
  }
  async countries() { await this.init(); return this.idx.countries; }
  async printed() { await this.init(); return this.idx.printed; }
}
