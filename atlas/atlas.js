/* LOKA Atlas — a generic, manifest-driven map engine (MapLibre GL JS).
 * Give it a dataset folder containing manifest.json + data files and it builds
 * the map, the layer-control widget, legends, popups and the credits footer.
 * No layer is hard-coded: everything is described declaratively in the manifest. */
(function () {
  "use strict";

  try {
    console.log(
      "%cLOKA Atlas%c · a Socratus project\n%cOpen data, openly mapped — discoverloka.org",
      "font:700 15px/1.5 'Lora',serif;color:#2A6B41",
      "font:400 12px/1.5 'Karla',system-ui,sans-serif;color:#5A5751",
      "font:400 11px/1.5 'Karla',system-ui,sans-serif;color:#6E6A63"
    );
  } catch (e) {}

  var QS = new URLSearchParams(location.search);
  // No ?dataset= -> this page is the LOKA Atlas home (a gallery of instances).
  // With ?dataset=<id> it is the viewer for that instance.
  var DATASET = QS.get("dataset") || "";
  var KEY = QS.get("key") || "";
  // ?embed=1 strips the page furniture — site nav, the build-your-own CTA and
  // the footer — leaving the atlas's own identity and the map. It's what the
  // add-data preview wants: a look at the atlas, not at loka.place.
  // ?embed=map goes further: nothing but the stage, filling the frame.
  var EMBED = QS.get("embed") === "1" || QS.get("embed") === "map";
  if (EMBED) {
    document.documentElement.classList.add("atlas-embed");
    if (QS.get("embed") === "map") document.documentElement.classList.add("atlas-embed-map");
    // The owner's own tooling has no business inside someone else's frame:
    // Share offers a link to an atlas that may not be published yet, and Add
    // data walks the frame off to the data bench in the middle of a flow. Take
    // the row out of the document rather than hide it — a display:none button
    // is still a button waiting for the next line of code to unhide it, and CSS
    // can't stop `hidden = false`.
    var ownerActions = document.querySelector(".hero-actions");
    if (ownerActions && ownerActions.parentNode) ownerActions.parentNode.removeChild(ownerActions);
    // LOKA's badge leaves the frame for a tab of its own, never the host page
    Array.prototype.forEach.call(document.querySelectorAll(".loka-badge"), function (a) { a.target = "_blank"; a.rel = "noopener"; });
  }
  // An atlas takes the whole page — the map edge to edge under one thin
  // header (index.html's .atlas-full rules). The home gallery keeps its own
  // page shape.
  if (DATASET) document.documentElement.classList.add("atlas-full");
  // Public datasets are plain static files. A private atlas's files sit outside
  // the web root, so they come through the API instead, and there are two ways to
  // be allowed: a view key in the address, or — with ?via=api and no key — the
  // signed-in owner's own session. The session route is what lets the owner
  // preview a private atlas, since the plaintext key is issued once at creation
  // and only its hash is kept, so no page can look it up later.
  var VIA_API = !!KEY || QS.get("via") === "api";
  var BASE = VIA_API ? "./api/datasets/" + DATASET + "/" : "./datasets/" + DATASET + "/";
  /* True once the atlas has answered through the API — only a private atlas
     does, so this is the viewer's own knowledge that it is drawing one, with
     or without a key in the address (the owner arrives with neither). */
  var PRIVATE = false;
  /* A layer's file keeps its name when its contents change — reading it rewrites
     user-<layer>.geojson in place — so its address has to change when its
     contents do, or a browser answers the next request out of its own cache.

     DATA_V covers the case where THIS page caused the change: the owner asks
     for a reading, it lands, and the next fetch is a different address. It
     cannot cover the other two, because they happen when this page is not
     running: a reading done on the server, and any visitor arriving later.
     Measured after a server-side re-read of a live atlas: the manifest came back
     fresh with three new question names while the places came out of cache
     still carrying the old answers, so the map wore new labels over old
     colours — the same halves-out-of-step fault as a key called "Pattern 4",
     arrived at from the other direction.

     So a layer's own file is asked for by its CONTENTS. The manifest already
     records a hash of each layer's rows, and the manifest is what the page has
     just fetched, so the address changes exactly when the rows do and never
     otherwise. DATA_V still wins when it is set: it means something changed a
     moment ago, which is fresher than anything the manifest can know. */
  var DATA_V = "";
  function bumpDataVersion() { DATA_V = String(Date.now()); }
  function dataUrl(file, ver) {
    var url = BASE + file;
    var q = [];
    if (KEY) q.push("key=" + encodeURIComponent(KEY));
    var v = DATA_V || ver;
    if (v) q.push("v=" + encodeURIComponent(v));
    if (!q.length) return url;
    return url + (url.indexOf("?") < 0 ? "?" : "&") + q.join("&");
  }
  // a layer's file, asked for by what is in it
  function layerUrl(L) { return dataUrl(L.source, L && L.contentHash); }
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var el = function (tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  /* Category icons and the value->icon matcher live in iconkit.js, loaded
     before this file and shared with the owner's tools, which draw the same
     legend beside the map — see the note there on why one table beats two.
     Aliased locally so the rest of this file reads as it always did. */
  var ICONS = LokaIcons.ICONS;

  var map, MANIFEST, activeBasemap, DATA = {}, markersByLayer = {}, cropState = {};
  var flipWired = false;   // the layout-flip listener outlives any one map — see start()
  /* A map framed for one window size is wrong for another: made narrower, the
     region ran off the right edge. So while nobody has moved the map, a resize
     frames it again; once someone pans or zooms, their view is left alone. */
  var resizeWired = false, userMoved = false;
  var searchKeyWired = false;   // "/"-to-search is wired once, however often the panel rebuilds

  /* ---- more than one key: shared palette + state ----
     The colours are fragment.js's CATEGORY_COLORS, duplicated because this is
     a plain browser script with no imports: Paul Tol's muted scheme, same
     order, same grey for "other". If one list changes, change both.
     Measured for this feature (CIEDE2000 over Viénot-Brettel dichromacy
     simulation): min pairwise ΔE00 within the eight = 15.0 normal, 15.8
     deuteranopia, 14.8 protanopia. Two active keys deliberately REUSE this
     palette instead of splitting the spectrum between them: a 14-colour
     palette only reaches a ~15.5 floor by becoming a lightness ladder of
     blues and greys (dichromats keep a single blue↔yellow hue axis), and
     warm-vs-cool banding collapses to 1.6 ΔE00 under deuteranopia — two keys'
     colours become the same colour. So colour says which KIND within a key,
     the mark's SHAPE says which KEY, and colours repeat freely between keys:
     every key counts from the front of the palette (the committed key keeps
     its committed colours), and the key panel states that cost in words. */
  var KEY_COLORS = ["#332288", "#999933", "#44AA99", "#AA4499", "#117733", "#882255", "#88CCEE", "#DDCC77"];
  var KEY_OTHER = "#7a756c";
  var KEY_MAX = 8;
  // how many kinds a column may hold and still be offered as a key — see the
  // note where it is used. Eight are drawn; the ninth and tenth become "other".
  var KEY_CAP = 10;
  // the wizard's named single colours (fragment.js MARKER_COLORS), for "one colour"
  /* The seven-colour point set (DESIGN.md §2), each with a marker shape of its
     own in iconkit.js. The old names keep resolving so a manifest written
     before the Bazaar palette still draws — to the new value of the same
     name, which is the one place an existing atlas changes colour: a layer
     that asked for "rust" by name, not by hex, asked for the product's red. */
  var ONE_COLORS = {
    sindoor: "#C9402B", leaf: "#2A6B41", marigold: "#E9A237", blue: "#3A7FA1",
    stone: "#A39E94", ink: "#26231F", turmeric: "#B99A1C",
    rust: "#C9402B", moss: "#2A6B41", ochre: "#E9A237", sienna: "#D2692A", slate: "#3A7FA1",
  };
  var keyState = {};   // layer id -> { active: [column, ...], note: string|null }

  // Signed-in state in the nav — on the home gallery and on every atlas.
  function initAuthNav() {
    // embedded: the whole nav is hidden, so there's no state to show and no
    // reason to ask the API who's signed in from inside somebody's iframe.
    if (EMBED) return;
    var user = $("#nav-user"), signin = $("#nav-signin"), signout = $("#nav-signout");
    if (!user || !signin || !signout) return;
    fetch("./api/auth/me", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (me) {
        if (!me || !me.email) return; // stays: "sign in" link
        user.textContent = me.email;
        user.hidden = false;
        signin.hidden = true;
        signout.hidden = false;
      })
      .catch(function () {});
    signout.onclick = function () {
      fetch("./api/auth/logout", { method: "POST", credentials: "same-origin" })
        .catch(function () {})
        .then(function () { location.reload(); });
    };
  }
  initAuthNav();

  if (!DATASET) {
    renderHome();
  } else {
    // The owner's tools mount whether or not the map drew. An atlas whose files
    // are missing cannot render — and that is exactly when its owner most needs
    // Settings, because Delete lives there. Gating the tools on a successful
    // draw left a broken atlas impossible to throw away: it would not open, and
    // the only way to remove it was the one the failure had just taken away.
    draw().then(function () { checkOwner(); });
  }

  /* Read the atlas's manifest and draw from it. One function rather than a
     chain at the top level, because it has to be repeatable: while the owner
     edits a layer the map previews a DRAFT copy of the atlas, and the honest
     way to show a draft is the real viewer reading the real draft folder — not
     a second renderer that could quietly disagree with this one. See reboot().
     Resolves true when something was drawn, false when the reader has been
     handed an error in the map's place. */
  /* The stage's own ground and one quiet line while the manifest and the base
     style are on their way; the map takes its place once it has drawn. */
  function showLoading(on) {
    var n = $("#atlas-loading");
    if (!n) return;
    if (on) { n.classList.remove("gone"); n.hidden = false; return; }
    n.classList.add("gone");
    setTimeout(function () { n.hidden = true; }, 220);
  }

  /* The reason, in words a reader can act on. Our own messages already are;
     the map engine's are not — a browser that cannot draw the map throws a
     block of JSON about WebGL, which nobody should be shown. */
  function plainReason(err) {
    var m = String(err && err.message || "");
    if (/webgl/i.test(m) || /^\s*[\[{]/.test(m)) {
      return "Your browser could not draw the map. Try again in a newer browser, or with hardware acceleration switched on.";
    }
    if (!m || m.length > 240) return "Something went wrong while loading the atlas. Reload the page, and tell us if it keeps happening.";
    return m;
  }

  /* The manifest, from wherever the atlas lives. A public atlas is a folder of
     static files; a private one has left the web root and answers only through
     the API — to its owner and editors by their sign-in, to anyone else by the
     key in a private link. Nothing in the address says which it is, and the
     owner opens their own private atlas from the same plain link as everyone
     else, so a 404 from the static path is followed by one question to the
     API: 200 means private and allowed (so every later file goes the same way),
     403 means private and not allowed, 404 means there is no such atlas. */
  function fetchManifest() {
    return fetch(dataUrl("manifest.json")).then(function (r) {
      if (r.ok && VIA_API) PRIVATE = true;
      if (r.ok || VIA_API || r.status !== 404) return r;
      VIA_API = true;
      BASE = "./api/datasets/" + DATASET + "/";
      return fetch(dataUrl("manifest.json"), { credentials: "same-origin" }).then(function (r2) {
        if (r2.status === 404) { VIA_API = false; BASE = "./datasets/" + DATASET + "/"; return r; }
        if (r2.ok) PRIVATE = true;
        return r2;
      });
    });
  }

  function draw() {
    showLoading(true);
    return fetchManifest()
      .then(function (r) {
        if (r.status === 403) {
          var e = new Error(KEY
            ? "This private link no longer works — the owner has made a new one. Ask them for the current link."
            : "Only its owner, the people they invited, and anyone with its private link can open it. If someone sent you a link, open that one — it carries the key.");
          e.privateAtlas = true;
          throw e;
        }
        if (!r.ok) throw new Error(r.status === 404
          ? "There's no atlas at that address — it may have been removed, or it's still being built."
          : "The atlas data couldn't be loaded (error " + r.status + "). Try again in a moment.");
        // A web-server error page answering 200 would otherwise surface as a raw
        // JSON parse error; say something the reader can act on instead.
        return r.text().then(function (t) {
          try { return JSON.parse(t); }
          catch (e) { throw new Error("The atlas data came back unreadable — reload the page, and tell us if it keeps happening."); }
        });
      })
      .then(mergeLocalOverlay)
      .then(applyAppBasemaps)
      .then(function (m) {
        // the everyday map is a style document that has to arrive before the
        // map can be built from it
        activeBasemap = (m.basemaps.find(function (b) { return b.default; }) || m.basemaps[0]).id;
        return baseStyle(m).then(function (st) { start(m, st); return true; });
      })
      .catch(function (err) {
        showLoading(false);
        /* A small panel that says what happened in words and offers one thing
           to try. The title is the same every time; the line under it is the
           reason, which is the part a reader can act on. */
        /* A private atlas is not a fault, and "try again" would not change the
           answer: it gets its own title and the way in, in words. */
        $("#atlas-map").innerHTML =
          '<div class="atlas-error"><div class="atlas-error-box" role="alert">' +
            '<h2>' + (err && err.privateAtlas ? "This atlas is private" : "The map could not be loaded") + '</h2>' +
            '<p>' + esc(err && err.privateAtlas ? err.message : plainReason(err)) + '</p>' +
            (err && err.privateAtlas
              ? '<p>If it is yours, <a class="atlas-error-signin" href="./setup/?back=' + encodeURIComponent(DATASET) + '">sign in</a> and it opens for you.</p>'
              : '<button type="button" class="share-btn atlas-error-retry">Try again</button>') +
          '</div></div>';
        if (err && err.privateAtlas) document.title = "A private atlas \u2014 LOKA Atlas";
        var again = $(".atlas-error-retry");
        if (again) again.onclick = function () { location.reload(); };
        return false;
      });
  }

  // The LOKA Atlas home: featured reference instance, published instances, build CTA.
  function renderHome() {
    document.title = "LOKA Atlas \u2014 layered maps for any geography";
    setText("#atlas-title", "LOKA Atlas");
    setText("#atlas-subtitle", "Layered, shareable maps for any geography \u2014 built from open data.");
    setText("#atlas-about", "Every atlas below is built with the same engine: pick a region, choose layers, add your data, and share it. Public tech by Socratus.");
    var home = $("#atlas-home");
    var stage = document.querySelector(".atlas-stage");
    if (stage) stage.style.display = "none";
    var credits = document.querySelector(".atlas-credits");
    if (credits) credits.style.display = "none";
    /* The band was hidden here and a moss-filled card stood in for it inside
       the gallery. The band is better: it is the same invitation this product
       makes on every other page, in the same words and the same place. Its
       lead says "an atlas like this", which needs an atlas on the screen to
       mean anything, so on the home page it says what it means outright. */
    setText("#cta-lead", "Build one of these for your own geography and data.");
    home.hidden = false;

    var grid = $("#home-grid");
    grid.innerHTML = "";

    // one row per atlas: its name, then where it is and who built it
    function row(href, title, blurb, featured) {
      var a = el("a", "home-row");
      a.href = href;
      a.innerHTML = "<h2>" + esc(title) +
        (featured ? '<span class="feat">Featured</span>' : "") + "</h2>" +
        "<p>" + esc(blurb) + '</p><span class="go" aria-hidden="true">\u2192</span>';
      return a;
    }

    grid.appendChild(row("./?dataset=deoria-bioregion",
      "Deoria \u00b7 Kushinagar \u00b7 Gorakhpur",
      "Built with the Systems Practice at Socratus and Jagriti \u2014 crops, value chains and ecology across three eastern-UP districts.",
      true));

    // published instances from the registry (best-effort; fine without the API)
    fetch("./api/instances")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.instances) return;
        data.instances.forEach(function (i) {
          if (i.slug === "deoria-bioregion") return;
          grid.appendChild(row("./?dataset=" + encodeURIComponent(i.slug), i.title,
            [i.org, plainName(i.regionLabel)].filter(Boolean).join(" \u00b7 ") || "Built with LOKA Atlas."));
        });
      })
      .catch(function () {});
  }

  // Org-added layers live in a gitignored overlay (manifest.local.json + user-*.geojson)
  // so a `git pull` on the server never conflicts with them.
  function mergeLocalOverlay(manifest) {
    /* Asked for fresh every time, not from the cache.

       Everything else this product serves is stamped with the version it was
       deployed at, which is right for files that change when we ship. This one
       changes when an OWNER changes something — keeping a question, hiding one,
       renaming a layer — and the stamp knows nothing about that. So a question
       somebody had just kept was written to the layer, the map was rebuilt, and
       the browser handed back the copy it already had: the question existed
       everywhere except the one place its owner would look for it.

       It is a few kilobytes, and it decides what every key on the map is
       called. Worth asking for properly. */
    return fetch(dataUrl("manifest.local.json"), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (local) {
        if (!local) return manifest;
        (local.layers || []).forEach(function (L) {
          // contributed layers carry their credit into the layer's info tooltip
          /* And, in plain words, what kind of thing it came from. The note
             used to print the file's own name ("From Multispecies Landscape
             Assessment Timeline 2026.xlsx"), which tells a visitor nothing
             they can use and looks like a database field. The owner's own
             tools still know the filename; the visitor is told "a
             spreadsheet" or "a map file", and who shared it. */
          var kind = uploadKind(L.uploadedAs);
          if (L.addedBy && (L.addedBy.org || L.addedBy.name)) {
            var by = "Added by " + (L.addedBy.org || L.addedBy.name) + (kind ? ", from " + kind : "");
            L.info = L.info ? L.info + " — " + by : by;
          } else if (kind) {
            var from = "From " + kind + " someone shared";
            L.info = L.info ? L.info + " — " + from : from;
          }
          manifest.layers.push(L);
        });
        (local.groups || []).forEach(function (g) {
          if (!manifest.groups.some(function (x) { return x.id === g.id; })) manifest.groups.push(g);
        });
        (local.attributions || []).forEach(function (a) { manifest.attributions.push(a); });
        // the people who tagged the places, when the owner has recorded them
        if (local.taggedBy) manifest.taggedBy = local.taggedBy;
        return manifest;
      });
  }

  function start(manifest, styleDoc) {
    MANIFEST = manifest;
    document.title = manifest.title + " — LOKA Atlas";
    setText("#atlas-title", manifest.title);
    setText("#atlas-subtitle", manifest.subtitle || "");
    setText("#atlas-about", manifest.about || "");
    // the same two lines, where an atlas view reads them: the About & sources panel
    setText("#sources-sub", manifest.subtitle || "");
    setText("#sources-lead", manifest.about || "");
    renderBranding(manifest.branding);
    renderCollaborators(manifest);
    wireShare(manifest);

    // activeBasemap is chosen in draw(), before the style is fetched — the style
    // that gets fetched depends on which basemap is active, so it cannot wait
    // until here.

    map = new maplibregl.Map({
      container: "atlas-map",
      style: styleDoc,
      center: manifest.center,
      zoom: manifest.zoom,
      minZoom: manifest.minzoom || 5,
      maxZoom: manifest.maxzoom || 16,
      attributionControl: false,
      hash: false
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    // the scale note sits bottom-left, away from the zoom buttons (DESIGN.md §5)
    // with the zoom buttons: the bottom-left corner belongs to the credits chip
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");
    // attribution is rendered in a strip below the map (renderMapAttrib), not over it
    window.__map = map;   // debug hook
    map.on("error", function (e) { console.error("Atlas map error:", e && e.error && e.error.message); });

    /* An image the style asks for and its own sprite does not have.

       The base map style is somebody else's, fetched and merged, and one of its
       layers builds a road-shield name by joining "road_" to a road's shield
       number: ["concat", "road_", ["get", "ref_length"]]. A road with no number
       makes the name "road_", and the sprite has road_1 to road_6 and nothing
       called road_. Nothing of ours is missing and nothing fails to draw — the
       shield is simply not painted, which is right for a road with no number.

       Left alone it warns once per feature, and a third party filling the
       console is how our own faults get missed. So the blank is supplied, and
       each NAME is said once rather than silenced: a missing image that really
       is ours must still be visible. */
    var blanked = {};
    map.on("styleimagemissing", function (e) {
      var id = e && e.id;
      if (!id || map.hasImage(id)) return;
      map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
      if (blanked[id]) return;
      blanked[id] = true;
      console.info('Atlas: the base map asked for an image called "' + id +
        '" that its sprite does not have — drawn blank.');
    });

    // The layers panel and credits are plain DOM built from the manifest — they
    // must never wait on the basemap. On a slow tile fetch (or a throttled
    // iframe) the map's "load" can be seconds away, and the atlas looked empty:
    // no controls, no legend, nothing. Build them immediately; only the map
    // layers themselves wait for "load".
    try { buildControls(); buildCredits(); }
    catch (err) { console.error("Atlas controls error:", err && err.message, err && err.stack); }

    /* The showing basemap's own credit needs no style and no sources, so it is
       stated the moment the map exists. Leaving it to "load" meant a style that
       was slow — or that never finished — left the map crediting nobody. */
    renderMapAttrib();

    userMoved = false;
    map.on("movestart", function (e) { if (e && e.originalEvent) userMoved = true; });
    map.on("load", function () {
      try {
        // the base style is up: warm it before anything of ours goes on top,
        // and take the loading line away now there is a map to look at
        warmBaseStyle(map);
        showLoading(false);
        // buildLayers preloads sources async, so layer ids (L._ids) only exist once
        // it resolves. wirePopups + fitToData depend on those, so run them after.
        renderMapAttrib();
        buildLayers().then(function () {
          wirePopups();
          syncSearchBox();   // the data is in: keep the search box only if it has text to search
          /* Draw every layer's row again now the data is in. The panel is built
             before the files land, so anything that depends on what a layer
             actually contains — the owner's doors most of all — has nothing to
             go on the first time round. initLayerKeys re-draws the rows it
             touches, but it bails early on a layer with no key-shaped column,
             and that layer is exactly the one whose door matters most. */
          (MANIFEST.layers || []).forEach(function (L) { if (L._extra) renderExtra(L); });
          buildBar();        // the phone's tab now knows how many people or places
          if (!focusFit()) fitToData(false);
          setTimeout(showCue, 700);   // once the map has settled on the data
          renderMapAttrib(); // re-run once layer sources (e.g. labels) are added
          /* And once more when the style is genuinely up. A basemap given as a
             whole style document is still fetching when "load" fires, so the
             first two runs can find nothing to credit and leave the strip
             blank — which is how the map ended up crediting nobody at all. */
          map.once("idle", renderMapAttrib);
          // If the container had no real size when we fit (hidden iframe or a
          // backgrounded tab), the frame is garbage — refit once it gets one.
          var r = map.getContainer().getBoundingClientRect();
          if (r.width < 60 || r.height < 60) {
            var once = function () {
              window.removeEventListener("resize", once);
              setTimeout(function () { map.resize(); if (!focusFit()) fitToData(false); }, 60);
            };
            window.addEventListener("resize", once);
          }
        }).catch(function (err) { console.error("Atlas build error:", err && err.message, err && err.stack); });
        // re-frame when the layout flips between the floating panel (desktop) and
        // the bottom sheet (mobile). Wired once for the life of the page: start()
        // runs again on every draft preview (reboot), and this listener outlives
        // the map it was registered alongside.
        if (!resizeWired) {
          resizeWired = true;
          var refitT = null;
          window.addEventListener("resize", function () {
            clearTimeout(refitT);
            refitT = setTimeout(function () { if (map && !userMoved && !focusFit(true)) fitToData(true); }, 250);
          });
        }
        if (!flipWired) {
          flipWired = true;
          window.matchMedia("(max-width: 720px)").addEventListener("change", function () {
            setTimeout(function () { if (map && !focusFit(true)) fitToData(true); }, 80);
          });
        }
      } catch (err) { console.error("Atlas build error:", err && err.message, err && err.stack); }
    });
  }

  // Org identity from the manifest's optional `branding` block. Rendered ALONGSIDE
  // the fixed LOKA elements in the page (wordmark, credit strip, CTA) — those are
  // hard-coded in index.html and never driven by manifest content, so an instance
  // can add its own identity but can't remove LOKA's.
  function renderBranding(b) {
    if (!b || (!b.orgName && !b.logo)) return;
    var hero = $("#org-branding");
    if (hero) {
      hero.innerHTML = "";
      var wrap = el("span", "org-brand-line");
      if (b.logo) {
        var img = el("img", "org-brand-logo");
        img.src = dataUrl(b.logo);
        img.alt = b.orgName || "Organisation logo";
        wrap.appendChild(img);
      }
      if (b.orgName) {
        var lbl = el("span", null, "<b>" + esc(b.orgName) + "</b>");
        wrap.appendChild(lbl);
      }
      if (b.orgUrl && /^https:\/\//.test(b.orgUrl)) {
        var a = el("a");
        a.href = b.orgUrl; a.target = "_blank"; a.rel = "noopener";
        a.appendChild(wrap);
        hero.appendChild(a);
      } else {
        hero.appendChild(wrap);
      }
    }
    var cred = $("#org-credit");
    if (cred) {
      cred.innerHTML = "";
      if (b.logo) {
        var cimg = el("img", "org-credit-logo");
        cimg.src = dataUrl(b.logo);
        cimg.alt = b.orgName || "";
        cred.appendChild(cimg);
      }
      if (b.orgName) cred.appendChild(el("div", "org-credit-name", esc(b.orgName)));
      if (b.footerLine) cred.appendChild(el("div", "org-credit-line", esc(b.footerLine)));
    }
  }

  // Instance-specific partner credits from the manifest (`collabLede` sentence +
  // `collaborators: [{name, role, icon?}]`). Only the instance that declares them
  // shows them — the LOKA and MapLibre credits stay fixed in the page.
  var COLLAB_ICONS = {
    network: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="4.5" r="2.5"/><path d="m10.2 6.3-3.9 3.9"/><circle cx="4.5" cy="12" r="2.5"/><path d="M7 12h10"/><circle cx="19.5" cy="12" r="2.5"/><path d="m13.8 17.7 3.9-3.9"/><circle cx="12" cy="19.5" r="2.5"/></svg>',
    sprout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/></svg>'
  };
  function renderCollaborators(manifest) {
    var lede = $("#collab-lede");
    if (lede && manifest.collabLede) lede.textContent = " " + manifest.collabLede;
    var box = $("#collab-credits");
    if (!box) return;
    box.innerHTML = "";
    (manifest.collaborators || []).slice(0, 6).forEach(function (c) {
      var row = el("div", "cr-org");
      var icon = el("span", "cr-icon", COLLAB_ICONS[c.icon] || COLLAB_ICONS.network);
      icon.setAttribute("aria-hidden", "true");
      row.appendChild(icon);
      row.appendChild(el("div", null, "<b>" + esc(c.name) + "</b>" + (c.role ? "<span>" + esc(c.role) + "</span>" : "")));
      box.appendChild(row);
    });
  }

  /* Whoever owns this atlas gets its controls, here, on the atlas itself.

     The API answers canEdit:true when the caller's session owns the instance
     or was invited to it (same-origin cookie); everyone else gets the public
     fields and nothing more. Only then is owner.js fetched — a reader never
     downloads a byte of it, which is the other half of why the tools live in
     their own file rather than in this one. */
  function checkOwner() {
    // embedded: ownership is nobody's business inside someone else's frame, so
    // don't even ask the API who the caller is
    if (EMBED || !DATASET) return;
    fetch("./api/instances/" + encodeURIComponent(DATASET), { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (inst) {
        if (!inst || !inst.canEdit) return;
        loadOwnerTools(inst);
      })
      .catch(function () {});
  }

  /* ?v= is stamped by deploy/deploy.sh on every ship, exactly as it is on the
     script tags in the HTML, so a returning owner is never left running last
     week's tools against this week's API. */
  var OWNER_V = (function () {
    var tag = document.querySelector('script[src*="atlas.js"]');
    var m = tag && /[?&]v=([0-9A-Za-z._-]+)/.exec(tag.getAttribute("src") || "");
    return m ? m[1] : "dev";
  })();

  function loadOwnerTools(inst) {
    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "./owner.css?v=" + OWNER_V;
    document.head.appendChild(css);
    var js = document.createElement("script");
    js.src = "./owner.js?v=" + OWNER_V;
    js.onload = function () {
      if (window.LokaAtlasOwner) window.LokaAtlasOwner.mount(inst);
    };
    js.onerror = function () { console.error("Atlas: the owner tools could not be loaded."); };
    document.head.appendChild(js);
  }

  function wireShare(manifest) {
    if (EMBED) return;   // no Share inside a frame — see the embed block up top
    var btn = $("#share-btn");
    if (!btn || !window.AtlasShare) return;
    btn.hidden = false;
    // The owner's tools add facts the viewer can't know (e.g. that the atlas
    // isn't live yet, so the link only works for its owner). The panel opens
    // with whatever the button carries at click time.
    btn.__shareOpts = {
      url: location.href,
      title: manifest.title + " — LOKA Atlas",
      slug: DATASET,
      private: !!KEY || PRIVATE,
      viewKey: KEY || "",
    };
    btn.onclick = function () { window.AtlasShare.open(btn.__shareOpts); };
  }

  /* Where the map opens.

     An atlas opens on the places it holds. Somebody who tagged thirty-three
     things in Cubbon Park picked Bengaluru as the region — because that is
     where Cubbon Park is — and the map opened on all sixty-six kilometres of
     it, with their tags a speck in the middle. The region says what the map is
     OF; it should not decide what you see first.

     So: frame the layers the owner added themselves, and fall back to the
     region when there are none. That needs no rule about which atlases are
     which, because it settles itself — when somebody's places cover the whole
     region, framing them IS the region view. Measured on the three real
     atlases: Deoria has no layers of its own and is untouched; Bengaluru's
     finds span 21km of a 66km region, so it tightens a little; Cubbon Park's
     tags span 0.87km, and that is the one this is for. */
  function framedLayers() {
    // a draft preview asks for one particular layer, and still gets it
    if (MANIFEST.focusLayer) return [MANIFEST.focusLayer];
    return (MANIFEST.layers || [])
      .filter(function (L) { return L.userLayer && L.default !== false; })
      .map(function (L) { return L.id; });
  }

  /* Room for the panel that floats over the map, so framed places do not open
     underneath it. Shared with fitToData, which had this to itself while
     focusFit used a flat sixty on every side. */
  function viewPadding() {
    var pad = { top: 40, right: 40, bottom: 40, left: 40 };
    /* Room for the bottom sheet, the same way room is made for the side panel
       below. Without it a pin or a cluster disc can land under the sheet on
       first load and nothing says it is there — seen on the Bengaluru atlas,
       where a disc sat half-hidden at the bottom-left. */
    try {
      var stage = map.getContainer().closest(".atlas-stage");
      var sheet = parseFloat(stage && getComputedStyle(stage).getPropertyValue("--sheet-h")) || 0;
      if (sheet > 0) pad.bottom = Math.min(sheet + 16, map.getContainer().clientHeight * 0.45);
    } catch (e) {}
    try {
      var mr = map.getContainer().getBoundingClientRect();
      var panel = document.getElementById("atlas-panel");
      if (panel && mr.width) {
        var pr = panel.getBoundingClientRect();
        var overlapsVertically = pr.bottom > mr.top + 16 && pr.top < mr.bottom - 16;
        var onLeftHalf = (pr.left + pr.right) / 2 < mr.left + mr.width / 2;
        var intersectsMap = pr.right > mr.left && pr.left < mr.right;
        if (overlapsVertically && onLeftHalf && intersectsMap) {
          pad.left = Math.min(mr.width * 0.55, (pr.right - mr.left) + 24);
        }
        // and for the card docked at the right, while one is open
        if (LAST_POP && cardDocked()) pad.right = Math.min(mr.width * 0.45, 340 + 8 + 24);
      }
    } catch (e) {}
    return pad;
  }

  // Frame the data within the map area that's actually visible — i.e. to the right of the
  // control widget when it floats over the map (desktop), full width when it's docked below (mobile).
  function focusFit(animate) {
    var ids = framedLayers();
    if (!ids.length) return false;
    /* Before framing anything, let the region lower the floor.
    
       This used to live only in fitToData, and fitToData is the path NOT taken
       whenever there is a layer to frame — every load runs
       `if (!focusFit()) fitToData(false)`. So on the one atlas that needed it,
       the fix never ran: on a phone it opened showing 82.1°E to 87.9°E of an
       atlas covering 70.7 to 99.4, under six degrees of twenty-nine, because
       fitting needs zoom 2.84 and the floor was 4. Measured on the live site
       after I had already reported it fixed, which it was not.
    
       It is cheap and it always computes from what the build asked for, so
       calling it from both paths costs nothing and leaves neither uncovered. */
    floorFitsTheRegion();
    var w = 180, s = 90, e = -180, n = -90, seen = 0;
    ids.forEach(function (id) {
      var d = DATA[id];
      if (!d || !d.features || !d.features.length) return;
      d.features.forEach(function (f) {
        (function walk(c) {
          if (!Array.isArray(c)) return;
          if (typeof c[0] === "number") {
            seen++;
            if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
            if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
          } else c.forEach(walk);
        })((f.geometry && f.geometry.coordinates) || []);
      });
    });
    if (!seen || e < w || n < s) return false;
    /* One place, or several stacked on the same spot, has no width to frame, so
       it is given some. It used to be given a great deal: anything narrower
       than 0.01 degrees was pushed out by 0.02 either way, and 0.01 degrees is
       over a kilometre — so a park's worth of tags was inflated to about five
       kilometres and then capped wider still. The room is now only for the case
       that genuinely has none, and it is a few streets rather than a city. */
    var NOTHING = 1e-7, ROOM = 0.002;          // about 220 metres
    if (e - w < NOTHING) { w -= ROOM; e += ROOM; }
    if (n - s < NOTHING) { s -= ROOM; n += ROOM; }
    /* Thirteen is about a five-kilometre view: enough to cap a single point,
       and also enough to hold a small park at arm's length however tightly it
       was framed. Sixteen still stops one tag zooming to its rooftop. */
    map.fitBounds([[w, s], [e, n]],
      { padding: viewPadding(), duration: animate ? 350 : 0, maxZoom: 16 });
    return true;
  }

  /* The floor on how far out you can zoom is worked out when the atlas is
     built, against no screen in particular. On a phone that floor can be
     tighter than the atlas's own region needs, and then the map cannot show
     the thing it is a map of.

     Measured on this atlas: it covers 70.7°E to 99.4°E, a phone opened it
     showing 77.7°E to 92.3°E, and fitting the region on a 333-pixel-wide map
     needs zoom 2.63 against a floor of 4. Half the width — Punjab, Gujarat,
     the whole Western Ghats — was off the screen, with nothing to say so.

     So the floor gives way to the region. It is lowered only as far as the
     region actually needs on this screen, and only ever downwards, so a narrow
     window loosens it and a wide one leaves it exactly where the build put it.
     Run again on resize, because turning a phone sideways changes the answer. */
  function floorFitsTheRegion() {
    if (!MANIFEST.bounds || !map || !map.cameraForBounds) return;
    // Always measured against what the build asked for, never against whatever
    // this ran to last time — otherwise a narrow window loosens the floor and
    // a later wide one never tightens it back.
    var built = MANIFEST.minzoom || 5;
    map.setMinZoom(0);
    var cam = null;
    try { cam = map.cameraForBounds(MANIFEST.bounds, { padding: viewPadding() }); } catch (e) {}
    map.setMinZoom(cam && typeof cam.zoom === "number" ? Math.min(built, cam.zoom) : built);
  }

  function fitToData(animate) {
    if (!MANIFEST.bounds || !map) return;
    floorFitsTheRegion();
    map.fitBounds(MANIFEST.bounds, { padding: viewPadding(), duration: animate ? 350 : 0 });
  }

  /* ---- base style (glyphs + background + basemaps) ---- */
  /* ==================================================================
     THE APP'S BASE MAP — one place, and it is this one.

     A basemap is not an atlas's data, it is the ground the app draws on. It
     used to be written into every manifest at build time, which meant the look
     of the product was frozen into each atlas on the day it was built: change
     the house style and only atlases built afterwards would show it, while
     everything already published stayed as it was.

     So the tiles live here and are applied to whatever the manifest says, for
     the ids the app knows. Every atlas picks up the current look on its next
     load, old ones included, and no dataset file is touched to do it. The
     builder writes matching tiles so a manifest still describes itself, but
     this table is the authority — if the two ever disagree, this one wins and
     nothing breaks.

     An id the app does not know is left exactly as the manifest wrote it, so a
     hand-made atlas can still carry a basemap of its own.
  ================================================================== */
  var APP_BASEMAPS = {
    /* OSM Bright, from OpenFreeMap — roads, parks and water in gentle colour,
       the look chosen from map-style-variations.html, but drawn from VECTOR
       tiles and served without an API key.

       CARTO was the earlier choice and had to go: it began stamping
       "API KEY REQUIRED" across the tiles of an atlas that asks nobody to sign
       up for anything. Vector is also simply sharper — the text is drawn by the
       browser at the screen's own resolution rather than baked into a picture,
       which is the same problem the pixel-grid fix was chasing from the other
       end. Bright carries its own place names, so this basemap asks for no
       separate label layer. */
    light: {
      style: "https://tiles.openfreemap.org/styles/bright",
      labels: null,                    // built into the style
      attribution: "© OpenStreetMap contributors, © OpenFreeMap",
      ground: "#F5F1E6",               // --map-ground: the cream the frame holds
    },
    satellite: {
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      labels: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
      labelsAttribution: "Labels © Esri",
      tileSize: 256, maxzoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
      ground: "#2B2F33",
    },
  };

  /* Which font names the ACTIVE glyph source can serve.

     Every piece of text the atlas draws itself — a boundary's name, the number
     on a cluster disc — has to name a font, and the name has to exist in
     whichever glyph server the style points at. OSM Bright's fonts come from
     OpenFreeMap and are Noto; the old CARTO style's were Open Sans. Asking for
     the wrong one does not fall back: the glyph fetch 404s and the whole text
     layer draws nothing.

     That is exactly how the map came up empty after the basemap changed. The
     cluster disc's count could not be drawn, so the disc was not drawn, and
     because every marker was folded into a disc there was nothing left to see —
     66 markers in the page and an empty map.

     So the names are chosen with the style, not hard-coded at the point of use. */
  var GLYPH_FONTS = { regular: "Noto Sans Regular", bold: "Noto Sans Bold" };

  // The ground behind the tiles, so a slow fetch shows the map's own colour
  // rather than a grey belonging to no basemap. Starts as the app's everyday
  // map and is re-read from whichever basemap the atlas opens on, so there is
  // no third colour to keep in step.
  var mapGround = APP_BASEMAPS.light.ground;

  /* The everyday map, warmed and quietened to sit with the cream ground.

     OSM Bright is somebody else's style, fetched whole, and it is drawn for a
     white page: sky-blue water, lime woods, salmon motorways, black place
     names. On the atlas those colours compete with the data, which is the one
     thing the Map Speaks Rule forbids. So once the style is up its layers are
     repainted in the map tokens — water to the atlas's blue, greens
     desaturated, roads to a tone step above the ground, base labels to Ink
     Soft with the Ground halo — matched by the id and source-layer OSM Bright
     uses. Every call is guarded, and a layer that is not there is simply not
     touched: a style update upstream can drop a layer, and that must cost
     nothing. Satellite is never touched; the atlas's own layers are not
     touched either, because they are not in the style until after this runs
     and none of them carry these ids. */
  var BASE_WARM = {
    ground: "#F5F1E6", outside: "#EAE6DC", water: "#C8DBE5", waterway: "#3A7FA1",
    green: "#E9EDDF", wood: "#DCE3CF", landuse: "#EFEAE0", road: "#E2DDD0", roadMajor: "#D6D0C0",
    roadCasing: "#CFC9B8", building: "#E8E2D6", boundary: "#8C8985", label: "#5A5751", halo: "#F5F1E6",
    labelStrong: "#24211D",
  };
  function warmBaseStyle(m) {
    if (!m || !m.getStyle) return;
    var style; try { style = m.getStyle(); } catch (e) { return; }
    var W = BASE_WARM;
    function paint(id, prop, val) {
      if (!m.getLayer(id)) return;
      try { m.setPaintProperty(id, prop, val); } catch (e) { /* a property this layer type lacks */ }
    }
    (style && style.layers || []).forEach(function (L) {
      var id = L.id, src = L["source-layer"] || "", type = L.type;
      if (id === "background") { paint(id, "background-color", W.ground); return; }
      if (type === "fill" && src === "water") { paint(id, "fill-color", W.water); return; }
      if (type === "line" && src === "waterway") { paint(id, "line-color", W.waterway); paint(id, "line-opacity", 0.55); return; }
      if (type === "fill" && (src === "landcover" || src === "park")) {
        if (/glacier|ice|sand/.test(id)) { paint(id, "fill-color", W.landuse); return; }
        paint(id, "fill-color", /wood/.test(id) ? W.wood : W.green);
        if (/wood/.test(id)) { paint(id, "fill-opacity", 0.6); paint(id, "fill-outline-color", "rgba(0,0,0,0)"); }
        return;
      }
      if (type === "fill" && src === "landuse") { paint(id, "fill-color", W.landuse); return; }
      if (type === "fill" && src === "building") { paint(id, "fill-color", W.building); paint(id, "fill-outline-color", "rgba(0,0,0,0)"); return; }
      if (type === "fill" && (src === "aeroway" || src === "transportation")) { paint(id, "fill-color", W.landuse); paint(id, "fill-outline-color", "rgba(0,0,0,0)"); return; }
      if (type === "line" && (src === "transportation" || src === "aeroway")) {
        if (/railway|transit|cablecar|ferry/.test(id)) { paint(id, "line-color", W.boundary); paint(id, "line-opacity", 0.5); return; }
        var major = /motorway|trunk|primary/.test(id) && !/link/.test(id);
        if (/casing/.test(id)) { paint(id, "line-color", major ? W.roadCasing : W.road); return; }
        paint(id, "line-color", major ? W.roadMajor : (/path|track|service|minor/.test(id) ? "#EDE8DC" : W.road));
        return;
      }
      if (type === "line" && src === "boundary") { paint(id, "line-color", W.boundary); return; }
      if (type === "symbol") {
        var strong = src === "place" && /city|town|state|country/.test(id);
        paint(id, "text-color", strong ? W.labelStrong : W.label);
        paint(id, "text-halo-color", W.halo);
        paint(id, "text-halo-width", 1.6);
      }
    });
  }

  function applyAppBasemaps(m) {
    (m.basemaps || []).forEach(function (b) {
      var app = APP_BASEMAPS[b.id];
      if (!app) return;                        // not ours to speak for
      b.tiles = app.tiles;
      b.tileSize = app.tileSize;
      b.maxzoom = app.maxzoom;
      b.attribution = app.attribution;
      if (b.default) mapGround = app.ground;
    });
    // the place-name layer rides on top of whichever basemap is showing, so its
    // tiles belong to the basemap, not to the atlas
    (m.layers || []).forEach(function (L) {
      if (!L.tilesByBasemap) return;
      Object.keys(L.tilesByBasemap).forEach(function (id) {
        var app = APP_BASEMAPS[id];
        if (!app) return;
        // labels:null means the basemap draws its own names — a second layer of
        // them would print every town twice
        /* The credit follows the tiles. These label tiles come from the app
           now, so the atlas's own line — still naming CARTO, whose tiles left
           with the old basemap — is a claim about something no longer drawn. */
        L.attributionByBasemap = L.attributionByBasemap || {};
        if (app.labels) {
          L.tilesByBasemap[id] = app.labels;
          L.attributionByBasemap[id] = app.labelsAttribution || "";
        } else {
          delete L.tilesByBasemap[id];
          delete L.attributionByBasemap[id];
        }
      });
    });
    return m;
  }

  /* OSM Bright asks whether a road's rank or a boundary's level is above some
     number. Where the tiles carry nothing for one of those, MapLibre refuses the
     comparison outright — "Expected value to be of type number, but found null
     instead" — once per tile, in the console, for as long as the map is open.

     It is not our data and not our style: it is a mismatch between the two, and
     the map draws correctly either way. But a console full of errors is a
     console nobody reads, and this one buried a real fault of ours for most of a
     day, so it is worth removing rather than explaining.

     A missing number is read as zero, which is what the comparison would have
     concluded anyway — every one of these filters asks whether the number is at
     least something, so absent and zero are already treated alike. Nothing that
     was drawn stops being drawn. */
  function numbersOrZero(style) {
    var CMP = { "<": 1, ">": 1, "<=": 1, ">=": 1 };
    function fix(e) {
      if (!Array.isArray(e)) return e;
      var out = e.map(fix);
      if (CMP[out[0]]) {
        for (var i = 1; i < out.length; i++) {
          if (Array.isArray(out[i]) && out[i][0] === "get") {
            out[i] = ["coalesce", out[i], 0];
          }
        }
      }
      return out;
    }
    (style.layers || []).forEach(function (L) {
      if (L.filter) L.filter = fix(L.filter);
    });
    return style;
  }

  /* The style the map opens with.

     A basemap is normally a set of raster tiles, and those become one raster
     layer each whose visibility the Map/Satellite switch flips. One of them —
     the everyday map — is a VECTOR style instead (OSM Bright), which arrives as
     a whole style document of its own. When that is the case its document
     becomes the foundation and the raster basemaps are laid on top of it, still
     as toggleable layers, so the switch keeps working exactly as it did: turn
     satellite on and its opaque tiles cover the vector map beneath.

     Returns a promise, because a style document has to be fetched. */
  function baseStyle(m) {
    var raster = { sources: {}, layers: [] };
    var vector = null;
    m.basemaps.forEach(function (b) {
      var app = APP_BASEMAPS[b.id];
      if (app && app.style) {
        if (b.id === activeBasemap || !vector) vector = { id: b.id, url: app.style };
        return;                       // no raster layer of its own
      }
      raster.sources["base-" + b.id] = {
        type: "raster", tiles: b.tiles, tileSize: b.tileSize || 256,
        maxzoom: b.maxzoom || 19, attribution: b.attribution || ""
      };
      raster.layers.push({
        id: "base-" + b.id, type: "raster", source: "base-" + b.id,
        layout: { visibility: b.id === activeBasemap ? "visible" : "none" }
      });
    });

    var plain = {
      version: 8, glyphs: m.glyphs,
      sources: raster.sources,
      layers: [{ id: "bg", type: "background", paint: { "background-color": mapGround } }]
        .concat(raster.layers),
    };
    if (!vector) return Promise.resolve(plain);

    return fetch(vector.url)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (st) {
        // its own sources, sprite and glyphs come along — without them the
        // vector map has no shapes to draw and no font to draw names in
        st.sources = Object.assign({}, st.sources, raster.sources);
        st.layers = (st.layers || []).concat(raster.layers);
        return numbersOrZero(st);
      })
      .catch(function (e) {
        // the atlas is not held hostage by a style server: fall back to the
        // plain background and whatever raster basemaps exist, and say why —
        // and back to the font names THAT glyph source serves, or the fallback
        // would draw no text either
        console.error("Atlas: the base map style could not be loaded (" + e.message + ")");
        GLYPH_FONTS = { regular: "Open Sans Regular", bold: "Open Sans Bold" };
        return plain;
      });
  }

  /* ==================================================================
     LAYERS
  ================================================================== */
  function buildLayers() {
    var layers = MANIFEST.layers;
    // Preload every source first, THEN add layers in manifest order so draw order
    // is deterministic (array order = bottom→top; markers are DOM and sit on top).
    // Returns a promise that resolves once layers are added (so callers that need
    // layer ids — wirePopups, fitToData — can wait for it).
    return Promise.all(layers.map(function (L) {
      if (L.type === "raster" || !L.source) return Promise.resolve();
      // One unreachable layer file must not take the atlas down — skip that
      // layer and say so in the console (silently empty layers are worse to
      // debug than a named miss).
      return fetch(layerUrl(L))
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (d) { DATA[L.id] = d; numberRows(L, d); })
        .catch(function (e) {
          L._missing = true;
          console.warn("Atlas: layer “" + L.id + "” couldn't load its data (" + L.source + "): " + e.message);
        });
    })).then(function () {
      layers.forEach(function (L) {
        if (L.type === "fill") addFill(L);
        else if (L.type === "line") addLine(L);
        else if (L.type === "circle") addCircle(L);
        else if (L.type === "categories") addCategories(L);
        else if (L.type === "image") addImage(L);
        else if (L.type === "raster") addRaster(L);
        else if (L.type === "marker") addMarker(L);
        else if (L.type === "pmtiles") addPmtiles(L);
      });
    });
  }
  function on(L) { return L.default !== false; }
  function vis(L) { return on(L) ? "visible" : "none"; }
  function srcId(L) { return "src-" + L.id; }

  // Vector tiles read straight from a remote PMTiles archive over HTTP range
  // requests (e.g. the global Protomaps OpenStreetMap build) — no data is stored
  // per instance. Layers sharing one archive URL share one vector source.
  var pmSources = {};
  function ensurePmtilesProtocol() {
    if (window._lokaPmReg) return true;
    if (!window.pmtiles || !window.maplibregl || !maplibregl.addProtocol) return false;
    maplibregl.addProtocol("pmtiles", new pmtiles.Protocol().tile);
    window._lokaPmReg = true;
    return true;
  }
  function addPmtiles(L) {
    L._ids = [];
    if (!ensurePmtilesProtocol()) return; // pmtiles lib missing — skip gracefully
    var url = L.pmtiles;
    var sid = pmSources[url];
    if (!sid) {
      sid = "pmsrc-" + Object.keys(pmSources).length;
      pmSources[url] = sid;
      map.addSource(sid, { type: "vector", url: "pmtiles://" + url, attribution: L.attribution || "" });
    }
    var lid = L.id + "-pm";
    var def = { id: lid, source: sid, "source-layer": L.sourceLayer, type: L.render || "fill",
                layout: { visibility: vis(L) }, paint: L.paint || {} };
    if (L.minzoom != null) def.minzoom = L.minzoom;
    map.addLayer(def);
    L._ids = [lid];
    refreshLegend(L);
  }

  function addGeoSource(L, done) {
    var gj = DATA[L.id];
    if (!gj) return;
    if (!map.getSource(srcId(L))) map.addSource(srcId(L), { type: "geojson", data: gj, generateId: true });
    done && done(gj);
  }

  // Apply an optional MapLibre filter so two layers can render subsets of one source
  // (e.g. reserved vs protected forests off the same forests.geojson).
  function withFilter(L, spec) { if (L.filter) spec.filter = L.filter; return spec; }

  function addFill(L) {
    L._ids = [];
    addGeoSource(L, function () {
      var p = L.paint || {};
      map.addLayer(withFilter(L, {
        id: L.id + "-fill", type: "fill", source: srcId(L),
        layout: { visibility: vis(L) },
        paint: { "fill-color": p.fillColor || "#888", "fill-opacity": p.fillOpacity != null ? p.fillOpacity : 0.4 }
      }));
      L._ids.push(L.id + "-fill");
      if (p.outlineColor || p.outlineWidth) {
        var lp = { "line-color": p.outlineColor || "#fff", "line-width": p.outlineWidth || 1 };
        if (p.outlineOpacity != null) lp["line-opacity"] = p.outlineOpacity;
        if (p.outlineDash) lp["line-dasharray"] = p.outlineDash;
        map.addLayer(withFilter(L, { id: L.id + "-line", type: "line", source: srcId(L), layout: { visibility: vis(L) }, paint: lp }));
        L._ids.push(L.id + "-line");
      }
      addHighlight(L);
      /* A contributed area layer wears the same mark as a pin layer — see ONE
         MARK FOR EVERY PLACE. Its names are then the pins' names, drawn by the
         map at the mark, so the area label layer is not added on top. */
      if (areaPins(L)) { addAreaMarkers(L); return; }
      addCentreMarks(L);
      addLabel(L);
    });
  }

  /* ==================================================================
     ONE MARK FOR EVERY PLACE

     Every row in a contributed file is a place where somebody or something
     is, and every one of them wears the same teardrop marker: a name beside
     it, the same card on a tap, the key's marks beside it, folded into a
     counted disc when crowded, hidden by a search that does not match it.
     An area is a place that also says how far it reaches: its shading and
     outline stay drawn, always, under its marker. A pin says "here, at this
     spot"; the shading under an area's marker says "across all of this".

     Before this the two were two pipelines. Areas drew a small round dot at
     each centre (4d8892b) that the map's tap handler never registered, so a
     shape too small to draw had a dot that did nothing when tapped; areas
     could not wear keys, never folded, and twelve people across the same
     three districts were twelve dots on top of one another. Now the area's
     marker is built by the same code as a pin's, and registered in the same
     list (markersByLayer), so everything written for pins serves areas too.

     The marker stands at the shape's pole of inaccessibility — the point
     furthest from any edge — not its centre of mass, so a crescent's marker
     is on the crescent and a ring's is on the ring. Only contributed layers
     get markers; the base map's districts, forests and rivers never do.
  ================================================================== */
  function areaPins(L) {
    return !!(L && L.userLayer && L.centreMarks && (L.type === "fill" || L.type === "polygon"));
  }
  // whether a layer's places stand as markers right now (pins, or areas' marks)
  function hasPins(L) { return !!(L && markersByLayer[L.id]); }

  function addAreaMarkers(L) {
    markersByLayer[L.id] = [];
    var gj = DATA[L.id];
    if (!gj) return;
    gj.features.forEach(function (f) {
      var at = poleOfInaccessibility(f.geometry) || labelAnchorPoint(f.geometry);
      if (!at) return;
      /* The marker's own feature is a point at the pole, sharing the shape's
         properties and row number, so every piece of pin code (names, search,
         folding, selection, the card) reads it as a pin. The shape itself
         stays on the entry for the fit and the outline's ring. */
      var shadow = { type: "Feature", geometry: { type: "Point", coordinates: at }, properties: f.properties, _row: f._row, _twins: f._twins };
      makePinEntry(L, shadow, f);
    });
    ensurePinNames(L);
    applyMarkerVisibility(L);
    initLayerKeys(L);
  }

  /* The pole of inaccessibility: the point inside a polygon furthest from its
     edges (Garcia-Castellanos & Lombardo; the "polylabel" method). The centre
     of mass of a crescent lies outside it, and a marker outside its own area
     says the wrong thing. A grid of cells is refined where a better point
     could still be, down to a precision of about a hundredth of the shape's
     size. For a MultiPolygon the largest part is taken. */
  function poleOfInaccessibility(geom) {
    if (!geom) return null;
    var polygon = null;
    if (geom.type === "Polygon") polygon = geom.coordinates;
    else if (geom.type === "MultiPolygon") {
      var bestA = -1;
      geom.coordinates.forEach(function (p) { var a = ringArea(p[0]); if (a > bestA) { bestA = a; polygon = p; } });
    } else return null;
    if (!polygon || !polygon[0] || polygon[0].length < 3) return null;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    polygon[0].forEach(function (c) { if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0]; if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1]; });
    var w = x1 - x0, h = y1 - y0, size = Math.min(w, h);
    if (!(size > 0)) return [x0, y0];
    var precision = size / 100;
    var cellSize = size, half = cellSize / 2;
    function segDist(px, py, a, b) {
      var x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
      if (dx !== 0 || dy !== 0) {
        var t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
      }
      dx = px - x; dy = py - y;
      return dx * dx + dy * dy;
    }
    // signed distance from the point to the polygon's edges: inside positive
    function pointToPolygonDist(px, py) {
      var inside = false, minSq = Infinity;
      polygon.forEach(function (ring) {
        for (var i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
          var a = ring[i], b = ring[j];
          if ((a[1] > py) !== (b[1] > py) && px < (b[0] - a[0]) * (py - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
          var d = segDist(px, py, a, b);
          if (d < minSq) minSq = d;
        }
      });
      return (inside ? 1 : -1) * Math.sqrt(minSq);
    }
    function cell(cx, cy, hh) {
      var d = pointToPolygonDist(cx, cy);
      return { x: cx, y: cy, h: hh, d: d, max: d + hh * Math.SQRT2 };
    }
    var queue = [];
    for (var x = x0; x < x1; x += cellSize) for (var y = y0; y < y1; y += cellSize) queue.push(cell(x + half, y + half, half));
    // the centre of mass is a fair first guess, and a point in the box's middle another
    var c = labelAnchorPoint(geom);
    var best = c ? cell(c[0], c[1], 0) : cell(x0 + w / 2, y0 + h / 2, 0);
    var mid = cell(x0 + w / 2, y0 + h / 2, 0);
    if (mid.d > best.d) best = mid;
    var guard = 0;
    while (queue.length && guard++ < 20000) {
      // the most promising cell first
      var bi = 0;
      for (var i = 1; i < queue.length; i++) if (queue[i].max > queue[bi].max) bi = i;
      var q = queue[bi]; queue[bi] = queue[queue.length - 1]; queue.pop();
      if (q.d > best.d) best = q;
      if (q.max - best.d <= precision) continue;
      var hq = q.h / 2;
      queue.push(cell(q.x - hq, q.y - hq, hq));
      queue.push(cell(q.x + hq, q.y - hq, hq));
      queue.push(cell(q.x - hq, q.y + hq, hq));
      queue.push(cell(q.x + hq, q.y + hq, hq));
    }
    return best.d >= 0 ? [best.x, best.y] : (c || null);
  }
  function ringArea(ring) {
    if (!ring || ring.length < 3) return 0;
    var a = 0;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    return Math.abs(a / 2);
  }

  /* A dot at the middle of every shape.

     A shape is only findable if it is big enough to see, and on a map of a
     whole country most are not. Measured on the multispecies atlas at the view
     it opens on: a neighbourhood in Bengaluru came out 0 by 0 pixels and a
     tiger reserve 6 by 10, so two of the eleven people on that map were simply
     not on it. The nine that were showed as unnamed green blobs.

     Pins instead of shapes is not the answer either — a pin in the middle of
     the Western Ghats says the person works at a point, which is the opposite
     of true. So both: the shape for the extent, a dot for the fact that
     somebody is there.

     The dot never yields. Text can be dropped when the map is crowded and
     nothing is lost but a name you can click for; a dropped dot loses the
     person. It rides on the same anchor points the labels use, so a dot and
     its name always agree about where they are.

     Superseded for contributed layers by ONE MARK FOR EVERY PLACE: their
     shapes wear the teardrop marker instead (addAreaMarkers). This dot is
     kept only for a curated layer that asks for centreMarks in its manifest
     — none does today. */
  function addCentreMarks(L) {
    if (!L.centreMarks) return;
    var sid = labelPointSource(L);
    if (!sid) return;
    var p = L.paint || {};
    var fill = p.fillColor || "#40573D";
    map.addLayer(withFilter(L, {
      id: L.id + "-mark", type: "circle", source: sid,
      layout: { visibility: vis(L) },
      paint: {
        // Small enough not to hide a small shape, big enough to aim at.
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3.4, 8, 5, 14, 6.5],
        "circle-color": fill,
        "circle-opacity": 1,
        // A ring, so the dot reads on its own shading and on the ground alike.
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 3, 1.2, 14, 2],
        "circle-stroke-opacity": 0.95
      }
    }));
    L._ids.push(L.id + "-mark");
  }

  // Feature-state driven outline: invisible until a feature is hovered (a thin
  // ink line) or selected (the Sindoor ring, persisting while the map pans).
  // Only for clickable layers. The selected ring is two lines: a 2px Sindoor
  // ring and a faint 1px ring just outside it, drawn by a second layer with a
  // gap the width of the first — "this one, here", and nothing else changes.
  function addHighlight(L) {
    if (!L.popup || !map.getSource(srcId(L))) return;
    var SEL = ["boolean", ["feature-state", "selected"], false];
    var HOV = ["boolean", ["feature-state", "hover"], false];
    map.addLayer(withFilter(L, {
      id: L.id + "-hl-ring", type: "line", source: srcId(L), layout: { visibility: vis(L) },
      paint: {
        "line-color": "#C9402B",
        "line-width": ["case", SEL, 1, 0],
        "line-gap-width": ["case", SEL, 2.4, 0],
        "line-opacity": ["case", SEL, 0.45, 0]
      }
    }));
    L._ids.push(L.id + "-hl-ring");
    map.addLayer(withFilter(L, {
      id: L.id + "-hl", type: "line", source: srcId(L), layout: { visibility: vis(L) },
      paint: {
        "line-color": ["case", SEL, "#C9402B", "#26231F"],
        "line-width": ["case", SEL, 2.4, HOV, 1.8, 0],
        "line-opacity": ["case", SEL, 1, HOV, 0.9, 0]
      }
    }));
    L._ids.push(L.id + "-hl");
  }

  function addLine(L) {
    L._ids = [];
    addGeoSource(L, function () {
      var p = L.paint || {};
      var lp = { "line-color": p.color || "#38bdf8", "line-width": p.width || 1.2, "line-opacity": p.opacity != null ? p.opacity : 1 };
      if (p.dash) lp["line-dasharray"] = p.dash;
      map.addLayer({ id: L.id + "-line", type: "line", source: srcId(L), layout: { visibility: vis(L), "line-cap": "round", "line-join": "round" }, paint: lp });
      L._ids.push(L.id + "-line");
      addLabel(L);
    });
  }

  function addCircle(L) {
    L._ids = [];
    addGeoSource(L, function () {
      var p = L.paint || {};
      map.addLayer({
        id: L.id + "-circle", type: "circle", source: srcId(L), layout: { visibility: vis(L) },
        paint: {
          "circle-radius": p.radius || 5, "circle-color": p.color || "#C9402B",
          "circle-stroke-color": p.strokeColor || "#F5F1E6", "circle-stroke-width": p.strokeWidth != null ? p.strokeWidth : 1.2,
          "circle-opacity": p.opacity != null ? p.opacity : 1
        }
      });
      L._ids.push(L.id + "-circle");
      addLabel(L);
    });
  }

  /* A polygon's name must be written ONCE. Symbols hang per tile, so a
     district spanning three tiles wrote "Bengaluru Urban" three times (and
     alwaysShow kept every copy). The fix is one point per feature — an
     area-weighted centre of its largest ring — on a source of its own, so
     the map says each name exactly once at any zoom. Lines keep the tiled
     source: their labels follow the line itself. */
  function labelAnchorPoint(geom) {
    if (!geom) return null;
    if (geom.type === "Point") return geom.coordinates;
    if (geom.type === "MultiPoint") return geom.coordinates[0] || null;
    var rings = [];
    if (geom.type === "Polygon") rings = [geom.coordinates[0]];
    else if (geom.type === "MultiPolygon") rings = geom.coordinates.map(function (p) { return p[0]; });
    else return null;
    var best = null, bestA = -1;
    rings.forEach(function (ring) {
      if (!ring || ring.length < 3) return;
      var a = 0, cx = 0, cy = 0;
      for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        var cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
        a += cross;
        cx += (ring[j][0] + ring[i][0]) * cross;
        cy += (ring[j][1] + ring[i][1]) * cross;
      }
      if (!a) return;
      var area = Math.abs(a / 2);
      if (area > bestA) { bestA = area; best = [cx / (3 * a), cy / (3 * a)]; }
    });
    return best;
  }
  function boxArea(g) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    (function walk(c) {
      if (typeof c[0] === "number") { if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0]; if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1]; return; }
      for (var i = 0; i < c.length; i++) walk(c[i]);
    })((g && g.coordinates) || []);
    return x1 > x0 ? (x1 - x0) * (y1 - y0) : 0;
  }

  function labelPointSource(L) {
    var gj = DATA[L.id];
    if (!gj || !gj.features) return null;
    var pts = [];
    var t = L.label_text || {};
    gj.features.forEach(function (f) {
      var p = labelAnchorPoint(f.geometry);
      if (!p) return;
      var props = f.properties;
      // how much ground the shape covers (its box, in square degrees), so a
      // layer that asks for it can let the big names win a crowded map
      if (t.biggestFirst) { props = {}; for (var k in f.properties) props[k] = f.properties[k]; props._lblsize = boxArea(f.geometry); }
      /* Twins (see findTwins) share one anchor, and the map writes one name
         there — whichever wins the collision. So each twin's label carries
         BOTH names, "Gijs Spoor & Vijay Ramesh", and whichever survives says
         the whole truth. The dot is still one per row, on the same spot. */
      if (f._twins && t.property) {
        if (props === f.properties) { props = {}; for (var k2 in f.properties) props[k2] = f.properties[k2]; }
        props[t.property] = joinNames(f._twins.map(function (r) { return popupTitleText(L, gj.features[r].properties) || gj.features[r].properties[t.property]; }));
      }
      pts.push({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: p } });
    });
    if (!pts.length) return null;
    var sid = srcId(L) + "-lblpt";
    if (!map.getSource(sid)) map.addSource(sid, { type: "geojson", data: { type: "FeatureCollection", features: pts } });
    return sid;
  }

  function addLabel(L) {
    var t = L.label_text;
    if (!t) return;
    var source = srcId(L);
    if (L.type !== "line") source = labelPointSource(L) || source;
    /* An area's name is set like a district on a printed map — uppercase,
       tracked, in the bold — and a place's or a line's name is plain. Every
       label wears Ink with the Ground halo unless the atlas says otherwise.
       (The map's glyphs are Noto Sans, the nearest the tile server has to the
       page's Karla; a web font cannot be drawn on the map.) */
    var area = L.type === "polygon" || L.type === "fill";
    var layout = {
      visibility: vis(L),
      "text-field": ["coalesce", ["get", t.property], ""],
      "text-size": t.size || 12,
      "text-font": [area ? GLYPH_FONTS.bold : GLYPH_FONTS.regular],
      "symbol-placement": L.type === "line" ? "line" : "point",
      "text-allow-overlap": !!t.alwaysShow,
      "text-ignore-placement": !!t.alwaysShow,
      "text-optional": !t.alwaysShow
    };
    if (t.transform) layout["text-transform"] = t.transform;
    else if (area) layout["text-transform"] = "uppercase";
    if (t.letterSpacing) layout["text-letter-spacing"] = t.letterSpacing;
    else if (area) layout["text-letter-spacing"] = 0.2;
    /* Nudged off the anchor, for a layer that also draws a dot there. Without
       this the name sits on top of its own dot and neither can be read. The
       offset is in multiples of the text size, so it holds as the text grows. */
    if (t.offset) { layout["text-offset"] = t.offset; layout["text-anchor"] = t.anchor || "top"; }
    /* Where names compete for room, the biggest place keeps its name: a map
       of India should say "Western Ghats" before it says every sanctuary
       inside it. MapLibre places the lowest sort key first. */
    if (t.biggestFirst) layout["symbol-sort-key"] = ["-", 0, ["coalesce", ["get", "_lblsize"], 0]];
    if (t.minzoom == null) {} else layout["text-size"] = ["interpolate", ["linear"], ["zoom"], (t.minzoom - 0.5), 0, t.minzoom, t.size || 12];
    var paint = {
      "text-color": t.color || "#24211D",
      "text-halo-color": t.haloColor || "#F5F1E6",
      "text-halo-width": t.haloWidth || 2.2
    };
    map.addLayer(withFilter(L, { id: L.id + "-label", type: "symbol", source: source, layout: layout, paint: paint }));
    L._ids.push(L.id + "-label");
  }

  function addImage(L) {
    var meta = DATA[L.id];
    if (!meta) return;
    L._imageMeta = meta;
    map.addSource(srcId(L), { type: "image", url: dataUrl(meta.image), coordinates: meta.coordinates });
    /* Drawn crisp, not smoothed.

       These overlays are one picture stretched over the whole region, and they
       are banded: forest cover is three classes, elevation is five. Their
       pixels are the data. Smoothing between them — which is what a raster
       layer does by default when you zoom past its resolution — blends bands
       that mean different things into colours that mean nothing, and the map
       looks broken rather than coarse.

       The forest picture is 2042 pixels across 55 kilometres: about 27 metres
       to a pixel, which is the resolution of the source (Hansen/UMD at 30 m).
       Nothing can make it sharper, because the detail was never recorded. Drawn
       crisp it reads as what it is — thirty-metre data, honestly blocky —
       instead of a smear that looks like a rendering fault. */
    map.addLayer({ id: L.id + "-img", type: "raster", source: srcId(L), layout: { visibility: vis(L) }, paint: { "raster-opacity": L.opacity != null ? L.opacity : 0.8, "raster-fade-duration": 0, "raster-resampling": "nearest" } });
    L._ids = [L.id + "-img"];
    if (L.legendFrom === "source" && meta.legend) L._legend = meta.legend.map(function (c) { return { color: c.color, label: c.label + (c.pct != null ? " · " + c.pct + "%" : "") }; });
    refreshLegend(L);
  }

  function addRaster(L) {
    L._ids = [];
    L._idBasemap = {};
    if (L.tilesByBasemap) {
      // One logical layer, different tiles per basemap (e.g. "Place names":
      // CARTO labels on the map basemap, Esri labels on satellite).
      Object.keys(L.tilesByBasemap).forEach(function (bm) {
        var id = L.id + "-raster-" + bm;
        var credit = (L.attributionByBasemap && L.attributionByBasemap[bm] != null)
          ? L.attributionByBasemap[bm] : (L.attribution || "");
        map.addSource(srcId(L) + "-" + bm, { type: "raster", tiles: L.tilesByBasemap[bm], tileSize: L.tileSize || 256, attribution: credit });
        map.addLayer({
          id: id, type: "raster", source: srcId(L) + "-" + bm,
          layout: { visibility: on(L) && bm === activeBasemap ? "visible" : "none" },
          paint: { "raster-opacity": L.opacity != null ? L.opacity : 1 }
        });
        L._ids.push(id);
        L._idBasemap[id] = bm;
      });
      return;
    }
    map.addSource(srcId(L), { type: "raster", tiles: L.tiles, tileSize: L.tileSize || 256, attribution: L.attribution || "" });
    var show = on(L) && (!L.onlyWithBasemap || L.onlyWithBasemap === activeBasemap);
    map.addLayer({ id: L.id + "-raster", type: "raster", source: srcId(L), layout: { visibility: show ? "visible" : "none" }, paint: { "raster-opacity": L.opacity != null ? L.opacity : 1 } });
    L._ids = [L.id + "-raster"];
    if (L.onlyWithBasemap) L._idBasemap[L.id + "-raster"] = L.onlyWithBasemap;
  }

  /* ---- categories (crop distribution) ---- */
  function addCategories(L) {
    L._ids = [];
    cropState[L.id] = L.defaultMode || "diversity";
    addGeoSource(L, function () {
      map.addLayer({
        id: L.id + "-fill", type: "fill", source: srcId(L),
        layout: { visibility: vis(L) },
        paint: { "fill-color": "#888", "fill-opacity": 0.4, "fill-outline-color": "rgba(0,0,0,0)" }
      });
      L._ids.push(L.id + "-fill");
      addHighlight(L);
      applyCategoryPaint(L);
    });
  }

  function applyCategoryPaint(L) {
    var mode = cropState[L.id], id = L.id + "-fill";
    if (!map.getLayer(id)) return;
    if (mode === "diversity") {
      var d = L.diversity, ramp = d.ramp, stops = ["step", ["get", L.countProperty], ramp[0]];
      for (var i = 1; i < ramp.length; i++) stops.push(i + 1, ramp[i]);
      map.setPaintProperty(id, "fill-color", stops);
      map.setPaintProperty(id, "fill-opacity", 0.6);
    } else {
      var cat = L.categories.find(function (c) { return c.name === mode; });
      var color = cat ? cat.color : "#888";
      var has = ["in", mode, ["get", L.arrayProperty]];
      map.setPaintProperty(id, "fill-color", ["case", has, color, "#5b6b5b"]);
      map.setPaintProperty(id, "fill-opacity", ["case", has, 0.72, 0.06]);
    }
    refreshLegend(L);
  }

  function categoryLegend(L) {
    // The panel is built before the layer's data lands — deliberately, so the
    // controls never wait on a tile fetch — which means this can run before
    // cropState has been given its opening value. Reading it raw printed
    // "Grows undefined" on the live map: a developer's word, in the key, where
    // a crop's name belongs. Fall back to the same default the layer sets.
    var mode = cropState[L.id] || L.defaultMode || "diversity";
    if (mode === "diversity") {
      var r = L.diversity.ramp;
      return { ramp: r, min: "1", max: r.length + "+", unit: "crops / block" };
    }
    var cat = L.categories.find(function (c) { return c.name === mode; });
    return [{ color: cat ? cat.color : "#888", label: "Grows " + mode }, { color: "#5b6b5b", label: "Not grown", faint: true }];
  }

  // compact hover tooltip: the feature's crops as chips coloured to match the legend
  function catTooltipHTML(L, props) {
    var raw = props[L.arrayProperty];
    var crops = Array.isArray(raw) ? raw : safeArr(raw);
    if (!crops || !crops.length) return "";
    var colorOf = {};
    (L.categories || []).forEach(function (c) { colorOf[c.name] = c.color; });
    var name = (L.nameProperty && props[L.nameProperty]) ? esc(props[L.nameProperty]) : "";
    var chips = crops.map(function (cr) {
      return '<span class="tt-crop" style="--c:' + (colorOf[cr] || "#8a8f7a") + '">' + esc(cr) + "</span>";
    }).join("");
    return (name ? '<div class="tt-name">' + name + "</div>" : "") + '<div class="tt-crops">' + chips + "</div>";
  }

  /* ---- markers (DOM) ---- */
  function addMarker(L) {
    markersByLayer[L.id] = [];
    var gj = DATA[L.id];
    if (!gj) return;
    var pts = [];
    gj.features.forEach(function (f) {
      makePinEntry(L, f, null);
      pts.push(f.geometry.coordinates);
    });
    L._pts = pts;
    if (L.cluster && pts.length) setupCluster(L);
    ensurePinNames(L);
    applyMarkerVisibility(L);
    initLayerKeys(L);
  }

  /* One marker on the map for one row of a contributed layer — a pin's row,
     or an area's (then `shape` is the area itself and `f` a point at its
     pole; see ONE MARK FOR EVERY PLACE). The entry it registers is what every
     later piece of pin code reads: { mk, f, shape, color, node }. */
  function makePinEntry(L, f, shape) {
    var cfg = (L.markers && L.markers[f.properties[L.markerBy]]) || L.markerDefault || L.marker || {};
    var wrap = el("div", "atlas-marker");
    // pin + label live in an inner node: MapLibre owns the wrap's transform
    // (true position), the node alone takes the spiderfy displacement — see
    // the SPIDERFY section below.
    var node = el("div", "atlas-mnode");
    /* Every place now wears the standard location marker. `ring` and `glyph`
       stop being read: a ring said which upload a place came from, which the
       popup's Source row now says in words, and no contributed layer ever
       declared a glyph. A declared icon still goes in the pin's head. */
    /* A colour survives only where it tells two kinds apart. Deoria's sugar
       mills and distilleries do that, so they keep sienna and moss; its survey
       villages are all one kind, so their rust said nothing and they join every
       other place at the one standard colour. */
    var perKind = !!(L.markers && L.markerBy);
    var pin = locPinEl((perKind && cfg.color) ? cfg.color : PIN_ONE, cfg.icon, perKind ? cfg.shape : null);
    // Explicit icons and glyphs are an atlas's own bespoke styling (deoria's
    // factory and flask) and stay exactly as declared. The DERIVED icon —
    // guessed from a kind's words on contributed layers — is retired: those
    // pins carry nothing inside, and the keys a layer can wear are drawn
    // beside the pin instead (see KEYS WEAR ROWS below).
    node.appendChild(pin);
    // a pin's name is drawn by the map, not the marker — see PIN NAMES
    wrap.appendChild(node);
    var mk = new maplibregl.Marker({ element: wrap, anchor: "bottom" }).setLngLat(f.geometry.coordinates).addTo(map);
    // keep the feature alongside its marker so search can gate it by content;
    // node is kept so a key change can redraw the marks without touching the
    // marker element MapLibre owns (or any wiring on it)
    var entry = { mk: mk, f: f, shape: shape || null, color: cfg.color || "", node: node };
    // clicks route through the spiderfy gate: a fanned pin opens its own
    // popup, any other visible pin is a loner by construction and pops up
    wrap.addEventListener("click", function (e) { e.stopPropagation(); spiderClick(L, entry); });
    // A pin must be reachable without a pointer. The inner node is the
    // button (the wrap belongs to MapLibre); a hidden or folded pin is
    // display:none, so the tab order only ever holds what's visible.
    node.setAttribute("role", "button");
    node.tabIndex = 0;
    var pinName = popupTitleText(L, f.properties);
    node.setAttribute("aria-label", pinName || (L.label || "place") + " — details");
    node.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      spiderClick(L, entry);
    });
    // hovering names the pin without a click (see HOVER TOOLTIP), and when
    // keys are on it also says what this place is under each of them
    wireMarkerHint(node, function () { return popupTitleText(L, f.properties); },
      function () { return keyRowsEl(L, f.properties); });
    markersByLayer[L.id].push(entry);
    return entry;
  }

  /* ==================================================================
     KEYS WEAR ROWS — a contributed marker layer can be coloured by
     several of its columns at once. The pin itself never says any of
     it: it is always the plain neutral 20px circle — white body, thin
     border in the layer's one colour — meaning only "a place is here",
     and the map opens with no key switched on. Each switched-on key
     draws ONE ROW of small marks beside the pin, in that key's own
     shape — the first key circles, the second squares, then triangles,
     diamonds, bars — and within a row there is one mark for EVERY
     answer the place holds: a place that is Culture and Nature wears
     two circles, side by side. The corner-mark design this replaces
     showed only the first answer per key, which silently dropped a
     category on 49 of the 66 Bengaluru places; the rows show all of
     it, and at two keys they hold that design's density (grown
     neighbourhood at z16: 14 readable against its 13 — measured in
     the approved mock, atlas/rows-mock.html).

     Rows sit to the RIGHT of the pin, stacked in key order and
     centred on the pin's middle; a pin near the map's right edge
     flips its block to the left (updateRowFlips). A place missing an
     answer under a key simply lacks that row — the shapes mean a
     missing row misleads nobody, and the hover bubble still says
     "left blank" in words. Mark sizes are ink-matched — each carries
     the colour area of a 12px dot (circle 12, square 10.6, triangle
     16.2, diamond 15.1, bar 15.1×7.55) — because below that much ink
     the muted palette stops being nameable. Marks sit 2px apart, rows
     2px apart, each mark rimmed 1.4px white.

     Colour tells the kinds apart WITHIN a key, off the same eight
     colours the committed layer already uses (see KEY_COLORS above —
     eight distinct colours is the honest ceiling on this basemap).
     Colours repeat freely BETWEEN keys; the SHAPE says which key a
     row belongs to, and the key panel states that cost in words. A
     place that answers several keys still counts ONCE in the cluster
     arithmetic: all its rows live inside its one marker element, and
     the fold distance follows the marker's true footprint — see
     keyedFoldRadius.

     Which columns may be a key — name-blind, by counting alone: a
     column qualifies when a small number of kinds covers essentially
     all the places, whatever the column is called. Single-answer
     columns: 2–9 kinds; list columns ("Culture; Heritage"): at most
     12 first-tags; and the top eight kinds must cover at least 60% of
     the places. Every kept kind must also read as a word — a column
     of shared links or id-strings is not a set of readable kinds,
     however few of them there are. The column NAME is never judged
     (that gate stays for search only): a `batch_id` column holding
     "first walk" / "second walk" is a key; an `address` column of 54
     one-off strings is not. Measured on the Bengaluru layer:
     categories' top-8 covers 63 of 66 (a key); labels' top-8 covers
     12 of 66 (a caption, never a key).
  ================================================================== */
  function prettyCol(name) {
    /* A key list holding "categories", "creator" and "What is this place for?"
       is two grammars in one column. A column's own name cannot be made into a
       question, but it can at least start like a sentence.

       How it reads is one rule, shared with the server (label-rules.js). It
       used to be decided here, by lowercasing everything after the first
       letter — which turned "What languages do you primarily work in? Feel
       free to mention all" into "…work in? feel free…". A heading keeps its
       own capitals now; only a slug (created_at) is opened out. */
    return LokaLabelRules.headingCase(name);
  }

  /* What to print for a column heading, and what it is short for.

     A heading can be a whole survey question, and the drawer is 320 pixels
     wide. label-rules.js decides the short name (a name the owner gave wins,
     then the one the server stored on the layer, then its own plain cut); this
     answers { text, full, shortened } and everything that prints a heading as
     a label — the key list, the legend, a card's field names — prints text
     and, when it was shortened, keeps full one hover or one ⓘ away. */
  function colLabel(L, col) { return LokaLabelRules.labelFor(col, L || {}); }

  /* The small ⓘ after a shortened label: a real button, so a phone (no hover)
     and a keyboard can reach the whole heading. It opens the heading under
     the label; pressing again puts it away. Built as HTML because a card's
     contents are serialised on the way in and a listener wired here would be
     lost — one delegated listener (below) works every ⓘ on the page. The
     aria-label carries the whole heading, so a screen reader hears it without
     pressing anything. */
  var LBL_INFO_N = 0;
  function labelInfoHTML(full) {
    var id = "lbl-full-" + (++LBL_INFO_N);
    return '<button type="button" class="lbl-info" aria-expanded="false" aria-controls="' + id +
      '" aria-label="' + esc(full) + '" title="' + esc(full) + '">' + ICONS.info + "</button>" +
      '<span class="lbl-full" id="' + id + '" hidden>' + esc(full) + "</span>";
  }
  /* The same two pieces as elements, for the key list, where the ⓘ sits on
     the row and the heading opens UNDER it — as a layer's own note does. */
  function labelInfo(full) {
    var box = el("span", "lbl-wrap");
    box.innerHTML = labelInfoHTML(full);
    return { btn: box.firstChild, full: box.lastChild };
  }
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest && e.target.closest(".lbl-info[aria-controls]");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();   // inside a key's label: the switch must not flip
    var full = document.getElementById(b.getAttribute("aria-controls"));
    if (!full) return;
    var show = full.hidden;
    full.hidden = !show;
    b.setAttribute("aria-expanded", String(show));
  }, true);
  // the plain name of a date column that is really the app's own bookkeeping
  function dateKeyName(col) {
    var t = String(col).replace(/[_-]+/g, " ").trim().toLowerCase();
    if (/^(created|added|tagged)( at| on| date)?$/.test(t)) return "When it was added";
    if (/^(updated|modified|edited|changed)( at| on| date)?$/.test(t)) return "When it was last changed";
    return prettyCol(col);
  }

  // Layers contributed through the wizard may offer their qualifying columns
  // as keys — pins, and areas now that they wear the same marker (the colour
  // goes on the marker, never on the fill). Curated layers (Deoria's pins)
  // never enter here.
  function initLayerKeys(L) {
    if (!L.userLayer || !hasPins(L) || L._keyOptions) return;
    var gj = DATA[L.id];
    if (!gj || !gj.features || !gj.features.length) return;
    var opts = computeKeyOptions(L, gj.features);
    if (!opts.length) return;
    var committedOpt = null;
    opts.forEach(function (o) { if (o.committed) committedOpt = o; });
    // a layer whose committed colouring we cannot mirror is left untouched
    if (L.markerBy && !committedOpt) return;
    L._keyOptions = opts;
    // the map opens with nothing switched on: every pin the plain neutral
    // circle, the panel saying only the layer's name — the reader turns
    // keys on, and the committed colouring is simply the first key offered
    keyState[L.id] = { active: [], note: null };
    (markersByLayer[L.id] || []).forEach(function (e) { renderMarks(L, e, []); });
    L._legend = keyLegendRows(L, []);
    wireRowFlips();
    renderExtra(L);   // the switches exist only once the data has said which columns qualify
  }

