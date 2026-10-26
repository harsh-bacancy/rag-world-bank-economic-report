import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { EMBEDDING_DIMS, MODELS, geminiEmbed, hasGeminiKey } from "@/lib/gemini/client";
import { textHash } from "./chunk";

type Task = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";
const FILE = path.join(process.cwd(), ".cache", "embeddings.json");

/**
 * Embeddings are cached by (model, dims, task, text hash): re-ingesting or re-running the eval costs
 * no calls for text already seen. Without an API key the cache still serves what it has; missing
 * vectors come back as null and the dense channel switches off.
 */
let mem: Record<string, number[]> | null = null;
let dirty = false;

async function load(): Promise<Record<string, number[]>> {
  if (mem) return mem;
  try { mem = JSON.parse(await readFile(FILE, "utf8")); } catch { mem = {}; }
  return mem!;
}
export async function saveEmbeddings() {
  if (!dirty || !mem) return;
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(mem));
  dirty = false;
}

const key = (task: Task, text: string) => `${MODELS.embedding}:${EMBEDDING_DIMS}:${task}:${textHash(text)}`;

export async function embedTexts(texts: string[], task: Task, opts: { fetchMissing?: boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<(number[] | null)[]> {
  const cache = await load();
  const out = texts.map((t) => cache[key(task, t)] ?? null);
  const missing = texts.map((t, i) => (out[i] ? -1 : i)).filter((i) => i >= 0);
  if (missing.length && (opts.fetchMissing ?? true) && hasGeminiKey()) {
    const unique = [...new Set(missing.map((i) => texts[i]))];
    // save after every batch, so a stopped run resumes where it left off
    await geminiEmbed(unique, task, async (done, total, vecs, start) => {
      vecs.forEach((v, j) => { cache[key(task, unique[start + j])] = v.map((x) => Math.round(x * 1e6) / 1e6); });
      dirty = true;
      await saveEmbeddings();
      opts.onProgress?.(done, total);
    });
    missing.forEach((i) => { out[i] = cache[key(task, texts[i])]; });
  }
  return out;
}

export async function embedQuery(q: string): Promise<number[] | null> {
  const [v] = await embedTexts([q], "RETRIEVAL_QUERY");
  return v;
}
