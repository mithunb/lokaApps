# LOKA Atlas — what it is, how it works with LOKA tags, and how to embed it on discoverloka.org

**Written for:** the Claude session that will add a LOKA Atlas to **discoverloka.org** (project
`/Users/mithunsheshagiri/work/loka-website`, GitHub `mithunb/loka-website`), and for anyone who needs a
current picture of the atlas. **Written:** 9 Nov 2026, from the code in `lokaApps` at `493800a` and the
live site. Older notes in this repo (`LOKA-APP-AND-ATLAS.md`, `LOKA-ATLAS-CAPABILITIES.md`) predate
the LOKA sync, the modes and the merged panel — where they disagree with this note, this note wins.

The atlas to embed (Mithun's choice): **Khazan Survey on Divar Island** — public, published.
- Full link: https://loka.place/apps/atlas/?dataset=khazan-survey-on-divar-island
- Short link: https://loka.place/apps/atlas/a/khazan-survey-on-divar-island (302 to the full link)

---

## 1. LOKA and LOKA Atlas in one paragraph each

**LOKA** (the phone app, discoverloka.org) is where people stand in a place and *tag* it: a photo, their
own words, labels and categories, and the point on the map. Each tag lives in a LOKA **space** (a group's
shared collection — e.g. the "Divar Island" space of the Khazan Collective).

**LOKA Atlas** (loka.place/apps/atlas/) turns those tags into a map people can read. An atlas is built for
a region from open data (boundaries, rivers, wetlands, land use…), and a group's own places go on top.
Then LOKA's AI reads what people wrote and turns it into **questions with answers** ("What kind of place
is this?" → Natural Habitat · Path or Track · …) so the map can be coloured and explored by them, and
writes a short **story of the place** from people's own words, with their quotes.

## 2. How LOKA tags become a map (the pipeline)

1. **Connect a LOKA space** (owner, in the atlas wizard or Owner ▾): the server signs in to LOKA with its
   own account and downloads the space's tags. "Update now" fetches new ones; nothing is sent back to LOKA.
   Tags can also be uploaded as a file (CSV, Excel, GeoJSON…) — the atlas works with any place data, not
   only LOKA's (people/ID columns are never read; photos are found by their contents).
2. **Build:** the atlas lays the places on its base map. Small photos are made on the server for fast cards.
3. **Read:** the AI reads the places' own words (descriptions, labels — never addresses, names of people or
   IDs) and writes up to six **questions**, each answer counted and coloured on the map. Location is never
   guessed from text.
4. **Story of the place:** a short paragraph of what people feel and notice, with quotes and who wrote
   them (LOKA usernames; "— From LOKA" for LOKA's own curated places). Few voices → quotes only
   ("in their own words").
5. **Publish:** the owner chooses public or private (Owner ▾ → Private → Change). Public atlases get rich
   link previews (title, description, best place photo) in WhatsApp, Slack, X, etc.

## 3. What a visitor sees (Standard mode — the default; Divar uses it)

Owners choose how visitors explore: **Standard · Event · Explore** (Standard took in the old Insight mode
on 8 Nov 2026). In Standard, the panel is headed **"This map"**:
- **Story of the place in their own words** (when there is one).
- **The questions**, each like a map key: the answer colours, names and counts; an ⓘ per answer for
  details. The open question colours the pins and says "✓ Showing on the map" (bordered); the others say
  "Show this on the map". One at a time; tap an answer to show only those places.
- **Research mode** (computers/tablets only, off on every visit): tick up to three questions — pins turn
  grey with a circle / square / triangle beside them; "Compare with" and a split bar appear. Phones show a
  line saying to use a computer or desktop mode for this.
- **More on this map** (folded): other data layers and public map layers with switches, plus plain columns
  (Category, When it was added) as extra keys.
- **The map:** close places fold into numbered discs whose ring shows the answer shares; place names show
  where there is room (else on hover / tap); tapping a pin opens the place's card (photo, words, a link to
  see it in LOKA). Search sits at the top of the panel.
- **Phones:** the panel is a bottom sheet (peek / full); a small chip on the map shows the open question
  and all its answers; opening a question lowers the sheet so the map is in view.
Other modes: **Event** (festival guide: venues, programme, Eat & Drink / See & Do / Essentials nearby) and
**Explore** (up to four buttons and "What's around here").

## 4. Embedding on discoverloka.org — facts measured on 9 Nov 2026

- **Framing is allowed today.** loka.place sends no `X-Frame-Options` and no CSP `frame-ancestors`, and
  discoverloka.org sends no CSP either, so a plain iframe works now:
  ```html
  <iframe src="https://loka.place/apps/atlas/?dataset=khazan-survey-on-divar-island&embed=1"
          title="Khazan Survey on Divar Island — LOKA Atlas map"
          loading="lazy" style="width:100%;height:80vh;min-height:520px;border:0"
          referrerpolicy="strict-origin-when-cross-origin"></iframe>
  <p><a href="https://loka.place/apps/atlas/a/khazan-survey-on-divar-island" target="_blank" rel="noopener">Open the full map</a></p>
  ```
  Give the frame a real height (the atlas fills its window; a short frame gives a cramped map) and always
  put an "Open the full map" link beside it (phones, slow connections, people who want it full-screen).
- **Use the embed view: add `&embed=1` to the FULL link** (live since 85d340f, 9 Nov 2026). Inside
  another site's frame it shows only the map and the "This map" panel: no header, Share, "Get the LOKA
  app", sign-in or owner tools; the atlas's name heads the panel; a small "Open full map ↗" in the map's
  corner opens the normal atlas in a new tab. A phone-width frame gets the usual bottom sheet. Without
  the flag, the whole atlas page shows, header included.
  Use the full `?dataset=…&embed=1` address, NOT the short `/a/<slug>?embed=1`: the short link's
  redirect keeps the flag only after the Apache config on loka.place is updated (needs the "Server
  Security and Performance" session and Mithun's "go"); until then it drops it.
- **Scrolling:** in the embed view the map no longer catches the page's scroll — two fingers move it on a
  touch screen, Ctrl/⌘ + scroll zooms it with a mouse, and the map says so. A click-to-load teaser image
  is still a good idea to save a heavy map load for visitors who never use it.
- **Only public atlases embed.** In the embed view a private atlas shows only "This map is private / Open
  it on LOKA Atlas ↗" (no title, region or photo), even with a private key in the address — never put a
  key in an embed. Divar Island is public and published.
- **Do not copy the atlas's files into the website** or call its APIs from the site; the atlas updates
  itself (new tags, new readings, new story) and an iframe/link always shows the current version.
- **Brand and look:** the atlas has its own look (Bazaar colours, Latin-first fonts); the website keeps its
  own. Use the atlas's link-preview image for a static teaser if needed: fetch the page with a crawler user
  agent, e.g. `curl -A Twitterbot '<full link>'` and read `og:image` / `og:title` / `og:description` —
  today Divar's og:image is a loka.place /api/images/… photo.
- **Wording for the site** (plain words; Mithun's audience is non-technical): e.g. "This map is made from
  places tagged by the Khazan Collective on Divar Island with the LOKA app. Tap a question to colour the map
  by its answers, or a pin to read what people wrote."

## 5. Who to ask / where things live
- Atlas code, embed view, modes, emails: **lokaApps** (this repo; deploy `./deploy/deploy.sh`, needs
  Mithun's explicit yes per change).
- discoverloka.org pages: **loka-website** (static HTML/CSS/JS; read its CLAUDE.md first).
- Server/Apache changes on loka.place: the "Server Security and Performance" session; it needs Mithun's
  own "go" typed in that session.
