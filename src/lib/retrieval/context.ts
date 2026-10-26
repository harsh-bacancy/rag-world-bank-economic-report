import { CHAPTER_TITLES, REGION_NAMES, type ChapterKey, type Region } from "@/lib/pdf/types";
import { approxTokens } from "@/lib/pipeline/chunk";
import type { RetrievedItem } from "./retrieve";

/** A numbered passage the model may cite. The computed source is one of these too. */
export interface Source {
  n: number;
  id: string;
  chunkIds: string[];
  kind: RetrievedItem["kind"] | "computed";
  label: string;              // "Chapter 2: Regional Outlooks › South Asia (SAR) › Outlook · pp. 74–75"
  headingPath: string | null;
  chapter: ChapterKey | null;
  region: Region | null;
  boxId: string | null;
  sectionId: string | null;
  printed: string;
  pdfStart: number;
  pdfEnd: number;
  pageBreaks?: { offset: number; page: number }[];
  text: string;
}

export const CONTEXT_BUDGET = 5200; // tokens of passages handed to the model

/**
 * Context management: dedupe, keep rank order, stop at a token budget, and label every passage with where it
 * lives (chapter › section, region, pages) so the model can see the boundaries it must not cross.
 */
export function buildSources(items: RetrievedItem[], budget = CONTEXT_BUDGET): Source[] {
  const out: Source[] = [];
  let used = 0;
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.id)) continue;
    const t = approxTokens(it.text);
    if (out.length && used + t > budget) break;
    seen.add(it.id);
    used += t;
    const where = it.headingPath ?? `PDF page ${it.pdfStart}${it.pdfEnd !== it.pdfStart ? `–${it.pdfEnd}` : ""}`;
    out.push({
      n: out.length + 1, id: it.id, chunkIds: it.chunkIds, kind: it.kind, label: `${where} · p. ${it.printed}`, headingPath: it.headingPath,
      chapter: it.chapter, region: it.region, boxId: it.boxId, sectionId: it.sectionId, printed: it.printed, pdfStart: it.pdfStart, pdfEnd: it.pdfEnd, pageBreaks: it.pageBreaks, text: it.text,
    });
  }
  return out;
}

export function sourceHeader(s: Source): string {
  if (s.kind === "computed") return `[Source ${s.n}] COMPUTED by code from the report's tables and quoted figures (you may cite it)`;
  const tags = [s.chapter ? CHAPTER_TITLES[s.chapter] : null, s.region ? `region: ${REGION_NAMES[s.region]} (${s.region})` : null, s.boxId ? `Box ${s.boxId}` : null, `printed page ${s.printed}`].filter(Boolean);
  return `[Source ${s.n}] ${s.headingPath ?? "Report text"}\n(${tags.join(" · ")})`;
}

export function renderSources(sources: Source[]): string {
  return sources.map((s) => `${sourceHeader(s)}\n${s.text}`).join("\n\n---\n\n");
}
