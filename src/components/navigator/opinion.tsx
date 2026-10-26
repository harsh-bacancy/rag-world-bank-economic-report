"use client";

import { Check, KeyRound, ShieldOff } from "lucide-react";
import type { ReactNode } from "react";
import type { AskResult } from "@/lib/retrieval/ask";
import type { Source } from "@/lib/retrieval/context";
import { CHAPTER_SHORT, REGION_LABEL, shortPath } from "./types";

/** The scope line of the headnote: where the question was routed, and why. */
export function ScopeLine({ r }: { r: AskResult }) {
  const parts: ReactNode[] = [];
  for (const reg of r.route.regions) parts.push(<span key={reg}>{REGION_LABEL[reg]} <span className="text-[11px] tracking-[0.06em]">({reg})</span></span>);
  for (const ch of r.route.chapters ?? (r.route.chapter ? [r.route.chapter] : [])) parts.push(<span key={`ch${ch}`}>{CHAPTER_SHORT[ch]}</span>);
  if (r.route.boxId) parts.push(<span key="bx">Box {r.route.boxId}</span>);
  const why = r.mode === "naive" ? "naive baseline: no routing" : r.route.openComparison ? "named in the question; the whole report is searched too, for the other side of the comparison" : r.route.regionSource === "country" ? `from ${r.route.countries.map((c) => c.replace(/\b\w/g, (m) => m.toUpperCase())).join(", ")}` : r.route.regionSource === "acronym" ? "from the acronym" : r.route.regionSource === "user" ? "chosen for comparison" : r.route.regionSource === "name" ? "named in the question" : r.route.chapter ? "named in the question" : "";
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] leading-snug">
      <KeyRound className={`size-3.5 shrink-0 translate-y-[2px] ${parts.length ? "text-path" : "text-ink-3"}`} strokeWidth={2.25} aria-hidden />
      <span className="font-semibold text-ink-2">Scope</span>
      {parts.length ? parts.map((p, i) => <span key={i} className="font-semibold text-path">{p}{i < parts.length - 1 ? " ·" : ""}</span>) : <span className="text-ink-2">the whole report</span>}
      {why && <span className="text-ink-3">— {why}{r.widened ? "; the filter matched too little, so the whole report was searched" : ""}</span>}
    </p>
  );
}

function Holding({ text, onPin, cited }: { text: string; onPin: (n: number) => void; cited: Set<number> }) {
  const parts = text.split(/(\[\^\d+\])/g);
  return (
    <p className="record text-[19px] leading-[1.55] text-ink">
      <span className="mr-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-2" style={{ fontFamily: "var(--font-ui)" }}>Held</span>
      {parts.map((p, i) => {
        const m = /^\[\^(\d+)\]$/.exec(p);
        if (!m) return <span key={i}>{p}</span>;
        const n = Number(m[1]);
        if (!cited.has(n)) return null;
        return (
          <button key={i} type="button" onClick={() => onPin(n)} className="mx-[1px] align-super font-[var(--font-ui)] text-[12px] font-semibold text-path hover:text-path-2 hover:underline" aria-label={`Open pinpoint ${n} in the record`} style={{ fontFamily: "var(--font-ui)" }}>
            [{n}]
          </button>
        );
      })}
    </p>
  );
}

const REFUSAL_WHY: Record<string, string> = {
  gate: "No passage in the report is close enough to this question to answer it, so no answer was generated.",
  structural: "",
  model: "The passages retrieved do not contain this.",
  verifier: "Every citation the draft answer offered failed verification, so nothing was kept.",
};

