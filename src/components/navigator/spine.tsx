"use client";

import { KeyRound } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ChapterKey, Region } from "@/lib/pdf/types";
import { CHAPTER_SHORT, type OutlineNode } from "./types";

const ORDER: ChapterKey[] = ["ES", "1", "2", "3", "4", "SA"];
const CHAPTER_TITLE: Record<string, string> = {
  ES: "Executive Summary", "1": "Global Outlook", "2": "Regional Outlooks", "3": "Sovereign Debt Levels and Interest Rates in EMDEs", "4": "Fiscal Policy and Commodity Price Swings", SA: "Statistical Appendix",
};

export interface SpineMarks {
  scopeRegions: Region[];
  scopeChapter: ChapterKey | null;
  scopeBox: string | null;
  cited: Map<string, number[]>;   // top-level section id → pinpoint numbers
  open: string | null;            // section id open in the record
}

/**
 * The volume's spine: chapters as black-and-gilt spine labels, their sections below with printed pages.
 * Oxblood marks only the answer's path: the routed scope (a key) and the sections an answer cites (pinpoints).
 */
export function Spine({ outline, marks, onOpen }: { outline: OutlineNode[]; marks: SpineMarks; onOpen: (node: OutlineNode) => void }) {
  const roots = new Map<ChapterKey, OutlineNode>();
  for (const n of outline) if (n.level === 0 && ORDER.includes(n.chapter) && !roots.has(n.chapter)) roots.set(n.chapter, n);
  const children = (id: string) => outline.filter((n) => n.parentId === id && n.kind !== "references");
  const ref = useRef<HTMLElement>(null);
  const scopeKey = `${marks.scopeRegions.join()}|${marks.scopeChapter}|${marks.scopeBox}`;
  // bring the scope into view when it changes, so the key is never hidden below the fold
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>("[data-scoped]");
    const box = ref.current?.closest("aside");
    if (!el || !box || box.scrollHeight <= box.clientHeight) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTo({ top: Math.max(0, top - box.clientHeight / 2), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [scopeKey]);

  return (
    <nav ref={ref} aria-label="Report outline" className="spine flex flex-col gap-4 px-3 pb-8 pt-4">
      <div className="px-1">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-buckram-ink-2">Global Economic Prospects</p>
        <p className="text-[13px] text-buckram-ink">June 2026 · 200 pages</p>
      </div>
      {ORDER.map((ch) => {
        const root = roots.get(ch);
        if (!root) return null;
        const inScope = marks.scopeChapter === ch;
        const kids = children(root.id);
        return (
          <section key={ch} aria-label={`${CHAPTER_SHORT[ch]}: ${CHAPTER_TITLE[ch]}`}>
            <button
              type="button"
              data-scoped={inScope ? "" : undefined}
              onClick={() => onOpen(root)}
              className={`spine-mark group flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left ${inScope ? "bg-path text-gilt" : "bg-label text-gilt hover:bg-[#2b2620]"}`}
            >
              {inScope && <KeyRound aria-label="In scope" className="size-3.5 shrink-0 translate-y-[1px]" strokeWidth={2.25} />}
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] opacity-90">{ch === "ES" || ch === "SA" ? "" : `Ch. ${ch}`}</span>
              <span className="min-w-0 flex-1 text-[13px] font-semibold leading-snug">{CHAPTER_TITLE[ch]}</span>
              <span className="num text-[12px] opacity-80">{root.printedStart}</span>
            </button>
            {kids.length > 0 && (
              <ul className="mt-1">
                {kids.map((k) => {
                  const scoped = (k.region && marks.scopeRegions.includes(k.region)) || (k.boxId && marks.scopeBox === k.boxId);
                  const pins = marks.cited.get(k.id) ?? [];
                  const open = marks.open === k.id;
                  return (
                    <li key={k.id}>
                      <button
                        type="button"
                        onClick={() => onOpen(k)}
                        data-scoped={scoped ? "" : undefined}
                        aria-current={open ? "true" : undefined}
                        className={`spine-mark flex w-full items-baseline gap-2 py-[5px] pl-2.5 pr-2 text-left text-[13px] leading-snug ${open ? "bg-buckram-2" : "hover:bg-buckram-2/70"} ${scoped ? "font-semibold text-path-2" : "text-buckram-ink"}`}
                      >
                        <span className="w-3.5 shrink-0">{scoped && <KeyRound aria-label="In scope" className="size-3 translate-y-[1px]" strokeWidth={2.5} />}</span>
                        <span className="min-w-0 flex-1">
                          {k.boxId ? `Box ${k.boxId}: ${k.title.replace(/^Box [\d.]+:\s*/, "")}` : k.title}
                          {k.region && <span className={`ml-1.5 text-[11px] font-semibold tracking-[0.06em] ${scoped ? "text-path-2" : "text-buckram-ink-2"}`}>{k.region}</span>}
                        </span>
                        {pins.length > 0 && (
                          <span className="num shrink-0 text-[11px] font-semibold text-path-2" aria-label={`Cited by pinpoint${pins.length > 1 ? "s" : ""} ${pins.join(", ")}`}>
                            {pins.map((n) => `[${n}]`).join("")}
                          </span>
                        )}
                        <span className={`num shrink-0 text-[12px] ${open ? "text-buckram-ink" : "text-buckram-ink-2"}`}>{k.printedStart}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </nav>
  );
}
