# LOKA Atlas visual redesign — build and deployment plan (September 2026)

Decisions are final and approved by Mithun:
- **Layout:** Field Notebook, refined (round 1) — strip + shelf on desktop, the map in a framed cream well, and on phones a bottom sheet that shows one group of layers at a time with large switches.
- **Colours:** "Bazaar, a little softer" (Level 1). Tokens are in `DESIGN.md` frontmatter and repeated below.
- **Fonts:** Source Serif 4 (700) for titles and headlines; Source Sans 3 (400/600/700) for everything else. Latin only for now; stacks are written so script companions can be added later without touching selectors.
- **Set aside:** other-language font companions; print/hatching; dark mode.

The mock-ups these decisions were made on are in the session scratchpad (`designs/loka-atlas-fonts.html`, pairing 1, is the closest single picture of the target). They are drawings, not code: the spec below is what to build.

Two builders work in parallel on **disjoint file sets** (section 5). Neither touches `api/atlas-builders/`, `test/places-test.mjs` or `test/source-rows-test.mjs` (another session is editing those).

---

## 1. Tokens (single source: `DESIGN.md` frontmatter)

### CSS custom properties
Every page defines these on `:root` with exactly these names. The old names (`--color-moss`, `--color-rust`, `--color-canopy`, `--color-ochre`, `--color-sienna`, `--color-bg`, `--color-bg-alt`) are **kept as aliases** pointing at the new values during the build so nothing breaks mid-way, then removed by each builder from their own files once no selector uses them.

```css
:root{
  /* interface */
  --color-page:#FAF8F3;  --color-surface:#FDFCF8;  --color-surface-alt:#F0EDE4;
  --color-text-primary:#24211D; --color-text-secondary:#5A5751; --color-text-muted:#6E6A63;
  --color-border:rgba(36,33,29,.18); --color-divider:rgba(36,33,29,.10);
  --color-leaf:#2A6B41; --color-leaf-deep:#1F5232; --color-leaf-tint:rgba(42,107,65,.10);
  --color-sindoor:#C9402B; --color-sindoor-deep:#9E3220; --color-sindoor-tint:rgba(201,64,43,.10);
  --color-marigold:#E9A237; --color-marigold-tint:rgba(233,162,55,.16); --color-blue-tint:rgba(58,127,161,.14);
  --color-toggle-off:#CFCBC2;
  /* aliases, remove when unused */
  --color-bg:var(--color-page); --color-bg-alt:var(--color-surface-alt);
  --color-moss:var(--color-leaf); --color-canopy:var(--color-leaf-deep); --color-moss-tint:var(--color-leaf-tint);
  --color-rust:var(--color-sindoor); --color-rust-deep:var(--color-sindoor-deep); --color-rust-tint:var(--color-sindoor-tint);
  --color-ochre:var(--color-marigold); --color-sienna:#D2692A;
  /* map */
  --map-ground:#F5F1E6; --map-outside:#EAE6DC; --map-water:#3A7FA1; --map-water-fill:#C8DBE5;
  --map-boundary:#26231F; --map-block:#8C8985; --map-road:#E2DDD0; --map-label:#24211D; --map-halo:#F5F1E6;
  --ramp-1:#FBF1D9; --ramp-2:#F4CF82; --ramp-3:#E9A237; --ramp-4:#D2692A; --ramp-5:#A8321A;
  --point-1:#C9402B; --point-2:#2A6B41; --point-3:#E9A237; --point-4:#3A7FA1; --point-5:#A39E94; --point-6:#26231F; --point-7:#B99A1C;
  /* type */
  --font-companions-serif:"Source Serif 4"; --font-companions-sans:"Source Sans 3";   /* never empty — see the note below; script companions are appended here later */
  --font-display:"Source Serif 4",var(--font-companions-serif),serif;
  --font-body:"Source Sans 3",var(--font-companions-sans),sans-serif;
  --t-display:clamp(1.6rem,4vw,2.4rem); --t-section:1.2rem; --t-body:1rem; --t-control:.95rem; --t-ui:.9rem; --t-meta:.8rem; --t-label:.72rem;
  /* shape and depth */
  --radius-xs:.125rem; --radius-md:.25rem; --radius-lg:.375rem; --radius-pill:999px;
  --shadow-sm:none; --shadow-md:0 1px 4px rgba(36,33,29,.10); --shadow-lg:0 2px 12px rgba(36,33,29,.12);
  --container:min(76rem,100% - 2.5rem);
}
```

