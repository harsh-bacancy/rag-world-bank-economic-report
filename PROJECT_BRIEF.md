# World Bank GEP RAG — Project Brief

Reference project: `../rag-chatbot` (Travel Packet Assistant). Reference reading: *Advanced RAG Field Guide*, chapter 2 "Long, structured".
Source: `data/source/GEP-Jun-2026.pdf`. *Global Economic Prospects, June 2026*, World Bank Prospects Group. 200 pages, letter size, 4.7 MB, sha256 `26b979eb…0629f`.

---

## 1. Definition

A question-answering system over **one long, structured report**. The work is navigation: before answering, the system has to know **where a passage lives** (chapter › section › subsection, box, table, figure, annex) and keep facts from one region or chapter out of answers about another.

All six regions in Chapter 2 use the same template ("Recent developments", "Outlook", a forecast-summary table, an economy-forecasts table) and the same vocabulary ("growth is expected to soften to X percent in 2026"). Word overlap cannot tell them apart. Only location can.

The document is public, so no synthetic sources are needed. It has no PII.

### What the PDF actually looks like (inspected 2026-10-25)

| Part | PDF pages | Printed pages | Notes |
|---|---|---|---|
| Cover, Summary of Contents, Contents, lists of boxes/figures/tables | 1–14 | i–xii | Contents has the full 3-level outline with printed page numbers |
| Acknowledgments, Foreword | 15–18 | xiii–xvi | The Foreword repeats headline numbers ("a meager 2.5 percent") |
| **Executive Summary** | 19–20 | xvii–xviii | One section; one paragraph per chapter, plus risks and policy |
| Abbreviations (+ blank p. 22) | 21–22 | xix–xx | |
| **Ch. 1 Global Outlook** | 23–68 | 1–46 | Italic chapter Summary; Box 1.1 (AI), Box 1.2 (private investment); Table 1.1 Real GDP; Risks to the outlook; Policy challenges; References |
| **Ch. 2 Regional Outlooks** | 69–106 | 47–84 | Cross-region overview (Regional developments / Outlook / Risks, pp. 49–52); Box 2.1 LICs; then EAP 59, ECA 62, LAC 66, MNA 70, SAR 74, SSA 77, each with 2 tables (2.1–2.12); References |
| **Ch. 3 Sovereign Debt Levels and Interest Rates in EMDEs** | 107–142 | 85–120 | Box 3.1 hidden debt; Annexes 3.1–3.2; regression tables A3.1–A3.4; References |
| **Ch. 4 Fiscal Policy and Commodity Price Swings** | 143–184 | 121–162 | Annexes 4.1–4.3; Table 4.1; References |
| **Statistical Appendix** | 185–190 | 163–168 | Real GDP growth by country: annual 2023–2028f plus quarterly columns |
| Data and Forecast Conventions, Selected Topics, other publications | 191–197 | 169–175 | Mostly bibliography: noise for retrieval |
| Blank pages, back cover | 14, 22, 186, 198–200 | n/a | The back cover **restates the Executive Summary**, a near-duplicate |

Typography matches the field guide. Body text is AGaramondPro 11 pt; chapter-summary text is Garamond Italic 11. Section headings are HelveticaLTStd-Bold 16 ("South Asia", "Summary"). Subsections are HelveticaLTStd-Roman 11 ("Recent developments", "Outlook"). Captions are HelveticaLTStd-Bold 10 ("TABLE 2.9", "FIGURE 2.7"). Chart and table text is Helvetica at 4.6–7.6 pt. Running heads are HelveticaLTStd-Light 7.

### The three sample questions and where they are answered

| Question | Where | Must not be confused with |
|---|---|---|
| What is the growth outlook for South Asia? | Ch. 2 › South Asia › Outlook, p. 74 (PDF 96): "Growth in SAR is expected to soften to 6.3 percent in 2026…", with Table 2.9 on p. 76 | The other five regions' Outlook sections; Ch. 2's cross-region overview; the MNA section (Pakistan is in MNA here, not SAR) |
| What does Chapter 3 say about sovereign debt in developing economies? | Ch. 3 summary/introduction, pp. 85–90, plus the Ch. 3 paragraph in the Executive Summary | Ch. 4's public-debt sections (commodity exporters); Ch. 1 "EMDE fiscal policy challenges" |
| According to the executive summary, what are the main risks to the global outlook? | Executive Summary, p. xvii (PDF 19): "Risks to the outlook remain skewed to the downside…" | Ch. 1 "Risks to the outlook" (p. 30, much longer); Ch. 2 regional Risks; the back-cover blurb |

