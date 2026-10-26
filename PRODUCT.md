# Product

<!-- impeccable:product-schema 1 -->

> Written 2026-10-25 without an interview: the user asked for unattended work ("do not ask me questions, just choose best recommended"). Facts come from the assignment text, PROJECT_BRIEF.md and docs/PLAN.md. Lines marked *(inferred)* are my assumptions for the user to confirm or correct.

## Platform

web

## Users

- **Primary — reviewers of a RAG training assignment** (confirmed by the assignment): they open the app once or twice, ask the three sample questions and a few of their own, and judge one thing: did the system find the right chapter and section, and did it keep regions and chapters apart. They also read the evaluation page to see which technique moved which number.
- **Secondary — a reader of the World Bank's *Global Economic Prospects, June 2026*** *(inferred)*: an analyst, student or journalist who needs a figure or a passage from a 200-page report fast, with the page number to cite it.

Scene *(inferred)*: a desktop browser at a desk, reading alongside the PDF; mobile is a fallback, not the target.

## Product Purpose

GEP Navigator answers questions about one long, structured report and shows **where** every answer came from: the chapter › section › subsection path, the region, the box or table, and the printed page. Success: an answer whose citations all sit in the place the question is about, verified verbatim, with arithmetic done in code; and a clear "the report doesn't say that" when it doesn't.

## Positioning

A generic "chat with your PDF" retrieves passages that share words with the question. This product knows the report's outline: it routes a question to a region, a chapter, the executive summary or a box before searching, and refuses to cite a passage from outside that scope. It can show that on screen because every chunk carries its location.

## Operating Context

- One document, public: `data/source/GEP-Jun-2026.pdf` (World Bank, CC BY 3.0 IGO). No uploads, no other editions.
- Four chapters (Global Outlook, Regional Outlooks, Sovereign Debt, Fiscal Policy), six regions in Chapter 2 (EAP, ECA, LAC, MNA, SAR, SSA), four boxes, ~25 forecast tables, a Statistical Appendix.
- Answers take seconds (Gemini free tier behind a rate limiter); retrieval alone is instant. Evaluation results are files the app reads (`data/eval/*.json`).
- Terminal-first workflow: `npm run ingest`, `npm run ask`, `npm run eval:retrieval`, `npm run eval`.

## Capabilities and Constraints

- Navigator: outline of the report; ask a question; answer with `[^n]` citations that open the cited passage with its path and printed page; the routed scope (region / chapter / box) is shown; refusals are a first-class answer.
- Compare *(inferred, from the brief's Idea 2)*: one question asked for two regions side by side, each scoped to its own section.
- `/eval`: naive vs full, the retrieval ablation ladder, the refusal gate.
- Constraints: $0 stack; Gemini free tier (500 requests/day per model); answers are not streamed (the verifier needs the whole answer); single user, no auth.
- Without an API key the app still routes and retrieves; generation shows an honest "retrieval only" state.

Terminology: **outline** (the report's section tree), **scope** (the region / chapter / box a question is routed to), **source** (a numbered passage the answer may cite), **computed source** (figures derived in code), **refusal**, **mix-up** (a fact from the wrong region or chapter).

## Brand Commitments

Name: **GEP Navigator** (chosen in docs/PLAN.md, D1). No logo, colours or typography exist. The World Bank's name and report title are cited as the source, never used as this product's brand *(inferred: an independent student project must not look like an official World Bank product)*.

## Evidence on Hand

- The report itself and its rebuilt tables (`data/index/index.json` after ingest).
- Golden set: `data/golden/gep-golden.json` (60 questions, human-checked expected answers pending the author's review).
- Retrieval results: `data/eval/retrieval-latest.json`; answer results: `data/eval/latest.json` once a key is set.
- No users, testimonials or benchmarks of this product exist; the field guide's numbers belong to the field guide.

## Product Principles

1. **Location is the answer's credential.** Every claim shows the chapter › section path and printed page it came from.
2. **Scope before search.** Decide where to look, then look; never let a neighbouring region answer.
3. **Computed, not recalled.** Differences, averages and implied projections come from code.
4. **Refusal is a first-class answer.**
5. **Show the measurement.** The evaluation is part of the product, not an appendix.

## Accessibility & Inclusion

WCAG 2.2 AA *(inferred, carried from the user's previous project)*. Region and status are never conveyed by colour alone. Keyboard-complete ask flow.