Note on empty custom properties (corrected by both builders, 26 Sep 2026): `--font-companions-serif:;` is valid CSS, but the stack `"Source Serif 4", var(--font-companions-serif), serif` reads `"Source Serif 4", , serif` once substituted, and Chromium rejected the whole declaration — every heading fell back to Times (measured on the viewer and on the wizard pages). `var(--x, )` fails the same way. The form that works, now in every page, keeps the slot **non-empty** by holding the primary face as a placeholder: `--font-companions-serif:"Source Serif 4"; --font-companions-sans:"Source Sans 3";`. A companion is appended to that value later: `--font-companions-sans:"Source Sans 3", "Noto Sans Devanagari";`. Two further tokens were added during the build: `--color-marigold-tint: rgba(233,162,55,.16)` (the "because" chips) and `--color-blue-tint: rgba(58,127,161,.14)` (the owner's pickers).

### Measured contrast (WCAG 2.x, computed on the round-3 page)
Text #24211D on Surface #FDFCF8 = **15.6:1**; muted #5A5751 on Surface = **7.0:1**; white on Leaf #2A6B41 = **6.4:1**; Sindoor #C9402B on Surface = **4.8:1** (passes 3:1 for lines/rings and 4.5 for short text). Ramp stays in lightness order under deuteranopia (L* 96 → 86 → 74 → 59 → 43). Point set: closest pair after simulation is Marigold vs Turmeric (ΔE 8.7) — they never share a marker shape.

---

## 2. Component spec

Everything below is for the viewer (`atlas/index.html` + `atlas.js`) unless marked *owner* or *wizard*. Plain-language copy throughout; no jargon in any string a user sees.

### 2.1 Header, title, site bar — superseded by layout B (26 Sep 2026, see DESIGN.md §5 "The atlas page")
Built after this plan, on Mithun's choice of Option B from the branding review: an atlas puts `.atlas-full` on `<html>` (atlas.js), and the map fills everything under one 44px header (`.nav`) that carries the organisation's logo, name and the atlas title (`.org-head`, `#org-branding`, `#atlas-title`), the strip's pieces (`#head-tools`), Share, and the site links. The title block above the stage, the "LOKA / APPS" wordmark, the CTA band and the footer are not drawn on an atlas. Bottom-left of the map: the `#sources-btn` chip opens `<dialog id="atlas-sources">` (not modal) holding the lead text and the whole credits ledger. Bottom-right: the hard-coded `.loka-badge` ("Powered by [LOKA] Atlas", links to `./setup/`). What follows below is the earlier spec, kept for the parts that still hold (tokens, controls, rows).
- The Share button: secondary button (Leaf border/text); icon only on phones.

### 2.2 The strip
- On a wide screen the strip is moved into the header by `placeStripPieces` (search, then Map/Satellite, then the owner's region row); on a phone it stays over the map as the floating search box. The rules below describe its pieces.
- ~~Left: the **"LOKA Atlas" wordmark**~~ — replaced by the badge (layout B).
- Map/Satellite segmented control: Surface, 1px Ink Border, 4px; the active segment Leaf with white text (was moss).
- Search: Surface, 1px Ink Border, 4px, magnifier icon Ink Faded; placeholder "Search this map…"; focus = 2px Leaf outline (offset −1px, as today); the result count hangs below as today.
- Owner-only region row unchanged in structure; colours re-tokened.

### 2.3 The shelf (layer panel)
- 19.5rem wide, Surface at 95%, 4px radius, panel-lift shadow (kept). Layout B: floats 8px under the header and stops 44px above the stage's foot; **open on load**; folded, its head alone is the "Layers · N" button.
- Panel head "LAYERS · 17": Label type; **2px Leaf rule beneath** (replaces the hairline). Collapse chevron unchanged; a layers icon shows when folded.
- Group heads ("BASE", "CROPS & LAND"): Label type in Ink Soft over a hairline; sticky as today; the gap above a group is ≥ 3× the row gap.
- Rows: one skeleton (switch, name, then anything else pushed to the end). Name Sans 600 `--t-ui`; off rows drop to 400 + Ink Soft (Two-Channel Rule kept).
- **Switch**: 32×18 track `--color-toggle-off` off → Leaf on; white knob; 0.2s ease-out; indeterminate = Leaf at 60% with centred knob; ≥ 44px hit area on touch. The key toggles (26×15) and tick boxes follow the same colours.
- Keys and legends (`.ctl-extra`, `.ctl-legend`, `.key-chips`): indented to the row's text edge; swatches 14×14 with a 1px rgba(0,0,0,.08) edge; ramp legends show the five steps with plain-language ranges ("Under 10%", "Over 40%"); counts in Meta with `tabular-nums`. The moss `border-left` rule on `.ctl-extra` becomes a Leaf rule (same 1px, same place; it is a fold rule, not a stripe).
- Opacity sliders: `accent-color: var(--color-leaf)`.
- Info buttons (`.ctl-info`): Ink Faded, Leaf on hover/focus.

### 2.4 The map well and base style
- The map stage gets the **frame**: `border:1px solid var(--map-boundary); outline:1px solid var(--map-boundary); outline-offset:2px;` and background `--map-ground`; the stage keeps an 8px inset from the shelf on desktop. The old stage shadow is removed. On phones the frame is 0px-offset (frame only, no gap) so no width is lost.
- **Base style lives in `atlas/atlas.js`**, `APP_BASEMAPS` (lines ≈ 642–668): `light` is the OpenFreeMap "bright" vector style (`https://tiles.openfreemap.org/styles/bright`) with `ground: "#F8F4EC"`; `satellite` is the Esri World Imagery raster with `ground: "#2B2F33"`. The background layer `bg` is painted from `mapGround` (≈ line 795) and re-set at ≈ line 3531 when the basemap changes. Glyphs: `GLYPH_FONTS = { regular: "Noto Sans Regular", bold: "Noto Sans Bold" }` (≈ line 685; the map's own label glyphs stay Noto Sans — MapLibre cannot use web fonts, and Noto Sans is the closest match to Source Sans 3 in x-height).
  - Set `light.ground` to `#F5F1E6` (`--map-ground`).
  - After the vector style loads, **warm and quiet the OpenFreeMap "bright" layers** so they sit with the cream ground: water fill → `#C8DBE5`, waterway lines → `#3A7FA1`, landcover/park greens → desaturated toward `#E9EDDF`, residential/landuse → `#EFEAE0`, roads → `#E2DDD0` (major roads may stay one step darker, `#D6D0C0`), building fills → `#E8E2D6`, admin boundaries → `#8C8985`, base labels → `#5A5751` with halo `#F5F1E6`. Do this in one function (`warmBaseStyle(map)`) that iterates `map.getStyle().layers` and matches by `source-layer`/`id` prefixes (`water`, `waterway`, `landcover`, `landuse`, `park`, `road|highway|transportation`, `building`, `boundary`, `place|poi|label`), applying `setPaintProperty`. Guard every call with `map.getLayer(id)`; log nothing on a miss. Satellite is untouched.
  - The "warm" raster treatment in `atlas/map-style-variations.html` is a precedent only; it is not loaded by the product.
- Manifest-supplied basemaps (`manifest.basemaps`, ≈ lines 188, 776, 3523) are per-atlas and stay as they are; only the app defaults change.

### 2.5 Boundaries, labels, markers, choropleth (data layers in `atlas.js`)
- Region/district outline (`line` layers built ≈ lines 906–930): default `line-color` `#26231F` at 1.8px; the **selected** case `#C9402B` (was `#A6522F` / `#1e2a1c`). Block-level lines 0.7px `#8C8985`.
- Label layers (≈ lines 1018–1030): default `text-color` `#24211D`, `text-halo-color` `#F5F1E6`, `text-halo-width` 2.2 (was `#fff`/`#000`/1.2). District/region names uppercase with `text-letter-spacing` 0.2; place names not tracked.
- `ONE_COLORS` (line 124: rust/moss/ochre/sienna/slate) → `{ sindoor:"#C9402B", leaf:"#2A6B41", marigold:"#E9A237", blue:"#3A7FA1", stone:"#A39E94", ink:"#26231F", turmeric:"#B99A1C" }` with the old keys kept as aliases (`rust→sindoor`, `moss→leaf`, `ochre→marigold`, `sienna→#D2692A`, `slate→blue`) so existing manifests keep working.
- Point defaults (≈ line 955): circle `#C9402B` with a `--map-halo` stroke 1.2px (was `#f97316`). Marker **shapes** come from `iconkit.js`: add or confirm dot, triangle, square, diamond, hollow square, hollow triangle, and outlined dot, and map the seven point colours to them in that order when a layer has no explicit icon.
- Clusters (≈ lines 2576–2608): bounds fill/line `#2A6B41` at .08/.5; cluster circles step `#5B8E6A` (<10), `#2A6B41` (10–50), `#1F5232` (50+); stroke and count text white.
- Choropleth ramps: the server-side palettes in **`api/lib/fragment.js`** (`PALETTES`: `greens`, `ylorbr`, `brteal`…; auto-categorical = Paul Tol muted) are what generated layers ship with. Add `marigold: ['#FBF1D9','#F4CF82','#E9A237','#D2692A','#A8321A']` and make it the default (`rampFor` fallback), keep the others available by name. Do not change `brteal`/`tealbr` (diverging, colour-blind-safe). Categorical auto-palette: replace Tol muted with the seven-colour point set in order; keep Tol available as `tol`. (This file is under `api/lib/`, not `api/atlas-builders/`; it is assigned to Builder A, see section 5.)
- Fill opacity stays 0.55–0.75; `fill-outline-color` transparent as today.

### 2.6 Feature pop-up / place card (`openPopup` ≈ line 4229, `popupHTML` ≈ 4369, CSS `.atlas-popup` ≈ index.html 691–851)
- `.maplibregl-popup-content`: Surface, 4px, **3px Sindoor top border**, `--shadow-lg`, padding 0; the pop-in animation kept at .18s.
- Photo band (`.pop-img`, `.pop-shots`): unchanged geometry; corner radius 4px.
- `.pop-sub` (kicker): Label type in **Leaf** ("SURVEY VILLAGE · GORAKHPUR").
- `.pop-title`: Source Serif 4 700, 1.1rem, Ink.
- Fields: two-column (`.pop-lbl` Meta Ink Soft; `.pop-val` Sans 600 Ink with `tabular-nums`).
- Close: 14px circle, rgba(255,255,255,.85), Ink glyph; focus ring Leaf.
- Hover tooltip (`.atlas-tooltip`): Surface, hairline, Meta type; no shadow.
- The popup tip (arrow) takes Surface; the Sindoor edge does not run into the tip.

### 2.7 Map controls
- NavigationControl (≈ line 319, bottom-right, no compass) — restyle `.maplibregl-ctrl-group`: Surface, 1px Ink Border, 4px, no shadow; buttons 26px on desktop, 32px on phones; icons Ink; hover Leaf Tint; focus Leaf ring. Keep bottom-right.
- Add a scale note bottom-left in Label type on Surface only if a `ScaleControl` is added; otherwise omit (not in the current code — do not invent).
- Attribution: MapLibre's compact control, Meta type, Ink Soft on Surface at 90%.

### 2.8 Phone bottom sheet (≤ 720px) — replaces the tray + bar of marks
- The stage is 64dvh (kept). The sheet (`.atlas-panel` on mobile) is a bottom sheet with: a 30×4 grab bar in `--color-toggle-off`; a **row of group tabs** (one per `.ctl-group`, labels from the group heads, e.g. "Base · Crops & land · Water"); then **only the active group's rows**. Tabs: Label type, Surface with Ink Border, 4px; active = Leaf fill, white text. Rows: full-width, min 44px, switch at the row's end, hairline between rows. Keys/legends fold under their row as today.
- The sheet's foot (layout B): hairline, then Map/Satellite left and LOKA's badge right. Tapping the grab bar with no group open folds the sheet to a "Layers · N" chip bottom-left; the badge then floats bottom-right.
- Height: max 50% of the stage, never covering the top third of the map; slide 0.28s `cubic-bezier(.22,1,.36,1)`; `prefers-reduced-motion` disables.
- The existing `.atlas-bar` (46px bar of marks with `.mk-lb` labels) is retired **but** `test/panel-form-test.mjs` asserts the literal CSS lines `.atlas-bar { display:none; }` and `.atlas-bar:not([hidden]) {` exist in `index.html`. Keep those two rules (they can style the new tab row: give the tab row the class `atlas-bar` and keep the `hidden` attribute behaviour) so the test stays green; do not edit the test.
- Strip on phones: transparent, search only (kept); Map/Satellite moves into the sheet's foot row (kept from today's tray).

### 2.9 Credits strip and the call to action (`.atlas-credits` ≈ 855, `.atlas-cta` ≈ 928)
- Layout B: the two-column credits grid stays in full (Surface Alt, hairline top, 6px radius; "Made by" column headed in Label type; sources in Meta) but inside the "About & sources" panel; the LOKA logo image at its head is gone (the badge is LOKA's mark).
- The CTA aside keeps its wording exactly and shows on the home gallery; on an atlas it is not drawn (the badge and the panel's foot carry "Build your own atlas for free →").
- Embeds (`.atlas-embed`, `.atlas-embed-map`) hide the links/CTA/footer as today; the badge always shows, and `?embed=map` hides the header too.

### 2.10 States
- **Loading**: while the manifest/style loads, the stage shows Ground with a centred Meta line "Loading the map…" in Ink Soft (add a `.atlas-loading` element toggled by `atlas.js`; today there is none and the map simply appears). No spinner graphic; a 3-dot ellipsis is enough.
- **Empty** (an atlas with no layers or no region): the shelf shows one Meta line "This atlas has no layers yet." and, for owners, a secondary button "Add a layer".
- **Error** (`.atlas-error` ≈ index.html 99, message built ≈ atlas.js 175): Surface panel with a Sindoor Deep title "The map could not be loaded" and the plain explanation; a secondary "Try again" button. Never a red wall.
- **Focus**: 2px Leaf outline, 2px offset, on every interactive element; `:focus-visible` only.
- **Hover**: buttons Leaf Deep or Leaf Tint wash; rows no background change; links underline.
- **Selected**: map feature ring 2px Sindoor + 1px outer ring at 45%; the row for a selected layer does not change colour (selection is on the map, not in the shelf).
- **Disabled**: 50% opacity, no colour change.
- **Dark mode**: not shipped (see DESIGN.md §7). Remove nothing; add nothing.

### 2.11 Owner controls (*owner*, `atlas/owner.css`, `owner.js`)
Same tokens; structure unchanged. Specifics: `.share-btn.primary` Leaf; `.share-btn.danger` Sindoor Deep text, Sindoor Tint hover; `.own-confirm` Sindoor Tint; `.own-rename` Leaf border; `.own-sheet` Surface with `0 8px 30px rgba(36,33,29,.22)`; `.own-chip` pill kept; `.own-toast` Ink on Surface; all focus rings Leaf.

### 2.12 Wizard and data-bench pages (*wizard*: `setup/`, `create/`, `add-data/`, `admin/`, `edit-layer-preview.html`, `databench.css`)
Same tokens, same faces. Stepper chips Leaf Tint/Leaf; primary buttons Leaf; cost badges `free` Leaf Tint, `needs approval` Sindoor Tint; inputs per DESIGN.md; tables with `tabular-nums` on numeric columns; the eyebrow chip "LOKA ATLAS · SETUP WIZARD" in Label type. No page gets a new layout; this is a re-skin plus the font swap.

---

## 3. Fonts: how they load today and what replaces it

Today every page carries a Google Fonts link (`fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Figtree:wght@500;600;700`) — in `atlas/index.html`, `setup/index.html`, `create/index.html`, `add-data/index.html`, `admin/index.html`, `edit-layer-preview.html`. `atlas/vendor/` holds only JS (papaparse, pmtiles, qrcode, simplify, xlsx); nothing is self-hosted. `edit/index.html` and `layers.html` are retired redirect pages with no fonts.

**Replacement (Google Fonts, Latin only, `display=swap`):**
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&family=Source+Serif+4:wght@700&display=swap">
```
Measured on 26 Sep 2026 (woff2, Latin subset): Source Sans 3 400/600/700 = 84 KB in 3 files; Source Serif 4 700 = 21 KB in 1 file; **105 KB total**, versus today's DM Sans + Figtree at 6 weights.
- One shared snippet, pasted identically into each page (there is no shared head include). Remove the Figtree/DM Sans link in the same commit.
- Map glyphs (labels drawn by MapLibre) stay Noto Sans via the style's `glyphs` URL; that is not a web font and is unaffected.
- **Later, for other scripts:** add `&family=Noto+Sans+Devanagari:wght@400;600` (and Bengali/Tamil/Arabic, or IBM Plex siblings) to the link and set `--font-companions-sans: "Noto Sans Devanagari", "Noto Sans Bengali", …;` / `--font-companions-serif: "Noto Serif Devanagari", …;` in `:root`. No selector changes. Google Fonts serves companions with `unicode-range`, so they download only on pages that contain that script.
- Self-hosting is not required now; if it is wanted later, the same four woff2 files go under `atlas/vendor/fonts/` with `@font-face` rules and the link is dropped.

---

## 4. Verification checklist and deploy steps

Before opening a PR, each builder runs, on their own port (`LOKA_DEV_STATIC=1 … node api/server.js`, see `.claude/launch.json` for the pattern):
1. **Desktop (≥ 1200px)**: viewer at `/apps/atlas/` for the Deoria atlas — strip, shelf, framed map, place card open, credits, CTA, all in the new tokens and fonts; no old moss/rust/ochre anywhere (`grep -n "#4A5A33\|#AE5028\|#B8862F\|Figtree\|DM Sans" atlas/index.html atlas/*.css atlas/*/index.html` returns nothing in your files).
2. **375px**: bottom sheet with tabs, one group at a time, 44px rows, no horizontal scroll (`document.documentElement.scrollWidth === innerWidth`), map not covered above its top third, credits in the sheet foot.
3. **Contrast**: the token pairs above are already measured; any new pair a builder introduces is checked (a one-line Node script with the WCAG formula is fine) and the ratio is noted in the commit message.
4. **Fonts**: in DevTools, `document.fonts.check('700 16px "Source Serif 4"')` and `document.fonts.check('400 16px "Source Sans 3"')` both `true`; Network shows 4 woff2 files from `fonts.gstatic.com`.
5. **Console**: no errors on load, on basemap switch, on opening a popup, on toggling every layer.
6. **Tests**: `node test/run.mjs` passes with the same count as before your change (the runner reports the total; a lower total is a finding). Do not edit `test/places-test.mjs` or `test/source-rows-test.mjs`.
7. **Owner view** (Builder B): sign in as an owner locally, open settings sheet, rename a layer, see the toast — all in new tokens.
8. **Wizard** (Builder B): walk `setup/` to the end with the sample dataset; `admin/` and `add-data/` load without console errors.

**Deploy** (only after Mithun's go on the merged PRs):
- `./deploy/deploy.sh` — pulls `main` on the server, refreshes deps, stamps every `?v=` cache token with the commit hash, restarts pm2, runs health checks.
- Then open `https://loka.place/apps/atlas/` and the Deoria atlas; check steps 1, 2, 4 and 5 against production.
- Fonts come from Google, so a first production load may flash unstyled text for a moment (`display=swap`); that is expected.
- **Hard-refresh note:** the deploy stamps `?v=` on HTML-referenced JS/CSS, so returning browsers get fresh code; the HTML itself may still be cached by a browser for a while — a hard refresh (Shift+Reload) on the atlas page is the check, not a fix to ship.

---

## 5. Page-by-page change list, split into two disjoint file sets

### Builder A — viewer
Files: `atlas/index.html`, `atlas/atlas.js`, `atlas/share.js`, `atlas/iconkit.js`, `atlas/reading-rules.js` (only if a string/colour lives there), **`api/lib/fragment.js`** (palettes only), `DESIGN.md` (fix-ups only).

`atlas/index.html`
- Font link (section 3). `:root` tokens (section 1) replacing lines ≈ 13–39; keep aliases until the file's selectors are migrated, then delete the aliases.
- Strip: add the "LOKA Atlas" wordmark before the Map/Satellite control; re-token `.bm-btn` active, `.ctl-search-box` focus.
- Shelf: `.panel-head` 2px Leaf rule; group heads to Label type; `.ctl-toggle` colours; `.ctl-extra` rule → Leaf; legend swatch edge; `tabular-nums` on counts.
- Map stage: the frame (section 2.4); remove the stage shadow.
- Popup CSS (section 2.6).
- `.maplibregl-ctrl-group` restyle (2.7).
- Mobile block (≈ 981–1070): the bottom sheet with tabs (2.8), keeping the two `.atlas-bar` rules the test looks for.
- Credits and CTA (2.9): tokens only, wording untouched.
- States (2.10): `.atlas-loading`, empty line, `.atlas-error` restyle.
- Site bar and title block: fonts and tokens.

`atlas/atlas.js`
- `APP_BASEMAPS.light.ground` → `#F5F1E6`; `warmBaseStyle(map)` after style load and after basemap switch (2.4).
- `ONE_COLORS` new keys + aliases (2.5). Boundary line colours ≈ 928; label defaults ≈ 1018–1030; point default ≈ 955; cluster colours ≈ 2576–2608.
- Popup markup (`popupHTML`): kicker before title; fact list two-column with the classes in 2.6.
- Mobile sheet behaviour: build the tab row from `.ctl-group` heads; show one group; keep the `hidden` attribute contract on the element that carries class `atlas-bar`.
- Loading/empty/error states (2.10).

`atlas/iconkit.js`
- Marker shapes for the seven-colour set (2.5): dot, triangle, square, diamond, outlined dot, hollow square, hollow triangle; a helper `shapeForIndex(i)`.

`atlas/share.js`
- Any inline colours or font names in the share sheet/QR panel → tokens; the primary button Leaf.

`api/lib/fragment.js`
- `marigold` ramp added and made the default; categorical auto-palette → the seven-colour set with `tol` kept by name. Run `node test/run.mjs`; if a test asserts the old default palette name, report it rather than editing a test another session owns.

### Builder B — owner and wizard pages
Files: `atlas/owner.css`, `atlas/owner.js` (colours/strings only), `atlas/databench.css`, `atlas/databench.js` (colours only), `atlas/setup/index.html`, `atlas/setup/setup.js` (colours only), `atlas/create/index.html`, `atlas/add-data/index.html`, `atlas/admin/index.html`, `atlas/layers.html`, `atlas/edit/index.html`, `atlas/edit-layer-preview.html`, `atlas/ingest.js` / `checktable.js` (only if they emit inline colours).

Shared file rule: **`atlas/databench.css` is Builder B's** (it is loaded by `setup/` and `add-data/`, both B). **`atlas/owner.css` is Builder B's** even though `owner.js` runs inside the viewer; Builder A must not edit it, and A's token aliases in `index.html` keep it working until B lands. Neither builder edits the `*-mock.html` files or `map-style-variations.html`.

`atlas/owner.css` — section 2.11; replace every `--color-moss/rust/canopy` reference with the new names; keep radii.
`atlas/databench.css` — section 2.12; tokens and fonts; `tabular-nums` on table numerics; step chips.
`atlas/setup/index.html` (452 lines, inline `<style>` with 49 token uses) — font link, `:root` tokens, eyebrow chip, buttons, chips, inputs.
`atlas/create/index.html` (224 lines, inline style, 27 uses) — same.
`atlas/add-data/index.html` (201 lines, 15 uses) — same; it also loads `databench.css`.
`atlas/admin/index.html` (411 lines, 25 uses) — same; tables get `tabular-nums`.
`atlas/edit-layer-preview.html` (1126 lines, 39 uses; use the bulk-reader, not a whole read) — same, plus its own mini map preview if it paints colours (search `#4A5A33`, `#AE5028`, `Figtree`).
`atlas/layers.html`, `atlas/edit/index.html` — retired redirect pages: swap font link only if one exists (today: none); otherwise leave.

Both builders: commit messages name the section of this document they implement; no commits to `main` directly — a branch each (`redesign-viewer`, `redesign-owner`), PRs for Mithun.

---

## 6. Later (explicitly out of scope now)
- **Other-language font companions**: fill `--font-companions-sans/serif` and extend the Google Fonts link per script (section 3). Map glyphs for other scripts need a glyph set on the tile server, a separate task.
- **Print and hatching**: an optional diagonal hatch for the top ramp class and a print stylesheet (frame, legend box, scale bar) for photocopies.
- **Dark mode**: a second base style (dark ground) rather than a theme; only on request.
- **Self-hosting fonts** under `atlas/vendor/fonts/` if Google Fonts becomes a concern.

---

## 7. Open questions for Mithun
1. The atlas title block currently sits above the map as a web page (pushing the map down on short laptops). This plan keeps it there; moving the title into the strip only would be a layout change beyond what was chosen. Keep or move?
2. Generated choropleths default to the marigold ramp; existing atlases that name `greens`/`ylorbr` in their manifests keep those. Should existing atlases be migrated to marigold on next build, or left?
3. The phone sheet retires the bar of group marks (icons). The tab row uses text labels; long group names will truncate with an ellipsis. Acceptable, or should tabs scroll horizontally?
