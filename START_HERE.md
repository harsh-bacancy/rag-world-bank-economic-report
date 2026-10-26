# Start here

You asked me to build as much as possible without asking questions, and to leave you one file to follow. This is it. Read it top to bottom once (about 5 minutes); the steps marked **You** are the only ones that need you.

---

## 1. Where things stand

| Area | State | Verified how |
|---|---|---|
| Brief, ideas, plan | **Done.** `PROJECT_BRIEF.md` (definition, pass/fail bar, 16-row failure → cause → fix table, five build ideas), `docs/PLAN.md` (locked decisions, $0 stack, schema, phases, risks, rejected, status log) | Read them |
| Golden set | **Done.** 60 questions in `data/golden/gep-golden.json`, written from the PDF before pipeline code | Needs **your review** (step 3) |
| PDF → structure → chunks → index | **Done.** 163 sections, 6 regions, 4 boxes, 25 tables rebuilt (4,339 cells), 783 search chunks inside 346 reading windows | `npm test` (28 tests, incl. integration checks on the real PDF), `npm run inspect` |
| Retrieval (routing, BM25, RRF, rerank, parents, refusal gate) | **Done and measured** (keyword channel) | `npm run eval:retrieval` → table below |
| Embeddings / hybrid search | **Search chunks done (783/783)**, hybrid search live. Naive-baseline chunks 74/889 and the heading-path ablation set 0/783: the free tier caps embeddings at **1,000 texts/day** (and 100/min, 30k tokens/min), so they finish over the next day or two | Re-run `npm run ingest` each day; it resumes |
| Answer generation, verifier, scope guard, computed source | **Running.** The three sample questions answer correctly with verified, in-scope citations | `npm run ask -- "…"` |
| Answer-level eval | **Full mode done:** correctness 0.97, faithfulness 0.98, **0% mix-ups**, refusal accuracy 100%, p50 4.8 s. Naive mode pending its embeddings | `/eval`, `data/eval/latest.json` |
| Supabase store | **Written, untested** (no project/keys). The app runs on a local JSON index without it | Optional step 4 |
| UI (`/`, `/eval`, `/how-it-works`) | **Done.** Built with the impeccable skill and two finish-review rounds. Round 1: seven fixes. Round 2: six resolved, one partial plus two small regressions, all fixed afterwards but **not re-reviewed** (an unattended run stops at two rounds). Design detector clean | `npm run dev` (step 5) |
| Docs | README, PRODUCT.md, DESIGN.md, CLAUDE.md, notebook | — |
| `lint` / `tsc` / `test` | Clean | `npm run lint && npx tsc --noEmit && npm test` |

Nothing is committed (the folder is not a git repo yet) and nothing outside this folder was touched. Two things were *copied* in (read-only source): the reranker weights from `../rag-chatbot/.cache/models` (saves a 560 MB download) and the Gemini client/limiter code.

### Retrieval results so far (no API key, keyword channel only)

52 answerable questions. A passage counts only if it is in the expected chapter/region/box **and** on the expected pages.

| Rung (one technique added) | hit@1 | hit@5 | MRR | wrong-region share of top 5 |
|---|---|---|---|---|
| naive 1000-char chunks | 25% | 58% | 0.44 | 8% |
| + section-aware chunks + text repair | 37% | 65% | 0.52 | 5% |
| + heading path in the retrieval text | 48% | 69% | 0.63 | 4% |
| + routing (rules) | 58% | 81% | 0.75 | 2% |
| + rerank (bge-reranker-v2-m3) | 67% | 94% | 0.86 | 2% |
| + parents (what the model reads) | 67% | 96% | 0.87 | 3% |
| A/B: rerank without routing | 62% | 85% | 0.80 | 2% |

Refusal gate (no model call): 97% correct on all 60 questions, 0 false refusals. The field guide reached MRR 0.26 → 0.76 → 0.88 on this report.

---

## 2. Your steps

### Step 1 — **You:** add a Gemini key, then embed (about 2 minutes, ~8 API calls)

1. Get a free key at https://aistudio.google.com/apikey.
2. Create `.env.local` from the template and paste the key after `GOOGLE_GENERATIVE_AI_API_KEY=`:

```bash
cp .env.example .env.local
```

3. Build the embeddings (text already embedded is cached, so re-runs cost nothing):

```bash
npm run ingest
```

4. Re-run the ladder. It now adds the dense and hybrid rungs and the LLM-routing A/B (about 60 routing calls; the rerank scores are cached):

```bash
npm run eval:retrieval
```

5. Ask the three sample questions from the terminal:

```bash
npm run ask -- "What is the growth outlook for South Asia in this report?"
```

```bash
npm run ask -- "What does Chapter 3 say about sovereign debt in developing economies?"
```

```bash
npm run ask -- "According to the executive summary, what are the main risks to the global outlook?"
```

**About the shared key:** if the sibling projects (`rag-gpo-annual-report`, `rag-apple-imac-env-report`) use the same key, they share the per-model daily cap (500 requests/day for `gemini-3.5-flash-lite`), but each project's limiter only counts its own calls. Run one Gemini-consuming command at a time across all three, or give this project its own key.

### Step 2 — **You:** run the answer eval (about 30–45 minutes, ~280 API calls)

This is most of one model's daily quota, so run it alone. If it stops at the daily cap, re-run the same command with `--resume` the next day (or after the fallback model takes over).

