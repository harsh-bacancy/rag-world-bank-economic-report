/**
 * BM25 for the local store. Postgres' `ts_rank_cd` plays this role in the Supabase store; both see the
 * same retrieval text (heading path + chunk + tables read as prose), so exact strings like "Table 2.9",
 * "2026/27" or "SAR" do real work.
 */
const STOP = new Set("a an and are as at be been but by for from has have in is it its of on or that the this to was were will with which what how does do did than then there their these those into over under about after before between during per can could would should may might also not no yes".split(" "));

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.normalize("NFKC").toLowerCase().matchAll(/\d{4}\/\d{2}[ef]?|\d+(?:\.\d+)?[a-z]?|[a-z]+/g)) {
    let t = m[0];
    if (STOP.has(t)) continue;
    if (/^[a-z]+$/.test(t) && t.length > 4) {
      if (t.endsWith("ies")) t = `${t.slice(0, -3)}y`;
      else if (t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us")) t = t.slice(0, -1);
    }
    out.push(t);
  }
  return out;
}

export class BM25 {
  private readonly docs: Map<string, number>[] = [];
  private readonly lengths: number[] = [];
  private readonly df = new Map<string, number>();
  private avgLen = 0;

  constructor(private readonly ids: string[], texts: string[], private readonly k1 = 1.2, private readonly b = 0.75) {
    texts.forEach((t) => {
      const tf = new Map<string, number>();
      const toks = tokenize(t);
      for (const w of toks) tf.set(w, (tf.get(w) ?? 0) + 1);
      for (const w of tf.keys()) this.df.set(w, (this.df.get(w) ?? 0) + 1);
      this.docs.push(tf);
      this.lengths.push(toks.length);
    });
    this.avgLen = this.lengths.reduce((a, b) => a + b, 0) / Math.max(1, this.lengths.length);
  }

  /** Top-k ids with scores; `allow` restricts the candidate set (metadata filters). */
  search(query: string, k: number, allow?: (id: string) => boolean): { id: string; score: number }[] {
    const q = [...new Set(tokenize(query))];
    const N = this.docs.length;
    const scored: { id: string; score: number }[] = [];
    this.docs.forEach((tf, i) => {
      const id = this.ids[i];
      if (allow && !allow(id)) return;
      let s = 0;
      for (const w of q) {
        const f = tf.get(w);
        if (!f) continue;
        const df = this.df.get(w) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        s += idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * this.lengths[i]) / this.avgLen)));
      }
      if (s > 0) scored.push({ id, score: s });
    });
    return scored.sort((a, b) => b.score - a.score).slice(0, k);
  }
}

/** Reciprocal Rank Fusion. Only ranks matter, so cosine and BM25 never need a common scale. k = 50 as in the SQL function. */
export function rrf(lists: { id: string }[][], k = 50): { id: string; score: number }[] {
  const s = new Map<string, number>();
  for (const list of lists) list.forEach((x, i) => s.set(x.id, (s.get(x.id) ?? 0) + 1 / (k + i + 1)));
  return [...s.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na * nb) || 1);
}
