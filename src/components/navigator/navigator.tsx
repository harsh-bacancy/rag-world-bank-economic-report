"use client";

import { ArrowRight, Columns2, ListTree, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Region } from "@/lib/pdf/types";
import type { AskResult } from "@/lib/retrieval/ask";
import type { Source } from "@/lib/retrieval/context";
import { Opinion } from "./opinion";
import { RecordPanel } from "./record-panel";
import { Spine, type SpineMarks } from "./spine";
import { MORE_QUESTIONS, REGION_LABEL, SAMPLE_QUESTIONS, type OutlineNode, type RecordPassage, type ScopePreview } from "./types";

type Answer = { status: "idle" } | { status: "loading"; question: string } | { status: "done"; result: AskResult } | { status: "error"; message: string };
const REGION_KEYS = Object.keys(REGION_LABEL) as Region[];

export function Navigator({ outline, printed, hasKey }: { outline: OutlineNode[]; printed: string[]; hasKey: boolean }) {
  const [question, setQuestion] = useState("");
  const [rawPreview, setPreview] = useState<ScopePreview | null>(null);
  const preview = question.trim().length >= 4 ? rawPreview : null;
  const [naive, setNaive] = useState(false);
  const [compare, setCompare] = useState(false);
  const [pair, setPair] = useState<[Region, Region]>(["SAR", "SSA"]);
  const [answers, setAnswers] = useState<Answer[]>([{ status: "idle" }]);
  const [record, setRecord] = useState<{ title: string | null; passages: RecordPassage[]; sectionId: string | null; loading?: boolean }>({ title: null, passages: [], sectionId: null });
  const [outlineOpen, setOutlineOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recordRef = useRef<HTMLDivElement>(null);

  // the question as typed re-scopes the outline live (rules routing on the server, no model call)
  useEffect(() => {
    const q = question.trim();
    if (q.length < 4) return;
    const t = setTimeout(async () => {
      try { setPreview(await (await fetch(`/api/route?q=${encodeURIComponent(q)}`)).json()); } catch { /* preview is optional */ }
    }, 220);
    return () => clearTimeout(t);
  }, [question]);

  const topLevelOf = useMemo(() => {
    const byId = new Map(outline.map((n) => [n.id, n]));
    return (id: string | null) => {
      let cur = id ? byId.get(id) : undefined;
      while (cur && cur.level > 1) cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      return cur?.id ?? null;
    };
  }, [outline]);

  const done = answers.filter((a): a is { status: "done"; result: AskResult } => a.status === "done").map((a) => a.result);
  const marks: SpineMarks = useMemo(() => {
    const cited = new Map<string, number[]>();
    for (const r of done) for (const c of r.citations) {
      const src = r.sources.find((s) => s.n === c.source);
      const top = topLevelOf(src?.sectionId ?? null);
      if (top) cited.set(top, [...new Set([...(cited.get(top) ?? []), c.n])]);
    }
    const route = done[0]?.route;
    const scopeRegions = done.length ? [...new Set(done.flatMap((r) => r.route.regions))] : preview?.regions ?? [];
    return { scopeRegions, scopeChapter: route?.chapter ?? (done.length ? null : preview?.chapter ?? null), scopeBox: route?.boxId ?? (done.length ? null : preview?.boxId ?? null), cited, open: record.sectionId };
  }, [done, preview, topLevelOf, record.sectionId]);

  const askNow = useCallback(async (q: string) => {
    const text = q.trim();
    if (!text) { inputRef.current?.focus(); return; }
    setQuestion(text);
    const scopes: (Region | undefined)[] = compare ? [pair[0], pair[1]] : [undefined];
    setAnswers(scopes.map(() => ({ status: "loading", question: text })));
    setRecord({ title: null, passages: [], sectionId: null });
    const url = new URL(window.location.href);
    url.searchParams.set("q", text);
    window.history.replaceState(null, "", url);
    await Promise.all(scopes.map(async (scopeRegion, i) => {
      try {
        const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: text, mode: naive ? "naive" : "full", scopeRegion }) });
        const body = await res.json();
        setAnswers((prev) => prev.map((a, j) => (j === i ? (res.ok ? { status: "done", result: body as AskResult } : { status: "error", message: body.error ?? "Something went wrong." }) : a)));
      } catch {
        setAnswers((prev) => prev.map((a, j) => (j === i ? { status: "error", message: "The server did not answer. Is `npm run dev` still running?" } : a)));
      }
    }));
  }, [compare, pair, naive]);

  // ?q= deep links ask on arrival
  useEffect(() => {
    const q = new URL(window.location.href).searchParams.get("q");
    if (!q) return;
    const t = setTimeout(() => void askNow(q), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSource = (r: AskResult, s: Source, pin?: { n: number; span: string }) => {
    if (s.kind === "computed") {
      setRecord({ title: "Computed in code", sectionId: null, passages: [{ id: s.id, headingPath: "Computed from the report's tables and quoted figures", text: s.text, pdfStart: 0, pdfEnd: 0, pageBreaks: [], pinpoint: pin?.span, pinNumber: pin?.n }] });
    } else {
      setRecord({ title: null, sectionId: topLevelOf(s.sectionId), passages: [{ id: s.id, headingPath: s.headingPath ?? `PDF page ${s.pdfStart}`, text: s.text, pdfStart: s.pdfStart, pdfEnd: s.pdfEnd, pageBreaks: s.pageBreaks ?? [], pinpoint: pin?.span, pinNumber: pin?.n }] });
    }
    requestAnimationFrame(() => { if (window.matchMedia("(max-width: 1279px)").matches) recordRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  };
  const openPin = (r: AskResult, n: number) => {
    const c = r.citations.find((x) => x.n === n);
    const s = c && r.sources.find((x) => x.n === c.source);
    if (c && s) openSource(r, s, { n, span: c.span });
  };
  const openSection = async (node: OutlineNode) => {
    setOutlineOpen(false);
    setRecord({ title: node.title, passages: [], sectionId: node.id, loading: true });
    try {
      const res = await fetch(`/api/section?id=${encodeURIComponent(node.id)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setRecord({ title: body.section.path.slice(1).join(" › ") || body.section.path[0], sectionId: node.id, passages: body.passages });
    } catch {
      setRecord({ title: node.title, sectionId: node.id, passages: [{ id: "err", headingPath: node.title, text: "This section could not be read. Check that `npm run ingest` has run.", pdfStart: 0, pdfEnd: 0, pageBreaks: [] }] });
    }
    requestAnimationFrame(() => { if (window.matchMedia("(max-width: 1279px)").matches) recordRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  };

  const idle = answers.every((a) => a.status === "idle");
  const busy = answers.some((a) => a.status === "loading");

  return (
    <div className="grid flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_minmax(360px,420px)]">
      {/* spine */}
      <aside className="border-b border-rule-strong bg-buckram lg:sticky lg:top-14 lg:h-[calc(100dvh-3.5rem)] lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <button type="button" onClick={() => setOutlineOpen((o) => !o)} aria-expanded={outlineOpen} className="flex w-full items-center gap-2 px-4 py-3 text-[14px] font-semibold text-buckram-ink lg:hidden">
          <ListTree className="size-4" aria-hidden /> Outline of the report
        </button>
        <div className={`${outlineOpen ? "block" : "hidden"} lg:block`}>
          <Spine outline={outline} marks={marks} onOpen={openSection} />
        </div>
      </aside>

      {/* the bench: ask and the opinion */}
      <main className="min-w-0 px-4 pb-16 pt-6 md:px-8 lg:pt-8">
        <form
          className="mx-auto flex max-w-[760px] flex-col gap-3"
          onSubmit={(e) => { e.preventDefault(); void askNow(question); }}
        >
          <label htmlFor="q" className="text-[13px] font-semibold text-ink-2">Ask the report</label>
          <div className="flex items-end gap-3 border-b-2 border-rule-strong pb-2 focus-within:border-ink">
            <textarea
              id="q"
              ref={inputRef}
              rows={1}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void askNow(question); } }}
              placeholder="What is the growth outlook for South Asia?"
              className="record min-h-[40px] flex-1 resize-none bg-transparent text-[22px] leading-snug text-ink outline-none placeholder:text-ink-3 [field-sizing:content] max-h-40"
              aria-describedby="scope-preview"
            />
            <button type="submit" disabled={busy} className="flex shrink-0 items-center gap-1.5 bg-rule-strong px-4 py-2 text-[14px] font-semibold text-page hover:bg-ink-2 disabled:cursor-progress disabled:opacity-60">
              {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}
              {busy ? "Reading" : "Ask"}
            </button>
          </div>
          <div id="scope-preview" className="flex min-h-[20px] flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-ink-3">
            <span aria-live="polite">
              {preview?.structuralRefusal ? <span className="text-ink-2">{preview.structuralRefusal}</span>
                : preview && (preview.regions.length || preview.chapter || preview.boxId) ? (
                  <>Will search <span className="font-semibold text-path">{[...preview.regions.map((r) => REGION_LABEL[r]), preview.chapter ? (preview.chapter === "ES" ? "the Executive Summary" : preview.chapter === "SA" ? "the Statistical Appendix" : `Chapter ${preview.chapter}`) : null, preview.boxId ? `Box ${preview.boxId}` : null].filter(Boolean).join(" · ")}</span>{preview.countries.length ? <> (from {preview.countries.map((c) => c.replace(/\b\w/g, (m) => m.toUpperCase())).join(", ")})</> : null}</>
                ) : question.trim().length >= 4 ? "Will search the whole report" : "Name a region, a country, a chapter or a box to narrow the search."}
            </span>
            <span className="ml-auto flex items-center gap-4">
              <label className="flex cursor-pointer items-center gap-1.5 text-ink-2">
                <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="accent-[var(--ink)]" />
                <Columns2 className="size-3.5" aria-hidden /> Compare two regions
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-ink-2" title="1000-character chunks, no routing, no reranker, no scope guard">
                <input type="checkbox" checked={naive} onChange={(e) => setNaive(e.target.checked)} className="accent-[var(--ink)]" />
                Naive baseline
              </label>
            </span>
          </div>
          {compare && (
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
              Ask the same question of
              {[0, 1].map((i) => (
                <select key={i} value={pair[i]} onChange={(e) => setPair((p) => (i === 0 ? [e.target.value as Region, p[1]] : [p[0], e.target.value as Region]))} className="border border-rule bg-page px-2 py-1 text-[13px] text-ink" aria-label={i === 0 ? "First region" : "Second region"}>
                  {REGION_KEYS.map((r) => <option key={r} value={r}>{REGION_LABEL[r]}</option>)}
                </select>
              ))}
              <span className="text-ink-3">— each answer may cite only its own region.</span>
            </div>
          )}
        </form>

        <div className="mx-auto mt-8 max-w-[760px]">
          {idle ? (
            <Docket onAsk={(q) => void askNow(q)} hasKey={hasKey} />
          ) : (
            <div className={answers.length > 1 ? "grid gap-8 md:grid-cols-2" : ""}>
              {answers.map((a, i) => (
                <div key={i} className="min-w-0">
                  {answers.length > 1 && <h2 className="mb-3 border-b border-rule-strong pb-1 text-[13px] font-semibold uppercase tracking-[0.08em] text-path">{REGION_LABEL[pair[i]]}</h2>}
                  {a.status === "loading" && <Reading compare={answers.length > 1} />}
                  {a.status === "error" && <p role="alert" className="record border-y border-rule-strong py-3 text-[17px] leading-snug text-ink"><span className="mr-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-2" style={{ fontFamily: "var(--font-ui)" }}>Not answered.</span>{a.message}</p>}
                  {a.status === "done" && <Opinion r={a.result} compact={answers.length > 1} onPin={(n) => openPin(a.result, n)} onSource={(s) => openSource(a.result, s)} />}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* the record */}
      <aside ref={recordRef} aria-label="Record" className="col-span-full border-t border-rule-strong bg-page xl:col-span-1 xl:sticky xl:top-14 xl:h-[calc(100dvh-3.5rem)] xl:overflow-y-auto xl:border-l xl:border-t-0">
        <RecordPanel passages={record.passages} printed={printed} title={record.title} loading={record.loading} onClose={record.passages.length ? () => setRecord({ title: null, passages: [], sectionId: null }) : undefined} />
      </aside>
    </div>
  );
}

function Docket({ onAsk, hasKey }: { onAsk: (q: string) => void; hasKey: boolean }) {
  return (
    <section aria-label="Questions to try" className="flex flex-col gap-6">
      <div>
        <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3">The assignment&rsquo;s three questions</h2>
        <ol className="border-t border-rule-strong">
          {SAMPLE_QUESTIONS.map((q, i) => (
            <li key={q} className="border-b border-rule">
              <button type="button" onClick={() => onAsk(q)} className="group flex w-full items-baseline gap-4 py-3 text-left hover:bg-page-2">
                <span className="num w-6 shrink-0 text-[13px] font-semibold text-ink-3">{i + 1}.</span>
                <span className="record flex-1 text-[18px] leading-snug text-ink group-hover:underline group-hover:decoration-rule-strong">{q}</span>
                <ArrowRight className="size-4 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-3">Harder ones</h2>
        <ul className="flex flex-col">
          {MORE_QUESTIONS.map((q) => (
            <li key={q}>
              <button type="button" onClick={() => onAsk(q)} className="w-full py-1.5 text-left text-[15px] text-ink-2 hover:text-ink hover:underline">{q}</button>
            </li>
          ))}
        </ul>
        <p className="mt-3 max-w-[62ch] text-[13px] leading-relaxed text-ink-3">The second asks about a country this report files under the Middle East and North Africa, not South Asia; the third needs arithmetic done in code; the last asks for a chapter that does not exist.</p>
      </div>
      {!hasKey && <p className="border-t border-rule pt-3 text-[13px] leading-relaxed text-ink-3">No Gemini API key is set, so the app will route and retrieve but not write answers. START_HERE.md says how to add one.</p>}
    </section>
  );
}

function Reading({ compare }: { compare: boolean }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Reading the report">
      <div className="h-3 w-1/2 bg-rule/70" />
      <div className="h-2.5 w-1/3 bg-page-2" />
      <div className="mt-3 flex flex-col gap-2.5">
        {Array.from({ length: compare ? 5 : 4 }).map((_, i) => <div key={i} className="h-4 bg-page-2" style={{ width: `${96 - i * 9}%` }} />)}
      </div>
      <p className="mt-2 text-[12px] text-ink-3">Routing, searching, reranking, then writing and verifying the answer. This takes a few seconds on the free tier.</p>
    </div>
  );
}
