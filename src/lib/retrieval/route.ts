import { z } from "zod";
import { geminiObject } from "@/lib/gemini/client";
import { REGION_NAMES, REGIONS, type ChapterKey, type Region } from "@/lib/pdf/types";

/**
 * Query understanding: turn the question into search instructions. The field guide's lessons are encoded here:
 *  - a region can be named, abbreviated, or implied by a country ("India" → SAR, "Pakistan" → MNA in this report);
 *  - a chapter filter is set ONLY when the question literally names it; a wrong filter hides the answer;
 *  - names come from closed lists; anything else is dropped.
 */
export interface Route {
  regions: Region[];
  regionSource: "name" | "acronym" | "country" | "llm" | "user" | null;
  countries: string[];
  chapter: ChapterKey | null;      // the single named chapter (filter)
  chapters: ChapterKey[];          // every chapter named; two or more are searched one by one
  boxId: string | null;
  structuralRefusal: string | null;
  /** a comparison whose other side is not named ("which region is worst affected, compared with South Asia?") */
  openComparison: boolean;
  searchQuery: string;
  how: "rules" | "llm" | "none";
  intent: { arithmetic: boolean; compare: boolean; quarter: boolean };
}

const NAME_PATTERNS: [RegExp, Region][] = [
  [/\beast asia(?: and| &)? (?:the )?pacific\b|\beast asia\b|\basia[- ]pacific\b/i, "EAP"],
  [/\beurope(?: and| &) central asia\b|\bcentral asia\b|\bemerging europe\b/i, "ECA"],
  [/\blatin america\b|\bthe caribbean\b/i, "LAC"],
  [/\bmiddle east(?:,)? (?:and )?north africa\b|\bmiddle east, north africa, afghanistan, and pakistan\b|\bmena(?:ap)?\b/i, "MNA"],
  [/\bsouth asia(?:n)?\b/i, "SAR"],
  [/\bsub[- ]?saharan africa\b|\bsub[- ]?saharan\b/i, "SSA"],
];
const ACRONYMS: Record<string, Region> = { EAP: "EAP", ECA: "ECA", LAC: "LAC", MNA: "MNA", MENA: "MNA", MENAAP: "MNA", SAR: "SAR", SSA: "SSA" };

const EXPAND: [RegExp, string][] = [
  [/\bEMDEs?\b/, "emerging market and developing economies"],
  [/\bLICs?\b/, "low-income countries"],
  [/\bAI\b/, "artificial intelligence"],
  [/\bFY\s?(\d{4}\/\d{2})/i, "fiscal year $1"],
  [/\bGDP\b/, "real GDP growth"],
  [/\bSWFs?\b/, "sovereign wealth funds"],
  [/\bAEs?\b/, "advanced economies"],
];