/* A column of dates.

   Deliberately tight: an ISO-ish date and nothing else. A looser test would
   swallow a house number or "2/3", and a column wrongly called a date would
   lose its own values to bucketing. Nearly all of them have to match, not all —
   real data has a stray. */
  var DATEY = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[T ].*)?$/;
  function looksLikeDates(vals) {
    var seen = 0, hit = 0;
    for (var i = 0; i < vals.length; i++) {
      var v = String(vals[i] || "").trim();
      if (!v) continue;
      seen++;
      if (DATEY.test(v)) hit++;
    }
    return seen >= 3 && hit >= seen * 0.9;
  }

  var MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  /* A date read as a word, because a key's kinds have to read as words: the
     value guard rejects anything with no letters in it, so "2026-03" would take
     the whole key down with it. "March 2026" survives, and is what a person
     would have written anyway. */
  function dateBucket(v, grain) {
    var m = DATEY.exec(String(v || "").trim());
    if (!m) return null;
    var mon = MONTHS[Number(m[2]) - 1] || m[2];
    if (grain === "year") return m[1];
    if (grain === "month") return mon + " " + m[1];
    return m[3] ? Number(m[3]) + " " + mon + " " + m[1] : mon + " " + m[1];
  }

  /* Nineteen dates is not a key — it is nineteen colours. Grouped by month it is
     seven, which is a key. So the grain is chosen rather than fixed: the finest
     one that fits under the cap, because a day tells you more than a month and a
     month more than a year, and an event that happened in one afternoon wants
     the day. Measured on the Bengaluru layer: by day 19 buckets, by month 7, by
     year 2 — so month. */
  function dateGrain(vals, cap) {
    var grains = ["day", "month", "year"];
    for (var i = 0; i < grains.length; i++) {
      var seen = {}, n = 0;
      for (var j = 0; j < vals.length; j++) {
        var b = dateBucket(vals[j], grains[i]);
        if (b && !seen[b]) { seen[b] = 1; n++; }
      }
      if (n >= 2 && n <= cap) return grains[i];
    }
    return null;
  }

  /* How lopsided a key may be before it stops being one.

     A key exists to tell places apart. When nine in ten wear the same mark it
     tells a reader nothing, and it costs them a switch and a legend to find
     that out. Measured on the live Bengaluru layer: "Creator" is offered today
     and 89% of its places say "LOKA Finds".

     Not applied to a question, whose spread is the honest answer to something
     asked of these places, nor to the marker column an owner committed to —
     both are somebody's decision rather than an accident of a column. */
  var KEY_DOMINANCE = 0.85;
  var QUESTION_MIN_REACH = 0.30;   // a discovered question must speak for 30% of places to be a key
  /* Reach and shape are two different things, and a question can be fine on one
     and useless on the other. Measured on one live map: two questions reached
     the same 42 of 66 places, and one split them 20/7/7/4/4 while the other
     painted 25 of them a single colour. The first is a good key about two thirds
     of a map. The second teaches a reader nothing they could not already see,
     and costs them a click to find that out.

     The test is that ONE ANSWER OUTWEIGHS ALL THE OTHERS PUT TOGETHER, and there
     are at least three answers for that to mean anything. A share would have
     been easier to write and wrong: at six-tenths, the question that started
     this — 25 of 42 — sits at 59.5% and slips under, while a plain yes/no
     splitting 55 to 45 is a perfectly good key and would be caught. Weighing
     the commonest against the rest handles both, and it is the same sentence a
     reader is shown, so the rule and the wording cannot drift apart.

     A question that fails it is still offered. It is honest, and somebody may
     want exactly the thing most of the map has in common. It only says so on
     its own row, and waits at the bottom. */
  var KEY_LOPSIDED_MIN_KINDS = 3;
  /* A key groups places, so at least half of the places that answered a column
     must share their answer with at least one other place (Mithun, October
     2026). In the Multispecies atlas 11 people answered and 9 gave an
     organisation's name, all different: few enough kinds to slip under the cap,
     and a key that put every place in a group of its own.

     Such a column is not offered as a key, but it stays on the list marked
     `scattered`, exactly as a question marked tooFew does, so every place still
     shows its answer on its card. Never applied to the column the owner chose
     to colour by, nor to a discovered question. */
  var KEY_MIN_SHARED = 0.5;

  /* What share of the places that answered share an answer with another place.
     A list cell ("Culture; Nature") shares if any of its answers is shared; each
     answer is cut and trimmed the same way the kinds are counted, and a date
     column is compared by the month or year it is grouped into. */
  function sharedShare(nonEmpty, delim, grain) {
    var perPlace = [], tally = {};
    nonEmpty.forEach(function (v) {
      var parts = delim ? String(v).split(delim) : [v], mine = {};
      parts.forEach(function (s) {
        if (grain) { s = dateBucket(s, grain); if (!s) return; }
        s = unquotePiece(s).slice(0, 40);
        if (s) mine[s] = 1;
      });
      var ks = Object.keys(mine);
      if (!ks.length) return;
      ks.forEach(function (k) { tally[k] = (tally[k] || 0) + 1; });
      perPlace.push(ks);
    });
    if (!perPlace.length) return 1;
    var shared = perPlace.filter(function (ks) {
      return ks.some(function (k) { return tally[k] >= 2; });
    }).length;
    return shared / perPlace.length;
  }

  function computeKeyOptions(L, feats) {
    var committedCol = null;
    if (L.markerBy) {
      committedCol = (L.spec && L.spec.categoryColumn) ? String(L.spec.categoryColumn)
        : (L.markerBy !== "_category" ? L.markerBy : null);
      if (!committedCol || !L.markers) return [];
    }
    var names = {};
    feats.slice(0, 5).forEach(function (f) { for (var k in (f.properties || {})) names[k] = 1; });
    var opts = [];
    Object.keys(names).forEach(function (col) {
      // name-blind: only engine-internal columns (leading "_") are barred by
      // name; everything else is judged on its VALUES below. skipSearchProp
      // stays out of this path on purpose — it judges names, and a batch_id
      // column holding "first walk" / "second walk" is a perfectly good key.
      if (col.charAt(0) === "_") return;
      /* An area layer's lowercase `name` is the region the row was matched to
         (Western Ghats, Karnataka), written in by the join — not something the
         person collected. Offered as a key it read "Name", and twice ("Name" /
         "name") when the file had its own Name column. */
      if (col === "name" && L.type !== "marker") return;
      var committed = committedCol === col;
      var nonEmpty = [];
      feats.forEach(function (f) {
        var v = f.properties ? f.properties[col] : undefined;
        // unwrapped here so a key's kinds are words, not "{Nature}"
        if (v !== undefined && v !== null && v !== "") nonEmpty.push(unbrace(v));
      });
      if (!nonEmpty.length) return;
      // multi-value cells: the same rule the server uses (fragment.js detectDelimiter)
      var delim = null;
      [";", ","].forEach(function (d) {
        if (!delim && nonEmpty.filter(function (v) { return v.indexOf(d) >= 0; }).length >= nonEmpty.length * 0.4) delim = d;
      });
      /* A column of dates arrives with one kind per date, which is no key at
         all. It becomes one by grouping — see dateGrain. Only for a column that
         is dates all the way down; anything else is counted as it comes. */
      var grain = (!committed && !delim && looksLikeDates(nonEmpty))
        ? dateGrain(nonEmpty, 9) : null;
      var counts = [], seen = {};
      nonEmpty.forEach(function (v) {
        if (delim) { var i = v.indexOf(delim); if (i >= 0) v = v.slice(0, i); }
        if (grain) {
          v = dateBucket(v, grain);
          if (!v) return;
        }
        v = unquotePiece(v).slice(0, 40);
        if (!v) return;
        if (seen[v] == null) { seen[v] = counts.length; counts.push({ kind: v, n: 0 }); }
        counts[seen[v]].n++;
      });
      if (!committed) {
        if (counts.length < 2) return;
        /* One cap, and it is the palette's eight plus room for a small tail.

           Eight is not a preference — it is how many marks this atlas owns
           (KEY_COLORS), chosen to stay apart for a colourblind reader. It was
           nine for a plain column and twelve for a list one, and twelve
           promised four more kinds than can be drawn: a reader was shown eight
           and four were merged into "other" without being asked.

           Ten rather than eight because a column just over the line is worth
           keeping: "Categories" has exactly ten kinds and its top eight cover
           95% of places, so "other" holds 5% — an ordinary honest class, not a
           hidden merge. What keeps that tail small is the rule below, which
           refuses a column whose top eight cannot reach 60%. That is the rule
           doing the real work: measured on this layer it is what rejects the
           address, the labels, the ids and the descriptions, and the cap only
           saves it the arithmetic.

           Cartography agrees about the ceiling rather than the exact number:
           qualitative schemes are usually advised at five to seven classes,
           ColorBrewer's longest run to twelve, and the colourblind-safe ones
           are far shorter than that. */
        if (counts.length > KEY_CAP) return;
      }
      counts.sort(function (a, b) { return b.n - a.n; });   // stable: ties keep first-seen order
      var kept;
      if (committed) {
        kept = Object.keys(L.markers);   // the committed kinds, committed order, committed colours
      } else {
        kept = counts.slice(0, KEY_MAX).map(function (c) { return c.kind; });
        // every kept kind must read as a word: a column of shared links,
        // id-strings or timestamps is not a set of readable kinds
        if (kept.some(function (k) { return skipSearchValue(k); })) return;
      }
      var named = 0;
      counts.forEach(function (c) { if (kept.indexOf(c.kind) >= 0) named += c.n; });
      /* A discovered question is offered whatever it reaches. The 60% rule is
         right for a column somebody uploaded — a column that names a fifth of
         the places is usually a column with a lot missing, and offering it as a
         key would be offering a mostly-grey map with no explanation. A question
         is different: it was asked of these places and this is the honest answer,
         so it is offered with the share it can speak for written beside it. */
      if (/^pattern_\d+_why$/.test(col)) return;   // a reason is not a key
      var isQuestion = /^pattern_\d+$/.test(col);
      /* A question with no name is not a question, it is a leftover column.

         "pattern_4" is the machinery's own name for the fourth question a
         reading found; a reader should never meet it. Its real name lives in
         the layer's keyLabels, and when a later reading finds fewer questions
         the surplus names are dropped. If the column outlives its name — as one
         did here, when only one of the two places that write a reading learned
         to clear the old columns — the fallback dressed it up as "Pattern 4"
         and put it on the map as a key.

         There is no sensible name to give it, so it is not offered. */
      if (isQuestion && !(L.keyLabels && L.keyLabels[col])) return;
      /* A question the owner has taken off the map. It was asked, and every
         place still carries its answer — this only says the switch is not
         offered. The owner puts it back from the layer's own fold, which is the
         only place it is still visible. */
      if (isQuestion && (L.hiddenKeys || []).indexOf(col) >= 0) return;
      if (!committed && !isQuestion && named / feats.length < 0.6) return;
      /* A question answered by fewer than 30% of the places is not offered as
         a key (Mithun, October 2026): switched on, it leaves most of the map
         grey, and "from 13% of places" beside it is a warning, not a key. It
         stays on the list marked tooFew, so the places that did answer still
         show it on their cards; only the panel's tick is left out. */
      var tooFew = Boolean(isQuestion && !committed && named / feats.length < QUESTION_MIN_REACH);
      // and a key that does not tell places apart is not a key — see KEY_DOMINANCE
      if (!committed && !isQuestion && counts.length &&
          counts[0].n / feats.length > KEY_DOMINANCE) return;
      // and a key whose answers are mostly one of a kind groups nothing — see KEY_MIN_SHARED
      var scattered = Boolean(!committed && !isQuestion &&
        sharedShare(nonEmpty, delim, grain) < KEY_MIN_SHARED);
      /* A name the owner gave this key wins over the column's own name. The
         column is called "themes", which says how it was made rather than what
         it holds — and the switch lowercased it while the popup capitalised it,
         so a reader could meet "themes" and "Themes" in one sitting. */
      /* A date column grouped by month is named for what it means, not for
         the column: "Created at · by month" read like a database field. The
         app's own bookkeeping dates get plain names ("When it was added"),
         any other date keeps its name, and the grouping is said in brackets.
         Anything else goes through colLabel: the owner's name, or the stored
         short name, or the plain cut of a long heading — with the whole
         heading kept beside it for the hover and the ⓘ. */
      var lab = grain ? { text: dateKeyName(col), full: dateKeyName(col), shortened: false } : colLabel(L, col);
      var shown = lab.text;
      if (grain) shown += " (by " + grain + ")";
      // the commonest answer, and how much of this key's own answers it takes
      var top = null;
      counts.forEach(function (c) {
        if (kept.indexOf(c.kind) >= 0 && (!top || c.n > top.n)) top = c;
      });
      var lopsided = (named && top) ? top.n / named : 0;
      // does the commonest answer outweigh everything else the question answered?
      var outweighs = Boolean(top && top.n > (named - top.n));
      var kindsHere = 0;
      counts.forEach(function (c) { if (kept.indexOf(c.kind) >= 0 && c.n > 0) kindsHere += 1; });
      opts.push({ col: col, label: shown, full: lab.full, shortened: lab.shortened,
        delim: delim, committed: committed, grain: grain, tooFew: tooFew, scattered: scattered,
        // what share of the places this key can actually speak for; shown beside
        // a discovered question, whose whole point is that it may not reach all
        reach: feats.length ? named / feats.length : 0, isQuestion: isQuestion,
        // and how lopsided it is, which is a different thing from how far it reaches
        lopsided: lopsided, biggest: top ? top.kind : "", biggestN: top ? top.n : 0,
        answered: named,
        flat: Boolean(isQuestion && !committed && named && outweighs &&
                      kindsHere >= KEY_LOPSIDED_MIN_KINDS),
                  kept: kept, hasOther: named < feats.length });
    });
    /* Committed key first, then anything that sorts, then the questions that
       barely do. A flat question is not hidden — a reader may want exactly the
       thing that is true of most of the map — but it should not be the first
       switch a newcomer reaches for. */
    opts.sort(function (a, b) {
      return (b.committed ? 1 : 0) - (a.committed ? 1 : 0)
          || (a.flat ? 1 : 0) - (b.flat ? 1 : 0);
    });
    return opts;
  }

  function activeKeyOptions(L) {
    var st = keyState[L.id];
    if (!st || !L._keyOptions) return [];
    return L._keyOptions.filter(function (o) { return st.active.indexOf(o.col) >= 0; });
  }

  // Colour slots: every family counts from the front of the palette — colours
  // repeat freely between keys and the shape says which key, so the far-end
  // trick the two-key row used is gone. The committed key, always the anchor
  // family, keeps its committed colours untouched.
  function keyKindColor(L, opt, familyIndex, slot) {
    if (opt.committed && familyIndex === 0) {
      var m = L.markers && L.markers[opt.kept[slot]];
      if (m && m.color) return m.color;
    }
    return KEY_COLORS[slot % KEY_MAX];
  }

  // EVERY answer a place holds under a key, in the order the cell lists
  // them: a list cell ("Culture; Nature") is split on the delimiter the
  // counting detected; a single-answer cell is one answer. Duplicates are
  // dropped (the same answer twice is one answer), and each answer gets
  // the same trim the counting gave it, so kept kinds match exactly. The
  // committed key reads its raw column too — the derived first-answer
  // property (markerBy) is only a fallback for data that lost the column.
  function optValuesOf(L, opt, f) {
    var p = f.properties || {};
    var v = p[opt.col];
    if ((v === undefined || v === null || v === "") && opt.committed && L.markerBy) v = p[L.markerBy];
    if (v === undefined || v === null || v === "") return [];
    // a database's braces are the list, not part of the first and last word in it
    var text = unbrace(v);
    var parts = opt.delim ? text.split(opt.delim) : [text];
    var out = [], seen = {};
    parts.forEach(function (s) {
      /* A bucketed column has to be asked the same question its kinds were
         built from. Without this the key would list "March 2026" and every
         place would look for its own raw date among those names, match nothing,
         and the map would come out entirely blank under a key that reads fine. */
      if (opt.grain) {
        s = dateBucket(s, opt.grain);
        if (!s) return;
      }
      s = unquotePiece(s).slice(0, 40);
      if (!s || seen[s]) return;
      seen[s] = 1;
      out.push(s);
    });
    return out;
  }

  /* One colour for every contributed place. The colour an owner used to pick
     painted a 2px ring nobody could read, went missing the moment pins folded
     into a group, and collided by default — two uploads in the only three-upload
     atlas wore the same rust because neither had chosen. A colour that declares
     a real difference still wins: Deoria's sugar mills and distilleries keep
     sienna and moss, because there that colour IS the distinction. */
  var PIN_ONE = "#9E3220";        // --color-sindoor-deep
  function oneColorOf(L) {
    if (L.marker && L.marker.color) return L.marker.color;
    return PIN_ONE;
  }

  // The neutral pin: white body, thin border in the layer's one colour,
  // nothing inside. This is every keyed pin, keys on or off — the rows
  // beside it carry the answers.
  /* The standard location marker, drawn once. A round head 10px from the top and
     a tip at the bottom middle: the tip is the place. The white keyline is not
     decoration — over satellite it is the only thing that reads, because every
     fill we could choose disappears into vegetation there. */
  var PIN_PATH = "M10 27.4C10 27.4 19 16.2 19 10A9 9 0 1 0 1 10C1 16.2 10 27.4 10 27.4Z";
  function pinBody() {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 20 28");
    svg.setAttribute("class", "pin-body");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS(ns, "path");
    path.setAttribute("d", PIN_PATH);
    path.setAttribute("fill", "currentColor");
    path.setAttribute("stroke", "#fff");
    path.setAttribute("stroke-width", "2");
    svg.appendChild(path);
    return svg;
  }
  /* The head holds whatever the place has to say: a declared icon in white, or
     failing that a plain white dot. Deoria's factory and flask live here — they
     are the only thing separating a sugar mill from a distillery. */
  function pinHeart(iconName, shape) {
    var heart = el("span", "pin-heart");
    if (iconName && ICONS[iconName]) heart.innerHTML = ICONS[iconName];
    else if (shape && shape !== "dot" && window.LokaIcons && window.LokaIcons.markSVG) {
      // a kind's shape from the point set, in white, in the pin's head — so
      // the map says the same thing as the legend without a colour
      heart.innerHTML = window.LokaIcons.markSVG(shape, "#fff", 12);
    } else {
      var ns = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 12 12");
      svg.setAttribute("aria-hidden", "true");
      var c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", "6"); c.setAttribute("cy", "6"); c.setAttribute("r", "3");
      c.setAttribute("fill", "#fff");
      svg.appendChild(c); heart.appendChild(svg);
    }
    return heart;
  }
  function locPinEl(color, iconName, shape) {
    var pin = el("div", "atlas-pin loc");
    pin.style.setProperty("--pin", color);
    pin.appendChild(pinBody());
    pin.appendChild(pinHeart(iconName, shape));
    return pin;
  }
  function keyPinEl(color) { return locPinEl(color, null); }

  /* The row marks: one shape per key — circles, squares, triangles,
     diamonds, bars, in the order the keys are offered. Solid fill, thin
     white rim, no icon — colour and shape carry everything. Sizes are
     ink-matched (each holds the colour area of a 12px dot), which makes
     the triangle, diamond and bar wider than the square: that is the
     price of every kind carrying the same amount of colour. Geometry as
     the approved mock (rows-mock.html); marks 2px apart within a row,
     rows 2px apart in the stack, block centred on the pin's middle. */
  var ROW_SHAPES = ["circle", "square", "triangle", "diamond", "bar"];   // keys 1..5
  var ROW_WORDS = ["circles", "squares", "triangles", "diamonds", "bars"];
  var ROW_W = { circle: 12, square: 10.6, triangle: 16.2, diamond: 15.1, bar: 15.1 };
  var ROW_H = { circle: 12, square: 10.6, triangle: 14.03, diamond: 15.1, bar: 7.55 };
  var MARK_GAP = 2;      // white between neighbouring marks in a row
  var ROW_GAP = 2;       // white between rows in the stack (kept in CSS too)
  var ROW_PINGAP = 3;    // between the pin's edge and the block
  var PIN_W = 20;        // the neutral pin's outer size
    // The cap on keys worn at once is five — one per shape the rows can draw
    // (ROW_SHAPES). What five costs in HEIGHT is measured, not guessed, on the
    // live map (Bengaluru, dense neighbourhood, z16 and z17): folding keeps
    // pins about 48px apart (the mean footprint). Three rows stack 40.6px —
    // inside that distance, so a three-row place can never sit on a neighbour
    // (0 collisions measured). Four reach 57.7px and graze the rare vertical
    // neighbour (1 pair per scene, 3–4px — under half a mark). Five reach
    // 67.3px, where that graze deepens to about 13px and can hide a whole mark
    // on the pair below. The owner set the cap at five knowing that cost: the
    // fifth key is worth more than the rare hidden mark, and a reader who hits
    // it can turn a key off. (Those measurements hold at street zooms, where
    // the fold charges the rows' full width. Zoomed out the fold eases to the
    // plain pin distance — keyedFoldRadius — so tall stacks can overlap there:
    // the accepted price of keys-on no longer emptying the city view.)
    var KEY_STACK_CAP = 5;
    // Reader-facing, and it must speak the same language as the heading it sits
    // under ("Show key"). It says "keys" for that reason, not "colourings":
    // colour is not what tells two keys apart — each key wears its own shape,
    // and colours repeat between them.
    var KEY_STACK_NOTE = "The map can mark places by five things at once, and five are ticked. Untick one to add {name}.";
  var SVG_NS = "http://www.w3.org/2000/svg";
  function markPathD(shape, cx, cy) {
    if (shape === "square") { var s = 10.6 / 2; return "M" + (cx - s) + " " + (cy - s) + "h" + (2 * s) + "v" + (2 * s) + "h" + (-2 * s) + "z"; }
    if (shape === "triangle") {
      var w = 16.2 / 2, h = ROW_H.triangle, top = cy - h / 2;
      return "M" + cx + " " + top + "L" + (cx + w) + " " + (top + h) + "L" + (cx - w) + " " + (top + h) + "z";
    }
    if (shape === "bar") { var bw = 15.1 / 2, bh = 7.55 / 2; return "M" + (cx - bw) + " " + (cy - bh) + "h" + (2 * bw) + "v" + (2 * bh) + "h" + (-2 * bw) + "z"; }
    var d = 15.1 / 2;   // diamond
    return "M" + cx + " " + (cy - d) + "L" + (cx + d) + " " + cy + "L" + cx + " " + (cy + d) + "L" + (cx - d) + " " + cy + "z";
  }
  function markNode(shape, cx, cy, color) {
    var m;
    if (shape === "circle") {
      m = document.createElementNS(SVG_NS, "circle");
      m.setAttribute("cx", cx); m.setAttribute("cy", cy); m.setAttribute("r", 6);
    } else {
      m = document.createElementNS(SVG_NS, "path");
      m.setAttribute("d", markPathD(shape, cx, cy));
    }
    m.setAttribute("fill", color);
    m.setAttribute("stroke", "#fff");
    m.setAttribute("stroke-width", "1.4");
    return m;
  }
  // one mark on its own, for the key panel and the hover bubble
  function markEl(shape, color) {
    var s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("viewBox", "0 0 20 20");
    s.setAttribute("aria-hidden", "true");
    s.appendChild(markNode(shape, 10, 10, color));
    return s;
  }
  function rowWidth(shape, n) { return n * ROW_W[shape] + (n - 1) * MARK_GAP; }
  // one row of marks as one svg, sized to its true box; the white rims may
  // paint a hair outside it (overflow stays visible), exactly as the mock
  function rowSvg(shape, colors) {
    var w = rowWidth(shape, colors.length), h = ROW_H[shape];
    var s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("class", "atlas-keyrow");
    s.setAttribute("width", w); s.setAttribute("height", h);
    s.setAttribute("viewBox", "0 0 " + w + " " + h);
    s.setAttribute("aria-hidden", "true");
    colors.forEach(function (c, i) {
      s.appendChild(markNode(shape, ROW_W[shape] / 2 + i * (ROW_W[shape] + MARK_GAP), h / 2, c));
    });
    return s;
  }

  // Redraw one place to match the active keys. None on: the plain neutral
  // pin alone. Keys on: the same neutral pin plus one row per key the place
  // answers — every answer its own mark, kept kinds in their colours, any
  // other answer grey. The marker element and all its wiring stay; only
  // what is drawn inside changes. entry._rowsW records how far the block
  // reaches past the pin — folding and the fan spacing read it.
  /* The marks one place wears under the keys that are on: one row per key
     the place answers, every answer its own mark, kept kinds in their colours,
     any other answer grey. One builder, read by the pin on the map AND by the
     place's line in the Map Browser, so the list can never disagree with
     the map about what a place is. */
  function keyMarkRows(L, f, act) {
    var rows = [];
    act.forEach(function (opt, fi) {
      var vals = optValuesOf(L, opt, f);
      if (!vals.length) return;   // no answer under this key: no row
      rows.push({ shape: ROW_SHAPES[fi], colors: vals.map(function (v) {
        var slot = opt.kept.indexOf(v);
        return slot >= 0 ? keyKindColor(L, opt, fi, slot) : KEY_OTHER;
      }) });
    });
    return rows;
  }
  function renderMarks(L, entry, act) {
    var node = entry.node;
    if (!node) return;
    while (node.firstChild && node.firstChild.className !== "atlas-mlabel") node.removeChild(node.firstChild);
    entry._rowsW = 0;
    entry._rowsEl = null;
    var rows = keyMarkRows(L, entry.f, act);
    if (!rows.length) {
      node.insertBefore(keyPinEl(oneColorOf(L)), node.firstChild);
      return;
    }
    var holder = el("div", "atlas-rowed loc");
    holder.appendChild(keyPinEl(oneColorOf(L)));
    var block = el("div", "atlas-keyrows");
    var w = 0;
    rows.forEach(function (r) {
      block.appendChild(rowSvg(r.shape, r.colors));
      w = Math.max(w, rowWidth(r.shape, r.colors.length));
    });
    holder.appendChild(block);
    entry._rowsW = ROW_PINGAP + w;
    entry._rowsEl = block;
    node.insertBefore(holder, node.firstChild);
  }

  // Rows sit to the right of the pin; a pin whose block would cross the
  // map's right edge flips it to the left. Decided from the pin's on-map
  // position, so it is re-checked when the camera comes to rest — width,
  // the thing folding prices, is identical either side.
  function updateRowFlips() {
    if (!map) return;
    var w = map.getContainer().clientWidth;
    (MANIFEST.layers || []).forEach(function (L) {
      if (!keyState[L.id]) return;
      (markersByLayer[L.id] || []).forEach(function (e) {
        if (!e._rowsEl) return;
        var x = map.project(e.mk.getLngLat()).x;
        e._rowsEl.classList.toggle("flip", x + PIN_W / 2 + e._rowsW > w - 6);
      });
    });
  }
  var rowFlipsWired = false;
  function wireRowFlips() {
    if (rowFlipsWired || !map) return;
    rowFlipsWired = true;
    map.on("moveend", updateRowFlips);
    map.on("zoomend", updateRowFlips);
  }

  // The key beside the layer, rebuilt with the marks: each switched-on key's
  // kinds under a header pairing it with its shape ("categories — circles"),
  // from the first key on — the pin no longer says any of it, so the panel
  // must. Nothing on: one row, the layer's own colour and name.
  /* One key's kinds as panel rows. Built from keyLegendRows so the panel, the
     map and the popup can never tell different stories — it simply takes the
     slice belonging to this key and drops the header the switch replaces. */
  function keyKindRows(L, opt) {
    var act = activeKeyOptions(L);
    var fi = act.indexOf(opt);
    if (fi < 0) return [];
    var all = keyLegendRows(L, act);
    var mine = [], seenHeads = -1;
    for (var i = 0; i < all.length; i++) {
      if (all[i].header) { seenHeads++; continue; }
      if (seenHeads === fi) mine.push(all[i]);
      if (seenHeads > fi) break;
    }
    var out = [];
    mine.forEach(function (it) {
      /* Each kind is a chip you can press: the map keeps the places of that
         kind and the list narrows to them, the way search does (filterByKind).
         Pressing it again, or "show all", comes back. The row wears the
         same mark the map draws, so what you press is what you see. */
      var r = el("button", "leg-item key-kind" + (it.faint ? " faint" : ""));
      r.type = "button";
      var which = it.silentOf ? "silent" : (it.label === "other" && it.color === KEY_OTHER ? "other" : "kind");
      r.setAttribute("data-kind", which === "kind" ? it.label : "");
      r.setAttribute("data-which", which);
      r.setAttribute("data-layer", L.id);
      r.setAttribute("data-col", opt.col);
      var lit = kindFilterIs(L, opt, which, it.label);
      r.classList.toggle("on", lit);
      r.setAttribute("aria-pressed", lit ? "true" : "false");
      r.setAttribute("aria-label", (lit ? "Showing only the places that are " : "Show only the places that are ") +
        kindWords(it.label, which) + (it.n != null ? " — " + it.n : ""));
      r.appendChild(swatch(it));
      r.appendChild(el("span", "leg-label", esc(it.label)));
      if (it.n != null) r.appendChild(el("span", "leg-n", String(it.n)));
      /* The pressed chip wears a small × so it reads "tap again to clear",
         and the line under the key says the rest (see keyOnlyLine). */
      var x = el("span", "key-x", "×");
      x.setAttribute("aria-hidden", "true");
      r.appendChild(x);
      r.onclick = function () { filterByKind(L, opt, which, it.label); };
      out.push(r);
      /* The words behind a kind, or the places a question is silent on, open
         from a small chevron after the row — not from the row itself, which
         now narrows the map. */
      var fold = null;
      if (it.silentOf) fold = silentPlacesEl(L, it.silentOf);
      else if (it.why && it.why.length) fold = whyWordsEl(L, it.why);
      if (fold) {
        fold.hidden = true;
        var open = el("button", "leg-open", ICONS.chevron);
        open.type = "button";
        open.setAttribute("aria-expanded", "false");
        open.setAttribute("aria-label", it.silentOf
          ? "Which places have no answer"
          : "The words that put a place under " + it.label);
        open.onclick = function () {
          fold.hidden = !fold.hidden;
          open.setAttribute("aria-expanded", String(!fold.hidden));
        };
        var pair = el("div", "leg-pair");
        pair.appendChild(r);
        pair.appendChild(open);
        out[out.length - 1] = pair;
        out.push(fold);
      }
    });
    out.push(keyOnlyLine(L, opt));
    return out;
  }
  /* The line under a key's kinds while one is pressed: "Showing only Green
     Space (16) · Show all". Tapping a kind used to flip the map between
     "only these" and "all" with nothing near the tap saying which — the
     count line at the top of the panel said it, but not where the reader
     was looking. This sits right under the chips; Show all is a plain
     button; hidden when nothing is pressed. Filled in by markLitKinds. */
  function keyOnlyLine(L, opt) {
    var line = el("div", "key-only");
    line.setAttribute("data-layer", L.id);
    line.setAttribute("data-col", opt.col);
    line.hidden = true;
    line.appendChild(el("span", "key-only-t"));
    var all = el("button", "key-only-all", "Show all");
    all.type = "button";
    all.onclick = function () { clearSearch(); };
    line.appendChild(el("span", "key-only-dot", "·"));
    line.appendChild(all);
    return line;
  }
  // how a kind is named in the count line and to a screen reader
  function kindWords(label, which) {
    if (which === "silent") return "without an answer";
    if (which === "other") return "something else";
    return label;
  }

  function keyLegendRows(L, act) {
    if (!act.length) {
      return [{ color: oneColorOf(L), label: String(L.label || "").slice(0, 40), shape: "dot" }];
    }
    var rows = [];
    var entries = markersByLayer[L.id] || [];
    act.forEach(function (opt, fi) {
      // How many places wear each kind's mark — counted from the same answers
      // the marks themselves are drawn from (optValuesOf), so the number in
      // the key can never disagree with the marks on the map. "other" counts
      // places carrying at least one answer outside the kept kinds.
      var tally = {}, other = 0;
      entries.forEach(function (e) {
        var hitOther = false;
        optValuesOf(L, opt, e.f).forEach(function (v) {
          if (opt.kept.indexOf(v) >= 0) tally[v] = (tally[v] || 0) + 1;
          else hitOther = true;
        });
        if (hitOther) other++;
      });
      rows.push({ header: true, label: opt.label + " — " + ROW_WORDS[fi], full: opt.shortened ? opt.full : "" });
      opt.kept.forEach(function (kind, i) {
        /* The words that gathered this kind's places, from their own text. Folded
           away until asked for: a key is read at a glance, and a list of words
           under every kind would bury the thing being glanced at. Tapping opens
           one — which is what the shelves used to be, now attached to the key
           that colours the map rather than standing beside it. */
        /* Each word is evidence, and evidence came from somewhere. The place it
           was quoted from is kept beside it so the word can be followed back to
           the marker it belongs to — a word repeated by several places keeps
           all of them. */
        var seen = {}, words = [];
        if (opt.isQuestion) {
          entries.forEach(function (e) {
            if (optValuesOf(L, opt, e.f).indexOf(kind) < 0) return;
            String((e.f.properties || {})[opt.col + "_why"] || "").split(",").forEach(function (w) {
              w = w.trim();
              if (!w) return;
              var k = w.toLowerCase();
              if (seen[k]) { seen[k].es.push(e); return; }
              seen[k] = { w: w, es: [e] };
              words.push(seen[k]);
            });
          });
        }
        rows.push({ color: keyKindColor(L, opt, fi, i), label: kind, categorical: true, family: ROW_SHAPES[fi],
                    n: entries.length ? (tally[kind] || 0) : null,
                    why: words.length ? words.slice(0, 14) : null });
      });
      /* The leftover row. A question does not fail to classify a place — it has
         nothing to say about it, which is a different thing and worth a
         different word. And its count is the places the question could not
         speak for, not the places carrying some answer outside the kept kinds:
         an unanswered place holds no answer at all, so the old count read 0
         beside a question that had missed a third of the map. */
      if (opt.isQuestion) {
        /* No "no answer" row (Mithun, September 2026): the share beside the
           question already says how many places it speaks for, and a grey row
           of the unanswered read as one more kind to choose. */
      } else if (opt.hasOther) {
        rows.push({ color: KEY_OTHER, label: "other", categorical: true, family: ROW_SHAPES[fi],
                    n: entries.length ? other : null });
      }
    });
    return rows;
  }

  // What this place is, key by key: one line per key that is ON, in row
  // order — the key's shape, the key's name, then EVERY answer the place
  // holds under it, in the order its row wears them ("categories · Culture,
  // Nature"). The lines come back as one DOM box: the hover bubble appends
  // it, the tap popup serialises it — one builder, so the bubble, the
  // popup, the panel and the map can never tell different stories. A key
  // this place leaves blank keeps its line, saying "left blank" — its row
  // is missing from the map on purpose, and the words say so. Built only
  // when a pointer enters a pin or a popup opens, never per move.
  /* `all` is the difference between the two things this builds. A hover bubble
     decodes the marks a pin is wearing, so it shows the keys that are on and
     nothing else. A popup decodes nothing — somebody opened a place to read
     about it, and every answer that place holds belongs there whether or not
     its key happens to be switched on. One builder still, so the same answer
     is worded the same way in both. */
  function keyRowsEl(L, props, all) {
    var act = all ? (L._keyOptions || []) : activeKeyOptions(L);
    if (!act.length) return null;
    var f = { properties: props };
    var box = el("div", "key-rows");
    // marks are drawn in the order the keys came ON, so a shape means something
    // only for a key that is on; an answer from a key that is off gets a plain
    // dot, because there is nothing on the map for a shape to point at
    var marked = activeKeyOptions(L);
    act.forEach(function (opt) {
      var fi = marked.indexOf(opt);
      var vals = optValuesOf(L, opt, f);
      /* A column somebody uploaded and left empty is worth saying out loud —
         the gap is in their data. A question with nothing to say about this
         place is not a gap; it is an answer, and printing "left blank" under it
         reads as a fault. So the line simply does not appear. */
      /* Nor for an empty column: no "no answer" or "left blank" lines anywhere
         (Mithun, September 2026) — a card lists what a place says. */
      if (!vals.length) return;
      /* Why this place got that answer, in its own words. A question's answer is
         a judgement; without the words behind it nobody can tell a good one from
         a counter. Only where the reading actually quoted something — a filing
         done by counting has no reason to give, and will not invent one. */
      var why = props[opt.col + "_why"];
      var hasWhy = !!(opt.isQuestion && vals.length && why && String(why).trim());

      /* Folded by default, and only in the popup. A place answering four
         questions spent three lines on each — question, answer, reason — and the
         card came to 317px against a 317px ceiling, so it scrolled inside a box
         most people do not realise scrolls. The reason is evidence, wanted when
         an answer looks wrong and in the way the rest of the time.

         The hover bubble gets no reasons at all: it cannot be clicked, so a fold
         is no use there, and a glance does not want the evidence unfolded. */
      var foldable = hasWhy && all;
      var row = el(foldable ? "button" : "div",
        "key-row" + (vals.length ? "" : " blank") + (foldable ? " key-row-open" : ""));
      if (foldable) {
        row.type = "button";
        row.setAttribute("aria-expanded", "false");
        row.setAttribute("data-fold", "why");
      }
      // a key that is on wears its shape; one that is off gets a plain dot,
      // because there is no mark on the map for a shape to point at
      var mini = markEl(fi >= 0 ? ROW_SHAPES[fi] : "circle", "#6b6353");
      mini.setAttribute("class", "key-mark");
      row.appendChild(mini);
      /* The question and the answer sit in one run of text rather than a line
         each: compact when they fit, and the answer wraps to the next line when
         it does not, so nothing is ever cut short. */
      var line = el("span", "key-line");
      var kname = el("span", "key-name", esc(opt.label));
      if (opt.shortened) {
        kname.title = opt.full;
        kname.innerHTML += " " + labelInfoHTML(opt.full);
      }
      line.appendChild(kname);
      line.appendChild(document.createTextNode(" "));
      line.appendChild(el("span", "key-word", vals.length ? esc(vals.join(", ")) : "left blank"));
      row.appendChild(line);
      if (foldable) {
        // its own column, so it can never be orphaned onto a line by itself
        var chev = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        chev.setAttribute("class", "key-chev");
        chev.setAttribute("viewBox", "0 0 10 6");
        chev.setAttribute("aria-hidden", "true");
        chev.innerHTML = '<path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" ' +
          'stroke-width="1.4" stroke-linecap="round"/>';
        row.appendChild(chev);
      }
      box.appendChild(row);

      if (hasWhy && all) {
        var b2 = el("div", "key-because");
        b2.hidden = true;
        b2.appendChild(el("span", "key-because-lead", "because"));
        // a flex gap is space on the screen and nothing in the text
        b2.appendChild(document.createTextNode(" "));
        String(why).split(",").forEach(function (w) {
          w = w.trim();
          if (w) b2.appendChild(el("span", "key-because-w", esc(w)));
        });
        box.appendChild(b2);
        /* No handler here on purpose. The popup is assembled by serialising
           these rows to HTML (krows.outerHTML), and serialising throws every
           event handler away — the chevron rendered and nothing listened. The
           fold is worked by one delegated listener instead, the same way the
           tag chips in a popup already are. */
        row.setAttribute("aria-label", opt.label + ": " + vals.join(", ") + " — show why");
      }
    });
    return box;
  }

  function applyLayerKeys(L) {
    var act = activeKeyOptions(L);
    (markersByLayer[L.id] || []).forEach(function (e) { renderMarks(L, e, act); });
    hideHint();   // a bubble built from the old keys must not outlive them
    updateRowFlips();   // fresh blocks near the right edge flip straight away
    // the panel always describes what the pins now wear — the manifest's own
    // key described coloured pins that no longer exist once keys are offered
    L._legend = keyLegendRows(L, act);
    renderExtra(L);
    applyMarkerVisibility(L);   // discs re-read the new footprints (fold distance included)
    // a pressed kind whose key just went off has nothing left to filter by
    if (KINDFILTER && KINDFILTER.layer === L.id &&
        !act.some(function (o) { return o.col === KINDFILTER.col; })) clearSearch();
  }

  // Fold distance follows the markers' true footprint. With nothing switched
  // on every pin is the plain 20px circle; with keys on, a pin plus its rows
  // is as wide as the pin, the gap and its widest row. The folding engine
  // takes ONE distance per build (see CLUSTERS), so it folds at the mean
  // footprint of the pins wearing rows — recomputed on every toggle, and the
  // engine is rebuilt whenever the number moves (refreshClusterIndex).
  //
  // The rows' width is only charged where the rows are truly in play: zoomed
  // in past KEY_FOLD_NEAR. Out past KEY_FOLD_FAR the fold distance stays
  // exactly what it was before any key was on — so switching a key on at
  // city view colours the pins the reader already had instead of folding
  // them away, and rows that brush a neighbour out there are the accepted
  // price. Between the two the distance climbs in 4px steps, so zooming
  // through rebuilds the engine a handful of times, never continuously
  // (syncLeafVisibility notices the step and rebuilds).
  var KEY_FOLD_FAR = 13, KEY_FOLD_NEAR = 16;
  function keyedFoldRadius() {
    var sum = 0, n = 0;
    (MANIFEST.layers || []).forEach(function (L) {
      if (L._visible === false) return;
      var st = keyState[L.id];
      if (!st || !st.active.length) return;
      (markersByLayer[L.id] || []).forEach(function (e) {
        if (e.hidden) return;
        sum += PIN_W + (e._rowsW || 0);
        n++;
      });
    });
    if (!n) return CLUSTER_RADIUS;
    var full = Math.round(sum / n);
    var t = (map.getZoom() - KEY_FOLD_FAR) / (KEY_FOLD_NEAR - KEY_FOLD_FAR);
    t = Math.max(0, Math.min(1, t));
    var extra = Math.max(0, full - CLUSTER_RADIUS);
    return CLUSTER_RADIUS + Math.round(extra * t / 4) * 4;
  }

  // This layer's places that are folded away inside counted discs in the
  // current view. _clustered alone would overcount: the engine also flags
  // pins that are merely outside the viewport, and those are not "hiding".
  function foldedCount(L) {
    var n = 0, b = map.getBounds();
    (markersByLayer[L.id] || []).forEach(function (e) {
      if (!e.hidden && e._clustered && !e._fanned && b.contains(e.mk.getLngLat())) n++;
    });
    return n;
  }

  // The one-line answer to "the map got emptier": with keys on, some places
  // sit inside the counted discs, marks and all. Say so in numbers, right
  // under the switches — and keep the line current as the reader zooms and
  // pans (syncLeafVisibility calls back in after every camera rest).
  function updateFoldNote(L) {
    var box = L._foldEl;
    if (!box || !box.isConnected) return;
    var st = keyState[L.id];
    var n = (st && st.active.length && L._visible !== false) ? foldedCount(L) : 0;   // no pins, nothing to say
    if (!n) { box.hidden = true; box.textContent = ""; return; }
    box.textContent = n === 1
      ? "1 place here sits inside a numbered disc — zoom in to see it."
      : n + " places here sit inside the numbered discs — zoom in to see them.";
    box.hidden = false;
  }

  // Each key the layer offers is a switch, the same control a layer itself
  // is turned on with — one vocabulary for "this can be switched on" — a
  // size down and indented under its layer, because a key belongs to its
  // layer rather than standing beside it. Keys stack (up to KEY_STACK_CAP),
  // and every switch shows its own state, so nothing here can read as a
  // pick-one row the way the old chips did. The old "one colour" chip is
  // gone with the chips: it was a reset dressed as a colour choice — with
  // switches, all-off is visible on the switches themselves, and the legend
  // already names the layer's one colour when nothing is on.
  function buildKeyToggles(L) {
    var st = keyState[L.id];
    var wrap = el("div", "key-chips");
    // the switches are one named group to a screen reader, as they are to the eye
    wrap.setAttribute("role", "group");
    // "Show key", not "Colour by": what a mark belongs to is said by its SHAPE
    // (circles, squares, triangles…), and colours repeat between keys, so a
    // heading promising colour described the wrong half of the system. The
    // legend below already names both — "categories — circles".
    /* The caption had to change with the control. "Show key" described a switch
       that revealed something; these are a list you mark places by, and up to
       five can be marked at once. */
    wrap.setAttribute("aria-label", "Mark each place by");
    wrap.appendChild(el("span", "key-chips-lbl", "Mark each place by"));
    /* Two ways of finding things live side by side in this panel, and until now
       neither said which it was. A key COLOURS the map; a word you tap NARROWS
       it. One sentence, said once per layer, so a reader meeting "Culture" as a
       colour here and as a tappable word on a place knows they are the same
       word doing two different jobs. */
    wrap.appendChild(el("span", "key-hint",
      "Keys colour the map — each wears its own shape. Tap a kind to show only those places; tap it again, or Show all, to bring the rest back. Tap a word on a place to see who else said it."));
    var list = el("div", "key-list");
    // The cap message, when it has something to say (kept in st.note so a
    // rebuild mid-conversation does not eat it). role=status: the refused
    // switch snaps back visually — a screen reader must hear why.
    var note = el("div", "key-note");
    note.setAttribute("role", "status");
    note.hidden = !st.note;
    if (st.note) note.textContent = st.note;
    L._keyOptions.forEach(function (opt) {
      if (opt.tooFew) return;   // under 30% of places: on cards, not offered as a key
      if (opt.scattered) return;   // answers mostly one of a kind: on cards, not offered as a key
      /* A flat question needs two lines, not one, so it gets a wrapper. Every
         other key keeps the single row it always had. */
      var host = opt.flat ? el("div", "key-flatwrap") : null;
      /* A tick, not a switch, and the difference is the point.

         A switch is the mark of a thing that is on or off by itself: show these
         places, or hide them. A tick is the mark of a thing CHOSEN FROM A LIST —
         mark each place by this, and by up to four others at once. Wearing one
         shape for both meanings, a switch above and switches indented under it,
         asked a reader to learn from context that the indented ones meant
         something else entirely. A 16px square beside a 32×18 pill says it
         without a word.

         Not the key's own shape, tempting as that was: a key is given its shape
         by its place among the keys that are ON (see ROW_SHAPES over
         activeKeyOptions), so a key nobody has ticked has no shape to wear. */
      var lab = el("label", "key-toggle");
      var cb = el("input"); cb.type = "checkbox";
      cb.checked = st.active.indexOf(opt.col) >= 0;
      cb._col = opt.col;
      lab.appendChild(cb);
      lab.appendChild(el("span", "key-tick"));
      var tname = el("span", "key-tname", esc(opt.label));
      lab.appendChild(tname);
      /* A key named short says what it is short for: the whole heading on
         hover, and behind a small ⓘ for a phone, where there is no hover. The
         ⓘ sits at the row's end, where a layer's own ⓘ sits, and the heading
         opens under the row (fullHeading, appended after the label below). */
      var fullHeading = null;
      if (opt.shortened) {
        tname.title = opt.full;
        var parts = labelInfo(opt.full);
        lab.appendChild(parts.btn);
        fullHeading = parts.full;
      }
      /* A question says what share of the places it can answer. Without it a
         reader turns on "How old is it?" and meets a map that is mostly grey,
         with nothing telling them that is the answer rather than a fault. */
      if (opt.isQuestion) {
        var pct = Math.round(opt.reach * 100);
        /* "88% answered", not a bare "88%": a lone number beside a switch was
           a riddle. The word costs a few pixels and says what is counted;
           the long form is one hover away. */
        /* "from 88% of tags", in the layer's own word for its rows: what the
           share counts is not the question but the places behind its answers. */
        var nounK = layerNoun(L);
        var reach = el("span", "key-reach", "from " + pct + "% of " + nounK);
        reach.title = "Answers to this question come from " + pct + " of every 100 " + nounK;
        reach.setAttribute("aria-label", reach.title);
        lab.appendChild(reach);
      }
      /* And, for a question that barely sorts anything, why. Said in the
         panel's quietest voice, under the name, in the plainest words there
         are: most of what it answers says the same thing. A reader can then
         decide whether that is what they came for, instead of spending a
         click to find out. */
      if (host) {
        host.appendChild(lab);
        /* The kind is deliberately not named here. Measured in a 320px panel:
           naming it runs the note onto a second line, and the name is on the
           legend the moment the switch goes on, so saying it twice costs a line
           of the panel to tell a reader something they are about to see. */
        var why = el("div", "key-flat",
          "Mostly one answer — " + opt.biggestN + " of its " + opt.answered + " say the same");
        why.title = "Its commonest answer is “" + opt.biggest + "”, on " + opt.biggestN +
          " of the " + opt.answered + " places it can speak for";
        host.appendChild(why);
      }
      cb.onchange = function () {
        /* Turning a colouring on turns its layer on with it. The keys are listed
           while the layer is off, so a reader can reach one from cold — and
           asking them to find the layer's own switch first would make the listing
           pointless: they would still need two acts, and the second one is the
           one nobody thinks of. Turning a key OFF leaves the layer alone; it is
           not a way of hiding places. */
        if (cb.checked && L._visible === false) {
          setLayerVisible(L, true);
          if (L._cb) L._cb.checked = true;
          if (L._row) L._row.classList.remove("off");
          if (L._onVisible) L._onVisible();
        }
        var i = st.active.indexOf(opt.col);
        if (cb.checked && i < 0) {
          if (st.active.length >= KEY_STACK_CAP) {
            // the cap is vertical: rows stack, and past this many the
            // stack hangs further below a pin than the folding rule keeps
            // pins apart — measured, see the KEYS WEAR ROWS block. The
            // switch snaps back rather than lying about what the map wears.
            cb.checked = false;
            st.note = KEY_STACK_NOTE.replace("{name}", opt.label);
            note.textContent = st.note;
            note.hidden = false;
            return;
          }
          st.active.push(opt.col);
          // row order follows the offered order, not tap order, so the
          // committed key keeps its circles and its colours, and each key
          // keeps its own shape
          st.active = L._keyOptions.filter(function (o) { return st.active.indexOf(o.col) >= 0; })
            .map(function (o) { return o.col; });
        } else if (!cb.checked && i >= 0) {
          st.active.splice(i, 1);
        } else return;
        st.note = null;
        st._focus = opt.col;   // the rebuild below must hand the keyboard back
        applyLayerKeys(L);
      };
      list.appendChild(host || lab);
      // the whole heading of a key named short, under its row, hidden until its ⓘ is pressed
      if (fullHeading) list.appendChild(fullHeading);
      /* This key's kinds, directly beneath the switch that turns them on. They
         used to pool into one block below every switch, so flipping a switch put
         its result somewhere further down, past everything else — and knowing
         what a switch had just added meant hunting for its header. The header is
         gone with the move: the switch already carries that name, and every kind
         row already wears the key's shape. */
      /* A ticked key on a layer nobody is showing keeps its tick and loses its
         legend. Listing the keys while the layer is off — which is the whole of
         this panel — meant the kinds came with them, so hiding a layer left a
         legend on screen decoding marks that were not on the map. A legend for
         nothing is worse than no legend: it is a lie about what you are seeing.

         The choice survives, because it is a choice and not a picture, and the
         name drops to the off voice so the row reads "chosen, not showing"
         rather than "on". Two channels, the same two the layer's own row uses
         when it is off. */
      if (cb.checked && L._visible !== false) {
        keyKindRows(L, opt).forEach(function (r) { list.appendChild(r); });
      }
      if (cb.checked && L._visible === false) lab.classList.add("key-held");
    });
    wrap.appendChild(list);
    wrap.appendChild(note);
    // "N places are inside the discs" — filled in by updateFoldNote once
    // renderExtra has attached this block (and on every camera rest after).
    // Deliberately NOT a live region: the count moves on every pan and zoom,
    // and announcing each change would talk over a screen reader's whole
    // visit. It sits in reading order right under the switches instead.
    var fold = el("div", "key-fold");
    fold.hidden = true;
    wrap.appendChild(fold);
    L._foldEl = fold;
    // applyLayerKeys rebuilds this whole block, which would drop keyboard
    // focus on the floor mid-tabbing — put it back on the switch just flipped
    if (st._focus != null) {
      var want = st._focus;
      st._focus = null;
      setTimeout(function () {
        var ins = wrap.querySelectorAll("input");
        for (var i = 0; i < ins.length; i++) {
          if (ins[i]._col === want) { ins[i].focus({ preventScroll: true }); break; }
        }
      }, 0);
    }
    return wrap;
  }

  // A single numbered badge stands in for a tight group at overview zoom; the
  // individual pins take over once you zoom past `belowZoom`.
  function setupCluster(L) {
    var pts = L._pts;
    var cx = pts.reduce(function (s, p) { return s + p[0]; }, 0) / pts.length;
    var cy = pts.reduce(function (s, p) { return s + p[1]; }, 0) / pts.length;
    var wrap = el("div", "atlas-cluster");
    wrap.innerHTML = '<span class="cl-count">' + pts.length + "</span>" +
      (L.cluster.label ? '<span class="cl-label">' + esc(L.cluster.label) + "</span>" : "");
    wrap.addEventListener("click", function (e) { e.stopPropagation(); fitPoints(pts); });
    L._clusterMarker = new maplibregl.Marker({ element: wrap, anchor: "center" }).setLngLat([cx, cy]).addTo(map);
    if (!L._zoomWired) { map.on("zoom", function () { applyMarkerVisibility(L); }); L._zoomWired = true; }
  }

  /* ==================================================================
     PIN NAMES — a marker layer's `label_text`, drawn by the map.

     Shape layers have had names for a while (addLabel). A pin layer's
     name used to be a span under the pin's own element, which the map
     knew nothing about: names piled on top of one another and over the
     next pin along, and nothing was ever dropped. Now the names go into
     the map as a symbol layer fed by the pins that are actually standing
     alone (not folded into a disc, not hidden by a search), and the map
     does what it does for every other label: two names that would
     collide, and one is dropped; a name that would run across a pin or a
     counted disc is dropped too, because every pin claims its ground
     through an invisible icon placed first.

     The manifest stanza is the shape layers' one: { property, size,
     color, haloColor, haloWidth, alwaysShow }, plus `maxChars` (default
     32) because a pin's name may be a whole sentence.
  ================================================================== */
  var PIN_NAME_BOX = "atlas-pin-box";   // a transparent image the size of a pin
  function ensurePinNames(L) {
    var t = L.label_text;
    if (!t || !t.property || !map || map.getSource(srcId(L) + "-names")) return;
    var style = map.getStyle();
    if (!style || !style.glyphs) return;   // no font to draw with (see ensureClusterEngine)
    try {
      if (!map.hasImage(PIN_NAME_BOX)) {
        map.addImage(PIN_NAME_BOX, { width: PIN_W + 4, height: 30, data: new Uint8Array((PIN_W + 4) * 30 * 4) });
      }
      map.addSource(srcId(L) + "-names", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      var before = map.getLayer(CLUSTER_LAYER) ? CLUSTER_LAYER : undefined;
      /* the names, placed after the boxes (the map places higher layers
         first), so a name never sits on a pin */
      map.addLayer({
        id: L.id + "-pinname", type: "symbol", source: srcId(L) + "-names",
        layout: {
          "text-field": ["get", "_name"],
          "text-font": [GLYPH_FONTS.regular],
          "text-size": t.size || 11,
          "text-anchor": "top",
          // clear of the pin's own box below (measured: at 0.35 the text's
          // collision padding touched the box's, and every name was dropped)
          "text-offset": [0, 0.6],
          "text-max-width": 9,
          "text-allow-overlap": !!t.alwaysShow,
          "text-ignore-placement": !!t.alwaysShow,
          "text-optional": true
        },
        paint: {
          "text-color": t.color || "#24211D",
          "text-halo-color": t.haloColor || "#F5F1E6",
          "text-halo-width": t.haloWidth || 2
        }
      }, before);
      map.addLayer({
        id: L.id + "-pinbox", type: "symbol", source: srcId(L) + "-names",
        layout: { "icon-image": PIN_NAME_BOX, "icon-anchor": "bottom", "icon-allow-overlap": true, "icon-ignore-placement": false, "icon-padding": 0 }
      }, before);
      L._ids = (L._ids || []).concat([L.id + "-pinname", L.id + "-pinbox"]);
    } catch (e) {}
  }
  // the names of the pins standing alone right now, and nothing else
  function syncPinNames(L) {
    var t = L.label_text;
    if (!t || !t.property || !map) return;
    var src = map.getSource(srcId(L) + "-names");
    if (!src) return;
    var feats = [];
    var folded = L.cluster && L._clusterMarker && map.getZoom() < L.cluster.belowZoom;
    var max = t.maxChars || 32;
    if (L._visible !== false && !folded) {
      (markersByLayer[L.id] || []).forEach(function (e) {
        if (e.hidden || e._clustered || e._absorbed || e._fanned) return;
        var v = e.f.properties[t.property];
        if (v == null || v === "") return;
        feats.push({ type: "Feature", geometry: e.f.geometry, properties: { _name: shortName(String(v), max) } });
      });
    }
    src.setData({ type: "FeatureCollection", features: feats });
  }
  // a name cut at a word, with an ellipsis, when it is really a sentence
  function shortName(s, max) {
    s = s.trim();
    if (s.length <= max) return s;
    var cut = s.slice(0, max - 1);
    var sp = cut.lastIndexOf(" ");
    if (sp > max * 0.5) cut = cut.slice(0, sp);
    return cut.replace(/[\s,;:\-–—]+$/, "") + "…";
  }

  // Writes display for one layer's pins. `e._clustered` is the cluster
  // engine's verdict (folded into a disc, or outside the viewport);
  // `e._fanned` overrides it while that pin is spread out of a fan.
  function paintMarkerDisplay(L) {
    var shown = L._visible !== false;
    var folded = L.cluster && L._clusterMarker && map.getZoom() < L.cluster.belowZoom;
    (markersByLayer[L.id] || []).forEach(function (e) {
      e.mk.getElement().style.display =
        (shown && !folded && !e.hidden && ((!e._clustered && !e._absorbed) || e._fanned)) ? "" : "none";
    });
    if (L._clusterMarker) L._clusterMarker.getElement().style.display = (shown && folded) ? "" : "none";
    syncPinNames(L);
  }
  function applyMarkerVisibility(L) {
    // whatever is changing here (layer toggle, badge fold, search) can change
    // who is folded with whom — collapse any open fan rather than chase it
    if (SPIDER.items) spiderCollapse();
    hideHint();   // a pin can vanish from under the pointer; no mouseleave follows
    paintMarkerDisplay(L);
    scheduleClusterRefresh();
  }

/* Follow a word back to the place it came from.

   The words under a kind are the atlas's evidence — "Golden trumpet tree"
   under Botanic/Foliage is there because one place's own line says so. Reading
   it and then hunting the map for which place that was is work the map should
   do. One place: go to it and open it, the same as tapping its pin. Several:
   frame them all, and let the person choose. */
  function goToWord(L, es) {
    if (!es || !es.length) return;
    if (es.length === 1) {
      var e = es[0];
      var at = e.mk ? e.mk.getLngLat() : e.f.geometry.coordinates;
      var opened = false;
      var open = function () { if (opened) return; opened = true; spiderClick(L, e); };
      map.once("moveend", open);
      // an area is framed whole, with room left for the drawer and the sheet;
      // a map already framed right may not move at all, so the card is
      // opened on a timer as well
      if (e.shape) {
        var b = null;
        walkCoords(e.shape.geometry, function (c) { if (!b) b = new maplibregl.LngLatBounds(c, c); else b.extend(c); });
        if (b) { setTimeout(open, 900); try { map.fitBounds(b, { padding: viewPadding(), maxZoom: 10, duration: 600 }); return; } catch (err) {} }
      }
      /* Close enough that the place stands on its own. Below this it can still
         be folded into a numbered disc, and a popup would open over a disc
         rather than over the place it belongs to. */
      map.easeTo({ center: at, zoom: Math.max(map.getZoom(), 16), duration: 600 });
      return;
    }
    fitPoints(es.map(function (e) { return e.f.geometry.coordinates; }));
  }

  // the words under a kind, each one a way back to the places that said it
  /* Who fell through, and what they have in common.

     A place with no answer is not a failure to classify — the question has
     nothing to say about it, which is a different thing. But eight of them is a
     pattern, and the pattern is usually one word: on this map, four of the eight
     the place-question could not answer say Civic and three say Heritage. That
     is worth saying out loud, because it is the difference between "this map has
     odd corners" and "this question has no kind for civic places".

     Each place leads back to its own pin, so the row is a way INTO the map
     rather than a report about it. */
  function silentPlacesEl(L, col) {
    var gj = DATA[L.id];
    var feats = (gj && gj.features) || [];
    var box = el("div", "leg-silent");
    var mine = [];
    feats.forEach(function (f, i) {
      var v = String((f.properties || {})[col] || "").trim();
      if (!v) mine.push({ f: f, i: i });
    });
    // what they share, counted the way the reading counts it
    var shared = {};
    mine.forEach(function (m) {
      var p = m.f.properties || {};
      var tags = {};
      String(p.categories || "").split(";").concat(String(p.labels || "").split(";"))
        .forEach(function (t) { t = t.trim(); if (t) tags[t.toLowerCase()] = t; });
      Object.keys(tags).forEach(function (k) {
        shared[k] = shared[k] || { word: tags[k], n: 0 };
        shared[k].n++;
      });
    });
    var common = Object.keys(shared).map(function (k) { return shared[k]; })
      .filter(function (x) { return x.n >= 3; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, 2);

    mine.slice(0, 12).forEach(function (m) {
      var p = m.f.properties || {};
      /* What to call it. The layer's own title column first — but a title
         column is not always a name: this one can be a list of tags, and
         "Culture; Heritage" tells a reader nothing about which place they are
         looking at. A list is not a name, so fall through to something that is. */
      var own = {};
      String(p.categories || "").split(";").concat(String(p.labels || "").split(";"))
        .forEach(function (t) { t = t.trim().toLowerCase(); if (t) own[t] = 1; });
      var pick = function (v) {
        v = String(v || "").trim();
        if (!v || v.indexOf(";") >= 0) return "";       // a list is not a name
        if (own[v.toLowerCase()]) return "";            // nor is one of its own tags
        return v;
      };
      var name = pick(p[(L.popup && L.popup.title) || "description"]) ||
        pick(p.description) || pick(p.name) || pick(p.title) || "a place";
      var b = el("button", "leg-silent-p", esc(name.slice(0, 60)));
      b.type = "button";
      /* The same road the words under a kind take. goToWord knows the thing this
         nearly got wrong: at low zoom a place can be folded inside a numbered
         disc, and flying to its coordinates would open a popup over the disc
         rather than over the place. */
      b.onclick = function (e) {
        e.preventDefault(); e.stopPropagation();
        var entry = (markersByLayer[L.id] || []).filter(function (x) { return x.f === m.f; })[0];
        if (entry) goToWord(L, [entry]);
      };
      box.appendChild(b);
    });
    if (mine.length > 12) {
      box.appendChild(el("div", "leg-silent-more", "and " + (mine.length - 12) + " more"));
    }
    if (common.length) {
      box.appendChild(el("div", "leg-silent-why",
        common.map(function (c) { return c.n + " of these say “" + c.word + "”"; }).join(", and ") +
        ". This question has no answer that takes them."));
    }
    return box;
  }

  function whyWordsEl(L, why) {
    var box = el("div", "leg-why");
    (why || []).forEach(function (it) {
      var w = typeof it === "string" ? { w: it, es: [] } : it;
      var many = (w.es || []).length > 1;
      var b = el("button", "leg-why-w", esc(w.w));
      b.type = "button";
      if (w.es && w.es.length) {
        b.classList.add("leg-why-go");
        b.title = many ? "Show the " + w.es.length + " places that say this" : "Show this place";
        b.setAttribute("aria-label", b.title + ": " + w.w);
        b.onclick = function (ev) { ev.stopPropagation(); goToWord(L, w.es); };
      } else {
        b.disabled = true;
      }
      box.appendChild(b);
    });
    return box;
  }

  function fitPoints(pts) {
    var b = new maplibregl.LngLatBounds(pts[0], pts[0]);
    pts.forEach(function (p) { b.extend(p); });
    map.fitBounds(b, { padding: 110, maxZoom: 13, duration: 600 });
  }

  /* ==================================================================
     SPIDERFY — members of a cluster that cannot be told apart by
     zooming fan out on click so each one can be reached. The wrap
     element stays MapLibre's (true lngLat — it pans for free); the
     inner .atlas-mnode takes a pure-CSS pixel displacement, so the fan
     holds its shape through a pan and the two transforms never fight.
     Pixel offsets only mean something at one zoom, so starting a zoom
     folds the fan instead of chasing it. Fans are fed by the CLUSTERS
     engine below — nothing is maintained while the user just browses.
  ================================================================== */
  var SPIDER = { items: null, anchor: null, svg: null, pop: null, cid: null };
  var FAN_GAP = 28;     // displaced pins keep at least a marker-width apart
  var FAN_MAX = 100;    // a fan past this stops being reachable and starts being decoration

  // fan feet in px around (0,0): a ring while neighbours fit, an archimedean
  // spiral past 8 (a ring wide enough for many pins drifts too far out).
  // gap = how far apart neighbouring feet must stay — a marker-width, wider
  // when the fanned pins wear crowns.
  function fanFeet(n, gap) {
    var feet = [], i;
    if (n <= 8) {
      // ring radius grows so neighbouring pins stay a marker-width apart
      var r = Math.max(34, (gap / 2 + 2) / Math.sin(Math.PI / n));
      for (i = 0; i < n; i++) {
        var a = (2 * Math.PI * i) / n - Math.PI / 2;
        feet.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      return feet;
    }
    var angle = 0, leg = 30, cx = 0, cy = 0;
    for (i = 0; i < n; i++) {
      angle += (gap + 5) / leg;             // a constant arc between feet
      feet.push([leg * Math.cos(angle), leg * Math.sin(angle)]);
      cx += feet[i][0] / n; cy += feet[i][1] / n;
      leg += 2 * Math.PI * 4.5 / angle;     // creep outward as the spiral winds
    }
    // recentre the spiral so the fan sits around the anchor, not to one side
    for (i = 0; i < n; i++) { feet[i][0] -= cx; feet[i][1] -= cy; }
    return feet;
  }

  /* ==================================================================
     CLUSTERS — where pins would collide they are drawn once, as a
     counted disc. The old approach did this by hand in screen space (a
     grid walk over every visible marker after every pan); honest, but
     it was ours to pay for on the main thread, and it knew nothing of
     zoom levels beyond "this one". MapLibre's GeoJSON source has
     supercluster built in: hand it the points and it keeps the whole
     zoom hierarchy in its worker — spatial index, per-tile queries,
     viewport culling, and it hands back `point_count`, expansion zooms
     and member lists. We keep exactly one piece of bookkeeping: which
     pins are currently swallowed by a disc, so their DOM markers can
     step aside.

     The split of labour is deliberate. Clusters are GL layers (a
     circle and its count) because that is where scale lives: thousands
     of points cost the style nothing, and only what intersects the
     viewport is ever computed or drawn. The pins themselves STAY DOM
     markers — the per-category colour and icon, the hover lift and the
     fan's CSS displacement are all DOM-native, and an atlas rarely
     shows more than a few hundred UNclustered pins at once, which is
     exactly the population DOM markers are good for. All marker layers
     share ONE clustered source: two layers listing the same place must
     fold into one disc that says 2, not two discs that each say 1 —
     the arithmetic (discs + lone pins = every visible marker) is what
     keeps the map honest.

     The radius is the pin's own diameter: a disc forms only where pins
     would genuinely overlap, never where they are merely neighbourly.
     Bespoke atlases whose pin spacing was chosen by a person keep
     looking exactly as designed; dense contributed layers collapse
     into legible counts.
  ================================================================== */
  var CLUSTER_SRC = "atlas-cluster-src";
  var CLUSTER_BOUNDS_SRC = "atlas-cluster-bounds-src";
  var CLUSTER_LAYER = "atlas-cluster-disc";
  var MERGED_SRC = "atlas-cluster-merged-src";
  var MERGED_LAYER = "atlas-cluster-merged-disc";
  // the disc's ink by count bracket: Ink Soft (#5A5751), a step darker, Ink
  var DISC_INK = ["#5A5751", "#3F3C37", "#24211D"];
  var DISC_R = [13, 17, 22];          // disc radius by bracket (<10, 10–49, 50+)
  function discBracket(n) { return n >= 50 ? 2 : n >= 10 ? 1 : 0; }
  function discPaint() {
    return {
      "circle-color": ["step", ["get", "point_count"], DISC_INK[0], 10, DISC_INK[1], 50, DISC_INK[2]],
      "circle-radius": ["step", ["get", "point_count"], DISC_R[0], 10, DISC_R[1], 50, DISC_R[2]],
      "circle-stroke-color": "#FFFFFF",
      "circle-stroke-width": 2
    };
  }
  function countLayout() {
    return {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": [GLYPH_FONTS.bold],
      "text-size": ["step", ["get", "point_count"], 12, 10, 13, 50, 14],
      // the count IS the feature — it must never lose a placement contest;
      // it does claim its ground, though, so a pin's name (PIN NAMES below)
      // is dropped rather than written across it
      "text-allow-overlap": true,
      "text-ignore-placement": false
    };
  }
  var CLUSTER_RADIUS = 20;   // = pin diameter: fold only what truly collides
  // With keys switched on a pin wears rows beside it and its true footprint
  // grows with the data, so "truly collides" starts further out — the engine
  // folds at the mean footprint of the pins wearing rows (keyedFoldRadius),
  // recomputed on every toggle.
  var CLUSTER = { ready: false, off: false, wired: false, radiusNow: CLUSTER_RADIUS,
                  hovering: false, hoverId: null,
                  byKey: {}, boundsCache: {}, refreshTimer: null, syncTimer: null };

  // Marker entries the reader can currently see, layer by layer: layer on,
  // not folded behind its own zoom badge, not hidden by search. This is the
  // clustering population — nothing else may fold into a disc.
  function clusterEntries() {
    var out = [];
    (MANIFEST.layers || []).forEach(function (L) {
      if (L._visible === false) return;
      if (L.cluster && L._clusterMarker && map.getZoom() < L.cluster.belowZoom) return;
      (markersByLayer[L.id] || []).forEach(function (e, i) {
        if (e.hidden) return;
        out.push({ L: L, e: e, key: L.id + "|" + i });
      });
    });
    return out;
  }

  // The engine is optional equipment: without glyphs in the style there is
  // no way to draw a legible count, and a disc that hides pins while saying
  // nothing would be worse than the pile it replaces. In that case pins
  // simply never fold.
  function ensureClusterEngine() {
    if (CLUSTER.ready) return true;
    if (CLUSTER.off || !map) return false;
    var style = map.getStyle();
    if (!style || !style.glyphs) { CLUSTER.off = true; return false; }
    map.addSource(CLUSTER_SRC, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      cluster: true,
      clusterRadius: CLUSTER.radiusNow,
      // Clustering runs through the deepest reachable tile, so a group that
      // cannot separate is still a cluster AT max zoom — the click handler
      // reads "expansion zoom past the map's ceiling" as "these can never
      // part" and fans them out instead of pretending a zoom would help.
      clusterMaxZoom: Math.floor(map.getMaxZoom())
    });
    map.addSource(CLUSTER_BOUNDS_SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    // hover footprint first, so the discs and their counts draw above it
    map.addLayer({
      id: "atlas-cluster-bounds-fill", type: "fill", source: CLUSTER_BOUNDS_SRC,
      paint: { "fill-color": DISC_INK[0], "fill-opacity": 0.08 }
    });
    map.addLayer({
      id: "atlas-cluster-bounds-line", type: "line", source: CLUSTER_BOUNDS_SRC,
      paint: { "line-color": DISC_INK[0], "line-width": 1.2, "line-dasharray": [2, 2], "line-opacity": 0.5 }
    });
    // Size brackets: small (<10), medium (10–50), large (50+). One ink
    // deepening with count — a scale, not a category, because count is a
    // quantity. Ink, not Leaf: a green disc read as one of the key's colours
    // ("Green Space"), and a disc is not a kind of place, it is a count. The
    // white ring lifts the disc off any basemap the way the pins' own white
    // fill does. Contrast of the white count: 7.0:1 on the palest step.
    map.addLayer({
      id: CLUSTER_LAYER, type: "circle", source: CLUSTER_SRC,
      filter: ["has", "point_count"],
      paint: discPaint()
    });
    map.addLayer({
      id: "atlas-cluster-count", type: "symbol", source: CLUSTER_SRC,
      filter: ["has", "point_count"],
      layout: countLayout(),
      paint: { "text-color": "#FFFFFF" }
    });
    /* The merged discs (see MERGED below): where two discs, or a disc and a
       lone pin, would land on each other at the closest zoom, they are
       drawn once here as one disc, and the originals are filtered out. Same
       look, same source shape, so nothing tells them apart — which is the
       point. */
    map.addSource(MERGED_SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: MERGED_LAYER, type: "circle", source: MERGED_SRC, paint: discPaint() });
    map.addLayer({ id: "atlas-cluster-merged-count", type: "symbol", source: MERGED_SRC,
      layout: countLayout(), paint: { "text-color": "#FFFFFF" } });
    wireClusterEvents();
    CLUSTER.ready = true;
    return true;
  }

  function clusterAt(pt) {
    if (!CLUSTER.ready || !map.getLayer(CLUSTER_LAYER)) return null;
    var hits = map.queryRenderedFeatures(pt, { layers: [CLUSTER_LAYER, MERGED_LAYER] });
    return hits.length ? hits[0] : null;
  }

  // The cluster source can be torn down and rebuilt (the fold radius changes
  // with the pins' width — see clusterTeardown), but these handlers are wired
  // once for the page: MapLibre delegates them by layer id, so they find the
  // re-added layers by name, and wiring twice would fire every click twice.
  function wireClusterEvents() {
    if (CLUSTER.wired) return;
    CLUSTER.wired = true;
    map.on("click", CLUSTER_LAYER, function (e) {
      var f = e.features && e.features[0];
      if (f) clusterClick(f);
    });
    map.on("mousemove", CLUSTER_LAYER, function (e) {
      var f = e.features && e.features[0];
      if (!f) return;
      CLUSTER.hovering = true;
      map.getCanvas().style.cursor = "pointer";
      if (SPIDER.items) return;               // the fan owns the stage
      var cid = f.properties.cluster_id;
      var p = map.project(f.geometry.coordinates.slice());
      var r = f.properties.point_count >= 50 ? 22 : f.properties.point_count >= 10 ? 17 : 13;
      showHint(f.properties.point_count + " places here", { x: p.x, y: p.y - r }, "cl|" + cid);
      showClusterBounds(cid, f.properties.point_count);
    });
    map.on("mouseleave", CLUSTER_LAYER, function () {
      CLUSTER.hovering = false;
      map.getCanvas().style.cursor = "";
      if (typeof HINT.key === "string" && HINT.key.indexOf("cl|") === 0) hideHintSoon();
      hideClusterBounds();
    });
    // a merged disc answers a click and a hover the same way its parts did
    map.on("click", MERGED_LAYER, function (e) {
      var f = e.features && e.features[0];
      if (f) mergedClick(f);
    });
    map.on("mousemove", MERGED_LAYER, function (e) {
      var f = e.features && e.features[0];
      if (!f) return;
      CLUSTER.hovering = true;
      map.getCanvas().style.cursor = "pointer";
      if (SPIDER.items) return;
      var p = map.project(f.geometry.coordinates.slice());
      showHint(f.properties.point_count + " places here", { x: p.x, y: p.y - DISC_R[discBracket(f.properties.point_count)] }, "cl|m" + f.properties.mid);
    });
    map.on("mouseleave", MERGED_LAYER, function () {
      CLUSTER.hovering = false;
      map.getCanvas().style.cursor = "";
      if (typeof HINT.key === "string" && HINT.key.indexOf("cl|") === 0) hideHintSoon();
    });
    // pans are the tile machinery's problem; we only re-read the answer
    map.on("moveend", scheduleClusterSync);
    map.on("zoomend", scheduleClusterSync);
    // a hover footprint outlives its disc the moment the zoom changes (the
    // tree reshapes and no mouseleave ever fires under a moving map)
    map.on("zoomstart", hideClusterBounds);
    map.on("data", function (e) {
      if (e.sourceId === CLUSTER_SRC && e.isSourceLoaded) scheduleClusterSync();
    });
    wireHintGlobals();
  }

  // Clicking a disc asks supercluster where the group splits. If that zoom
  // is reachable, fly there — framed on the members' own bounds, not just
  // the centroid, so the reader lands on the group. If it is NOT reachable
  // (coincident members, or the map already at its ceiling), zooming is a
  // lie we refuse to tell: fan the members out instead.
  function clusterClick(f) {
    var cid = f.properties.cluster_id;
    var n = f.properties.point_count;
    var at = f.geometry.coordinates.slice();
    if (SPIDER.items) {
      var same = SPIDER.cid === cid;
      spiderCollapse();
      if (same) return;      // clicking the fan's own centre folds it, full stop
    }
    var src = map.getSource(CLUSTER_SRC);
    if (!src) return;
    var maxZ = map.getMaxZoom();
    Promise.all([
      src.getClusterExpansionZoom(cid),
      src.getClusterLeaves(cid, Math.min(n, FAN_MAX), 0)
    ]).then(function (res) {
      var z = res[0], leaves = res[1];
      if (z > maxZ || map.getZoom() >= maxZ - 0.05) { spiderfyLeaves(cid, at, leaves); return; }
      var b = leavesBounds(leaves);
      if (b) map.fitBounds(b, { padding: 80, maxZoom: Math.min(z + 0.25, maxZ), duration: 500 });
      else map.easeTo({ center: at, zoom: Math.min(z + 0.25, maxZ), duration: 500 });
    }).catch(function () {});   // a stale cluster id (source just rebuilt) is a no-op, not a crash
  }

  function leavesBounds(leaves) {
    if (!leaves || !leaves.length) return null;
    var c0 = leaves[0].geometry.coordinates;
    var b = new maplibregl.LngLatBounds(c0, c0);
    leaves.forEach(function (l) { b.extend(l.geometry.coordinates); });
    return b;
  }

  // A fan is DOM pins again: look each leaf up by the key it carried into
  // the source, reveal those markers, and hand them to the spiderfy that
  // has always owned the geometry.
  function spiderfyLeaves(cid, anchor, leaves) {
    var items = [];
    leaves.forEach(function (l) {
      var it = CLUSTER.byKey[l.properties && l.properties.__k];
      if (it) { it.e._fanned = true; items.push(it); }
    });
    if (!items.length) return;
    hideClusterBounds();
    (MANIFEST.layers || []).forEach(paintMarkerDisplay);
    SPIDER.cid = cid;
    spiderfy(items, anchor);
  }

  // The footprint under a hovered disc: the members' geographic bounding
  // box, drawn faint — "this disc stands for roughly here". Members come
  // back async; by then the pointer may be on a different disc, so answers
  // carry the id they were asked about. Boxes are cached per cluster id,
  // and the cache lives exactly as long as one build of the source (the
  // ids are only stable within it).
  function showClusterBounds(cid, n) {
    if (CLUSTER.hoverId === cid) return;
    CLUSTER.hoverId = cid;
    var cached = CLUSTER.boundsCache[cid];
    if (cached) { setClusterBounds(cached); return; }
    var src = map.getSource(CLUSTER_SRC);
    if (!src) return;
    src.getClusterLeaves(cid, n || 1000, 0).then(function (leaves) {
      var b = leavesBounds(leaves);
      if (!b) return;
      var ring = [[b.getWest(), b.getSouth()], [b.getEast(), b.getSouth()],
                  [b.getEast(), b.getNorth()], [b.getWest(), b.getNorth()],
                  [b.getWest(), b.getSouth()]];
      CLUSTER.boundsCache[cid] = ring;
      if (CLUSTER.hoverId === cid && !SPIDER.items) setClusterBounds(ring);
    }).catch(function () {});
  }
  function setClusterBounds(ring) {
    var src = map.getSource(CLUSTER_BOUNDS_SRC);
    if (src) src.setData({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } });
  }
  function hideClusterBounds() {
    CLUSTER.hoverId = null;
    var src = map.getSource(CLUSTER_BOUNDS_SRC);
    if (src) src.setData({ type: "FeatureCollection", features: [] });
  }

  function scheduleClusterRefresh() {
    if (CLUSTER.refreshTimer) clearTimeout(CLUSTER.refreshTimer);
    CLUSTER.refreshTimer = setTimeout(function () { CLUSTER.refreshTimer = null; refreshClusterIndex(); }, 60);
  }

  // Undo ensureClusterEngine so the next refresh can rebuild the source with a
  // different fold radius. A GeoJSON source's clusterRadius is fixed at
  // creation, so widening it (two-key pins) means starting the engine over.
  // Handlers stay wired — see wireClusterEvents.
  function clusterTeardown() {
    if (!CLUSTER.ready) return;
    clearMerged();
    ["atlas-cluster-count", CLUSTER_LAYER, "atlas-cluster-bounds-line", "atlas-cluster-bounds-fill",
     "atlas-cluster-merged-count", MERGED_LAYER].forEach(function (id) {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(CLUSTER_SRC)) map.removeSource(CLUSTER_SRC);
    if (map.getSource(CLUSTER_BOUNDS_SRC)) map.removeSource(CLUSTER_BOUNDS_SRC);
    if (map.getSource(MERGED_SRC)) map.removeSource(MERGED_SRC);
    CLUSTER.ready = false;
    CLUSTER.byKey = {};
    CLUSTER.boundsCache = {};
    CLUSTER.hoverId = null;
  }

  // Rebuild the clustered source from whatever is currently visible. Runs
  // on layer toggles, search and badge folds — never on mere pans. Entries
  // new to the source stay visible until the first sync says otherwise
  // (optimistic, like the restack this replaces): a moment of overlap reads
  // better than pins blinking off and back on.
  function refreshClusterIndex() {
    if (!map) return;
    // every rebuild reconciles the fold distance with the pins' current
    // footprint; atlases with no keys on never leave CLUSTER_RADIUS, so
    // nothing is torn down
    var want = keyedFoldRadius();
    if (CLUSTER.radiusNow !== want) { clusterTeardown(); CLUSTER.radiusNow = want; }
    if (!ensureClusterEngine()) return;
    if (SPIDER.items) { scheduleClusterRefresh(); return; }   // never re-index under an open fan
    var feats = [], byKey = {};
    clusterEntries().forEach(function (it) {
      byKey[it.key] = it;
      if (!CLUSTER.byKey[it.key]) it.e._clustered = false;
      feats.push({ type: "Feature", geometry: it.e.f.geometry, properties: { __k: it.key } });
    });
    // entries that just LEFT the source must not stay hidden by a stale flag
    for (var k in CLUSTER.byKey) { if (!byKey[k]) CLUSTER.byKey[k].e._clustered = false; }
    clearMerged(true);   // a fresh index means fresh verdicts; the merge re-reads them
    CLUSTER.byKey = byKey;
    CLUSTER.boundsCache = {};
    hideClusterBounds();
    var src = map.getSource(CLUSTER_SRC);
    if (src) src.setData({ type: "FeatureCollection", features: feats });
    scheduleClusterSync();
  }

  function scheduleClusterSync() {
    if (CLUSTER.syncTimer) clearTimeout(CLUSTER.syncTimer);
    CLUSTER.syncTimer = setTimeout(function () { CLUSTER.syncTimer = null; syncLeafVisibility(); }, 90);
  }

  // Ask the source which of its points are, right now, standing alone in
  // the viewport's tiles: those get their DOM pin; everything else is
  // inside some disc — or outside the view, which for a DOM node amounts
  // to the same thing (no element to lay out). This is the whole viewport-
  // rendering story for pins, and it is a read, not a computation: the
  // spatial work already happened in the source's worker.
  function syncLeafVisibility() {
    if (!map || !CLUSTER.ready || SPIDER.items) return;
    // the zoom may have moved the keyed fold distance a step (keyedFoldRadius):
    // rebuild first — reading leaves out of an engine built for another zoom
    // would paint pins with a verdict about to be replaced
    if (keyedFoldRadius() !== CLUSTER.radiusNow) { refreshClusterIndex(); return; }
    var loose = {};
    try {
      map.querySourceFeatures(CLUSTER_SRC, { filter: ["!", ["has", "point_count"]] }).forEach(function (f) {
        if (f.properties && f.properties.__k) loose[f.properties.__k] = 1;
      });
    } catch (err) { return; }
    var touched = {};
    for (var k in CLUSTER.byKey) {
      var it = CLUSTER.byKey[k];
      it.e._clustered = !loose[k];
      touched[it.L.id] = it.L;
    }
    for (var id in touched) paintMarkerDisplay(touched[id]);
    // every keyed layer's fold note re-reads the fresh verdicts — including
    // layers whose pins all left the population (search can empty one)
    (MANIFEST.layers || []).forEach(function (L) { if (L._foldEl) updateFoldNote(L); });
    mergeOverlaps();
  }

  /* ==================================================================
     MERGED DISCS — what the engine cannot promise, checked on screen.

     supercluster folds pins that fall within the fold radius of a cluster's
     first member, and puts the disc at the members' mean. Two discs' means
     can therefore land closer than a disc is wide — seen west of Bengaluru
     at the closest zoom, a "9" and an "8" nine pixels apart, their numbers
     run together — and a lone pin standing just outside a disc's radius is
     drawn OVER it (pins are DOM, discs are canvas), hiding its number: the
     "16" east of the city read "6". Neither is fixable by the fold radius:
     it is the pin's own width by design, so pins that do not collide are
     not folded.

     So after every verdict the discs and lone pins in view are measured in
     screen pixels, and any that touch are drawn once, as one disc that
     counts them all. Its parts are filtered out (discs) or hidden (pins);
     the pin's marker keeps its place in the list and in search. Clicking
     the merged disc does what clicking either part did: zoom in where a
     zoom would separate them, fan them out where it would not. The whole
     pass is a read of what is on screen, and it runs after the engine has
     spoken, never instead of it.
  ================================================================== */
  var MERGED = { feats: [], byId: {}, hiddenDiscs: [], seq: 0 };
  var MERGE_GAP = 3;   // discs (and a disc and a pin) keep at least this many pixels apart

  function clearMerged(quiet) {
    var had = MERGED.feats.length;
    for (var k in CLUSTER.byKey) CLUSTER.byKey[k].e._absorbed = false;
    MERGED.feats = []; MERGED.byId = {}; MERGED.hiddenDiscs = [];
    if (!had || !map) return;
    try {
      if (map.getLayer(CLUSTER_LAYER)) map.setFilter(CLUSTER_LAYER, ["has", "point_count"]);
      if (map.getLayer("atlas-cluster-count")) map.setFilter("atlas-cluster-count", ["has", "point_count"]);
      var src = map.getSource(MERGED_SRC);
      if (src) src.setData({ type: "FeatureCollection", features: [] });
    } catch (e) {}
    if (!quiet) (MANIFEST.layers || []).forEach(paintMarkerDisplay);
  }

  function mergeOverlaps() {
    if (!map || !CLUSTER.ready || SPIDER.items || !map.getLayer(CLUSTER_LAYER)) return;
    var items = [], seen = {};
    // the discs on screen, once each (a disc on a tile seam is reported twice)
    // read from the source, not the drawn layer: the drawn layer is missing
    // whatever the last merge filtered out, and reading it would free those
    // discs every other pass
    var discs = [];
    try { discs = map.querySourceFeatures(CLUSTER_SRC, { filter: ["has", "point_count"] }); } catch (e) { return; }
    // measured against the engine's own answer, not against the last merge;
    // a pin hidden by the last merge must come back if this one frees it
    var hadBefore = MERGED.feats.length > 0;
    clearMerged(true);
    var w = map.getContainer().clientWidth, h = map.getContainer().clientHeight;
    discs.forEach(function (f) {
      var cid = f.properties.cluster_id;
      if (seen[cid]) return;
      seen[cid] = 1;
      var n = f.properties.point_count;
      var p = map.project(f.geometry.coordinates.slice());
      if (p.x < -60 || p.y < -60 || p.x > w + 60 || p.y > h + 60) return;   // off screen
      items.push({ disc: cid, n: n, x: p.x, y: p.y, r: DISC_R[discBracket(n)] + 2, lngLat: f.geometry.coordinates.slice() });
    });
    if (!items.length) { if (hadBefore) (MANIFEST.layers || []).forEach(paintMarkerDisplay); return; }
    // the lone pins on screen: a pin stands on its point, 20 wide and 28 tall
    for (var k in CLUSTER.byKey) {
      var it = CLUSTER.byKey[k];
      if (it.e._clustered || it.e.hidden || it.L._visible === false) continue;
      var q = map.project(it.e.mk.getLngLat());
      if (q.x < -30 || q.y < -30 || q.x > w + 30 || q.y > h + 30) continue;
      // a pin wearing key rows is wider on the side the rows sit (see
      // updateRowFlips): its footprint grows that way by the rows' width
      var rw = it.e._rowsW || 0;
      var flip = rw && it.e._rowsEl && it.e._rowsEl.classList.contains("flip");
      items.push({ pin: it, n: 1, x: q.x + (flip ? -rw / 2 : rw / 2), y: q.y - 14, r: 12 + rw / 2, lngLat: it.e.mk.getLngLat() });
    }
    // group everything that touches (a pin touching a pin is the engine's
    // job and is left alone: only groups holding a disc are merged)
    var parent = items.map(function (_, i) { return i; });
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    for (var i = 0; i < items.length; i++) {
      for (var j = i + 1; j < items.length; j++) {
        if (items[i].pin && items[j].pin) continue;
        var dx = items[i].x - items[j].x, dy = items[i].y - items[j].y;
        var lim = items[i].r + items[j].r + MERGE_GAP;
        if (dx * dx + dy * dy < lim * lim) parent[find(i)] = find(j);
      }
    }
    var groups = {};
    items.forEach(function (it, i) { var g = find(i); (groups[g] = groups[g] || []).push(it); });
    var feats = [], hidden = [];
    for (var g in groups) {
      var members = groups[g];
      if (members.length < 2) continue;
      var n = 0, sx = 0, sy = 0, discIds = [], pinKeys = [];
      members.forEach(function (m) {
        n += m.n; sx += m.x * m.n; sy += m.y * m.n;
        if (m.disc != null) { discIds.push(m.disc); hidden.push(m.disc); }
        else { pinKeys.push(m.pin.key); m.pin.e._absorbed = true; }
      });
      var at = map.unproject([sx / n, sy / n]);
      var mid = ++MERGED.seq;
      MERGED.byId[mid] = { discs: discIds, pins: pinKeys, n: n, at: [at.lng, at.lat] };
      feats.push({ type: "Feature", geometry: { type: "Point", coordinates: [at.lng, at.lat] },
        properties: { mid: mid, point_count: n, point_count_abbreviated: n >= 1000 ? Math.round(n / 100) / 10 + "k" : String(n) } });
    }
    MERGED.feats = feats; MERGED.hiddenDiscs = hidden;
    if (feats.length) {
      var keep = ["all", ["has", "point_count"], ["!", ["in", ["get", "cluster_id"], ["literal", hidden]]]];
      try {
        map.setFilter(CLUSTER_LAYER, keep);
        map.setFilter("atlas-cluster-count", keep);
        map.getSource(MERGED_SRC).setData({ type: "FeatureCollection", features: feats });
      } catch (e) {}
    }
    if (feats.length || hadBefore) (MANIFEST.layers || []).forEach(paintMarkerDisplay);
  }

  // A merged disc: zoom in if any part would come apart at a reachable
  // zoom; otherwise fan every member — the discs' leaves and the pins.
  function mergedClick(f) {
    var m = MERGED.byId[f.properties.mid];
    if (!m) return;
    if (SPIDER.items) {
      var same = SPIDER.cid === "m" + f.properties.mid;
      spiderCollapse();
      if (same) return;      // clicking the fan's own centre folds it, full stop
    }
    var src = map.getSource(CLUSTER_SRC);
    if (!src) return;
    var maxZ = map.getMaxZoom();
    Promise.all(m.discs.map(function (cid) { return src.getClusterExpansionZoom(cid); }))
      .then(function (zs) {
        var z = Math.min.apply(null, zs.concat([Infinity]));
        if (m.discs.length && z <= maxZ && map.getZoom() < maxZ - 0.05) {
          map.easeTo({ center: m.at, zoom: Math.min(z + 0.25, maxZ), duration: 500 });
          return;
        }
        return Promise.all(m.discs.map(function (cid) { return src.getClusterLeaves(cid, FAN_MAX, 0); }))
          .then(function (lists) {
            var leaves = [];
            lists.forEach(function (l) { leaves = leaves.concat(l); });
            m.pins.forEach(function (k) { leaves.push({ properties: { __k: k } }); });
            spiderfyLeaves("m" + f.properties.mid, m.at, leaves.slice(0, FAN_MAX));
          });
      }).catch(function () {});
  }

  // every marker click lands here: a fanned pin opens its own popup (fan
  // stays); any other visible pin is a loner by construction — the engine
  // has already folded everything that overlaps — so it pops up directly
  function spiderClick(L, entry) {
    // the tapped pin is the chosen one: the Sindoor ring on the map, the
    // Sindoor name in the Map Browser, whichever way it was reached
    // an area's marker also rings its outline: the shape has a feature state
    if (entry.f && entry.f._row != null) selectRow(L, entry.f._row, entry.shape ? shapeRef(L, entry.shape, entry.f._row) : null);
    if (SPIDER.items) {
      for (var i = 0; i < SPIDER.items.length; i++) {
        var it = SPIDER.items[i];
        if (it.e === entry) {
          if (SPIDER.pop) SPIDER.pop.remove();   // one member speaks at a time
          SPIDER.pop = openPopup(it.L, it.e.f, it.e.mk.getLngLat(), it.off, fanAnchor(it.foot));
          return;
        }
      }
      spiderCollapse(); // a marker outside the open fan: fold it first
    }
    openPopup(L, entry.f, entry.mk.getLngLat());
  }

  // A fanned pin's popup must not squat on its siblings: anchor it on the
  // side that faces the fan's centre, so the body opens outward, away from
  // the ring. Eight sectors, eight anchors. (Screen y grows downward, so a
  // positive angle means the foot points below the centre.)
  function fanAnchor(foot) {
    var a = Math.atan2(foot[1], foot[0]) * 180 / Math.PI;
    if (a >= -22.5 && a < 22.5) return "left";
    if (a >= 22.5 && a < 67.5) return "top-left";
    if (a >= 67.5 && a < 112.5) return "top";
    if (a >= 112.5 && a < 157.5) return "top-right";
    if (a >= -67.5 && a < -22.5) return "bottom-left";
    if (a >= -112.5 && a < -67.5) return "bottom";
    if (a >= -157.5 && a < -112.5) return "bottom-right";
    return "right";
  }

  function spiderfy(stack, anchor) {
    wireSpider();
    hideHint();
    var a = map.project(anchor);
    // pins wearing rows need elbow room for their widest block: neighbours
    // in the fan stay a whole footprint apart, plus a little air
    var gap = FAN_GAP;
    stack.forEach(function (it) {
      var w = PIN_W + (it.e._rowsW || 0) + 8;
      if (w > gap) gap = w;
    });
    var feet = fanFeet(stack.length, gap);
    SPIDER.anchor = anchor;
    SPIDER.items = stack.map(function (it, i) {
      // offset from the member's own point to its foot; both endpoints shift
      // by the same delta when the map pans, so it stays right until a zoom
      var p = map.project(it.e.mk.getLngLat());
      var off = [a.x + feet[i][0] - p.x, a.y + feet[i][1] - p.y];
      var w = it.e.mk.getElement();
      w.style.setProperty("--fan-x", off[0] + "px");
      w.style.setProperty("--fan-y", off[1] + "px");
      w.classList.add("fanned");
      return { L: it.L, e: it.e, off: off, foot: feet[i] };
    });
    // the fan is the one thing happening: veil everything that is not it
    dimEl();
    map.getContainer().classList.add("atlas-fanned");
    drawLegs();
  }

  // A translucent paper wash between the tiles and the fan. It lives in the
  // canvas container right after the canvas, so GL layers (including the
  // cluster discs) sit under it while the legs and the fanned pins — later
  // siblings — paint above. pointer-events stays none in CSS: the click
  // that should fold the fan must reach the map beneath.
  var DIM = { el: null };
  function dimEl() {
    if (!DIM.el) {
      DIM.el = el("div", "atlas-dim");
      map.getCanvasContainer().insertBefore(DIM.el, map.getCanvas().nextSibling);
    }
    return DIM.el;
  }

  function spiderCollapse() {
    if (!SPIDER.items) return;
    SPIDER.items.forEach(function (it) {
      var w = it.e.mk.getElement();
      it.e._fanned = false;
      w.classList.remove("fanned");
      w.style.removeProperty("--fan-x");
      w.style.removeProperty("--fan-y");
    });
    SPIDER.items = null;
    SPIDER.anchor = null;
    SPIDER.cid = null;
    map.getContainer().classList.remove("atlas-fanned");
    if (SPIDER.svg) { SPIDER.svg.remove(); SPIDER.svg = null; }
    // a popup opened from a fanned pin points at a spot that no longer exists
    if (SPIDER.pop) { SPIDER.pop.remove(); SPIDER.pop = null; }
    // the members go back behind their disc, and the engine re-reads reality
    (MANIFEST.layers || []).forEach(paintMarkerDisplay);
    scheduleClusterSync();
  }

  // thin leader lines from the shared point to each displaced pin — an SVG
  // overlay in the canvas container (above the tiles, below the markers),
  // redrawn on every map move. Screen-space like the fan itself.
  var SVG_NS = "http://www.w3.org/2000/svg";
  function drawLegs() {
    if (!SPIDER.items) return;
    if (!SPIDER.svg) {
      SPIDER.svg = document.createElementNS(SVG_NS, "svg");
      SPIDER.svg.setAttribute("class", "spider-legs");
      // after the veil when there is one: legs above the wash, below the pins
      var after = (DIM.el && DIM.el.parentNode) ? DIM.el : map.getCanvas();
      map.getCanvasContainer().insertBefore(SPIDER.svg, after.nextSibling);
    }
    var box = map.getContainer().getBoundingClientRect();
    SPIDER.svg.setAttribute("width", box.width);
    SPIDER.svg.setAttribute("height", box.height);
    var a = map.project(SPIDER.anchor);
    SPIDER.items.forEach(function (it, i) {
      var ln = SPIDER.svg.childNodes[i];
      if (!ln) {
        ln = document.createElementNS(SVG_NS, "line");
        ln.setAttribute("class", "spider-leg");
        SPIDER.svg.appendChild(ln);
      }
      ln.setAttribute("x1", a.x); ln.setAttribute("y1", a.y);
      ln.setAttribute("x2", a.x + it.foot[0]); ln.setAttribute("y2", a.y + it.foot[1]);
    });
  }

  var spiderWired = false;
  function wireSpider() {
    if (spiderWired) return;
    spiderWired = true;
    // a background click folds the fan — but a click on a cluster disc is
    // the disc's own business (its handler may be folding this fan to open
    // another); folding here too would undo what it just did
    map.on("click", function (e) { if (!clusterAt(e.point)) spiderCollapse(); });
    map.on("zoomstart", spiderCollapse);  // px offsets belong to one zoom level
    map.on("move", drawLegs);             // markers pan natively; legs follow here
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") spiderCollapse(); });
  }

  /* ==================================================================
     HOVER TOOLTIP — a symbol names itself when the pointer rests on it,
     so a dense map can be read without clicking through it. One element
     for the whole map, moved to whichever symbol is hovered: nothing is
     built per marker, and sliding along a row of pins repositions that
     single element instead of tearing one down and building the next
     (which flickers). It lives in the map container rather than inside
     the marker, so it can never disturb a spiderfied fan, and it never
     takes the pointer — clicks always reach the pin underneath.
  ================================================================== */
  var HINT = { el: null, key: null };
  var HINT_LIFT = 9;   // px between the tooltip's bottom and the symbol's top
  var HINT_EDGE = 6;   // never come closer than this to the map's edge
  // Hover is a pointer idea. On a touch screen the same gesture is a tap, which
  // opens the popup — a tooltip would only sit stranded on top of it.
  var HOVER_OK = !(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

  function hintEl() {
    if (!HINT.el) {
      HINT.el = el("div", "atlas-hint");
      HINT.el.setAttribute("aria-hidden", "true");  // decorative: the popup carries the real text
      map.getContainer().appendChild(HINT.el);
    }
    return HINT.el;
  }

  // `at` is the top-centre of the thing being labelled, in map-container px:
  // the tooltip is centred above it and clamped inside the container on all
  // four sides. `key` identifies the target, so re-entering the same one is a
  // no-op. Empty text and no rows means no tooltip at all (never an empty
  // bubble). `rows` (optional) is the key-by-key box from keyRowsEl: the
  // place's name stays the heading and the rows sit underneath, so a keyed
  // map can be read without walking back to the key panel.
  function showHint(text, at, key, rows) {
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    if (!HOVER_OK || (!text && !rows) || !at) { hideHint(); return; }
    var t = hintEl();
    if (key !== HINT.key) {
      if (rows) {
        t.textContent = "";
        if (text) t.appendChild(el("div", "hint-name", esc(text)));
        t.appendChild(rows);
      } else {
        t.textContent = text;
      }
      HINT.key = key;
    }
    t.classList.add("on");
    var box = map.getContainer().getBoundingClientRect();
    var w = t.offsetWidth, h = t.offsetHeight;   // measured with the text in place
    var x = clamp(at.x - w / 2, HINT_EDGE, box.width - w - HINT_EDGE);
    var y = clamp(at.y - h - HINT_LIFT, HINT_EDGE, box.height - h - HINT_EDGE);
    t.style.transform = "translate(" + Math.round(x) + "px," + Math.round(y) + "px)";
  }
  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi < lo ? lo : hi); }

  function hideHint() {
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    if (!HINT.el) return;
    HINT.el.classList.remove("on");
    HINT.key = null;
  }

  // Leaving a symbol defers the hide by a beat. Crossing the sliver of map
  // between two adjacent pins fires a leave then an enter; showHint cancels the
  // pending hide, so the tooltip slides across instead of blinking off and on.
  var hintTimer = null;
  function hideHintSoon() {
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(hideHint, 70);
  }

  var hintWired = false;
  function wireHintGlobals() {
    if (hintWired || !HOVER_OK) return;
    hintWired = true;
    // The tooltip is placed in screen px, so any camera change strands it.
    map.on("movestart", hideHint);
    map.on("zoomstart", hideHint);
    map.on("mouseout", hideHint);        // pointer left the map entirely
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") hideHint(); });
  }

  // DOM markers: hover is wired on the inner .atlas-mnode, not the wrap — a
  // fanned marker drops pointer events on its wrap, and the node is the part
  // that actually moves, so the rect we measure is the one the user sees.
  // `titleOf` and `rowsOf` are read at hover time; nothing is cached per
  // marker, so the rows always reflect the keys that are on right now.
  function wireMarkerHint(node, titleOf, rowsOf) {
    if (!HOVER_OK) return;
    wireHintGlobals();
    function show() {
      if (HINT.key === node) return;      // already ours — mousemove must not thrash layout
      var text = titleOf();
      var rows = rowsOf ? rowsOf() : null;   // built on entry, never per move
      if (!text && !rows) return;         // nothing to say about this pin: no tooltip, and no measuring
      showHint(text, nodeTop(node), node, rows);
    }
    node.addEventListener("mouseenter", show);
    node.addEventListener("mousemove", show);   // bring it back if a pan cleared it
    node.addEventListener("mouseleave", function () { if (HINT.key === node) hideHintSoon(); });
  }

  // top-centre of the pin in map-container px — measured on the pin itself so a
  // label underneath it never pushes the tooltip down
  function nodeTop(node) {
    var r = (node.firstElementChild || node).getBoundingClientRect();
    var box = map.getContainer().getBoundingClientRect();
    return { x: r.left + r.width / 2 - box.left, y: r.top - box.top };
  }

  // Circle layers (plain dots and the data-driven bubble kind) are drawn by the
  // GL style, not as DOM nodes, so their hover comes from the map: ask what is
  // rendered under the pointer, restricted to those layer ids.
  var hintSkip = null;   // last circle feature that resolved to no title
  function wireCircleHints() {
    if (!HOVER_OK) return;
    var targets = [];
    (MANIFEST.layers || []).forEach(function (L) {
      if (!L.popup) return;               // no popup spec, no title to show
      (L._ids || []).forEach(function (id) {
        if (/-circle$/.test(id) && map.getLayer(id)) targets.push({ id: id, L: L });
      });
    });
    if (!targets.length) return;
    wireHintGlobals();
    targets.forEach(function (t) {
      map.on("mousemove", t.id, function (e) {
        var f = e.features && e.features[0];
        if (!f) return;
        var key = t.id + "|" + (f.id != null ? f.id : coordKey(f));
        if (key === HINT.key || key === hintSkip) return;  // same bubble as last move
        map.getCanvas().style.cursor = "pointer";
        var text = popupTitleText(t.L, f.properties);
        // A bubble with nothing to say is remembered as such, so the rest of the
        // hover doesn't re-measure it on every mousemove.
        if (!text) { hintSkip = key; hideHint(); return; }
        hintSkip = null;
        showHint(text, circleTop(t.id, f), key);
      });
      map.on("mouseleave", t.id, function () {
        hintSkip = null;
        if (typeof HINT.key === "string" && HINT.key.indexOf(t.id + "|") === 0) hideHintSoon();
      });
    });
  }
  // vector features often carry no id; a point's own coordinates identify it
  function coordKey(f) {
    var g = f.geometry && f.geometry.coordinates;
    return Array.isArray(g) ? g.join(",") : "?";
  }

  // How far above a circle's centre its drawn edge sits. Bubble layers scale
  // the radius by value, and a paint expression can't be read back evaluated —
  // so ask the renderer instead: step up from the centre until the hit test
  // stops finding the layer. Coarse and capped, and only run when the hovered
  // feature changes.
  function circleTop(id, f) {
    var g = f.geometry && f.geometry.coordinates;
    if (!Array.isArray(g)) return null;
    var c = map.project(g), d = 0;
    while (d < 48 && map.queryRenderedFeatures([c.x, c.y - d - 4], { layers: [id] }).length) d += 4;
    return { x: c.x, y: c.y - d };
  }

  /* ==================================================================
     SEARCH — a hybrid box over marker layers: a query matches a feature
     against EVERY text-bearing property it carries (what the contributor
     uploaded and whatever enrichment added — both are just properties by the
     time a layer is committed), and on public atlases the server expands the
     query semantically (query → nearest vocabulary terms) so "temples" can find
     features tagged "heritage". Keyword works with no AI; semantic adds to it.
  ================================================================== */
  var searchTags = [], searchSeq = 0, searchTimer = null;
  var searchWord = "";   // the search as typed, for the line under the box; matching lowercases its own copy

  function tagFieldsOf(L) {
    var out = ((L.popup && L.popup.fields) || []).filter(function (f) { return f.type === "tags"; }).map(function (f) { return f.property; });
    if (L.markerBy && out.indexOf(L.markerBy) < 0) out.push(L.markerBy);
    return out;
  }
  /* A cell that arrived as a database's own idea of a list.

     LOKA keeps categories and labels in Postgres, and Postgres writes an array
     as {a,b,c}. That shape travelled all the way to the map unopened: a place
     whose categories were {Activities,Nature} showed two tags, "{Activities"
     and "Nature}", and a key wore its brace in its name. Every categories and
     labels value on the Cubbon Park atlas is written this way.

     The braces are the list, not part of the first and last word in it, so they
     come off before the words are separated. A quoted piece — Postgres quotes
     anything holding a comma or a space — loses its quotes with them.

     Only a brace-wrapped value that is not readable as JSON is treated this
     way, so a cell genuinely holding a record is left alone. */
  function unbrace(v) {
    var s = String(v == null ? "" : v).trim();
    if (s.charAt(0) !== "{" || s.charAt(s.length - 1) !== "}") return s;
    try { JSON.parse(s); return s; } catch (e) { /* not a record; it is a list */ }
    return s.slice(1, -1);
  }
  function unquotePiece(s) {
    var t = String(s == null ? "" : s).trim();
    if (t.length > 1 && t.charAt(0) === '"' && t.charAt(t.length - 1) === '"') {
      t = t.slice(1, -1).replace(/\\"/g, '"');
    }
    return t.trim();
  }

  function splitTags(v) {
    if (v == null) return [];
    return unbrace(v).split(/[;,]/)
      .map(function (s) { return unquotePiece(s).toLowerCase(); })
      .filter(Boolean);
  }
  function featureTagSet(L, f) { var s = {}; tagFieldsOf(L).forEach(function (p) { splitTags(f.properties[p]).forEach(function (t) { s[t] = 1; }); }); return s; }
  // Ids, urls, coordinates, colours and timestamps are noise in a search box —
  // they'd let a stray digit or date match every feature. Everything else that
  // carries letters is fair game. Mirrors the server's index coverage.
  function skipSearchProp(n) {
    n = String(n == null ? "" : n).toLowerCase();
    if (/(^|[^a-z])(id|ids|uuid|guid|url|uri|link|href|image|images|img|photo|photos|thumb|thumbnail|icon|lat|latitude|lon|lng|long|longitude|x|y|geom|geometry|wkt|color|colour)([^a-z]|$)/.test(n)) return true;
    return /(created|updated|modified|timestamp)/.test(n);
  }
  function cellText(v) {
    if (v == null) return "";
    if (Array.isArray(v)) return v.join("; ");
    if (typeof v === "object") return "";
    return String(v);
  }
  function skipSearchValue(v) {
    var s = cellText(v).trim();
    if (s.length < 2) return true;
    if (!/[a-z]/i.test(s)) return true;
    if (/^(https?:|www\.|data:|\/\/)/i.test(s)) return true;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(s)) return true;
    if (/^\d{4}-\d{2}-\d{2}[t ]/i.test(s)) return true;
    return false;
  }
  // cached on the feature: a search runs on every keystroke over every marker
  function featureText(L, f) {
    if (f._stext != null) return f._stext;
    var parts = [];
    for (var k in f.properties) {
      // a reason quotes words the place already carries, so counting it again
      // would weight those places twice in a search
      if (/^pattern_\d+_why$/.test(k)) continue;
      if (skipSearchProp(k) || skipSearchValue(f.properties[k])) continue;
      parts.push(cellText(f.properties[k]));
    }
    f._stext = parts.join(" · ").toLowerCase();
    return f._stext;
  }
  // The box is built from the manifest, before any layer data has arrived, so
  // the question here is "could this layer have text?": a contributed layer's
  // rows always carry text columns, and a declared popup means there is
  // something to read. syncSearchBox() removes the box after load if it turns
  // out nothing had text — that's what keeps the promise honest without hiding
  // the box from every atlas whose layers simply have no tag column.
  function manifestSearchable() {
    return (MANIFEST.layers || []).filter(function (L) {
      if (shapeSearchable(L)) return true;
      if (L.type !== "marker") return false;
      var p = L.popup || {};
      return !!(L.userLayer || L.markerBy || p.title || (p.fields && p.fields.length));
    });
  }
  /* Which SHAPE layers a search may touch. A pin layer only has to look like
     it could carry text (above); a shape layer has to be the data itself. The
     multispecies atlas draws each person as the region they work in, and the
     search there must find people — but Deoria's forests, wards and district
     boundaries have popups too, and they are the ground the data sits on.
     Typing "forest" and watching every forest polygon light up is noise, and
     it would change what Deoria's search has always done. So the rule is
     explicit: a shape layer is searchable when it was contributed through the
     wizard (userLayer) or the manifest says `searchable: true`. Anything in
     the base group stays out whatever it says. */
  function shapeSearchable(L) {
    if (L.type !== "fill" && L.type !== "polygon" && L.type !== "line") return false;
    if (L.group === "base") return false;
    return !!(L.userLayer || L.searchable === true);
  }
  /* Every feature learns its row number as its data arrives, on the feature
     (for the semantic hits the server reports by row) and, on a searchable
     shape layer, in its properties too — the map's paint can only read
     properties, and that number is how a fill knows whether it matched. A
     bare number never reaches a popup or a search: the fact rows skip "_"
     columns and featureText skips values with no letters. */
  function numberRows(L, gj) {
    var shape = shapeSearchable(L);
    ((gj && gj.features) || []).forEach(function (f, i) {
      f._row = i;
      if (shape && f.properties) f.properties._srow = i;
    });
    if (shape) findTwins(L, gj);
  }

  /* ==================================================================
     MAP BROWSER — a layer of your data is a collection

     The panel used to treat a contributed layer as a style — one switch,
     one swatch repeating the layer's name — when it is really eleven people,
     or sixty-six places. A reader could not tell how many were on the map,
     could not see their names, and could not reach the three whose shapes sat
     under somebody else's. So such a layer's row says what it holds ("11
     people"), opens into a list of names, and each name is a way in: the map
     goes there and the card opens, the same card a tap on the map gives.

     Which layers: the ones that ARE the data — a shape layer the search rule
     already admits (contributed, or opted in by the manifest; never the base
     group) and a contributed pin layer. Deoria's forests, wards and survey
     villages are the ground the data sits on, and keep their old rows.
  ================================================================== */
  function collectionLayer(L) {
    if (!L) return false;
    if (L.type === "marker") return !!L.userLayer;
    return shapeSearchable(L);
  }
  /* ONE FILE, ONE ROW. A file whose rows mostly named regions LOKA had
     outlines for, with a few that only had a point, goes on as two layers —
     the outlines, and "<name> · as points" (sameFileAs, cbe7356). In the
     engine they stay two; in the Map Browser the visitor sees one row, one
     switch and one count, because to them it is one file. The outlines
     layer is the row; its points twin is folded into it. */
  function layerById(id) {
    return (MANIFEST && MANIFEST.layers || []).filter(function (x) { return x.id === id; })[0] || null;
  }
  // the "· as points" half of a split file: named so by the server (pointsLabel)
  function looksLikeTwin(L) {
    return !!(L && L.sameFileAs && (L.id === L.sameFileAs + "-as-points" || /·\s*as points$/.test(L.label || "")));
  }
  // the points twin of a layer, if the file split that way — the first half
  // may itself be points (a category file puts each matched region's row at
  // the region's middle), so the pair is told apart by the twin's name
  function pairedTwin(L) {
    if (!L || !L.sameFileAs || looksLikeTwin(L)) return null;
    var t = layerById(L.sameFileAs);
    return t && t.sameFileAs === L.id && looksLikeTwin(t) ? t : null;
  }
  // the layer a points twin belongs under
  function pairedPrimary(L) {
    if (!looksLikeTwin(L)) return null;
    var p = layerById(L.sameFileAs);
    return p && pairedTwin(p) === L ? p : null;
  }
  // how a split file's halves are said: "6 as areas · 5 as points", or, when
  // the first half was placed at its regions' middles, "6 by region · 5 looked up"
  function splitWords(n, P, twin) {
    var areas = P.type === "fill" || P.type === "polygon";
    if (twin) return n + (areas ? " as points" : " looked up");
    return n + (areas ? (n === 1 ? " as area" : " as areas") : " by region");
  }
  // What the rows are called: what the manifest says ("people"), else places
  // for pins and areas for shapes. One of them is a person, a place, an area.
  function layerNoun(L) {
    return L.noun || (L.type === "marker" ? "places" : "areas");
  }
  function nounOne(noun) {
    return noun === "people" ? "person" : String(noun).replace(/s$/, "");
  }
  function countWords(n, noun) {
    return n + " " + (n === 1 ? nounOne(noun) : noun);
  }
  /* Two rows drawn as the same shape — two people who both work across the
     Western Ghats — are twins. On the map the top one hides the other from a
     tap, and only one of the two names can be written at the shared spot.
     Twins are found once, as the data lands, by a signature of the shape:
     its type, how many points it has, its corners and its first few points.
     That is not a proof of sameness, but two different regions that agree on
     all of it do not occur in practice, and the cost of a false twin is one
     extra name in a chooser. */
  function geomKey(g) {
    if (!g) return "";
    var n = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, head = [];
    walkCoords(g, function (c) {
      n++;
      if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0];
      if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1];
      if (head.length < 3) head.push(c[0] + "," + c[1]);
    });
    return g.type + "|" + n + "|" + [x0, y0, x1, y1].join(",") + "|" + head.join(";");
  }
  function findTwins(L, gj) {
    var byKey = {};
    ((gj && gj.features) || []).forEach(function (f) {
      var k = geomKey(f.geometry);
      (byKey[k] = byKey[k] || []).push(f._row);
    });
    ((gj && gj.features) || []).forEach(function (f) {
      var rows = byKey[geomKey(f.geometry)];
      f._twins = rows.length > 1 ? rows : null;
    });
  }
  // "Gijs Spoor & Vijay Ramesh"; three or more read "A, B & C"
  function joinNames(names) {
    names = names.filter(Boolean);
    if (names.length < 2) return names[0] || "";
    return names.slice(0, -1).join(", ") + " & " + names[names.length - 1];
  }
  // The rows a search runs over: a pin layer's markers, a shape layer's
  // features — each as { f } so one loop serves both.
  function searchRows(L) {
    if (markersByLayer[L.id]) return markersByLayer[L.id];
    if (!shapeSearchable(L) || !DATA[L.id]) return [];
    if (!L._srows) L._srows = (DATA[L.id].features || []).map(function (f) { return { f: f }; });
    return L._srows;
  }
  function layerHasText(L) {
    if (L._hasText == null) {
      L._hasText = searchRows(L).some(function (e) { return featureText(L, e.f).length > 1; });
    }
    return L._hasText;
  }
  // layers search can actually act on: rows on the map, carrying real text.
  // A layer with nothing searchable is left alone by a query rather than blanked.
  function searchableLayers() {
    return (MANIFEST.layers || []).filter(function (L) {
      return searchRows(L).length && layerHasText(L);
    });
  }
  function syncSearchBox() {
    var sc = $(".ctl-search"); if (!sc) return;
    sc.style.display = searchableLayers().length ? "" : "none";
  }
  function layerVocab() {
    var v = {};
    searchableLayers().forEach(function (L) { searchRows(L).forEach(function (e) { for (var t in featureTagSet(L, e.f)) v[t] = 1; }); });
    return Object.keys(v);
  }
  /* A pin that doesn't match is taken off the map; a shape that doesn't match
     stays, faded to a faint outline. Hiding it would leave a hole where a
     region was, and a faded region can still be tapped, which a hole cannot.
     The fade rides on each sub-layer's own opacity, wrapped in "does this row
     match", so a matching area keeps exactly the colour, outline, dot and
     name it had. The original values are kept the first time so that
     clearing puts them back rather than guessing. */
  var SEARCH_FADE = { "fill-opacity": 0.15, "line-opacity": 0.4, "circle-opacity": 0.25, "circle-stroke-opacity": 0.25, "text-opacity": 0.3 };
  function fadeProps(id) {
    var lay = map.getLayer(id); if (!lay) return [];
    return { fill: ["fill-opacity"], line: ["line-opacity"], circle: ["circle-opacity", "circle-stroke-opacity"], symbol: ["text-opacity"] }[lay.type] || [];
  }
  function applyShapeFade(L) {
    if (!map || !L._ids) return;
    var hits = [], any = false;
    searchRows(L).forEach(function (e) { if (e.hidden) any = true; else hits.push(e.f._row); });
    var ids = L._ids.filter(function (id) { return /-(fill|line|mark|label)$/.test(id); });
    if (!L._searchPaint) {
      L._searchPaint = {};
      ids.forEach(function (id) {
        fadeProps(id).forEach(function (p) {
          var v; try { v = map.getPaintProperty(id, p); } catch (e) {}
          L._searchPaint[id + "|" + p] = v == null ? 1 : v;
        });
      });
    }
    var hit = ["in", ["get", "_srow"], ["literal", hits]];
    ids.forEach(function (id) {
      fadeProps(id).forEach(function (p) {
        var orig = L._searchPaint[id + "|" + p];
        var v = any ? ["case", hit, orig, ["*", orig, SEARCH_FADE[p]]] : orig;
        try { map.setPaintProperty(id, p, v); } catch (e) {}
      });
    });
    /* Twins write one name for two rows (see labelPointSource). While a search
       is on, the matching twin's copy is placed first, so the name on the map
       is drawn at full strength when either of them matched. */
    var lbl = L.id + "-label";
    if (map.getLayer(lbl)) {
      if (!("_searchSort" in L)) { try { L._searchSort = map.getLayoutProperty(lbl, "symbol-sort-key"); } catch (e) { L._searchSort = null; } }
      var base = L._searchSort == null ? 0 : L._searchSort;
      try { map.setLayoutProperty(lbl, "symbol-sort-key", any ? ["+", ["case", hit, 0, 1e9], base] : L._searchSort); } catch (e) {}
    }
  }
  // after a search touches a layer's rows: pins re-draw, shapes re-paint
  function applyRowVisibility(L) {
    // an area layer with markers does both: its markers hide, its shading pales
    if (hasPins(L)) applyMarkerVisibility(L);
    if (!hasPins(L) || areaPins(L)) applyShapeFade(L);
    syncCollection(pairedPrimary(L) || L);   // the count in the panel narrows with the map
  }
  // The corners of every matching area, so the map can fit them. A pin is a
  // point; a shape contributes every point on its outline.
  function shapeBounds(L) {
    var b = null;
    searchRows(L).forEach(function (e) {
      if (e.hidden) return;
      // an area's marker entry keeps the whole shape on it (see makePinEntry)
      walkCoords((e.shape || e.f).geometry, function (c) { if (!b) b = new maplibregl.LngLatBounds(c, c); else b.extend(c); });
    });
    return b;
  }
  function walkCoords(g, fn) {
    if (!g) return;
    if (g.type === "GeometryCollection") return (g.geometries || []).forEach(function (x) { walkCoords(x, fn); });
    (function walk(c) { if (typeof c[0] === "number") fn(c); else c.forEach(walk); })(g.coordinates || []);
  }
  /* What the line under the box calls a row. A pin layer's rows are places;
     a shape layer's are areas unless the manifest names them ("people").
     Where the layers disagree, "places" covers both. */
  function searchNoun(layers) {
    var nouns = [];
    layers.forEach(function (L) {
      var n = L.noun || (markersByLayer[L.id] ? "places" : "areas");
      if (nouns.indexOf(n) < 0) nouns.push(n);
    });
    return nouns.length === 1 ? nouns[0] : "places";
  }
  // `lead` names what is being shown when it is not a typed search — a tapped
  // tag, say. Without it the line reads "5 of 66 shown", which is true and
  // says nothing about why.
  // `word` is the typed search on an atlas with shape layers: faded areas are
  // still on the map, so the line has to say what they were tested against —
  // "3 of 11 areas match ‘Telugu’" — and name the way back to all of them.
  // `noun` is what the rows are called (places, areas, people).
  function updateSearchCount(shown, total, pts, lead, word, noun) {
    var c = $("#atlas-search-count"); if (!c) return;
    if (shown == null) { c.hidden = true; c.textContent = ""; return; }
    c.hidden = false;
    noun = noun || "places";
    var one = noun === "people" ? "person" : noun.replace(/s$/, "");
    // a pressed kind counts against the whole layer: "12 of 66 places are Market"
    if (lead && lead.ofAll) {
      c.textContent = shown
        ? shown + " of " + total + " " + noun + (shown === 1 ? " is " : " are ") + lead.ofAll
        : "none of the " + total + " " + noun + " are " + lead.ofAll;
    } else if (lead) {
      c.textContent = shown
        ? shown + " " + (shown === 1 ? one : noun) + " " + lead
        : "no " + noun + " " + lead;
    } else if (word) {
      c.textContent = shown
        ? shown + " of " + total + " " + (total === 1 ? one : noun) + " match ‘" + word + "’"
        : "nothing matched ‘" + word + "’ — try another word";
    } else {
      c.textContent = shown ? (shown + " of " + total + " shown") : "nothing matched — try another word";
    }
    // a filter with no way out is a trap; the words name the way out
    if (lead || word) {
      var all = el("button", "ctl-search-go", "show all");
      all.type = "button";
      // the box empties too: a line that has gone while the box still says
      // "Telugu" would leave the reader wondering which of them is right
      all.onclick = function () { var box = $(".ctl-search-input"); if (box) box.value = ""; clearSearch(); };
      c.appendChild(document.createTextNode(" · "));
      c.appendChild(all);
    }
    // Matches that all sit off-screen look exactly like no matches: the map
    // under the box doesn't change. Offer the one move that resolves it.
    if (shown && pts && pts.length && map) {
      var inView = false;
      try {
        var b = map.getBounds();
        inView = pts.some(function (p) { return b.contains(p); });
      } catch (e) { inView = true; }
      if (!inView) {
        var go = el("button", "ctl-search-go", "Show me →");
        go.type = "button";
        var sep = document.createTextNode(" · ");
        go.onclick = function () {
          fitPoints(pts);
          sep.parentNode && sep.parentNode.removeChild(sep);   // its job is done
          go.parentNode && go.parentNode.removeChild(go);
        };
        c.appendChild(sep);
        c.appendChild(go);
      }
    }
  }
  // An expansion term must land on a word boundary ("art" shouldn't match
  // "smart"); the user's own query stays a plain substring, as typed.
  var termRes = {};
  function termRe(t) {
    if (!termRes[t]) {
      var esc2 = String(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      termRes[t] = new RegExp("(^|[^a-z0-9])" + esc2 + "([^a-z0-9]|$)", "i");
    }
    return termRes[t];
  }
  /* `rows` is what the server found by meaning: { layerId: { rowNumber: 1 } }.
     A row it names matches even when none of the words do — that is the
     whole point of it — and it is empty on an atlas with no embeddings, where
     the words alone decide, as they always did. */
  var lastFitKey = null;
  function applySearch(q, tags, rows) {
    var terms = [];
    tags.forEach(function (t) { t = String(t || "").toLowerCase(); if (t && terms.indexOf(t) < 0) terms.push(t); });
    rows = rows || {};
    var shown = 0, total = 0, matchPts = [], layers = searchableLayers(), shapes = false, b = null;
    layers.forEach(function (L) {
      var byRow = rows[L.id] || {};
      searchRows(L).forEach(function (e) {
        total++;
        var text = featureText(L, e.f);
        var match = !!(q && text.indexOf(q) >= 0) || !!byRow[e.f._row];
        for (var i = 0; !match && i < terms.length; i++) match = termRe(terms[i]).test(text);
        e.hidden = !match;
        if (match) { shown++; if (hasPins(L) && !areaPins(L)) matchPts.push(e.f.geometry.coordinates); }
      });
      applyRowVisibility(L);
      // an area that matched is framed by its whole outline, marker or not
      if (!hasPins(L) || areaPins(L)) {
        shapes = true;
        var sb = shapeBounds(L);
        if (sb) b = b ? b.extend(sb) : sb;
      }
    });
    // A pin-only atlas keeps its old line and its "Show me" offer, unchanged.
    if (!shapes) { updateSearchCount(shown, total, matchPts); return; }
    updateSearchCount(shown, total, null, null, searchWord || q, searchNoun(layers));
    /* The map goes to the matching areas, making room for the drawer and the
       phone sheet as every other fit does. Only when the set of matches has
       changed: the words match on every keystroke and the meaning a moment
       later, and a map that lurches twice for one answer reads as broken. */
    if (!shown || !b) { lastFitKey = null; return; }
    matchPts.forEach(function (p) { b.extend(p); });
    var key = layers.map(function (L) { return searchRows(L).map(function (e) { return e.hidden ? 0 : 1; }).join(""); }).join("|");
    if (key === lastFitKey) return;
    lastFitKey = key;
    try { map.fitBounds(b, { padding: viewPadding(), maxZoom: 13, duration: 600 }); } catch (e) {}
  }
  /* ==================================================================
     TAP A TAG — the places that share it

     A tag set is the one thing a colour key cannot summarise. On the real
     Bengaluru layer there are 335 distinct tags across 66 places and 303 of
     them are used exactly once: fold that into eight coloured rows and the top
     eight describe twelve places while fifty-four go grey. So tags get this
     instead of a key — tap one and the map answers "which places share this",
     which is a question 335 kinds can actually answer.

     It borrows the search box's gating (hide a marker, refresh the layer, say
     the count in the same line) but NOT its matching. Search tests words
     against everything a place has written down, with a loose boundary — right
     for a search box, wrong here: tapping "shrine" would also light every
     "devotional-shrine", and would light a place whose description merely says
     the word. Membership of the place's own tag list is exact, and
     featureTagSet already reads it — the same helper these chips came from.

     One tag at a time. Tapping the lit tag again, or "show all", comes back. */
  var TAGFILTER = null, TAGFILTER_LAYER = null;

  /* `layerId` scopes the answer to the layer the tag was tapped on. Both ways in
     belong to one layer — a popup is one place on one layer, and the label index
     is opened from a layer's own row — so answering across every layer made the
     index say "5 places" and the map say "10". Two numbers for one question is
     worse than the narrower answer. */
  function filterByTag(tag, layerId) {
    // the line is the only way back, so without it this would be a trap
    if (!$("#atlas-search-count")) return;
    if (TAGFILTER === tag && TAGFILTER_LAYER === (layerId || null)) { clearSearch(); return; }
    TAGFILTER = tag;
    TAGFILTER_LAYER = layerId || null;
    if (KINDFILTER) { KINDFILTER = null; markLitKinds(); }   // one filter at a time
    var box = $(".ctl-search-input");
    if (box) box.value = "";          // one filter at a time, and it is this one
    searchTags = [];
    searchSeq++;                       // orphan any search still in flight
    clearTimeout(searchTimer);
    var shown = 0, total = 0, pts = [];
    // featureTagSet lowercases as it splits, and the chip carries the tag in
    // the case the data wrote it ("Culture") because that is how it should be
    // read. Compare on the set's own terms, or every capitalised tag matches
    // nothing at all.
    var want = String(tag).trim().toLowerCase();
    var layers = searchableLayers();
    layers.forEach(function (L) {
      var mine = !TAGFILTER_LAYER || L.id === TAGFILTER_LAYER;
      searchRows(L).forEach(function (e) {
        // Count only what this filter could possibly match. A tag belongs to one
        // layer, so counting every layer's markers made the total describe a
        // different population than the number beside it — on an atlas holding
        // the same places twice, "of 132" for 66 places on screen.
        if (mine) total++;
        var has = mine && !!featureTagSet(L, e.f)[want];
        e.hidden = !has;
        if (has) { shown++; if (markersByLayer[L.id]) pts.push(e.f.geometry.coordinates); }
      });
      applyRowVisibility(L);
    });
    updateSearchCount(shown, total, pts, "tagged \u201c" + tag + "\u201d", null, searchNoun(layers));
    markLitTags();
  }

  /* A kind on a key, pressed in the panel, narrows the map the same way a tag
     does: the places of that kind stay, the rest go, the list narrows with
     them, and the line under the search box says "12 of 66 places are
     Market · show all". One filter at a time — a kind replaces a tag or a
     typed word, and typing replaces the kind (runSearch). `which` is "kind"
     for a named kind, "other" for the key's leftover row, "silent" for the
     places a question has no answer for. */
  var KINDFILTER = null;   // { layer, col, which, label }
  function kindFilterIs(L, opt, which, label) {
    return !!KINDFILTER && KINDFILTER.layer === L.id && KINDFILTER.col === opt.col &&
      KINDFILTER.which === which && (which !== "kind" || KINDFILTER.label === label);
  }
  function filterByKind(L, opt, which, label) {
    if (!$("#atlas-search-count")) return;
    if (kindFilterIs(L, opt, which, label)) { clearSearch(); return; }
    clearSearch();   // whatever stood before — a tag, a word — is gone
    var box = $(".ctl-search-input");
    if (box) box.value = "";          // one filter at a time, and it is this one
    searchWord = "";
    searchSeq++;                       // orphan any search still in flight
    clearTimeout(searchTimer);
    KINDFILTER = { layer: L.id, col: opt.col, which: which, label: label };
    var shown = 0, total = 0, pts = [];
    var rows = searchRows(L);
    rows.forEach(function (e) {
      total++;
      var vals = optValuesOf(L, opt, e.f);
      var has;
      if (which === "silent") has = !vals.length;
      else if (which === "other") has = vals.some(function (v) { return opt.kept.indexOf(v) < 0; });
      else has = vals.indexOf(label) >= 0;
      e.hidden = !has;
      if (has) { shown++; if (markersByLayer[L.id]) pts.push(e.f.geometry.coordinates); }
    });
    applyRowVisibility(L);
    updateSearchCount(shown, total, pts, { ofAll: kindWords(label, which) }, null, searchNoun([L]));
    markLitKinds();
  }
  // the pressed kind shows as on in the panel, and only that one
  function markLitKinds() {
    var litN = "";
    document.querySelectorAll(".key-kind[data-which]").forEach(function (b) {
      var sameKey = !!KINDFILTER &&
        b.getAttribute("data-layer") === KINDFILTER.layer &&
        b.getAttribute("data-col") === KINDFILTER.col;
      var on = sameKey &&
        b.getAttribute("data-which") === KINDFILTER.which &&
        (KINDFILTER.which !== "kind" || b.getAttribute("data-kind") === KINDFILTER.label);
      b.classList.toggle("on", on);
      // the other kinds of the same key step back, still there to switch to
      b.classList.toggle("dim", sameKey && !on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      if (on) { var n = b.querySelector(".leg-n"); litN = n ? n.textContent : ""; }
    });
    document.querySelectorAll(".key-only[data-layer]").forEach(function (line) {
      var mine = !!KINDFILTER &&
        line.getAttribute("data-layer") === KINDFILTER.layer &&
        line.getAttribute("data-col") === KINDFILTER.col;
      line.hidden = !mine;
      if (mine) {
        var t = line.querySelector(".key-only-t");
        var what = KINDFILTER.which === "kind" ? KINDFILTER.label
          : KINDFILTER.which === "silent" ? "places without an answer" : "places that said something else";
        t.textContent = "Showing only " + what + (litN ? " (" + litN + ")" : "");
      }
    });
  }

  // the tapped tag shows as on wherever it appears — in this popup and in any
  // other the reader opens while the filter stands
  function markLitTags() {
    document.querySelectorAll(".pop-tag[data-tag]").forEach(function (b) {
      var on = TAGFILTER && b.getAttribute("data-tag") === TAGFILTER;
      b.classList.toggle("on", !!on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  // one listener for every tag chip there will ever be: popups are built and
  // thrown away constantly, and a per-chip handler would die with each one
  var POPUP_LAYER = null;
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest && e.target.closest(".pop-tag[data-tag]");
    if (!b) return;
    e.preventDefault();
    filterByTag(b.getAttribute("data-tag"), b.getAttribute("data-layer") || POPUP_LAYER);
  });

  /* Every fold inside a popup, worked from one place.

     Delegated for the same reason the chips above are: a popup's contents are
     serialised to HTML on the way in, so anything wired to the element itself
     is gone by the time it is on screen — the chevron drew and nothing
     listened. What folds always sits immediately after the thing that folds it,
     which is what makes this a sibling lookup rather than a search. */
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest("[data-fold]");
    if (!t) return;
    var body = t.nextElementSibling;
    if (!body) return;
    e.preventDefault();
    body.hidden = !body.hidden;
    t.setAttribute("aria-expanded", String(!body.hidden));
  });

  function clearSearch() {
    searchTags = [];
    TAGFILTER = null;
    TAGFILTER_LAYER = null;
    markLitTags();
    KINDFILTER = null;
    markLitKinds();
    lastFitKey = null;
    searchableLayers().forEach(function (L) { searchRows(L).forEach(function (e) { e.hidden = false; }); applyRowVisibility(L); });
    updateSearchCount(null);
  }
  function runSearch(raw) {
    searchWord = (raw || "").trim();
    var q = searchWord.toLowerCase();
    if (!q) { clearSearch(); return; }
    // Typing replaces a tapped tag rather than joining it: one filter at a
    // time, the same rule tapping a second tag follows. Without this the chip
    // stayed lit — and announced as pressed — for a filter that had already
    // been replaced, and tapping it then cleared a search the box still showed.
    if (TAGFILTER) { TAGFILTER = null; TAGFILTER_LAYER = null; markLitTags(); }
    if (KINDFILTER) { KINDFILTER = null; markLitKinds(); }   // a pressed kind, likewise
    searchTags = [];                         // expansion belongs to the query that fetched it
    var kw = layerVocab().filter(function (t) { return t.indexOf(q) >= 0 || q.indexOf(t) >= 0; });
    applySearch(q, kw);                      // instant keyword pass
    var seq = ++searchSeq;                    // semantic expansion (public atlases with embeddings)
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      // the key rides along so search works on a private atlas the same way its
      // files do; with no key the API falls back to the caller's own session
      fetch("./api/layers/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataset: DATASET, q: q, key: KEY || undefined }),
      })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          if (seq !== searchSeq) return;      // a newer keystroke won
          searchTags = (r && r.tags) || [];
          /* The server scores every row against the meaning of the query and
             names its hits by layer and row number — the same numbers the
             features here were given as they loaded. Only rows found by
             meaning are taken: a row it found by its words the words here
             already found, and with no key on the server it has nothing
             beyond the words, so the pass below is the same as the first. */
          var rows = {}, anyRow = false;
          ((r && r.hits) || []).forEach(function (h) {
            (h.features || []).forEach(function (f) {
              if (f.score == null) return;
              (rows[h.layer] = rows[h.layer] || {})[f.i] = 1; anyRow = true;
            });
          });
          if (!searchTags.length && !anyRow) return;
          var kw2 = layerVocab().filter(function (t) { return t.indexOf(q) >= 0 || q.indexOf(t) >= 0; });
          applySearch(q, kw2.concat(searchTags), rows);
        }).catch(function () {});
    }, 250);
  }

  /* ==================================================================
     TOGGLING
  ================================================================== */
  // A sub-layer id may be tied to one basemap (L._idBasemap[id]); it only shows
  // when its layer is on AND that basemap is active.
  function idVisible(L, id, show) {
    var bm = L._idBasemap && L._idBasemap[id];
    return show && (!bm || bm === activeBasemap);
  }
  function setLayerVisible(L, show) {
    L._visible = show;
    (L._ids || []).forEach(function (id) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", idVisible(L, id, show) ? "visible" : "none");
    });
    if (markersByLayer[L.id]) applyMarkerVisibility(L);
    // one file, one switch: the rows that went on as points follow their outlines
    var twin = pairedTwin(L);
    if (twin) setLayerVisible(twin, show);
  }

  // Basemap + tile attributions, rendered in a strip BELOW the map (not overlaying
  // it). Shows the active basemap's credit plus any raster tile source (e.g. Esri
  // labels); dataset/source credits live in the credits section further down.
  function renderMapAttrib() {
    var el = $("#map-attrib"); if (!el || !map) return;
    var srcs = (map.getStyle() && map.getStyle().sources) || {};
    var seen = {}, parts = [];
    /* A basemap given as a whole style document has no source of its own here,
       and OpenFreeMap's style attributes nothing — so reading credits off the
       sources alone left OpenStreetMap uncredited on the map people actually
       look at. The active basemap's own credit is stated first, always. */
    var activeBm = (MANIFEST.basemaps || []).filter(function (b) { return b.id === activeBasemap; })[0];
    var own = (APP_BASEMAPS[activeBasemap] && APP_BASEMAPS[activeBasemap].attribution)
      || (activeBm && activeBm.attribution) || "";
    if (own) { seen[own] = 1; parts.push(own); }
    Object.keys(srcs).forEach(function (k) {
      if (/^base-/.test(k) && k !== "base-" + activeBasemap) return; // only the active basemap
      // A layer that swaps tiles per basemap makes one source per basemap, but
      // only one of them is on the map. Without this the hidden one's credit
      // showed too — which is how Esri's label credit appeared over a map
      // drawing no Esri labels.
      var mine = true;
      (MANIFEST.basemaps || []).forEach(function (bmp) {
        if (bmp.id !== activeBasemap && k.slice(-(String(bmp.id).length + 1)) === "-" + bmp.id) mine = false;
      });
      if (!mine) return;
      var a = srcs[k] && srcs[k].attribution;
      if (a && !seen[a]) { seen[a] = 1; parts.push(a); }
    });
    el.innerHTML = parts.join(" · ");
  }

  function switchBasemap(id) {
    activeBasemap = id;
    MANIFEST.basemaps.forEach(function (b) {
      if (map.getLayer("base-" + b.id)) map.setLayoutProperty("base-" + b.id, "visibility", b.id === id ? "visible" : "none");
    });
    // the ground behind the tiles belongs to whichever base map is showing, so
    // a gap while satellite tiles load is dark rather than paper-coloured
    var app = APP_BASEMAPS[id];
    if (app && app.ground && map.getLayer("bg")) {
      mapGround = app.ground;
      map.setPaintProperty("bg", "background-color", app.ground);
    }
    // the vector map underneath keeps its warm paint whichever raster is
    // showing over it; re-applied here so a style reload cannot undo it
    if (app && app.style) warmBaseStyle(map);
    renderMapAttrib();
    // sub-layers tied to a specific basemap (e.g. per-basemap place names)
    MANIFEST.layers.forEach(function (L) {
      if (!L._idBasemap || !Object.keys(L._idBasemap).length) return;
      var show = L._visible !== false;
      (L._ids || []).forEach(function (lid) {
        if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", idVisible(L, lid, show) ? "visible" : "none");
      });
    });
  }

  /* ==================================================================
     CONTROL WIDGET
  ================================================================== */
  // Boundaries and place names ARE the base map: the wizard always draws
  // them, they open switched on, and the owner's region row already speaks
  // for them ("Boundaries & place names for …"). Listing them again as
  // switchable layers made every fresh atlas open on two rows nobody asked
  // to manage — the retired editor filtered them for exactly this reason.
  // The layers still render; only their panel rows go. Curated layers with
  // their own ids (Deoria's districts, blocks) keep their rows.
  function isBaseMapRow(L) {
    return !L.userLayer &&
      /^(admin|labels|boundary|boundaries|placenames|place-names)$/i.test(String(L.id || ""));
  }

  /* ---- the strip: the map's own toolbar, floating beside the drawer ----
     Search and Map/Satellite each give ONE answer for the whole atlas, so
     they live on one small floating toolbar at the map's top edge, to the
     right of the Layers drawer — grouped with the map they act on, and the
     panel keeps only the layers and their keys. Rebuilt with the panel.
     placeStripPieces owns the 720px flip: phones keep Map/Satellite in the
     bottom sheet's foot exactly as before, and the strip carries search
     alone. The owner's region row lives in the Owner menu (owner.js). */
  /* How tall the bottom sheet is, measured and kept current.

     On a phone the sheet sits over the foot of the map, and nothing allowed for
     it: the zoom buttons landed at 768-834 down the page while the shut sheet
     spanned 725-844, so a tap on "+" hit the sheet, a tap on "-" hit its credit
     line, and the scale bar sat behind the Satellite button. Pins could load
     under it too, because the framing only ever made room for the side panel a
     desktop has.

     Measured rather than guessed, because the sheet is one height shut, another
     open, another again with a long region name wrapped across it. */
  function watchSheetHeight(stage) {
    var panel = stage.querySelector(".atlas-panel");
    if (!panel || panel._sheetWatched) return;
    panel._sheetWatched = true;
    var lastH = null, roomT = null;
    var sync = function () {
      var onPhone = window.matchMedia("(max-width: 720px)").matches;
      var h = (onPhone ? panel.offsetHeight : 0);
      stage.style.setProperty("--sheet-h", h + "px");
      /* The map's toolbar sits just to the right of the drawer, whether the
         drawer is open (19.5rem) or folded to its "Layers · N" head — so the
         drawer's width is measured too, and the toolbar follows it. */
      stage.style.setProperty("--panel-w", (onPhone ? 0 : panel.offsetWidth) + "px");
      /* The sheet opening a group rises over the foot of the map, and whatever
         was framed there went under it (the southern tip on the multispecies
         atlas). So when it grows or shrinks on a phone, the map makes room:
         framed again while nobody has moved it, otherwise nudged by half the
         change so what was in the middle stays in the middle. */
      var was = lastH; lastH = h;
      if (was == null || !h || !was || Math.abs(h - was) < 24 || !map) return;
      clearTimeout(roomT);
      roomT = setTimeout(function () {
        if (!map) return;
        if (!userMoved) { if (!focusFit(true)) fitToData(true); }
        else map.panBy([0, (h - was) / 2], { duration: 250 });
      }, 120);
    };
    if (window.ResizeObserver) new ResizeObserver(sync).observe(panel);
    window.addEventListener("resize", sync);
    window.matchMedia("(max-width: 720px)").addEventListener("change", sync);
    requestAnimationFrame(sync);
  }

  function ensureStrip(stage) {
    // looked up page-wide: on a wide screen the strip lives in the header
    var strip = document.querySelector(".atlas-strip");
    if (!strip) {
      strip = el("div", "atlas-strip");
      stage.insertBefore(strip, stage.firstChild);
      stage.classList.add("has-strip");
      // the panel starts just below the strip — measured, never guessed, so a
      // wrapped or touch-sized strip can never overlap it
      var syncH = function () { stage.style.setProperty("--strip-h", strip.offsetHeight + "px"); };
      if (window.ResizeObserver) new ResizeObserver(syncH).observe(strip);
      else window.addEventListener("resize", syncH);
      requestAnimationFrame(syncH);
    }
    watchSheetHeight(stage);
    strip.innerHTML = "";   // a rebuild remakes every piece below
    return strip;
  }

  var stripWired = false;
  function placeStripPieces() {
    var stage = document.querySelector(".atlas-stage");
    var strip = document.querySelector(".atlas-strip");
    var panel = $("#atlas-controls");
    if (!strip || !panel || !stage) return;
    var phone = window.matchMedia("(max-width: 720px)").matches;
    var bm = document.querySelector(".ctl-basemaps");
    var region = document.querySelector(".own-region-wrap");   // owner.js's row
    var foot = document.querySelector("#atlas-panel .sheet-foot");
    /* The strip is the map's own toolbar and never leaves the stage: on a
       wide screen it floats beside the Layers drawer (search, then
       Map/Satellite), on a phone it is the floating search box the phone
       always had. It used to ride up into the header on wide screens, which
       made the owner's header two rows tall and put the map's own controls
       a level away from the map. */
    if (strip.parentNode !== stage) stage.insertBefore(strip, stage.firstChild);
    if (phone && foot) {
      // the sheet's foot: Map/Satellite first
      if (bm && bm.parentNode !== foot) foot.insertBefore(bm, foot.firstChild);
    } else {
      // strip order: search (already there), then Map/Satellite — appended
      // every time, so a rebuild cannot shuffle them
      if (bm) strip.appendChild(bm);
    }
    /* The owner's region row belongs to the Owner menu (owner.js builds
       both). owner.js places it there itself; this is the safety net for a
       row that landed in the layers panel before the menu existed. */
    var slot = document.getElementById("own-panel-region");
    if (region && slot && region.parentNode !== slot) slot.appendChild(region);
  }
  function wireStripPlacement() {
    if (stripWired) return;
    stripWired = true;
    window.matchMedia("(max-width: 720px)").addEventListener("change", placeStripPieces);
    // owner.js adds its region row to the panel whenever it mounts — often
    // long after this build. Watch the panel and re-home the row the moment
    // it lands. placeStripPieces is idempotent, and its own moves re-trigger
    // the observer only to find nothing left to do.
    var panel = $("#atlas-controls");
    if (panel && window.MutationObserver) {
      new MutationObserver(placeStripPieces).observe(panel, { childList: true });
    }
  }

  function buildControls() {
    var panel = $("#atlas-controls");
    panel.innerHTML = "";
    var stage = document.querySelector(".atlas-stage");
    var strip = stage ? ensureStrip(stage) : null;

    // basemap switch — placed by placeStripPieces: the strip on wide screens,
    // the top of the bottom sheet on phones
    var bm = el("div", "ctl-basemaps");
    MANIFEST.basemaps.forEach(function (b) {
      var btn = el("button", "bm-btn" + (b.id === activeBasemap ? " active" : ""), esc(b.label));
      btn.onclick = function () {
        switchBasemap(b.id);
        Array.prototype.forEach.call(bm.children, function (c) { c.classList.remove("active"); });
        btn.classList.add("active");
      };
      bm.appendChild(btn);
    });
    if (strip) strip.appendChild(bm); else panel.appendChild(bm);   // placeStripPieces orders it after the search

    // search box — over marker layers that could carry text (keyword now,
    // semantic on public atlases with embeddings). syncSearchBox() takes it away
    // again once the data is in if none of them actually had any.
    // It lives in the strip, not in this panel: searching the map is a
    // reader's first move, and buried under the layer switches it read as a
    // setting. ensureStrip() cleared the old box, so a rebuilt panel (reboot)
    // neither loses nor doubles it.
    if (strip && manifestSearchable().length) {
      var sc = el("div", "ctl-search");
      var slab = el("label", "ctl-search-box");
      slab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
      var si = el("input", "ctl-search-input");
      si.type = "search"; si.placeholder = "Search this map…"; si.setAttribute("aria-label", "Search this map");
      si.addEventListener("input", function () { runSearch(si.value); });
      si.addEventListener("search", function () { runSearch(si.value); });
      slab.appendChild(si);
      sc.appendChild(slab);
      var cnt = el("div", "ctl-search-count"); cnt.id = "atlas-search-count"; cnt.hidden = true;
      cnt.setAttribute("aria-live", "polite");   // pins vanishing is silent otherwise
      sc.appendChild(cnt);
      strip.appendChild(sc);
      if (!searchKeyWired) {
        searchKeyWired = true;
        // "/" reaches the box from anywhere on the page — the map idiom —
        // unless the visitor is already typing somewhere
        document.addEventListener("keydown", function (e) {
          if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
          var a = document.activeElement;
          if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return;
          var box = document.querySelector(".ctl-search-input");
          if (!box) return;
          e.preventDefault();
          box.focus();
        });
      }
    }

    // groups + layers — declared groups first, then a synthesized group for any
    // layer whose group id isn't declared (e.g. contributed "userdata" layers),
    // so nothing is ever orphaned out of the panel
    // "Boundaries & places" is the viewer's own name for an undeclared base
    // group — the same words the owner's menu uses for it. A manifest that
    // declares the group keeps whatever it called it.
    var GROUP_LABELS = { userdata: "Your data", base: "Boundaries & places", agri: "Crops & value chain", eco: "Ecological landscape" };
    var declaredIds = {};
    MANIFEST.groups.forEach(function (g) { declaredIds[g.id] = true; });
    var groupList = MANIFEST.groups.slice();
    MANIFEST.layers.forEach(function (L) {
      var gid = L.group || "userdata";
      if (!declaredIds[gid]) {
        declaredIds[gid] = true;
        groupList.push({ id: gid, label: GROUP_LABELS[gid] || gid.charAt(0).toUpperCase() + gid.slice(1).replace(/[-_]/g, " ") });
      }
    });
    /* Contributed data leads the list. It is why somebody opened this atlas —
       the base map is context, and a reader who has to scroll past two groups of
       context to reach the places is being shown the furniture first. */
    groupList.sort(function (a, b) {
      return (b.id === "userdata" ? 1 : 0) - (a.id === "userdata" ? 1 : 0);
    });
    var groupsShown = 0, layersShown = 0;
    groupList.forEach(function (g) {
      var layers = MANIFEST.layers.filter(function (L) {
        // a points twin has no row of its own: it sits under its outlines (ONE FILE, ONE ROW)
        return (L.group || "userdata") === g.id && !isBaseMapRow(L) && !pairedPrimary(L);
      });
      if (!layers.length) return;
      groupsShown++; layersShown += layers.length;
      /* A heading over rows that never hide has nothing to fold and nothing to
         summarise, so it is a heading and not a button.

         Groups used to shut, and the rule for which ones stayed open had already
         been patched once: folding a contributed group away hid its colour keys
         completely — built, correct, and behind a shut fold. Nothing folds now,
         which is the whole of D: a visitor never has to act on a control to
         discover that a control exists. The count goes with the chevron, because
         its only job was to tell you what a shut group held. */
      var sec = el("section", "ctl-group");
      /* Named on the outside so the phone's bar can find it. The bar shows one
         group at a time, which is the one place a group still folds — on a tall
         rail there is room to show them all, and on a phone there is not. */
      sec.setAttribute("data-group", g.id);
      sec.setAttribute("data-group-label", g.label);
      var head = el("h3", "ctl-group-head");
      head.textContent = g.label;
      sec.appendChild(head);
      var body = el("div", "ctl-group-body");

      // split into direct items and named sub-groups, preserving manifest order
      var order = [], subMap = {};
      layers.forEach(function (L) {
        if (L.subgroup) {
          if (!subMap[L.subgroup]) { subMap[L.subgroup] = { name: L.subgroup, layers: [] }; order.push({ sub: L.subgroup }); }
          subMap[L.subgroup].layers.push(L);
        } else {
          order.push({ layer: L });
        }
      });
      /* A subgroup around ONE layer is two switches for one thing. On this atlas
         that is "Facilities" holding "Health facilities" and nothing else, and it
         cost a real confusion: the master switch was reported as broken when it
         was only unpainted. A master over a single row decides nothing, so the
         layer is drawn on its own and the subgroup's name is not said twice. */
      order.forEach(function (o) {
        if (o.layer) { body.appendChild(layerRow(o.layer)); return; }
        var sg = subMap[o.sub];
        if (sg.layers.length < 2) { body.appendChild(layerRow(sg.layers[0])); return; }
        body.appendChild(subGroupSection(sg));
      });

      sec.appendChild(body);
      panel.appendChild(sec);
    });

    // the panel head says how much the shelf holds — only when more than one
    // group shares it; a lone group's own head already says the number
    setText("#panel-count", groupsShown > 1 ? "· " + layersShown : "");   // the head already says "Layers"
    // an atlas with nothing on its shelf says so, in one line, rather than
    // standing there with an empty box
    if (!layersShown) panel.appendChild(el("p", "ctl-empty", "This atlas has no layers yet."));

    // the owner's tools add their rows to this panel — see LokaAtlas.onControlsBuilt
    controlsHooks.forEach(function (fn) {
      try { fn(); } catch (e) { console.error("Atlas owner hook error:", e && e.message); }
    });

    // home the strip's pieces for the current width, and keep them homed
    // across the 720px flip and the owner's late arrival
    wireStripPlacement();
    placeStripPieces();

    /* The phone's bar, last, so it reads the panel as it finally stands —
       including whatever the owner's tools just added to it. */
    buildBar();
    /* A mark carries how many of its layers are on, so it has to hear about a
       switch moving. One listener on the panel rather than one per switch, and
       it survives the panel being rebuilt because the panel is what it is on. */
    var controls = document.getElementById("atlas-controls");
    if (controls && !controls._barWired) {
      controls._barWired = true;
      controls.addEventListener("change", function (e) {
        if (e.target && e.target.type === "checkbox") buildBar();
      });
    }
  }

  // sub-group: a master (tri-state) toggle over related layers + a collapse chevron,
  // with each child layer as its own indented row.
  function subGroupSection(sg) {
    var wrap = el("div", "ctl-sub");
    var head = el("div", "ctl-sub-head");
    var lab = el("label", "ctl-sub-toggle");
    var master = el("input"); master.type = "checkbox";
    master.setAttribute("role", "switch");   // the same order of control as a layer's own
    var sw = el("span", "ctl-switch");
    var name = el("span", "ctl-sub-name", esc(sg.name));
    lab.appendChild(master); lab.appendChild(sw); lab.appendChild(name);
    head.appendChild(lab);
    var chev = el("button", "ctl-sub-chev", '<span class="chev">' + ICONS.chevron + "</span>");
    head.appendChild(chev);
    wrap.appendChild(head);

    var body = el("div", "ctl-sub-body");
    chev.onclick = function () { wrap.classList.toggle("collapsed"); };

    function sync() {
      var vis = sg.layers.filter(function (L) { return L._visible; }).length;
      master.checked = vis > 0;
      master.indeterminate = vis > 0 && vis < sg.layers.length;
      head.classList.toggle("off", vis === 0);
    }
    master.onchange = function () {
      var show = master.checked;
      sg.layers.forEach(function (L) {
        if (L._cb) L._cb.checked = show;
        setLayerVisible(L, show);
        if (L._row) L._row.classList.toggle("off", !show);
        renderExtra(L);
      });
      master.indeterminate = false;
      head.classList.toggle("off", !show);
    };
    sg.layers.forEach(function (L) { body.appendChild(layerRow(L, sync)); });
    sync();
    wrap.appendChild(body);
    return wrap;
  }

  function layerRow(L, onChange) {
    L._visible = on(L);
    var row = el("div", "ctl-row");
    var top = el("label", "ctl-toggle");
    var cb = el("input"); cb.type = "checkbox"; cb.checked = on(L);
    /* In speech the two controls were still one: everything here is a checkbox
       to the browser, so somebody listening heard "checkbox" for the layer and
       "checkbox" for each key — the very sameness the tick was drawn to end.
       The layer says what it is. */
    cb.setAttribute("role", "switch");
    /* And it is named by the layer, not by everything sitting on the row.
       A label wraps the whole row, so the switch borrowed its name from all
       the text inside it — which, once an owner is signed in, is the layer's
       name plus Edit card plus Remove plus About. Named here, it says the one
       thing it is. */
    cb.setAttribute("aria-label", L.label || L.id);
    var sw = el("span", "ctl-switch");
    var name = el("span", "ctl-name", esc(L.label));
    top.appendChild(cb); top.appendChild(sw); top.appendChild(name);
    var said = null;
    if (L.info) {
      /* A real button, and it does something.

         This was a span carrying a title. Two faults followed from that. A span
         is not interactive content, so a press on it reached the label around
         it and flipped the layer off — reported as "the info icon toggles the
         layer", which is exactly what it did. And a title only appears on hover
         with a mouse: on a phone, and for anybody moving by keyboard, the words
         behind it were simply unreachable.

         What it holds is worth reaching: where a layer's data came from, what
         it counts, what year it is. So pressing it shows that under the row,
         and pressing it again puts it away. */
      var info = el("button", "ctl-info", ICONS.info);
      info.type = "button";
      info.setAttribute("aria-expanded", "false");
      info.setAttribute("aria-label", "About " + (L.label || L.id));
      said = el("p", "ctl-said", esc(L.info));
      said.hidden = true;
      info.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        var show = said.hidden;
        said.hidden = !show;
        info.setAttribute("aria-expanded", String(show));
      };
      top.appendChild(info);
    }
    row.appendChild(top);
    // under the row, not inside the label — a label holds the switch and its name
    if (said) row.appendChild(said);

    var extra = el("div", "ctl-extra");
    row.appendChild(extra);
    L._extra = extra;
    L._cb = cb; L._row = row;
    /* A subgroup master watches its children through this. A key switch can now
       turn this layer on from under it, so the master has to hear about that too
       or it goes back to showing the wrong thing. */
    L._onVisible = onChange || null;

    cb.onchange = function () {
      setLayerVisible(L, cb.checked);
      row.classList.toggle("off", !cb.checked);
      renderExtra(L);
      if (onChange) onChange();
    };
    row.classList.toggle("off", !cb.checked);

    renderExtra(L);
    return row;
  }

  /* ==================================================================
     FAMILIES OF MEANING — the labels, shelved so they can be browsed

     A colour key can hold eight kinds. This layer has hundreds of labels, most
     used exactly once, and that is not a failure of the data — it is the data:
     what the people walking a city thought worth writing down. Folding it into
     eight rows would describe a handful of places and grey out the rest.

     So the labels are not a key and not a list. They are words you type: 303 of
     one layer's 335 sat on a single place each, so listing them promised browsing
     and delivered a directory. Tapping one still runs the filter that already
     exists, and the map answers "who shares this".

  /* A column that qualifies as a key is NOT a label. Its kinds are already on
     offer as a colouring and already tappable on every place, so counting them
     in the label index gave the reader one vocabulary in two costumes — the
     button said "Browse all 345 labels" when the layer has 335, and Culture,
     Nature and Heritage sat at the head of the browse list while simultaneously
     being the key. A key owns its words. */
  function keyOwnedColumns(L) {
    var owned = {};
    (L._keyOptions || []).forEach(function (o) { if (o.col) owned[o.col] = 1; });
    return owned;
  }

  function tagFieldCount(L) {
    var owned = keyOwnedColumns(L);
    // "_"-prefixed columns are derived twins of a committed column (markerBy's
    // "_category" holds its first answers) — their words are the key's words,
    // and the server's family count skips them too. Counting them here made
    // the button say 345 while the sheet it opens said 335.
    var fields = tagFieldsOf(L).filter(function (f) { return !owned[f] && f.charAt(0) !== "_"; });
    if (!fields.length) return 0;
    var seen = {}, n = 0;
    (markersByLayer[L.id] || []).forEach(function (e) {
      fields.forEach(function (f) {
        splitTags(e.f.properties ? e.f.properties[f] : null).forEach(function (t) {
          if (!seen[t]) { seen[t] = 1; n++; }
        });
      });
    });
    return n;
  }

  
  
  
  function renderExtra(L) {
    var box = L._extra; if (!box) return;
    box.innerHTML = "";

    /* The keys are listed even while the layer is off, and this is the whole of
       D. They used to exist only under a layer that was showing, which meant a
       visitor could not find out that colouring was ON OFFER until they had
       already turned something on — the options were hidden behind the very act
       of exploring. Listing them costs height at rest and buys the thing back:
       every choice a reader might want is on the first level, and the only thing
       left behind a second act is the words that gathered a kind.

       A key switch turns its layer on with it (see buildKeyToggles), so flipping
       one from cold is a single act rather than two. */
    /* Only when at least one key is actually offered: a layer whose every
       column is on cards only (tooFew, scattered) would otherwise show
       "Mark each place by" with nothing under it. */
    if (L._keyOptions && keyState[L.id] &&
        L._keyOptions.some(function (o) { return !o.tooFew && !o.scattered; })) {
      box.appendChild(buildKeyToggles(L));
      updateFoldNote(L);
    }
    if (!L._visible) return;


    // crop selector
    if (L.type === "categories") {
      var chips = el("div", "crop-chips");
      var mk = function (mode, label, color) {
        var c = el("button", "crop-chip" + (cropState[L.id] === mode ? " on" : ""), esc(label));
        if (color) c.style.setProperty("--c", color);
        else c.classList.add("diversity");
        c.onclick = function () {
          cropState[L.id] = mode;
          applyCategoryPaint(L);
          Array.prototype.forEach.call(chips.children, function (x) { x.classList.remove("on"); });
          c.classList.add("on");
        };
        return c;
      };
      chips.appendChild(mk("diversity", L.diversity.label || "Diversity", null));
      L.categories.forEach(function (cat) { chips.appendChild(mk(cat.name, cat.name, cat.color)); });
      box.appendChild(chips);
    }


    // the way into this layer's labels, when it has more of them than a key
    // could ever show (see FAMILIES OF MEANING)
    /* The shelves door stood here — "Browse all 335 labels", opening into groups
       of words the model had shelved. It was a free approximation of the question
       the reading now answers properly, and its own list could not be browsed
       anyway: 303 of those 335 words sat on a single place each. The words remain
       findable by typing; what grouped them is now a key that also colours the
       map, and each kind opens into the words that gathered it. */

    // opacity slider
    if (L.opacityControl) {
      var wrap = el("div", "ctl-opacity");
      var s = el("input"); s.type = "range"; s.min = 0; s.max = 100;
      s.value = Math.round((L.opacity != null ? L.opacity : 0.8) * 100);
      var prop = L.type === "image" ? "raster-opacity" : (L.type === "raster" ? "raster-opacity" : "fill-opacity");
      var target = L.type === "image" ? L.id + "-img" : (L.type === "raster" ? L.id + "-raster" : L.id + "-fill");
      s.oninput = function () { if (map.getLayer(target)) map.setPaintProperty(target, prop, +s.value / 100); };
      wrap.appendChild(el("span", "ctl-opacity-lbl", "Opacity"));
      wrap.appendChild(s);
      box.appendChild(wrap);
    }

    /* The owner's tools hang their per-layer doors here. renderExtra empties the
       box on every toggle and every reboot, so a door added once would vanish the
       first time someone switched the layer off and on — it has to be re-offered
       each time the row is drawn. */
    // the Map Browser: what the layer holds, by name — a contributed layer is a collection
    if (collectionLayer(L) && DATA[L.id]) box.appendChild(collectionEl(L));

    layerExtraHooks.forEach(function (fn) {
      // a door that throws must say so: swallowed silently it looks exactly like
      // a door that decided not to appear, which is a bug you cannot see
      try { fn(L, box); } catch (e) { console.error("Atlas: a layer door failed —", e && e.message, e); }
    });

    refreshLegend(L);
  }

  function refreshLegend(L) {
    if (!L._extra || !L._visible) return;
    var old = $(".ctl-legend", L._extra); if (old) old.remove();
    var data = L.type === "categories" ? categoryLegend(L) : (L._legend || L.legend);
    if (!data) data = legendFromPaint(L);   // derive from a match/step colour expression
    /* The Map Browser row says "11 people" with the colour beside it (see
       collectionEl), so a legend row that only repeats the layer's name under
       the same colour is dropped. Any other row — a kind, a ramp — stays. */
    /* The same for any one-colour layer: its only legend row said its own
       name again under the switch that already says it ("Where the
       respondents work" under "Where the respondents work"). One colour
       needs no key; the row is dropped where it only repeats. */
    if (data && data.length && !data.ramp) {
      var own = String(L.label || "");
      var repeats = function (it) { return !it.header && (it.label === own || it.label === own.slice(0, 40)); };
      if (collectionLayer(L) || (data.length === 1 && repeats(data[0]))) {
        data = data.filter(function (it) { return !repeats(it); });
        if (!data.length) data = null;
      }
    }
    var size = L.sizeLegend;                // bubble layers: reference circles by value
    if (!data && !(size && size.length)) return;
    var leg = el("div", "ctl-legend");
    if (size && size.length) {
      // proportional-symbol key: reference circles at their true on-map size,
      // largest first, each labelled with the value it stands for
      var row = el("div", "leg-size");
      size.forEach(function (it) {
        var item = el("div", "leg-size-item");
        var c = el("span", "leg-size-circle");
        var d = Math.max(6, Math.round(2 * (it.radius || 4)));
        c.style.width = d + "px"; c.style.height = d + "px";
        c.style.setProperty("--c", it.color || (L.paint && L.paint.color) || "#888");
        item.appendChild(c);
        item.appendChild(el("span", "leg-size-val", esc(it.label)));
        row.appendChild(item);
      });
      leg.appendChild(row);
    }
    if (data && data.ramp) {
      // sequential scale → one graduated bar with endpoint labels, not a row per step
      var bar = el("div", "leg-ramp");
      data.ramp.forEach(function (c) { var s = el("span", "leg-ramp-seg"); s.style.background = c; bar.appendChild(s); });
      var lab = el("div", "leg-ramp-labels");
      lab.appendChild(el("span", "leg-ramp-end", esc(data.min)));
      if (data.unit) lab.appendChild(el("span", "leg-ramp-unit", esc(data.unit)));
      lab.appendChild(el("span", "leg-ramp-end", esc(data.max)));
      leg.appendChild(bar);
      leg.appendChild(lab);
    } else if (data && data.length) {
      /* A keyed layer draws its kinds under their own switches now, so this
         block would be saying it all a second time. Everything else it renders —
         a shaded map's ramp, a bubble layer's reference circles, an atlas's own
         declared legend, and the single row a layer wears when no key is on —
         belongs to the layer rather than to one key, and still lives here. */
      var keyed = !!(L._keyOptions && keyState[L.id] && keyState[L.id].active.length);
      // skip these rows, do not leave the function: a bubble layer's reference
      // circles were added just above and still have to be appended
      if (!keyed) data.forEach(function (it) {
        if (it.header) {
          var head = el("div", "leg-head", esc(it.label));
          if (it.full) head.title = it.full;   // the whole heading, for a key named short
          leg.appendChild(head);
          return;
        }
        var r = el("div", "leg-item" + (it.faint ? " faint" : ""));
        r.appendChild(swatch(it));
        r.appendChild(el("span", "leg-label", esc(it.label)));
        // the name leads its row; the count of places wearing the mark sits in ink
        if (it.n != null) r.appendChild(el("span", "leg-n", String(it.n)));
        leg.appendChild(r);
        /* Folded away, not gone. A key is read at a glance, and the words behind
           every kind would bury the thing being glanced at — so the row opens
           only when asked, and shows what its places actually said. */
        if (it.why && it.why.length) {
          r.classList.add("leg-openable");
          r.setAttribute("role", "button");
          r.setAttribute("tabindex", "0");
          r.setAttribute("aria-expanded", "false");
          var words = whyWordsEl(L, it.why);
          words.hidden = true;
          leg.appendChild(words);
          var flip = function () {
            words.hidden = !words.hidden;
            r.setAttribute("aria-expanded", String(!words.hidden));
          };
          r.onclick = flip;
          r.onkeydown = function (e) {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); }
          };
        }
      });
    }
    if (!leg.childNodes.length) return;
    L._extra.appendChild(leg);
  }

  // Derive legend rows from a MapLibre match/step colour expression, for any
  // colour-encoded layer that didn't ship an explicit .legend.
  function legendFromPaint(L) {
    var p = L.paint || {};
    var expr = p.fillColor || p.color;
    if (!Array.isArray(expr)) return null;
    if (expr[0] === "match") {
      var out = [];
      for (var i = 2; i + 1 < expr.length; i += 2) out.push({ color: expr[i + 1], label: String(expr[i]), categorical: true });
      if (expr.length % 2 === 1) out.push({ color: expr[expr.length - 1], label: "other", categorical: true });
      return out.length ? out : null;
    }
    if (expr[0] === "step") {
      var colors = [expr[2]], breaks = [];
      for (var j = 3; j < expr.length; j += 2) { breaks.push(expr[j]); colors.push(expr[j + 1]); }
      return colors.map(function (c, k) {
        var lab = k === 0 ? "< " + breaks[0]
          : k === colors.length - 1 ? "≥ " + breaks[k - 1]
          : breaks[k - 1] + "–" + breaks[k];
        return { color: c, label: String(lab) };
      });
    }
    return null;
  }

  function swatch(it) {
    // keyed rows: the swatch is the map's own mark — the key's shape, the
    // kind's colour, at the panel's size
    if (it.family) {
      var sv = markEl(it.family, it.color);
      sv.setAttribute("class", "leg-sat");
      sv.setAttribute("viewBox", "1 1 18 18");
      return sv;
    }
      // An atlas's own declared picture still shows (deoria's factory, flask).
      // The DERIVED picture is retired with the pins that carried it: a
      // contributed pin draws plain now, so its category row shows the colour
      // alone, as a dot matching that pin. This is the whole point of sharing
      // one renderer with the panel — neither may claim a picture the map does
      // not draw.
      var key = it.icon;
      if (key && ICONS[key]) {
        var w = el("span", "leg-icon", ICONS[key]);
        w.style.setProperty("--c", it.color);
        return w;
      }
      var s = el("span", "leg-swatch " + (it.shape || (it.categorical ? "dot" : "box")));
    s.style.setProperty("--c", it.color);
    return s;
  }

  /* ==================================================================
     MAP BROWSER — the list in the row, the ring on the map, the chooser
     in the card

     One selection, shown in two places. A tap on the map, or on a name in
     the panel, marks the row: the Sindoor ring around its shape (feature
     state, drawn by addHighlight) and the Sindoor name in the list. Both
     read from SEL, so they cannot disagree.
  ================================================================== */
  var SEL = { L: null, row: null, ref: null };
  function selectRow(L, row, ref) {
    clearSelection();
    SEL.L = L; SEL.row = row; SEL.ref = ref || null;
    if (ref) { try { map.setFeatureState(ref, { selected: true }); } catch (e) {} }
    markSelPin();
  }
  function clearSelection() {
    if (SEL.ref) { try { map.setFeatureState(SEL.ref, { selected: false }); } catch (e) {} }
    SEL.L = null; SEL.row = null; SEL.ref = null;
    markSelPin();
  }
  // the feature-state handle of a shape, for the Sindoor ring on its outline
  function shapeRef(L, f, row) {
    return { source: srcId(L), id: f && f.id != null ? f.id : row };
  }
  // a pin has no feature state: the chosen one wears the ring by class (an
  // area's marker too — its outline rings by feature state at the same time)
  function markSelPin() {
    document.querySelectorAll(".atlas-mnode.sel").forEach(function (n) { n.classList.remove("sel"); });
    if (!SEL.L || !hasPins(SEL.L) || SEL.row == null) return;
    var es = markersByLayer[SEL.L.id] || [];
    for (var i = 0; i < es.length; i++) {
      if (es[i].f._row === SEL.row) { if (es[i].node) es[i].node.classList.add("sel"); return; }
    }
  }

  // The items of a collection layer, in row order: the row, the colour of
  // its mark, and whether a search has hidden it.
  function collectionItems(L) {
    var out = [];
    if (hasPins(L)) {
      (markersByLayer[L.id] || []).forEach(function (e) {
        out.push({ row: e.f._row, name: popupTitleText(L, e.f.properties), color: e.color || oneColorOf(L), e: e, hidden: !!e.hidden });
      });
    } else {
      var fill = (L.paint && L.paint.fillColor) || (L.paint && L.paint.color) || "#40573D";
      searchRows(L).forEach(function (e) {
        out.push({ row: e.f._row, name: popupTitleText(L, e.f.properties), color: fill, e: e, hidden: !!e.hidden });
      });
    }
    return out.map(function (it) { if (!it.name) it.name = nounOne(layerNoun(L)) + " " + (it.row + 1); return it; });
  }

  /* The row's count: one line that says how many the layer holds ("11
     people", "134 places"), as plain text. A search narrows it to the rows
     that matched — the same rows the map keeps — and the line says so ("16
     of 134 places match").

     The list of names that used to open from here is gone. It was the index
     an area needed when an area could be lost — under somebody else's shape,
     its name dropped, its twin hidden. Every place now has a marker that
     carries its name and folds into a counted disc, so the map is the index.
     A file that went on as two layers (its outlines, and the rows that only
     had a point — see sameFileAs) is counted as one here, with a second line
     saying how it split: "6 as areas · 5 as points". */
  function collectionEl(L) {
    var wrap = el("div", "ctl-coll");
    wrap.setAttribute("data-layer", L.id);
    L._coll = wrap;
    syncCollection(L);
    return wrap;
  }
  function syncCollection(L) {
    var wrap = L._coll; if (!wrap) return;   // the newest block; an older one is off the page
    var parts = [L].concat(pairedTwin(L) ? [pairedTwin(L)] : []);
    var items = [], shown = 0, split = [];
    parts.forEach(function (P, i) {
      var its = collectionItems(P);
      var kept = its.filter(function (it) { return !it.hidden; }).length;
      items = items.concat(its); shown += kept;
      if (its.length) split.push(splitWords(its.length, L, i > 0));
    });
    wrap.innerHTML = "";
    if (!items.length) return;
    // a split file's rows are areas and points both, so they are "places"
    // unless the manifest names them ("people")
    var noun = L.noun || (parts.length > 1 ? "places" : layerNoun(L));
    var narrowed = shown !== items.length;
    // the phone's tab reads this number instead of "1 layer" — see buildBar
    if (L._row) L._row.setAttribute("data-count", String(shown));

    var head = el("div", "coll-head");
    var dot = el("span", "coll-dot pin");
    dot.style.setProperty("--c", items[0].color);
    head.appendChild(dot);
    var words = narrowed
      ? shown + " of " + items.length + " " + noun + " match"
      : countWords(items.length, noun);
    head.appendChild(el("span", "coll-count", esc(words)));
    wrap.appendChild(head);
    if (parts.length > 1) wrap.appendChild(el("p", "coll-split", esc(split.join(" · "))));
  }
  // the rows a card should offer beside this one: its twins, if it has any
  function twinRowsOf(L, f) {
    return f && f._twins && f._twins.length > 1 ? f._twins.slice() : null;
  }

  /* THE CHOOSER. When a tap lands on two or more rows of one contributed
     layer — twins drawn as the same region, or a neighbourhood inside the
     state somebody else covers — the card names them all, "3 people here",
     and each name is a press away. Without it the top shape won every tap,
     and on the multispecies atlas three of eleven people could not be
     reached from the map at all. */
  function chooserHTML(L, rows, at) {
    if (!rows || rows.length < 2) return "";
    var feats = (DATA[L.id] && DATA[L.id].features) || [];
    var h = '<div class="pop-twins" role="group" aria-label="' + esc(countWords(rows.length, layerNoun(L))) + ' here">';
    h += '<span class="pop-twins-n">' + esc(countWords(rows.length, layerNoun(L))) + " here</span>";
    rows.forEach(function (r) {
      var f = feats[r]; if (!f) return;
      var name = popupTitleText(L, f.properties) || (nounOne(layerNoun(L)) + " " + (r + 1));
      h += '<button type="button" class="pop-twin" data-row="' + r + '" aria-pressed="' + (r === at ? "true" : "false") + '">' + esc(name) + "</button>";
    });
    return h + "</div>";
  }
  function wireChooser(pop, L, rows) {
    var root = pop.getElement && pop.getElement(); if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll(".pop-twin"), function (b) {
      b.onclick = function () {
        var r = +b.getAttribute("data-row");
        var f = DATA[L.id].features[r]; if (!f) return;
        selectRow(L, r, { source: srcId(L), id: f.id != null ? f.id : r });
        pop.setHTML(chooserHTML(L, rows, r) + popupHTML(L, f.properties));
        wireChooser(pop, L, rows);
      };
    });
  }

  /* THE FIRST-VISIT CUE. One line under the map's foot — "Tap an area to
     read who works there" — and a soft pulse on one dot, so a first visitor
     learns that the map answers a tap. It goes at the first tap on the map
     or on a name, and never returns on that device. Not in an embed (the
     frame's owner sets the tone there), and the pulse stays still for anyone
     who asked for less motion. The line comes from the layer's noun, and a
     manifest can say it its own way (L.hint). */
  var CUE = { el: null, mk: null, seen: false };
  function cueSeen() { try { return localStorage.getItem("atlas-cue-seen") === "1"; } catch (e) { return false; } }
  function cueText(L) {
    if (L.hint) return L.hint;
    var noun = layerNoun(L);
    if (L.type === "marker") return "Tap a pin to read about the place";
    if (noun === "people") return "Tap an area to read who works there";
    return "Tap an area to read about it";
  }
  function showCue() {
    if (EMBED || CUE.seen || cueSeen() || CUE.el) return;
    var L = null;
    (MANIFEST.layers || []).some(function (x) { if (collectionLayer(x) && x._visible && collectionItems(x).length) { L = x; return true; } return false; });
    if (!L) return;
    var stage = map.getContainer().closest(".atlas-stage"); if (!stage) return;
    CUE.el = el("div", "atlas-cue", esc(cueText(L)));
    CUE.el.setAttribute("role", "status");
    stage.appendChild(CUE.el);
    if (reducedMotion()) return;
    // the pulse rides the item nearest the middle of the view: the one a
    // reader is most likely looking at already
    var c = map.getCenter(), best = null, bestD = Infinity;
    collectionItems(L).forEach(function (it) {
      var p = hasPins(L) ? it.e.f.geometry.coordinates : labelAnchorPoint(it.e.f.geometry);
      if (!p) return;
      var d = Math.pow(p[0] - c.lng, 2) + Math.pow(p[1] - c.lat, 2);
      if (d < bestD) { bestD = d; best = p; }
    });
    if (!best) return;
    // the map positions the marker's element with a transform of its own,
    // so the ring that grows lives one level down
    var ring = el("div", "atlas-pulse-wrap");
    ring.setAttribute("aria-hidden", "true");
    ring.appendChild(el("div", "atlas-pulse"));
    // a marker's head is 18px above the spot it marks; a shape without one is on it
    CUE.mk = new maplibregl.Marker({ element: ring, anchor: "center", offset: hasPins(L) ? [0, -18] : [0, 0] }).setLngLat(best).addTo(map);
  }
  function dismissCue() {
    if (CUE.seen) return;
    CUE.seen = true;
    try { localStorage.setItem("atlas-cue-seen", "1"); } catch (e) {}
    if (CUE.el) { CUE.el.classList.add("gone"); var c = CUE.el; setTimeout(function () { c.remove(); }, 400); CUE.el = null; }
    if (CUE.mk) { try { CUE.mk.remove(); } catch (e) {} CUE.mk = null; }
  }

  /* ==================================================================
     POPUPS
  ================================================================== */
  function wirePopups() {
    var clickable = MANIFEST.layers.filter(function (L) { return L.popup && L.type !== "marker"; });
    var ids = [];
    clickable.forEach(function (L) { (L._ids || []).forEach(function (id) { if (/-(fill|line|circle)$/.test(id) && !/-hl$/.test(id)) ids.push({ id: id, L: L }); }); });
    var idList = ids.map(function (x) { return x.id; });
    var hoverRef = null;

    // Prefer the most specific layer (earliest in manifest order — a block's crop popup
    // wins over the transparent district fill that sits above it).
    function pick(pt) {
      var hits = map.queryRenderedFeatures(pt, { layers: idList });
      // Contributed layers draw on top of everything and win the click (hit
      // order = topmost first) — ranking them by manifest order would let a
      // base layer's popup shadow them forever.
      for (var k = 0; k < hits.length; k++) {
        var i = ids.findIndex(function (x) { return x.id === hits[k].layer.id; });
        if (i >= 0 && ids[i].L.userLayer) return { f: hits[k], L: ids[i].L };
      }
      // Among the curated layers, manifest order stays the popup priority —
      // bespoke atlases (Deoria) place the richest popup first on purpose.
      var best = null, bestRank = Infinity;
      hits.forEach(function (h) {
        var i = ids.findIndex(function (x) { return x.id === h.layer.id; });
        if (i >= 0 && i < bestRank) { bestRank = i; best = { f: h, L: ids[i].L }; }
      });
      return best;
    }
    function clearHover() { if (hoverRef) { try { map.setFeatureState(hoverRef, { hover: false }); } catch (e) {} hoverRef = null; } }
    /* Every row of a contributed layer under the point, not only the top one:
       the top shape hid its twins from a tap. Rows are told apart by their
       number (a fill and its outline are the same row), and the one the old
       rule chose stays first, so the ring the hover drew is the card that opens. */
    function rowsUnder(pt, top) {
      var L = top.L;
      if (!collectionLayer(L) || L.type === "marker") return null;
      var own = idList.filter(function (id) { return id.indexOf(L.id + "-") === 0; });
      var rows = [], seen = {};
      var first = top.f.properties && top.f.properties._srow;
      if (first != null) { rows.push(first); seen[first] = 1; }
      map.queryRenderedFeatures(pt, { layers: own }).forEach(function (h) {
        var r = h.properties && h.properties._srow;
        if (r == null || seen[r]) return;
        seen[r] = 1; rows.push(r);
      });
      return rows.length > 1 ? rows : null;
    }

    // at-a-glance crop tooltip: hovering a categories layer (crop distribution)
    // lists that feature's crops without a click, coloured to match the legend.
    var catTip = null;
    function hideTip() { if (catTip) { catTip.remove(); catTip = null; } }
    function showTip(L, feature, lngLat) {
      var html = catTooltipHTML(L, feature.properties);
      if (!html) { hideTip(); return; }
      if (!catTip) catTip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "atlas-tooltip", offset: 12 });
      catTip.setLngLat(lngLat).setHTML(html).addTo(map);
    }

    map.on("mousemove", function (e) {
      // over a cluster disc the disc's own handler owns the cursor and the
      // hint; whatever polygon lies beneath must neither light up nor speak
      if (CLUSTER.hovering) { clearHover(); hideTip(); return; }
      var top = pick(e.point);
      map.getCanvas().style.cursor = top ? "pointer" : "";
      if (!top || top.f.id == null) { clearHover(); hideTip(); return; }
      var ref = { source: top.f.source, id: top.f.id };
      var changed = !hoverRef || hoverRef.id !== ref.id || hoverRef.source !== ref.source;
      if (changed) {
        clearHover(); hoverRef = ref;
        try { map.setFeatureState(ref, { hover: true }); } catch (e) {}
      }
      if (top.L.type === "categories" && top.L.arrayProperty) {
        if (changed || !catTip) showTip(top.L, top.f, e.lngLat);
        else catTip.setLngLat(e.lngLat); // follow the cursor without rebuilding
      } else {
        hideTip();
      }
    });
    map.on("mouseout", function () { clearHover(); hideTip(); });

    map.on("click", function (e) {
      if (clusterAt(e.point)) return;             // the disc owns this click
      dismissCue();                               // the map has been tapped: the cue's work is done
      var top = pick(e.point);
      if (!top) { clearSelection(); return; }     // click on empty map clears the selection
      var row = top.f.properties && top.f.properties._srow;
      selectRow(top.L, row != null ? row : null, top.f.id != null ? { source: top.f.source, id: top.f.id } : null);
      openPopup(top.L, top.f, e.lngLat, null, null, rowsUnder(e.point, top));
    });

    wireCircleHints();   // hover tooltips for circle/bubble layers (style-drawn, not DOM)
  }

  // `rows` (optional) are the other rows a tap landed on, this one first or
  // among them: the card opens with the chooser above it (see chooserHTML).
  /* One card at a time. A tap on the map closes the last card by itself, but
     a name in the Map Browser is not a tap on the map, and the cards piled up
     — the first one still on top, saying the wrong name. */
  var LAST_POP = null;
  function openPopup(L, feature, lngLat, offsetPx, anchor, rows) {
    hideHint();   // the popup says everything the tooltip did, and more
    dismissCue(); // a card is open: the reader has found the way in
    var html = popupHTML(L, feature.properties);
    if (!html) return;
    var at = feature.properties && feature.properties._srow;
    if (rows && rows.length > 1) html = chooserHTML(L, rows, at != null ? at : feature._row) + html;
    var opts = { closeButton: true, maxWidth: "320px", className: "atlas-popup" };
    // An un-fanned popup used to open with no offset, right on the pin — fine
    // over a 20px circle, but the taller pin now sits under its own popup.
    opts.offset = 30;
    /* On a wide screen the card is docked at the map's right (see the
       desktop rule in index.html), so the pin's offset and anchor mean
       nothing to it — the stylesheet fixes its place. The pin stays marked
       (selectRow) and is panned clear of the card (keepClearOfCard). */
    var docked = cardDocked();
    // a spiderfied marker keeps its true lngLat plus a px displacement — the
    // popup takes the same displacement so it points at the pin the user
    // sees, and (fanned pins only) an anchor chosen to open away from the
    // rest of the fan, nudged so it clears the pin's own body
    if (offsetPx && !docked) {
      var off = [offsetPx[0], offsetPx[1]];
      if (anchor) {
        // the pin is 28px tall now, not 20 — these clear its body
        if (anchor.indexOf("bottom") === 0) off[1] -= 34;        // above the pin's head
        else if (anchor.indexOf("top") === 0) off[1] += 6;       // below its foot
        else off[1] -= 20;                                       // beside its waist
        opts.anchor = anchor;
      }
      opts.offset = off;
    }
    if (LAST_POP) { try { LAST_POP.remove(); } catch (e) {} }
    var pop = new maplibregl.Popup(opts).setLngLat(lngLat).setHTML(html).addTo(map);
    LAST_POP = pop;
    if (rows && rows.length > 1) wireChooser(pop, L, rows);
    var stage = map.getContainer().closest(".atlas-stage");
    if (docked) {
      if (stage) {
        stage.classList.add("card-docked");
        /* the toolbar (search, Map/Satellite) floats top-left of the map;
           where the map is narrow enough for it to reach under the card,
           the card starts below it instead of covering it */
        var top = 8;
        try {
          var strip = document.querySelector(".atlas-strip");
          var mr = map.getContainer().getBoundingClientRect();
          if (strip && strip.offsetHeight && strip.getBoundingClientRect().right > mr.right - 340 - 8 - 8) {
            top = Math.round(strip.getBoundingClientRect().bottom - mr.top) + 8;
          }
        } catch (e) {}
        stage.style.setProperty("--card-top", top + "px");
      }
      pop.on("close", function () {
        if (LAST_POP === pop) LAST_POP = null;
        if (stage && !LAST_POP) stage.classList.remove("card-docked");
      });
      keepClearOfCard(lngLat, offsetPx);
    } else {
      pop.on("close", function () { if (LAST_POP === pop) LAST_POP = null; });
      keepClearOfStrip(pop);
    }
    return pop;
  }
  // wide enough for the card to dock at the right (the phone keeps its bottom card)
  function cardDocked() {
    try { return window.matchMedia("(min-width: 721px)").matches; } catch (e) { return false; }
  }
  // Esc puts the card away, as it does the fan and the tooltip
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && LAST_POP) { try { LAST_POP.remove(); } catch (err) {} }
  });

  // The strip floats over the top of the map, so a card opened near the top
  // would tuck its name under it. Nudge the map down just enough to show it.
  function keepClearOfStrip(pop) {
    var el = pop.getElement && pop.getElement();
    var strip = document.querySelector(".atlas-strip");
    if (!el || !strip || !strip.offsetHeight) return;
    var over = strip.getBoundingClientRect().bottom + 8 - el.getBoundingClientRect().top;
    if (over > 0) map.panBy([0, -over], { duration: 250 });
  }

  /* The docked card covers the map's right edge, so the place the card is
     about could be under it — or under the toolbar at the top, or just off
     an edge. Pan the map the least distance that brings the pin (28px
     tall, its rows beside it) into the open, so the card and its place are
     both in view. Measured from the card's own box, so a narrower map is
     handled the same way. */
  function keepClearOfCard(lngLat, offsetPx) {
    if (!LAST_POP || !LAST_POP.getElement) return;
    var el = LAST_POP.getElement();
    var box = map.getContainer();
    var mr = box.getBoundingClientRect();
    var cr = el.getBoundingClientRect();
    var p = map.project(lngLat);
    if (offsetPx) { p.x += offsetPx[0]; p.y += offsetPx[1]; }
    var room = 48;                                     // the pin and a little air
    var rightLimit = (cr.width ? cr.left - mr.left : mr.width) - room;
    var dx = 0, dy = 0;
    if (p.x > rightLimit) dx = p.x - rightLimit;
    else if (p.x < room) dx = p.x - room;
    var topLimit = 40;
    var strip = document.querySelector(".atlas-strip");
    if (strip && strip.offsetHeight) {
      var sr = strip.getBoundingClientRect();
      if (p.x + mr.left > sr.left - 20 && p.x + mr.left < sr.right + 20) topLimit = sr.bottom - mr.top + 40;
    }
    if (p.y - 34 < topLimit) dy = (p.y - 34) - topLimit;
    else if (p.y > mr.height - 24) dy = p.y - (mr.height - 24);
    if (dx || dy) map.panBy([dx, dy], { duration: 250 });
  }

  // The popup title and the hover tooltip must call a feature the same thing,
  // so both resolve it here: the stanza's title property, then its fallback. A
  // manifest can name a property the data doesn't carry (a column renamed or
  // dropped after the stanza was written) — that resolves to "", and callers
  // skip the title rather than print "undefined".
  function popupTitleText(L, props) {
    var spec = L && L.popup;
    if (!spec || !props) return "";
    var t = spec.title ? props[spec.title] : "";
    if ((t == null || t === "") && spec.titleFallback) t = props[spec.titleFallback];
    if (t == null) return "";
    t = String(t).trim();
    return (t && t !== "null" && t !== "undefined") ? t : "";
  }

  /* Three cases, in order of how much the upload can tell us: its own name; the
     person who added it and when; or just when. Never the email — that belongs
     to the owner's tools, not to every reader of the map. */
  /* "a spreadsheet" or "a map file" — the words a visitor gets instead of a
     filename. Anything else that was uploaded is "a file". */
  function uploadKind(name) {
    var n = String(name || "").trim();
    if (!n) return "";
    if (/\.(csv|tsv|xlsx?|ods)$/i.test(n)) return "a spreadsheet";
    if (/\.(geojson|json|kml|kmz|gpx|zip|shp)$/i.test(n)) return "a map file";
    return "a file";
  }

  /* Place names as the gallery prints them: "Maharashtra", not "Mahārāshtra".
     The region names come from the boundary data with their transliteration
     marks on, and beside "Delhi" they read as three spellings in one line.
     Stripping the marks gives the plain English spelling every time. */
  function plainName(s) {
    s = String(s || "");
    try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return s;
  }

  function sourceLine(L) {
    if (!L || !L.userLayer) return "";
    var by = L.addedBy || null;
    var when = L.addedAt ? new Date(L.addedAt).toLocaleDateString("en-IN",
      { day: "numeric", month: "short", year: "numeric" }) : "";
    var name = String(L.label || "").trim();
    var fileish = !name || name === L.id || /\.(csv|tsv|xlsx?|geojson|json)$/i.test(name);
    if (!fileish) return name;
    var who = by && (by.name || by.org) ? String(by.name || by.org).trim() : "";
    if (who && when) return "Upload by " + who + ", " + when;
    if (who) return "Upload by " + who;
    if (when) return "Upload from " + when;
    return "";
  }

