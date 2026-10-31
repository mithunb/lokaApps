# Design: "Use my website's look" for every atlas

Status: design, 31 Oct 2026. Nothing here is built yet. The one-off that
this grows out of is recorded in `docs/style-from-website.md` (Emergence,
21 Oct 2026); read that first for what a theme is and what it may never do.

What exists today and stays as it is:

| Piece | Where | What it does |
|---|---|---|
| theme rules and the guard | `atlas/theme.js` | reads a `theme` block, refuses dark pages, darkens faint colours to WCAG AA, allows Google Fonts only, sets the page variables |
| the viewer's hook | `atlas/atlas.js` ~L478, ~L580 | lifts `theme` from `manifest.local.json` onto the manifest and applies it before the title is drawn |
| the badge lock | `atlas/index.html` ~L1546 (`.loka-badge`) | "Powered by LOKA Atlas" sets LOKA's own colours, faces and corners back for itself |
| logo path | `atlas/logo-tools.js`, `POST /instances/:slug/details` (`api/apps/atlas.js` ~L2134), `validLogo` (~L1119) | browser redraws any picture as a PNG ≤ 200 KB; the server saves it as `branding-logo.png` and marks `hasLogo` |
| overlay writers | `readOverlay` / `writeOverlay` (`api/apps/atlas.js` ~L1736) | atomic write of `manifest.local.json`, the file a rebuild leaves alone |
| Settings sheet | `atlas/owner.js` `settingsHTML` (~L2491), `openSettings` (~L2976) | Region, Identity (title, what it is for, organisation, logo, site), people, delete |
| checks | `test/theme-test.mjs`, run by `node test/run.mjs` | no theme changes nothing; guard; badge; fonts |
| hand tool | `deploy/apply-theme.mjs` + `deploy/themes/*.json` | the by-hand route; stays for LOKA staff, is not what creators use |

What is to be built: the finding (fetch + extract + map), the proposal and
preview, the save/undo routes, a place in Settings, and the checks for all
of it.

---

## 1. What the creator sees

One new row in Settings, under Identity, after the logo and site fields:

> **Look** · *LOKA's own look* (or: *From emergencefestival.in, 21 Oct 2026*)
> [Use my website's look]  [Back to LOKA's look]

"Use my website's look" opens one sheet (not a wizard):

1. **Address.** One box, filled in with the "Your website" field from
   Identity when there is one. Button: **Read the site**. Under it, one line:
   "We read the site's colours and logo. Nothing is changed until you press
   Use this look."
2. **Wait.** The Leaf-dots wait mark (`atlas/wait.js`) with "Reading the
   site… this takes a few seconds."
3. **Proposal.** What was found, in the owner's words, not ours:
   - **Colours:** a short row of swatches, each with a plain name: *page*,
     *words*, *links and buttons*, *chosen place*. Beside each, the colour
     the site uses it for ("the site's purple: links and buttons"). Any
     colour the guard changed carries one line under it: "Darkened a little
     so words stay readable."
   - **Logo:** the picture found, on the page colour, with "Use this logo"
     on (when one was found) and a one-line rights question (section 7).
   - **Fonts** (phase 2): "Words in Poppins, which the site uses. Titles stay
     in LOKA's own face so every atlas reads as an atlas."
   - **What we left out**, folded: the site's dark sections, colours that
     cannot carry words, a logo that was too small. Plain sentences.
4. **Preview.** The owner's own atlas, live, in a frame below the proposal,
   with a two-way switch above it: **Now** / **With the site's look**. The
   switch flips the same frame (one map, no second load). On a phone the
   frame is the full width; the switch sits above it.
5. **Use this look** (primary) / **Not now**. After Use: the sheet closes,
   the page repaints, a quiet line in Settings says "Look from
   emergencefestival.in · Undo". **Undo** puts back exactly what was there
   (theme and logo) in one press, for as long as the owner stays on the
   page and afterwards as "Back to LOKA's look" / "Back to the previous
   logo" in Settings (section 6).

Nothing new for visitors. A visitor sees an atlas in the site's colours
with the site's logo, and the badge as always. No control, no toggle, no
"theme" word anywhere a visitor reads.

