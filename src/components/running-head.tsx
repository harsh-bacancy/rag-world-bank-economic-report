"use client";

import { useEffect, useState } from "react";

/**
 * The reporter's running head: guide words naming the first and last section in view, recomputed as the
 * reader scrolls. Sections opt in with a `data-guide="…"` attribute.
 */
export function RunningHead({ title }: { title: string }) {
  const [words, setWords] = useState<[string, string] | null>(null);
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>("[data-guide]")];
    if (!els.length) return;
    const visible = new Set<HTMLElement>();
    const update = () => {
      const inView = els.filter((e) => visible.has(e));
      const list = inView.length ? inView : [els[0]];
      setWords([list[0].dataset.guide!, list[list.length - 1].dataset.guide!]);
    };
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) visible.add(en.target as HTMLElement);
        else visible.delete(en.target as HTMLElement);
      }
      update();
    }, { rootMargin: "-96px 0px -20% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return (
    <div className="running-head sticky top-14 z-20 border-b border-rule bg-page">
      <div className="mx-auto flex h-8 w-full max-w-[1120px] items-center justify-between gap-4 px-4 text-[12px] text-ink-3 md:px-8">
        <span className="truncate">{words?.[0] ?? title}</span>
        <span className="hidden truncate sm:inline">{title}</span>
        <span className="truncate text-right">{words && words[1] !== words[0] ? words[1] : ""}</span>
      </div>
    </div>
  );
}