### Pass/fail bar

For every answerable golden question:

1. **Right place:** a chunk from the expected chapter + section is retrieved in the top 5. It counts only if it is that section; the right page alone is not enough.
2. **Right facts:** the answer has the expected figures and claims (judge-graded against a human-written expected answer).
3. **No mixing:** every citation comes from the expected chapter/section/region. One cited fact from another region or chapter fails the question, even if the rest is right.
4. **Verified citations:** each quoted span appears verbatim in its chunk, and its printed page number is correct.

For each refusal question, the system refuses and states no facts.

Proposed targets, to be confirmed in the plan: section hit@5 ≥ 0.95 · section MRR ≥ 0.80 · **mix-up rate = 0** · correctness ≥ 0.90 · citation precision ≥ 0.95 · refusal accuracy ≥ 0.90. Bar to beat: the field guide reached MRR 0.26 naive, 0.76 advanced and 0.88 with parents on 13 questions, using bge-small embeddings.

---

### Why naive RAG fails on this document: failure → cause → fix

| # | Failure | Cause (seen in this PDF) | Fix |
|---|---|---|---|
| 1 | Words that should match don't ("ﬁscal" vs "fiscal") | ~1,500 ligature codepoints (ﬁ 934, ﬂ 249, ﬀ 282, ﬃ 34); some extractors render drop caps as garbage ("7T_he", or the guide's "Te") | Normalise with NFKC; repair drop caps; test on known sentences |
| 2 | Compound words get glued ("weatherrelated") | Line-break hyphens dropped during extraction | Rejoin hyphenated line breaks using a word list; keep real compounds' hyphens |
| 3 | Sentences from two columns are interleaved | Two-column pages; layout-preserving extraction reads straight across | Prose in column order; tables in layout mode. **Different extraction per element type** |
| 4 | Every chunk carries "CHAPTER 2 GLOBAL ECONOMIC PROSPECTS \| JUNE 2026 76" | Running heads and folios on every page | Strip by font (Helvetica-Light 7) and position |
| 5 | The right page is retrieved but it's only table fragments | 1000-character chunks cut through tables and chart labels (the guide's "about 4 percent" vs 6.3% failure) | Section-aware chunks; tables as their own elements, linearized ("EMDE SAR, GDP: 2026f 6.3; revision from Jan 2026: 0.1") |
| 6 | The system doesn't know which chapter or region a chunk belongs to | No structure in plain text; the PDF bookmarks are shallow and messy (MNA split across two entries, ECA/LAC out of order, no subsections) | Rebuild the outline from fonts and check it against the Contents pages. Every chunk stores chapter, section, subsection, region, box, kind and printed page |
| 7 | "South Asia" doesn't match a passage that says "SAR" | The regional text uses acronyms (SAR, MNA, EAP, ECA, LAC, SSA, EMDEs, LICs) | Embed the heading path with the text (the stored text stays verbatim); expand acronyms in the rewrite |
| 8 | Facts from the wrong region | All six regions share a template and vocabulary; the Ch. 2 overview mentions every region on one page | Query understanding turns a region named directly, by acronym, or through a country ("India", "the region that includes Pakistan") into a **filter**; plus a region guard in the verifier |
| 9 | A wrong filter hides the answer | An LLM guessing "Chapter 4" from a question's topic (field guide lesson) | Set a chapter filter only when the question says "Chapter N"; widen to the whole report if a filter returns fewer than 3 hits |
| 10 | A small chunk matches but lacks context; a big chunk matches poorly | One chunk size can't serve both search and answering | Search ~280-token children; give the model their ~900-token parent window, kept inside one section |
| 11 | "Executive summary" questions get answered from Ch. 1 or the back cover | Same claims repeated in the Executive Summary, chapter Summaries, Foreword and back cover | `kind` metadata (executive_summary · chapter_summary · foreword · body · box · table · figure · annex · references · back_matter); an executive-summary filter; back cover and Foreword excluded or down-weighted |
| 12 | Wrong year or wrong column read from a table | Revision columns (percentage-point changes from January 2026) sit next to levels; fiscal-year rows switch their column years mid-table (India 2026/27 vs Bangladesh 2025/26); footnote digits are glued to names ("Myanmar 3 4") | Rebuild tables with column headers that follow row-group header switches; mark revision columns; strip footnote markers into a `notes` field |
| 13 | Retrieval noise from charts, references and bibliography | Axis labels (5.7 pt), ~40 pages of references and "Selected Topics" lists | Chart chunk = caption + panel titles + note only; References / Selected Topics stored as `kind=references` and excluded by default |
| 14 | The model does arithmetic ("how much lower than in 2025?") and gets it wrong | Language models make arithmetic mistakes (rag-chatbot X07: €426 + €236 = "€680") | Differences and sums computed in TypeScript from table cells and handed to the model as a citable source |
| 15 | Confident answer for something the report doesn't contain (e.g. 2029 forecasts, a Chapter 5) | No refusal gate | Rerank-score gate with no LLM call; structural refusals (a chapter number that doesn't exist, a year outside the table range); the verifier turns an answer with nothing verified into a refusal |
| 16 | Citation says "page 96" while the reader sees "74" | Printed page numbers ≠ PDF page index (offset 22 for chapters; roman numerals in front matter) | Store both; display printed numbers; the source view opens the PDF at the right index |

