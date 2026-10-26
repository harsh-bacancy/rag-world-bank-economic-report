import { z } from "zod";
import { geminiObject, hasGeminiKey } from "@/lib/gemini/client";
import { REGION_NAMES } from "@/lib/pdf/types";
import type { TableCell } from "@/lib/pipeline/index-file";
import { getStore, type Store } from "@/lib/store";
import { locateSpan } from "@/lib/text";
import type { Source } from "./context";
import type { Route } from "./route";

/**
 * "Computed, not recalled." The model may read numbers but never does arithmetic. Two deterministic helpers:
 *  1. table facts: for every entity the question names (region, country, World, oil …), the rebuilt table rows
 *     with changes, averages and implied January projections computed in TypeScript;
 *  2. operand arithmetic: for an arithmetic question, the model only EXTRACTS operands with verbatim quotes;
 *     each quote is verified, and TypeScript computes the result.
 * Both land in one extra source the answer may cite; citations into it are verified like any other.
 */

const TABLE11_ENTITIES: [RegExp, string][] = [
  [/\bworld\b|\bglobal\b/i, "World"],
  [/\badvanced economies\b/i, "Advanced economies"],
  [/\bunited states\b|\bu\.s\.\b|\bus economy\b/i, "United States"],
  [/\beuro area\b|\beurozone\b/i, "Euro area"],
  [/\bjapan\b/i, "Japan"],
  [/\bemdes?\b|\bemerging market and developing economies\b|\bdeveloping economies\b/i, "Emerging market and developing economies"],
  [/\blow-income countries\b|\blics?\b/i, "Low-income countries"],
  [/\bworld trade\b|\btrade volume\b/i, "World trade volume"],
  [/\boil\b|\bbrent\b/i, "Oil (US$ per barrel)"],
  [/\bcommodity price/i, "WBG commodity price index"],
  [/\benergy (price|index)/i, "Energy index"],
];

const fmt = (x: number) => (Math.round(x * 100) / 100).toFixed(Math.abs(x) >= 20 ? 1 : 1).replace(/^-0\.0$/, "0.0");
const isLevelRow = (label: string) => /index|US\$|per barrel/i.test(label);

function rowFacts(entity: string, cells: TableCell[]): string | null {
  if (!cells.length) return null;
  const c0 = cells[0];
  const levels = cells.filter((c) => !c.isRevision && c.value !== null);
  const revs = cells.filter((c) => c.isRevision && c.value !== null);
  if (!levels.length) return null;
  const unit = isLevelRow(c0.rowLabel) ? "" : " percent";
  const diffUnit = isLevelRow(c0.rowLabel) ? "" : " percentage points";
  const parts = [`${entity} — ${c0.rowLabel} (${c0.caption.replace(/^Table /, "Table ")}, p. ${c0.printedPage}): ${levels.map((c) => `${c.column} ${c.raw}`).join("; ")}.`];
  const est = [...levels].reverse().find((c) => /e$/.test(c.column));
  const forecasts = levels.filter((c) => /f$/.test(c.column));
  if (est && forecasts[0]) parts.push(`Change ${est.column} → ${forecasts[0].column}: ${fmt(forecasts[0].value! - est.value!)}${diffUnit}.`);
  if (forecasts.length >= 3) {
    const [a, b] = forecasts.slice(1, 3);
    parts.push(`Average of ${a.column} and ${b.column}: ${fmt((a.value! + b.value!) / 2)}${unit}.`);
  }
  for (const r of revs) {
    const lvl = levels.find((c) => c.column === r.column);
    if (lvl) parts.push(`Implied January 2026 projection for ${r.column}: ${fmt(lvl.value! - r.value!)}${unit} (${lvl.raw} minus a revision of ${r.raw}).`);
  }
  return parts.join(" ");
}

export async function tableFacts(question: string, route: Route, store: Store = getStore()): Promise<{ lines: string[]; cells: TableCell[] }> {
  const all = await store.cells({});
  const lines: string[] = [];
  const used: TableCell[] = [];
  const firstForecast = new Map<string, { label: string; value: number; column: string }>();
  const take = (entity: string, cells: TableCell[]) => {
    const f = rowFacts(entity, cells);
    if (!f || lines.length >= 6) return;
    lines.push(f);
    used.push(...cells);
    const ff = cells.find((c) => !c.isRevision && /f$/.test(c.column) && c.value !== null);
    if (ff) firstForecast.set(entity, { label: entity, value: ff.value!, column: ff.column });
  };
  const rowsOf = (tableId: string, label: string) => all.filter((c) => c.tableId === tableId && c.rowLabel === label);

  for (const r of route.regions) take(REGION_NAMES[r], rowsOf("1.1", REGION_NAMES[r]));
  for (const country of route.countries) {
    const norm = (s: string) => s.toLowerCase().replace(/\s+\d+(\s+\d+)*$/, "");
    const hit = all.filter((c) => /economy forecasts/i.test(c.caption) && (norm(c.rowLabel) === country || norm(c.rowLabel).replace(/,.*$/, "") === country));
    const label = hit[0]?.rowLabel;
    if (label) take(label, hit.filter((c) => c.rowLabel === label && c.tableId === hit[0].tableId));
  }
  for (const [re, label] of TABLE11_ENTITIES) if (re.test(question)) take(label, rowsOf("1.1", label));

  // pairwise differences in the first forecast year, when two entities share the same year basis
  const ents = [...firstForecast.values()];
  for (let i = 0; i < ents.length; i++) for (let j = i + 1; j < ents.length; j++) {
    const a = ents[i], b = ents[j];
    if (a.column === b.column) lines.push(`Difference in ${a.column}: ${a.label} ${fmt(a.value)} minus ${b.label} ${fmt(b.value)} = ${fmt(a.value - b.value)} percentage points.`);
    else lines.push(`${a.label} (${a.column}) and ${b.label} (${b.column}) are reported on different year bases; compare with care.`);
  }
  return { lines, cells: used };
}

