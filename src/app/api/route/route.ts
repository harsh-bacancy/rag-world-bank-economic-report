import { resolveRoute } from "@/lib/retrieval/retrieve";

export const runtime = "nodejs";

/** GET ?q= → the rules route for a question as it is being typed (0 model calls), for the live scope preview. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return Response.json({ regions: [], chapter: null, boxId: null, structuralRefusal: null, countries: [] });
  try {
    const r = await resolveRoute(q, "rules");
    return Response.json({ regions: r.regions, chapter: r.chapter, chapters: r.chapters, boxId: r.boxId, structuralRefusal: r.structuralRefusal, countries: r.countries, regionSource: r.regionSource });
  } catch {
    return Response.json({ regions: [], chapter: null, boxId: null, structuralRefusal: null, countries: [] });
  }
}
