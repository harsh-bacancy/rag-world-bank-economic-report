import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Region, Section } from "@/lib/pdf/types";
import type { RetrievedItem } from "@/lib/retrieval/retrieve";

export interface GoldenLocation { chapter: string | number; region?: Region; box?: string; pdf_pages: [number, number]; printed?: string }
export interface GoldenQuestion {
  id: string;
  category: "lookup" | "reasoning" | "cross_section" | "arithmetic" | "refusal";
  sample?: boolean;
  question: string;
  expected_answer: string;
  numbers: string[];
  locations: GoldenLocation[];
  require: "any" | "all";
  expect_refusal?: boolean;
  must_not?: string[];
  notes?: string;
}
export interface GoldenSet { document: string; version: number; questions: GoldenQuestion[] }

export const GOLDEN_PATH = path.join(process.cwd(), "data", "golden", "gep-golden.json");
export async function readGolden(file = GOLDEN_PATH): Promise<GoldenSet> {
  return JSON.parse(await readFile(file, "utf8")) as GoldenSet;
}

const overlaps = (a: [number, number], b: [number, number]) => a[0] <= b[1] && b[0] <= a[1];

/**
 * Is a retrieved item in the expected place? Structured items must match chapter (and region / box when the
 * location names one) AND overlap the expected pages. Naive chunks have no metadata, so for them page overlap
 * alone decides — a generous rule that favours the baseline, not the full pipeline.
 */
export function matches(item: Pick<RetrievedItem, "chapter" | "region" | "boxId" | "pdfStart" | "pdfEnd"> & { kind: string }, loc: GoldenLocation): boolean {
  if (!overlaps([item.pdfStart, item.pdfEnd], loc.pdf_pages)) return false;
  if (item.kind === "naive") return true;
  if (String(item.chapter) !== String(loc.chapter)) return false;
  if (loc.region && item.region !== loc.region) return false;
  if (loc.box && item.boxId !== loc.box) return false;
  return true;
}

export const relevant = (item: Parameters<typeof matches>[0], q: GoldenQuestion) => q.locations.some((l) => matches(item, l));

/** Region of a naive chunk, recovered from its pages (Chapter 2's regional sections occupy distinct pages). */
export function regionByPage(sections: Section[]): (page: number) => Region | null {
  const regional = sections.filter((s) => s.region && s.level === 1);
  return (page) => regional.find((s) => page >= s.pdfStart && page <= s.pdfEnd)?.region ?? null;
}

export interface RetrievalScore { firstRelevant: number | null; hit1: boolean; hit3: boolean; hit5: boolean; rr: number; covered: number; mixup: number | null }

/** hit@k / reciprocal rank on the ranked list; `require: all` needs every location in the top 5; mix-up = share of the top 5 from a region the question is not about. */
export function scoreRetrieval(items: RetrievedItem[], q: GoldenQuestion, regionOfPage: (p: number) => Region | null): RetrievalScore {
  const ranks = items.map((it) => relevant(it, q));
  const first = ranks.indexOf(true);
  const top5 = items.slice(0, 5);
  const covered = q.locations.filter((l) => top5.some((it) => matches(it, l))).length;
  const allCovered = q.require === "all" ? covered === q.locations.length : covered > 0;
  const expectedRegions = new Set(q.locations.map((l) => l.region).filter(Boolean));
  let mixup: number | null = null;
  if (expectedRegions.size) {
    const regs = top5.map((it) => (it.kind === "naive" ? regionByPageOr(it, regionOfPage) : it.region));
    mixup = regs.filter((r) => r && !expectedRegions.has(r)).length / Math.max(1, top5.length);
  }
  return {
    firstRelevant: first >= 0 ? first + 1 : null,
    hit1: ranks[0] === true && (q.require === "any" || q.locations.length === 1),
    hit3: q.require === "all" ? q.locations.every((l) => items.slice(0, 3).some((it) => matches(it, l))) : ranks.slice(0, 3).some(Boolean),
    hit5: allCovered,
    rr: first >= 0 ? 1 / (first + 1) : 0,
    covered,
    mixup,
  };
}

function regionByPageOr(it: RetrievedItem, f: (p: number) => Region | null): Region | null {
  return f(it.pdfStart) ?? f(it.pdfEnd);
}
