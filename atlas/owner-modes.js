/* LOKA Atlas — the owner's tools for how visitors explore an atlas.
 *
 * Loaded by owner.js (never by a visitor's page), which hands over what it
 * owns — api, toast, dialogs, the shelves — through mount(ctx). Three things:
 *   - the Owner menu's "How visitors explore · <mode>" line and its dialog
 *     (Standard, Event, Explore; POST /instances/:slug/mode);
 *   - "See it as a visitor", the menu's first line;
 *   - Explore's Buttons tab (owner.js builds the tabs; this draws the editor).
 * The rules for buttons are explore-mode.js's, the file the server checks with. */
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
  };
  var MODE_ORDER = ["standard", "event", "explore"];
  var EVENT_NOT_SET_UP = "An event guide needs its venues and programme set up first. LOKA sets this up for you — write to us.";
  var MODE_SWITCHED = "loka-mode-switched";
  var MODEINFO = null;   // the server's answer: { name, kept, canEvent, canChange }

  // the mode the page is drawing (what the owner's tabs must match)
  function modeDrawn() {
    var M = window.LokaAtlas && window.LokaAtlas.manifest, m = M && M.mode;
    return m && typeof m === "object" && (m.name === "explore" || m.name === "event") ? m.name : "standard";
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
    var to = VISITOR ? document.getElementById("atlas-visitor-back") : $("#own-btn");
    if (to) to.focus();
  }

  /* ---------------- Explore: the Buttons tab ----------------
     What visitors press on the map, edited where the owner can watch the map
     change: the buttons on the map follow every edit at once (the explore
     viewer's setButtons), and visitors get them only on Save. Colours follow
     the place in the row; at most four. The rules for what may be saved are
     explore-mode.js's, the same file the server checks with. */
  var BTN = { saved: null, draft: null, saving: false, saved1: false, err: "", icons: -1, tries: 0 };
  var ICON_WORDS = { leaf: "Leaf", landmark: "Landmark", ticket: "Ticket", users: "People", utensils: "Knife and fork",
    camera: "Camera", music: "Music", book: "Book" };
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
      return { id: b.id, label: String(b.label || ""), icon: b.icon, words: (b.words || []).slice() };
    });
  }
  function btnDirty() { return JSON.stringify(BTN.draft) !== JSON.stringify(BTN.saved); }
  function previewList(list) {
    return (list || BTN.draft).map(function (b, i) {
      return { id: b.id || "new-" + (i + 1), label: b.label.trim() || "Untitled", icon: b.icon, words: b.words };
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
    var one = { tagColumn: mode.tagColumn, buttons: [{ id: "x", label: "x", words: b.words }] };
    return XM().countButtons(feats, one).x;
  }
  function btnCountLine(b, n) {
    return esc(b.label.trim() || "Untitled") + " — <b>" + n + "</b> " + (n === 1 ? "place" : "places") +
      (n === 0 ? ' <span class="own-bhint">· tick a category below</span>' : "");
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
    var pal = XM().PALETTE, cats = XM().wordCounts(feats, mode), choices = XM().ICON_CHOICES;
    var h = '<div class="own-bbody"><p class="own-set-p">What visitors press on the map. Tick which categories go under each button.</p>';
    BTN.draft.forEach(function (b, i) {
      var n = btnCount(b, feats, mode);
      var has = {}; b.words.forEach(function (w) { has[String(w).toLowerCase()] = true; });
      h += '<div class="own-bcard" style="--bc:' + pal[i % pal.length] + '">' +
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
          return '<label class="own-tick' + (on ? " on" : "") + '"><input type="checkbox" data-tk="' + i + '" value="' + esc(c.w) + '"' + (on ? " checked" : "") + ">" +
            esc(c.w) + ' <span class="own-tick-n">' + c.n + "</span></label>";
        }).join("") + "</div>" +
      "</div>";
    });
    var full = BTN.draft.length >= XM().MAX_BUTTONS;
    h += '<button type="button" class="own-badd" id="own-badd"' + (full ? " disabled" : "") + ">" +
      (full ? "Four buttons is the most: a row of four still fits on a phone" : "+ Add a button") + "</button>";
    // the places under no button, and what they are
    var pm = { tagColumn: mode.tagColumn, buttons: previewList() }, none = 0, theirs = {}, order = [];
    var shown = {}; cats.forEach(function (c) { shown[c.w.toLowerCase()] = c.w; });
    feats.forEach(function (f) {
      if (XM().placeButtons(f.properties, pm).length) return;
      none++;
      var ws = XM().placeWords(f.properties, mode);
      if (!ws.length) ws = ["no category"];
      ws.forEach(function (w) { if (!theirs[w]) { theirs[w] = true; order.push(shown[w] || w); } });
    });
    var line;
    if (!BTN.draft.length) line = "No buttons: visitors see the map and the Around here list.";
    else if (!none) line = "Every place is under at least one button.";
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
    function changed() { BTN.saved1 = false; BTN.err = ""; previewButtons(); drawButtonShelf(host); }
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
      if (d.rm !== undefined) { BTN.draft.splice(+d.rm, 1); BTN.icons = -1; changed(); return; }
      if (t.id === "own-badd") {
        if (BTN.draft.length >= XM().MAX_BUTTONS) return;
        var used = BTN.draft.map(function (x) { return x.icon; });
        var icon = XM().ICON_CHOICES.filter(function (k) { return used.indexOf(k) < 0; })[0] || "camera";
        BTN.draft.push({ label: "New button", icon: icon, words: [] });
        changed();
        var names = host.querySelectorAll(".own-bname");
        if (names.length) { names[names.length - 1].focus(); names[names.length - 1].select(); }
        return;
      }
      if (t.id === "own-bundo") { BTN.draft = plainButtons(BTN.saved); BTN.icons = -1; changed(); return; }
      if (t.id === "own-bsave") { saveButtons(host); return; }
    });
    host.addEventListener("change", function (e) {
      var cb = e.target;
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

  function saveButtons(host) {
    if (!btnDirty() || BTN.saving) return;
    var send = BTN.draft.map(function (b) {
      var o = { label: b.label.trim(), icon: b.icon, words: b.words.slice() };
      if (b.id) o.id = b.id;
      return o;
    });
    if (send.some(function (b) { return !b.label; })) { BTN.err = "Give every button a name."; drawButtonShelf(host); return; }
    BTN.saving = true; BTN.err = "";
    drawButtonShelf(host);
    api("instances/" + encodeURIComponent(SLUG) + "/mode", { method: "POST", body: { buttons: send } })
      .then(function (j) {
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
    return { drawButtonShelf: drawButtonShelf, visitor: function () { return VISITOR; } };
  }

  window.LokaOwnerModes = { mount: mount };
})();
