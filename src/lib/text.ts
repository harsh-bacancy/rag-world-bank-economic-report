/** Typographic variants a model may "normalise" when it copies a quote: fold them on both sides. */
const FOLD: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "−": "-", " ": " " };

/**
 * Case- and whitespace-insensitive substring locate (reused from rag-chatbot, plus quote/dash folding).
 * Returns [start, end] offsets into the raw `text`, or null when the span is not present verbatim.
 * This is the rule the citation verifier applies: no match, no citation.
 */
export function locateSpan(text: string, span: string): [number, number] | null {
  // Markdown emphasis (**bold**, _em_, `code`) is decoration, not content: skip it on both sides.
  // Table pipes read as whitespace so a quote copied from a table row matches with or without them.
  const skip = /[*_`]/;
  const ws = /[\s|]/;
  const map: number[] = [];
  let norm = "";
  let lastWs = false;
  for (let i = 0; i < text.length; i++) {
    const ch = FOLD[text[i]] ?? text[i];
    if (skip.test(ch)) continue;
    if (ws.test(ch)) {
      if (!lastWs) { norm += " "; map.push(i); }
      lastWs = true;
    } else {
      norm += ch.toLowerCase(); map.push(i); lastWs = false;
    }
  }
  const needle = [...span].map((c) => FOLD[c] ?? c).join("").replace(/[*_`]/g, "").replace(/[\s|]+/g, " ").trim().toLowerCase();
  if (!needle) return null;
  const at = norm.indexOf(needle);
  if (at < 0) return null;
  const start = map[at];
  const endIdx = at + needle.length - 1;
  const end = map[Math.min(endIdx, map.length - 1)] + 1;
  return [start, end];
}
