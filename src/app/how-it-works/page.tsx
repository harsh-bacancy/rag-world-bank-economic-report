import type { Metadata } from "next";
import type { ReactNode } from "react";
import { readIndex } from "@/lib/pipeline/index-file";
import { tableFacts } from "@/lib/retrieval/computed";
import { resolveRoute } from "@/lib/retrieval/retrieve";
import type { Route } from "@/lib/retrieval/route";
import { RunningHead } from "@/components/running-head";

export const metadata: Metadata = { title: "How it works" };
export const dynamic = "force-dynamic";

const ROUTE_EXAMPLES = [
  "What is the growth outlook for South Asia in this report?",
  "What growth is projected in 2026 for the region that includes Pakistan?",
  "What does Chapter 3 say about sovereign debt in developing economies?",
  "According to the executive summary, what are the main risks to the global outlook?",
  "What was Mongolia's year-on-year growth in the fourth quarter of 2025?",
  "What does Box 4.1 in this report discuss?",
];

/** Each step is set as a headnote: a numbered key, the point of law in small capitals, then the discussion. */
function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <section data-guide={title} className="grid gap-4 border-t border-rule-strong pt-6 md:grid-cols-[200px_minmax(0,1fr)]">
      <h2 className="flex items-baseline gap-2 text-[14px] font-semibold leading-snug text-ink"><span className="num shrink-0 border border-rule-strong px-1.5 text-[11px] font-semibold leading-[1.5]">{n}</span><span className="running-head">{title}</span></h2>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}
const Prose = ({ children }: { children: ReactNode }) => <p className="record max-w-[68ch] text-[17px] leading-[1.65] text-ink">{children}</p>;
const Specimen = ({ label, children, tone = "plain" }: { label: string; children: ReactNode; tone?: "plain" | "before" }) => (
  <figure className="min-w-0">
    <figcaption className="mb-1 text-[12px] font-semibold text-ink-3">{label}</figcaption>
    <pre className={`overflow-x-auto whitespace-pre-wrap break-words border-y px-0.5 py-2.5 text-[12.5px] leading-relaxed ${tone === "before" ? "border-dashed border-ink-3 text-ink-3" : "border-rule-strong text-ink"}`}>{children}</pre>
  </figure>
);

