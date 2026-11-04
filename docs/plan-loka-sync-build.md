# LOKA sync — build plan (4 Nov 2026)

Built against what the LOKA server actually shipped (GET /tags/download, an ordinary
LOKA sign-in, a read-only account that sees the public tags), not against
docs/design-loka-sync.md, whose larger shape was not built. That document's §10
questions are mostly moot now; the ones that still matter are §5 below.

## 1. What it does, in plain words

An owner can say "keep this atlas up to date from LOKA space X". From then on LOKA
Atlas fetches that space's places on a schedule (and when the owner presses
"Update now"), and the atlas's LOKA layer changes to match: new places appear,
changed places change, places taken out of LOKA leave the atlas. Everything the
atlas added itself (LOKA's answers to its questions, the place names it worked
out, small photos) is kept for places that did not change.

## 2. How it is built

1. **Sign-in (server only).** The refresh key lives in `api/.env` as
   `LOKA_REFRESH_TOKEN` (Mithun puts it there himself; documented in
   `api/.env.example`). Before each sync the server swaps it for a 60-minute key
   (`POST /api/auth/refresh`) and keeps the renewed key in a file only the server
   can read (`api/data/atlas/loka-key.json`), so the 90-day window keeps sliding.
   The key is never logged, never sent to a browser, never written into an atlas.
2. **Fetching.** `GET /api/tags/download?space_id=…&format=ndjson`. A download
   with no closing `_eof` line, or one marked `truncated`, counts as failed and
   changes nothing. Later syncs ask only for places changed since the last one
   (minus 60 seconds, duplicates dropped by id), and once a day a full fetch
   finds places that were taken out (LOKA does not list removals).
3. **Turning a place into a row.** Each place becomes the same columns a LOKA
   export file has today (tag_id, description, address, latitude, longitude,
   labels, categories, photo links, public link, created_at…), so everything
   downstream — reading, Explore, Insight, search, small photos — works unchanged.
4. **Applying.** Through the same path as an owner's re-upload (ingestLayer →
   commitLayer, as the server already does for its own writes), with the
   atlas's own columns (answers, `loka_name`, small photos) carried over by
   tag_id for unchanged places. New or changed places are read by LOKA in the
   background, as after any change of places today. Never on deoria-bioregion.
   Never while the atlas is building; a backup of the layer before each write.
5. **Owner menu.** One line: "Kept up to date from LOKA · <space> · checked
   10 min ago · Update now", with a calm progress line while it runs and a plain
   sentence if it fails ("LOKA couldn't be reached; your atlas is unchanged").
   Owners and editors may press Update now; only the owner connects or
   disconnects a space.
6. **Checks.** A pretend LOKA server in the tests: sign-in renewal and saving
   the renewed key; a download cut short (no `_eof`) changes nothing; a place
   added, changed and taken out; answers kept for unchanged places; deoria
   refused; the key never appears in a reply or a log.

## 3. What is not in this build

- Writing to LOKA (no schedule comments: the server has no writes).
- Private LOKA spaces: the account sees public ones only. A space owner can add
  it to their space later; nothing in Atlas changes for that.

## 4. Order of work

Server sign-in + fetch + row mapping (with checks) → apply and keep answers
(with checks) → Update now and the Owner menu line → try it on a copy of a real atlas on
this computer → Mithun's yes → deploy → Mithun puts the key in `api/.env`.

## 5. Mithun's answers (4 Nov 2026)

1. **Who connects an atlas to a space.** An owner may make an atlas of the LOKA
   spaces they created themselves. For any other space they press **Request
   access**, and the super admin approves or declines. The super admin may make
   an atlas from any space, **private ones too**.
2. **How often.** **Only when pressed** — no schedule. "Update now" in the Owner
   menu (§2.5); §2.2's hourly/daily checks are dropped. Each press fetches only
   what changed since the last one, plus a full pass to find removed places.
3. **Places taken out of LOKA** leave the atlas too.
4. **New or changed places** are read by LOKA automatically; answers for the
   rest are kept.

### What this needs from the LOKA server (asked of the loka-server session)
- **"Spaces this person created."** Atlas knows an owner by email; LOKA knows
  people by phone sign-in. A way to tell which spaces an Atlas owner created is
  needed (e.g. the owner signs in to LOKA once from Atlas, or LOKA keeps a
  verified email per user).
