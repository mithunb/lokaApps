# "What the places say" — version 2 (plan, 5 Nov 2026)

## Why
Mithun (5 Nov): the current summary "is not useful". Every sentence restates one bar
("Of the 40 places that name a material, 25 say Wood"), so it tells the reader nothing
the bars do not.

The first attempt at version 2 answered that with *findings*: the same counts, chosen by
code and written in plainer words, each with a quote. Mithun saw it and changed direction
the same day: "maybe the Wystem approach for insights is not a useful prompt — focus on
writing a short summary or story of the places. Stats are less important because the
questions cover it." So version 2 is a **story**, and the findings code is gone.

## Mithun's decisions (5 Nov 2026)
1. **Shape:** one short paragraph — 3 to 5 plain sentences telling what this map is about
   and what people noticed — then **two short quotes** in the places' own words, each
   linking to its place.
2. **No numbers at all.** No digits, no number words, no words for how many ("most",
   "many", "few", "almost all", "a handful", "half", "often", "all", "every"). The
   questions under the story already show every count.
3. **Each sentence names its places.** The model returns, with each sentence, the ids of
   the 2 to 6 places it draws from. The code checks they exist in what it offered; the
   proofread reads each sentence beside those places' own words and answers and must say
   it is supported, with no benefit of the doubt. An unsupported sentence is dropped.
   Under two sentences left, nothing is shown. If the proofread cannot be had, nothing is
   shown either — never unchecked text.

## Rules kept from today (api/lib/atlas/insight-summary.js, atlas/insight-mode.js)
- A question whose answers are people is never used. Never a tagger's name or id
  (created_by, *_user_id), in the text, in a quote, or in a reason written to a log.
- Under the minimum that passes, show nothing (the card is hidden), never a hedged text.
- Kept with a fingerprint; written again only when the places' words change.
- The quote machinery is the one the findings round built: a quote is a whole sentence of
  the place's own description, never one with a link, an email, a phone number, an
  @handle, a credit line, or anything that place's people columns say, and never words
  that stand on more than SHARED_MAX places (a LOKA space's name copied onto every place).

## The pipeline
1. **The digest, in code** (`IM.storyDigest`): for each place with words of its own —
   `{id, name, words, sentences, answers}`, the answers being the plain labels of the
   questions on show. On a big atlas a sample spread across the answers, a place at a time
   from each answer in turn, capped at `STORY_PLACES` (80). No counts anywhere in it.
2. **The model writes once** (`storyPromptFor`): the sentences with their place ids, and
   two quotes given as `{id, text}`.
3. **The code checks** (`checkStory`): no digit, no number word, no amount word
   (`IM.hasAmountWords`); 2 to 6 ids a sentence, every one of them offered; a quote's words
   must be one of the sentences that place was offered for, and the code puts its own copy
   back; two quotes, two different places, a place the story names first.
4. **The model proofreads once** (`storyProofreadPromptFor`): each sentence beside the
   very places it points at, each quote for a person's name. Missing verdict = dropped.
5. **`writeStory`** puts it together and records the model and the seconds of each call.

## Mocking it up
`deploy/measure-story.mjs` runs the whole pipeline on a local layer and writes
`<name>-story.json`, `<name>-dropped.txt` and `<name>-mock.html` (the real Insight CSS plus
the proposed story CSS) into the folder named by `--out`, and nowhere else. `--model` picks
the model for both calls, `--proofread-model` for the proofread alone; with no key here,
`--ask-dir=DIR` writes each prompt out and waits for an answer file beside it, and the mock
names the model that answered. `--list` prints the atlases that can be mocked up.
Never `deoria-bioregion`, in any spelling.

## Not on the visitor page
None of this is shipped. The live summary is unchanged: `SUMMARY_VERSION` 4,
`writeSummary`, the server's call in `api/apps/atlas.js` and the visitor page are as they
were, and `atlas/insight-mode.js checkSentencesWithReasons` still checks the shipped
sentence exactly as it did.
