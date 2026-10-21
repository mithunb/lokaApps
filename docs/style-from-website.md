# Styling an atlas from a website

The first time we did this was for the Emergence Festival atlas
(emergence-festival-of-future-cities, a private atlas of 24 places in Panaji,
Goa), on 21 October 2026. We did it by hand, once, but through a mechanism any
atlas can use. This note records what we took, how we took it, what we left
out, and what a "Style from a website" button for every atlas creator would
have to do on its own. Read it as the starting point for that feature.

## What an atlas theme is

An atlas can now carry an optional **theme**: a short list of colours, two
font names, a corner style and a logo width. It lives in the atlas's
`manifest.local.json`, which is the file a rebuild leaves alone. The viewer
reads it and repaints the page. An atlas with no theme looks exactly as it did
before; nothing runs unless a theme is there.

The rules live in one file, `atlas/theme.js`. The viewer, the one-off script
and the checks all use that same file.

| Theme says | What it changes on the page |
|---|---|
| `page`, `surface`, `surfaceAlt` | the page, the panels, and the light shading behind hovered rows and the footer |
| `text`, `textSecondary`, `textMuted` | the three strengths of words |
| `accent`, `accentDeep` | links, switches, pressed buttons, the panel's rule (LOKA's green, "Leaf") |
| `highlight`, `highlightDeep` | the ring round a chosen place, the card's top line, and warning words (LOKA's red, "Sindoor") |
| `fonts.display`, `fonts.displayWeight` | the face and weight of the atlas title, headings and the card's title |
| `fonts.text` | every other word |
| `fonts.cssUrl` | where those faces are loaded from (Google Fonts only) |
| `corners: "square"` | buttons and panels lose their rounded corners |
| `logoMaxWidth` | how wide the owner's logo may be, 60 to 220 pixels (phones still cap it at 120) |

The logo itself is not part of the theme. It goes in the usual way an owner's
logo does (Settings, `branding-logo.png`), so Settings shows it and a rebuild
keeps it.

## What a theme can never change

- **The map's own colours.** Ground, water, roads, the shading ramps, each
  place's dot and pin, and the colours of answers are not on the list. So
  places stay as easy to tell apart as they are on every other atlas.
- **"Powered by LOKA Atlas".** The badge sets LOKA's own colours, faces and
  corner back for itself, so it looks the same on every atlas whatever the
  theme says. A check holds this.
- **Dark mode.** LOKA has none. A page, panel or shading colour that is not
  light is refused, and LOKA's own is kept.
- **Readability.** Every colour that carries words is checked against every
  background it can sit on, using the common accessibility rule (WCAG AA):
  words must reach 4.5 to 1, and a ring or border 3 to 1. White words on the
  accent colour (a pressed button) are checked too. A colour that fails is
  darkened a little at a time until it passes, and the change is written out
  in words.
- **Fonts from anywhere.** Only `https://fonts.googleapis.com/css2?…` is
  loaded. Font names may hold only letters, numbers and spaces, so a name
  cannot carry anything else into the page.

## What we took from emergencefestival.in

The site is a WordPress theme ("emergence-theme"). Everything below was read
from its own page and stylesheet; nothing was guessed from screenshots.

**Where to look**
- Colours: WordPress writes the site's palette as CSS variables in an inline
  `<style id="global-styles-inline-css">`, named
  `--wp--preset--color--<name>`. The theme's stylesheet
  (`/wp-content/themes/emergence-theme/assets/css/main.css`) uses those
  variables for each section (`--hero-bg`, `--s-accent` and so on), which
  shows which colours do what.
- What each colour is used for was confirmed in the browser by reading the
  computed style of the header, the nav links, the buttons, h1, h2, body text
  and each section's background.
- Fonts: the same inline style names the families
  (`--wp--preset--font-family--poppins`, `--…--lora`), and `@font-face` rules
  load them from the site itself (`/assets/fonts/poppins-latin-400-normal.woff2`
  and so on).
