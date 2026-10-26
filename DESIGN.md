---
name: GEP Navigator
description: The World Bank's Global Economic Prospects (June 2026), answered as an opinion on the record, every claim pinned to its page.
colors:
  page: "#ffffff"
  page-2: "#f7f6f3"
  ink: "#17140f"
  ink-2: "#48433b"
  ink-3: "#6b645a"
  rule: "#dcd6cc"
  rule-strong: "#1b1814"
  buckram: "#c9ad7f"
  buckram-2: "#bb9d6c"
  buckram-ink: "#20190f"
  buckram-ink-2: "#4a3c25"
  label: "#1c1915"
  gilt: "#ead9a8"
  path: "#8b1d1d"
  path-2: "#6e1515"
  path-soft: "#f7e6e2"
typography:
  display:
    fontFamily: "Source Serif 4, ui-serif, Georgia, serif"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Source Serif 4, ui-serif, Georgia, serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.375
  title:
    fontFamily: "Source Serif 4, ui-serif, Georgia, serif"
    fontSize: "19px"
    fontWeight: 400
    lineHeight: 1.55
  record:
    fontFamily: "Source Serif 4, ui-serif, Georgia, serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.625
  apparatus:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.375
    fontFeature: "\"tnum\", \"lnum\""
  label:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.08em"
  running-head:
    fontFamily: "Public Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.1em"
rounded:
  none: "0px"
spacing:
  gutter-sm: "16px"
  gutter-md: "32px"
  row: "10px"
  section: "40px"
  header: "56px"
  running-head: "32px"
components:
  button-ask:
    backgroundColor: "{colors.rule-strong}"
    textColor: "{colors.page}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "8px 16px"
  button-ask-hover:
    backgroundColor: "{colors.ink-2}"
    textColor: "{colors.page}"
  ask-field:
    textColor: "{colors.ink}"
    typography: "{typography.headline}"
    rounded: "{rounded.none}"
    padding: "0 0 8px 0"
  nav-link:
    textColor: "{colors.ink-2}"
    typography: "{typography.body}"
    padding: "0 12px"
    height: "56px"
  nav-link-active:
    textColor: "{colors.ink}"
  spine-label:
    backgroundColor: "{colors.label}"
    textColor: "{colors.gilt}"
    rounded: "{rounded.none}"
    padding: "6px 10px"
  spine-label-scoped:
    backgroundColor: "{colors.path}"
    textColor: "{colors.gilt}"
  spine-entry:
    backgroundColor: "{colors.buckram}"
    textColor: "{colors.buckram-ink}"
    padding: "5px 8px 5px 10px"
  spine-entry-open:
    backgroundColor: "{colors.buckram-2}"
  spine-entry-scoped:
    textColor: "{colors.path-2}"
  pinpoint-mark:
    backgroundColor: "{colors.path-soft}"
    textColor: "{colors.ink}"
  docket-line:
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    padding: "12px 0"
  docket-line-hover:
    backgroundColor: "{colors.page-2}"
---

# Design System: GEP Navigator

## Overview

**Creative North Star: "The Reporter's Volume"**

The interface is a bound law reporter opened on the desk. The report's outline is the volume's spine, cloth-bound in buckram tan, its chapters carried on black spine labels lettered in gilt. The centre is the bench: a question asked at headline scale, then an opinion set as headnote (where the question was routed), holding (the short answer, in serif, every sentence pinned) and authorities (the verbatim spans, each with its printed page). The right-hand record shows the cited passage as the report prints it, with guide words at its head, star-paging where printed pages break, and the quoted span marked.

Density is that of a reference book, not a dashboard: hairline rules divide everything, nothing is boxed, and the page stays white. One ink, oxblood, is reserved for the answer's path through the volume (the scope key, the pinpoints, the cited sections on the spine, the highlighted span), so the eye can follow how an answer was found without reading a legend. All other emphasis is weight and ink depth, never a second hue.

The serif carries what the report says and what the court held; the sans carries the apparatus around it: navigation, counts, page numbers, labels. Rejected outright by the build: chat bubbles, answer cards with source chips, rounded corners, drop shadows.

**Key Characteristics:**
- White record page, warm engraving-black inks, buckram spine as the only tinted surface.
- Oxblood marks the answer's path and nothing else in the content.
- Source Serif 4 for record and holdings; Public Sans for apparatus.
- Hairline rules, square corners, no cards, no shadows.
- Law-reporter devices are working UI: headnote, "Held", authorities, star-paging, guide words, running head, key glyph for scope.

## Colors

A white page and warm near-black inks, one cloth tan for the spine, one oxblood for the path.

