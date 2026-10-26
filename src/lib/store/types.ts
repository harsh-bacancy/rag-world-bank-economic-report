import type { ChapterKey, Kind, Region, Section } from "@/lib/pdf/types";
import type { Chunk, NaiveChunk, Parent } from "@/lib/pipeline/chunk";
import type { TableCell } from "@/lib/pipeline/index-file";

export interface SearchFilter {
  regions?: Region[];
  chapter?: ChapterKey;
  boxId?: string;
  kinds?: Kind[];          // defaults to SEARCHABLE_KINDS
}

export type Channel = "keyword" | "dense" | "hybrid";
/** Which text the search sees: chunks with their heading path (default), chunks without it (ablation), or the naive baseline. */
export type Corpus = "chunks" | "chunks_text_only" | "naive";

export interface Hit { id: string; score: number; rank: number; keywordRank: number | null; denseRank: number | null }

export interface Store {
  readonly name: "local" | "supabase";
  denseAvailable(corpus: Corpus): Promise<boolean>;
  search(q: { text: string; vector: number[] | null; filter?: SearchFilter; k: number; channel: Channel; corpus: Corpus }): Promise<Hit[]>;
  chunks(ids: string[]): Promise<Chunk[]>;
  naive(ids: string[]): Promise<NaiveChunk[]>;
  parents(ids: string[]): Promise<Parent[]>;
  sections(): Promise<Section[]>;
  cells(filter: { tableIds?: string[]; rowLabels?: string[] }): Promise<TableCell[]>;
  countries(): Promise<Record<string, Region>>;
  printed(): Promise<string[]>;
}
