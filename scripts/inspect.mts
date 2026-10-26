/**
 * Look at what the parser recovered, without any model calls.
 *   npm run inspect -- --outline            section tree with kinds, regions, boxes and page ranges
 *   npm run inspect -- --page 96            blocks on one PDF page
 *   npm run inspect -- --tables [id]        rebuilt tables (all, or one id like 2.9)
 *   npm run inspect -- --fonts              font/size census
 *   npm run inspect -- --lines 96           raw lines with font and position
 *   npm run inspect -- --stats              counts and warnings
 */
import { loadExtracted } from "@/lib/pdf/cache";
import { buildLines } from "@/lib/pdf/lines";
import { buildDocModel, classify } from "@/lib/pdf/structure";
import { printedLabel } from "@/lib/pdf/types";

const args = process.argv.slice(2);
const flag = (f: string) => args.indexOf(f);
const ex = await loadExtracted();
const doc = buildDocModel(ex);

if (flag("--outline") >= 0) {
  for (const s of doc.sections) {
    const n = doc.blocks.filter((b) => b.sectionId === s.id).length;
    const tags = [s.kind, s.region, s.boxId && `box ${s.boxId}`].filter(Boolean).join(" ");
    console.log(`${"  ".repeat(s.level)}${s.title}  [${tags}] pp.${printedLabel(doc, s.pdfStart)}–${printedLabel(doc, s.pdfEnd)} (PDF ${s.pdfStart}–${s.pdfEnd}) · ${n} blocks`);
  }
}
if (flag("--page") >= 0) {
  const p = Number(args[flag("--page") + 1]);
  for (const b of doc.blocks.filter((b) => b.pdfStart <= p && b.pdfEnd >= p)) {
    const s = doc.sections.find((x) => x.id === b.sectionId)!;
    console.log(`--- ${b.id} ${b.type} · ${s.path.join(" › ")} [${s.kind}${s.region ? ` ${s.region}` : ""}${s.boxId ? ` box ${s.boxId}` : ""}] PDF ${b.pdfStart}-${b.pdfEnd}`);
    console.log(b.text.slice(0, Number(process.env.CHARS ?? 1200)));
  }
}
if (flag("--tables") >= 0) {
  const id = args[flag("--tables") + 1];
  for (const b of doc.blocks.filter((b) => b.type === "table" && (!id || id.startsWith("--") || b.table?.id === id))) {
    console.log(`\n=== ${b.caption} (PDF ${b.pdfStart}) rows=${b.table?.rows.length ?? 0} cols=${(b.table?.columns ?? []).map((c) => (c.isRevision ? "Δ" : "") + c.label).join(",")}`);
    if (id && !id.startsWith("--")) console.log(b.text);
  }
}
if (flag("--lines") >= 0) {
  const p = Number(args[flag("--lines") + 1]);
  for (const l of buildLines(ex.pages[p - 1])) console.log(`${classify(l).padEnd(9)} ${l.font.padEnd(24)} ${String(l.size).padStart(4)} x${Math.round(l.x0)} y${Math.round(l.y)} | ${l.text.slice(0, 100)}`);
}
if (flag("--fonts") >= 0) {
  const m = new Map<string, number>();
  for (const pg of ex.pages) for (const l of buildLines(pg)) m.set(`${l.font} ${l.size} → ${classify(l)}`, (m.get(`${l.font} ${l.size} → ${classify(l)}`) ?? 0) + l.text.length);
  for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50)) console.log(String(v).padStart(8), k);
}
if (flag("--stats") >= 0 || args.length === 0) {
  const by = (k: string) => doc.blocks.filter((b) => b.type === k).length;
  console.log({ pages: doc.pageCount, sections: doc.sections.length, paragraphs: by("paragraph"), footnotes: by("footnote"), figures: by("figure"), tables: by("table"), warnings: doc.warnings });
}
