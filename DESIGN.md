---
name: LOKA Atlas
description: Layered, manifest-driven maps for any geography — public tech by Socratus.
colors:
  moss: "#4A5A33"
  canopy: "#384526"
  rust: "#AE5028"
  rust-deep: "#7C3616"
  sienna: "#99582F"
  ochre: "#B8862F"
  paper: "#F9F9F7"
  paper-alt: "#F0EFEA"
  surface: "#FFFFFF"
  ink: "#2A241A"
  ink-soft: "#564E3C"
  ink-faded: "#6B6350"
  ink-border: "#2A241A24"
  ink-divider: "#2A241A17"
  moss-tint: "#4A5A331A"
  rust-tint: "#AE50281A"
typography:
  display:
    fontFamily: "Figtree, sans-serif"
    fontSize: "clamp(1.6rem, 4vw, 2.4rem)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Figtree, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  control:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 600
    lineHeight: 1.4
    role: "Buttons, and the name of a thing you can act on — a file, a layer being built."
  ui:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.55
    role: "The workhorse: form labels, nav, stepper chips. Weight drops to 400 where it is reading text rather than a prompt."
  meta:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 400
    lineHeight: 1.55
    role: "Anything that annotates something else — hints, counts, required/optional markers, stage rails."
  label:
    fontFamily: "Figtree, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 600
    letterSpacing: "0.14em"
  icon:
    fontSize: "1.5rem"
    lineHeight: 1
    role: "Sizes an emoji glyph standing in as an icon. Not a text role — it is on this ramp because font-size is how a glyph is sized, not because anything reads at 1.5rem."
  mono:
    fontFamily: "ui-monospace, Menlo, monospace"
    fontSize: "0.75rem"
    lineHeight: 1.5
rounded:
  sm: "4px"
  md: "6px"
  pill: "999px"
spacing:
  xs: "0.35rem"
  sm: "0.6rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.moss}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    padding: "0.6rem 1.2rem"
  button-primary-hover:
    backgroundColor: "{colors.canopy}"
  button-secondary:
    backgroundColor: "#00000000"
    textColor: "{colors.moss}"
    rounded: "{rounded.sm}"
    padding: "0.6rem 1.2rem"
  eyebrow-chip:
    backgroundColor: "{colors.moss-tint}"
    textColor: "{colors.moss}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.25rem 0.6rem"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "1.35rem"
  input:
    backgroundColor: "#FFFFFF"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0.55rem 0.65rem"
---

# Design System: LOKA Atlas

## 1. Overview

**Creative North Star: "The Field Notebook"**

