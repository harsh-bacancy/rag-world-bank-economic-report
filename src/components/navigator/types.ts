import type { ChapterKey, Kind, Region } from "@/lib/pdf/types";

/** What the server hands the Navigator about the outline (no passage text). */
export interface OutlineNode {
  id: string;
  parentId: string | null;
  level: number;
  title: string;
  chapter: ChapterKey;
  region: Region | null;
  boxId: string | null;
  kind: Kind;
  printedStart: string;
  printedEnd: string;
}

export interface ScopePreview { regions: Region[]; chapter: ChapterKey | null; boxId: string | null; structuralRefusal: string | null; countries: string[]; regionSource?: string | null }

/** A passage open in the record panel. */
export interface RecordPassage {
  id: string;
  headingPath: string;
  text: string;
  pdfStart: number;
  pdfEnd: number;
  pageBreaks: { offset: number; page: number }[];
  pinpoint?: string;      // verbatim span to highlight
  pinNumber?: number;
  kind?: string;
}

export const REGION_LABEL: Record<Region, string> = {
  EAP: "East Asia and Pacific",
  ECA: "Europe and Central Asia",
  LAC: "Latin America and the Caribbean",
  MNA: "Middle East, North Africa, Afghanistan, and Pakistan",
  SAR: "South Asia",
  SSA: "Sub-Saharan Africa",
};

export const CHAPTER_SHORT: Record<ChapterKey, string> = {
  FM: "Front matter", ES: "Executive Summary", "1": "Chapter 1", "2": "Chapter 2", "3": "Chapter 3", "4": "Chapter 4", SA: "Statistical Appendix", BM: "Back matter",
};

export const SAMPLE_QUESTIONS = [
  "What is the growth outlook for South Asia in this report?",
  "What does Chapter 3 say about sovereign debt in developing economies?",
  "According to the executive summary, what are the main risks to the global outlook?",
];

export const MORE_QUESTIONS = [
  "What growth is projected in 2026 for the region that includes Pakistan?",
  "How much faster is the United States projected to grow than the euro area in 2026?",
  "What does Box 3.1 find about hidden debt?",
  "What does Chapter 5 say about climate finance?",
];

/** "Chapter 2: Regional Outlooks › South Asia (SAR) › Outlook" → "Ch. 2 › South Asia (SAR) › Outlook" */
export function shortPath(headingPath: string | null | undefined): string {
  if (!headingPath) return "";
  return headingPath.replace(/^Chapter (\d): [^›]+/, "Ch. $1 ").replace(/\s+›/g, " ›").trim();
}
