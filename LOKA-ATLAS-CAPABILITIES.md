# LOKA Atlas — what it can and cannot do

**Written for:** a model drafting a project proposal that would use the LOKA app and LOKA Atlas.
**Written from:** the code in this repository at commit `449837d`, plus checks against the running
site at <https://loka.place/apps/atlas/>.
**Date of the check:** 2026-08-18.

> ## Read this first: this document is a snapshot, and it has aged
>
> Everything below was true and carefully verified on **2026-08-18** at commit `449837d`. It has
> **not** been re-verified since. The repository is at `25f1ca2` as of **2026-09-22**, five weeks
> and a great deal of work later, and some of what follows is now wrong.
>
> **`LOKA-APP-AND-ATLAS.md`, beside this file, is current.** Read it first. It covers the whole
> questions-and-keys feature, which did not exist when this was written and which this document
> therefore does not mention at all.
>
> The three statements below are known to be wrong now. Treat the rest as a careful record of
> 2026-08-18 rather than as a description of today.
>
> 1. **"Turning addresses into coordinates … Nothing imports it … Do not propose this as working."**
>    It has a caller as of 2026-09-22. A table with an address column and no coordinates can now be
>    placed by address: the lookup reports what it found and a person ticks what is right before
>    anything reaches the map. See section 2 of the current document.
> 2. **"The platform's list of published public atlases is empty … no live tenants yet."**
>    One atlas is published — `cubbon-park-is-this-space-taken`, 33 tags in Cubbon Park.
> 3. **"Everything in sections 3 to 12 … is live today."** The owner's side of the product was
>    rebuilt in September: the panel, the controls on it and their wording, and the whole business
>    of a layer answering questions. Sections describing owner-side screens should be checked
>    against the code before being relied on.

Everything below was read out of the code. Where the code and the on-screen wording disagree, the
code wins and the disagreement is named. Where something could not be confirmed, it says so in
bold. Numbers are the numbers in the code, not the numbers in the help text.

**How current this is.** All the browser-side files were fetched from the live site and compared
byte-for-byte with this commit: `atlas.js`, `index.html`, `databench.js`, `iconkit.js`, `share.js`,
`edit/index.html`, `setup/setup.js`, `setup/catalog.json`, `add-data/index.html`,
`admin/index.html` — **all identical**. So for the browser side, live = this commit. The
server-side code cannot be diffed remotely; instead its behaviour was probed and matched what this
commit predicts (the size ceilings it reports, and 27 open-data layers offered for India vs 15 for
the United States). Deployment is manual (someone runs `deploy/deploy.sh`, which does a
fast-forward `git pull` on the server and restarts the process). There is no automation, so the
live site *can* lag this commit at other moments — it just does not right now.

**One live-service fact worth knowing before proposing anything.** *(Out of date — one atlas is
published as of 2026-09-22; see the note at the top.)* As of the check, the platform's
list of published public atlases is **empty**. Two sample atlases are on disk and openable by
direct link (`deoria-bioregion`, `basket-sample`), but no atlas is currently published through the
registry. Treat Atlas as working software with no live tenants yet, not as a populated platform.

---

## 1. What Atlas is for

Atlas is a self-serve tool for an organisation to publish one web map of one region: it builds a
starting map for the region out of open data, then lets the organisation upload its own tables of
places on top and decide how they are drawn.

What the publisher gets is a hosted map page at a web address of its own, carrying its name, logo
and credits, with a layer switcher, a search box, clickable places, a share link, an embed snippet
and a QR code.

The people who publish with it are small organisations, projects and coalitions working in one
geography — the code is written around "several organisations working one landscape pool their data
on a single atlas".

---

## 2. Live today / built but not deployed / designed, not built

### Live today (in this commit and on the running site)

Everything in sections 3 to 12 of this document, unless a paragraph says otherwise.

### Built but not reachable

- **Turning addresses into coordinates.** ~~`api/lib/atlas/geocode.js` is a complete, careful
  module … **Nothing imports it.**~~ **No longer true — wired in on 2026-09-22.** The module is as
  described (two free OpenStreetMap services, a shared queue, a permanent cache, a confidence mark
  per address, and a check that flags several different addresses landing on one identical point),
  and it now has a caller: `/layers/locate` looks addresses up and reports them, `/layers/locate/keep`
  writes the coordinates of the rows a person ticked. Its confidence mark turned out **not** to be
  usable as the gate — it graded a wrong answer and a right one identically — so what arrives ticked
  is decided by whether the answer is named after the question.
- **Private atlases.** The server can make an atlas private, mints a view key for it, moves its data
  outside the web root, and serves it behind that key. But no screen in the shipped product creates
  a private atlas or shows a view key: the setup wizard never sends a visibility choice (so the
  server defaults to public), and the editor's settings sheet has no public/private control.
  Private is an API-only capability today. Two further consequences, read from the code and **not
  observed at runtime**: (a) the routes that accept uploaded data resolve the atlas only inside the
  public data folder, so a private atlas would refuse an upload with "unknown dataset"; (b) the
  editor builds its own data paths without the key, so a private atlas would probably fail to open
  in the editor.
- **A prettier web address.** `/apps/atlas/a/<slug>` exists, but only as a redirect to
  `/apps/atlas/?dataset=<slug>` — the tidy form never stays in the address bar, and the dev-server
  version of the redirect drops any `?key=`.

### Designed, not built