---

## 2. Requirements

### Functional
- **F1 Extract:** read the PDF locally with each text run's font, size and position. No LLM parsing of 200 pages.
- **F2 Repair:** ligatures, drop caps, hyphenation, running heads/footers, blank pages, column reading order.
- **F3 Structure:** build an outline tree (front matter › Executive Summary › Chapter › section › subsection; boxes, figures, tables, annexes, references, Statistical Appendix) from typography, checked against the Contents pages. Tag each node with `chapter_no`, `region` (one of six, or none), `box_id`, `kind`, and printed + PDF page range. Fail ingest loudly if the outline doesn't match the Contents.
- **F4 Tables:** rebuild every table (~22 main and annex tables + the 4-page Statistical Appendix) with row and column headers (estimate/forecast flags, revision columns, fiscal-year row groups, footnotes split out). Store a structured cell table for computed answers, plus a linearized version for retrieval only.
- **F5 Figures:** one chunk per figure (caption, panel titles, source and note). Values that appear only in a chart are not answerable (see Out of scope).
- **F6 Chunking:** section-aware parent/child hierarchy that never crosses a section boundary. The heading path is embedded with each child; the verbatim text is what citations check against.
- **F7 Query understanding:** one structured call (rules first, LLM second) returns region / chapter / executive-summary / box flags and a rewrite in the report's vocabulary. Names come from closed lists; unknown values are dropped. Includes a country → region map that follows this report's groupings (Pakistan and Afghanistan → MNA).
- **F8 Retrieval:** hybrid (pgvector cosine + tsvector BM25 → RRF in SQL) inside metadata filters, widening when a filter returns fewer than 3 hits; cross-encoder rerank (A/B tested); children swapped for parents.
- **F9 Context management:** dedupe parents, keep a token budget, group context by section with the heading path shown, and label each source with its region/chapter so the model can see the boundaries.
- **F10 Answering:** `[^n]` citations with quoted spans; the verifier drops any quote not verbatim in its chunk; a region/chapter guard drops citations from outside the routed scope; arithmetic from code as a citable "Computed" source; refusal as a first-class answer with no LLM call below the threshold.
- **F11 Terminal first:** `npm run ingest`, `npm run ask -- "q" [--naive] [--trace]`, `npm run eval -- [--mode both|full|naive] [--ids …] [--resume]`.
- **F12 Web:** an ask surface with answers whose citations show the section path and printed page and open the source at that span; an `/eval` page comparing naive and full on every metric, with an ablation ladder (which technique moved which number).
- **F13 Golden set:** 40–60 questions in `data/golden/`, written **before** pipeline code (lookup, reasoning, cross-section, arithmetic, ~8 refusals). Each has the expected answer, chapter/section/page and the exact numbers.

### Non-functional
- **$0:** Gemini free tier (3.5-flash-lite → 3.1-flash-lite) behind the single limiter; one Gemini process at a time.
- **Gemini budget:** ingest uses only embeddings (~700 children ≈ 8 batched calls) plus optional table/figure repair. A full two-mode eval stays under one model's 500-request day. Everything is cached by content hash.
- **Determinism:** temperature 0; the same PDF hash gives the same chunks and IDs; re-ingest from cache costs 0 calls.
- **Latency:** full-mode answers under ~15 s median (rag-chatbot was 25 s; parent context and one rewrite call should be cheaper than its multi-rewrite rerank).
- **Traceability:** every answer stores its route (filters, rewrite, widened or not), candidates with RRF and rerank scores, and parents used.
- **Quality gate per phase:** `npm run lint && npx tsc --noEmit && npm test`. Unit tests for repair, outline, table rebuild, chunk boundaries, routing, the verifier and the region guard.
- **Containment:** all changes inside this folder; dependencies installed locally only; nothing global.

