/* Atlas setup — four questions, then hand over.
 *
 * The wizard that lived here used to do everything: pick a region by drilling
 * country → state → district, choose and style layers, add data, preview and
 * publish. All of that now lives on the atlas itself, on its own page, so
 * this asks the only things that must be known BEFORE an atlas can exist:
 * who it belongs to, where it is, and what open data to start it with.
 *
 * Everything here talks to the same API the old wizard did — POST /instances
 * builds, GET /jobs/:id reports — so nothing about how an atlas is made
 * changed. What changed is how much of it a person has to sit through.
 */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return [].slice.call(document.querySelectorAll(s)); };
  var API = "../api/";

  var S = {
    me: null,
    // chosen holds the boundary-data name (what we build with) and the label
    // the person recognised (what we show them) — see the alias note in step 2
    chosen: [], iso3: "", level: 2, catalog: null, picked: {},
    slug: "", jobId: "",
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
    if (box) box.innerHTML = text ? '<div class="msg ' + (cls || "err") + '">' + esc(text) + "</div>" : "";
  }
  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ======================= who is here ======================= */

  function boot() {
    api("auth/me").then(function (me) {
      S.me = me;
      $("#who").textContent = me.email;
      $("#signout").hidden = false;
      // a lapsed session mid-setup comes back to where it stopped, not to the
      // top of a form it has already been filled in
      if (S.resumeAtBuild) {
        S.resumeAtBuild = false;
        $("#gate").hidden = true;
        $("#home").hidden = true;
        $("#flow").hidden = false;
        step(3);
        msg(3, "Signed in again — press Build my atlas.", "ok");
        return;
      }
      if (/(^|[?&])new=1/.test(location.search)) startFlow();
      else showHome();
    }).catch(function () {
      $("#gate").hidden = false;
    });
  }

  $("#signout").onclick = function () {
    api("auth/logout", { method: "POST" }).then(function () { location.href = location.pathname; });
  };

  $("#g-send").onclick = function () {
    var em = $("#g-email").value.trim(), btn = this;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) {
      msg("gate", "That does not look like an email address."); $("#g-email").focus(); return;
    }
    btn.disabled = true; msg("gate", "");
    api("auth/request-link", { method: "POST", body: { email: em } }).then(function (r) {
      $("#gate-1").hidden = true; $("#gate-2").hidden = false;
      $("#g-said").textContent = r.sent === false
        ? "Mail is off on this server — the code is in its log."
        : "We sent a six-digit code to " + em + ".";
      $("#g-code").focus();
    }).catch(function (e) { msg("gate", errMsg(e)); })
      .then(function () { btn.disabled = false; });
  };
  $("#g-back").onclick = function () {
    $("#gate-2").hidden = true; $("#gate-1").hidden = false; msg("gate", ""); $("#g-email").focus();
  };
  $("#g-verify").onclick = function () {
    var em = $("#g-email").value.trim(), code = $("#g-code").value.trim(), btn = this;
    btn.disabled = true; msg("gate", "");
    api("auth/verify-code", { method: "POST", body: { email: em, code: code } }).then(function () {
      $("#gate").hidden = true;
      boot();
    }).catch(function (e) { msg("gate", errMsg(e)); })
      .then(function () { btn.disabled = false; });
  };
  $("#g-code").addEventListener("keydown", function (e) { if (e.key === "Enter") $("#g-verify").click(); });
  $("#g-email").addEventListener("keydown", function (e) { if (e.key === "Enter") $("#g-send").click(); });

  /* ======================= your atlases ======================= */

  function showHome() {
    $("#flow").hidden = true;
    $("#home").hidden = false;
    // arriving from a delete: say so once, then take it out of the address so a
    // refresh or a shared link does not keep announcing it
    var gone = new URLSearchParams(location.search).get("deleted");
    if (gone) {
      var note = $("#deleted-note");
      note.textContent = "“" + gone + "” was deleted.";
      note.hidden = false;
      history.replaceState(null, "", location.pathname);
    }
    var list = (S.me && S.me.instances) || [];
    $("#home-sub").textContent = list.length
      ? "Open one to add data, style it, or change who can see it."
      : "You have not built one yet.";
    var host = $("#mine");
    host.innerHTML = "";
    list.forEach(function (i) {
      var a = document.createElement("a");
      a.className = "row";
      a.href = "../?dataset=" + encodeURIComponent(i.slug);
      a.innerHTML = '<span class="t"><b>' + esc(i.title || i.slug) + "</b><span>" +
          esc(i.regionLabel || "") + (i.role === "editor" ? " · you were invited to this" : "") + "</span></span>" +
        '<span class="st' + (i.status === "published" ? " live" : "") + '">' +
          (i.status === "published" ? "Live" : "Not live") + "</span>";
      host.appendChild(a);
    });
  }
  $("#new-atlas").onclick = function () { startFlow(); };

  function startFlow() {
    $("#home").hidden = true;
    $("#gate").hidden = true;
    $("#flow").hidden = false;
    step(1);
  }

  /* ======================= steps ======================= */

  function step(n) {
    [1, 2, 3, 4].forEach(function (i) { $("#s" + i).hidden = i !== n; });
    // the file panel is not in that numbered set, and forgetting it here left it
    // visible underneath whatever step you moved to — so checking your data looked
    // like it was happening under "Open data"
    if ($("#s2b")) $("#s2b").hidden = true;
    if (n === 2) loadCountries();
    if (n === 3) loadCatalog();
    $$(".stp").forEach(function (b) {
      var i = Number(b.dataset.s);
      if (i === n) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
      if (i <= n) b.disabled = false;
    });
    window.scrollTo({ top: 0 });
  }
  $$(".stp").forEach(function (b) { b.onclick = function () { if (!b.disabled) step(Number(b.dataset.s)); }; });
  $$("[data-go]").forEach(function (b) { b.onclick = function () { step(Number(b.dataset.go)); }; });

  /* ---- 1 · identity ---- */

  function needField(id, what) {
    var input = $("#" + id), lab = input.closest("label.f"), err = lab.querySelector(".fielderr");
    var empty = !input.value.trim();
    lab.classList.toggle("bad", empty);
    err.hidden = !empty;
    err.textContent = empty ? what : "";
    return !empty;
  }
  function sayMissing(n) {
    if (!n) { msg(1, ""); return; }
    msg(1, (n === 1 ? "One thing is still needed" : n + " things are needed") + " before we can build anything.");
  }
  $("#next-1").onclick = function () {
    var okTitle = needField("f-title", "Your atlas needs a title. It is what people will see.");
    var okOrg = needField("f-org", "Name the organisation or project this atlas belongs to.");
    var missing = (okTitle ? 0 : 1) + (okOrg ? 0 : 1);
    if (missing) { sayMissing(missing); (okTitle ? $("#f-org") : $("#f-title")).focus(); return; }
    sayMissing(0);
    step(2);
    $("#place").focus();
  };
  ["f-title", "f-org"].forEach(function (id) {
    $("#" + id).addEventListener("input", function () {
      var lab = this.closest("label.f");
      if (lab.classList.contains("bad") && this.value.trim()) {
        lab.classList.remove("bad");
        lab.querySelector(".fielderr").hidden = true;
        sayMissing($$("label.f.bad").length);
      }
    });
  });

  /* ---- 2 · geography: a text box, not a drill-down ---- */

  function loadCountries() {
    if (loadCountries._p) return loadCountries._p;
    loadCountries._p = fetch("./countries.json").then(function (r) { return r.json(); }).then(function (list) {
      var sel = $("#country");
      sel.innerHTML = "";
      list.forEach(function (c) {
        var o = document.createElement("option");
        o.value = c.iso3; o.textContent = c.name;
        if (c.iso3 === "IND") o.selected = true;     // where the atlases are, today
        sel.appendChild(o);
      });
      S.iso3 = sel.value;
    }).catch(function () { msg(2, "The country list could not be loaded."); });
    return loadCountries._p;
  }
  $("#country").addEventListener("change", function () {
    S.iso3 = this.value;
    // places from the old country cannot be built into an atlas of the new one
    if (S.chosen.length) { S.chosen = []; paintChips(); }
    S.catalog = null;                       // a different country offers different layers
    S.picked = {};
    closeSugg();
  });

  var box = $("#place"), sugg = $("#sugg"), shown = [], cursor = -1, searchSeq = 0, searchTimer;

  function closeSugg() {
    sugg.hidden = true; box.setAttribute("aria-expanded", "false"); cursor = -1;
    box.removeAttribute("aria-activedescendant");
    box.setAttribute("aria-busy", "false");
  }
  /* One row in the list that is not a place: what the lookup is doing, or why
     it came back with nothing. A cold lookup takes about four seconds, and
     silence for four seconds is indistinguishable from broken. */
  function noteSugg(text, kind) {
    sugg.innerHTML = "";
    var li = document.createElement("li");
    li.setAttribute("role", "presentation");
    var row = document.createElement("span");
    row.className = "note" + (kind === "err" ? " is-err" : "");
    if (kind === "busy") {
      var sp = document.createElement("span");
      sp.className = "spin"; sp.setAttribute("aria-hidden", "true");
      row.appendChild(sp);
    }
    row.appendChild(document.createTextNode(text));
    li.appendChild(row); sugg.appendChild(li);
    shown = []; cursor = -1;
    sugg.hidden = false;
    box.setAttribute("aria-expanded", "true");
    box.setAttribute("aria-busy", kind === "busy" ? "true" : "false");
    box.removeAttribute("aria-activedescendant");
  }
  function has(id) { return S.chosen.some(function (c) { return c.id === id; }); }
  // "tumakuru" typed, "Tumakuru" shown — the match is case-insensitive but the
  // label is a place name and should look like one
  function properName(s) {
    return String(s || "").split(/\s+/).map(function (w) {
      return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    }).join(" ");
  }
  // what to call this place on screen: the spelling that was searched for when
  // it differs from the data's, otherwise the data's own
  function shownName(p) {
    return p.alias && p.alias.typed ? properName(p.alias.typed) : p.name;
  }

  function paintSugg() {
    sugg.innerHTML = "";
    if (!shown.length) { closeSugg(); return; }
    shown.forEach(function (p, i) {
      var li = document.createElement("li");
      li.setAttribute("role", "presentation");
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "option");
      b.id = "sugg-opt-" + i;
      b.setAttribute("aria-selected", i === cursor ? "true" : "false");
      // lead with the spelling the person typed; name the other one honestly
      var lead = shownName(p);
      var note = p.alias && p.alias.inData && p.alias.inData !== lead
        ? ' · listed as "' + p.alias.inData + '" in the boundary data' : "";
      b.innerHTML = '<span class="nm">' + esc(lead) + "</span>" +
        '<span class="wh">' + esc(p.label || "") + esc(note) + "</span>";
      b.onclick = function () { add(p, lead); };
      li.appendChild(b);
      sugg.appendChild(li);
    });
    sugg.hidden = false;
    box.setAttribute("aria-expanded", "true");
    // focus never leaves the input; the active option is named, not focused
    if (cursor >= 0 && shown[cursor]) box.setAttribute("aria-activedescendant", "sugg-opt-" + cursor);
    else box.removeAttribute("aria-activedescendant");
  }

  function search(q) {
    q = q.trim();
    if (q.length < 2 || !S.iso3) { shown = []; closeSugg(); return; }
    var seq = ++searchSeq;
    noteSugg("Looking for places…", "busy");
    api("geo/search?iso3=" + encodeURIComponent(S.iso3) + "&q=" + encodeURIComponent(q) + "&limit=8")
      .then(function (r) {
        if (seq !== searchSeq) return;            // a newer keystroke won
        var matches = (r.matches || []).filter(function (m) { return !has(m.id); });
        box.setAttribute("aria-busy", "false");
        if (!matches.length) { noteSugg("No places here match “" + q + "”.", "empty"); return; }
        shown = matches; cursor = -1;
        paintSugg();
      })
      .catch(function (e) {
        if (seq !== searchSeq) return;
        noteSugg("Could not reach the list of places. Try again in a moment.", "err");
        msg(2, e && e._status === 404 ? "" : errMsg(e));
      });
  }
  box.addEventListener("input", function () {
    clearTimeout(searchTimer);
    var v = this.value;
    // the wait shows straight away rather than after the typing pause — that
    // pause was itself part of what felt broken
    if (v.trim().length >= 2 && S.iso3) noteSugg("Looking for places…", "busy");
    else closeSugg();
    searchTimer = setTimeout(function () { search(v); }, 220);
  });
  box.addEventListener("keydown", function (e) {
    if (sugg.hidden) {
      if (e.key === "ArrowDown" && box.value.trim().length >= 2) { e.preventDefault(); search(box.value); }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!shown.length) return; // a wait or a message is showing — nothing to step through
      cursor += e.key === "ArrowDown" ? 1 : -1;
      if (cursor < 0) cursor = shown.length - 1;
      if (cursor >= shown.length) cursor = 0;
      paintSugg();
      var opt = sugg.querySelector("#sugg-opt-" + cursor);
      if (opt) opt.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      if (cursor >= 0 && shown[cursor]) {
        e.preventDefault();
        add(shown[cursor], shownName(shown[cursor]));
      }
    } else if (e.key === "Escape") { closeSugg(); }
    else if (e.key === "Home" || e.key === "End") {
      e.preventDefault(); cursor = e.key === "Home" ? 0 : shown.length - 1; paintSugg();
    }
  });
  document.addEventListener("click", function (e) {
    if (!sugg.hidden && !e.target.closest(".combo")) closeSugg();
  });

  function add(p, label) {
    if (!has(p.id)) {
      S.chosen.push({ id: p.id, name: p.name, label: label || p.name, level: p.level, bbox: p.bbox });
      // Every unit in one build has to come from one admin level — the API
      // resolves shapeIDs against a single level. The finest level chosen wins,
      // and anything coarser is dropped rather than silently mis-resolved.
      var finest = Math.max.apply(null, S.chosen.map(function (c) { return c.level || 2; }));
      var kept = S.chosen.filter(function (c) { return (c.level || 2) === finest; });
      if (kept.length !== S.chosen.length) {
        msg(2, "An atlas is built at one level of detail, so the " +
          (S.chosen.length - kept.length) + " broader place(s) were dropped in favour of the finer ones.", "ok");
        S.chosen = kept;
      } else { msg(2, ""); }
      S.level = finest;
    }
    box.value = ""; shown = []; closeSugg(); paintChips(); box.focus();
  }
  function paintChips() {
    var host = $("#chips");
    host.innerHTML = "";
    S.chosen.forEach(function (c) {
      var renamed = c.label !== c.name;
      var el = document.createElement("span");
      el.className = "chip";
      if (renamed) el.title = 'The boundary data calls this "' + c.name + '"';
      el.innerHTML = "<span>" + esc(c.label) +
          (renamed ? ' <span class="chip-alt">(' + esc(c.name) + ")</span>" : "") + "</span>" +
        '<button class="x" aria-label="Remove ' + esc(c.label) + '">✕</button>';
      el.querySelector(".x").onclick = function () {
        S.chosen = S.chosen.filter(function (x) { return x.id !== c.id; });
        paintChips();
      };
      host.appendChild(el);
    });
    $("#chips-empty").hidden = S.chosen.length > 0;
    // name the chosen place at the field as well as in the chips: a label reading
    // only "Place" beside an empty box made a finished step look untouched
    var chosen = $("#place-chosen");
    if (chosen) {
      chosen.textContent = !S.chosen.length ? ""
        : S.chosen.length === 1 ? S.chosen[0].label
        : S.chosen[0].label + " +" + (S.chosen.length - 1) + " more";
    }
    var v = $("#verdict");
    if (!S.chosen.length) { v.hidden = true; return; }
    v.hidden = false;
    v.textContent = "Your atlas will cover " + S.chosen.map(function (c) { return c.label; }).join(", ") +
      (S.chosen.length > 1 ? " — " + S.chosen.length + " places" : "") + ". Ready to build.";
  }

  /* ---- 2b · let a file answer "where is it?" ----
     Someone who does not know which districts their own spreadsheet covers cannot
     get past this step by typing — that is the whole reason this exists. The file
     is read HERE, in the browser; only a list of coordinates or place names is
     sent, never the file itself. What comes back fills the same chips a typed
     answer fills, so the person confirms with the same button, and can take any
     of them out. */

  // What the dropped file is, and what we read out of it. Held so the SAME file
  // can be carried into the build instead of being asked for a second time.
  // addedIds: the places THIS FILE put on the list. The card's ✕ takes the file and
  // these, and nothing else — a place you typed yourself is yours, and a single
  // dismiss should never quietly undo your own typing.
  var GEO = { file: null, canonical: null, rows: 0, addedIds: [] };

  // A representative point for any shape — the mean of its coordinates, which sits
  // inside a district where a single vertex might fall in its neighbour.
  function geomCentre(g) {
    if (!g || !g.coordinates) return null;
    var sx = 0, sy = 0, n = 0;
    (function walk(c) {
      if (!Array.isArray(c)) return;
      if (typeof c[0] === "number" && typeof c[1] === "number") { sx += c[0]; sy += c[1]; n++; return; }
      for (var i = 0; i < c.length; i++) walk(c[i]);
    })(g.coordinates);
    return n ? [sx / n, sy / n] : null;
  }

  function pointsFrom(c) {
    var pts = [];
    if (c.geoms && c.geoms.length) {                      // shapes already in the file
      c.geoms.forEach(function (g) { var p = geomCentre(g); if (p) pts.push(p); });
      if (pts.length) return pts;
    }
    var num = (c.schema || []).filter(function (s) { return s.type === "number"; });
    var lat = num.filter(function (s) { return /lat/i.test(s.name); })[0];
    var lng = num.filter(function (s) { return /(lon|lng)/i.test(s.name); })[0];
    if (!lat || !lng) return null;
    (c.rows || []).forEach(function (r) {
      var y = Number(r[lat.name]), x = Number(r[lng.name]);
      if (isFinite(x) && isFinite(y) && Math.abs(y) <= 90 && Math.abs(x) <= 180) pts.push([x, y]);
    });
    return pts.length ? pts : null;
  }

  // The column most likely to hold place names: one that is named like a place
  // first, otherwise the text column that reads as short labels rather than prose.
  function namesFrom(c) {
    var text = (c.schema || []).filter(function (s) { return s.type === "string"; });
    if (!text.length) return null;
    var named = text.filter(function (s) {
      return /(name|village|town|city|district|block|place|ward|panchayat|taluk|tehsil|mandal|gram)/i.test(s.name);
    })[0];
    var pick = named;
    if (!pick) {
      var best = null;
      text.forEach(function (s) {
        var vals = (c.rows || []).map(function (r) { return String(r[s.name] == null ? "" : r[s.name]).trim(); })
          .filter(Boolean);
        if (!vals.length) return;
        var chars = 0, words = 0;
        vals.forEach(function (v) { chars += v.length; words += v.split(/\s+/).length; });
        chars /= vals.length; words /= vals.length;
        if (chars > 40 || words > 4) return;              // prose, not a label
        var score = vals.length / (chars + words);
        if (!best || score > best.score) best = { s: s, score: score };
      });
      pick = best && best.s;
    }
    if (!pick) return null;
    var out = [];
    (c.rows || []).forEach(function (r) {
      var v = String(r[pick.name] == null ? "" : r[pick.name]).trim();
      if (v) out.push(v);
    });
    return out.length ? { col: pick.name, names: out } : null;
  }

  function showFileCard(name, note) {
    var host = $("#geo-file-card");
    if (!host) return;
    if (!name) { host.innerHTML = ""; return; }
    var n = GEO.addedIds.length;
    var tip = n
      ? "Forget this file and the " + n + " place" + (n > 1 ? "s" : "") + " it found"
      : "Forget this file";
    host.innerHTML = '<div class="filecard"><span></span><button type="button"></button></div>';
    host.querySelector("span").textContent = name + (note ? " · " + note : "");
    var x = host.querySelector("button");
    x.textContent = "✕";
    x.title = tip;
    x.setAttribute("aria-label", tip);
    x.onclick = function () {
      // the file and the places it found leave together; anything typed by hand stays
      if (GEO.addedIds.length) {
        S.chosen = S.chosen.filter(function (c) { return GEO.addedIds.indexOf(c.id) < 0; });
        if (S.chosen.length) S.level = Math.max.apply(null, S.chosen.map(function (c) { return c.level || 2; }));
        paintChips();
      }
      host.innerHTML = ""; msg(2, "");
      GEO.file = null; GEO.canonical = null; GEO.rows = 0; GEO.addedIds = [];
      if (BENCH) { BENCH.destroy(); BENCH = null; BENCH_KEY = ""; }
      syncRungs();
    };
  }

  function placesFromFile(file) {
    if (!window.LokaIngest) { msg(2, "The file reader didn’t load — reload the page and try again."); return; }
    msg(2, "Reading " + file.name + "…", "ok");
    showFileCard(file.name, "reading…");
    LokaIngest.fromFile(file, function (err, res) {
      if (err) { msg(2, "That file couldn’t be read: " + err.message); showFileCard(null); return; }
      if (res.kind === "unsupported") { msg(2, res.message); showFileCard(null); return; }
      // a workbook or a mixed shapes file: take the first, and say which
      if (res.kind === "sheets") {
        return res.pick(res.sheets[0].name, function (e2, r2) {
          if (e2 || !r2 || r2.kind !== "table") { msg(2, "That workbook couldn’t be read."); showFileCard(null); return; }
          useCanonical(r2.canonical, file, "sheet “" + res.sheets[0].name + "”");
        });
      }
      if (res.kind === "classes") {
        return res.pick(res.classes[0].cls, function (e2, r2) {
          if (e2 || !r2 || r2.kind !== "table") { msg(2, "That file couldn’t be read."); showFileCard(null); return; }
          useCanonical(r2.canonical, file, res.classes[0].label);
        });
      }
      if (res.kind !== "table") { msg(2, "That file couldn’t be read."); showFileCard(null); return; }
      useCanonical(res.canonical, file, "");
    });
  }

  function useCanonical(c, file, part) {
    var rows = (c.rows || []).length;
    GEO.file = file; GEO.canonical = c; GEO.rows = rows;
    var pts = pointsFrom(c);
    var nm = pts ? null : namesFrom(c);
    if (!pts && !nm) {
      msg(2, "This file has no coordinates and no column that reads like place names, so it can’t " +
        "say where it belongs. Search for the place above instead.");
      showFileCard(file.name, rows + " rows · couldn’t find places");
      syncRungs();   // the file is aboard even though it couldn't name places
      return;
    }
    if (!pts && !S.iso3) {
      msg(2, "Place names can’t say which country they are in — choose the country above, then drop the file again.");
      showFileCard(file.name, rows + " rows");
      syncRungs();
      return;
    }
    showFileCard(file.name, rows + " rows" + (part ? " · " + part : "") + " · finding places…");
    msg(2, "Reading all " + rows.toLocaleString() + " rows to find the places…", "ok");
    var body = pts ? { iso3: S.iso3, points: pts } : { iso3: S.iso3, names: nm.names };
    api("geo/infer", { method: "POST", body: body })
      .then(function (d) { applyInferred(d, file, rows, pts ? "coordinates" : "the “" + nm.col + "” column"); })
      .catch(function (e) {
        msg(2, e && e.needsCountry ? "Choose the country above, then drop the file again." : errMsg(e));
        showFileCard(file.name, rows + " rows");
      });
  }

  function applyInferred(d, file, rows, how) {
    var units = (d && d.units) || [];
    if (!units.length) {
      msg(2, "We couldn’t match these rows to any place we know. Search for the place above instead — " +
        "your data will still go on the atlas afterwards.");
      showFileCard(file.name, rows + " rows · no places found");
      return;
    }
    var had = S.chosen.map(function (c) { return c.id; });
    units.forEach(function (u) { add({ id: u.id, name: u.name, level: d.level, bbox: u.bbox }, u.name); });
    GEO.addedIds = S.chosen.map(function (c) { return c.id; })
      .filter(function (id) { return had.indexOf(id) < 0; });
    var added = GEO.addedIds.length;
    var shownNames = S.chosen.slice(0, 3).map(function (c) { return c.label; }).join(", ");
    var more = S.chosen.length > 3 ? " and " + (S.chosen.length - 3) + " more" : "";
    var said = "From " + how + ": your file’s places sit in " + shownNames + more +
      " — " + (d.matchedRows || 0).toLocaleString() + " of " + (d.rows || rows).toLocaleString() + " rows.";
    if (d.sharedRows) {
      said += " " + d.sharedRows.toLocaleString() + " row" + (d.sharedRows > 1 ? "s name" : " names") +
        " a place that exists in more than one part of the country — we took the ones nearest the rest of your data.";
    }
    if (d.unreadRows) {
      said += " " + d.unreadRows.toLocaleString() + " row" + (d.unreadRows > 1 ? "s" : "") + " we couldn’t read.";
    }
    said += " Take any out, or search to add more.";
    msg(2, said, "ok");
    /* The card used to count only the places this file ADDED to the selection,
       so a file whose places you had already chosen read "0 places found"
       directly under a sentence saying they had been found. Two lines of the
       same screen disagreeing. Report what the file's places ARE. */
    var found = S.chosen.length;
    showFileCard(file.name, rows + " rows · " + found + " place" + (found === 1 ? "" : "s") +
      (added ? "" : " (already chosen)"));
    syncRungs();
  }

  (function wireGeoDrop() {
    var drop = $("#geo-drop"), input = $("#geo-file");
    if (!drop || !input) return;
    ["dragenter", "dragover"].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("over"); });
    });
    ["dragleave", "dragend"].forEach(function (t) {
      drop.addEventListener(t, function () { drop.classList.remove("over"); });
    });
    drop.addEventListener("drop", function (e) {
      e.preventDefault(); drop.classList.remove("over");
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) placesFromFile(f);
    });
    input.addEventListener("change", function () {
      if (input.files && input.files[0]) placesFromFile(input.files[0]);
      input.value = "";                                   // same file twice should re-read
    });
  })();

  /* ---- 2c · check the file against the places, before the atlas is built ----
     The file goes to the server ONCE, here, as a pending piece of work: there is
     no atlas yet to attach it to, so it carries the region instead and waits. This
     is also the only moment the fix-list exists — after the build it is gone —
     which is why checking happens before Open data rather than after. */

  var BENCH = null, BENCH_KEY = "";

  function chosenBbox() {
    var w = 180, so = 90, e = -180, n = -90, any = false;
    S.chosen.forEach(function (c) {
      var b = c.bbox;
      if (!b || b.length !== 4) return;
      any = true;
      if (b[0] < w) w = b[0];
      if (b[1] < so) so = b[1];
      if (b[2] > e) e = b[2];
      if (b[3] > n) n = b[3];
    });
    return any ? [w, so, e, n] : null;
  }

  /* Checking a file IS a step, and pretending otherwise is what confused the owner:
     the stepper said four questions, none of them "your data", while a data screen
     sat inside Geography. So the file gets its own rung — but only when there is a
     file. Someone mapping a region from public data still sees four. */
  function syncRungs() {
    var rung = $("#stp-file");
    if (!rung) return;
    var withFile = !!GEO.canonical;
    rung.hidden = !withFile;
    // The step button names where it actually goes. With a file aboard, the
    // next stop is checking that file — a button still saying "Choose open
    // data" walked you somewhere it didn't say.
    var fwd = $("#next-2");
    if (fwd) fwd.textContent = withFile ? "Check your data →" : "Choose open data →";
    // ...and the page's own summary counts the same steps the rail shows
    var lede = $("#flow .lede");
    if (lede) lede.textContent = withFile
      ? "Five steps: who you are, where it is, a look at your data, what open data goes on it. Then we build it and hand you the map."
      : "Four steps: who you are, where it is, what open data goes on it. Then we build it and hand you the map.";
    var order = withFile ? ["1", "2", "file", "3", "4"] : ["1", "2", "3", "4"];
    order.forEach(function (key, i) {
      var b = key === "file" ? rung : $('.stp[data-s="' + key + '"]');
      if (b) b.querySelector("b").textContent = String(i + 1);
    });
  }

  function showCheck() {
    [1, 2, 3, 4].forEach(function (i) { $("#s" + i).hidden = true; });
    $("#s2b").hidden = false;
    syncRungs();
    $$(".stp").forEach(function (b) { b.removeAttribute("aria-current"); });
    var rung = $("#stp-file");
    if (rung) { rung.hidden = false; rung.disabled = false; rung.setAttribute("aria-current", "step"); }
    window.scrollTo({ top: 0 });

    var key = S.iso3 + "|" + S.level + "|" +
      S.chosen.map(function (c) { return c.id; }).sort().join(",");
    if (BENCH && BENCH_KEY === key) return;        // already checked against these places
    if (BENCH) { BENCH.destroy(); BENCH = null; }
    BENCH_KEY = key;
    $("#check-verdict").classList.remove("err");
    $("#check-verdict").textContent = "Reading " + GEO.file.name + "…";
    try {
      // window.__bench mirrors what the add-data page already exposes: a handle
      // on the bench from the console. It is how a wizard-only fault in the data
      // steps can be reproduced at all — without it the bench's state is sealed
      // inside this closure and the only way to test the flow is by hand.
      BENCH = window.__bench = window.LokaDataBench.mount($("#bench"), {
        mode: "embedded",
        api: API,
        viewer: "../",
        stages: "checkPlace",
        region: {
          iso3: S.iso3, level: S.level,
          shapeIDs: S.chosen.map(function (c) { return c.id; }),
          bbox: chosenBbox(),
        },
        // the bench's progress and errors surface HERE, in the verdict line
        // the person is already reading — its own message sits below a table
        // that can be screens tall
        onStatus: function (text, kind) {
          var bar = $("#check-working");
          // the bar runs while the work does: a status that is neither empty
          // nor a failure IS the work in progress
          if (bar) bar.hidden = !text || kind === "err";
          if (!text) return;   // cleared: the verdict or onReady speaks next
          var v = $("#check-verdict");
          v.hidden = false;
          v.classList.toggle("err", kind === "err");
          v.textContent = text;
        },
        onReady: function (sum) {
          var left = sum.needsAttention || 0;
          var bar = $("#check-working");
          if (bar) bar.hidden = true;      // the answer is in; the work is over
          var v = $("#check-verdict");
          v.classList.remove("err");
          v.textContent = left
            ? sum.features + " of " + sum.rows + " rows are on the map — " + left +
              " need a second look below."
            : sum.rows + " rows, all placed. Nothing to fix.";
        },
      });
      BENCH.start(GEO.canonical);
    } catch (e) {
      BENCH = null; BENCH_KEY = "";
      msg("2b", "Your file couldn’t be checked here: " + e.message +
        " — build the atlas anyway, then add the file from the atlas’s own page.");
    }
  }

  $("#next-2").onclick = function () {
    if (!S.chosen.length) {
      msg(2, "An atlas needs at least one place. Search above to add one.");
      $("#place").focus();
      return;
    }
    msg(2, "");
    if (GEO.canonical) { showCheck(); return; }
    step(3);
  };

  $("#next-2b").onclick = function () { msg("2b", ""); step(3); };
  if ($("#stp-file")) $("#stp-file").onclick = function () { if (GEO.canonical) showCheck(); };

  /* ---- 3 · open data ---- */

  function loadCatalog() {
    // waits on the country list rather than assuming it has landed — what is
    // on offer depends entirely on which country this atlas is in
    $("#cats").innerHTML = '<p class="hint">Loading what is available here…</p>';
    loadCountries().then(function () {
      if (S.catalog && S.catalogIso === S.iso3) { paintCatalog(); return; }
      return fetchCatalog();
    });
  }
  function fetchCatalog() {
    return api("catalog?iso3=" + encodeURIComponent(S.iso3)).then(function (r) {
      S.catalog = r.layers || [];
      S.catalogIso = S.iso3;
      paintCatalog();
    }).catch(function (e) {
      $("#cats").innerHTML = "";
      msg(3, errMsg(e));
    });
  }

  var GROUP_LABELS = { base: "Boundaries & basics", eco: "Ecological landscape",
    context: "Context & infrastructure", people: "People & services" };

  function paintCatalog() {
    // required layers are not a choice; say what always comes rather than
    // showing a checkbox nobody may untick
    var always = S.catalog.filter(function (l) { return l.required || l.id === "labels"; });
    // catalogue names can be technical ("Admin boundaries"); this line speaks
    // to a person setting up their first atlas
    var plainNames = { admin: "your region’s boundaries", labels: "place names" };
    var names = always.map(function (l) { return "<b>" + esc(plainNames[l.id] || l.label) + "</b>"; });
    $("#given").innerHTML = "Included in every atlas: " +
      (names.length === 2 ? names.join(" and ") : names.join(", ")) +
      ". Sources are credited on the map.";
    always.forEach(function (l) { S.picked[l.id] = true; });

    var byGroup = {};
    S.catalog.forEach(function (l) {
      if (l.required || l.id === "labels") return;
      (byGroup[l.group || "context"] || (byGroup[l.group || "context"] = [])).push(l);
    });

    var host = $("#cats");
    host.innerHTML = "";
    Object.keys(byGroup).forEach(function (g, gi) {
      var d = document.createElement("details");
      d.className = "cat";
      if (gi === 0) d.open = true;
      d.innerHTML = "<summary>" + esc(GROUP_LABELS[g] || g) + '<span class="cat-n"></span></summary>';
      byGroup[g].forEach(function (l) {
        var lab = document.createElement("label");
        lab.className = "cat-row";
        lab.innerHTML = '<input type="checkbox" value="' + esc(l.id) + '"' +
            (S.picked[l.id] ? " checked" : "") + " />" +
          "<span><b>" + esc(l.label) + "</b>" +
            '<span class="src">' + esc(l.info || "") +
            (l.cost && l.cost !== "free" ? " · needs approval" : "") + "</span></span>";
        lab.querySelector("input").onchange = function () {
          S.picked[l.id] = this.checked;
          paintCounts();
        };
        d.appendChild(lab);
      });
      host.appendChild(d);
    });
    paintCounts();
  }
  function paintCounts() {
    var picked = 0;
    $$("details.cat").forEach(function (d) {
      var boxes = d.querySelectorAll('.cat-row input[type="checkbox"]');
      var on = 0;
      boxes.forEach(function (b) { if (b.checked) on++; });
      picked += on;
      d.querySelector(".cat-n").textContent = on + " of " + boxes.length;
    });
    $("#cat-total").textContent = picked
      ? picked + (picked === 1 ? " open-data layer" : " open-data layers") + " will be added."
      : "No open data chosen. You can add layers any time after the atlas is built.";
  }

  /* ---- 4 · build for real ---- */

  $("#build-go").onclick = function () {
    var btn = this;
    var layers = Object.keys(S.picked).filter(function (k) { return S.picked[k]; });
    if (!layers.length) { msg(3, "Something has gone wrong: not even the boundaries are selected."); return; }
    btn.disabled = true; msg(3, "");
    step(4);
    // "you can safely leave this page" stops being true when a file is riding
    // along: the page is what hands it over once the atlas exists
    if (GEO.canonical && $("#build-leave")) {
      $("#build-leave").textContent = "Your file is added at the end, so keep this page open.";
    }
    $("#done-row").hidden = true;
    $("#log").textContent = "";
    $("#build-title").textContent = "Building your atlas…";
    $("#prog-msg").textContent = "Sending it off…";

    api("instances", {
      method: "POST",
      body: {
        title: $("#f-title").value.trim(),
        org: $("#f-org").value.trim(),
        subtitle: $("#f-desc").value.trim(),
        branding: { orgName: $("#f-org").value.trim() },
        region: {
          iso3: S.iso3,
          level: S.level,
          shapeIDs: S.chosen.map(function (c) { return c.id; }),
        },
        layers: layers,
      },
    }).then(function (r) {
      S.slug = r.slug; S.jobId = r.jobId;
      log("[atlas] " + r.slug);
      if (!r.jobId) { finish(); return; }
      poll();
    }).catch(function (e) {
      btn.disabled = false;
      if (e && (e._status === 401 || e.needsAuth)) {
        // A session can lapse between filling this in and pressing build. The
        // answers are still in memory, so hold on to them, explain in the place
        // the person is actually looking, and come back to the same step.
        S.resumeAtBuild = true;
        $("#flow").hidden = true;
        $("#gate").hidden = false;
        $("#gate-1").hidden = false; $("#gate-2").hidden = true;
        msg("gate", "Your sign-in has lapsed. Sign in again and your answers are still here.");
        $("#g-email").focus();
        return;
      }
      step(3);
      msg(3, errMsg(e));
    });
  };

  function log(line) {
    var el = $("#log");
    el.textContent += line + "\n";
    el.scrollTop = el.scrollHeight;
  }

  var lastStep = "";
  function poll() {
    api("jobs/" + encodeURIComponent(S.jobId)).then(function (j) {
      var pct = Math.max(0, Math.min(100, Number(j.pct) || 0));
      $("#fill").style.transform = "scaleX(" + (pct / 100).toFixed(2) + ")";
      if (j.message) $("#prog-msg").textContent = j.message;
      if (j.step && j.step !== lastStep) { lastStep = j.step; log("[" + j.step + "] " + (j.message || "")); }
      if (j.status === "done") { finish(); return; }
      if (j.status === "failed") {
        $("#build-title").textContent = "The build stopped";
        $("#prog-msg").textContent = "";
        msg(4, j.message || "Something failed while building. Nothing was published.");
        return;
      }
      setTimeout(poll, 1500);
    }).catch(function (e) {
      msg(4, "Lost track of the build: " + errMsg(e) + " — it may still be running.");
    });
  }

  function finish() {
    $("#fill").style.transform = "scaleX(1)";
    $("#build-title").textContent = "Your atlas is ready";
    $("#build-sub").textContent = "Built from open data just now.";
    var go = "../?dataset=" + encodeURIComponent(S.slug);
    $("#open-editor").href = go;
    // The atlas opens itself — a button saying "open your atlas" on a page whose
    // only remaining purpose is to open your atlas is a step for its own sake. It
    // stays hidden unless something goes wrong, where it becomes the way out.
    $("#done-row").hidden = true;

    // the file has waited on the server since the check step; the atlas exists
    // now, so it is told where it belongs and added BEFORE we leave the page —
    // this page is what hands it over, so navigating early would lose it
    if (BENCH && GEO.canonical) {
      $("#prog-msg").textContent = "Adding " + GEO.file.name + " to your atlas…";
      BENCH.bindDataset(S.slug);
      BENCH.commit().then(function () {
        $("#prog-msg").textContent = "Your data is on it — opening your atlas…";
        location.href = go;
      }).catch(function () {
        // stay put: this needs reading, and the button is the way on
        $("#prog-msg").textContent = "Your atlas is built, but your file couldn’t be added " +
          "automatically. Open the atlas and drop it there — it takes a minute.";
        $("#done-row").hidden = false;
        $("#open-editor").focus();
      });
      return;
    }
    $("#prog-msg").textContent = "Opening your atlas…";
    location.href = go;
  }

  boot();
})();