Six mock-up pages sit in the repo uncommitted. They are design studies, not features. Nothing in
the product loads them. If a proposal wants any of these, it is proposing new work:

| File | What it proposes |
| --- | --- |
| `atlas/rows-mock.html` | Rows of small shapes beside a pin, and clickable words that light the map |
| `atlas/noticings-mock.html` | The words people wrote, offered as tappable chips beside the search box |
| `atlas/tags-mock.html` | "Places like this one" beside each place, and all the written words sorted into families |
| `atlas/many-keys-mock.html` | More than two colour keys on one layer at real map density |
| `atlas/marker-mock.html` | A plain pin whose body could carry the keys |
| `atlas/edit-layer-preview.html` | A prototype of the "change a layer" screen |

Note that "more than two keys" and the badges around a pin **did** ship (five keys, see §7) — the
mock is the study that preceded it, and it is now behind the shipped behaviour.

---

## 3. The publishing path

Four screens, in this order. Sign-in comes first and is not optional.

### Sign in

Type an email, receive a **six-digit code**, type the code. Not a click-this-link email — the code
is what the live flow uses. The code lasts 10 minutes, is single-use, and dies after 5 wrong tries.
Five code requests per internet address per hour. The sign-in lasts **30 days** (a cookie named
`atlas_session`).

### Step 1 — Identity (`/apps/atlas/setup/`)

Asks for: **atlas title** (required, up to 80 characters), **the organisation or project this atlas
belongs to** (required, up to 60 characters), and an optional one-line description (up to 160
characters). Both required answers are checked before the step will advance.

### Step 2 — Where

A country dropdown (**249 countries**, India pre-selected) and a **type-and-choose place box** — not
a country → state → district drill-down. Typing two or more letters searches the boundary source
across administrative depths 1 to 4 and returns up to 8 ranked suggestions, each labelled with what
it is and what contains it ("district · Karnātaka, India"). Matching is exact, then
starts-with, then approximate, and each is tried against alternative spellings, so typing
"Bengaluru" reaches data that says "Bangalore" — and when it does, the suggestion says so
("listed as Bangalore in the boundary data"). Chosen places become removable chips.

One rule the screen enforces silently and then explains: **every unit in one atlas must come from
one administrative depth.** If you add a district and then a state, the broader one is dropped and
you are told why.

### Step 3 — Open data

Shows the layers available for the chosen country, grouped into four collapsible groups. Boundaries
and place names are stated as always-included rather than shown as checkboxes you may not untick.
Everything else is a checkbox. A running count reads "N open-data layers will be added." Layers
needing operator approval are marked "needs approval".

### Step 4 — Build

One button, then a progress bar with a live message and a running log. The atlas is built by a
Python job on the server, one job at a time in a queue. On success the screen offers a link into the
editor.

### After the build — the editor (`/apps/atlas/edit/?dataset=<slug>`)

The editor wraps the *real* map in a frame and puts one panel beside it. The panel lists: the
basemap choice (Map / Satellite), the region row, **Your data** (uploaded layers), **Open data**
(catalogue layers), and an **Add data** button. Every layer has a show/hide checkbox. **Only
uploaded layers can be opened and changed** — catalogue layers wear a small "open data" lock and can
only be switched on and off.

Opening an uploaded layer asks **three questions**, in this order:

1. **Layer name** (up to 60 characters).
2. **One colour question, whose wording follows what the layer draws** — "Colour places by" for pins,
   "Shade areas by" (plus a "Colour ramp" chooser) for shaded areas, "Size circles by" for circles,
   or a plain colour swatch labelled "Line colour" / "Fill colour" / "Which colour". The column list
   is annotated with how many different answers each column holds ("categories — 9 kinds").
3. **Call each place by** — which column supplies the name shown on hover and in the popup.

Between questions 2 and 3 the live map key is shown as *output*, with per-kind counts. Below sits
"Remove this layer from the atlas…". Changes are held until you press **Save changes**; a note reads
"Only you see this until you save."

There is **no shape question in the editor**. What shape a layer draws is decided once, when the
data is first added, and cannot be changed afterwards without removing and re-adding the layer.

The top bar carries **Make it live / Take it off**, **Share** and **Settings**. Settings holds:
region (with "Rebuild with this region"), identity (title, purpose, organisation website), "Who can
edit it" (invitations, owner only), and a delete armed by typing the atlas's web address.

---

## 4. Getting data in

Reached from the editor's **Add data** button (`/apps/atlas/add-data/?dataset=<slug>`). Four steps:
drop a file → **Check your table** → **Where are these located?** → **How it looks**.

### File types

The picker accepts `.csv .tsv .xlsx .xls .json .geojson .kml .gpx`. All eight really parse. Reading
is by looking at the file's first bytes, not by its name, so a mislabelled file usually still works.
Character sets: UTF-8 first, retried as Windows-1252 if that produces garbage.

Two honest gaps:

- **Zipped shapefiles are refused**, on purpose, with a message telling you to export from QGIS
  instead. They are not in the picker but a drag-and-drop reaches the refusal.
- **A `.kmz` (zipped KML) produces the wrong error message** — "Couldn't read that Excel file". KML
  is advertised; its zipped sibling misfires. Small, but it will confuse people working on site.

### Size and count limits

