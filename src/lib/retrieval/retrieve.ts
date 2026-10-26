import type { ChapterKey, Region } from "@/lib/pdf/types";
import { embedQuery } from "@/lib/pipeline/embed";
import type { Chunk, NaiveChunk } from "@/lib/pipeline/chunk";
import { getStore, type Store } from "@/lib/store";
import type { Channel, Corpus, Hit, SearchFilter } from "@/lib/store/types";
import { noRoute, routeLLM, routeRules, type Route } from "./route";
import { rerank, saveRerankCache } from "./rerank";

/** Every technique is a switch, so the eval can add them one at a time (the ablation ladder). */
export interface RetrievalConfig {
  corpus: Corpus;                     // naive 1000-char windows · section-aware chunks (± heading path)
  channel: Channel | "auto";          // auto = hybrid when embeddings exist, else keyword
  route: "none" | "rules" | "llm";
  rerank: boolean;
  parents: boolean;                   // swap children for their parent windows
  k: number;                          // what the model reads
  candidates: number;                 // shortlist before reranking
}

export const FULL: RetrievalConfig = { corpus: "chunks", channel: "auto", route: "rules", rerank: true, parents: true, k: 5, candidates: 24 };
export const NAIVE: RetrievalConfig = { corpus: "naive", channel: "auto", route: "none", rerank: false, parents: false, k: 5, candidates: 30 };

/** One retrieved item in rank order: a child chunk, a parent window, or a naive chunk. */
export interface RetrievedItem {
  id: string;                 // chunk id, parent id, or naive id
  chunkIds: string[];         // the children that matched (for parents)
  kind: "chunk" | "parent" | "naive";
  text: string;               // verbatim: what the model reads and citations verify against
  retrievalText: string;      // what the cross-encoder scores (heading path + text + tables read as prose)
  headingPath: string | null;
  chapter: ChapterKey | null;
  region: Region | null;
  boxId: string | null;
  sectionId: string | null;
  pdfStart: number;
  pdfEnd: number;
  printed: string;
  pageBreaks?: { offset: number; page: number }[];
  score: number;              // rerank score when reranked, else the fused / channel score
  rerankScore: number | null;
  keywordRank: number | null;
  denseRank: number | null;
}

export interface RetrievalResult {
  route: Route;
  items: RetrievedItem[];
  channel: Channel;
  widened: boolean;
  topScore: number | null;
  config: RetrievalConfig;
}

const g = globalThis as unknown as { __gepBoxes?: string[] };

export async function resolveRoute(question: string, how: RetrievalConfig["route"], store: Store = getStore()): Promise<Route> {
  if (how === "none") return noRoute(question);
  const countries = await store.countries();
  g.__gepBoxes ??= [...new Set((await store.sections()).map((s) => s.boxId).filter((b): b is string => !!b))].sort();
  const ctx = { countries, boxes: g.__gepBoxes };
  return how === "llm" ? routeLLM(question, ctx) : routeRules(question, ctx);
}

export async function retrieve(question: string, cfg: RetrievalConfig, opts: { store?: Store; route?: Route } = {}): Promise<RetrievalResult> {
  const store = opts.store ?? getStore();
  const route = opts.route ?? (await resolveRoute(question, cfg.route, store));
  const dense = cfg.channel === "keyword" ? false : await store.denseAvailable(cfg.corpus);
  let channel: Channel = cfg.channel === "auto" ? (dense ? "hybrid" : "keyword") : cfg.channel;
  const text = cfg.route === "none" ? question : route.searchQuery;
  let vector: number[] | null = null;
  if (channel !== "keyword") {
    try { vector = await embedQuery(text); } catch (err) {
      // the embedding quota is per day on the free tier: fall back to keywords rather than failing the question
      if (cfg.channel === "dense") throw err;
      console.warn(`[retrieve] query embedding failed, keyword channel only: ${err instanceof Error ? err.message.slice(0, 120) : err}`);
    }
    if (!vector) channel = "keyword";
  }

  // one or more scopes: each named region or chapter is searched on its own so a comparison sees every side
  const base: SearchFilter = { chapter: route.chapter ?? undefined, boxId: route.boxId ?? undefined, regions: route.regions.length === 1 ? route.regions : undefined };
  const scopes: SearchFilter[] = cfg.corpus === "naive" ? [{}]
    : route.regions.length > 1 ? route.regions.map((r) => ({ ...base, regions: [r] }))
    : route.chapters.length > 1 ? route.chapters.map((c) => ({ ...base, chapter: c }))
    : [base];
  if (cfg.corpus !== "naive" && route.openComparison) scopes.push({});
  const lists = await Promise.all(scopes.map((f) => store.search({ text, vector, filter: f, k: cfg.candidates, channel, corpus: cfg.corpus })));
  const hits: Hit[] = [];
  const scopeOf = new Map<string, number>();
  for (let i = 0; i < cfg.candidates; i++) lists.forEach((l, s) => { const h = l[i]; if (h && !scopeOf.has(h.id)) { scopeOf.set(h.id, s); hits.push(h); } });
  let widened = false;
  const filtered = route.regions.length || route.chapters.length || route.boxId;
  if (cfg.corpus !== "naive" && hits.length < 3 && filtered) {
    // a filter that finds (almost) nothing is a bad filter: search the whole report
    widened = true;
    const more = await store.search({ text, vector, k: cfg.candidates, channel, corpus: cfg.corpus });
    for (const h of more) if (!scopeOf.has(h.id)) { scopeOf.set(h.id, 0); hits.push(h); }
  }

  let items: RetrievedItem[];
  if (cfg.corpus === "naive") {
    const naive = await store.naive(hits.map((h) => h.id));
    const byId = new Map(naive.map((n) => [n.id, n]));
    items = hits.map((h) => fromNaive(byId.get(h.id)!, h));
  } else {
    const chunks = await store.chunks(hits.map((h) => h.id));
    const byId = new Map(chunks.map((c) => [c.id, c]));
    items = hits.filter((h) => byId.has(h.id)).map((h) => fromChunk(byId.get(h.id)!, h, cfg.corpus));
  }

  let topScore: number | null = null;
  if (cfg.rerank && items.length) {
    // the cross-encoder reads the reader's question itself; the expanded search query is for the retrievers
    const best = new Map<string, number>();
    for (const r of await rerank(question, items, rerankText, items.length)) best.set(r.item.id, r.score);
    items = items.map((it) => ({ ...it, rerankScore: best.get(it.id) ?? 0, score: best.get(it.id) ?? 0 })).sort((a, b) => b.score - a.score);
    topScore = items[0]?.rerankScore ?? null;
    if (scopes.length > 1) items = balance(items, (it) => scopeOf.get(it.id) ?? 0, scopes.length);
    saveRerankCache();
  }

  if (cfg.parents && cfg.corpus !== "naive") items = await toParents(items, cfg.k, store);
  return { route, items: items.slice(0, cfg.parents ? cfg.k : Math.max(cfg.k, 10)), channel, widened, topScore, config: cfg };
}

