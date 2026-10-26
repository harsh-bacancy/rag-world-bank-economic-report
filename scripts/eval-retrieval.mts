/**
 * The retrieval ladder on the golden set: one technique added per rung, scored on section-level relevance.
 * With rules routing this makes no LLM calls at all (embeddings come from the cache).
 *   npm run eval:retrieval
 *   npm run eval:retrieval -- --only naive,parents,gate
 */
import { runRetrievalEval } from "@/lib/eval/retrieval";

const args = process.argv.slice(2);
const i = args.indexOf("--only");
const only = i >= 0 ? args[i + 1].split(",") : undefined;
const pct = (x: number) => `${(x * 100).toFixed(0)}%`.padStart(5);
console.log(`${"rung".padEnd(42)} hit@1 hit@3 hit@5   MRR  mix-up  time`);
const r = await runRetrievalEval({
  only,
  onRung: (x) => console.log(`${x.label.padEnd(42)} ${pct(x.hit1)} ${pct(x.hit3)} ${pct(x.hit5)}  ${x.mrr.toFixed(2)}  ${pct(x.mixup)}  ${(x.ms / 1000).toFixed(1)}s`),
});
for (const s of r.skipped) console.log(`skipped ${s.key}: ${s.why}`);
if (r.gate) console.log(`\nrefusal gate: threshold ${r.gate.threshold} → accuracy ${pct(r.gate.accuracy)} (false refusals ${r.gate.falseRefusals}, missed refusals ${r.gate.missedRefusals})`);
console.log(`\n${r.questions} answerable questions · store=${r.store} · dense=${r.dense} → data/eval/retrieval-latest.json`);
