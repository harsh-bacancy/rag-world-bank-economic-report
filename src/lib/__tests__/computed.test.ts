import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INDEX_PATH } from "@/lib/pipeline/index-file";
import { tableFacts } from "@/lib/retrieval/computed";
import { routeRules } from "@/lib/retrieval/route";
import { LocalStore } from "@/lib/store/local";
import { readIndex } from "@/lib/pipeline/index-file";

// The computed source reads rebuilt table cells; these checks run against the real index (skipped before ingest).
describe.skipIf(!existsSync(INDEX_PATH))("computed source (table facts)", () => {
  const store = new LocalStore();
  const route = async (q: string) => routeRules(q, { countries: (await readIndex()).countries, boxes: ["1.1", "1.2", "2.1", "3.1"] });

  it("derives South Asia's change, average and January projection in code", async () => {
    const q = "By how many percentage points is South Asia's growth expected to slow from 2025 to 2026?";
    const { lines } = await tableFacts(q, await route(q), store);
    const sar = lines.find((l) => l.startsWith("South Asia"))!;
    expect(sar).toContain("2026f 6.3");
    expect(sar).toContain("Change 2025e → 2026f: -0.7 percentage points");
    expect(sar).toContain("Average of 2027f and 2028f: 7.0 percent");
    expect(sar).toContain("Implied January 2026 projection for 2026f: 6.2 percent");
  }, 30_000);

  it("computes the oil price January implied and a pairwise difference", async () => {
    const q = "What oil price had the January 2026 edition projected for 2026?";
    const oil = (await tableFacts(q, await route(q), store)).lines.join("\n");
    expect(oil).toContain("Implied January 2026 projection for 2026f: 60.0");
    const q2 = "How much faster is the United States projected to grow than the euro area in 2026?";
    const us = (await tableFacts(q2, await route(q2), store)).lines.join("\n");
    expect(us).toContain("Difference in 2026f: United States 2.2 minus Euro area 0.8 = 1.4 percentage points");
  }, 30_000);

  it("reads a country from its regional table (Iraq, MNA)", async () => {
    const q = "What was Iraq's 2026 growth projection in January 2026?";
    const iraq = (await tableFacts(q, await route(q), store)).lines.join("\n");
    expect(iraq).toContain("Implied January 2026 projection for 2026f: 6.5 percent");
  }, 30_000);
});
