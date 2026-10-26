import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStore } from "@/lib/store";
import { ask, type AskMode } from "@/lib/retrieval/ask";
import type { RetrievedItem } from "@/lib/retrieval/retrieve";
import { judge } from "./judge";
import { GOLDEN_PATH, matches, readGolden, regionByPage, scoreRetrieval, type GoldenQuestion } from "./golden";

export interface EvalRow {
  id: string; category: string; question: string; expected: string; expectRefusal: boolean; mode: AskMode;
  answer: string; refused: boolean; refusal: string | null; route: string;
  firstRelevant: number | null; hit1: boolean; hit5: boolean; rr: number; retrievalMixup: number | null;
  citationPrecision: number | null; citedOutOfScope: number; refusalCorrect: boolean;
  faithfulness: number | null; correctness: number | null; mixedUp: boolean | null; numbersFound: number | null;
  judgeNote: string; latencyMs: number; geminiCalls: number; rejected: { notVerbatim: number; outOfScope: number }; error?: string;
}

export interface EvalSummary {
  mode: AskMode; n: number; hit1: number; hit5: number; mrr: number; retrievalMixup: number;
  citationPrecision: number; faithfulness: number; correctness: number; mixupRate: number; numbersFound: number;
  refusalAccuracy: number; falseRefusalRate: number; refusalRecall: number; avgLatencyMs: number; p50LatencyMs: number; geminiCalls: number;
  rejectedNotVerbatim: number; rejectedOutOfScope: number;
  byCategory: Record<string, { n: number; hit5: number; correctness: number; faithfulness: number }>;
}

export interface EvalReport { ranAt: string; golden: string; store: string; rows: EvalRow[]; summaries: Partial<Record<AskMode, EvalSummary>> }

export const EVAL_PATH = path.join(process.cwd(), "data", "eval", "latest.json");
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function summarize(rows: EvalRow[], mode: AskMode): EvalSummary {
  const r = rows.filter((x) => x.mode === mode && !x.error);
  const ans = r.filter((x) => !x.expectRefusal);
  const ref = r.filter((x) => x.expectRefusal);
  const lat = r.map((x) => x.latencyMs).sort((a, b) => a - b);
  const cats = [...new Set(r.map((x) => x.category))];
  return {
    mode, n: r.length,
    hit1: mean(ans.map((x) => +x.hit1)), hit5: mean(ans.map((x) => +x.hit5)), mrr: mean(ans.map((x) => x.rr)),
    retrievalMixup: mean(ans.filter((x) => x.retrievalMixup !== null).map((x) => x.retrievalMixup!)),
    citationPrecision: mean(ans.filter((x) => x.citationPrecision !== null).map((x) => x.citationPrecision!)),
    faithfulness: mean(r.filter((x) => x.faithfulness !== null).map((x) => x.faithfulness!)),
    correctness: mean(r.filter((x) => x.correctness !== null).map((x) => x.correctness!)),
    mixupRate: mean(ans.filter((x) => x.mixedUp !== null).map((x) => +x.mixedUp!)),
    numbersFound: mean(ans.filter((x) => x.numbersFound !== null).map((x) => x.numbersFound!)),
    refusalAccuracy: mean(r.map((x) => +x.refusalCorrect)),
    falseRefusalRate: mean(ans.map((x) => +x.refused)),
    refusalRecall: mean(ref.map((x) => +x.refused)),
    avgLatencyMs: mean(lat), p50LatencyMs: lat[Math.floor(lat.length / 2)] ?? 0,
    geminiCalls: r.reduce((a, x) => a + x.geminiCalls, 0),
    rejectedNotVerbatim: r.reduce((a, x) => a + x.rejected.notVerbatim, 0), rejectedOutOfScope: r.reduce((a, x) => a + x.rejected.outOfScope, 0),
    byCategory: Object.fromEntries(cats.map((c) => { const cr = r.filter((x) => x.category === c); return [c, { n: cr.length, hit5: mean(cr.filter((x) => !x.expectRefusal).map((x) => +x.hit5)), correctness: mean(cr.map((x) => x.correctness ?? 0)), faithfulness: mean(cr.map((x) => x.faithfulness ?? 0)) }]; })),
  };
}

/** Share of the expected numbers that appear in the answer (a judge-free correctness signal). */
export function numbersFound(answer: string, numbers: string[]): number | null {
  if (!numbers.length) return null;
  const a = answer.replace(/−/g, "-");
  return numbers.filter((n) => new RegExp(`(^|[^\\d.])${n.replace(/[.$]/g, (m) => `\\${m}`)}(?![\\d])`).test(a) || (n.endsWith(".0") && a.includes(n.slice(0, -2)))).length / numbers.length;
}

