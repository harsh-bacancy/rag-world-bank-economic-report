import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { hasGeminiKey } from "@/lib/gemini/client";
import { getStore } from "@/lib/store";
import { retrieve, type RetrievalConfig } from "@/lib/retrieval/retrieve";
import { readGolden, regionByPage, scoreRetrieval, type GoldenQuestion } from "./golden";

/** One rung of the ladder: a name and the config it runs. */
export interface Rung { key: string; label: string; technique: string; cfg: RetrievalConfig; needs?: "dense" | "llm" }

const base: RetrievalConfig = { corpus: "naive", channel: "keyword", route: "none", rerank: false, parents: false, k: 5, candidates: 24 };

/** The field guide's ladder, one technique added per rung. Dense rungs run only when embeddings exist. */
export function ladder(dense: boolean): Rung[] {
  const ch = dense ? "hybrid" : "keyword";
  const rungs: Rung[] = [
    { key: "naive", label: "1 naive 1000-char chunks", technique: "baseline", cfg: { ...base, channel: dense ? "dense" : "keyword" } },
    { key: "sections", label: "2 section-aware chunks", technique: "section-aware chunking + text repair", cfg: { ...base, corpus: "chunks_text_only", channel: dense ? "dense" : "keyword" } },
    { key: "heading", label: "3 + heading path embedded", technique: "heading path in retrieval text", cfg: { ...base, corpus: "chunks", channel: dense ? "dense" : "keyword" } },
  ];
  if (dense) rungs.push({ key: "hybrid", label: "4 + hybrid (dense + BM25, RRF)", technique: "hybrid search", cfg: { ...base, corpus: "chunks", channel: "hybrid" } });
  rungs.push(
    { key: "routing", label: `${dense ? 5 : 4} + routing (rules)`, technique: "metadata filters from the question", cfg: { ...base, corpus: "chunks", channel: ch, route: "rules" } },
    { key: "rerank", label: `${dense ? 6 : 5} + rerank (bge-reranker-v2-m3)`, technique: "cross-encoder rerank", cfg: { ...base, corpus: "chunks", channel: ch, route: "rules", rerank: true } },
    { key: "parents", label: `${dense ? 7 : 6} + parents (what the model reads)`, technique: "search small, read the parent", cfg: { ...base, corpus: "chunks", channel: ch, route: "rules", rerank: true, parents: true } },
    { key: "rerank_noroute", label: "A/B: rerank without routing", technique: "is routing still needed after rerank?", cfg: { ...base, corpus: "chunks", channel: ch, route: "none", rerank: true } },
    { key: "routing_llm", label: "A/B: routing (LLM) + rerank", technique: "LLM query understanding", cfg: { ...base, corpus: "chunks", channel: ch, route: "llm", rerank: true }, needs: "llm" },
  );
  return rungs;
}

export interface RungResult {
  key: string; label: string; technique: string; channel: string; n: number;
  hit1: number; hit3: number; hit5: number; mrr: number; mixup: number; mixupN: number;
  byCategory: Record<string, { n: number; hit5: number; mrr: number }>;
  rows: { id: string; category: string; firstRelevant: number | null; hit5: boolean; mixup: number | null; top: string[]; widened: boolean; route: string }[];
  ms: number;
}

export interface GateResult {
  threshold: number; accuracy: number; falseRefusals: number; missedRefusals: number;
  scores: { id: string; category: string; expectRefusal: boolean; topScore: number | null; structural: string | null }[];
  sweep: { threshold: number; accuracy: number }[];
}

