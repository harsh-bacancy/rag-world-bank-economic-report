import { ask } from "@/lib/retrieval/ask";
import { REGIONS, type Region } from "@/lib/pdf/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/** POST { question, mode?: "full" | "naive", scopeRegion?: Region } → AskResult */
export async function POST(req: Request) {
  let body: { question?: unknown; mode?: unknown; scopeRegion?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: "Send JSON: { question }" }, { status: 400 }); }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return Response.json({ error: "Ask a question about the report." }, { status: 400 });
  if (question.length > 600) return Response.json({ error: "Keep the question under 600 characters." }, { status: 400 });
  const mode = body.mode === "naive" ? "naive" : "full";
  const scopeRegion = REGIONS.includes(body.scopeRegion as Region) ? (body.scopeRegion as Region) : undefined;
  try {
    return Response.json(await ask(question, { mode, scopeRegion }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ask]", msg);
    const quota = /quota|budget|spent for today/i.test(msg);
    return Response.json({ error: quota ? "The free Gemini quota for today is used up. Retrieval still works; answers resume after midnight UTC." : /No index/.test(msg) ? "The report has not been indexed yet. Run: npm run ingest" : "Something went wrong while answering. The server log has the details." }, { status: quota ? 429 : 500 });
  }
}
