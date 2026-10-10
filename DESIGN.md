---
name: LOKA Atlas
description: Layered, manifest-driven maps for any geography — public tech by Socratus.
colors:
  page: "#FAF8F3"
  surface: "#FDFCF8"
  surface-alt: "#F0EDE4"
  ink: "#24211D"
  ink-soft: "#5A5751"
  ink-faded: "#6E6A63"
  ink-border: "rgba(36,33,29,.18)"
  ink-divider: "rgba(36,33,29,.10)"
  leaf: "#2A6B41"
  leaf-deep: "#1F5232"
  leaf-tint: "rgba(42,107,65,.10)"
  sindoor: "#C9402B"
  sindoor-deep: "#9E3220"
  sindoor-tint: "rgba(201,64,43,.10)"
  marigold: "#E9A237"
  marigold-tint: "rgba(233,162,55,.16)"
  blue-tint: "rgba(58,127,161,.14)"
  map-ground: "#F5F1E6"
  map-outside: "#EAE6DC"
  map-water: "#3A7FA1"
  map-water-fill: "#C8DBE5"
  map-boundary: "#26231F"
  map-block: "#8C8985"
  map-road: "#E2DDD0"
  map-label: "#24211D"
  map-label-halo: "#F5F1E6"
  ramp-1: "#FBF1D9"
  ramp-2: "#F4CF82"
  ramp-3: "#E9A237"
  ramp-4: "#D2692A"
  ramp-5: "#A8321A"
  point-1: "#C9402B"
  point-2: "#2A6B41"
  point-3: "#E9A237"
  point-4: "#3A7FA1"
  point-5: "#A39E94"
  point-6: "#26231F"
  point-7: "#B99A1C"
typography:
  display:
    fontFamily: "'Lora', serif"
    fontSize: "clamp(1.6rem, 4vw, 2.4rem)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "'Lora', serif"
    fontSize: "1.2rem"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "'Karla', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  control:
    fontFamily: "'Karla', sans-serif"
    fontSize: "0.95rem"
    fontWeight: 600
    lineHeight: 1.4
    role: "Buttons, and the name of a thing you can act on — a file, a layer being built."
  ui:
    fontFamily: "'Karla', sans-serif"
    fontSize: "0.9rem"
    fontWeight: 600
    lineHeight: 1.5
    role: "The workhorse: switch names, form labels, nav, stepper chips. Weight drops to 400 where it is reading text rather than a prompt."
  meta:
    fontFamily: "'Karla', sans-serif"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.5
    role: "Anything that annotates something else — keys, hints, counts, required/optional markers."
  label:
    fontFamily: "'Karla', sans-serif"
    fontSize: "0.72rem"
    fontWeight: 700
    letterSpacing: "0.12em"
    role: "Uppercase stamps: the panel head, group heads, the place-card kicker, the eyebrow chip."
  numeral:
    fontFamily: "'Karla', sans-serif"
    fontVariantNumeric: "tabular-nums"
    role: "Any number that sits in a column or is compared with another: legend counts, percentages, place-card facts, stats."
  mono:
    fontFamily: "ui-monospace, Menlo, monospace"
    fontSize: "0.75rem"
    lineHeight: 1.5
rounded:
  xs: "2px"
  md: "4px"
  lg: "6px"
  pill: "999px"
  note: "xs is only for a solid shape under 16px; pill is for the switch track and a bar a few pixels tall. A circle is 50% and not on this scale."
spacing:
  xs: "0.35rem"
  sm: "0.6rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.leaf}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "0.6rem 1.2rem"
  button-primary-hover:
    backgroundColor: "{colors.leaf-deep}"
  button-secondary:
    backgroundColor: "#00000000"
    textColor: "{colors.leaf}"
    rounded: "{rounded.md}"
    padding: "0.6rem 1.2rem"
  eyebrow-chip:
    backgroundColor: "{colors.leaf-tint}"
    textColor: "{colors.leaf}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0.25rem 0.6rem"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "1.35rem"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0.55rem 0.65rem"
  place-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    borderTop: "3px solid {colors.sindoor}"
---

# Design System: LOKA Atlas

## 1. Overview

**Creative North Star: "The Field Notebook, at a market"**

LOKA Atlas still looks like a working document from fieldwork, not a dashboard: a warm
off-white page, white cards raised by a hairline, small honest controls, a map framed
like the page's plate. What changed in September 2026 is the colour it is allowed to
carry. The old earth pigments (moss, rust, ochre) have given way to the colours of a
Deoria market morning, taken down a notch: **sindoor** red for what is selected,
**marigold** for the data ramp, **banana-leaf** green for anything you can press, on
a warm off-white that is not quite white. It is louder than before on purpose — the
product is read on cheap phones in full sun — but every colour is measured so it never
shouts past the data.

The interface has two typefaces with two jobs, both chosen for how their Latin reads on
a phone: **Lora** structures (titles, headlines), **Karla** reads and
labels (everything else). Both have true tabular figures, so numbers line up.

The system still rejects the shiny-SaaS register: no gradients, no glass, no floating
stacks of shadowed cards, no neon, no emoji-as-icons, no glowing dark mode. A screen
holds one map, one shelf of layers, and a credits ledger, in that order of importance.

