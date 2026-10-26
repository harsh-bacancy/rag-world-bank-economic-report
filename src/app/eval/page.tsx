import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RetrievalReport } from "@/lib/eval/retrieval";
import type { EvalReport, EvalSummary } from "@/lib/eval/run";
import { RunningHead } from "@/components/running-head";

export const metadata: Metadata = { title: "Evaluation" };
export const dynamic = "force-dynamic";

async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(path.join(process.cwd(), "data", "eval", file), "utf8")) as T; } catch { return null; }
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmtDate = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";

/** A value with its bar: the bar is the plate, the number is the fact. */
function Bar({ value, max = 1, best, label }: { value: number; max?: number; best?: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`num w-10 shrink-0 text-right text-[13px] ${best ? "font-semibold text-ink" : "text-ink-2"}`}>{label}</span>
      <span className="relative h-2 flex-1 bg-page-2" aria-hidden>
        <span className={`absolute inset-y-0 left-0 ${best ? "bg-ink" : "bg-ink-3/60"}`} style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%` }} />
      </span>
    </div>
  );
}

export default async function EvalPage() {
  const retrieval = await readJson<RetrievalReport>("retrieval-latest.json");
  const answers = await readJson<EvalReport>("latest.json");

  return (
    <>
    <RunningHead title="Evaluation" />
    <main className="mx-auto w-full max-w-[1120px] px-4 pb-24 pt-8 md:px-8">
      <h1 className="record text-[34px] font-semibold leading-tight tracking-[-0.01em]">Evaluation</h1>
      <p className="mt-2 max-w-[70ch] text-[15px] leading-relaxed text-ink-2">
        Sixty questions written before any pipeline code (<code className="text-[13px]">data/golden/gep-golden.json</code>), each with the chapter, section and pages that hold its answer.
        A retrieved passage counts only if it sits in that place: right chapter, right region or box, overlapping pages.
      </p>

      <section className="mt-10" aria-labelledby="ladder" data-guide="What each technique moved">
        <h2 id="ladder" className="record text-[22px] font-semibold">What each technique moved</h2>
        {retrieval ? (
          <>
            <p className="mt-1 text-[13px] text-ink-3">
              Retrieval only, {retrieval.questions} answerable questions · {retrieval.dense ? "meaning + keywords (embeddings present)" : "keyword channel only: no embeddings yet, so the dense and hybrid rungs are skipped"} · run {fmtDate(retrieval.ranAt)}
            </p>
            <MobileLadder report={retrieval} />
            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-rule-strong text-left text-[12px] text-ink-3">
                    <th scope="col" className="py-2 pr-4 font-semibold">Rung (one technique added)</th>
                    <th scope="col" className="w-[150px] py-2 pr-4 font-semibold">hit@1</th>
                    <th scope="col" className="w-[150px] py-2 pr-4 font-semibold">hit@5</th>
                    <th scope="col" className="w-[170px] py-2 pr-4 font-semibold">MRR</th>
                    <th scope="col" className="w-[110px] py-2 font-semibold">Wrong-region share of top 5</th>
                  </tr>
                </thead>
                <tbody>
                  {retrieval.rungs.map((r, i) => {
                    const main = retrieval.rungs.filter((x) => !x.label.startsWith("A/B"));
                    const best = (k: "hit1" | "hit5" | "mrr") => Math.max(...main.map((x) => x[k]));
                    const prev = main[main.indexOf(r) - 1];
                    const ab = r.label.startsWith("A/B");
                    return (
                      <tr key={r.key} className={`border-b border-rule align-top ${ab ? "text-ink-2" : ""} ${ab && !retrieval.rungs[i - 1]?.label.startsWith("A/B") ? "border-t-2 border-t-rule-strong" : ""}`}>
                        <td className="py-2.5 pr-4">
                          <span className="font-medium text-ink">{r.label.replace(/^A\/B: /, "")}</span>
                          <span className="block text-[12px] text-ink-3">{ab ? "A/B check: " : ""}{r.technique}{prev && !ab ? ` · MRR ${r.mrr - prev.mrr >= 0 ? "+" : "−"}${Math.abs(r.mrr - prev.mrr).toFixed(2)}` : ""}</span>
                        </td>
                        <td className="py-2.5 pr-4"><Bar value={r.hit1} label={pct(r.hit1)} best={!ab && r.hit1 === best("hit1")} /></td>
                        <td className="py-2.5 pr-4"><Bar value={r.hit5} label={pct(r.hit5)} best={!ab && r.hit5 === best("hit5")} /></td>
                        <td className="py-2.5 pr-4"><Bar value={r.mrr} label={r.mrr.toFixed(2)} best={!ab && r.mrr === best("mrr")} /></td>
                        <td className="num py-2.5 text-right">{pct(r.mixup)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {retrieval.skipped.length > 0 && <p className="mt-2 text-[12px] text-ink-3">Not run: {retrieval.skipped.map((s) => `${s.key} (${s.why})`).join(" · ")}.</p>}
            <p className="mt-3 max-w-[75ch] text-[13px] leading-relaxed text-ink-3">
              Field guide, same report, 13 questions, bge-small embeddings: MRR 0.26 naive → 0.76 with rerank → 0.88 reading parents. Parents are bigger targets, so their row is not directly comparable with the rows above it.
            </p>

            {retrieval.gate && (
              <div className="mt-10 grid gap-8 md:grid-cols-[1fr_320px]">
                <div>
                  <h3 className="text-[16px] font-semibold">The refusal gate</h3>
                  <p className="mt-1 max-w-[62ch] text-[14px] leading-relaxed text-ink-2">
                    Before any answer is written, the best reranked passage must score at least <span className="num font-semibold text-ink">{retrieval.gate.threshold}</span>; questions about a chapter, box or year the report does not have are refused by rule.
                    On all {retrieval.gate.scores.length} questions this decides correctly <span className="num font-semibold text-ink">{pct(retrieval.gate.accuracy)}</span> of the time, with {retrieval.gate.falseRefusals} false refusal{retrieval.gate.falseRefusals === 1 ? "" : "s"} and {retrieval.gate.missedRefusals} question{retrieval.gate.missedRefusals === 1 ? "" : "s"} passed on for the model to refuse. No model call is spent on a refused question.
                  </p>
                </div>
                <GateChart gate={retrieval.gate} />
              </div>
            )}

            <details className="group mt-8">
              <summary className="cursor-pointer list-none text-[13px] font-semibold text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden"><span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span> per-question results for the final rung</summary>
              <PerQuestion report={retrieval} />
            </details>
          </>
        ) : (
          <Empty cmd="npm run eval:retrieval" what="the retrieval ladder (no API key needed)" />
        )}
      </section>

      <section className="mt-14" aria-labelledby="answers" data-guide="Answers: naive versus full">
        <h2 id="answers" className="record text-[22px] font-semibold">Answers: naive versus full</h2>
        {answers?.summaries.full || answers?.summaries.naive ? <AnswerTable report={answers} /> : <Empty cmd="npm run eval" what="the answer-level comparison (needs GOOGLE_GENERATIVE_AI_API_KEY; about 280 Gemini calls)" />}
      </section>
    </main>
    </>
  );
}

function GateChart({ gate }: { gate: NonNullable<RetrievalReport["gate"]> }) {
  const w = 320, h = 150, pad = 24;
  const pts = gate.sweep;
  const x = (t: number) => pad + ((t - pts[0].threshold) / (pts[pts.length - 1].threshold - pts[0].threshold)) * (w - pad * 2);
  const y = (a: number) => h - pad - a * (h - pad * 2);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.threshold).toFixed(1)},${y(p.accuracy).toFixed(1)}`).join(" ");
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={`Gate accuracy by threshold; chosen threshold ${gate.threshold} gives ${pct(gate.accuracy)}`}>
        {[0, 0.5, 1].map((a) => (
          <g key={a}>
            <line x1={pad} x2={w - pad} y1={y(a)} y2={y(a)} stroke="var(--rule)" strokeWidth="1" />
            <text x={pad - 4} y={y(a) + 3} textAnchor="end" fontSize="9" fill="var(--ink-3)">{pct(a)}</text>
          </g>
        ))}
        <path d={d} fill="none" stroke="var(--ink-2)" strokeWidth="1.5" />
        <line x1={x(gate.threshold)} x2={x(gate.threshold)} y1={pad / 2} y2={h - pad} stroke="var(--ink)" strokeWidth="1.5" />
        <circle cx={x(gate.threshold)} cy={y(gate.accuracy)} r="3.5" fill="var(--ink)" />
        <text x={x(gate.threshold) + 5} y={pad / 2 + 8} fontSize="10" fill="var(--ink)">threshold {gate.threshold}</text>
        <text x={w - pad} y={h - 6} textAnchor="end" fontSize="9" fill="var(--ink-3)">best-passage score →</text>
      </svg>
      <figcaption className="mt-1 text-[12px] text-ink-3">Gate accuracy as the threshold moves; the line marks the one in use.</figcaption>
    </figure>
  );
}

