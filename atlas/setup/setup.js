/* LOKA Atlas setup wizard.
   Anonymous create → build → publish; email registration (magic link) only for
   "Save draft" and private atlases. API is same-origin: ../api/… resolves to
   /apps/atlas/api/… (Apache in prod, LOKA_DEV_STATIC rewrite in dev). */
(function () {
  "use strict";

  var API = "../api/";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var S = {
    step: 1,
    visibility: "public",
    logoData: null,
    slugTouched: false,
    geo: { iso3: "", level: 1, features: [], selected: {} },
    catalog: { tier: "", layers: [], chosen: {} },
    build: null,           // {slug, jobId, editToken, viewKey, status}
    session: null,
    draftId: null,
    editSlug: null,        // editing an existing atlas (rebuild / details)
    editMode: null,        // 'details' | 'rebuild'
    editInst: null,        // the instance being edited
    regionKept: false,     // rebuild: user kept the current region
    removeLogo: false,
  };

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    if (opts.body && typeof opts.body !== "string") opts.body = JSON.stringify(opts.body);
    return fetch(API + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { j._status = r.status; throw j; }
        return j;
      });
    });
  }
  function errMsg(e) { return (e && (e.error || e.message)) || "something went wrong"; }
  function msg(n, text, cls) {
    var box = $("#msg-" + n);
    box.innerHTML = text ? '<div class="msg ' + (cls || "err") + '">' + text + "</div>" : "";
  }

  /* ================= steps ================= */

  function show(step) {
    S.step = step;
    for (var i = 1; i <= 5; i++) {
      $("#step-" + i).hidden = i !== step;
      var chip = document.querySelector('.stp[data-step="' + i + '"]');
      chip.classList.toggle("active", i === step);
      chip.classList.toggle("done", i < step);
    }
    window.scrollTo({ top: 0 });
    if (step >= 1 && step <= 3) saveLocal(); // keep a browser-local backup of in-progress work
  }

  /* ---- browser-local autosave: survives a reload or the sign-in link opening a new tab.
     Separate from server drafts (which need an account); this is best-effort resilience. ---- */
  var LS_KEY = "loka-atlas-wizard";
  function saveLocal() {
    try {
      var st = draftState();
      var meaningful = (st.fields && st.fields.title) ||
        (st.geo && ((st.geo.selected && st.geo.selected.length) || (st.geo.crumbs && st.geo.crumbs.length)));
      if (!meaningful) return;
      localStorage.setItem(LS_KEY, JSON.stringify({ state: st, at: Date.now() }));
    } catch (e) { /* private mode / quota — ignore */ }
  }
  function clearLocal() { try { localStorage.removeItem(LS_KEY); } catch (e) {} }
  function offerLocalResume() {
    var raw;
    try { raw = localStorage.getItem(LS_KEY); } catch (e) { return; }
    if (!raw) return;
    var saved; try { saved = JSON.parse(raw); } catch (e) { clearLocal(); return; }
    if (!saved || !saved.state || (Date.now() - (saved.at || 0)) > 7 * 864e5) { clearLocal(); return; }
    var title = (saved.state.fields && saved.state.fields.title) || "your atlas";
    var box = $("#resume-local");
    box.hidden = false;
    box.innerHTML = '<div class="msg ok">Pick up where you left off with <b>' + esc(title) + '</b>? ' +
      '<a href="#" id="lr-yes">Resume</a> · <a href="#" id="lr-no">Start fresh</a></div>';
    $("#lr-yes").onclick = function (ev) { ev.preventDefault(); box.hidden = true; applyDraft({ id: S.draftId, state: saved.state }); };
    $("#lr-no").onclick = function (ev) { ev.preventDefault(); box.hidden = true; clearLocal(); };
  }

  /* ================= step 1: org & branding ================= */

  function slugify(t) {
    return String(t || "").toLowerCase().normalize("NFKD")
      .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 40);
  }

  var slugTimer;
  function checkSlug() {
    var slug = $("#f-slug").value.trim();
    var hint = $("#slug-hint");
    if (!slug) { hint.textContent = "lowercase letters, numbers and dashes"; hint.className = "hint"; return; }
    clearTimeout(slugTimer);
    slugTimer = setTimeout(function () {
      api("slug-check?slug=" + encodeURIComponent(slug)).then(function (r) {
        if (!r.valid) { hint.textContent = "not a valid address"; hint.className = "hint bad"; }
        else if (!r.available) { hint.textContent = "already taken"; hint.className = "hint bad"; }
        else { hint.textContent = "available — your atlas will live at …/atlas/a/" + slug; hint.className = "hint ok"; }
      }).catch(function () {});
    }, 300);
  }

  $("#f-title").addEventListener("input", function () {
    if (!S.slugTouched) { $("#f-slug").value = slugify(this.value); checkSlug(); }
  });
  $("#f-slug").addEventListener("input", function () { S.slugTouched = true; this.value = this.value.toLowerCase(); checkSlug(); });

  $("#f-logo").addEventListener("change", function () {
    var f = this.files && this.files[0];
    var hint = $("#logo-hint");
    S.logoData = null;
    if (!f) { hint.textContent = ""; return; }
    if (f.type !== "image/png") { hint.textContent = "PNG only"; hint.className = "hint bad"; return; }
    if (f.size > 200 * 1024) { hint.textContent = "too big — keep it under 200 KB"; hint.className = "hint bad"; return; }
    var rd = new FileReader();
    rd.onload = function () { S.logoData = rd.result; hint.textContent = "✓ " + f.name; hint.className = "hint ok"; };
    rd.readAsDataURL(f);
  });

  function setVisibility(v) {
    if (v === "private" && !S.session) {
      signIn("Private atlases need a verified email, so we know who can manage the view key.").then(function (ok) {
        if (ok) setVisibility("private");
      });
      return;
    }
    S.visibility = v;
    $("#vis-public").classList.toggle("on", v === "public");
    $("#vis-private").classList.toggle("on", v === "private");
  }
  $("#vis-public").onclick = function () { setVisibility("public"); };
  $("#vis-private").onclick = function () { setVisibility("private"); };

  $("#next-1").onclick = function () {
    if (S.editMode === "details") { saveDetails(); return; }
    msg(1, "");
    if (!$("#f-title").value.trim()) return msg(1, "Give your atlas a title first.");
    var slug = $("#f-slug").value.trim();
    if (!slug) { $("#f-slug").value = slugify($("#f-title").value); }
    show(2);
    initCountries();
  };

  /* ================= step 2: geography (drill-down) ================= */

  var geoMap, geoMapReady = false, hoverId = null;
  var LIMITS = { freeAreaDeg2: 6, hardAreaDeg2: 40 };
  api("config").then(function (c) { LIMITS = c; }).catch(function () {});

  var LEVEL_NOUN = { 1: "states / provinces", 2: "districts", 3: "sub-districts", 4: "localities" };

  function initCountries() {
    var sel = $("#f-country");
    if (sel.options.length > 1) return;
    fetch("./countries.json").then(function (r) { return r.json(); }).then(function (list) {
      list.forEach(function (c) {
        var o = document.createElement("option");
        o.value = c.iso3; o.textContent = c.name;
        sel.appendChild(o);
      });
    });
    initGeoMap();
  }

  function initGeoMap() {
    if (geoMap) return;
    geoMap = new maplibregl.Map({
      container: "geo-map",
      style: {
        version: 8,
        sources: { carto: { type: "raster", tiles: [
          "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
          "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"], tileSize: 256 } },
        layers: [{ id: "carto", type: "raster", source: "carto" }],
      },
      center: [20, 10], zoom: 1.2, attributionControl: false,
    });
    geoMap.addControl(new maplibregl.AttributionControl({ compact: true }));
    geoMap.on("load", function () {
      geoMap.addSource("units", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
      geoMap.addLayer({ id: "units-fill", type: "fill", source: "units", paint: {
        "fill-color": "#40573D",
        "fill-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 0.42, 0.26],
      } });
      geoMap.addLayer({ id: "units-line", type: "line", source: "units", paint: {
        "line-color": "#2F4230", "line-width": 1.1 } });
      geoMap.on("click", "units-fill", function (e) {
        if (e.features && e.features[0]) toggleUnit(e.features[0].properties.id);
      });
      geoMap.on("mousemove", "units-fill", function (e) {
        geoMap.getCanvas().style.cursor = "pointer";
        var id = e.features && e.features[0] && e.features[0].properties.id;
        if (hoverId && hoverId !== id) geoMap.setFeatureState({ source: "units", id: hoverId }, { hover: false });
        if (id) { hoverId = id; geoMap.setFeatureState({ source: "units", id: id }, { hover: true }); }
      });
      geoMap.on("mouseleave", "units-fill", function () {
        geoMap.getCanvas().style.cursor = "";
        if (hoverId) { geoMap.setFeatureState({ source: "units", id: hoverId }, { hover: false }); hoverId = null; }
      });
      geoMapReady = true;
    });
  }

  // Drill state: the LIST navigates (click a place → open it), the MAP composes
  // (tap areas → keep just those). Nothing tapped = everything on the map is the
  // atlas. Selection lives only inside the current view; navigating clears it.
  function resetGeo() {
    S.geo.crumbs = [];
    S.geo.viewLevel = 1;
    S.geo.features = [];
    S.geo.selected = {};
  }

  // two map moods: nothing tapped = the whole view is included (all lit);
  // a tapped subset = chosen areas glow, the rest fade to faint context
  function syncMapPaint() {
    if (!geoMapReady) return;
    var hasSel = Object.keys(S.geo.selected).length > 0;
    geoMap.setPaintProperty("units-fill", "fill-color", hasSel
      ? ["case", ["boolean", ["feature-state", "sel"], false], "#40573D", "#B0863A"]
      : "#40573D");
    geoMap.setPaintProperty("units-fill", "fill-opacity", hasSel
      ? ["case", ["boolean", ["feature-state", "sel"], false], 0.5,
          ["boolean", ["feature-state", "hover"], false], 0.18, 0.04]
      : ["case", ["boolean", ["feature-state", "hover"], false], 0.42, 0.26]);
    geoMap.setPaintProperty("units-line", "line-color", hasSel
      ? ["case", ["boolean", ["feature-state", "sel"], false], "#2F4230", "#9C5A34"]
      : "#2F4230");
    geoMap.setPaintProperty("units-line", "line-width", hasSel
      ? ["case", ["boolean", ["feature-state", "sel"], false], 2, 0.7]
      : 1.1);
  }

  function clearSelection() {
    if (geoMapReady) Object.keys(S.geo.selected).forEach(function (k) {
      geoMap.setFeatureState({ source: "units", id: k }, { sel: false });
    });
    S.geo.selected = {};
  }

  function drillInto(f) {
    clearSelection();
    S.geo.crumbs.push({ id: f.properties.id, name: f.properties.name, level: S.geo.viewLevel, bbox: f.bbox });
    S.geo.viewLevel += 1;
    loadUnits();
  }

  function countryName() {
    var sel = $("#f-country");
    return sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : "Country";
  }

  function maxLevel() {
    var ls = S.geo.levels || [1];
    return ls[ls.length - 1];
  }

  function loadUnits() {
    var iso3 = S.geo.iso3;
    if (!iso3) return;
    var level = S.geo.viewLevel;
    var parent = S.geo.crumbs.length ? S.geo.crumbs[S.geo.crumbs.length - 1] : null;
    $("#geo-list").innerHTML = '<span class="hint" style="padding:.5rem">Loading ' + (LEVEL_NOUN[level] || "areas") + "…</span>";
    renderCrumbs();
    var q = "geo/admin?iso3=" + iso3 + "&level=" + level + (parent ? "&parents=" + encodeURIComponent(parent.id) : "");
    api(q).then(function (fc) {
      S.geo.features = fc.features || [];
      renderGeoList();
      if (geoMapReady) {
        var src = geoMap.getSource("units");
        src.setData({ type: "FeatureCollection", features: S.geo.features.map(function (f) {
          return { type: "Feature", id: f.properties.id, properties: f.properties, geometry: f.geometry };
        }) });
        S.geo.features.forEach(function (f) {
          geoMap.setFeatureState({ source: "units", id: f.properties.id }, { sel: !!S.geo.selected[f.properties.id] });
        });
        syncMapPaint();
        var fit = (parent && parent.bbox && parent.bbox.length === 4) ? parent.bbox
          : (S.geo.features.length ? unionBbox(S.geo.features) : null);
        if (fit) geoMap.fitBounds([[fit[0], fit[1]], [fit[2], fit[3]]], { padding: 30, duration: 400 });
      }
      updateGeoMeta();
    }).catch(function (e) {
      $("#geo-list").innerHTML = '<span class="hint bad" style="padding:.5rem">' + esc(errMsg(e)) + "</span>";
    });
  }

  function renderCrumbs() {
    var bar = $("#geo-crumbs");
    bar.innerHTML = "";
    if (!S.geo.iso3) return;
    function add(el) { bar.appendChild(el); }
    function sep() { var s = document.createElement("span"); s.className = "sep"; s.textContent = "›"; add(s); }
    var root = document.createElement(S.geo.crumbs.length ? "button" : "span");
    root.className = S.geo.crumbs.length ? "" : "cur";
    root.textContent = countryName();
    if (S.geo.crumbs.length) root.onclick = function () { clearSelection(); S.geo.crumbs = []; S.geo.viewLevel = 1; loadUnits(); };
    add(root);
    S.geo.crumbs.forEach(function (c, i) {
      sep();
      var last = i === S.geo.crumbs.length - 1;
      var el = document.createElement(last ? "span" : "button");
      el.className = last ? "cur" : "";
      el.textContent = c.name;
      if (!last) el.onclick = function () {
        clearSelection();
        S.geo.crumbs = S.geo.crumbs.slice(0, i + 1);
        S.geo.viewLevel = c.level + 1;
        loadUnits();
      };
      add(el);
    });
    sep();
    var noun = document.createElement("span");
    noun.className = "sep";
    noun.textContent = LEVEL_NOUN[S.geo.viewLevel] || "areas";
    add(noun);
  }

  function unionBbox(feats) {
    if (!feats.length) return null;
    var w = 180, s = 90, e = -180, n = -90;
    feats.forEach(function (f) {
      var b = f.bbox || f;
      if (!b || b.length !== 4) return;
      w = Math.min(w, b[0]); s = Math.min(s, b[1]); e = Math.max(e, b[2]); n = Math.max(n, b[3]);
    });
    return [w, s, e, n];
  }

  function renderGeoList() {
    var box = $("#geo-list");
    box.innerHTML = "";
    var canDrill = S.geo.viewLevel < maxLevel();
    var childNoun = LEVEL_NOUN[S.geo.viewLevel + 1] || "smaller areas";
    S.geo.features
      .slice()
      .sort(function (a, b) { return a.properties.name.localeCompare(b.properties.name); })
      .forEach(function (f) {
        var id = f.properties.id;
        var row = document.createElement("button");
        row.type = "button";
        row.className = "geo-item" + (S.geo.selected[id] ? " on" : "");
        row.dataset.id = id;
        var nm = document.createElement("span");
        nm.className = "nm";
        nm.textContent = f.properties.name;
        row.appendChild(nm);
        var chip = document.createElement("span");
        chip.className = "in";
        chip.textContent = "in the atlas";
        chip.hidden = !S.geo.selected[id];
        row.appendChild(chip);
        if (canDrill) {
          var chev = document.createElement("span");
          chev.className = "chev";
          chev.setAttribute("aria-hidden", "true");
          chev.textContent = "›";
          row.appendChild(chev);
          row.title = "Open " + f.properties.name + " — see its " + childNoun;
          row.onclick = function () { drillInto(f); };
        } else {
          row.title = "Keep or remove " + f.properties.name;
          row.onclick = function () { toggleUnit(id); };
        }
        // hovering a name lights up its shape, so names and shapes stay connected
        row.onmouseenter = function () {
          if (!geoMapReady) return;
          if (hoverId && hoverId !== id) geoMap.setFeatureState({ source: "units", id: hoverId }, { hover: false });
          hoverId = id;
          geoMap.setFeatureState({ source: "units", id: id }, { hover: true });
        };
        row.onmouseleave = function () {
          if (geoMapReady && hoverId === id) { geoMap.setFeatureState({ source: "units", id: id }, { hover: false }); hoverId = null; }
        };
        box.appendChild(row);
      });
    if (!S.geo.features.length) {
      box.innerHTML = '<span class="hint" style="padding:.5rem">No smaller areas available here.</span>';
    }
  }

  function toggleUnit(id) {
    var f = S.geo.features.find(function (x) { return x.properties.id === id; });
    if (S.geo.selected[id]) {
      delete S.geo.selected[id];
    } else {
      if (!f) return;
      S.geo.selected[id] = { name: f.properties.name, bbox: f.bbox };
    }
    var row = document.querySelector('.geo-item[data-id="' + CSS.escape(id) + '"]');
    if (row) {
      row.classList.toggle("on", !!S.geo.selected[id]);
      var chip = row.querySelector(".in");
      if (chip) chip.hidden = !S.geo.selected[id];
    }
    if (geoMapReady) geoMap.setFeatureState({ source: "units", id: id }, { sel: !!S.geo.selected[id] });
    syncMapPaint();
    updateGeoMeta();
  }

  // The region the atlas will cover — always exactly what the map shows:
  // the tapped subset if any, else the place that was opened (whole view),
  // else the whole country.
  function effectiveRegion() {
    if (!S.geo.iso3) return null;
    var ids = Object.keys(S.geo.selected);
    if (ids.length) {
      return { mode: "subset", level: S.geo.viewLevel, units: ids.map(function (id) {
        var s = S.geo.selected[id];
        return { id: id, name: s.name, bbox: s.bbox };
      }) };
    }
    var crumb = S.geo.crumbs.length ? S.geo.crumbs[S.geo.crumbs.length - 1] : null;
    if (crumb) return { mode: "scope", level: crumb.level, units: [{ id: crumb.id, name: crumb.name, bbox: crumb.bbox }] };
    if (S.geo.features.length) {
      return { mode: "country", level: S.geo.viewLevel, units: S.geo.features.map(function (f) {
        return { id: f.properties.id, name: f.properties.name, bbox: f.bbox };
      }) };
    }
    return null;
  }

  function regionArea(eff) {
    if (!eff || !eff.units.length) return 0;
    var bb = unionBbox(eff.units.map(function (u) { return { bbox: u.bbox }; }));
    if (!bb) return 0;
    return (bb[2] - bb[0]) * (bb[3] - bb[1]);
  }

  function regionSizeState(eff) {
    var area = regionArea(eff);
    if (area > LIMITS.hardAreaDeg2) return "blocked";
    if (area > LIMITS.freeAreaDeg2) return "approval";
    return "free";
  }

  function updateGeoMeta() {
    var meta = $("#geo-meta");
    var eff = effectiveRegion();
    if (!eff) {
      meta.innerHTML = "Choose a country to begin — the map always shows exactly what your atlas will cover.";
      return;
    }
    var noun = LEVEL_NOUN[S.geo.viewLevel] || "areas";
    var crumb = S.geo.crumbs.length ? S.geo.crumbs[S.geo.crumbs.length - 1] : null;
    var canDrill = S.geo.viewLevel < maxLevel();
    var line;
    if (eff.mode === "subset") {
      var names = eff.units.slice(0, 4).map(function (u) { return esc(u.name); }).join(", ") +
        (eff.units.length > 4 ? " +" + (eff.units.length - 4) : "");
      line = "Your atlas: <b>" + names + "</b> — " + eff.units.length + " of " + S.geo.features.length + " " + noun +
        (crumb ? " in " + esc(crumb.name) : "") + ". Tap the map to add or remove areas. ";
    } else {
      var scopeName = crumb ? crumb.name : countryName();
      line = "Your atlas: <b>all of " + esc(scopeName) + "</b> — everything on the map. Tap areas to keep just some" +
        (canDrill ? ", or open a place in the list to go deeper. " : ". ");
    }
    var state = regionSizeState(eff);
    if (state === "free") {
      line += '<span class="hint ok">Ready to build.</span>';
    } else if (state === "approval") {
      line += '<span style="color:var(--color-sienna)">That\u2019s a big region. You can continue — it just needs a quick, free approval from the LOKA team before it builds (we\u2019ll email you). Prefer not to wait? Keep a smaller part of it.</span>';
    } else {
      line += '<span class="hint bad">That\u2019s more than one atlas can cover — open a place in the list and keep a smaller part of it.</span>';
    }
    meta.innerHTML = line;
  }

  $("#f-country").addEventListener("change", function () {
    S.geo.iso3 = this.value;
    resetGeo();
    if (!S.geo.iso3) return;
    S.geo.levels = [1];
    api("geo/levels?iso3=" + S.geo.iso3).then(function (r) {
      S.geo.levels = r.levels || [1];
      $("#level-hint").textContent = maxLevel() > 1
        ? "Boundary data goes down to " + (LEVEL_NOUN[maxLevel()] || "smaller areas") + " here."
        : "This country has one boundary level available.";
      loadUnits();
    }).catch(function () { loadUnits(); });
  });

  $("#back-2").onclick = function () { show(1); };
  $("#next-2").onclick = function () {
    msg(2, "");
    var eff = effectiveRegion();
    if (S.editMode === "rebuild" && !eff) {
      // no new pick → keep the atlas's current region, just change layers
      S.regionKept = true; show(3); loadCatalog(); return;
    }
    if (S.editMode === "rebuild") S.regionKept = false;
    if (!eff) return msg(2, "Choose a country first — the map shows what your atlas will cover.");
    var state = regionSizeState(eff);
    if (state === "blocked") {
      return msg(2, "That region is more than one atlas can cover — open a place in the list and keep a smaller part of it.");
    }
    if (state === "approval" && !$("#f-email").value.trim()) {
      msg(2, 'This region needs a quick approval from the LOKA team, so we need a way to reach you. <a href="#" id="goto-email">Add your contact email in step 1 →</a>');
      var a = document.getElementById("goto-email");
      if (a) a.onclick = function (ev) { ev.preventDefault(); show(1); setTimeout(function () { $("#f-email").focus(); }, 50); };
      return;
    }
    show(3);
    loadCatalog();
  };

  /* ================= step 3: layers ================= */

  function loadCatalog() {
    api("catalog?iso3=" + S.geo.iso3).then(function (r) {
      S.catalog.tier = r.tier;
      S.catalog.layers = r.layers;
      if (!Object.keys(S.catalog.chosen).length) {
        r.layers.forEach(function (l) { if (l.required || l.cost === "free") S.catalog.chosen[l.id] = true; });
        delete S.catalog.chosen["floodplain-ndem"];
      }
      $("#tier-note").textContent = (r.tier === "india"
        ? "India tier — the full catalogue, including LGD blocks and WRIS water layers."
        : "Global tier — boundaries, OSM waterways and ESA WorldCover land cover.")
        + " Sensible layers come pre-selected — adjust freely. These are your atlas's default layers; after it's built you can add your own data on top.";
      renderCatalog();
    }).catch(function (e) { msg(3, esc(errMsg(e))); });
  }

  var GROUP_LABELS = { base: "Base", context: "Terrain, climate & access", people: "People & services", eco: "Ecological landscape", agri: "Crops & value chain" };

  function catRow(l) {
    var row = document.createElement("label");
    row.className = "cat-row";
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!S.catalog.chosen[l.id] || !!l.required;
    cb.disabled = !!l.required;
    cb.onchange = function () {
      if (cb.checked) S.catalog.chosen[l.id] = true; else delete S.catalog.chosen[l.id];
      updateCatCounts();
    };
    var body = document.createElement("div");
    var badge = l.required ? '<span class="badge locked">always on</span>'
      : l.cost === "approval" ? '<span class="badge approval">needs approval</span>'
      : '<span class="badge free">free</span>';
    var attr = (l.attribution && (l.attribution[S.catalog.tier] || l.attribution.global)) || "";
    body.innerHTML = "<b>" + esc(l.label) + "</b>" + badge +
      '<span class="info">' + esc(l.info || "") + "</span>" +
      (attr ? '<span class="attr">Source: ' + esc(attr) + "</span>" : "");
    row.appendChild(cb);
    row.appendChild(body);
    return row;
  }

  // selected-count badge per group, so collapsed groups still tell the story
  function updateCatCounts() {
    document.querySelectorAll("#cat-list .cat-count").forEach(function (el) {
      var gid = el.dataset.group;
      var entries = S.catalog.layers.filter(function (l) { return l.group === gid; });
      var on = entries.filter(function (l) { return S.catalog.chosen[l.id] || l.required; }).length;
      el.textContent = on + " of " + entries.length + " selected";
    });
  }

  function renderCatalog() {
    var box = $("#cat-list");
    box.innerHTML = "";
    // collapsed <details> per group — the catalogue is long, so users scan
    // five headings with counts instead of a wall of checkboxes
    ["base", "context", "people", "eco", "agri"].forEach(function (gid) {
      var entries = S.catalog.layers.filter(function (l) { return l.group === gid; });
      if (!entries.length) return;
      var g = document.createElement("details");
      g.className = "cat-group";
      var sum = document.createElement("summary");
      sum.innerHTML = '<span class="g-chev" aria-hidden="true">›</span><h3>' + esc(GROUP_LABELS[gid]) + "</h3>" +
        '<span class="cat-count" data-group="' + esc(gid) + '"></span>';
      g.appendChild(sum);
      // group by named subgroup in first-appearance order (mirrors the viewer's panel)
      var order = [], subMap = {};
      entries.forEach(function (l) {
        if (l.subgroup) {
          if (!subMap[l.subgroup]) { subMap[l.subgroup] = []; order.push({ sub: l.subgroup }); }
          subMap[l.subgroup].push(l);
        } else {
          order.push({ item: l });
        }
      });
      order.forEach(function (o) {
        if (o.item) { g.appendChild(catRow(o.item)); return; }
        var h = document.createElement("div");
        h.className = "cat-sub";
        h.textContent = o.sub;
        g.appendChild(h);
        subMap[o.sub].forEach(function (l) { g.appendChild(catRow(l)); });
      });
      box.appendChild(g);
    });
    updateCatCounts();
  }

  $("#back-3").onclick = function () { show(2); };
  $("#next-3").onclick = function () {
    msg(3, "");
    var chosen = Object.keys(S.catalog.chosen);
    if (!chosen.length) return msg(3, "Pick at least one layer.");
    createInstance();
  };

  /* ================= step 4: create + poll + preview ================= */

  function payload() {
    var eff = effectiveRegion() || { level: S.geo.viewLevel, units: [] };
    return {
      slug: $("#f-slug").value.trim() || undefined,
      title: $("#f-title").value.trim(),
      subtitle: $("#f-subtitle").value.trim(),
      about: $("#f-about").value.trim(),
      org: $("#f-org").value.trim(),
      email: $("#f-email").value.trim() || undefined,
      visibility: S.visibility,
      branding: {
        orgName: $("#f-org").value.trim(),
        orgUrl: $("#f-orgurl").value.trim() || undefined,
        footerLine: $("#f-footer").value.trim() || undefined,
        logoData: S.logoData || undefined,
      },
      region: { iso3: S.geo.iso3, level: eff.level, shapeIDs: eff.units.map(function (u) { return u.id; }) },
      layers: Object.keys(S.catalog.chosen),
    };
  }

  function rebuildInstance() {
    show(4);
    $("#build-title").textContent = "Rebuilding your atlas…";
    $("#prog-fill").style.width = "3%";
    $("#prog-msg").textContent = "Applying your changes…";
    $("#preview-wrap").hidden = true;
    $("#next-4").hidden = true;
    $("#back-4").hidden = true;
    msg(4, "");
    var body = { layers: Object.keys(S.catalog.chosen) };
    if (!S.regionKept) {
      var eff = effectiveRegion();
      if (eff) body.region = { iso3: S.geo.iso3, level: eff.level, shapeIDs: eff.units.map(function (u) { return u.id; }) };
    }
    api("instances/" + S.editSlug + "/rebuild", { method: "POST", body: body }).then(function (r) {
      S.build = { slug: r.slug, jobId: r.jobId };
      S._rebuildWasPublished = r.wasPublished;
      // an unpublished rebuild ends in a publish step — show it now, inactive until built
      if (!r.wasPublished) { $("#next-4").hidden = false; $("#next-4").disabled = true; }
      pollJob(r.jobId);
    }).catch(function (e) {
      show(3);
      msg(3, esc(errMsg(e)));
    });
  }

  function createInstance() {
    if (S.editMode === "rebuild") { rebuildInstance(); return; }
    show(4);
    $("#build-title").textContent = "Building your atlas…";
    $("#prog-fill").style.width = "3%";
    $("#prog-msg").textContent = "Creating your atlas…";
    $("#preview-wrap").hidden = true;
    // publish is the destination of this step — visible from the start, inactive until built
    $("#next-4").hidden = false;
    $("#next-4").disabled = true;
    $("#back-4").hidden = true;
    msg(4, "");

    api("instances", { method: "POST", body: payload() }).then(function (r) {
      S.build = r;
      if (r.status === "pending-approval") {
        $("#build-title").textContent = "Waiting for a quick approval";
        $("#prog-msg").textContent = "Your atlas needs a bit more computing than the free tier covers (a large region or heavy data layers), " +
          "so the LOKA team gets a quick look first — it's free and usually same-day. " +
          "We'll email you at " + $("#f-email").value + " when it's approved. You can safely leave this page.";
        $("#prog-fill").style.width = "6%";
        pollInstanceUntilBuilding();
      } else {
        pollJob(r.jobId);
      }
    }).catch(function (e) {
      if (e.needsAuth) {
        signIn("Private atlases need a verified email.").then(function (ok) { if (ok) createInstance(); else show(3); });
        return;
      }
      if (e.needsEmail) { show(1); msg(1, "Those layers need approval — add a contact email first."); return; }
      show(3);
      msg(3, esc(errMsg(e)));
    });
  }

  function authHeaders() {
    return S.build && S.build.editToken ? { Authorization: "Bearer " + S.build.editToken } : {};
  }

  function pollInstanceUntilBuilding() {
    var t = setInterval(function () {
      api("instances/" + S.build.slug, { headers: authHeaders() }).then(function (inst) {
        if (inst.status === "building" && inst.jobId) { clearInterval(t); pollJob(inst.jobId); }
        else if (inst.status === "built") { clearInterval(t); onBuilt(); }
        else if (inst.status === "denied") {
          clearInterval(t);
          $("#build-title").textContent = "Not approved this time";
          $("#prog-msg").textContent = "We couldn't approve this build — check your email for details.";
        }
      }).catch(function () {});
    }, 10000);
  }

  function pollJob(jobId) {
    $("#build-title").textContent = "Building your atlas…";
    $("#prog-bar").classList.add("working");
    var layerEl = $("#prog-layer");
    var t = setInterval(function () {
      api("jobs/" + jobId).then(function (j) {
        $("#prog-fill").style.width = Math.max(4, j.pct) + "%";
        if (j.queuedBehind) {
          layerEl.hidden = true;
          $("#prog-msg").textContent = "Waiting in line — " + j.queuedBehind +
            (j.queuedBehind === 1 ? " atlas" : " atlases") + " building ahead of yours…";
        } else {
          if (j.layer) {
            layerEl.hidden = false;
            var count = (j.lnum >= 1 && j.ltot) ? ' <span class="count">· layer ' + j.lnum + " of " + j.ltot + "</span>" : "";
            layerEl.innerHTML = esc(j.layer) + count;
          } else {
            layerEl.hidden = true;
          }
          // the raw step message is the fine-grained activity (e.g. "reading Copernicus tile …")
          $("#prog-msg").textContent = j.message || j.status || "working…";
        }
        if (j.logTail && j.logTail.length) {
          var log = $("#prog-log");
          log.hidden = false;
          log.textContent = j.logTail.join("\n");
          log.scrollTop = log.scrollHeight;
        }
        if (j.status === "done") { clearInterval(t); $("#prog-bar").classList.remove("working"); onBuilt(); }
        if (j.status === "failed") {
          clearInterval(t);
          $("#prog-bar").classList.remove("working");
          layerEl.hidden = true;
          $("#build-title").textContent = "Build failed";
          $("#prog-msg").textContent = j.message || "build failed";
          $("#next-4").disabled = true; // nothing to publish
          $("#back-4").hidden = false;
          msg(4, "You can adjust your region or layers and try again.");
        }
      }).catch(function () {});
    }, 2000);
  }

  function previewUrl() {
    var u = "../?dataset=" + encodeURIComponent(S.build.slug);
    if (S.build.viewKey) u += "&key=" + encodeURIComponent(S.build.viewKey);
    return u;
  }

  var CHECK_SVG = '<svg class="done-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  function onBuilt() {
    $("#prog-fill").style.width = "100%";
    $("#prog-bar").classList.remove("working");
    $("#prog-layer").hidden = true;
    $("#preview-wrap").hidden = false;
    $("#preview-frame").src = previewUrl();

    // Rebuild of a published atlas: changes are already live — confirm and return.
    if (S.editMode === "rebuild" && S._rebuildWasPublished) {
      $("#build-title").innerHTML = CHECK_SVG + "Your changes are live";
      $("#prog-msg").textContent = "Your published atlas has been updated with the new layers.";
      $("#next-4").hidden = true;
      $("#back-4").hidden = true;
      msg(4, 'The preview below shows the updated atlas. <a href="#" id="rb-done">← Back to your atlases</a>', "ok");
      var d = document.getElementById("rb-done");
      if (d) d.onclick = function (ev) { ev.preventDefault(); exitEdit(); refreshMe(); window.scrollTo({ top: 0 }); };
      return;
    }
    $("#build-title").innerHTML = CHECK_SVG + (S.editMode === "rebuild" ? "Rebuilt" : "Your atlas is ready");
    $("#prog-msg").textContent = "Built. Explore the preview below, then publish.";
    $("#next-4").hidden = false;
    $("#next-4").disabled = false; // build complete — publishing unlocks
    $("#back-4").hidden = false;
  }

  $("#back-4").onclick = function () { show(3); };
  $("#next-4").onclick = function () {
    if (!S.session) {
      signIn("Publishing needs a verified email, so your atlas stays manageable — and so we can reach you about it.")
        .then(function (ok) { if (ok) publish(); });
      return;
    }
    publish();
  };

  /* ================= step 5: publish & share ================= */

  function prettyUrl() {
    var base = location.origin + location.pathname.replace(/setup\/?$/, "");
    if (S.build.viewKey) return base + "?dataset=" + S.build.slug + "&key=" + S.build.viewKey;
    return base + "a/" + S.build.slug;
  }

  function publish() {
    api("instances/" + S.build.slug + "/publish", { method: "POST", headers: authHeaders(), body: {} })
      .then(function () {
        clearLocal(); // published — the browser-local backup is no longer needed
        show(5);
        renderPublished();
        loadDirectory();
      })
      .catch(function (e) {
        if (e.needsAuth) {
          signIn("Publishing needs a verified email — sign in to continue.")
            .then(function (ok) { if (ok) publish(); });
          return;
        }
        msg(4, esc(errMsg(e)));
      });
  }

  function renderPublished() {
    var body = $("#pub-body");
    var isPrivate = S.visibility === "private";
    $("#pub-title").textContent = isPrivate ? "Your private atlas is live" : "Your atlas is live 🎉";
    body.innerHTML = "";

    // publishing bound the atlas to the signed-in account — that's the whole story
    var manage = document.createElement("p");
    manage.className = "hint";
    manage.innerHTML = (S.session && S.session.email
      ? "It’s linked to <b>" + esc(S.session.email) + "</b> — manage, edit or delete it anytime from <b>Your atlases</b> in this wizard."
      : "Manage, edit or delete it anytime from <b>Your atlases</b> in this wizard.");
    body.appendChild(manage);

    var next = document.createElement("p");
    next.className = "hint";
    next.innerHTML = "Your atlas ships with its default open-data layers — now make it yours: " +
      '<a href="../layers.html?dataset=' + encodeURIComponent(S.build.slug) + '"><b>add your own data</b></a> ' +
      "(CSV, Excel, JSON, GeoJSON, KML or GPX). Experimental — under active development.";
    body.appendChild(next);

    body.appendChild(window.AtlasShare.panel({
      url: prettyUrl(),
      title: $("#f-title").value.trim(),
      slug: S.build.slug,
      private: isPrivate,
    }));
  }

  /* ================= auth (magic links) ================= */

  var authResolve = null;
  var authPollTimer = null;
  var dlg = $("#auth-dialog");

  function signIn(why) {
    $("#auth-why").textContent = why || "";
    $("#auth-step-email").hidden = false;
    $("#auth-step-wait").hidden = true;
    $("#auth-msg").innerHTML = "";
    if ($("#f-email").value) $("#auth-email").value = $("#f-email").value;
    dlg.showModal();
    return new Promise(function (resolve) { authResolve = resolve; });
  }
  function endAuth(ok) {
    clearInterval(authPollTimer);
    if (dlg.open) dlg.close();
    if (authResolve) { authResolve(ok); authResolve = null; }
  }
  $("#auth-cancel").onclick = $("#auth-cancel-2").onclick = function () { endAuth(false); };

  $("#auth-send").onclick = function () {
    var email = $("#auth-email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      $("#auth-msg").innerHTML = '<div class="msg err">Enter a valid email.</div>'; return;
    }
    saveLocal(); // capture the in-progress atlas before the user leaves to click the link
    api("auth/request-link", { method: "POST", body: { email: email } })
      .then(function (r) {
        $("#auth-step-email").hidden = true;
        $("#auth-step-wait").hidden = false;
        $("#auth-sent-to").textContent = email;
        if (!r.sent) {
          $("#auth-msg").innerHTML = '<div class="msg err">This server can’t send email yet, so no message reached your inbox. ' +
            'Your sign-in link was written to the server log — ask the LOKA team (mithun@socratus.org) to send it to you, ' +
            'or try again once email is set up.</div>';
        }
        authPollTimer = setInterval(function () {
          api("auth/me").then(function (me) {
            S.session = me;
            showSignedIn(me);
            renderMyAtlases();
            endAuth(true);
          }).catch(function () {});
        }, 3000);
      })
      .catch(function (e) { $("#auth-msg").innerHTML = '<div class="msg err">' + esc(errMsg(e)) + "</div>"; });
  };

  function showSignedIn(me) {
    $("#nav-auth").textContent = me.email;
    $("#nav-logout").hidden = false;
  }

  $("#nav-auth").onclick = function () {
    if (S.session) return;
    signIn("Sign in to see your drafts and atlases.").then(function (ok) { if (ok) loadDrafts(); });
  };

  $("#nav-logout").onclick = function () {
    api("auth/logout", { method: "POST", body: {} })
      .catch(function () {})
      .then(function () { location.href = "./"; }); // fresh wizard, signed out
  };

  /* ================= drafts ================= */

  function draftState() {
    return {
      fields: {
        title: $("#f-title").value, slug: $("#f-slug").value, subtitle: $("#f-subtitle").value,
        org: $("#f-org").value, email: $("#f-email").value, orgUrl: $("#f-orgurl").value,
        about: $("#f-about").value, footer: $("#f-footer").value,
      },
      visibility: S.visibility,
      geo: {
        iso3: S.geo.iso3,
        level: S.geo.viewLevel,
        selected: Object.keys(S.geo.selected),
        crumbs: S.geo.crumbs,
      },
      chosen: Object.keys(S.catalog.chosen),
      step: S.step,
    };
  }
  function applyDraft(d) {
    var st = d.state || {};
    var f = st.fields || {};
    $("#f-title").value = f.title || ""; $("#f-slug").value = f.slug || "";
    $("#f-subtitle").value = f.subtitle || ""; $("#f-org").value = f.org || "";
    $("#f-email").value = f.email || ""; $("#f-orgurl").value = f.orgUrl || "";
    $("#f-about").value = f.about || ""; $("#f-footer").value = f.footer || "";
    S.slugTouched = !!f.slug;
    if (st.visibility) setVisibility(st.visibility);
    S.draftId = d.id;
    if (st.geo && st.geo.iso3) {
      S.geo.iso3 = st.geo.iso3;
      initCountries();
      setTimeout(function () {
        $("#f-country").value = S.geo.iso3;
        resetGeo();
        S.geo.crumbs = st.geo.crumbs || [];
        S.geo.viewLevel = st.geo.level || 1;
        api("geo/levels?iso3=" + S.geo.iso3).then(function (r) { S.geo.levels = r.levels || [1]; })
          .catch(function () {})
          .then(function () {
            loadUnits();
            var restore = setInterval(function () {
              if (S.geo.features.length) {
                clearInterval(restore);
                (st.geo.selected || []).forEach(function (id) {
                  if (!S.geo.selected[id]) toggleUnit(id);
                });
              }
            }, 400);
          });
      }, 300);
    }
    (st.chosen || []).forEach(function (id) { S.catalog.chosen[id] = true; });
    show(Math.min(st.step || 1, 3));
  }

  function saveDraft() {
    var doSave = function () {
      api("drafts", { method: "POST", body: { draft: { id: S.draftId, title: $("#f-title").value || "Untitled atlas", state: draftState() } } })
        .then(function (r) { S.draftId = r.id; msg(S.step, "Draft saved — sign back in any time to resume.", "ok"); })
        .catch(function (e) { msg(S.step, esc(errMsg(e))); });
    };
    if (S.session) return doSave();
    signIn("Drafts are saved to your email, so you can come back later.").then(function (ok) { if (ok) doSave(); });
  }
  ["1", "2", "3"].forEach(function (n) {
    var b = $("#save-draft-" + n);
    if (b) b.onclick = saveDraft;
  });

  function loadDrafts() {
    api("drafts").then(function (r) {
      if (!r.drafts || !r.drafts.length) return;
      var box = $("#resume-drafts");
      box.innerHTML = '<div class="msg ok">Resume a draft: ' + r.drafts.map(function (d) {
        return '<a href="#" data-id="' + esc(d.id) + '">' + esc(d.title || d.id) + "</a>";
      }).join(" · ") + "</div>";
      box.querySelectorAll("a[data-id]").forEach(function (a) {
        a.onclick = function (ev) {
          ev.preventDefault();
          var d = r.drafts.find(function (x) { return x.id === a.dataset.id; });
          if (d) applyDraft(d);
        };
      });
    }).catch(function () {});
  }

  /* ================= directory ================= */

  function loadDirectory() {
    api("instances").then(function (r) {
      var grid = $("#dir-grid");
      grid.innerHTML = "";
      var list = r.instances || [];
      if (!list.length) {
        grid.innerHTML = '<span class="hint">None yet — yours could be the first.</span>';
        return;
      }
      list.forEach(function (i) {
        var a = document.createElement("a");
        a.className = "dir-card";
        a.href = "../a/" + encodeURIComponent(i.slug);
        a.innerHTML = "<b>" + esc(i.title) + "</b><span>" +
          esc(i.org || "") + (i.org && i.regionLabel ? " · " : "") + esc(i.regionLabel || "") + "</span>";
        grid.appendChild(a);
      });
    }).catch(function () {});
  }

  /* ================= edit an existing atlas ================= */

  function refreshMe() {
    return api("auth/me").then(function (me) {
      S.session = me;
      showSignedIn(me);
      renderMyAtlases();
      return me;
    }).catch(function () {});
  }

  function renderMyAtlases() {
    var sec = $("#my-atlases"), list = $("#my-atlases-list");
    var mine = (S.session && S.session.instances) || [];
    if (!mine.length) { sec.hidden = true; return; }
    sec.hidden = false;
    list.className = "mine";
    list.innerHTML = "";
    mine.forEach(function (i) {
      var row = document.createElement("div");
      row.className = "mine-item";
      row.dataset.slug = i.slug;
      var label = i.status === "published" ? (i.visibility === "private" ? "Private" : "Published")
        : i.status === "building" ? "Building…" : i.status === "pending-approval" ? "Awaiting approval"
        : i.status === "built" ? "Unpublished" : i.status;
      row.innerHTML = '<div class="mine-main"><b>' + esc(i.title || i.slug) + "</b><span>" +
        esc(i.regionLabel || "") + '</span></div><span class="mine-badge ' +
        (i.status === "published" ? "" : "draft") + '">' + esc(label) + "</span>";
      var actions = document.createElement("div");
      actions.className = "mine-actions";
      if (i.status === "published" && i.visibility !== "private") {
        var open = document.createElement("a");
        open.href = "../a/" + encodeURIComponent(i.slug);
        open.target = "_blank"; open.rel = "noopener"; open.textContent = "Open";
        actions.appendChild(open);
      }
      var busy = i.status === "building" || i.status === "pending-approval";
      if (!busy && (i.status === "published" || i.status === "built")) {
        var addData = document.createElement("a");
        addData.href = "../layers.html?dataset=" + encodeURIComponent(i.slug);
        addData.textContent = "Add data";
        addData.title = "Add your own data as a map layer (CSV, Excel, JSON, GeoJSON, KML, GPX) — experimental, under development";
        actions.appendChild(addData);
      }
      var edit = document.createElement("button"); edit.textContent = "Edit details";
      edit.disabled = busy; edit.onclick = function () { editDetails(i.slug); };
      var reb = document.createElement("button"); reb.textContent = "Change layers";
      reb.disabled = busy; reb.onclick = function () { changeLayers(i.slug); };
      var del = document.createElement("button"); del.className = "danger"; del.textContent = "Delete";
      del.onclick = function () { deleteAtlas(i.slug, i.title); };
      actions.appendChild(edit); actions.appendChild(reb); actions.appendChild(del);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function fillDetails(inst) {
    var bnd = inst.branding || {};
    $("#f-title").value = inst.title || "";
    $("#f-slug").value = inst.slug || "";
    $("#f-subtitle").value = inst.subtitle || "";
    $("#f-org").value = inst.org || bnd.orgName || "";
    $("#f-orgurl").value = bnd.orgUrl || "";
    $("#f-about").value = inst.about || "";
    $("#f-footer").value = bnd.footerLine || "";
    S.logoData = null; S.removeLogo = false;
    var lh = $("#logo-hint");
    lh.className = "hint";
    lh.textContent = bnd.hasLogo ? "current logo kept — choose a file to replace it" : "";
    setVisibility(inst.visibility || "public");
    $("#f-slug").disabled = true; // the slug is the atlas URL — fixed after creation
  }

  function editDetails(slug) {
    api("instances/" + slug).then(function (inst) {
      if (!inst.canEdit) { alert("You can't edit this atlas."); return; }
      S.editSlug = slug; S.editMode = "details"; S.editInst = inst;
      fillDetails(inst);
      var eb = $("#edit-banner"); eb.hidden = false;
      eb.innerHTML = "Editing <b>" + esc(inst.title) + "</b> — details, branding &amp; visibility. " +
        '<a href="#" id="edit-cancel">Cancel</a>';
      $("#edit-cancel").onclick = function (ev) { ev.preventDefault(); exitEdit(); };
      $("#next-1").textContent = "Save changes";
      $("#my-atlases").hidden = true;
      $(".stepper").hidden = true;
      show(1);
      window.scrollTo({ top: 0 });
    }).catch(function (e) { alert(errMsg(e)); });
  }

  function saveDetails() {
    msg(1, "");
    if (!$("#f-title").value.trim()) return msg(1, "Give your atlas a title first.");
    var body = {
      title: $("#f-title").value.trim(),
      subtitle: $("#f-subtitle").value.trim(),
      about: $("#f-about").value.trim(),
      org: $("#f-org").value.trim(),
      visibility: S.visibility,
      branding: {
        orgName: $("#f-org").value.trim(),
        orgUrl: $("#f-orgurl").value.trim() || undefined,
        footerLine: $("#f-footer").value.trim() || undefined,
        logoData: S.logoData || undefined,
        removeLogo: S.removeLogo || undefined,
      },
    };
    $("#next-1").disabled = true;
    api("instances/" + S.editSlug + "/details", { method: "POST", body: body })
      .then(function () { $("#next-1").disabled = false; exitEdit(); refreshMe(); window.scrollTo({ top: 0 }); })
      .catch(function (e) {
        $("#next-1").disabled = false;
        if (e.needsAuth) { signIn("Sign in to edit this atlas.").then(function (ok) { if (ok) saveDetails(); }); return; }
        msg(1, esc(errMsg(e)));
      });
  }

  function changeLayers(slug) {
    api("instances/" + slug).then(function (inst) {
      if (!inst.canEdit) { alert("You can't edit this atlas."); return; }
      S.editSlug = slug; S.editMode = "rebuild"; S.editInst = inst; S.regionKept = true;
      // fully reset the drill state — leftover crumbs/features would read as a
      // "new region" and defeat the keep-current-region default
      S.geo = { iso3: inst.region.iso3, levels: [1], crumbs: [], viewLevel: 1, features: [], selected: {} };
      S.catalog = { tier: "", layers: [], chosen: {} };
      (inst.layers || []).forEach(function (id) { S.catalog.chosen[id] = true; });
      $("#my-atlases").hidden = true;
      $(".stepper").hidden = false;
      var gc = $("#geo-current"); gc.hidden = false;
      gc.innerHTML = "Editing <b>" + esc(inst.title) + "</b>. Current region: <b>" + esc(inst.regionLabel || "") +
        "</b>. Keep it and change layers on the next step, or pick a new region below. " +
        '<a href="#" id="rebuild-cancel">Cancel</a>';
      $("#rebuild-cancel").onclick = function (ev) { ev.preventDefault(); exitEdit(); };
      if ($("#f-country").options.length < 2) initCountries();
      $("#f-country").value = "";
      show(2);
      window.scrollTo({ top: 0 });
    }).catch(function (e) { alert(errMsg(e)); });
  }

  function deleteAtlas(slug, title) {
    if (!confirm("Delete “" + (title || slug) + "”? This removes the atlas and its data, and can't be undone.")) return;
    api("instances/" + slug, { method: "DELETE" })
      .then(function () { refreshMe(); })
      .catch(function (e) { alert(errMsg(e)); });
  }

  function exitEdit() {
    S.editSlug = null; S.editMode = null; S.editInst = null; S.regionKept = false;
    $("#edit-banner").hidden = true;
    $("#geo-current").hidden = true;
    $("#next-1").textContent = "Choose layers →";
    $("#f-slug").disabled = false;
    $(".stepper").hidden = false;
    ["f-title", "f-slug", "f-subtitle", "f-org", "f-orgurl", "f-about", "f-footer"].forEach(function (id) { $("#" + id).value = ""; });
    S.logoData = null; S.removeLogo = false; S.slugTouched = false; S._rebuildWasPublished = false;
    $("#logo-hint").textContent = "";
    S.geo = { iso3: "", level: 1, features: [], selected: {}, viewLevel: 1, crumbs: [] };
    S.catalog = { tier: "", layers: [], chosen: {} };
    setVisibility("public");
    msg(1, ""); msg(4, "");
    renderMyAtlases();
    show(1);
  }

  // Deep-link from the viewer's "Manage this atlas" button: ?edit=<slug> scrolls
  // to and highlights that atlas in the dashboard (prompting sign-in if needed).
  function focusManage(slug) {
    var owned = ((S.session && S.session.instances) || []).some(function (i) { return i.slug === slug; });
    if (!owned) {
      if (!S.session || !S.session.email) {
        signIn("Sign in to manage your atlas.").then(function (ok) {
          if (ok) refreshMe().then(function () { focusManage(slug); });
        });
      }
      return;
    }
    var row = document.querySelector('.mine-item[data-slug="' + (window.CSS && CSS.escape ? CSS.escape(slug) : slug) + '"]');
    if (row) {
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.classList.add("flash");
      setTimeout(function () { row.classList.remove("flash"); }, 2200);
    }
  }

  /* ================= init ================= */

  var QS = new URLSearchParams(location.search);
  var EDIT_PARAM = QS.get("edit");
  var SIGNIN_PARAM = QS.get("signin");

  api("auth/me").then(function (me) {
    S.session = me;
    showSignedIn(me);
    loadDrafts();
    renderMyAtlases();
    if (EDIT_PARAM) focusManage(EDIT_PARAM);
  }).catch(function () {
    if (EDIT_PARAM) focusManage(EDIT_PARAM); // not signed in → focusManage will prompt
    else if (SIGNIN_PARAM) signIn("Sign in to see and manage your atlases.").then(function (ok) { if (ok) loadDrafts(); });
  });
  loadDirectory();
  show(1);
  if (!EDIT_PARAM) offerLocalResume();
})();
