# GEP Navigator — Plan

RAG over the World Bank's *Global Economic Prospects, June 2026* (200 pages). Brief: `PROJECT_BRIEF.md`. Reference project: `../rag-chatbot`.

## Locked decisions (2026-10-25; chosen autonomously at the user's request, "choose the best recommended")

| # | Decision | Why |
|---|---|---|
| D1 | **Idea 1 engine + Idea 2 product ("GEP Navigator") + Idea 3 ledger as the computed source** | Field-guide ladder + rag-chatbot reuse; the outline-as-interface shows the pass/fail bar; table cells give exact arithmetic |
| D2 | **Real public PDF**, no synthetic documents | Public World Bank publication (CC BY 3.0 IGO), no PII |
| D3 | **Local, font-aware extraction with `pdfjs-dist`** (in-project); no LLM parsing | 200 pages would cost a large share of the 500/day quota and drift; fonts carry the structure |
| D4 | **Two stores behind one interface:** `local` (JSON index under `data/index/`, BM25 + cosine + RRF in TypeScript) is the default; `supabase` (pgvector HNSW + tsvector GIN + RRF in SQL, `supabase/migrations/0001_init.sql`) when `STORE=supabase` | The pipeline runs end-to-end with zero setup; Supabase is one env var away. The same RRF formula (k = 50) in both |
| D5 | `gemini-embedding-001` @ 768d, cached per chunk hash under `.cache/embed/` | Default stack. Without a key, the dense channel switches off and every report says so |
| D6 | **Parent/child chunks inside one section:** children ~280 tokens (40-token overlap) are searched; parents ~900 tokens are what the model reads. Tables and figures are their own elements | Field guide: parents took MRR 0.76 → 0.88 |
| D7 | **Heading path embedded** with each child ("Chapter 2: Regional Outlooks › South Asia › Outlook"); the stored text stays verbatim | Recovers "SAR" ↔ "South Asia"; citations still verify against the raw text |
| D8 | **Routing: rules first, LLM optional** (`--route llm`). Closed lists for regions, chapters, boxes and countries; chapter only when the question says "Chapter N"; widen if a filter returns fewer than 3 hits | Field guide: rules tie the LLM on region-named questions and cost 0 calls; the LLM wins on country-only questions, so countries go into the rule map too |
| D9 | `bge-reranker-v2-m3` ONNX q8, in-process, **A/B tested** (`--no-rerank`) | Biggest single jump on this report in the guide; it hurt tables on the iMac report, so we measure |
| D10 | Generation: `gemini-3.5-flash-lite` → `3.1-flash-lite`, through the single limiter | 500/day per model on a new key |
| D11 | **Region/chapter guard** in the verifier: a citation whose chunk lies outside the routed scope is stripped and counted, like a non-verbatim quote | Turns the pass/fail bar ("did not mix") into code |
| D12 | **Computed source** from table cells: forecast, revision, differences between years/regions, computed in TypeScript and cited to the table row | "Computed, not recalled" |
| D13 | **Refusal gate** on the top rerank score (no LLM call), plus structural refusals (Chapter > 4, forecast year > 2028, a box that doesn't exist) | Refusal is a first-class answer |
| D14 | Printed page numbers in citations; PDF index kept for the viewer | What a reader sees |

## $0 stack

| Layer | Choice | Cost |
|---|---|---|
| App | Next.js 16.3 App Router · TS · Tailwind v4 · shadcn/ui (base-nova) · Vercel AI SDK 7 | free |
| Extraction | `pdfjs-dist` 5 (legacy build, Node), font name + size + position per run | free |
| Repair / structure / tables | Pure TypeScript (`src/lib/pdf/*`) | free |
| Embeddings | `gemini-embedding-001` @ 768d | free tier |
| Store | Local JSON index (default) · Supabase Postgres + pgvector + tsvector (optional) | free |
| Keyword search | BM25 in TS (local) · `ts_rank_cd` (Supabase) | free |
| Rerank | `onnx-community/bge-reranker-v2-m3-ONNX` q8 via `@huggingface/transformers` | free |
| Routing / rewrite / generate / judge | `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` | free tier, 500/day per model |
| Eval | Retrieval ladder (no LLM calls with rules routing) + answer eval with a Gemini judge anchored on human expected answers | free |

## Schema

```
sections   id, parent_id, level, kind, title, path, chapter_no, region, box_id,
           pdf_start, pdf_end, printed_start, printed_end, ord
parents    id, section_id, text, pdf_start, pdf_end, printed_start, printed_end, token_count
chunks     id, parent_id, section_id, kind, text (verbatim), retrieval_text (path + text + linearized table),
           embedding vector(768), fts tsvector (generated from retrieval_text),
           chapter_no, region, box_id, heading_path, pdf_start, pdf_end, printed_start, printed_end, token_count
table_cells table_id, caption, row_group, row_label, entity, col_label, year, is_revision, value, raw, pdf_page, printed_page, chunk_id
naive_chunks id, text, embedding, fts, pdf_page        -- the baseline index
messages / traces                                      -- Supabase only
```

`kind` ∈ executive_summary · chapter_summary · body · box · table · figure · annex · references · front_matter · back_matter · statistical_appendix.
`region` ∈ EAP · ECA · LAC · MNA · SAR · SSA (null outside the six Chapter 2 regional sections; Box 2.1 LICs is tagged `region = null, box_id = "2.1"`).

## Phases

| Phase | Output | Runnable as | Status |
|---|---|---|---|
| P0 | Golden set (40–60 questions) **before pipeline code** | `data/golden/gep-golden.json` | |
| P1 | Extraction → repair → outline → elements | `npm run inspect -- --outline / --page 96 / --tables` | |
| P2 | Chunking (parent/child, naive baseline) → embeddings → index | `npm run ingest` | |
| P3 | Routing → hybrid → rerank → parents → context | `npm run ask -- "q" --retrieve-only` | |
| P4 | Generation → verifier + region guard → computed source → refusal | `npm run ask -- "q" [--naive]` | |
| P5 | Retrieval ladder (offline) + answer eval naive vs full | `npm run eval:retrieval`, `npm run eval` | |
| P6 | Navigator UI: ask, outline rail, source view, Compare, `/eval` | `npm run dev` | |
| P7 | README, PRODUCT.md, DESIGN.md, notebook, CLAUDE.md, START_HERE.md | | |

**Short-cut version (1 day):** P0 with 20 questions → P1–P3 with rules routing, local store, no reranker → P4 → retrieval ladder only → a one-page UI.

## Risks

| Risk | Mitigation |
|---|---|
| pdfjs font names are subset-prefixed or missing | Map by size + family substring; fall back to size-only rules; `inspect --fonts` shows the census |
| Table rebuilding from positions | Column anchors come from the header row's x positions; tests on Table 2.9/2.10 and the appendix |
| Shared Gemini key with the sibling GPO/iMac projects | Each limiter only counts its own calls; START_HERE says to use a separate key or run one project at a time |
| Revision columns read as levels ("0.1" vs "6.3") | Columns tagged `is_revision`; linearized as "revision from January 2026 projections: +0.1 pp" |
| Judge bias (Gemini grading Gemini) | Human expected answers anchor correctness; retrieval metrics need no judge |
| A wrong filter hides the answer | Chapter only when named; widen below 3 hits; the ladder measures routing on and off |
| Near-duplicates (back cover, Foreword) outrank the Executive Summary | `kind = back_matter / front_matter` down-weighted; an executive-summary filter when named |

## Deliberately rejected
- **LLM parsing of the PDF** (Idea 4's long context included): quota, drift, unverifiable.
- **Agentic navigation** (Idea 5): 4–10 calls per question on a 500/day budget.
- **Vision for charts:** the brief puts chart-only values out of scope; text and tables carry the forecasts.
- **GraphRAG, frameworks (LangChain/LlamaIndex), managed vector DBs, paid rerankers.**
- **Per-chunk contextual summaries by LLM:** the heading path gives most of the benefit at 0 calls.
- **Streaming answers:** the verifier needs the whole answer.

## Status log
_(updated per phase below)_

### 2026-10-25 — P0–P7 built in one unattended run
- **P0 golden set:** 60 questions (`data/golden/gep-golden.json`) written from the PDF before pipeline code; L15's location widened after the ladder showed Ch. 1 › Global trade also states the figure.
- **P1 extraction/structure:** pdfjs runs with real font names; outline from typography (163 sections, all 6 regions, 4 boxes, annexes, references); boxes separated from main text by font size (10.6 vs 11) on shared pages; 25 tables rebuilt (7 non-year tables kept as text); printed page labels from folios. Finding: pdfjs decodes ligatures itself (pdftotext emits ~1,500); NFKC kept for safety.
- **P2 chunk + index:** 346 parents / 783 children / 889 naive chunks / 4,339 table cells / 177 countries → regions, in 0.2 s, 0 model calls. Embeddings are wired and cached, but **not yet computed: no API key in this run**.
- **P3 retrieval:** local store (BM25 + cosine + RRF) and Supabase store (`gep_hybrid_search`, untested until keys exist); rules routing with multi-region and multi-chapter scopes and open comparisons; bge reranker with a persistent score cache; parents; balanced interleave across scopes after rerank.
- **P4 answering:** generator + verifier (verbatim AND scope guard) + computed source (table facts + operand arithmetic) + gate. Unit-tested; **not run end-to-end: needs a key**. A test caught an inherited verifier hole (sentences ending ".[^1]" were never split, so an unverified sentence survived beside a verified one); fixed.
- **P5 eval:** retrieval ladder (keyword channel) naive MRR 0.44 → 0.52 sections → 0.63 heading path → 0.75 routing → 0.86 rerank → 0.87 parents; hit@5 58% → 96%; rerank without routing 0.80 (routing still earns its place). Gate 0.15 → 97% on all 60, 0 false refusals. Answer eval (`npm run eval`) pending a key.
- **P6 UI:** impeccable new-work flow, roll 2d2ae0e1 → court-reporter opinion page world (buckram spine, oxblood path ink, headnote/holding/authorities, star-paging, record panel), code-led. Detector clean.
- **P7 package:** README, PRODUCT.md (inferences labelled), CLAUDE.md, notebook, START_HERE.md.

### 2026-10-26 — key added, full mode measured
- Free-tier embedding limits found the hard way: 100 texts/min, 30,000 tokens/min and **1,000 texts/day** (every text in a batch counts). Embedding now batches by texts and tokens, paces a one-minute window, honours the API's retry hint, saves after every batch (resumable), and the limiter no longer mistakes a per-minute 429 for the daily cap. Query embedding falls back to keywords if the daily cap is hit.
- Search chunks fully embedded → hybrid search live. Naive chunks 74/889, ablation 0/783: next days.
- Full-mode answer eval, 60 questions: run 1 correctness 0.93 (S3 refused because its single over-long quote failed verification). Fixes: verifier accepts the longest verbatim clause (≥ 6 words) of a failed quote and shows only that; one repair retry when nothing verifies; prompt asks for headline figures and short quotes. Run 2: **correctness 0.97, faithfulness 0.98, mix-ups 0%, refusal accuracy 100%, false refusals 0%, citation precision 83%, numbers present 86%, p50 4.8 s, 141 calls**. Remaining half-credits: S2 (chooses different headline findings than the expected answer), L06, X04, X05.
- Pending: naive answer run and dense ladder rungs after embeddings complete.