function PerQuestion({ report }: { report: RetrievalReport }) {
  const final = report.rungs.find((r) => r.key === "parents") ?? report.rungs[report.rungs.length - 1];
  const naive = report.rungs.find((r) => r.key === "naive");
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-rule-strong text-left text-ink-3">
            <th className="py-1.5 pr-3 font-semibold">ID</th><th className="py-1.5 pr-3 font-semibold">Kind</th><th className="py-1.5 pr-3 font-semibold">Route</th>
            <th className="py-1.5 pr-3 text-right font-semibold">First right passage (naive)</th><th className="py-1.5 pr-3 text-right font-semibold">First right passage (final)</th><th className="py-1.5 font-semibold">Top passage (final)</th>
          </tr>
        </thead>
        <tbody>
          {final.rows.map((row) => {
            const n = naive?.rows.find((x) => x.id === row.id);
            return (
              <tr key={row.id} className="border-b border-rule/70 align-top">
                <td className="num py-1.5 pr-3 font-semibold">{row.id}</td>
                <td className="py-1.5 pr-3 text-ink-2">{row.category.replace("_", "-")}</td>
                <td className="py-1.5 pr-3 text-ink-2">{row.route.replace(/^rules: /, "")}{row.widened ? " (widened)" : ""}</td>
                <td className="num py-1.5 pr-3 text-right text-ink-3">{n?.firstRelevant ?? "—"}</td>
                <td className={`num py-1.5 pr-3 text-right ${row.firstRelevant === 1 ? "font-semibold text-ink" : row.firstRelevant ? "text-ink-2" : "italic text-ink-3"}`}>{row.firstRelevant ?? "missed"}</td>
                <td className="py-1.5 text-ink-2">{row.top[0]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AnswerTable({ report }: { report: EvalReport }) {
  const n = report.summaries.naive, f = report.summaries.full;
  const rows: { label: string; key: keyof EvalSummary; fmt: (x: number) => string; higher: boolean; note?: string }[] = [
    { label: "Right place in top 5 (hit@5)", key: "hit5", fmt: pct, higher: true },
    { label: "Mean reciprocal rank", key: "mrr", fmt: (x) => x.toFixed(2), higher: true },
    { label: "Answer correctness (judge, anchored on human answers)", key: "correctness", fmt: (x) => x.toFixed(2), higher: true },
    { label: "Expected numbers present", key: "numbersFound", fmt: pct, higher: true, note: "judge-free" },
    { label: "Faithfulness to the passages", key: "faithfulness", fmt: (x) => x.toFixed(2), higher: true },
    { label: "Answers mixing regions or chapters", key: "mixupRate", fmt: pct, higher: false, note: "the pass/fail bar" },
    { label: "Citation precision (cited passages in the right place)", key: "citationPrecision", fmt: pct, higher: true },
    { label: "Refusal accuracy", key: "refusalAccuracy", fmt: pct, higher: true },
    { label: "False refusals", key: "falseRefusalRate", fmt: pct, higher: false },
    { label: "Median latency", key: "p50LatencyMs", fmt: (x) => `${(x / 1000).toFixed(1)} s`, higher: false },
    { label: "Gemini calls (incl. judge)", key: "geminiCalls", fmt: (x) => String(x), higher: false },
  ];
  return (
    <>
      <p className="mt-1 text-[13px] text-ink-3">{report.rows.length} rows · run {fmtDate(report.ranAt)} · judge: Gemini grading Gemini (a known bias; numbers and locations are checked without it)</p>
      <table className="mt-4 w-full max-w-[760px] border-collapse text-[14px]">
        <thead>
          <tr className="border-b border-rule-strong text-left text-[12px] text-ink-3"><th className="py-2 font-semibold">Metric</th><th className="py-2 text-right font-semibold">Naive</th><th className="py-2 text-right font-semibold">Full</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const a = n?.[r.key] as number | undefined, b = f?.[r.key] as number | undefined;
            const better = a !== undefined && b !== undefined && (r.higher ? b > a : b < a);
            return (
              <tr key={r.key} className="border-b border-rule">
                <td className="py-2 pr-4 text-ink-2">{r.label}{r.note && <span className="ml-1.5 text-[12px] text-ink-3">({r.note})</span>}</td>
                <td className="num py-2 text-right text-ink-2">{a !== undefined ? r.fmt(a) : "—"}</td>
                <td className={`num py-2 text-right ${better ? "font-semibold text-ink" : "text-ink-2"}`}>{b !== undefined ? r.fmt(b) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function Empty({ cmd, what }: { cmd: string; what: string }) {
  return (
    <p className="record mt-4 max-w-[640px] border-y border-rule py-3 text-[16px] leading-relaxed text-ink-2">
      No results yet for {what}. Run <code className="font-[var(--font-ui)] text-[14px] text-ink" style={{ fontFamily: "ui-monospace, monospace" }}>{cmd}</code> in the project folder, then reload.
    </p>
  );
}

/** Below md the ladder reads as entries, not a table: label, then four tabular numbers. */
function MobileLadder({ report }: { report: RetrievalReport }) {
  return (
    <ol className="mt-4 border-t border-rule-strong md:hidden">
      {report.rungs.map((r) => (
        <li key={r.key} className="border-b border-rule py-2.5">
          <p className="text-[14px] font-medium text-ink">{r.label.replace(/^A\/B: /, "A/B: ")}</p>
          <p className="text-[12px] text-ink-3">{r.technique}</p>
          <dl className="num mt-1.5 grid grid-cols-4 gap-2 text-[13px]">
            {([["hit@1", pct(r.hit1)], ["hit@5", pct(r.hit5)], ["MRR", r.mrr.toFixed(2)], ["wrong region", pct(r.mixup)]] as const).map(([k, v]) => (
              <div key={k}><dt className="text-[11px] text-ink-3">{k}</dt><dd className="text-ink">{v}</dd></div>
            ))}
          </dl>
        </li>
      ))}
    </ol>
  );
}
