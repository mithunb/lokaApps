# LOKA ↔ LOKA Atlas sync — design

Status: draft for review, 31 Oct 2026. No code written yet.
Audience: the engineer working on the LOKA backend (`loka-server`). You do not need to have seen the Atlas code; everything Atlas expects is stated here.

Open questions for Mithun are marked **[DECISION_NEEDED]**.

---

## 1. Why

LOKA Atlas turns the tags of a LOKA space into a web map (a public one such as the Emergence festival guide, or a private one shared by key or invite). Today an atlas gets its places only when a person exports a CSV from the LOKA app and uploads it to Atlas. Three problems:

1. **It is by hand.** The Emergence guide was refreshed each morning by export → upload → `node deploy/refresh-event-atlas.mjs <slug> --apply`.
2. **Text is cut.** Atlas's importer keeps at most 500 characters of any cell (`api/apps/atlas.js`, `slice(0, 500)` on every row). A venue's programme of 16 sessions is ~1,500 characters, so three of seven venues arrived cut mid-session on 22 Oct; the fix was a side file passed as `--full-text`.
3. **Comments are not in the export at all.** The festival programme lives in a comment on each venue's tag (written by the `LOKA_admin` account) and had to be joined into a `festival_comment` column by hand before upload.

Two things are wanted from the backend:

- **A. Sync endpoint.** Atlas reads a space's tags (with comments and photos, uncut, incrementally) through a stable, versioned endpoint, for public *and* private spaces, with access granted per space by its owner.
- **B. Comment write.** Atlas can write, update and read back its own comment on a tag, so that *temporary* facts about a place (a festival's sessions at that venue) are kept in the comment section, where they are visible in the LOKA app too, and expire.

Everything below is the proposal. §2–§7 are backend; §8–§9 are Atlas-side and are here so the backend engineer sees how the endpoint is used.

---

## 2. What exists today (observed 30 Oct 2026, no auth)

| Call | Returns | Gaps for Atlas |
|---|---|---|
| `GET /api/spaces/<spaceId>` | space details (name, type `public_read`) | fine |
| `GET /api/spaces/<spaceId>/tags` | `{success, tags:[{id, address, categories, labels, comments_count, created_at, creator, creatorName, description, latitude, longitude, likes_count, spaceIds, thumbnail}]}` | no comments; no full image paths; no `updated_at`; no paging; no deletions; sends `creator`/`creatorName` to anyone |
| `GET /api/tags/<tagId>` | `{tag:{…, comments:[{id, comment_text, created_at, username}], image_paths:[…], thumbnail, spaces:[{id,name,type}], object_coords, is_liked}}` | one call per tag → N+1 for a sync; still no `updated_at` |
| `GET /api/spaces`, `GET /api/tags/<id>/comments` | 401 | — |

Atlas today derives its columns from the CSV export. The column list it expects is in §5.

---

## 3. Access model

### 3.1 Principals

- **Atlas service credential.** One long-lived credential for the Atlas server (`loka.place` host, server-to-server only; never in a browser). Suggested: a bearer token, `Authorization: Bearer <token>`, stored on Atlas in its env file; rotatable (issue a new one, keep both valid for a day, retire the old).
- **A LOKA user** (space owner) who *grants* Atlas access to a space. The grant is the owner's act, in the LOKA app or a web page, not something Atlas can do for itself.
- **The Atlas bot user** (`LOKA_admin` today) — the LOKA account under which schedule comments are written. See **[DECISION_NEEDED]** in §6.1 on whether to keep `LOKA_admin` or create a purpose-named account (`LOKA Atlas`).

### 3.2 Per-space grant

A table `atlas_space_grants` (name illustrative):

| column | meaning |
|---|---|
| `space_id` | the space |
| `granted_by` | user id of the owner who granted it |
| `scope` | `read` or `read+comment` |
| `atlas_slug` | optional: which atlas it is for (for display to the owner) |
| `created_at`, `revoked_at` | |

Rules:
- **Public spaces** (`public_read`): Atlas may read with the service credential alone — no grant needed, because anyone can read them already. (A grant is still needed for `comment` scope.)
- **Private spaces**: readable by Atlas **only** with a non-revoked grant for that space. Without one: `404` (not `403`) — do not confirm the space exists.
- **Comment write**: needs `scope = read+comment` on the space the tag belongs to. If a tag is in several spaces, a grant on any one of them suffices.
- The owner sees and can revoke grants in LOKA ("Connected: LOKA Atlas · guide ‘Emergence’ · reads tags and writes schedule comments").
- Atlas, on its side, maps atlas → space(s) and refuses to build a *public* atlas from a private space unless the owner has explicitly confirmed on the Atlas side too ("This space is private in LOKA. Publishing it as a public map makes its places public. Continue?"). Belt and braces: the backend is the authority on *who may read*, Atlas on *who may see the result*.

### 3.3 How a grant is created

**[DECISION_NEEDED]** Two options, pick one for phase 1:

- (a) **In-app toggle** (preferred): the space owner opens the space → "Share with LOKA Atlas" → chooses read / read+comment. Backend creates the grant. Atlas discovers granted spaces via `GET /api/v1/atlas/spaces`. Nothing to copy.
- (b) **Space key**: the owner generates a key in LOKA and pastes it into Atlas's "Refresh from LOKA" settings. Faster to build, but a key is a secret that people paste into chats.

---

## 4. Endpoints: `/api/v1/atlas/...`

All under `/api/v1/atlas/`, all require the service credential, all return JSON with `Content-Type: application/json; charset=utf-8`. Versioned by path; breaking changes go to `/v2/`. Non-breaking additions (new optional fields) do not bump the version. Every response carries `X-LOKA-API-Version: 1`.

### 4.1 `GET /api/v1/atlas/spaces`

The spaces Atlas may read: every public space **[DECISION_NEEDED: or only public spaces with a grant? See §4.7]** plus every privately granted one.

```json
{ "spaces": [
  { "id": "0bafd48a-…", "name": "Emergence: Festival of Future Cities", "type": "public_read",
    "scope": "read+comment", "tag_count": 41, "updated_at": "2026-10-30T09:12:00Z",
    "granted_by_display": "Festival team", "granted_at": "2026-10-20T07:00:00Z" } ],
  "next_cursor": null }
```

### 4.2 `GET /api/v1/atlas/spaces/{spaceId}`

Space details: `id, name, type, description, scope, tag_count, updated_at, bounds {min_lat, min_lon, max_lat, max_lon}` (bounds help Atlas pick a region without inferring it).

### 4.3 `GET /api/v1/atlas/spaces/{spaceId}/tags` — the sync call

Query:

| param | meaning |
|---|---|
| `updated_since=<RFC3339>` | only tags changed (created, edited, commented on, liked, photo added, **or deleted**) after this instant |
| `cursor=<opaque>` | page continuation |
| `limit` | default 200, max 500 |
| `include=comments,images` | comma list; without it, tags come without comments or image arrays (cheap list) |

Response:

```json
{
  "space": { "id": "…", "name": "…", "type": "public_read" },
  "tags": [ { …tag object, §5… } ],
  "deleted": [ { "id": "…", "deleted_at": "2026-10-29T11:00:00Z" } ],
  "next_cursor": "eyJ…",
  "sync_token": "2026-10-30T09:12:00.412Z",
  "server_time": "2026-10-30T09:12:01Z"
}
```

- Ordering: by `updated_at` ascending, then `id` — stable under paging. The cursor encodes `(updated_at, id)` of the last row; it is opaque to the caller.
- `sync_token` is the `updated_at` of the newest row *in this whole sweep* (not the page). Atlas stores it and sends it back as `updated_since` next time. Return it only on the **last** page (`next_cursor: null`) so a sweep that fails midway is simply repeated.
- `updated_since` must include a small overlap: Atlas will send `token − 60 s`; the endpoint is idempotent so duplicates are harmless.
- **Tombstones.** `deleted` lists tags removed from the space (deleted, or *moved out of this space*) since `updated_since`. Keep tombstones for at least 90 days; a sync older than that must do a full sweep (Atlas does one when `updated_since` is absent or when the server answers `410 Gone` with `{"error":"sync_token_expired"}`).
- **ETag / If-None-Match** on the full (no-`updated_since`) call: `ETag` = hash of `(space.updated_at, tag_count)`; a `304` saves the body when nothing changed. Optional but cheap.
- Requires: `updated_at` on tags, bumped on any change to the tag *or its comments/likes/images*; a `deleted_at` soft delete (or a tombstone table) keyed by space.

### 4.4 `GET /api/v1/atlas/tags/{tagId}`

One tag in full (always with comments and images). Used by Atlas to re-read a tag after writing a comment, and by the dry-run.

### 4.5 Comments

| call | what |
|---|---|
| `GET /api/v1/atlas/tags/{tagId}/comments` | all comments: `{comments:[{id, text, created_at, updated_at, author:{id, display_name, is_bot}}]}` |
| `POST /api/v1/atlas/tags/{tagId}/comments` | body `{text, kind?, valid_until?, external_key?}` → `201 {comment:{…}}`. Written as the Atlas bot user. |
| `PUT /api/v1/atlas/comments/{commentId}` | replace text (and `valid_until`) of a comment **the bot wrote**. `403` otherwise. |
| `DELETE /api/v1/atlas/comments/{commentId}` | only the bot's own comments. |

`external_key` is the duplicate guard (see §6.3): `POST` with an `external_key` that already exists on that tag **updates** that comment instead of creating a second (`200`, not `201`). This is the upsert Atlas will use; the `PUT` is a fallback.

### 4.6 Images

Tags carry file names (`adilshah_….jpg`, `thumb_adilshah_….jpg`) today. The endpoint should return **absolute URLs**, and say their sizes:

```json
"images": [
  { "id": "…", "url": "https://loka.place/media/adilshah_069f….jpg", "thumb_url": "https://loka.place/media/thumb_adilshah_069f….jpg",
    "width": 3024, "height": 4032, "bytes": 2140000, "content_type": "image/jpeg", "sort": 0 } ]
```

Atlas does not need the bytes through the API — it fetches the URLs (and makes its own small copies, see the `make-small-photos` job). Two asks: (1) the media URLs are stable and cacheable (`Cache-Control: public, max-age=…`, `ETag`), (2) images of **private** spaces are **not** on a guessable public path — either serve them behind the service credential (`/api/v1/atlas/media/{id}` → bytes or a 302 to a signed URL with ≥ 1 h validity) or sign the URLs in the JSON. **[DECISION_NEEDED]** which; signed URLs are simpler for Atlas.

### 4.7 Webhooks (optional, phase 3)

`POST <atlas-url>/api/loka-hook` with `{event:"space.updated", space_id, at}` whenever a granted space changes, signed with HMAC-SHA256 over the body (`X-LOKA-Signature`). Atlas then runs an incremental sync. Polling (§8.1) covers phase 1–2; webhooks only make the guide fresher between polls. Debounce on the backend: at most one hook per space per minute.

### 4.8 Rate limits and errors

- Service credential: 600 requests/min, `X-RateLimit-Limit / -Remaining / -Reset` headers; `429` with `Retry-After` (seconds). A full sweep of a 5,000-tag space at `limit=500` is 10 calls, so this is generous.
- Error body, always the same shape:

```json
{ "error": "space_not_granted", "message": "This space is private and has not been shared with LOKA Atlas.", "request_id": "…" }
```

| status | `error` |
|---|---|
| 400 | `bad_request` (unknown param, bad cursor, `limit` out of range) |
| 401 | `unauthenticated` (missing/invalid service credential) |
| 403 | `scope_insufficient` (read-only grant, tried to comment), `not_own_comment` |
| 404 | `not_found` — also used for private spaces without a grant |
| 409 | `comment_conflict` (concurrent edit on the same `external_key`; retry with a fresh read) |
| 410 | `sync_token_expired` → full sweep |
| 413 | `comment_too_long` (see §6.4) |
| 429 | `rate_limited` |
| 5xx | `server_error` — Atlas retries with backoff 1 s, 4 s, 16 s, then reports |

`message` is plain language because Atlas shows it to the atlas owner verbatim.

---

## 5. The tag object — field by field

What the endpoint sends, and which Atlas column each becomes. Atlas's importer takes any columns; these are the ones its Event mode and card already read (from the CSV export, see `deploy/refresh-event-atlas.mjs` and `deploy/event-mode-lib.mjs`).

| endpoint field | type | → Atlas column | note |
|---|---|---|---|
| `id` | uuid | `tag_id` | the join key for everything (fixes, merges, full texts) |
| `name` | string? | `loka_name` / `name` | if LOKA has a title separate from the description; else Atlas derives the name from the description's first line |
| `description` | string | `description` | **full length, never cut** |
| `categories` | string[] | `categories` | joined `; ` for the CSV-shaped column; keep the array in JSON |
| `labels` | string[] | `labels` | ditto |
| `latitude`, `longitude` | number | `latitude`, `longitude` | WGS84; `null` when the tag has no point |
| `address` | string | `address` | |
| `space_ids` / `spaces[]` | | `spaces` | names joined, plus ids |
| `created_at`, `updated_at` | RFC3339 | `created_at`, `updated_at` | |
| `likes_count` | int | `likes` | |
| `comments_count` | int | `comments_count` | |
| `images[]` (§4.6) | | `photo_urls` (all, `; `-joined), `photo_1_url`, `photo_2_url`, `thumbnail_url`, `photo_count`, `image_urls` | Atlas's existing photo columns |
| `public_link` | url | `public_link` | the tag's page on loka.place, if public; `null` for private spaces |
| `comments[]` (§4.5) | | `festival_comment` and the structured `loka_schedule` (§6) | Atlas joins the *bot's* schedule comment into `festival_comment` for backward compatibility with Event mode's parser, and reads the structured block directly |
| `creator_display` | string | **not sent to the public map** | see below |

### 5.1 People privacy

Atlas strips from every public map any column that names a person: `created_by`, `created_by_user_id`, anything ending `_user_id` (`api/lib/atlas/search-text.js`, line 26). The sync endpoint should therefore:

- **Not send** `creator` (user id) or `creatorName` in the tags list by default. Today's public `/api/spaces/<id>/tags` sends both to anyone — that is a leak the new endpoint must not repeat.
- Send instead `created_by_display` **only when** `include=people` is asked for, and only for spaces with a grant (the owner opted in). Atlas needs it for exactly one thing: the owner's private "who contributed" view, never the public map.
- For comments, send `author.display_name` and `author.is_bot`. Atlas shows a comment on the map only when `is_bot` is true (the schedule) or the atlas owner has turned on "show visitors' comments"; it never shows comment authors.
- Likes: a count only, never who liked.
- Consider: the old public `/api/spaces/<id>/tags` should also drop `creator`/`creatorName` for `public_read` spaces. **[DECISION_NEEDED]** (LOKA app may rely on it.)

---

## 6. Temporary facts in comments: the schedule comment

### 6.1 Principle

A tag describes a *place*; a comment can describe *what is true of it for a while* — the sessions a festival runs there this week. The comment is visible to everyone in the LOKA app (readable as today), and Atlas reads it as data. When it expires it is removed or marked past.

The writer is a bot account. **[DECISION_NEEDED]** keep `LOKA_admin` (already the author of all 16 Emergence schedule comments) or create `LOKA Atlas` so the app shows a sensible author name. Either way the backend marks the account `is_bot = true`.

### 6.2 Format, version 1

Human-readable text first (exactly today's shape, which Atlas's `parseProgramme` already reads), then one machine block fenced by marker lines. The app shows the whole thing; the block is short and sits at the bottom.

```
EMERGENCE: FESTIVAL OF FUTURE CITIES · 29–31 Oct 2026
Festival venue · 3 sessions

THU 29 OCT
  14:00–15:30 24/7 Power – A City Imagined on Renewables · Transitions Research / CSTEP
  16:00–17:30 AI and the Future of Cities · AI Knowledge Consortium

FRI 30 OCT
  09:30–11:00 Climate Tech Storybuilding · Storiculture

Times and registration: emergencefestival.in

--- loka-schedule v1 ---
{"v":1,"kind":"schedule","key":"emergence-2026","tz":"Asia/Kolkata",
 "valid_until":"2026-11-01T00:00:00+05:30","source":"https://emergencefestival.in/schedule",
 "generated_at":"2026-10-30T06:10:00Z",
 "sessions":[
  {"day":"2026-10-29","start":"14:00","end":"15:30","title":"24/7 Power – A City Imagined on Renewables","organiser":"Transitions Research / CSTEP","url":"https://…"},
  {"day":"2026-10-29","start":"16:00","end":"17:30","title":"AI and the Future of Cities","organiser":"AI Knowledge Consortium"},
  {"day":"2026-10-30","start":"09:30","end":"11:00","title":"Climate Tech Storybuilding","organiser":"Storiculture"}]}
--- end ---
```

Rules:
- Marker lines are exact: `--- loka-schedule v1 ---` and `--- end ---`. The JSON between them is one object, may span lines, UTF-8.
- The readable part is **generated from** the JSON (never edited by hand) so the two cannot disagree. Atlas, when reading, trusts the JSON and uses the text only as a fallback for comments written before this format (today's 16).
- `key` names the event (one per atlas/event); `kind` lets the same mechanism carry other temporary facts later (`"kind":"notice"` — a closure, an opening-hours change — with a `text` field instead of `sessions`).
- `v` is the format version; a reader ignores blocks with a `v` it does not know and reports it.

### 6.3 No duplicates

The backend keeps `external_key` on comments (§4.5). Atlas writes with `external_key = "schedule:" + key` (e.g. `schedule:emergence-2026`). A second `POST` with the same key on the same tag **updates** the earlier comment; the backend enforces `UNIQUE (tag_id, author_id, external_key)`. Atlas also reads the tag's comments before writing and, if it finds a bot comment with a `loka-schedule` block for the same `key` but no `external_key` (today's hand-written ones), updates that one via `PUT` and the backend attaches the key. Net: at most one schedule comment per event per tag, ever.

### 6.4 Length

Today's largest schedule is ~1,600 characters readable + ~2,000 JSON. Comment limit on the backend: **[DECISION_NEEDED]** confirm it is ≥ 8,000 characters for bot comments (`413 comment_too_long` otherwise; Atlas then writes the readable part only and warns).

### 6.5 Expiry

- `valid_until` lives both in the JSON and as a column on the comment (`POST` body `valid_until`), so the backend can act without parsing text.
- After `valid_until`: the LOKA app hides the comment from the tag's list (or shows it under "Past") — **[DECISION_NEEDED]** hide or fold. The endpoint still returns it with `"expired": true` for 30 days, then it is deleted by a nightly job. Atlas's reader ignores expired blocks.
- Atlas's own "Refresh from LOKA" after the event (phase 2) offers "Remove the festival schedule from N places" which `DELETE`s the bot's comments by key.

### 6.6 Reading side (Atlas)

`readScheduleComments(tag)`: for each bot comment, find the fenced block, parse, check `v`, `key`, `valid_until`; return `sessions[]`. Fallback when no block: run today's `parseProgramme` on the text (keeps the 16 existing comments working until they are rewritten in v1 format at the next refresh).

---

## 7. Backend work list (phase order)

**Phase 1 — read-only** (unblocks the sync)
1. Service credential + middleware for `/api/v1/atlas/*`.
2. `updated_at` on tags bumped by comment/like/image changes; tombstones (`deleted_at` + space membership history).
3. `atlas_space_grants` table; grant UI for the owner (toggle in app, option (a) of §3.3).
4. `GET spaces`, `GET spaces/{id}`, `GET spaces/{id}/tags` with `updated_since`/cursor/`deleted`/`include`, `GET tags/{id}`.
5. Absolute image URLs; private-space media behind signed URLs.
6. Error contract, rate-limit headers, `X-LOKA-API-Version`.
7. Drop `creator`/`creatorName` from Atlas-facing responses (and, if agreed, from the old public one).

**Phase 2 — comment write**
8. `is_bot` on users; the bot account.
9. `external_key`, `valid_until`, `expired` on comments; `POST` upsert, `PUT`, `DELETE` for own comments; `comment` scope on grants.
10. App behaviour for expired comments.

**Phase 3 — optional**
11. Webhook with HMAC signature; `ETag`/`304` on the full sweep.

Backward compatibility: nothing in the existing public `/api/...` changes except (7), and only if agreed.

---

## 8. Atlas-side design (brief; for context)

### 8.1 Sync job

- Per atlas, a setting `loka: { spaceIds: [...], layer: "tags", scope }` set by the owner through a "Connect to LOKA" step (lists the granted spaces from `GET /api/v1/atlas/spaces`).
- **Manual**: a "Refresh from LOKA" button on the owner's atlas page. **Scheduled**: every 30 min for atlases in Event mode while the event is within ±2 days; daily otherwise. **[DECISION_NEEDED]** the two intervals.
- Each run: incremental sync (`updated_since = stored token − 60 s`) → merge into the layer by `tag_id` (new tags added, changed ones replaced, tombstoned ones removed) → re-run the mode's derivations (venues, sessions, nearby places, place fixes and merges from `deploy/events/<slug>.json`, exactly what `refresh-event-atlas.mjs` does) → rebuild search index.
- **Backup before writes**: `backupFiles('loka-sync', slug, dir, [...])` as the refresh script does; keep the last 10.
- **Never the `deoria-bioregion` atlas**: the `NEVER` set in `event-mode-lib.mjs` applies; the job refuses that slug before reading anything.
- **No 500-character cut** on this path: the sync writes properties straight into the layer's GeoJSON; the CSV importer's cap is for uploads only.
- **Progress line** for the owner while it runs ("Reading 412 places from LOKA · 2 of 3 pages", "Finding what is near 7 venues", "Writing the map"); a failed run leaves the atlas exactly as it was and says why in plain words (the endpoint's `message`).
- A full sweep on the first run and whenever the server says the token expired; a diff summary at the end ("3 new places, 1 changed, 1 removed").

### 8.2 Schedule reader

A module `atlas/schedule-reader` (server side), generic across events:

1. **Fetch** the schedule page the owner gives (URL). Respect `robots`, send a plain user agent, cache the fetched HTML with the run.
2. **Extract sessions**, trying in order and stopping at the first that yields ≥ 1 session that validates:
   - **schema.org `Event` JSON-LD** (`<script type="application/ld+json">`, `@type: Event`/`EventSeries`, `startDate`, `endDate`, `location.name`, `organizer.name`, `name`, `url`). Most ticketing and festival sites emit this.
   - **iCal / ICS** linked from the page (`rel="alternate" type="text/calendar"` or a `.ics` link): `DTSTART`, `DTEND`, `SUMMARY`, `LOCATION`, `ORGANIZER`.
   - **Site-specific adapters**, registered by hostname: `emergencefestival.in` → `article.em-sch__session` with `p.em-sch__venue`, `p.em-sch__time`, `h4` title, organiser from the following line. One file per adapter, ~30 lines; the example for the next festival.
   - **AI-assisted reader**: the page's main text (scripts/nav removed, ≤ 60k characters) goes to a model with a fixed JSON schema `{sessions:[{venue, day, start, end, title, organiser, url}]}`; the output is **validated** (every session needs venue + day + title; times `HH:MM`; days within the event's dates) and **cross-checked** (every session's title must occur verbatim in the page text, otherwise it is dropped and reported). Never the only step without the dry run.
3. **Match venues to tags**: normalise names (case, punctuation, "The", transliteration), match against the space's tag names and addresses; exact → fuzzy (trigram ≥ 0.8) → unmatched. Remembered matches in `deploy/events/<slug>.json` (`venueAliases: {"Old Secretariat (IPSCDL)": "<tag_id>"}`) so a human decides once.
4. **Dry run** (always first): a table — venue → tag, sessions added / changed / removed since the current comment, unmatched venues, dropped sessions and why. The owner approves on the page ("Write 7 schedules · 41 sessions").
5. **Write** via `POST …/comments` with `external_key`, then re-read the tag and confirm the block round-trips; then run the sync job so the map shows it.

---

## 9. Security notes

- The service credential is the single secret; it lives in Atlas's env on the server, never in git, never in the browser. Rotation: issue, overlap one day, retire.
- Private-space data on Atlas is stored where the atlas's own access rules already apply (private atlases are opened by key/invite); the sync never changes an atlas from private to public.
- Comments written by the bot carry no personal data; the reader treats everything from the web page as untrusted text (escaped on the card, titles never interpreted).
- Audit: the backend logs each Atlas call with the grant used; the owner can see "last read by LOKA Atlas: …" on the space.

---

## 10. Decisions needed (collected)

1. §3.3 Grant creation: in-app toggle (a) or paste-a-key (b).
2. §4.1 Does `GET /api/v1/atlas/spaces` list *every* public space, or only granted ones?
3. §4.6 Private-space images: signed URLs in JSON, or served behind the credential.
4. §5.1 Drop `creator`/`creatorName` from the old public `/api/spaces/<id>/tags` as well.
5. §6.1 Bot account: keep `LOKA_admin` or create `LOKA Atlas`.
6. §6.4 Comment length limit for bot comments (≥ 8,000 characters?).
7. §6.5 Expired schedule comments in the app: hidden or folded under "Past".
8. §8.1 Scheduled sync intervals (30 min during an event, daily otherwise?).