export default async function HowItWorks() {
  let idx;
  try { idx = await readIndex(); } catch {
    return <main className="mx-auto max-w-[680px] px-6 py-16"><h1 className="text-[22px] font-semibold">Run <code>npm run ingest</code> first</h1><p className="mt-3 text-ink-2">This page shows real examples from the index, so it needs one.</p></main>;
  }
  const naiveSample = idx.naive.find((c) => /G L O B A L/.test(c.text) && /Percent/.test(c.text)) ?? idx.naive[40];
  const sarChunk = idx.chunks.find((c) => c.text.includes("Growth in SAR is expected to soften to 6.3"));
  const tableChunk = idx.chunks.find((c) => c.type === "table" && c.text.startsWith("Table 2.9"));
  const routes: Route[] = await Promise.all(ROUTE_EXAMPLES.map((q) => resolveRoute(q, "rules")));
  const sarRoute = routes[0];
  const facts = await tableFacts(ROUTE_EXAMPLES[0], sarRoute);
  const counts = { sections: idx.sections.length, chunks: idx.chunks.length, parents: idx.parents.length, tables: new Set(idx.cells.map((c) => c.tableId)).size, cells: idx.cells.length, countries: Object.keys(idx.countries).length };

  return (
    <>
    <RunningHead title="How it works" />
    <main className="mx-auto w-full max-w-[1000px] px-4 pb-24 pt-8 md:px-8">
      <h1 className="record text-[34px] font-semibold leading-tight tracking-[-0.01em]">How it works</h1>
      <p className="record mt-3 max-w-[66ch] text-[19px] leading-[1.55] text-ink-2">
        A 200-page report where six regions describe their growth forecasts in the same words. Matching words is not enough; the system has to know where each passage lives, and keep to that place when it answers.
      </p>
      <p className="mt-3 text-[13px] text-ink-3 num">
        From the PDF: {counts.sections} sections · {counts.parents} reading windows · {counts.chunks} search chunks · {counts.tables} tables rebuilt into {counts.cells.toLocaleString("en")} cells · {counts.countries} economies mapped to regions. Every example below is read from that index.
      </p>

      <div className="mt-10 flex flex-col gap-10">
        <Step n="1" title="Read the PDF with its fonts">
          <Prose>
            A plain extractor hands a RAG system text like the specimen on the left: running heads spelled with spaces, chart axis labels, table cells out of reading order. (Some extractors also emit ligatures as single characters: pdftotext gives about 1,500 of them for this PDF, the letters “f” and “i” arriving as the single character U+FB01, so a search for “fiscal” misses them; text normalisation repairs them.) We read every run of text with its font and position instead, because in this report the fonts carry the structure: Garamond 11 is the body, 10.6 is a box, Helvetica Bold 16 is a section, Helvetica 11 a subsection, Helvetica 7.6 a table cell.
          </Prose>
          <div className="grid gap-4 md:grid-cols-2">
            <Specimen label={`What the naive baseline indexes (PDF page ${naiveSample.pdfStart})`} tone="before">{naiveSample.text.slice(0, 520)}…</Specimen>
            {sarChunk && <Specimen label={`What we index: repaired, one section only (printed p. ${sarChunk.printedStart})`}>{sarChunk.text.slice(0, 520)}…</Specimen>}
          </div>
        </Step>

        <Step n="2" title="Rebuild the outline, then chunk inside it">
          <Prose>
            Headings, boxes, figures, tables and footnotes become an outline that matches the report’s own Contents. Each section is cut into reading windows of about 900 tokens and search chunks of about 280, and no chunk ever crosses a section boundary. Every chunk carries its chapter, region, box, kind and printed page.
          </Prose>
          {sarChunk && <Specimen label="One search chunk, with the heading path it is embedded with">{`${sarChunk.headingPath}\n— region ${sarChunk.region} · ${sarChunk.kind} · printed p. ${sarChunk.printedStart}\n\n${sarChunk.text.slice(0, 300)}…`}</Specimen>}
          <Prose>
            The passage says “SAR”, never “South Asia”. The heading path in front of it gives search the words the reader uses, while the text that citations are checked against stays exactly as printed.
          </Prose>
        </Step>

        <Step n="3" title="Tables become rows with their headers">
          <Prose>
            In a forecast table, “0.1” beside “6.3” is a revision from January, not a growth rate, and India’s columns are fiscal years while Maldives’ are calendar years. Each table is rebuilt from the positions of its cells: column anchors come from the header row, revision columns are marked, and fiscal-year groups keep their own labels.
          </Prose>
          {tableChunk && (
            <div className="grid gap-4 md:grid-cols-2">
              <Specimen label="What the model reads and quotes">{tableChunk.text.split("\n").slice(0, 6).join("\n")}</Specimen>
              <Specimen label="What search sees (rows read as prose)">{tableChunk.retrievalText.split("\n").slice(2, 5).join("\n")}</Specimen>
            </div>
          )}
        </Step>

        <Step n="4" title="Decide where to look before looking">
          <Prose>
            The question is routed first. A region can be named, abbreviated, or implied by a country, using the report’s own grouping read from its tables (Pakistan sits with the Middle East and North Africa here). A chapter filter is set only when the question names one: a wrong filter hides the answer, a missing one only makes search work harder. Things the report cannot contain are refused by rule.
          </Prose>
          <table className="w-full border-collapse text-[13px]">
            <thead><tr className="border-b border-rule-strong text-left text-[12px] text-ink-3"><th className="py-1.5 pr-4 font-semibold">Question</th><th className="py-1.5 font-semibold">Searched</th></tr></thead>
            <tbody>
              {ROUTE_EXAMPLES.map((q, i) => {
                const r = routes[i];
                const scope = r.structuralRefusal ? `refused: ${r.structuralRefusal}` : [r.regions.join(" + "), r.chapter && (r.chapter === "ES" ? "Executive Summary" : r.chapter === "SA" ? "Statistical Appendix" : `Chapter ${r.chapter}`), r.boxId && `Box ${r.boxId}`].filter(Boolean).join(" · ") || "whole report";
                return (
                  <tr key={q} className="border-b border-rule align-top">
                    <td className="record py-2 pr-4 text-[15px] text-ink">{q}</td>
                    <td className={`py-2 ${r.structuralRefusal ? "text-ink-2" : "font-semibold text-path"}`}>{scope}{r.regionSource === "country" && <span className="block font-normal text-ink-3">from {r.countries.join(", ")}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Step>

        <Step n="5" title="Search, rerank, read the parent">
          <Prose>
            Inside the scope, keyword search (BM25) and meaning search (Gemini embeddings, when a key is set) each rank the chunks, and Reciprocal Rank Fusion merges the two lists by rank alone. A cross-encoder (bge-reranker-v2-m3, running locally) then rereads the question with each candidate. The model is handed the parent windows of the best chunks, labelled with chapter, region and page. If even the best candidate scores below the gate, the answer is a refusal and no model call is spent.
          </Prose>
        </Step>

        <Step n="6" title="Compute, cite, verify">
          <Prose>
            The model may read numbers but never does arithmetic. For the entities a question names, the rebuilt table rows are turned into facts in code (changes, averages, the January projection a revision implies) and handed over as one more citable source:
          </Prose>
          <Specimen label="The computed source for “What is the growth outlook for South Asia?”">{facts.lines.join("\n") || "(no table facts)"}</Specimen>
          <Prose>
            Every sentence of an answer must carry a citation with a quote. Before you see it, each quote is looked up verbatim in the passage it names, and any citation into a passage from outside the question’s scope is removed even when the quote is genuine. A sentence left without support is dropped; an answer left with nothing becomes a refusal.
          </Prose>
        </Step>

        <Step n="7" title="What it does not do">
          <ul className="max-w-[68ch] list-disc pl-5 text-[15px] leading-relaxed text-ink-2">
            <li>Values that appear only in charts are not answerable; the charts’ captions, panels and notes are indexed, their bars are not.</li>
            <li>One report, one edition. Questions about other editions, other institutions or years beyond 2028 are refused.</li>
            <li>Answers are not streamed, because verification needs the whole answer first.</li>
            <li>The answer judge on the Evaluation page is Gemini grading Gemini; locations and numbers are checked without it.</li>
          </ul>
        </Step>
      </div>
    </main>
    </>
  );
}