**Key characteristics**
- Warm off-white page (#FAF8F3); near-white surfaces (#FDFCF8) lifted by a hairline.
- One green speaks for the product (Leaf #2A6B41); one red marks selection (Sindoor #C9402B); the marigold ramp belongs to the data.
- The map sits in a thin ink frame with a cream ground (#F5F1E6), so it reads as the page's plate rather than a pasted screenshot.
- Flat, ink-on-paper depth: hairlines and tone steps, not shadows.
- Serif structures, sans reads. Numbers are tabular.
- Everything credited: sources, partners and the "Build your own atlas" call are part of the identity.

## 2. Colors

### Interface
- **Page** (#FAF8F3): the page background — warm, not white.
- **Surface** (#FDFCF8): cards, inputs, the layer shelf, the strip, the place card.
- **Surface Alt** (#F0EDE4): the credit strip, recessed wells, the phone sheet's tab row background.
- **Ink** (#24211D): primary text. 15.6:1 on Surface.
- **Ink Soft** (#5A5751): secondary and muted text. 7.0:1 on Surface.
- **Ink Faded** (#6E6A63): hints only, never body copy. ≥ 4.5:1 on Surface.
- **Ink Border** rgba(36,33,29,.18) and **Ink Divider** rgba(36,33,29,.10): every stroke is a transparency of Ink.

### Action and selection
- **Leaf** (#2A6B41): the product's one voice — primary buttons, switches when on, links, focus rings, the active Map/Satellite segment, the active phone tab. White on Leaf is 6.4:1. Deepens to **Leaf Deep** (#1F5232) on hover/press. **Leaf Tint** for eyebrow chips and selection washes.
- **Sindoor** (#C9402B): "this thing, here" — the ring around a selected map feature, the top edge of the place card, the selected-row mark. 4.8:1 on Surface, so it may also carry short warning text as **Sindoor Deep** (#9E3220). Never a button fill.
- **Marigold** (#E9A237): the middle of the data ramp and a marker colour. Never text. **Marigold Tint** rgba(233,162,55,.16) is the ground a quoted reason sits on (the "because" chips); **Blue Tint** rgba(58,127,161,.14) is the wash for a water-coloured chip in the owner's pickers. Both are washes, never fills for text to sit on unless the text is Ink.

### Map tokens
- **Ground** (#F5F1E6) inside the atlas region; **Outside** (#EAE6DC) beyond it; the framed well's background is Ground.
- **Water** (#3A7FA1) lines; **Water Fill** (#C8DBE5) for lakes, wetlands, oxbows.
- **Boundary** (#26231F) at 1.8px for the district/region outline; **Block** (#8C8985) at 0.7px for the next level down; **Road** (#E2DDD0).
- **Label** (#24211D) with a **Halo** of Ground (#F5F1E6) at 2.2px. District names uppercase, +0.2em, Lora 700; place names Karla 600, no tracking.

### Sequential ramp (5 steps, light → dark)
`#FBF1D9 · #F4CF82 · #E9A237 · #D2692A · #A8321A`
Lightness stays in order under deuteranopia simulation (L* 96 → 86 → 74 → 59 → 43, smallest step 9.7). The first step is close to Ground, so class-1 blocks need the Block hairline to read. Fills ship translucent (0.55–0.75) so boundaries show through.

### Point set (7 colours, each with its own marker shape)
| # | Colour | Name | Shape |
|---|---|---|---|
| 1 | #C9402B | Sindoor | dot |
| 2 | #2A6B41 | Banana leaf | triangle |
| 3 | #E9A237 | Marigold | square |
| 4 | #3A7FA1 | Blue | diamond |
| 5 | #A39E94 | Stone | dot, ink outline |
| 6 | #26231F | Black | square, hollow |
| 7 | #B99A1C | Turmeric | triangle, hollow |

The closest pair after red-green simulation is Marigold vs Turmeric (ΔE 8.7); they never share a shape. Shape carries the difference that colour cannot.

### Named rules
**The Map Speaks Rule** (kept). Saturated colour belongs to data on the map. The interface uses Leaf and its tints on roughly 10% of the screen and nothing else. If a UI element competes with the map for colour, mute the element.

**The Two Marks Rule** (new). Green means you can act on it; sindoor means it is the one you chose. They are never swapped and never used for the same job, so "on" and "chosen" cannot be confused.

**The Measured Colour Rule** (new). Any new text/background pair must clear 4.5:1 (3:1 for lines and rings). Any new ramp must stay in lightness order under deuteranopia simulation. Any new categorical colour must come with a marker shape. Numbers, not taste, settle arguments.

**The Earth Ink Rule** is retired. The Bazaar hues are deliberately more saturated than soil and turmeric; what governs them now is measurement, not a mixing metaphor.

## 3. Typography

**Display font:** Lora (700; 600 only if a file is added)
**Body font:** Karla (400, 600, 700)
**Mono:** ui-monospace / Menlo — build logs, tokens, embed snippets only.

**Character:** Lora is a quiet transitional serif: classic, not bookish, at home on a title. Karla has a large x-height, open counters and a distinct 1 / l / I, which is what keeps an 11px legend label readable on a cheap phone. Both were drawn by one studio for screens, so the pairing reads as one voice.

### Hierarchy
- **Display** (Serif 700, clamp 1.6–2.4rem, 1.12): the atlas title; one per page, `text-wrap: balance`.
- **Headline** (Serif 700, ~1.2rem, 1.25): panel and section headings, the place-card name.
- **Body** (Sans 400, 1rem, 1.55): prose, capped at 65–75ch, `text-wrap: pretty`.
- **Control / UI** (Sans 600, 0.9–0.95rem): switch names, buttons, form labels. A switched-off row drops to 400 and Ink Soft.
- **Meta** (Sans 400, 0.8rem): keys, hints, counts, credits.
- **Label** (Sans 700, 0.72rem, uppercase, +0.12em): the panel head ("MAP LAYERS"), group heads ("CROPS & LAND"), the place-card kicker, the eyebrow chip.
- **Numeral**: `font-variant-numeric: tabular-nums` on every column of numbers — legend counts, percentages, place-card facts, stats.
- **Map labels**: district names Serif 700 uppercase +0.2em; place names Sans 600; always with the Ground halo.

### Named rules
**The Two Voices Rule** (kept, faces changed). Serif for structure, Sans for reading and labelling. Never a third family. Never the serif for paragraphs or switch names; never the sans for the atlas title.

**The Two-Channel Rule** (kept). Every step down in rank moves at least two of size, weight and colour together.

**The Numbers Line Up Rule** (new). Any number that sits above or beside another number is tabular. Karla's default figures are proportional, so this must be set explicitly.

**The Companions Rule** (new, for later). Font stacks are written so a script companion can be added without touching a selector: `"Karla", var(--font-companions-sans), sans-serif` and `"Lora", var(--font-companions-serif), serif`. The companion variables are **never empty**: today they hold the primary face as a placeholder (`--font-companions-sans: "Karla"; --font-companions-serif: "Lora";`). An empty value left `, ,` in the stack, Chromium threw the whole declaration away and every page fell back to Times (measured by both builders, 26 Sep 2026). When another language ships, the matched Noto faces are appended in those variables — `--font-companions-sans: "Karla", "Noto Sans Devanagari";` — and nothing else changes.

## 4. Elevation

Flat, ink on paper (kept). Depth is a hairline of Ink Border on a lighter Surface — not a shadow. Two sanctioned exceptions remain: the floating layer shelf over the map (`0 2px 12px rgba(36,33,29,.12)` plus a ≥ 94%-opaque backdrop) and the place card (`0 2px 12px rgba(0,0,0,.14)`), both legibility devices over unpredictable map imagery. The map well is not shadowed any more; it is **framed**: a 1px Ink line, then a 2px gap, then a second 1px Ink line (`border` + `outline` with `outline-offset: 2px`).

**The Ink-on-Paper Rule** (kept). Surfaces are flat at rest and flat on hover. Try a border, then a tone step, then ask.

## 5. Components

Refined and restrained (kept): thin strokes, small radii, generous whitespace, quiet colour.

### Buttons
- Barely rounded (4px). Never pills, never full-width unless mobile.
- **Primary:** Leaf fill, white text; hover Leaf Deep. One primary action per view.
- **Secondary:** transparent, 1px Leaf border, Leaf text; hover Leaf Tint wash.
- **Ghost:** borderless, Ink Soft, underlined on hover.
- **Focus:** 2px Leaf outline, 2px offset — never a glow.

### Chips
- **Eyebrow chip:** Leaf Tint, Leaf text, Label type, 4px.
- **Data chips:** Surface with Ink Border and an 8px swatch; selected = Leaf border + Leaf Tint wash + 600. Cost badges: `free` in Leaf Tint, `needs approval` in Sindoor Tint.

### Cards / containers
6px, Surface, 1px Ink Border, no shadow, 1.35rem padding. Cards are rare; lists and dividers are the default. The **place card** is the exception that carries a 3px Sindoor top edge and the panel shadow.

### Inputs
Surface fill, 1px Ink Border, 4px, Sans 0.95rem. Labels small bold Ink Soft above. Focus: the 2px Leaf outline. Error text in Sindoor Deep, never a red border wall.

### Toggles (signature, kept)
32×18 pill track (#CFCBC2 off → Leaf on), white knob, 0.2s ease-out; tri-state masters render indeterminate as Leaf at 60% with a centred knob. Touch target ≥ 44px on phones. The most-touched control in the product: calm and instant.

### The atlas page: map edge to edge (September 2026, layout B)
An atlas is the map. Below one thin header (44px on a wide screen, 52px on a phone) the stage fills the whole viewport; the page does not scroll. The lead text, the call-to-action band and the site footer are not drawn on an atlas — their words are reached from the map (the "About & sources" panel, LOKA's badge). The home gallery keeps its page shape.

### The header (org branding first; one row for everyone)
The header carries the organisation that built the atlas: its logo (30px, if it gave one) at the left spanning two lines, its name in Label type above, the atlas title in Lora 700 (1.1rem) beneath. With no logo the name alone reads finished. At the right, one group of acts: the **Owner** button (owner only, see below), **Share**, then the site links in Meta type — "all atlases", the signed-in email, sign out (or sign in). The row never wraps: long names and titles shorten with an ellipsis (the full name stays in the credits and the page title), so the header is 44px for a visitor and for an owner alike, and the map starts at the same place for both. Between a phone and a wide screen (721–1100px) Share is its icon and only sign in / sign out stay among the links; on a phone the Owner button is its dot alone. Nothing about the map lives in the header. No "LOKA / APPS" wordmark: LOKA's presence on an atlas is the badge.

### The map toolbar and the drawer (signature, kept; the strip moved to the map)
The **map toolbar** (the code still calls it the strip) holds what is true of the whole map: search, then Map/Satellite. It floats at the map's top edge just right of the Layers drawer — 8px down, 8px in from the drawer's edge, following the drawer when it folds — wearing the drawer's own materials (Surface at 95%, hairline edge, panel-lift shadow, 4px corners) so the two read as one family of controls over the map. Inside it the search box and the Map/Satellite pair drop their own boxes; the box returns to the search field on focus. The count line under search ("16 of 66 places are Green Space · show all") hangs from the toolbar's left edge, clear of the drawer. On a phone the toolbar is the floating search box the phone always had, full width, and Map/Satellite stays in the sheet's foot. The **drawer** is unchanged: it floats 8px inside the stage under the header, holds layers and nothing else (switches, keys, legends, fold notes), stops 44px above the stage's foot, is open when the page loads, and folds to its "Layers · N" head. Panel head has a 2px Leaf rule beneath it; group heads are Label type over a hairline. An undeclared base group is called "Boundaries & places" — the owner's words for it; a manifest that declares the group keeps its own name ("Base" on Deoria).

### The Owner menu (owner only)
Everything about owning an atlas folds into one **Owner ▾** button beside Share: Meta type at 600, Sindoor-deep words on Surface, outlined in Sindoor — the colour the product keeps for "this is yours" — with a dot before the word that is Leaf while anyone can open the atlas. It opens a menu hanging from the header's right (Surface at 97%, Sindoor hairline, panel-lift shadow, 19–26rem wide), headed OWNER in Label type, with four lines that each pair what they are about (left, Ink Soft, UI type at 400) with the one act on it (right, Leaf 600, underlined on hover — a word, never a box):

- **● Anyone with the link — not listed on the LOKA Atlas page** · Change (or **Private — only you, your editors and people with the private link**, or **● Listed — anyone with the link, and on the LOKA Atlas page**). Change opens a sheet, "Who can see this atlas?", with the three as radio choices, each a bold name over one plain sentence — Private says "Its files leave the open web", Anyone with the link says they "can open it and download its data" — a note under them saying where the link will be (Share), Save and Cancel. The two ideas that used to share one switch, who can open the files and whether the atlas is on the public page, are kept apart on purpose: the old "Make it private" only unlisted, and nothing the owner can press is called private unless the files are actually out of reach. After a change the page comes back fresh with a toast, and after Private the Share panel opens on the private link.
- **Boundaries & place names for Bengaluru** · Change
- **Open data layers** · Add or remove
- **Your data** · + Add data
- **Title, logo, about** · Settings

A press outside or Esc shuts it; a line that opens something else (Change and Settings open the Settings panel, Add or remove opens the open-data sheet, Add data leaves for its own pages) shuts it first.

**Open data layers (September 2026).** The wizard's step 3 again, for a built atlas, as a sheet like Settings: the same grouped rows, plain descriptions and NEEDS APPROVAL tag (the markup is one shared piece, `atlas/catalog-rows.js`, so the two never drift), pre-ticked with what the atlas has; groups the atlas already draws from open, the rest folded. A line under the rows says what a press would do — "Adding Rivers & waterways · Taking off Terrain." — and Apply stays quiet until there is something to say. Taking a layer off asks once, in a Sindoor-tint box: it comes from open data and can be added back; your own data stays. Apply rebuilds the base map the way a change of region does — the atlas stays up, and the owner's own layers, About text and logo travel across. A heavy layer goes into the same approval queue as a first build; the menu line then reads **Open data layers · Waiting for approval** and the sheet says what was asked for instead of offering ticks. An atlas that the wizard did not build (no recorded choice of layers or region — Deoria) shows **Open data layers · Made by hand — can't be changed here** in Meta type, and no sheet. On a phone the button is its dot alone and the menu is a sheet from the top, full width under the header, the region line stacked on two lines. The per-layer "⋯" on a layer's row (Edit card, Remove) is a different menu about a different thing and stays where it is.

### The setup wizard (October 2026, release 1)
Sign in first, as before. Then four steps, in the order a person has the answers: **Where is your work?** — the place search and the file drop side by side as equals, an "or" between them (stacked on a phone with the "or" as a rule across); a look at your data, only when a file came along; **What open data goes on it?** — the whole catalogue up front in its four groups, A to Z inside a group, nothing pre-ticked but the boundaries (shown as the first row, ticked and locked, tagged ALWAYS INCLUDED in the leaf wash; place names stay in the line above), a NEEDS APPROVAL tag in the sindoor wash on the rows the team must OK, rows the region is too wide for greyed at the end of their group, and a foot in body type that adds it up — "3 layers · about 4 minutes to build" — over the line "You can add any of these later from Owner ▾ → Open data layers"; **Name it** — the atlas name (filled in from the place or the file) and the organisation (from the account when it has one), no description and — since release 2 — no logo (Settings has both); then **Build**, unchanged. The rows are the same shared piece the Owner menu's sheet draws (`atlas/catalog-rows.js`); the locked row is the wizard's alone. Plain words on every screen: no "recommended", no step numbers in the copy beyond the stepper's own.

### The setup wizard, release 2 (October 2026): what we found, the first look, the logo in Settings
Between **Where** and **Open data** everyone now gets **Here's what we found**, one screen that folds the old "your data — check it" step in. At the left the one big thing: the count, in body face at display size with tabular figures ("38 of 42" over "rows name a place we know" — and once the file's check settles, "rows are on the map"), a sentence naming the places, and the places as static chips. At the right a small map, plain SVG and no map library: the matched places' outlines (they ride along with the region-finding when there are 60 or fewer) in Leaf Tint, the file's own rows as Sindoor dots when it had coordinates, the places shaded darker when rows were placed by name; names on the map up to twelve places; on a phone it drops under the words at 200px. The file's check runs under that on the same screen, with its fix rows. Two buttons, one green: **Looks right →** with *Choose the places myself* beside it — and when fewer than 60% of the rows landed they swap, "Choose the places myself" turns green and first, "Continue anyway" goes secondary, and a Marigold-tint line says why. A typed region gets the same screen with "N places in India" and the chips; nothing to check, so no bench. The stepper reads Where · What we found · Open data · Name it · Build, numbered in the page.

**The first look** — once, on the atlas the wizard just built, for the owner: a card docked where the place card docks (top-right of the map, 340px; across the top on a phone), Surface with the hairline and a 3px Sindoor top edge, headed YOUR ATLAS IS BUILT in Label type in Sindoor Deep. It says what was built ("Boundaries and place names for Mysuru, with 3 open data layers."), what of the file made it ("38 of 42 rows from village.xlsx are on the map."), and, in a Marigold-tint line, the rows that did not, with the way to fix them (add the file again under Your data). Two acts: **Who can see it** (primary; opens the same sheet as the Owner menu) and **Add open data**; under them, the fact that matters most about a fresh atlas — "Right now it is private — only you can open it. Share has a private link to send to people, and the Owner menu can open it to everyone." (a new atlas starts private since 9 October 2026; an atlas from before that, still open to the link, reads "Right now anyone with the link can open it, and it is not listed on the LOKA Atlas page" — the line follows the record, never a guess); × or Esc puts it away; it never comes back (the `built=1` cue is taken off the address at once).

**The logo lives in Settings.** The Identity section gains *Your organisation or project* and a *Logo* field: the current picture at header size (30px) beside the name in Label type, with Change and Remove; or "Add a logo" when there is none. Any picture file is redrawn as a small PNG in the browser (`atlas/logo-tools.js`, the one copy, loaded on demand). Nothing is sent until Save. The wizard's Name screen lost its logo fold and says where it went.

### The setup wizard, release 3 (October 2026): which place did you mean, villages as points, rows that need a place
**Which Nautan did you mean?** — a screen after *Here's what we found*, only when a name means more than one place and the file's other rows could not settle it (a name with exactly one of its places inside the area the other rows cover is placed there, "put by its neighbours", and not asked). One question at a time, counted in Label type above the title ("QUESTION 1 OF 2"). The places are a list of option cards (page colour, hairline; the chosen one in the leaf wash with a leaf edge), each with a numbered disc — leaf for the first, Ink for the rest — the place and its district in body 600, the first tagged SUGGESTED in leaf Label type, and under it in meta type where it is: "inside the area your other places cover" or "about 210 km from your other places". Beside the list (under it on a phone) a small map with no library: the area the other rows cover as a dashed leaf box in the leaf wash, labelled *your other places*, and each place as its numbered disc. Under the list, "Same for all 3 rows that say …", ticked. Buttons: **Use Nautan, Gopalganj →** (primary, names the choice), **Skip for now** (secondary), ← Back (quiet); a meta line says what comes next and that skipped rows wait on the finished atlas. A name spelled unlike any place ("Which place is 'Sidhwalia'?") uses the same screen. The model's guessed spellings (release 4) follow as one list — "We guessed these spellings — check them" — each row a name and a dropdown (our guess first, the other candidates, "Leave it off for now").

**Villages as points** — on *Here's what we found*, when a quarter or more of the rows (and at least three) name nothing the outlines hold: a Marigold-tint box, heading in body 700 ("5 of 11 rows name places we have no outline for"), a sentence saying why (outlines stop at blocks) and what can be done (look each of those rows up by name on OpenStreetMap and put it on as a point; "The 6 rows that matched an outline keep it."), a meta line saying exactly what is sent, then **Look them up** / Keep outlines only. Only the rows no outline holds are looked up. While it runs, the working stripe and a count; then the answers as a checklist (found ones whose name matches ticked, the rest unticked, "not found" in Sindoor Deep), and **Use the ticked ones (5)**, after which the box says both numbers ("6 rows go on the map as outlines, and 5 as points"). The 60% "choose the places myself" warning stands aside while this box is up, because the region is right and the outlines are not.

**Points go beside the outlines, never instead of them** (October 2026). A layer is one kind of shape — the map draws it as areas or as pins, not both — so a file that ends up with both becomes two layers under Your data, side by side: "<name>" with its outlines and "<name> · as points" with the looked-up rows, sharing the file's columns, card and colour keys. Each names the other; removing either takes both, and the remove sentence says so ("“… · as points” came from the same file and comes off with it."). OpenStreetMap is credited once, under the same name the outlines' own credit uses. Rows neither matched nor ticked stay in *Still need a place*. In the Map Browser the pair is one row (see *Map Browser*, "one file, one row").

**Rows that need a place** — on the finished atlas the first look links to them ("2 rows still need a place — give them one", "1 place was put by its neighbours (Basantpur). Check it."), and the link opens a page in the wizard's own frame (`setup/?fix=<atlas>`): three groups — *Still need a place*, *Put by their neighbours — check them*, *We guessed these spellings — check them* — each name a card with the same option list, the place it is on now tagged ON THE MAP NOW, and **Keep this** / **Move it here** / **Put it here**, with a quiet *Leave it off the map*. A row with nothing to choose from gets a search box over the atlas's own outlines. A row placed by name can also go on as a point: an option card "As a point: <what the map found>" (meta: found by name on OpenStreetMap) when it was looked up during setup, or a secondary **Look it up on the map** that asks for it then; chosen, it lands in the file's points layer, and a point row given an outline moves back to the outlines. A quiet "I've seen these — stop listing them" at the foot. The list is kept for thirty days at most.

### The setup wizard, review fixes (October 2026)
From building a real atlas from a 134-row file. **Where** says what a dropped file found in one line, in the leaf-tint verdict box above the button, and nowhere else: "Found: Bangalore and Bangalore Rural, from the coordinates in 134 of 134 rows. Take any out, or search to add more." (or "from the “district” column"). It follows the chips; once none of the file's places is chosen it falls back to "Your atlas will cover …". "Ready to build" is gone from every line — open data and a name still follow. The button is a plain **Continue →**. On **Here's what we found**, *Choose the places myself* sits under the summary and the small map — with the region it changes, not under the column table where it read as part of that box — outlined when most rows landed, green when under 60% did; the way on (**Looks right →**, or "Continue anyway") stays at the foot with ← Back. While the file is being checked that button is disabled, faded to 60%, and reads "Checking your rows…"; the verdict line above the stripe names the step the server is on, as it starts ("Sending your 134 rows…", "Getting the outlines of your places…", "Reading what each column holds…", "Matching your 134 rows to places…", "Checking the spelling of 12 place names…"), with a running "14 seconds so far." from the third second. No share done is shown: the server cannot know one, so none is invented. If the check fails the line turns Sindoor tint ("Your rows couldn't be checked. … Try again, or carry on and add the file from the atlas afterwards."), a secondary **Try again** appears under it, and the way on becomes "Continue anyway". The column table is headed **Columns the atlas will use**, with one line: "Untick any you don't want on the map. ✎ renames one or changes what it holds; Preview rows lets you fix entries by hand."

**Questions on a new atlas arrive late, and say so.** They are found by a reading on the server that starts when the layer is added and takes half a minute or more (see *Questions are found on the server* below). Until it lands, the layer's row shows a note directly under its keys (not at the foot of the row): "Finding questions in your data… more will appear here in about half a minute." with the columns being read under it in muted type. The note is drawn from the server's own record, so a redrawn row says the same thing, and it is replaced by the outcome when the reading ends.

### Questions are found on the server (October 2026)
The questions a layer can answer are no longer found in the owner's browser. The server starts the reading the moment a layer of points is put on an atlas — the wizard's hand-off, adding data, changing a layer, fixing its rows — and nobody has to keep a page open. It is read once for each version of its places: putting the same rows back does nothing, changed rows are read again (keeping the questions already settled), and writing the answers on is not counted as a change. One reading runs at a time; the list is kept in a file, so a restart carries on where it stopped. A reading is paid for out of the atlas owner's hourly allowance, as when their browser started it, and stops after one try if it fails (an unreachable model goes on the existing retry list and the owner is emailed when it lands). Without a model key nothing is read. The owner's row shows "Finding questions in your data… more will appear here in about half a minute." only while the server is queued or reading — the old "Keep this page open until they do." is gone — and the page looks again every five seconds, putting the new keys on the map without a reload when the reading lands. A failure shows one plain line: "No questions could be found just now. Nothing was added." or, when the model could not be reached, that it will be tried again and the owner emailed. Layers read before this keep their questions untouched; `deploy/queue-question-readings.mjs` (dry run unless `--apply`) lists the layers that never got theirs and puts them on the list. The operator's own Deoria atlas is never read.

### A long column heading gets a short name (October 2026)
A spreadsheet's column heading is often a whole survey question — "What languages do you primarily work in? Feel free to mention all if there is more than one." — and that heading was the name of the key, the field on the card and the legend's line. One rule now decides how a heading reads, shared by the viewer and the server (`atlas/label-rules.js`, loaded like `reading-rules.js`), so the same heading gets the same name everywhere. A heading keeps its own capitals (the viewer used to lowercase everything after the first letter — "…work in? feel free…"); only a slug like `created_at` is opened out, and a heading SHOUTED IN CAPITALS is brought down to a sentence. A heading longer than 36 characters is long — measured: a key's row is 244px wide and a 34-character name took 209px, so about 35 characters fit on a line — and is shown by a short name: the one the owner gave (`keyLabels`, which always wins, so a discovered question's wording is never touched), else the one the server stored on the layer (`shortLabels`), else the plain cut the page makes itself (the first clause, asking words taken off — "Languages", "Geographic areas", "Name of Organisation or Collective"; never a word the heading does not have). Wherever a label was shortened the whole heading is its hover, and a small ⓘ after it — a real button, the heading as its aria-label — opens the heading under the row for a phone, where there is no hover; it sits at the key row's end where a layer's own ⓘ sits, and never flips the switch beside it. The server asks the model once per layer for all its long headings at once (plain words, at most four and 32 characters, the heading's own language), the moment the layer is put on an atlas, on its own waiting list made the way the questions' is (`api/lib/atlas/short-labels.js`: once per version of the headings, one at a time, kept in a file, charged to the owner's hour, the names kept on the list so a re-commit gets them back for nothing). A name that breaks the rule is replaced by the plain cut. Without a model nothing is asked — the page's own cut serves. `deploy/queue-short-labels.mjs` (dry run unless `--apply`) lists the layers added before this and puts them on the list; Deoria is never touched.

### The phone sheet (signature, kept)
On phones the drawer docks as a bottom sheet with a grab bar and a **row of group tabs** (Base · Crops · Water …), shown at rest so the layers are obvious. One group shows at a time; each row is a full-width touch target (min 44px) with the switch at the row's end; the active tab is Leaf with white text. The sheet's foot carries Map/Satellite at the left and LOKA's badge at the right. Tapping the grab bar puts an open group away; tapping it again folds the sheet to a "Layers · N" chip bottom-left, and the badge comes out to float bottom-right. It never covers the map's top third.

### One mark for every place (October 2026)
**Every place has one mark. An area also shows how far it reaches.** Every row of a contributed file is a place where somebody or something is, and every one of them wears the same teardrop marker — the standard location marker, Sindoor Deep with a white keyline, 20×28px, its tip on the spot. A pin's row is marked at its coordinates. An area's row keeps its shading and outline, always drawn, and wears the same marker at its **pole of inaccessibility** — the point of the shape furthest from any edge — so a crescent's marker is on the crescent and a ring's is on the ring, not in the hole. The marker is the teardrop and not a dot because the keys' marks are shapes (circle, square, triangle, diamond, bar) and a round place-dot read as a circle key.

One set of behaviours, pins and areas alike: the name beside the marker, dropped when crowded; a tap opens the same card; keys put their marks beside the marker (colour goes on the marker, never on an area's fill); markers that collide fold into the counted ink disc and fan open on a tap; search hides the markers that do not match, and for an area the shading goes pale as well, so a non-match's extent is still faintly there; the chosen place rings its marker in Sindoor, and an area's outline rings with it. Twins — two rows on the same shape — fold and fan like co-located pins; a tap on the shading still offers the chooser. Only contributed layers get markers; the base map's districts, forests and rivers never do. The small round centre dot areas wore before is retired. Multi-choice questions are not solved by this: a key still colours by one answer.

### Map Browser (October 2026)
A layer of the reader's own data is a **collection**, not a style. Its row in the drawer says what it holds — the place mark in the layer's colour, then "11 people" in Meta type (the noun is the manifest's `noun`, else "places" for pins and "areas" for shapes) — as plain text, not a control. A search narrows the count with the map and the row reads "16 of 134 places match". The list of names that used to open from a chevron is gone: it was the index an area needed when an area could be lost under somebody else's shape or its dropped name, and with one mark for every place the map is the index — every place carries its name and folds into a counted disc. **One file, one row:** a file that went on as two layers (its outlines, and "<name> · as points" for the rows that only had a point) is one row here — one switch that moves both, one count, and a Muted second line saying how it split, "6 as areas · 5 as points". The two layers still exist in the engine; the visitor never sees that. The keys offered under that row are the outlines layer's; the points twin's are not offered yet (a key over both halves is a separate decision).

**A kind is a chip (September 2026).** Each kind under a key ("Green Space · 16") is a button. Pressed, it fills with Leaf Tint on a Leaf edge, the map keeps only those places, and the line under search reads "16 of 66 places are Green Space · show all" (one place: "is"; the leftover row: "are something else"; a question's silent places: "are without an answer"). Pressing it again, or "show all", comes back. One filter at a time, the same rule tags follow: a kind replaces a typed word or a tapped tag and empties the box; typing or tapping a tag replaces the kind; a key going off drops a filter that was on it. The words behind a kind (and the places a question is silent on) open from a small chevron after the row, so the row itself is free to narrow. Keys are offered on contributed pins and, since October 2026, on contributed areas. A key groups places, so a column of the reader's own is offered only when at least half of the places that answered it share their answer with another place (October 2026) — nine different organisation names on eleven places is a caption, not a key. Such a column gets no tick under the layer, but every place still shows its answer on its card, as a question answered by too few places does; and when a layer is left with nothing to offer, the "Mark each place by" heading does not appear at all. The column the owner chose to colour by is always offered. The one-row legend that repeated the layer's name is gone from these layers. Which layers: contributed pins and shapes, and a curated shape the manifest marks `searchable` — never the base group. On a phone the group's tab counts the people ("Your data 11").

**Twins** — two rows drawn as the same shape — get a **chooser** at the top of the card: a Label-type line ("2 PEOPLE HERE") and a chip per name, the one being shown in Sindoor Tint with a Sindoor edge. Pressing a chip swaps the card and moves the ring. The same chooser opens when a tap lands on several rows of one contributed layer (a neighbourhood inside a state). On the map each twin's label carries both names, "Gijs Spoor & Vijay Ramesh", so whichever copy survives the collision says the whole truth.

**First-visit cue** — one line at the map's foot, above the phone's sheet, on a Surface pill with a Marigold dot before it: "Tap an area to read who works there" (from the layer's noun; a manifest's `hint` overrides), plus a soft Marigold ring pulsing on the dot nearest the middle of the view. Gone at the first tap on the map, on a name, or when any card opens; once per device; never in an embed; no pulse under `prefers-reduced-motion`.

### LOKA's badge ("Powered by [LOKA] Atlas")
The one LOKA element on every atlas view, embeds included. Hard-coded in the page, never manifest-driven. "Powered by" in Karla 600 at Label size, the LOKA mark as an image 10px tall, "Atlas" in Lora 700 at .85rem; a hairline pill on Surface at 94%. Floats bottom-right over the map on a wide screen; sits in the sheet's foot on a phone. Links to `./setup/` (in an embed, in a new tab).

### "About & sources"
A chip bottom-left of the map (Label type on a Surface pill), with the base map's own attribution beside it. It opens the credits as a panel over the map's corner (Surface, hairline, panel-lift shadow; a bottom sheet on phones): the atlas's subtitle and description, then the credits ledger as before — "Made by" (the organisation, partners), "Data & sources" — and a foot with "Build your own atlas for free →" and "All atlases". Not modal: the map stays live; Esc, the × or a click on the map put it away.

### Map frame, controls, place card
- The map well: Ground background, double ink frame (see Elevation), 8px inset from the shelf.
- Zoom controls: 22–26px Surface squares with Ink Border, 4px, bottom-right; no compass.
- The scale bar sits with the zoom buttons bottom-right (the bottom-left corner belongs to the "About & sources" chip).
- **Place card:** Surface, 4px, 3px Sindoor top edge, photo band, Label kicker in Leaf ("SURVEY VILLAGE · GORAKHPUR"), Headline name, then a two-column fact list with tabular values. Close is a 14px circle top-right.
- **Where the card opens (late September 2026):** on a wide screen (721px and up) every card is **docked at the right** of the map — 8px in from the top and right edges, 340px wide, as tall as it needs up to the badge, then it scrolls as one piece; no tip. The zoom buttons step left of it while it is open. The pin or shape it is about keeps its Sindoor mark, and the map pans it clear of the card if it would sit underneath. Esc, × or a tap on the map close it. On a phone the card stays along the bottom, above the sheet, as before. Measured on Bengaluru at 1280×800: a 691px card fits without a scroll; the pin, 200px left of the card, is not moved.
- **Selected feature:** a 2px Sindoor ring plus a faint 1px outer ring; the label is not changed. A chosen **pin** wears the same ring around its head (`.atlas-mnode.sel`).
- **Counted discs:** where pins would collide they are one disc with a count. A counted disc is **ink, not Leaf** — Ink Soft (#5A5751) under 10, #3F3C37 to 49, Ink (#24211D) from 50 — with a 2px white ring and a white count (7.0:1 on the palest step). Green read as a key colour ("Green Space"), and a disc is a count, not a kind of place. Discs never touch: two discs, or a disc and a lone pin, that would land on each other on screen are drawn once as one disc that counts them all (see MERGED DISCS in atlas.js).
- **Pin names:** a pin layer's `label_text` is drawn by the map, like a shape layer's — Karla-equivalent sans at 11px under the pin's foot, with the Ground halo — so names that would collide are dropped, and a name is never written across a pin or a disc. `maxChars` (default 32) cuts a sentence at a word.
- **A pressed kind in a key:** the pressed chip fills with Leaf Tint on a Leaf edge and wears a small ×; the other kinds of that key step back to 55% but stay tappable (tapping one switches); and under the chips a line in Label type says "Showing only Culture (32) · Show all". The count line above the map says the same thing in the toolbar's voice.

### Navigation
One thin bar, shared by the home gallery and every atlas. On the home gallery it reads "LOKA Atlas" (the page's title, Lora) with the links at the right; on an atlas it carries the organisation's block (see The header). Links Ink Soft in Meta type. No active pills, no bottom borders.

### Credits and the call to action
The credits ledger (Surface Alt, hairline top edge: "Made by … with …", data sources, contributed data, the people who walked the ground, the ODbL note) is kept in full but lives behind the "About & sources" chip on an atlas. The LOKA logo block that headed it is gone — the badge is LOKA's mark now. The call-to-action band ("Build an atlas like this…") shows on the home gallery only; on an atlas its link is the badge and the panel's foot.

## 6. Motion
Transitions ≤ 0.2s ease-out (kept); the phone sheet slides in 0.28s with `cubic-bezier(.22,1,.36,1)`. `prefers-reduced-motion` disables all of it. Nothing bounces, nothing springs.

## 7. Dark mode
Not shipped. The product is used outdoors and on projectors in light rooms; a dark map ground would be a second map style, not a theme. Pages must render correctly if the OS is dark (no inverted images, no invisible text), which the fixed tokens guarantee. Revisit only with a real request.

## 8. Do's and Don'ts

**Do**
- Keep the interface paper-quiet; let the ramp and markers be the most colourful thing on screen.
- Separate with hairlines; reach for Surface + border before a shadow.
- Use Leaf for every affordance and Sindoor for every selection, and nothing else for either.
- Give every map label the Ground halo.
- Set tabular figures on every column of numbers.
- Ship layers translucent with opacity sliders where stacking matters.
- Credit sources, partners and licences visibly.

**Don't**
- No gradients, no glass, no glow, no shadows on cards or buttons or hovers.
- No Inter, Roboto, Open Sans, system-ui or any third family as a face.
- No emoji as icons; use the icon kit.
- No purple, no indigo, no teal; nothing outside the tokens above without a measured pair.
- No `border-left` stripes, hero-metric blocks or identical icon-card grids.
- No radius over 6px on containers; pills are for the switch track only.

## 9. What changed from the previous design (September 2026)

**Replaced**
- Palette: moss / canopy / rust / ochre / sienna / paper → Leaf / Leaf Deep / Sindoor / Marigold / warm off-white ("Bazaar, a little softer", measured).
- Faces: Figtree + DM Sans → Lora + Karla. Weights: serif 700; sans 400 / 600 / 700.
- Map base: the pale grey base and its "grey CARTO" feel → cream Ground (#F5F1E6) inside a double ink frame; boundary ink is now near-black (#26231F), not ochre.
- Map data colours: the `greens` / `ylorbr` earth ramps → the marigold ramp; point colours are the seven-colour set with mandatory marker shapes.
- Phone layout: the 46% bottom tray with a bar of group marks → a bottom sheet with group tabs, one group at a time, 44px rows.
- Atlas page (layout B, later in September): the title block above a framed map well → the map edge to edge under one 44px header carrying the organisation's logo, name and title; the "LOKA Atlas" wordmark in the strip and the LOKA logo in the credits → one "Powered by [LOKA] Atlas" badge; the credits ledger and the lead text → the "About & sources" panel; the shelf → a drawer that is open on load and folds to a "Layers · N" button. Measured at 1280×800: map on screen 55% → 94%, map not covered 36% → 70% (drawer open) / 92% (folded). At 375×812: 63% → 93% on screen, 38% → 70% not covered with the sheet at rest.

**Kept**
The Map Speaks Rule, the Two Voices Rule (faces changed), the Two-Channel Rule, the Ink-on-Paper Rule, the One-Skeleton Rule for lists, the Strip and the Shelf, the signature toggle, small radii, the credits ledger, the motion limits.

**Retired**
The Earth Ink Rule ("nothing bluer than #5f7f92, nothing redder than rust") — replaced by the Measured Colour Rule. The map-stage shadow — replaced by the frame.

**Set aside for later**
Script companions for other languages (the Companions Rule reserves the variables). Print and hatching (the top ramp class may gain a hatch for photocopies; not now).

**Viewer batch (late September 2026)**
The place card docks at the right on a wide screen instead of opening beside its pin; a pressed kind says so under the key it was pressed in; counted discs are ink, and never touch each other or a pin; pin layers' names are drawn by the map. Five wordings went plain: a layer's note says "from a spreadsheet" rather than the file's name; a date key reads "When it was added (by month)"; the share beside a question reads "88% answered"; a one-colour layer no longer repeats its own name in a legend row; and the gallery prints region names without transliteration marks.

**Header and keys (late September 2026)**
Search and Map/Satellite left the header for a floating toolbar beside the drawer, so the header is one 44px row for a visitor and an owner alike; the owner's controls (live status, region, add data, settings) fold into one Sindoor-outlined Owner menu. In the Map Browser a name wears its key marks, and a kind under a key is a chip that narrows list and map together with the line search uses.
