/* LOKA Atlas — Explore mode: a city's places, found by what they are and by
 * what is near where you are looking.
 *
 * An atlas switches it on with a `mode` in manifest.local.json (the file a
 * rebuild leaves alone), written by deploy/apply-explore-mode.mjs from
 * deploy/explores/<atlas>.json:
 *
 *   mode: {
 *     name: "explore",
 *     layer: "<the layer holding the places>",
 *     tagColumn: "categories",          // the places' own words, split on ";"
 *     frameShare: 0.8,                  // the map opens on this share of the places
 *     buttons: [ { id, label, icon, color?, words: [...] }, ... ]
 *   }
 *
 * A place belongs to a button when one of its own words is one of the
 * button's words (any case). It may belong to several, or to none: a place
 * with no button stays on the map and in the list. One button at a time;
 * tapping the chosen one again shows every place.
 *
 * It is built from Event mode's pieces (event-mode.js): the same buttons,
 * the same phone layout above the sheet, the same rows, the same distances
 * in words, the same "Where am I" (atlas.js adds it for any mode). What it
 * adds: the list is "Around here", nearest the middle of the map first, and
 * re-ordered when the map stops moving; each row has its small photo
 * (deploy/make-small-photos.mjs); the map opens on most of the places, the
 * few far ones left out (frameBox).
 *
 * With no mode, or any other name, nothing here runs. Nothing here knows
 * which city it is drawing: every word on the screen comes from the mode or
 * from the places. */
