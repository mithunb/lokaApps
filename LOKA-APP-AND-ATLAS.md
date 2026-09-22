# The LOKA app and LOKA Atlas, together

**Written for:** another Claude session that needs to understand how places tagged in the LOKA
app become a map somebody can read, and what the Atlas will and will not do with them.

**Written from:** the code in this repository at commit `25f1ca2`, plus checks against the running
site at <https://loka.place/apps/atlas/>. Date of the check: **2026-09-22**.

Everything here was read out of the code or measured against the live site. Where something was
not verified, it says so. Numbers are the numbers in the code.

> **Read this before the older document.** `LOKA-ATLAS-CAPABILITIES.md` sits beside this file. It
> is thorough and still broadly right about the atlas builder, the open-data layers and the size
> ceilings — but it was written on **2026-08-18**, before the whole questions-and-keys feature
> existed, and it does not mention it at all. Two of its statements are now wrong: it says no
> atlas is published through the registry (one is — `cubbon-park-is-this-space-taken`), and its
> picture of what an owner can do predates everything in section 4 below.

---

## 1. What the two things are

**The LOKA app** is where somebody stands in a place and records it. Each record — a *tag* — comes
out carrying a `tag_id` (a UUID), a `description` in their own words, `labels`, `categories`,
`media` (one or more photographs), an `address`, a `status`, and a latitude and longitude.

**LOKA Atlas** is a map-making tool. Somebody picks a region, the atlas builds base layers for it
from open data, and then they add their own places on top. It is manifest-driven: each atlas is a
folder under `atlas/datasets/<slug>/` holding a `manifest.json` (the built base) and a
`manifest.local.json` (everything its owner added or changed). The viewer is `atlas/atlas.js`,
built on MapLibre.

They are **not** wired together. There is no connector, no sync, no API call from one to the other.

## 2. How tags actually get from the app onto a map

The owner exports their tags and **drops the file on the atlas, or pastes a table into it**
(`atlas/ingest.js`, entry points `fromFile` and `fromPaste`; the page is `atlas/add-data/`). CSV,
TSV, GeoJSON, Excel and JSON all work. Up to **5,000 rows and 40 columns**. A workbook with several
sheets asks which one to read, and so does a file mixing several kinds of shape.

**A row reaches the map three ways, and only three.** This matters more than it sounds, because it
is where most files fail:

1. **Its own coordinates.** A latitude and a longitude column. Nothing to decide.
2. **Its name is a boundary the atlas holds.** The name is matched against administrative units —
   for India, 36 states, 735 districts, and 6,822 and 7,143 units at the two finer levels. A cell
   that is not itself a name is read for names it *contains*, so "BRT Tiger Reserve,
   Chamarajanagar district, Karnataka, India" yields a district and a state. Only outright matches
   count inside a sentence; nothing is guessed at there, because a loose version of the same scan
   put the Western Ghats in West Delhi.
3. **An address lookup.** For a place no boundary holds — a neighbourhood, a reserve, a street.
   Two free OpenStreetMap services, twenty lookups a request, five hundred rows at most, biased to
   the atlas's own region. **It places nothing on its own:** it reports what it found in the
   provider's own words and a person ticks what is right. What arrives ticked is decided by
   whether the answer is *named after* the question, never by the provider's confidence — asked for
   "Pan India" it returned a bistro in JP Nagar and graded that **exact**, and asked for a tiger
   reserve it returned a banknote printing press eighty kilometres away and graded that
   **approximate**, the same grade it gave an answer that was right. Precision is not correctness.

**Two things a row can say that have no place on a map**, and the atlas now says so rather than
guessing: a country's own name or a phrase like "Pan India" (counted as covering the whole
country), and another country's name (named as outside this atlas). Before 2026-09-22 a row
reading "India" was placed in **Indi**, a taluk five hundred kilometres from Bengaluru, and
"Bhutan" in **Bhuta**, a village in Uttar Pradesh — the spelling guesser accepts a similarity of
0.85 and those two score 0.86 and 0.89.

**Which column holds the places is chosen, not assumed.** The page offers its best few columns by
what their headings say and the boundary data settles which one is actually read; the answer names
the column it used. A form export had defeated the old rule completely, which took the first
heading containing any of fourteen words — that is "Name", the person who filled the form in, so
twelve people's names went to the boundary data and the page said "no places found" while the
answers to "which geographic areas do you work in?" sat five columns to the right.

The atlas then *recognises* LOKA data by its shape rather than being told: a layer counts as LOKA
if its places carry `tag_id`, `labels` and `description`, and every `tag_id` it samples is a UUID
(`lokaShaped` in `atlas/atlas.js`). When it is, cards are composed rather than listed — the
photographs lead, then the description as a caption, then the keys.

**Three shapes LOKA data arrives in that cost real work to handle.** A session that proposes
anything involving this data should know them:

- **Postgres array text.** `categories` and `labels` arrive as `{Nature}` or
  `{Activities,Nature}` — the database's own way of writing a list. Until 2026-09-13 those braces
  travelled all the way to the map, so a place showed two tags called `{Activities` and `Nature}`.
  Now unwrapped both on the way in and wherever a value is read.
- **Photographs wrapped in records.** `media` is a JSON list of objects, each holding the address
  in a part of its own: `[{"id": "…", "image_url": "https://loka.place/api/images/….jpg"}]`. Not a
  bare link, not a list of links. Every card on one atlas showed no photograph at all because the
  test was "does this value begin with https".
