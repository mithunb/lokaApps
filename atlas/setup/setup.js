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
        "fill-color": ["case", ["boolean", ["feature-state", "sel"], false], "#40573D", "#B0863A"],
        "fill-opacity": ["case", ["boolean", ["feature-state", "sel"], false], 0.45,
          ["boolean", ["feature-state", "hover"], false], 0.25, 0.08],
      } });
      geoMap.addLayer({ id: "units-line", type: "line", source: "units", paint: {
        "line-color": ["case", ["boolean", ["feature-state", "sel"], false], "#2F4230", "#9C5A34"],
        "line-width": ["case", ["boolean", ["feature-state", "sel"], false], 2, 0.8] } });
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

  // Drill state: crumbs = the units opened so far; the list shows children of the
  // last crumb (or the country's top level). Selections can mix siblings freely
  // but must all sit at one depth — the built atlas is one set of units.
  function resetGeo() {
    S.geo.crumbs = [];
    S.geo.viewLevel = 1;
    S.geo.features = [];
    S.geo.selected = {};
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
        var bb = parent ? null : unionBbox(S.geo.features);
        var fit = bb || (S.geo.features.length ? unionBbox(S.geo.features) : null);
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
    if (S.geo.crumbs.length) root.onclick = function () { S.geo.crumbs = []; S.geo.viewLevel = 1; loadUnits(); };
    add(root);
    S.geo.crumbs.forEach(function (c, i) {
      sep();
      var last = i === S.geo.crumbs.length - 1;
      var el = document.createElement(last ? "span" : "button");
      el.className = last ? "cur" : "";
      el.textContent = c.name;
      if (!last) el.onclick = function () {
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
    S.geo.features
      .slice()
      .sort(function (a, b) { return a.properties.name.localeCompare(b.properties.name); })
      .forEach(function (f) {
        var id = f.properties.id;
        var row = document.createElement("label");
        row.className = "geo-item";
        row.dataset.id = id;
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!S.geo.selected[id];
        cb.onchange = function () { toggleUnit(id); };
        row.appendChild(cb);
        var nm = document.createElement("span");
        nm.className = "nm";
        nm.textContent = f.properties.name;
        row.appendChild(nm);
        if (canDrill) {
          var open = document.createElement("button");
          open.type = "button";
          open.className = "geo-open";
          open.textContent = "Open ›";
          open.title = "Pick smaller areas inside " + f.properties.name;
          open.onclick = function (ev) {
            ev.preventDefault(); ev.stopPropagation();
            S.geo.crumbs.push({ id: id, name: f.properties.name, level: S.geo.viewLevel });
            S.geo.viewLevel += 1;
            loadUnits();
          };
          row.appendChild(open);
        }
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
      var levels = Object.keys(S.geo.selected).map(function (k) { return S.geo.selected[k].level; });
      if (levels.length && levels[0] !== S.geo.viewLevel) {
        if (!confirm("Your earlier picks are at a different level — clear them and start from here?")) return;
        Object.keys(S.geo.selected).forEach(function (k) {
          if (geoMapReady) geoMap.setFeatureState({ source: "units", id: k }, { sel: false });
        });
        S.geo.selected = {};
        renderGeoList();
      }
      S.geo.selected[id] = { name: f.properties.name, bbox: f.bbox, level: S.geo.viewLevel };
    }
    var row = document.querySelector('.geo-item[data-id="' + CSS.escape(id) + '"] input');
    if (row) row.checked = !!S.geo.selected[id];
    if (geoMapReady) geoMap.setFeatureState({ source: "units", id: id }, { sel: !!S.geo.selected[id] });
    updateGeoMeta();
  }

  function selection() {
    return Object.keys(S.geo.selected).map(function (id) {
      var s = S.geo.selected[id];
      return { id: id, name: s.name, bbox: s.bbox, level: s.level };
    });
  }

  function selectionArea() {
    var sel = selection();
    if (!sel.length) return 0;
    var bb = unionBbox(sel.map(function (s) { return { bbox: s.bbox }; }));
    return (bb[2] - bb[0]) * (bb[3] - bb[1]);
  }

  function selectionSizeState() {
    var area = selectionArea();
    if (area > LIMITS.hardAreaDeg2) return "blocked";
    if (area > LIMITS.freeAreaDeg2) return "approval";
    return "free";
  }

  function updateGeoMeta() {
    var sel = selection();
    var meta = $("#geo-meta");
    if (!sel.length) {
      meta.innerHTML = "Tick areas to include them in your atlas — or <b>Open ›</b> one to pick smaller areas inside it.";
      return;
    }
    var names = sel.slice(0, 4).map(function (s) { return esc(s.name); }).join(", ") +
      (sel.length > 4 ? " +" + (sel.length - 4) : "");
    var state = selectionSizeState();
    var line = "<b>" + sel.length + "</b> area" + (sel.length > 1 ? "s" : "") + " selected — " + names + ". ";
    if (state === "free") {
      line += '<span class="hint ok">Ready to build.</span>';
    } else if (state === "approval") {
      line += '<span style="color:var(--color-sienna)">That\u2019s a big region. You can continue — it just needs a quick, free approval from the LOKA team before it builds (we\u2019ll email you). Prefer not to wait? <b>Open ›</b> an area and pick smaller parts of it.</span>';
    } else {
      line += '<span class="hint bad">That\u2019s more than one atlas can cover. <b>Open ›</b> an area and pick smaller parts inside it.</span>';
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
        ? "Tick areas to include them, or Open › one to pick smaller areas inside it."
        : "This country has one boundary level available.";
      loadUnits();
    }).catch(function () { loadUnits(); });
  });

  $("#back-2").onclick = function () { show(1); };
  $("#next-2").onclick = function () {
    msg(2, "");
    var sel = selection();
    if (!sel.length) return msg(2, "Pick at least one area first.");
    var state = selectionSizeState();
    if (state === "blocked") {
      return msg(2, "That region is more than one atlas can cover — <b>Open ›</b> an area in the list and pick smaller parts inside it.");
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
      $("#tier-note").textContent = r.tier === "india"
        ? "India tier — the full catalogue, including LGD blocks and WRIS water layers."
        : "Global tier — boundaries, OSM waterways and ESA WorldCover land cover.";
      renderCatalog();
    }).catch(function (e) { msg(3, esc(errMsg(e))); });
  }

  var GROUP_LABELS = { base: "Base", eco: "Ecological landscape", agri: "Crops & value chain" };

  function renderCatalog() {
    var box = $("#cat-list");
    box.innerHTML = "";
    ["base", "eco", "agri"].forEach(function (gid) {
      var entries = S.catalog.layers.filter(function (l) { return l.group === gid; });
      if (!entries.length) return;
      var g = document.createElement("div");
      g.className = "cat-group";
      g.innerHTML = "<h3>" + esc(GROUP_LABELS[gid]) + "</h3>";
      entries.forEach(function (l) {
        var row = document.createElement("label");
        row.className = "cat-row";
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!S.catalog.chosen[l.id] || !!l.required;
        cb.disabled = !!l.required;
        cb.onchange = function () {
          if (cb.checked) S.catalog.chosen[l.id] = true; else delete S.catalog.chosen[l.id];
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
        g.appendChild(row);
      });
      box.appendChild(g);
    });
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
    var sel = selection();
    var level = sel.length ? sel[0].level : S.geo.viewLevel;
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
      region: { iso3: S.geo.iso3, level: level, shapeIDs: sel.map(function (f) { return f.id; }) },
      layers: Object.keys(S.catalog.chosen),
    };
  }

  function createInstance() {
    show(4);
    $("#build-title").textContent = "Building your atlas…";
    $("#prog-fill").style.width = "3%";
    $("#prog-msg").textContent = "Creating instance…";
    $("#preview-wrap").hidden = true;
    $("#next-4").hidden = true;
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
    var t = setInterval(function () {
      api("jobs/" + jobId).then(function (j) {
        $("#prog-fill").style.width = Math.max(4, j.pct) + "%";
        $("#prog-msg").textContent = (j.queuedBehind ? "Queued (" + j.queuedBehind + " ahead) — " : "") + (j.message || j.status);
        if (j.logTail && j.logTail.length) {
          var log = $("#prog-log");
          log.hidden = false;
          log.textContent = j.logTail.join("\n");
          log.scrollTop = log.scrollHeight;
        }
        if (j.status === "done") { clearInterval(t); onBuilt(); }
        if (j.status === "failed") {
          clearInterval(t);
          $("#build-title").textContent = "Build failed";
          $("#prog-msg").textContent = j.message || "build failed";
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

  function onBuilt() {
    $("#prog-fill").style.width = "100%";
    $("#build-title").textContent = "Your atlas is ready";
    $("#prog-msg").textContent = "Built. Explore the preview below, then publish.";
    $("#preview-wrap").hidden = false;
    $("#preview-frame").src = previewUrl();
    $("#next-4").hidden = false;
    $("#back-4").hidden = false;
  }

  $("#back-4").onclick = function () { show(3); };
  $("#next-4").onclick = function () { publish(); };

  /* ================= step 5: publish & share ================= */

  function prettyUrl() {
    var base = location.origin + location.pathname.replace(/setup\/?$/, "");
    if (S.build.viewKey) return base + "?dataset=" + S.build.slug + "&key=" + S.build.viewKey;
    return base + "a/" + S.build.slug;
  }

  function publish() {
    api("instances/" + S.build.slug + "/publish", { method: "POST", headers: authHeaders(), body: {} })
      .then(function () {
        show(5);
        renderPublished();
        loadDirectory();
      })
      .catch(function (e) { msg(4, esc(errMsg(e))); });
  }

  function renderPublished() {
    var body = $("#pub-body");
    var isPrivate = S.visibility === "private";
    $("#pub-title").textContent = isPrivate ? "Your private atlas is live" : "Your atlas is live 🎉";
    body.innerHTML = "";

    var tokenBox = document.createElement("div");
    tokenBox.className = "token-box";
    tokenBox.innerHTML = "<b>Save your edit token — it's shown only once.</b>" +
      "<code>" + esc(S.build.editToken) + "</code>" +
      '<span class="hint">It\'s the only way to manage or delete this atlas later' +
      (S.session ? " (also linked to your account " + esc(S.session.email) + ")" : "") + ".</span> ";
    var cp = document.createElement("button");
    cp.className = "btn secondary"; cp.style.marginTop = ".5rem"; cp.textContent = "Copy token";
    cp.onclick = function () { navigator.clipboard.writeText(S.build.editToken); cp.textContent = "Copied ✓"; };
    tokenBox.appendChild(cp);
    body.appendChild(tokenBox);

    if (!S.session && S.build.editToken) {
      var claim = document.createElement("p");
      claim.className = "hint";
      claim.innerHTML = 'Prefer not to keep a token? <a href="#" id="claim-link">Sign in with email</a> to attach this atlas to an account.';
      body.appendChild(claim);
      claim.querySelector("#claim-link").onclick = function (ev) {
        ev.preventDefault();
        signIn("Attach this atlas to your email so you can manage it without the token.").then(function (ok) {
          if (ok) api("instances/" + S.build.slug + "/claim", { method: "POST", body: { editToken: S.build.editToken } })
            .then(function () { msg(5, "Linked to " + esc(S.session.email), "ok"); });
        });
      };
    }

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
    api("auth/request-link", { method: "POST", body: { email: email, next: location.pathname } })
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
            $("#nav-auth").textContent = me.email;
            endAuth(true);
          }).catch(function () {});
        }, 3000);
      })
      .catch(function (e) { $("#auth-msg").innerHTML = '<div class="msg err">' + esc(errMsg(e)) + "</div>"; });
  };

  $("#nav-auth").onclick = function () {
    if (S.session) return;
    signIn("Sign in to see your drafts and atlases.").then(function (ok) { if (ok) loadDrafts(); });
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
        level: selection().length ? selection()[0].level : S.geo.viewLevel,
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

  /* ================= init ================= */

  api("auth/me").then(function (me) {
    S.session = me;
    $("#nav-auth").textContent = me.email;
    loadDrafts();
  }).catch(function () {});
  loadDirectory();
  show(1);
})();