/** One answer as an opinion on the record: headnote, holding, authorities. */
export function Opinion({ r, onPin, onSource, compact }: { r: AskResult; onPin: (n: number) => void; onSource: (s: Source) => void; compact?: boolean }) {
  const cited = new Set(r.citations.map((c) => c.n));
  const retrievalOnly = !!r.retrieveOnly;
  return (
    <article className="flex flex-col gap-5" aria-live="polite">
      <header className="flex flex-col gap-1.5 border-b border-rule pb-3">
        {r.mode === "naive" && <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink">Naive baseline — 1000-character chunks, no routing, no reranker, no scope guard</p>}
        <ScopeLine r={r} />
        <p className="num text-[12px] text-ink-3">
          {r.retrieved.length} passages read · {r.channel === "hybrid" ? "meaning + keywords" : r.channel === "dense" ? "meaning" : "keywords"}
          {r.topScore !== null && <> · best match {r.topScore.toFixed(2)}</>} · {(r.latencyMs / 1000).toFixed(1)} s · {r.geminiCalls} model call{r.geminiCalls === 1 ? "" : "s"}
        </p>
      </header>

      {r.refused ? (
        <section className="flex flex-col gap-2">
          <p className="record flex items-start gap-2 text-[19px] leading-snug text-ink">
            <ShieldOff className="mt-1.5 size-4 shrink-0 text-ink-2" aria-hidden />
            <span>{r.answer.replace(/\s*This report has.*|\s*This edition.*|\s*The report's forecasts.*/, "")}</span>
          </p>
          <p className="max-w-[60ch] pl-6 text-[14px] leading-relaxed text-ink-2">{r.refusalReason && r.refusal === "structural" ? r.refusalReason : REFUSAL_WHY[r.refusal ?? "model"]}</p>
          <p className="pl-6 text-[12px] text-ink-3">A refusal is an answer: the report was searched, and it does not say this.</p>
        </section>
      ) : retrievalOnly ? (
        <section className="-mt-5 flex flex-col gap-2 border-b border-rule py-3">
          <p className="record text-[19px] leading-snug text-ink"><span className="mr-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-2" style={{ fontFamily: "var(--font-ui)" }}>No holding written.</span>Answers are off: no Gemini API key is set.</p>
          <p className="text-[13px] leading-relaxed text-ink-3">Routing and retrieval ran in full. These are the passages an answer would be drawn from; open any of them. Add <code className="text-[12px]">GOOGLE_GENERATIVE_AI_API_KEY</code> to <code className="text-[12px]">.env.local</code> to generate answers (see START_HERE.md).</p>
        </section>
      ) : (
        <Holding text={r.answer} onPin={onPin} cited={cited} />
      )}

      {!r.refused && !retrievalOnly && r.citations.length > 0 && (
        <section aria-label="Authorities">
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3">Authorities</h3>
          <ol className="flex flex-col divide-y divide-rule border-y border-rule">
            {r.citations.map((c) => {
              const src = r.sources.find((s) => s.n === c.source);
              return (
                <li key={`${c.n}-${c.source}`}>
                  <button type="button" onClick={() => onPin(c.n)} className="group flex w-full gap-3 py-2.5 text-left hover:bg-page-2">
                    <span className="num w-7 shrink-0 text-[13px] font-semibold text-path">[{c.n}]</span>
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="text-[13px] leading-snug text-ink-2">{src?.kind === "computed" ? "Computed in code from the report's tables" : shortPath(src?.headingPath) || c.label} {src?.kind !== "computed" && <span className="num text-ink-3">· p. {c.printed}</span>}</span>
                      <span className="record text-[15px] italic leading-snug text-ink">“{c.span}”</span>
                    </span>
                    <span className="ml-auto flex shrink-0 items-start gap-1 pt-0.5 text-[11px] font-medium text-ink-3"><Check className="size-3.5" aria-hidden />verbatim</span>
                  </button>
                </li>
              );
            })}
          </ol>
          {(r.rejected.notVerbatim > 0 || r.rejected.outOfScope > 0) && (
            <p className="mt-2 text-[12px] text-ink-3">
              Removed before you saw it: {r.rejected.notVerbatim > 0 && `${r.rejected.notVerbatim} quote${r.rejected.notVerbatim > 1 ? "s" : ""} not found verbatim`}
              {r.rejected.notVerbatim > 0 && r.rejected.outOfScope > 0 && "; "}
              {r.rejected.outOfScope > 0 && `${r.rejected.outOfScope} citation${r.rejected.outOfScope > 1 ? "s" : ""} from outside the scope`}.
            </p>
          )}
        </section>
      )}

      {(retrievalOnly || (!compact && !r.refused)) && r.sources.length > 0 && (
        <details className="group" open={retrievalOnly}>
          <summary className="cursor-pointer list-none text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3 hover:text-ink">
            <span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span> the {r.sources.filter((s) => s.kind !== "computed").length} passages read
          </summary>
          <ol className="mt-2 flex flex-col">
            {r.sources.filter((s) => s.kind !== "computed").map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onSource(s)} className="flex w-full items-baseline gap-3 py-1.5 text-left text-[13px] hover:bg-page-2">
                  <span className="num w-6 shrink-0 text-ink-3">{s.n}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2" title={s.headingPath ?? undefined}>{shortPath(s.headingPath) || `Unstructured chunk, PDF page ${s.pdfStart}`}</span>
                  <span className="num shrink-0 text-ink-3">p. {s.printed}</span>
                </button>
              </li>
            ))}
          </ol>
          {r.computed && <p className="mt-2 whitespace-pre-line border-l border-rule pl-3 text-[12px] leading-relaxed text-ink-3"><span className="font-semibold text-ink-2">Computed in code: </span>{r.computed}</p>}
        </details>
      )}
    </article>
  );
}