- **Private spaces for the super admin.** The sync account sees public spaces
  only. Either the super admin's own LOKA sign-in is used for private spaces, or
  the sync account is added to that space (one SpaceMember row) when the super
  admin connects it.
- **A list of spaces** (id, name, public or private, created by) to choose from.

Until those answers come, the build covers: the key, fetching, turning places
into rows, applying with answers kept, Update now, and connecting by the super
admin to a public space. Owner self-connect and Request access follow.

### The LOKA server's answers (4 Nov 2026, loka-server session)
- **A. Which spaces an owner created.** Only org admins and platform admins can create spaces, and all of them have an email; they sign in to LOKA by **email code** (POST /auth/send-otp, /auth/verify-otp), not SMS. Atlas must not match emails as text: the owner signs in to LOKA once from Atlas, Atlas sends that LOKA token (in a POST body, never a URL) to GET /users/me itself, keeps the LOKA user id and throws the token away (design: loka-server docs/design-dashboard-atlas-signin.md, commit 1c3bf95). `email` and `orgIds` in /users/me are committed but **not deployed** yet.
- **B. Private spaces for the super admin.** Per space: when the super admin connects a private space, the sync account is added to it as a Viewer (POST /spaces/<id>/users with the account's phone). Needs one small server change if LOKA moves to API keys (a key bound to the sync account). No blanket "read everything" flag.
- **C. A list of spaces** (id, name, type, owner, tag count, filter by creator) **does not exist**. GET /spaces is superadmin only and no payload names the owner. Needs server work and Mithun's go-ahead.
- **API key.** The server session has built (not committed, not deployed, not approved) an `X-LOKA-API-Key` sign-in for the download that can be cancelled on its own. Atlas supports both it and the refresh token; the refresh token stays until LOKA confirms the key is live.
- **Removals** need a full download of the space on every Update now (no tombstones). Cheap at today's 1,330 tags.

### Later answers (4 Nov 2026)
- **A LOKA space that is now empty** (a complete download with no places): the atlas is emptied too — every place on the layer is taken out (backup first). A download that is cut short or fails still changes nothing.

### Owner self-connect check (loka-server session, 4 Nov 2026)
GET /spaces/<id> returns orgId (public spaces readable by anyone; private ones only by members, which a space's creator is). With the owner's own LOKA token: GET /spaces/<id> → orgId; GET /users/me → orgIds, role (needs 1c3bf95 deployed); accept if orgId ∈ orgIds and role is org_admin. This is a **soft check**: it proves "an org admin who belongs to the space's org", not "the admin of that org" or "created this space". The tight check needs one field, ownerId, on the space payload — a small server change, separate from the spaces list.
Server state: the API key (X-LOKA-API-Key, keys `loka_sk_…`, made with `python scripts/manage_api_client.py create loka-atlas`, shown once) is approved and committed (52ec079), DDL applied; **deploys are blocked** — the LOKA production server can't reach GitHub (`Permission denied (publickey)` for /root/.ssh/id_ed25519). Binding the key to the sync account is not built or approved.

### Who may connect a space (Mithun, 4 Nov 2026 — replaces "spaces they created")
**Anyone who has been added as a member of the space, or of the organisation that owns it, may make an atlas of it.** Checked with the person's own LOKA sign-in (email code, from Atlas): GET /spaces/<id> → orgId; GET /users/me → orgIds (needs 1c3bf95 deployed); GET /users/<me>/spaces → their space memberships. Allowed if the space is in their memberships or its orgId is in their orgIds. Everyone else: Request access → super admin. No ownerId field is needed.

### Choosing a space while building (Mithun, 4 Nov 2026, reverses "spaces list: not now")
The build wizard shows a **list of spaces** to pick from: everything for the super admin (private too), and for anyone else the spaces they are a member of and their organisations' spaces (public ones offered with Request access). Needs the LOKA server's spaces list (asked of the loka-server session, for Mithun's confirmation there). Today's way stays meanwhile: build, then Settings → Connect to a LOKA space.
- **The 15 spaces whose owner is in neither the space nor its organisation** (all in the "LOKA" organisation): Mithun, 4 Nov — "created by the super admin and belong to LOKA". They are LOKA's own spaces; the super admin connects them. Whether their owner_id users should see them under "my spaces" is put to Mithun in the loka-server session.