Words to use and avoid (creator-facing): "look", "colours", "logo",
"words", "titles"; never "theme", "palette", "token", "hex", "contrast
ratio", "WCAG" (say "readable"), "scrape", "fetch", "render".

Not pills: swatches are square-cornered tiles with the name below; the
Now / With switch is two plain buttons, one pressed.

---

## 2. Fetching the site (server only)

The owner's browser never touches the site. The API fetches it, because the
browser cannot (CORS), because what comes back must be bounded, and because
a site must never learn who the owner is.

**Route:** `POST /instances/:slug/look/read` body `{ url }`. Owner or editor
(`callerCanEdit`, same as `/details`), atlas not building. Returns a
proposal (section 5) and writes nothing. Private atlases are no different:
`reg.getInstance` + `datasetDirFor` already serve both.

**Address rules**
- Accept `https://` and `http://`; the scheme the owner typed is tried, and
  a plain host ("emergencefestival.in") is tried as https first, then http.
- Host must be a public name. Before every connection (first request and
  each redirect) resolve the name and refuse if any answer is in:
  `10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16` (cloud metadata
  lives here), `0/8`, `100.64/10`, `224/4`, `240/4`, `::1`, `fc00::/7`,
  `fe80::/10`, `::ffff:`-mapped copies of any of those, and the literal
  `localhost`. Connect to the address that was checked (pin it), not to a
  name resolved a second time, so the answer cannot change between the check
  and the connection. Refuse raw IP addresses and port numbers other than
  80/443.
- At most 5 redirects, each re-checked. Refuse a redirect to a scheme other
  than http/https.
- Refuse `loka.place` and its own hosts (nothing to learn, and a loop).

**Budget**
- 8 seconds for the whole read, 4 seconds per connection. `AbortController`.
- HTML ≤ 2 MB; each stylesheet ≤ 1 MB; at most 8 stylesheets; at most 6
  candidate images at ≤ 3 MB each, read in parallel with the stylesheet
  pass. Read bodies as streams and stop at the cap (do not trust
  `Content-Length`).
- Only `text/html` is parsed as the page; only `text/css` (or a `.css` path
  when the type is missing) as a stylesheet; only `image/png`, `image/jpeg`,
  `image/webp`, `image/svg+xml`, `image/x-icon`, `image/vnd.microsoft.icon`
  as images. Anything else is dropped, not errored.
- No cookies sent or kept; no credentials; `User-Agent:
  LOKA-Atlas-look (+https://loka.place)`; `Accept-Language: en`.
- No script from the site runs anywhere, in phase 1 or 2: the HTML is
  tokenised, not loaded. `<script>` and `<noscript>` bodies are skipped
  entirely. Inline `<style>` is read as CSS text. `style="…"` attributes
  are read only on `body`, `header`, `nav`, `h1`, `a`, `button`.