| Limit | Number | Where enforced |
| --- | --- | --- |
| One file | **25 MB** | in the browser, before parsing |
| Rows kept | **5,000** | browser and server both |
| Columns kept | **40** | browser and server both |
| Shapes kept from a map file | **5,000** | browser |
| Characters kept per cell | **500** | server |
| Total shape corner points | 150,000 in the browser; 300,000 on the server | simplification, then a hard stop |
| Upload request body | **10 MB** | server, on the upload route only |
| Every other request body | **2 MB** | server |

Rows and columns past the limit are **silently trimmed and then reported**, not rejected. The drop
zone says "up to 5,000 rows / points, 25 MB" and does **not** mention the 40-column ceiling, which
is real.

One mismatch worth planning around: the **Find themes** step posts up to 5,000 rows of the chosen
description columns, but that route is served under the **2 MB** body limit, not the 10 MB one. A
table with long descriptions can therefore sail through the upload and then fail on theme-finding.
**Not observed at runtime — read from the code.**

### One file at a time

**No multi-file upload.** The picker has no multi-select, and both the drop handler and the picker
handler take only the first file. A multi-file drop silently ingests one and discards the rest with
no message. **One file becomes one layer. There is no merge.** A file holding a mix of points and
areas must be uploaded once per shape kind, which the screen tells you to do.

There is **no cap on how many layers an atlas may hold** — the limits are per upload, not per atlas.
Half-finished uploads expire after 24 hours.

### Paste a table

Yes, behind a fold: "…or paste a table (from Excel / Sheets)". It accepts tab-separated and
comma-separated text alike (the separator is auto-detected). **It has no size limit of its own** —
the 25 MB check lives on the file path and is never reached by paste. Only the 5,000-row and
40-column ceilings apply. Pasting something enormous will try to parse it in the browser tab.

### How places get located — three ways, not two

1. **The file already carries shapes.** GeoJSON, KML and GPX bring their own geometry; nothing is
   matched or guessed.
2. **Coordinate columns in the table.** Auto-detection needs the column name to contain `lat` /
   `lon` / `lng` **and** the numbers to be in range — or, with no name hint at all, the numbers to
   fall inside India's box (6–38 north, 68–98 east) with more than three different numbers. A table
   from outside India with unhelpful column names will need the columns picked by hand, which the
   screen allows. There is a swap-correction, but it only fires when latitude exceeds ±90 while
   longitude does not, so **the common Indian case of a genuine swap goes undetected** (both numbers
   are inside ±90). Bad or missing coordinates put the row on a "bad coordinates" list.
3. **Matching place names to boundary shapes.** The screen asks for a **place-name column**, what to
   **match against**, and an optional **parent column** (district / state) to tell apart same-named
   places. What you can match against is: the atlas's own boundary layers that carry a `name`
   property, plus geoBoundaries units **one and two depths finer than the atlas's own depth** (never
   coarser, never deeper than depth 4). A depth holding more than **4,000** units in the region is
   skipped silently, so a district with more than 4,000 villages offers no village level.

   Name matching normalises hard: accents stripped, lower-cased, and **every digit and every
   non-Latin letter deleted**. So "Ward 12" and "Ward 7" become the same word, and a name written in
   Devanagari becomes nothing at all. Then: exact, then parent-scoped exact, then approximate
   (character-pair overlap; candidates from 0.5, auto-accepted at 0.85 with a clear margin).
   Everything else lands on a **"Needs your eye"** list where a person picks the right boundary or
   skips the row. That list shows at most **60** rows even when more need attention, though the count
   above it is honest. **A skipped or unmatched row produces no place and vanishes from the layer** —
   there is no "put it on the map anyway".

   Two side effects to know: a matched row's own name column is **overwritten** with the boundary's
   name; and for pins the matched area is collapsed to the middle of its bounding box, which for a
   crescent-shaped district can land outside the district.

### Where an AI model is involved in reading a table

Google Gemini, when a key is configured on the server. It never places rows; it pre-fills the
pickers a person then confirms.

- **Guessing the setup** from the column summaries plus **the first 30 rows verbatim**, the map's
  bounds, and the list of things it could match against. Its answer replaces the plain-code guess.
- **Breaking ties** on ambiguous name matches, but only when there are 40 or fewer, and only ever
  choosing from that row's own candidate list.
- **Finding themes** (§9).

Rate limit: **30 model calls per internet address per rolling hour**. Two holes in it, both read
from the code: the tie-breaking pass does not check the limit at all, and one theme-finding
allowance can spend up to ~126 calls (one to invent themes plus one per 40 rows to file them). So
that number bounds neither total calls nor cost.

If no key is configured, everything above is skipped and the plain-code path is used. Nothing
breaks.

---

## 5. Open data layers it can build for a region

The catalogue (`atlas/setup/catalog.json`) holds **28 layers**. Availability depends on country, in
two tiers decided by one line of code: **India gets the enhanced tier, every other country gets the
baseline tier.** There is no third tier and no per-country configuration.

- **Baseline (any country): 15 layers.**
- **India: 27 layers.**
- One layer is baseline-only (`water-osm`, rivers from OpenStreetMap — India gets a better one).
- 13 layers are India-only.

Verified live: asking for India returns 27, asking for the United States returns 15.

Four groups: **Boundaries & basics** (7), **Ecological landscape** (9), **Context & infrastructure**
(6), **People & services** (6). Some carry a sub-heading (Water, Climate, Access, Facilities,
Forests, District indicators).

A representative sample:

