import { hasGeminiKey } from "@/lib/gemini/client";
import { limiter } from "@/lib/gemini/limiter";
import { getStore } from "@/lib/store";
import { computedSource } from "./computed";
import { buildSources, type Source } from "./context";
import { generateAnswer, REFUSAL_TEXT, type VerifiedCitation } from "./generate";
import type { Region } from "@/lib/pdf/types";
import { FULL, NAIVE, resolveRoute, retrieve, type RetrievalConfig, type RetrievedItem } from "./retrieve";
import type { Route } from "./route";

export type AskMode = "full" | "naive";

export interface AskResult {
  question: string;
  mode: AskMode;
  answer: string;
  refused: boolean;
  refusal: "gate" | "structural" | "model" | "verifier" | null;
  refusalReason: string | null;
  citations: VerifiedCitation[];
  rejected: { notVerbatim: number; outOfScope: number };
  route: Route;
  widened: boolean;
  channel: string;
  topScore: number | null;
  sources: Source[];
  retrieved: Pick<RetrievedItem, "id" | "kind" | "headingPath" | "region" | "chapter" | "boxId" | "printed" | "pdfStart" | "pdfEnd" | "score" | "rerankScore" | "keywordRank" | "denseRank" | "chunkIds">[];
  computed: string | null;
  latencyMs: number;
  geminiCalls: number;
  retrieveOnly?: boolean;
}

export const REFUSAL_THRESHOLD = Number(process.env.RERANK_REFUSAL_THRESHOLD ?? 0.15);

/**
 * Full: route → hybrid inside filters → rerank → parents → refusal gate (no LLM call) → computed source →
 * generate → verify (verbatim + scope). Naive (the eval baseline): 1000-char chunks, one channel, top 5 straight
 * to the same generator; no routing, no reranker, no parents, no gate, no computed source, no scope guard.
 */
export async function ask(question: string, opts: { mode?: AskMode; config?: Partial<RetrievalConfig>; retrieveOnly?: boolean; scopeRegion?: Region; history?: { role: "user" | "assistant"; content: string }[] } = {}): Promise<AskResult> {
  const mode = opts.mode ?? "full";
  const cfg: RetrievalConfig = { ...(mode === "full" ? FULL : NAIVE), ...opts.config };
  const t0 = Date.now();
  const before = (await limiter.usage()).today;
  const store = getStore();
  // Compare mode scopes the same question to one region chosen by the reader
  let route = undefined;
  if (opts.scopeRegion) {
    const base = await resolveRoute(question, cfg.route === "none" ? "rules" : cfg.route, store);
    route = { ...base, regions: [opts.scopeRegion], regionSource: "user" as const, countries: base.countries.filter(() => false) };
  }
  const r = await retrieve(question, cfg, { store, route });
  const sources = buildSources(r.items);
  const retrieved = r.items.map(({ id, kind, headingPath, region, chapter, boxId, printed, pdfStart, pdfEnd, score, rerankScore, keywordRank, denseRank, chunkIds }) => ({ id, kind, headingPath, region, chapter, boxId, printed, pdfStart, pdfEnd, score, rerankScore, keywordRank, denseRank, chunkIds }));
  const base = { question, mode, route: r.route, widened: r.widened, channel: r.channel, topScore: r.topScore, sources, retrieved };
  const done = async (x: Omit<AskResult, keyof typeof base | "latencyMs" | "geminiCalls">): Promise<AskResult> => ({ ...base, ...x, latencyMs: Date.now() - t0, geminiCalls: (await limiter.usage()).today - before });

  if (mode === "full" && r.route.structuralRefusal) {
    return done({ answer: `${REFUSAL_TEXT} ${r.route.structuralRefusal}`, refused: true, refusal: "structural", refusalReason: r.route.structuralRefusal, citations: [], rejected: { notVerbatim: 0, outOfScope: 0 }, computed: null });
  }
  if (mode === "full" && cfg.rerank && (r.topScore ?? 0) < REFUSAL_THRESHOLD) {
    // nothing in the report is about this: refuse without spending a generation call
    return done({ answer: REFUSAL_TEXT, refused: true, refusal: "gate", refusalReason: `best passage scored ${(r.topScore ?? 0).toFixed(3)} < ${REFUSAL_THRESHOLD}`, citations: [], rejected: { notVerbatim: 0, outOfScope: 0 }, computed: null });
  }
  if (opts.retrieveOnly || !hasGeminiKey()) {
    return done({ answer: hasGeminiKey() ? "(retrieval only)" : "(retrieval only — set GOOGLE_GENERATIVE_AI_API_KEY to generate answers)", refused: false, refusal: null, refusalReason: null, citations: [], rejected: { notVerbatim: 0, outOfScope: 0 }, computed: null, retrieveOnly: true });
  }

  let all = sources;
  let computed: string | null = null;
  if (mode === "full") {
    const c = await computedSource(question, r.route, sources, store);
    if (c.source) { all = [...sources, c.source]; computed = c.source.text; }
  }
  // the scope guard: a citation from outside the routed regions/chapters is stripped (open comparisons have no fixed scope)
  const scope = mode === "full" && !r.route.openComparison && (r.route.regions.length || r.route.chapters.length) ? { regions: r.route.regions, chapters: r.route.chapters } : null;
  let gen = await generateAnswer(question, all, scope, { history: opts.history });
  if (mode === "full" && gen.refused && gen.rejected.notVerbatim + gen.rejected.outOfScope === 0 && (r.topScore ?? 0) >= 0.4) {
    // a strong retrieval match but a refusal: give the model one nudge before accepting it
    const retry = await generateAnswer(question, all, scope, { nudge: true, history: opts.history });
    if (!retry.refused) gen = retry;
  }
  const refusal = gen.refused ? (gen.raw.trim() === REFUSAL_TEXT || gen.citations.length === 0 && gen.rejected.notVerbatim + gen.rejected.outOfScope === 0 ? "model" : "verifier") : null;
  return done({ answer: gen.answer, refused: gen.refused, refusal, refusalReason: refusal === "verifier" ? "no citation survived verification" : null, citations: gen.citations, rejected: gen.rejected, computed });
}
