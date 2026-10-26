import { describe, expect, it } from "vitest";
import { appendLine, normalizeText, splitSentences, Vocabulary } from "@/lib/pdf/repair";

describe("text repair", () => {
  it("expands ligature codepoints so search sees plain words", () => {
    expect(normalizeText("ﬁscal ﬂows aﬀected eﬃcient")).toBe("fiscal flows affected efficient");
  });

  it("joins a broken word but keeps a real compound", () => {
    const v = new Vocabulary();
    v.add("lead weather-related shocks also pose risks to advanced economies");
    v.add("in many information and processing tasks");
    expect(appendLine("prospects for ad-", "vanced economies", v)).toBe("prospects for advanced economies");
    expect(appendLine("and weather-", "related shocks", v)).toBe("and weather-related shocks");
    expect(appendLine("many information-", "processing tasks", v)).toBe("many information-processing tasks");
  });

  it("does not treat line fragments as words", () => {
    const v = new Vocabulary();
    v.add("the outlook for eco-");
    v.add("nomic activity remains weak");
    expect(appendLine("eco-", "nomic activity", v)).toBe("economic activity");
  });

  it("splits sentences without breaking on U.S. or decimals", () => {
    expect(splitSentences("Lower U.S. tariffs helped. Growth is 6.3 percent in 2026. Risks remain.")).toEqual([
      "Lower U.S. tariffs helped.", "Growth is 6.3 percent in 2026.", "Risks remain.",
    ]);
  });
});
