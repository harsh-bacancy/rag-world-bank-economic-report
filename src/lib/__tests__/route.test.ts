import { describe, expect, it } from "vitest";
import { routeRules } from "@/lib/retrieval/route";

const ctx = { countries: { india: "SAR", pakistan: "MNA", brazil: "LAC", mongolia: "EAP", nigeria: "SSA", niger: "SSA" } as const, boxes: ["1.1", "1.2", "2.1", "3.1"] };
const r = (q: string) => routeRules(q, { countries: { ...ctx.countries }, boxes: ctx.boxes });

describe("query routing (rules)", () => {
  it("routes region names and acronyms", () => {
    expect(r("What is the growth outlook for South Asia in this report?").regions).toEqual(["SAR"]);
    expect(r("What is the outlook for SSA?").regions).toEqual(["SSA"]);
  });

  it("routes a country to the region this report puts it in", () => {
    expect(r("What growth is projected in 2026 for the region that includes Pakistan?").regions).toEqual(["MNA"]);
    expect(r("What is India's projected growth for fiscal year 2026/27?").regions).toEqual(["SAR"]);
    expect(r("Compare Pakistan's and India's growth").regions.sort()).toEqual(["MNA", "SAR"]);
  });

  it("matches the longest country name first", () => {
    const x = r("How fast will Nigeria grow?");
    expect(x.countries).toEqual(["nigeria"]);
  });

  it("sets a chapter only when it is named", () => {
    expect(r("What does Chapter 3 say about sovereign debt in developing economies?").chapter).toBe("3");
    expect(r("What does the report say about sovereign debt?").chapter).toBeNull();
    expect(r("According to the executive summary, what are the main risks?").chapter).toBe("ES");
  });

  it("keeps every chapter a question names, and opens one-sided comparisons", () => {
    expect(r("Do the executive summary and Chapter 3 agree on spreads?").chapters).toEqual(["ES", "3"]);
    expect(r("How do Chapter 1 and Chapter 4 describe the shock?").chapters).toEqual(["1", "4"]);
    const w = r("Which region is worst affected in 2026, and how does its growth compare with South Asia's?");
    expect(w.regions).toEqual(["SAR"]);
    expect(w.openComparison).toBe(true);
    expect(r("What is the growth outlook for South Asia?").openComparison).toBe(false);
  });

  it("refuses structurally what cannot exist", () => {
    expect(r("What does Chapter 5 say about climate finance?").structuralRefusal).toMatch(/four chapters/);
    expect(r("What does Box 4.1 in this report discuss?").structuralRefusal).toMatch(/no Box 4\.1/);
    expect(r("What is the growth forecast for South Asia in 2029?").structuralRefusal).toMatch(/2028/);
    expect(r("How did debt change since 2010?").structuralRefusal).toBeNull();
  });

  it("sends quarterly questions to the Statistical Appendix", () => {
    const x = r("What was Mongolia's year-on-year growth in the fourth quarter of 2025?");
    expect(x.chapter).toBe("SA");
    expect(x.regions).toEqual(["EAP"]);
  });
});
