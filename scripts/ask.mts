/**
 * Ask the report from the terminal.
 *   npm run ask -- "What is the growth outlook for South Asia?"
 *   npm run ask -- "…" --naive            the eval baseline
 *   npm run ask -- "…" --retrieve-only    route + retrieve + rerank, no generation (0 Gemini calls with rules routing)
 *   npm run ask -- "…" --route llm        LLM query understanding instead of rules
 *   npm run ask -- "…" --no-rerank --no-parents --json
 */
import { ask } from "@/lib/retrieval/ask";
import { describeRoute } from "@/lib/eval/retrieval";

const args = process.argv.slice(2);
const question = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--route").join(" ");
if (!question) { console.error('usage: npm run ask -- "question" [--naive] [--retrieve-only] [--route rules|llm|none] [--no-rerank] [--no-parents] [--json]'); process.exit(1); }
const ri = args.indexOf("--route");
const config = {
  ...(ri >= 0 ? { route: args[ri + 1] as "rules" | "llm" | "none" } : {}),
  ...(args.includes("--no-rerank") ? { rerank: false } : {}),
  ...(args.includes("--no-parents") ? { parents: false } : {}),
};
const r = await ask(question, { mode: args.includes("--naive") ? "naive" : "full", config, retrieveOnly: args.includes("--retrieve-only") });
if (args.includes("--json")) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }

console.log(`\n${r.mode.toUpperCase()} · ${describeRoute(r.route)}${r.widened ? " (widened)" : ""} · ${r.channel} · top rerank ${r.topScore?.toFixed(3) ?? "n/a"}`);
console.log(`search query: ${r.route.searchQuery}\n`);
console.log("Retrieved:");
r.retrieved.forEach((it, i) => console.log(`  ${i + 1}. ${(it.rerankScore ?? it.score).toFixed(3)}  ${it.headingPath ?? "(naive chunk)"} · p. ${it.printed}`));
console.log(`\n${r.answer}\n`);
for (const c of r.citations) console.log(`  [^${c.n}] ${c.label}\n        “${c.span}”`);
if (r.computed) console.log(`\nComputed source:\n${r.computed}`);
console.log(`\nrejected: ${r.rejected.notVerbatim} not verbatim, ${r.rejected.outOfScope} out of scope · ${r.geminiCalls} Gemini calls · ${(r.latencyMs / 1000).toFixed(1)} s${r.refusal ? ` · refusal: ${r.refusal}${r.refusalReason ? ` (${r.refusalReason})` : ""}` : ""}`);