- Rate: 12 reads per atlas per hour, 60 per account per day; one read at a
  time per atlas (a second press while one is running gets the running
  one's answer).
- Every read is logged with slug, host, bytes, time and outcome, never with
  page content.

**Failure answers** (each is a plain sentence the sheet shows; the code
keeps a short reason for logs):

| What happened | What the owner reads |
|---|---|
| name does not resolve, refused address, port, raw IP | "We couldn't reach that address. Check it and try again." |
| 401/403/429, a bot wall, a CAPTCHA page (looks like: Cloudflare challenge markers, "Just a moment", very short HTML with a script-only body) | "That site doesn't let us read it. You can still add your logo and colours by hand in Settings." |
| timed out or over the size cap | "That site took too long to answer. Try again in a minute." |
| HTML read, but nothing usable found (no colours beyond black and white, no logo) | "We couldn't find colours or a logo on that page. Try the site's front page, or add them by hand." |
| a JavaScript-only site (body has fewer than ~40 words of text and the stylesheets set no colour on body/a/button) | "That site draws itself in the browser, so we can only read part of it." + whatever was found (often `theme-color`, favicon, manifest icons are still there) |

The last row is where a headless browser would help. It is not in phase 1
or 2 (section 11, decision D5).

---

## 3. What is extracted, and how

The parser is a small tokeniser written for this (no new dependency): HTML
to a flat list of start tags with attributes, text runs, `<style>` bodies,
`<link>`s and `<meta>`s; CSS to a list of `{selectorText, declarations}`
with `@media` kept as a flag (`prefers-color-scheme: dark` blocks are
skipped: no dark mode) and `@font-face` and `@import` collected. It need
not be a full cascade. It needs to be right for the common platforms, which
is tested on saved fixtures (section 10).

### 3.1 Colours

Each colour candidate is `{ hex, weight, roles[] }`. Sources, in the order
read, with the weight each adds:

| Source | How it is read | Weight | Role it suggests |
|---|---|---|---|
| `<meta name="theme-color">` (first one without a `media` attribute, or the light one) | attribute | 6 | brand |
| custom properties on `:root`, `html`, `body`, and in WordPress's `#global-styles-inline-css` | names and values; a name containing `primary`, `brand`, `accent`, `main`, `link`, `button`, `cta` adds the matching role; `secondary`, `highlight`, `alert`, `danger` adds highlight; `background`, `bg`, `base`, `white`, `paper` adds page; `text`, `foreground`, `body`, `ink`, `black` adds text | 4 (per declared name) | by name |
| platform presets | WordPress `--wp--preset--color--*`, Squarespace `--*Color` in `.sqs-*` blocks, Webflow `--*` on `:root`, Wix `--color_*`, Shopify `--color-*`, Tailwind's generated `--tw-*` and `--color-*`. A preset that is **never referenced** by any other rule (`var(--name)` not found) gets weight 0 (this is what drops WordPress's "vivid-cyan-blue") | 0 or 3 | by name |
| rules whose selector is or ends with `body`, `html` | `background(-color)`, `color` | 8 | page / text |
| `a`, `a:link`, `.wp-element-button`, `button`, `.btn`, `.button`, `[class*="btn"]`, `input[type=submit]` | `color` (links) and `background(-color)` (buttons), plus `border-color` | 6 | accent |
| `header`, `.site-header`, `nav`, `.navbar`, `[role=banner]` | `background(-color)`, `color` | 4 | brand surface / brand text |
| `h1`, `h2`, `.site-title`, `.hero *` | `color` | 3 | accent or text |
| every other declaration anywhere | `color`, `background(-color)`, `border-color`, `fill` | 1 each, capped at 30 per colour | none |
| `style=""` on the six allowed elements | as above | same as the element | same |

Values accepted: `#rgb`, `#rrggbb`, `#rrggbbaa` (alpha dropped),
`rgb()/rgba()`, `hsl()/hsla()`, the 148 named colours, and `var(--x)`
resolved one level through the collected custom properties (with
fallback). `currentColor`, `inherit`, `transparent`, gradients, and
`color-mix()` are skipped.

