import Link from "next/link";
import { NavLinks } from "./nav-links";

/** The volume's title strip: product name, the source it reads, and the three surfaces. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-rule-strong bg-page">
      <div className="flex h-14 items-center gap-6 px-4 md:px-6">
        <Link href="/" className="flex items-baseline gap-3 whitespace-nowrap">
          <span className="text-[17px] font-bold tracking-[-0.01em] text-ink">GEP Navigator</span>
          <span className="hidden text-[13px] text-ink-3 lg:inline">
            reads <cite className="not-italic text-ink-2">Global Economic Prospects, June 2026</cite> · World Bank
          </span>
        </Link>
        <NavLinks />
      </div>
    </header>
  );
}
