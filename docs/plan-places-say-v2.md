# "What the places say" — version 2 (plan, 5 Nov 2026)

## Why
Mithun (5 Nov): the current summary "is not useful". Every sentence restates one bar
("Of the 40 places that name a material, 25 say Wood"), so it tells the reader nothing
the bars do not. Wystem's Data Story pipeline (wystem repo,
docs/architecture/data-story-pipeline.md) shows a way to say more without letting the
model invent numbers.

## Mithun's decisions (5 Nov 2026)
1. **Quotes: yes.** The places' own words (their descriptions) may be quoted.
2. **Shape: a few sentences AND findings.** A short summary on top (2–3 sentences), then
   3–5 findings, each with a count and a quote from a place.

## Rules kept from today (api/lib/atlas/insight-summary.js, atlas/insight-mode.js)
- The code counts; the model only writes. Every number in the text is checked against a
  cell the code worked out, as a pair (K of N together), never a loose number.
- A question whose answers are people is never used. Never a tagger's name or id
  (created_by, *_user_id), in the text or in a quote.
- Under the minimum that passes, show nothing (the card is hidden), never a hedged text.
- Kept with a fingerprint; written again only when the answers change.

## What changes
1. **A richer digest, in code.** Besides each question's answer counts (with the N each
   is out of): the pairs of questions that pass the compare rule, and **quotes** — for
   each answer that is worth a finding, a few places' own description sentences, picked by
   code (spread across answers, short, trimmed to a sentence, never a person's name or
   contact detail, never the tagger columns). Each quote carries its place id.
2. **The model writes** a summary (2–3 sentences, plain words, at most one number each)
   and 3–5 findings. A finding = a one-sentence claim + its cell (questions, answers,
   count, of) + 1–2 quotes chosen from the digest by id.
3. **Checks, in code, before anything is kept**
   - every number: the existing exact-cell check (pairs, not loose numbers);
   - every quote: must be verbatim from the offered set, by place id (the model may not
     edit a quote; the code re-inserts the exact text by id);
   - a finding whose cell fails is dropped whole, with its quotes;
   - the summary: a sentence with an unheld number is dropped; if the summary is empty,
     or fewer than 2 findings survive, nothing is shown;
   - the proofread step stays (each finding read beside its fact).
4. **On screen (Insight mode, "What the places say")**: the summary, then the findings,
   each with its count shown as "K of N places" and its quote in the place's words, with
   a link to that place on the map. A finding whose count cannot be backed shows no count.
5. **Data-quality warning, computed in code**: when many places say nothing, or many
   descriptions are identical or near-empty, a plain line "Many places have little written
   about them, so read this with care" — and no findings that rest on them.
6. **Too few places** (≤ 10 with words): no summary, as today's few-places rule.

## Not copied from Wystem
Its three analyzer modes, the PDF path, the long 6-section report (Atlas needs the short
layer only), the vector-store claim verification (quotes are checked by id instead).

## Order of work
Fable review of this plan → a mock-up on two atlases (e.g. Emergence and Cubbon Park; one
public-words, one research), shown to Mithun before any deploy → build (tests: fabricated
pair dropped, edited quote dropped, tagger name never quoted, deoria never touched) →
Mithun's yes → deploy → every summary written again once (SUMMARY_VERSION bump).

## Open questions for Mithun (after the mock-up)
- Should a visitor be able to tap a quote to open that place? (proposed: yes)
- Research-mode atlases: same text, or more precise wording?

## After the Fable review (5 Nov 2026) — these replace the matching parts above
- **Digest in code** (atlas/insight-mode.js, beside summaryTables): notable pair cells
  (one answer holds ≥60% of a row) and contrasts between rows worked out in code, not left
  to the model; quotes per top answer and per notable cell (≤3 each); quality shares. The
  fingerprint covers the quotes too, so an edited description is never quoted stale.
- **Where quotes come from:** the column each question was read from
  (layer.keyColumns), else the place's longest free-text column. Best quote = the
  description sentence holding that place's own evidence words (pattern_N_why, already
  checked verbatim). Code drops sentences with an email, phone, link or @handle, credit
  lines, and any sentence holding a value from that place's people columns (one wider
  people rule, shared; today's misses a column named "creator"). The proofread also asks
  "does this quote name a person?", as the backstop for names in running prose.
- **Quote check:** an id must belong to the set offered for THAT finding's cell (a pair
  finding: a place giving both answers); "says nothing" findings get no quote; the text is
  re-inserted by the code and checked again before it is shown.
- **One write + one proofread**, as today; about the same wait.
- **Fixes to this plan:** "shows no count" (item 4) is dropped — a finding that cannot be
  backed is not shown at all; the few-places number is the one already in insight-mode.js
  (8), not a new 10; findings hidden with their question when the owner turns it off;
  logs keep place ids, never quoted words; pasted tables have no place id, so the place's
  position in the layer is used, guarded by the fingerprint; tapping a quote to open its
  place is a new control and is mocked up first.
- **Mock-up:** only blr-finds-test is on this computer. A second real atlas must be
  copied (read-only) from the server into api/data/atlas/private-datasets/ to measure on
  two maps (deploy/measure-summary.mjs, extended to print findings and quotes).
