# GEP Navigator

Ask the World Bank's **Global Economic Prospects, June 2026** (a 200-page report) and get answers pinned to the chapter, section and printed page they came from. The system can tell "East Asia and Pacific" from "Sub-Saharan Africa" even though both say "growth is expected to … percent in 2026", and it never cites one region's section for another region's question.

Built for a RAG training assignment ("handling long and structured documents") on a **$0 stack**: local font-aware PDF parsing · Gemini free tier · a local or Supabase vector store · a local ONNX cross-encoder · Next.js 16.

> Start with **[START_HERE.md](START_HERE.md)**: what's done, what's verified, and the few steps that need you (API key, optional Supabase).

## The pipeline

```
PDF ─▶ runs with fonts (pdfjs) ─▶ repair (NFKC, hyphens, running heads, drop caps)
    ─▶ outline from typography (chapter › section › subsection, boxes, figures, tables, annexes)
    ─▶ tables rebuilt from cell positions (revision columns, fiscal-year groups) ─▶ 4,339 cells
    ─▶ parents (~900 tokens) + children (~280 tokens) inside one section, each with chapter/region/box/kind/pages
    ─▶ embeddings of heading path + text (+ tables read as prose) ─▶ index (local JSON or Supabase)

Question ─▶ route (region by name / acronym / country · chapter only if named · box · structural refusals)
        ─▶ hybrid search inside the filter (BM25 + cosine → RRF; widen if < 3 hits)
        ─▶ rerank (bge-reranker-v2-m3) ─▶ parents ─▶ refusal gate (no model call)
        ─▶ computed source (table facts + operand arithmetic in TypeScript)
        ─▶ generate with [^n] + quoted spans ─▶ verify (verbatim AND in scope) ─▶ answer
```

| Layer | Choice | Why |
|---|---|---|
| Parsing | `pdfjs-dist`, local, fonts kept | The report's fonts carry its structure (Garamond 11 body, 10.6 boxes, Helvetica Bold 16 sections, Helvetica 7.6 table cells). No LLM parsing of 200 pages. |
| Structure | pure TS (`src/lib/pdf/structure.ts`) | Outline checked against the Contents pages; boxes separated from the main text by font size even on shared pages. |
| Tables | rebuilt from positions (`src/lib/pdf/tables.ts`) | "0.1" beside "6.3" is a revision, not growth; India's columns are fiscal years. |
| Chunks | parent/child, section-bounded | Search small, read the parent (field guide: MRR 0.76 → 0.88). |
| Embeddings | `gemini-embedding-001` @ 768d, cached | Heading path embedded with the text: "SAR" passages become findable as "South Asia". |
| Store | local JSON (default) or Supabase pgvector + tsvector | Same RRF (k = 50) in TS and SQL; runs with zero setup. |
| Rerank | `bge-reranker-v2-m3` ONNX q8, in-process | Biggest single jump on this report. Scores cached in `.cache/rerank.json`. |
| Generation | `gemini-3.5-flash-lite` → `3.1-flash-lite` behind one limiter | 500 requests/day per model on a new free key. |
| Trust | verifier + scope guard + computed source + refusal gate | No unverified quote, no out-of-scope citation, no model arithmetic, refusal as an answer. |

## Run it

```bash
npm install
npm run ingest            # PDF → data/index/index.json (0 model calls without a key; ~8 embedding calls with one)
npm run eval:retrieval    # the retrieval ladder → data/eval/retrieval-latest.json (0 Gemini calls)
PORT=3200 npm run dev     # http://localhost:3200
```

With a Gemini key in `.env.local` (see `.env.example`):

```bash
npm run ingest                                   # adds embeddings (hybrid search switches on)
npm run ask -- "What is the growth outlook for South Asia in this report?"
npm run ask -- "…" --naive                       # the baseline
npm run eval                                     # naive vs full answers → data/eval/latest.json → /eval (~280 calls)
```

Inspect without any model: `npm run inspect -- --outline`, `--page 96`, `--tables 2.10`, `--lines 96`.

## Results (retrieval, no API key, keyword channel)

52 answerable golden questions; a passage counts only if it is in the expected chapter/region/box **and** pages.

| Rung (one technique added) | hit@1 | hit@5 | MRR | wrong-region share of top 5 |
|---|---|---|---|---|
| 1 naive 1000-char chunks | 25% | 58% | 0.44 | 8% |
| 2 section-aware chunks + text repair | 37% | 65% | 0.52 | 5% |
| 3 + heading path in the retrieval text | 48% | 69% | 0.63 | 4% |
| 4 + routing (rules) | 58% | 81% | 0.75 | 2% |
| 5 + rerank (bge-reranker-v2-m3) | 67% | 94% | 0.86 | 2% |
| 6 + parents (what the model reads) | 67% | 96% | 0.87 | 3% |
| A/B: rerank without routing | 62% | 85% | 0.80 | 2% |

By kind (final rung): lookup hit@5 100% · reasoning 100% · arithmetic 100% · cross-section 75% (questions that need two places in the top 5). Refusal gate (no model call): threshold 0.15 on the best reranked passage plus rule-based refusals → 97% correct on all 60 questions, 0 false refusals; the 2 refusals it lets through (an IMF forecast, a June 2025 edition) are on-topic and left to the model and verifier.

Field guide on the same report (13 questions, bge-small embeddings): MRR 0.26 → 0.76 → 0.88. Dense and hybrid rungs and the answer-level table (correctness, faithfulness, mix-up rate, citation precision, refusal accuracy, latency) appear on `/eval` once a key is set and `npm run eval` has run.

## Surfaces

- `/` **Navigator**: the report's outline as a spine; the question re-scopes it live as you type; answers are set as an opinion on the record (scope headnote → holding with pinpoints → authorities); the record panel opens the cited passage with star-paging (*74) and the quoted span highlighted. **Compare** asks one question of two regions, each allowed to cite only its own. **Naive baseline** is a visible toggle.
- `/eval`: the ablation ladder, the refusal gate's calibration, and naive vs full answers.
- `/how-it-works`: the pipeline, explained with live examples from the index.

## Evaluation set

`data/golden/gep-golden.json`: 60 questions written before pipeline code. 3 assignment samples, 18 lookup, 15 reasoning (incl. country → region routing), 8 cross-section, 8 arithmetic, 8 refusals. Each has the expected answer, the exact numbers and its location (chapter, region/box, PDF pages, printed pages).

## Limits

Chart-only values are not answerable (captions, panels and notes are indexed) · one report, one edition · answers are not streamed (the verifier needs the whole answer) · the reranker runs on CPU (~10 s for a new question; cached afterwards) · the answer judge is Gemini grading Gemini · single user, no auth.

## Repository map

```
src/lib/pdf/        extract (pdfjs runs + fonts) · lines · repair · structure (outline) · tables (rebuild) · types
src/lib/pipeline/   chunk (parent/child, naive) · embed (cached) · index-file (cells, countries) · ingest
src/lib/store/      local (BM25 + cosine + RRF) · supabase (gep_hybrid_search) · index
src/lib/retrieval/  route · retrieve · rerank · bm25 · context · computed · generate (+ verifier) · ask
src/lib/eval/       golden (relevance by location) · retrieval (ladder + gate) · run (answers) · judge
src/app/            / · /eval · /how-it-works · api/ask · api/route · api/section
scripts/            ingest · ask · eval · eval-retrieval · inspect · db-push · warm-reranker
data/               source/GEP-Jun-2026.pdf · golden/ · index/ · eval/
docs/PLAN.md        decisions, phases, status      notebooks/pipeline_walkthrough.ipynb
```
