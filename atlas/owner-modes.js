/* LOKA Atlas — the owner's tools for how visitors explore an atlas.
 *
 * Loaded by owner.js (never by a visitor's page), which hands over what it
 * owns — api, toast, dialogs, the shelves — through mount(ctx). Three things:
 *   - the Owner menu's "How visitors explore · <mode>" line and its dialog
 *     (Standard, Event, Explore, Insight; POST /instances/:slug/mode);
 *   - "See it as a visitor", the menu's first line;
 *   - Explore's Buttons tab (owner.js builds the tabs; this draws what is in
 *     them), and Insight's Settings tab (added here to the visitor's own
 *     tabs, What the places say · Questions, which insight-mode.js draws).
 * The rules for buttons are explore-mode.js's, and for Insight's questions
 * insight-mode.js's: the same files the server checks with. */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var C = null, api, errMsg, esc, toast, openDialog, rowsOnMap, INST, SLUG;

  /* ---------------- how visitors explore ----------------
     Three ways an atlas can meet its visitors: Standard (the layers and the
     questions), Event (a festival guide, event-mode.js) and Explore (four
     buttons and "Around here", explore-mode.js). The Owner menu says which is
     in use and, for the owner, offers Change. Switching keeps the old mode's
     settings on the server (modeKept), so switching back finds them as they
     were left; the page then reloads to draw the atlas the new way, and says
     so on arrival. The server is the authority on what is kept and whether an
     event guide has been set up (GET /instances/:slug/mode). */
  var MODES = {
    standard: { t: "Standard", d: "The map with its layers, and questions about what the places show.",
      sees: "the layers and the questions about the places" },
    event: { t: "Event", d: "A festival guide: the venues, each venue's programme day by day, and what is nearby.",
      sees: "the venues, each venue's programme, and what is near each one" },
    explore: { t: "Explore", d: "For visitors finding their way around: up to four buttons, and a list of what is around here.",
      sees: "up to four buttons and a list of what is around here" },
    insight: { t: "Insight", d: "For people reading patterns: the questions, with a short summary on top.",
      sees: "the questions LOKA asked of the places, each answer counted and coloured on the map, with a short summary on top" },
  };
  var MODE_ORDER = ["standard", "event", "explore", "insight"];
  var INSIGHT_NOT_READY = "Insight needs the questions LOKA asks of the places. They appear once the atlas has been read.";
  var EVENT_NOT_SET_UP = "An event guide needs its venues and programme set up first. LOKA sets this up for you — write to us.";
  var MODE_SWITCHED = "loka-mode-switched";
  var MODEINFO = null;   // the server's answer: { name, kept, canEvent, canInsight, canChange }

  // the mode the page is drawing (what the owner's tabs must match)
  function modeDrawn() {
    var M = window.LokaAtlas && window.LokaAtlas.manifest, m = M && M.mode;
    return m && typeof m === "object" && (m.name === "explore" || m.name === "event" || m.name === "insight") ? m.name : "standard";
  }
  function modeName() { return (MODEINFO && MODES[MODEINFO.name]) ? MODEINFO.name : modeDrawn(); }

  function paintMode() {
    var what = $("#own-mode-what"), small = $("#own-mode-small"), act = $("#own-mode-change");
    if (!what || !small || !act) return;
    var name = modeName();
    what.textContent = "How visitors explore · " + MODES[name].t;
    var owner = INST.role === "owner";
    small.textContent = owner ? MODES[name].d : "Only the owner can change this";
    act.hidden = !owner || INST.status === "building" || INST.status === "pending-approval";
  }
  function loadModeInfo() {
    return api("instances/" + encodeURIComponent(SLUG) + "/mode")
      .then(function (j) { MODEINFO = j; paintMode(); return j; })
      .catch(function () { return null; });
  }
  // after a switch the page comes back fresh; it says what happened, once
  function modeArrived() {
    var was = null;
    try {
      was = JSON.parse(sessionStorage.getItem(MODE_SWITCHED) || "null");
      sessionStorage.removeItem(MODE_SWITCHED);
    } catch (e) { was = null; }
    if (!was || was.slug !== SLUG || !MODES[was.to] || !MODES[was.from]) return;
    toast("Now in " + MODES[was.to].t + ". Your " + MODES[was.from].t + " settings are kept for when you switch back.", 6500);
  }

  function modeDialogHTML(cur, title) {
    return '<div class="own-sheet own-mode-sheet" role="dialog" aria-labelledby="own-mode-h">' +
      '<div id="own-mode-pick">' +
        '<h2 id="own-mode-h">How should visitors find their way?</h2>' +
        '<p class="own-set-p">Pick one for ' + esc(title) + '. Your places and photos stay the same in every mode. ' +
          'Only what visitors see around the map changes.</p>' +
        '<div class="own-choices" role="radiogroup" aria-labelledby="own-mode-h">' +
        MODE_ORDER.map(function (id) {
          return '<label class="own-choice"><input type="radio" name="own-mode" value="' + id + '"' + (id === cur ? " checked" : "") + " />" +
            "<span><b>" + MODES[id].t + (id === cur ? ' <span class="own-mode-now">In use now</span>' : "") + "</b>" +
            '<span class="own-choice-p">' + esc(MODES[id].d) + "</span></span></label>";
        }).join("") +
        "</div>" +
        '<div class="own-mode-confirm" id="own-mode-confirm" role="status" hidden></div>' +
        '<div class="own-row own-row-top">' +
          '<button class="share-btn" id="own-mode-keep" type="button" data-close>Close</button>' +
          '<button class="share-btn primary" id="own-mode-go" type="button" hidden></button>' +
        "</div>" +
        '<p class="own-err" id="own-mode-err" role="alert"></p>' +
      "</div>" +
      '<div id="own-mode-wait" hidden></div>' +
    "</div>";
  }

  function openModeDialog() {
    if (INST.role !== "owner") { toast("Only the owner can change how visitors explore this atlas"); return; }
    (MODEINFO ? Promise.resolve(MODEINFO) : loadModeInfo()).then(function () { showModeDialog(); });
  }
  function showModeDialog() {
    var cur = modeName();
    var M = window.LokaAtlas && window.LokaAtlas.manifest;
    var title = (M && M.title) || INST.title || "this atlas";
    var busy = false;
    openDialog(modeDialogHTML(cur, title), function (scrim) {
      var conf = scrim.querySelector("#own-mode-confirm"), go = scrim.querySelector("#own-mode-go");
      var keep = scrim.querySelector("#own-mode-keep"), err = scrim.querySelector("#own-mode-err");
      var pick = scrim.querySelector("#own-mode-pick"), wait = scrim.querySelector("#own-mode-wait");
      function picked() { return (scrim.querySelector('input[name="own-mode"]:checked') || {}).value || cur; }
      function say() {
        var to = picked();
        err.textContent = "";
        if (to === cur) { conf.hidden = true; go.hidden = true; keep.textContent = "Close"; return; }
        keep.textContent = "Keep " + MODES[cur].t;
        conf.hidden = false;
        if (to === "event" && !(MODEINFO && MODEINFO.canEvent)) {
          conf.innerHTML = "<p>" + esc(EVENT_NOT_SET_UP) + "</p>";
          go.hidden = true;
          return;
        }
        // Insight reads the questions LOKA asked; an atlas not yet read has none
        if (to === "insight" && !(MODEINFO && MODEINFO.canInsight)) {
          conf.innerHTML = "<p>" + esc(INSIGHT_NOT_READY) + "</p>";
          go.hidden = true;
          return;
        }
        var n = rowsOnMap();
        var lines = [
          "Visitors will see " + MODES[to].sees + ".",
          "Nothing is lost: " + (n > 1 ? "all " + n.toLocaleString() + " places and their photos stay"
            : n === 1 ? "the one place and its photos stay" : "every place and its photos stay") + " exactly as they are.",
          MODES[cur].t + "’s settings are kept. Switch back and they return as you left them.",
        ];
        if (to === "explore" && !(MODEINFO && (MODEINFO.kept || []).indexOf("explore") >= 0)) {
          lines.push("To start, LOKA makes up to four buttons from the categories your places use most. You can change them under Buttons.");
        }
        if (to === "insight") {
          lines.push("LOKA writes a short summary of what the places say. It takes about a minute; visitors see the questions meanwhile. You choose which questions show, and their order, under Settings.");
        }
        conf.innerHTML = "<p>Switch " + esc(title) + " from " + MODES[cur].t + " to " + MODES[to].t + "?</p><ul>" +
          lines.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul>";
        go.hidden = false;
        go.textContent = "Switch to " + MODES[to].t;
      }
      Array.prototype.forEach.call(scrim.querySelectorAll('input[name="own-mode"]'), function (r) { r.onchange = say; });
      say();
      go.onclick = function () {
        var to = picked();
        if (busy || to === cur) return;
        busy = true;
        pick.hidden = true;
        wait.hidden = false;
        /* Two steps, each ticked by what really happened: the server's answer,
           then the page drawn again in the new mode (said on arrival). */
        wait.innerHTML =
          '<h2 id="own-mode-wh" tabindex="-1">Switching to ' + MODES[to].t + "…</h2>" +
          '<p class="own-set-p">This takes a few seconds.</p>' +
          '<div class="own-mode-bar" role="progressbar" aria-label="Switching" aria-valuemin="0" aria-valuemax="2" aria-valuenow="0"><i></i></div>' +
          '<ul class="own-mode-steps">' +
            '<li id="own-mode-s1"><span class="own-mode-ck"><span class="own-mode-spin" aria-hidden="true"></span></span>Saving your choice</li>' +
            '<li id="own-mode-s2"><span class="own-mode-ck">·</span>Atlas redrawn in ' + MODES[to].t + "</li>" +
          "</ul>" +
          '<p class="own-set-p own-mode-wnote" id="own-mode-wnote" role="status"></p>';
        var wh = wait.querySelector("#own-mode-wh"); if (wh) wh.focus();
        api("instances/" + encodeURIComponent(SLUG) + "/mode", { method: "POST", body: { name: to } })
          .then(function () {
            var s1 = wait.querySelector("#own-mode-s1"), s2 = wait.querySelector("#own-mode-s2"), bar = wait.querySelector(".own-mode-bar");
            s1.classList.add("done");
            s1.querySelector(".own-mode-ck").textContent = "✓";
            s2.querySelector(".own-mode-ck").innerHTML = '<span class="own-mode-spin" aria-hidden="true"></span>';
            bar.setAttribute("aria-valuenow", "1");
            bar.querySelector("i").style.width = "55%";
            wait.querySelector("#own-mode-wnote").textContent = "Done — reloading the atlas…";
            try { sessionStorage.setItem(MODE_SWITCHED, JSON.stringify({ slug: SLUG, to: to, from: cur })); } catch (e) {}
            // a beat for the tick to be seen, then the atlas drawn the new way
            setTimeout(function () { location.reload(); }, 300);
          })
          .catch(function (e) {
            busy = false;
            wait.hidden = true;
            wait.innerHTML = "";
            pick.hidden = false;
            err.textContent = errMsg(e);
            // the server knows best whether an event guide is set up
            if (e && e.needsSetUp && MODEINFO) { MODEINFO.canEvent = false; say(); err.textContent = errMsg(e); }
            if (e && e.needsQuestions && MODEINFO) { MODEINFO.canInsight = false; say(); err.textContent = errMsg(e); }
          });
      };
    }, function () { return !busy; });
  }

  /* ---------------- See it as a visitor ----------------
     One class on the page puts every owner tool away (the CSS in modeStyle
     hides anything owner.js made), the panel goes back to the visitor's own
     head and list, and one pill brings the tools back. Not remembered: a
     fresh load is editing again. */
  var VISITOR = false;
  function setVisitorView(on) {
    VISITOR = !!on;
    if (VISITOR) C.closeFold();
    // a phone's menu (☰), where the Owner menu lives there, is put away first
    var burger = document.getElementById("nav-burger");
    if (VISITOR && burger && burger.getAttribute("aria-expanded") === "true") burger.click();
    document.documentElement.classList.toggle("atlas-as-visitor", VISITOR);
    var sw = $("#own-visitor");
    if (sw) sw.setAttribute("aria-checked", String(VISITOR));
    var pill = document.getElementById("atlas-visitor-pill");
    if (VISITOR && !pill) {
      pill = document.createElement("div");
      pill.id = "atlas-visitor-pill";
      pill.className = "atlas-visitor-pill";
      pill.setAttribute("role", "status");
      pill.innerHTML = "<span>Seeing it as a visitor</span>" +
        '<button type="button" id="atlas-visitor-back">Back to editing</button>';
      (document.querySelector(".atlas-stage") || document.body).appendChild(pill);
      pill.querySelector("button").onclick = function () { setVisitorView(false); };
    }
    if (pill) pill.hidden = !VISITOR;
    // seen as a visitor, the map wears the SAVED buttons; back to editing, the draft again
    if (BTN.saved && btnDirty()) previewButtons();
    C.showShelf();
    var iv = insightViewer();   // Insight: the visitor's two tabs and what is under them, Settings put away (or back)
    if (iv && iv.renderPanel) iv.renderPanel();
    var to = VISITOR ? document.getElementById("atlas-visitor-back") : $("#own-btn");
    if (to) to.focus();
  }

  /* ---------------- Explore: the Buttons tab ----------------
     What visitors press on the map, edited where the owner can watch the map
     change: the buttons on the map follow every edit at once (the explore
     viewer's setButtons), and visitors get them only on Save. Colours follow
     the place in the row; at most four. The rules for what may be saved are
     explore-mode.js's, the same file the server checks with. */
  var BTN = { saved: null, draft: null, saving: false, saved1: false, err: "", icons: -1, tries: 0, grouping: "", groupErr: "" };
  var ICON_WORDS = { leaf: "Leaf", landmark: "Landmark", ticket: "Ticket", users: "People", utensils: "Knife and fork",
    camera: "Camera", music: "Music", book: "Book", store: "Shop", droplet: "Water drop", footprints: "Footprints" };
  function XM() { return window.LokaExploreMode; }
  function exploreMode() {
    var M = window.LokaAtlas && window.LokaAtlas.manifest, m = M && M.mode;
    return m && m.name === "explore" ? m : null;
  }
  function exploreFeatures() {
    var m = exploreMode(), A = window.LokaAtlas;
    if (!m || !A.dataFor) return null;
    var d = A.dataFor(m.layer);
    if (!d) ((A.manifest && A.manifest.layers) || []).some(function (L) {
      if (L && L._ev && L._ev.explore) { d = A.dataFor(L.id); return true; }
      return false;
    });
    return (d && d.features) || null;
  }
  function plainButtons(list) {
    return (list || []).map(function (b) {
      var o = { id: b.id, label: String(b.label || ""), icon: b.icon, words: (b.words || []).slice() };
      if (b.rest) o.rest = true;
      return o;
    });
  }
  function topicCount(list) { return (list || []).filter(function (b) { return !b.rest; }).length; }
  // the layer's own stanza (its questions: keyLabels, keyKinds, keyNouns), as the page has it
  function exploreStanza(mode) {
    var M = window.LokaAtlas && window.LokaAtlas.manifest;
    return ((M && M.layers) || []).filter(function (L) { return L && L.id === mode.layer; })[0] || null;
  }
  /* The server's answer to "Group by" or Save is the mode in use: the page's
     own copy (the one the map is drawn from) takes it, so the buttons on the
     map read the same column the server will. */
  function takeMode(m) {
    var live = exploreMode();
    if (!live || !m || typeof m !== "object") return;
    Object.keys(live).forEach(function (k) { if (!(k in m)) delete live[k]; });
    Object.keys(m).forEach(function (k) { live[k] = m[k]; });
  }
  function btnDirty() { return JSON.stringify(BTN.draft) !== JSON.stringify(BTN.saved); }
  function previewList(list) {
    return (list || BTN.draft).map(function (b, i) {
      var o = { id: b.id || "new-" + (i + 1), label: b.label.trim() || "Untitled", icon: b.icon, words: b.words };
      if (b.rest) o.rest = true;
      return o;
    });
  }
  function previewButtons() {
    var v = XM() && XM().viewer && XM().viewer._current;
    if (v && v.setButtons) v.setButtons(previewList(VISITOR ? BTN.saved : BTN.draft));
  }
  function iconSvg(name) {
    var kit = window.LokaIcons && window.LokaIcons.ICONS;
    return (kit && kit[name]) || "";
  }
  function btnCount(b, feats, mode) {
    if (b.rest) {
      var all = { tagColumn: mode.tagColumn, buttonsFrom: mode.buttonsFrom, buttons: previewList() };
      return XM().countButtons(feats, all)[XM().REST_ID] || 0;
    }
    var one = { tagColumn: mode.tagColumn, buttonsFrom: mode.buttonsFrom, buttons: [{ id: "x", label: "x", words: b.words }] };
    return XM().countButtons(feats, one).x;
  }
  function btnCountLine(b, n) {
    if (b.rest) return "Places under no other button — <b>" + n + "</b>";
    return esc(b.label.trim() || "Untitled") + " — <b>" + n + "</b> " + (n === 1 ? "place" : "places") +
      (n === 0 ? ' <span class="own-bhint">· tick ' + (fromAnalysis() ? "an answer" : "a category") + " below</span>" : "");
  }
  function fromAnalysis() { var m = exploreMode(); return !!(m && m.buttonsFrom === "analysis"); }
  /* "Group by": the atlas's own analysis (offered only when one of its
     questions qualifies, explore-mode.js pickQuestion — the server's own
     rule) or LOKA's categories. Choosing asks the server, which makes the
     buttons afresh and keeps them at once. */
  function groupByHTML(mode, stanza, pick) {
    var from = mode.buttonsFrom === "analysis" ? "analysis" : "categories";
    if (!pick && from !== "analysis") return "";
    var q = from === "analysis" && stanza ? { noun: (stanza.keyNouns || {})[mode.tagColumn], question: (stanza.keyLabels || {})[mode.tagColumn] } : pick;
    var opts = [["analysis", XM().groupByLabel(q) || "What LOKA found"], ["categories", "LOKA categories"]];
    var busy = !!BTN.grouping;
    var h = '<div class="own-bgroup"><span class="own-bgroup-k" id="own-bgroup-k">Group by:</span>' +
      '<span class="own-bgroup-opts" role="radiogroup" aria-labelledby="own-bgroup-k">' + opts.map(function (o) {
        var on = (BTN.grouping || from) === o[0];
        return '<label class="own-tick' + (on ? " on" : "") + '"><input type="radio" name="own-bgroup" value="' + o[0] + '"' +
          (on ? " checked" : "") + (busy ? " disabled" : "") + "> " + esc(o[1]) + "</label>";
      }).join("") + "</span></div>";
    if (busy) h += '<p class="own-bwait" role="status"><span class="own-mode-spin" aria-hidden="true"></span>' +
      (BTN.grouping === "analysis" ? "Choosing buttons from what the atlas found…" : "Choosing buttons from LOKA categories…") + "</p>";
    else if (BTN.groupErr) h += '<p class="own-err" role="alert">' + esc(BTN.groupErr) + "</p>";
    else if (from === "analysis" && mode.buttonsEdited) h += '<p class="own-bedited">You\u2019ve edited these buttons, so rebuilding the atlas won\u2019t change them. ' +
      '<button type="button" class="own-blink" id="own-bagain">Let LOKA choose again</button></p>';
    return h;
  }
  function btnSaveBar() {
    var d = btnDirty(), msg;
    if (BTN.saving) msg = '<span class="own-mode-spin" aria-hidden="true"></span>Saving…';
    else if (BTN.err) msg = '<span class="own-err">' + esc(BTN.err) + "</span>";
    else if (BTN.saved1 && !d) msg = '<span class="own-bok" aria-hidden="true">✓</span>Saved. Visitors see the new buttons from now.';
    else if (d) msg = "Not saved yet. The map shows your changes; visitors don't see them until you save.";
    else msg = "Visitors see these buttons.";
    return '<span class="own-bmsg" role="status">' + msg + "</span>" +
      (d && !BTN.saving ? '<button class="share-btn" type="button" id="own-bundo">Undo</button>' : "") +
      '<button class="share-btn primary" type="button" id="own-bsave"' + (!d || BTN.saving ? " disabled" : "") + ">Save</button>";
  }

  function drawButtonShelf(host) {
    var mode = exploreMode();
    if (!mode || !XM()) { host.innerHTML = ""; return; }
    if (!BTN.saved) { BTN.saved = plainButtons(mode.buttons); BTN.draft = plainButtons(mode.buttons); }
    wireButtonShelf(host);
    var feats = exploreFeatures();
    if (!feats) {
      host.innerHTML = '<p class="own-set-p">' + (window.LokaWait ? window.LokaWait.html("Loading the places…") : "Loading the places…") + "</p>";
      if (BTN.tries++ < 40) setTimeout(function () { if (!host.hidden) drawButtonShelf(host); }, 400);
      return;
    }
    var pal = XM().PALETTE, cols = XM().colourOf(BTN.draft), cats = XM().wordCounts(feats, mode), choices = XM().ICON_CHOICES;
    var stanza = exploreStanza(mode), analysis = mode.buttonsFrom === "analysis";
    var pick = stanza ? XM().pickQuestion(stanza, feats) : null;
    // an answer's own definition, as the analysis wrote it, is the tick's title
    var defs = {};
    if (analysis && stanza) ((stanza.keyKinds || {})[mode.tagColumn] || []).forEach(function (k) {
      if (k && k.name) defs[String(k.name).toLowerCase()] = String(k.definition || "");
    });
    var qWords = analysis && stanza ? String((stanza.keyLabels || {})[mode.tagColumn] || "").trim() : "";
    var h = '<div class="own-bbody">' + groupByHTML(mode, stanza, pick) + '<p class="own-set-p">' + (analysis
      ? "What visitors press on the map. Each place has one answer to \u201c" + esc(qWords) + "\u201d. Tick the answers each button should show."
      : "What visitors press on the map. Tick which categories go under each button.") + "</p>";
    BTN.draft.forEach(function (b, i) {
      var n = btnCount(b, feats, mode);
      if (b.rest) {
        // Odds & ends: its name only; it holds whatever no other button does
        h += '<div class="own-bcard own-brest" style="--bc:' + pal[4] + '"><div class="own-bc-top">' +
          '<span class="own-bicon own-bicon-fixed" aria-hidden="true">' + iconSvg(XM().REST_ICON) + "</span>" +
          '<input class="own-bname" type="text" data-name="' + i + '" value="' + esc(b.label) + '" aria-label="Name of the button for the places under no other button (at most ' + XM().MAX_LABEL + ' letters)">' +
          "</div>" + '<div class="own-bcount">' + btnCountLine(b, n) + "</div></div>";
        return;
      }
      var has = {}; b.words.forEach(function (w) { has[String(w).toLowerCase()] = true; });
      h += '<div class="own-bcard" style="--bc:' + (cols[i] || pal[i % pal.length]) + '">' +
        '<div class="own-bc-top">' +
          '<button type="button" class="own-bicon" data-icon="' + i + '" aria-expanded="' + (BTN.icons === i) + '" aria-label="Choose a picture for ' +
            esc(b.label.trim() || "this button") + " (now: " + esc(ICON_WORDS[b.icon] || b.icon) + ')">' + iconSvg(b.icon) +
            '<span class="own-bcaret" aria-hidden="true">▾</span></button>' +
          '<input class="own-bname" type="text" data-name="' + i + '" value="' + esc(b.label) + '" aria-label="Button name (at most ' + XM().MAX_LABEL + ' letters)">' +
          '<button type="button" class="own-bx" data-rm="' + i + '" aria-label="Remove the button ' + esc(b.label.trim() || "Untitled") + '">×</button>' +
        "</div>" +
        (BTN.icons === i ? '<div class="own-bpick" role="group" aria-label="Pictures">' + choices.map(function (k) {
          return '<button type="button" data-seticon="' + i + "," + k + '" class="' + (b.icon === k ? "on" : "") + '" aria-pressed="' + (b.icon === k) +
            '" aria-label="' + esc(ICON_WORDS[k] || k) + '">' + iconSvg(k) + "</button>";
        }).join("") + "</div>" : "") +
        '<div class="own-bcount">' + btnCountLine(b, n) + "</div>" +
        '<div class="own-ticks">' + cats.map(function (c) {
          var on = !!has[c.w.toLowerCase()];
          var def = defs[c.w.toLowerCase()];
          return '<label class="own-tick' + (on ? " on" : "") + '"' + (def ? ' title="' + esc(def) + '"' : "") + '><input type="checkbox" data-tk="' + i + '" value="' + esc(c.w) + '"' + (on ? " checked" : "") + ">" +
            esc(c.w) + ' <span class="own-tick-n">' + c.n + "</span></label>";
        }).join("") + "</div>" +
      "</div>";
    });
    var full = topicCount(BTN.draft) >= XM().MAX_BUTTONS;
    h += '<button type="button" class="own-badd" id="own-badd"' + (full ? " disabled" : "") + ">" +
      (full ? "Four buttons is the most: a row of four still fits on a phone" : "+ Add a button") + "</button>";
    // the places under no button, and what they are
    var pm = { tagColumn: mode.tagColumn, buttonsFrom: mode.buttonsFrom, buttons: previewList().filter(function (b) { return !b.rest; }) }, none = 0, theirs = {}, order = [];
    var rest = BTN.draft.filter(function (b) { return b.rest; })[0];
    var shown = {}; cats.forEach(function (c) { shown[c.w.toLowerCase()] = c.w; });
    feats.forEach(function (f) {
      if (XM().placeButtons(f.properties, pm).length) return;
      none++;
      var ws = XM().placeWords(f.properties, mode);
      if (!ws.length) ws = [analysis ? "no answer" : "no category"];
      ws.forEach(function (w) { if (!theirs[w]) { theirs[w] = true; order.push(shown[w] || w); } });
    });
    var line;
    if (!BTN.draft.length) line = "No buttons: visitors see the map and the Around here list.";
    else if (!none) line = "Every place is under at least one button.";
    else if (rest) line = "<b>" + none + (none === 1 ? " place has" : " places have") + " none of these</b> (" + esc(order.join(", ")) + "), so " +
      (none === 1 ? "it is" : "they are") + " under \u201c" + esc(rest.label.trim() || XM().REST_LABEL) + "\u201d.";
    else line = "<b>" + none + (none === 1 ? " place is" : " places are") + " under no button</b> (" + esc(order.join(", ")) + "). " +
      (none === 1 ? "It stays" : "They stay") + " on the map and in Around here.";
    h += '<p class="own-bnone">' + line + "</p></div>";
    h += '<div class="own-bsave" id="own-bsave-bar">' + btnSaveBar() + "</div>";
    var keepScroll = host.querySelector(".own-bbody");
    var top = keepScroll ? keepScroll.scrollTop : 0;
    host.innerHTML = h;
    var body = host.querySelector(".own-bbody");
    if (body) body.scrollTop = top;
  }

  function wireButtonShelf(host) {
    if (host._wired) return;
    host._wired = true;
    function changed() {
      BTN.saved1 = false; BTN.err = "";
      // "Odds & ends" comes and goes by itself, as the places under no other button do
      var mode = exploreMode(), feats = exploreFeatures();
      if (mode && feats) BTN.draft = plainButtons(XM().withRest(BTN.draft, feats, mode));
      previewButtons(); drawButtonShelf(host);
    }
    host.addEventListener("click", function (e) {
      var t = e.target && e.target.closest && e.target.closest("button");
      if (!t || BTN.saving) return;
      var d = t.dataset;
      if (d.icon !== undefined) { BTN.icons = BTN.icons === +d.icon ? -1 : +d.icon; drawButtonShelf(host); return; }
      if (d.seticon) {
        var p = d.seticon.split(","), b = BTN.draft[+p[0]];
        if (b && XM().ICON_CHOICES.indexOf(p[1]) >= 0) b.icon = p[1];
        BTN.icons = -1;
        changed();
        var back = host.querySelector('[data-icon="' + p[0] + '"]'); if (back) back.focus();
        return;
      }
      if (d.rm !== undefined) { if (BTN.draft[+d.rm] && !BTN.draft[+d.rm].rest) BTN.draft.splice(+d.rm, 1); BTN.icons = -1; changed(); return; }
      if (t.id === "own-bagain") { groupBy(host, "analysis"); return; }
      if (t.id === "own-badd") {
        var nt = topicCount(BTN.draft);
        if (nt >= XM().MAX_BUTTONS) return;
        var used = BTN.draft.map(function (x) { return x.icon; });
        var icon = XM().ICON_CHOICES.filter(function (k) { return used.indexOf(k) < 0; })[0] || "camera";
        // new buttons go before "Odds & ends", which stays last
        BTN.draft.splice(nt, 0, { label: "New button", icon: icon, words: [] });
        changed();
        var named = host.querySelector('.own-bname[data-name="' + nt + '"]');
        if (named) { named.focus(); named.select(); }
        return;
      }
      if (t.id === "own-bundo") { BTN.draft = plainButtons(BTN.saved); BTN.icons = -1; changed(); return; }
      if (t.id === "own-bsave") { saveButtons(host); return; }
    });
    host.addEventListener("change", function (e) {
      var cb = e.target;
      if (cb && cb.name === "own-bgroup") { groupBy(host, cb.value); return; }
      if (!cb || cb.getAttribute("data-tk") == null) return;
      var b = BTN.draft[+cb.getAttribute("data-tk")];
      if (!b) return;
      var w = cb.value, k = w.toLowerCase();
      b.words = b.words.filter(function (x) { return String(x).toLowerCase() !== k; });
      if (cb.checked) b.words.push(w);
      changed();
      var again = host.querySelector('input[data-tk="' + cb.getAttribute("data-tk") + '"][value="' + w.replace(/["\\]/g, "\\$&") + '"]');
      if (again) again.focus();
    });
    host.addEventListener("input", function (e) {
      var inp = e.target;
      if (!inp || inp.getAttribute("data-name") == null) return;
      var i = +inp.getAttribute("data-name"), b = BTN.draft[i];
      if (!b) return;
      // at most 20 letters, counted as letters (an emoji is one), not as the browser's code units
      var chars = Array.from(inp.value);
      if (chars.length > XM().MAX_LABEL) inp.value = chars.slice(0, XM().MAX_LABEL).join("");
      b.label = inp.value;
      BTN.saved1 = false; BTN.err = "";
      // only what the name touches is redrawn, so the cursor stays in the box
      var mode = exploreMode(), feats = exploreFeatures();
      var card = inp.closest(".own-bcard");
      var cl = card && card.querySelector(".own-bcount");
      if (cl && mode && feats) cl.innerHTML = btnCountLine(b, btnCount(b, feats, mode));
      var bar = host.querySelector("#own-bsave-bar");
      if (bar) bar.innerHTML = btnSaveBar();
      previewButtons();
    });
  }

  function groupBy(host, to) {
    var mode = exploreMode();
    if (!mode || BTN.grouping || BTN.saving) return;
    if (to === (mode.buttonsFrom === "analysis" ? "analysis" : "categories") && !(to === "analysis" && mode.buttonsEdited)) return;
    BTN.grouping = to; BTN.groupErr = ""; BTN.err = ""; BTN.icons = -1;
    drawButtonShelf(host);
    api("instances/" + encodeURIComponent(SLUG) + "/mode", { method: "POST", body: { groupBy: to } })
      .then(function (j) {
        takeMode(j && j.mode);
        BTN.saved = plainButtons(j && j.mode && j.mode.buttons);
        BTN.draft = plainButtons(BTN.saved);
        BTN.grouping = ""; BTN.saved1 = true;
        previewButtons();
        drawButtonShelf(host);
      })
      .catch(function (e) {
        BTN.grouping = ""; BTN.groupErr = errMsg(e);
        drawButtonShelf(host);
      });
  }

  function saveButtons(host) {
    if (!btnDirty() || BTN.saving) return;
    var send = BTN.draft.map(function (b) {
      var o = { label: b.label.trim(), icon: b.icon, words: b.words.slice() };
      if (b.id) o.id = b.id;
      if (b.rest) o.rest = true;
      return o;
    });
    if (send.some(function (b) { return !b.label; })) { BTN.err = "Give every button a name."; drawButtonShelf(host); return; }
    BTN.saving = true; BTN.err = "";
    drawButtonShelf(host);
    api("instances/" + encodeURIComponent(SLUG) + "/mode", { method: "POST", body: { buttons: send } })
      .then(function (j) {
        takeMode(j && j.mode);
        BTN.saved = plainButtons(j && j.mode && j.mode.buttons);
        BTN.draft = plainButtons(BTN.saved);
        BTN.saving = false; BTN.saved1 = true;
        previewButtons();
        drawButtonShelf(host);
      })
      .catch(function (e) {
        BTN.saving = false; BTN.err = errMsg(e);
        drawButtonShelf(host);
      });
  }

  /* ---------------- Insight: the Settings tab ----------------
     Three settings and nothing else: the summary on top (on or off, and
     "Write it again"), which questions show, and their order. A question whose
     answers are people's names is locked off, with the reason. Each change is
     saved at once (POST /instances/:slug/mode { insight }) and the page shows
     it straight away (the insight viewer's setMode). */
  var INS = { saving: false, writing: false, tries: 0, polls: 0 };
  function IM() { return window.LokaInsightMode; }
  function insightMode() {
    var M = window.LokaAtlas && window.LokaAtlas.manifest, m = M && M.mode;
    return m && m.name === "insight" ? m : null;
  }
  function insightViewer() { return IM() && IM().viewer && IM().viewer._current; }
  function takeInsight(m) {
    var v = insightViewer(), live = insightMode();
    if (v && v.setMode) v.setMode(m);
    else if (live && m) { Object.keys(live).forEach(function (k) { if (!(k in m)) delete live[k]; }); Object.keys(m).forEach(function (k) { live[k] = m[k]; }); }
  }
  function writtenWhen(at) {
    if (!at) return "";
    try { return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return ""; }
  }
  function drawInsightShelf(host) {
    var mode = insightMode();
    if (!mode || !IM()) { host.innerHTML = ""; return; }
    wireInsightShelf(host);
    var L = exploreStanza(mode), A = window.LokaAtlas;
    var d = L && A.dataFor ? A.dataFor(L.id) : null, feats = d && d.features;
    if (!L || !feats) {
      host.innerHTML = '<p class="own-set-p">' + (window.LokaWait ? window.LokaWait.html("Loading the places…") : "Loading the places…") + "</p>";
      if (INS.tries++ < 40) setTimeout(function () { if (!host.hidden) drawInsightShelf(host); }, 400);
      return;
    }
    INS.tries = 0;
    var s = IM().settingsOf(L, mode), busy = INS.saving || INS.writing;
    var writing = INS.writing || IM().isPending(mode);
    var h = '<div class="own-bbody own-ibody">';
    h += '<div class="own-icard"><div class="own-irow"><div class="own-ik"><b id="own-isum-k">Summary</b>' +
      "<small>A few sentences in plain words, written by AI from the answers each time the atlas is updated. Visitors see it first, under \u201cWhat the places say\u201d.</small></div>" +
      '<button class="own-switch" type="button" role="switch" data-iact="sum" aria-checked="' + s.summaryOn + '" aria-labelledby="own-isum-k"' + (busy ? " disabled" : "") +
      '><span class="own-switch-tr" aria-hidden="true"></span></button></div>';
    if (s.summaryOn) {
      h += '<div class="own-irow own-irow2"><button class="share-btn" type="button" data-iact="rewrite"' + (writing || busy ? " disabled" : "") + ">" +
        (writing ? '<span class="own-mode-spin" aria-hidden="true"></span>Writing…' : "Write it again") + "</button>" +
        '<span class="own-inote" role="status">' + (writing ? "Visitors still see the questions while it is written."
          : mode.summary ? "Last written " + esc(writtenWhen(mode.summary.at)) + ", from these answers."
          : "No summary for now: LOKA could not write one from these answers.") + "</span></div>";
    }
    h += "</div>";
    h += '<div class="own-icard"><b>Questions visitors see</b><small class="own-is">Switch a question off to hide it; use the arrows to change the order. ' +
      "The first one opens when a visitor arrives and colours the map.</small>";
    s.order.forEach(function (col, i) {
      var st = IM().stats(L, feats, col), on = !!s.shown[col], q = st.question || col;
      var small = st.people ? IM().PEOPLE_REASON : !st.answered ? "No place answers this yet." :
        IM().coverWords(st) + (st.sparse ? " (shown under \u201cSaid by only a few places\u201d)" : "");
      h += '<div class="own-iq' + (on ? "" : " off") + '"><div class="own-imv">' +
        '<button type="button" data-iact="up" data-col="' + esc(col) + '"' + (i === 0 || busy ? " disabled" : "") + ' aria-label="Move \u201c' + esc(q) + '\u201d up">▲</button>' +
        '<button type="button" data-iact="down" data-col="' + esc(col) + '"' + (i === s.order.length - 1 || busy ? " disabled" : "") + ' aria-label="Move \u201c' + esc(q) + '\u201d down">▼</button></div>' +
        '<div class="own-ik"><span>' + esc(q) + "</span><small>" + esc(small) + "</small></div>" +
        '<button class="own-switch" type="button" role="switch" data-iact="show" data-col="' + esc(col) + '" aria-checked="' + on + '"' + (st.people || busy ? " disabled" : "") +
        ' aria-label="Show \u201c' + esc(q) + '\u201d to visitors"><span class="own-switch-tr" aria-hidden="true"></span></button></div>';
    });
    h += '</div><button class="share-btn primary" type="button" data-iact="asvisitor">See it as a visitor</button></div>';
    var keep = host.querySelector(".own-ibody"), top = keep ? keep.scrollTop : 0;
    host.innerHTML = h;
    var body = host.querySelector(".own-ibody");
    if (body) body.scrollTop = top;
    if (IM().isPending(mode) && !INS.writing) pollInsight(host);
  }
  // while the server writes the summary (after a switch, or the summary turned on), ask now and then
  function pollInsight(host, again) {
    if (INS.pollT) return;
    if (!again) INS.polls = 0;   // a new wait starts its own count
    INS.pollT = setTimeout(function () {
      INS.pollT = null;
      api("instances/" + encodeURIComponent(SLUG) + "/mode").then(function (j) {
        var m = j && j.mode;
        if (!m || m.name !== "insight") return;
        if (IM().isPending(m) && INS.polls++ < 45) { if (!host.hidden) pollInsight(host, true); return; }
        if (IM().isPending(m)) { delete m.summaryPending; delete m.summaryPendingAt; }
        takeInsight(m);
        if (m.summary) toast("Summary written");
        drawInsightShelf(host);
      }).catch(function () { if (INS.polls++ < 45) pollInsight(host, true); });
    }, 4000);
  }
  function saveInsight(host, patch, said) {
    INS.saving = true;
    drawInsightShelf(host);
    api("instances/" + encodeURIComponent(SLUG) + "/mode", { method: "POST", body: { insight: patch } })
      .then(function (j) {
        INS.saving = false;
        if (j && j.mode) takeInsight(j.mode);
        toast(said);
        drawInsightShelf(host);
      })
      .catch(function (e) {
        INS.saving = false;
        toast(errMsg(e));
        drawInsightShelf(host);
      });
  }
  function rewriteSummary(host) {
    var mode = insightMode();
    if (!mode || INS.writing) return;
    INS.writing = true;
    var was = {};
    Object.keys(mode).forEach(function (k) { was[k] = mode[k]; });
    var pending = {};
    Object.keys(mode).forEach(function (k) { pending[k] = mode[k]; });
    pending.summary = null; pending.summaryPending = true; pending.summaryPendingAt = Date.now();
    takeInsight(pending);   // the page shows "being written", the questions still there
    drawInsightShelf(host);
    api("instances/" + encodeURIComponent(SLUG) + "/mode", { method: "POST", body: { rewriteSummary: true } })
      .then(function (j) {
        INS.writing = false;
        if (j && j.mode) takeInsight(j.mode);
        if (j && j.mode && IM().isPending(j.mode)) { /* another write was under way: the tab waits for it */ }
        else toast(j && j.mode && j.mode.summary ? "Summary written again" : "LOKA could not write a summary this time. Visitors see the questions.");
        drawInsightShelf(host);
      })
      .catch(function (e) {
        INS.writing = false;
        delete was.summaryPending; delete was.summaryPendingAt;
        takeInsight(was);
        toast(errMsg(e));
        drawInsightShelf(host);
      });
  }
  /* Insight's tabs are the visitor's own (What the places say · Questions,
     drawn by insight-mode.js); the owner gets one more, Settings, which puts
     the panel's list away and shows the settings in its place. Kept on the
     viewer itself, so a redrawn viewer has it too; See it as a visitor hides
     it, and the visitor's tabs are what is left. */
  function insightTabs() {
    var body = document.getElementById("atlas-controls");
    if (modeDrawn() !== "insight" || !IM() || !IM().viewer || !body) return;
    if (!INST || INST.role !== "owner") return;   // an editor could not save these: no Settings, the visitor's tabs only
    var host = document.getElementById("own-ishelf");
    if (!host) {
      host = document.createElement("div");
      host.className = "own-bshelf";
      host.id = "own-ishelf";
      host.hidden = true;
      body.parentNode.insertBefore(host, body.nextSibling);
    }
    IM().viewer.extraTab = {
      key: "settings", label: "Settings",
      hidden: function () { return VISITOR; },
      show: function (on) {
        var b = document.getElementById("atlas-controls"), h = document.getElementById("own-ishelf");
        if (!b || !h) return;
        var was = !h.hidden;
        b.hidden = on;
        h.hidden = !on;
        if (on && !was) drawInsightShelf(h);
      },
    };
    var v = insightViewer();
    if (v && v.renderPanel) v.renderPanel();
  }
  function wireInsightShelf(host) {
    if (host._insWired) return;
    host._insWired = true;
    host.addEventListener("click", function (e) {
      var t = e.target && e.target.closest && e.target.closest("[data-iact]");
      if (!t || t.disabled || !insightMode() || modeDrawn() !== "insight") return;
      var act = t.getAttribute("data-iact"), col = t.getAttribute("data-col");
      var mode = insightMode(), L = exploreStanza(mode);
      if (!L) return;
      var s = IM().settingsOf(L, mode);
      if (act === "asvisitor") { setVisitorView(true); return; }
      if (act === "rewrite") { rewriteSummary(host); return; }
      if (INS.saving) return;
      if (act === "sum") { saveInsight(host, { summaryOn: !s.summaryOn }, "Saved"); return; }
      if (act === "show") { var sh = {}; sh[col] = !s.shown[col]; saveInsight(host, { shown: sh }, "Saved"); return; }
      if (act === "up" || act === "down") {
        var i = s.order.indexOf(col), j = act === "up" ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= s.order.length) return;
        var order = s.order.slice(), x = order[i];
        order[i] = order[j]; order[j] = x;
        saveInsight(host, { order: order }, "Order saved");
        setTimeout(function () { var b = host.querySelector('[data-iact="' + act + '"][data-col="' + col.replace(/["\\]/g, "\\$&") + '"]'); if (b && !b.disabled) b.focus(); }, 0);
      }
    });
  }

  // the look of the pieces above; owner.css is shared with every owner tool, these are only here
  function modeStyle() {
    if (document.getElementById("own-mode-style")) return;
    var s = document.createElement("style");
    s.id = "own-mode-style";
    s.textContent = [
      ".own-mode-k{min-width:0;flex:1 1 auto}",
      ".own-mode-k small{display:block;font-size:var(--t-meta);color:var(--color-text-muted);line-height:1.35}",
      "#own-panel-mode,#own-panel-visitor{padding:.35rem 0}",
      ".own-switch{flex:none;background:none;border:0;padding:4px 0;cursor:pointer}",
      ".own-switch-tr{display:block;width:36px;height:20px;border-radius:999px;background:var(--color-toggle-off,#CFCBC2);position:relative;transition:background .2s}",
      ".own-switch-tr::after{content:\"\";position:absolute;left:2px;top:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s cubic-bezier(.25,1,.5,1)}",
      ".own-switch[aria-checked=true] .own-switch-tr{background:var(--color-leaf)}",
      ".own-switch[aria-checked=true] .own-switch-tr::after{transform:translateX(16px)}",
      ".own-switch:focus-visible{outline:2px solid var(--color-leaf);outline-offset:2px;border-radius:999px}",
      ".own-mode-now{font-size:.65rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-leaf-deep);border:1px solid var(--color-leaf);border-radius:var(--radius-xs,2px);padding:0 .3rem;margin-left:.35rem;vertical-align:1px;white-space:nowrap}",
      ".own-mode-confirm{border-radius:var(--radius-md);background:var(--color-marigold-tint,rgba(233,162,55,.16));padding:.7rem .85rem;margin:.8rem 0 0;font-size:var(--t-ui)}",
      ".own-mode-confirm[hidden],#own-mode-pick[hidden],#own-mode-wait[hidden]{display:none}",
      ".own-mode-confirm p{margin:0 0 .35rem;font-weight:700;color:var(--color-text-primary)}",
      ".own-mode-confirm ul{margin:0;padding-left:1.1rem;color:var(--color-text-secondary)}",
      ".own-mode-confirm li{margin:.2rem 0}",
      ".own-mode-sheet .own-row-top{justify-content:flex-end}",
      "#own-mode-wait h2:focus{outline:none}",
      ".own-mode-bar{height:6px;border-radius:999px;background:var(--color-surface-alt,#F0EDE4);overflow:hidden;margin:.7rem 0 .8rem}",
      ".own-mode-bar i{display:block;height:100%;width:10%;background:var(--color-leaf);border-radius:999px;transition:width .5s ease}",
      ".own-mode-steps{list-style:none;padding:0;margin:0 0 .4rem;font-size:var(--t-ui)}",
      ".own-mode-steps li{display:flex;gap:.5rem;align-items:center;margin:.3rem 0;color:var(--color-text-muted)}",
      ".own-mode-steps li.done{color:var(--color-text-primary)}",
      ".own-mode-ck{width:16px;display:inline-flex;justify-content:center;color:var(--color-leaf);font-weight:700}",
      ".own-mode-spin{display:inline-block;flex:none;width:14px;height:14px;border-radius:50%;border:2px solid var(--color-leaf-tint);border-top-color:var(--color-leaf);animation:own-mode-sp .8s linear infinite}",
      "@keyframes own-mode-sp{to{transform:rotate(360deg)}}",
      "@media (prefers-reduced-motion:reduce){.own-mode-spin{animation-duration:2.4s}.own-mode-bar i{transition:none}}",
      /* the owner's tabs stand where the head's words were; the words come back for See it as a visitor */
      "html:not(.atlas-as-visitor) .panel-head[data-own-shelves] .sheet-who > strong{display:none !important}",
      /* See it as a visitor: everything owner.js made goes, the note at the bottom aside */
      "html.atlas-as-visitor :is([class^=\"own-\"],[class*=\" own-\"]):not(.own-toast){display:none !important}",
      ".atlas-visitor-pill{position:absolute;left:50%;bottom:96px;transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:.6rem;" +
        "background:var(--color-surface);border:1.5px solid var(--color-sindoor);border-radius:999px;padding:.35rem .4rem .35rem .9rem;" +
        "font-size:var(--t-ui);box-shadow:0 6px 18px rgba(36,33,29,.18);white-space:nowrap;color:var(--color-text-primary)}",
      ".atlas-visitor-pill[hidden]{display:none}",
      ".atlas-visitor-pill button{font:inherit;font-size:var(--t-meta);font-weight:700;border:0;background:var(--color-sindoor);color:#fff;border-radius:999px;padding:.35rem .8rem;min-height:32px;cursor:pointer}",
      ".atlas-visitor-pill button:hover{background:var(--color-sindoor-deep)}",
      ".atlas-visitor-pill button:focus-visible{outline:2px solid var(--color-leaf);outline-offset:2px}",
      "@media (max-width:720px){.atlas-visitor-pill{top:64px;bottom:auto;font-size:var(--t-meta)}}",
      /* the Buttons tab */
      ".own-bshelf{display:flex;flex-direction:column;min-height:0;flex:1 1 auto}",
      ".own-bshelf[hidden]{display:none}",
      ".own-bbody{overflow-y:auto;flex:1 1 auto;min-height:0;padding:.6rem .8rem .8rem;scrollbar-width:thin}",
      ".own-bcard{border:1px solid var(--color-border);border-left:4px solid var(--bc);border-radius:var(--radius-md);padding:.6rem .65rem .55rem;margin:0 0 .65rem;background:var(--color-page)}",
      ".own-bc-top{display:flex;align-items:center;gap:.45rem}",
      ".own-bicon{position:relative;width:38px;height:38px;flex:none;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface);color:var(--bc);cursor:pointer;padding:0}",
      ".own-bicon svg{width:19px;height:19px}",
      ".own-bcaret{position:absolute;right:1px;bottom:0;font-size:9px;color:var(--color-text-muted)}",
      ".own-bname{flex:1 1 auto;min-width:0;font:inherit;font-weight:600;font-size:var(--t-ui);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:.4rem .55rem;background:var(--color-surface);color:var(--color-text-primary)}",
      ".own-bname:focus{outline:2px solid var(--color-leaf);outline-offset:1px;border-color:var(--color-leaf)}",
      ".own-bx{flex:none;width:32px;height:32px;border:0;background:none;border-radius:var(--radius-md);font-size:1.2rem;line-height:1;color:var(--color-text-muted);cursor:pointer}",
      ".own-bx:hover{background:var(--color-surface-alt);color:var(--color-text-primary)}",
      ".own-bicon:focus-visible,.own-bx:focus-visible,.own-badd:focus-visible,.own-bpick button:focus-visible{outline:2px solid var(--color-leaf);outline-offset:2px}",
      ".own-bpick{display:grid;grid-template-columns:repeat(4,40px);gap:.3rem;margin:.45rem 0 .1rem;padding:.4rem;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface);width:max-content}",
      ".own-bpick button{width:40px;height:40px;display:flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:var(--radius-md);background:none;color:var(--bc);cursor:pointer;padding:0}",
      ".own-bpick button:hover,.own-bpick button.on{border-color:var(--color-border);background:var(--color-surface-alt)}",
      ".own-bpick svg{width:19px;height:19px}",
      ".own-bcount{margin:.45rem 0 .35rem;font-size:var(--t-ui);color:var(--color-text-primary)}",
      ".own-bcount b{font-variant-numeric:tabular-nums}",
      ".own-bhint{color:var(--color-text-muted);font-size:var(--t-meta)}",
      ".own-ticks{display:flex;flex-wrap:wrap;gap:.3rem}",
      ".own-tick{display:inline-flex;align-items:center;gap:.3rem;border:1px solid var(--color-border);border-radius:999px;padding:.18rem .55rem .18rem .4rem;font-size:var(--t-meta);background:var(--color-surface);cursor:pointer;user-select:none;min-height:28px}",
      ".own-tick input{margin:0;accent-color:var(--color-leaf)}",
      ".own-tick.on{border-color:var(--color-leaf);background:var(--color-leaf-tint)}",
      ".own-tick-n{color:var(--color-text-muted);font-variant-numeric:tabular-nums}",
      ".own-badd{width:100%;font:inherit;font-weight:600;font-size:var(--t-ui);border:1px dashed var(--color-border);background:none;border-radius:var(--radius-md);padding:.55rem;color:var(--color-text-secondary);cursor:pointer}",
      ".own-badd:disabled{cursor:default;opacity:.75}",
      ".own-bnone{margin:.8rem 0 0;padding:.6rem .7rem;border-radius:var(--radius-md);background:var(--color-surface-alt);font-size:var(--t-meta);color:var(--color-text-secondary)}",
      ".own-bsave{flex:none;display:flex;align-items:center;gap:.5rem;padding:.55rem .8rem;border-top:1px solid var(--color-divider);background:var(--color-surface)}",
      ".own-bmsg{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:.4rem;font-size:var(--t-meta);color:var(--color-text-muted)}",
      ".own-bok{color:var(--color-leaf);font-weight:700}",
      ".own-bsave .share-btn{flex:none}",
      /* Group by, and Odds & ends */
      ".own-bgroup{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;margin:0 0 .5rem}",
      ".own-bgroup-k{font-size:var(--t-meta);font-weight:700;color:var(--color-text-secondary)}",
      ".own-bgroup-opts{display:flex;flex-wrap:wrap;gap:.3rem}",
      ".own-bgroup .own-tick input{accent-color:var(--color-leaf)}",
      ".own-bwait{display:flex;align-items:center;gap:.45rem;margin:0 0 .6rem;font-size:var(--t-meta);color:var(--color-text-secondary)}",
      ".own-bedited{margin:0 0 .6rem;font-size:var(--t-meta);color:var(--color-text-secondary)}",
      ".own-blink{font:inherit;font-weight:700;color:var(--color-leaf);background:none;border:0;padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:2px}",
      ".own-blink:focus-visible{outline:2px solid var(--color-leaf);outline-offset:2px}",
      ".own-bicon-fixed{cursor:default}",
      /* Insight's Settings tab */
      ".own-ibody{display:flex;flex-direction:column;gap:.8rem}",
      ".own-icard{border:1px solid var(--color-border);border-radius:var(--radius-lg,.375rem);padding:.7rem .8rem;background:var(--color-surface)}",
      ".own-icard>b{display:block;font-size:var(--t-ui)}",
      ".own-is{display:block;font-size:var(--t-meta);color:var(--color-text-muted);line-height:1.35;margin:.1rem 0 .3rem}",
      ".own-irow{display:flex;justify-content:space-between;align-items:center;gap:.6rem}",
      ".own-irow2{justify-content:flex-start;flex-wrap:wrap;margin-top:.6rem}",
      ".own-irow2 .share-btn{display:inline-flex;align-items:center;gap:.4rem}",
      ".own-inote{font-size:var(--t-meta);color:var(--color-text-muted)}",
      ".own-ik{flex:1 1 auto;min-width:0;font-size:var(--t-ui)}",
      ".own-ik small{display:block;color:var(--color-text-muted);font-size:var(--t-meta);line-height:1.35}",
      ".own-iq{display:flex;gap:.6rem;align-items:center;padding:.55rem 0;border-top:1px solid var(--color-divider)}",
      ".own-iq.off .own-ik>span{color:var(--color-text-muted)}",
      ".own-imv{display:flex;flex-direction:column;gap:2px;flex:none}",
      ".own-imv button{background:none;border:1px solid var(--color-border);border-radius:var(--radius-xs,2px);width:28px;height:22px;line-height:1;font-size:.7rem;padding:0;cursor:pointer;color:var(--color-text-primary)}",
      ".own-imv button[disabled]{opacity:.3;cursor:default}",
      ".own-imv button:focus-visible{outline:2px solid var(--color-leaf);outline-offset:2px}",
      ".own-switch[disabled]{opacity:.5;cursor:not-allowed}",
      ".own-ibody>.share-btn.primary{align-self:flex-start}",
    ].join("\n");
    document.head.appendChild(s);
  }

  // the two menu lines, into the places owner.js keeps for them
  function fillMenu() {
    var vis = $("#own-panel-visitor"), mode = $("#own-panel-mode");
    if (vis && !vis.firstChild) {
      vis.innerHTML = '<span class="own-panel-k own-mode-k" id="own-visitor-k">See it as a visitor' +
          "<small>Hide your tools and look at the atlas as anyone would</small></span>" +
        '<button class="own-switch" id="own-visitor" type="button" role="switch" aria-checked="false" aria-labelledby="own-visitor-k"><span class="own-switch-tr" aria-hidden="true"></span></button>';
      $("#own-visitor").onclick = function () { setVisitorView(true); };
    }
    if (mode && !mode.firstChild) {
      mode.innerHTML = '<span class="own-panel-k own-mode-k"><span id="own-mode-what">How visitors explore</span>' +
          '<small id="own-mode-small"></small></span>' +
        '<button class="own-act" id="own-mode-change" hidden type="button" aria-label="Change how visitors explore this atlas">Change</button>';
      $("#own-mode-change").onclick = function () { openModeDialog(); };
    }
  }

  function mount(ctx) {
    C = ctx; api = ctx.api; errMsg = ctx.errMsg; esc = ctx.esc; toast = ctx.toast; openDialog = ctx.openDialog;
    rowsOnMap = ctx.rowsOnMap; INST = ctx.inst; SLUG = ctx.slug;
    modeStyle();
    fillMenu();
    paintMode();
    loadModeInfo();
    modeArrived();
    insightTabs();
    return { drawButtonShelf: drawButtonShelf, visitor: function () { return VISITOR; } };
  }

  window.LokaOwnerModes = { mount: mount };
})();
