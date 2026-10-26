@AGENTS.md

# GEP Navigator — project conventions

**What this is.** A RAG training-assignment project over ONE long, structured report: the World Bank's *Global Economic Prospects, June 2026* (`data/source/GEP-Jun-2026.pdf`, 200 pages, public). Pass/fail bar: the answer comes from the right chapter and section and never mixes facts across regions or chapters. Brief: `PROJECT_BRIEF.md` · plan + status: `docs/PLAN.md` · product truth: `PRODUCT.md` · visual system: `DESIGN.md` · the human to-do list: `START_HERE.md`. Reference project (read-only): `../rag-chatbot`.

**Stack (all free).** Next.js 16 App Router · Tailwind v4 · Vercel AI SDK 7 + `@ai-sdk/google` · `pdfjs-dist` (font-aware extraction) · `gemini-embedding-001` @ 768d · local JSON store (BM25 + cosine + RRF in TS) or Supabase (pgvector + tsvector + RRF in SQL, `supabase/migrations/0001_init.sql`) · `bge-reranker-v2-m3` ONNX in-process (`.cache/models`).

**Hard rules.**
- Every Gemini call goes through `src/lib/gemini/limiter.ts`. Never two Gemini-consuming processes at once (one RPM window; the sibling GPO/iMac projects may share the key).
- Structure comes from fonts (`src/lib/pdf/structure.ts`): body Garamond 11, boxes Garamond 10.6, h1 Helvetica Bold 16/14, h2 Helvetica Roman 11, captions Helvetica Bold 10, table cells Helvetica 7.6. No LLM parsing of the PDF.
- Chunks never cross a section boundary; every chunk carries chapter, region, box, kind, printed pages. Citations verify against verbatim `text`; `retrievalText` (heading path + linearized tables) is for search only.
- Routing: chapter filter ONLY when the question says "Chapter N"; countries map to regions from the report's own tables (Pakistan → MNA). Widen when a filter returns < 3 hits.
- Verifier strips non-verbatim quotes AND citations outside the routed scope. Arithmetic only from the computed source. Refuse below `RERANK_REFUSAL_THRESHOLD` with no model call.
- Model outputs are cached by content hash: `.cache/extract`, `.cache/embeddings.json`, `.cache/rerank.json`.

**Layout.** `src/lib/pdf/*` (extract, lines, repair, structure, tables, types) · `src/lib/pipeline/*` (chunk, embed, index-file, ingest) · `src/lib/store/*` (local, supabase) · `src/lib/retrieval/*` (route, retrieve, rerank, bm25, context, computed, generate, ask) · `src/lib/eval/*` (golden, retrieval ladder, run, judge) · `src/app` (`/`, `/eval`, `/how-it-works`, `api/ask`, `api/route`, `api/section`) · `src/components/navigator/*` · `scripts/*` · `data/golden/gep-golden.json` · `notebooks/pipeline_walkthrough.ipynb`.

**Commands.** `npm run inspect -- --outline|--page N|--tables [id]|--lines N` (0 calls) · `npm run ingest [-- --no-embed]` · `npm run ask -- "q" [--naive] [--retrieve-only] [--route llm]` · `npm run eval:retrieval` (0 Gemini calls) · `npm run eval [-- --mode full --ids S1,S2 --resume]` (~280 calls: run alone) · `npm run db:push` · `PORT=3200 npm run dev`.

**Verification.** `npm run lint && npx tsc --noEmit && npm test`. Don't commit, push or open PRs unless asked. Work only inside this folder.
