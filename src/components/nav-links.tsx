"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Ask" },
  { href: "/eval", label: "Evaluation" },
  { href: "/how-it-works", label: "How it works" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="ml-auto flex h-full items-stretch">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center whitespace-nowrap border-b-2 px-2 text-[14px] sm:px-3 font-medium transition-colors ${active ? "border-rule-strong text-ink" : "border-transparent text-ink-2 hover:text-ink hover:border-rule"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
