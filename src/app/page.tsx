import { Navigator } from "@/components/navigator/navigator";
import type { OutlineNode } from "@/components/navigator/types";
import { hasGeminiKey } from "@/lib/gemini/client";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Page() {
  let outline: OutlineNode[] = [];
  let printed: string[] = [];
  try {
    const store = getStore();
    printed = await store.printed();
    const label = (p: number) => printed[p - 1] || `PDF ${p}`;
    outline = (await store.sections())
      .filter((s) => s.level <= 1)
      .map((s) => ({ id: s.id, parentId: s.parentId, level: s.level, title: s.title, chapter: s.chapter, region: s.region, boxId: s.boxId, kind: s.kind, printedStart: label(s.pdfStart), printedEnd: label(s.pdfEnd) }));
  } catch {
    return (
      <main className="mx-auto max-w-[640px] px-6 py-16">
        <h1 className="text-[22px] font-semibold">The report has not been indexed yet</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-2">Run <code>npm run ingest</code> in the project folder, then reload. It reads <code>data/source/GEP-Jun-2026.pdf</code> and needs no API key.</p>
      </main>
    );
  }
  return <Navigator outline={outline} printed={printed} hasKey={hasGeminiKey()} />;
}