/* Is this a layer that came out of the LOKA app?

   The atlas is built to take any spreadsheet from anyone, and it guesses well
   from the columns alone. But LOKA's own data is not a guess: we wrote the app
   that produces it, so we know what every column means, which are worth reading
   and which are only bookkeeping. Recognising it is worth doing because a guess
   and a certainty deserve different treatment.

   The signature is three columns together, one of which is unmistakable: a
   tag_id that is a UUID. A spreadsheet might happen to have "labels" or
   "description"; one that also stamps every row with a UUID under that name is
   ours. Measured on the live Bengaluru layer: 66 of 66 rows, every id distinct
   and every one a UUID. */
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function lokaShaped(feats) {
    var p = (feats && feats[0] && feats[0].properties) || null;
    if (!p) return false;
    if (!("tag_id" in p) || !("labels" in p) || !("description" in p)) return false;
    var seen = 0, uuid = 0;
    for (var i = 0; i < feats.length && seen < 12; i++) {
      var v = String(((feats[i].properties || {}).tag_id) || "").trim();
      if (!v) continue;
      seen++;
      if (UUID_RE.test(v)) uuid++;
    }
    return seen > 0 && uuid === seen;
  }

  // worked out once per layer, when its places arrive
  function isLoka(L) {
    if (!L) return false;
    if (L._loka === undefined) {
      var gj = DATA[L.id];
      L._loka = !!(gj && lokaShaped(gj.features || []));
    }
    return L._loka;
  }

  /* How a LOKA place reads, in the order it reads best.

     A photo of the thing, then what the person wrote about it, then what the
     atlas worked out, then the words they tagged it with, and last the
     bookkeeping — where, when, by whom. The order the wizard produces is a
     reasonable guess for a spreadsheet nobody has seen; for our own data it is
     only a guess where we have an answer.

     The description especially: for LOKA it is a sentence, sometimes with a
     photo credit on the end, so heading a card with it made an eight-line
     title. It is a caption. It belongs under the picture it captions. */
  var LOKA_ORDER = ["image_urls", "description", "labels", "address", "created_at", "creator"];
  function lokaFields(fields) {
    var by = {}, rest = [];
    (fields || []).forEach(function (f) {
      if (LOKA_ORDER.indexOf(f.property) >= 0) by[f.property] = f;
      else rest.push(f);
    });
    var out = [];
    LOKA_ORDER.forEach(function (k) { if (by[k]) out.push(by[k]); });
    // anything the app grows later still shows, after what we know about
    return out.concat(rest);
  }