### Out of scope
- Values that appear **only in charts** (no vision pass; the field guide needed vision only for the iMac report). A question that needs one is a refusal, or answered from the text that states it.
- Other GEP editions, live data, comparisons with the IMF or others, forecasts beyond 2028.
- OCR (the PDF has a full text layer), multi-document corpora, user uploads, auth.
- Economic advice or opinion beyond what the report states.

### Inputs still needed
1. **Gemini key and quota sharing:** the sibling projects (GPO, iMac) may use the same key. The free tier's per-model daily cap is shared, but each project's limiter file only sees its own calls. Decide: a separate key, or a shared quota file.
2. **Supabase:** a new project, or new tables in rag-chatbot's project (a separate schema).
3. **Golden-set review:** I'll draft the questions and expected answers from the PDF; you review them before the first eval run, as on rag-chatbot.
4. **Product angle and build approach:** step 3 (five ideas).

---

## 3. Five ways to build it

### Idea 1: Section-aware pipeline (rag-chatbot, extended)
The rag-chatbot retrieval path (hybrid RRF → bge rerank → refusal gate → verified `[^n]` citations), with a new front half: font-aware extraction, text repair, an outline rebuilt from typography, parent/child chunks with full location metadata, rule-based routing into metadata filters, and parent expansion.
- **Pros:** reuses ~60% of proven code (limiter, verifier, reranker, eval runner); every field-guide technique has a slot; the ablation ladder falls out naturally; cheap on the Gemini budget.
- **Cons:** the extraction and outline work is custom to this PDF's typography (the idea transfers, the thresholds don't); no product story beyond "Q&A".

### Idea 2: "GEP Navigator", the report's table of contents as the interface (original product angle)
Same engine as Idea 1, but the product is built around **where** an answer comes from. The left rail is the report's outline. Every answer lights up the sections it used, shows the routed scope ("searched: Ch. 2 › South Asia"), and flags other places the topic appears ("also discussed in: Ch. 1 › Risks"). A **Compare** mode answers one question for two regions side by side, each scoped to its own section, so mixing is impossible by construction. A citation opens the section text at the quoted span with its printed page.
- **Pros:** makes the pass/fail bar (right chapter, no mixing) **visible** to a reviewer; Compare turns the hardest failure (cross-region contamination) into a feature; little extra backend.
- **Cons:** more UI work; Compare costs two generation calls.

### Idea 3: Table-first fact ledger + prose RAG
Rebuild all ~22 forecast tables and the Statistical Appendix into a `facts` table (entity, series, year, value, revision, table, page). Numeric questions ("India's FY2026/27 forecast", "how much was SSA revised?") are answered by lookup and arithmetic in code, cited to the table row. Prose questions go to RAG.
- **Pros:** numbers can't be hallucinated; arithmetic is exact; "Computed, not recalled" taken all the way.
- **Cons:** table rebuilding from positions is the riskiest code; it needs a question classifier; many golden questions are qualitative.

### Idea 4: Structure-routed long context (no vectors)
An LLM reads the outline, picks 1–3 sections, and the whole sections (≤ 30k tokens) go to Gemini with instructions to quote.
- **Pros:** tiny codebase; whole-section context answers "what does Chapter 3 say" well.
- **Cons:** throws away the retrieval work the assignment asks to explore; large prompts hit the free tier's tokens-per-minute limits; nothing to show in a hit-rate / MRR ladder; citations are harder to verify at scale.

### Idea 5: Agentic analyst
The model gets tools (`toc()`, `open_section(id)`, `search(q, filters)`, `read_table(id)`) and navigates like a human analyst, iterating until it has evidence.
- **Pros:** handles multi-hop and cross-section questions elegantly; impressive in a demo.
- **Cons:** 4–10 calls per question kills a 500-request day (a 2-mode eval of 50 questions would take ~4 days); non-deterministic; hard to evaluate fairly against naive.

### Recommendation (chosen, per "choose the best recommended")
**Idea 1 as the engine + Idea 2 as the product + Idea 3's ledger used narrowly as the computed source.** Idea 1 delivers the field-guide ladder and reuses rag-chatbot. Idea 2 is the original angle and shows the pass/fail bar on screen. Idea 3 contributes only the part that is cheap and high-value: forecast-table cells as structured rows, so differences and revisions are computed in code. Ideas 4 and 5 are rejected (see `docs/PLAN.md` → Deliberately rejected).