### Primary
- **Path Oxblood** (path): the answer's path. Scope key glyph and scope names in the headnote and the live "Will search" preview; pinpoint numbers `[n]` in the holding, authorities and record; the in-scope chapter label on the spine (gilt on oxblood, 6.5:1); the region heading over each column in compare mode, since it names that column's scope. Also the focus ring, text caret and selection tint, which globals.css treats as browser parts.
- **Deep Oxblood** (path-2): oxblood as small text on tinted grounds, where path would be too light or too loud: in-scope section names, region codes and pinpoint counts on the buckram spine (5.5:1 on buckram, 4.6:1 on buckram-2); the pinned table row in the record; pinpoint hover; selection text.
- **Pinpoint Blush** (path-soft): the ground of the quoted span (with a 1.5px oxblood underline inset) and of the pinned table row. Never a panel fill.

### Secondary
- **Buckram Tan** (buckram): the spine's cloth. The outline rail is the only tinted surface in the product.
- **Worn Buckram** (buckram-2): the open section on the spine, and its hover at 70%.
- **Spine Ink** (buckram-ink) and **Faded Spine Ink** (buckram-ink-2): text on buckram, primary and secondary (printed pages, region codes, the spine's title line).
- **Spine Label Black** (label) and **Gilt** (gilt): chapter labels, gilt lettering on black (12.5:1), as stamped on a bound volume.

### Neutral
- **Record White** (page): every reading surface, the header, the record panel.
- **Paper Tint** (page-2): row hover on docket lines, authorities and passages; loading skeleton bars; the empty track of eval bars.
- **Engraving Black** (ink): body text, holdings, the best value in any eval comparison.
- **Second Ink** (ink-2): secondary text, labels like "Held", non-best values.
- **Third Ink** (ink-3): metadata, counts, star-page numbers, captions (5.8:1 on white).
- **Hairline** (rule): the default divider between rows and under the running head.
- **Strong Rule** (rule-strong): structural rules (header base, record head, table heads, the ask field underline), active nav underline, and the Ask button's fill.

### Named Rules
**The One Path Rule.** Oxblood means "this is the route the answer took." It never marks navigation, hover on ordinary links, eval results, headings that are not a scope name, or decoration. If a mark is not scope, pinpoint, cited section or quoted span, it is ink.

**The Weight Not Hue Rule.** Winners, active states and emphasis are carried by weight and ink depth (ink over ink-2 over ink-3). The eval page's best bars are ink, others ink-3 at 60%; there is no success green, warning amber or error red.

## Typography

**Record Font:** Source Serif 4 (with ui-serif, Georgia), optical sizing on
**Apparatus Font:** Public Sans (with ui-sans-serif, system-ui), weights 400/500/600/700

**Character:** A sturdy book serif for the text of the report and the court's holding, beside a plain civic sans that keeps the apparatus quiet and tabular.

### Hierarchy
- **Display** (serif 600, 34px, 1.25, -0.01em): page titles on /eval and /how-it-works only.
- **Headline** (serif 600, 22px): section heads on reading pages. The ask field uses the same size in regular weight, so the question reads as a line of the record.
- **Title** (serif 400, 19px, 1.55): the holding, refusal statements, the /how-it-works lede (max 66ch). Docket questions sit just below at 18px.
- **Record** (serif 400, 16px, 1.6): passages in the record panel, max 68ch; long-form reading at 17px/1.65. Authority quotes are serif italic 15px.
- **Body** (sans 400, 14-15px, relaxed): explanatory prose and refusal reasons, max 60-75ch.
- **Apparatus** (sans 400, 13px, tabular lining figures): scope line, citation paths, printed pages, spine entries, table cells (12-13px).
- **Label** (sans 600, 12px, 0.08em, uppercase): section labels in the apparatus ("Authorities", docket heads, the spine title). "Held" and its siblings ("No holding written.", "Not answered.") are 13px at 0.12em.
- **Running head** (sans 600, 12px, 0.1em, uppercase): guide words in the sticky running head and the record panel head. Real uppercase with tracking; no synthesized small caps.

### Named Rules
**The Two Voices Rule.** Serif is what the report says or what the answer holds; sans is everything about it. A page number, count or label is never serif; a quoted span is never sans.

**The Tabular Rule.** Every number that can sit in a column (pages, pinpoints, scores, percentages) uses tabular lining figures.

## Layout

The Navigator is a three-column volume on wide screens: spine 280px, the bench (content max 760px, centred), the record 360-420px. Spine and record are sticky beneath the 56px header and scroll independently. Below 1280px the record drops beneath the bench as a full-width section and opening a pinpoint scrolls to it; below 1024px the spine collapses behind an "Outline of the report" toggle at the top.

Reading pages (/eval at max 1120px, /how-it-works at max 1000px) carry a 32px sticky running head under the header, whose guide words name the first and last `data-guide` section in view. Gutters are 16px on small screens and 32px from md. Rows breathe at about 10px vertical padding; sections separate by 40-56px. On /eval below md the ablation table becomes a list of entries (label, technique, four tabular figures) rather than a scrolling table.

## Elevation & Depth

Flat. There are no box-shadows anywhere. Depth is carried by the spine's cloth tint against the white page, by strong rules at structural edges (header base, the record's left edge and sticky head, table heads), and by sticky positioning. The only shadow-like value is the pinpoint's inset 1.5px oxblood underline, which is a rule, not elevation.

