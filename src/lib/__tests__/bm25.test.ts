import { describe, expect, it } from "vitest";
import { BM25, rrf, tokenize } from "@/lib/retrieval/bm25";

describe("keyword search", () => {
  it("keeps fiscal years, decimals and estimate/forecast suffixes as tokens", () => {
    expect(tokenize("India FY2026/27: 6.6 percent in 2026f")).toEqual(expect.arrayContaining(["2026/27", "6.6", "2026f", "india"]));
  });

  it("ranks the passage with the rare exact terms first", () => {
    const idx = new BM25(["a", "b"], ["Growth in SSA edges down to 4 percent", "Growth in SAR softens to 6.3 percent"]);
    expect(idx.search("SAR growth", 2)[0].id).toBe("b");
  });

  it("fuses rankings by rank only (RRF)", () => {
    const fused = rrf([[{ id: "x" }, { id: "y" }], [{ id: "y" }, { id: "z" }]]);
    expect(fused[0].id).toBe("y");
  });
});
