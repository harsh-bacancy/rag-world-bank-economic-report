import { describe, expect, it } from "vitest";
import { REFUSAL_TEXT, verifyAnswer } from "@/lib/retrieval/generate";

const sources = [
  { n: 1, id: "p1", label: "Ch 2 › South Asia › Outlook", printed: "74", region: "SAR" as const, chapter: "2" as const, kind: "parent" as const, text: "Growth in SAR is expected to soften to 6.3 percent in 2026, mainly reflecting the adverse impact of the conflict in the Middle East." },
  { n: 2, id: "p2", label: "Ch 2 › Sub-Saharan Africa › Outlook", printed: "77", region: "SSA" as const, chapter: "2" as const, kind: "parent" as const, text: "Growth in SSA is forecast to edge down to 4 percent in 2026 and then recover to 4.4 percent on average in 2027–28." },
  { n: 3, id: "__computed__", label: "Computed", printed: "", region: null, chapter: null, kind: "computed" as const, text: "Change 2025e → 2026f: -0.7 percentage points." },
];

describe("citation verifier", () => {
  it("keeps verbatim quotes, even with different quote marks or case", () => {
    const g = verifyAnswer({ answer: "Growth softens to 6.3 percent in 2026.[^1]", citations: [{ n: 1, source: 1, quote: "growth in SAR is expected to soften to 6.3 percent in 2026" }], refused: false }, sources, { regions: ["SAR"], chapters: [] });
    expect(g.refused).toBe(false);
    expect(g.citations).toHaveLength(1);
    expect(g.citations[0].span).toContain("6.3 percent");
  });

  it("strips a quote that is not in its source, and the sentence with it", () => {
    const g = verifyAnswer({ answer: "Growth softens to 6.3 percent.[^1] It will reach 9 percent in 2027.[^2]", citations: [{ n: 1, source: 1, quote: "soften to 6.3 percent in 2026" }, { n: 2, source: 1, quote: "reach 9 percent in 2027" }], refused: false }, sources, null);
    expect(g.answer).toBe("Growth softens to 6.3 percent.[^1]");
    expect(g.rejected.notVerbatim).toBe(1);
  });

  it("strips a verbatim citation from another region (the scope guard)", () => {
    const g = verifyAnswer({ answer: "South Asia grows 6.3 percent.[^1] It recovers to 4.4 percent.[^2]", citations: [{ n: 1, source: 1, quote: "soften to 6.3 percent in 2026" }, { n: 2, source: 2, quote: "recover to 4.4 percent on average" }], refused: false }, sources, { regions: ["SAR"], chapters: [] });
    expect(g.answer).toBe("South Asia grows 6.3 percent.[^1]");
    expect(g.rejected.outOfScope).toBe(1);
  });

  it("lets the computed source through the scope guard", () => {
    const g = verifyAnswer({ answer: "It slows by 0.7 percentage points.[^1]", citations: [{ n: 1, source: 3, quote: "-0.7 percentage points" }], refused: false }, sources, { regions: ["SAR"], chapters: ["2"] });
    expect(g.refused).toBe(false);
  });

  it("turns an answer with nothing verified into a refusal", () => {
    const g = verifyAnswer({ answer: "Growth is 12 percent.[^1]", citations: [{ n: 1, source: 2, quote: "growth is 12 percent" }], refused: false }, sources, null);
    expect(g.refused).toBe(true);
    expect(g.answer).toBe(REFUSAL_TEXT);
  });
});