| Layer | Where | Source |
| --- | --- | --- |
| Admin boundaries (**always included**) | everywhere | geoBoundaries, or India's Local Government Directory |
| Place names (**on by default**) | everywhere | Esri / CARTO |
| Roads & streets, Buildings | everywhere | OpenStreetMap via Protomaps, streamed live, no build time |
| Terrain & elevation | everywhere | Copernicus 30 m elevation model |
| Annual rainfall | everywhere | CHIRPS, about 5 km |
| Forest cover & loss | everywhere | Hansen / UMD, 30 m |
| Land use / land cover | everywhere | ESA WorldCover 2021, 10 m |
| Travel time to healthcare | everywhere | Malaria Atlas Project, about 1 km |
| Schools & colleges, Health facilities | everywhere | OpenStreetMap humanitarian export |
| Blocks / sub-divisions | India only | Local Government Directory |
| Rivers & canals, Wetlands, River sub-basins | India only | India-WRIS |
| Lok Sabha constituencies | India only | DataMeet |
| Four district indicators from NFHS-5 (institutional births, women's literacy, clean cooking fuel, child stunting) | India only | NFHS-5 district tables |
| Agro-ecological zones, Reserved & protected forests, Wasteland | India only | ICAR, Survey of India, ESA WorldCover |
| Floodplain (observed flooding 1998–2022) | India only | ISRO NDEM — **the one layer that needs operator approval** (about 100 MB of source data) |

Estimated build times in the catalogue run from 1 second (the streamed layers) to 180 seconds (the
floodplain). Every layer carries its own credit line, and credits appear on the published map.

Two basemaps ship with every atlas: **Map** (CARTO light, the default) and **Satellite** (Esri World
Imagery). The built map's top zoom is 15.

---

## 6. Regions

- **Countries offered:** 249.
- **Administrative depths:** 1 to 4 (roughly states, districts, sub-districts, localities — the
  words are display-only labels; a country whose boundary source lacks a depth simply does not offer
  it). Depths come from geoBoundaries' open release.
- **One atlas is built at one depth.** Mixing depths is refused and explained.
- **Up to 100 units** may be chosen for one atlas (anything beyond the hundredth is dropped without
  a message).
- **Size ceiling.** Measured as the area of the **bounding box** around the chosen units, in square
  degrees — not their true area, so a scattered handful of units can measure far larger than the land
  they cover. Above **6 square degrees** (the code calls that roughly 73,800 km²) the build stops and
  waits for the operator, who gets an email with approve and deny links. Above **40 square degrees**
  (roughly 492,000 km²) it is refused outright: "That region is larger than a single atlas can cover
  right now — open a unit on the map and pick smaller areas inside it." Both numbers can be changed
  by an environment setting on the server; the live server reports the defaults, 6 and 40.
- **Changing the region later** rebuilds in place, with no downtime for a live atlas (the new data
  only replaces the old on success). But **any region change that would newly need approval is
  refused outright**, with a message telling you to email the operator. So an atlas cannot grow past
  the free ceiling through the editor at all.
- **Platform ceilings:** at most **50 atlases in total** across all accounts, and **3 new atlases per
  internet address per day**. Both are environment settings. The 50 is a whole-platform number, not
  per account — worth checking with the operator before proposing anything that would create many
  atlases.

---

## 7. How data is shown on the map

### Colours and keys

A "key" means: colour the places of one layer by the answers in one of its columns.

- **Up to 5 keys can be on at once on one layer.** The pin itself carries the first; the other four
  sit at the pin's four corners as small marks — square, triangle, diamond, bar. Turning on a sixth
  is refused with: "Five keys are already on — the pin's four corners are all taken."
- **Colour says which kind within a key; shape says which key.** Colours repeat between keys, on
  purpose: a measurement in the code shows that splitting the palette between keys collapses to
  near-identical colours for someone with colour-blindness.
- **8 colours plus a grey "other".** The eight are Paul Tol's muted set:
  `#332288 #999933 #44AA99 #AA4499 #117733 #882255 #88CCEE #DDCC77`, with `#7a756c` for "other".
  They were checked by simulating red-green colour-blindness; the closest pair stays about 15 units
  apart on a perceptual scale. Rose was deliberately left out because it collides with the grey.
- **When a column has more than 8 kinds**, the 8 commonest keep their colours and the rest fold into
  the grey "other" row. Nothing is refused and no colour repeats within a key.
- A place that left the column blank keeps its row in the key, greyed, reading "left blank".

**What qualifies a column to be a key.** Judged on its contents, not its name:

- at least **2** different answers;
- at most **9** different answers for a one-answer-per-place column, or **12** different *first*
  answers for a column holding lists;
- the kept kinds must cover at least **60%** of the layer's places (blanks count against this);
- every kept kind must read as a word — a column of numbers, links, ID strings or timestamps is
  refused, because any one bad kind disqualifies the whole column;
- answers are cut to 40 characters.

One inconsistency, verified: the **editor** only offers columns with up to **8** different answers as
the "Colour by" choice, while the **map** will accept up to **9**. A column with exactly 9 kinds can
become a key by tapping it on the map but will never appear in the editor's dropdown.

**A hard structural limit.** Keys, pins, badges and per-place icons only exist on layers drawn as
pins, and a point layer becomes pins only when it has **300 or fewer** places. Above 300 the layer is
drawn as plain flat circles — no keys, no badges, no icons. **If a proposal needs the key system, it
needs layers of 300 places or fewer.**

Colour ramps for shaded areas: 7 ramps of 6 steps each (Greens, Blues, Rust, Sand to brown, Brown to
teal, Teal to brown, Purples). Red-to-green was retired because its middle steps were
indistinguishable to colour-blind readers. Five named single colours: rust, moss, ochre, sienna,
slate.

### Grouping nearby pins, and separating pins on top of each other

- Pins closer than **20 pixels** group into one numbered circle; **40 pixels** when the layer is
  wearing more than one key (the badges make each pin wider). Grouping applies at every zoom below
  the map's top zoom.
- The numbered circle grows in three steps: radius 13 under 10 places, 17 for 10–49, 22 for 50 and
  up; it darkens at the same thresholds. Hovering it outlines where its members are and says
  "N places here". Clicking zooms in.
- When zooming in cannot separate them — places at genuinely identical coordinates — the pins **fan
  out** around the spot instead: a ring for up to 8, a spiral beyond, keeping **28 pixels** apart
  (**44** when badges are on), up to **100 pins**. Beyond 100 the fan stops.

### Popups and hover

- Clicking a place opens a popup up to 320 pixels wide: the title, then one row per active key, then
  the chosen columns. **At most 6 columns plus one photo plus the title.** When Atlas picks the
  columns itself it picks **5**, skipping the title, the photo, coordinates and anything that looks
  like an identifier.
- A photo column is detected only when at least **60%** of its entries are single `https` links
  ending in `.jpg/.jpeg/.png/.webp/.gif`. Only one photo per place is rendered, and a broken link
  hides itself.
- Columns separated by semicolons render as small chips. Comma-separated ones stay plain text.
- Hovering a place shows a small bubble: its name and one line per active key, which is how the
  badges are decoded. **Hover is switched off entirely on touch screens** — there the popup does that
  job.
- **There is no cap on how many rows a popup or a key panel renders.** With five keys on, the key
  panel can reach about 50 rows. Verified absent from the code; plan for it if you propose many keys.

---

## 8. Search

There is one search box, and it works in two layers.

**Word matching, always, in the browser.** Typing two or more characters hides every place whose
text does not contain what you typed, and reports "N of M places". The text searched is every
readable column of the place joined together, with identifiers, links, coordinates, colours and
timestamps left out. This needs no server and no AI, works on any atlas including one nobody has
published, and is instant.

**Related words, from the server.** A quarter-second after you stop typing, the browser asks the
server for words already in the layer that share text with what you typed, and widens the search to
those too. So typing "shadow puppet" can reach a "shadow-theatre" chip that no place spells out.
This needs the server but no AI. Up to 24 extra words.

**Meaning-based matching.** With an AI key configured on the server, every place's text is turned
into a numeric summary of what it means, stored in a small side-file next to the layer
(`search-<layerId>.vec`). A search turns the typed words into the same kind of summary and keeps
places whose meaning is close enough (a similarity of 0.50 or better), whether or not any word is
shared. Written and applied by `embedAndStoreVocab` and the search route.

The conditions, plainly:

- It needs **an AI key configured on the server**. Without one, nothing is built and search stays at
  word matching. Nothing breaks and nothing is announced.
- It needs the atlas to live in the **public data folder**. The route resolves an atlas only there,
  so **a private atlas gets word matching only** — the server returns an empty answer for it.
- The side-file is built **in the background, after the fact**: the first search on a new layer
  triggers the work and answers with word matching alone; later searches get meaning matching. A
  5,000-row layer is about 50 batched calls. Editing or re-adding a layer invalidates the file and
  the work is redone.
- The similarity threshold of 0.50 was chosen by reasoning, not measured on real traffic — the code
  says so.
- It never *narrows* a search. Word matches and meaning matches are added together.

---

## 9. Finding themes from a place's own words

One button in the add-data flow, labelled **Find themes**: "Reads every place's description and tags,
then suggests a few themes that run through them."

**What it does.** It builds one line per place from the description and tag columns you tick, sends
those to Gemini, and asks for the few real themes that run through them — "in everyday words a
stranger reading the map key would understand". Then a second pass files **every** place into exactly
one theme or into "other". Filing never samples; theme-invention samples only above 400 described
places (an even-spaced sample of 400 plus a count of repeated tags so the aggregate signal survives).

**What it touches.** It proposes **one new column, named `themes`.** If a column called `themes`
already exists it becomes `themes_2`. **It never changes, rewrites or deletes any uploaded column.**
The screen says so: "Keep adds them as a new column below — your original columns are unchanged." The
same is true of the underlying code (`ensureColumn`).

**The keep-or-discard gate.** Nothing is saved until a person presses **Keep** or **Discard**. Keep
writes the theme set to the atlas so that later uploads are filed into the *same* themes rather than
new ones. Discard clears the remembered set so the next attempt starts clean. Themes remembered from
an older, retired flow are deliberately ignored — only a set a person explicitly kept counts.

**Its refusals.** A refusal is a result, not an error, and there are five distinct ones:

| What comes back | When | What the screen says |
| --- | --- | --- |
| `too_thin` | fewer than **8** places have any words | "Too few places have descriptions or tags to find themes in." |
| `no_clear_themes` | the model itself declines, with one plain sentence why | "No clear themes here: …" |
| `refused` | the deterministic quality gate rejects the answer | "The themes that came back didn't hold up — …" |
| `unavailable` | no AI key, or the call failed | nothing is invented |
| `themes` | it worked | the themes are offered as chips with counts |

The quality gate is worth quoting, because it is what makes the result trustworthy. Before a person
sees anything, themes are dropped when the name repeats a word from the atlas's own title (true of
every place, so it separates nothing), near-duplicates another theme, cites fewer than three real
places as examples, or is "other" or a column's own name. Then, on the real counts: a theme covering
fewer than 3 places folds into "other"; the whole answer is refused if fewer than 2 themes survive,
or if one theme covers more than 60% of described places, or if "other" covers more than 40% of them
(or more than the largest theme).