export function routeRules(question: string, ctx: { countries: Record<string, Region>; boxes: string[] }): Route {
  const q = question;
  const lower = q.toLowerCase();
  const regions = new Set<Region>();
  let regionSource: Route["regionSource"] = null;

  for (const [re, r] of NAME_PATTERNS) if (re.test(q)) { regions.add(r); regionSource ??= "name"; }
  for (const m of q.matchAll(/\b(EAP|ECA|LAC|MNA|MENA|MENAAP|SAR|SSA)\b/g)) { regions.add(ACRONYMS[m[1]]); regionSource ??= "acronym"; }
  // "Africa" alone means Sub-Saharan Africa unless it is North Africa
  if (!regions.size && /\bafrica\b/i.test(q) && !/north africa/i.test(q)) { regions.add("SSA"); regionSource = "name"; }

  const countries: string[] = [];
  const names = Object.keys(ctx.countries).sort((a, b) => b.length - a.length);
  let rest = lower;
  for (const n of names) {
    const re = new RegExp(`(^|[^a-zà-ÿ])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-zà-ÿ])`, "i");
    if (re.test(rest)) {
      countries.push(n);
      rest = rest.replace(re, "$1 ");
      if (!regions.has(ctx.countries[n])) { regions.add(ctx.countries[n]); regionSource ??= "country"; }
    }
  }

  const chapters: ChapterKey[] = [];
  let structuralRefusal: string | null = null;
  if (/\bexecutive summary\b/i.test(q)) chapters.push("ES");
  for (const m of q.matchAll(/\b(?:chapters?|ch\.)\s*(\d+)(?:\s*(?:and|&|,)\s*(\d+))?\b/gi)) {
    for (const d of [m[1], m[2]].filter(Boolean)) {
      const n = Number(d);
      if (n >= 1 && n <= 4) { if (!chapters.includes(String(n) as ChapterKey)) chapters.push(String(n) as ChapterKey); }
      else structuralRefusal = `This report has four chapters; there is no Chapter ${n}.`;
    }
  }
  if (/\bstatistical (appendix|annex)\b/i.test(q)) chapters.push("SA");
  let chapter: ChapterKey | null = chapters.length === 1 ? chapters[0] : null;

  let boxId: string | null = null;
  const bx = /\bbox\s+(\d+\.\d+)\b/i.exec(q);
  if (bx) {
    if (ctx.boxes.includes(bx[1])) boxId = bx[1];
    else structuralRefusal = `This edition has no Box ${bx[1]} (its boxes are ${ctx.boxes.join(", ")}).`;
  }

  const years = [...q.matchAll(/\b(20\d{2})(?!\/)/g)].map((m) => Number(m[1]));
  if (years.some((y) => y > 2028) && /forecast|projection|projected|outlook|growth|expected/i.test(q)) structuralRefusal ??= "The report's forecasts run to 2028.";

  const quarter = /\bquarter\b|\bQ[1-4]\b|\b\d{2}Q\d\b/i.test(q);
  if (quarter && !chapters.length) { chapter = "SA"; chapters.push("SA"); } // quarterly estimates exist only in the Statistical Appendix
  const arithmetic = /how much (higher|lower|faster|slower|more|less|larger|smaller)|by how (many|much)|\bdifference\b|\bgap\b|\baverage\b|\bsum\b|\btotal\b|had .* projected|in january 2026\b/i.test(q);
  const comparative = /\bcompare|\bcompared\b|\bversus\b|\bvs\.?\b|\bdiffer|\bagree\b|\bworst\b|\bbest\b|\bfastest\b|\bslowest\b|\bstrongest\b|\bweakest\b|\bas a whole\b/i.test(q);
  const compare = regions.size > 1 || chapters.length > 1 || comparative;
  // one side named, the other left open: search the whole report too, and let the scope guard stand down
  const openComparison = comparative && regions.size + chapters.length + (boxId ? 1 : 0) === 1;

  let searchQuery = q;
  for (const [re, add] of EXPAND) {
    const m = re.exec(q);
    if (m) searchQuery += ` ${add.replace("$1", m[1] ?? "")}`;
  }
  for (const r of regions) searchQuery += ` ${REGION_NAMES[r]} ${r}`;
  if (/outlook|forecast|projected|projection|growth/i.test(q) && !years.length) searchQuery += " projected growth 2026";

  return { regions: [...regions], regionSource, countries, chapter, chapters, boxId, structuralRefusal, openComparison, searchQuery: searchQuery.replace(/\s+/g, " ").trim(), how: "rules", intent: { arithmetic, compare, quarter } };
}

const Understood = z.object({
  regions: z.array(z.enum(REGIONS)).describe("regions the question is about, by name, acronym or a country in them; empty for global or multi-region questions"),
  chapter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.null()]).describe("ONLY when the question literally says 'Chapter N'"),
  executive_summary: z.boolean(),
  box: z.string().nullable().describe("box number like '1.1' only when the question names a box"),
  search_query: z.string().describe("the question rewritten for search: acronyms spelled out, the report's vocabulary (EMDEs, outlook, projected growth), every number and year kept"),
});

/** The LLM variant: one structured call. Its output is merged onto the rules (which still provide refusals and intents). */
export async function routeLLM(question: string, ctx: { countries: Record<string, Region>; boxes: string[] }): Promise<Route> {
  const base = routeRules(question, ctx);
  try {
    const out = await geminiObject("route", Understood, [{ type: "text", text: question }], [
      "You turn a question about the World Bank's Global Economic Prospects report (June 2026) into search instructions.",
      `Regions (Chapter 2 has one section per region): ${REGIONS.map((r) => `${r} = ${REGION_NAMES[r]}`).join("; ")}.`,
      "Chapters: 1 Global Outlook, 2 Regional Outlooks, 3 Sovereign Debt Levels and Interest Rates in EMDEs, 4 Fiscal Policy and Commodity Price Swings; plus the Executive Summary and boxes 1.1, 1.2, 2.1, 3.1.",
      "Set regions when the question names a region OR a country in it (India → SAR; Brazil → LAC; Pakistan and Afghanistan → MNA in this report).",
      "Set chapter only when the question literally says 'Chapter N'. Never infer it from the topic: a wrong filter hides the answer.",
    ].join("\n"));
    const regions = out.regions.filter((r) => REGIONS.includes(r));
    const chapter = base.chapters.length > 1 ? null : out.executive_summary ? "ES" : out.chapter ? (String(out.chapter) as ChapterKey) : base.chapter;
    const boxId = out.box && ctx.boxes.includes(out.box) ? out.box : base.boxId;
    return { ...base, regions, regionSource: regions.length ? "llm" : null, chapter, chapters: chapter ? [chapter] : base.chapters, boxId, searchQuery: `${out.search_query} ${regions.map((r) => `${REGION_NAMES[r]} ${r}`).join(" ")}`.trim(), how: "llm" };
  } catch {
    return base;
  }
}

export const noRoute = (question: string): Route => ({ regions: [], regionSource: null, countries: [], chapter: null, chapters: [], boxId: null, structuralRefusal: null, openComparison: false, searchQuery: question, how: "none", intent: { arithmetic: false, compare: false, quarter: false } });