export async function runEval(opts: { modes: AskMode[]; ids?: string[]; resume?: boolean; outPath?: string; onRow?: (row: EvalRow, i: number, total: number) => void }): Promise<EvalReport> {
  const out = opts.outPath ?? EVAL_PATH;
  const golden = await readGolden();
  const store = getStore();
  const regionOfPage = regionByPage(await store.sections());
  let qs: GoldenQuestion[] = golden.questions;
  if (opts.ids?.length) qs = qs.filter((q) => opts.ids!.includes(q.id));

  let report: EvalReport = { ranAt: new Date().toISOString(), golden: path.basename(GOLDEN_PATH), store: store.name, rows: [], summaries: {} };
  if (opts.resume) { try { report = JSON.parse(await readFile(out, "utf8")); } catch { /* fresh */ } }
  // re-running named ids replaces their rows; everything else in a resumed report is kept
  if (opts.resume && opts.ids?.length) report.rows = report.rows.filter((r) => !(opts.ids!.includes(r.id) && opts.modes.includes(r.mode)));
  const done = new Set(report.rows.filter((r) => !r.error).map((r) => `${r.mode}:${r.id}`));
  report.rows = report.rows.filter((r) => !r.error);
  const total = qs.length * opts.modes.length;
  let i = 0;

  for (const mode of opts.modes) {
    for (const q of qs) {
      i++;
      if (done.has(`${mode}:${q.id}`)) continue;
      let row: EvalRow;
      try {
        const r = await ask(q.question, { mode });
        const items = r.retrieved as RetrievedItem[];
        const s = scoreRetrieval(items, q, regionOfPage);
        const cited = r.citations.map((c) => r.sources.find((x) => x.n === c.source)).filter((x) => x && x.kind !== "computed");
        const citationPrecision = cited.length ? cited.filter((src) => q.locations.some((l) => matches(src!, l))).length / cited.length : null;
        const expectedRegions = new Set(q.locations.map((l) => l.region).filter(Boolean));
        const citedOutOfScope = expectedRegions.size ? cited.filter((src) => { const reg = src!.kind === "naive" ? regionOfPage(src!.pdfStart) : src!.region; return reg && !expectedRegions.has(reg); }).length : 0;
        const v = await judge(q.question, r.answer, q.expected_answer, q.numbers, r.sources.map((x) => x.text));
        row = {
          id: q.id, category: q.category, question: q.question, expected: q.expected_answer, expectRefusal: !!q.expect_refusal, mode,
          answer: r.answer, refused: r.refused, refusal: r.refusal, route: `${r.route.how}: ${[r.route.regions.join("+"), r.route.chapter, r.route.boxId].filter(Boolean).join(", ") || "no filter"}`,
          firstRelevant: s.firstRelevant, hit1: s.hit1, hit5: s.hit5, rr: s.rr, retrievalMixup: s.mixup, citationPrecision, citedOutOfScope,
          refusalCorrect: !!q.expect_refusal === r.refused, faithfulness: v.faithfulness, correctness: v.correctness, mixedUp: v.mixedUp,
          numbersFound: numbersFound(r.answer, q.numbers), judgeNote: v.note, latencyMs: r.latencyMs, geminiCalls: r.geminiCalls + 1, rejected: r.rejected,
        };
      } catch (err) {
        row = {
          id: q.id, category: q.category, question: q.question, expected: q.expected_answer, expectRefusal: !!q.expect_refusal, mode, answer: "", refused: false, refusal: null, route: "",
          firstRelevant: null, hit1: false, hit5: false, rr: 0, retrievalMixup: null, citationPrecision: null, citedOutOfScope: 0, refusalCorrect: false,
          faithfulness: null, correctness: null, mixedUp: null, numbersFound: null, judgeNote: "", latencyMs: 0, geminiCalls: 0, rejected: { notVerbatim: 0, outOfScope: 0 },
          error: err instanceof Error ? err.message : String(err),
        };
      }
      report.rows.push(row);
      for (const m of opts.modes) report.summaries[m] = summarize(report.rows, m);
      report.ranAt = new Date().toISOString();
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, JSON.stringify(report, null, 2));
      opts.onRow?.(row, i, total);
      if (row.error && /budget exhausted|every gemini text model/i.test(row.error)) throw new Error(row.error);
    }
  }
  return report;
}