Then: drop pure black/white/greys from brand consideration (saturation
< 0.12 in HSL) but keep them for page/text; merge near-duplicates (ΔE
under 6 in Lab, keep the heavier one's hex); keep the top 12 by weight.
That list is the **found palette** the owner can swap from.

### 3.2 Logo

Candidates, in order; the first that passes is proposed, the rest are
offered under "Other pictures we found":

1. `<img>` inside `header`, `nav`, `[role=banner]`, `.site-header`, or
   within the first 3 KB of body text, whose `class`, `id`, `alt`, `src`
   or a parent's class contains `logo`, `brand`, `site-title`, or which is
   wrapped in an `<a href="/">`. WordPress's `custom-logo` is this case.
   `srcset` is read and the largest candidate ≤ 3 MB is taken.
2. An inline `<svg>` in the same places (serialised, 200 KB cap, with
   `<script>`, `on*=` attributes, `<foreignObject>` and external `href`
   stripped before it is handed to the browser).
3. A web app manifest (`<link rel="manifest">`) icon, largest `sizes`,
   PNG or SVG, `purpose` not `monochrome`.
4. `<link rel="apple-touch-icon">` largest, then `<link rel="icon">`
   largest (an `.ico` is accepted; the browser's canvas can read it).
5. `og:image` **last and only when it is not a photograph**: width/height
   ratio between 1:1 and 8:1 and under 2 MB; a 1200×630 JPEG with no
   transparency is treated as a photo and skipped.

Passing means: readable as an image, both sides ≥ 48 px (logo-tools'
`LOGO_MIN`), not a 1×1 tracker, not a sprite (ratio over 10:1 or under
1:10), not the platform's own mark (a short list: WordPress, Wix,
Squarespace, Webflow, Shopify badges by path). A `data:` URL `src` is
accepted up to 200 KB.

The server does **not** convert the image. It returns the bytes it fetched,
re-encoded as a data URL of the original type, through the proposal, and
the browser runs it through `window.LokaLogoTools` exactly as a file the
owner picked: PNG ≤ 200 KB, ≤ 512 px, proportions kept, see-through kept,
empty edges trimmed (one new step in logo-tools: trim fully transparent
rows and columns, so wide wordmarks sit flush). Saving goes through the
existing `/details` `branding.logoData`, so `validLogo` and the 200 KB rule
hold with no second copy. `logoMaxWidth` is set from the trimmed shape:
wordmarks (ratio ≥ 3:1) get 180, square marks 120, in between 150.

### 3.3 Fonts (phase 2)

- Body face: `font-family` from the `body`/`html` rule, else the most
  frequent `font-family` across rules weighted as in 3.1. Headings face:
  from `h1`/`h2` rules; recorded in the proposal as "the site's title face"
  but **never applied** (section 4).
- The first family name in the stack that is not a generic
  (`sans-serif`, `serif`, `system-ui`, `-apple-system`, …) and not a
  system face (`Arial`, `Helvetica`, `Georgia`, `Times`, `Segoe UI`,
  `Roboto` when it comes from the OS stack…).
- `<link href="https://fonts.googleapis.com/css2?family=…">` and
  `@import url(fonts.googleapis.com…)` are read directly: their family
  names are known-good.
- `@font-face` blocks name families the site serves itself. We never load
  from the site. The family name is looked up in LOKA's own list of Google
  Fonts families (`api/lib/atlas/google-fonts.json`, committed, refreshed
  by a script from Google's developer API, not at run time). If it is
  there, it is loaded from Google Fonts: the same open-licence face, from
  the host `theme.js` allows. If it is not there, the proposal says "The
  site's face, Gotham, isn't one we can load. Words stay in LOKA's own." and
  nothing is loaded. No "closest face" guessing in phase 2 (decision D6).
- Weight: the `font-weight` the site uses on body text if 400–600, else 400.
- The `cssUrl` is built by us (`family=<Name>:wght@400;500;600;700&display=swap`),
  never copied from the site, so it always matches `theme.js`'s `FONT_CSS`.

### 3.4 Icons (phase 2)

The atlas page's own tab icon. Today every atlas shows LOKA's. With a look
from a site, the largest square icon found (manifest icon, apple-touch-icon,
favicon ≥ 64 px) is saved as `branding-icon.png` (192×192, same
browser-side conversion) and the viewer sets `<link rel="icon">` from
`branding.icon`. The badge is unaffected. Decision D7 asks whether this is
wanted at all.

---

## 4. Mapping the site's colours onto LOKA's slots

The slots are `theme.js`'s: `page, surface, surfaceAlt, text, textSecondary,
textMuted, accent, accentDeep, highlight, highlightDeep`. The mapping runs on
the server (`api/lib/atlas/look-map.js`, requiring `atlas/theme.js` for
`contrast`/`luminance`/`over`/`darken`, which it exports already, so the
numbers are the same the viewer will see) and is pure: palette in, theme +
notes out, no I/O, so the checks can drive it.

| Slot | Rule | Fallback |
|---|---|---|
| **page** | the `body` background when its luminance ≥ 0.75 (the guard's `LIGHT_ENOUGH`). If the site's page is dark or absent: white tinted 3% toward the brand colour (`over("#FFFFFF", brand, 0.03)`), noted as "The site's dark page isn't used; the page stays light." | LOKA's `#FAF8F3` |
| **surface** | `#FFFFFF` if page is off-white, else page lightened 2% | `#FDFCF8` |
| **surfaceAlt** | the accent at 10% over surface (`over(surface, accent, 0.10)`), but if the result has luminance < 0.75 or clashes with the map's park green (hue 90–150 and saturation > 0.25), use the accent at 6% | LOKA's `#F0EDE4` |
| **text** | the `body` colour if contrast on page ≥ 7:1 and luminance < 0.2 | LOKA's `#24211D` |
| **textSecondary** | text mixed 22% toward page | guard darkens |
| **textMuted** | text mixed 38% toward page | guard darkens |
| **accent** | the heaviest candidate carrying an `accent`/`brand`/`link`/`button` role with saturation ≥ 0.25 and luminance ≤ 0.45 (it must hold white words on a button) and hue not within 25° of the chosen `text` hue; if the only brand colour is too light (Emergence's green at 2.3:1), it is **not** darkened into something the site never used: it becomes the `surfaceAlt` tint and the next candidate is tried | LOKA's Leaf `#2A6B41`; noted "The site's main colour is too light for links, so it is used as a pale shading instead." |
| **accentDeep** | accent darkened 30% | guard |
| **highlight** | the most saturated **warm** candidate (hue 0–60 or 330–360, saturation ≥ 0.5) that is not the accent and is at least 40° of hue from it; else the most saturated non-accent colour meeting the same distance | LOKA's Sindoor `#C9402B` |
| **highlightDeep** | highlight, then the guard darkens it to 4.5:1 for words (Emergence: `#FC3103` → `#CF2802`) | guard |
| **corners** | `square` if the `button`/`.btn`/`.wp-element-button` rules give `border-radius` ≤ 2px; else `soft` | `soft` |

Then `theme.js`'s `resolve` runs on the result; its `notes` are shown as the
plain lines under each swatch. The mapping never emits a colour the guard
would refuse outright (a dark page) because it checks first; it may emit
colours the guard darkens, and that is shown.

**Map and pins stay distinguishable.** The theme cannot touch map colours
(held by `theme.js`), but two theme colours sit *on* the map: the
`highlight` ring round a chosen place and the `accent` on pressed controls
over the map. Two extra rules, in the mapper, not the guard:

- The ring must contrast ≥ 3:1 with the page **and** differ from every
  colour the viewer gives a place's dot or an answer (the categorical and
  ramp palettes in `atlas/atlas.js`; the mapper reads them from one exported
  list, `atlas/map-colours.js`, which the viewer is changed to read from
  too so there is one list). "Differ" means contrast ≥ 1.4:1 or hue ≥ 30°
  apart. If the site's red is the same red as a pin colour, the ring stays
  Sindoor and the note says "The site's red is one of the map's own, so the
  ring round a chosen place keeps LOKA's."
- The accent must not be within 20° of hue and 1.3:1 of contrast of the
  map's park green or water blue, so a pressed button over the map does not
  vanish into it. If it is, it is darkened 15% first, then the guard runs.

**Titles.** `fonts.display` is never set by this feature. The atlas title,
headings and card titles stay in Lora at `--weight-display` 700 and the
size `index.html` gives them. This is Mithun's call from Emergence: the
title is LOKA's type; the site gives colours, logo and (phase 2) the body
face. The slot remains in `theme.js` for the hand tool.

**Powered by LOKA Atlas** is not touched; the existing check holds it.

---

## 5. The proposal (what `/look/read` returns)

```
{
  "source":  { "url": "https://emergencefestival.in/", "host": "emergencefestival.in", "readAt": "2026-10-31T09:12:00Z" },
  "theme":   { ...the theme block of section 6, guard already applied... },
  "found":   { "colours": [ { "hex": "#6B1164", "usedFor": "links and buttons", "weight": 41 }, ... up to 12 ],
               "fonts":   { "body": "Poppins", "titles": "Poppins", "loadable": ["Poppins"] } },
  "logo":    { "dataUrl": "data:image/png;base64,...", "from": "the site's header", "width": 800, "height": 120,
               "others": [ { "dataUrl": "...", "from": "the site's icon" } ] },
  "lines":   [ "Darkened the site's red a little so warning words stay readable.",
               "The site's bright green is too light for links, so it is used as a pale shading." ],
  "leftOut": [ "The site's dark purple sections (LOKA has no dark mode).", ... ],
  "partial": false
}
```

Nothing in it is trusted by the browser as HTML: every string is set as
text; the data URLs are drawn to a canvas by logo-tools, which is how a
hostile image is defanged (an SVG is rasterised, never inserted into the
page).

---

## 6. Storage, versioning, undo

In `manifest.local.json`, top level, beside `layers`, `placeName`, `mode`:

```
"theme": {
  "version": 1,
  "source": { "url": "https://emergencefestival.in/", "host": "emergencefestival.in", "readAt": "2026-10-31T09:12:00Z" },
  "colors": { "page": "#FFFDFD", ..., "highlightDeep": "#CF2802" },
  "fonts":  { "text": "Poppins", "cssUrl": "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" },
  "corners": "square",
  "logoMaxWidth": 180,
  "chosen": { "accent": "#6B1164" }       // slots the owner swapped by hand in the sheet, so a re-read keeps them
},
"themePrevious": { ...the whole previous theme block, or null when there was none..., "logoWas": true|false, "savedAt": "..." }
```

- `version` is the theme block's shape, so a later `theme.js` can read an
  older block. `theme.js` ignores keys it does not know (it already does),
  so `source`, `chosen` and `version` ride along unread by the viewer.
- The logo goes where logos go: `branding-logo.png` + `branding.hasLogo` in
  the registry + `branding.logo` in `manifest.json` (the `/details` path).
  Before a logo from a site overwrites one the owner uploaded, the old file
  is moved to `branding-logo.previous.png` (one generation).
- **Undo** = `POST /instances/:slug/look/undo`: swaps `theme` and
  `themePrevious`, and if `logoWas` says there was a logo and
  `branding-logo.previous.png` exists, swaps the files back; if there was
  no logo before, removes the site's. One generation deep. Pressing Undo
  twice is "redo", which is honest and needs no extra state.
- **Back to LOKA's look** = `DELETE /instances/:slug/look`: removes `theme`
  (the logo is left; it is the owner's logo field, removed in Identity if
  they want).
- **Save** = `POST /instances/:slug/look` body `{ theme, logoData?,
  useLogo }`: the server runs the mapper's validation again (never trusts the
  browser's block: it re-runs `resolve`, refuses unknown keys, caps sizes),
  writes `themePrevious`, writes `theme`, and when `useLogo` and `logoData`
  are given, saves the logo via the same code `/details` uses (factor the
  logo save out of the `/details` handler into one function, so there is
  one rule). Owner only for save/undo/delete (`callerRole === 'owner'`, as
  `/mode`); editors may read a proposal and preview it.
- A rebuild (`/rebuild`, ~L2245) already preserves `manifest.local.json`
  and the logo; nothing new to carry.

---

## 7. Rights and credit

- **Logo.** Under the logo in the proposal, one checkbox, off by default:
  "This is my organisation's own site and logo, and I may use them here."
  "Use this look" is disabled until it is ticked when a logo is included;
  colours alone need no tick (colours are not protected; a look is not a
  copy of the site). The tick is recorded as `logoRights: { by: <account email>, at: <time> }`
  in the registry's `branding` (not in the public manifest).
- **Credit line.** About & sources gains one line when a theme has a
  `source`: "Look: colours and logo from emergencefestival.in, read on
  21 Oct 2026." Owners can turn it off in the sheet ("Say where the look
  comes from" — on by default). Decision D3 asks whether it should exist.
- **Fonts.** Only Google Fonts families (all under OFL/Apache/UFL) are ever
  loaded, from Google's host, so licence is settled by construction. The
  site's own font files are never copied or served.
- **Images other than the logo and icon** (hero photos, partner marks,
  `og:image` photographs) are never taken. Decision D4 confirms.

---

## 8. Applying it in the viewer

Nothing new in the viewer for a saved look: `atlas.js` already lifts
`theme` from the overlay and applies it before the title paints.

For the **preview**, one small addition: in embed mode (`?embed=1`), the
viewer listens for `message` events from `window.parent` **only when
`event.origin === location.origin`**, of the shape
`{ type: "loka-look-preview", theme: {...} | null }`, and calls
`LokaTheme.apply(theme)` (or restores LOKA's values by removing the
variables it set and the `atlas-themed` class; `theme.js` gains a `clear`
for this). The logo in the preview is set the same way
(`{ type: "loka-look-preview", logoDataUrl }` → `renderBranding` with a
temporary `logo` that is a data URL; `renderBranding` already takes any
`b.logo`, and `dataUrl()` must be taught to pass a `data:` URL through
untouched). The owner's page opens
`atlas/?dataset=<slug>&embed=1` in the sheet's frame (with `&key=` for a
private atlas, as the add-data preview does today) and posts to it. Same
origin, no network, instant Now/With switch.

Fonts in preview: `apply` already appends the Google Fonts `<link>`; a
`clear` removes it.

---

## 9. Cost

- **Dependencies:** none new for phase 1 and 2. The HTML/CSS tokenisers are
  ~300 lines each in `api/lib/atlas/look-read.js`; the mapper ~200 lines;
  the Google Fonts list is a committed JSON (~60 KB) with a refresh script in
  `deploy/`.
- **Server:** a read is ≤ 8 s and ≤ ~25 MB of transient memory in the worst
  case (caps above); typically 1–2 s and 2 MB. With the rate limits it
  cannot be used to make LOKA fetch at volume.
- **Storage:** the theme block is under 2 KB; the logo is the same 200 KB
  the owner could upload today; one previous logo generation doubles that.
- **Headless render** (not in plan): Playwright + Chromium is ~400 MB on
  disk, 150–300 MB RAM per render, 3–10 s, and needs its own sandboxing on
  loka.place. See D5.
- **Build effort:** phase 1 about 5–7 working days including checks and
  fixtures; phase 2 about 3–4.

---

## 10. Checks (`node test/run.mjs`)

All in `test/`, no network: fixtures are saved copies of real pages and
stylesheets in `test/fixtures/look/<site>/` (HTML + CSS files + a small
PNG), with a `expected.json` beside each.

`test/look-read-test.mjs`
- address rules: every private range above, IPv4 and IPv6 and mapped,
  `localhost`, a raw IP, a port, a 6th redirect, a redirect to `file:`,
  `loka.place` → refused with the right plain sentence.
- caps: an HTML over 2 MB is cut and still parsed; a 9th stylesheet is
  ignored; a `Content-Length` lie does not matter.
- fixtures: `emergence` (WordPress) must yield purple accent, red
  highlight, `#FFFDFD` page, Poppins body, square corners, the header logo —
  within a ΔE of 3 of the hand-made `deploy/themes/emergence-festival.json`
  on every colour slot (this is the regression that proves the general rule
  reproduces the one-off). Plus: a Squarespace site, a Webflow site, a
  Tailwind site, a site with only `theme-color` and a favicon, a dark site,
  a site with no logo, a JS-only shell, a bot-wall page.
- no script ever evaluated: a fixture whose `<script>` sets custom
  properties yields nothing from them.

`test/look-map-test.mjs`
- each row of the mapping table with a hand-made palette; the dark-page
  rule; the too-light-brand rule; the warm-highlight rule; the ring-vs-pin
  rule against `atlas/map-colours.js`; the accent-vs-park-green rule;
  `fonts.display` is never present in the output.
- idempotence: mapping the found palette of a theme's own colours gives the
  same theme.

`test/theme-test.mjs` (extend)
- a `version: 1` block with `source` and `chosen` resolves the same as one
  without; `clear` restores every variable it set and removes the font link.

`test/look-routes-test.mjs` (handler-level, no server)
- save re-validates: unknown keys dropped, dark page refused, a 300 KB logo
  refused, an editor cannot save, an owner can; undo swaps and swaps back;
  delete leaves the logo.

`test/logo-test.mjs` (extend)
- trim of transparent edges; an SVG with a `<script>` is rasterised without it.

Two-atlas rule (memory: systemic, not one-off): before shipping, run the
feature on Emergence's site and on at least one other real site for a
different atlas (Cubbon Park's or Socratus's), and keep both as fixtures.

---

## 11. Decisions needed

- **D1 — Name of the button.** "Use my website's look" (proposed) vs
  "Match my website" vs "Take colours from my site".
- **D2 — Who may save.** Owner only (proposed, like mode) or any editor
  (like title and logo today)?
- **D3 — Credit line.** Show "Look: colours and logo from <host>" in About
  & sources, on by default with a switch (proposed), always, or never?
- **D4 — Pictures.** Confirm: logo and tab icon only; never hero images,
  partner marks or `og:image` photographs.
- **D5 — JavaScript-only sites.** Phase 1 and 2 read the page without
  running it; a site that draws itself in the browser yields only
  `theme-color`, icons and the manifest, with an honest message. Add a
  headless browser later (cost in section 9), or leave these to "by hand in
  Settings" for good?
- **D6 — Fonts not on Google Fonts.** Keep LOKA's face and say so
  (proposed), or offer the nearest Google face by name (needs a mapping
  table we would maintain: Gotham → Montserrat, Proxima Nova → Nunito Sans…)?
- **D7 — Tab icon.** Should an atlas with a look also take the site's icon
  as its browser-tab icon (phase 2), or does every atlas keep LOKA's?
- **D8 — http sites.** Allow plain `http://` sites (proposed, read-only, no
  harm) or require https?
- **D9 — Undo depth.** One generation (proposed) or keep the last three
  looks in the sheet to pick from?

---

## 12. Phases

**Phase 1 — colours and logo**
1. `atlas/map-colours.js`: the viewer's dot/answer colour lists moved to one
   exported file; the viewer reads from it (no visible change; a check holds
   equality).
2. `api/lib/atlas/look-read.js`: address rules, bounded fetch, HTML/CSS
   tokenisers, colour and logo candidates. Fixtures + `look-read-test`.
3. `api/lib/atlas/look-map.js`: mapping + the two map rules. `look-map-test`.
4. Routes `look/read`, `look` (save), `look/undo`, `look` (delete); logo
   save factored out of `/details`. `look-routes-test`.
5. `theme.js`: `clear`, `version` tolerated. Viewer: preview message in
   embed mode; `dataUrl` passes `data:` through; `renderBranding` unchanged.
6. `owner.js`: the Look row in Settings, the sheet, the preview frame, the
   swatch row with swap-from-found, the rights tick, Undo. logo-tools: trim.
7. About & sources credit line (per D3).
8. Run on Emergence and one more atlas; record the result in
   `docs/style-from-website.md`'s log; deployed-vs-pending table.

**Phase 2 — fonts and icons**
1. `api/lib/atlas/google-fonts.json` + `deploy/refresh-google-fonts.mjs`.
2. Font extraction and the body-face rule; `cssUrl` built by us; proposal
   shows "Words in …; titles stay in LOKA's face".
3. Tab icon (per D7): `branding-icon.png`, viewer `<link rel="icon">`.
4. Checks extended; two-atlas run again.

**Later, only if decided (D5):** a headless read for JavaScript-only sites,
sandboxed, with the same address rules applied to every request the page
makes.

Not planned, on purpose: dark mode; the site's heading font on titles;
per-site hand rules; any visitor-facing control.

---

## 13. Mithun's answers (31 Oct 2026)

These override the proposals above where they differ.

- **D1 — Wording.** The Settings row reads: "Provide a website for visual style and design reference."
- **D2 — Who may save.** Owner **and editors** (like title and logo today), not owner only.
- **D3 — Credit line.** On by default in About this atlas; the owner can turn it off.
- **D4 — Pictures.** The atlas creator and the website owner may be the same organisation. Allow **logos, the tab icon, and background images or motifs** (patterns). During the import, show each picture found and say plainly which can be used and which should not (e.g. partner logos, photos of people, stock images), so the creator chooses with that in view. This widens §4–5: background images/motifs become phase 1 candidates, each with its own "can use / should not use" verdict and reason.
- **D5 — JavaScript-only sites.** Say so plainly now; add the headless browser reader later.
- **D6 — Fonts not on Google Fonts.** Keep LOKA's font and say so.
- **D7 — Tab icon.** Let the creator **upload an icon while building the atlas** (the wizard), and use that as the tab icon. A website's icon may be offered as a suggestion for that upload; it is not taken silently.
- **D8 — http sites.** Allowed (read only).
- **D9 — Undo.** One step back.
