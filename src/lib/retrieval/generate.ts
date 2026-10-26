import { z } from "zod";
import { geminiObject } from "@/lib/gemini/client";
import { locateSpan } from "@/lib/text";
import type { ChapterKey, Region } from "@/lib/pdf/types";
import { renderSources, type Source } from "./context";

export const REFUSAL_TEXT = "The report doesn't say that.";

const Answer = z.object({
  answer: z.string().describe("Plain prose, 1–5 sentences, no headings. Every factual claim ends with a marker like [^1]. Say what the sources say and, when relevant, what they do not say."),
  citations: z.array(z.object({
    n: z.number().int().describe("marker number used in the answer"),
    source: z.number().int().describe("1-based number of the source passage this citation points to"),
    quote: z.string().describe("a verbatim span copied character-for-character from that source, 5–30 words, that supports the claim"),
  })),
  refused: z.boolean().describe("true when the sources do not contain what was asked; then answer must be exactly the refusal sentence"),
});
export type RawAnswer = z.infer<typeof Answer>;

export interface VerifiedCitation { n: number; source: number; sourceId: string; label: string; printed: string; region: Region | null; chapter: ChapterKey | null; span: string; verified: boolean; reason?: "not_verbatim" | "out_of_scope" | "no_source" }
export interface GeneratedAnswer { answer: string; citations: VerifiedCitation[]; rejected: { notVerbatim: number; outOfScope: number }; refused: boolean; raw: string }

/** What the routed question is about. A citation from outside it is stripped like a non-verbatim quote. */
export interface Scope { regions: Region[]; chapters: ChapterKey[] }

const SYSTEM = (opts: { nudge?: boolean; repair?: boolean }) => [
  "You answer questions about ONE document, the World Bank's Global Economic Prospects (June 2026), using ONLY the numbered sources. No outside knowledge.",
  `If the sources do not contain the answer, set refused=true and make the answer exactly: "${REFUSAL_TEXT}". That includes questions about other editions, other institutions' forecasts, years the report does not forecast, or advice.`,
  "Each source is labelled with where it lives (chapter › section, region, page). Use a source only for the region, chapter, country or box it belongs to: never attach a figure from one region's section to another region. If the question names the executive summary, a chapter or a box, answer from that part.",
  "Quote numbers, years and names exactly as written. Distinguish forecasts (f), estimates (e) and revisions (differences from January 2026 projections, in percentage points); do not read a revision as a growth rate. Fiscal-year figures keep their fiscal year (e.g. FY2026/27).",
  "Never compute. Differences, averages, sums and implied earlier projections may only come from a source labelled COMPUTED, which you may cite.",
  "Write a direct answer in 1–5 sentences. When the question asks what a part of the report says, cover its main findings WITH their headline figures (percentages, basis points, years). Put a marker like [^1] after each claim; each marker maps to one citation whose quote is copied VERBATIM from that source, one sentence or clause of 5–30 words, never a whole paragraph (for tables, copy the row text, e.g. 'South Asia | 6.6 | 6.8 | 7.0 | 6.3').",
  opts.repair ? "IMPORTANT: your previous answer's quotes could not be found verbatim in the sources. Copy each quote character for character from ONE sentence of its source; keep quotes short." : "",
  opts.nudge ? "IMPORTANT: the retrieval system rated these sources highly relevant to this exact question. Re-read every source; refuse only if the answer truly is not there." : "",
].filter(Boolean).join("\n");

export async function generateAnswer(question: string, sources: Source[], scope: Scope | null, opts: { nudge?: boolean; repair?: boolean; history?: { role: "user" | "assistant"; content: string }[] } = {}): Promise<GeneratedAnswer> {
  const convo = (opts.history ?? []).slice(-6).map((m) => `${m.role === "user" ? "Reader" : "Assistant"}: ${m.content}`).join("\n");
  const out = await geminiObject("answer", Answer, [{ type: "text", text: `${convo ? `Conversation so far:\n${convo}\n\n` : ""}Sources:\n\n${renderSources(sources)}\n\nQuestion: ${question}` }], SYSTEM(opts));
  return verifyAnswer(out, sources, scope);
}