/** Round-robin across scopes, each in its own reranked order: the reranker may prefer one side, the reader needs both. */
function balance(items: RetrievedItem[], scopeOf: (it: RetrievedItem) => number, n: number): RetrievedItem[] {
  const queues = Array.from({ length: n }, (_, s) => items.filter((it) => scopeOf(it) === s));
  const out: RetrievedItem[] = [];
  while (queues.some((q) => q.length)) for (const q of queues) { const it = q.shift(); if (it) out.push(it); }
  return out;
}

/** The cross-encoder sees what the embedder sees: heading path + text (+ tables read as prose). */
function rerankText(it: RetrievedItem): string {
  return it.retrievalText;
}

function fromChunk(c: Chunk, h: Hit, corpus: Corpus): RetrievedItem {
  return {
    id: c.id, chunkIds: [c.id], kind: "chunk", text: c.text, retrievalText: corpus === "chunks" ? c.retrievalText : c.text, headingPath: c.headingPath,
    chapter: c.chapter, region: c.region, boxId: c.boxId, sectionId: c.sectionId, pdfStart: c.pdfStart, pdfEnd: c.pdfEnd,
    printed: c.printedStart === c.printedEnd ? c.printedStart : `${c.printedStart}–${c.printedEnd}`, score: h.score, rerankScore: null, keywordRank: h.keywordRank, denseRank: h.denseRank,
  };
}

function fromNaive(n: NaiveChunk, h: Hit): RetrievedItem {
  return { id: n.id, chunkIds: [n.id], kind: "naive", text: n.text, retrievalText: n.text, headingPath: null, chapter: null, region: null, boxId: null, sectionId: null, pdfStart: n.pdfStart, pdfEnd: n.pdfEnd, printed: n.printedStart, score: h.score, rerankScore: null, keywordRank: h.keywordRank, denseRank: h.denseRank };
}

/** Swap each child for its parent window; duplicates are dropped and rank order is kept. */
async function toParents(items: RetrievedItem[], n: number, store: Store): Promise<RetrievedItem[]> {
  const chunks = await store.chunks(items.map((i) => i.id));
  const parentOf = new Map(chunks.map((c) => [c.id, c.parentId]));
  const order: string[] = [];
  const members = new Map<string, RetrievedItem[]>();
  for (const it of items) {
    const p = parentOf.get(it.id);
    if (!p) continue;
    if (!members.has(p)) { order.push(p); members.set(p, []); }
    members.get(p)!.push(it);
  }
  const chosen = order.slice(0, n);
  const parents = await store.parents(chosen);
  const pById = new Map(parents.map((p) => [p.id, p]));
  const printed = await store.printed();
  const label = (p: number) => printed[p - 1] || `PDF ${p}`;
  return chosen.map((pid) => {
    const p = pById.get(pid)!;
    const top = members.get(pid)![0];
    return { ...top, id: pid, kind: "parent" as const, chunkIds: members.get(pid)!.map((m) => m.id), text: p.text, pageBreaks: p.pageBreaks, pdfStart: p.pdfStart, pdfEnd: p.pdfEnd, printed: p.pdfStart === p.pdfEnd ? label(p.pdfStart) : `${label(p.pdfStart)}–${label(p.pdfEnd)}` };
  });
}
