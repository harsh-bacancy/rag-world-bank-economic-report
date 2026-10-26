/** Where a passage lives. Every chunk carries these fields; retrieval filters on them. */
export type ChapterKey = "FM" | "ES" | "1" | "2" | "3" | "4" | "SA" | "BM";

export type Kind =
  | "front_matter" | "foreword" | "executive_summary" | "chapter_summary" | "body" | "box"
  | "figure" | "table" | "annex" | "references" | "statistical_appendix" | "back_matter";

export const REGIONS = ["EAP", "ECA", "LAC", "MNA", "SAR", "SSA"] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_NAMES: Record<Region, string> = {
  EAP: "East Asia and Pacific",
  ECA: "Europe and Central Asia",
  LAC: "Latin America and the Caribbean",
  MNA: "Middle East, North Africa, Afghanistan, and Pakistan",
  SAR: "South Asia",
  SSA: "Sub-Saharan Africa",
};

export const CHAPTER_TITLES: Record<ChapterKey, string> = {
  FM: "Front matter",
  ES: "Executive Summary",
  "1": "Chapter 1: Global Outlook",
  "2": "Chapter 2: Regional Outlooks",
  "3": "Chapter 3: A Rising Challenge: Sovereign Debt Levels and Interest Rates in EMDEs",
  "4": "Chapter 4: Navigating Volatility: Fiscal Policy and Commodity Price Swings",
  SA: "Statistical Appendix",
  BM: "Back matter",
};

/** Kinds that are searchable by default. Contents pages, references and back matter only add noise. */
export const SEARCHABLE_KINDS: Kind[] = ["foreword", "executive_summary", "chapter_summary", "body", "box", "figure", "table", "annex", "statistical_appendix"];

export interface Section {
  id: string;
  parentId: string | null;
  level: number;          // 0 = chapter root
  title: string;
  path: string[];         // chapter title first
  chapter: ChapterKey;
  region: Region | null;
  boxId: string | null;   // "1.1"
  kind: Kind;
  pdfStart: number;
  pdfEnd: number;
}

export interface TableColumn { label: string; isRevision: boolean }
export interface TableRow { label: string; group: string | null; region: Region | null; values: (string | null)[]; labels?: string[] /* column labels when a fiscal-year group relabels them */ }
export interface TableData {
  id: string;             // "2.9", "B2.1.1", "SA-187"
  caption: string;
  subtitle: string | null;
  columns: TableColumn[];
  rows: TableRow[];
  notes: string[];
}

export type BlockType = "paragraph" | "footnote" | "figure" | "table";

export interface Block {
  id: string;
  sectionId: string;
  type: BlockType;
  text: string;           // verbatim (repaired) text; for tables a Markdown rendering
  pdfStart: number;
  pdfEnd: number;
  pageBreaks?: { offset: number; page: number }[]; // char offsets in `text` where a later PDF page begins
  caption?: string;       // figures and tables
  table?: TableData;
}

export interface DocModel {
  hash: string;
  pageCount: number;
  printed: string[];      // printed page label per PDF page (index 0 = PDF page 1); "" when none
  sections: Section[];
  blocks: Block[];
  warnings: string[];
}

export const printedLabel = (doc: Pick<DocModel, "printed">, pdfPage: number) => doc.printed[pdfPage - 1] || `PDF ${pdfPage}`;