/**
 * A long quote with one wrong character should not sink a true citation: try its clauses (split at . ; : ,)
 * longest first, and accept one of at least 6 words that occurs verbatim. Only that verbatim span is shown.
 */
export function longestVerbatimClause(text: string, quote: string): [number, number] | null {
  const clauses = quote.split(/(?<=[.;:,])\s+/).map((c) => c.replace(/[.;:,]$/, "").trim()).filter((c) => c.split(/\s+/).length >= 6);
  for (const c of clauses.sort((a, b) => b.length - a.length)) {
    const hit = locateSpan(text, c);
    if (hit) return hit;
  }
  return null;
}

/**
 * The verifier, pure and testable.
 *  1. each quote must occur verbatim (whitespace/case/quote-style-insensitive) in the source it names;
 *  2. scope guard: when the question is routed to regions or a chapter, a citation into a passage from a
 *     different region or chapter is stripped (the computed source is exempt);
 *  3. a sentence whose every citation failed is removed; an answer left with no verified support becomes a refusal.
 */
export function verifyAnswer(out: RawAnswer, sources: Pick<Source, "n" | "id" | "label" | "printed" | "region" | "chapter" | "kind" | "text">[], scope: Scope | null): GeneratedAnswer {
  const citations: VerifiedCitation[] = out.citations.map((c) => {
    const src = sources[c.source - 1];
    if (!src) return { n: c.n, source: c.source, sourceId: "", label: "", printed: "", region: null, chapter: null, span: c.quote, verified: false, reason: "no_source" as const };
    const base = { n: c.n, source: c.source, sourceId: src.id, label: src.label, printed: src.printed, region: src.region, chapter: src.chapter };
    const hit = locateSpan(src.text, c.quote) ?? longestVerbatimClause(src.text, c.quote);
    if (!hit) return { ...base, span: c.quote, verified: false, reason: "not_verbatim" as const };
    const span = src.text.slice(hit[0], hit[1]);
    if (scope && src.kind !== "computed") {
      const wrongRegion = scope.regions.length > 0 && src.region !== null && !scope.regions.includes(src.region);
      const wrongChapter = scope.chapters.length > 0 && src.chapter !== null && !scope.chapters.includes(src.chapter);
      if (wrongRegion || wrongChapter) return { ...base, span, verified: false, reason: "out_of_scope" as const };
    }
    return { ...base, span, verified: true };
  });
  const verifiedNs = new Set(citations.filter((c) => c.verified).map((c) => c.n));
  const rejected = { notVerbatim: citations.filter((c) => c.reason === "not_verbatim" || c.reason === "no_source").length, outOfScope: citations.filter((c) => c.reason === "out_of_scope").length };

  let answer = out.answer.trim();
  if (!out.refused) {
    // a sentence ends at . ! or ? — with or without citation markers after it ("…percent.[^1] It …")
    const sentences = answer.split(/(?<=[.!?](?:\[\^\d+\])*)\s+(?=[A-Z€$0-9"'(])/);
    const kept = sentences.filter((s) => {
      const ns = [...s.matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1]));
      return ns.length === 0 || ns.some((n) => verifiedNs.has(n));
    });
    answer = kept.map((s) => s.replace(/\[\^(\d+)\]/g, (m, n) => (verifiedNs.has(Number(n)) ? m : ""))).join(" ").replace(/\s+([.,;])/g, "$1").replace(/\s{2,}/g, " ").trim();
  }
  const refused = out.refused || answer.length === 0 || (citations.length > 0 && verifiedNs.size === 0) || (citations.length === 0 && !out.refused && /\d/.test(answer));
  if (refused) answer = REFUSAL_TEXT;
  return { answer, citations: refused ? [] : citations.filter((c) => c.verified), rejected, refused, raw: out.answer };
}