### Named Rules
**The Hairline Rule.** Separation is a 1px rule (hairline or strong), never a card, fill or shadow. Tonal fill is allowed only as state (row hover, the open spine section), as the pinpoint ground, and in loading skeletons.

## Shapes

Square everywhere: zero radius on buttons, selects, spine labels, marks and skeleton bars. Borders are 1px, rising to 2px only for the ask field underline, the active nav underline and the A/B divider in the eval table. The one bordered inline form is the step number box on /how-it-works (1px strong rule). Icons are Lucide line icons at 14-16px; the key glyph is the scope mark.

## Components

### Buttons
Blunt and printed.
- **Shape:** square (0px).
- **Primary (Ask):** strong-rule fill, white text, sans 600 14px, 8px 16px, arrow icon; while answering it reads "Reading" with a spinner and drops to 60% opacity.
- **Hover / Focus:** fill lightens to ink-2; focus is the global 2px oxblood outline at 2px offset.
- **Text actions:** close, show/hide passages and pinpoint buttons are unboxed text in ink-3 or oxblood, darkening on hover.

### Inputs / Fields
- **Ask field:** an unboxed serif textarea at 22px over a 2px strong-rule underline, growing with content to 160px; placeholder in ink-3; Enter asks, Shift+Enter breaks. The live scope preview sits beneath in 12px apparatus.
- **Selects and checkboxes:** 1px hairline square selects on white; checkboxes take the ink accent, not oxblood.

### Navigation
- **Header:** sticky 56px white strip on a strong rule; product name in sans 700 17px, source citation in ink-3 on large screens.
- **Links:** sans 500 14px in ink-2, full-height with a 2px bottom border: transparent at rest, hairline on hover, strong rule when current. Never oxblood.

### The Spine (signature)
The outline as the volume's spine on buckram. Chapters are black labels with gilt lettering (chapter number in 11px tracked caps, title 13px 600, printed page tabular); the chapter in scope turns oxblood and gains the key glyph. Sections beneath are 13px buckram-ink rows with region codes and printed pages; scoped sections go Deep Oxblood and bold with the key; cited sections show their pinpoint numbers `[1][3]` in Deep Oxblood; the section open in the record takes the worn-buckram fill. Colour changes ease over 180ms.

### The Opinion (signature)
Headnote (scope line with key glyph and the reason for routing, then a tabular run-line of passages read, channel, score, seconds, model calls) over a hairline; the holding in 19px serif led by "Held" with superscript oxblood pinpoints; then Authorities: a hairline-ruled list of `[n]`, path and printed page, the verbatim span in serif italic, and a "verbatim" check. Refusals are set in the same serif with a shield-off icon in ink-2, never oxblood or red.

### The Record (signature)
A sticky head on a strong rule carrying left and right guide words and the passage title; passages beneath in 16px serif at 68ch with star-paging (`*74`, sans 600 at 0.72em, ink-3, raised 0.15em) where a printed page begins, and the pinpoint span in Pinpoint Blush with its oxblood underline. Tables keep their caption, strong-ruled head, hairline rows, and mark the pinned row in blush with Deep Oxblood figures. Opening a passage slides it in 8px over 220ms (expo-out), only when motion is allowed.

### Docket
The idle state's numbered list of the three assignment questions: serif 18px lines between a strong top rule and hairlines, a tabular number in ink-3, row hover in Paper Tint with an arrow fading in.

## Do's and Don'ts

### Do:
- **Do** reserve oxblood (path, path-2, path-soft) for scope, pinpoints, cited spine sections and the quoted span.
- **Do** set the report's words and the holding in Source Serif 4, and every count, page and label in Public Sans with tabular figures.
- **Do** separate with 1px rules (rule for rows, rule-strong for structure) and keep every corner square.
- **Do** carry the law-reporter apparatus on new surfaces where it does real work: guide words in a running head, star-paging inside passages, "Held" before a holding, printed page after every citation.
- **Do** show winners and active states with weight and ink depth.
- **Do** gate every motion behind prefers-reduced-motion.

### Don't:
- **Don't** put oxblood on navigation, link hover, eval bars, headings that do not name a scope, or icons that are not the scope key.
- **Don't** introduce a second accent, or status colours (green, amber, red) for results or refusals.
- **Don't** wrap content in cards, tinted panels, chat bubbles or source chips.
- **Don't** use box-shadows or border radius.
- **Don't** fake small caps; the running head and labels are real uppercase with tracking.
- **Don't** tint any surface other than the spine.