const Operands = z.object({
  operation: z.enum(["difference", "sum", "average", "ratio", "percent_change", "none"]).describe("the computation the question asks for; 'difference' = first operand minus second"),
  operands: z.array(z.object({
    label: z.string(),
    value: z.number(),
    unit: z.string().describe("percent, percentage points, basis points, US$ per barrel, percent of GDP, …"),
    source: z.number().int().describe("1-based source number the value comes from"),
    quote: z.string().describe("verbatim span from that source containing the number, 5–25 words"),
  })).max(4),
});

/** The model extracts operands with quotes; code verifies the quotes and does the arithmetic. One call, arithmetic questions only. */
export async function operandArithmetic(question: string, sources: Source[]): Promise<string | null> {
  if (!hasGeminiKey() || !sources.length) return null;
  try {
    const out = await geminiObject("operands", Operands, [{ type: "text", text: `${sources.map((s) => `[Source ${s.n}] ${s.label}\n${s.text}`).join("\n\n")}\n\nQuestion: ${question}` }],
      "Do NOT compute anything. Identify which figures in the sources the question's computation needs and copy each with a verbatim quote that contains the number. If the sources lack a needed figure, use operation 'none'.");
    if (out.operation === "none" || out.operands.length < (out.operation === "sum" || out.operation === "average" ? 2 : 2)) return null;
    const ok = out.operands.filter((o) => {
      const src = sources[o.source - 1];
      return src && locateSpan(src.text, o.quote) && o.quote.replace(/,/g, "").includes(String(Math.abs(o.value)).replace(/\.0$/, ""));
    });
    if (ok.length !== out.operands.length) return null; // an operand we cannot verify means no computed result
    const v = ok.map((o) => o.value);
    let result: number;
    let expr: string;
    switch (out.operation) {
      case "difference": result = v[0] - v[1]; expr = `${v[0]} − ${v[1]}`; break;
      case "sum": result = v.reduce((a, b) => a + b, 0); expr = v.join(" + "); break;
      case "average": result = v.reduce((a, b) => a + b, 0) / v.length; expr = `(${v.join(" + ")}) / ${v.length}`; break;
      case "ratio": result = v[0] / v[1]; expr = `${v[0]} / ${v[1]}`; break;
      case "percent_change": result = ((v[1] - v[0]) / v[0]) * 100; expr = `(${v[1]} − ${v[0]}) / ${v[0]} × 100`; break;
    }
    const unit = out.operation === "difference" && /percent$/i.test(ok[0].unit) ? "percentage points" : out.operation === "percent_change" || out.operation === "ratio" ? (out.operation === "ratio" ? "times" : "percent") : ok[0].unit;
    const from = ok.map((o) => `${o.label} = ${o.value} ${o.unit} (Source ${o.source}: "${o.quote}")`).join("; ");
    return `Computed ${out.operation}: ${expr} = ${fmt(result)} ${unit}. Operands: ${from}.`;
  } catch {
    return null;
  }
}

export async function computedSource(question: string, route: Route, sources: Source[], store: Store = getStore()): Promise<{ source: Source | null; calls: number }> {
  const facts = await tableFacts(question, route, store);
  let calls = 0;
  let arithmetic: string | null = null;
  if (route.intent.arithmetic) { arithmetic = await operandArithmetic(question, sources); calls = hasGeminiKey() ? 1 : 0; }
  const lines = [...(arithmetic ? [arithmetic] : []), ...facts.lines];
  if (!lines.length) return { source: null, calls };
  return {
    source: { n: sources.length + 1, id: "__computed__", chunkIds: [...new Set(facts.cells.map((c) => c.chunkId).filter((x): x is string => !!x))], kind: "computed", label: "Computed by code", headingPath: null, chapter: null, region: null, boxId: null, sectionId: null, printed: [...new Set(facts.cells.map((c) => c.printedPage))].join(", "), pdfStart: 0, pdfEnd: 0, text: lines.join("\n") },
    calls,
  };
}