- Logo: `<img class="custom-logo">` in the header.

**The palette**

| Site name | Colour | Used on the site for |
|---|---|---|
| purple | #6B1164 | headings, links, buttons, the logo |
| primary-green | #1DC254 | the hero band and the closing band |
| secondary-green | #03FCAD | a bright accent on purple sections |
| red | #FC3103 | the pins on the site's own map, the dot before "Panjim, Goa" |
| black | #060606 | words |
| white | #FFFDFD | the page |

(WordPress's stock colours, such as "vivid-cyan-blue", are also in the list.
The site does not use them, and neither did we.)

**Type**: headings, nav and buttons in **Poppins** weight 500, with tight
letter spacing. Body text in **Lora** 400. Square buttons (no rounded
corners). Nav in capitals with wide letter spacing.

**Logo**: `https://emergencefestival.in/wp-content/themes/emergence-theme/assets/images/emergence-logo-purple.png`,
an 800 × 120 PNG of 8 KB: the swirl mark and the word EMERGENCE, in purple.

**Motifs worth noting**: red teardrop pins on their map
(`border-radius: 50% 50% 50% 0`), a red dot before the place name, big
numerals, and capitals with wide spacing for small labels.

**Permission**: these are the festival's own colours, typefaces and logo, used
on the festival's own atlas at the request of its owner on LOKA. Poppins and
Lora are open fonts (SIL Open Font Licence) and are served here from Google
Fonts, not from the festival's server. If the feature is opened to every
creator, the owner should confirm they have the right to use the site's logo
before it is applied.

## How the site's colours map onto LOKA

| LOKA slot | Emergence value | Why |
|---|---|---|
| page | #FFFDFD | the site's own page white |
| surface | #FFFFFF | panels a touch whiter than the page, as on LOKA |
| surfaceAlt | #E8F7EC | the site's primary green, 10% over white: a pale green shading, so the festival green is present without large green blocks |
| text | #060606 | the site's black |
| textSecondary | #3D3C3C | the site's black at 78%, the strength it uses for softer lines |
| textMuted | #605F5F | a step lighter, still at least 5.7 to 1 on every background |
| accent | #6B1164 | the site's purple: its links and buttons |
| accentDeep | #4A0B45 | a darker purple for hover and pressed states |
| highlight | #FC3103 | the site's red, as the ring round a chosen place (like its map pins) |
| highlightDeep | #FC3103 → **#CF2802** | see below |
| display font | Poppins, weight 500 | the site's headings |
| text font | Poppins | see "What we left out" |
| corners | square | the site's buttons are square |
| logo width | up to 180 px | the logo is a wide wordmark; at LOKA's usual 120 px it was 18 px tall |

**Contrast change, one**: the site's red as *words* reads at only 3.7 to 1 on
white, under the 4.5 needed. The theme gives #FC3103 and the guard darkened
it to **#CF2802** for words (warnings, a pressed "same place" button). As a
ring round a chosen place it stays the true #FC3103, which passes the 3 to 1
rule for rings. Every other colour passed as given: purple on white is 11 to
1, and black on the pale green is over 18 to 1.

## What we left out, and why

- **Lora for body text.** The site sets its paragraphs in Lora, but nearly
  every word on an atlas is a control, a label or a short line in a list, and
  the site itself sets those (nav, buttons, small paragraphs) in Poppins.
  Lora at label sizes read poorly. LOKA already loads Lora, so a future theme
  could still choose it.
- **The secondary green #03FCAD.** It reads at 1.3 to 1 on white and is meant
  for dark purple backgrounds. On a light page it cannot carry anything.
- **The primary green as a large colour.** It reads at 2.3 to 1 on white, so
  it cannot be words or a link, and big green blocks would compete with the
  map's own greens (parks, green answers). It is used only as the pale
  shading.
- **The green and purple hero bands.** A map page has no hero. The site's
  dark-purple sections would mean dark mode, which LOKA does not have.
