/**
 * Answer-level eval, naive vs full, on the golden set → data/eval/latest.json → /eval.
 * Needs GOOGLE_GENERATIVE_AI_API_KEY. ~60 questions × 2 modes ≈ 260–300 Gemini calls (answers + judge + a few
 * routing/arithmetic calls): most of one model's 500/day. Run it alone (one Gemini process at a time).
 *   npm run eval
 *   npm run eval -- --mode full --ids S1,S2,S3
 *   npm run eval -- --resume
 */
import { hasGeminiKey } from "@/lib/gemini/client";
import { runEval } from "@/lib/eval/run";

if (!hasGeminiKey()) { console.error("Set GOOGLE_GENERATIVE_AI_API_KEY in .env.local first (see START_HERE.md). For a no-key run use: npm run eval:retrieval"); process.exit(1); }
const args = process.argv.slice(2);
const get = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const mode = get("--mode") ?? "both";
const modes = mode === "both" ? (["naive", "full"] as const) : ([mode] as ["naive" | "full"]);
const r = await runEval({
  modes: [...modes], ids: get("--ids")?.split(","), resume: args.includes("--resume"),
  onRow: (x, i, n) => console.log(`[${i}/${n}] ${x.mode.padEnd(5)} ${x.id.padEnd(4)} hit5=${x.hit5 ? "✓" : "·"} correct=${x.correctness ?? "-"} ${x.refused ? "REFUSED " : ""}${x.error ? `ERROR ${x.error.slice(0, 80)}` : x.answer.slice(0, 70)}`),
});
for (const [m, s] of Object.entries(r.summaries)) console.log(`\n${m}: hit@5 ${(s!.hit5 * 100).toFixed(0)}% · MRR ${s!.mrr.toFixed(2)} · correctness ${s!.correctness.toFixed(2)} · faithfulness ${s!.faithfulness.toFixed(2)} · mix-ups ${(s!.mixupRate * 100).toFixed(0)}% · citation precision ${(s!.citationPrecision * 100).toFixed(0)}% · refusal accuracy ${(s!.refusalAccuracy * 100).toFixed(0)}% · p50 ${(s!.p50LatencyMs / 1000).toFixed(1)} s · ${s!.geminiCalls} calls`);
