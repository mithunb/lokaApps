/* LOKA Atlas — the owner's tools.
 *
 * An atlas has ONE home: its own page. This file is what turns that page from
 * something you read into something you change, and it is fetched only when the
 * API has confirmed the caller may edit (see checkOwner in atlas.js). A reader
 * never downloads a byte of it.
 *
 * It used to be a second page. That page framed the viewer in an iframe and
 * drew its own panel beside it, and the two grew apart exactly as you would
 * expect: two panels, two layer lists, and "layers" meaning different things
 * depending on which half you were looking at. Everything here now works by
 * ADDING to what the viewer already built — its header, its panel, its layer
 * rows — through the small surface atlas.js exposes as window.LokaAtlas. When
 * you want to show the owner something, look for the viewer's own version of it
 * first. A second one is how the last two pages happened.
 *
 * The one genuinely tricky part is previewing an unsaved change. The server
 * builds edits into a DRAFT copy of the atlas, and the honest way to show a
 * draft is to point this same viewer at that folder — LokaAtlas.reboot(). It
 * redraws the map and rebuilds the panel, which is why the layer's own card
 * lives OUTSIDE the panel's rebuilt half and survives it.
 */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var API = "./api/";

  var SLUG = "";
  var INST = null;         // the instance record: title, status, region, collaborators
  var MINE = [];           // GET /layers/list — the authority on which layers exist
  var MOUNTED = false;

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
  // same shape as the viewer's helper, so the door reads the same in both files.
  // NOTE: the third argument is innerHTML — anything from the data must be esc()'d.
  var el = function (tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---- one toast element, reused: a shared timer with several nodes orphans
          whichever one the timer did not belong to ---- */
  var toastTimer, toastNode;
  function toast(text) {
    if (!toastNode) {
      toastNode = document.createElement("div");
      toastNode.className = "own-toast";
      toastNode.setAttribute("role", "status");
      document.body.appendChild(toastNode);
    }
    toastNode.textContent = text;
    toastNode.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastNode.hidden = true; }, 2600);
  }

  /* ---- dialogs: focus enters, Tab is trapped, the page behind is inert ----
          Used for Settings, which is a genuine interruption. The layer's own
          card is NOT a dialog: you have to watch the map change while you
          change it, so it cannot make the map inert. */
  var dialogStack = [];
  function focusablesIn(root) {
    return [].slice.call(root.querySelectorAll(
      'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'))
      .filter(function (n) { return !n.disabled && n.offsetParent !== null; });
  }
  function pageRegions() {
    return [].slice.call(document.body.children).filter(function (n) {
      return n.tagName !== "SCRIPT" && !n.classList.contains("own-scrim");
    });
  }
  function openDialog(html, wire, guard) {
    var scrim = document.createElement("div");
    scrim.className = "own-scrim";
    scrim.innerHTML = html;
    var opener = document.activeElement;
    scrim.addEventListener("click", function (e) {
      if (e.target === scrim || e.target.hasAttribute("data-close")) closeDialog(scrim);
    });
    scrim.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      var f = focusablesIn(scrim);
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    var sheet = scrim.querySelector(".own-sheet");
    if (sheet && !sheet.querySelector(".own-x")) {
      var xrow = document.createElement("div");
      xrow.className = "own-xrow";
      xrow.innerHTML = '<button type="button" class="own-x" data-close aria-label="Close">✕</button>';
      sheet.insertBefore(xrow, sheet.firstChild);
    }
    document.body.appendChild(scrim);
    dialogStack.push({ scrim: scrim, opener: opener });
    pageRegions().forEach(function (n) { n.inert = true; });
    if (wire) wire(scrim);
    if (guard) scrim.__guard = guard;
    var f = focusablesIn(scrim).filter(function (n) { return !n.classList.contains("own-x"); });
    (f[0] || scrim.querySelector(".own-x") || sheet).focus();
    return scrim;
  }
  function closeDialog(which) {
    var top = dialogStack[dialogStack.length - 1];
    if (!top) return;
    var entry = which ? dialogStack.filter(function (d) { return d.scrim === which; })[0] : top;
    if (!entry) return;
    if (entry.scrim.__guard && entry.scrim.__guard() === false) return;
    dialogStack = dialogStack.filter(function (d) { return d !== entry; });
    entry.scrim.remove();
    if (!dialogStack.length) pageRegions().forEach(function (n) { n.inert = false; });
    if (entry.opener && entry.opener.isConnected) entry.opener.focus();
  }
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (dialogStack.length) { closeDialog(); return; }
    // in a layer's own card, Escape means "back to all layers" — same guard,
    // same one-liner when there are unsaved changes; an open inline confirm
    // folds first, like any other transient
    if (ED) {
      if (!$("#own-rm-confirm").hidden) { hideRemoveConfirm(); return; }
      evBack();
    }
  });

  /* ================= mounting ================= */

  /* ---- Discover underlying patterns, on the layer's own row ---------------
     This used to sit inside Change, where nobody would look for it: Change
     reads as "adjust what is here", not "find out something new". It belongs
     on the panel beside the layer it acts on, under the switches it creates,
     because that is where its result lands.

     Found once, and that is the end of it. There is no "read again": reading
     a second time does not sharpen the patterns, it replaces them with
     different ones, so the key a reader learned disappears. Four different
     readings of the same 66 places are sitting on disk to prove it. Offering
     that choice would be asking a question we already know the answer to.

     The loop runs on endpoints that already exist: the layer's own file gives
     the rows, /layers/enrich proposes, keeping sends the table back with one
     new column and commits it in place. The column is the point — once it is
     in the data the viewer offers it as a key of its own accord. */

  // the columns worth reading: words people wrote, not ids, links or coordinates
  /* Which columns hold words worth reading. Judged by counting, not by name, so
     it works on data whose columns are called anything.

     A column is thrown out when every place's entry is different AND none of
     them contains a space: that is an identifier or a timestamp, not writing.
     It cannot group anything and it cannot be read for meaning, yet it used to
     be sent and paid for — a place's text arrived at the model beginning with
     its own id string. Pictures go for the same reason: a link is not words. */
  function wordColumns(feats) {
    var props = (feats[0] && feats[0].properties) || {};
    return Object.keys(props).filter(function (k) {
      // never read our own answers back in: a question's column is an answer,
      // not evidence, and feeding it to the next reading would let one reading
      // put words into the mouth of the next
      if (k.charAt(0) === "_" || k === "themes" || /^pattern_\d+$/.test(k)) return false;
      if (/^(lat|latitude|lon|lng|long|longitude)$/i.test(k)) return false;
      var seen = {}, n = 0, spaced = 0, filled = 0;
      for (var i = 0; i < feats.length; i++) {
        var v = (feats[i].properties || {})[k];
        if (typeof v !== "string") continue;
        v = v.trim();
        if (!v) continue;
        if (/^https?:\/\//i.test(v)) return false;      // a link, not words
        filled++;
        if (v.indexOf(" ") >= 0) spaced++;
        if (!seen[v]) { seen[v] = 1; n++; }
      }
      if (!filled) return false;
      return !(n === filled && spaced === 0);          // all different, none spaced -> an id
    });
  }

  function patternsDoor(L, box) {
    if (!L || L.type !== "marker" || !L.userLayer) return;
    if (!MINE.some(function (m) { return m.id === L.id; })) return;   // not yours to change
    var gj = window.LokaAtlas.dataFor && window.LokaAtlas.dataFor(L.id);
    var feats = (gj && gj.features) || [];
    if (!feats.length) return;

    var wrap = el("div", "own-door");
    box.appendChild(wrap);

    /* Questions already answered? Then the door has done its work: each one is
       a key in the list above, so there is nothing here to press. Their columns
       are named pattern_1, pattern_2 …; the wording a reader sees comes from the
       key name stored beside them. */
    var done = Object.keys(feats[0].properties || {})
      .filter(function (k) { return /^pattern_\d+$/.test(k); });
    if (done.length) {
      wrap.appendChild(el("span", "own-door-said",
        done.length + (done.length === 1 ? " question" : " questions") +
        " answered for this layer — each one a key above."));
      return;
    }

    var cols = wordColumns(feats);
    if (!cols.length) return;            // nothing written here to read

    var link = el("button", "own-door-link", "Discover underlying patterns");
    link.type = "button";
    var panel = el("div", "own-door-body");
    panel.hidden = true;
    wrap.appendChild(link);
    wrap.appendChild(panel);

    link.onclick = function () {
      if (!panel.hidden) { panel.hidden = true; return; }
      panel.hidden = false;
      if (panel.childNodes.length) return;      // already built
      panel.appendChild(el("p", "own-note",
        "We read what people wrote about all " + feats.length + " places here and look for " +
        "the few patterns running through them. They arrive as one new key you can keep or " +
        "discard — what you uploaded is never changed."));
      panel.appendChild(el("p", "own-note own-door-cost",
        "Reads " + esc(cols.slice(0, 3).join(", ")) + " · about half a minute · costs one reading"));
      var go = el("button", "share-btn", "Read the places");
      go.type = "button";
      panel.appendChild(go);
      var msg = el("p", "own-note");
      msg.hidden = true;
      panel.appendChild(msg);
      function say(t, warn) {
        msg.hidden = !t; msg.textContent = t || "";
        msg.classList.toggle("warnish", !!warn);
      }

      go.onclick = function () {
        go.disabled = true;
        say("Reading every place…");
        fetch(window.LokaAtlas.fileUrl(L.source))
          .then(function (r) { return r.json(); })
          .then(function (d) {
            var rows = (d.features || []).map(function (f) { return f.properties || {}; });
            return api("layers/enrich", { method: "POST", body: {
              dataset: SLUG, rows: rows, fields: cols, mode: "questions",
              title: (window.LokaAtlas.manifest && window.LokaAtlas.manifest.title) || "",
            } }).then(function (r) { return { r: r, rows: rows }; });
          })
          .then(function (out) {
            var qs = out.r.questions || [];
            if (out.r.verdict !== "questions" || !qs.length) {
              say(out.r.verdict === "no_clear_questions"
                ? "These places do not clearly answer a question" +
                  (out.r.note ? ": " + out.r.note : ".") + " Nothing was added."
                : "No questions could be found just now. Nothing was added.", true);
              go.disabled = false;
              return;
            }
            say("Adding " + qs.length + (qs.length === 1 ? " question" : " questions") + "…");
            return keepQuestions(L, out.rows, qs).catch(function (e) {
              go.disabled = false; say(errMsg(e), true);
            });
          })
          .catch(function (e) { go.disabled = false; say(errMsg(e), true); });
      };
    };
  }

  /* Every question is kept. There is no asking: the questions a place can answer
     are universal, so the owner is not made to approve each one — they arrive as
     keys, each carrying the share of places it can speak for, and any that is
     not wanted is simply left switched off.

     One column per question, pattern_1, pattern_2 …, with the question itself
     stored as the key's name so a reader meets "What can you do here?" rather
     than a column named after how it was made. */
  function keepQuestions(L, rows, questions) {
    var labels = {};
    var out = rows.map(function (p) {
      var o = Object.assign({}, p);
      delete o._category;                 // the engine's own, re-derived on build
      return o;
    });
    questions.forEach(function (q, n) {
      var col = "pattern_" + (n + 1);
      labels[col] = q.question;
      (q.categories || []).forEach(function (c, i) {
        if (out[i]) out[i][col] = c === "other" ? "" : (c || "");
      });
      out.forEach(function (o) { if (o[col] === undefined) o[col] = ""; });
    });
    var names = Object.keys(out[0] || {});
    return api("layers/ingest", { method: "POST", body: {
      dataset: SLUG, replaceLayerId: L.id, filename: L.label || L.id,
      schema: names.map(function (nm) {
        return { name: nm, type: (nm === "latitude" || nm === "longitude") ? "number" : "string" };
      }),
      rows: out,
      keyLabels: labels,
      meta: { sourceName: L.source, rowCount: out.length },
    } })
      .then(function (ing) {
        return api("layers/commit", { method: "POST", body: { importId: ing.importId, dataset: SLUG } });
      })
      .then(function () {
        toast(questions.length + (questions.length === 1 ? " question" : " questions") +
              " added — the map can be coloured by any of them.");
        // the columns are on the server; this page still holds the copy it
        // loaded, and which columns may become a key is worked out once as a
        // layer's data arrives — so the map has to read the layer again
        return preview(SLUG).then(refreshLayers).then(function () {
          if (window.LokaAtlas.reboot) window.LokaAtlas.reboot(SLUG);
        });
      });
  }

  function mount(inst) {
    if (MOUNTED) return;
    MOUNTED = true;
    INST = inst;
    SLUG = window.LokaAtlas.dataset;
    buildBar();
    buildEditCard();
    // the panel is the viewer's and gets rebuilt on every draft preview, so the
    // owner's additions to it are re-applied each time rather than once
    window.LokaAtlas.onControlsBuilt(augmentPanel);
    // and a door on every layer row the signed-in person may change
    window.LokaAtlas.onLayerExtra(patternsDoor);
    refreshLayers();
    if (/(^|[?&])added=1/.test(location.search)) {
      toast("Layer added — it is on the map now");
      history.replaceState(null, "", location.pathname + "?dataset=" + encodeURIComponent(SLUG));
    }
  }

  /* GET /layers/list is the authority on WHICH layers are on this atlas, and on
     whether this caller may change each one. The merged manifest the viewer
     already holds describes them; it is not asked whether they exist, because a
     browser holding a cached overlay file once showed an atlas as empty for as
     long as the cache lasted. */
  function refreshLayers() {
    return api("layers/list?dataset=" + encodeURIComponent(SLUG))
      .then(function (r) { MINE = (r && r.layers) || []; })
      .catch(function () { MINE = []; })
      .then(augmentPanel)
      // who may change what has only just arrived from the server; the layer
      // doors were refused before it did, so offer them again now
      .then(function () {
        if (window.LokaAtlas.redrawLayerRows) window.LokaAtlas.redrawLayerRows();
      });
  }
  function mineFor(id) {
    for (var i = 0; i < MINE.length; i++) if (MINE[i].id === id) return MINE[i];
    return null;
  }

  /* ================= the bar across the top =================
     The viewer's hero already carries the title, the description and Share.
     What an owner needs on top of that is whether the atlas is on the air, the
     switch for it, a way in to Settings, and the way to add data. They go in
     the same row as Share rather than in a bar of their own — a second bar
     saying "this is the owner's strip" is how the second page started. */

  function buildBar() {
    var row = document.querySelector(".hero-actions");
    if (!row) return;
    var box = document.createElement("div");
    box.className = "own-acts";
    box.innerHTML =
      '<span class="own-status" id="own-status" role="status">' +
        '<span class="own-dot" aria-hidden="true"></span>' +
        '<span class="own-what" id="own-what"></span>' +
        '<span class="own-who" id="own-who"></span>' +
      "</span>" +
      '<button class="share-btn" id="own-live" hidden type="button"></button>' +
      '<button class="share-btn" id="own-settings" type="button">Settings</button>';
    row.insertBefore(box, row.firstChild);
    $("#own-live").onclick = toggleLive;
    $("#own-settings").onclick = function () { openSettings(); };

    // the add-data flow is its own several-step job, like first setting an atlas
    // up: it keeps its own page and comes back here when it is done
    var add = $("#add-data-btn");
    if (add) {
      add.href = "./add-data/?dataset=" + encodeURIComponent(SLUG);
      add.hidden = false;
      add.removeAttribute("title");
      add.setAttribute("aria-label", "Add your data to this atlas");
    }
    paintStatus();
  }

  // Two things, said as one sentence. `published` is what makes an atlas listed
  // and openable by anyone with the link; `private` moves it out of the web root
  // entirely, so only invited people can reach it at all.
  function paintStatus() {
    var live = INST.status === "published";
    var priv = INST.visibility === "private";
    $("#own-status").classList.toggle("live", live);
    $("#own-what").textContent = live ? "Live" : "Not live";
    $("#own-who").textContent = live
      ? (priv ? "— only invited people" : "— anyone with the link")
      : "— only you can see it";
    var act = $("#own-live");
    // only the owner decides whether an atlas is on the air
    act.hidden = INST.role !== "owner" || INST.status === "building";
    act.textContent = live ? "Take it off" : "Make it live";
    act.classList.toggle("primary", !live);
    // the Share panel must say when a link and QR will only work for the
    // owner — a printed poster of a not-live atlas is a dead poster
    var share = $("#share-btn");
    if (share && share.__shareOpts) share.__shareOpts.notLive = !live;
  }

  function toggleLive() {
    var btn = $("#own-live"), live = INST.status === "published";
    btn.disabled = true;
    api("instances/" + encodeURIComponent(SLUG) + "/" + (live ? "unpublish" : "publish"), { method: "POST" })
      .then(function () {
        INST.status = live ? "built" : "published";
        paintStatus();
        toast(live ? "Taken off the air — only you can see it now"
                   : "Live — anyone with the link can open it");
      })
      .catch(function (e) { toast(errMsg(e)); })
      .then(function () { btn.disabled = false; });
  }

  /* ================= adding to the viewer's panel =================
     Two additions and nothing more: the region, which the panel had no reason
     to show a reader, and a way into each layer this caller may change. The
     layer rows, their switches and their colour keys are the viewer's own and
     are left exactly as they are — an owner and a reader should be looking at
     the same list, or one of them is being lied to. */

  function augmentPanel() {
    var LA = window.LokaAtlas;
    if (!LA || !LA.manifest) return;
    addRegionRow();
    (LA.manifest.layers || []).forEach(addChangeButton);
    // a reboot rebuilds the viewer's Share wiring too — restate what only
    // the owner knows (see paintStatus)
    var share = $("#share-btn");
    if (share && share.__shareOpts && INST) share.__shareOpts.notLive = INST.status !== "published";
  }

  // What the base map actually draws, rather than what we would like to claim:
  // an atlas built before those layers existed has neither.
  function baseLayerNames() {
    var have = [];
    (window.LokaAtlas.manifest.layers || []).forEach(function (L) {
      var id = String(L.id || "").toLowerCase();
      if (/^(admin|boundary|boundaries)$/.test(id)) have.push("Boundaries");
      else if (/^(labels|placenames|place-names)$/.test(id)) have.push("place names");
    });
    return have;
  }

  function addRegionRow() {
    var panel = $("#atlas-controls");
    if (!panel || $("#own-region")) return;
    var label = INST.regionLabel || (INST.region && INST.region.label) || "";
    var have = baseLayerNames();
    var lead = have.length ? have.join(" & ") + " for" : "This atlas covers";
    var wrap = document.createElement("div");
    wrap.className = "own-region-wrap";
    wrap.innerHTML =
      '<button class="own-region" id="own-region" type="button">' +
        '<span class="own-region-k">' + esc(lead) + "</span>" +
        '<span class="own-region-v">' + esc(label || "no region recorded") + "</span>" +
        '<span class="own-region-go" aria-hidden="true">Change</span>' +
      "</button>" +
      (have.length ? "" :
        '<p class="own-region-warn">No boundary or place-name layers were built for it.</p>');
    $("#own-region", wrap).setAttribute("aria-label",
      (have.length ? "Boundaries and place names are drawn for " : "This atlas covers ") +
      (label || "no region yet") + ". Change the region.");
    $("#own-region", wrap).onclick = function () { openSettings("region"); };
    // right under the Map/Satellite switch: the region is what the base map
    // draws, so it belongs with the base map and not among the data layers
    var after = panel.querySelector(".ctl-basemaps");
    if (after && after.nextSibling) panel.insertBefore(wrap, after.nextSibling);
    else if (after) panel.appendChild(wrap);
    else panel.insertBefore(wrap, panel.firstChild);
  }

  /* One extra control on the rows this caller may change, named for what it
     does. It is a button of its own rather than making the whole row clickable,
     because the row already has a switch: showing a layer and changing how it
     looks are different acts and must not share one hit target.

     It goes on the name's line, before the little "i", pushed right by the
     toggle row's own flex. HTML says a label does nothing for clicks aimed at
     interactive content inside it, so a button there cannot flip the visibility
     switch by accident — and the handler stops the click as well, because that
     rule is worth not betting a silent bug on. */
  function addChangeButton(L) {
    var row = L._row;
    if (!row || row.querySelector(".own-change")) return;
    var m = mineFor(L.id);
    if (!m || !m.canRemove) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "own-change";
    btn.textContent = "Change";
    btn.setAttribute("data-lid", L.id);
    btn.setAttribute("aria-label", "Change how " + (L.label || L.id) + " looks");
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      openLayer(L, m);
    };
    var head = row.querySelector(".ctl-toggle") || row;
    var info = head.querySelector(".ctl-info");
    if (info) head.insertBefore(btn, info);
    else head.appendChild(btn);
    // who contributed it — an owner's question, not a reader's, so it is added
    // here rather than built into the viewer's row
    var by = m.addedBy || L.addedBy || null;
    var who = by && (by.org || by.name || by.email);
    if (who && !row.querySelector(".own-by")) {
      var note = document.createElement("span");
      note.className = "own-by";
      note.textContent = "added by " + who;
      row.appendChild(note);
      // the viewer's info tooltip carries the same credit for readers — with
      // the visible note here, saying it twice on one row is noise
      var info = row.querySelector(".ctl-info");
      if (info && info.title) {
        var trimmed = info.title.replace(/(\s*—\s*)?Added by [^—]*$/, "").trim();
        if (trimmed) info.title = trimmed;
        else info.parentNode.removeChild(info);
      }
    }
  }

  /* ================= one layer's own card =================
     "Change" swaps the panel's contents for the layer's card: a name, ONE
     colour question, the live map key, what to call each place, and a quiet
     remove. The card sits BESIDE the viewer's controls, not inside them, so
     that a draft preview — which rebuilds the panel from scratch — cannot pull
     it out from under the person using it.

     The model behind it is draft-then-commit. Opening calls layers/reopen (a
     fresh import session and a draft copy of the atlas), every settled change
     is one layers/apply, the map is pointed at the draft, and Save is
     layers/commit, which replaces the layer in place. Nothing is public until
     Save, which is what the one line above the buttons says. */

  // the server's named single colours (api/lib/fragment.js MARKER_COLORS) —
  // brand choices a person picks for a whole layer. The key itself is always
  // drawn from the server's own legend, so these hexes only tint the chips.
  var MARKER_COLORS = { rust: "#A6522F", moss: "#40573D", ochre: "#B0863A", sienna: "#9C5A34", slate: "#5f7f92" };
  var MARKER_NAMES = { rust: "Rust", moss: "Moss", ochre: "Ochre", sienna: "Sienna", slate: "Slate" };
  // mirrors PALETTES in api/lib/fragment.js — the server owns which ramp a spec
  // means; these are only so the choice can be seen before it is made
  var PALETTES = {
    greens: ["#e7e3d8", "#cdd3b4", "#a9bd8e", "#7f9c65", "#566f42", "#39502f"],
    blues: ["#e6ebec", "#c2d2d8", "#93b1bd", "#6690a1", "#446e80", "#2d4f5e"],
    rust: ["#f0e6dd", "#e0c4ab", "#cb9c77", "#b06f47", "#8f4d2c", "#6e371d"],
    ylorbr: ["#efe6d9", "#ddc4a0", "#caa06f", "#a8703f", "#824e26", "#5e3618"],
    brteal: ["#8a5a25", "#bb8f4e", "#e2cfa4", "#9fc7bd", "#4e8f86", "#2c625d"],
    tealbr: ["#2c625d", "#4e8f86", "#9fc7bd", "#e2cfa4", "#bb8f4e", "#8a5a25"],
    purples: ["#e9e4ea", "#cfc3d4", "#ac97b6", "#8a6e96", "#6a4d75", "#4c3454"],
  };
  var PALETTE_NAMES = {
    greens: "Greens", blues: "Blues", rust: "Rust", ylorbr: "Sand to brown",
    brteal: "Brown to teal", tealbr: "Teal to brown", purples: "Purples",
  };

  /* What "colour" means depends on what the layer draws, so the question
     changes with it. Points ask which column classes them. Shaded areas ask
     which number to shade by, and with which ramp. Bubbles ask which number
     sets the size. A plain line or fill has only a colour to give. */
  var COLOUR_MODES = {
    category:   { by: "cat", label: "Colour places by" },
    markers:    { by: "cat", label: "Colour places by" },
    choropleth: { by: "num", label: "Shade areas by", ramp: true, empty: "This layer has no number to shade by." },
    bubble:     { by: "num", label: "Size circles by", swatch: "Circle colour", empty: "This layer has no number to size by." },
    line:       { swatch: "Line colour" },
    polygon:    { swatch: "Fill colour" },
  };
  var NOTE_DEFAULT = "Only you see this until you save.";
  // the server's own title preference (pickTitleColumn), for layers whose stored
  // title is missing or points at a column the data does not have
  var NAMEISH = /^(name|title|label|place|description|desc|site|spot)s?$/i;

  var ED = null;   // the open layer's working state; null = the panel's own list

  function buildEditCard() {
    var host = $("#atlas-panel");
    if (!host || $("#own-edit")) return;
    var card = document.createElement("div");
    card.id = "own-edit";
    card.hidden = true;
    card.innerHTML =
      '<div class="own-ev-body">' +
        '<button class="own-back" id="own-back" type="button">‹ All layers</button>' +
        '<h3 class="own-ev-title" id="own-ev-title" tabindex="-1"></h3>' +
        '<p class="own-ev-sub" id="own-ev-sub"></p>' +
        '<p class="own-ev-loading" id="own-ev-loading" hidden>Opening this layer…</p>' +
        '<p class="own-err" id="own-ev-err" role="alert" hidden></p>' +
        '<div id="own-ev-form" hidden>' +
          '<label class="own-fld" for="own-f-name">Layer name' +
            '<input type="text" id="own-f-name" maxlength="60" autocomplete="off" />' +
            '<span class="own-err" id="own-name-err" role="alert" hidden>The layer needs a name.</span>' +
          "</label>" +
          '<label class="own-fld" for="own-f-colour" id="own-w-colour" hidden>' +
            '<span id="own-lbl-colour"></span>' +
            '<select id="own-f-colour"></select>' +
            '<span class="own-note warnish" id="own-multi-note" hidden></span>' +
          "</label>" +
          '<label class="own-fld" for="own-f-palette" id="own-w-palette" hidden>Colour ramp' +
            '<select id="own-f-palette"></select>' +
            '<span class="own-ramp" id="own-ramp" aria-hidden="true"></span>' +
          "</label>" +
          '<div class="own-fld" id="own-one-colour" hidden>' +
            '<span id="own-one-lbl">Which colour</span>' +
            '<div class="own-swatches" role="group" aria-labelledby="own-one-lbl" id="own-swatches"></div>' +
          "</div>" +
          '<div class="own-key-head"><span class="own-group">Map key</span>' +
            '<span class="own-key-note" id="own-key-note"></span></div>' +
          '<ul class="own-key" id="own-ev-key"></ul>' +
          '<label class="own-fld" for="own-f-title" id="own-w-title" hidden>Call each place by' +
            '<select id="own-f-title"></select>' +
            '<span class="own-note">The name shown when someone points at or opens a place.</span>' +
          "</label>" +
          '<div class="own-remove">' +
            '<button class="own-linkish" id="own-rm-link" type="button">Remove this layer from the atlas…</button>' +
            '<div class="own-confirm" id="own-rm-confirm" hidden>' +
              '<p id="own-rm-text"></p>' +
              '<p class="own-err" id="own-rm-err" role="alert" hidden></p>' +
              '<div class="own-row">' +
                '<button class="share-btn danger" id="own-rm-yes" type="button">Remove the layer</button>' +
                '<button class="share-btn" id="own-rm-no" type="button">Keep it</button>' +
              "</div>" +
            "</div>" +
          "</div>" +
        "</div>" +
      "</div>" +
      '<div class="own-save" id="own-save-bar" hidden>' +
        '<p class="own-save-note" id="own-save-note" role="status">' + NOTE_DEFAULT + "</p>" +
        '<div class="own-row">' +
          '<button class="share-btn primary" id="own-save-btn" type="button">Save changes</button>' +
          '<button class="share-btn" id="own-discard-btn" type="button">Discard changes</button>' +
        "</div>" +
      "</div>";
    host.appendChild(card);
    wireEditCard();
  }

  function profileOf(name) {
    if (!ED || !name) return null;
    return ED.profiles.filter(function (p) { return p.name === name; })[0] || null;
  }
  function colName(x) { return x && profileOf(x) ? x : null; }
  function snap(c) {
    return { name: c.name, colourBy: c.colourBy, valueBy: c.valueBy,
             palette: c.palette, markerColor: c.markerColor, titleBy: c.titleBy };
  }
  function whoLine(ed) {
    var by = (ed.meta && ed.meta.addedBy) || ed.stanza.addedBy || null;
    var who = by && (by.org || by.name || by.email);
    var bits = [];
    if (ed.features != null) bits.push(ed.features + (ed.features === 1 ? " place" : " places"));
    if (who) bits.push("added by " + who);
    return bits.join(" · ");
  }

  /* Point the map at a dataset. While a change is unsaved that is the DRAFT
     copy the server built; on save, discard or leaving it is the real atlas
     again. Nothing here draws the map itself — the viewer does, from the folder
     it is told to read. */
  function preview(dataset) {
    return window.LokaAtlas.reboot(dataset);
  }

  function openLayer(L, meta) {
    if (ED && ED.busy) return;
    ED = {
      layerId: L.id, stanza: L, meta: meta || {},
      importId: null, spec: null, fragment: null, profiles: [],
      catCols: [], numCols: [], titleCols: [], colourable: false,
      features: null, cur: null, base: null, mode: null,
      ready: false, busy: false, applySeq: 0, applyTimer: null,
      restRows: [], restTally: null,
    };
    $("#atlas-controls").hidden = true;
    $("#own-edit").hidden = false;
    setPanelHead(L.label || L.id);
    $("#own-ev-title").textContent = L.label || L.id;
    $("#own-ev-sub").textContent = whoLine(ED);
    $("#own-ev-loading").hidden = false;
    $("#own-ev-err").hidden = true;
    $("#own-ev-form").hidden = true;
    var bar = $("#own-save-bar");
    bar.hidden = true; bar.classList.remove("on");
    hideRemoveConfirm(true);
    $("#own-ev-title").focus();
    api("layers/reopen", { method: "POST", body: { dataset: SLUG, layerId: L.id } })
      .then(function (r) { if (ED && ED.layerId === L.id) hydrate(r, false); })
      .catch(function (err) {
        if (!ED || ED.layerId !== L.id) return;
        toast(errMsg(err));
        closeEdit(L.id);
      });
  }

  // the panel says what it is showing: all the layers, or the one being changed
  var PANEL_HEAD = null;
  function setPanelHead(text) {
    var h = document.querySelector("#atlas-panel .panel-head strong");
    if (!h) return;
    if (PANEL_HEAD == null) PANEL_HEAD = h.textContent;
    h.textContent = text == null ? PANEL_HEAD : text;
  }

  /* Older layers can have lost WHICH column their categories came from (the
     stanza only says the derived "_category"). The map still shows the rule, so
     recover it: the multi-value colourable column whose kind count reproduces
     the key the map is drawing. 8 = the server's top-8 fold. */
  function inferColourColumn() {
    var by = ED.stanza.markerBy;
    if (by && by !== "_category") return colName(by);
    if (by !== "_category") return null;
    var legLen = Array.isArray(ED.stanza.legend) ? ED.stanza.legend.length : 0;
    var mv = ED.catCols.filter(function (p) { return p.multiValue; });
    var fit = mv.filter(function (p) {
      return Math.min(p.kinds, 8) + (p.kinds > 8 ? 1 : 0) === legLen;
    })[0] || mv[0] || null;
    return fit && fit.name;
  }

  function guessTitle() {
    var byName = ED.titleCols.filter(function (n) { return NAMEISH.test(n.trim()); })[0];
    if (byName) return byName;
    var nameish = ED.profiles.filter(function (p) {
      return p.type === "string" && p.looksLikeName && !p.looksLikeImage && p.name.charAt(0) !== "_";
    })[0];
    return (nameish && nameish.name) || ED.titleCols[0] || null;
  }

  // silent=true re-baselines after a save without moving focus or resetting what
  // the person is looking at (the controls already hold the saved state)
  function hydrate(r, silent) {
    ED.importId = r.importId;
    ED.spec = r.spec || {};
    ED.profiles = r.profiles || [];
    ED.fragment = r.fragment || null;
    if (r.stats && r.stats.features != null) ED.features = r.stats.features;
    if (silent) {
      var again = (window.LokaAtlas.manifest.layers || [])
        .filter(function (l) { return l.id === ED.layerId; })[0];
      if (again) ED.stanza = again;
    }
    var kind = ED.spec.kind;
    ED.mode = COLOUR_MODES[kind] || null;
    ED.catCols = ED.profiles.filter(function (p) {
      return p.categorical && p.name.charAt(0) !== "_";
    });
    // lat/lng are numbers, but shading a map by its own latitude is noise, and
    // the server keeps them out of the spec anyway
    ED.numCols = ED.profiles.filter(function (p) {
      return p.type === "number" && p.name.charAt(0) !== "_" &&
        !/^(lat|latitude|lon|lng|long|longitude)$/i.test(p.name);
    });
    ED.colourable = !!(ED.mode && ED.mode.by);
    var colourBy = null, valueBy = null;
    if (kind === "category") {
      colourBy = colName(ED.spec.categoryColumn) || inferColourColumn();
      if (!colourBy) ED.colourable = false;   // nothing safe to offer
    } else if (kind === "markers") {
      colourBy = "one";
    } else if (ED.mode && ED.mode.by === "num") {
      valueBy = colName(ED.spec.valueColumn) || (ED.numCols[0] && ED.numCols[0].name) || null;
      if (!valueBy) ED.colourable = false;
    }
    ED.titleCols = ED.profiles.filter(function (p) {
      return p.type === "string" && !p.looksLikeImage && p.name.charAt(0) !== "_";
    }).map(function (p) { return p.name; });
    var titleBy = colName(ED.spec.popupTitleColumn) ||
      colName(ED.stanza.popup && ED.stanza.popup.title) || guessTitle();
    // a line's colour lives in lineColor, a polygon's in fillColor; all three
    // draw from the same five names, so one control serves whichever applies
    var flat = ED.spec.markerColor;
    if (kind === "line") flat = ED.spec.lineColor || "slate";
    else if (kind === "polygon") flat = ED.spec.fillColor || "moss";
    ED.cur = {
      name: ED.spec.label || ED.stanza.label || ED.layerId,
      colourBy: colourBy,
      valueBy: valueBy,
      palette: PALETTES[ED.spec.palette] ? ED.spec.palette : "greens",
      markerColor: MARKER_COLORS[flat] ? flat : "rust",
      titleBy: titleBy,
    };
    ED.base = snap(ED.cur);
    // at rest the map is the committed layer, so the key mirrors ITS legend;
    // reopen's rebuilt fragment only takes over once something changes. A shaded
    // layer's legend is a ramp object, not a list of rows — keep it whole rather
    // than letting the array test drop it on the floor.
    var sl = ED.stanza.legend;
    var haveStanza = Array.isArray(sl) ? sl.length > 0 : !!(sl && sl.ramp);
    ED.restRows = haveStanza ? sl : ((ED.fragment && ED.fragment.legend) || []);
    ED.restTally = null;
    renderControls();
    renderKey(ED.restRows, null, ED.features);
    syncMultiNote(null);
    $("#own-ev-title").textContent = ED.cur.name;
    setPanelHead(ED.cur.name);
    $("#own-ev-sub").textContent = whoLine(ED);
    $("#own-ev-loading").hidden = true;
    $("#own-ev-form").hidden = false;
    ED.ready = true;
    syncSaveBar();
    // per-kind counts, tallied from the layer's own rows
    if (ED.cur.colourBy && ED.cur.colourBy !== "one" && ED.stanza.source) {
      var lid = ED.layerId;
      tallyFile(window.LokaAtlas.fileUrl(ED.stanza.source), ED.cur.colourBy).then(function (t) {
        if (!ED || ED.layerId !== lid || !t || edDirty()) return;
        ED.restTally = t;
        renderKey(ED.restRows, t, ED.features);
        syncMultiNote(t);
      });
    }
  }

  function fillSelect(sel, opts, value) {
    sel.innerHTML = "";
    opts.forEach(function (o) {
      var el = document.createElement("option");
      el.value = o.value;
      el.textContent = o.label;
      sel.appendChild(el);
    });
    sel.value = value;
  }

  function renderControls() {
    $("#own-f-name").value = ED.cur.name;
    $("#own-name-err").hidden = true;
    var wc = $("#own-w-colour"), mode = ED.mode || {};
    /* A layer of places has no colour question left. Every pin wears the one
       standard marker, and which column colours the map is the reader's own
       choice through the key switches — the owner's pick only ever decided
       which key came first. Shaded maps and drawn shapes keep their colour,
       because there the colour is the content. */
    if (mode.by === "cat") { wc.hidden = true; } else
    if (ED.colourable && mode.by === "cat") {
      $("#own-lbl-colour").textContent = mode.label;
      var opts = ED.catCols.map(function (p) {
        return { value: p.name, label: p.name + " — " + p.kinds + " kinds" };
      });
      if (ED.cur.colourBy && ED.cur.colourBy !== "one" &&
          !opts.some(function (o) { return o.value === ED.cur.colourBy; })) {
        opts.unshift({ value: ED.cur.colourBy, label: ED.cur.colourBy });
      }
      opts.push({ value: "one", label: "One colour for every place" });
      fillSelect($("#own-f-colour"), opts, ED.cur.colourBy || "one");
      wc.hidden = false;
    } else if (ED.colourable && mode.by === "num") {
      // shaded areas and bubbles are driven by a number, not a class
      $("#own-lbl-colour").textContent = mode.label;
      var nopts = ED.numCols.map(function (p) { return { value: p.name, label: p.name }; });
      if (ED.cur.valueBy && !nopts.some(function (o) { return o.value === ED.cur.valueBy; })) {
        nopts.unshift({ value: ED.cur.valueBy, label: ED.cur.valueBy });
      }
      fillSelect($("#own-f-colour"), nopts, ED.cur.valueBy);
      wc.hidden = false;
    } else {
      wc.hidden = true;
    }
    renderPalette();
    renderSwatches();
    syncOneColour();
    var wt = $("#own-w-title");
    if (ED.titleCols.length && ED.cur.titleBy) {
      var topts = ED.titleCols.map(function (n) { return { value: n, label: n }; });
      if (!ED.titleCols.some(function (n) { return n === ED.cur.titleBy; })) {
        topts.unshift({ value: ED.cur.titleBy, label: ED.cur.titleBy });
      }
      fillSelect($("#own-f-title"), topts, ED.cur.titleBy);
      wt.hidden = false;
    } else {
      wt.hidden = true;
    }
  }

  function renderPalette() {
    var w = $("#own-w-palette");
    if (!ED.colourable || !(ED.mode && ED.mode.ramp)) { w.hidden = true; return; }
    fillSelect($("#own-f-palette"), Object.keys(PALETTES).map(function (k) {
      return { value: k, label: PALETTE_NAMES[k] || k };
    }), ED.cur.palette);
    paintRamp();
    w.hidden = false;
  }

  function paintRamp() {
    var ramp = PALETTES[ED.cur.palette] || [];
    $("#own-ramp").innerHTML = ramp.map(function (c) {
      return '<i style="--c:' + esc(c) + '"></i>';
    }).join("");
  }

  function renderSwatches() {
    var host = $("#own-swatches");
    host.innerHTML = "";
    Object.keys(MARKER_COLORS).forEach(function (k) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "own-sw";
      b.setAttribute("aria-pressed", String(ED.cur.markerColor === k));
      b.setAttribute("aria-label", MARKER_NAMES[k]);
      b.title = MARKER_NAMES[k];
      b.innerHTML = '<i style="--c:' + MARKER_COLORS[k] + '"></i>';
      b.onclick = function () {
        if (!ED || !ED.ready) return;
        ED.cur.markerColor = k;
        host.querySelectorAll(".own-sw").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
        syncSaveBar();
        scheduleApply();
      };
      host.appendChild(b);
    });
  }

  /* The flat-colour chips serve three cases: a points layer set to one colour,
     a bubble layer's circles, and a line or fill that has nothing else to
     choose. The label says which, because "Which colour" beside a polygon layer
     tells you nothing. */
  function syncOneColour() {
    if (!ED || !ED.cur) return;
    var mode = ED.mode || {};
    /* The five swatches painted a 2px ring on a white circle and one dot in the
       key — and from town height the ring vanished entirely, because a group of
       pins folds into a disc that ignores it. A place now wears the one standard
       marker. Drawn shapes keep their swatch: for a river or a boundary it is the
       only dial there is, and it means something. */
    var show = !!mode.swatch;
    $("#own-one-colour").hidden = !show;
    if (show) $("#own-one-lbl").textContent = mode.swatch || "Which colour";
  }

  // one swatch, one code path: the viewer's rows and this key must draw the same
  // mark for the same class or one of them is lying
  var LEG_SHAPES = { box: 1, dot: 1, line: 1, dashed: 1, triangle: 1, diamond: 1 };
  function swatchFor(it) {
    var row = it;
    if (it.shape && !LEG_SHAPES[it.shape]) row = Object.assign({}, it, { shape: "box" });
    return LokaIcons.swatchHTML(row, esc);
  }

  /* The key is output, not a control: rows come from the server's legend (the
     stanza at rest, the draft's fragment while editing). The counts are the one
     author-only annotation — the public key has none. */
  function renderKey(rows, tally, total) {
    /* A sequential scale reads as one graduated bar with its endpoints, not as
       a row per step — the same shape the viewer's own key uses, so the author
       sees what the reader will. */
    if (rows && !Array.isArray(rows) && rows.ramp) {
      $("#own-ev-key").innerHTML =
        '<li class="own-k-ramp"><span class="own-k-bar">' +
        rows.ramp.map(function (c) { return '<i style="--c:' + esc(c) + '"></i>'; }).join("") +
        '</span><span class="own-k-ends"><span>' + esc(rows.min) + "</span>" +
        (rows.unit ? "<span>" + esc(rows.unit) + "</span>" : "") +
        "<span>" + esc(rows.max) + "</span></span></li>";
      $("#own-key-note").textContent = total != null
        ? total + (total === 1 ? " area" : " areas") : "";
      return;
    }
    rows = Array.isArray(rows) ? rows : [];
    var single = rows.length === 1 && !rows[0].categorical;
    var counted = tally && tally.matched > 0 ? tally : null;
    var keptSum = 0;
    if (counted) {
      rows.forEach(function (it) {
        if (it.categorical && it.label !== "other" && counted.counts[it.label]) {
          keptSum += counted.counts[it.label];
        }
      });
    }
    $("#own-ev-key").innerHTML = rows.map(function (it) {
      var n = null;
      if (single && total != null) n = total;
      else if (counted && it.categorical) {
        n = it.label === "other" ? Math.max(0, counted.total - keptSum) : counted.counts[it.label];
      }
      return "<li>" + swatchFor(it) + '<span class="own-k-label">' + esc(it.label) + "</span>" +
        (n != null ? '<span class="own-k-count">' + n + "</span>" : "") + "</li>";
    }).join("");
    var kinds = rows.filter(function (it) { return it.categorical; }).length;
    $("#own-key-note").textContent =
      (kinds >= 2 ? kinds + " kinds" + (total != null ? " · " : "") : "") +
      (total != null ? total + (total === 1 ? " place" : " places") : "");
  }

  /* Count each kind from the layer's own rows. For a multi-value column the
     server derives the primary tag onto "_category" (fragment.js) — counting
     THAT property counts exactly what the map colours by; for single-value
     columns the entry itself is the kind (trimmed to the legend's 40 chars). */
  function tallyFile(url, col) {
    var p = profileOf(col);
    var derived = !!(p && p.multiValue);
    return fetch(url + (url.indexOf("?") < 0 ? "?v=" : "&v=") + Date.now())
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (g) {
        var feats = (g && g.features) || [];
        var counts = {}, multi = 0, matched = 0;
        feats.forEach(function (f) {
          var pr = f.properties || {};
          var raw = pr[col];
          var key = derived ? pr._category : (raw == null ? "" : String(raw).slice(0, 40));
          if (key != null && key !== "") { counts[key] = (counts[key] || 0) + 1; matched++; }
          if (derived && raw != null) {
            var s = String(raw).trim();
            if (s && s.slice(0, 40) !== pr._category) multi++;
          }
        });
        return { counts: counts, multi: multi, total: feats.length, matched: matched };
      })
      .catch(function () { return null; });
  }

  // said once, only when a multi-value column is chosen, with the count computed
  // from the data — the first tag decides the colour (fragment.js)
  function syncMultiNote(tally) {
    var note = $("#own-multi-note");
    var col = ED && ED.cur && ED.cur.colourBy;
    var p = col && col !== "one" ? profileOf(col) : null;
    if (!p || !p.multiValue || !tally || !tally.multi) { note.hidden = true; return; }
    note.hidden = false;
    note.textContent = (tally.multi === 1
      ? "1 place carries two or more " + col
      : tally.multi + " places carry two or more " + col) +
      " — the first one decides the colour.";
  }

  function controlsSpec() {
    var s = Object.assign({}, ED.spec);
    var name = $("#own-f-name").value.trim();
    s.label = (name || s.label || ED.layerId).slice(0, 60);
    if (ED.cur.titleBy) s.popupTitleColumn = ED.cur.titleBy;
    var mode = ED.mode || {};
    if (ED.colourable && mode.by === "cat") {
      if (ED.cur.colourBy === "one") {
        s.kind = "markers";
        s.markerColor = ED.cur.markerColor;
        delete s.categoryColumn;
      } else if (ED.cur.colourBy) {
        s.kind = "category";
        s.categoryColumn = ED.cur.colourBy;
      }
    } else if (ED.colourable && mode.by === "num" && ED.cur.valueBy) {
      s.valueColumn = ED.cur.valueBy;
      if (mode.ramp) s.palette = ED.cur.palette;
      else s.markerColor = ED.cur.markerColor;
    }
    // a flat line or fill names its colour in its own field
    if (s.kind === "line") s.lineColor = ED.cur.markerColor;
    else if (s.kind === "polygon") s.fillColor = ED.cur.markerColor;
    return s;
  }

  function edDirty() {
    if (!ED || !ED.ready) return false;
    var c = ED.cur, b = ED.base, mode = ED.mode || {};
    var flat = (c.colourBy === "one") || !!mode.swatch;
    return $("#own-f-name").value.trim() !== b.name.trim() ||
      c.colourBy !== b.colourBy ||
      c.valueBy !== b.valueBy ||
      (mode.ramp && c.palette !== b.palette) ||
      (flat && c.markerColor !== b.markerColor) ||
      c.titleBy !== b.titleBy;
  }

  function setNote(text, warn) {
    var n = $("#own-save-note");
    n.textContent = text;
    n.classList.toggle("warn", !!warn);
  }

  // the save bar does not exist until something changed
  function syncSaveBar() {
    if (!ED || !ED.ready) return;
    var bar = $("#own-save-bar");
    if (edDirty()) {
      if (bar.hidden) {
        bar.hidden = false;
        setNote(NOTE_DEFAULT, false);
        void bar.offsetHeight;   // commit the hidden->shown layout, then slide
      }
      bar.classList.add("on");
    } else {
      bar.classList.remove("on");
      bar.hidden = true;
      setNote(NOTE_DEFAULT, false);
    }
    var named = !!$("#own-f-name").value.trim();
    $("#own-name-err").hidden = named;
    $("#own-save-btn").disabled = !named || ED.busy;
    $("#own-discard-btn").disabled = ED.busy;
  }

  function scheduleApply() {
    if (!ED || !ED.ready) return;
    clearTimeout(ED.applyTimer);
    ED.applyTimer = setTimeout(function () { applyNow().catch(function () {}); }, 350);
  }

  // one apply per settled change; stale responses (an older apply landing after
  // a newer one) are dropped by the sequence check
  function applyNow() {
    if (!ED || !ED.importId) return Promise.reject({ error: "this layer is not open" });
    clearTimeout(ED.applyTimer);
    var mine = ++ED.applySeq, lid = ED.layerId;
    return api("layers/apply", { method: "POST", body: { importId: ED.importId, spec: controlsSpec() } })
      .then(function (r) {
        if (!ED || ED.layerId !== lid || mine !== ED.applySeq) return r;
        ED.spec = r.spec || ED.spec;
        ED.fragment = r.fragment || ED.fragment;
        if (r.stats && r.stats.features != null) ED.features = r.stats.features;
        setNote(NOTE_DEFAULT, false);
        var rows = (ED.fragment && ED.fragment.legend) || [];
        if (edDirty()) {
          renderKey(rows, null, ED.features);
          syncMultiNote(null);
          if (r.draftDataset) {
            var src = ED.fragment && ED.fragment.source;
            preview(r.draftDataset).then(function () {
              if (!ED || ED.layerId !== lid || mine !== ED.applySeq) return;
              if (!src || !ED.cur.colourBy || ED.cur.colourBy === "one") return;
              // the draft is what the map is reading now, so ask the viewer
              // where its files are rather than assembling a path here
              tallyFile(window.LokaAtlas.fileUrl(src), ED.cur.colourBy).then(function (t) {
                if (!ED || ED.layerId !== lid || mine !== ED.applySeq || !t) return;
                renderKey(rows, t, ED.features);
                syncMultiNote(t);
              });
            });
          }
        } else {
          // changed and changed back before the debounce settled — show the
          // saved truth, not a draft that happens to look the same
          renderKey(ED.restRows, ED.restTally, ED.features);
          syncMultiNote(ED.restTally);
          if (window.LokaAtlas.dataset !== SLUG) preview(SLUG);
        }
        return r;
      }, function (e) {
        if (ED && ED.layerId === lid && mine === ED.applySeq) setNote(errMsg(e), true);
        throw e;
      });
  }

  function saveChanges() {
    if (!ED || !ED.ready || ED.busy) return;
    var name = $("#own-f-name").value.trim();
    if (!name) { $("#own-name-err").hidden = false; $("#own-f-name").focus(); return; }
    ED.busy = true;
    syncSaveBar();
    var lid = ED.layerId, committed = false;
    applyNow().then(function () {
      return api("layers/commit", { method: "POST", body: { importId: ED.importId } });
    }).then(function () {
      committed = true;
      if (!ED || ED.layerId !== lid) return;
      ED.cur.name = name;
      ED.base = snap(ED.cur);
      toast("Saved — the atlas shows the new look.");
      return preview(SLUG).then(refreshLayers).then(function () {
        // commit closed the import session; reopen so editing can continue
        return api("layers/reopen", { method: "POST", body: { dataset: SLUG, layerId: lid } });
      }).then(function (r2) {
        if (!ED || ED.layerId !== lid) return;
        ED.busy = false;
        hydrate(r2, true);
        $("#own-ev-title").focus();
      });
    }).catch(function (e) {
      if (!ED || ED.layerId !== lid) return;
      ED.busy = false;
      if (committed) {
        // the save itself landed; only the follow-up reopen failed
        toast("Saved — open the layer again to keep editing.");
        closeEdit(lid);
        return;
      }
      setNote(errMsg(e), true);
      syncSaveBar();
    });
  }

  function discardChanges() {
    if (!ED || !ED.ready || ED.busy) return;
    ED.applySeq++;                    // orphan any in-flight apply
    clearTimeout(ED.applyTimer);
    ED.cur = snap(ED.base);
    renderControls();
    renderKey(ED.restRows, ED.restTally, ED.features);
    syncMultiNote(ED.restTally);
    if (window.LokaAtlas.dataset !== SLUG) preview(SLUG);   // the map snaps back to what is saved
    syncSaveBar();
    toast("Put back the way it was.");
    $("#own-ev-title").focus();
  }

  /* --- remove: the other thing you do to an existing layer --- */
  function hideRemoveConfirm(skipFocus) {
    $("#own-rm-confirm").hidden = true;
    $("#own-rm-err").hidden = true;
    $("#own-rm-link").hidden = false;
    if (!skipFocus) $("#own-rm-link").focus();
  }

  /* --- leaving the card: one way out, and it names its destination --- */
  function evBack() {
    if (!ED || ED.busy) return;
    if (edDirty()) {
      syncSaveBar();
      setNote("Unsaved changes — save them or discard them below.", true);
      $("#own-save-btn").focus();
      return;
    }
    if (ED.importId) {
      api("layers/discard", { method: "POST", body: { importId: ED.importId } }).catch(function () {});
    }
    closeEdit(ED.layerId);
  }
  function closeEdit(focusLid) {
    var wasDraft = window.LokaAtlas.dataset !== SLUG;
    ED = null;
    $("#own-edit").hidden = true;
    $("#atlas-controls").hidden = false;
    setPanelHead(null);
    var back = function () {
      if (!focusLid) return;
      var btn = document.querySelector('.own-change[data-lid="' + focusLid + '"]');
      if (btn) btn.focus();
    };
    if (wasDraft) preview(SLUG).then(back);
    else back();
  }

  function wireEditCard() {
    $("#own-back").onclick = evBack;
    $("#own-f-name").addEventListener("input", function () {
      if (!ED || !ED.ready) return;
      ED.cur.name = this.value;
      // the name never redraws the map — it appears only in this card and, on
      // any single-row key (one colour, a line, a fill), as that row's label:
      // patch it in place. A key with many rows names classes, not the layer.
      var labels = document.querySelectorAll("#own-ev-key .own-k-label");
      if (labels.length === 1) {
        labels[0].textContent = this.value.trim().slice(0, 40) || ED.base.name;
      }
      syncSaveBar();
    });
    // one select, two meanings: a class column for points, a number for shaded
    // areas and bubbles — the mode decides which field it writes
    $("#own-f-colour").addEventListener("change", function () {
      if (!ED || !ED.ready) return;
      if (ED.mode && ED.mode.by === "num") ED.cur.valueBy = this.value;
      else ED.cur.colourBy = this.value;
      syncOneColour();
      syncSaveBar();
      scheduleApply();
    });
    $("#own-f-palette").addEventListener("change", function () {
      if (!ED || !ED.ready) return;
      ED.cur.palette = this.value;
      paintRamp();
      syncSaveBar();
      scheduleApply();
    });
    $("#own-f-title").addEventListener("change", function () {
      if (!ED || !ED.ready) return;
      ED.cur.titleBy = this.value;
      syncSaveBar();
      scheduleApply();
    });
    $("#own-save-btn").onclick = saveChanges;
    $("#own-discard-btn").onclick = discardChanges;



    $("#own-rm-link").onclick = function () {
      if (!ED || !ED.ready) return;
      var n = ED.features;
      $("#own-rm-text").textContent = "Remove “" + ED.base.name + "”? " +
        (n != null ? "Its " + n + (n === 1 ? " place comes" : " places come") : "Its places come") +
        " off the map and the public atlas. Your original file stays with you.";
      $("#own-rm-link").hidden = true;
      $("#own-rm-confirm").hidden = false;
      $("#own-rm-no").focus();
    };
    $("#own-rm-no").onclick = function () { hideRemoveConfirm(); };
    $("#own-rm-yes").onclick = function () {
      if (!ED || !ED.ready || ED.busy) return;
      ED.busy = true;
      var lid = ED.layerId, name = ED.base.name, importId = ED.importId;
      var yes = this;
      yes.disabled = true;
      $("#own-rm-no").disabled = true;
      api("layers/remove", { method: "POST", body: { dataset: SLUG, layerId: lid } })
        .then(function () {
          if (importId) api("layers/discard", { method: "POST", body: { importId: importId } }).catch(function () {});
          toast("“" + name + "” removed from the atlas.");
          ED = null;
          $("#own-edit").hidden = true;
          $("#atlas-controls").hidden = false;
          setPanelHead(null);
          return preview(SLUG).then(refreshLayers).then(function () {
            var first = document.querySelector(".own-change") || $("#add-data-btn");
            if (first) first.focus();
          });
        })
        .catch(function (e) {
          if (!ED || ED.layerId !== lid) return;
          ED.busy = false;
          yes.disabled = false;
          $("#own-rm-no").disabled = false;
          var el = $("#own-rm-err");
          el.textContent = errMsg(e);
          el.hidden = false;
        });
    };

    // closing the tab with unsaved changes gets the browser's own one-liner
    window.addEventListener("beforeunload", function (e) {
      if (edDirty()) { e.preventDefault(); e.returnValue = ""; }
    });
  }

  /* ================= Settings =================
     One sheet for everything about the atlas rather than the layers on it: the
     region it covers, what it is called, who else may work on it, and — last,
     and owner-only — deleting it. This one IS a dialog: none of it is something
     you watch happening on the map, so making the page behind it inert is
     right, and the region rebuild in particular deserves the full stop. */

  function settingsHTML() {
    var b = INST.branding || {};
    var owner = INST.role === "owner";
    return '<div class="own-sheet" role="dialog" aria-modal="true" aria-label="Atlas settings">' +
      "<h2>Settings</h2>" +

      '<h3 class="own-set-h">Region</h3>' +
      '<p class="own-set-p">Where this atlas covers. Changing it rebuilds the base map, which takes a ' +
        'few minutes — the atlas stays up and your own data layers are kept.</p>' +
      '<div class="own-chips" id="own-chips"></div>' +
      '<label class="own-fld own-combo" style="margin-top:.6rem">Add a place' +
        '<input type="text" id="own-place" placeholder="Type a district, block or state…" ' +
          'autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" ' +
          'aria-controls="own-sugg" />' +
        '<ul class="own-sugg" id="own-sugg" role="listbox" aria-label="Matching places" hidden></ul>' +
      "</label>" +
      '<div class="own-row own-row-tight">' +
        '<button class="share-btn" id="own-region-save" disabled>Rebuild with this region</button>' +
        '<span class="own-err" id="own-region-msg" role="alert"></span></div>' +
      '<div class="own-confirm" id="own-region-confirm" hidden>' +
        '<p id="own-region-warn"></p>' +
        '<div class="own-row">' +
          '<button class="share-btn primary" id="own-region-yes" type="button">Rebuild the base map</button>' +
          '<button class="share-btn" id="own-region-no" type="button">Keep it as it is</button>' +
        "</div>" +
      "</div>" +

      '<h3 class="own-set-h">Identity</h3>' +
      '<label class="own-fld">Atlas title' +
        '<input type="text" id="own-title" maxlength="80" value="' + esc(INST.title || "") + '" /></label>' +
      '<label class="own-fld">What this atlas is for <span class="own-note">shown under the title</span>' +
        '<textarea id="own-desc" rows="3" maxlength="160">' + esc(INST.subtitle || "") + "</textarea></label>" +
      '<label class="own-fld">Organisation website <span class="own-note">optional, https</span>' +
        '<input type="text" id="own-site" placeholder="https://example.org" value="' + esc(b.orgUrl || "") + '" /></label>' +

      (owner ? '<h3 class="own-set-h">Who can edit it</h3>' +
      '<p class="own-set-p">Invite the people who need to work on this atlas. They can add and style ' +
        "data; only you can delete it or take it off the air.</p>" +
      '<div class="own-inv" id="own-inv-list"></div>' +
      '<div class="own-inv-add">' +
        '<input type="email" id="own-inv-email" aria-label="Email address to invite" ' +
          'placeholder="name@organisation.org" autocomplete="off" />' +
        '<button class="share-btn" id="own-inv-go">Invite</button>' +
      "</div>" : "") +

      '<div class="own-row own-row-top">' +
        '<button class="share-btn primary" id="own-set-save">Save changes</button>' +
        '<span class="own-err" id="own-set-err" role="alert"></span></div>' +

      /* Owner only, and last. Deleting an atlas is a different order of act from
         removing a layer: there is no history, no undo and no copy kept, and the
         published link stops working for everyone who has it. So the confirm is
         armed by typing the name rather than by one more click — the point is not
         friction, it is that you have to look at WHICH atlas you are naming.
         Collaborators are not offered it at all; the API refuses them, and
         offering a button that will be refused is a lie. */
      (owner ? '<div class="own-del">' +
        '<h3 class="own-set-h">Delete this atlas</h3>' +
        '<button class="own-linkish danger" id="own-del-open">Delete “' + esc(INST.title || SLUG) + '”…</button>' +
        '<div class="own-confirm" id="own-del-confirm" hidden>' +
          '<p>This removes the atlas, every data layer on it, and its base map. ' +
            'Anyone with the link will get a “not found” page, and collaborators lose access. ' +
            'There is no undo and no copy kept.</p>' +
          '<label class="own-fld">Type <b>' + esc(SLUG) + '</b> to confirm' +
            '<input type="text" id="own-del-slug" autocomplete="off" spellcheck="false" ' +
              'aria-describedby="own-del-err" placeholder="' + esc(SLUG) + '" /></label>' +
          '<div class="own-row">' +
            '<button class="share-btn" id="own-del-no">Keep it</button>' +
            '<button class="share-btn danger" id="own-del-yes" disabled>Delete permanently</button>' +
          "</div>" +
          '<span class="own-err" id="own-del-err" role="alert"></span>' +
        "</div></div>" : "") +
    "</div>";
  }

  function identityDirty(scrim) {
    var t = scrim.querySelector("#own-title");
    if (!t) return false;
    var b = INST.branding || {};
    return t.value.trim() !== (INST.title || "") ||
      scrim.querySelector("#own-desc").value.trim() !== (INST.subtitle || "") ||
      scrim.querySelector("#own-site").value.trim() !== (b.orgUrl || "");
  }

  /* ================= region: search, chips, rebuild =================
     The region is the one setting that cannot just be saved — it rebuilds the
     base map from open data. The build swaps the atlas over atomically and
     carries contributed layers across, so the atlas stays up and your own data
     survives; what a person still needs telling is that rows can end up outside
     a region that shrank. */
  var REG = { chosen: [], level: 2, dirty: false };

  function regionInit(scrim) {
    // start from what the atlas actually has, so "no change" is the default
    var r = INST.region || {};
    REG.level = Number(r.level) || 2;
    REG.chosen = (r.shapeIDs || []).map(function (id, i) {
      var names = r.shapeNames || [];
      return { id: id, name: names[i] || id, label: names[i] || id, level: REG.level };
    });
    REG.dirty = false;
    paintRegionChips(scrim);
    wireRegionSearch(scrim);
  }

  function paintRegionChips(scrim) {
    var host = scrim.querySelector("#own-chips");
    if (!host) return;
    host.innerHTML = "";
    if (!REG.chosen.length) {
      host.innerHTML = '<span class="own-set-p" style="margin:0">No places yet.</span>';
    }
    REG.chosen.forEach(function (c) {
      var renamed = c.label !== c.name;
      var el = document.createElement("span");
      el.className = "own-chip";
      if (renamed) el.title = 'The boundary data calls this "' + c.name + '"';
      el.innerHTML = "<span>" + esc(c.label) +
          (renamed ? ' <span class="own-chip-alt">(' + esc(c.name) + ")</span>" : "") + "</span>" +
        '<button class="own-chip-x" aria-label="Remove ' + esc(c.label) + '">✕</button>';
      el.querySelector(".own-chip-x").onclick = function () {
        REG.chosen = REG.chosen.filter(function (x) { return x.id !== c.id; });
        REG.dirty = true;
        paintRegionChips(scrim);
      };
      host.appendChild(el);
    });
    var save = scrim.querySelector("#own-region-save");
    if (save) save.disabled = !REG.dirty || !REG.chosen.length;
    var m = scrim.querySelector("#own-region-msg");
    if (m && !REG.chosen.length) m.textContent = "An atlas needs at least one place.";
    else if (m && m.textContent === "An atlas needs at least one place.") m.textContent = "";
  }

  function wireRegionSearch(scrim) {
    var box = scrim.querySelector("#own-place"), sugg = scrim.querySelector("#own-sugg");
    if (!box) return;
    var shown = [], cursor = -1, seq = 0, timer;
    var iso3 = (INST.region && INST.region.iso3) || "IND";

    function close() {
      sugg.hidden = true; box.setAttribute("aria-expanded", "false"); cursor = -1;
      box.removeAttribute("aria-activedescendant");
      box.setAttribute("aria-busy", "false");
    }
    /* One row in the suggestion box that is not a place: what the lookup is
       doing, or why it came back with nothing. A failure used to close the box
       in silence, which looked exactly like "there is no such place". */
    function suggNote(text, kind) {
      sugg.innerHTML = "";
      var li = document.createElement("li");
      li.setAttribute("role", "presentation");
      var row = document.createElement("span");
      row.className = "own-sugg-note" + (kind === "err" ? " is-err" : "");
      if (kind === "busy") {
        var sp = document.createElement("span");
        sp.className = "own-spin"; sp.setAttribute("aria-hidden", "true");
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
    function paint() {
      sugg.innerHTML = "";
      if (!shown.length) { close(); return; }
      shown.forEach(function (p, i) {
        var li = document.createElement("li");
        li.setAttribute("role", "presentation");
        var b = document.createElement("button");
        b.type = "button"; b.setAttribute("role", "option"); b.id = "own-opt-" + i;
        b.setAttribute("aria-selected", i === cursor ? "true" : "false");
        var lead = properName((p.alias && p.alias.typed) || p.name);
        var note = p.alias && p.alias.inData && p.alias.inData !== lead
          ? ' · listed as "' + p.alias.inData + '" in the boundary data' : "";
        b.innerHTML = '<span class="own-nm">' + esc(lead) + "</span>" +
          '<span class="own-wh">' + esc(p.label || "") + esc(note) + "</span>";
        b.onclick = function () { pick(p, lead); };
        li.appendChild(b); sugg.appendChild(li);
      });
      sugg.hidden = false; box.setAttribute("aria-expanded", "true");
      if (cursor >= 0) box.setAttribute("aria-activedescendant", "own-opt-" + cursor);
      else box.removeAttribute("aria-activedescendant");
    }
    function pick(p, label) {
      // one build, one level of detail — the API resolves the chosen places
      // against a single level, so mixing them would silently drop some
      if (REG.chosen.length && (p.level || 2) !== REG.level) {
        scrim.querySelector("#own-region-msg").textContent =
          "An atlas is built at one level of detail. Remove the places you have first to switch level.";
        box.value = ""; shown = []; close();
        return;
      }
      REG.level = p.level || 2;
      if (!REG.chosen.some(function (c) { return c.id === p.id; })) {
        REG.chosen.push({ id: p.id, name: p.name, label: label || p.name, level: REG.level });
        REG.dirty = true;
      }
      scrim.querySelector("#own-region-msg").textContent = "";
      box.value = ""; shown = []; close();
      paintRegionChips(scrim);
      box.focus();
    }
    function search(q) {
      q = q.trim();
      if (q.length < 2) { shown = []; close(); return; }
      var mine = ++seq;
      suggNote("Looking for places…", "busy");
      api("geo/search?iso3=" + encodeURIComponent(iso3) + "&q=" + encodeURIComponent(q) + "&limit=8")
        .then(function (r) {
          if (mine !== seq) return;
          var matches = (r.matches || []).filter(function (m) {
            return !REG.chosen.some(function (c) { return c.id === m.id; });
          });
          box.setAttribute("aria-busy", "false");
          if (!matches.length) { suggNote("No places here match “" + q + "”.", "empty"); return; }
          shown = matches; cursor = -1; paint();
        })
        .catch(function () {
          if (mine !== seq) return;
          suggNote("Could not reach the list of places. Try again in a moment.", "err");
        });
    }
    box.addEventListener("input", function () {
      clearTimeout(timer);
      var v = this.value;
      // the wait shows straight away rather than after the typing pause — that
      // pause was itself part of what felt broken
      if (v.trim().length >= 2) suggNote("Looking for places…", "busy");
      else close();
      timer = setTimeout(function () { search(v); }, 220);
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
        paint();
      } else if (e.key === "Enter") {
        if (cursor >= 0 && shown[cursor]) {
          e.preventDefault();
          pick(shown[cursor], properName((shown[cursor].alias && shown[cursor].alias.typed) || shown[cursor].name));
        }
      } else if (e.key === "Escape") { e.stopPropagation(); close(); }
    });
  }
  function properName(v) {
    return String(v || "").split(/\s+/).map(function (w) {
      return w ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    }).join(" ");
  }

  // The one question here used to be a native window.confirm — the only
  // browser-chrome dialog left in the product, guarding its biggest owner
  // action. It now asks inline, in the same styled confirm the remove-layer
  // and delete flows use. The chosen places are captured at confirm time so
  // the words and the action can never drift apart.
  function rebuildRegion(scrim, btn) {
    var m = scrim.querySelector("#own-region-msg");
    var mine = MINE.length;
    var chosen = REG.chosen.slice();
    var level = REG.level;
    var where = chosen.map(function (c) { return c.label; }).join(", ");
    var box = scrim.querySelector("#own-region-confirm");
    scrim.querySelector("#own-region-warn").textContent = mine
      ? "Rebuilding the base map for " + where + ". Your " + mine +
        (mine === 1 ? " data layer is" : " data layers are") + " kept, but rows " +
        "outside the new region will sit off the map."
      : "Rebuilding the base map for " + where + ".";
    box.hidden = false;
    scrim.querySelector("#own-region-no").onclick = function () { box.hidden = true; };
    scrim.querySelector("#own-region-yes").onclick = function () {
      box.hidden = true;
      btn.disabled = true; m.textContent = "";
      api("instances/" + encodeURIComponent(SLUG) + "/rebuild", {
        method: "POST",
        body: { region: { iso3: (INST.region && INST.region.iso3) || "IND", level: level,
                          shapeIDs: chosen.map(function (c) { return c.id; }) } },
      }).then(function (r) {
        closeDialog(scrim);
        toast("Rebuilding — this takes a few minutes. The atlas stays up meanwhile.");
        if (r.jobId) watchRebuild(r.jobId);
      }).catch(function (e) {
        btn.disabled = false;
        m.textContent = errMsg(e);
      });
    };
  }

  // the atlas is live throughout, so this only has to say when it is done
  function watchRebuild(jobId) {
    var tick = function () {
      api("jobs/" + encodeURIComponent(jobId)).then(function (j) {
        if (j.status === "done") {
          toast("Region rebuilt — redrawing the map");
          // the whole atlas changed underneath, base layers and all, so it is
          // read again from the top rather than patched
          setTimeout(function () { location.reload(); }, 900);
          return;
        }
        if (j.status === "failed") {
          toast("The rebuild failed — your atlas is unchanged. " + (j.message || ""));
          return;
        }
        setTimeout(tick, 2500);
      }).catch(function () { /* stop watching; the atlas is untouched either way */ });
    };
    setTimeout(tick, 2500);
  }

  function wireDelete(scrim) {
    var open = scrim.querySelector("#own-del-open");
    if (!open) return;                       // collaborators never see this
    var box = scrim.querySelector("#own-del-confirm"),
        slug = scrim.querySelector("#own-del-slug"),
        yes = scrim.querySelector("#own-del-yes"),
        no = scrim.querySelector("#own-del-no"),
        err = scrim.querySelector("#own-del-err");

    function close() {
      box.hidden = true; open.hidden = false;
      slug.value = ""; yes.disabled = true; err.textContent = "";
      open.focus();
    }
    open.onclick = function () { open.hidden = true; box.hidden = false; slug.focus(); };
    no.onclick = close;
    slug.addEventListener("input", function () {
      yes.disabled = this.value.trim() !== SLUG;
      err.textContent = "";
    });
    // Enter in the field is the same commitment as the button, but only once the
    // name matches — otherwise it is a stray keystroke, not a decision
    slug.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); if (!yes.disabled) yes.click(); }
    });
    yes.onclick = function () {
      if (slug.value.trim() !== SLUG) return;
      yes.disabled = true; no.disabled = true;
      yes.textContent = "Deleting…";
      err.textContent = "";
      api("instances/" + encodeURIComponent(SLUG), { method: "DELETE" })
        .then(function () {
          // this page's subject is gone; there is nothing here to return to
          location.href = "./setup/?deleted=" + encodeURIComponent(INST.title || SLUG);
        })
        .catch(function (e) {
          yes.textContent = "Delete permanently";
          no.disabled = false;
          yes.disabled = slug.value.trim() !== SLUG;
          err.textContent = errMsg(e);
        });
    };
  }

  function openSettings(land) {
    var sheet = openDialog(settingsHTML(), function (scrim) {
      regionInit(scrim);
      var rs = scrim.querySelector("#own-region-save");
      if (rs) rs.onclick = function () { rebuildRegion(scrim, this); };
      paintInvites(scrim);
      ["#own-title", "#own-desc", "#own-site"].forEach(function (sel) {
        scrim.querySelector(sel).addEventListener("input", function () {
          scrim.__warned = false;
          scrim.querySelector("#own-set-err").textContent = "";
        });
      });
      var go = scrim.querySelector("#own-inv-go");
      if (go) go.onclick = function () { invite(scrim); };
      scrim.querySelector("#own-set-save").onclick = function () { saveIdentity(scrim, this); };
      wireDelete(scrim);
    }, function () {
      var scrim = dialogStack[dialogStack.length - 1].scrim;
      if (!identityDirty(scrim) || scrim.__warned) return true;
      scrim.__warned = true;
      scrim.querySelector("#own-set-err").textContent =
        "Unsaved changes. Save them, or close again to discard.";
      scrim.querySelector("#own-set-save").focus();
      return false;
    });
    if (land === "region") {
      var pl = sheet.querySelector("#own-place");
      if (pl) { pl.scrollIntoView({ block: "start" }); pl.focus(); }
    }
    return sheet;
  }

  function saveIdentity(scrim, btn) {
    var t = scrim.querySelector("#own-title"), err = scrim.querySelector("#own-set-err");
    if (!t.value.trim()) { err.textContent = "An atlas cannot be untitled."; t.focus(); return; }
    var site = scrim.querySelector("#own-site").value.trim();
    if (site && !/^https:\/\/[^\s]+$/.test(site)) {
      err.textContent = "A website has to start with https://";
      scrim.querySelector("#own-site").focus();
      return;
    }
    btn.disabled = true; err.textContent = "";
    api("instances/" + encodeURIComponent(SLUG) + "/details", {
      method: "POST",
      body: {
        title: t.value.trim(),
        subtitle: scrim.querySelector("#own-desc").value.trim(),
        branding: { orgUrl: site },
      },
    }).then(function () {
      INST.title = t.value.trim();
      INST.subtitle = scrim.querySelector("#own-desc").value.trim();
      INST.branding = Object.assign({}, INST.branding, { orgUrl: site });
      scrim.__warned = true;              // nothing left to lose
      closeDialog(scrim);
      toast("Settings saved");
      // the title and description are drawn from the atlas's own manifest, which
      // the server has just rewritten — so read it again rather than patching
      // this page's copy and hoping the two agree
      preview(SLUG);
    }).catch(function (e) {
      err.textContent = errMsg(e);
    }).then(function () { btn.disabled = false; });
  }

  function paintInvites(scrim) {
    var host = scrim.querySelector("#own-inv-list");
    if (!host) return;
    var list = INST.collaborators || [];
    host.innerHTML = "";
    if (!list.length) {
      host.innerHTML = '<p class="own-set-p" style="margin:0">Nobody yet.</p>';
      return;
    }
    list.forEach(function (c) {
      var row = document.createElement("div");
      row.className = "own-inv-row";
      row.innerHTML = '<span class="own-inv-who">' + esc(c.email) + "</span>" +
        '<span class="own-inv-role">' + (c.acceptedAt ? "editing" : "invited") + "</span>" +
        '<button class="own-inv-x" aria-label="Remove ' + esc(c.email) + '">✕</button>';
      var x = row.querySelector(".own-inv-x");
      x.onclick = function () {
        x.disabled = true;
        api("instances/" + encodeURIComponent(SLUG) + "/collaborators", {
          method: "DELETE", body: { email: c.email },
        }).then(function (r) {
          INST.collaborators = r.collaborators || [];
          paintInvites(scrim);
          toast("Removed " + c.email);
        }).catch(function (e) { toast(errMsg(e)); x.disabled = false; });
      };
      host.appendChild(row);
    });
  }

  function invite(scrim) {
    var em = scrim.querySelector("#own-inv-email"), go = scrim.querySelector("#own-inv-go");
    var v = em.value.trim();
    if (!v) { em.focus(); return; }
    go.disabled = true;
    api("instances/" + encodeURIComponent(SLUG) + "/collaborators", { method: "POST", body: { email: v } })
      .then(function (r) {
        INST.collaborators = r.collaborators || [];
        em.value = "";
        paintInvites(scrim);
        // the invitation is an email; saying "invited" when it did not send would
        // be the atlas lying about something the person cannot see
        toast(r.sent === false ? "Added, but the email could not be sent" : "Invited " + v);
      })
      .catch(function (e) { scrim.querySelector("#own-set-err").textContent = errMsg(e); })
      .then(function () { go.disabled = false; });
  }

  window.LokaAtlasOwner = { mount: mount };
})();
