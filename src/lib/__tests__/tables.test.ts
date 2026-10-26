import { describe, expect, it } from "vitest";
import type { Run } from "@/lib/pdf/extract";
import { linearizeTable, rebuildTable, tableToMarkdown } from "@/lib/pdf/tables";

const run = (text: string, x: number, y: number, size = 7.6, w = text.length * 3.5): Run => ({ page: 98, x, y, w, size, font: "HelveticaLTStd-Roman", text, eol: false });
const cols = [200, 240, 280, 320, 360, 400, 470, 520];

/** A miniature of Table 2.10: a calendar-year group, then a fiscal-year group that relabels the columns. */
function table210(): Run[] {
  const runs: Run[] = [run("Percentage-point differences", 455, 405)];
  ["2023", "2024", "2025e", "2026f", "2027f", "2028f", "2026f", "2027f"].forEach((t, i) => runs.push(run(t, cols[i], 380, 7.6, 14)));
  runs.push(run("Calendar-year basis", 40, 368));
  runs.push(run("Maldives", 50, 357));
  ["4.9", "3.5", "5.7", "0.7", "7.2", "4.0", "-3.2", "3.2"].forEach((t, i) => runs.push(run(t, cols[i] + 2, 357, 7.6, 10)));
  runs.push(run("Fiscal-year basis", 40, 345));
  runs.push(run("1", 98, 347, 4.6, 2));
  ["2023/24", "2024/25", "2025/26e", "2026/27f", "2027/28f", "2028/29f", "2026/27f", "2027/28f"].forEach((t, i) => runs.push(run(t, cols[i] - 3, 345, 7.6, 22)));
  runs.push(run("India", 50, 334));
  ["7.2", "7.1", "7.7", "6.6", "7.2", "7.0", "0.1", "0.6"].forEach((t, i) => runs.push(run(t, cols[i] + 2, 334, 7.6, 10)));
  runs.push(run("Source: World Bank.", 40, 300, 6));
  return runs;
}

describe("table rebuild", () => {
  const t = rebuildTable("2.10", "Table 2.10 South Asia economy forecasts", table210(), { region: "SAR" });

  it("assigns each value to its column and marks revision columns", () => {
    expect(t.columns.map((c) => c.isRevision)).toEqual([false, false, false, false, false, false, true, true]);
    const india = t.rows.find((r) => r.label === "India")!;
    expect(india.values[3]).toBe("6.6");
    expect(india.values[6]).toBe("0.1");
  });

  it("keeps the fiscal-year labels for rows under a relabelling header", () => {
    const india = t.rows.find((r) => r.label === "India")!;
    expect(india.labels?.[3]).toBe("2026/27f");
    expect(t.rows.find((r) => r.label === "Maldives")!.labels).toBeUndefined();
    expect(linearizeTable(t, [india])[0]).toContain("2026/27f 6.6");
    expect(linearizeTable(t, [india])[0]).toContain("2026/27f +0.1 pp");
  });

  it("drops superscript footnote markers and keeps notes apart", () => {
    expect(t.rows.map((r) => r.label)).toEqual(["Maldives", "India"]);
    expect(t.notes.join(" ")).toContain("Source: World Bank.");
    expect(tableToMarkdown(t)).toContain("| India | 7.2 | 7.1 | 7.7 | 6.6 |");
  });
});
