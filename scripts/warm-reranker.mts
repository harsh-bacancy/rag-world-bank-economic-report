/** Load the cross-encoder once and score a sanity pair. Set RERANKER_ALLOW_REMOTE=1 to download weights if .cache/models is empty. */
import { rerank } from "@/lib/retrieval/rerank";
const t0 = Date.now();
const r = await rerank("What is the growth outlook for South Asia?", ["Growth in SAR is expected to soften to 6.3 percent in 2026.", "Growth in SSA is forecast to edge down to 4 percent in 2026."], (s) => s, 2);
console.log(r.map((x) => `${x.score.toFixed(3)}  ${x.item}`).join("\n"), `\n(${Date.now() - t0} ms incl. load)`);
