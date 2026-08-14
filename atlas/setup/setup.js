/* Atlas setup — four questions, then hand over.
 *
 * The wizard that lived here used to do everything: pick a region by drilling
 * country → state → district, choose and style layers, add data, preview and
 * publish. All of that now lives on the atlas itself (/apps/atlas/edit/), so
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
      a.href = "../edit/?dataset=" + encodeURIComponent(i.slug);
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
    api("geo/search?iso3=" + encodeURIComponent(S.iso3) + "&q=" + encodeURIComponent(q) + "&limit=8")
      .then(function (r) {
        if (seq !== searchSeq) return;            // a newer keystroke won
        shown = (r.matches || []).filter(function (m) { return !has(m.id); });
        cursor = -1;
        paintSugg();
      })
      .catch(function (e) {
        if (seq !== searchSeq) return;
        shown = []; closeSugg();
        msg(2, e && e._status === 404 ? "" : errMsg(e));
      });
  }
  box.addEventListener("input", function () {
    clearTimeout(searchTimer);
    var v = this.value;
    searchTimer = setTimeout(function () { search(v); }, 220);
  });
  box.addEventListener("keydown", function (e) {
    if (sugg.hidden) {
      if (e.key === "ArrowDown" && box.value.trim().length >= 2) { e.preventDefault(); search(box.value); }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
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
      S.chosen.push({ id: p.id, name: p.name, label: label || p.name, level: p.level });
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
    var v = $("#verdict");
    if (!S.chosen.length) { v.hidden = true; return; }
    v.hidden = false;
    v.textContent = "Your atlas will cover " + S.chosen.map(function (c) { return c.label; }).join(", ") +
      (S.chosen.length > 1 ? " — " + S.chosen.length + " places" : "") + ". Ready to build.";
  }

  $("#next-2").onclick = function () {
    if (!S.chosen.length) {
      msg(2, "An atlas needs at least one place. Search above to add one.");
      $("#place").focus();
      return;
    }
    msg(2, "");
    step(3);
  };

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
    $("#given").innerHTML = "Included in every atlas: " +
      always.map(function (l) { return "<b>" + esc(l.label) + "</b>"; }).join(", ") +
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
    $("#prog-msg").textContent = "Opening it so you can add your data and style it.";
    $("#open-editor").href = "../edit/?dataset=" + encodeURIComponent(S.slug);
    $("#done-row").hidden = false;
    $("#open-editor").focus();
  }

  boot();
})();
