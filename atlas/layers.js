/* LOKA Atlas — data-to-layer workbench.
   A four-step wizard: Upload → Check & fix → Place on map → Preview & add.
   Parsing and canonicalization happen in the browser (ingest.js); the typed
   table is shown and corrected in checktable.js; the API only ever receives
   the canonical JSON. AI pre-fills every choice but never gates one — each
   picker works by hand when Gemini is unavailable.

   Server round-trips: POST layers/ingest once per table (inference, no draft);
   layers/apply|resolve with draft:false while placing (report only) and
   draft:true from the preview step on (writes the draft the iframe shows). */
(function () {
  "use strict";

  var API = "./api/";
  var $ = function (s) { return document.querySelector(s); };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
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
  function msg(sel, text, cls) {
    $(sel).innerHTML = text ? '<div class="msg ' + (cls || "err") + '">' + text + "</div>" : "";
  }

  var S = {
    dataset: "", canonical: null, names: [], result: null, options: null,
    step: 1, me: null, styleReady: false,
  };

  /* ================= steps ================= */

  function goStep(n) {
    S.step = n;
    [1, 2, 3, 4].forEach(function (i) {
      $("#step-" + i).hidden = i !== n;
      var chip = document.querySelector('#stepper [data-step="' + i + '"]');
      chip.classList.toggle("now", i === n);
      chip.classList.toggle("done", i < n);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ================= step 1 · upload + sign-in ================= */

  var qsDataset = new URLSearchParams(location.search).get("dataset");
  if (qsDataset) $("#f-dataset").value = qsDataset;

  function datasetReady() {
    S.dataset = $("#f-dataset").value.trim();
    if (!S.dataset) { msg("#msg-start", "Enter the atlas dataset id first (it's in the atlas URL after ?dataset=)."); return false; }
    $("#nav-atlas").href = "./?dataset=" + encodeURIComponent(S.dataset);
    return true;
  }

  function refreshAuth() {
    return api("auth/me").then(function (me) {
      S.me = me;
      var who = me.org || me.name ? " (" + esc(me.org || me.name) + ")" : "";
      $("#auth-state").innerHTML = "Signed in as <b>" + esc(me.email) + "</b>" + who + ".";
      $("#signin-form").hidden = true;
      $("#commit-auth").innerHTML = "Signed in as <b>" + esc(me.email) + "</b> — adding publishes the layer to this atlas.";
      return me;
    }).catch(function () {
      S.me = null;
      $("#auth-state").textContent = "Adding data changes the atlas, so sign in first — the owner or an invited collaborator.";
      $("#signin-form").hidden = false;
      $("#commit-auth").textContent = "You'll need to be signed in as this atlas's owner or a collaborator.";
      return null;
    });
  }
  refreshAuth();

  $("#auth-send").onclick = function () {
    var email = $("#f-auth-email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg("#msg-auth", "Enter a valid email."); return; }
    api("auth/request-link", { method: "POST", body: { email: email } }).then(function (r) {
      msg("#msg-auth", r.sent
        ? "We emailed you a 6-digit code — type it and sign in."
        : "This server can't send email yet — ask the LOKA team (mithun@socratus.org) for your code.", r.sent ? "ok" : "err");
      $("#code-wrap").hidden = false;
      $("#auth-verify").hidden = false;
      $("#f-auth-code").value = "";
      $("#f-auth-code").focus();
    }).catch(function (e) { msg("#msg-auth", esc(errMsg(e))); });
  };
  $("#auth-verify").onclick = function () {
    var email = $("#f-auth-email").value.trim();
    var code = $("#f-auth-code").value.trim();
    if (!/^\d{6}$/.test(code)) { msg("#msg-auth", "Enter the 6-digit code from the email."); return; }
    api("auth/verify-code", { method: "POST", body: { email: email, code: code } })
      .then(function () { $("#code-wrap").hidden = true; $("#auth-verify").hidden = true; return refreshAuth(); })
      .then(function () { msg("#msg-auth", "Signed in ✓", "ok"); loadAddedLayers(); })
      .catch(function (e) { msg("#msg-auth", esc(errMsg(e))); });
  };

  /* ---- layers already added to this atlas ---- */

  function loadAddedLayers() {
    var ds = $("#f-dataset").value.trim();
    if (!ds) return;
    api("layers/list?dataset=" + encodeURIComponent(ds)).then(function (r) {
      var wrap = $("#added-layers"), list = $("#added-layers-list");
      list.innerHTML = "";
      if (!r.layers.length) { wrap.hidden = true; return; }
      wrap.hidden = false;
      r.layers.forEach(function (l) {
        var row = document.createElement("div");
        row.style.cssText = "display:flex; align-items:center; gap:.6rem; padding:.45rem 0; border-top:1px solid var(--color-divider); font-size:.9rem";
        var credit = l.addedBy ? (l.addedBy.org || l.addedBy.name || l.addedBy.email) : "";
        row.innerHTML = '<span style="flex:1 1 auto; min-width:0"><b>' + esc(l.label) + "</b>" +
          (credit ? ' <span class="hint">— added by ' + esc(credit) + "</span>" : "") + "</span>";
        if (l.canRemove) {
          var rm = document.createElement("button");
          rm.className = "btn secondary"; rm.textContent = "Remove";
          rm.onclick = function () {
            if (!confirm("Remove the layer “" + l.label + "” from this atlas?")) return;
            api("layers/remove", { method: "POST", body: { dataset: ds, layerId: l.id } })
              .then(loadAddedLayers)
              .catch(function (e) { msg("#msg-start", esc(errMsg(e))); });
          };
          row.appendChild(rm);
        }
        list.appendChild(row);
      });
    }).catch(function () { $("#added-layers").hidden = true; /* not signed in / no access */ });
  }
  loadAddedLayers();
  $("#f-dataset").addEventListener("change", loadAddedLayers);

  /* ---- file intake ---- */

  var drop = $("#drop");
  drop.onclick = function () { $("#f-file").click(); };
  drop.ondragover = function (e) { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = function () { drop.classList.remove("over"); };
  drop.ondrop = function (e) {
    e.preventDefault(); drop.classList.remove("over");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  };
  $("#f-file").onchange = function () { if (this.files[0]) handleFile(this.files[0]); };
  $("#paste-go").onclick = function () {
    if (!datasetReady()) return;
    var text = $("#f-paste").value.trim();
    if (!text) return;
    var out = LokaIngest.fromPaste(text);
    if (out.kind !== "table") { msg("#msg-start", esc(out.message || "Couldn't read that table.")); return; }
    startCheck(out.canonical);
  };

  function handleFile(file) {
    if (!datasetReady()) return;
    msg("#msg-start", "Reading " + esc(file.name || "file") + "…", "ok");
    LokaIngest.fromFile(file, function (err, out) {
      if (err) { msg("#msg-start", esc(err.message)); return; }
      if (out.kind === "unsupported") { msg("#msg-start", esc(out.message)); return; }
      msg("#msg-start", "");
      if (out.kind === "sheets") { showSheetPicker(out); return; }
      startCheck(out.canonical);
    });
  }

  /* ================= step 2 · check & fix ================= */

  function showSheetPicker(res) {
    goStep(2);
    $("#check-table").innerHTML = "";
    $("#to-place").disabled = true;
    var pickWrap = $("#sheet-pick");
    pickWrap.hidden = false;
    var list = $("#sheet-list");
    list.innerHTML = "";
    res.sheets.forEach(function (sh) {
      var b = document.createElement("button");
      b.type = "button";
      b.innerHTML = "<b>" + esc(sh.name) + '</b><span class="dim">' +
        sh.rows.toLocaleString() + " × " + sh.cols + "</span>";
      b.onclick = function () {
        res.pick(sh.name, function (err, out) {
          if (err) { msg("#msg-check", esc(err.message)); return; }
          if (out.kind !== "table") { msg("#msg-check", esc(out.message || "That sheet has no table.")); return; }
          pickWrap.hidden = true;
          startCheck(out.canonical);
        });
      };
      list.appendChild(b);
    });
  }

  function startCheck(canonical) {
    S.canonical = canonical;
    S.result = null;
    S.styleReady = false;
    $("#sheet-pick").hidden = true;
    $("#check-title").textContent = "Check your table" +
      (canonical.meta.sheet ? " — sheet “" + canonical.meta.sheet + "”" : "");
    LokaCheck.render($("#check-table"), canonical, { onChange: checkChanged });
    checkChanged(canonical);
    msg("#msg-check", "");
    goStep(2);
  }

  function activeColumns() {
    return (S.canonical ? S.canonical.schema : []).filter(function (c) { return !c.ignored; });
  }
  function checkChanged() {
    var ok = S.canonical && S.canonical.rows.length > 0 && activeColumns().length > 0;
    $("#to-place").disabled = !ok;
  }

  $("#back-1").onclick = function () { location.reload(); };

  $("#to-place").onclick = function () {
    if (!S.canonical) return;
    var cols = activeColumns();
    var names = cols.map(function (c) { return c.name; });
    var rows = S.canonical.rows.map(function (r) {
      var o = {};
      names.forEach(function (n) { o[n] = r[n]; });
      return o;
    });
    $("#to-place").disabled = true;
    msg("#msg-check", "Reading your table and matching it to the atlas…", "ok");
    Promise.all([
      api("layers/options?dataset=" + encodeURIComponent(S.dataset)),
      api("layers/ingest", { method: "POST", body: {
        dataset: S.dataset,
        filename: S.canonical.meta.sourceName,
        schema: cols.map(function (c) { return { name: c.name, type: c.type }; }),
        rows: rows,
        meta: S.canonical.meta,
      } }),
    ]).then(function (out) {
      S.options = out[0];
      S.names = names;
      msg("#msg-check", "");
      $("#to-place").disabled = false;
      enterPlace(out[1]);
    }).catch(function (e) {
      $("#to-place").disabled = false;
      if (e.needsAuth) msg("#msg-check", "Sign in first — it's on the previous step, under the drop zone.");
      else msg("#msg-check", esc(errMsg(e)));
    });
  };

  /* ================= step 3 · place on map ================= */

  function fillSelect(sel, items, value, withEmpty) {
    var el = $(sel);
    el.innerHTML = withEmpty ? '<option value="">—</option>' : "";
    items.forEach(function (it) {
      var o = document.createElement("option");
      o.value = typeof it === "string" ? it : it.value;
      o.textContent = typeof it === "string" ? it : it.label;
      el.appendChild(o);
    });
    if (value != null) el.value = value;
  }
  function role(result, r) {
    var c = (result.columns || []).find(function (x) { return x.role === r; });
    return c ? c.name : "";
  }

  function enterPlace(result) {
    S.result = result;

    if (result.inference && (result.inference.rowSubject || result.inference.notes)) {
      $("#infer-note").hidden = false;
      $("#infer-note").innerHTML = "<b>" + esc(result.inference.rowSubject || "") + "</b>" +
        (result.inference.notes ? "<br>" + esc(result.inference.notes) : "");
    } else {
      $("#infer-note").hidden = true;
    }

    $("#s-strategy").value = result.strategy || "adminJoin";
    fillSelect("#s-join", (S.options.boundaries || []).map(function (b) {
      return { value: b.id, label: b.label + " (" + b.count + (b.group === "base" ? ", boundary layer" : "") + ")" };
    }), result.joinLayer);
    fillSelect("#s-name", S.names, role(result, "placeName"), true);
    fillSelect("#s-parent", S.names, role(result, "adminParent"), true);
    fillSelect("#s-lat", S.names, role(result, "latitude"), true);
    fillSelect("#s-lng", S.names, role(result, "longitude"), true);
    syncPlaceVisibility();
    renderReport(result);
    goStep(3);
  }

  function syncPlaceVisibility() {
    var strat = $("#s-strategy").value;
    $("#w-join").hidden = strat !== "adminJoin";
    $("#w-name").hidden = strat !== "adminJoin";
    $("#w-parent").hidden = strat !== "adminJoin";
    $("#w-lat").hidden = strat !== "coordinates";
    $("#w-lng").hidden = strat !== "coordinates";
  }

  function outsideChoice() {
    var el = document.querySelector('input[name="outside"]:checked');
    return el ? el.value : "keep";
  }

  function renderReport(result) {
    var rep = result.matchReport || {};
    var bits = ["<b>" + (result.stats ? result.stats.features : 0) + "</b> features on the map"];
    if (rep.strategy === "adminJoin") {
      bits.push("joined to <b>" + esc(rep.joinLabel || rep.joinLayer || "boundaries") + "</b>");
      if (rep.ambiguous && rep.ambiguous.length) bits.push('<b style="color:var(--color-rust-deep)">' + rep.ambiguous.length + " need attention</b>");
      if (rep.unmatched && rep.unmatched.length) bits.push(rep.unmatched.length + " unmatched");
    }
    if (rep.note) bits.push(esc(rep.note));
    $("#stat-line").innerHTML = bits.join(" · ");

    // out-of-area choice
    if (rep.outside) {
      $("#w-outside").hidden = false;
      $("#outside-note").textContent = rep.outside + " point" + (rep.outside > 1 ? "s fall" : " falls") +
        " outside the atlas area.";
    } else {
      $("#w-outside").hidden = true;
    }

    // fix list
    var fixes = (rep.ambiguous || []).concat(rep.unmatched || []);
    $("#card-fixes").hidden = !fixes.length;
    $("#fix-count").textContent = fixes.length ? "· " + fixes.length : "";
    var list = $("#fix-list");
    list.innerHTML = "";
    fixes.slice(0, 60).forEach(function (f) {
      var row = document.createElement("div");
      row.className = "fix-row";
      var candOpts = (f.candidates || []).map(function (c) {
        return '<option value="' + esc(c.code) + '">' + esc(c.name) + (c.parent ? " (" + esc(c.parent) + ")" : "") +
          " · " + Math.round(c.score * 100) + "%</option>";
      }).join("");
      row.innerHTML = "<b title=\"" + esc(f.name) + "\">" + esc(f.name) + "</b>" +
        '<select><option value="">choose…</option>' + candOpts + "</select>" +
        '<button class="btn secondary" data-a="ok">Match</button>' +
        '<button class="btn secondary" data-a="skip">Skip</button>';
      var sel = row.querySelector("select");
      row.querySelector('[data-a="ok"]').onclick = function () {
        if (!sel.value) return;
        resolveFix([{ row: f.row, code: sel.value }]);
      };
      row.querySelector('[data-a="skip"]').onclick = function () { resolveFix([{ row: f.row, skip: true }]); };
      list.appendChild(row);
    });

    $("#frag-json").textContent = JSON.stringify(result.fragment, null, 2);
  }

  function buildColumns() {
    return S.names.map(function (c) {
      var r = "text";
      if (c === $("#s-name").value) r = "placeName";
      else if (c === $("#s-parent").value) r = "adminParent";
      else if (c === $("#s-lat").value) r = "latitude";
      else if (c === $("#s-lng").value) r = "longitude";
      else if (c === $("#s-value").value) r = "value";
      return { name: c, role: r };
    });
  }

  /* single-in-flight, debounced apply */
  var applyTimer = null, applyBusy = false, applyQueued = null;
  function scheduleApply(fn, delay) {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(function () { runApply(fn); }, delay == null ? 450 : delay);
  }
  function runApply(fn) {
    if (applyBusy) { applyQueued = fn; return; }
    applyBusy = true;
    fn().catch(function () {}).then(function () {
      applyBusy = false;
      if (applyQueued) { var g = applyQueued; applyQueued = null; runApply(g); }
    });
  }

  function applyPlace() {
    if (!S.result) return Promise.resolve();
    var spec = Object.assign({}, S.result.spec, { outsideAction: outsideChoice() });
    return api("layers/apply", { method: "POST", body: {
      importId: S.result.importId, draft: false, spec: spec,
      strategy: $("#s-strategy").value, joinLayer: $("#s-join").value, columns: buildColumns(),
    } }).then(function (r) { S.result = r; renderReport(r); msg("#msg-place", ""); })
      .catch(function (e) { msg("#msg-place", esc(errMsg(e))); });
  }

  ["#s-strategy", "#s-join", "#s-name", "#s-parent", "#s-lat", "#s-lng"].forEach(function (sel) {
    $(sel).addEventListener("change", function () {
      syncPlaceVisibility();
      scheduleApply(applyPlace, 100);
    });
  });
  document.querySelectorAll('input[name="outside"]').forEach(function (r) {
    r.addEventListener("change", function () { scheduleApply(applyPlace, 100); });
  });

  function resolveFix(fixes) {
    var draft = S.step === 4;   // report-only while placing; live draft once previewing
    runApply(function () {
      return api("layers/resolve", { method: "POST", body: { importId: S.result.importId, fixes: fixes, draft: draft } })
        .then(function (r) { S.result = r; renderReport(r); if (draft && r.draftDataset) refreshPreview(r.draftDataset); })
        .catch(function (e) { msg(S.step === 4 ? "#msg-commit" : "#msg-place", esc(errMsg(e))); });
    });
  }

  $("#back-2").onclick = function () { goStep(2); };

  $("#to-style").onclick = function () {
    if (!S.result) return;
    var rep = S.result.matchReport || {};
    var open = (rep.ambiguous || []).length + (rep.unmatched || []).length;
    if (!S.result.stats || !S.result.stats.features) {
      msg("#msg-place", "Nothing matched yet — pick the place-name column (or lat/lng) above."); return;
    }
    if (open && !confirm(open + " row" + (open > 1 ? "s are" : " is") + " still unmatched and will be left off the map. Continue anyway?")) return;
    $("#to-style").disabled = true;
    msg("#msg-place", "Building the preview…", "ok");
    runApply(function () {
      var spec = Object.assign({}, S.result.spec, { outsideAction: outsideChoice() });
      return api("layers/apply", { method: "POST", body: {
        importId: S.result.importId, draft: true, spec: spec,
        strategy: $("#s-strategy").value, joinLayer: $("#s-join").value, columns: buildColumns(),
      } }).then(function (r) {
        S.result = r;
        msg("#msg-place", "");
        $("#to-style").disabled = false;
        enterStyle(r);
      }).catch(function (e) { $("#to-style").disabled = false; msg("#msg-place", esc(errMsg(e))); });
    });
  };

  /* ================= step 4 · preview & add ================= */

  function refreshPreview(draftId) {
    var f = $("#preview-frame");
    if (f.dataset.draft !== draftId) {
      f.dataset.draft = draftId;
      f.src = "./?dataset=" + encodeURIComponent(draftId);
    } else {
      try { f.contentWindow.location.reload(); }
      catch (e) { f.src = "./?dataset=" + encodeURIComponent(draftId); }
    }
  }

  function enterStyle(result) {
    var spec = result.spec || {};
    if (!S.styleReady) {
      $("#s-label").value = spec.label || "";
      $("#s-kind").value = spec.kind || "markers";
      fillSelect("#s-value", S.names, spec.valueColumn || role(result, "value"), true);
      fillSelect("#s-palette", S.options.palettes || [], spec.palette || "greens");
      fillSelect("#s-marker", S.options.markerColors || [], spec.markerColor || "rust");
      $("#s-group").value = ["base", "agri", "eco"].indexOf(spec.group) >= 0 ? spec.group : "agri";
      fillSelect("#s-poptitle", S.names, spec.popupTitleColumn || role(result, "placeName"), true);
      $("#chat-hint").textContent = S.options.geminiAvailable ? "" :
        "AI refine is off (no key configured) — the pickers above do everything manually.";
      S.styleReady = true;
    }
    syncStyleVisibility();
    renderReport(result);
    if (result.draftDataset) refreshPreview(result.draftDataset);
    $("#style-state").textContent = "";
    goStep(4);
  }

  function syncStyleVisibility() {
    var kind = $("#s-kind").value;
    $("#w-value").hidden = kind !== "choropleth";
    $("#w-palette").hidden = kind !== "choropleth";
    $("#w-marker").hidden = kind !== "markers";
  }

  function applyStyle() {
    if (!S.result) return Promise.resolve();
    var spec = Object.assign({}, S.result.spec, {
      label: $("#s-label").value.trim() || "My data",
      kind: $("#s-kind").value,
      group: $("#s-group").value,
      valueColumn: $("#s-value").value || undefined,
      palette: $("#s-palette").value,
      markerColor: $("#s-marker").value,
      popupTitleColumn: $("#s-poptitle").value || undefined,
      outsideAction: outsideChoice(),
    });
    $("#style-state").textContent = "Updating the preview…";
    return api("layers/apply", { method: "POST", body: {
      importId: S.result.importId, draft: true, spec: spec,
      strategy: $("#s-strategy").value, joinLayer: $("#s-join").value, columns: buildColumns(),
    } }).then(function (r) {
      S.result = r;
      $("#frag-json").textContent = JSON.stringify(r.fragment, null, 2);
      $("#style-state").textContent = "";
      if (r.draftDataset) refreshPreview(r.draftDataset);
    }).catch(function (e) {
      $("#style-state").textContent = "";
      msg("#msg-commit", esc(errMsg(e)));
    });
  }

  ["#s-label", "#s-kind", "#s-value", "#s-palette", "#s-marker", "#s-group", "#s-poptitle"].forEach(function (sel) {
    $(sel).addEventListener("change", function () {
      syncStyleVisibility();
      scheduleApply(applyStyle);
    });
  });
  $("#s-label").addEventListener("input", function () { scheduleApply(applyStyle, 700); });

  $("#back-3").onclick = function () { goStep(3); };

  /* ---- chat refine ---- */

  function chatAdd(cls, text) {
    var d = document.createElement("div");
    d.className = cls;
    d.textContent = text;
    $("#chat-log").appendChild(d);
    $("#chat-log").scrollTop = 1e6;
  }
  $("#chat-send").onclick = sendChat;
  $("#chat-input").addEventListener("keydown", function (e) { if (e.key === "Enter") sendChat(); });
  function sendChat() {
    var m = $("#chat-input").value.trim();
    if (!m || !S.result) return;
    $("#chat-input").value = "";
    chatAdd("me", m);
    api("layers/refine", { method: "POST", body: { importId: S.result.importId, message: m } })
      .then(function (r) {
        chatAdd("ai", r.reply || "Updated.");
        S.result = r;
        S.styleReady = false;           // AI may have changed style fields — re-fill pickers
        enterStyle(r);
      })
      .catch(function (e) { chatAdd("ai", "⚠ " + errMsg(e)); });
  }

  /* ---- commit ---- */

  $("#commit").onclick = function () {
    if (!S.result) return;
    api("layers/commit", { method: "POST", body: { importId: S.result.importId } })
      .then(function (r) {
        msg("#msg-commit", 'Layer added 🎉 — <a href="./?dataset=' + encodeURIComponent(r.dataset) + '" target="_blank">open the atlas</a>', "ok");
        loadAddedLayers();
      })
      .catch(function (e) {
        if (e.needsAuth) {
          msg("#msg-commit", "Sign in first — it's on the Upload step, under the drop zone.");
          return;
        }
        msg("#msg-commit", esc(errMsg(e)));
      });
  };
  $("#discard").onclick = function () {
    if (!S.result) return;
    api("layers/discard", { method: "POST", body: { importId: S.result.importId } }).then(function () {
      location.reload();
    });
  };
})();