Between **2 and 7** themes, plus "other" — which is exactly the 8-colour palette.

**What it is not.** It is not tagging, not categorising against a fixed list, and not a keyword
clusterer. A keyword version existed and was deleted: on real data it produced the city's own name
and a stray verb as "themes", and could never say "these places don't split".

---

## 10. Working with other people

The owner can invite editors by email from the editor's settings sheet. **Up to 20 collaborators per
atlas.** The invitation email tells the person to sign in at the setup page with that email address,
after which the atlas appears under "Your atlases".

| | Owner | Invited editor |
| --- | --- | --- |
| Change title, description, organisation, logo | yes | yes |
| Change the region and rebuild | yes | yes |
| Add and remove open-data layers | yes | yes |
| Upload new data layers | yes | yes |
| Open and restyle an uploaded layer | any layer | **only layers they added themselves** |
| Make the atlas live | yes | yes |
| Take the atlas off the air | yes | **no** |
| Invite or remove collaborators | yes | no |
| Delete the atlas | yes | no |

There is no third role, no read-only role, and no per-layer permission beyond "who added it".

---

## 11. Publishing, sharing, embeds, privacy

- **Public or private.** Public is the default and, today, effectively the only option through the
  screens (see §2). A public atlas's data is plain static files under
  `/apps/atlas/datasets/<slug>/`. A private atlas's data is moved outside the web root and served
  only to someone holding its view key, with `noindex` set. The key is shown **once**, in the reply
  to the call that created or changed the atlas, and never again — only a hash of it is stored.
