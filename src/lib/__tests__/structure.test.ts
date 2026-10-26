import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadExtracted, SOURCE_PDF } from "@/lib/pdf/cache";
import { buildDocModel } from "@/lib/pdf/structure";
import type { DocModel } from "@/lib/pdf/types";
import { buildChunks } from "@/lib/pipeline/chunk";
import { deriveCountries } from "@/lib/pipeline/index-file";

// Integration checks against the real report (skipped if the PDF is absent).
describe.skipIf(!existsSync(SOURCE_PDF))("structure of the GEP June 2026 PDF", () => {
  let doc: DocModel;
  beforeAll(async () => { doc = buildDocModel(await loadExtracted()); }, 60_000);

  it("recovers the six regional sections of Chapter 2 with their regions", () => {
    const regional = doc.sections.filter((s) => s.chapter === "2" && s.level === 1 && s.region).map((s) => s.region);
    expect(regional).toEqual(["EAP", "ECA", "LAC", "MNA", "SAR", "SSA"]);
  });

  it("puts the South Asia outlook sentence in Ch. 2 › South Asia › Outlook on printed page 74", () => {
    const b = doc.blocks.find((x) => x.text.startsWith("Growth in SAR is expected to soften to 6.3"))!;
    const s = doc.sections.find((x) => x.id === b.sectionId)!;
    expect(s.path.slice(-2)).toEqual(["South Asia", "Outlook"]);
    expect(doc.printed[b.pdfStart - 1]).toBe("74");
  });

  it("keeps box text in its box even on pages it shares with the main text", () => {
    const boxes = doc.sections.filter((s) => s.kind === "box" && s.level === 1).map((s) => s.boxId);
    expect(boxes).toEqual(["1.1", "1.2", "2.1", "3.1"]);
    const globalContext = doc.sections.find((s) => s.title === "Global context")!;
    expect(globalContext.boxId).toBeNull();
  });

  it("tags the executive summary and chapter summaries", () => {
    const es = doc.blocks.filter((b) => doc.sections.find((s) => s.id === b.sectionId)!.kind === "executive_summary");
    expect(es.some((b) => b.text.includes("global growth could fall to just 1.3 percent in 2026"))).toBe(true);
  });

  it("maps countries to the report's regions (Pakistan is MNA)", () => {
    const c = deriveCountries(doc);
    expect(c["pakistan"]).toBe("MNA");
    expect(c["india"]).toBe("SAR");
  });

  it("never lets a chunk cross a section boundary or lose its location", () => {
    const { chunks, parents } = buildChunks(doc);
    const parentSection = new Map(parents.map((p) => [p.id, p.sectionId]));
    for (const c of chunks) expect(parentSection.get(c.parentId)).toBe(c.sectionId);
    expect(chunks.filter((c) => c.region === "SAR").length).toBeGreaterThan(5);
  });
});
