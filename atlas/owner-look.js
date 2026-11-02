/* LOKA Atlas — "Use my website's look": the owner's sheet in Settings.
 *
 * Loaded by owner.js (never by a visitor's page) when Settings opens, which
 * hands over what it owns — api, dialogs, toast — through mount(ctx). Then:
 *   - the row in Settings under Identity: "Provide a website for visual style
 *     and design reference." with where the look is from today, the button
 *     that opens the sheet, Back to LOKA's look, Undo, and the credit switch;
 *   - the sheet: one address box → Read the site → what was found, in plain
 *     words (colours as square tiles with the site's own use of each, the
 *     logo candidates with which looks like the organisation's own and which
 *     a partner's, what was left out) → a live preview of this very atlas,
 *     Now / With the site's look → Use this look.
 * The rules for the colours are look-map.js's, the same file the server runs
 * at save; swapping a colour by hand re-runs them here so the preview is what
 * will be saved. docs/design-style-from-website.md, §1, §13. */
(function () {
  "use strict";

  var api, errMsg, esc, toast, openDialog, closeDialog, INST, SLUG, preview;
  var STATE = { theme: null, canUndo: false, hasLogo: false, site: "" };
  var NAMES = { page: "page", text: "words", accent: "links and buttons", highlight: "chosen place", surfaceAlt: "shading" };
  var SHOWN = ["page", "text", "accent", "highlight", "surfaceAlt"];

  function $(s, r) { return (r || document).querySelector(s); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function when(iso) {
    try { var d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return ""; }
  }
  function key() { var m = /[?&]key=([^&]+)/.exec(location.search); return m ? m[1] : ""; }

  /* ---------------- the row in Settings ---------------- */
  function settings(scrim) {
    var host = scrim.querySelector("#own-look");
    if (!host) return;
    host.innerHTML =
      '<div class="own-fld own-look-fld"><span>Provide a website for visual style and design reference. ' +
        '<span class="own-note">its colours and logo, on this atlas</span></span>' +
        '<div class="own-look-box">' +
          '<div class="own-look-now" id="own-look-now"></div>' +
          '<div class="own-row own-look-acts">' +
            '<button class="share-btn" type="button" id="own-look-open">Use my website’s look</button>' +
            '<button class="share-btn" type="button" id="own-look-off" hidden>Back to LOKA’s look</button>' +
            '<button class="own-linkish" type="button" id="own-look-undo" hidden>Undo</button>' +
          "</div>" +
          '<label class="own-look-credit" id="own-look-credit-row" hidden><input type="checkbox" id="own-look-credit" /> ' +
            "Say in About this atlas where the look comes from</label>" +
        "</div>" +
        '<span class="own-err" id="own-look-err" role="alert"></span>' +
      "</div>";
    $("#own-look-open", scrim).onclick = function () { openSheet(scrim); };
    $("#own-look-off", scrim).onclick = function () { change(scrim, this, "DELETE", "look", "Back to LOKA’s look", "Putting LOKA’s look back…"); };
    $("#own-look-undo", scrim).onclick = function () { change(scrim, this, "POST", "look/undo", "Put back", "Putting it back…"); };
    $("#own-look-credit", scrim).onchange = function () {
      var box = this;
      api("instances/" + encodeURIComponent(SLUG) + "/look/credit", { method: "POST", body: { on: box.checked } })
        .then(function (r) { took(r); toast(box.checked ? "About this atlas says where the look comes from" : "The line is off"); })
        .catch(function (e) { box.checked = !box.checked; $("#own-look-err", scrim).textContent = errMsg(e); });
    };
    paint(scrim);
    api("instances/" + encodeURIComponent(SLUG) + "/look").then(function (r) { took(r); paint(scrim); }).catch(function () {});
  }
  function took(r) {
    if (!r || typeof r !== "object") return;
    STATE.theme = r.theme || null; STATE.canUndo = !!r.canUndo; STATE.hasLogo = !!r.hasLogo; STATE.site = r.site || STATE.site;
  }
  function paint(scrim) {
    var now = $("#own-look-now", scrim);
    if (!now) return;
    var t = STATE.theme, src = t && t.source;
    now.textContent = src && src.host ? "Look from " + src.host + (when(src.readAt) ? ", " + when(src.readAt) : "") : (t ? "A look set by hand" : "LOKA’s own look");
    $("#own-look-off", scrim).hidden = !t;
    $("#own-look-undo", scrim).hidden = !STATE.canUndo;
    $("#own-look-credit-row", scrim).hidden = !(src && src.host);
    $("#own-look-credit", scrim).checked = !!(t && t.credit !== false);
  }
  // Back to LOKA's look, and Undo: one call, then the page is repainted
  function change(scrim, btn, method, route, label, wait) {
    var err = $("#own-look-err", scrim);
    err.textContent = "";
    var stop = LokaWait.start(btn, wait);
    api("instances/" + encodeURIComponent(SLUG) + "/" + route, { method: method })
      .then(function (r) { took(r); paint(scrim); repaint(scrim); toast(label === "Undo" || label === "Put back" ? "Put back as it was" : "LOKA’s own look is back"); })
      .catch(function (e) { err.textContent = errMsg(e); })
      .then(stop);
  }
  /* The page shows the look that is saved now: the old variables are taken
     off (theme.js clear), then the atlas is drawn again from its own files,
     which is where a logo change is read from too. */
  function repaint(scrim) {
    if (window.LokaTheme) window.LokaTheme.clear(document);
    if (window.LokaAtlas && window.LokaAtlas.dataChanged) window.LokaAtlas.dataChanged();
    preview(SLUG);
    if (INST && INST.branding) INST.branding.hasLogo = STATE.hasLogo;
    syncLogoBlock(scrim);
  }
  /* The Logo block above this row (owner.js) shows what Save would leave;
     after a look brings or takes a logo it is shown as it now is, so the
     open sheet does not say "Add a logo" under a logo that is there. */
  function syncLogoBlock(scrim) {
    if (!scrim) return;
    var now = $("#own-logo-now", scrim), img = $("#own-logo-img", scrim);
    if (!now || !img) return;
    scrim.__logo = undefined;   // nothing pending for Save: the file is what it is
    now.hidden = !STATE.hasLogo;
    if (STATE.hasLogo && window.LokaAtlas) img.src = window.LokaAtlas.fileUrl("branding-logo.png") + (/\?/.test(window.LokaAtlas.fileUrl("branding-logo.png")) ? "&" : "?") + "t=" + Date.now();
    else img.removeAttribute("src");
    ["#own-logo-add", "#own-logo-note"].forEach(function (id) { var e = $(id, scrim); if (e) e.hidden = STATE.hasLogo; });
    ["#own-logo-change", "#own-logo-remove"].forEach(function (id) { var e = $(id, scrim); if (e) e.hidden = !STATE.hasLogo; });
  }

  /* ---------------- the sheet ---------------- */
  function sheetHTML() {
    return '<div class="own-sheet own-look-sheet" role="dialog" aria-modal="true" aria-label="Use my website’s look">' +
      "<h2>Use my website’s look</h2>" +
      '<p class="own-set-p">We read the site’s colours and logo. Nothing is changed until you press <b>Use this look</b>.</p>' +
      '<label class="own-fld">Your website’s address' +
        '<input type="text" id="look-url" placeholder="https://example.org" autocomplete="off" spellcheck="false" value="' + esc(STATE.site || (INST.branding && INST.branding.orgUrl) || "") + '" /></label>' +
      '<div class="own-row">' +
        '<button class="share-btn primary" type="button" id="look-read">Read the site</button>' +
        '<span class="own-note" id="look-wait" aria-live="polite"></span>' +
      "</div>" +
      '<span class="own-err" id="look-err" role="alert"></span>' +
      '<div id="look-found" hidden></div>' +
    "</div>";
  }
  function openSheet(settingsScrim) {
    var sheet = openDialog(sheetHTML(), function (scrim) {
      var go = $("#look-read", scrim), box = $("#look-url", scrim);
      go.onclick = function () { read(scrim, settingsScrim); };
      box.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); read(scrim, settingsScrim); } });
      box.addEventListener("input", function () { $("#look-err", scrim).textContent = ""; });
      setTimeout(function () { box.focus(); }, 0);
    });
    return sheet;
  }

  function read(scrim, settingsScrim) {
    var box = $("#look-url", scrim), err = $("#look-err", scrim), waitLine = $("#look-wait", scrim), go = $("#look-read", scrim);
    var typed = box.value.trim();
    if (!typed) { err.textContent = "Type your website’s address."; box.focus(); return; }
    err.textContent = "";
    $("#look-found", scrim).hidden = true;
    // never instant: the mark goes up at once, with words that say how long
    var stop = LokaWait.start(go, "Reading the site…", { delay: 0 });
    waitLine.textContent = "This takes a few seconds.";
    api("instances/" + encodeURIComponent(SLUG) + "/look/read", { method: "POST", body: { url: typed } })
      .then(function (p) { waitLine.textContent = ""; showProposal(scrim, settingsScrim, p); })
      .catch(function (e) { waitLine.textContent = ""; err.textContent = errMsg(e); })
      .then(stop);
  }

  /* ---------------- the proposal ---------------- */
  var P = null;   // { proposal, chosen, logoPick, logoPng, credit, rights }
  function showProposal(scrim, settingsScrim, proposal) {
    // the site's own logo is picked to start with (found by its picture: the
    // answer's `logo` is a copy of the list's entry, not the same object)
    var own = proposal.logo ? (proposal.logos || []).map(function (l) { return l.dataUrl; }).indexOf(proposal.logo.dataUrl) : -1;
    P = { proposal: proposal, chosen: {}, logoPick: own, logoPng: null, credit: true, rights: false, theme: proposal.theme, from: proposal.from, lines: proposal.lines, leftOut: proposal.leftOut };
    var host = $("#look-found", scrim);
    host.hidden = false;
    host.innerHTML =
      (proposal.partial ? '<p class="own-set-p own-look-partial">That site draws itself in the browser, so we could only read part of it. Here is what we found.</p>' : "") +
      '<h3 class="own-set-h">Colours</h3>' +
      '<p class="own-set-p">Press a colour to swap it for another the site uses.</p>' +
      '<div class="own-look-tiles" id="look-tiles"></div>' +
      '<ul class="own-look-lines" id="look-lines"></ul>' +
      '<h3 class="own-set-h">Logo</h3>' +
      '<div class="own-look-logos" id="look-logos"></div>' +
      '<label class="own-look-tick" id="look-rights-row"><input type="checkbox" id="look-rights" /> This is my organisation’s own site and logo, and I may use them here.</label>' +
      '<label class="own-look-tick"><input type="checkbox" id="look-credit" checked /> Say in About this atlas where the look comes from</label>' +
      '<details class="own-look-left" id="look-left"><summary>What we left out</summary><ul></ul></details>' +
      '<h3 class="own-set-h">How it looks</h3>' +
      '<div class="own-look-switch" role="group" aria-label="Preview">' +
        '<button type="button" class="own-look-sw" id="look-sw-now" aria-pressed="false">Now</button>' +
        '<button type="button" class="own-look-sw" id="look-sw-with" aria-pressed="true">With the site’s look</button>' +
      "</div>" +
      '<div class="own-look-frame"><p class="own-note wait-line" id="look-frame-wait">' + LokaWait.html("Opening the preview…") + "</p>" +
        '<iframe id="look-frame" title="Your atlas, as it would look" hidden></iframe></div>' +
      '<div class="own-row own-row-top">' +
        '<button class="share-btn primary" type="button" id="look-use">Use this look</button>' +
        '<button class="share-btn" type="button" id="look-not" data-close>Not now</button>' +
        '<span class="own-err" id="look-save-err" role="alert"></span>' +
      "</div>";
    paintTiles(scrim);
    paintLogos(scrim);
    var left = $("#look-left ul", scrim);
    (P.leftOut || []).forEach(function (s) { left.appendChild(el("li", null, esc(s))); });
    $("#look-left", scrim).hidden = !(P.leftOut && P.leftOut.length);
    $("#look-rights", scrim).onchange = function () { P.rights = this.checked; armUse(scrim); };
    $("#look-credit", scrim).onchange = function () { P.credit = this.checked; };
    $("#look-sw-now", scrim).onclick = function () { flip(scrim, false); };
    $("#look-sw-with", scrim).onclick = function () { flip(scrim, true); };
    $("#look-use", scrim).onclick = function () { save(scrim, settingsScrim, this); };
    armUse(scrim);
    openFrame(scrim);
    host.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  // the tiles: square, the name below, the site's own use of the colour beside
  function paintTiles(scrim) {
    var host = $("#look-tiles", scrim), lines = $("#look-lines", scrim);
    host.innerHTML = ""; lines.innerHTML = "";
    var colors = P.theme.colors || {}, from = P.from || {}, found = P.proposal.found.colours || [];
    SHOWN.forEach(function (slot) {
      var hex = colors[slot];
      if (!hex) return;
      var f = from[slot];
      var tile = el("div", "own-look-tile");
      var sw = el("button", "own-look-swatch");
      sw.type = "button"; sw.style.background = hex; sw.setAttribute("aria-label", NAMES[slot] + ": " + hex);
      sw.title = "Swap the colour for " + NAMES[slot];
      var words = el("div", "own-look-tile-words");
      words.appendChild(el("b", null, esc(NAMES[slot])));
      if (f && f.name) words.appendChild(el("span", null, esc("the site’s " + f.name + (f.usedFor ? ": " + f.usedFor : "")) + (f.why === "chosen by you" ? " · <i>chosen by you</i>" : "")));
      else words.appendChild(el("span", null, "LOKA’s own"));
      tile.appendChild(sw); tile.appendChild(words);
      var pick = el("div", "own-look-pick"); pick.hidden = true;
      found.forEach(function (c) {
        var b = el("button", "own-look-swatch own-look-swatch-s");
        b.type = "button"; b.style.background = c.hex; b.title = "the site’s " + (window.LokaLookMap ? window.LokaLookMap.colourName(c.hex) : c.hex) + ": " + c.usedFor;
        b.setAttribute("aria-label", b.title);
        b.onclick = function () { P.chosen[slot] = c.hex; remap(scrim); };
        pick.appendChild(b);
      });
      if (P.chosen[slot]) {
        var back = el("button", "own-linkish", "Back to what we found");
        back.type = "button"; back.onclick = function () { delete P.chosen[slot]; remap(scrim); };
        pick.appendChild(back);
      }
      sw.onclick = function () { pick.hidden = !pick.hidden; };
      tile.appendChild(pick);
      host.appendChild(tile);
    });
    (P.lines || []).forEach(function (s) { lines.appendChild(el("li", null, esc(s))); });
    lines.hidden = !(P.lines && P.lines.length);
  }
  // a colour swapped by hand: the same rule the server runs, with `chosen`.
  // look-map.js is fetched when first needed (visitors never need it).
  var mapP = null;
  function mapTools() {
    if (window.LokaLookMap) return Promise.resolve(window.LokaLookMap);
    if (mapP) return mapP;
    mapP = new Promise(function (ok, no) {
      var s = document.createElement("script");
      s.src = "./look-map.js" + VERSION;
      s.onload = function () { window.LokaLookMap ? ok(window.LokaLookMap) : no(new Error("no mapper")); };
      s.onerror = function () { mapP = null; no(new Error("no mapper")); };
      document.head.appendChild(s);
    });
    return mapP;
  }
  function remap(scrim) {
    mapTools().then(function () { remapNow(scrim); }).catch(function () { post(scrim, true); });
  }
  function remapNow(scrim) {
    var f = P.proposal.found, logo = P.logoPick >= 0 ? P.proposal.logos[P.logoPick] : null;
    var r = window.LokaLookMap.map({ colours: f.colours, page: f.page, text: f.text, corners: f.corners, logo: logo ? { width: logo.width, height: logo.height } : null, chosen: P.chosen });
    r.theme.source = P.proposal.source;
    if (Object.keys(P.chosen).length) r.theme.chosen = Object.assign({}, P.chosen);
    P.theme = r.theme; P.from = r.from; P.lines = r.lines; P.leftOut = r.leftOut;
    paintTiles(scrim);
    post(scrim, true);
  }

  // the logo candidates: which looks like the organisation's own, which a
  // partner's. Each is redrawn by logo-tools first (as the owner's own file
  // would be), and its tone read: a light logo (white on see-through) sits on
  // a dark tile so it can be seen; a picture with nothing drawn is not offered.
  function paintLogos(scrim) {
    var host = $("#look-logos", scrim);
    host.innerHTML = "";
    var logos = P.proposal.logos || [];
    P.prepared = [];
    if (!logos.length) {
      host.appendChild(el("p", "own-set-p", "We didn’t find a logo on that page. You can add one by hand in Settings."));
      $("#look-rights-row", scrim).hidden = true;
      return;
    }
    var rows = logos.map(function (l, i) {
      var row = el("label", "own-look-logo" + (l.verdict === "partner" ? " own-look-logo-no" : ""));
      var radio = el("input"); radio.type = "radio"; radio.name = "look-logo"; radio.checked = i === P.logoPick;
      radio.onchange = function () { P.logoPick = i; pickLogo(scrim); };
      var pic = el("span", "own-look-logo-pic"); pic.style.background = (P.theme.colors && P.theme.colors.page) || "#FFFFFF";
      var img = el("img"); img.alt = l.alt || ""; img.src = l.dataUrl; pic.appendChild(img);
      var words = el("span", "own-look-logo-words", "<b>" + esc(l.from.charAt(0).toUpperCase() + l.from.slice(1)) + "</b><span>" + esc(l.words) + "</span>");
      row.appendChild(radio); row.appendChild(pic); row.appendChild(words);
      host.appendChild(row);
      return { row: row, pic: pic, radio: radio };
    });
    var none = el("label", "own-look-logo");
    var nr = el("input"); nr.type = "radio"; nr.name = "look-logo"; nr.checked = P.logoPick < 0;
    nr.onchange = function () { P.logoPick = -1; pickLogo(scrim); };
    none.appendChild(nr); none.appendChild(el("span", "own-look-logo-words", "<b>No logo from the site</b><span>Colours only" + (STATE.hasLogo ? "; the logo you have stays" : "") + ".</span>"));
    host.appendChild(none);
    tools().then(function (T) {
      logos.forEach(function (l, i) {
        T.logoFromDataUrl(l.dataUrl, function (e, png) {
          if (e) { P.prepared[i] = { error: e }; dropLogo(scrim, rows, i); return; }
          T.logoTone(png, function (e2, tone) {
            P.prepared[i] = { png: png, tone: tone || null };
            if (!e2 && tone && tone.empty) { dropLogo(scrim, rows, i); return; }
            if (!e2 && tone && tone.light) { rows[i].pic.classList.add("own-look-logo-dark"); rows[i].pic.style.background = ""; }
            if (i === P.logoPick) pickLogo(scrim);
          });
        });
      });
    }).catch(function () { $("#look-save-err", scrim).textContent = "The logo tools didn’t load — reload the page and try again."; });
    pickLogo(scrim);
  }
  // a picture that cannot be used as a logo is taken off the list
  function dropLogo(scrim, rows, i) {
    rows[i].row.remove();
    if (P.logoPick === i) {
      P.logoPick = -1;
      for (var j = 0; j < rows.length; j++) if (rows[j].row.isConnected && !(P.prepared[j] && (P.prepared[j].error || (P.prepared[j].tone && P.prepared[j].tone.empty)))) { P.logoPick = j; break; }
      if (P.logoPick >= 0) rows[P.logoPick].radio.checked = true; else $("#look-logos input[type=radio]:last-of-type", scrim).checked = true;
      pickLogo(scrim);
    }
  }
  // the picked logo, as logo-tools redrew it, goes to the preview and to Save
  function pickLogo(scrim) {
    $("#look-rights-row", scrim).hidden = P.logoPick < 0;
    armUse(scrim);
    var prep = P.logoPick >= 0 ? P.prepared[P.logoPick] : null;
    P.logoPng = prep && prep.png ? prep.png : null;
    remap(scrim);
  }
  var toolsP = null;
  function tools() {
    if (window.LokaLogoTools) return Promise.resolve(window.LokaLogoTools);
    if (toolsP) return toolsP;
    toolsP = new Promise(function (ok, no) {
      var s = document.createElement("script");
      s.src = "./logo-tools.js" + VERSION;
      s.onload = function () { window.LokaLogoTools ? ok(window.LokaLogoTools) : no(new Error("no tools")); };
      s.onerror = function () { toolsP = null; no(new Error("no tools")); };
      document.head.appendChild(s);
    });
    return toolsP;
  }
  function armUse(scrim) {
    var use = $("#look-use", scrim);
    if (!use) return;
    use.disabled = P.logoPick >= 0 && !P.rights;
    use.title = use.disabled ? "Tick the line about the logo first, or choose “No logo from the site”." : "";
  }

  /* ---------------- the preview ---------------- */
  function openFrame(scrim) {
    var f = $("#look-frame", scrim), waitEl = $("#look-frame-wait", scrim);
    f.src = "./?dataset=" + encodeURIComponent(SLUG) + "&embed=1" + (key() ? "&key=" + encodeURIComponent(key()) : "");
    f.onload = function () { waitEl.hidden = true; f.hidden = false; setTimeout(function () { post(scrim, true); }, 400); };
  }
  function post(scrim, withLook) {
    var f = $("#look-frame", scrim);
    if (!f || !f.contentWindow) return;
    var msg = withLook === null ? { type: "loka-look-preview", logoDataUrl: null }
      : withLook ? { type: "loka-look-preview", theme: P.theme, logoDataUrl: P.logoPng || null }
      : { type: "loka-look-preview", theme: null, logoDataUrl: null };
    try { f.contentWindow.postMessage(msg, location.origin); } catch (e) {}
  }
  function flip(scrim, withLook) {
    $("#look-sw-now", scrim).setAttribute("aria-pressed", String(!withLook));
    $("#look-sw-with", scrim).setAttribute("aria-pressed", String(!!withLook));
    post(scrim, withLook);
  }

  /* ---------------- save ---------------- */
  function save(scrim, settingsScrim, btn) {
    var err = $("#look-save-err", scrim);
    err.textContent = "";
    var useLogo = P.logoPick >= 0 && !!P.logoPng;
    if (P.logoPick >= 0 && !P.logoPng) { err.textContent = "The logo is still being prepared — one moment."; return; }
    var theme = Object.assign({}, P.theme, { credit: P.credit });
    var stop = LokaWait.start(btn, "Saving the look…");
    api("instances/" + encodeURIComponent(SLUG) + "/look", { method: "POST", body: { theme: theme, useLogo: useLogo, logoData: useLogo ? P.logoPng : undefined } })
      .then(function (r) {
        took(r);
        closeDialog(scrim);
        paint(settingsScrim);
        repaint(settingsScrim);
        toast("Look from " + ((theme.source && theme.source.host) || "your site") + " is on · Undo in Settings");
      })
      .catch(function (e) { err.textContent = errMsg(e); })
      .then(stop);
  }

  var VERSION = "";
  function mount(ctx) {
    api = ctx.api; errMsg = ctx.errMsg; esc = ctx.esc; toast = ctx.toast; openDialog = ctx.openDialog; closeDialog = ctx.closeDialog;
    INST = ctx.inst; SLUG = ctx.slug; preview = ctx.preview; VERSION = ctx.version || "";
    return { settings: settings };
  }
  window.LokaOwnerLook = { mount: mount };
})();
