import { google } from "@ai-sdk/google";
import { embedMany, generateObject, generateText } from "ai";
import type { z } from "zod";
import { isDailyQuotaError, limiter } from "./limiter";

// Reused from rag-chatbot (Travel Packet Assistant). Model reality on a new free-tier key (verified 11–13 Sep 2026):
//   gemini-2.5-flash / 2.5-flash-lite → 404 "no longer available to new users"
//   gemini-3.8-flash → free_tier_requests limit 20 PER DAY, and frequent 503 "high demand"
//   gemini-3.5-flash-lite → 500 requests PER DAY (per model); 3.1-flash-lite carries its own daily quota
// When a model's day is spent, text calls fall through the chain instead of waiting for midnight.
// So the lite model is primary for ingestion; text calls walk a fallback chain when a model is overloaded.
export const MODELS = {
  text: process.env.GEMINI_TEXT_MODEL ?? "gemini-3.5-flash-lite",
  textFallbacks: (process.env.GEMINI_TEXT_FALLBACKS ?? "gemini-3.1-flash-lite,gemini-flash-latest").split(",").map((s) => s.trim()).filter(Boolean),
  embedding: process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001",
} as const;

const isOverloaded = (err: unknown) => {
  const status = (err as { statusCode?: number })?.statusCode ?? (err as { lastError?: { statusCode?: number } })?.lastError?.statusCode;
  const msg = err instanceof Error ? err.message : String(err);
  return status === 503 || /503|UNAVAILABLE|high demand|overloaded/i.test(msg);
};

/** Try the primary model, then each fallback, but only when the failure is the model being overloaded. */
async function withFallback<T>(label: string, fn: (modelId: string) => Promise<T>): Promise<T> {
  const chain = [MODELS.text, ...MODELS.textFallbacks];
  let lastErr: unknown;
  for (let i = 0; i < chain.length; i++) {
    if (await limiter.isSpent(chain[i])) continue; // this model's day is over; don't burn a request finding out again
    try {
      return await limiter.run(`${label} [${chain[i]}]`, () => fn(chain[i]), i === 0 ? 2 : 1);
    } catch (err) {
      lastErr = err;
      if (isDailyQuotaError(err)) {
        await limiter.markSpent(chain[i]);
        console.warn(`[gemini] ${label}: ${chain[i]} daily quota spent — skipping it for the rest of the day`);
        continue;
      }
      if (i < chain.length - 1 && isOverloaded(err)) {
        console.warn(`[gemini] ${label}: ${chain[i]} overloaded, falling back to ${chain[i + 1]}`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Every Gemini text model in the chain is spent for today (${chain.join(", ")}). Resets at midnight UTC.`);
}

export const EMBEDDING_DIMS = 768;

type FilePart = { type: "file"; data: Uint8Array; mediaType: string; filename?: string };
type TextPart = { type: "text"; text: string };

/** Plain text generation. */
export async function geminiText(label: string, parts: (FilePart | TextPart)[], system?: string): Promise<string> {
  return withFallback(label, async (modelId) => {
    const { text } = await generateText({
      model: google(modelId),
      system,
      messages: [{ role: "user", content: parts }],
      temperature: 0,
      maxRetries: 1,
    });
    return text;
  });
}

/** Structured output against a zod schema (query understanding, answers, the judge). */
export async function geminiObject<T>(label: string, schema: z.ZodType<T>, parts: (FilePart | TextPart)[], system?: string): Promise<T> {
  return withFallback(label, async (modelId) => {
    const { object } = await generateObject({
      model: google(modelId),
      schema,
      system,
      messages: [{ role: "user", content: parts }],
      temperature: 0,
      maxRetries: 1,
    });
    return object as T;
  });
}

/**
 * Embeddings at 768 dims (Matryoshka truncation). Free-tier limits are per minute and count every TEXT
 * (100 requests) and every TOKEN (30,000): batches are cut at EMBED_BATCH texts or EMBED_TOKENS_PER_MIN × 0.8
 * tokens, and a sliding one-minute window keeps both budgets. taskType matters: documents and queries are
 * embedded asymmetrically.
 */
const EMBED_BATCH = Number(process.env.GEMINI_EMBED_BATCH ?? 90);
const EMBED_PER_MIN = Number(process.env.GEMINI_EMBED_PER_MIN ?? 90);
const EMBED_TOKENS_PER_MIN = Number(process.env.GEMINI_EMBED_TOKENS_PER_MIN ?? 26_000);
const estTokens = (s: string) => Math.ceil(s.length / 3.6); // conservative: the API counts a little more than chars/4
const ge = globalThis as unknown as { __embedWindow?: { t: number; n: number; tok: number }[] };
async function paceEmbeds(n: number, tok: number) {
  const win = (ge.__embedWindow ??= []);
  for (;;) {
    const now = Date.now();
    while (win.length && now - win[0].t > 61_000) win.shift();
    const used = win.reduce((a, x) => a + x.n, 0);
    const usedTok = win.reduce((a, x) => a + x.tok, 0);
    if (!win.length || (used + n <= EMBED_PER_MIN && usedTok + tok <= EMBED_TOKENS_PER_MIN)) { win.push({ t: now, n, tok }); return; }
    await new Promise((r) => setTimeout(r, 61_000 - (now - win[0].t) + 250));
  }
}

export function hasGeminiKey(): boolean {
  return !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
}

export async function geminiEmbed(values: string[], taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY", onBatch?: (done: number, total: number, vectors: number[][], start: number) => Promise<void> | void): Promise<number[][]> {
  const out: number[][] = [];
  const maxTok = Math.floor(EMBED_TOKENS_PER_MIN * 0.8);
  for (let i = 0; i < values.length; ) {
    let j = i, tok = 0;
    while (j < values.length && j - i < EMBED_BATCH && (j === i || tok + estTokens(values[j]) <= maxTok)) { tok += estTokens(values[j]); j++; }
    const batch = values.slice(i, j);
    await paceEmbeds(batch.length, tok);
    const vectors = await limiter.run(`embed[${i}-${i + batch.length}]`, async () => {
      const { embeddings } = await embedMany({
        model: google.textEmbedding(MODELS.embedding),
        values: batch,
        providerOptions: { google: { outputDimensionality: EMBEDDING_DIMS, taskType } },
      });
      return embeddings;
    });
    out.push(...vectors);
    await onBatch?.(j, values.length, vectors, i);
    i = j;
  }
  return out;
}
