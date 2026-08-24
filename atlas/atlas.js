/* LOKA Atlas — a generic, manifest-driven map engine (MapLibre GL JS).
 * Give it a dataset folder containing manifest.json + data files and it builds
 * the map, the layer-control widget, legends, popups and the credits footer.
 * No layer is hard-coded: everything is described declaratively in the manifest. */
(function () {
  "use strict";

  try {
    console.log(
      "%cLOKA Atlas%c · a Socratus project\n%cOpen data, openly mapped — discoverloka.org",
      "font:700 15px/1.5 Figtree,system-ui,sans-serif;color:#1A7048",
      "font:500 12px/1.5 system-ui,sans-serif;color:#4D6050",
      "font:400 11px/1.5 system-ui,sans-serif;color:#7A8E7A"
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
  }
  // Public datasets are plain static files. A private atlas's files sit outside
  // the web root, so they come through the API instead, and there are two ways to
  // be allowed: a view key in the address, or — with ?via=api and no key — the
  // signed-in owner's own session. The session route is what lets the owner
  // preview a private atlas, since the plaintext key is issued once at creation
  // and only its hash is kept, so no page can look it up later.
  var VIA_API = !!KEY || QS.get("via") === "api";
  var BASE = VIA_API ? "./api/datasets/" + DATASET + "/" : "./datasets/" + DATASET + "/";
  function dataUrl(file) {
    if (!KEY) return BASE + file;
    return BASE + file + (file.indexOf("?") < 0 ? "?key=" : "&key=") + encodeURIComponent(KEY);
  }
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
  // the wizard's named single colours (fragment.js MARKER_COLORS), for "one colour"
  var ONE_COLORS = { rust: "#A6522F", moss: "#40573D", ochre: "#B0863A", sienna: "#9C5A34", slate: "#5f7f92" };
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
    draw().then(function (ok) { if (ok) checkOwner(); });
  }

  /* Read the atlas's manifest and draw from it. One function rather than a
     chain at the top level, because it has to be repeatable: while the owner
     edits a layer the map previews a DRAFT copy of the atlas, and the honest
     way to show a draft is the real viewer reading the real draft folder — not
     a second renderer that could quietly disagree with this one. See reboot().
     Resolves true when something was drawn, false when the reader has been
     handed an error in the map's place. */
  function draw() {
    return fetch(dataUrl("manifest.json"))
      .then(function (r) {
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
      .then(function (m) { start(m); return true; })
      .catch(function (err) {
        $("#atlas-map").innerHTML =
          '<div class="atlas-error">Could not load “' + esc(DATASET) + '”.<br><small>' + esc(err.message) + "</small></div>";
        return false;
      });
  }

  // The LOKA Atlas home: featured reference instance, published instances, build CTA.
  function renderHome() {
    document.title = "LOKA Atlas \u2014 layered maps for any geography";
    // the eyebrow claims "interactive map" \u2014 on the gallery there is no map
    setText(".eyebrow", "atlas gallery \u00b7 loka atlas");
    setText("#atlas-title", "LOKA Atlas");
    setText("#atlas-subtitle", "Layered, shareable maps for any geography \u2014 built from open data.");
    setText("#atlas-about", "Every atlas below is built with the same engine: pick a region, choose layers, add your data, and share it. Public tech by Socratus.");
    var home = $("#atlas-home");
    var stage = document.querySelector(".atlas-stage");
    if (stage) stage.style.display = "none";
    var credits = document.querySelector(".atlas-credits");
    if (credits) credits.style.display = "none";
    var cta = document.querySelector(".atlas-cta");
    if (cta) cta.style.display = "none";
    home.hidden = false;

    var grid = $("#home-grid");
    grid.innerHTML = "";

    function card(href, tag, tagCls, title, blurb, go) {
      var a = el("a", "home-card");
      a.href = href;
      a.innerHTML = '<span class="tag' + (tagCls ? " " + tagCls : "") + '">' + esc(tag) + "</span>" +
        "<h2>" + esc(title) + "</h2><p>" + esc(blurb) + '</p><span class="go">' + esc(go) + " \u2192</span>";
      return a;
    }

    grid.appendChild(card("./?dataset=deoria-bioregion", "Featured atlas", "template",
      "Deoria \u00b7 Kushinagar \u00b7 Gorakhpur",
      "Built with the Systems Practice at Socratus and Jagriti \u2014 crops, value chains and ecology across three eastern-UP districts.",
      "Open the atlas"));

    var build = card("./setup/", "For organisations", "",
      "Build your own atlas",
      "Pick a region anywhere in the world, choose layers, add your branding and data \u2014 free to start. Sign in with just your email when you publish.",
      "Start the wizard");
    build.className = "home-card build";
    grid.appendChild(build);

    // published instances from the registry (best-effort; fine without the API)
    fetch("./api/instances")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.instances) return;
        data.instances.forEach(function (i) {
          if (i.slug === "deoria-bioregion") return;
          var c = card("./?dataset=" + encodeURIComponent(i.slug), "Atlas", "",
            i.title, [i.org, i.regionLabel].filter(Boolean).join(" \u00b7 ") || "Built with LOKA Atlas.",
            "Open the atlas");
          grid.insertBefore(c, build);
        });
      })
      .catch(function () {});
  }

  // Org-added layers live in a gitignored overlay (manifest.local.json + user-*.geojson)
  // so a `git pull` on the server never conflicts with them.
  function mergeLocalOverlay(manifest) {
    return fetch(dataUrl("manifest.local.json"))
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (local) {
        if (!local) return manifest;
        (local.layers || []).forEach(function (L) {
          // contributed layers carry their credit into the layer's info tooltip
          if (L.addedBy && (L.addedBy.org || L.addedBy.name)) {
            var by = "Added by " + (L.addedBy.org || L.addedBy.name);
            L.info = L.info ? L.info + " — " + by : by;
          }
          manifest.layers.push(L);
        });
        (local.groups || []).forEach(function (g) {
          if (!manifest.groups.some(function (x) { return x.id === g.id; })) manifest.groups.push(g);
        });
        (local.attributions || []).forEach(function (a) { manifest.attributions.push(a); });
        return manifest;
      });
  }

  function start(manifest) {
    MANIFEST = manifest;
    document.title = manifest.title + " — LOKA Atlas";
    setText("#atlas-title", manifest.title);
    setText("#atlas-subtitle", manifest.subtitle || "");
    setText("#atlas-about", manifest.about || "");
    renderBranding(manifest.branding);
    renderCollaborators(manifest);
    wireShare(manifest);

    activeBasemap = (manifest.basemaps.find(function (b) { return b.default; }) || manifest.basemaps[0]).id;

    map = new maplibregl.Map({
      container: "atlas-map",
      style: baseStyle(manifest),
      center: manifest.center,
      zoom: manifest.zoom,
      minZoom: manifest.minzoom || 5,
      maxZoom: manifest.maxzoom || 16,
      attributionControl: false,
      hash: false
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");
    // attribution is rendered in a strip below the map (renderMapAttrib), not over it
    window.__map = map;   // debug hook
    map.on("error", function (e) { console.error("Atlas map error:", e && e.error && e.error.message); });

    // The layers panel and credits are plain DOM built from the manifest — they
    // must never wait on the basemap. On a slow tile fetch (or a throttled
    // iframe) the map's "load" can be seconds away, and the atlas looked empty:
    // no controls, no legend, nothing. Build them immediately; only the map
    // layers themselves wait for "load".
    try { buildControls(); buildCredits(); }
    catch (err) { console.error("Atlas controls error:", err && err.message, err && err.stack); }

    map.on("load", function () {
      try {
        // buildLayers preloads sources async, so layer ids (L._ids) only exist once
        // it resolves. wirePopups + fitToData depend on those, so run them after.
        renderMapAttrib();
        buildLayers().then(function () {
          wirePopups();
          syncSearchBox();   // the data is in: keep the search box only if it has text to search
          if (!focusFit()) fitToData(false);
          renderMapAttrib(); // re-run once layer sources (e.g. labels) are added
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
        var lbl = el("span", null, "By <b>" + esc(b.orgName) + "</b>");
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
      private: !!KEY,
    };
    btn.onclick = function () { window.AtlasShare.open(btn.__shareOpts); };
  }

  // Frame the data within the map area that's actually visible — i.e. to the right of the
  // control widget when it floats over the map (desktop), full width when it's docked below (mobile).
  // Draft previews set MANIFEST.focusLayer — frame the proposed layer, not the
  // whole atlas, so the user lands on their own data.
  function focusFit(animate) {
    var d = MANIFEST.focusLayer && DATA[MANIFEST.focusLayer];
    if (!d || !d.features || !d.features.length) return false;
    var w = 180, s = 90, e = -180, n = -90;
    d.features.forEach(function (f) {
      (function walk(c) {
        if (!Array.isArray(c)) return;
        if (typeof c[0] === "number") {
          if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
          if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
        } else c.forEach(walk);
      })((f.geometry && f.geometry.coordinates) || []);
    });
    if (e < w || n < s) return false;
    if (e - w < 0.01) { w -= 0.02; e += 0.02; }   // single point: give it room
    if (n - s < 0.01) { s -= 0.02; n += 0.02; }
    map.fitBounds([[w, s], [e, n]], { padding: 60, duration: animate ? 350 : 0, maxZoom: 13 });
    return true;
  }

  function fitToData(animate) {
    if (!MANIFEST.bounds || !map) return;
    var pad = { top: 40, right: 40, bottom: 40, left: 40 };
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
      }
    } catch (e) {}
    map.fitBounds(MANIFEST.bounds, { padding: pad, duration: animate ? 350 : 0 });
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
  var CARTO = ["a", "b", "c"];
  function cartoTiles(style) {
    // @2x with tileSize 256 — a 512px image drawn into a 256pt tile, which is
    // what a retina screen needs. At 1x the whole surface is upscaled and soft,
    // labels worst of all, because text is where blur shows first.
    return CARTO.map(function (h) {
      return "https://" + h + ".basemaps.cartocdn.com/" + style + "/{z}/{x}/{y}@2x.png";
    });
  }

  var APP_BASEMAPS = {
    // "Streets & colour" — roads, parks and water in gentle colour. Chosen from
    // the six laid out in map-style-variations.html.
    light: {
      tiles: cartoTiles("rastertiles/voyager_nolabels"),
      labels: cartoTiles("rastertiles/voyager_only_labels"),
      tileSize: 256, maxzoom: 19,
      attribution: "© OpenStreetMap contributors © CARTO",
      ground: "#FBF8F3",
    },
    satellite: {
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      labels: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256, maxzoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
      ground: "#2B2F33",
    },
  };

  // The ground behind the tiles, so a slow fetch shows the map's own colour
  // rather than a grey belonging to no basemap. Starts as the app's everyday
  // map and is re-read from whichever basemap the atlas opens on, so there is
  // no third colour to keep in step.
  var mapGround = APP_BASEMAPS.light.ground;

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
        if (APP_BASEMAPS[id] && APP_BASEMAPS[id].labels) L.tilesByBasemap[id] = APP_BASEMAPS[id].labels;
      });
    });
    return m;
  }

  function baseStyle(m) {
    var sources = {}, layers = [
      { id: "bg", type: "background", paint: { "background-color": mapGround } }
    ];
    m.basemaps.forEach(function (b) {
      sources["base-" + b.id] = {
        type: "raster", tiles: b.tiles, tileSize: b.tileSize || 256,
        maxzoom: b.maxzoom || 19, attribution: b.attribution || ""
      };
      layers.push({
        id: "base-" + b.id, type: "raster", source: "base-" + b.id,
        layout: { visibility: b.id === activeBasemap ? "visible" : "none" }
      });
    });
    return { version: 8, glyphs: m.glyphs, sources: sources, layers: layers };
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
      return fetch(dataUrl(L.source))
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (d) { DATA[L.id] = d; })
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
      addLabel(L);
    });
  }

  // Feature-state driven outline: invisible until a feature is hovered (thin dark) or
  // selected (bold orange, persists while the map pans). Only for clickable layers.
  function addHighlight(L) {
    if (!L.popup || !map.getSource(srcId(L))) return;
    map.addLayer(withFilter(L, {
      id: L.id + "-hl", type: "line", source: srcId(L), layout: { visibility: vis(L) },
      paint: {
        "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#A6522F", "#1e2a1c"],
        "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3.4, ["boolean", ["feature-state", "hover"], false], 1.8, 0],
        "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 1, ["boolean", ["feature-state", "hover"], false], 0.9, 0]
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
          "circle-radius": p.radius || 5, "circle-color": p.color || "#f97316",
          "circle-stroke-color": p.strokeColor || "#fff", "circle-stroke-width": p.strokeWidth != null ? p.strokeWidth : 1.5,
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
  function labelPointSource(L) {
    var gj = DATA[L.id];
    if (!gj || !gj.features) return null;
    var pts = [];
    gj.features.forEach(function (f) {
      var p = labelAnchorPoint(f.geometry);
      if (p) pts.push({ type: "Feature", properties: f.properties, geometry: { type: "Point", coordinates: p } });
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
    var layout = {
      visibility: vis(L),
      "text-field": ["coalesce", ["get", t.property], ""],
      "text-size": t.size || 12,
      "text-font": ["Open Sans Regular"],
      "symbol-placement": L.type === "line" ? "line" : "point",
      "text-allow-overlap": !!t.alwaysShow,
      "text-ignore-placement": !!t.alwaysShow,
      "text-optional": !t.alwaysShow
    };
    if (t.transform) layout["text-transform"] = t.transform;
    if (t.letterSpacing) layout["text-letter-spacing"] = t.letterSpacing;
    if (t.minzoom == null) {} else layout["text-size"] = ["interpolate", ["linear"], ["zoom"], (t.minzoom - 0.5), 0, t.minzoom, t.size || 12];
    var paint = {
      "text-color": t.color || "#fff",
      "text-halo-color": t.haloColor || "#000",
      "text-halo-width": t.haloWidth || 1.2
    };
    map.addLayer(withFilter(L, { id: L.id + "-label", type: "symbol", source: source, layout: layout, paint: paint }));
    L._ids.push(L.id + "-label");
  }

  function addImage(L) {
    var meta = DATA[L.id];
    if (!meta) return;
    L._imageMeta = meta;
    map.addSource(srcId(L), { type: "image", url: dataUrl(meta.image), coordinates: meta.coordinates });
    map.addLayer({ id: L.id + "-img", type: "raster", source: srcId(L), layout: { visibility: vis(L) }, paint: { "raster-opacity": L.opacity != null ? L.opacity : 0.8, "raster-fade-duration": 0 } });
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
        map.addSource(srcId(L) + "-" + bm, { type: "raster", tiles: L.tilesByBasemap[bm], tileSize: L.tileSize || 256, attribution: L.attribution || "" });
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
    var mode = cropState[L.id];
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
      var cfg = (L.markers && L.markers[f.properties[L.markerBy]]) || L.markerDefault || L.marker || {};
      var wrap = el("div", "atlas-marker");
      // pin + label live in an inner node: MapLibre owns the wrap's transform
      // (true position), the node alone takes the spiderfy displacement — see
      // the SPIDERFY section below.
      var node = el("div", "atlas-mnode");
      var pin = el("div", "atlas-pin" + (cfg.ring ? " ring" : ""));
      pin.style.setProperty("--pin", cfg.color || "#f97316");
      // Explicit icons and glyphs are an atlas's own bespoke styling (deoria's
      // factory and flask) and stay exactly as declared. The DERIVED icon —
      // guessed from a kind's words on contributed layers — is retired: those
      // pins carry nothing inside, and the keys a layer can wear are drawn
      // beside the pin instead (see KEYS WEAR ROWS below).
      if (cfg.icon && ICONS[cfg.icon]) pin.innerHTML = ICONS[cfg.icon];
      else if (cfg.glyph) pin.textContent = cfg.glyph;
      node.appendChild(pin);
      if (L.label_text) node.appendChild(el("span", "atlas-mlabel", esc(f.properties[L.label_text.property])));
      wrap.appendChild(node);
      var mk = new maplibregl.Marker({ element: wrap, anchor: "bottom" }).setLngLat(f.geometry.coordinates).addTo(map);
      // keep the feature alongside its marker so search can gate it by content;
      // node is kept so a key change can redraw the marks without touching the
      // marker element MapLibre owns (or any wiring on it)
      var entry = { mk: mk, f: f, color: cfg.color || "", node: node };
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
      pts.push(f.geometry.coordinates);
    });
    L._pts = pts;
    if (L.cluster && pts.length) setupCluster(L);
    applyMarkerVisibility(L);
    initLayerKeys(L);
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
    return String(name).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  }

  // Marker layers contributed through the wizard may offer their qualifying
  // columns as keys. Curated layers (Deoria's pins) never enter here.
  function initLayerKeys(L) {
    if (!L.userLayer || L.type !== "marker" || L._keyOptions) return;
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
      var committed = committedCol === col;
      var nonEmpty = [];
      feats.forEach(function (f) {
        var v = f.properties ? f.properties[col] : undefined;
        if (v !== undefined && v !== null && v !== "") nonEmpty.push(String(v));
      });
      if (!nonEmpty.length) return;
      // multi-value cells: the same rule the server uses (fragment.js detectDelimiter)
      var delim = null;
      [";", ","].forEach(function (d) {
        if (!delim && nonEmpty.filter(function (v) { return v.indexOf(d) >= 0; }).length >= nonEmpty.length * 0.4) delim = d;
      });
      var counts = [], seen = {};
      nonEmpty.forEach(function (v) {
        if (delim) { var i = v.indexOf(delim); if (i >= 0) v = v.slice(0, i); }
        v = v.trim().slice(0, 40);
        if (!v) return;
        if (seen[v] == null) { seen[v] = counts.length; counts.push({ kind: v, n: 0 }); }
        counts[seen[v]].n++;
      });
      if (!committed) {
        if (counts.length < 2) return;
        // the counting caps: fewer than 10 kinds for a one-answer column,
        // at most 12 first-tags for a list column
        if (delim ? counts.length > 12 : counts.length > 9) return;
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
      if (!committed && named / feats.length < 0.6) return;   // the named kinds must cover most places
      opts.push({ col: col, label: prettyCol(col), delim: delim, committed: committed,
                  kept: kept, hasOther: named < feats.length });
    });
    // committed key first; the rest keep the order the data carries them in
    opts.sort(function (a, b) { return (b.committed ? 1 : 0) - (a.committed ? 1 : 0); });
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
    var parts = opt.delim ? String(v).split(opt.delim) : [String(v)];
    var out = [], seen = {};
    parts.forEach(function (s) {
      s = s.trim().slice(0, 40);
      if (!s || seen[s]) return;
      seen[s] = 1;
      out.push(s);
    });
    return out;
  }

  function oneColorOf(L) {
    if (L.marker && L.marker.color) return L.marker.color;
    if (L.spec && ONE_COLORS[L.spec.markerColor]) return ONE_COLORS[L.spec.markerColor];
    return ONE_COLORS.rust;
  }

  // The neutral pin: white body, thin border in the layer's one colour,
  // nothing inside. This is every keyed pin, keys on or off — the rows
  // beside it carry the answers.
  function keyPinEl(color) {
    var pin = el("div", "atlas-pin");
    pin.style.setProperty("--pin", color);
    return pin;
  }

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
    var KEY_STACK_NOTE = "The map can show five keys at once, and all five are on. Turn one off to add {name}.";
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
  function renderMarks(L, entry, act) {
    var node = entry.node;
    if (!node) return;
    while (node.firstChild && node.firstChild.className !== "atlas-mlabel") node.removeChild(node.firstChild);
    entry._rowsW = 0;
    entry._rowsEl = null;
    var rows = [];
    act.forEach(function (opt, fi) {
      var vals = optValuesOf(L, opt, entry.f);
      if (!vals.length) return;   // no answer under this key: no row
      rows.push({ shape: ROW_SHAPES[fi], colors: vals.map(function (v) {
        var slot = opt.kept.indexOf(v);
        return slot >= 0 ? keyKindColor(L, opt, fi, slot) : KEY_OTHER;
      }) });
    });
    if (!rows.length) {
      node.insertBefore(keyPinEl(oneColorOf(L)), node.firstChild);
      return;
    }
    var holder = el("div", "atlas-rowed");
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
  function keyLegendRows(L, act) {
    if (!act.length) {
      return [{ color: oneColorOf(L), label: String(L.label || "").slice(0, 40), shape: "dot" }];
    }
    var rows = [];
    act.forEach(function (opt, fi) {
      rows.push({ header: true, label: opt.label + " — " + ROW_WORDS[fi] });
      opt.kept.forEach(function (kind, i) {
        rows.push({ color: keyKindColor(L, opt, fi, i), label: kind, categorical: true, family: ROW_SHAPES[fi] });
      });
      if (opt.hasOther) rows.push({ color: KEY_OTHER, label: "other", categorical: true, family: ROW_SHAPES[fi] });
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
  function keyRowsEl(L, props) {
    var act = activeKeyOptions(L);
    if (!act.length) return null;
    var f = { properties: props };
    var box = el("div", "key-rows");
    act.forEach(function (opt, fi) {
      var vals = optValuesOf(L, opt, f);
      var row = el("div", "key-row" + (vals.length ? "" : " blank"));
      var mini = markEl(ROW_SHAPES[fi], "#6b6353");   // names the key, claims no colour
      mini.setAttribute("class", "key-mark");
      row.appendChild(mini);
      row.appendChild(el("span", "key-name", esc(opt.label)));
      row.appendChild(el("span", "key-word", vals.length ? esc(vals.join(", ")) : "left blank"));
      box.appendChild(row);
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
    var n = (st && st.active.length && L._visible !== false) ? foldedCount(L) : 0;
    if (!n) { box.hidden = true; box.textContent = ""; return; }
    box.textContent = n === 1
      ? "1 place in this view is inside a numbered disc — zoom in to see its marks."
      : n + " places in this view are inside the numbered discs — zoom in to see their marks.";
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
    wrap.setAttribute("aria-label", "Show key");
    wrap.appendChild(el("span", "key-chips-lbl", "Show key"));
    var list = el("div", "key-list");
    // The cap message, when it has something to say (kept in st.note so a
    // rebuild mid-conversation does not eat it). role=status: the refused
    // switch snaps back visually — a screen reader must hear why.
    var note = el("div", "key-note");
    note.setAttribute("role", "status");
    note.hidden = !st.note;
    if (st.note) note.textContent = st.note;
    L._keyOptions.forEach(function (opt) {
      var lab = el("label", "ctl-toggle key-toggle");
      var cb = el("input"); cb.type = "checkbox";
      cb.checked = st.active.indexOf(opt.col) >= 0;
      cb._col = opt.col;
      lab.appendChild(cb);
      lab.appendChild(el("span", "ctl-switch small"));
      lab.appendChild(el("span", "key-tname", esc(opt.label)));
      cb.onchange = function () {
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
      list.appendChild(lab);
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

  // Writes display for one layer's pins. `e._clustered` is the cluster
  // engine's verdict (folded into a disc, or outside the viewport);
  // `e._fanned` overrides it while that pin is spread out of a fan.
  function paintMarkerDisplay(L) {
    var shown = L._visible !== false;
    var folded = L.cluster && L._clusterMarker && map.getZoom() < L.cluster.belowZoom;
    (markersByLayer[L.id] || []).forEach(function (e) {
      e.mk.getElement().style.display =
        (shown && !folded && !e.hidden && (!e._clustered || e._fanned)) ? "" : "none";
    });
    if (L._clusterMarker) L._clusterMarker.getElement().style.display = (shown && folded) ? "" : "none";
  }
  function applyMarkerVisibility(L) {
    // whatever is changing here (layer toggle, badge fold, search) can change
    // who is folded with whom — collapse any open fan rather than chase it
    if (SPIDER.items) spiderCollapse();
    hideHint();   // a pin can vanish from under the pointer; no mouseleave follows
    paintMarkerDisplay(L);
    scheduleClusterRefresh();
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
      paint: { "fill-color": "#4A5A33", "fill-opacity": 0.08 }
    });
    map.addLayer({
      id: "atlas-cluster-bounds-line", type: "line", source: CLUSTER_BOUNDS_SRC,
      paint: { "line-color": "#4A5A33", "line-width": 1.2, "line-dasharray": [2, 2], "line-opacity": 0.5 }
    });
    // Size brackets: small (<10), medium (10–50), large (50+). One moss hue
    // deepening with count — a scale, not a category, because count is a
    // quantity. White bold count clears 4.8:1 on the palest fill, and the
    // white ring lifts the disc off any basemap the way the pins' own white
    // fill does.
    map.addLayer({
      id: CLUSTER_LAYER, type: "circle", source: CLUSTER_SRC,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": ["step", ["get", "point_count"], "#66784A", 10, "#4A5A33", 50, "#2E3A20"],
        "circle-radius": ["step", ["get", "point_count"], 13, 10, 17, 50, 22],
        "circle-stroke-color": "#FFFFFF",
        "circle-stroke-width": 2
      }
    });
    map.addLayer({
      id: "atlas-cluster-count", type: "symbol", source: CLUSTER_SRC,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["Open Sans Bold"],
        "text-size": ["step", ["get", "point_count"], 12, 10, 13, 50, 14],
        // the count IS the feature — it must never lose a placement contest
        "text-allow-overlap": true,
        "text-ignore-placement": true
      },
      paint: { "text-color": "#FFFFFF" }
    });
    wireClusterEvents();
    CLUSTER.ready = true;
    return true;
  }

  function clusterAt(pt) {
    if (!CLUSTER.ready || !map.getLayer(CLUSTER_LAYER)) return null;
    var hits = map.queryRenderedFeatures(pt, { layers: [CLUSTER_LAYER] });
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
    ["atlas-cluster-count", CLUSTER_LAYER, "atlas-cluster-bounds-line", "atlas-cluster-bounds-fill"].forEach(function (id) {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    if (map.getSource(CLUSTER_SRC)) map.removeSource(CLUSTER_SRC);
    if (map.getSource(CLUSTER_BOUNDS_SRC)) map.removeSource(CLUSTER_BOUNDS_SRC);
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
  }

  // every marker click lands here: a fanned pin opens its own popup (fan
  // stays); any other visible pin is a loner by construction — the engine
  // has already folded everything that overlaps — so it pops up directly
  function spiderClick(L, entry) {
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

  function tagFieldsOf(L) {
    var out = ((L.popup && L.popup.fields) || []).filter(function (f) { return f.type === "tags"; }).map(function (f) { return f.property; });
    if (L.markerBy && out.indexOf(L.markerBy) < 0) out.push(L.markerBy);
    return out;
  }
  function splitTags(v) {
    if (v == null) return [];
    return String(v).split(/[;,]/).map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
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
      if (L.type !== "marker") return false;
      var p = L.popup || {};
      return !!(L.userLayer || L.markerBy || p.title || (p.fields && p.fields.length));
    });
  }
  function layerHasText(L) {
    if (L._hasText == null) {
      L._hasText = (markersByLayer[L.id] || []).some(function (e) { return featureText(L, e.f).length > 1; });
    }
    return L._hasText;
  }
  // layers search can actually act on: markers on the map, carrying real text.
  // A layer with nothing searchable is left alone by a query rather than blanked.
  function searchableLayers() {
    return (MANIFEST.layers || []).filter(function (L) {
      return markersByLayer[L.id] && markersByLayer[L.id].length && layerHasText(L);
    });
  }
  function syncSearchBox() {
    var sc = $(".ctl-search"); if (!sc) return;
    sc.style.display = searchableLayers().length ? "" : "none";
  }
  function layerVocab() {
    var v = {};
    searchableLayers().forEach(function (L) { (markersByLayer[L.id] || []).forEach(function (e) { for (var t in featureTagSet(L, e.f)) v[t] = 1; }); });
    return Object.keys(v);
  }
  // `lead` names what is being shown when it is not a typed search — a tapped
  // tag, say. Without it the line reads "5 of 66 shown", which is true and
  // says nothing about why.
  function updateSearchCount(shown, total, pts, lead) {
    var c = $("#atlas-search-count"); if (!c) return;
    if (shown == null) { c.hidden = true; c.textContent = ""; return; }
    c.hidden = false;
    if (lead) {
      c.textContent = shown
        ? shown + (shown === 1 ? " place " : " places ") + lead
        : "no places " + lead;
    } else {
      c.textContent = shown ? (shown + " of " + total + " shown") : "nothing matched — try another word";
    }
    // a filter with no way out is a trap; the words name the way out
    if (lead) {
      var all = el("button", "ctl-search-go", "show all");
      all.type = "button";
      all.onclick = function () { clearSearch(); };
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
  function applySearch(q, tags) {
    var terms = [];
    tags.forEach(function (t) { t = String(t || "").toLowerCase(); if (t && terms.indexOf(t) < 0) terms.push(t); });
    var shown = 0, total = 0, matchPts = [];
    searchableLayers().forEach(function (L) {
      (markersByLayer[L.id] || []).forEach(function (e) {
        total++;
        var text = featureText(L, e.f);
        var match = !!(q && text.indexOf(q) >= 0);
        for (var i = 0; !match && i < terms.length; i++) match = termRe(terms[i]).test(text);
        e.hidden = !match;
        if (match) { shown++; matchPts.push(e.f.geometry.coordinates); }
      });
      applyMarkerVisibility(L);
    });
    updateSearchCount(shown, total, matchPts);
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
  var TAGFILTER = null;

  function filterByTag(tag) {
    // the line is the only way back, so without it this would be a trap
    if (!$("#atlas-search-count")) return;
    if (TAGFILTER === tag) { clearSearch(); return; }
    TAGFILTER = tag;
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
    searchableLayers().forEach(function (L) {
      (markersByLayer[L.id] || []).forEach(function (e) {
        total++;
        var has = !!featureTagSet(L, e.f)[want];
        e.hidden = !has;
        if (has) { shown++; pts.push(e.f.geometry.coordinates); }
      });
      applyMarkerVisibility(L);
    });
    updateSearchCount(shown, total, pts, "tagged \u201c" + tag + "\u201d");
    markLitTags();
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
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest && e.target.closest(".pop-tag[data-tag]");
    if (!b) return;
    e.preventDefault();
    filterByTag(b.getAttribute("data-tag"));
  });

  function clearSearch() {
    searchTags = [];
    TAGFILTER = null;
    markLitTags();
    searchableLayers().forEach(function (L) { (markersByLayer[L.id] || []).forEach(function (e) { e.hidden = false; }); applyMarkerVisibility(L); });
    updateSearchCount(null);
  }
  function runSearch(raw) {
    var q = (raw || "").trim().toLowerCase();
    if (!q) { clearSearch(); return; }
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
          if (!searchTags.length) return;
          var kw2 = layerVocab().filter(function (t) { return t.indexOf(q) >= 0 || q.indexOf(t) >= 0; });
          applySearch(q, kw2.concat(searchTags));
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
  }

  // Basemap + tile attributions, rendered in a strip BELOW the map (not overlaying
  // it). Shows the active basemap's credit plus any raster tile source (e.g. Esri
  // labels); dataset/source credits live in the credits section further down.
  function renderMapAttrib() {
    var el = $("#map-attrib"); if (!el || !map) return;
    var srcs = (map.getStyle() && map.getStyle().sources) || {};
    var seen = {}, parts = [];
    Object.keys(srcs).forEach(function (k) {
      if (/^base-/.test(k) && k !== "base-" + activeBasemap) return; // only the active basemap
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

  function buildControls() {
    var panel = $("#atlas-controls");
    panel.innerHTML = "";

    // basemap switch
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
    panel.appendChild(bm);

    // search box — over marker layers that could carry text (keyword now,
    // semantic on public atlases with embeddings). syncSearchBox() takes it away
    // again once the data is in if none of them actually had any.
    // It floats top-centre OVER THE MAP, not inside this panel: searching the
    // map is a reader's first move, and buried under the layer switches it
    // read as a setting. It lives on the stage so a rebuilt panel (reboot)
    // neither loses nor doubles it — the old one is removed first.
    var stage = document.querySelector(".atlas-stage");
    var oldSearch = stage && stage.querySelector(".ctl-search");
    if (oldSearch) oldSearch.parentNode.removeChild(oldSearch);
    if (stage && manifestSearchable().length) {
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
      stage.appendChild(sc);
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
    var GROUP_LABELS = { userdata: "Your data", base: "Base", agri: "Crops & value chain", eco: "Ecological landscape" };
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
    groupList.forEach(function (g) {
      var layers = MANIFEST.layers.filter(function (L) {
        return (L.group || "userdata") === g.id && !isBaseMapRow(L);
      });
      if (!layers.length) return;
      // Base is expanded on load, and so is any group holding data somebody
      // contributed — that is the whole reason they opened this atlas, and its
      // colour keys live inside that layer's row. Folding it away by default hid
      // the keys completely: they were built, correct, and behind a shut fold.
      // Everything else still collapses so the panel isn't overwhelming. The
      // engine owns this — a manifest's per-group `open` flag is ignored here.
      var mine = layers.some(function (L) { return L.userLayer; });
      var sec = el("section", "ctl-group" + (g.id === "base" || mine ? "" : " collapsed"));
      var head = el("button", "ctl-group-head");
      head.innerHTML = '<span>' + esc(g.label) + '</span><span class="chev">' + ICONS.chevron + '</span>';
      head.onclick = function () { sec.classList.toggle("collapsed"); };
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
      order.forEach(function (o) {
        body.appendChild(o.layer ? layerRow(o.layer) : subGroupSection(subMap[o.sub]));
      });

      sec.appendChild(body);
      panel.appendChild(sec);
    });

    // the owner's tools add their rows to this panel — see LokaAtlas.onControlsBuilt
    controlsHooks.forEach(function (fn) {
      try { fn(); } catch (e) { console.error("Atlas owner hook error:", e && e.message); }
    });
  }

  // sub-group: a master (tri-state) toggle over related layers + a collapse chevron,
  // with each child layer as its own indented row.
  function subGroupSection(sg) {
    var wrap = el("div", "ctl-sub");
    var head = el("div", "ctl-sub-head");
    var lab = el("label", "ctl-sub-toggle");
    var master = el("input"); master.type = "checkbox";
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
    var sw = el("span", "ctl-switch");
    var name = el("span", "ctl-name", esc(L.label));
    top.appendChild(cb); top.appendChild(sw); top.appendChild(name);
    if (L.info) {
      var info = el("span", "ctl-info", ICONS.info);
      info.title = L.info;
      top.appendChild(info);
    }
    row.appendChild(top);

    var extra = el("div", "ctl-extra");
    row.appendChild(extra);
    L._extra = extra;
    L._cb = cb; L._row = row;

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

  function renderExtra(L) {
    var box = L._extra; if (!box) return;
    box.innerHTML = "";
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

    // colour keys for contributed marker layers (see MORE THAN ONE KEY)
    if (L._keyOptions && keyState[L.id]) {
      box.appendChild(buildKeyToggles(L));
      updateFoldNote(L);   // the block is attached now — say straight away what is folded
    }

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

    refreshLegend(L);
  }

  function refreshLegend(L) {
    if (!L._extra || !L._visible) return;
    var old = $(".ctl-legend", L._extra); if (old) old.remove();
    var data = L.type === "categories" ? categoryLegend(L) : (L._legend || L.legend);
    if (!data) data = legendFromPaint(L);   // derive from a match/step colour expression
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
      data.forEach(function (it) {
        // keyed layers group their kinds under a header per key's shape
        if (it.header) { leg.appendChild(el("div", "leg-head", esc(it.label))); return; }
        var r = el("div", "leg-item" + (it.faint ? " faint" : ""));
        r.appendChild(swatch(it));
        r.appendChild(el("span", "leg-label", esc(it.label)));
        leg.appendChild(r);
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
     POPUPS
  ================================================================== */
  function wirePopups() {
    var clickable = MANIFEST.layers.filter(function (L) { return L.popup && L.type !== "marker"; });
    var ids = [];
    clickable.forEach(function (L) { (L._ids || []).forEach(function (id) { if (/-(fill|line|circle)$/.test(id) && !/-hl$/.test(id)) ids.push({ id: id, L: L }); }); });
    var idList = ids.map(function (x) { return x.id; });
    var hoverRef = null, selRef = null;

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
    function clearSel() { if (selRef) { try { map.setFeatureState(selRef, { selected: false }); } catch (e) {} selRef = null; } }

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
      var top = pick(e.point);
      if (!top) { clearSel(); return; }           // click on empty map clears the selection
      clearSel();
      if (top.f.id != null) {
        selRef = { source: top.f.source, id: top.f.id };
        try { map.setFeatureState(selRef, { selected: true }); } catch (e) {}
      }
      openPopup(top.L, top.f, e.lngLat);
    });

    wireCircleHints();   // hover tooltips for circle/bubble layers (style-drawn, not DOM)
  }

  function openPopup(L, feature, lngLat, offsetPx, anchor) {
    hideHint();   // the popup says everything the tooltip did, and more
    var html = popupHTML(L, feature.properties);
    if (!html) return;
    var opts = { closeButton: true, maxWidth: "320px", className: "atlas-popup" };
    // a spiderfied marker keeps its true lngLat plus a px displacement — the
    // popup takes the same displacement so it points at the pin the user
    // sees, and (fanned pins only) an anchor chosen to open away from the
    // rest of the fan, nudged so it clears the pin's own body
    if (offsetPx) {
      var off = [offsetPx[0], offsetPx[1]];
      if (anchor) {
        if (anchor.indexOf("bottom") === 0) off[1] -= 26;        // above the pin's head
        else if (anchor.indexOf("top") === 0) off[1] += 6;       // below its foot
        else off[1] -= 12;                                       // beside its waist
        opts.anchor = anchor;
      }
      opts.offset = off;
    }
    return new maplibregl.Popup(opts).setLngLat(lngLat).setHTML(html).addTo(map);
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

  function popupHTML(L, props) {
    var spec = L.popup;
    // the same key-by-key rows the hover bubble shows — a touch screen has
    // no hover, so the tap popup is where the marks get decoded there. A
    // keyed layer with no popup stanza still gets a popup of just the rows.
    var krows = keyRowsEl(L, props);
    if (!spec && !krows) return "";
    spec = spec || {};
    var title = popupTitleText(L, props);
    var sub = spec.subtitle || (spec.subtitleProperty ? props[spec.subtitleProperty] : "");
    var shell = '<div class="pop">';
    var h = shell;
    if (title) h += '<div class="pop-title">' + esc(title) + "</div>";
    if (sub) h += '<div class="pop-sub">' + esc(sub) + "</div>";
    if (krows) h += krows.outerHTML;
    (spec.fields || []).forEach(function (fld) {
      var v = props[fld.property];
      if (v == null || v === "" || v === "[]") return;
      if (fld.type === "tags") {
        var arr = Array.isArray(v) ? v : tagArr(v);
        if (!arr.length) return;
        // Each tag is a button, not a label: tapping one shows the places that
        // share it (see filterByTag). A button so a keyboard reaches it, and so
        // it announces itself as something that does a thing.
        h += '<div class="pop-field"><div class="pop-lbl">' + esc(fld.label) + '</div><div class="pop-tags">' +
          arr.map(function (t) {
            return '<button type="button" class="pop-tag" data-tag="' + esc(t) +
              '" title="Show the places tagged ' + esc(t) + '">' + esc(t) + "</button>";
          }).join("") + "</div></div>";
      } else if (fld.type === "notes") {
        var notes = Array.isArray(v) ? v : safeArr(v);
        if (!notes.length) return;
        h += '<div class="pop-notes">' + notes.map(function (n) {
          return '<div class="pop-note"><b>' + esc(n.title) + "</b>" + (n.body ? "<span>" + esc(n.body) + "</span>" : "") + "</div>";
        }).join("") + "</div>";
      } else if (fld.type === "image") {
        // photo column: https-only, lazy, silently hidden when the link is dead
        var u = String(v).trim();
        if (/^https:\/\/\S+$/i.test(u)) {
          h += '<img class="pop-img" src="' + esc(u) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'" />';
        }
      } else if (fld.type === "cropProfile") {
        var cp = Array.isArray(v) ? v : safeArr(v);
        if (!cp.length) return;
        h += '<div class="pop-field"><div class="pop-lbl">' + esc(fld.label) + '</div><div class="pop-tags">' +
          cp.map(function (c) { return '<span class="pop-tag">' + esc(c.crop) + ' <b>' + esc(c.blocks) + "</b></span>"; }).join("") + "</div></div>";
      } else {
        h += '<div class="pop-field"><div class="pop-lbl">' + esc(fld.label) + '</div><div class="pop-val">' +
          esc(v) + (fld.suffix || "") + "</div></div>";
      }
    });
    // A popup stanza can point at columns the data no longer carries — that
    // used to open a bare white box with nothing but a close button. If
    // nothing resolved, there is nothing to say: no popup at all.
    if (h === shell) return "";
    return h + "</div>";
  }
  function safeArr(v) { try { return JSON.parse(v); } catch (e) { return []; } }
  // tag chips from either a JSON array or a "a; b, c"-delimited string
  function tagArr(v) {
    if (Array.isArray(v)) return v;
    var j = safeArr(v);
    if (j.length) return j;
    return String(v).split(/[;,]/).map(function (t) { return t.trim(); }).filter(Boolean);
  }

  /* ==================================================================
     CREDITS (data sources from manifest)
  ================================================================== */
  function buildCredits() {
    var box = $("#data-credits");
    if (!box || !MANIFEST.attributions) return;
    box.innerHTML = MANIFEST.attributions.map(function (a) {
      var name = a.url ? '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.name) + "</a>" : esc(a.name);
      return '<li><span class="cr-name">' + name + "</span>" +
        (a.note ? '<span class="cr-note">' + esc(a.note) + "</span>" : "") +
        (a.license ? '<span class="cr-lic">' + esc(a.license) + "</span>" : "") + "</li>";
    }).join("");

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
  function reboot(dataset) {
    Object.keys(markersByLayer).forEach(function (id) {
      (markersByLayer[id] || []).forEach(function (mk) { try { mk.remove(); } catch (e) {} });
    });
    if (map) { try { map.remove(); } catch (e) {} map = null; }
    MANIFEST = null; activeBasemap = null;
    DATA = {}; markersByLayer = {}; cropState = {}; keyState = {}; pmSources = {};
    SPIDER = { items: null, anchor: null, svg: null, pop: null, cid: null };
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
    fileUrl: function (name) { return dataUrl(name); },
    reboot: reboot,
  };

  function setText(sel, txt) { var e = $(sel); if (e) e.textContent = txt; }
})();