export interface RetrievalReport { ranAt: string; store: string; dense: boolean; questions: number; rungs: RungResult[]; skipped: { key: string; why: string }[]; gate: GateResult | null }

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export async function runRetrievalEval(opts: { only?: string[]; onRung?: (r: RungResult) => void } = {}): Promise<RetrievalReport> {
  const store = getStore();
  const golden = await readGolden();
  const answerable = golden.questions.filter((q) => !q.expect_refusal);
  const regionOfPage = regionByPage(await store.sections());
  const dense = await store.denseAvailable("chunks");
  const rungs = ladder(dense).filter((r) => !opts.only || opts.only.includes(r.key));
  const skipped: RetrievalReport["skipped"] = [];
  const results: RungResult[] = [];

  for (const rung of rungs) {
    if (rung.needs === "llm" && !hasGeminiKey()) { skipped.push({ key: rung.key, why: "needs GOOGLE_GENERATIVE_AI_API_KEY" }); continue; }
    if (rung.cfg.corpus !== "naive" && rung.cfg.channel !== "keyword" && !dense) { skipped.push({ key: rung.key, why: "needs embeddings" }); continue; }
    if (rung.cfg.corpus === "naive" && rung.cfg.channel === "dense" && !(await store.denseAvailable("naive"))) { skipped.push({ key: rung.key, why: "needs embeddings" }); continue; }
    const t0 = Date.now();
    const rows: RungResult["rows"] = [];
    const scores: { q: GoldenQuestion; s: ReturnType<typeof scoreRetrieval> }[] = [];
    for (const q of answerable) {
      const r = await retrieve(q.question, rung.cfg, { store });
      const s = scoreRetrieval(r.items, q, regionOfPage);
      scores.push({ q, s });
      rows.push({ id: q.id, category: q.category, firstRelevant: s.firstRelevant, hit5: s.hit5, mixup: s.mixup, top: r.items.slice(0, 5).map((it) => `${it.headingPath ?? "naive"} · p.${it.printed}`), widened: r.widened, route: describeRoute(r.route) });
    }
    const cats = [...new Set(answerable.map((q) => q.category))];
    const mix = scores.filter((x) => x.s.mixup !== null).map((x) => x.s.mixup!);
    const res: RungResult = {
      key: rung.key, label: rung.label, technique: rung.technique, channel: String(rung.cfg.channel), n: scores.length,
      hit1: mean(scores.map((x) => +x.s.hit1)), hit3: mean(scores.map((x) => +x.s.hit3)), hit5: mean(scores.map((x) => +x.s.hit5)), mrr: mean(scores.map((x) => x.s.rr)),
      mixup: mean(mix), mixupN: mix.length,
      byCategory: Object.fromEntries(cats.map((c) => { const cs = scores.filter((x) => x.q.category === c); return [c, { n: cs.length, hit5: mean(cs.map((x) => +x.s.hit5)), mrr: mean(cs.map((x) => x.s.rr)) }]; })),
      rows, ms: Date.now() - t0,
    };
    results.push(res);
    opts.onRung?.(res);
  }

  // the refusal gate: no LLM call, so it can be calibrated offline on the full retrieval config
  let gate: GateResult | null = null;
  if (!opts.only || opts.only.includes("gate")) gate = await calibrateGate(golden.questions, dense);
  const report: RetrievalReport = { ranAt: new Date().toISOString(), store: store.name, dense, questions: answerable.length, rungs: results, skipped, gate };
  await mkdir(path.join(process.cwd(), "data", "eval"), { recursive: true });
  await writeFile(path.join(process.cwd(), "data", "eval", "retrieval-latest.json"), JSON.stringify(report, null, 2));
  return report;
}

export function describeRoute(r: { regions: string[]; chapter: string | null; chapters?: string[]; boxId: string | null; how: string; structuralRefusal: string | null; openComparison?: boolean }): string {
  const chs = r.chapters?.length ? r.chapters : r.chapter ? [r.chapter] : [];
  const parts = [r.regions.length ? `region=${r.regions.join("+")}` : null, chs.length ? `chapter=${chs.join("+")}` : null, r.openComparison ? "+ whole report" : null, r.boxId ? `box=${r.boxId}` : null, r.structuralRefusal ? "structural refusal" : null].filter(Boolean);
  return `${r.how}: ${parts.join(", ") || "no filter"}`;
}

async function calibrateGate(questions: GoldenQuestion[], dense: boolean): Promise<GateResult> {
  const cfg: RetrievalConfig = { corpus: "chunks", channel: dense ? "hybrid" : "keyword", route: "rules", rerank: true, parents: false, k: 5, candidates: 24 };
  const scores: GateResult["scores"] = [];
  for (const q of questions) {
    const r = await retrieve(q.question, cfg);
    scores.push({ id: q.id, category: q.category, expectRefusal: !!q.expect_refusal, topScore: r.topScore, structural: r.route.structuralRefusal });
  }
  const sweep: GateResult["sweep"] = [];
  for (let t = 0.02; t <= 0.6; t += 0.01) {
    const th = Math.round(t * 100) / 100;
    const acc = mean(scores.map((s) => +((s.structural !== null || (s.topScore ?? 0) < th) === s.expectRefusal)));
    sweep.push({ threshold: th, accuracy: acc });
  }
  // the middle of the widest best-accuracy plateau: the decision should not sit on the edge of one question's score
  const bestAcc = Math.max(...sweep.map((s) => s.accuracy));
  let run: number[] = [], widest: number[] = [];
  for (const s of sweep) { if (s.accuracy === bestAcc) run.push(s.threshold); else { if (run.length > widest.length) widest = run; run = []; } }
  if (run.length > widest.length) widest = run;
  const threshold = widest[Math.floor((widest.length - 1) / 2)];
  const refuse = (s: GateResult["scores"][number]) => s.structural !== null || (s.topScore ?? 0) < threshold;
  return {
    threshold, accuracy: bestAcc,
    falseRefusals: scores.filter((s) => !s.expectRefusal && refuse(s)).length,
    missedRefusals: scores.filter((s) => s.expectRefusal && !refuse(s)).length,
    scores, sweep,
  };
}