```bash
npm run eval
```

Results go to `data/eval/latest.json` and appear on `/eval` (naive vs full: correctness, numbers present, faithfulness, mix-up rate, citation precision, refusal accuracy, latency, calls). Copy the final numbers into the README's Results section and `docs/PLAN.md`'s status log.

### Step 3 — **You:** review the golden set (about 20 minutes)

Open `data/golden/gep-golden.json`. Every expected answer was written from the PDF text, but you are the human anchor. Check these first, because they hinge on reading a table or a subtle phrase:

- **L08** (MNA 2025 growth): the Ch. 2 overview says 3.9%; the MNA section and Table 2.7 say 4 / 4.0. Both are accepted.
- **R12 / X03** (Pakistan, India): fiscal years differ (July–June vs April–March).
- **A05** (oil price implied for January: $94 − $34 = $60) and **A06** (Iraq: −8.9 + 15.4 = 6.5): arithmetic from Table 1.1 / 2.8 revision columns.
- **X02, X04**: the two cross-section questions retrieval still misses at hit@5. Decide whether the Ch. 2 overview (p. 50) should also count as a valid location.

### Step 4 — optional, **You:** Supabase (about 10 minutes)

The app works without it. To use Postgres + pgvector (the default stack's store):

1. Create a free project at https://supabase.com (or reuse rag-chatbot's: all tables are prefixed `gep_`).
2. In the SQL editor, run the whole of `supabase/migrations/0001_init.sql`.
3. In `.env.local`, set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (Project → Settings → API).
4. Push the index (run step 1 first, so the embeddings go up too):

```bash
npm run db:push
```

5. Set `STORE=supabase` in `.env.local` and restart the dev server. The heading-path ablation rung runs on the local store only, by design.

### Step 5 — **You:** look at the app

```bash
PORT=3200 npm run dev
```

Open http://localhost:3200:

- Click a sample question.
- Type "Pakistan" into a question and watch the spine's scope key move to the MNA section.
- Tick **Compare two regions**.
- Tick **Naive baseline** to see the honest difference.
- Open `/eval` and `/how-it-works`.

Without a key, answers show a "retrieval only" state listing the passages; with one, you get a holding with pinpoints and verified authorities.

---

## 3. Decisions I made for you (change any of them)

| Decision | Why | Where to change |
|---|---|---|
| Build approach: Idea 1 engine + Idea 2 "GEP Navigator" product + Idea 3 table ledger as the computed source | Reuses rag-chatbot, shows the pass/fail bar on screen, exact arithmetic | `PROJECT_BRIEF.md` §3, `docs/PLAN.md` D1 |
| Real PDF, no synthetic documents | Public, no PII | — |
| Local font-aware parsing (pdfjs), no LLM parsing | Quota, fidelity, the fonts carry the structure | D3 |
| Local JSON store as default, Supabase optional | Runs with zero setup; same RRF in both | D4, `STORE` |
| Rules routing by default, LLM routing as an A/B | 0 calls, ties the LLM on region-named questions (field guide) | `npm run ask -- "…" --route llm` |
| Refusal threshold 0.15 | Middle of the best plateau in the gate calibration | `RERANK_REFUSAL_THRESHOLD` |
| Reranker candidates 24, question-only | CPU cost; scores cached in `.cache/rerank.json` | `FULL` in `src/lib/retrieval/retrieve.ts` |
| PRODUCT.md written without an interview | You said not to ask; every inference is marked *(inferred)* | `PRODUCT.md` |
| Visual world: a court reporter's opinion page (buckram spine, oxblood path ink, star-paging) | Assigned by the impeccable concept roll; it fits the product (headnote = scope, pinpoints = verified spans) | `DESIGN.md`, `.impeccable/surfaces/` |

---

## 4. Command cheat sheet

| Command | What it does | Model calls |
|---|---|---|
| `npm run inspect -- --outline` | section tree with kinds, regions, boxes, pages | 0 |
| `npm run inspect -- --page 96` / `--tables 2.10` / `--lines 96` | what the parser recovered | 0 |
| `npm run ingest` | PDF → `data/index/index.json` (+ embeddings with a key) | 0 / ~8 |
| `npm run ask -- "q" [--naive] [--retrieve-only] [--route llm] [--json]` | one question from the terminal | 0–3 |
| `npm run eval:retrieval [-- --only naive,parents,gate]` | the ladder and the gate | 0 (rules) |
| `npm run eval [-- --mode full --ids S1,S2,S3 --resume]` | naive vs full answers + judge | ~280 for all |
| `npm run db:push` | local index → Supabase | 0 |
| `npm run warm-reranker` | load and sanity-check the cross-encoder | 0 |
| `npm run lint && npx tsc --noEmit && npm test` | the quality gate | 0 |

---

## 5. Known gaps and what I'd do next

1. **Run steps 1–2.** Everything model-dependent is untested end-to-end until then. Expect to tune the generation prompt once against the full-mode eval.
2. **Reranker latency.** About 10 s for a never-seen question on CPU (cached afterwards). If that is too slow for a demo, set candidates to 12 in `FULL`, then re-run the ladder to see what it costs.
3. **Cross-section questions with an unnamed side** (X02, X04) still miss one of their two locations in the top 5.
4. **Chart-only values** are out of scope by design (captions, panels and notes are indexed).
5. **Git:** `git init` and a first commit when you're happy. I didn't, because you asked me not to commit.
