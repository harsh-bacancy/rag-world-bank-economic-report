import { getStore } from "@/lib/store";
import { readIndex } from "@/lib/pipeline/index-file";

export const runtime = "nodejs";

/** GET ?id=<section id> → the section's own passages (and its subsections'), for reading the record from the outline. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  try {
    const store = getStore();
    const sections = await store.sections();
    const section = sections.find((s) => s.id === id);
    if (!section) return Response.json({ error: "No such section." }, { status: 404 });
    const inside = new Set(sections.filter((s) => s.id === id || s.id.startsWith(`${id}/`)).map((s) => s.id));
    const idx = await readIndex();
    const parents = idx.parents.filter((p) => inside.has(p.sectionId) && p.type !== "table").slice(0, 8);
    const titleOf = new Map(sections.map((s) => [s.id, s.path.join(" › ")]));
    return Response.json({
      section: { id: section.id, path: section.path, region: section.region, boxId: section.boxId, chapter: section.chapter, pdfStart: section.pdfStart, pdfEnd: section.pdfEnd },
      passages: parents.map((p) => ({ id: p.id, headingPath: titleOf.get(p.sectionId) ?? "", text: p.text, pdfStart: p.pdfStart, pdfEnd: p.pdfEnd, pageBreaks: p.pageBreaks ?? [], type: p.type })),
      more: idx.parents.filter((p) => inside.has(p.sectionId) && p.type !== "table").length > parents.length,
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error && /No index/.test(err.message) ? "Run npm run ingest first." : "Could not read the section." }, { status: 500 });
  }
}
