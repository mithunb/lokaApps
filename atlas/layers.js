/* LOKA Atlas — data-to-layer workbench.
   Parsing happens in the browser (Papa Parse for CSV/paste, SheetJS for Excel);
   the API only ever receives JSON. The inference card doubles as the manual
   fallback: every field Gemini pre-fills is an editable picker, so the flow
   still works when AI is unavailable. */
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

  var S = { dataset: "", columns: [], rows: [], result: null, options: null };

  /* ---------------- dataset field ---------------- */

  var qsDataset = new URLSearchParams(location.search).get("dataset");
  if (qsDataset) $("#f-dataset").value = qsDataset;

  /* ---------------- layers already added to this atlas ----------------
     Owner can remove any; a collaborator only the layers their org added. */

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

  function datasetReady() {
    S.dataset = $("#f-dataset").value.trim();
    if (!S.dataset) { msg("#msg-start", "Enter the atlas dataset id first (it's in the atlas URL after ?dataset=)."); return false; }
    return true;
  }

  /* ---------------- ingest ---------------- */

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
    var text = $("#f-paste").value.trim();
    if (!text) return;
    var parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    fromTable("pasted-table", parsed.meta.fields || [], parsed.data || []);
  };

  function handleFile(file) {
    if (!datasetReady()) return;
    msg("#msg-start", "");
    var name = file.name || "file";
    if (/\.(xlsx|xls)$/i.test(name)) {
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var wb = XLSX.read(new Uint8Array(rd.result), { type: "array" });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
          var cols = rows.length ? Object.keys(rows[0]) : [];
          fromTable(name, cols, rows);
        } catch (e) { msg("#msg-start", "Couldn't read that Excel file: " + esc(e.message)); }
      };
      rd.readAsArrayBuffer(file);
    } else if (/\.(json|geojson)$/i.test(name)) {
      readText(file, function (text) { fromJsonText(name, text); });
    } else if (/\.kml$/i.test(name)) {
      readText(file, function (text) { fromKml(name, text); });
    } else if (/\.gpx$/i.test(name)) {
      readText(file, function (text) { fromGpx(name, text); });
    } else {
      Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: function (out) { fromTable(name, out.meta.fields || [], out.data || []); },
        error: function (e) { msg("#msg-start", "Couldn't parse that file: " + esc(e.message)); },
      });
    }
  }

  function readText(file, cb) {
    var rd = new FileReader();
    rd.onload = function () { cb(String(rd.result)); };
    rd.readAsText(file);
  }

  // scalar-ise nested values so column profiling stays sane
  function flatVal(v) {
    if (v == null) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return v;
  }

  function rowsFromObjects(list) {
    var cols = [], seen = {};
    list.forEach(function (o) {
      Object.keys(o || {}).forEach(function (k) { if (!seen[k]) { seen[k] = 1; cols.push(k); } });
    });
    var rows = list.map(function (o) {
      var r = {};
      cols.forEach(function (k) { r[k] = flatVal(o ? o[k] : ""); });
      return r;
    });
    return { cols: cols, rows: rows };
  }

  // Tabular JSON (array of objects, or {data|rows|records:[…]}) — or GeoJSON.
  function fromJsonText(name, text) {
    var data;
    try { data = JSON.parse(text); }
    catch (e) { msg("#msg-start", "That file isn't valid JSON: " + esc(e.message)); return; }
    if (data && data.type === "FeatureCollection" && Array.isArray(data.features)) return fromGeojson(name, data);
    if (data && data.type === "Feature") return fromGeojson(name, { type: "FeatureCollection", features: [data] });
    var list = Array.isArray(data) ? data
      : (data && Array.isArray(data.data)) ? data.data
      : (data && Array.isArray(data.rows)) ? data.rows
      : (data && Array.isArray(data.records)) ? data.records
      : null;
    if (!list || !list.length || typeof list[0] !== "object") {
      msg("#msg-start", "Couldn't find a table in that JSON — expected an array of objects, or GeoJSON.");
      return;
    }
    var t = rowsFromObjects(list);
    fromTable(name, t.cols, t.rows);
  }

  // GeoJSON: point features become rows (properties + latitude/longitude).
  function fromGeojson(name, fc) {
    var pts = [], skipped = 0;
    (fc.features || []).forEach(function (f) {
      var g = f && f.geometry;
      var c = g && g.type === "Point" ? g.coordinates
        : (g && g.type === "MultiPoint" && g.coordinates.length) ? g.coordinates[0] : null;
      if (!c || c.length < 2) { skipped++; return; }
      var row = {};
      Object.keys((f && f.properties) || {}).forEach(function (k) { row[k] = flatVal(f.properties[k]); });
      row.longitude = c[0];
      row.latitude = c[1];
      pts.push(row);
    });
    if (!pts.length) {
      msg("#msg-start", "No point features found — polygon and line layers aren't supported yet. Export points, or a table joined by place names.");
      return;
    }
    if (skipped) msg("#msg-start", skipped + " non-point feature" + (skipped > 1 ? "s" : "") + " skipped — points carried through.", "ok");
    var t = rowsFromObjects(pts);
    fromTable(name, t.cols, t.rows);
  }

  // namespace-proof tag lookup (KML/GPX files vary in namespace usage)
  function xtags(el, name) {
    return Array.prototype.slice.call(el.getElementsByTagNameNS("*", name));
  }
  function xtext(el, name) {
    var n = xtags(el, name)[0];
    return n ? n.textContent.trim() : "";
  }

  // KML: Placemarks with a <Point> become rows; ExtendedData carried through.
  function fromKml(name, text) {
    var doc = new DOMParser().parseFromString(text, "text/xml");
    if (doc.getElementsByTagName("parsererror").length) { msg("#msg-start", "Couldn't read that KML file."); return; }
    var pts = [], skipped = 0;
    xtags(doc, "Placemark").forEach(function (pm) {
      var pt = xtags(pm, "Point")[0];
      var coords = pt ? xtext(pt, "coordinates") : "";
      var c = coords ? coords.split(",") : [];
      if (c.length < 2) { skipped++; return; }
      var row = { name: xtext(pm, "name"), description: xtext(pm, "description") };
      xtags(pm, "Data").forEach(function (d) {
        var k = d.getAttribute("name");
        if (k) row[k] = xtext(d, "value");
      });
      xtags(pm, "SimpleData").forEach(function (d) {
        var k = d.getAttribute("name");
        if (k) row[k] = d.textContent.trim();
      });
      row.longitude = parseFloat(c[0]);
      row.latitude = parseFloat(c[1]);
      pts.push(row);
    });
    if (!pts.length) { msg("#msg-start", "No point placemarks found in that KML — polygon and line layers aren't supported yet."); return; }
    if (skipped) msg("#msg-start", skipped + " non-point placemark" + (skipped > 1 ? "s" : "") + " skipped — points carried through.", "ok");
    var t = rowsFromObjects(pts);
    fromTable(name, t.cols, t.rows);
  }

  // GPX: waypoints become rows.
  function fromGpx(name, text) {
    var doc = new DOMParser().parseFromString(text, "text/xml");
    if (doc.getElementsByTagName("parsererror").length) { msg("#msg-start", "Couldn't read that GPX file."); return; }
    var pts = [];
    xtags(doc, "wpt").forEach(function (w) {
      var lat = parseFloat(w.getAttribute("lat")), lng = parseFloat(w.getAttribute("lon"));
      if (isNaN(lat) || isNaN(lng)) return;
      pts.push({
        name: xtext(w, "name"), description: xtext(w, "desc"),
        elevation: xtext(w, "ele"), latitude: lat, longitude: lng,
      });
    });
    if (!pts.length) { msg("#msg-start", "No waypoints found in that GPX file — tracks and routes aren't supported yet."); return; }
    var t = rowsFromObjects(pts);
    fromTable(name, t.cols, t.rows);
  }

  function fromTable(filename, columns, rows) {
    if (!datasetReady()) return;
    columns = columns.filter(Boolean).slice(0, 40);
    rows = rows.slice(0, 5000);
    if (!columns.length || !rows.length) { msg("#msg-start", "That table looks empty."); return; }
    S.columns = columns; S.rows = rows;
    msg("#msg-start", "Reading " + esc(filename) + " — " + rows.length + " rows, " + columns.length + " columns…", "ok");

    Promise.all([
      api("layers/options?dataset=" + encodeURIComponent(S.dataset)),
      api("layers/infer", { method: "POST", body: { dataset: S.dataset, filename: filename, columns: columns, rows: rows } }),
    ]).then(function (out) {
      S.options = out[0];
      onResult(out[1]);
      $("#bench").hidden = false;
      $("#chat-hint").textContent = S.options.geminiAvailable ? "" :
        "AI refine is off (no key configured) — the pickers above do everything manually.";
      $("#nav-atlas").href = "./?dataset=" + encodeURIComponent(S.dataset);
      msg("#msg-start", "", "ok");
      $("#bench").scrollIntoView({ behavior: "smooth" });
    }).catch(function (e) {
      msg("#msg-start", esc(errMsg(e)));
    });
  }

  /* ---------------- workbench ---------------- */

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

  function onResult(result) {
    S.result = result;
    var spec = result.spec || {};

    if (result.inference && (result.inference.rowSubject || result.inference.notes)) {
      $("#infer-note").hidden = false;
      $("#infer-note").innerHTML = "<b>" + esc(result.inference.rowSubject || "") + "</b>" +
        (result.inference.notes ? "<br>" + esc(result.inference.notes) : "");
    }

    var rep = result.matchReport || {};
    var bits = ["<b>" + (result.stats ? result.stats.features : 0) + "</b> features on the map"];
    if (rep.strategy === "adminJoin") {
      bits.push("joined to <b>" + esc(rep.joinLabel || rep.joinLayer || "boundaries") + "</b>");
      if (rep.ambiguous && rep.ambiguous.length) bits.push('<b style="color:var(--color-rust-deep)">' + rep.ambiguous.length + " need attention</b>");
      if (rep.unmatched && rep.unmatched.length) bits.push(rep.unmatched.length + " unmatched");
    }
    if (rep.outside) bits.push(rep.outside + " points fall outside the atlas area");
    if (rep.note) bits.push(esc(rep.note));
    $("#stat-line").innerHTML = bits.join(" · ");

    // pickers
    $("#s-label").value = spec.label || "";
    $("#s-kind").value = spec.kind || "markers";
    $("#s-strategy").value = result.strategy || "adminJoin";
    $("#s-group").value = ["base", "agri", "eco"].indexOf(spec.group) >= 0 ? spec.group : "agri";
    fillSelect("#s-join", (S.options.boundaries || []).map(function (b) { return { value: b.id, label: b.label + " (" + b.count + ")" }; }), result.joinLayer);
    fillSelect("#s-name", S.columns, role(result, "placeName"), true);
    fillSelect("#s-parent", S.columns, role(result, "adminParent"), true);
    fillSelect("#s-lat", S.columns, role(result, "latitude"), true);
    fillSelect("#s-lng", S.columns, role(result, "longitude"), true);
    fillSelect("#s-value", S.columns, spec.valueColumn || role(result, "value"), true);
    fillSelect("#s-palette", S.options.palettes || [], spec.palette || "greens");
    fillSelect("#s-marker", S.options.markerColors || [], spec.markerColor || "rust");
    syncVisibility();

    // fragment JSON
    $("#frag-json").textContent = JSON.stringify(result.fragment, null, 2);

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

    // preview
    $("#preview-frame").src = "./?dataset=" + encodeURIComponent(result.draftDataset);
  }

  function syncVisibility() {
    var strat = $("#s-strategy").value;
    var kind = $("#s-kind").value;
    $("#w-join").hidden = strat !== "adminJoin";
    $("#w-name").hidden = strat !== "adminJoin";
    $("#w-parent").hidden = strat !== "adminJoin";
    $("#w-lat").hidden = strat !== "coordinates";
    $("#w-lng").hidden = strat !== "coordinates";
    $("#w-value").hidden = kind !== "choropleth";
    $("#w-palette").hidden = kind !== "choropleth";
    $("#w-marker").hidden = kind !== "markers";
  }
  $("#s-strategy").onchange = syncVisibility;
  $("#s-kind").onchange = syncVisibility;

  $("#apply").onclick = function () {
    if (!S.result) return;
    var columns = S.columns.map(function (c) {
      var r = "text";
      if (c === $("#s-name").value) r = "placeName";
      else if (c === $("#s-parent").value) r = "adminParent";
      else if (c === $("#s-lat").value) r = "latitude";
      else if (c === $("#s-lng").value) r = "longitude";
      else if (c === $("#s-value").value) r = "value";
      return { name: c, role: r };
    });
    var spec = Object.assign({}, S.result.spec, {
      label: $("#s-label").value.trim() || "My data",
      kind: $("#s-kind").value,
      group: $("#s-group").value,
      valueColumn: $("#s-value").value || undefined,
      palette: $("#s-palette").value,
      markerColor: $("#s-marker").value,
      popupTitleColumn: $("#s-name").value || S.result.spec.popupTitleColumn,
    });
    api("layers/apply", { method: "POST", body: {
      importId: S.result.importId, spec: spec,
      strategy: $("#s-strategy").value, joinLayer: $("#s-join").value, columns: columns,
    } }).then(onResult).catch(function (e) { alert(errMsg(e)); });
  };

  function resolveFix(fixes) {
    api("layers/resolve", { method: "POST", body: { importId: S.result.importId, fixes: fixes } })
      .then(onResult).catch(function (e) { alert(errMsg(e)); });
  }

  /* ---------------- chat refine ---------------- */

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
      .then(function (r) { chatAdd("ai", r.reply || "Updated."); onResult(r); })
      .catch(function (e) { chatAdd("ai", "⚠ " + errMsg(e)); });
  }

  /* ---------------- commit (signed-in owner) ---------------- */

  function refreshAuth() {
    return api("auth/me").then(function (me) {
      $("#commit-auth").innerHTML = "Signed in as <b>" + esc(me.email) + "</b> — publishing adds the layer to this atlas.";
      $("#commit-signin").hidden = true;
      return me;
    }).catch(function () {
      $("#commit-auth").textContent = "Publishing needs the atlas's owner — sign in with your email.";
      $("#commit-signin").hidden = false;
      return null;
    });
  }
  refreshAuth();

  $("#auth-send").onclick = function () {
    var email = $("#f-auth-email").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg("#msg-commit", "Enter a valid email."); return; }
    api("auth/request-link", { method: "POST", body: { email: email } }).then(function (r) {
      msg("#msg-commit", r.sent
        ? "We emailed you a 6-digit code — type it above and sign in."
        : "This server can't send email yet — ask the LOKA team (mithun@socratus.org) for your code.", r.sent ? "ok" : "err");
      $("#commit-code-wrap").hidden = false;
      $("#auth-verify").hidden = false;
      $("#f-auth-code").value = "";
      $("#f-auth-code").focus();
    }).catch(function (e) { msg("#msg-commit", esc(errMsg(e))); });
  };

  $("#auth-verify").onclick = function () {
    var email = $("#f-auth-email").value.trim();
    var code = $("#f-auth-code").value.trim();
    if (!/^\d{6}$/.test(code)) { msg("#msg-commit", "Enter the 6-digit code from the email."); return; }
    api("auth/verify-code", { method: "POST", body: { email: email, code: code } })
      .then(function () {
        $("#commit-code-wrap").hidden = true;
        $("#auth-verify").hidden = true;
        return refreshAuth();
      })
      .then(function () { msg("#msg-commit", "Signed in ✓ — you can add the layer now.", "ok"); loadAddedLayers(); })
      .catch(function (e) { msg("#msg-commit", esc(errMsg(e))); });
  };

  $("#commit").onclick = function () {
    if (!S.result) return;
    api("layers/commit", { method: "POST", body: { importId: S.result.importId } })
      .then(function (r) {
        msg("#msg-commit", 'Layer added 🎉 — <a href="./?dataset=' + encodeURIComponent(r.dataset) + '" target="_blank">open the atlas</a>', "ok");
        $("#preview-frame").src = "./?dataset=" + encodeURIComponent(r.dataset);
        loadAddedLayers();
      })
      .catch(function (e) {
        if (e.needsAuth) {
          $("#commit-signin").hidden = false;
          msg("#msg-commit", "Sign in as this atlas's owner first — email field above.");
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
