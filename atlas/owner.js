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

  /* The rules a reading obeys live in one file that the server reads too, so
     that a rule the browser learns cannot go on being wrong on the server —
     which is exactly how a key came to be called "Pattern 4". Loaded by a tag
     in index.html, before atlas.js fetches this. */
  var RULES = window.LokaReadingRules;

  var SLUG = "";
  var INST = null;         // the instance record: title, status, region, collaborators
  var MINE = [];           // GET /layers/list — the authority on which layers exist
  var MOUNTED = false;
  // layers whose reading is in flight this visit — a row is redrawn on every
  // toggle, and without this each redraw would start the reading again
  var RUNNING = {};

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
    /* In an open layer fold, Escape closes it — and an open remove-confirm
       folds first, like any other transient. There is nothing to warn about on
       the way out any more: a name is saved when you leave the box, so there is
       no such thing as a half-made change to lose. */
    if (FOLD) {
      var conf = FOLD.host && FOLD.host.querySelector(".own-confirm");
      if (conf && !conf.hidden) {
        conf.hidden = true;
        var link = FOLD.host.querySelector(".own-linkish");
        if (link) { link.hidden = false; link.focus(); }
        return;
      }
      closeFold(true);
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

  /* Which columns hold words worth reading — reading-rules.js has the rule and
     the reasons. The viewer holds places as features, so this hands their
     properties over; that adapting is all this is. */
  function wordColumns(feats) {
    return RULES.wordColumns((feats || []).map(function (f) {
      return (f && f.properties) || {};
    }));
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
    /* Already looked and found nothing? Then do not look again. Without this a
       layer whose words answer no question pays for that discovery on every
       visit, by every editor, for ever — the sort of cost that only shows up
       on the bill. */
    if (L.patternsNone) {
      wrap.appendChild(el("span", "own-door-said",
        "Analysed once \u2014 no pattern here runs through enough places to colour the map by."));
      return;
    }
    var done = Object.keys(feats[0].properties || {})
      .filter(function (k) { return /^pattern_\d+$/.test(k); });
    if (done.length) {
      wrap.appendChild(el("span", "own-door-said",
        "Patterns found once \u2014 " + done.length +
        (done.length === 1 ? " question this data answers, now a key above."
                           : " questions this data answers, each now a key above.")));
      /* A way back, for when the questions are wrong.

         Settling the questions was right: an atlas somebody has linked to
         should not change its keys under them, and adding places should not
         reshuffle the map. But settling made a bad set permanent from inside
         the product — one of these atlases asked "what kind of place is it?"
         with no kind for a park, and a third of its places went somewhere
         wrong with no way for their owner to say so.

         Deliberate, and it says what it will cost: the keys change, and
         anybody holding a link sees different ones. */
      var again = el("button", "own-linkish own-again", "Ask different questions\u2026");
      again.type = "button";
      var sure = el("div", "own-confirm");
      sure.hidden = true;
      sure.appendChild(el("p", null,
        "This reads your places again and looks for a fresh set of questions. " +
        "The keys on this map will change, and anyone you have shared the link with " +
        "will see the new ones. Your places and their words are untouched."));
      var row = el("div", "own-row");
      var no = el("button", "share-btn", "Keep these");
      no.type = "button";
      var yes = el("button", "share-btn danger", "Ask again");
      yes.type = "button";
      row.appendChild(no); row.appendChild(yes);
      sure.appendChild(row);
      again.onclick = function () { sure.hidden = false; again.hidden = true; no.focus(); };
      no.onclick = function () { sure.hidden = true; again.hidden = false; };
      yes.onclick = function () {
        yes.disabled = no.disabled = true;
        sure.replaceChildren(el("p", null, "Reading every place again\u2026"));
        askQuestions(L, feats, true);
      };
      wrap.appendChild(again);
      wrap.appendChild(sure);
      return;
    }

    var cols = wordColumns(feats);
    if (!cols.length) return;            // nothing written here to read
    askQuestions(L, feats, false, wrap);
  }

  /* Read these places and put the answers on the layer.

     `afresh` decides the one thing that matters here: whether the questions
     this layer already settled on are handed back to be answered again, or
     thrown away so a new set can be found. Everything else is the same either
     way, which is why it is one function and not two. */
  function askQuestions(L, feats, afresh, host) {
    var cols = wordColumns(feats);
    if (!cols.length) return;
    var wrap = host || document.createElement("div");

    /* No press. The questions a place can answer are the same questions
       everywhere, so asking permission to ask them was ceremony — the reading
       starts the moment somebody who may change this layer opens the atlas,
       and says what it is doing while it runs rather than before.

       Once only: the guard is the answered columns themselves, which exist as
       soon as the reading lands, so the next visit finds them and does nothing.
       RUNNING stops one layer starting twice inside a visit, because its row is
       redrawn every time the layer is switched or the panel rebuilt. */
    var panel = el("div", "own-door-body");
    wrap.appendChild(panel);
    if (RUNNING[L.id]) {
      panel.appendChild(el("p", "own-note", "Reading every place…"));
      return;
    }
    RUNNING[L.id] = true;

    panel.appendChild(el("p", "own-note own-door-cost",
      "Analysing your data to find the patterns underneath \u2014 reading " +
      esc(cols.slice(0, 3).join(", ")) + " across " + feats.length +
      " places \u00b7 about half a minute"));
    var msg = el("p", "own-note");
    msg.hidden = true;
    panel.appendChild(msg);
    function say(t, warn) {
      msg.hidden = !t; msg.textContent = t || "";
      msg.classList.toggle("warnish", !!warn);
    }

    (function () {
        say("Reading every place…");
        fetch(window.LokaAtlas.fileUrl(L))
          .then(function (r) { return r.json(); })
          .then(function (d) {
            var rows = (d.features || []).map(function (f) { return f.properties || {}; });
            return api("layers/enrich", { method: "POST", body: {
              dataset: SLUG, layerId: L.id, rows: rows, fields: cols, mode: "questions",
              /* The questions this layer already settled on. Sent back so a
                 reading after new places are added answers the same questions
                 rather than inventing a fresh set — the keys on a map somebody
                 has linked to should not move under them. */
              keepQuestions: afresh ? [] : settledQuestions(L, rows),
              title: (window.LokaAtlas.manifest && window.LokaAtlas.manifest.title) || "",
            } }).then(function (r) { return { r: r, rows: rows }; });
          })
          .then(function (out) {
            var qs = out.r.questions || [];
            if (out.r.verdict !== "questions" || !qs.length) {
              /* Three different answers, and they used to share one sentence.
                 "These places have nothing to be asked" is a finding. "The AI
                 could not be reached" is a fault on our side, and the person
                 should not be left thinking their data was the problem. */
              /* The promise is kept by the waiting list on the server: the
                 reading is written down, tried again on a backing-off timer,
                 and whoever asked is written to when it lands or when it is
                 given up on. So the line can say so again. */
              if (out.r.verdict === "unread") {
                var read = out.r.read || 0, all = out.r.batches || 0;
                say("The AI that reads your places could not be reached" +
                  (read && read < all
                    ? " part-way through, so nothing was kept — reading half a set would leave the rest looking like places with nothing to say."
                    : ", so nothing was added.") +
                  " Your data is untouched. This will be tried again on its own, and " +
                  "you will get an email when it is done.", true);
                return;
              }
              say(out.r.verdict === "no_clear_questions"
                ? "These places do not clearly answer a question" +
                  (out.r.note ? ": " + out.r.note : ".") + " Nothing was added."
                : "No questions could be found just now. Nothing was added.", true);
              // remember a considered "nothing here" so it is not rediscovered on
              // every visit; a passing failure is not remembered, only a real no
              if (out.r.verdict === "no_clear_questions") rememberNothingHere(L, out.rows);
              return;
            }
            say("Adding " + qs.length + (qs.length === 1 ? " question" : " questions") + "…");
            // anything that arrives here was read whole; a short reading never
            // reaches this point, it is refused above and nothing is written
            return keepQuestions(L, out.rows, qs).catch(function (e) {
              say(errMsg(e), true);
            });
          })
          .catch(function (e) { say(errMsg(e), true); });
    }());
  }

  /* Every question is kept. There is no asking: the questions a place can answer
     are universal, so the owner is not made to approve each one — they arrive as
     keys, each carrying the share of places it can speak for, and any that is
     not wanted is simply left switched off.

     One column per question, pattern_1, pattern_2 …, with the question itself
     stored as the key's name so a reader meets "What can you do here?" rather
     than a column named after how it was made. */
  /* Writes the layer back unchanged but for one mark on it: asked, nothing
     found. One reading's cost once, instead of a small cost for ever. */
  function rememberNothingHere(L, rows) {
    /* Cleared through the shared rule, which also drops any previous answer.
       This used to clear only the engine's own column, so a layer that had once
       been read and now reads as nothing would have kept its old answers —
       the same omission that produced "Pattern 4", one path over. */
    var out = RULES.withoutAnswers(rows);
    return api("layers/ingest", { method: "POST", body: {
      dataset: SLUG, replaceLayerId: L.id, filename: L.label || L.id,
      patternsNone: true,
      schema: RULES.schemaFor(out),
      rows: out,
      meta: { sourceName: L.source, rowCount: out.length },
    } })
      .then(function (ing) {
        return api("layers/commit", { method: "POST", body: { importId: ing.importId, dataset: SLUG } });
      })
      .catch(function () { /* not worth troubling anyone with — it retries next visit */ });
  }

  // what this layer has already been asked, wording and kinds together
  function settledQuestions(L, rows) {
    return RULES.settledQuestions(L, rows || []);
  }

  function keepQuestions(L, rows, questions) {
    /* The shaping is the shared rule's — one column per question, its words
       beside it, every previous answer cleared first. All that is left here is
       sending it, which is the one thing the browser and the server genuinely
       do differently. */
    var shaped = RULES.shapeReading(rows, questions);
    var out = shaped.rows, labels = shaped.keyLabels, kinds = shaped.keyKinds;
    return api("layers/ingest", { method: "POST", body: {
      dataset: SLUG, replaceLayerId: L.id, filename: L.label || L.id,
      schema: shaped.schema,
      rows: out,
      keyLabels: labels, keyKinds: kinds,
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
          // the file was rewritten under the same name; say so before rebooting
          // or the reboot reads the copy the browser already had
          if (window.LokaAtlas.dataChanged) window.LokaAtlas.dataChanged();
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
        toast(live ? "Taken off — only you can see it now"
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
      toggleFold(L, m);
    };
    var head = row.querySelector(".ctl-toggle") || row;
    var info = head.querySelector(".ctl-info");
    if (info) head.insertBefore(btn, info);
    else head.appendChild(btn);
    addRenamePencil(L, head, btn);
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

  /* ================= one layer's own fold =================

     This was a card that replaced the whole panel: a name, a colour question, a
     colour ramp, which colour, a preview of the map key, what to call each
     place, and a remove. Eight hundred lines, and a draft copy of the atlas
     opened, previewed and committed behind every keystroke.

     The reading took most of its job. Colour is decided by the questions now, so
     for a layer of places three of its seven controls were already hidden and a
     fourth — the map key — was a read-only picture of something the panel showed
     properly one level up. What was left was a name, a title column and a
     remove, sitting in a container named for changing things that mostly could
     not change anything.

     Fable's verdict, and the reason it is a fold and not a smaller panel: the
     owner controls that WORK in this product sit next to the thing they change —
     Change on the layer's row, "Ask different questions" under the keys, the
     region under the base-map switch. The one that sat in its own panel is the
     one that became a stub. So the three that are left open under the row they
     belong to, with the real map key already beneath them, and nothing is
     previewed because nothing here needs previewing: a name is a name.

     Two strings and a removal, through two small routes, with no draft copy of
     the atlas involved. */

  /* Renaming happens where the name is.

     It used to be a box inside a panel you opened to get to — which is a long
     way to go to change a word, and it put the name you were editing out of
     sight of the map that shows it. The pencil sits after the name; the name
     becomes a box in place; the pencil becomes a tick. Enter or the tick saves,
     Escape puts back what was there, and leaving the box saves as any field in
     this product does.

     The hit area grows to the RIGHT of the glyph, never back over the name —
     the name is the visibility switch's own label, and a rename control that
     swallowed part of it would make the switch unreliable to tap. */
  function addRenamePencil(L, head, changeBtn) {
    if (head.querySelector(".own-pencil")) return;
    var nameEl = head.querySelector(".ctl-name");
    if (!nameEl) return;
    var pen = el("button", "own-pencil", ICON_PENCIL);
    pen.type = "button";
    pen.title = "Rename this layer";
    pen.setAttribute("aria-label", "Rename " + (L.label || L.id));
    pen.onclick = function (e) {
      e.preventDefault(); e.stopPropagation();
      startRename(L, head, nameEl, pen, changeBtn);
    };
    nameEl.insertAdjacentElement("afterend", pen);
  }

  var ICON_PENCIL =
    '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" ' +
    'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10z"/></svg>';
  var ICON_TICK =
    '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3 8.5l3.5 3.5L13 4.5"/></svg>';

  function startRename(L, head, nameEl, pen, changeBtn) {
    if (head.querySelector(".own-rename")) return;
    var was = L.label || L.id;
    var box = document.createElement("input");
    box.type = "text";
    box.className = "own-rename";
    box.maxLength = 60;
    box.value = was;
    box.setAttribute("aria-label", "Layer name");
    nameEl.hidden = true;
    // a box, a tick and Change do not fit in 312px; Change waits its turn
    if (changeBtn) changeBtn.hidden = true;
    nameEl.insertAdjacentElement("beforebegin", box);
    pen.innerHTML = ICON_TICK;
    pen.title = "Save this name";
    var done = false;
    function finish(save) {
      if (done) return;
      done = true;
      var v = box.value.trim();
      box.remove();
      nameEl.hidden = false;
      if (changeBtn) changeBtn.hidden = false;
      pen.innerHTML = ICON_PENCIL;
      pen.title = "Rename this layer";
      pen.focus();
      if (!save || !v || v === was) return;
      nameEl.textContent = v;      // say it at once; the reload confirms it
      api("layers/relabel", { method: "POST", body: { dataset: SLUG, layerId: L.id, label: v } })
        .then(function () { return preview(SLUG).then(refreshLayers); })
        .catch(function (e) { nameEl.textContent = was; toast(errMsg(e)); });
    }
    box.onkeydown = function (e) {
      if (e.key === "Enter") { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
      e.stopPropagation();
    };
    box.onblur = function () { finish(true); };
    pen.onclick = function (e) { e.preventDefault(); e.stopPropagation(); finish(true); };
    box.focus();
    box.select();
  }

  var FOLD = null;          // { lid, host, row } — at most one open

  function preview(dataset) {
    return window.LokaAtlas.reboot(dataset);
  }

  function closeFold(focusBack) {
    if (!FOLD) return;
    var lid = FOLD.lid;
    if (FOLD.host && FOLD.host.parentNode) FOLD.host.parentNode.removeChild(FOLD.host);
    FOLD = null;
    if (focusBack) {
      var btn = document.querySelector('.own-change[data-lid="' + cssEsc(lid) + '"]');
      if (btn) btn.focus();
    }
  }

  // an id is ours and slug-shaped, but a selector is not the place to trust that
  function cssEsc(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  function toggleFold(L, meta) {
    if (FOLD && FOLD.lid === L.id) { closeFold(true); return; }
    closeFold(false);
    buildFold(L, meta);
  }

  function buildFold(L, meta) {
    var row = L._row;
    if (!row) return;
    var host = el("div", "own-fold");
    host.setAttribute("data-lid", L.id);

    /* The name is not here any more — it is edited from the row, where it is.
       What is here is what a place's card says, which is the thing you cannot
       do from anywhere else and which needs more than one tap. */
    var cardBox = el("div", "own-fld");
    cardBox.appendChild(document.createTextNode("On every place's card"));
    var list = el("div", "own-cards");
    var chosen = cardColumnsNow(L);
    var offer = cardColumnCandidates(L);
    var boxes = [];
    if (!offer.length) {
      list.appendChild(el("p", "own-note", "This layer has nothing else to show on a card."));
    }
    offer.forEach(function (c) {
      var row = el("label", "ctl-toggle own-card");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = chosen.indexOf(c.col) >= 0;
      cb._col = c.col;
      boxes.push(cb);
      row.appendChild(cb);
      row.appendChild(el("span", "own-card-tick"));
      var text = el("span", "own-card-t");
      text.appendChild(el("span", "own-card-n", prettyish(c.col)));
      // a real entry from these places, so nobody has to guess what a column holds
      if (c.sample) text.appendChild(el("span", "own-card-eg", c.sample));
      row.appendChild(text);
      cb.onchange = function () {
        save({ cardColumns: boxes.filter(function (b) { return b.checked; })
          .map(function (b) { return b._col; }) });
      };
      list.appendChild(row);
    });
    cardBox.appendChild(list);
    if (offer.length) {
      cardBox.appendChild(el("span", "own-note",
        "Answers to your questions are shown by their keys, so they are not listed here."));
    }
    host.appendChild(cardBox);

    var err = el("p", "own-err");
    err.setAttribute("role", "alert");
    err.hidden = true;
    host.appendChild(err);

    /* Which questions this atlas offers.

       The questions settle at the first reading and stay, so that a map somebody
       has linked to does not change its keys under them. That is right, and it
       makes a bad question permanent — and until now the only way out was to
       throw away the whole set and let the model find another, which is a great
       deal to risk to be rid of one. So each one can be taken off the map here.

       Nothing is deleted: the question was asked, every place still carries its
       answer and the words behind it, and turning it back on puts it straight
       back. This is the one place a hidden question is still visible, which is
       why it lists them all rather than only the ones still showing. */
    var qs = questionsOf(L);
    if (qs.length) {
      var box = el("div", "own-fld");
      box.appendChild(document.createTextNode("Questions this atlas offers"));
      var list = el("div", "own-qs");
      qs.forEach(function (q) {
        // ctl-toggle so this IS the viewer's switch rather than a second one
        // built to look like it — the checked state lives in that rule
        var row = el("label", "ctl-toggle own-q");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !q.hidden;
        row.appendChild(cb);
        row.appendChild(el("span", "ctl-switch small"));
        row.appendChild(el("span", "own-q-name", q.label));
        cb.onchange = function () {
          var now = (L.hiddenKeys || []).slice();
          var at = now.indexOf(q.col);
          if (cb.checked) { if (at >= 0) now.splice(at, 1); }
          else if (at < 0) now.push(q.col);
          save({ hiddenKeys: now });
        };
        list.appendChild(row);
      });
      box.appendChild(list);
      box.appendChild(el("span", "own-note",
        "Turning one off takes its switch off the map. The answers stay on every place."));
      host.appendChild(box);
    }

    /* Saved on the way out of a control rather than behind a Save button. There
       is nothing here to preview and nothing to get half-done: two strings, each
       written on its own. */
    var saving = false;
    function save(patch, then) {
      if (saving) return;
      saving = true;
      err.hidden = true;
      api("layers/relabel", { method: "POST", body: Object.assign(
        { dataset: SLUG, layerId: L.id }, patch) })
        .then(function () {
          saving = false;
          /* The map is rebuilt from the changed manifest, which takes the panel
             and this fold with it — so it is opened again on the same layer.
             Without that, setting a name and then choosing what to call each
             place is two trips, and the second one is not obviously still
             available: the fold just vanishes as you finish typing. */
          return preview(SLUG).then(refreshLayers).then(function () {
            var again = (window.LokaAtlas.manifest.layers || []).filter(
              function (x) { return x.id === L.id; })[0];
            if (again && again._row) buildFold(again, meta);
            if (then) then();
          });
        })
        .catch(function (e) {
          saving = false;
          err.textContent = errMsg(e);
          err.hidden = false;
        });
    }

    /* The remove, with the wording it already had — the same sentence in the
       same order, because it is the one place here that cannot be taken back and
       the words had been thought about. */
    var rm = el("div", "own-remove");
    var rmLink = el("button", "own-linkish");
    rmLink.type = "button";
    rmLink.textContent = "Remove this layer from the atlas…";
    var confirm = el("div", "own-confirm");
    confirm.hidden = true;
    var n = countPlaces(L);
    confirm.appendChild(el("p", null, "Remove “" + (L.label || L.id) + "”? " +
      (n != null ? "Its " + n + (n === 1 ? " place comes" : " places come") : "Its places come") +
      " off the map and the public atlas. Your original file stays with you."));
    var rmErr = el("p", "own-err");
    rmErr.setAttribute("role", "alert");
    rmErr.hidden = true;
    confirm.appendChild(rmErr);
    var buttons = el("div", "own-row");
    var yes = el("button", "share-btn danger");
    yes.type = "button";
    yes.textContent = "Remove the layer";
    var no = el("button", "share-btn");
    no.type = "button";
    no.textContent = "Keep it";
    buttons.appendChild(yes);
    buttons.appendChild(no);
    confirm.appendChild(buttons);
    rmLink.onclick = function () {
      rmLink.hidden = true;
      confirm.hidden = false;
      no.focus();
    };
    no.onclick = function () {
      confirm.hidden = true;
      rmLink.hidden = false;
      rmLink.focus();
    };
    yes.onclick = function () {
      yes.disabled = true;
      rmErr.hidden = true;
      api("layers/remove", { method: "POST", body: { dataset: SLUG, layerId: L.id } })
        .then(function () {
          closeFold(false);
          toast("“" + (L.label || L.id) + "” is off the map.");
          return preview(SLUG).then(refreshLayers);
        })
        .catch(function (e) {
          yes.disabled = false;
          rmErr.textContent = errMsg(e);
          rmErr.hidden = false;
        });
    };
    rm.appendChild(rmLink);
    rm.appendChild(confirm);
    host.appendChild(rm);

    row.appendChild(host);
    FOLD = { lid: L.id, host: host, row: row };
    // the first thing you can act on, so a keyboard lands somewhere useful
    var first = host.querySelector("input, button");
    if (first) first.focus();
  }

  /* What is on a card now. The stanza is the truth — the browser holds the
     manifest it loaded, and that is what the fold must agree with. */
  function cardColumnsNow(L) {
    return ((L.popup && L.popup.fields) || []).map(function (f) { return f.property; });
  }

  /* Which columns are worth offering, and one real entry from each so a person
     is choosing between things rather than between names. A column the reading
     answered is left out — its answers belong to the key, and putting one on a
     card as a plain line is the "Pattern 1" fault we shipped and fixed. */
  function cardColumnCandidates(L) {
    var gj = window.LokaAtlas.dataFor && window.LokaAtlas.dataFor(L.id);
    var feats = (gj && gj.features) || [];
    var title = (L.popup && L.popup.title) || "";
    var names = feats.length ? Object.keys(feats[0].properties || {})
      : cardColumnsNow(L);
    return names.filter(function (k) {
      if (k.charAt(0) === "_" || /^pattern_/.test(k)) return false;
      if (k === title) return false;
      if (/^(lat|latitude|lon|lng|long|longitude)$/i.test(k)) return false;
      if (/(^|_)(id|uuid|guid)$/i.test(k)) return false;
      if (!feats.length) return true;
      // a column no place has anything in cannot be shown
      return feats.some(function (f) {
        var v = (f.properties || {})[k];
        return typeof v === "string" ? v.trim() : v != null;
      });
    }).map(function (k) {
      var eg = "";
      for (var i = 0; i < feats.length && !eg; i++) {
        var v = (feats[i].properties || {})[k];
        if (typeof v === "string" && v.trim()) eg = v.trim();
        else if (typeof v === "number") eg = String(v);
      }
      if (/^https?:\/\//i.test(eg)) eg = "a picture";
      return { col: k, sample: eg ? eg.replace(/\s+/g, " ").slice(0, 44) : "" };
    });
  }

  // "created_at" is not a thing to show somebody in a menu
  function prettyish(col) {
    var s = String(col).replace(/[_-]+/g, " ").trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* Every question this layer carries, showing or not. The viewer's own list
     leaves the hidden ones out — which is its job, and the reason this reads the
     layer's stanza instead. */
  function questionsOf(L) {
    var labels = (L && L.keyLabels) || {};
    var hidden = (L && L.hiddenKeys) || [];
    return Object.keys(labels)
      .filter(function (c) { return /^pattern_\d+$/.test(c); })
      .sort(function (a, b) { return Number(a.split("_")[1]) - Number(b.split("_")[1]); })
      .map(function (c) {
        return { col: c, label: labels[c], hidden: hidden.indexOf(c) >= 0 };
      });
  }

  function countPlaces(L) {
    var gj = window.LokaAtlas.dataFor && window.LokaAtlas.dataFor(L.id);
    return (gj && gj.features) ? gj.features.length : null;
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
        "data; only you can delete it or take it off.</p>" +
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
