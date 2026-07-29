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
    mode: "wizard",        // 'home' = dashboard only; 'wizard' = the step flow
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
    // any step visible means we're inside the wizard proper — the fork and the
    // data-first panel step aside, the stepper comes back. Null-guarded: a
    // browser holding a cached page against fresh JS must degrade, not die.
    var pc = $("#path-choice"); if (pc) pc.hidden = true;
    var dfp = $("#data-first"); if (dfp) dfp.hidden = true;
    var stp = document.querySelector(".stepper"); if (stp) stp.hidden = false;
    for (var i = 1; i <= 5; i++) {
      $("#step-" + i).hidden = i !== step;
      var chip = document.querySelector('.stp[data-step="' + i + '"]');
      chip.classList.toggle("active", i === step);
      chip.classList.toggle("done", i < step);
    }
    window.scrollTo({ top: 0 });
    if (step >= 1 && step <= 3) saveLocal(); // keep a browser-local backup of in-progress work
  }

  // Landing view for returning creators: just their atlases — the wizard stays
  // out of sight until "Build a new atlas".
  function showHome() {
    S.mode = "home";
    $(".stepper").hidden = true;
    $("#path-choice").hidden = true;
    $("#data-first").hidden = true;
    for (var i = 1; i <= 5; i++) $("#step-" + i).hidden = true;
    renderMyAtlases();
    window.scrollTo({ top: 0 });
  }
  // Every new atlas starts at the fork: begin from a place, or from a data file.
  function showFork() {
    S.mode = "wizard";
    var ma = $("#my-atlases"); if (ma) ma.hidden = true;
    var stp = document.querySelector(".stepper"); if (stp) stp.hidden = true;
    for (var i = 1; i <= 5; i++) $("#step-" + i).hidden = true;
    var dfp = $("#data-first"); if (dfp) dfp.hidden = true;
    var pc = $("#path-choice");
    if (pc) pc.hidden = false;
    else show(1);   // stale cached page without the fork markup — degrade to step 1
    window.scrollTo({ top: 0 });
  }
  function startWizard() {
    S.mode = "wizard";
    S.dataFirst = null; S.userFiles = []; S._lostFiles = []; S._dfDraft = null;
    renderMyAtlases(); // dashboard steps aside while building
    show(1);           // show() hides the fork + data-first, restores the stepper
  }
  $("#start-new").onclick = showFork;
  $("#path-place").onclick = startWizard;
  $("#path-data").onclick = function () { startDataFirst(); };

  // The stepper is a map, not a mural: any chip is a way back (or forward, once
  // that step exists — the build must have run before 4, publish before 5).
  document.querySelectorAll(".stepper .stp").forEach(function (chip) {
    chip.addEventListener("click", function () {
      if (S.mode !== "wizard") return;
      var n = Number(chip.dataset.step);
      if (!n || n === S.step) return;
      if (n === 1) { show(1); return; }
      if (n === 2) { show(2); initCountries(); maybeApplyDfGeo(); return; }
      if (n === 3) {
        if (!S.geo.iso3) { show(2); initCountries(); msg(2, "Choose your region first — then pick the layers.", "ok"); return; }
        show(3); loadCatalog(); return;
      }
      if (n === 4 && S.build) { show(4); return; }
      if (n === 5 && S._published) { show(5); return; }
    });
  });

  /* ================= data-first: upload → infer region → wizard ================= */
  var dfMap = null, dfReady = false;
  function dfmsg(text, cls) { var el = $("#df-status"); if (!el) return; el.textContent = text || ""; el.className = text ? ("msg " + (cls || "")) : ""; }

  function startDataFirst() {
    S.mode = "wizard";
    S.dataFirst = { canonical: null, file: null, filename: "", iso3: "", inf: null, locators: null };
    S.userFiles = []; S._lostFiles = []; S._dfDraft = null;
    S._dfGeoApplied = false;
    $("#my-atlases").hidden = true;
    $(".stepper").hidden = true;
    $("#path-choice").hidden = true;
    for (var i = 1; i <= 5; i++) $("#step-" + i).hidden = true;
    $("#df-result").hidden = true;
    $("#df-country-wrap").hidden = true;   // country is detected from the data; shown only to override
    dfmsg("");
    $("#data-first").hidden = false;
    populateDfCountries();
    window.scrollTo({ top: 0 });
  }
  var sd1 = $("#start-data-1"); if (sd1) sd1.onclick = startDataFirst;
  $("#df-back").onclick = function () { showFork(); };

  var dfCountriesReady = null;
  function populateDfCountries() {
    var sel = $("#df-country");
    if (!dfCountriesReady) {
      dfCountriesReady = fetch("./countries.json").then(function (r) { return r.json(); }).then(function (list) {
        list.forEach(function (c) { var o = document.createElement("option"); o.value = c.iso3; o.textContent = c.name; sel.appendChild(o); });
      }).catch(function () {});
    }
    return dfCountriesReady;
  }
  function countryNameOf(iso3) {
    var o = document.querySelector('#df-country option[value="' + iso3 + '"]');
    return o ? o.textContent : iso3;
  }

  (function wireDropZone() {
    var drop = $("#df-drop"), file = $("#df-file");
    if (!drop) return;
    drop.onclick = function () { file.click(); };
    drop.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } };
    drop.ondragover = function (e) { e.preventDefault(); drop.style.borderColor = "var(--color-moss)"; };
    drop.ondragleave = function () { drop.style.borderColor = "var(--color-border)"; };
    drop.ondrop = function (e) { e.preventDefault(); drop.style.borderColor = "var(--color-border)"; if (e.dataTransfer.files && e.dataTransfer.files[0]) handleDfFile(e.dataTransfer.files[0]); };
    file.onchange = function () { if (this.files[0]) handleDfFile(this.files[0]); };
    $("#df-country").addEventListener("change", function () { S.dataFirst.iso3 = this.value; if (S.dataFirst.canonical) runDfInfer(); });
    $("#df-redo").onclick = function () { $("#df-result").hidden = true; S.dataFirst.canonical = null; dfmsg("Drop another file to try again.", "ok"); };
    $("#df-use").onclick = dfUseRegion;
  })();

  function resolveCanonical(out, cb) {
    if (out.kind === "unsupported") return cb(new Error(out.message || "That file type isn't supported."));
    if (out.kind === "sheets") return out.pick(out.sheets[0].name, function (e, o) { e ? cb(e) : resolveCanonical(o, cb); });
    if (out.kind === "classes") return out.pick(out.classes[0].cls, function (e, o) { e ? cb(e) : resolveCanonical(o, cb); });
    if (out.canonical) return cb(null, out.canonical);
    cb(new Error("Couldn't read that file."));
  }

  function handleDfFile(file) {
    dfmsg("Reading " + (file.name || "file") + "…", "ok");
    $("#df-result").hidden = true;
    LokaIngest.fromFile(file, function (err, out) {
      if (err) { dfmsg(errMsg(err), "err"); return; }
      resolveCanonical(out, function (e, canonical) {
        if (e) { dfmsg(errMsg(e), "err"); return; }
        S.dataFirst.canonical = canonical;
        S.dataFirst.file = file;
        S.dataFirst.filename = file.name || "";
        dfmsg("");
        runDfInfer();   // country comes from the data; the select appears only if we can't tell
      });
    });
  }

  function dfCentroid(geom) {
    var w = 180, s = 90, e = -180, n = -90;
    (function walk(c) { if (typeof c[0] === "number") { if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0]; if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1]; } else c.forEach(walk); })(geom.coordinates || []);
    return [(w + e) / 2, (s + n) / 2];
  }
  var DF_PLACE_RE = /(name|place|village|town|city|district|ward|block|panchayat|taluk|tehsil|mandal|location|locality|area|region|state|constituency)/i;
  function deriveLocators(canon) {
    var schema = canon.schema, rows = canon.rows;
    if (canon.geoms && canon.geoms.length) {
      var pts = [], idx = canon.geomIdx;
      rows.forEach(function (r, i) { var gi = idx ? idx[i] : i; var g = (gi != null && gi >= 0) ? canon.geoms[gi] : null; if (g) { var c = dfCentroid(g); if (isFinite(c[0]) && isFinite(c[1])) pts.push(c); } });
      if (pts.length) return { points: pts.slice(0, 500) };
    }
    var num = schema.filter(function (c) { return c.type === "number"; });
    var latc = num.find(function (c) { return /lat/i.test(c.name); });
    var lngc = num.find(function (c) { return /(lon|lng)/i.test(c.name); });
    if (latc && lngc) {
      var p2 = [];
      rows.forEach(function (r) { var la = Number(r[latc.name]), ln = Number(r[lngc.name]); if (isFinite(la) && isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180) p2.push([ln, la]); });
      if (p2.length) return { points: p2.slice(0, 500) };
    }
    var strs = schema.filter(function (c) { return c.type === "string" && !c.ignored; });
    var cand = strs.find(function (c) { return DF_PLACE_RE.test(c.name); }) || strs[0];
    if (cand) {
      var seen = {}, names = [];
      rows.forEach(function (r) { var v = String(r[cand.name] == null ? "" : r[cand.name]).trim(); if (v && v.length <= 60 && !seen[v]) { seen[v] = 1; names.push(v); } });
      if (names.length) return { names: names.slice(0, 500), nameCol: cand.name };
    }
    return {};
  }

  function runDfInfer() {
    var canon = S.dataFirst.canonical;
    if (!canon) return;
    var loc = deriveLocators(canon);
    if (!loc.points && !loc.names) { dfmsg("Couldn't find locations in this file — it needs coordinates or a place-name column.", "err"); return; }
    S.dataFirst.locators = loc;
    dfmsg("Finding your region…", "ok");
    var body = {};
    if (S.dataFirst.iso3) body.iso3 = S.dataFirst.iso3;   // set only by the override select
    if (loc.points) body.points = loc.points; else body.names = loc.names;
    api("geo/infer", { method: "POST", body: body }).then(function (r) {
      if (!r.units || !r.units.length) { dfmsg("Couldn't match your data to admin areas there — pick the region manually with “Start from a place”.", "err"); return; }
      S.dataFirst.inf = r;
      S.dataFirst.iso3 = r.iso3;
      dfmsg("");
      // reveal the country as a pre-filled override, so a wrong detection is one click away
      populateDfCountries().then(function () {
        $("#df-country").value = r.iso3;
        $("#df-country-label").innerHTML = 'Country <span class="hint">(detected from your data — change if it looks wrong)</span>';
        $("#df-country-wrap").hidden = false;
        renderDfResult(r, loc);
      });
    }).catch(function (e) {
      if (e && e.needsCountry) {
        // names-only tables (or unmatched coordinates) can't tell us the country
        populateDfCountries().then(function () {
          $("#df-country-label").textContent = "Country";
          $("#df-country-wrap").hidden = false;
          dfmsg("We couldn't tell the country from this file — choose it above and we'll take it from there.", "err");
        });
      } else dfmsg(errMsg(e), "err");
    });
  }

  function renderDfResult(r, loc) {
    $("#df-result").hidden = false;
    var noun = LEVEL_NOUN[r.level] || "areas";
    var names = r.units.map(function (u) { return u.name; });
    var head = names.length === 1
      ? "<b>" + esc(names[0]) + "</b> (" + noun.replace(/s$/, "") + ")"
      : "<b>" + names.length + "</b> " + noun + " (" + esc(names.slice(0, 3).join(", ")) + (names.length > 3 ? " +" + (names.length - 3) : "") + ")";
    var pct = Math.round(r.coverage * 100);
    var detail = loc.points ? (pct + "% of " + loc.points.length + " points inside") : (pct + "% of " + loc.names.length + " names matched");
    $("#df-line").innerHTML = "📍 Your data is in " + head + ", " + esc(countryNameOf(r.iso3)) + " — " + detail + ".";
    drawDfMap(r);
  }

  function drawDfMap(r) {
    var fc = { type: "FeatureCollection", features: r.units.filter(function (u) { return u.geometry; }).map(function (u) { return { type: "Feature", properties: { name: u.name }, geometry: u.geometry }; }) };
    function apply() { var src = dfMap.getSource("inf"); if (src) src.setData(fc); if (r.bbox) dfMap.fitBounds([[r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[3]]], { padding: 28, duration: 0 }); }
    if (!dfMap) {
      dfMap = new maplibregl.Map({ container: "df-map", style: { version: 8, sources: { carto: { type: "raster", tiles: ["https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"], tileSize: 256 } }, layers: [{ id: "carto", type: "raster", source: "carto" }] }, center: [20, 10], zoom: 1, attributionControl: false });
      dfMap.on("load", function () {
        dfReady = true;
        dfMap.addSource("inf", { type: "geojson", data: fc });
        dfMap.addLayer({ id: "inf-fill", type: "fill", source: "inf", paint: { "fill-color": "#4A5A33", "fill-opacity": 0.25 } });
        dfMap.addLayer({ id: "inf-line", type: "line", source: "inf", paint: { "line-color": "#4A5A33", "line-width": 1.5 } });
        apply();
      });
    } else if (dfReady) { apply(); }
  }

  /* Put a resolved region ({iso3, level, units, parents, bbox}) into wizard state:
     units become the selection, and a synthetic crumb of their parents keeps the
     geography step scoped to the relevant slice (loadUnits passes crumb ids as
     the geo/admin parents filter). Shared by data-first inference and by editing
     an existing atlas, so both show a real, editable selection. */
  function applyRegionUnits(r) {
    S.geo.iso3 = r.iso3; S.geo.viewLevel = r.level; S.geo.level = r.level; S.geo.selected = {};
    (r.units || []).forEach(function (u) { S.geo.selected[u.id] = { name: u.name, bbox: u.bbox }; });
    S.geo.features = (r.units || []).map(function (u) { return { properties: { id: u.id, name: u.name }, geometry: u.geometry, bbox: u.bbox }; });
    var parents = r.parents || [];
    S.geo.crumbs = (r.level > 1 && parents.length) ? [{
      id: parents.map(function (p) { return p.id; }).join(","),
      name: parents.map(function (p) { return p.name; }).join(" + "),
      level: r.level - 1,
      bbox: r.bbox,
    }] : [];
  }

  function dfUseRegion() {
    var r = S.dataFirst.inf; if (!r) return;
    applyRegionUnits(r);
    var eff = effectiveRegion(), state = eff ? regionSizeState(eff) : "free";
    if (state === "blocked") { dfmsg("That data covers too large an area for one atlas — trim the file, or pick a smaller region via “Start from a place”.", "err"); return; }
    // this upload becomes the atlas's first data layer after the build
    addUserFile(S.dataFirst.filename || "data", S.dataFirst.canonical);
    S._dfGeoApplied = false;      // the geography step shows this selection on first entry
    var t = $("#f-title");
    if (!t.value.trim() && S.dataFirst.filename) {
      t.value = S.dataFirst.filename.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, function (c) { return c.toUpperCase(); }).slice(0, 80);
      if (!$("#f-slug").value.trim()) $("#f-slug").value = slugify(t.value);
    }
    renderMyAtlases();
    show(1);
  }

  // First entry to the geography step when the region came from somewhere other
  // than the drill picker (data-first inference, or editing an existing atlas):
  // reflect it in the country select, level hint, list and map.
  function maybeApplyDfGeo() {
    if (S._dfGeoApplied || !S.geo.iso3) return;
    var haveUnits = Object.keys(S.geo.selected || {}).length > 0;
    if (!haveUnits) return;   // nothing preselected — the drill picker owns this step
    S._dfGeoApplied = true;
    var iso3 = S.geo.iso3;
    initCountries().then(function () { $("#f-country").value = iso3; });
    api("geo/levels?iso3=" + iso3).then(function (r2) {
      S.geo.levels = r2.levels || [1];
      $("#level-hint").textContent = maxLevel() > 1
        ? "Boundary data goes down to " + (LEVEL_NOUN[maxLevel()] || "smaller areas") + " here."
        : "This country has one boundary level available.";
      loadUnits();
    }).catch(function () { loadUnits(); });
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
    msg(1, "");
    if (!$("#f-title").value.trim()) return msg(1, "Give your atlas a title first.");
    var slug = $("#f-slug").value.trim();
    if (!slug) { $("#f-slug").value = slugify($("#f-title").value); }
    show(2);
    initCountries();
    maybeApplyDfGeo();   // data-first: surface the inferred region for confirmation
  };

  /* ================= step 2: geography (drill-down) ================= */

  var geoMap, geoMapReady = false, hoverId = null;
  var LIMITS = { freeAreaDeg2: 6, hardAreaDeg2: 40 };
  api("config").then(function (c) { LIMITS = c; }).catch(function () {});

  var LEVEL_NOUN = { 1: "states / provinces", 2: "districts", 3: "sub-districts", 4: "localities" };

  var wizCountriesReady = null;
  function initCountries() {
    var sel = $("#f-country");
    if (!wizCountriesReady) {
      wizCountriesReady = fetch("./countries.json").then(function (r) { return r.json(); }).then(function (list) {
        list.forEach(function (c) {
          var o = document.createElement("option");
          o.value = c.iso3; o.textContent = c.name;
          sel.appendChild(o);
        });
      }).catch(function () {});
    }
    initGeoMap();
    return wizCountriesReady;
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
      // units loaded before the map finished (e.g. a data-first preselection):
      // push them now, restore selection states, and frame the region
      if (S.geo.features.length) {
        geoMap.getSource("units").setData({ type: "FeatureCollection", features: S.geo.features.map(function (f) {
          return { type: "Feature", id: f.properties.id, properties: f.properties, geometry: f.geometry };
        }) });
        S.geo.features.forEach(function (f) {
          geoMap.setFeatureState({ source: "units", id: f.properties.id }, { sel: !!S.geo.selected[f.properties.id] });
        });
        syncMapPaint();
        var fit = unionBbox(S.geo.features);
        if (fit) geoMap.fitBounds([[fit[0], fit[1]], [fit[2], fit[3]]], { padding: 30, duration: 0 });
      }
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
    S.regionKept = false; // editing: navigating in = building a new region
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
    S.regionKept = false; // editing: composing a subset = a new region
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
    if (S.editMode) S.regionKept = false; // editing: changing country = new region
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
    if (S.editMode && S.regionKept) {
      // editing and the region was left untouched → keep it, straight to layers
      show(3); loadCatalog(); return;
    }
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
        // start lean: only Admin boundaries + Place names — the user adds the
        // rest deliberately rather than deselecting a wall of pre-checked layers
        r.layers.forEach(function (l) { if (l.required || l.default) S.catalog.chosen[l.id] = true; });
      }
      $("#tier-note").textContent = (r.tier === "india"
        ? "India tier — the full catalogue, including LGD blocks and WRIS water layers."
        : "Global tier — boundaries, OSM waterways and ESA WorldCover land cover.")
        + " We start with just the admin boundaries and place names — add any layers you want on top. After it's built you can also add your own data.";
      renderCatalog();
      renderOwnDataCard();
    }).catch(function (e) { msg(3, esc(errMsg(e))); });
  }

  /* the your-data card on the Layers step: shows what is attached, attaches a
     file when nothing is, and points at the data bench once the atlas exists */
  function renderOwnDataCard() {
    var box = $("#own-data-note");
    if (!box) return;
    box.classList.add("own-data");          // base card styling (modifiers below)
    box.classList.remove("clickable", "attached");
    box.hidden = false;
    box.onclick = null;
    if (S.editMode) {
      // an existing atlas: say what's already on it, then offer one clear action
      var existing = S.editLayers;
      var benchHref = "../layers.html?dataset=" + encodeURIComponent(S.editSlug);
      var head, body;
      if (existing === null) {
        head = "Your own data"; body = '<span class="hint">Checking what\'s already on this atlas…</span>';
      } else if (existing.length) {
        head = "Your own data · " + existing.length + (existing.length === 1 ? " layer" : " layers");
        body = '<div class="od-files">' + existing.map(function (l) {
          var by = l.addedBy && (l.addedBy.org || l.addedBy.name);
          return '<div class="od-file"><span class="odf-name">' + esc(l.label || l.id) + "</span>" +
            (by ? '<span class="odf-rows">added by ' + esc(by) + "</span>" : "") + "</div>";
        }).join("") + "</div>" +
          '<span class="hint">Already on the map. Add more files, restyle or remove them in the data bench.</span>';
      } else {
        head = "Your own data";
        body = '<span class="hint">No data of your own yet — add survey results, a facility list, tagged photos or shapes (CSV, Excel, JSON, GeoJSON, KML, GPX) as new map layers.</span>';
      }
      box.innerHTML = '<span class="od-ico" aria-hidden="true">📄</span><div class="od-body"><b>' + head + "</b>" + body +
        '<a class="btn secondary od-btn" href="' + benchHref + '">' +
        (existing && existing.length ? "Manage data layers →" : "Add your own data →") + "</a></div>";
      return;
    }
    var list = userFiles();
    var lost = S._lostFiles || [];
    if (list.length) {
      box.classList.add("attached");
      var rows = list.map(function (f, i) {
        return '<div class="od-file"><span class="odf-name">' + esc(f.filename || "data") + "</span>" +
          '<span class="odf-rows">' + f.canonical.rows.length.toLocaleString() + " rows</span>" +
          '<button type="button" class="odf-x" data-i="' + i + '" title="Remove this file" aria-label="Remove ' + esc(f.filename) + '">✕</button></div>';
      }).join("");
      box.innerHTML = '<span class="od-ico" aria-hidden="true">📄</span><div class="od-body"><b>Your data · ' +
        list.length + (list.length === 1 ? " file" : " files") + "</b>" +
        '<div class="od-files">' + rows + "</div>" +
        '<span class="hint">Each file becomes its own map layer right after the build — we pick colours, icons and popup fields from your columns and show you exactly what we did. Pick any extra open-data layers below.</span>' +
        (lost.length ? '<span class="hint" style="color:var(--color-rust-deep)">' + esc(lost.join(", ")) +
          " couldn't ride along with the saved draft — attach again if you still want it.</span>" : "") +
        '<button type="button" class="od-act" id="od-more">＋ Add another file</button></div>';
      box.querySelectorAll(".odf-x").forEach(function (b) {
        b.onclick = function (e) { e.stopPropagation(); removeUserFile(Number(b.dataset.i)); };
      });
      var more = $("#od-more");
      if (more) more.onclick = function (e) { e.stopPropagation(); $("#od-file").click(); };
      return;
    }
    box.classList.add("clickable");
    box.innerHTML = '<span class="od-ico" aria-hidden="true">＋</span><div class="od-body"><b>Add your own data</b>' +
      '<span class="hint">Attach one or more files — CSV, Excel, GeoJSON, KML or GPX. Each becomes its own map layer after the build, styled from your columns, and you can add more any time from the data bench.</span>' +
      (lost.length ? '<span class="hint" style="color:var(--color-rust-deep)">' + esc(lost.join(", ")) +
        " couldn't ride along with the saved draft — attach again if you still want it.</span>" : "") + "</div>";
    box.onclick = function () { $("#od-file").click(); };
  }

  (function wireOwnDataFile() {
    var input = $("#od-file");
    if (!input) return;
    input.addEventListener("change", function () {
      var files = Array.prototype.slice.call(this.files || []);
      this.value = "";
      if (!files.length) return;
      var done = 0, failed = [];
      msg(3, "Reading " + files.length + (files.length === 1 ? " file" : " files") + "…", "ok");
      files.forEach(function (file) {
        LokaIngest.fromFile(file, function (err, out) {
          function finish(errText) {
            if (errText) failed.push((file.name || "file") + " — " + errText);
            if (++done < files.length) return;
            renderOwnDataCard();
            msg(3, failed.length ? failed.map(esc).join("<br>") : "");
          }
          if (err) return finish(errMsg(err));
          resolveCanonical(out, function (e, canonical) {
            if (e) return finish(errMsg(e));
            S.dataFirst = S.dataFirst || { iso3: "", inf: null, locators: null };
            if (!S.dataFirst.iso3) S.dataFirst.iso3 = S.geo.iso3;
            addUserFile(file.name || "data", canonical);
            finish(null);
          });
        });
      });
    });
  })();

  var GROUP_LABELS = { base: "Base", context: "Terrain, climate & access", people: "People & services", eco: "Ecological landscape", agri: "Crops & value chain" };

  function catRow(l) {
    var row = document.createElement("label");
    row.className = "cat-row";
    // Clicking a label focuses its checkbox, and the browser scrolls a
    // partially-off-screen checkbox into view — which jumps the whole page when
    // toggling layers low on the list (e.g. Ecological landscape). Pre-focus the
    // checkbox without scrolling so the browser's own focus-on-press is a no-op;
    // the click still toggles it, and keyboard/tab focus is unaffected.
    row.addEventListener("pointerdown", function () {
      try { cb.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
    });
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

  $("#back-3").onclick = function () { show(2); initCountries(); maybeApplyDfGeo(); };
  $("#next-3").onclick = function () {
    msg(3, "");
    var chosen = Object.keys(S.catalog.chosen);
    if (!chosen.length) return msg(3, "Pick at least one layer.");
    // navigating back to tweak region/layers must update THIS atlas, not mint a
    // twin — once an instance exists in this session, further builds are rebuilds
    if (!S.editMode && S.build && S.build.slug && S.build.editToken) { rebuildCurrent(); return; }
    createInstance();
  };

  function rebuildCurrent() {
    show(4);
    var ds = $("#data-summary"); if (ds) { ds.hidden = true; ds.innerHTML = ""; }
    $("#build-title").textContent = "Rebuilding your atlas…";
    $("#prog-fill").style.width = "3%";
    $("#prog-msg").textContent = "Applying your changes…";
    $("#preview-wrap").hidden = true;
    $("#next-4").hidden = false;
    $("#next-4").disabled = true;
    $("#back-4").hidden = true;
    msg(4, "");
    var eff = effectiveRegion();
    var body = { layers: Object.keys(S.catalog.chosen) };
    if (eff) body.region = { iso3: S.geo.iso3, level: eff.level, shapeIDs: eff.units.map(function (u) { return u.id; }) };
    api("instances/" + S.build.slug + "/rebuild", { method: "POST", headers: authHeaders(), body: body }).then(function (r) {
      S.build.jobId = r.jobId;
      pollJob(r.jobId);
    }).catch(function (e) {
      show(3);
      msg(3, esc(errMsg(e)));
    });
  }

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

  // edit "Save & exit" with a region/layer change: rebuild with progress, then
  // open the atlas (the published dataset swaps atomically on success)
  function rebuildAndOpen(viewKey) {
    S._pendingViewKey = viewKey;
    show(4);
    $("#build-title").textContent = "Saving your changes…";
    $("#prog-fill").style.width = "3%";
    $("#prog-msg").textContent = "Rebuilding the atlas with your changes…";
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
      pollJob(r.jobId);
    }).catch(function (e) {
      // rebuild refused (e.g. now needs approval) — the metadata edit already saved
      show(3);
      msg(3, esc(errMsg(e)) + " Your other changes were saved.");
      ["#save-exit-1", "#save-exit-2", "#save-exit-3"].forEach(function (b) { if ($(b)) $(b).disabled = false; });
    });
  }

  function createInstance() {
    show(4);
    var ds = $("#data-summary"); if (ds) { ds.hidden = true; ds.innerHTML = ""; }
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
      if (e.needsEmail) { show(1); msg(1, esc(errMsg(e))); return; }   // the server says WHY approval is needed
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

  // `v` busts any cached manifest/geojson from an earlier load of this slug —
  // the preview must always show the layers that exist right now.
  function previewUrl() {
    var u = "../?dataset=" + encodeURIComponent(S.build.slug);
    if (S.build.viewKey) u += "&key=" + encodeURIComponent(S.build.viewKey);
    return u + "&v=" + Date.now();
  }
  function loadPreview() {
    $("#preview-wrap").hidden = false;
    $("#preview-frame").src = previewUrl();
  }

  var CHECK_SVG = '<svg class="done-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  function onBuilt() {
    $("#prog-fill").style.width = "100%";
    $("#prog-bar").classList.remove("working");
    $("#prog-layer").hidden = true;

    // full-wizard edit (Save & exit with a rebuild): changes are live — open the atlas
    if (S.editMode === "full") {
      loadPreview();
      $("#build-title").innerHTML = CHECK_SVG + "Saved — opening your atlas…";
      $("#prog-msg").textContent = "Your changes are live.";
      leaveToAtlas(S._pendingViewKey);
      return;
    }

    $("#build-title").innerHTML = CHECK_SVG + "Your atlas is ready";
    $("#next-4").hidden = false;
    $("#back-4").hidden = false;

    var pending = userFiles();
    var lost = S._lostFiles || [];
    if (pending.length) {
      // The dataset folder exists now, so the uploads can be committed. Hold the
      // preview until they are: loading it first and reloading afterwards raced
      // the commit, and a preview that lost the race showed an atlas with no
      // data layer — exactly the "no tag markers" report.
      $("#next-4").disabled = true;   // publish once the data is really in
      $("#prog-msg").textContent = pending.length === 1
        ? "Adding your data as a map layer…"
        : "Adding your " + pending.length + " data files as map layers…";
      autoAddData();
    } else {
      loadPreview();
      $("#prog-msg").textContent = "Built. Explore the preview below, then publish.";
      $("#next-4").disabled = false;
      if (lost.length) {
        msg(4, esc(lost.join(", ")) + " couldn't ride along with the resumed draft — add it from the " +
          '<a href="../layers.html?dataset=' + encodeURIComponent(S.build.slug) + '">data bench</a>.', "ok");
      }
    }
  }

  // Commit each attached file as its own layer (ingest → commit, sequentially so
  // layer ids and manifest writes can't interleave), then load the preview once
  // and report exactly how each layer was styled. A failure is non-fatal: the
  // atlas is built either way, and we point at the data bench.
  function autoAddData() {
    if (!S.build || !S.build.slug) return;
    var H = authHeaders(), added = [], failed = [];
    var queue = userFiles().slice();

    function bodyFor(item) {
      var canon = item.canonical;
      var cols = canon.schema.filter(function (c) { return !c.ignored; });
      var names = cols.map(function (c) { return c.name; });
      var body = {
        dataset: S.build.slug, filename: item.filename || "data",
        schema: cols.map(function (c) { return { name: c.name, type: c.type }; }),
        rows: canon.rows.map(function (r) { var o = {}; names.forEach(function (n) { o[n] = r[n]; }); return o; }),
        meta: canon.meta,
      };
      if (canon.geoms && canon.geoms.length) { body.geoms = canon.geoms; body.geomIdx = canon.geomIdx; }
      return body;
    }

    function step(i) {
      if (i >= queue.length) return finish();
      var item = queue[i];
      if (queue.length > 1) $("#prog-msg").textContent = "Adding " + (item.filename || "your data") + " (" + (i + 1) + " of " + queue.length + ")…";
      var ing = null;
      api("layers/ingest", { method: "POST", headers: H, body: bodyFor(item) })
        .then(function (r) {
          ing = r;
          return api("layers/commit", { method: "POST", headers: H, body: { importId: r.importId } });
        })
        .then(function (c) {
          added.push({ filename: item.filename, layerId: c.layerId, stanza: ing.fragment || {}, stats: ing.stats || {} });
          step(i + 1);
        })
        .catch(function (e) { failed.push({ filename: item.filename, error: errMsg(e) }); step(i + 1); });
    }

    function finish() {
      // committed files leave the queue; anything that failed stays attachable
      S.userFiles = queue.filter(function (q) {
        return failed.some(function (f) { return f.filename === q.filename; });
      });
      cacheDataFirstDraft();
      loadPreview();   // first and only load — the layers are on disk by now
      $("#next-4").disabled = false;
      $("#prog-msg").textContent = added.length
        ? (added.length === 1 ? "Built, with your data on the map." : "Built, with your " + added.length + " data layers on the map.")
        : "Built. Explore the preview below, then publish.";
      renderDataSummary(added);
      if (failed.length) {
        msg(4, failed.map(function (f) { return esc(f.filename) + " — " + esc(f.error); }).join("<br>") +
          '<br>Add it by hand from the <a href="../layers.html?dataset=' + encodeURIComponent(S.build.slug) + '">data bench</a>.');
      }
    }

    step(0);
  }

  /* "How is my data shown?" — read the committed layer stanza back and say, in
     plain language, what the map does with it. Everything here comes from the
     stanza the server actually produced, not from a guess. */
  function renderDataSummary(added) {
    var box = $("#data-summary");
    if (!box) return;
    if (!added || !added.length) { box.hidden = true; box.innerHTML = ""; return; }
    var KIND_TEXT = {
      marker: "pins at each point", circle: "dots at each point", categories: "coloured areas",
      fill: "shaded areas", line: "lines", choropleth: "areas shaded by value", raster: "an image overlay",
    };
    var html = "<h3>How your data is shown</h3>";
    added.forEach(function (a) {
      var L = a.stanza || {}, facts = [];
      var n = (a.stats && a.stats.features) || 0;
      facts.push("<b>" + n.toLocaleString() + "</b> " + (n === 1 ? "feature" : "features") +
        " drawn as " + (KIND_TEXT[L.type] || L.type || "map features"));
      var legend = L.legend || [];
      if (L.markerBy && legend.length) {
        facts.push("coloured by <b>" + esc(L.markerBy === "_category" ? "category" : L.markerBy) + "</b> — " +
          legend.length + " values, each with its own colour" + (L.categoryIcons ? " and icon" : "") + ", listed in the map legend");
      } else if (legend.length) {
        facts.push("legend with " + legend.length + " " + (legend.length === 1 ? "entry" : "entries"));
      }
      var popup = L.popup || {};
      if (popup.title || (popup.fields || []).length) {
        var fieldNames = (popup.fields || []).map(function (f) { return f.label || f.property; });
        facts.push("click a feature for a popup titled by <b>" + esc(popup.title || "your title column") + "</b>" +
          (fieldNames.length ? ", showing " + esc(fieldNames.slice(0, 6).join(", ")) : ""));
        if ((popup.fields || []).some(function (f) { return f.type === "image"; })) facts.push("images in the popup where your rows have image links");
        if ((popup.fields || []).some(function (f) { return f.type === "tags"; })) facts.push("tags shown as chips, and searchable from the map's search box");
      }
      html += '<div class="ds-layer"><b>' + esc(a.filename || a.layerId) + "</b> → layer “" + esc(L.label || a.layerId) + "”" +
        '<ul class="ds-facts">' + facts.map(function (f) { return "<li>" + f + "</li>"; }).join("") + "</ul>";
      if (legend.length) {
        html += '<div class="ds-swatches">' + legend.slice(0, 12).map(function (x) {
          return '<span class="ds-chip"><span class="ds-dot" style="background:' + esc(x.color || "#999") + '"></span>' + esc(x.label) + "</span>";
        }).join("") + "</div>";
      }
      html += "</div>";
    });
    html += '<p class="hint" style="margin:.6rem 0 0">Want it styled differently? Open the ' +
      '<a href="../layers.html?dataset=' + encodeURIComponent(S.build.slug) + '">data bench</a> — you can restyle, rename or remove any layer there.</p>';
    box.innerHTML = '<div class="ds-card">' + html + "</div>";
    box.hidden = false;
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
        S._published = true;   // step 5 becomes a stepper destination
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

    // the link is the deliverable — it leads, everything else follows
    var hero = document.createElement("div");
    hero.className = "pub-hero";
    hero.innerHTML = '<a class="btn" target="_blank" rel="noopener" href="' + esc(prettyUrl()) + '">Open your atlas →</a>' +
      '<span class="pub-url">' + esc(prettyUrl()) + "</span>";
    body.appendChild(hero);

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
    $("#auth-step-profile").hidden = true;
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

  // OTP flow: we email a 6-digit code, the user types it right here — no link,
  // no tab-switching, and the session lands on this tab directly.
  function requestCode(email) {
    api("auth/request-link", { method: "POST", body: { email: email } })
      .then(function (r) {
        $("#auth-step-email").hidden = true;
        $("#auth-step-wait").hidden = false;
        $("#auth-sent-to").textContent = email;
        $("#auth-code").value = "";
        setTimeout(function () { $("#auth-code").focus(); }, 60);
        $("#auth-msg").innerHTML = r.sent ? "" :
          '<div class="msg err">This server can’t send email yet, so no code reached your inbox. ' +
          'Ask the LOKA team (mithun@socratus.org) for your code, or try again once email is set up.</div>';
      })
      .catch(function (e) { $("#auth-msg").innerHTML = '<div class="msg err">' + esc(errMsg(e)) + "</div>"; });
  }

  $("#auth-send").onclick = function () {
    var email = $("#auth-email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      $("#auth-msg").innerHTML = '<div class="msg err">Enter a valid email.</div>'; return;
    }
    saveLocal(); // capture the in-progress atlas before signing in
    requestCode(email);
  };
  $("#auth-resend").onclick = function (ev) {
    ev.preventDefault();
    requestCode($("#auth-email").value.trim());
  };

  function finishSignIn(me) {
    S.session = me;
    showSignedIn(me);
    renderMyAtlases();
    endAuth(true);
  }

  function submitCode() {
    var email = $("#auth-email").value.trim();
    var code = $("#auth-code").value.trim();
    if (!/^\d{6}$/.test(code)) {
      $("#auth-msg").innerHTML = '<div class="msg err">Enter the 6-digit code from the email.</div>'; return;
    }
    $("#auth-verify").disabled = true;
    api("auth/verify-code", { method: "POST", body: { email: email, code: code } })
      .then(function () { return api("auth/me"); })
      .then(function (me) {
        $("#auth-verify").disabled = false;
        $("#auth-msg").innerHTML = "";
        // first sign-in: capture who they are, so contributed layers carry a credit
        if (!me.name || !me.org) {
          S._pendingMe = me;
          $("#auth-step-wait").hidden = true;
          $("#auth-step-profile").hidden = false;
          setTimeout(function () { $("#auth-name").focus(); }, 60);
          return;
        }
        finishSignIn(me);
      })
      .catch(function (e) {
        $("#auth-verify").disabled = false;
        $("#auth-msg").innerHTML = '<div class="msg err">' + esc(errMsg(e)) + "</div>";
      });
  }
  $("#auth-verify").onclick = submitCode;
  $("#auth-code").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); submitCode(); }
  });

  $("#auth-profile-save").onclick = function () {
    var name = $("#auth-name").value.trim();
    var org = $("#auth-org").value.trim();
    if (!name || !org) {
      $("#auth-msg").innerHTML = '<div class="msg err">Both your name and organisation are needed.</div>'; return;
    }
    $("#auth-profile-save").disabled = true;
    api("auth/profile", { method: "POST", body: { name: name, org: org } })
      .then(function () {
        $("#auth-profile-save").disabled = false;
        $("#auth-step-profile").hidden = true;
        var me = S._pendingMe || {};
        me.name = name; me.org = org;
        finishSignIn(me);
      })
      .catch(function (e) {
        $("#auth-profile-save").disabled = false;
        $("#auth-msg").innerHTML = '<div class="msg err">' + esc(errMsg(e)) + "</div>";
      });
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

  /* ---- custom data queue: every attached file becomes its own map layer ----
     Files live in S.userFiles = [{filename, canonical}]. The data-first entry
     seeds the first one (it also drives region inference); the Layers-step card
     adds more. They commit in order after the build. */
  function userFiles() { return (S.userFiles = S.userFiles || []); }
  function userFileRows() { return userFiles().reduce(function (n, f) { return n + f.canonical.rows.length; }, 0); }
  function addUserFile(filename, canonical) {
    var list = userFiles();
    var dup = list.findIndex(function (f) { return f.filename === filename; });
    if (dup >= 0) list[dup] = { filename: filename, canonical: canonical };   // re-drop replaces
    else list.push({ filename: filename, canonical: canonical });
    cacheDataFirstDraft();
  }
  function removeUserFile(i) { userFiles().splice(i, 1); cacheDataFirstDraft(); renderOwnDataCard(); }

  // The attached data must survive a reload: without it a resumed data-first
  // session builds an atlas with no data layer (and no markers). Cached once
  // per attach — serializing thousands of rows on every step change would jank —
  // and size-capped so drafts stay within localStorage / server-draft limits.
  var DF_DRAFT_MAX = 700000;   // bytes of JSON, roughly
  function cacheDataFirstDraft() {
    S._dfDraft = null;
    var list = userFiles();
    if (!list.length) return;
    try {
      var inf = S.dataFirst && S.dataFirst.inf ? {
        iso3: S.dataFirst.inf.iso3, mode: S.dataFirst.inf.mode, level: S.dataFirst.inf.level,
        coverage: S.dataFirst.inf.coverage, bbox: S.dataFirst.inf.bbox,
        units: (S.dataFirst.inf.units || []).map(function (u) { return { id: u.id, name: u.name, bbox: u.bbox }; }),
        parents: S.dataFirst.inf.parents || [],
      } : null;
      var base = { iso3: (S.dataFirst && S.dataFirst.iso3) || "", inf: inf };
      // keep as many whole files as fit; anything dropped is reported, never silent
      var kept = [], dropped = [], budget = DF_DRAFT_MAX;
      list.forEach(function (f) {
        var size = JSON.stringify(f).length;
        if (size <= budget) { kept.push(f); budget -= size; } else dropped.push(f.filename);
      });
      S._dfDraft = { files: kept, droppedNames: dropped, iso3: base.iso3, inf: base.inf };
    } catch (e) { S._dfDraft = null; }
  }

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
        // name + bbox ride along so a resume can restore the region SYNCHRONOUSLY —
        // effectiveRegion() must be correct even if the user builds immediately
        selected: Object.keys(S.geo.selected).map(function (id) {
          return { id: id, name: S.geo.selected[id].name, bbox: S.geo.selected[id].bbox };
        }),
        crumbs: S.geo.crumbs,
      },
      chosen: Object.keys(S.catalog.chosen),
      dataFirst: S._dfDraft || null,
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
    // the attached uploads ride in the draft — restoring them is what keeps the
    // add-as-layers promise across a reload
    if (st.dataFirst) {
      S.dataFirst = { canonical: null, file: null, filename: "", iso3: st.dataFirst.iso3 || "",
        inf: st.dataFirst.inf || null, locators: null };
      S.userFiles = (st.dataFirst.files || []).filter(function (f) { return f && f.canonical; });
      if (S.userFiles.length) {
        S.dataFirst.canonical = S.userFiles[0].canonical;
        S.dataFirst.filename = S.userFiles[0].filename;
      }
      S._lostFiles = st.dataFirst.droppedNames || [];   // too large to stash — needs re-attaching
      S._dfGeoApplied = true;   // the saved geo state below already reflects it
      cacheDataFirstDraft();
    }
    if (st.geo && st.geo.iso3) {
      S.geo.iso3 = st.geo.iso3;
      initCountries().then(function () { $("#f-country").value = S.geo.iso3; });
      resetGeo();
      S.geo.crumbs = st.geo.crumbs || [];
      S.geo.viewLevel = st.geo.level || 1;
      // restore the selection SYNCHRONOUSLY — the region must be right even if
      // the user hits "Build" before the boundary list finishes loading.
      // (Older drafts stored bare id strings; those still restore via toggleUnit.)
      var legacyIds = [];
      (st.geo.selected || []).forEach(function (s) {
        if (s && s.id) S.geo.selected[s.id] = { name: s.name, bbox: s.bbox };
        else if (typeof s === "string") legacyIds.push(s);
      });
      api("geo/levels?iso3=" + S.geo.iso3).then(function (r) { S.geo.levels = r.levels || [1]; })
        .catch(function () {})
        .then(function () {
          loadUnits();   // paints the restored selection once the list arrives
          if (!legacyIds.length) return;
          var tries = 0;
          var restore = setInterval(function () {
            tries++;
            if (S.geo.features.length) {
              clearInterval(restore);
              legacyIds.forEach(function (id) { if (!S.geo.selected[id]) toggleUnit(id); });
            } else if (tries > 40) {   // ~16s — say so instead of sticking forever
              clearInterval(restore);
              msg(2, "Couldn't reload the boundaries — check your connection, or pick the region again.");
            }
          }, 400);
        });
    }
    (st.chosen || []).forEach(function (id) { S.catalog.chosen[id] = true; });
    S.mode = "wizard";
    renderMyAtlases();
    var stepTo = Math.min(st.step || 1, 3);
    show(stepTo);
    // landing on Layers needs its content — the catalog (and the your-data card)
    // never rendered in this fresh page
    if (stepTo === 3 && S.geo.iso3) loadCatalog();
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
    sec.hidden = S.mode !== "home"; // dashboard only on the landing view
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
        esc(i.regionLabel || "") + "</span></div>" +
        (i.role === "editor" ? '<span class="mine-badge shared">Shared with you</span>' : "") +
        '<span class="mine-badge ' + (i.status === "published" ? "" : "draft") + '">' + esc(label) + "</span>";
      var actions = document.createElement("div");
      actions.className = "mine-actions";
      if (i.status === "published" && i.visibility !== "private") {
        var open = document.createElement("a");
        open.href = "../a/" + encodeURIComponent(i.slug);
        open.target = "_blank"; open.rel = "noopener"; open.textContent = "Open";
        actions.appendChild(open);
      }
      var busy = i.status === "building" || i.status === "pending-approval";
      var edit = document.createElement("button"); edit.textContent = "Edit atlas";
      edit.disabled = busy; edit.onclick = function () { editAtlas(i.slug); };
      actions.appendChild(edit);
      if (!busy && (i.status === "published" || i.status === "built")) {
        var addData = document.createElement("a");
        addData.href = "../layers.html?dataset=" + encodeURIComponent(i.slug);
        addData.textContent = "Add data";
        addData.title = "Add your own data as a map layer (CSV, Excel, JSON, GeoJSON, KML, GPX) — experimental, under development";
        actions.appendChild(addData);
      }
      if (i.role !== "editor") { // only the owner can delete
        var del = document.createElement("button"); del.className = "danger"; del.textContent = "Delete";
        del.onclick = function () { deleteAtlas(i.slug, i.title); };
        actions.appendChild(del);
      }
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
    $("#f-email").value = inst.email || "";
    $("#f-footer").value = bnd.footerLine || "";
    S.logoData = null; S.removeLogo = false;
    var lh = $("#logo-hint");
    lh.className = "hint";
    lh.textContent = bnd.hasLogo ? "current logo kept — choose a file to replace it" : "";
    setVisibility(inst.visibility || "public");
    $("#f-slug").disabled = true; // the slug is the atlas URL — fixed after creation
  }

  // One edit flow: the full wizard, prefilled. Step 1 (identity) → step 2
  // (region, kept by default) → step 3 (layers). "Save & exit" on any step
  // persists metadata, rebuilds if the region/layers changed, then opens the atlas.
  function editAtlas(slug) {
    api("instances/" + slug).then(function (inst) {
      if (!inst.canEdit) { alert("You can't edit this atlas."); return; }
      S.editSlug = slug; S.editMode = "full"; S.editInst = inst; S.mode = "wizard";
      S.regionKept = true;
      S.editRole = inst.role || "owner";
      S._origLayers = (inst.layers || []).slice().sort().join(",");

      fillDetails(inst);
      // collaborators: only the owner can see and manage the panel
      if (S.editRole === "owner") {
        $("#collab-panel").hidden = false;
        renderCollaborators(inst.collaborators || []);
      }
      // region: carry the current one; the country is preset so the catalogue
      // (step 3) resolves, and drilling/tapping later flips regionKept off
      S.geo = { iso3: inst.region.iso3, levels: [1], crumbs: [], viewLevel: inst.region.level || 1, features: [], selected: {} };
      S.catalog = { tier: "", layers: [], chosen: {} };
      (inst.layers || []).forEach(function (id) { S.catalog.chosen[id] = true; });
      S.userFiles = []; S._lostFiles = []; S._dfDraft = null; S.dataFirst = null;
      S._dfGeoApplied = false;

      initCountries().then(function () { $("#f-country").value = inst.region.iso3; });

      // resolve the saved shapeIDs into real units so step 2 shows the region
      // selected and framed, not just described in a banner
      var reg0 = inst.region || {};
      if (reg0.iso3 && (reg0.shapeIDs || []).length) {
        api("geo/resolve", { method: "POST", body: { iso3: reg0.iso3, level: reg0.level || 1, shapeIDs: reg0.shapeIDs } })
          .then(function (r) {
            if (S.editSlug !== slug) return;      // user navigated away meanwhile
            applyRegionUnits(r);
            S.regionKept = true;                  // showing it isn't changing it
            S._dfGeoApplied = false;
            if (S.step === 2) maybeApplyDfGeo();  // already looking at it → paint now
          }).catch(function () { /* banner still tells them the current region */ });
      }

      // contributed data layers already on this atlas (manifest.local overlay)
      S.editLayers = null;
      api("layers/list?dataset=" + encodeURIComponent(slug)).then(function (r) {
        S.editLayers = r.layers || [];
        if (S.step === 3) renderOwnDataCard();
      }).catch(function () { S.editLayers = []; });

      var eb = $("#edit-banner"); eb.hidden = false;
      eb.innerHTML = "Editing <b>" + esc(inst.title) + "</b> — walk through each step and " +
        "<b>Save &amp; exit</b> whenever you're done. " + '<a href="#" id="edit-cancel">Cancel</a>';
      $("#edit-cancel").onclick = function (ev) { ev.preventDefault(); exitEdit(); };

      var gc = $("#geo-current"); gc.hidden = false;
      gc.innerHTML = "Current region: <b>" + esc(inst.regionLabel || "your area") +
        "</b> — kept as-is unless you pick a new one below.";

      enterEditChrome();
      show(1);
      window.scrollTo({ top: 0 });
    }).catch(function (e) { alert(errMsg(e)); });
  }

  // Toggle the wizard chrome between "create" and "edit": edit hides drafts and
  // the terminal build button, shows Save & exit on every step, relabels next.
  function enterEditChrome() {
    $("#my-atlases").hidden = true;
    $(".stepper").hidden = false;
    ["1", "2", "3"].forEach(function (n) {
      var sd = $("#save-draft-" + n); if (sd) sd.hidden = true;
      var se = $("#save-exit-" + n); if (se) { se.hidden = false; se.onclick = saveAndExit; }
    });
    $("#next-1").textContent = "Continue to region →";
    $("#next-2").textContent = "Continue to layers →";
    $("#next-3").hidden = true; // Save & exit is the terminal action when editing
  }
  function exitEditChrome() {
    ["1", "2", "3"].forEach(function (n) {
      var sd = $("#save-draft-" + n); if (sd) sd.hidden = false;
      var se = $("#save-exit-" + n); if (se) se.hidden = true;
    });
    $("#next-1").textContent = "Choose your region →";
    $("#next-2").textContent = "Choose layers →";
    $("#next-3").hidden = false;
  }

  function detailsBody() {
    return {
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
        removeLogo: S.removeLogo || undefined,
      },
    };
  }

  function viewerUrl(slug, viewKey) {
    var base = location.origin + location.pathname.replace(/setup\/?$/, "");
    if (viewKey) return base + "?dataset=" + encodeURIComponent(slug) + "&key=" + encodeURIComponent(viewKey);
    return base + "a/" + encodeURIComponent(slug);
  }

  // finished editing → go to the atlas (public), or the dashboard if we can't
  // build a viewable URL for a private atlas (its view key isn't recoverable)
  function leaveToAtlas(viewKey) {
    var slug = S.editSlug;
    var isPrivate = S.visibility === "private";
    exitEdit();
    if (!isPrivate) { location.href = viewerUrl(slug); return; }
    if (viewKey) { location.href = viewerUrl(slug, viewKey); return; }
    refreshMe(); showHome(); msg(S.step, "Saved. Your private atlas is updated.", "ok");
  }

  function saveAndExit() {
    msg(S.step, "");
    if (!$("#f-title").value.trim()) { show(1); return msg(1, "Give your atlas a title first."); }
    var rebuildNeeded = !S.regionKept ||
      Object.keys(S.catalog.chosen).slice().sort().join(",") !== S._origLayers;

    var buttons = ["#save-exit-1", "#save-exit-2", "#save-exit-3"];
    buttons.forEach(function (b) { if ($(b)) $(b).disabled = true; });
    var reenable = function () { buttons.forEach(function (b) { if ($(b)) $(b).disabled = false; }); };

    api("instances/" + S.editSlug + "/details", { method: "POST", body: detailsBody() })
      .then(function (r) {
        if (rebuildNeeded) { rebuildAndOpen(r.viewKey); return; }
        leaveToAtlas(r.viewKey);
      })
      .catch(function (e) {
        reenable();
        if (e.needsAuth) { signIn("Sign in to edit this atlas.").then(function (ok) { if (ok) saveAndExit(); }); return; }
        msg(S.step, esc(errMsg(e)));
      });
  }

  /* ---- collaborators (edit mode, owner only) ---- */

  function collabMsg(text, cls) {
    $("#collab-msg").innerHTML = text ? '<div class="msg ' + (cls || "err") + '">' + text + "</div>" : "";
  }

  function renderCollaborators(list) {
    var box = $("#collab-list");
    box.innerHTML = "";
    if (!list.length) {
      box.innerHTML = '<p class="hint" style="margin:.3rem 0 0">No collaborators yet — invite a partner organisation below.</p>';
      return;
    }
    list.forEach(function (c) {
      var row = document.createElement("div");
      row.className = "collab-row";
      row.innerHTML = '<span class="em">' + esc(c.email) + "</span>" +
        '<span class="mine-badge' + (c.acceptedAt ? "" : " draft") + '">' + (c.acceptedAt ? "Active" : "Invited") + "</span>";
      var rm = document.createElement("button");
      rm.type = "button"; rm.textContent = "Remove";
      rm.onclick = function () {
        if (!confirm("Remove " + c.email + " from this atlas? They lose edit access immediately.")) return;
        api("instances/" + S.editSlug + "/collaborators", { method: "DELETE", body: { email: c.email } })
          .then(function (r) { collabMsg(""); renderCollaborators(r.collaborators || []); })
          .catch(function (e) { collabMsg(esc(errMsg(e))); });
      };
      row.appendChild(rm);
      box.appendChild(row);
    });
  }

  $("#collab-invite").onclick = function () {
    var email = $("#collab-email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { collabMsg("Enter a valid email."); return; }
    $("#collab-invite").disabled = true;
    api("instances/" + S.editSlug + "/collaborators", { method: "POST", body: { email: email } })
      .then(function (r) {
        $("#collab-invite").disabled = false;
        $("#collab-email").value = "";
        renderCollaborators(r.collaborators || []);
        collabMsg(r.sent
          ? "Invite sent to " + esc(email) + " — they sign in with that email and this atlas appears under their atlases."
          : "Added — but the invite email couldn’t be sent. Share the sign-in steps with them directly.", r.sent ? "ok" : "err");
      })
      .catch(function (e) { $("#collab-invite").disabled = false; collabMsg(esc(errMsg(e))); });
  };

  function deleteAtlas(slug, title) {
    if (!confirm("Delete “" + (title || slug) + "”? This removes the atlas and its data, and can't be undone.")) return;
    api("instances/" + slug, { method: "DELETE" })
      .then(function () { refreshMe(); loadDirectory(); })   // the public gallery must drop it too
      .catch(function (e) { alert(errMsg(e)); });
  }

  function exitEdit() {
    S.editSlug = null; S.editMode = null; S.editInst = null; S.regionKept = false;
    S._origLayers = null; S._pendingViewKey = null; S.editRole = null;
    $("#edit-banner").hidden = true;
    $("#geo-current").hidden = true;
    $("#collab-panel").hidden = true;
    $("#collab-list").innerHTML = ""; $("#collab-msg").innerHTML = ""; $("#collab-email").value = "";
    exitEditChrome();
    $("#f-slug").disabled = false;
    $(".stepper").hidden = false;
    ["f-title", "f-slug", "f-subtitle", "f-org", "f-orgurl", "f-email", "f-about", "f-footer"].forEach(function (id) { $("#" + id).value = ""; });
    S.logoData = null; S.removeLogo = false; S.slugTouched = false;
    $("#logo-hint").textContent = "";
    S.geo = { iso3: "", level: 1, features: [], selected: {}, viewLevel: 1, crumbs: [] };
    S.catalog = { tier: "", layers: [], chosen: {} };
    setVisibility("public");
    msg(1, ""); msg(4, "");
    if (((S.session && S.session.instances) || []).length) {
      showHome(); // back to the dashboard, not a blank form
    } else {
      renderMyAtlases();
      show(1);
    }
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
    showHome(); // the dashboard is the manage surface
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
    else if ((me.instances || []).length) showHome(); // returning creator → dashboard, not the form
  }).catch(function () {
    if (EDIT_PARAM) focusManage(EDIT_PARAM); // not signed in → focusManage will prompt
    else if (SIGNIN_PARAM) signIn("Sign in to see and manage your atlases.").then(function (ok) {
      if (ok) {
        loadDrafts();
        if (((S.session && S.session.instances) || []).length) showHome();
      }
    });
  });
  loadDirectory();
  showFork();   // every fresh visit starts at the fork; auth may swap in the dashboard
  if (!EDIT_PARAM) offerLocalResume();
})();
