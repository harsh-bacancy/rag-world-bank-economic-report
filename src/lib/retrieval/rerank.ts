import { AutoModelForSequenceClassification, AutoTokenizer, env, type PreTrainedModel, type PreTrainedTokenizer } from "@huggingface/transformers";
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * bge-reranker-v2-m3 as ONNX, in-process (reused from rag-chatbot). A cross-encoder reads (query, passage)
 * together and scores relevance; it costs nothing per call. Weights live under .cache/models
 * (copied from rag-chatbot's cache, or downloaded once with RERANKER_ALLOW_REMOTE=1 npm run warm-reranker).
 */
const MODEL_ID = process.env.RERANKER_MODEL ?? "onnx-community/bge-reranker-v2-m3-ONNX";
const DTYPE = (process.env.RERANKER_DTYPE ?? "q8") as "fp32" | "fp16" | "q8" | "q4";

env.localModelPath = path.join(process.cwd(), ".cache", "models");
env.cacheDir = path.join(process.cwd(), ".cache", "models");
env.allowLocalModels = true;
env.allowRemoteModels = process.env.RERANKER_ALLOW_REMOTE === "1";

type Loaded = { tokenizer: PreTrainedTokenizer; model: PreTrainedModel };
const g = globalThis as unknown as { __reranker?: Promise<Loaded> };

function load(): Promise<Loaded> {
  return (g.__reranker ??= (async () => {
    const t0 = Date.now();
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
    const model = await AutoModelForSequenceClassification.from_pretrained(MODEL_ID, { dtype: DTYPE });
    if (process.env.DEBUG_RERANK) console.log(`[rerank] ${MODEL_ID} (${DTYPE}) ready in ${Date.now() - t0}ms`);
    return { tokenizer, model };
  })().catch((err) => { g.__reranker = undefined; throw err; }));
}

export interface Reranked<T> { item: T; score: number; rank: number }

// Scores are deterministic for (model, query, passage): cache them so the eval's rungs and repeated
// questions never rescore a pair. Persisted to .cache/rerank.json.
const CACHE_FILE = path.join(process.cwd(), ".cache", "rerank.json");
const gc = globalThis as unknown as { __rerankCache?: Record<string, number>; __rerankDirty?: number };
function cache(): Record<string, number> {
  if (!gc.__rerankCache) {
    try { gc.__rerankCache = JSON.parse(readFileSync(CACHE_FILE, "utf8")); } catch { gc.__rerankCache = {}; }
  }
  return gc.__rerankCache!;
}
const pairKey = (q: string, t: string) => createHash("sha1").update(`${MODEL_ID}|${DTYPE}|${q}|${t}`).digest("base64").slice(0, 20);
export function saveRerankCache() {
  if (!gc.__rerankDirty) return;
  mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache()));
  gc.__rerankDirty = 0;
}

/** Score each passage against the query; returns items sorted by relevance with sigmoid scores in [0,1]. */
export async function rerank<T>(query: string, items: T[], text: (t: T) => string, topK: number): Promise<Reranked<T>[]> {
  if (items.length === 0) return [];
  const c = cache();
  const texts = items.map(text);
  const keys = texts.map((t) => pairKey(query, t));
  const scores: number[] = keys.map((k) => c[k] ?? NaN);
  const todo = scores.map((s, i) => (Number.isNaN(s) ? i : -1)).filter((i) => i >= 0);
  if (todo.length) {
    const { tokenizer, model } = await load();
    for (let i = 0; i < todo.length; i += 8) {
      const batch = todo.slice(i, i + 8);
      const inputs = tokenizer(batch.map(() => query), { text_pair: batch.map((j) => texts[j]), padding: true, truncation: true, max_length: 512 });
      const out = await model(inputs);
      const logits = out.logits as { sigmoid: () => { tolist: () => number[][] } };
      logits.sigmoid().tolist().forEach((r, k) => { scores[batch[k]] = r[0]; c[keys[batch[k]]] = Math.round(r[0] * 1e5) / 1e5; });
    }
    gc.__rerankDirty = (gc.__rerankDirty ?? 0) + todo.length;
    if (gc.__rerankDirty > 200) saveRerankCache();
  }
  return items
    .map((item, i) => ({ item, score: scores[i], rank: 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

export async function warmReranker() { await load(); }