- **A 500-character ceiling on every value.** A place with four photographs needs 529 characters
  in the wrapped form, so the fourth address was cut in half. The column is now flattened to plain
  addresses *before* that cut, which fits four in 326 — but **a layer imported before 2026-09-13
  has already lost the addresses past the cut and must be re-imported to get them back**.

## 3. What the atlas does with the places: the reading

This is the part the older document does not cover, and it is the heart of how the Atlas
visualises LOKA data.

When a layer of places arrives, the atlas **reads** it. A model is shown a digest of the words on
those places and asked what questions this set can answer — not what categories exist, but what a
reader might want to know about any one place. It then answers its own questions for every place.

The result is written onto each place as `pattern_1`, `pattern_2` … with a `pattern_N_why` beside
it holding the words that justified the answer. The question's own wording travels separately, on
the layer, as `keyLabels`; the answers it offers travel as `keyKinds`. A reader therefore meets
*"What can you do here?"* rather than a column called `pattern_3`.

Each question becomes a **key** on the map: a switch that colours and shapes the marks by its
answers. The rules that matter:

| | |
|---|---|
| Questions per layer | **No limit.** A cap of five was removed on 2026-09-13. |
| Keys switched on at once | **Five.** Each wears its own shape and there are five shapes; the stack of key rows under a pin also hangs too low past five. |
| Answers per question | 2 to 7, plus "other" — eight, which is the palette |
| An answer holding fewer than 3 places | folded away; those places become unanswered, honestly |
| Question wording | up to 120 characters |
| Models | `gemini-2.5-flash` finds the questions, `gemini-3.5-flash-lite` answers them |

**A reading is a lottery, and this is the most important thing to know before promising anything.**
Measured over about 90 readings across three maps: a freshly found set of questions comes out good
— two or more questions reaching 60% of places, few places left unanswered — roughly **two times in
five**. Rewording the prompt barely moves this; an approach scoring 83% on one map scored 38% on
another. What did help was judging the second attempt properly: the atlas reads twice when the
first attempt leaves places unanswered, and keeping the better of the two lifts good readings from
about 42% to about 65%. Do not propose "the atlas will find the right questions"; propose that it
finds candidate questions a person then keeps, repairs, or turns off.

## 4. What an owner can do afterwards

Because the reading is uncertain, the repair path matters more than the reading itself:

- **Ask a question of your own.** You write the wording; the model proposes the answers; you see
  how much of the map it covers *before* committing. `/layers/ask`, three steps: kinds, try, keep.
- **Fix a question in place.** Change its wording, drop an answer, or **add an answer the reading
  missed** — then try it and keep or discard. This is what makes a bad reading recoverable: an
  atlas that asked "what kind of place is it?" with no answer for a park had a third of its places
  filed wrong, and hiding the question threw away the two-thirds it got right.
- **Turn a question off** without deleting anything. The answers stay on every place.
- **Rename a layer** by clicking its name.
- **Edit card** and **Remove…** — what a place's card shows, and taking the layer off the map, are
  two separate controls. The ellipsis is load-bearing: Remove opens a question and the keyboard
  lands on "Keep it".
- **Make it private** / **Make it live** — the two states an atlas moves between.

There is deliberately **no** "read it again from scratch" button any more. It existed, and it was a
throw of the dice that took the questions that were right along with the one that was wrong: on
the live map it turned 88/83/74 into 94/26 in one press, with nothing to put back.

## 5. Who can do what

Roles come from `callerRole` in `api/apps/atlas.js`. An **owner** can do everything including
publishing and deleting; an **editor** is invited and may add their own layers and ask questions of
any layer. An atlas can have several owners. Accounts named in `ATLAS_OWNER_EMAILS` own every atlas
on the installation — that is how the operator reaches their own tools from a browser, and it is
worth knowing that it makes a signed-in session carry owner rights over other people's atlases.

Publishing is a separate step from building: an atlas sits at `status: built` until published, and
an unpublished atlas is still reachable by direct link while its record stays private.

## 6. What to check before relying on anything here

- **The owner-side panel has not been exercised in a browser by its author.** Signing in was not
  possible in the sessions that built it. The code and 521 committed checks (`node test/run.mjs`)
  pass, but Edit card, Remove…, rename-by-clicking, the question shelf and the address-lookup
  review list have not been clicked by a signed-in owner. The address lookup's *server* end was
  driven end to end against a real import session; its controls were not.
- **Phone behaviour is simulated, not real.** The panel became a docked rail on screens and a
  bottom bar on phones on 2026-09-13; safe-area insets were emulated, drag was mouse-driven, and
  Safari's collapsing URL bar was never seen.
- **One atlas is published** (`cubbon-park-is-this-space-taken`, 33 tags in Cubbon Park). Treat
  Atlas as working software with one live tenant, not a populated platform.
- **The region step cannot express a whole country.** Levels run 1 to 4 — states down to
  localities — with nothing above. You pick a country, then places inside it; there is no single
  choice meaning "all of India". A national atlas would mean adding all 36 states by hand, and a
  build of open-data base layers at that scale has never been attempted here.
- Deployment is manual: someone runs `deploy/deploy.sh`, which fast-forwards the server and
  restarts it. The live site can lag this commit.