- **Live or not live.** "Make it live" requires being signed in and the atlas to have finished
  building. "Take it off" returns it to built: the data stays exactly where it is, it stops being
  listed, and it stops answering to anyone not invited. Owner only.
- **Sharing.** The viewer's Share dialog gives: the link with a **Copy link** button, a **QR code**
  drawn in the browser with a **Download PNG** button, offered for posters and flyers, share
  buttons for WhatsApp / X / email, and an **embed snippet**. The exact snippet:

  ```html
  <iframe src="URL" width="100%" height="620" style="border:1px solid #F1E7CC;border-radius:6px" title="TITLE" loading="lazy"></iframe>
  ```

  Note the snippet embeds the **current address as-is** and does not add `embed=1`, so an atlas
  embedded straight from that snippet carries the full page furniture. A proposal wanting a clean
  embed should hand-edit the address (below).

  A private atlas gets no QR, no social buttons and no embed snippet — just the link and a warning
  that the link contains the key.

  Separately, the **editor's** Share button is a simpler sheet of its own: one sentence, the link,
  and "Copy the link". It has no QR, no embed and no social buttons — and, verified in the code, it
  omits the view key, so for a private atlas the editor hands out a link that will not load.
- **Embed modes** (add to the address):
  - `?embed=1` — hides the site header, the "build your own" call-to-action and the site footer.
    The atlas's own title, credits and map stay.
  - `?embed=map` — nothing but the map, filling the frame. No title, no credits, no attribution
    strip.
  - `?panel=0` — the map stays, the layer panel goes, on the understanding that the surrounding page
    takes over the panel's jobs (basemap, search, key) through same-origin messages. This is how the
    editor frames the real viewer.
  - These combine: the editor uses `?dataset=<slug>&embed=map&panel=0`.
  - Inside any embed mode the Share button and the owner's own buttons are **removed from the page**,
    not merely hidden.
- **Taking it off the air** is `Take it off` (above), or delete. Deleting removes the data folder
  from both roots, removes the registry entry, and removes every account's reference to it. It is
  armed by typing the atlas's web address and it is not reversible.
- **Web addresses in use:** `/apps/atlas/` (home), `/apps/atlas/?dataset=<slug>` (a map),
  `/apps/atlas/?dataset=<slug>&key=<viewKey>` (a private map), `/apps/atlas/setup/`,
  `/apps/atlas/edit/?dataset=<slug>`, `/apps/atlas/add-data/?dataset=<slug>`, `/apps/atlas/admin/`,
  `/apps/atlas/create/` (a landing page). `/apps/atlas/layers.html` is retired and redirects.
- **Signing in is not needed to view a public atlas.** It is needed to create, build, publish, add
  data or change anything.
- **The home page** lists a featured atlas plus every atlas published through the registry. Right
  now that registry list is empty (§ intro).

---

## 12. Operator view

`/apps/atlas/admin/` — titled **"Every atlas"**, sub-titled "every account, public and private".

It shows a totals line (how many atlases, how many live, how many private, how much disk, plus
awaiting-approval and failed counts when non-zero), a filter box, and a sortable table:
**Atlas** (title and web address), **Owner** (account and organisation), **Status**, **Visibility**,
**Region**, **Layers**, **Editors**, **Size**, **Created**, **Published**, and links to open or edit.

