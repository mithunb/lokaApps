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
  // wizard's preview pane wants: a look at the atlas, not at loka.place.
  // ?embed=map goes further: nothing but the stage, filling the frame. The
  // editor wraps the atlas in its own bar, so the hero would say the title
  // twice and the credits would push the map off the bottom.
  var EMBED = QS.get("embed") === "1" || QS.get("embed") === "map";
  if (EMBED) {
    document.documentElement.classList.add("atlas-embed");
    if (QS.get("embed") === "map") document.documentElement.classList.add("atlas-embed-map");
    // The owner's own tooling has no business inside someone else's frame:
    // Share offers a link to an atlas that may not be published yet, Manage
    // opens the wizard inside the wizard, and Add data walks the frame off to
    // the data bench in the middle of a flow. Take the row out of the document
    // rather than hide it — a display:none button is still a button waiting for
    // the next line of code to unhide it, and CSS can't stop `hidden = false`.
    var ownerActions = document.querySelector(".hero-actions");
    if (ownerActions && ownerActions.parentNode) ownerActions.parentNode.removeChild(ownerActions);
  }
  // ?panel=0 — the map stays, the control panel goes. The editor frames this
  // page (embed=map) and grew an authoring panel of its own, so a reader there
  // saw two panels, each titled "Layers" and meaning different things. The
  // host that asks for panel=0 takes the panel's jobs over — basemap, search,
  // legend — through the REMOTE CONTROL messages below. Hidden by CSS rather
  // than unbuilt: one buildControls() serves every mode, and the search and
  // basemap machinery it wires is exactly what the host drives.
  var PANEL_OFF = QS.get("panel") === "0";
  if (PANEL_OFF) document.documentElement.classList.add("atlas-nopanel");
  // Private datasets live outside the web root and are served by the API behind
  // a view key; public datasets are plain static files.
  var BASE = KEY ? "./api/datasets/" + DATASET + "/" : "./datasets/" + DATASET + "/";
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

  // Lucide icons (MIT) — a modern, consistent set, inlined so the app stays self-contained.
  function svgIcon(inner) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  }
  var ICONS = {
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    factory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M17 18h1M12 18h1M7 18h1"/></svg>',
    flask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/></svg>',
    // theme icons for on-the-fly category → icon mapping (Lucide, MIT)
    leaf: svgIcon('<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/>'),
    trees: svgIcon('<path d="M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z"/><path d="M7 16v6"/><path d="M13 19v3"/><path d="M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5"/>'),
    droplet: svgIcon('<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5C11.5 5.5 10 7.9 8 9.5 6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>'),
    utensils: svgIcon('<path d="M3 2v7c0 1.1.9 2 2 2a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>'),
    landmark: svgIcon('<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>'),
    palette: svgIcon('<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C22 6.012 17.461 2 12 2z"/>'),
    cap: svgIcon('<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>'),
    store: svgIcon('<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M2 7h20"/><path d="M18 12a2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 0 1-4 0"/>'),
    health: svgIcon('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>'),
    home: svgIcon('<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
    alert: svgIcon('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
    users: svgIcon('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    pin: svgIcon('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>')
  };
  // Category → icon by keyword; arbitrary/emergent categories fall back to a
  // lettered monogram badge. Keeps colour + icon reinforcing each other.
  var KEYWORD_ICONS = {
    nature: "leaf", eco: "leaf", green: "leaf", park: "leaf", garden: "leaf", tree: "leaf", plant: "leaf",
    forest: "trees", wood: "trees",
    water: "droplet", river: "droplet", lake: "droplet", wetland: "droplet", pond: "droplet", stream: "droplet", drink: "droplet",
    food: "utensils", restaurant: "utensils", cafe: "utensils", eat: "utensils", cuisine: "utensils", meal: "utensils",
    heritage: "landmark", historic: "landmark", monument: "landmark", temple: "landmark", shrine: "landmark", idol: "landmark",
    culture: "palette", art: "palette", craft: "palette", music: "palette", creative: "palette", decor: "palette",
    learn: "cap", education: "cap", school: "cap", college: "cap", library: "cap", study: "cap",
    market: "store", shop: "store", store: "store", vendor: "store", retail: "store", commerce: "store",
    health: "health", clinic: "health", hospital: "health", medical: "health", care: "health",
    infra: "home", building: "home", housing: "home", home: "home", construction: "home",
    hazard: "alert", danger: "alert", risk: "alert", waste: "alert", pollution: "alert", safety: "alert", civic: "alert",
    social: "users", community: "users", people: "users", activit: "users", gathering: "users"
  };
  function iconFor(value) {
    var v = String(value == null ? "" : value).toLowerCase();
    for (var k in KEYWORD_ICONS) { if (v.indexOf(k) >= 0) return { icon: KEYWORD_ICONS[k] }; }
    var words = v.replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean);
    var initials = words.slice(0, 2).map(function (w) { return w.charAt(0); }).join("").toUpperCase();
    return { badge: initials || "?" };
  }
  // pale fills (the auto palette's cyan and sand) need dark ink, not white
  function paleHex(h) {
    if (!/^#[0-9a-fA-F]{6}$/.test(h || "")) return false;
    var r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 145;
  }

  var map, MANIFEST, activeBasemap, DATA = {}, markersByLayer = {}, cropState = {};

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
  fetch(dataUrl("manifest.json"))
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
    .then(start)
    .then(checkOwner)
    .catch(function (err) {
      $("#atlas-map").innerHTML =
        '<div class="atlas-error">Could not load “' + esc(DATASET) + '”.<br><small>' + esc(err.message) + "</small></div>";
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
          // only now can a host's messages do real work (markers exist, layers
          // are addressable) — so only now does the frame declare itself, and
          // says whether a search box would have anything to act on
          tellHost({ atlas: "ready", searchable: searchableLayers().length > 0 });
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
        // re-frame when the layout flips between the floating panel (desktop) and the bottom sheet (mobile)
        window.matchMedia("(max-width: 720px)").addEventListener("change", function () {
          setTimeout(function () { if (!focusFit(true)) fitToData(true); }, 80);
        });
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

  // Show a "Manage this atlas" link only to the owner. The API returns
  // canEdit:true when the caller's session owns this instance (same-origin
  // cookie); everyone else gets public fields and no button.
  function checkOwner() {
    // embedded: the action row is gone and ownership is nobody's business inside
    // the frame, so don't even ask the API who the caller is.
    if (EMBED) return;
    var btn = $("#manage-btn");
    if (!btn || !DATASET) return;
    fetch("./api/instances/" + encodeURIComponent(DATASET), { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (inst) {
        if (inst && inst.canEdit) {
          btn.href = "./edit/?dataset=" + encodeURIComponent(DATASET);
          btn.hidden = false;
          var add = $("#add-data-btn");
          if (add) {
            add.href = "./add-data/?dataset=" + encodeURIComponent(DATASET);
            add.hidden = false;
          }
        }
      })
      .catch(function () {});
  }

  function wireShare(manifest) {
    if (EMBED) return;   // no Share inside a frame — see the embed block up top
    var btn = $("#share-btn");
    if (!btn || !window.AtlasShare) return;
    btn.hidden = false;
    btn.onclick = function () {
      window.AtlasShare.open({
        url: location.href,
        title: manifest.title + " — LOKA Atlas",
        slug: DATASET,
        private: !!KEY,
      });
    };
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
  function baseStyle(m) {
    var sources = {}, layers = [
      { id: "bg", type: "background", paint: { "background-color": "#EAE9E3" } }
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

  function addLabel(L) {
    var t = L.label_text;
    if (!t) return;
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
    map.addLayer(withFilter(L, { id: L.id + "-label", type: "symbol", source: srcId(L), layout: layout, paint: paint }));
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
      var paleFill = paleHex(cfg.color);
      // pin + label live in an inner node: MapLibre owns the wrap's transform
      // (true position), the node alone takes the spiderfy displacement — see
      // the SPIDERFY section below.
      var node = el("div", "atlas-mnode");
      var pin = el("div", "atlas-pin" + (cfg.ring ? " ring" : ""));
      pin.style.setProperty("--pin", cfg.color || "#f97316");
      if (cfg.icon && ICONS[cfg.icon]) pin.innerHTML = ICONS[cfg.icon];
      else if (cfg.glyph) pin.textContent = cfg.glyph;
      else if (L.categoryIcons) {
        // category layers: derive an icon (or monogram badge) from the value
        var ic = iconFor(f.properties[L.markerBy]);
        if (ic.icon && ICONS[ic.icon]) pin.innerHTML = ICONS[ic.icon];
        else {
          pin.textContent = ic.badge; pin.classList.add("badge");
          if (paleFill) pin.classList.add("pale");   // dark ink on the pale palette slots
        }
      }
      node.appendChild(pin);
      if (L.label_text) node.appendChild(el("span", "atlas-mlabel", esc(f.properties[L.label_text.property])));
      wrap.appendChild(node);
      var mk = new maplibregl.Marker({ element: wrap, anchor: "bottom" }).setLngLat(f.geometry.coordinates).addTo(map);
      // keep the feature alongside its marker so search can gate it by content
      var entry = { mk: mk, f: f, color: cfg.color || "" };
      // clicks route through the spiderfy gate: a lone pin pops up as before,
      // a stacked pin fans its stack out first
      wrap.addEventListener("click", function (e) { e.stopPropagation(); spiderClick(L, entry); });
      // hovering names the pin without a click (see HOVER TOOLTIP)
      wireMarkerHint(node, function () { return popupTitleText(L, f.properties); });
      markersByLayer[L.id].push(entry);
      pts.push(f.geometry.coordinates);
    });
    L._pts = pts;
    if (L.cluster && pts.length) setupCluster(L);
    applyMarkerVisibility(L);
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

  // Writes display for one layer's pins. `e._stacked` is set by restack() for
  // pins standing behind a count badge; everything else here is as it was.
  function paintMarkerDisplay(L) {
    var shown = L._visible !== false;
    var clustered = L.cluster && L._clusterMarker && map.getZoom() < L.cluster.belowZoom;
    (markersByLayer[L.id] || []).forEach(function (e) {
      e.mk.getElement().style.display =
        (shown && !clustered && !e.hidden && !e._stacked) ? "" : "none";
    });
    if (L._clusterMarker) L._clusterMarker.getElement().style.display = (shown && clustered) ? "" : "none";
  }
  function applyMarkerVisibility(L) {
    // whatever is changing here (layer toggle, cluster zoom, search) can change
    // who is stacked with whom — fold any open fan rather than chase it
    if (SPIDER.items) spiderCollapse();
    hideHint();   // a pin can vanish from under the pointer; no mouseleave follows
    paintMarkerDisplay(L);
    scheduleRestack();
  }

  function fitPoints(pts) {
    var b = new maplibregl.LngLatBounds(pts[0], pts[0]);
    pts.forEach(function (p) { b.extend(p); });
    map.fitBounds(b, { padding: 110, maxZoom: 13, duration: 600 });
  }

  /* ==================================================================
     SPIDERFY — markers sitting on (nearly) the same point fan out on
     click so each one can be reached. The wrap element stays MapLibre's
     (true lngLat — it pans for free); the inner .atlas-mnode takes a
     pure-CSS pixel displacement, so the fan holds its shape through a
     pan and the two transforms never fight. Pixel offsets only mean
     something at one zoom, so starting a zoom folds the fan instead of
     chasing it. Stacks are found lazily, on click — nothing is
     maintained while the user just browses.
  ================================================================== */
  var SPIDER = { items: null, anchor: null, svg: null, pop: null };
  var SPIDER_PX = 12;   // markers closer than this on screen count as one stack
  var FAN_GAP = 28;     // displaced pins keep at least a marker-width apart

  // fan feet in px around (0,0): a ring while neighbours fit, an archimedean
  // spiral past 8 (a ring wide enough for many pins drifts too far out)
  function fanFeet(n) {
    var feet = [], i;
    if (n <= 8) {
      // ring radius grows so neighbouring pins stay a marker-width apart
      var r = Math.max(34, (FAN_GAP / 2 + 2) / Math.sin(Math.PI / n));
      for (i = 0; i < n; i++) {
        var a = (2 * Math.PI * i) / n - Math.PI / 2;
        feet.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      return feet;
    }
    var angle = 0, leg = 30, cx = 0, cy = 0;
    for (i = 0; i < n; i++) {
      angle += (FAN_GAP + 5) / leg;         // a constant arc between feet
      feet.push([leg * Math.cos(angle), leg * Math.sin(angle)]);
      cx += feet[i][0] / n; cy += feet[i][1] / n;
      leg += 2 * Math.PI * 4.5 / angle;     // creep outward as the spiral winds
    }
    // recentre the spiral so the fan sits around the anchor, not to one side
    for (i = 0; i < n; i++) { feet[i][0] -= cx; feet[i][1] -= cy; }
    return feet;
  }

  // only markers the user can currently see may stack: layer on, not folded
  // into a cluster badge, not hidden by search. `_stacked` is excluded by the
  // caller, since restack() itself has to look at pins it has just folded.
  function markerEntries(includeStacked) {
    var out = [];
    (MANIFEST.layers || []).forEach(function (L) {
      if (L._visible === false) return;
      if (L.cluster && L._clusterMarker && map.getZoom() < L.cluster.belowZoom) return;
      (markersByLayer[L.id] || []).forEach(function (e) {
        if (e.hidden) return;
        if (!includeStacked && e._stacked) return;
        out.push({ L: L, e: e });
      });
    });
    return out;
  }
  function visibleMarkerEntries() { return markerEntries(false); }

  /* ==================================================================
     STACKS — pins landing on the same spot used to be drawn as a pile:
     you could not tell four from one until you clicked. A stack is now
     drawn ONCE, as a badge carrying how many places are under it, and
     clicking the badge fans them out through the spiderfy below.

     Screen-space, so it is recomputed after every pan and zoom, and
     bucketed into a grid rather than compared pairwise — an atlas with
     a few thousand pins must not go quadratic on every map move.
  ================================================================== */
  var STACKS = [], restackTimer = null, stacksWired = false;

  function scheduleRestack() {
    if (restackTimer) clearTimeout(restackTimer);
    restackTimer = setTimeout(function () { restackTimer = null; restack(); }, 60);
  }
  function clearStacks() {
    STACKS.forEach(function (st) {
      st.mk.remove();
      st.items.forEach(function (it) { it.e._stacked = false; });
    });
    STACKS = [];
  }

  function restack() {
    if (!map) return;
    if (SPIDER.items) return;          // a fan is open — leave the map as it is
    wireStacks();
    clearStacks();

    // The grid only narrows the search. Membership is decided by real distance,
    // the same SPIDER_PX the fan uses — bucketing alone would merge two pins a
    // cell apart while splitting two that straddle a boundary.
    var pts = markerEntries(true).map(function (it) {
      var p = map.project(it.e.mk.getLngLat());
      return { it: it, x: p.x, y: p.y, taken: false };
    });
    var grid = {};
    pts.forEach(function (q, i) {
      var k = Math.floor(q.x / SPIDER_PX) + "|" + Math.floor(q.y / SPIDER_PX);
      (grid[k] || (grid[k] = [])).push(i);
    });
    var r2 = SPIDER_PX * SPIDER_PX;
    pts.forEach(function (q) {
      if (q.taken) return;
      var gx = Math.floor(q.x / SPIDER_PX), gy = Math.floor(q.y / SPIDER_PX);
      var near = [];
      for (var dx = -1; dx <= 1; dx++) {
        for (var dy = -1; dy <= 1; dy++) {
          var cellIdx = grid[(gx + dx) + "|" + (gy + dy)];
          if (!cellIdx) continue;
          for (var n = 0; n < cellIdx.length; n++) {
            var o = pts[cellIdx[n]];
            if (o.taken) continue;
            var ex = o.x - q.x, ey = o.y - q.y;
            if (ex * ex + ey * ey <= r2) near.push(o);
          }
        }
      }
      if (near.length < 2) return;
      var sx = 0, sy = 0, items = [];
      near.forEach(function (o) { o.taken = true; sx += o.x; sy += o.y; items.push(o.it); o.it.e._stacked = true; });
      addStackBadge(items, map.unproject([sx / near.length, sy / near.length]));
    });

    (MANIFEST.layers || []).forEach(paintMarkerDisplay);
  }

  // one colour if the stack agrees, ink if it does not — a badge should not
  // invent a category the places under it do not share
  function stackColor(items) {
    var c = items[0].e.color || "";
    for (var i = 1; i < items.length; i++) if ((items[i].e.color || "") !== c) return "";
    return c;
  }

  function addStackBadge(items, lngLat) {
    var wrap = el("div", "atlas-stack");
    var col = stackColor(items);
    if (col) wrap.style.setProperty("--stack", col);
    wrap.innerHTML =
      '<span class="st-pile"><span class="st-leaf"></span><span class="st-leaf"></span>' +
        '<span class="st-disc"></span></span>' +
      '<span class="st-n">' + items.length + "</span>";
    wrap.setAttribute("role", "button");
    wrap.setAttribute("tabindex", "0");
    wrap.setAttribute("aria-label", items.length + " places here — open them");
    var st = { mk: null, items: items };
    function open() {
      // the members are hidden behind this badge; show them, drop the badge,
      // then hand the stack to the fan
      st.items.forEach(function (it) { it.e._stacked = false; });
      STACKS = STACKS.filter(function (x) { return x !== st; });
      st.mk.remove();
      (MANIFEST.layers || []).forEach(paintMarkerDisplay);
      spiderfy(st.items, lngLat);
    }
    wrap.addEventListener("click", function (e) { e.stopPropagation(); open(); });
    wrap.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); open(); }
    });
    wireMarkerHint(wrap, function () { return items.length + " places here"; });
    st.mk = new maplibregl.Marker({ element: wrap, anchor: "center" }).setLngLat(lngLat).addTo(map);
    STACKS.push(st);
  }

  function wireStacks() {
    if (stacksWired) return;
    stacksWired = true;
    map.on("moveend", scheduleRestack);
    map.on("zoomend", scheduleRestack);
  }

  function stackFor(entry) {
    var p0 = map.project(entry.mk.getLngLat());
    return visibleMarkerEntries().filter(function (it) {
      var p = map.project(it.e.mk.getLngLat());
      var dx = p.x - p0.x, dy = p.y - p0.y;
      return dx * dx + dy * dy <= SPIDER_PX * SPIDER_PX;
    });
  }

  // every marker click lands here: a fanned pin opens its own popup (fan
  // stays); a stacked pin fans its stack out; a lone pin behaves as ever
  function spiderClick(L, entry) {
    if (SPIDER.items) {
      for (var i = 0; i < SPIDER.items.length; i++) {
        var it = SPIDER.items[i];
        if (it.e === entry) {
          SPIDER.pop = openPopup(it.L, it.e.f, it.e.mk.getLngLat(), it.off);
          return;
        }
      }
      spiderCollapse(); // a marker outside the open fan: fold it first
    }
    var stack = stackFor(entry);
    if (stack.length < 2) { openPopup(L, entry.f, entry.mk.getLngLat()); return; }
    spiderfy(stack, entry.mk.getLngLat());
  }

  function spiderfy(stack, anchor) {
    wireSpider();
    var a = map.project(anchor);
    var feet = fanFeet(stack.length);
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
    drawLegs();
  }

  function spiderCollapse() {
    if (!SPIDER.items) return;
    SPIDER.items.forEach(function (it) {
      var w = it.e.mk.getElement();
      w.classList.remove("fanned");
      w.style.removeProperty("--fan-x");
      w.style.removeProperty("--fan-y");
    });
    SPIDER.items = null;
    SPIDER.anchor = null;
    if (SPIDER.svg) { SPIDER.svg.remove(); SPIDER.svg = null; }
    // a popup opened from a fanned pin points at a spot that no longer exists
    if (SPIDER.pop) { SPIDER.pop.remove(); SPIDER.pop = null; }
    scheduleRestack();       // the stack the fan came from earns its badge back
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
      map.getCanvasContainer().insertBefore(SPIDER.svg, map.getCanvas().nextSibling);
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
    map.on("click", spiderCollapse);      // a background click folds the fan
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
  // no-op. Empty text means no tooltip at all (never an empty bubble).
  function showHint(text, at, key) {
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    if (!HOVER_OK || !text || !at) { hideHint(); return; }
    var t = hintEl();
    if (key !== HINT.key) { t.textContent = text; HINT.key = key; }
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
  // `titleOf` is read at hover time; nothing is cached per marker.
  function wireMarkerHint(node, titleOf) {
    if (!HOVER_OK) return;
    wireHintGlobals();
    function show() {
      if (HINT.key === node) return;      // already ours — mousemove must not thrash layout
      var text = titleOf();
      if (!text) return;                  // nothing names this pin: no tooltip, and no measuring
      showHint(text, nodeTop(node), node);
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
  function updateSearchCount(shown, total) {
    // a panel-less host is showing this count in its own search box; push it
    // there too (tellHost is a no-op everywhere else — see REMOTE CONTROL)
    tellHost({ atlas: "count", shown: shown == null ? null : shown, total: total || 0 });
    var c = $("#atlas-search-count"); if (!c) return;
    if (shown == null) { c.hidden = true; c.textContent = ""; }
    else { c.hidden = false; c.textContent = shown ? (shown + " of " + total + " shown") : "nothing matched — try another word"; }
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
    var shown = 0, total = 0;
    searchableLayers().forEach(function (L) {
      (markersByLayer[L.id] || []).forEach(function (e) {
        total++;
        var text = featureText(L, e.f);
        var match = !!(q && text.indexOf(q) >= 0);
        for (var i = 0; !match && i < terms.length; i++) match = termRe(terms[i]).test(text);
        e.hidden = !match; if (match) shown++;
      });
      applyMarkerVisibility(L);
    });
    updateSearchCount(shown, total);
  }
  function clearSearch() {
    searchTags = [];
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
      fetch("./api/layers/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset: DATASET, q: q }) })
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
     REMOTE CONTROL — with ?panel=0 a same-origin host page (the atlas
     editor) owns the panel's jobs, and this page does them on request.
     postMessage, not the host reaching into this window, although both
     work same-origin: the editor reloads this frame whenever settings
     change, and any function reference it had captured would die with
     the old document — a message is addressed to whichever document is
     in the frame right now. It also keeps timing honest in the other
     direction: the map boots asynchronously, so the frame says "ready"
     only once the controls actually work, and pushes search counts as
     they land (the semantic pass arrives ~250ms after the keystroke —
     no return value could have carried it).
  ================================================================== */
  function tellHost(msg) {
    // standalone, or the panel is intact: nobody took the jobs, say nothing
    if (!PANEL_OFF || window.parent === window) return;
    try { window.parent.postMessage(msg, location.origin); } catch (e) {}
  }
  if (PANEL_OFF) {
    window.addEventListener("message", function (e) {
      if (e.origin !== location.origin) return;   // same-origin hosts only
      var m = e.data || {};
      if (m.atlas === "set-basemap" && map && MANIFEST) {
        // only ids the manifest declares — a stray message must not blank the map
        if (MANIFEST.basemaps.some(function (b) { return b.id === m.id; })) switchBasemap(m.id);
      } else if (m.atlas === "search") {
        runSearch(String(m.q == null ? "" : m.q));
      }
    });
  }

  /* ==================================================================
     CONTROL WIDGET
  ================================================================== */
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
    if (manifestSearchable().length) {
      var sc = el("div", "ctl-search");
      var si = el("input", "ctl-search-input");
      si.type = "search"; si.placeholder = "Search the map…"; si.setAttribute("aria-label", "Search the map");
      si.addEventListener("input", function () { runSearch(si.value); });
      si.addEventListener("search", function () { runSearch(si.value); });
      sc.appendChild(si);
      var cnt = el("div", "ctl-search-count"); cnt.id = "atlas-search-count"; cnt.hidden = true;
      sc.appendChild(cnt);
      panel.appendChild(sc);
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
      var layers = MANIFEST.layers.filter(function (L) { return (L.group || "userdata") === g.id; });
      if (!layers.length) return;
      // Only Base is expanded on load; all other groups collapse so the panel
      // isn't overwhelming (users open the ones they want). The engine owns this
      // — manifests' per-group `open` flag is intentionally ignored here.
      var sec = el("section", "ctl-group" + (g.id === "base" ? "" : " collapsed"));
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
    var key = it.icon, badge = null;
    // category legend rows carry the value in `label`; derive icon/badge to match the markers
    if (!key && it.categorical) { var ic = iconFor(it.label); if (ic.icon) key = ic.icon; else badge = ic.badge; }
    if (key && ICONS[key]) {
      var w = el("span", "leg-icon", ICONS[key]);
      w.style.setProperty("--c", it.color);
      return w;
    }
    if (badge) {
      var b = el("span", "leg-badge" + (paleHex(it.color) ? " pale" : ""), badge);
      b.style.setProperty("--c", it.color);
      return b;
    }
    var s = el("span", "leg-swatch " + (it.shape || "box"));
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

  function openPopup(L, feature, lngLat, offsetPx) {
    hideHint();   // the popup says everything the tooltip did, and more
    var html = popupHTML(L, feature.properties);
    if (!html) return;
    var opts = { closeButton: true, maxWidth: "320px", className: "atlas-popup" };
    // a spiderfied marker keeps its true lngLat plus a px displacement — the
    // popup takes the same displacement so it points at the pin the user sees
    if (offsetPx) opts.offset = offsetPx;
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
    var spec = L.popup; if (!spec) return "";
    var title = popupTitleText(L, props);
    var sub = spec.subtitle || (spec.subtitleProperty ? props[spec.subtitleProperty] : "");
    var h = '<div class="pop">';
    if (title) h += '<div class="pop-title">' + esc(title) + "</div>";
    if (sub) h += '<div class="pop-sub">' + esc(sub) + "</div>";
    (spec.fields || []).forEach(function (fld) {
      var v = props[fld.property];
      if (v == null || v === "" || v === "[]") return;
      if (fld.type === "tags") {
        var arr = Array.isArray(v) ? v : tagArr(v);
        if (!arr.length) return;
        h += '<div class="pop-field"><div class="pop-lbl">' + esc(fld.label) + '</div><div class="pop-tags">' +
          arr.map(function (t) { return '<span class="pop-tag">' + esc(t) + "</span>"; }).join("") + "</div></div>";
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

  function setText(sel, txt) { var e = $(sel); if (e) e.textContent = txt; }
})();
