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
    fontFamily: "'Source Serif 4', serif"
    fontSize: "clamp(1.6rem, 4vw, 2.4rem)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "'Source Serif 4', serif"
    fontSize: "1.2rem"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "'Source Sans 3', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  control:
    fontFamily: "'Source Sans 3', sans-serif"
    fontSize: "0.95rem"
    fontWeight: 600
    lineHeight: 1.4
    role: "Buttons, and the name of a thing you can act on — a file, a layer being built."
  ui:
    fontFamily: "'Source Sans 3', sans-serif"
    fontSize: "0.9rem"
    fontWeight: 600
    lineHeight: 1.5
    role: "The workhorse: switch names, form labels, nav, stepper chips. Weight drops to 400 where it is reading text rather than a prompt."
  meta:
    fontFamily: "'Source Sans 3', sans-serif"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.5
    role: "Anything that annotates something else — keys, hints, counts, required/optional markers."
  label:
    fontFamily: "'Source Sans 3', sans-serif"
    fontSize: "0.72rem"
    fontWeight: 700
    letterSpacing: "0.12em"
    role: "Uppercase stamps: the panel head, group heads, the place-card kicker, the eyebrow chip."
  numeral:
    fontFamily: "'Source Sans 3', sans-serif"
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
a phone: **Source Serif 4** structures (titles, headlines), **Source Sans 3** reads and
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
- **Marigold** (#E9A237): the middle of the data ramp and a marker colour. Never text.

### Map tokens
- **Ground** (#F5F1E6) inside the atlas region; **Outside** (#EAE6DC) beyond it; the framed well's background is Ground.
- **Water** (#3A7FA1) lines; **Water Fill** (#C8DBE5) for lakes, wetlands, oxbows.
- **Boundary** (#26231F) at 1.8px for the district/region outline; **Block** (#8C8985) at 0.7px for the next level down; **Road** (#E2DDD0).
- **Label** (#24211D) with a **Halo** of Ground (#F5F1E6) at 2.2px. District names uppercase, +0.2em, Source Serif 4 700; place names Source Sans 3 600, no tracking.

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

**Display font:** Source Serif 4 (700; 600 only if a file is added)
**Body font:** Source Sans 3 (400, 600, 700)
**Mono:** ui-monospace / Menlo — build logs, tokens, embed snippets only.

**Character:** Source Serif 4 is a quiet transitional serif: classic, not bookish, at home on a title. Source Sans 3 has a large x-height, open counters and a distinct 1 / l / I, which is what keeps an 11px legend label readable on a cheap phone. Both were drawn by one studio for screens, so the pairing reads as one voice.

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

**The Numbers Line Up Rule** (new). Any number that sits above or beside another number is tabular. Source Sans 3's default figures are proportional, so this must be set explicitly.

**The Companions Rule** (new, for later). Font stacks are written so a script companion can be added without touching a selector: `"Source Sans 3", var(--font-companions-sans), sans-serif` and `"Source Serif 4", var(--font-companions-serif), serif`, where the companion variables are empty today. When another language ships, the matched Noto faces go into those variables and nothing else changes.

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

### The Strip and the Shelf (signature, kept)
The **strip** across the top of the stage holds what is true of the whole atlas: wordmark "LOKA Atlas", Map/Satellite, search, and (owner-only) the region row. It wears Surface at 95% with a hairline bottom edge. The **shelf** (panel) holds layers and nothing else: switches, keys, legends, fold notes. Panel head has a 2px Leaf rule beneath it; group heads are Label type over a hairline, with at least three times the gap between groups as between rows inside them.

### The phone sheet (signature, new shape)
On phones the shelf docks as a bottom sheet with a grab bar and a **row of group tabs** (Base · Crops · Water …). One group shows at a time; each row is a full-width touch target (min 44px) with the switch at the row's end; the active tab is Leaf with white text. The sheet's foot carries the LOKA credit and the "Build your own atlas →" link. It never covers the map's top third.

### Map frame, controls, place card
- The map well: Ground background, double ink frame (see Elevation), 8px inset from the shelf.
- Zoom controls: 22–26px Surface squares with Ink Border, 4px, bottom-right; no compass.
- A scale note ("1 : 250 000") bottom-left in Label type on Surface.
- **Place card:** Surface, 4px, 3px Sindoor top edge, photo band, Label kicker in Leaf ("SURVEY VILLAGE · GORAKHPUR"), Headline name, then a two-column fact list with tabular values. Close is a 14px circle top-right.
- **Selected feature:** a 2px Sindoor ring plus a faint 1px outer ring; the label is not changed.

### Navigation
Thin top bar: wordmark "LOKA / APPS" in Label type, Ink; links Ink Soft 0.9rem. No active pills, no bottom borders.

### Credits and the call to action
The credit strip is Surface Alt with a hairline top edge: a black "LOKA" tag, "Made by … with …", data sources, and at the end "Build an atlas like this for your own geography and data." with a Leaf button "Build your own atlas for free →". It is part of the brand and appears on every atlas view, including the phone sheet's foot.

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
- Faces: Figtree + DM Sans → Source Serif 4 + Source Sans 3. Weights: serif 700; sans 400 / 600 / 700.
- Map base: the pale grey base and its "grey CARTO" feel → cream Ground (#F5F1E6) inside a double ink frame; boundary ink is now near-black (#26231F), not ochre.
- Map data colours: the `greens` / `ylorbr` earth ramps → the marigold ramp; point colours are the seven-colour set with mandatory marker shapes.
- Phone layout: the 46% bottom tray with a bar of group marks → a bottom sheet with group tabs, one group at a time, 44px rows.

**Kept**
The Map Speaks Rule, the Two Voices Rule (faces changed), the Two-Channel Rule, the Ink-on-Paper Rule, the One-Skeleton Rule for lists, the Strip and the Shelf, the signature toggle, small radii, the credits ledger, the motion limits.

**Retired**
The Earth Ink Rule ("nothing bluer than #5f7f92, nothing redder than rust") — replaced by the Measured Colour Rule. The map-stage shadow — replaced by the frame.

**Set aside for later**
Script companions for other languages (the Companions Rule reserves the variables). Print and hatching (the top ramp class may gain a hatch for photocopies; not now).
