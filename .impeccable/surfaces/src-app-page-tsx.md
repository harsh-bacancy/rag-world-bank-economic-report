---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/app/eval/page.tsx","src/app/how-it-works/page.tsx"]
---

# Surface brief: Navigator (`/`) + `/eval` + `/how-it-works`

Scope: the whole web UI of GEP Navigator. Visitor mode: **Operate** for `/` and `/eval`; **Read** for `/how-it-works`.
Audience and job: RAG-assignment reviewers asking the three sample questions and their own, judging whether answers come from the right chapter/section without mixing regions; secondarily analysts who need a figure with its page. Task states: empty, typing (live scope preview), answering (seconds), answered, refused (gate / structural / model), retrieval-only (no API key), error, compare (two regions).
Constraints: answers are not streamed; one document; desktop-first, mobile must work; WCAG 2.2 AA; no World Bank branding as our own.
Decided without the user (unattended run, user said "do not ask"): direction assigned by the roll, no re-roll; code-led (no image generation available).

## Direction contract

THESIS: An answer is an opinion on the record: a headnote states where the court sat (the routed scope), the holding is short, and every sentence carries a pinpoint citation to a page of the record. Refuses the chat-bubble transcript and the "AI answer card with sources chips" arrangement.

OWN-WORLD: Law-reporter material. White page, engraving-black text in a sturdy serif for record and holdings; workhorse sans for apparatus. The outline rail is the volume's spine in buckram tan with black-and-oxblood spine labels; oxblood is reserved for the answer's path (scope key, pinpoints, cited sections on the outline, highlighted spans) and nothing else. Key-number glyphs mark scope; star-paging (*74) marks printed-page breaks inside passages; hairline rules, no cards, no shadows beyond the panel edge.

STORY: The reader sees the report's anatomy, asks, watches the outline narrow to the scope as they type, gets a holding whose every claim pins to a page, opens the record at the exact span, and trusts the refusal when the record is silent. On `/eval` they see which technique moved which number.

FIRST VIEWPORT: Left 280px buckram spine: report title, chapters with region key codes and printed page numbers. Centre column (max 720px): the ask field across the top at headline scale with the three sample questions beneath as docket lines; below, the headnote + holding + authorities. Right: the record panel (420px) showing the cited passage with guide words, star-paging and the highlighted span. Primary action: Ask (Enter).

FORM: Court-reporter opinion page with headnotes, key numbers, star-paging and pinpoint citation, position 4 of the ordered list; seed key 2d2ae0e1. Raises — from orienteering map: one ink reserved for the active path over a fixed outline. From lexicon: guide words at the record panel head naming the first and last section in view. From type specimen: the question as typed re-scopes the whole outline live. From doujin catalog: every pinpoint deep-links outline and record together. From bitmap specimen: naive vs full shown as an honest state, not hidden.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