**It changes nothing.** The page only reads. The server route behind it is deliberately read-only
and hands back a fixed short list of safe items — never the edit token, never the view key hash,
never the creator's internet address, never the build recipe. Acting on any atlas still goes through
the normal owner checks.

**Who can see it:** either a caller holding the operator's secret token, or a signed-in account whose
email matches the operator's email — which defaults in code to `mithun@socratus.org` and is
overridable by an environment setting. Everyone else gets "You cannot see this page… it is the
operator's dashboard". Verified live: an unauthenticated request is refused.

---

## 13. Data from the LOKA app

**The boundary of what I know.** I know the LOKA app **only through the shape of the table it
produces**. Nothing in this repository implements, describes or connects to the LOKA app: there is no
importer for it, no mention of it in the Atlas code, and no shared code. Atlas treats its output as
an ordinary uploaded spreadsheet, the same as any other. **Do not propose any LOKA app feature,
integration, live sync, or app-side change on the strength of this document — I cannot tell you what
the app can do.** Assume there is no automatic pipe today: someone exports a table and uploads it.

The table, as seen in a real layer of 66 places:

`tag_id, latitude, longitude, description, categories, labels, address, creator, created_at, image_urls`

### What Atlas does well with this shape

- **Placement is clean.** `latitude` and `longitude` are auto-detected by name and range, so the
  "Where are these located?" step needs no work. No name matching, no "Needs your eye" list, no
  rows lost. `address` is not needed and is not used for placement (§2 — address-to-coordinate
  conversion is not wired up).
- **66 places is comfortably under 300**, so the layer is drawn as real pins and gets the whole key
  system: icons, colours, up to five keys, corner badges, hover bubbles, fan-out for places on the
  same spot.
- **`description` and `labels` together are exactly what theme-finding wants.** 66 places is well
  above the 8-place minimum and well below the 400-place sampling threshold, so every place is read
  in full. The result is one new `themes` column, gated by a person, with the original columns
  untouched.
- **Search works well on this shape.** Descriptions and labels are long and varied — the best case
  for both word matching and meaning matching. `tag_id`, `image_urls`, `latitude`, `longitude` and
  `created_at` are excluded from search automatically by name, so a stray number or date cannot match
  every place.
- **`labels` renders as chips in the popup** if its separator is a semicolon; the screen says plainly
  why it is not offered as a colour choice: "*labels* has N different tags — too many to tell apart
  by colour. They stay searchable, and they show when a place is opened."
- **`creator` and `created_at`** are usable as popup columns. `creator` could even become a key if it
  holds between 2 and 9 different people.

### Where it currently struggles

- **`categories` holds several answers per place, and the map colours by the first one only.** This
  is the headline limitation. A cell like "Nature; Heritage; Water" is reduced to "Nature" for
  colouring, everywhere: on the map, in the key, and in the counts. Atlas is honest about it — the
  editor prints "N places carry two or more categories — the first one decides the colour" — but the
  second and third answers do not colour anything, do not appear in the key, and are not counted.
  There is no "colour by any of", no split pin, no place appearing under more than one kind. In a
  real 66-place layer the editor's own count showed **9 kinds** for this column, so it does qualify as
  a key — it is just a lossy one. **If a proposal depends on a place belonging to several categories
  at once on the map, that is new work.**
