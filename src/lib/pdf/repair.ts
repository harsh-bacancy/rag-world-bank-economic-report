/**
 * Text repair for the extracted lines. pdfjs already gives "The" (the field guide's "Te" came from a
 * different extractor), but the PDF still carries ligature codepoints (ﬁ ﬂ ﬀ ﬃ: ~1,500 of them) and
 * line-break hyphens. Search must see "fiscal", not "ﬁscal", and "advanced", not "ad- vanced".
 */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")                 // ﬁ → fi, ﬂ → fl, ﬀ → ff, ﬃ → ffi
    .replace(/[­]/g, "")           // soft hyphens
    .replace(/[‐‑]/g, "-")    // typographic hyphens → ASCII
    .replace(/\s+/g, " ")
    .trim();
}

/** Words seen in the document, used to decide whether a line-break hyphen is real ("weather-related"). */
export class Vocabulary {
  private readonly hyphenated = new Set<string>();
  private readonly plain = new Set<string>();

  /** Add one extracted line. Its first word may be the tail of a broken word and a final "word-" its head, so both are skipped. */
  add(line: string) {
    const words = line.toLowerCase().match(/[a-z]+(?:-[a-z]+)+-?|[a-z]+-?/g) ?? [];
    words.forEach((w, i) => {
      if (i === 0 || w.endsWith("-")) return;
      if (w.includes("-")) this.hyphenated.add(w);
      else this.plain.add(w);
    });
  }

  /** Join "head-" + "tail…" at a line break. Keep the hyphen only when the document spells the word that way elsewhere. */
  joinHyphen(head: string, tail: string): string {
    const a = /([A-Za-z]+)-$/.exec(head)?.[1]?.toLowerCase() ?? "";
    const b = /^([A-Za-z]+)/.exec(tail)?.[1]?.toLowerCase() ?? "";
    const joined = this.plain.has(`${a}${b}`);
    // "information-" + "processing": two known words whose concatenation never occurs → a real compound
    const compound = a.length >= 3 && b.length >= 3 && this.plain.has(a) && this.plain.has(b);
    const keep = !joined && (this.hyphenated.has(`${a}-${b}`) || compound);
    return keep ? `${head}${tail}` : `${head.slice(0, -1)}${tail}`;
  }
}

/** Append a line to a paragraph, repairing line-break hyphenation. */
export function appendLine(para: string, line: string, vocab: Vocabulary): string {
  if (!para) return line;
  if (/[A-Za-z]-$/.test(para) && /^[a-z]/.test(line)) return vocab.joinHyphen(para, line);
  return `${para} ${line}`;
}

const ABBREV = /\b(?:U\.S|U\.K|e\.g|i\.e|et al|Fig|No|vs|Rep|Fed|Sts|St|Dem|Mr|Ms|Dr|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|approx|cf)\.$/i;

/** Sentence split that survives "U.S.", "e.g.", "Rep." and decimal numbers. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const re = /[.!?]["”’)]?\s+(?=[A-Z“"(0-9•])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].trimEnd().length;
    const candidate = text.slice(start, end);
    if (ABBREV.test(candidate)) continue;
    out.push(candidate.trim());
    start = m.index + m[0].length;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}
