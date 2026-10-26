"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { locateSpan } from "@/lib/text";
import type { RecordPassage } from "./types";

/**
 * The record: the passage an answer cites, as the report prints it. Guide words at the head name where you are;
 * star-paging (*74) marks where each printed page begins; the pinpoint span is highlighted in the path ink.
 */
/** "Ch. 2 › Middle East… (MNA) › Outlook" → "MNA · Outlook": the guide word names the region, not just a heading every region shares. */
function guideWord(headingPath: string): string {
  const parts = headingPath.split(" › ");
  const region = /\((EAP|ECA|LAC|MNA|SAR|SSA)\)/.exec(headingPath)?.[1];
  const box = /^Box ([\d.]+)/.exec(parts.find((x) => x.startsWith("Box ")) ?? "")?.[1];
  const last = parts[parts.length - 1].replace(/\s*\((EAP|ECA|LAC|MNA|SAR|SSA)\)$/, "");
  const ch = /^Chapter (\d)/.exec(parts[0])?.[1];
  const prefix = region ?? (box ? `Box ${box}` : ch ? `Ch. ${ch}` : parts[0] === last ? null : parts[0]);
  return prefix && prefix !== last ? `${prefix} · ${last}` : last;
}

export function RecordPanel({ passages, printed, title, onClose, loading }: { passages: RecordPassage[]; printed: string[]; title: string | null; onClose?: () => void; loading?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setInView] = useState<number[]>([]);
  // guide words follow the sections in view, recomputed as the reader scrolls the record
  useEffect(() => {
    const root = ref.current?.closest("aside");
    const els = [...(ref.current?.querySelectorAll<HTMLElement>("[data-passage]") ?? [])];
    if (!els.length) return;
    const vis = new Set<number>();
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) { const i = Number((en.target as HTMLElement).dataset.passage); if (en.isIntersecting) vis.add(i); else vis.delete(i); }
      setInView([...vis].sort((a, b) => a - b));
    }, { root: root && root.scrollHeight > root.clientHeight ? root : null, rootMargin: "-60px 0px -15% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [passages]);
  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-5" aria-busy="true">
        <div className="h-3 w-2/3 bg-rule/70" />
        {Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-3 bg-page-2" style={{ width: `${92 - ((i * 13) % 30)}%` }} />)}
      </div>
    );
  }
  if (!passages.length) return <RecordEmpty />;
  const shown = inView.length ? inView : [0];
  const guideLeft = guideWord(passages[shown[0]]?.headingPath ?? passages[0].headingPath);
  const guideRight = guideWord(passages[shown[shown.length - 1]]?.headingPath ?? passages[0].headingPath);
  const label = (p: number) => printed[p - 1] || `PDF ${p}`;
  const pages = (p: RecordPassage) => (p.pdfStart === p.pdfEnd ? `p. ${label(p.pdfStart)}` : `pp. ${label(p.pdfStart)}–${label(p.pdfEnd)}`);

  return (
    <article ref={ref} className="record-enter flex flex-col" aria-label="Record">
      <header className="sticky top-0 z-10 border-b border-rule-strong bg-page px-5 pb-2 pt-3">
        <div className="flex items-baseline justify-between gap-3 text-[12px] font-semibold text-ink-3">
          <span className="running-head truncate text-[14px]">{guideLeft}</span>
          {guideRight !== guideLeft && <span className="running-head truncate text-right text-[14px]">{guideRight}</span>}
          {onClose && (
            <button type="button" onClick={onClose} className="-mr-1 shrink-0 p-1 text-ink-3 hover:text-ink" aria-label="Close the record">
              <X className="size-4" />
            </button>
          )}
        </div>
        {title && <h2 className="mt-1 text-[14px] font-semibold leading-snug text-ink">{title}</h2>}
      </header>
      <div className="flex flex-col gap-6 px-5 py-4">
        {passages.map((p, i) => (
          <section key={p.id} data-passage={i} aria-label={`${p.headingPath}, ${pages(p)}`}>
            <p className="mb-2 text-[12px] leading-snug text-ink-3">
              {p.pinNumber && <span className="mr-1.5 font-semibold text-path">[{p.pinNumber}]</span>}
              {p.headingPath} · <span className="num">{pages(p)}</span>
            </p>
            {p.text.startsWith("Table ") || p.text.includes("\n|") ? <RecordTable text={p.text} pinpoint={p.pinpoint} /> : <RecordProse p={p} label={label} />}
          </section>
        ))}
      </div>
    </article>
  );
}

