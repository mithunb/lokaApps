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
    chosen: [], iso3: "", level: 2, catalog: null, picked: {}, worldwide: false,
    slug: "", jobId: "",
    // the logo is not asked for here any more (release 2): it lives in the
    // atlas's own Settings, with the description
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
  /* "something went wrong" tells you nothing you did not already know. The
     bench's version names the step and what the server said, because that is
     the sentence you can pass on to get it fixed. */
  function errMsg(e) {
    var said = e && (e.error || e.message);
    if (said) return said;
    var st = e && e._status;
    if (st === 502 || st === 503 || st === 504) {
      return "The server is being updated right now. Nothing is lost — wait a few seconds and try again.";
    }
    if (st === 0) return "Could not reach the server — check your connection and try again.";
    var where = (e && e._path) || "the server";
    return "Something went wrong here (" + where + " answered " + (st || "nothing") +
      "). Tell us that, and we can fix it.";
  }
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
      // a signed-out visitor now gets a 200 saying so, where the request used
      // to fail; the gate below is what should still happen
      if (!me || !me.email) throw new Error("not signed in");
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
        step(1);
        msg(1, "Signed in again — press Build my atlas.", "ok");
        return;
      }
      var fix = /(^|[?&])fix=([^&]+)/.exec(location.search);
      if (fix) showFixes(decodeURIComponent(fix[2]));
      else if (/(^|[?&])new=1/.test(location.search)) startFlow();
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
      var wrap = document.createElement("div");
      wrap.className = "row-wrap";
      var a = document.createElement("a");
      a.className = "row";
      a.href = "../?dataset=" + encodeURIComponent(i.slug);
      a.innerHTML = '<span class="t"><b>' + esc(i.title || i.slug) + "</b><span>" +
          esc(i.regionLabel || "") + (i.role === "editor" ? " · you were invited to this" : "") + "</span></span>" +
        '<span class="st' + (i.status === "published" ? " live" : "") + '">' +
          (i.status === "published" ? "Live" : "Not live") + "</span>";
      wrap.appendChild(a);

      /* Delete lived only inside an atlas's own Settings — unreachable for the very
         atlas you most want rid of: one whose build failed and which therefore will
         not open. Somebody invited to another person's atlas is not offered it;
         deleting is the owner's alone, as the server already insists. */
      if (i.role !== "editor") {
        var kill = document.createElement("button");
        kill.type = "button";
        kill.className = "kill";
        kill.textContent = "Delete";
        kill.setAttribute("aria-label", "Delete " + (i.title || i.slug));
        kill.onclick = function () { askDelete(i, wrap); };
        wrap.appendChild(kill);
      }
      host.appendChild(wrap);
    });
  }
  /* The question replaces the row rather than floating over it, so the atlas it
     is about stays in view while you read it — and it is named, because "are you
     sure?" about an unnamed thing is how the wrong atlas gets deleted. */
  function askDelete(inst, wrap) {
    var name = inst.title || inst.slug;
    var box = document.createElement("div");
    box.className = "confirm";
    var p = document.createElement("p");
    p.textContent = "Delete \u201c" + name + "\u201d? Its map, its layers and anything " +
      "anyone added to it go for good. Your own files stay with you.";
    box.appendChild(p);
    var row = document.createElement("div");
    row.className = "btnrow";
    var yes = document.createElement("button");
    yes.type = "button"; yes.className = "btn"; yes.textContent = "Delete it";
    var no = document.createElement("button");
    no.type = "button"; no.className = "btn quiet"; no.textContent = "Keep it";
    row.appendChild(yes); row.appendChild(no);
    box.appendChild(row);
    var err = document.createElement("p");
    err.className = "hint"; err.hidden = true;
    box.appendChild(err);
    wrap.replaceWith(box);
    no.focus();                      // the safe one, for a stray Return

    no.onclick = function () { box.replaceWith(wrap); };
    yes.onclick = function () {
      yes.disabled = no.disabled = true;
      p.textContent = "Deleting \u201c" + name + "\u201d\u2026";
      api("instances/" + encodeURIComponent(inst.slug), { method: "DELETE" })
        .then(function () {
          // drop it from what we hold, then redraw: asking the server again
          // would be a round trip to learn something we already know
          if (S.me && S.me.instances) {
            S.me.instances = S.me.instances.filter(function (x) { return x.slug !== inst.slug; });
          }
          showHome();
          var note = $("#deleted-note");
          if (note) { note.textContent = "\u201c" + name + "\u201d was deleted."; note.hidden = false; }
        })
        .catch(function (e) {
          yes.disabled = no.disabled = false;
          p.textContent = "Delete \u201c" + name + "\u201d?";
          err.textContent = errMsg(e);
          err.hidden = false;
        });
    };
  }

  $("#new-atlas").onclick = function () { startFlow(); };

  function startFlow() {
    $("#home").hidden = true;
    $("#gate").hidden = true;
    $("#flow").hidden = false;
    step(2);
    $("#place").focus();
  }

  /* ======================= steps ======================= */

  /* The order the screens are walked in (release 1, October 2026): where the
     work is → (your data, when a file came along) → the open data → the name
     → the build. The panels keep their old numbers — 2 is the place, 3 the
     open data, 1 the name, 4 the build — so every message box, Back button
     and check that names a panel still holds; only this list says what comes
     after what. */
  /* "found" is the screen after the place: what we found — the region a file
     turned out to cover, or the places that were typed — with the file checked
     against it right there. Release 1 had this only when a file came along
     (the "your data" rung); release 2 shows it to everyone, because a typed
     region deserves one look too before open data is chosen for it. */
  function order() { return [2, "found", 3, 1, 4]; }
  function pos(key) { return order().indexOf(key); }

  function step(n) {
    [1, 2, 3, 4].forEach(function (i) { $("#s" + i).hidden = i !== n; });
    // the found panel is not in that numbered set, and forgetting it here left it
    // visible underneath whatever step you moved to — so checking your data looked
    // like it was happening under "Open data"
    if ($("#s2b")) $("#s2b").hidden = true;
    if ($("#s2q")) $("#s2q").hidden = true;
    if (n === 2) loadCountries();
    if (n === 3) loadCatalog();
    if (n === 1) prefillName();
    var here = pos(n);
    $$(".stp").forEach(function (b) {
      var key = b.id === "stp-found" ? "found" : Number(b.dataset.s);
      if (key === n) b.setAttribute("aria-current", "step"); else b.removeAttribute("aria-current");
      // steps already passed stay pressable; the ones ahead wait their turn
      var there = pos(key);
      if (there >= 0 && there <= here) b.disabled = false;
    });
    window.scrollTo({ top: 0 });
  }
  $$(".stp[data-s]").forEach(function (b) { b.onclick = function () { if (!b.disabled) step(Number(b.dataset.s)); }; });
  $$("[data-go]").forEach(function (b) {
    b.onclick = function () {
      // "found" is the way back from the open data: to what we found
      if (b.dataset.go === "found") { showFound(); return; }
      step(Number(b.dataset.go));
    };
  });

  /* ---- 3 · name it (panel 1) ----
     Last, and filled in: the name from the place or the file, the organisation
     from the account when it has one. Whatever was typed here is kept when
     you go Back and come forward again; only an untouched suggestion is
     replaced by a better one. */

  var NAME_AUTO = "";   // the last name this page filled in itself
  function plainFileName(name) {
    var s = String(name || "").replace(/\.[a-z0-9]+$/i, "").replace(/[_\-.]+/g, " ")
      .replace(/\s+/g, " ").trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  }
  function suggestedTitle() {
    if (GEO.file && GEO.file.name) return plainFileName(GEO.file.name);
    if (S.chosen.length) return (S.chosen[0].label || S.chosen[0].name) + " atlas";
    return "";
  }
  function prefillName() {
    var t = $("#f-title"), o = $("#f-org");
    var want = suggestedTitle();
    if (want && (!t.value.trim() || t.value === NAME_AUTO)) { t.value = want; NAME_AUTO = want; }
    var fromAccount = false;
    if (!o.value.trim() && S.me && S.me.org) { o.value = S.me.org; fromAccount = true; }
    else if (S.me && S.me.org && o.value === S.me.org) fromAccount = true;
    var hint = $("#name-hint");
    if (hint) hint.textContent = (fromAccount ? "The organisation is filled in from your account. " : "") +
      "Both show on the map; change either any time.";
  }

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
  // the name screen is the last question, so its check happens on Build itself
  function nameIsComplete() {
    var okTitle = needField("f-title", "Your atlas needs a name. It is what people will see.");
    var okOrg = needField("f-org", "Name the organisation or project this atlas belongs to.");
    var missing = (okTitle ? 0 : 1) + (okOrg ? 0 : 1);
    if (missing) { sayMissing(missing); (okTitle ? $("#f-org") : $("#f-title")).focus(); return false; }
    sayMissing(0);
    return true;
  }
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
    // choosing a place by hand says this atlas is of somewhere after all
    S.worldwide = false;
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
    /* Only the places you typed. The ones a file found are shown inside that
       file's own block, because they came as a set and they leave as a set —
       showing them here too gave one act two homes and two delete buttons. */
    var fromFile = GEO.addedIds || [];
    S.chosen.filter(function (c) { return fromFile.indexOf(c.id) < 0; }).forEach(function (c) {
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
    var empty = $("#chips-empty");
    empty.hidden = S.chosen.length > 0 || S.worldwide;
    if (S.worldwide) {
      empty.hidden = false;
      empty.textContent = "Worldwide — your data is not in one country, so no places are needed.";
    } else if (!S.chosen.length) {
      empty.textContent = "No places yet. Search above to add one.";
    }
    paintFileBlock();      // the file's places live there, and its counts move with them
    // name the chosen place at the field as well as in the chips: a label reading
    // only "Place" beside an empty box made a finished step look untouched
    var chosen = $("#place-chosen");
    if (chosen) {
      chosen.textContent = !S.chosen.length ? ""
        : S.chosen.length === 1 ? S.chosen[0].label
        : S.chosen[0].label + " +" + (S.chosen.length - 1) + " more";
    }
    var v = $("#verdict");
    // an atlas of data that is not in one country covers the world, and is as
    // ready to build as any other
    if (S.worldwide) {
      v.hidden = false;
      v.textContent = "Your atlas will cover the whole world and open on your own places. Ready to build.";
      return;
    }
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
  var GEO = { file: null, canonical: null, rows: 0, addedIds: [], infer: null, points: null, part: "" };

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

  /* The columns that might hold place names, best first.

     This used to take the FIRST column whose heading contained any of fourteen
     words. A form export's first such column is "Name" — the person who filled
     the form in — so twelve people's names were sent to the boundary data,
     nothing came back, and the page said no places were found while the answers
     to "which geographic areas do you work in?" sat five columns to the right.

     Three changes. The words are matched as WORDS, so "Instagram" stops reading
     as "gram", a village. "Name" on its own no longer counts as geographic at
     all — "Village name" still does, through "village". And a heading now only
     buys a place in the ORDER: which column is actually used is settled by the
     boundary data, which is asked about each of them in turn. */
  var READS_GEOGRAPHIC = /\b(where|location|located|locality|place|places|region|regions|area|areas|address|geograph\w*|district|districts|state|states|province|country|village|villages|town|towns|city|cities|taluk\w*|tehsil|mandal|panchayat|ward|block|pin ?code|postcode|zip)\b/i;
  var READS_PERSONAL = /\b(e-?mail|phone|mobile|contact|handle|handles|instagram|linkedin|facebook|twitter|whatsapp|website|url|link|links|timestamp|consent|credited|organisation|organization|institution|company)\b/i;
  var MAX_NAME_COLUMNS = 4;
  /* One request carries every candidate column, and the endpoint takes 2 MB.
     The best-named column always goes; the rest join it while there is room.
     Sending a SAMPLE of a column instead would mean the answer "8 of 12 rows"
     was measured on something other than the file. */
  var COLUMNS_BUDGET = 1400000;

  function nameColumns(c) {
    var text = (c.schema || []).filter(function (s) { return s.type === "string"; });
    if (!text.length) return null;
    var cands = [];
    text.forEach(function (s, at) {
      var vals = (c.rows || []).map(function (r) { return String(r[s.name] == null ? "" : r[s.name]).trim(); })
        .filter(Boolean);
      if (!vals.length) return;
      var chars = 0, words = 0;
      vals.forEach(function (v) { chars += v.length; words += v.split(/\s+/).length; });
      chars /= vals.length; words /= vals.length;
      /* A contact column is never a place, and it wins over every other signal
         here: "Email address" carries the word address and would otherwise
         read as geographic. */
      if (READS_PERSONAL.test(s.name)) return;
      var score = 0;
      if (READS_GEOGRAPHIC.test(s.name)) score += 3;
      if (chars <= 40 && words <= 4) score += 1;          // reads like a label
      if (chars > 200) score -= 1;                        // reads like an essay
      cands.push({ col: s.name, names: vals, score: score, at: at });
    });
    if (!cands.length) return null;
    cands.sort(function (a, b) { return (b.score - a.score) || (a.at - b.at); });
    var out = [], spent = 0;
    cands.forEach(function (x) {
      if (out.length >= MAX_NAME_COLUMNS) return;
      var size = 0;
      x.names.forEach(function (v) { size += v.length + 3; });
      if (out.length && spent + size > COLUMNS_BUDGET) return;
      spent += size;
      out.push({ col: x.col, names: x.names });
    });
    return out;
  }

  /* A form's question becomes the column's heading, and a question can run to
     two hundred characters. Say enough of it to know which column is meant:
     the question itself, where there is one, and never more than one line. */
  function shortCol(name) {
    var t = String(name || "").trim();
    var cut = t.search(/[?(]/);
    if (cut > 8 && cut < 70) t = t.slice(0, t.charAt(cut) === "?" ? cut + 1 : cut).trim();
    return t.length > 64 ? t.slice(0, 62).trim() + "\u2026" : t;
  }

  /* One block for one act. Dropping a file used to produce two separate things —
     a card naming the file, and a chip for each place it found, each with its own
     bare ✕ — so a single act had two homes and two delete buttons, neither of
     which said what it would take with it.

     The file, its counts and the places it found are now one block with one
     worded button. A layer is meaningless without its geography, so they go
     together. The reverse does not hold: geography is perfectly meaningful with
     no layer at all — that is every atlas built from open data — so places you
     typed yourself keep their own chips and their own ✕, and this button never
     touches them. */
  var FILE_STATE = { name: "", note: "", pick: null };

  function showFileCard(name, note) {
    FILE_STATE.name = name || "";
    FILE_STATE.note = note || "";
    paintFileBlock();
  }

  function paintFileBlock() {
    var host = $("#geo-file-card");
    if (!host) return;
    host.innerHTML = "";
    if (!FILE_STATE.name) return;

    var box = document.createElement("div");
    box.className = "filecard";

    var head = document.createElement("div");
    head.className = "filecard-head";
    head.textContent = FILE_STATE.name + (FILE_STATE.note ? " · " + FILE_STATE.note : "");
    box.appendChild(head);

    // waiting on which part of the file to read
    if (FILE_STATE.pick) {
      var ask = document.createElement("div");
      ask.className = "filecard-parts";
      FILE_STATE.pick.entries.forEach(function (en) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "part-opt";
        b.innerHTML = "<b>" + esc(en.label) + "</b><span>" + esc(en.note) + "</span>";
        b.onclick = function () { takePart(GEO.file || { name: FILE_STATE.name }, en); };
        ask.appendChild(b);
      });
      box.appendChild(ask);
    }

    // the places this file found, named — so the button's reach is visible
    var ids = GEO.addedIds || [];
    var mine = S.chosen.filter(function (c) { return ids.indexOf(c.id) >= 0; });
    if (mine.length) {
      var row = document.createElement("div");
      row.className = "filecard-places";
      mine.forEach(function (c) {
        var chip = document.createElement("span");
        chip.className = "chip chip-static";
        chip.textContent = c.label;
        row.appendChild(chip);
      });
      box.appendChild(row);
    }

    var kill = document.createElement("button");
    kill.type = "button";
    kill.className = "filecard-kill";
    // it forgets a file that has not been added to anything yet; its own
    // tooltip has always said so
    kill.textContent = "Forget this file";
    kill.title = mine.length
      ? "Forget this file and the " + mine.length + " place" + (mine.length > 1 ? "s" : "") + " it found"
      : "Forget this file";
    kill.setAttribute("aria-label", kill.title);
    kill.onclick = function () {
      // the file and the places it found leave together; anything typed by hand stays
      if ((GEO.addedIds || []).length) {
        S.chosen = S.chosen.filter(function (c) { return GEO.addedIds.indexOf(c.id) < 0; });
        if (S.chosen.length) S.level = Math.max.apply(null, S.chosen.map(function (c) { return c.level || 2; }));
      }
      FILE_STATE.name = ""; FILE_STATE.note = ""; FILE_STATE.pick = null;
      msg(2, "");
      GEO.file = null; GEO.canonical = null; GEO.rows = 0; GEO.addedIds = [];
      GEO.infer = null; GEO.points = null; GEO.part = "";
      if (BENCH) { BENCH.destroy(); BENCH = null; BENCH_KEY = ""; }
      paintChips();          // redraws the chips and, through them, this block
    };
    box.appendChild(kill);
    host.appendChild(box);
  }

  function placesFromFile(file) {
    if (!window.LokaIngest) { msg(2, "The file reader didn’t load — reload the page and try again."); return; }
    msg(2, "Reading " + file.name + "…", "ok");
    GEO.file = file;               // a part may be chosen after this returns
    FILE_STATE.pick = null;
    showFileCard(file.name, "reading…");
    LokaIngest.fromFile(file, function (err, res) {
      if (err) { msg(2, "That file couldn’t be read: " + err.message); showFileCard(null); return; }
      if (res.kind === "unsupported") { msg(2, res.message); showFileCard(null); return; }
      /* A workbook, or a file mixing shape types: ask which part to read.

         This used to take the first and carry on. A workbook's first sheet is
         usually the right one and sometimes emphatically is not — a form's
         responses sat in front of four other sheets holding a timeline, a
         contact list, a list of programmes and a grant, and there was no way
         to reach any of them. The data step has asked this question since it
         was written; this step simply never did. */
      if (res.kind === "sheets") {
        return askWhichPart(file, "That workbook has several sheets — which one holds the places?",
          res.sheets.map(function (sh) {
            return { name: sh.name, label: sh.name,
                     note: sh.rows.toLocaleString() + " rows × " + sh.cols + " columns",
                     part: "sheet “" + sh.name + "”",
                     pick: function (cb) { res.pick(sh.name, cb); } };
          }));
      }
      if (res.kind === "classes") {
        return askWhichPart(file, "That file mixes shapes — which of them should the atlas read?",
          res.classes.map(function (c) {
            return { name: c.cls, label: c.label, note: c.count.toLocaleString() + " shapes",
                     part: c.label,
                     pick: function (cb) { res.pick(c.cls, cb); } };
          }));
      }
      if (res.kind !== "table") { msg(2, "That file couldn’t be read."); showFileCard(null); return; }
      useCanonical(res.canonical, file, "");
    });
  }

  /* One part of a file, chosen rather than assumed.

     One entry means there is nothing to ask, so it is taken straight away —
     asking a question with a single answer is not a choice, it is a delay. */
  function askWhichPart(file, question, entries) {
    if (entries.length === 1) return takePart(file, entries[0]);
    FILE_STATE.pick = { question: question, entries: entries };
    showFileCard(file.name, entries.length + " sheets");
    msg(2, question, "ok");
  }

  function takePart(file, en) {
    FILE_STATE.pick = null;
    showFileCard(file.name, "reading “" + en.label + "”…");
    en.pick(function (err, out) {
      if (err || !out || out.kind !== "table") {
        msg(2, (out && out.message) || "That part couldn’t be read.");
        showFileCard(null);
        return;
      }
      useCanonical(out.canonical, file, en.part);
    });
  }

  function useCanonical(c, file, part) {
    var rows = (c.rows || []).length;
    GEO.file = file; GEO.canonical = c; GEO.rows = rows; GEO.part = part || "";
    var pts = pointsFrom(c);
    GEO.points = pts; GEO.infer = null;   // what the found screen draws from
    var cols = pts ? null : nameColumns(c);
    if (!pts && !cols) {
      msg(2, "This file has no coordinates and no column that reads like place names, so it can’t " +
        "say where it belongs. Search for the place above instead.");
      showFileCard(file.name, rows + " rows · couldn’t find places");
      return;
    }
    if (!pts && !S.iso3) {
      msg(2, "Place names can’t say which country they are in — choose the country above, then drop the file again.");
      showFileCard(file.name, rows + " rows");
      return;
    }
    showFileCard(file.name, rows + " rows" + (part ? " · " + part : "") + " · finding places…");
    msg(2, "Reading all " + rows.toLocaleString() + " rows to find the places…", "ok");
    // several columns may read like places; the boundary data settles which
    var body = pts ? { iso3: S.iso3, points: pts } : { iso3: S.iso3, columns: cols };
    api("geo/infer", { method: "POST", body: body })
      .then(function (d) { applyInferred(d, file, rows, !!pts); })
      .catch(function (e) {
        msg(2, e && e.needsCountry ? "Choose the country above, then drop the file again." : errMsg(e));
        showFileCard(file.name, rows + " rows");
      });
  }

  /* Rows that name a whole country, said plainly instead of guessed at.

     "India" used to be placed in Indi, a taluk five hundred kilometres from
     Bengaluru, because the two spellings are close enough for the spelling
     guesser. Neither a country nor a phrase like "Pan India" has a single
     place on a map, so the honest answer is to count them and say so — not to
     find them somewhere. */
  function wholeCountryNote(d) {
    var out = "";
    if (d && d.countryRows) {
      out += " " + d.countryRows.toLocaleString() + " row" + (d.countryRows > 1 ? "s cover" : " covers") +
        " the whole country, so there is no one place to put " + (d.countryRows > 1 ? "them" : "it") + ".";
    }
    if (d && d.outsideRows) {
      var names = (d.outsideNames || []).join(", ");
      out += " " + d.outsideRows.toLocaleString() + " name" + (d.outsideRows > 1 ? "" : "s") +
        " somewhere outside this country" + (names ? " (" + names + ")" : "") + ".";
    }
    return out;
  }

  /* The data turned out not to be of one country.

     No question is asked about this, because there is nothing to decide: a
     record of sightings across four countries HAS no country, and an atlas of
     it has no region. The wizard says what it found and carries on — the open
     data step will then offer almost nothing, which is the truthful answer at
     that width rather than a second thing to choose. */
  function goWorldwide(d, file, rows) {
    GEO.infer = d || null;
    S.worldwide = true;
    S.chosen = [];
    paintChips();
    var why = d && d.shareInside != null
      ? "Only " + Math.round(d.shareInside * 100) + "% of your places are in " +
        ($("#country").selectedOptions[0] || {}).textContent + "."
      : (d && (d.outsideNames || []).length
          ? "Some of your places are elsewhere (" + d.outsideNames.slice(0, 3).join(", ") + ")."
          : "");
    msg(2, why + " This data is not of one country, so the atlas will cover the whole world " +
      "and open on your own places. Base layers built from open data need a region, so there " +
      "will be very few to choose from.", "ok");
    showFileCard(file.name, rows + " rows \u00b7 worldwide");
  }

  function applyInferred(d, file, rows, fromPoints) {
    if (d && d.worldwide) { goWorldwide(d, file, rows); return; }
    GEO.infer = d || null;   // kept: the found screen says the same numbers and draws the places
    /* Which column was read is part of the answer, and when nothing is found it
       is the WHOLE answer: "no places found" sent somebody hunting for a fault
       in their data when the page had simply read the wrong column. */
    var how = fromPoints ? "coordinates"
      : (d && d.column ? "the “" + shortCol(d.column) + "” column"
                       : "the place names in your file");
    var units = (d && d.units) || [];
    if (!units.length) {
      msg(2, "We read " + how + " and couldn’t match any of it to a place we know." +
        wholeCountryNote(d) +
        " Search for the place above instead — your data will still go on the atlas afterwards.");
      showFileCard(file.name, rows + " rows · no places found");
      return;
    }
    var had = S.chosen.map(function (c) { return c.id; });
    units.forEach(function (u) { add({ id: u.id, name: u.name, level: d.level, bbox: u.bbox }, u.name); });
    GEO.addedIds = S.chosen.map(function (c) { return c.id; })
      .filter(function (id) { return had.indexOf(id) < 0; });
    // add() painted the chips as each place arrived, before this list existed —
    // so they were drawn as loose chips, and then a moment later also inside the
    // file's block. Paint once more now the list is known, and they sit in one
    // place only.
    paintChips();
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
    said += wholeCountryNote(d);
    said += " Take any out, or search to add more.";
    msg(2, said, "ok");
    /* The card used to count only the places this file ADDED to the selection,
       so a file whose places you had already chosen read "0 places found"
       directly under a sentence saying they had been found. Two lines of the
       same screen disagreeing. Report what the file's places ARE. */
    var found = S.chosen.length;
    showFileCard(file.name, rows + " rows · " + found + " place" + (found === 1 ? "" : "s") +
      (added ? "" : " (already chosen)"));
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

  /* ---- 2c · what we found: the region confirmed, the file checked against it ----
     One screen for two things that were two. Release 1 had a "your data" step
     after the place, only when a file came along, where the file went to the
     server once as pending work and was matched against the chosen places.
     Release 2 folds that into a confirm screen everyone sees: what we found —
     the places, how many rows landed in them, a small map of it — with the
     file's check running underneath on the same page, so the number at the top
     is the number the check settles on.

     The file goes to the server ONCE, here: there is no atlas yet to attach it
     to, so it carries the region instead and waits. This is also the only
     moment the fix-list exists — after the build it is gone — which is why
     checking happens before Open data rather than after. */

  var BENCH = null, BENCH_KEY = "";
  // what the last look said: rows, rows placed, rows still open. Read by the
  // buttons below (the 60% rule) and carried to the atlas for its first look.
  var FOUND = { rows: 0, placed: 0, open: 0, settled: false, rep: null };
  // Under this share of rows placed, the first offer is to choose the places
  // by hand: a file that mostly missed was read from the wrong column or the
  // wrong country, and "continue" would build an atlas of somewhere else.
  var LOW_COVER = 0.6;

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

  function placeList(names) {
    if (names.length <= 1) return names.join("");
    if (names.length === 2) return names[0] + " and " + names[1];
    if (names.length <= 4) return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
    return names.slice(0, 3).join(", ") + " and " + (names.length - 3) + " more";
  }
  function countryName() {
    var o = $("#country") && $("#country").selectedOptions[0];
    return o ? o.textContent : "";
  }
  function rowsWord(n) { return n === 1 ? " row" : " rows"; }

  /* The screen's words, from what is known right now. Before the check runs
     the count is the one the region-finding gave ("name a place we know");
     once the check has settled it is the check's ("are on the map"), which
     is the number that will be true of the atlas. */
  function paintFound() {
    var lede = $("#found-lede"), num = $("#found-num"), what = $("#found-what"), say = $("#found-say");
    var d = GEO.infer || null;
    var names = S.chosen.map(function (c) { return c.label; });
    if (GEO.canonical) {
      lede.textContent = "Read from " + GEO.file.name + (GEO.part ? " (" + GEO.part + ")" : "") + ". " +
        "Your file is checked against these places here, before anything is built.";
    } else {
      lede.textContent = "The places you chose. Add or take out any of them on the Where step.";
    }
    var rows = GEO.canonical ? (FOUND.settled ? FOUND.rows : ((d && d.rows) || GEO.rows || 0)) : 0;
    var placed = FOUND.settled ? FOUND.placed : (d && d.matchedRows) || 0;
    if (S.worldwide) {
      num.textContent = "Worldwide";
      what.textContent = "";
      say.textContent = "Your data is not in one country, so the atlas will cover the whole world and " +
        "open on your own places. Base layers built from open data need a region, so there will be very few to choose from.";
    } else if (!GEO.canonical) {
      num.textContent = names.length + (names.length === 1 ? " place" : " places");
      what.textContent = countryName() ? "in " + countryName() : "";
      say.textContent = "Your atlas will cover " + placeList(names) + ".";
    } else if (!rows) {
      num.textContent = GEO.rows.toLocaleString() + rowsWord(GEO.rows);
      what.textContent = "";
      say.textContent = "We could not read places out of the file, so it is checked against " +
        placeList(names) + " — the places you chose.";
    } else {
      num.textContent = placed.toLocaleString() + " of " + rows.toLocaleString();
      what.textContent = FOUND.settled ? "rows are on the map" : "rows name a place we know";
      var s = names.length ? "In " + placeList(names) + "." : "";
      var left = Math.max(0, rows - placed);
      if (d && !FOUND.settled) {
        if (d.sharedRows) s += " " + d.sharedRows.toLocaleString() + rowsWord(d.sharedRows) +
          (d.sharedRows > 1 ? " name" : " names") + " a place that exists in more than one part of the country — we took the ones nearest the rest of your data.";
        if (d.unreadRows) s += " " + d.unreadRows.toLocaleString() + rowsWord(d.unreadRows) + " we couldn’t read.";
        s += wholeCountryNote(d);
      }
      if (FOUND.settled && FOUND.rep) s += " " + checkSays(FOUND.rep);
      else if (left) s += " " + left.toLocaleString() + rowsWord(left) + (left > 1 ? " name" : " names") + " no place yet.";
      say.textContent = s;
    }
    var chips = $("#found-chips");
    chips.innerHTML = "";
    chips.hidden = !names.length;
    S.chosen.forEach(function (c) {
      var el = document.createElement("span");
      el.className = "chip chip-static";
      el.textContent = c.label;
      chips.appendChild(el);
    });
    drawFoundMap();
    paintFoundButtons();
  }

  // what share of the rows landed: the check's answer once it has one, else the
  // region-finding's; null when there is no file to speak of
  function foundShare() {
    if (!GEO.canonical || S.worldwide) return null;
    if (FOUND.settled) return FOUND.rows ? FOUND.placed / FOUND.rows : null;
    var d = GEO.infer;
    if (!d || !d.rows) return null;
    return (d.matchedRows || 0) / d.rows;
  }

  /* The 60% rule. Above it the green button carries on and the other offers
     the search; below it they swap: choosing the places is first, and carrying
     on is allowed but plainly second. The two buttons keep their ids; only
     their words, their weight and their order change. */
  function paintFoundButtons() {
    var on = $("#next-2b"), mine = $("#found-mine"), row = $("#found-btns"), back = $("#found-back");
    var share = foundShare();
    // rows that are villages are not a wrong region: the offer to put them
    // on as points speaks for them, and searching again would not help
    var low = share != null && share < LOW_COVER && !pointsOfferWanted(FOUND.rep) && !FOUND.asPoints;
    on.className = low ? "btn secondary" : "btn";
    on.textContent = low ? "Continue anyway" : "Looks right →";
    mine.className = low ? "btn" : "btn secondary";
    mine.textContent = GEO.canonical ? "Choose the places myself" : "Change the places";
    mine.dataset.low = low ? "1" : "";
    // the primary act comes first in the row, whichever button it is
    row.insertBefore(low ? mine : on, back.nextSibling);
    var note = $("#found-low");
    if (note) {
      note.hidden = !low;
      if (low) note.textContent = "Fewer than " + Math.round(LOW_COVER * 100) + "% of your rows landed in a place we know. " +
        "The file may name places another way, or be of somewhere else — searching for the right places is the surer way on.";
    }
  }

  /* ---- the small map: where the rows fall ----
     Drawn once, as plain shapes, from what the region-finding already sent
     back (the matched places' outlines ride along with the answer when there
     are 60 or fewer) and the file's own coordinates when it had any. No map
     library: the setup page does not load one, and a dot plot is what the
     question needs — "is this the right part of the country?" — not a map
     to pan. Rows placed by name have no point of their own, so those places
     are shaded instead of dotted. */
  function drawFoundMap() {
    var fig = $("#found-map"), cap = $("#found-map-cap");
    if (!fig) return;
    var units = ((GEO.infer && GEO.infer.units) || []).filter(function (u) { return u.geometry && u.geometry.coordinates; });
    var pts = (GEO.canonical && GEO.points) || [];
    if (!units.length && !pts.length) { fig.hidden = true; return; }
    fig.hidden = false;
    var W = 400, H = 260, PAD = 14;
    var bb = [180, 90, -180, -90];
    function grow(x, y) {
      if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y;
    }
    units.forEach(function (u) {
      if (u.bbox && u.bbox.length === 4) { grow(u.bbox[0], u.bbox[1]); grow(u.bbox[2], u.bbox[3]); }
      else (function walk(c) {
        if (typeof c[0] === "number") { grow(c[0], c[1]); return; }
        for (var i = 0; i < c.length; i++) walk(c[i]);
      })(u.geometry.coordinates);
    });
    // the frame follows the places; dots outside them fall off the edge, which
    // is what "not placed" looks like. Only when there are no places at all
    // does the frame follow the dots.
    if (!units.length) pts.forEach(function (p) { grow(p[0], p[1]); });
    var cosL = Math.cos((bb[1] + bb[3]) / 2 * Math.PI / 180) || 1;
    var dx = Math.max((bb[2] - bb[0]) * cosL, 1e-4), dy = Math.max(bb[3] - bb[1], 1e-4);
    var k = Math.min((W - 2 * PAD) / dx, (H - 2 * PAD) / dy);
    var ox = (W - dx * k) / 2, oy = (H - dy * k) / 2;
    var px = function (lon) { return ox + (lon - bb[0]) * cosL * k; };
    var py = function (lat) { return oy + (bb[3] - lat) * k; };
    var out = [];
    units.forEach(function (u) {
      var d = "";
      (function rings(c, depth) {
        if (typeof c[0][0] === "number") {           // a ring
          var lx = null, ly = null;
          for (var i = 0; i < c.length; i++) {
            var x = px(c[i][0]), y = py(c[i][1]);
            // thin the ring to what a screen can show: a vertex under a pixel
            // from the last one drawn adds nothing but bytes
            if (lx != null && Math.abs(x - lx) < 0.7 && Math.abs(y - ly) < 0.7 && i < c.length - 1) continue;
            d += (lx == null ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
            lx = x; ly = y;
          }
          d += "Z";
          return;
        }
        for (var j = 0; j < c.length; j++) rings(c[j], depth + 1);
      })(u.geometry.coordinates, 0);
      out.push('<path class="fm-unit' + (pts.length ? "" : " fm-unit-named") + '" d="' + d + '"/>');
    });
    // the dots: one per row with coordinates, thinned to the pixel so a
    // thousand rows in one village are drawn once, not a thousand times
    var seen = {}, drawn = 0;
    for (var i = 0; i < pts.length && drawn < 3000; i++) {
      var x = px(pts[i][0]), y = py(pts[i][1]);
      if (x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
      var cell = Math.round(x) + "," + Math.round(y);
      if (seen[cell]) continue;
      seen[cell] = true; drawn++;
      out.push('<circle class="fm-dot" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.6"/>');
    }
    // names, when there are few enough to read — and only on a place drawn
    // wide enough to carry one: a far-off place makes the rest small, and a
    // name on a smudge is a smudge
    if (units.length <= 12) {
      units.forEach(function (u) {
        var c = geomCentre(u.geometry);
        if (!c) return;
        if (u.bbox && u.bbox.length === 4 && (px(u.bbox[2]) - px(u.bbox[0])) < 28) return;
        out.push('<text class="fm-name" x="' + px(c[0]).toFixed(1) + '" y="' + py(c[1]).toFixed(1) + '">' + esc(u.name) + "</text>");
      });
    }
    var svg = fig.querySelector("svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.innerHTML = out.join("");
    if (cap) cap.textContent = pts.length
      ? (units.length ? "Your rows as dots, over the places they landed in." : "Your rows as dots.")
      : "The places your rows name, shaded.";
    fig.setAttribute("aria-label", cap ? cap.textContent : "Map of what we found");
  }

  function showFound() {
    [1, 2, 3, 4].forEach(function (i) { $("#s" + i).hidden = true; });
    $("#s2q").hidden = true;
    $("#s2b").hidden = false;
    $$(".stp").forEach(function (b) { b.removeAttribute("aria-current"); });
    var rung = $("#stp-found");
    if (rung) { rung.disabled = false; rung.setAttribute("aria-current", "step"); }
    window.scrollTo({ top: 0 });
    msg("2b", "");
    if (!GEO.canonical) { stopBench(); paintFound(); return; }
    paintFound();
    startBench();
  }

  function stopBench() {
    if (BENCH) { BENCH.destroy(); BENCH = null; }
    BENCH_KEY = "";
    FOUND = { rows: 0, placed: 0, open: 0, settled: false, rep: null };
    paintPointsOffer();
    var v = $("#check-verdict"), bar = $("#check-working");
    if (v) { v.hidden = true; v.textContent = ""; }
    if (bar) bar.hidden = true;
  }

  function startBench() {
    var key = S.iso3 + "|" + S.level + "|" +
      S.chosen.map(function (c) { return c.id; }).sort().join(",");
    if (BENCH && BENCH_KEY === key) return;        // already checked against these places
    if (BENCH) { BENCH.destroy(); BENCH = null; }
    BENCH_KEY = key;
    FOUND = { rows: 0, placed: 0, open: 0, settled: false, rep: null };
    var v = $("#check-verdict");
    v.hidden = false;
    v.classList.remove("err");
    v.textContent = "Checking " + GEO.file.name + " against these places…";
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
          var bar = $("#check-working");
          if (bar) bar.hidden = true;      // the answer is in; the work is over
          FOUND.rows = sum.rows || 0;
          FOUND.placed = Math.min(sum.features || 0, FOUND.rows);
          FOUND.open = sum.needsAttention || 0;
          FOUND.settled = true;
          FOUND.rep = benchReport();
          FOUND.asPoints = false;
          $("#bench").hidden = false;
          paintPointsOffer();
          // the headline takes the check's number. Rows to look at are no
          // longer picked from a list under the table (release 3): the words
          // above say how many, and the question screen after this one asks.
          var v = $("#check-verdict");
          v.classList.remove("err");
          v.hidden = true;
          v.textContent = "";
          paintFound();
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
    if (!S.chosen.length && !S.worldwide) {
      msg(2, "An atlas needs at least one place. Search above to add one.");
      $("#place").focus();
      return;
    }
    msg(2, "");
    showFound();
  };

  $("#next-2b").onclick = function () { msg("2b", ""); afterFound(); };

  /* ================= release 3: same-name places, and villages =================

     The check (the bench above) has joined the file's rows to the places it
     can see. Three things can be left over, and each gets said plainly:
       · a name that means more than one place, which the rows around it could
         not settle — asked on the next screen, one name at a time;
       · a place the model guessed a spelling for (release 4) — listed there
         to confirm or change;
       · a row whose place has no outline at all, usually a village, which the
         outlines stop short of — offered as a point, looked up by name.
     Rows put by their neighbours need nothing now; they are listed on the
     finished atlas to check. */

  function benchReport() {
    var r = BENCH && BENCH.state && BENCH.state.result;
    return (r && r.matchReport) || null;
  }
  function benchImport() {
    var r = BENCH && BENCH.state && BENCH.state.result;
    return (r && r.importId) || "";
  }
  // a fresh answer from the server becomes the bench's answer too, so the
  // file it adds to the atlas at the end is the one fixed here
  function takeResult(r) {
    if (BENCH && BENCH.state) BENCH.state.result = r;
    var rep = r.matchReport || {};
    FOUND.rep = rep;
    FOUND.placed = Math.min((r.stats && r.stats.features) || 0, FOUND.rows);
    FOUND.open = (rep.ambiguous || []).length + (rep.unmatched || []).length;
  }
  function n(x) { return Number(x || 0).toLocaleString(); }
  function plural(k, one, many) { return k === 1 ? one : many; }
  // where a place is, in words: "Raghopur, Vaishali" — its district when the
  // boundary knows it, else what it sits in
  function whereIs(c) {
    var up = c.area || c.parent || "";
    return up && up !== c.name ? c.name + ", " + up : c.name;
  }

  function checkSays(rep) {
    var bits = [];
    var nb = (rep.byNeighbours || []).length;
    var ql = questionsFrom(rep), qs = ql.length;
    var same = ql.filter(function (q) { return q.sameName; }).length, spell = qs - same;
    var guess = (rep.suggested || []).length;
    var none = (rep.unmatched || []).length;
    if (nb) bits.push(n(nb) + plural(nb, " row was", " rows were") + " put by their neighbours: the name is shared, " +
      "and only one of those places is among your other rows. You can check " + plural(nb, "it", "them") + " on the finished atlas.");
    if (qs) bits.push([
      same ? n(same) + plural(same, " name could", " names could") + " mean more than one place" : "",
      spell ? n(spell) + plural(spell, " name is", " names are") + " spelled unlike any place we know" : "",
    ].filter(Boolean).join(", and ") + " — " + plural(qs, "one question follows.", n(qs) + " questions follow."));
    if (guess) bits.push("We guessed the spelling of " + n(guess) + plural(guess, " place", " places") + " — check " +
      plural(guess, "it", "them") + " next.");
    if (none && rep.strategy === "coordinates") bits.push(n(none) + rowsWord(none) + plural(none, " has", " have") +
      " no point yet; " + plural(none, "it waits", "they wait") + " on the finished atlas to be given one.");
    else if (none) bits.push(n(none) + rowsWord(none) + " name no place we have an outline for" +
      (pointsOfferWanted(rep) ? " — see below." : "; they wait on the finished atlas to be given one."));
    if (!bits.length) bits.push("Nothing to fix.");
    return bits.join(" ");
  }

  /* ---- the question screen ---- */

  // one question per name, in the order the rows first say it
  function questionsFrom(rep) {
    var by = {}, out = [];
    ((rep && rep.ambiguous) || []).forEach(function (a) {
      if (!a.candidates || !a.candidates.length) return;
      var k = String(a.name || "").trim().toLowerCase();
      if (!by[k]) {
        by[k] = { name: String(a.name || "").trim(), rows: [], sameName: !!a.sameName,
                  candidates: a.candidates.slice(0, 4) };
        out.push(by[k]);
      }
      by[k].rows.push(a.row);
    });
    return out;
  }

  var Q = { list: [], at: 0, guesses: [], home: null };

  function afterFound() {
    var rep = FOUND.rep;
    if (!GEO.canonical || !rep || !benchImport()) { step(3); return; }
    Q.list = questionsFrom(rep);
    Q.guesses = (rep.suggested || []).slice();
    Q.home = rep.home || null;
    Q.at = 0;
    if (Q.list.length) showQuestion();
    else if (Q.guesses.length) showGuesses();
    else step(3);
  }

  function showQPanel() {
    [1, 2, 3, 4].forEach(function (i) { $("#s" + i).hidden = true; });
    $("#s2b").hidden = true;
    $("#s2q").hidden = false;
    var rung = $("#stp-found");
    if (rung) { rung.disabled = false; rung.setAttribute("aria-current", "step"); }
    window.scrollTo({ top: 0 });
    msg("2q", "");
  }

  function showQuestion() {
    var q = Q.list[Q.at];
    if (!q) { if (Q.guesses.length) showGuesses(); else step(3); return; }
    showQPanel();
    $("#q-ask").hidden = false;
    $("#q-guess").hidden = true;
    var many = Q.list.length > 1;
    $("#q-count").textContent = many ? "Question " + (Q.at + 1) + " of " + Q.list.length : "One question";
    var rows = q.rows.length;
    $("#q-title").textContent = q.sameName ? "Which " + q.name + " did you mean?" : "Which place is “" + q.name + "”?";
    var home = q.candidates.some(function (c) { return c.km != null; });
    $("#q-intro").textContent = (rows > 1 ? n(rows) + " rows say “" + q.name + "”. " : "One row says “" + q.name + "”. ") +
      (q.sameName
        ? n(q.candidates.length) + " places have that name" + (home ? ". The one nearest your other places is first." : ".")
        : "No place is spelled quite like that. " + (q.candidates.length === 1 ? "This is the closest one."
          : "These are the closest" + (home ? ", nearest your other places first." : ".")));
    var box = $("#q-opts");
    box.innerHTML = "";
    q.candidates.forEach(function (c, i) {
      var lab = document.createElement("label");
      lab.className = "q-opt";
      var meta = c.inside ? "inside the area your other places cover"
        : c.km != null ? "about " + n(c.km) + " km from your other places" : "";
      lab.innerHTML = '<input type="radio" name="q-pick" value="' + esc(c.code) + '"' + (i === 0 ? " checked" : "") + ">" +
        '<span class="q-num" aria-hidden="true">' + (i + 1) + "</span>" +
        '<span class="q-what"><b>' + esc(whereIs(c)) + "</b>" +
        (i === 0 ? ' <span class="q-tag">suggested</span>' : "") +
        (meta ? '<span class="q-meta">' + esc(meta) + "</span>" : "") + "</span>";
      lab.querySelector("input").onchange = paintUse;
      box.appendChild(lab);
    });
    $("#q-all-wrap").hidden = rows < 2;
    $("#q-all").checked = true;
    $("#q-all-text").textContent = "Same for all " + n(rows) + " rows that say “" + q.name + "”";
    var nextQ = Q.list[Q.at + 1];
    $("#q-next").textContent = (nextQ ? "Next: “Which " + nextQ.name + " did you mean?” · " : "") +
      "Skipped rows wait on the finished atlas under “rows that need a place”.";
    drawQMap(q);
    paintUse();
  }
  function picked() {
    var r = document.querySelector('#q-opts input[name="q-pick"]:checked');
    var q = Q.list[Q.at];
    if (!r || !q) return null;
    for (var i = 0; i < q.candidates.length; i++) if (String(q.candidates[i].code) === r.value) return q.candidates[i];
    return null;
  }
  function paintUse() {
    var c = picked();
    $("#q-use").textContent = c ? "Use " + whereIs(c) + " →" : "Use this →";
  }

  // fixes go to the same place the bench's own list sent them
  function resolve(fixes) {
    return api("layers/resolve", { method: "POST", body: { importId: benchImport(), fixes: fixes, draft: false } })
      .then(function (r) { takeResult(r); return r; });
  }
  function answer(skip) {
    var q = Q.list[Q.at], c = picked();
    if (!q || (!skip && !c)) return;
    var all = rows1(q);
    var fixes = all.map(function (row) { return skip ? { row: row, skip: true } : { row: row, code: String(c.code) }; });
    var btns = [$("#q-use"), $("#q-skip")];
    btns.forEach(function (b) { b.disabled = true; });
    resolve(fixes).then(function () {
      q.rows = q.rows.filter(function (r) { return all.indexOf(r) < 0; });
      if (!q.rows.length) Q.at++;
      showQuestion();
    }).catch(function (e) { msg("2q", errMsg(e)); })
      .then(function () { btns.forEach(function (b) { b.disabled = false; }); });
  }
  // every row with this name, or only the first when "same for all" is off
  function rows1(q) { return $("#q-all").checked || q.rows.length < 2 ? q.rows.slice() : [q.rows[0]]; }
  $("#q-use").onclick = function () { answer(false); };
  $("#q-skip").onclick = function () { answer(true); };
  $("#q-back").onclick = function () {
    if ($("#q-guess").hidden && Q.at > 0) { Q.at--; showQuestion(); return; }
    if (!$("#q-guess").hidden && Q.list.length) { Q.at = Q.list.length - 1; showQuestion(); return; }
    showFound();
  };
  $("#g-back").onclick = function () { $("#q-back").onclick(); };

  /* The model's spellings (release 4): placed, and marked as a guess until
     somebody looks. Keeping one is confirming it; changing it picks another
     place from the same short list. Either way it stops being a guess. */
  function showGuesses() {
    showQPanel();
    $("#q-ask").hidden = true;
    $("#q-guess").hidden = false;
    $("#q-count").textContent = Q.list.length ? "Last check" : "One check";
    $("#q-title").textContent = "We guessed these spellings — check them";
    $("#q-intro").textContent = "These names matched no place exactly, so we picked the closest. " +
      "Keep the ones that are right; change the rest, or leave them off the map for now.";
    var list = $("#q-guess-list");
    list.innerHTML = "";
    Q.guesses.forEach(function (g) {
      var li = document.createElement("li");
      var opts = [{ code: g.code, name: g.place, parent: g.parent, area: g.area }].concat((g.candidates || []).filter(function (c) {
        return String(c.code) !== String(g.code);
      }));
      li.innerHTML = '<span class="g-name">“' + esc(g.name) + "”</span>" +
        '<label class="g-pick"><span class="sr">Place for ' + esc(g.name) + "</span><select data-row=\"" + g.row + "\">" +
        opts.map(function (c, i) {
          return '<option value="' + esc(c.code) + '">' + esc(whereIs(c)) + (i === 0 ? " (our guess)" : "") + "</option>";
        }).join("") + '<option value="">Leave it off for now</option></select></label>';
      list.appendChild(li);
    });
    $("#q-next").textContent = "Anything left off waits on the finished atlas under “rows that need a place”.";
    $("#q-map").hidden = true;
  }
  $("#g-ok").onclick = function () {
    var fixes = $$("#q-guess-list select").map(function (s) {
      var row = Number(s.dataset.row);
      return s.value ? { row: row, code: s.value } : { row: row, skip: true };
    });
    var b = this;
    b.disabled = true;
    resolve(fixes).then(function () { Q.guesses = []; step(3); })
      .catch(function (e) { msg("2q", errMsg(e)); })
      .then(function () { b.disabled = false; });
  };

  /* A small map for the question: the area the other rows cover, and each
     place of that name as a numbered dot. Only drawn when the places have a
     position and there are few enough to tell apart. */
  function drawQMap(q) {
    var fig = $("#q-map");
    var pts = q.candidates.filter(function (c) { return c.at; });
    if (pts.length < 2) { fig.hidden = true; return; }
    fig.hidden = false;
    var W = 400, H = 240, PAD = 22;
    var bb = [180, 90, -180, -90];
    function grow(x, y) {
      if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y;
    }
    pts.forEach(function (c) { grow(c.at[0], c.at[1]); });
    if (Q.home) { grow(Q.home[0], Q.home[1]); grow(Q.home[2], Q.home[3]); }
    var cosL = Math.cos((bb[1] + bb[3]) / 2 * Math.PI / 180) || 1;
    var dx = Math.max((bb[2] - bb[0]) * cosL, 0.05), dy = Math.max(bb[3] - bb[1], 0.05);
    var k = Math.min((W - 2 * PAD) / dx, (H - 2 * PAD) / dy);
    var ox = (W - dx * k) / 2, oy = (H - dy * k) / 2;
    var px = function (lon) { return ox + (lon - bb[0]) * cosL * k; };
    var py = function (lat) { return oy + (bb[3] - lat) * k; };
    var out = [];
    if (Q.home) {
      var x0 = px(Q.home[0]), y0 = py(Q.home[3]), x1 = px(Q.home[2]), y1 = py(Q.home[1]);
      out.push('<rect class="qm-home" x="' + x0.toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + (x1 - x0).toFixed(1) +
        '" height="' + (y1 - y0).toFixed(1) + '" rx="4"/>');
      out.push('<text class="fm-name qm-home-t" x="' + ((x0 + x1) / 2).toFixed(1) + '" y="' + (y1 + 13 > H - 2 ? y0 - 5 : y1 + 13).toFixed(1) +
        '">your other places</text>');
    }
    pts.forEach(function (c) {
      var i = q.candidates.indexOf(c) + 1, x = px(c.at[0]), y = py(c.at[1]);
      out.push('<circle class="qm-dot' + (i === 1 ? " qm-first" : "") + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="12"/>' +
        '<text class="qm-num" x="' + x.toFixed(1) + '" y="' + (y + 4.5).toFixed(1) + '">' + i + "</text>");
    });
    var svg = fig.querySelector("svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.innerHTML = out.join("");
    var cap = "Each place called " + q.name + ", numbered as in the list" + (Q.home ? ", and the area your other rows cover." : ".");
    fig.querySelector("figcaption").textContent = cap;
    fig.setAttribute("aria-label", cap);
  }

  /* ---- rows no outline can hold: offer them as points ----

     Found in release 2's testing: a sheet of village names, with a district
     column, on an atlas of districts. The region check read the district
     column and said most rows named a place we know; the rows were then joined
     to outlines by the village name, and the finest outlines there are blocks,
     not villages. Nothing landed, and an empty layer was added. The outlines
     cannot be made finer here; what can be done is to look each village up by
     name (and district) on OpenStreetMap and put it on the map as a point —
     the same lookup "By address" uses on an atlas's own Add data page. The
     person sees what was found before anything moves. */

  var PTS = { running: false, results: [], column: "", context: [] };

  function pointsOfferWanted(rep) {
    if (!rep || rep.strategy !== "adminJoin" || FOUND.asPoints || FOUND.noPoints) return false;
    var none = (rep.unmatched || []).length;
    return none >= 3 && FOUND.rows && none / FOUND.rows >= 0.25;
  }
  function placeColumns() {
    var cols = (BENCH && BENCH.state && BENCH.state.result && BENCH.state.result.columns) || [];
    var name = "", ctx = [];
    cols.forEach(function (c) {
      if (c.role === "placeName") name = c.name;
      else if (c.role === "adminParent") ctx.push(c.name);
    });
    // a district or state column the check did not use as the parent still says where
    if (!ctx.length) cols.forEach(function (c) {
      if (c.name !== name && /district|zila|jila|tehsil|taluk|block|state/i.test(c.name)) ctx.push(c.name);
    });
    return { name: name, context: ctx.slice(0, 2) };
  }

  function paintPointsOffer() {
    var box = $("#found-points");
    if (!box) return;
    var rep = FOUND.rep;
    if (PTS.running) return;
    if (!FOUND.settled || !pointsOfferWanted(rep)) {
      if (!FOUND.asPoints) { box.hidden = true; box.innerHTML = ""; }
      return;
    }
    var none = (rep.unmatched || []).length, pc = placeColumns();
    var secs = Math.max(5, Math.round(FOUND.rows * 1.2));
    box.hidden = false;
    box.innerHTML =
      "<h3>" + n(none) + " of " + n(FOUND.rows) + " rows name places we have no outline for</h3>" +
      "<p>Villages, most likely: the outlines on this atlas go down to blocks, not villages, so a village name has nothing to match. " +
      "We can look each row up by name on OpenStreetMap, a free public map, and put it on your atlas as a point instead of an outline.</p>" +
      '<p class="hint">Only the ' + esc([pc.name || "place"].concat(pc.context).join(" and ")) +
      (pc.context.length ? " columns are" : " column is") + " sent, one row a second — about " + (secs < 90 ? secs + " seconds" : Math.round(secs / 60) + " minutes") +
      ". You see what was found before anything goes on the map.</p>" +
      '<div class="btnrow"><button class="btn" type="button" id="pts-go">Put every row on as a point</button>' +
      '<button class="btn quiet" type="button" id="pts-no">Keep outlines only</button></div>';
    $("#pts-go").onclick = lookUpPoints;
    $("#pts-no").onclick = function () { box.hidden = true; FOUND.noPoints = true; paintFound(); };
  }

  function lookUpPoints() {
    var box = $("#found-points"), pc = placeColumns();
    if (!pc.name || !benchImport()) return;
    PTS = { running: true, results: [], column: pc.name, context: pc.context };
    box.innerHTML = "<h3>Looking up your places…</h3>" +
      '<p id="pts-progress">Starting.</p><div class="working"><i></i></div>';
    (function round() {
      api("layers/locate", { method: "POST", body: { importId: benchImport(), column: pc.name, context: pc.context } })
        .then(function (r) {
          PTS.results = r.results || [];
          var p = $("#pts-progress");
          if (p) p.textContent = n(r.done) + " of " + n(r.total) + " looked up.";
          if (r.more > 0) { round(); return; }
          PTS.running = false;
          showPoints();
        })
        .catch(function (e) {
          PTS.running = false;
          box.innerHTML = '<p class="msg err">' + esc(errMsg(e)) + "</p>" +
            '<div class="btnrow"><button class="btn secondary" type="button" id="pts-again">Try again</button></div>';
          $("#pts-again").onclick = lookUpPoints;
        });
    })();
  }

  function showPoints() {
    var box = $("#found-points");
    var found = PTS.results.filter(function (r) { return r.lat != null; });
    var sure = found.filter(function (r) { return r.agrees && !r.collided; });
    box.innerHTML =
      "<h3>Found " + n(found.length) + " of " + n(PTS.results.length) + "</h3>" +
      "<p>Ticked are the ones whose name matches what the map found. Untick anything that is not the place you meant; " +
      "anything unticked or not found waits on the finished atlas under “rows that need a place”.</p>" +
      '<ul class="pts-list">' + PTS.results.map(function (r) {
        var ok = r.lat != null;
        return "<li><label>" + '<input type="checkbox" value="' + r.row + '"' + (ok ? "" : " disabled") +
          (ok && r.agrees && !r.collided ? " checked" : "") + ">" +
          '<span><b>' + esc(r.query.split(",")[0]) + "</b> " +
          (ok ? '<span class="pts-found">' + esc(r.label || "") + "</span>" : '<span class="pts-miss">not found</span>') +
          "</span></label></li>";
      }).join("") + "</ul>" +
      '<div class="btnrow"><button class="btn" type="button" id="pts-keep">Use the ticked ones (' + n(sure.length) + ")</button>" +
      '<button class="btn quiet" type="button" id="pts-cancel">Keep outlines only</button></div>';
    var keepBtn = $("#pts-keep");
    $$("#found-points .pts-list input").forEach(function (i) {
      i.onchange = function () {
        keepBtn.textContent = "Use the ticked ones (" + $$("#found-points .pts-list input:checked").length + ")";
      };
    });
    $("#pts-cancel").onclick = function () { box.hidden = true; FOUND.noPoints = true; paintFound(); };
    keepBtn.onclick = function () {
      var rows = $$("#found-points .pts-list input:checked").map(function (i) { return Number(i.value); });
      if (!rows.length) return;
      keepBtn.disabled = true;
      api("layers/locate/keep", { method: "POST", body: { importId: benchImport(), rows: rows } })
        .then(function () { return resolve([]); })
        .then(function (r) {
          FOUND.asPoints = true;
          // the dots on the small map are the rows now
          GEO.points = PTS.results.filter(function (x) { return x.lat != null && rows.indexOf(x.row) >= 0; })
            .map(function (x) { return [x.lng, x.lat]; });
          // the table below still shows the outline check; it is not what goes on the map now
          $("#bench").hidden = true;
          box.innerHTML = "<h3>" + n((r.stats && r.stats.features) || 0) + " rows go on the map as points</h3>" +
            "<p>" + (FOUND.rows - FOUND.placed > 0
              ? n(FOUND.rows - FOUND.placed) + rowsWord(FOUND.rows - FOUND.placed) + " wait on the finished atlas under “rows that need a place”."
              : "Every row has a place.") + "</p>";
          paintFound();
        })
        .catch(function (e) { keepBtn.disabled = false; msg("2b", errMsg(e)); });
    };
  }
  /* Back to the search. When the file mostly missed, the places it put on the
     list go with it — they are the wrong answer, and leaving them ticked
     would carry the mistake forward. The file itself stays: it still goes on
     the atlas, checked against whatever is chosen next. Anything typed by
     hand stays too. Above the line this is only a way back to add or take
     out a place, and nothing is touched. */
  $("#found-mine").onclick = function () {
    var low = this.dataset.low === "1";
    if (low && (GEO.addedIds || []).length) {
      S.chosen = S.chosen.filter(function (c) { return GEO.addedIds.indexOf(c.id) < 0; });
      if (S.chosen.length) S.level = Math.max.apply(null, S.chosen.map(function (c) { return c.level || 2; }));
      GEO.addedIds = [];
      GEO.infer = null;
      paintChips();
    }
    step(2);
    if (low) msg(2, "Search for the places your data covers — a district, a few blocks, a state. " +
      (GEO.file ? GEO.file.name + " stays with the atlas and is checked again against what you choose." : ""), "ok");
    $("#place").focus();
  };
  $("#next-3").onclick = function () { msg(3, ""); step(1); $("#f-title").focus(); };
  if ($("#stp-found")) $("#stp-found").onclick = function () { if (!$("#stp-found").disabled) showFound(); };

  /* ---- 3 · open data ---- */

  function loadCatalog() {
    // waits on the country list rather than assuming it has landed — what is
    // on offer depends entirely on which country this atlas is in
    $("#cats").innerHTML = '<p class="hint">Loading what is available here…</p>';
    loadCountries().then(function () {
      /* Cached on the country AND the region's size: what can be built here
         changes when places are added or taken away, not only when the
         country does, and a stale answer would offer a layer that will be
         dropped. */
      var area = chosenAreaDeg2();
      var same = S.catalog && S.catalogIso === S.iso3 &&
        Math.abs((S.catalogArea || 0) - area) < 0.001;
      if (same) { paintCatalog(); return; }
      return fetchCatalog();
    });
  }
  /* The box around the places chosen so far, in square degrees — the same
     number the server works the region's size out from. */
  function chosenAreaDeg2() {
    if (S.worldwide) return 360 * 170;      // the world, so the catalogue answers for it
    var b = chosenBbox();
    return (b && b.length === 4) ? (b[2] - b[0]) * (b[3] - b[1]) : 0;
  }

  function fetchCatalog() {
    /* Asked with the region's width, so the catalogue can say which layers
       can actually be built across it. A layer that would take the builder
       longer than it is given should not be a tick box somebody discovers was
       ignored — it should not be offered. */
    var area = chosenAreaDeg2();
    return api("catalog?iso3=" + encodeURIComponent(S.iso3) +
               (area > 0 ? "&areaDeg2=" + area.toFixed(3) : "")).then(function (r) {
      S.catalog = r.layers || [];
      S.catalogIso = S.iso3;
      S.catalogArea = area;
      paintCatalog();
    }).catch(function (e) {
      $("#cats").innerHTML = "";
      msg(3, errMsg(e));
    });
  }

  /* The rows, their grouping and their words come from catalog-rows.js — the
     same piece the Owner menu's "Open data layers" sheet draws from, so a
     layer reads the same on the day an atlas is set up and on the day one is
     added to it. */
  function paintCatalog() {
    var CR = window.LokaCatalogRows;
    /* The layers every atlas gets are not a choice. The required one (the
       boundaries) is shown as the first row, ticked and locked, so the whole
       list is in view; place names stay in the line above, as they were. */
    var required = S.catalog.filter(function (l) { return l.required; });
    $("#given").innerHTML = CR.givenLine(S.catalog.filter(function (l) { return !l.required; }));
    S.catalog.filter(CR.isGiven).forEach(function (l) { S.picked[l.id] = true; });

    var host = $("#cats");
    host.innerHTML = "";
    // every group open: the whole list up front, nothing favoured (the owner's rule)
    CR.groups(S.catalog).forEach(function (g) {
      var d = document.createElement("details");
      d.className = "cat";
      d.open = true;
      d.innerHTML = "<summary>" + esc(g.label) + '<span class="cat-n"></span></summary>';
      if (g.id === "base") required.forEach(function (l) {
        var lab = document.createElement("label");
        lab.className = "cat-row cat-row-given";
        lab.innerHTML = CR.rowHTML(l, true, { locked: true });
        d.appendChild(lab);
      });
      g.layers.forEach(function (l) {
        var cannot = CR.cannotBuild(l);
        if (cannot) S.picked[l.id] = false;
        var lab = document.createElement("label");
        lab.className = "cat-row" + (cannot ? " cat-row-off" : "");
        lab.innerHTML = CR.rowHTML(l, !!S.picked[l.id]);
        if (cannot) lab.title = CR.TOO_WIDE_TITLE;
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
  /* How long a build takes, said the way a person would: the catalogue's
     estimate per layer for a region this wide, added up over what is ticked
     (the given layers included — they are built too). */
  function aboutTime(seconds) {
    if (seconds < 45) return "about half a minute";
    if (seconds < 90) return "about a minute";
    var m = Math.round(seconds / 60);
    if (m < 60) return "about " + m + " minutes";
    var h = Math.round(m / 6) / 10;
    return "about " + (h === 1 ? "an hour" : h + " hours");
  }
  function pickedSeconds() {
    var CR = window.LokaCatalogRows;
    return (S.catalog || []).reduce(function (t, l) {
      var on = CR.isGiven(l) || (S.picked[l.id] && !CR.cannotBuild(l));
      return t + (on ? Number(l.estSecondsHere != null ? l.estSecondsHere : l.estSeconds) || 0 : 0);
    }, 0);
  }
  function paintCounts() {
    var CR = window.LokaCatalogRows;
    var picked = 0, asks = [];
    $$("details.cat").forEach(function (d) {
      var boxes = d.querySelectorAll('.cat-row:not(.cat-row-given) input[type="checkbox"]');
      var on = 0;
      boxes.forEach(function (b) { if (b.checked) on++; });
      picked += on;
      d.querySelector(".cat-n").textContent = on + " of " + boxes.length;
    });
    (S.catalog || []).forEach(function (l) {
      if (S.picked[l.id] && !CR.isGiven(l) && !CR.cannotBuild(l) && CR.needsApproval(l)) asks.push(l.label);
    });
    $("#cat-total").textContent = (picked
      ? picked + (picked === 1 ? " layer" : " layers")
      : "Nothing chosen yet") + " · " + aboutTime(pickedSeconds()) + " to build";
    /* a ticked layer the LOKA team must OK first: say once, here, what that
       means for the build — the whole atlas waits for the OK today (a later release
       builds the rest first) */
    var ask = $("#cat-ask");
    if (ask) {
      ask.hidden = !asks.length;
      ask.textContent = asks.length
        ? asks.join(" and ") + (asks.length > 1 ? " are" : " is") +
          " checked by the LOKA team first, so your atlas waits for a quick OK — usually the same day."
        : "";
    }
  }

  /* ---- 4 · build for real ---- */

  $("#build-go").onclick = function () {
    var btn = this;
    if (!nameIsComplete()) return;
    var layers = Object.keys(S.picked).filter(function (k) { return S.picked[k]; });
    if (!layers.length) { msg(1, "Something has gone wrong: not even the boundaries are selected."); return; }
    btn.disabled = true; msg(1, "");
    step(4);
    // "you can safely leave this page" stops being true when a file is riding
    // along: the page is what hands it over once the atlas exists
    if (GEO.canonical && $("#build-leave")) {
      $("#build-leave").textContent = "Your file is added at the end, so keep this page open.";
    }
    $("#done-row").hidden = true;
    $("#failed-row").hidden = true;
    var _sub = $("#build-sub"); if (_sub) _sub.hidden = false;
    msg(4, "");
    $("#log").textContent = "";
    $("#build-title").textContent = "Building your atlas…";
    $("#prog-msg").textContent = "Sending it off…";

    api("instances", {
      method: "POST",
      body: {
        title: $("#f-title").value.trim(),
        org: $("#f-org").value.trim(),
        branding: { orgName: $("#f-org").value.trim() },
        region: S.worldwide ? { worldwide: true } : {
          iso3: S.iso3,
          level: S.level,
          shapeIDs: S.chosen.map(function (c) { return c.id; }),
        },
        layers: layers,
      },
    }).then(function (r) {
      S.slug = r.slug; S.jobId = r.jobId;
      log("[atlas] " + r.slug);
      /* Layers the region turned out to be too wide for. The atlas is being
         built either way — this says what it will not contain, rather than
         leaving somebody to notice the absence on the finished map. */
      if (r.droppedLayers && r.droppedLayers.length) {
        msg(4, "Too wide an area for " + r.droppedLayers.join(", ") +
          ", so " + (r.droppedLayers.length > 1 ? "those are" : "that is") +
          " left out. Everything else is being built.", "ok");
      }
      /* A build past the free tier waits for an operator, and the API says so
         by answering with a status and no job to watch. Reading a missing job
         as success told somebody "Your atlas is ready" about an atlas that did
         not exist, then sent them to it — where the viewer said there was no
         atlas at that address — and, if they had attached a file, told them it
         "couldn't be added automatically". Three wrong things from one
         unchecked field. */
      if (r.status === "pending-approval") { waitForApproval(); return; }
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
      // back to the screen Build was pressed on, with the reason beside it
      step(1);
      msg(1, errMsg(e));
    });
  };

  /* One button, one path: a retry is the same build, started again — so it
     picks up the reset above and cannot drift from the first attempt. */
  $("#build-retry").onclick = function () {
    var go = $("#build-go");
    go.disabled = false;
    go.onclick.call(go);
  };

  function log(line) {
    var el = $("#log");
    el.textContent += line + "\n";
    el.scrollTop = el.scrollHeight;
  }

  var lastStep = "";
  /* Waiting for a person, not a machine. There is no job to poll, so this
     watches the atlas itself: the moment it is approved the build starts and
     a job id appears, and from there it is an ordinary build.

     The page keeps asking while it is open, because the file the person
     uploaded lives in a session on the server and this page is what hands it
     over. If they close the tab the atlas still builds — the mail says so —
     but the file will have to be added again, and that is said rather than
     discovered. */
  function waitForApproval() {
    $("#fill").style.transform = "scaleX(0.15)";
    $("#build-title").textContent = "Waiting to be approved";
    var sub = $("#build-sub");
    if (sub) {
      sub.hidden = false;
      // the wait is for a layer the team must OK, or for a region past the
      // free tier — say which, rather than blaming the region for a layer
      var CR = window.LokaCatalogRows;
      var asks = (S.catalog || []).filter(function (l) {
        return S.picked[l.id] && CR && CR.needsApproval(l) && !CR.isGiven(l);
      }).map(function (l) { return l.label; });
      sub.textContent = (asks.length
          ? asks.join(" and ") + (asks.length > 1 ? " are" : " is") + " checked by the LOKA team first. "
          : "A region this size is checked by the LOKA team first. ") +
        "They have been emailed, and you will be too once it is built.";
    }
    $("#prog-msg").textContent = GEO.canonical
      ? "Keep this page open and your file goes on as soon as it is approved."
      : "You can safely close this page.";
    $("#done-row").hidden = true;
    (function again() {
      api("instances/" + encodeURIComponent(S.slug)).then(function (inst) {
        if (inst && inst.status === "failed") {
          $("#build-title").textContent = "The build stopped";
          msg(4, "Something failed after approval. Nothing was published.");
          $("#failed-row").hidden = false;
          $("#build-go").disabled = false;
          return;
        }
        if (inst && inst.jobId) {           // approved: an ordinary build from here
          S.jobId = inst.jobId;
          $("#build-title").textContent = "Building your atlas…";
          if (sub) sub.textContent = "Approved — building from open data now.";
          poll();
          return;
        }
        setTimeout(again, 15000);
      }).catch(function () { setTimeout(again, 30000); });
    })();
  }

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
        var sub = $("#build-sub"); if (sub) sub.hidden = true;
        msg(4, j.message || "Something failed while building. Nothing was published.");
        // the way out: without these two lines the screen is a dead end and the
        // Build button behind it is still disabled from the first attempt
        $("#failed-row").hidden = false;
        $("#build-go").disabled = false;
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
    /* The atlas's first look (owner.js) says what was just built — the rows
       placed, the rows still without a place — and only this page knows those
       numbers. They ride across in the browser's own storage, keyed to the
       atlas; "built=1" on the address is what tells the atlas to look for them,
       once, and it takes the flag off the address again. */
    var look = {
      slug: S.slug,
      rows: FOUND.rows, placed: FOUND.placed, open: FOUND.open,
      file: GEO.file ? GEO.file.name : "",
      added: !!(BENCH && GEO.canonical),
      places: S.worldwide ? [] : S.chosen.map(function (c) { return c.label; }),
      layers: Object.keys(S.picked).filter(function (id) { return S.picked[id]; }).length,
    };
    function keepLook() { try { localStorage.setItem("loka-first-look", JSON.stringify(look)); } catch (e) { /* private mode: no first look */ } }
    keepLook();
    var go = "../?dataset=" + encodeURIComponent(S.slug) + "&built=1";
    $("#open-editor").href = go;
    // The atlas opens itself — a button saying "open your atlas" on a page whose
    // only remaining purpose is to open your atlas is a step for its own sake. It
    // stays hidden unless something goes wrong, where it becomes the way out.
    $("#done-row").hidden = true;

    // the file has waited on the server since the check step; the atlas exists
    // now, so it is told where it belongs and added BEFORE we leave the page —
    // this page is what hands it over, so navigating early would lose it
    // a file none of whose rows found a place is not added as an empty layer
    // (the server refuses one since release 3); the first look says so
    if (BENCH && GEO.canonical && FOUND.settled && !FOUND.placed) {
      look.added = false; keepLook();
    } else if (BENCH && GEO.canonical) {
      $("#prog-msg").textContent = "Adding " + GEO.file.name + " to your atlas…";
      BENCH.bindDataset(S.slug);
      BENCH.commit().then(function () {
        $("#prog-msg").textContent = "Your data is on it — opening your atlas…";
        location.href = go;
      }).catch(function () {
        // stay put: this needs reading, and the button is the way on. The first
        // look must not claim rows that never arrived.
        look.added = false; look.placed = 0; look.open = 0; keepLook();
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

  /* ================= rows that need a place, on a built atlas =================

     Reached from the atlas's first look. Everything here is worked out by the
     server from the import it kept for these rows (GET /layers/repair), and
     each answer is committed straight onto the atlas (POST /layers/repair),
     which then says what is still open. Three kinds of row, three groups:
     the ones with no place yet, the ones put by their neighbours to check,
     and the spellings the model guessed. */
  var FIX = { slug: "", imports: [] };

  function showFixes(slug) {
    FIX.slug = slug;
    $("#home").hidden = true; $("#gate").hidden = true; $("#flow").hidden = true;
    $("#fixes").hidden = false;
    $("#fixes-open").href = "../?dataset=" + encodeURIComponent(slug);
    $("#fixes-intro").textContent = "Loading…";
    loadFixes();
  }
  function loadFixes() {
    api("layers/repair?dataset=" + encodeURIComponent(FIX.slug)).then(function (r) {
      FIX.imports = r.imports || [];
      paintFixes();
    }).catch(function (e) {
      $("#fixes-intro").textContent = "";
      msg("fixes", errMsg(e));
    });
  }
  function paintFixes() {
    var list = $("#fixes-list");
    list.innerHTML = "";
    var total = 0;
    FIX.imports.forEach(function (imp) { total += imp.rows.length; });
    $("#fixes-done").hidden = !total;
    if (!total) {
      $("#fixes-intro").textContent = FIX.dismissed ? "Nothing is listed here any more."
        : "Nothing is waiting: every row has a place, and every one put by its neighbours has been checked.";
      return;
    }
    $("#fixes-intro").textContent = "Your atlas is built and these rows are on it, or waiting to be. " +
      "Each answer here goes straight onto the map.";
    FIX.imports.forEach(function (imp) {
      var groups = [
        { kinds: ["question", "skipped", "unplaced"], title: "Still need a place",
          say: "Left off the map for now. Pick the right place, or leave a row off." },
        { kinds: ["byNeighbours"], title: "Put by their neighbours — check them",
          say: "These names belong to more than one place. We chose the one among your other rows; keep it or change it." },
        { kinds: ["suggested"], title: "We guessed these spellings — check them",
          say: "No place was spelled quite like these, so we picked the closest." },
      ];
      if (FIX.imports.length > 1) {
        var h = document.createElement("p");
        h.className = "hint";
        h.textContent = "From " + (imp.file || imp.label);
        list.appendChild(h);
      }
      groups.forEach(function (g) {
        var rows = imp.rows.filter(function (r) { return g.kinds.indexOf(r.kind) >= 0; });
        if (!rows.length) return;
        var sec = document.createElement("section");
        sec.className = "fix-group";
        sec.innerHTML = "<h3>" + esc(g.title) + " · " + rows.length + "</h3><p class=\"hint\">" + esc(g.say) + "</p>";
        // rows with the same name are answered together
        var byName = {}, order = [];
        rows.forEach(function (r) {
          var k = String(r.name || "").trim().toLowerCase() + "|" + r.kind;
          if (!byName[k]) { byName[k] = []; order.push(k); }
          byName[k].push(r);
        });
        order.forEach(function (k) { sec.appendChild(fixItem(imp, byName[k])); });
        list.appendChild(sec);
      });
    });
  }
  function fixItem(imp, rows) {
    var r0 = rows[0], box = document.createElement("div");
    box.className = "fix-item";
    var name = "fx-" + imp.importId + "-" + r0.row;
    var placed = r0.kind === "byNeighbours" || r0.kind === "suggested";
    var cands = (r0.candidates || []).slice(0, 4);
    if (placed && !cands.some(function (c) { return String(c.code) === String(r0.code); })) {
      cands.unshift({ code: r0.code, name: r0.place, parent: r0.parent, area: r0.area });
    }
    var head = "“" + esc(r0.name) + "”" + (rows.length > 1 ? " · " + rows.length + " rows" : "");
    var now = placed ? "On the map at " + esc(whereIs({ name: r0.place, parent: r0.parent, area: r0.area })) + "."
      : r0.kind === "skipped" ? "Skipped while setting up."
      : r0.reason === "bad coordinates" ? "No point for it yet: the map lookup did not find it, or it was left unticked. " +
        "To place it, correct the name in your file and add the file again under Your data."
      : cands.length ? "Could be more than one place." : "No place of this name in the atlas’s outlines.";
    box.innerHTML = "<h4>" + head + "</h4><p class=\"hint\">" + now + "</p>";
    var opts = document.createElement("div");
    opts.className = "q-opts";
    function paintOpts(list) {
      opts.innerHTML = "";
      list.forEach(function (c, i) {
        var meta = c.inside ? "inside the area your other places cover"
          : c.km != null ? "about " + n(c.km) + " km from your other places" : "";
        var on = placed ? String(c.code) === String(r0.code) : i === 0;
        var lab = document.createElement("label");
        lab.className = "q-opt";
        lab.innerHTML = '<input type="radio" name="' + name + '" value="' + esc(c.code) + '"' + (on ? " checked" : "") + ">" +
          '<span class="q-what"><b>' + esc(whereIs(c)) + "</b>" +
          (placed && String(c.code) === String(r0.code) ? ' <span class="q-tag">on the map now</span>' : "") +
          (meta ? '<span class="q-meta">' + esc(meta) + "</span>" : "") + "</span>";
        lab.querySelector("input").onchange = function () {
          use.textContent = !placed ? "Put it here" : this.value === String(r0.code) ? "Keep this" : "Move it here";
        };
        opts.appendChild(lab);
      });
    }
    paintOpts(cands);
    box.appendChild(opts);
    // a row with nothing to choose from can be given a place by name
    if (!cands.length && r0.reason !== "bad coordinates") {
      var find = document.createElement("div");
      find.className = "fix-find";
      find.innerHTML = '<label class="sr" for="' + name + '-q">Find a place for ' + esc(r0.name) + "</label>" +
        '<input type="search" id="' + name + '-q" placeholder="Type the place’s name as the map spells it" />' +
        '<button class="btn secondary" type="button">Find</button>';
      var inp = find.querySelector("input");
      function go() {
        api("layers/repair/find?importId=" + encodeURIComponent(imp.importId) + "&q=" + encodeURIComponent(inp.value))
          .then(function (res) {
            cands = res.matches || [];
            paintOpts(cands);
            if (!cands.length) box.querySelector(".hint").textContent = "Nothing on the map is called that. Try another spelling.";
            use.hidden = !cands.length;
          }).catch(function (e) { msg("fixes", errMsg(e)); });
      }
      find.querySelector("button").onclick = go;
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
      box.appendChild(find);
    }
    var btns = document.createElement("div");
    btns.className = "btnrow";
    btns.innerHTML = '<button class="btn" type="button">' + (placed ? "Keep this" : "Put it here") + "</button>" +
      (placed || r0.kind !== "skipped" ? '<button class="btn quiet" type="button">Leave ' + (rows.length > 1 ? "them" : "it") + " off the map</button>" : "");
    var use = btns.children[0], off = btns.children[1];
    use.hidden = !cands.length;
    use.onclick = function () {
      var r = box.querySelector('input[type="radio"]:checked');
      if (!r) return;
      send(imp, rows.map(function (x) { return { row: x.row, code: r.value }; }), box);
    };
    if (off) off.onclick = function () { send(imp, rows.map(function (x) { return { row: x.row, skip: true }; }), box); };
    box.appendChild(btns);
    return box;
  }
  function send(imp, fixes, box) {
    $$("#fixes-list button").forEach(function (b) { b.disabled = true; });
    api("layers/repair", { method: "POST", body: { importId: imp.importId, fixes: fixes } }).then(function (r) {
      imp.rows = r.rows || [];
      paintFixes();
      msg("fixes", "Saved — it is on the atlas now.", "ok");
    }).catch(function (e) {
      $$("#fixes-list button").forEach(function (b) { b.disabled = false; });
      msg("fixes", errMsg(e));
    });
  }
  $("#fixes-done").onclick = function () {
    var b = this;
    b.disabled = true;
    Promise.all(FIX.imports.map(function (imp) {
      return api("layers/repair", { method: "POST", body: { importId: imp.importId, dismiss: true } });
    })).then(function () {
      FIX.imports = [];
      FIX.dismissed = true;
      paintFixes();
      msg("fixes", "Done. Rows still off the map stay off it; add the file again under Your data to change that.", "ok");
    }).catch(function (e) { msg("fixes", errMsg(e)); })
      .then(function () { b.disabled = false; });
  };

  boot();
})();
