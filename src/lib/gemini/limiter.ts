import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Gemini free tier: requests, not tokens, are the binding constraint (10 RPM / 1,500 RPD for Flash).
 * Every Gemini call in this codebase goes through `limiter.run()`. Never call the SDK directly.
 *
 * - Sliding window for RPM (timestamps of the last minute).
 * - Daily counter persisted to .cache/gemini-quota.json so CLI runs and the dev server share the budget.
 * - 429s back off and retry (the free tier answers 429 slightly before the documented limit).
 */
export class GeminiLimiter {
  private window: number[] = [];
  private queue: Promise<void> = Promise.resolve();
  private readonly rpm: number;
  private readonly rpd: number;
  private readonly quotaFile: string;

  constructor(opts: { rpm?: number; rpd?: number; quotaFile?: string } = {}) {
    this.rpm = opts.rpm ?? Number(process.env.GEMINI_RPM ?? 10);
    this.rpd = opts.rpd ?? Number(process.env.GEMINI_RPD ?? 1500);
    this.quotaFile = opts.quotaFile ?? path.join(process.cwd(), ".cache", "gemini-quota.json");
  }

  /** Serialises acquisition so concurrent callers never overshoot the window. */
  private acquire(): Promise<void> {
    const next = this.queue.then(async () => {
      const day = await this.readDay();
      if (day.count >= this.rpd) {
        throw new Error(`Gemini daily budget exhausted (${day.count}/${this.rpd}). Resets at midnight UTC.`);
      }
      const now = Date.now();
      this.window = this.window.filter((t) => now - t < 60_000);
      if (this.window.length >= this.rpm) {
        const wait = 60_000 - (now - this.window[0]) + 250;
        await sleep(wait);
      }
      this.window.push(Date.now());
      await this.writeDay({ ...day, count: day.count + 1 });
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  async run<T>(label: string, fn: () => Promise<T>, retries = 3): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.acquire();
      try {
        return await fn();
      } catch (err) {
        const status = (err as { statusCode?: number; status?: number })?.statusCode ?? (err as { status?: number })?.status;
        const msg = err instanceof Error ? err.message : String(err);
        const dailyQuota = isDailyQuotaError(err);
        const rateLimited = !dailyQuota && (status === 429 || /429|RESOURCE_EXHAUSTED|quota/i.test(msg));
        const overloaded = status === 503 || /503|UNAVAILABLE|high demand|overloaded/i.test(msg);
        if (dailyQuota) throw new DailyQuotaError(msg); // no point waiting 20 s for a window that resets at midnight
        if ((rateLimited || overloaded) && attempt < retries) {
          // honour the API's own "retry in 15.1s" when it gives one
          const hinted = /retry in ([\d.]+)s/i.exec(msg);
          const wait = hinted ? Math.ceil(Number(hinted[1]) * 1000) + 1500 : (rateLimited ? 20_000 : 30_000) * (attempt + 1);
          console.warn(`[gemini] ${label}: ${rateLimited ? "rate limited" : "model overloaded"}, retrying in ${wait / 1000}s (attempt ${attempt + 1}/${retries})`);
          await sleep(wait);
          continue;
        }
        throw err;
      }
    }
  }

  async usage(): Promise<{ today: number; rpd: number; rpm: number; spent: string[] }> {
    const day = await this.readDay();
    return { today: day.count, rpd: this.rpd, rpm: this.rpm, spent: day.spent ?? [] };
  }

  /** Remember that a model's per-day quota is gone, so the chain skips it until midnight UTC. */
  async markSpent(model: string) {
    const day = await this.readDay();
    if (!(day.spent ?? []).includes(model)) await this.writeDay({ ...day, spent: [...(day.spent ?? []), model] });
  }
  async isSpent(model: string): Promise<boolean> {
    return ((await this.readDay()).spent ?? []).includes(model);
  }

  private async readDay(): Promise<{ date: string; count: number; spent?: string[] }> {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const raw = JSON.parse(await fs.readFile(this.quotaFile, "utf8")) as { date: string; count: number; spent?: string[] };
      if (raw.date === today) return raw;
    } catch { /* first run or corrupt file */ }
    return { date: today, count: 0, spent: [] };
  }

  private async writeDay(day: { date: string; count: number; spent?: string[] }) {
    await fs.mkdir(path.dirname(this.quotaFile), { recursive: true });
    await fs.writeFile(this.quotaFile, JSON.stringify(day));
  }
}

/** "Quota exceeded for metric: …free_tier_requests, limit: 500, model: gemini-3.5-flash-lite" — a per-day cap, per model. */
export function isDailyQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  // "…_free_tier_requests … per minute" is a rate limit, not the day's cap: only treat it as daily when no minute is named
  if (/per minute|PerMinute|requests per minute/i.test(msg)) return false;
  return /free_tier_requests|per day|PerDay|RPD|daily/i.test(msg) && /quota|exceeded/i.test(msg);
}
export class DailyQuotaError extends Error {
  readonly daily = true;
  constructor(msg: string) { super(msg); this.name = "DailyQuotaError"; }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// One limiter per process; the daily counter file makes separate processes share the budget.
// The cache key carries a version: with hot reloading, an instance built by an older class would otherwise
// survive a code change and lack newly added methods ("limiter.isSpent is not a function").
const LIMITER_VERSION = 3;
const g = globalThis as unknown as Record<string, GeminiLimiter | undefined>;
const KEY = `__geminiLimiter_v${LIMITER_VERSION}`;
if (!g[KEY] || typeof g[KEY]!.isSpent !== "function") g[KEY] = new GeminiLimiter();
export const limiter = g[KEY]!;