- **Whether `categories` is even treated as a list depends on the data.** A column is read as a list
  only when at least **40%** of its filled cells contain the separator. If most places in a given
  export carry exactly one category, the column is read as one-answer-per-place — and then the
  ceiling for becoming a key drops from 12 kinds to 9 (on the map) or 8 (in the editor's dropdown). A
  layer that colours fine at 66 places can stop being offered for colouring as the data grows past
  those counts. **Worth measuring on the real export before proposing.**
- **`labels` cannot colour the map at all**, by design — it holds too many different tags. It is
  searchable and it shows in the popup. The uncommitted mock-ups in §2 are all attempts at giving
  these words a stronger role; none of that has been built.
- **`image_urls` will probably show no photo if it holds more than one link per place.** Atlas
  renders one photo per place and takes the cell as a single web address. If the links are joined by
  `"; "` (with a space) the column is not recognised as photos at all and the raw text may appear in
  the popup; if they are joined by `";"` (no space) the column *is* recognised, but the resulting
  image address is broken and is silently hidden. **I could not verify which of these the real LOKA
  export produces** — I did not read the data. Either way, expect at most one photo per place, and
  budget work for a gallery if photos matter.
- **`description` may be truncated.** Cells are cut to **500 characters** on the server. Longer written
  notes lose their tails, everywhere — popup, search and theme-finding.
- **`tag_id` is correctly ignored** for colour, key and search, but the pin's own name comes from
  whatever column you pick in "Call each place by". This table has **no short name column** — the
  natural candidates are `description` (long prose) and `address`. Expect hover labels and popup
  titles to read awkwardly unless a name column is added to the export. Atlas will only draw a name
  on the map face when it is short and name-like.
- **Adding more data means another upload.** There is no update-in-place and no matching on
  `tag_id`. Re-exporting after new places are tagged means uploading a new layer, or removing the old
  one and adding the new. Atlas does notice when the same data comes back — it fingerprints what was
  uploaded and warns — but it will not merge or update.
- **The 5,000-row ceiling is the growth ceiling.** 66 places is far from it, but a tagging app can
  cross 5,000 quickly, and at that point rows are silently trimmed. And crossing **300** places
  matters sooner: past 300 the layer stops being pins and loses the whole key and badge system.

---

## 14. Things it cannot do

State these as out of scope, or as new work, in any proposal.

1. **Turn addresses into coordinates.** Code exists; nothing calls it (§2).
2. **Colour a place by more than one of its own categories.** First answer only, always.
3. **Change a layer's shape after it is added.** No shape question in the editor; remove and re-add.
4. **Update or merge an existing layer with a newer export.** One upload, one layer; no matching on
   an ID column, no in-place update, no append.
5. **Upload several files at once**, or combine several files into one layer.
6. **Accept a zipped shapefile.** Refused with a message. `.kmz` fails with a misleading message.
7. **Show the key system on a layer of more than 300 places.** Above 300, flat circles only.
8. **Show more than 5 keys, or more than 8 colours plus grey within one key.**
9. **Show more than one photo per place.**
10. **Grow an atlas's region past the free size ceiling through the editor.** Refused; requires an
    email to the operator.
11. **Create a private atlas from any screen**, or add data to a private atlas (§2).
12. **Meaning-based search on a private atlas**, or on any atlas when the server has no AI key.
13. **Edit or export the data through Atlas.** There is no table editor and no download button on a
    published atlas; the data files are static and fetchable by address, but no export UI exists.
14. **Give anyone a read-only or comment-only role.** Owner and editor are the only roles.
15. **Let a collaborator take an atlas off the air, invite others, or delete it.**
16. **Change anything from the operator dashboard.** It reads only.
17. **Draw time.** Nothing in the code animates, filters or plays a layer by date. `created_at` is
    text in a popup.
18. **Fix more than 60 unmatched place names in one pass** through the screen.
19. **Publish more than 50 atlases on this platform** without the operator raising the limit, or
    create more than 3 per internet address per day.
20. **Deploy itself.** Someone runs the deploy script by hand.

---

## 15. The numbers, in one place

| Thing | Number |
| --- | --- |
| Open-data layers in the catalogue | 28 |
| — available in any country | 15 |
| — available in India | 27 |
| — needing operator approval | 1 (floodplain) |
| Countries offered | 249 |
| Administrative depths | 1–4, one depth per atlas |
| Units per atlas | 100 |
| Region ceiling — approval | 6 square degrees (~73,800 km², bounding box) |
| Region ceiling — refusal | 40 square degrees (~492,000 km², bounding box) |
| Atlases on the platform | 50 total |
| New atlases per internet address per day | 3 |
| Collaborators per atlas | 20 |
| Uploaded layers per atlas | no limit |
| File size | 25 MB |
| Rows per upload | 5,000 |
| Columns per upload | 40 |
| Shapes per upload | 5,000 |
| Characters per cell | 500 |
| Upload request body / other request bodies | 10 MB / 2 MB |
| Rows shown to the AI when guessing the setup | first 30 |
| AI calls per internet address per hour | 30 (with two holes, §4) |
| Keys on at once, per layer | 5 |
| Colours per key | 8, plus grey "other" |
| Different answers a column may hold to be a key | 2–9 (2–12 for a list column) |
| Share of places a key's kinds must cover | 60% |
| Places for a layer to be drawn as pins | 300 or fewer |
| Grouping distance for nearby pins | 20 px (40 px with badges) |
| Pins in one fan-out | 100, 28 px apart (44 px with badges) |
| Popup columns | 6, plus one photo and the title (5 when auto-picked) |
| Themes proposed | 2–7, plus "other" |
| Described places needed for theme-finding | 8 |
| Places read in full when finding themes | up to 400, then evenly sampled |
| Places filed into themes | all of them |
| Meaning-match similarity threshold | 0.50 |
| Extra search words the server adds | 24 |
| Places listed per layer in a search answer | 50 |
| Sign-in code life / sign-in life | 10 minutes / 30 days |
| Half-finished upload life | 24 hours |
| Built map's top zoom | 15 |

---

## 16. What I could not check

- **The server-side code running in production.** Browser files were compared byte-for-byte and
  match this commit; the server's behaviour was probed and matched, but its source could not be
  diffed. Treat server-side details as "this commit says", not "production does".
- **The real LOKA app export.** I never read the data. Everything in §13 about how `categories`,
  `labels` and `image_urls` actually behave depends on the separators and counts in the real file.
  The 40%-of-cells list-detection rule and the photo-detection rule are the two places where the
  real data decides the outcome. **Measure them before committing to a plan.**
- **Anything I marked "not observed at runtime"**: the theme-finding request-size mismatch, private
  atlases refusing uploads, the editor failing to open a private atlas. These are code readings, not
  tests.
- **Whether the web server keeps a `?key=` when redirecting the tidy `/a/<slug>` address.** The
  development version definitely drops it.
- **Whether the web server configuration in the repo is the one actually in force**, including its
  no-cache headers. The pages pin their own scripts to a version token that has not been bumped since
  the most recent commits touched those scripts; the no-cache headers should hide that, but that
  depends on server configuration I cannot see. Worst case, a returning visitor sees older scripts
  for a while.
- **How this behaves at scale.** Every ceiling above is a code constant, not a measured performance
  limit. Nothing here has been load-tested by me, and the meaning-based search threshold is
  documented in the code itself as chosen by reasoning rather than measurement.