LOKA Atlas looks like a working document from fieldwork, not a dashboard. The page is
clean, near-white paper (#F9F9F7) with white cards raised by a hairline — and everything drawn on
it behaves like ink: thin borders, earthy boundary lines, stamped uppercase labels,
small honest controls. The map is the page; the interface is the margin. Every design
decision defers to the data on the map, because the people this serves — survey teams,
on-ground partners, small orgs — come to read the land, not the chrome.

The system explicitly rejects the shiny SaaS register: no gradients, no glassmorphism-as-
decoration, no neon data-viz hues, no floating cards stacked on drop shadows. It also
rejects dashboard maximalism — a screen holds one map, one panel, and a credits ledger,
in that order of importance. Color is committed but muted: a rustic-pastel family (moss,
rust, sienna, ochre) that could be mixed from soil, turmeric and leaves.

**Key Characteristics:**
- Clean near-white paper canvas (#F9F9F7); white cards and the floating panel read as "on top".
- One green speaks for the product (moss `#4A5A33`); earth accents belong to the data.
- Flat, ink-on-paper depth: borders and tone steps, not shadows.
- Two typefaces, two jobs: Figtree structures, DM Sans reads.
- Refined and restrained components: thin strokes, small radii, quiet states.
- Everything credited: sources, partners and licenses are part of the visual identity.

## 2. Colors

An earth-pigment palette on clean near-white paper — committed to green, with rust and ochre
held in reserve for data and warnings. The paper is neutral so the earthy inks and the map
carry the warmth.

### Primary
- **Moss** (#4A5A33): the product's one voice — primary buttons, active toggles, selected
  states, links, focus rings. Deepens to **Canopy** (#384526) on hover/press.
- **Moss Tint** (#4A5A331F): selection washes, eyebrow chips, informational backgrounds.

### Secondary
- **Rust** (#AE5028): the data accent — survey markers, selected map features, warning text
  (as **Rust Deep** #7C3616). Never a button fill in the UI.
- **Ochre** (#B8862F): boundary ink on the map (district outlines) and approval badges.
- **Sienna** (#99582F): tertiary data accent (e.g. sugar-mill markers, caution copy).

### Neutral
- **Paper** (#F9F9F7): the page background — clean, near-white, faintly warm.
- **Paper Alt** (#F0EFEA): footers, recessed strips, the map-stage well backdrop.
- **Surface** (#FFFFFF): cards, inputs and the floating panel — white, raised off the page by a hairline border rather than a tone step.
- **Ink** (#2A241A): primary text. **Ink Soft** (#564E3C): secondary text — ≥ 7:1 on Paper.
  **Ink Faded** (#6B6350): hints and metadata (≥ 4.5:1), never body copy.
- **Ink Border** (rgba(42,36,26,.14)) / **Ink Divider** (rgba(42,36,26,.09)): all strokes
  are transparencies of Ink, so they sit naturally on the paper.

### Named Rules
**The Map Speaks Rule.** Saturated color belongs to data on the map (crop categoricals,
water blues, choropleth ramps). The interface itself never uses more than moss + tints on
roughly 10% of the screen. If a UI element competes with the map for color, mute the element.

**The Earth Ink Rule.** Every hue is desaturated toward earth. No pure primaries, nothing
neon, no blues bluer than the WRIS water tone (#5f7f92). A color that couldn't plausibly
be mixed from soil, leaves or turmeric doesn't belong.

**The Cartographic Palette.** Map-layer colors are their own curated set (crop categoricals
like Sugarcane #4f6b3f and Turmeric #cc8a33; ramps `greens`, `ylorbr`, `rdylgn` etc. in
`api/lib/fragment.js`) and layers ship deliberately translucent (fills 0.35–0.75) so
boundaries, land cover and the basemap read *through* each other. Translucency is a
feature: it is how three layers coexist on one page.

## 3. Typography

**Display Font:** Figtree (with sans-serif fallback)
**Body Font:** DM Sans (with system-ui fallback)
**Mono:** ui-monospace / Menlo — build logs, tokens, embed snippets only.

**Character:** Figtree is the stamp — geometric, confident, used tight (-0.01em) for titles
and wide (+0.14em, uppercase) for labels. DM Sans is the handwriting between the stamps:
humanist, comfortable at length. The pairing contrasts by role, not by style.

### Hierarchy
- **Display** (700, clamp(1.6rem–2.4rem), 1.12): the atlas title; one per page, `text-wrap: balance`.
- **Headline** (600, ~1.15rem, 1.25): panel and section headings ("Where is your region?").
- **Title** (600, 0.78rem, uppercase, +0.04–0.06em): group headers inside widgets (BASE,
  ECOLOGICAL LANDSCAPE) — Figtree, ink-soft.
- **Body** (400, 1rem, 1.55): prose, capped at ~65–75ch (`max-width: 44–46rem`), `text-wrap: pretty`.
- **Label** (600, 0.72rem, +0.14em, UPPERCASE): the eyebrow chip and panel titles ("MAP LAYERS").
- **Map labels**: uppercase, letterspaced, always with a paper-colored halo (e.g. district
  names #1e2a1c with 2.2px #ffffff halo) so text stays legible over any layer.

### Named Rules
**The Two Voices Rule.** Figtree for structure, DM Sans for reading. Never a third family;
never Figtree for paragraphs; never DM Sans for uppercase labels.

## 4. Elevation

Flat, ink on paper. Depth is conveyed by white cards lifting off the near-white page via a hairline ink border
— not by shadows. `--shadow-sm` is literally `none`. Two sanctioned
exceptions exist: the floating layer panel over the map carries a soft ambient shadow
(`0 2px 12px rgba(42,36,26,.12)`) plus a ≥94%-opaque blur backdrop — a legibility device
over unpredictable map imagery, not decoration — and the map stage itself sits in a
1px-bordered well with the same soft shadow to read as "the page's plate".

### Shadow Vocabulary
- **panel-lift** (`box-shadow: 0 2px 12px rgba(42,36,26,.12)`): the layer panel and map
  stage only.
- **hairline-lift** (`box-shadow: 0 1px 4px rgba(42,36,26,.10)`): mobile bottom sheet edge.

### Named Rules
**The Ink-on-Paper Rule.** Surfaces are flat at rest and flat on hover. If a new element
seems to need a shadow, first try a border; then try a tone step; only then ask.

## 5. Components

The component voice is **refined and restrained**: thin strokes, small radii, generous
whitespace, quiet color. Controls recede so the map speaks; when in doubt, remove a border
or lighten a fill rather than adding emphasis.

### Buttons
- **Shape:** barely rounded (4px). Never pills, never full-width unless mobile.
- **Primary:** Moss fill, white text, 0.6rem × 1.2rem padding; hover deepens to Canopy.
  One primary action per view.
- **Secondary:** transparent with 1px Moss border, Moss text; hover washes Moss Tint.
- **Ghost:** borderless, ink-soft, underlined on hover — for "Save draft"-class actions.
- **Focus:** 2px Moss outline, 2px offset — never a glow.

### Chips
- **Eyebrow chip:** Moss Tint background, Moss text, Label type, 4px radius — one per page
  as the section stamp ("LOKA ATLAS · SETUP WIZARD").
- **Crop/data chips:** white with ink border, 8px color swatch square; selected = Moss
  border + Moss Tint wash + 600 weight. Cost badges: `free` in moss-tint, `needs approval`
  in rust-tint — uppercase 0.68rem.

### Cards / Containers
- **Corner Style:** 6px. **Background:** Surface (white). **Border:** 1px Ink Border.
- **Shadow Strategy:** none (see Elevation). **Internal Padding:** 1.35rem.
- Cards are used sparingly — lists and dividers are the default; a card must mean
  "a distinct thing you can act on" (a step panel, a directory entry).

### Inputs / Fields
- **Style:** white fill, 1px Ink Border, 4px radius, DM Sans at 0.95rem.
- **Labels:** small bold ink-soft above the field, with `(optional)` hints in Ink Faded.
- **Focus:** the 2px Moss outline; **Error:** message text in Rust Deep, never a red border wall.

### Toggles (signature)
- The layer switch: a 32×18 pill track (#cfd6cf off → Moss on), white knob, 0.2s ease-out;
  tri-state masters render indeterminate as Moss at 60% with a centered knob. On touch
  screens the target grows to ≥44px. This switch is the most-touched control in the
  product — it must always feel calm and instant.

### Navigation
- A thin top bar: wordmark "LOKA / APPS" in Label type, ink; links in ink-soft 0.9rem.
  No active-state pills, no bottom borders — the page title does the orienting.

### The Layer Panel (signature)
- Desktop: floats top-left over the map, 19.5rem wide, white at 94% + blur backdrop,
  6px radius, panel-lift shadow. Mobile: docks below the map as a fixed-height bottom
  sheet (46%) with a drag-handle bar — it never covers the map.

## 6. Do's and Don'ts

### Do:
- **Do** keep the interface paper-quiet and let saturated color live on the map (The Map Speaks Rule).
- **Do** separate with 1px ink-transparency borders; reach for a white surface + hairline border
  before reaching for a shadow.
- **Do** use Moss (#4A5A33) for every interactive affordance — buttons, switches, focus,
  links — so "green means you can act on it" stays true everywhere.
- **Do** give every map label a paper halo; text over imagery is unreadable without it.
- **Do** ship layers translucent (0.35–0.75 fill) with opacity sliders where stacking matters.
- **Do** credit sources, partners and licenses visibly; the credits ledger is part of the brand.
- **Do** respect `prefers-reduced-motion` globally; transitions stay ≤0.2s ease-out.

### Don't:
- **Don't** use gradients anywhere — not on fills, not on text, not on charts.
- **Don't** use glassmorphism decoratively; the layer panel's ≥94%-opaque blur is the only
  sanctioned translucent surface in the UI.
- **Don't** add shadows to cards, buttons or hovers — flat, ink on paper (The Ink-on-Paper Rule).
- **Don't** introduce neon or pure-primary hues; nothing bluer than #5f7f92, nothing
  redder than Rust (The Earth Ink Rule).
- **Don't** use `border-left` stripes, hero-metric blocks, or identical icon-card grids —
  the shiny-SaaS register is the named anti-reference.
- **Don't** add a third typeface, use Figtree for body copy, or track lowercase text.
- **Don't** exceed 6px radius on containers; pills are for the toggle track only.
- **Don't** let any UI element outsaturate the data. If a screenshot's most colorful thing
  isn't the map, the screen is wrong.