function RecordProse({ p, label }: { p: RecordPassage; label: (page: number) => string }) {
  const hit = p.pinpoint ? locateSpan(p.text, p.pinpoint) : null;
  // paragraphs keep their offsets so star-paging and the pinpoint land where the text says
  const paras: { start: number; end: number }[] = [];
  let at = 0;
  for (const part of p.text.split("\n\n")) { paras.push({ start: at, end: at + part.length }); at += part.length + 2; }
  return (
    <div className="record flex flex-col gap-3 text-[16px] leading-[1.6] text-ink">
      {paras.map((para, i) => {
        const cuts = new Set<number>([para.start, para.end]);
        const stars = p.pageBreaks.filter((b) => b.offset >= para.start && b.offset < para.end);
        stars.forEach((b) => cuts.add(b.offset));
        if (hit) { if (hit[0] > para.start && hit[0] < para.end) cuts.add(hit[0]); if (hit[1] > para.start && hit[1] < para.end) cuts.add(hit[1]); }
        const points = [...cuts].sort((a, b) => a - b);
        const nodes: ReactNode[] = [];
        for (let k = 0; k < points.length - 1; k++) {
          const s = points[k], e = points[k + 1];
          const star = stars.find((b) => b.offset === s);
          if (star) nodes.push(<span key={`s${s}`} className="star-page" aria-label={`page ${label(star.page)} begins`}>*{label(star.page)}</span>);
          const slice = p.text.slice(s, e);
          const inPin = hit && s >= hit[0] && e <= hit[1];
          nodes.push(inPin ? <mark key={s} className="pinpoint">{slice}</mark> : <span key={s}>{slice}</span>);
        }
        return <p key={i} className="max-w-[68ch]">{nodes}</p>;
      })}
    </div>
  );
}

/** Tables read as tables: caption, header, rows; the row holding the pinpoint is marked. */
function RecordTable({ text, pinpoint }: { text: string; pinpoint?: string }) {
  const lines = text.split("\n");
  const caption = lines[0];
  const rows = lines.filter((l) => l.startsWith("|") && !/^\|[-|\s]+\|$/.test(l)).map((l) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  const notes = lines.filter((l) => !l.startsWith("|") && l !== caption && l.trim()).join(" ");
  const [head, ...body] = rows;
  return (
    <figure>
      <figcaption className="mb-2 text-[13px] font-semibold text-ink">{caption}</figcaption>
      <div className="overflow-x-auto">
        <table className="num w-full border-collapse text-[12px]">
          {head && (
            <thead>
              <tr className="border-b border-rule-strong">{head.map((h, i) => <th key={i} scope="col" className={`py-1 pr-2 align-bottom font-semibold text-ink-2 ${i ? "text-right" : "text-left text-[11px] font-normal italic"}`}>{h}</th>)}</tr>
            </thead>
          )}
          <tbody>
            {body.map((r, i) => {
              const group = /^\*.*\*$/.test(r[0]);
              const pinned = !!pinpoint && !group && !!locateSpan(`| ${r.join(" | ")} |`, pinpoint.replace(/\|/g, " "));
              return (
                <tr key={i} className={`border-b border-rule/70 ${pinned ? "bg-path-soft" : ""}`}>
                  {r.map((c, j) => (
                    <td key={j} className={`py-[3px] pr-2 ${j ? "text-right" : "text-left"} ${group ? "pt-2 text-[11px] italic text-ink-3" : pinned ? "font-semibold text-path-2" : "text-ink"}`}>{c.replace(/^\*|\*$/g, "")}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {notes && <p className="mt-2 text-[11px] leading-snug text-ink-3">{notes}</p>}
    </figure>
  );
}

function RecordEmpty() {
  return (
    <div className="flex flex-col gap-4 px-5 py-6 text-[14px] leading-relaxed text-ink-2">
      <h2 className="text-[15px] font-semibold text-ink">The record</h2>
      <p>Passages open here exactly as the report prints them. Click a pinpoint like <span className="font-semibold text-path">[1]</span> in an answer, or any section on the spine.</p>
      <p className="record text-[15px] leading-[1.6] text-ink">
        Growth in SAR is expected to soften to <mark className="pinpoint">6.3 percent in 2026</mark>, mainly reflecting the adverse impact of the conflict in the Middle East…
      </p>
      <p className="text-[13px] text-ink-3">The highlight is the quoted span the answer relies on. When a passage runs onto the next printed page, a star marker such as <span className="star-page !mx-0">*75</span> shows where that page begins, as in a law reporter.</p>
    </div>
  );
}