/* The opening of a LOKA card: every photo, then the caption, then the answers.

   Every photo, not the first one. LOKA lets somebody attach more than one, and
   9 of the 66 places on the live Bengaluru layer have two — the second was
   being dropped on the floor, because a generic image column means one image. */
  function lokaLead(L, props, caption, krows) {
    var h = "";
    /* The lead photograph. Looked for in the column LOKA sends and in whatever
       column this layer was told holds its pictures, because the name differs:
       a tag exported one way carries image_urls, another carries media. */
    var imgCol = (L && L.spec && L.spec.imageColumn) || "";
    var shots = linksIn(props.image_urls);
    if (!shots.length && imgCol) shots = linksIn(props[imgCol]);
    h += shotsHTML(shots);
    if (caption) h += '<p class="pop-caption">' + esc(String(caption).trim()) + "</p>";
    if (krows) h += krows.outerHTML;
    return h;
  }

  function popupHTML(L, props) {
    POPUP_LAYER = L && L.id;   // the tag chips below belong to this layer
    var spec = L.popup;
    // the same key-by-key rows the hover bubble shows — a touch screen has
    // no hover, so the tap popup is where the marks get decoded there. A
    // keyed layer with no popup stanza still gets a popup of just the rows.
    var krows = keyRowsEl(L, props, true);   // a popup shows every answer, not only the marks
    if (!spec && !krows) return "";
    spec = spec || {};
    var title = popupTitleText(L, props);
    var sub = spec.subtitle || (spec.subtitleProperty ? props[spec.subtitleProperty] : "");
    var loka = isLoka(L);
    var shell = '<div class="pop">';
    var h = shell;
    /* On a LOKA place the description IS the title, and it is a sentence —
       sometimes with a photo credit on the end — so heading the card with it
       produced an eight-line title. It is a caption, and it belongs under the
       picture it captions. So a LOKA card opens with the photo, then the
       caption, then what the atlas worked out; the generic card keeps the
       heading-first order that suits a spreadsheet nobody has seen. */
    if (loka) {
      h += lokaLead(L, props, title, krows);
    } else {
      // the kicker first ("SURVEY VILLAGE · GORAKHPUR"), then the name
      if (sub) h += '<div class="pop-sub">' + esc(sub) + "</div>";
      if (title) h += '<div class="pop-title">' + esc(title) + "</div>";
      if (krows) h += krows.outerHTML;
    }
    /* Plain facts sit in one two-column list — label beside value, values
       lined up — so consecutive facts are gathered and written out together.
       Anything that is not a plain fact (tags, notes, a photo) closes the
       list, and the next plain fact opens a new one. */
    var facts = "";
    /* Label beside value works for "Name · Gijs Spoor". It does not work for a
       survey question: the label column takes as much width as its longest
       label wants, so a sixty-letter question left the answer a column 56
       pixels wide and "Foundation for research on socio economic development"
       came out over eight lines with words split in the middle.

       So when a card's labels are long, the whole card stacks — question above
       answer, each across the full width. The whole card, not the offending
       row, because a card half in one shape and half in the other reads as a
       mistake. */
    var LONG_LABEL = 26;
    var stacked = false;
    function flushFacts() {
      if (!facts) return;
      h += '<div class="pop-facts' + (stacked ? " pop-facts-stacked" : "") + '">' + facts + "</div>";
      facts = "";
    }
    /* A layer's popup rows are generated from its columns when it is added, so
       every column a key later claims got said twice: once in the key rows above
       and again as a row of its own. Worse, a question's column arrived as a raw
       "Pattern 1" — the machinery's name for it, in front of a reader. And the
       Source line at the foot already names whoever added the places, so a
       Creator row repeated it a third time. */
    var keyCols = {};
    (L._keyOptions || []).forEach(function (o) { if (o.col) keyCols[o.col] = 1; });
    var srcLine = sourceLine(L);

    /* Our own data is not a guess. The wizard's field order is a fair reading of
       a spreadsheet nobody has seen; for a LOKA layer we know what each column
       is for, so the card is composed rather than listed. */
    var fields = loka ? lokaFields(spec.fields) : (spec.fields || []);
    fields.forEach(function (fld) {
      var v = props[fld.property];
      if (v == null || v === "" || v === "[]") return;
      /* The field's name, short when the heading is long. The card builder
         wrote fld.label when the layer was made; a long heading is shown by
         its short name here, with the whole heading on hover and behind ⓘ. */
      var fl = colLabel(L, fld.property);
      var labText = fl.shortened ? fl.text : (fld.label || fl.text);
      var labHTML = '<span class="pop-lbl"' + (fl.shortened ? ' title="' + esc(fl.full) + '"' : "") + ">" +
        esc(labText) + (fl.shortened ? " " + labelInfoHTML(fl.full) : "") + "</span>";
      if (keyCols[fld.property]) return;                          // the key rows said it
      if (/^pattern_\d+(_why)?$/.test(fld.property)) return;      // never show the machinery's name
      if (srcLine && String(v).trim() === String(srcLine).trim()) return;   // the Source line said it
      if (fld.type === "tags") {
        var arr = Array.isArray(v) ? v : tagArr(v);
        if (!arr.length) return;
        flushFacts();
        // Each tag is a button, not a label: tapping one shows the places that
        // share it (see filterByTag). A button so a keyboard reaches it, and so
        // it announces itself as something that does a thing.
        /* Open. These were folded behind a count for a while, because on a
           place with seven of them the chips ran to 144px of a 476px card —
           the largest thing on it. But each one filters the map, and a control
           you have to find first is a control most people never find. The
           height is worth it; the count stays as a heading. */
        h += '<div class="pop-field">' + labHTML + " " +
          '<span class="pop-fold-n">' + arr.length + '</span>' +
          '<div class="pop-tags">' +
          arr.map(function (t) {
            return '<button type="button" class="pop-tag" data-tag="' + esc(t) +
              '" data-layer="' + esc(L.id) +
              '" title="Show the places tagged ' + esc(t) + '">' + esc(t) + "</button>";
          }).join("") + "</div></div>";
      } else if (fld.type === "notes") {
        var notes = Array.isArray(v) ? v : safeArr(v);
        if (!notes.length) return;
        flushFacts();
        h += '<div class="pop-notes">' + notes.map(function (n) {
          return '<div class="pop-note"><b>' + esc(n.title) + "</b>" + (n.body ? "<span>" + esc(n.body) + "</span>" : "") + "</div>";
        }).join("") + "</div>";
      } else if (loka && (fld.property === "description" || fld.property === "image_urls" ||
                          fld.property === ((L.spec && L.spec.imageColumn) || ""))) {
        /* the photo and its caption already led the card. Whichever column
           holds the pictures is the one to skip, not only the one LOKA names:
           a layer whose photographs live in "media" drew every one of them
           twice, once at the top of the card and once again below it. */
        return;
      } else if (fld.type === "image") {
        /* photo column: https-only, lazy, silently hidden when the link is dead.
           The addresses are looked for inside the value rather than demanded of
           it, so a place carrying several — or carrying them wrapped, which is
           how they arrive from LOKA — shows its photographs instead of nothing. */
        flushFacts();
        h += shotsHTML(linksIn(v));
      } else if (fld.type === "cropProfile") {
        var cp = Array.isArray(v) ? v : safeArr(v);
        if (!cp.length) return;
        flushFacts();
        h += '<div class="pop-field">' + labHTML + '<div class="pop-tags">' +
          cp.map(function (c) { return '<span class="pop-tag">' + esc(c.crop) + ' <b>' + esc(c.blocks) + "</b></span>"; }).join("") + "</div></div>";
      } else {
        /* Label and value in one run of text. Stacked, "Creator / Sharang"
           spent two lines on one short word; inline it takes one and wraps only
           when the value is long enough to need it. */
        /* A value the wizard typed as plain words can still be a database's
           list — the braces are what stopped it looking like one when it was
           profiled. Shown as words either way, so a card never prints
           {dense-shade,surface-roots} at somebody. */
        var shown = unbrace(v);
        if (shown !== String(v)) {
          shown = shown.split(",").map(unquotePiece).filter(Boolean).join(", ");
        }
        /* A whole number that came out of a spreadsheet as a decimal.
        
           "How long have you been involved in this work?" answered "30" arrives
           as the text "30.0", because the sheet held it in a column of
           decimals, and the card printed "30.0" years at a reader. Only a
           string that is ENTIRELY a number is touched, and only its pointless
           trailing zeros: "1.5" stays, "v1.0" stays, "30.0 km" stays, and the
           stored data is not altered — this is how it reads, not what it is. */
        if (/^-?\d+\.0+$/.test(shown)) shown = shown.replace(/\.0+$/, "");
        if (String(labText || "").length > LONG_LABEL) stacked = true;
        facts += '<div class="pop-field pop-field-inline">' + labHTML +
          ' <span class="pop-val">' + esc(shown) + (fld.suffix || "") + "</span></div>";
      }
    });
    flushFacts();
    /* Where this place came from, in words. The pin's ring used to hint at this
       and could not be checked — the popup never named the upload, so a reader
       who wondered had nowhere to look. Only contributed layers have an upload
       to name; a curated atlas's own pins have none. */
    var src = sourceLine(L);
    if (src) h += '<div class="pop-src">Source · ' + esc(src) + "</div>";

    // A popup stanza can point at columns the data no longer carries — that
    // used to open a bare white box with nothing but a close button. If
    // nothing resolved, there is nothing to say: no popup at all.
    if (h === shell) return "";
    return h + "</div>";
  }
  function safeArr(v) { try { return JSON.parse(v); } catch (e) { return []; } }

  /* The pictures in a value, however that value arrived.

     A place can carry its photographs in more shapes than one, because the
     shape depends on whoever sent them. A single web address. Several
     separated by semicolons. A list written as text. And — this is the one
     that was showing nobody anything — a list of wrappers, each holding its
     address in a part of its own:

       [{"id": "a7a42…", "image_url": "https://…/1789129598955_lib0_….jpg"}]

     Every one of the thirty-three places on a Cubbon Park atlas stored its
     photograph that way. The card knew the column was pictures and asked for
     one, the test was "does this whole value begin with https", the value
     began with a square bracket, and nothing was drawn — no broken image, no
     message, just a card with no photograph on it.

     So rather than test the value, look inside it for web addresses, however
     deep they are wrapped. This heals what is already stored, which matters:
     those thirty-three places are on a map somebody has shared, and asking
     them to add their photographs again would be asking them to pay for our
     mistake. */
  /* The photographs on a card.

     One photograph fills the card's width. Several become a carousel rather
     than a grid: two side by side were 120px tall each, which is a thumbnail of
     a place somebody went and stood in. One at a time gets the full width and
     the full height, and the others are a swipe away.

     It is a scroll strip that snaps, so a finger or a trackpad moves it with no
     script at all — the arrows are for a mouse and a keyboard, and they are the
     only part that needs wiring. A card with one photograph gets no arrows and
     no counter, because there is nothing to move between. */
  var SHOTS_MAX = 12;
  function shotsHTML(urls) {
    var shots = (urls || []).slice(0, SHOTS_MAX);
    if (!shots.length) return "";
    var imgs = shots.map(function (u) {
      return '<img class="pop-img" src="' + esc(u) + '" alt="" loading="lazy" ' +
        'referrerpolicy="no-referrer" onerror="this.style.display=\'none\'" />';
    }).join("");
    if (shots.length === 1) return '<div class="pop-shots">' + imgs + "</div>";
    return '<div class="pop-shots many" data-n="' + shots.length + '">' +
      '<div class="pop-strip">' + imgs + "</div>" +
      '<button class="pop-shot-go back" type="button" data-dir="-1" aria-label="Previous photograph">\u2039</button>' +
      '<button class="pop-shot-go on" type="button" data-dir="1" aria-label="Next photograph">\u203a</button>' +
      '<span class="pop-shot-at" aria-live="polite">1 / ' + shots.length + "</span>" +
      "</div>";
  }

  /* The arrows, wired once for every card there will ever be. A popup is built
     fresh each time one is opened, so listening on the page rather than on the
     card is what keeps this to one listener instead of one per photograph. */
  document.addEventListener("click", function (e) {
    var go = e.target.closest && e.target.closest(".pop-shot-go");
    if (!go) return;
    var box = go.closest(".pop-shots");
    var strip = box && box.querySelector(".pop-strip");
    if (!strip) return;
    strip.scrollBy({ left: Number(go.getAttribute("data-dir")) * strip.clientWidth,
                     behavior: reducedMotion() ? "auto" : "smooth" });
  });
  document.addEventListener("scroll", function (e) {
    var strip = e.target;
    if (!strip.classList || !strip.classList.contains("pop-strip")) return;
    var box = strip.closest(".pop-shots");
    var at = box && box.querySelector(".pop-shot-at");
    if (!at || !strip.clientWidth) return;
    var n = Number(box.getAttribute("data-n")) || 1;
    var i = Math.min(n, Math.max(1, Math.round(strip.scrollLeft / strip.clientWidth) + 1));
    var said = i + " / " + n;
    if (at.textContent !== said) at.textContent = said;
  }, true);
  function reducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
  }

  function linksIn(v) {
    var out = [];
    (function take(x, depth) {
      if (x == null || depth > 5) return;
      if (Array.isArray(x)) { x.forEach(function (y) { take(y, depth + 1); }); return; }
      if (typeof x === "object") {
        for (var k in x) {
          if (Object.prototype.hasOwnProperty.call(x, k)) take(x[k], depth + 1);
        }
        return;
      }
      var str = String(x).trim();
      if (!str) return;
      // written as a list or a wrapper: read it as one before reading it as words
      if (str.charAt(0) === "[" || str.charAt(0) === "{") {
        var parsed = null;
        try { parsed = JSON.parse(str); } catch (e) { parsed = null; }
        if (parsed) { take(parsed, depth + 1); return; }
      }
      /* Look for addresses inside the words rather than asking the words to be
         one. They arrive wrapped in quotes and brackets, and — the reason this
         matters — a value is cut at five hundred characters on its way onto the
         map, so a place with several photographs ends mid-address and the whole
         thing stops being readable as a list. Searching still finds the ones
         that survived the cut. A cut-off address loads nothing and hides
         itself, which is the same as it always did. */
      // the separators this product uses between several are not part of one
      var found = str.match(/https:\/\/[^\s"'<>\\|;,]+/gi);
      if (found) {
        found.forEach(function (u) { out.push(u.replace(/[)\]},.;:'"]+$/, "")); });
      }
    })(v, 0);
    var seen = {};
    return out.filter(function (u) { return seen[u] ? false : (seen[u] = true); });
  }
  // tag chips from either a JSON array or a "a; b, c"-delimited string
  function tagArr(v) {
    if (Array.isArray(v)) return v;
    var j = safeArr(v);
    if (j.length) return j;
    return unbrace(v).split(/[;,]/).map(unquotePiece).filter(Boolean);
  }

  /* ==================================================================
     CREDITS (data sources from manifest)
  ================================================================== */
  function buildCredits() {
    /* Everything this map owes a credit to, in one list.

       Two things feed it. The atlas's own sources are settled when it is built
       and arrive in the manifest. A layer's are not: a layer made by joining
       rows to borrowed shapes only knows whose shapes it borrowed once the join
       has happened, and a layer added later has no build step at all to record
       it. So a layer may carry its own credits, and they are folded in here.

       Deduplicated by name, first mention wins, because the same register can
       reach the page twice — once as a source the atlas was built from and
       again as the origin of a shape somebody's data joined to. */
    /* Atlases built before the basemap moved still list CARTO for the map
       basemap; the tiles drawn are OpenFreeMap's, so the credit says so. */
    var sources = (MANIFEST.attributions || []).map(function (a) {
      if (a && /CARTO/.test(String(a.name)) && /basemap/i.test(String(a.note || "")))
        return { name: "OpenStreetMap contributors & OpenFreeMap", url: "https://openfreemap.org", note: a.note, license: "ODbL" };
      return a;
    });
    var already = {};
    sources.forEach(function (a) { already[String(a.name).toLowerCase()] = true; });
    (MANIFEST.layers || []).forEach(function (L) {
      (L.credits || []).forEach(function (a) {
        var k = String(a && a.name || "").toLowerCase();
        if (!k || already[k]) return;
        already[k] = true;
        sources.push(a);
      });
    });

    var box = $("#data-credits");
    if (box && sources.length) {
      box.innerHTML = sources.map(function (a) {
        var name = a.url ? '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.name) + "</a>" : esc(a.name);
        return '<li><span class="cr-name">' + name + "</span>" +
          (a.note ? '<span class="cr-note">' + esc(a.note) + "</span>" : "") +
          (a.license ? '<span class="cr-lic">' + esc(a.license) + "</span>" : "") + "</li>";
      }).join("");
    }

    // layers contributed by collaborating orgs — credit them by name
    var contrib = (MANIFEST.layers || []).filter(function (L) {
      return L.addedBy && (L.addedBy.org || L.addedBy.name);
    });
    var wrap = $("#contrib-credits"), list = $("#contrib-list");
    if (wrap && list && contrib.length) {
      wrap.hidden = false;
      list.innerHTML = contrib.map(function (L) {
        var org = L.addedBy.org || "";
        var person = L.addedBy.name || "";
        var by = org && person ? org + " (" + person + ")" : (org || person);
        return '<li><span class="cr-name">' + esc(L.label || L.id) + "</span> " +
          '<span class="cr-by">— added by ' + esc(by) + "</span></li>";
      }).join("");
    }

    /* Boundaries that came from OpenStreetMap carry a licence with a condition
       attribution alone does not satisfy.

       ODbL is share-alike: a database derived from OpenStreetMap has to be
       offered under ODbL too, and the boundary file this atlas serves IS such
       a database. Saying so, and pointing at the file, is what the licence
       asks and costs one line. Nothing is said on an atlas that has no such
       layer, because a notice about data you do not carry is noise. */
    /* Layers only — never the merged list. The basemap is OpenStreetMap too,
       and it is in that list on every atlas ever built. But showing somebody
       else's map underneath yours is not redistributing their database, and a
       notice that appears on every map regardless of what it carries tells a
       reader nothing. What triggers this is a layer whose SHAPES came from
       OpenStreetMap: a boundary file built from it, or somebody's own data
       joined to an outline borrowed from it. */
    var usesOsm = (MANIFEST.layers || []).some(function (L) {
      if (/openstreetmap/i.test(String(L.attribution || ""))) return true;
      return (L.credits || []).some(function (a) {
        return /openstreetmap/i.test(String(a && a.name || ""));
      });
    });
    var odbl = $("#odbl-note");
    if (odbl && usesOsm) {
      odbl.hidden = false;
      odbl.innerHTML = "Boundary data from OpenStreetMap on this map is available under the " +
        '<a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">' +
        "Open Database Licence</a>, as are the files it is served from.";
    }

    /* The people who walked the ground.

       A source of data gets a line under "Data & sources". The people who
       stood in the place and tagged it are not a source, and six names in
       that list would read like six databases, each wanting a licence. They
       get a line of their own.

       The order is left exactly as the manifest sets it. Whoever wrote the
       list chose that order — alphabetical, or who walked furthest — and a
       page that quietly re-sorts names has taken a decision that was not
       its own to take. */
    var walk = MANIFEST.taggedBy;
    var people = Array.isArray(walk) ? walk : ((walk && walk.people) || []);
    var wbox = $("#walk-credits"), wline = $("#walk-list"), whead = $("#walk-head");
    if (wbox && wline && people.length) {
      wbox.hidden = false;
      if (whead && walk && walk.heading) whead.textContent = walk.heading;
      wline.innerHTML = people.map(function (n) {
        return '<span class="walk-name">' + esc(n) + "</span>";
      }).join(", ");
    }
  }

  /* ==================================================================
     THE OWNER'S DOOR INTO THIS PAGE

     An atlas has one home, and this is it. A reader sees the map; whoever
     owns the atlas sees the same map with its controls live, because
     checkOwner() fetches owner.js once the API confirms they may edit.

     Everything the owner's tools are allowed to touch is listed below and
     nothing else. The narrow door is the point: the atlas used to be edited
     on a second page that framed this one, and the two grew a second panel,
     a second layer list and a second idea of what a layer was. A small,
     named surface is what stops that happening again.
  ================================================================== */

  var controlsHooks = [];
  var layerExtraHooks = [];

  /* Draw a DIFFERENT dataset into this same page, keeping the page itself.

     Editing a layer previews a draft build of the atlas, and the draft is a
     real folder that the real viewer can read — so previewing means pointing
     this viewer at it, not reloading the browser and losing the panel, the
     open sheet and the scroll position.

     Everything start() built is torn down first. A map left behind keeps its
     canvas, its markers and its listeners alive underneath the new one, and
     the three "wired" guards below all protect map listeners, which die with
     the map — leaving them set would silently kill fanning and clustering
     for the rest of the visit. */
  /* The phone's row of group tabs, built from the groups the panel just drew.

     It reads the rendered panel rather than the manifest, so it can never
     disagree with the list it opens — a group that was not drawn gets no tab,
     and the count on a tab is the switches actually on in that group.

     Tabs scroll sideways when the names need more room than the phone has;
     a name is never cut short, because a tab reading "Ecolog…" is a guess
     and a tab reading "Ecological landscape" is a place to go. Whichever tab
     you came in by stays lit and stays where it was, so the way out is the
     way you came. */
  var TRAY = null;              // which group the sheet is showing, if any

  function buildBar() {
    var bar = document.getElementById("atlas-bar");
    var stage = document.querySelector(".atlas-stage");
    if (!bar || !stage) return;
    var secs = [].slice.call(document.querySelectorAll("#atlas-controls .ctl-group[data-group]"));
    bar.innerHTML = "";
    if (!secs.length) { bar.hidden = true; return; }
    bar.hidden = false;

    function onIn(sec) {
      return sec.querySelectorAll('.ctl-toggle input[type="checkbox"]:checked').length;
    }
    /* "Your data 11", not "Your data 1": a group holding one Map Browser
       layer counts its people or places, which is what a reader wants to
       know. With two layers in the group the number goes back to layers —
       eleven people plus sixty-six places is not one number. */
    function tabCount(sec) {
      var rows = sec.querySelectorAll(".ctl-row");
      var on = onIn(sec);
      if (rows.length === 1 && on === 1 && rows[0].hasAttribute("data-count")) {
        var n = +rows[0].getAttribute("data-count");
        var coll = rows[0].querySelector(".ctl-coll");
        var lid = coll && coll.getAttribute("data-layer");
        var L = null; (MANIFEST.layers || []).some(function (x) { if (x.id === lid) { L = x; return true; } return false; });
        return { n: n, said: L ? countWords(n, layerNoun(L)) : n + " on" };
      }
      return { n: on, said: on + " on" };
    }
    secs.forEach(function (sec) {
      var id = sec.getAttribute("data-group");
      var label = sec.getAttribute("data-group-label") || id;
      var tc = tabCount(sec), count = tc.n;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "atlas-tab";
      b.setAttribute("data-mark", id);
      b.setAttribute("aria-expanded", String(TRAY === id));
      b.setAttribute("aria-label", label + (count ? ", " + tc.said : ""));
      b.appendChild(document.createTextNode(label));
      if (count) {
        var c = document.createElement("span");
        c.className = "tab-on"; c.textContent = String(count);
        c.setAttribute("aria-hidden", "true");
        b.appendChild(c);
      }
      b.onclick = function () { openTray(TRAY === id ? null : id); };
      bar.appendChild(b);
    });
    // the lit tab stays in view, even when the row has scrolled
    var lit = bar.querySelector('.atlas-tab[aria-expanded="true"]');
    if (lit && lit.scrollIntoView) {
      try { lit.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {}
    }
  }

  function openTray(which) {
    var stage = document.querySelector(".atlas-stage");
    var panel = document.getElementById("atlas-panel");
    if (!stage || !panel) return;
    TRAY = which;
    stage.classList.toggle("tray-open", !!which);
    var secs = [].slice.call(document.querySelectorAll("#atlas-controls .ctl-group[data-group]"));
    secs.forEach(function (sec) {
      sec.classList.toggle("on-show", sec.getAttribute("data-group") === which);
    });
    buildBar();
    if (which) {
      // focus stays on the tab that opened the group: the rows are right
      // beneath it, and a thumb that just tapped here is still here
      var tab = document.querySelector('.atlas-tab[data-mark="' + which + '"]');
      if (tab) { try { tab.focus({ preventScroll: true }); } catch (e) { tab.focus(); } }
      var controls = document.getElementById("atlas-controls");
      if (controls) controls.scrollTop = 0;
    }
  }

  /* The grab bar's job: open the first group, or put the open one away. */
  function toggleSheet() {
    if (TRAY) { openTray(null); return; }
    var first = document.querySelector("#atlas-controls .ctl-group[data-group]");
    if (first) openTray(first.getAttribute("data-group"));
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && TRAY) {
      var was = TRAY;
      openTray(null);
      var m = document.querySelector('.atlas-tab[data-mark="' + was + '"]');
      if (m) m.focus();
    }
  });

  function reboot(dataset) {
    Object.keys(markersByLayer).forEach(function (id) {
      (markersByLayer[id] || []).forEach(function (mk) { try { mk.remove(); } catch (e) {} });
    });
    if (map) { try { map.remove(); } catch (e) {} map = null; }
    MANIFEST = null; activeBasemap = null;
    TRAY = null;                  // the tray cannot outlive the groups it was showing
    var stageEl = document.querySelector(".atlas-stage");
    if (stageEl) stageEl.classList.remove("tray-open");
    DATA = {}; markersByLayer = {}; cropState = {}; keyState = {}; pmSources = {};
    SPIDER = { items: null, anchor: null, svg: null, pop: null, cid: null };
    SEL = { L: null, row: null, ref: null };
    if (CUE.el) { CUE.el.remove(); CUE.el = null; }
    if (CUE.mk) { try { CUE.mk.remove(); } catch (e) {} CUE.mk = null; }
    CLUSTER = { ready: false, off: false, wired: false, radiusNow: CLUSTER_RADIUS,
                hovering: false, hoverId: null,
                byKey: {}, boundsCache: {}, refreshTimer: null, syncTimer: null };
    DIM = { el: null };
    HINT = { el: null, key: null };
    rowFlipsWired = false; spiderWired = false;
    var panel = $("#atlas-controls");
    if (panel) panel.innerHTML = "";
    $("#atlas-map").innerHTML = "";
    DATASET = dataset;
    BASE = VIA_API ? "./api/datasets/" + DATASET + "/" : "./datasets/" + DATASET + "/";
    return draw();
  }

  window.LokaAtlas = {
    get map() { return map; },
    get manifest() { return MANIFEST; },
    get dataset() { return DATASET; },
    /* Called every time the panel is rebuilt — on first draw and after every
       reboot. The owner's tools add their rows to the panel that is already
       here rather than drawing a panel of their own, so "layers" can never
       mean two different things in two places again. */
    onLayerExtra: function (fn) {
      layerExtraHooks.push(fn);
      // catch the rows already on screen when the tools arrive
      (MANIFEST && MANIFEST.layers || []).forEach(function (L) {
        if (L._extra) { try { fn(L, L._extra); } catch (e) { console.error("Atlas: a layer door failed —", e && e.message, e); } }
      });
    },
    onControlsBuilt: function (fn) {
      controlsHooks.push(fn);
      if (MANIFEST) { try { fn(); } catch (e) { console.error("Atlas owner hook error:", e && e.message); } }
    },
    /* Where a data file for the atlas CURRENTLY drawn actually lives. The
       owner's tools count the kinds in a layer by reading its own geojson, and
       a private atlas is served from a different root than a public one — so
       the address has to come from whoever already knows, not be guessed a
       second time. After a reboot this answers for the draft, which is exactly
       what the preview needs. */
    /* Takes either a plain file name or a layer, so a caller that has the
       layer gets the contents-addressed URL and does not have to know how. */
    fileUrl: function (nameOrLayer) {
      if (nameOrLayer && typeof nameOrLayer === "object") return layerUrl(nameOrLayer);
      return dataUrl(nameOrLayer);
    },
    // the owner's tools need a layer's loaded places to know what it already
    // carries — without this the door would have to fetch the file twice
    dataFor: function (id) { return DATA[id] || null; },
    // call before reboot when a layer's file has been rewritten, so the reboot
    // reads the new file instead of the one the browser already has
    dataChanged: bumpDataVersion,
    /* Draw every layer's row again. The owner's tools need this because who may
       change which layer arrives from the server after the panel is already on
       screen — without it a door that was refused at registration, for want of
       an answer that had not come back yet, would never be offered again. */
    redrawLayerRows: function () {
      (MANIFEST && MANIFEST.layers || []).forEach(function (L) { if (L._extra) renderExtra(L); });
    },
    reboot: reboot,
    // the phone sheet's grab bar lives in index.html; it asks here
    toggleSheet: toggleSheet,
  };

  function setText(sel, txt) { var e = $(sel); if (e) e.textContent = txt; }
})();