- **The site's map picture** (`panjim-map-v2-*.jpg`) and partner logos. They
  are pictures for the website, not parts of a style; the atlas draws its own
  map.
- **The red teardrop pin and the uppercase nav.** Both would mean changing
  how markers or menus are drawn for one atlas. Markers belong to the map's
  colours and shapes, which a theme does not touch.
- **Fonts from the site's own server.** Only Google Fonts is allowed. Both
  faces are on Google Fonts, so nothing was lost.

## Putting it on an atlas (today, by hand)

```
deploy/themes/<name>.json         { "theme": {...}, "logo": "<https URL or .png>" }
node deploy/apply-theme.mjs <slug> deploy/themes/<name>.json            # dry run
pm2 stop lokaApps && node deploy/apply-theme.mjs <slug> deploy/themes/<name>.json --apply; pm2 start lokaApps
```

The dry run prints every variable the viewer will set and every colour the
guard changed. `--apply` backs up first (to
`api/data/atlas/backups/theme-<slug>-<time>/`), writes the theme into
`manifest.local.json`, saves the logo as `branding-logo.png`, points
`branding.logo` at it in `manifest.json`, and marks `hasLogo` in the registry.
The server is stopped while it runs because the running server holds the
registry in memory and would write over the logo mark. It refuses
deoria-bioregion.

To undo: copy the backed-up files back, with the server stopped.

## What a "Style from a website" feature would need to do on its own

1. **Ask for the address** and fetch the page from the server, never from the
   owner's browser. Follow redirects; give up after a few seconds; read only
   HTML and CSS.
2. **Find the colours.**
   - CSS custom properties on `:root` and `body`, including WordPress's
     `--wp--preset--color--*`, Squarespace's and Webflow's equivalents, and
     Tailwind theme variables.
   - The computed colours of known parts: `body` background and text, `a`,
     `h1`/`h2`, `button` and `.wp-element-button`, `header` and `nav`. This
     needs a headless browser, because a stylesheet alone does not say which
     colour wins.
   - `<meta name="theme-color">`.
   - Rank them by how much of the page they cover and where they appear, and
     drop the platform's stock colours that nothing uses.
3. **Find the logo.** In order: an `<img>` inside `header` whose class, id or
   alt says "logo"; the site's `custom-logo`; an inline `<svg>` in the header;
   `<link rel="icon">` and `apple-touch-icon` at their largest size;
   `og:image` last (it is usually a photo). Turn it into a PNG under 200 KB
   (`atlas/logo-tools.js` already does this) and trim its empty edges.
4. **Find the fonts.** The `font-family` of the headings and of the body, then
   look each one up on Google Fonts. If a face is not there, say so and
   suggest the closest Google face instead. Never load fonts from the site's
   own server.
5. **Map them onto LOKA's slots**: the page colour from the body background
   (refuse a dark one and pick a near-white tinted toward it); the accent from
   links and buttons; the highlight from the most saturated warm colour; the
   shading from the brand's main colour at about 10% over the page.
6. **Run the guard** in `atlas/theme.js` and show, in plain words, every
   colour it had to darken or refuse.
7. **Show a preview** of the owner's own atlas with the theme, side by side
   with how it looks now, on a wide screen and a phone, before anything is
   saved.
8. **Let the owner adjust and approve**: swap any colour from the found
   palette, pick another font, turn the logo on or off, or go back to LOKA's
   look. Saving writes `theme` into `manifest.local.json` and the logo through
   the normal Settings path. It needs no server stop, because the server
   itself makes the change.
9. **Ask about rights** in one line: "Is this your organisation's own site and
   logo?"

What can stay as it is: `atlas/theme.js` (the rules and the guard), the
viewer's hook, the badge's protection, and the checks in
`test/theme-test.mjs`. What is still to be built is the finding (steps 1 to
5), the preview, and a place in Settings.