(function (root, make) {
  var node = typeof module === "object" && module.exports;
  var made = make(node ? require("./event-mode.js") : root.LokaEventMode);
  if (node) module.exports = made;
  else root.LokaExploreMode = made;
})(typeof self !== "undefined" ? self : this, function (EVM) {
  "use strict";

  var metres = EVM.metres, distanceWords = EVM.distanceWords;

  function isOn(manifest) {
    var m = manifest && manifest.mode;
    return !!(m && typeof m === "object" && m.name === "explore");
  }

  // a place's own words: "Culture; Heritage" -> ["culture", "heritage"]
  function placeWords(props, mode) {
    var v = props && props[(mode && mode.tagColumn) || "categories"];
    if (v == null) return [];
    var parts = Array.isArray(v) ? v : String(v).split(";");
    return parts.map(function (s) { return String(s).trim().toLowerCase(); }).filter(Boolean);
  }
  function buttonsOf(mode) {
    return ((mode && mode.buttons) || []).filter(function (b) { return b && b.id && b.label; });
  }
  // the ids of the buttons a place belongs to, in the buttons' order
  function placeButtons(props, mode) {
    var w = placeWords(props, mode);
    return buttonsOf(mode).filter(function (b) {
      return (b.words || []).some(function (x) { return w.indexOf(String(x).trim().toLowerCase()) >= 0; });
    }).map(function (b) { return b.id; });
  }
  // how many places each button holds, and how many have none
  function countButtons(features, mode) {
    var out = { none: 0 };
    buttonsOf(mode).forEach(function (b) { out[b.id] = 0; });
    (features || []).forEach(function (f) {
      var ids = placeButtons(f && f.properties, mode);
      if (!ids.length) out.none++;
      ids.forEach(function (id) { out[id]++; });
    });
    return out;
  }

  /* The box the map opens on: the share of the places nearest their middle
     (the median longitude and latitude), the rest left out — so one place
     tagged on a trip out of town does not pull the whole city into a
     speck. Ties go by the places' order, so the same places always give the
     same box. Returns [[west, south], [east, north]], or null with none. */
  function frameBox(points, share) {
    var pts = (points || []).filter(function (p) { return p && isFinite(p[0]) && isFinite(p[1]); });
    if (!pts.length) return null;
    var s = typeof share === "number" && share > 0 && share <= 1 ? share : 0.8;
    var med = function (k) {
      var v = pts.map(function (p) { return p[k]; }).sort(function (a, b) { return a - b; });
      var h = v.length >> 1;
      return v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2;
    };
    var mid = [med(0), med(1)];
    var keep = Math.max(1, Math.ceil(pts.length * s));
    var near = pts.map(function (p, i) { return { p: p, i: i, m: metres(mid, p) }; })
      .sort(function (a, b) { return a.m - b.m || a.i - b.i; })
      .slice(0, keep);
    var w = 180, so = 90, e = -180, n = -90;
    near.forEach(function (x) {
      if (x.p[0] < w) w = x.p[0]; if (x.p[0] > e) e = x.p[0];
      if (x.p[1] < so) so = x.p[1]; if (x.p[1] > n) n = x.p[1];
    });
    return [[w, so], [e, n]];
  }

  function countWord(n, one, many) { return n + " " + (n === 1 ? one : many); }

  /* ---- the buttons, as the owner sets them (owner.js, the Buttons tab) and
     the server keeps them (POST /instances/:slug/mode). One set of rules for
     both, so the page cannot offer what the server would refuse. ---- */
  // colour by place in the row (the first four as the first atlas in Explore chose them)
  var PALETTE = ["#2A6B41", "#C9402B", "#B5541B", "#3A7FA1", "#B99A1C"];
  var ICON_CHOICES = ["leaf", "landmark", "ticket", "users", "utensils", "camera", "music", "book"];
  var DEFAULT_ICONS = ["leaf", "landmark", "ticket", "users"];
  var MAX_BUTTONS = 4, MAX_LABEL = 20, MAX_WORD = 40, MAX_WORDS = 12;

  /* Every word the places use, with how many places use it, most first. A
     word is the same word in any case; it is shown as most places write it. */
  function wordCounts(features, mode) {
    var col = (mode && mode.tagColumn) || "categories";
    var by = {}, order = [];
    (features || []).forEach(function (f) {
      var v = f && f.properties && f.properties[col];
      if (v == null) return;
      var seen = {};
      (Array.isArray(v) ? v : String(v).split(";")).forEach(function (raw) {
        var w = String(raw).trim(), k = w.toLowerCase();
        if (!w || seen[k]) return;
        seen[k] = true;
        if (!by[k]) { by[k] = { n: 0, forms: {} }; order.push(k); }
        by[k].n++;
        by[k].forms[w] = (by[k].forms[w] || 0) + 1;
      });
    });
    return order.map(function (k, i) {
      var forms = by[k].forms, best = null;
      Object.keys(forms).forEach(function (w) { if (best === null || forms[w] > forms[best]) best = w; });
      return { w: best, n: by[k].n, i: i };
    }).sort(function (a, b) { return b.n - a.n || a.i - b.i; })
      .map(function (x) { return { w: x.w, n: x.n }; });
  }
  // a new Explore: one button for each of the four words most places use
  function defaultButtons(features, mode) {
    return wordCounts(features, mode).slice(0, MAX_BUTTONS).map(function (x, i) {
      return { id: "b" + (i + 1), label: Array.from(x.w).slice(0, MAX_LABEL).join("").trim(),
        icon: DEFAULT_ICONS[i], color: PALETTE[i], words: [x.w] };
    });
  }
  /* What an owner sent, made safe or refused. Returns { buttons } or
     { error } in plain words. Ids are kept when they are plain and unique,
     otherwise made; colours always follow the place in the row. */
  function cleanButtons(list) {
    if (!Array.isArray(list)) return { error: "The buttons were not sent as a list." };
    if (list.length > MAX_BUTTONS) return { error: "Four buttons is the most: a row of four still fits on a phone." };
    var out = [], ids = {};
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (!b || typeof b !== "object") return { error: "Button " + (i + 1) + " is not a button." };
      var label = typeof b.label === "string" ? b.label.replace(/\s+/g, " ").trim() : "";
      if (!label) return { error: "Give every button a name." };
      // letters, not code units: an emoji or a conjunct's parts count as they are seen
      if (Array.from(label).length > MAX_LABEL) return { error: "A button's name can be at most " + MAX_LABEL + " letters: \u201c" + label + "\u201d is longer." };
      if (ICON_CHOICES.indexOf(b.icon) < 0) return { error: "Choose one of the eight pictures for \u201c" + label + "\u201d." };
      if (b.words != null && !Array.isArray(b.words)) return { error: "The categories for \u201c" + label + "\u201d were not sent as a list." };
      var words = [], seen = {};
      var raw = b.words || [];
      for (var j = 0; j < raw.length; j++) {
        if (typeof raw[j] !== "string") return { error: "A category for \u201c" + label + "\u201d is not a word." };
        var w = raw[j].trim(), k = w.toLowerCase();
        if (!w) continue;
        if (Array.from(w).length > MAX_WORD) return { error: "A category can be at most " + MAX_WORD + " letters." };
        if (seen[k]) continue;
        seen[k] = true;
        words.push(w);
      }
      if (words.length > MAX_WORDS) return { error: "A button can hold at most " + MAX_WORDS + " categories." };
      var id = typeof b.id === "string" && /^[a-z0-9_-]{1,24}$/i.test(b.id) && !ids[b.id] ? b.id : null;
      out.push({ id: id, label: label, icon: b.icon, color: PALETTE[i], words: words });
      if (id) ids[id] = true;
    }
    var n = 1;
    out.forEach(function (b) {
      if (b.id) return;
      while (ids["b" + n]) n++;
      b.id = "b" + n; ids[b.id] = true;
    });
    return { buttons: out };
  }

  /* ==================================================================
     THE VIEWER. atlas.js hands over what it owns (`api`, the same one Event
     mode gets) and calls back at the same points: layers(), pinEl(),
     cardHTML(), buildPanel(), ready(), framed(), sheetHead(); and one more,
     frameBox(), for the opening view.
  ================================================================== */
  var NO_BUTTON = "#7A756C";
  var NO_BUTTON_ICON = "pin";   // a list row's mark for a place with no button, or a photo that will not load
  var CSS =
    ".ex-thumb{flex:0 0 auto;width:48px;height:48px;border-radius:var(--radius-sm,6px);object-fit:cover;display:block;background:var(--color-surface-alt,#efe9dd)}\n" +
    ".ex-thumb-none{display:inline-flex;align-items:center;justify-content:center;color:var(--color-text-muted,#6E6A63)}\n" +
    ".ex-thumb-none svg{width:20px;height:20px}\n" +
    ".ex-row{align-items:center}\n" +
    ".ex-note{font-size:var(--t-meta,13px);color:var(--color-text-secondary,#5A5751);margin:.6rem 0 .3rem}\n" +
    /* a phone: the first-visit line ("Tap a pin…") goes above the credit,
       which Event mode's layout has already lifted over the buttons — so the
       buttons, the credit and the line never sit on one another */
    "@media (max-width:720px){.atlas-stage.ex-on .atlas-cue{bottom:calc(var(--sheet-h,0px) + 112px)}}\n";

  function viewer(mode, api) {
    var esc = api.esc, el = api.el;
    var BUTTONS = [], byId = {};
    function takeButtons() {
      BUTTONS = buttonsOf(mode);
      byId = {};
      BUTTONS.forEach(function (b, i) { byId[b.id] = b; if (!b.color) b.color = PALETTE[i % PALETTE.length]; });
    }
    takeButtons();
    var srcLayer = null, X = null, titleProp = "name";
    var state = { chosen: null, ready: false, chips: null, list: null };
    var moveTimer = null;

    function layers(list) {
      srcLayer = list.filter(function (L) { return L.id === mode.layer; })[0] ||
        list.filter(function (L) { return L.userLayer && L.type === "marker"; })[0] || null;
      if (!srcLayer) return null;
      titleProp = (srcLayer.popup && srcLayer.popup.title) || (srcLayer.label_text && srcLayer.label_text.property) || "name";
      // the same layer, its pins drawn by the buttons; every place is in it
      X = {};
      for (var k in srcLayer) X[k] = srcLayer[k];
      X.default = true; X._visible = true;
      X._ev = { explore: true };
      X.rowsFrom = function (gj) {
        ((gj && gj.features) || []).forEach(function (f) { f._exB = placeButtons(f.properties, mode); });
        return gj;
      };
      return list.map(function (L) { return L === srcLayer ? X : L; });
    }

    function nameOf(f) {
      var p = (f && f.properties) || {};
      return String(p[titleProp] || p.loka_name || p.name || "").trim();
    }
    function entries() { return (X && api.markers(X.id)) || []; }
    function firstButton(f) { var ids = (f && f._exB) || []; return ids.length ? byId[ids[0]] : null; }

    function pinEl(L, f) {
      if (!L || !L._ev || !L._ev.explore) return null;
      var b = firstButton(f);
      return api.locPinEl(b ? b.color : NO_BUTTON, b ? b.icon || null : null);
    }

    // the card keeps the full photograph; the list has the small one
    function photoHTML(props) {
      if (!props.photo_file || !api.dataUrl) return api.shotsHTML(api.linksIn(props.photo_urls || props.photo_1_url || props.image_urls));
      return api.shotsHTML([api.dataUrl(String(props.photo_file))]);
    }
    function cardHTML(L, props, f) {
      if (!L || !L._ev || !L._ev.explore) return null;
      var words = api.cellShown(props[mode.tagColumn || "categories"]).replace(/\s*;\s*/g, " · ");
      var h = '<div class="pop ev-card ex-card">';
      if (words) h += '<div class="pop-sub">' + esc(words) + "</div>";
      h += '<div class="pop-title">' + esc(nameOf(f || { properties: props })) + "</div>";
      h += photoHTML(props);
      if (props.description) h += '<p class="pop-caption">' + esc(api.cellShown(props.description)) + "</p>";
      if (props.address) h += '<p class="ev-addr">' + esc(api.cellShown(props.address)) + "</p>";
      var all = (api.data(X.id) || {}).features || [];
      var no = f ? all.indexOf(f) : -1;
      if (no >= 0) h += '<button type="button" class="ev-around-link" data-ex-around="' + no + '">What’s around here</button>';
      if (api.lokaLinkHTML) h += api.lokaLinkHTML(srcLayer || L, props);
      return h + "</div>";
    }

    /* ---- the buttons ---- */
    function apply() {
      entries().forEach(function (e) {
        e.subOff = !!(state.chosen && ((e.f && e.f._exB) || []).indexOf(state.chosen) < 0);
      });
      if (X) api.setLayerVisible(X, true);   // repaints the pins and their names
    }
    function syncChips() {
      if (!state.chips) return;
      Array.prototype.forEach.call(state.chips.querySelectorAll(".ev-chip"), function (b) {
        b.setAttribute("aria-pressed", String(b.getAttribute("data-cat") === state.chosen));
      });
    }
    function buildChips() {
      var bar = el("div", "ev-chips");
      bar.setAttribute("role", "group");
      bar.setAttribute("aria-label", "What to show on the map");
      BUTTONS.forEach(function (c) {
        var b = el("button", "ev-chip");
        b.type = "button";
        b.setAttribute("data-cat", c.id);
        b.style.setProperty("--ev-c", c.color);
        b.innerHTML = (c.icon ? EVM.iconSvg(c.icon) : '<i aria-hidden="true"></i>') + "<span>" + esc(c.label) + "</span>";
        b.addEventListener("click", function () {
          // one at a time; the chosen one again shows every place
          state.chosen = state.chosen === c.id ? null : c.id;
          apply();
          syncChips();
          renderList(true);
        });
        bar.appendChild(b);
      });
      bar.style.setProperty("--ev-n", String(BUTTONS.length));
      state.chips = bar;
      syncChips();
      return bar;
    }
    // phones: the buttons float above the sheet; wide screens: they head the panel
    function placeChips() {
      var bar = state.chips; if (!bar) return;
      var panel = document.getElementById("atlas-panel");
      var stage = document.querySelector(".atlas-stage");
      if (stage) { stage.classList.add("ev-on"); stage.classList.add("ex-on"); }
      // no buttons: no row at all, the plain map and the list
      if (!BUTTONS.length) { if (bar.parentNode) bar.parentNode.removeChild(bar); return; }
      if (api.onPhone()) {
        if (stage && bar.parentNode !== stage) stage.appendChild(bar);
      } else if (panel) {
        var body = panel.querySelector(".sheet-body");
        if (bar.parentNode !== panel) panel.insertBefore(bar, body || null);
      }
    }
    var placeWired = false;

    function injectStyle(doc) {
      EVM.injectStyle(doc);
      if (!doc || doc.getElementById("ex-style")) return;
      var s = doc.createElement("style");
      s.id = "ex-style";
      s.textContent = CSS;
      (doc.head || doc.documentElement).appendChild(s);
    }

    function buildPanel(panel) {
      injectStyle(document);
      Array.prototype.forEach.call(document.querySelectorAll(".ev-chips,.ev-subchips"), function (old) {
        if (old.parentNode) old.parentNode.removeChild(old);
      });
      buildChips();
      placeChips();
      if (!placeWired) {
        placeWired = true;
        window.matchMedia("(max-width: 720px)").addEventListener("change", placeChips);
      }
      var sec = el("section", "ctl-group ev-group");
      sec.setAttribute("data-group", "explore");
      sec.setAttribute("data-group-label", "Around here");
      var list = el("div", "ev-wrap");
      sec.appendChild(list);
      panel.appendChild(sec);
      state.list = list;
      renderList();
      var back = document.getElementById("sheet-card-back");
      if (back && back.lastChild && back.lastChild.nodeType === 3) back.lastChild.nodeValue = "Around here";
      if (back) back.setAttribute("aria-label", "Back to the places around here");
    }

    /* ---- "Around here": the places shown, nearest the middle of the map first ---- */
    function shown() { return entries().filter(function (e) { return !e.subOff; }); }
    function sheetHead() {
      var b = state.chosen && byId[state.chosen];
      if (!state.ready) return { label: "Around here", small: "" };
      var n = countWord(shown().length, "place", "places");
      return { label: "Around here", small: b ? b.label + " · " + n : n };
    }
    function syncHead() {
      var sh = sheetHead();
      var head = document.querySelector("#atlas-panel .sheet-who strong");
      if (head) head.textContent = sh.label;
      var who = document.getElementById("sheet-layer");
      if (who) { who.innerHTML = ""; who.appendChild(el("span", "sheet-layer-name", esc(sh.small || sh.label))); }
    }
    // a row is made once and kept, so its small photo is fetched once
    function rowOf(e) {
      if (e._exRow) return e._exRow;
      var f = e.f, p = f.properties || {};
      var b = firstButton(f);
      var mark = '<span class="ex-thumb ex-thumb-none" aria-hidden="true">' + EVM.iconSvg((b && b.icon) || NO_BUTTON_ICON) + "</span>";
      var thumb = p.photo_small && api.dataUrl
        ? '<img class="ex-thumb" src="' + esc(api.dataUrl(String(p.photo_small))) + '" alt="" loading="lazy" width="48" height="48" referrerpolicy="no-referrer">'
        : mark;
      var word = b ? b.label : (placeWords(p, mode)[0] ? api.cellShown(String(p[mode.tagColumn || "categories"]).split(";")[0]) : "");
      var row = el("button", "ev-row ex-row");
      row.type = "button";
      row.innerHTML = thumb + '<span class="ev-rw"><span class="ev-rn">' + esc(nameOf(f)) + '</span><span class="ev-rm">' +
        (word ? esc(word) + " · " : "") + "<b></b></span></span>";
      row.addEventListener("click", function () { api.openPlace(X, f); });
      // a small photo that will not load gives way to the place's mark, never an empty square
      var img = row.querySelector && row.querySelector("img.ex-thumb");
      if (img) img.addEventListener("error", function () {
        var box = el("span", "ex-thumb ex-thumb-none", EVM.iconSvg((b && b.icon) || NO_BUTTON_ICON));
        box.setAttribute("aria-hidden", "true");
        if (img.parentNode) img.parentNode.replaceChild(box, img);
      });
      e._exRow = row;
      return row;
    }
    function waitLine(words) {
      var p = el("p", "ev-hint");
      p.innerHTML = window.LokaWait ? window.LokaWait.html(words) : esc(words);
      return p;
    }
    function renderList(toTop) {
      syncHead();
      var box = state.list; if (!box) return;
      box.innerHTML = "";
      if (!state.ready) { box.appendChild(waitLine("Loading the places…")); return; }
      var mid = api.center ? api.center() : null;
      var rows = shown().map(function (e) {
        return { e: e, m: mid ? metres(mid, e.f.geometry.coordinates) : 0, n: nameOf(e.f) };
      }).sort(function (a, b) { return a.m - b.m || a.n.localeCompare(b.n); });
      // the panel's own head already says "Around here": the list says how many, and in what order;
      // a phone's sheet head already gives the count, so there it says only the order
      box.appendChild(el("p", "ex-note", api.onPhone() ? "Nearest the middle of the map first." :
        esc(countWord(rows.length, "place", "places") + ", nearest the middle of the map first.")));
      if (!rows.length) box.appendChild(el("p", "ev-hint", "None listed."));
      rows.forEach(function (r) {
        var row = rowOf(r.e);
        var d = row.querySelector(".ev-rm b");
        if (d) d.textContent = mid ? distanceWords(r.m) : "";
        box.appendChild(row);
      });
      if (toTop) {
        var sc = box.closest && box.closest(".sheet-body");
        if (sc) sc.scrollTop = 0;
      }
    }

    // "What's around here" on a card: the map comes to the place, and the list follows it
    function around(no) {
      var f = ((api.data(X.id) || {}).features || [])[+no];
      if (!f || !f.geometry) return;
      if (api.onPhone()) { api.closeCard(); api.setSheet("peek"); }
      if (api.centreOn) api.centreOn(f.geometry.coordinates);
    }

    if (!viewer._wired && typeof document !== "undefined") {
      viewer._wired = true;
      document.addEventListener("click", function (e) {
        var t = e.target && e.target.closest && e.target.closest("[data-ex-around]");
        if (!t || !viewer._current) return;
        e.stopPropagation();
        viewer._current.around(t.getAttribute("data-ex-around"));
      });
    }

    /* The owner's Buttons tab (owner.js) shows its unsaved buttons on the
       map as they are edited: the same drawing, handed a new list. Colours
       follow the place in the row, as the server will save them. */
    function setButtons(list) {
      mode.buttons = (list || []).map(function (b, i) {
        return { id: b.id, label: b.label, icon: b.icon, color: PALETTE[i % PALETTE.length], words: (b.words || []).slice() };
      });
      takeButtons();
      if (state.chosen && !byId[state.chosen]) state.chosen = null;
      if (!X) return;
      ((api.data(X.id) || {}).features || []).forEach(function (f) { f._exB = placeButtons(f.properties, mode); });
      entries().forEach(function (e) {
        e._exRow = null;   // a row wears its button's word and picture
        var old = e.node && e.node.querySelector && e.node.querySelector(".atlas-pin");
        var pin = old && pinEl(X, e.f);
        if (pin && old.parentNode) old.parentNode.replaceChild(pin, old);
      });
      if (typeof document !== "undefined") {
        if (state.chips && state.chips.parentNode) state.chips.parentNode.removeChild(state.chips);
        buildChips();
        placeChips();
      }
      if (state.ready) { apply(); renderList(); }
    }

    var me = {
      setButtons: setButtons,
      layers: layers,
      pinEl: pinEl,
      cardHTML: cardHTML,
      buildPanel: buildPanel,
      ready: function () {
        state.ready = true;
        apply();
        // the list follows the map: re-ordered once it stops moving
        if (api.onMoveEnd) api.onMoveEnd(function () {
          clearTimeout(moveTimer);
          moveTimer = setTimeout(function () { renderList(true); }, 250);
        });
        renderList();
      },
      framed: function () { return X ? [X.id] : []; },
      frameBox: function (pts) { return frameBox(pts, mode.frameShare); },
      sheetHead: sheetHead,
      around: around,
      state: state,
    };
    viewer._current = me;
    return me;
  }

  return {
    isOn: isOn,
    placeWords: placeWords,
    placeButtons: placeButtons,
    countButtons: countButtons,
    frameBox: frameBox,
    wordCounts: wordCounts,
    defaultButtons: defaultButtons,
    cleanButtons: cleanButtons,
    PALETTE: PALETTE,
    ICON_CHOICES: ICON_CHOICES,
    MAX_BUTTONS: MAX_BUTTONS,
    MAX_LABEL: MAX_LABEL,
    viewer: viewer,
  };
});
