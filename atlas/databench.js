/* LOKA Atlas — the data-to-layer wizard, as a mountable module.
   Check & fix → Place on map → Preview & add. Two hosts mount the same code:

     layers.html         mode "standalone" — also renders the upload step, the
                         dataset picker, sign-in and the manage list
     setup/ (wizard)     mode "embedded"   — the atlas, the identity and the
                         file are already known, so it starts at Check & fix

   Everything the wizard touches is looked up under its mount root, so a host
   page can put it anywhere without id collisions. Parsing stays in ingest.js,
   the typed table in checktable.js; the API only ever sees canonical JSON. */
(function () {
  "use strict";

  var STEP1_HTML = `    <section class="panel step" id="step-1">
      <label class="f" style="max-width:24rem">Which atlas?
        <input type="text" id="f-dataset" placeholder="dataset id, e.g. deoria-bioregion" />
        <span class="hint" id="dataset-hint"></span>
      </label>
      <div class="drop" id="drop">
        <svg class="drop-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/></svg>
        <b>Drop a CSV, Excel, JSON, GeoJSON, KML or GPX file here</b>
        <span>or click to choose — up to 5,000 rows / points, 25 MB</span>
        <input type="file" id="f-file" accept=".csv,.tsv,.xlsx,.xls,.json,.geojson,.kml,.gpx" />
      </div>
      <details class="paste">
        <summary>…or paste a table (from Excel / Sheets)</summary>
        <textarea id="f-paste" rows="6" placeholder="Paste rows here — the first line should be the column headers"></textarea>
        <div style="margin-top:.5rem"><button class="btn secondary" id="paste-go">Use pasted table</button></div>
      </details>
      <div id="msg-start"></div>

      <!-- Adding data changes the atlas, so sign-in comes first. When you ARE
           signed in this whole block disappears — your identity shows in the
           header, not as a stray sentence in the middle of the upload step. -->
      <div class="signin" id="signin-card" hidden>
        <p class="hint" id="auth-state" style="margin:0 0 .6rem">Checking who you are…</p>
        <div id="signin-form" hidden>
          <div class="signin-row">
            <label class="f"><span>Your email <span class="hint">(the atlas's owner, or an invited collaborator)</span></span>
              <input type="email" id="f-auth-email" placeholder="you@example.org" autocomplete="email" />
            </label>
            <label class="f code" id="code-wrap" hidden><span>6-digit code</span>
              <input type="text" id="f-auth-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6"
                     placeholder="123456" style="letter-spacing:.3em; font-variant-numeric:tabular-nums" />
            </label>
            <button class="btn secondary" id="auth-send">Email me a code</button>
            <button class="btn secondary" id="auth-verify" hidden>Sign in</button>
          </div>
          <div id="msg-auth"></div>
        </div>
      </div>

      <!-- layers already contributed to this atlas (owner removes any; a
           collaborator only their own) -->
      <div id="added-layers" hidden>
        <h2 style="font-size:1rem; margin:1.4rem 0 .2rem">Layers added to this atlas</h2>
        <div id="added-layers-list"></div>
      </div>
    </section>`;

  var STEPS234_HTML = `    <section class="panel step" id="step-2" hidden>
      <h2 id="check-title">Check your table</h2>
      <p class="hint" style="max-width:46rem">Here's every field we found, with its detected type and the role it'll play on
        the map. Untick anything you don't want, or hit <b>✎</b> to rename or re-type a field. Switch to
        <b>Preview rows</b> to see a sample of the data and fix values by hand.</p>
      <div id="sheet-pick" hidden>
        <p id="sheet-pick-title">That workbook has several sheets — which one holds the table?</p>
        <div class="sheet-list" id="sheet-list"></div>
      </div>
      <!-- spatial uploads: what the geometry cleaning found -->
      <div id="geom-summary" class="infer-note" hidden></div>
      <!-- text descriptions with no categories: derive category + labels -->
      <div id="enrich-panel" class="enrich-panel" hidden>
        <div class="enrich-head">
          <b>Add categories &amp; tags from a description</b>
          <span class="hint">No category column? Turn a free-text description into a colour-able category and fine tags — they land as new fields you review and edit before anything hits the map.</span>
        </div>
        <div class="enrich-row">
          <label class="f" style="margin:0">Describe from<select id="s-desccol"></select></label>
          <button class="btn secondary" id="enrich-go">✨ Generate</button>
        </div>
        <div id="msg-enrich"></div>
      </div>
      <div id="check-table"></div>
      <div class="step-nav">
        <button class="btn secondary" id="back-1">← Start over</button>
        <button class="btn" id="to-place">Looks right — place it on the map</button>
      </div>
      <div id="msg-check"></div>
    </section>

    <!-- ============ STEP 3 · PLACE ON MAP ============ -->
    <section class="panel step" id="step-3" hidden>
      <h2>Where are these located?</h2>
      <div class="infer-note" id="infer-note" hidden></div>

      <!-- the auto-detected placement, in plain language, with a way to change it -->
      <div class="place-summary" id="place-summary">
        <span class="ps-ico" aria-hidden="true" id="ps-ico">📍</span>
        <span class="ps-text" id="ps-line"></span>
        <button class="btn secondary ps-change" id="ps-change" type="button">Change</button>
      </div>

      <!-- hidden strategy state the segmented control drives (keeps apply logic simple) -->
      <select id="s-strategy" hidden>
        <option value="adminJoin">Match place names to boundaries</option>
        <option value="coordinates">Latitude / longitude columns</option>
      </select>

      <div class="place-details" id="place-details" hidden>
        <div class="pd-seg" id="pd-seg" role="radiogroup" aria-label="How to place the rows">
          <button type="button" class="pd-opt" data-strat="adminJoin">By place name</button>
          <button type="button" class="pd-opt" data-strat="coordinates">By latitude &amp; longitude</button>
        </div>
        <div class="pd-fields" id="pd-name-fields">
          <label class="f">Place-name column<select id="s-name"></select></label>
          <label class="f">Match against<select id="s-join"></select></label>
          <label class="f">Parent column <span class="hint">(optional — district / state, tells apart same-named places)</span><select id="s-parent"></select></label>
        </div>
        <div class="pd-fields" id="pd-coord-fields" hidden>
          <label class="f">Latitude column<select id="s-lat"></select></label>
          <label class="f">Longitude column<select id="s-lng"></select></label>
        </div>
      </div>

      <p class="stat" id="stat-line"></p>
      <div id="w-outside" hidden style="margin:.4rem 0 .8rem">
        <span class="hint" id="outside-note"></span>
        <div class="radio-row">
          <label><input type="radio" name="outside" value="keep" checked /> keep them on the map</label>
          <label><input type="radio" name="outside" value="drop" /> leave them out</label>
        </div>
      </div>

      <div id="card-fixes" hidden style="border-top:1px solid var(--color-divider); margin-top:.6rem; padding-top:.8rem">
        <h2 style="font-size:.95rem">Needs your eye <span class="hint" id="fix-count"></span></h2>
        <p class="hint">Rows we couldn't confidently match. Pick the right boundary or skip the row.</p>
        <div id="fix-list"></div>
      </div>

      <div class="step-nav">
        <button class="btn secondary" id="back-2">← Back to the table</button>
        <button class="btn" id="to-style">Continue — preview the layer</button>
      </div>
      <div id="msg-place"></div>
    </section>

    <!-- ============ STEP 4 · PREVIEW & ADD ============ -->
    <section class="bench step" id="step-4" hidden>
      <div class="bench-left">
        <div class="card">
          <h2>Style the layer</h2>
          <div class="grid2">
            <label class="f">Layer name<input type="text" id="s-label" maxlength="60" /></label>
            <label class="f">Layer kind
              <select id="s-kind"><option value="markers">Points / markers</option><option value="choropleth">Choropleth (colour by value)</option></select>
            </label>
            <label class="f" id="w-value">Value column<select id="s-value"></select></label>
            <label class="f" id="w-catcol" hidden>Colour by<select id="s-catcol"></select></label>
            <label class="f" id="w-palette">Colour ramp<select id="s-palette"></select></label>
            <label class="f" id="w-marker">Marker colour<select id="s-marker"></select></label>
            <label class="f" id="w-linecolor" hidden>Line colour<select id="s-linecolor"></select></label>
            <label class="f" id="w-linewidth" hidden>Line width
              <select id="s-linewidth"><option value="1">Thin</option><option value="2" selected>Regular</option><option value="3.5">Bold</option><option value="5">Heavy</option></select>
            </label>
            <label class="f" id="w-linedash" hidden style="flex-direction:row; align-items:center; gap:.5rem"><input type="checkbox" id="s-linedash" style="width:auto" /> Dashed line</label>
            <label class="f" id="w-fillcolor" hidden>Fill colour<select id="s-fillcolor"></select></label>
            <label class="f" id="w-fillopacity" hidden>Fill opacity
              <select id="s-fillopacity"><option value="0.25">Light</option><option value="0.45" selected>Medium</option><option value="0.7">Strong</option></select>
            </label>
            <label class="f">Group
              <select id="s-group"><option value="userdata">Your data</option><option value="agri">Crops &amp; value chain</option><option value="base">Base</option><option value="eco">Ecological landscape</option></select>
            </label>
            <label class="f">Popup title<select id="s-poptitle"></select></label>
            <label class="f"><span>Photo column <span class="hint">(image URLs, optional)</span></span><select id="s-image"></select></label>
          </div>
          <p class="hint" id="style-state" style="margin:.4rem 0 0"></p>
          <details class="frag"><summary>Layer definition (JSON)</summary><pre id="frag-json"></pre></details>
        </div>

        <div class="card" id="card-chat">
          <h2>Refine in plain language</h2>
          <div class="chat-log" id="chat-log"></div>
          <div class="chat-row">
            <input type="text" id="chat-input" placeholder='e.g. "red-to-green choropleth of literacy rate"' />
            <button class="btn" id="chat-send">Send</button>
          </div>
          <p class="hint" id="chat-hint" style="margin:.5rem 0 0"></p>
        </div>

        <div class="card">
          <h2>Add to the atlas</h2>
          <p class="hint" id="commit-auth"></p>
          <div style="display:flex; gap:.6rem; flex-wrap:wrap">
            <button class="btn" id="commit">Add layer to atlas</button>
            <button class="btn secondary" id="discard">Discard</button>
          </div>
          <div id="msg-commit"></div>
        </div>

        <div class="step-nav">
          <button class="btn secondary" id="back-3">← Back to placement</button>
        </div>
      </div>

      <iframe id="preview-frame" title="Layer preview"></iframe>
    </section>`;

  /* mount(root, opts) -> { start(canonical), step(), destroy() }
       opts.mode        "standalone" | "embedded"   (default standalone)
       opts.dataset     atlas slug (embedded: required)
       opts.editToken   authorises before the atlas is bound to an account
       opts.onStep      (n, spatial) — host renders its own stepper chrome
       opts.onCommitted ({layerId, dataset}) — after a layer lands
       opts.onBack      leaving the first wizard step (embedded hosts)   */
  function mount(root, opts) {
    opts = opts || {};
    var MODE = opts.mode === "embedded" ? "embedded" : "standalone";
    root.innerHTML = (MODE === "standalone" ? STEP1_HTML : "") + STEPS234_HTML;
    var $ = function (s) { return root.querySelector(s); };
    var HOST = {
      onStep: typeof opts.onStep === "function" ? opts.onStep : function () {},
      onCommitted: typeof opts.onCommitted === "function" ? opts.onCommitted : function () {},
      onBack: typeof opts.onBack === "function" ? opts.onBack : null,
      // called when check+place are settled and styling is all that's left
      onReady: typeof opts.onReady === "function" ? opts.onReady : null,
    };
    // "checkPlace" stops after placement; "all" runs through style and commit
    var STAGES = opts.stages === "checkPlace" ? "checkPlace" : "all";


    // the host page knows its own depth to the API mount
    var API = opts.api || "./api/";
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    // Arriving from the setup wizard we carry its edit token, so the atlas's
    // creator can set up their data even before the atlas is bound to an account.
    if (S.editToken && !opts.headers.Authorization) opts.headers.Authorization = "Bearer " + S.editToken;
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
    step: 1, me: null, styleReady: false, spatial: false,
    editToken: null,
  };
  var CLASS_LABEL = { point: "points", line: "lines", polygon: "areas (polygons)" };

  /* ================= steps ================= */

  function goStep(n) {
    S.step = n;
    [1, 2, 3, 4].forEach(function (i) {
      var panel = $("#step-" + i);
      if (panel) panel.hidden = i !== n;
    });
    HOST.onStep(n, S.spatial);           // the host owns its stepper chrome
    if (MODE === "standalone") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ================= step 1 · upload + sign-in ================= */

  var qsDataset = MODE === "standalone" ? new URLSearchParams(location.search).get("dataset") : (opts.dataset || "");
  if (qsDataset && $("#f-dataset")) $("#f-dataset").value = qsDataset;
  S.dataset = opts.dataset || qsDataset || "";
  if (opts.editToken) S.editToken = opts.editToken;

  function datasetReady() {
    var f = $("#f-dataset");
    S.dataset = f ? f.value.trim() : (opts.dataset || "");
    if (!S.dataset) { msg("#msg-start", "Enter the atlas dataset id first (it's in the atlas URL after ?dataset=)."); return false; }
    var navAtlas = document.getElementById("nav-atlas");
    if (navAtlas) navAtlas.href = "./?dataset=" + encodeURIComponent(S.dataset);
    return true;
  }

  function refreshAuth() {
    var nav = document.getElementById("nav-user");
    return api("auth/me").then(function (me) {
      S.me = me;
      var who = me.org || me.name ? " (" + esc(me.org || me.name) + ")" : "";
      // identity belongs in the header; the sign-in card steps out of the way
      if (nav) { nav.innerHTML = esc(me.email) + who; nav.hidden = false; }
      $("#signin-card").hidden = true;
      $("#signin-form").hidden = true;
      $("#commit-auth").innerHTML = "Signed in as <b>" + esc(me.email) + "</b> — adding publishes the layer to this atlas.";
      return me;
    }).catch(function () {
      S.me = null;
      if (nav) { nav.hidden = true; nav.textContent = ""; }
      $("#signin-card").hidden = false;
      $("#auth-state").textContent = "Adding data changes the atlas, so sign in first — the owner or an invited collaborator.";
      $("#signin-form").hidden = false;
      $("#commit-auth").textContent = "You'll need to be signed in as this atlas's owner or a collaborator.";
      return null;
    });
  }
  if (MODE === "standalone") refreshAuth();

  if ($("#auth-send")) $("#auth-send").onclick = function () {
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
  if ($("#auth-verify")) $("#auth-verify").onclick = function () {
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
    if (!$("#added-layers")) return;          // embedded hosts show their own list
    var ds = ($("#f-dataset") ? $("#f-dataset").value.trim() : S.dataset);
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
  if (MODE === "standalone") {
    loadAddedLayers();
    $("#f-dataset").addEventListener("change", loadAddedLayers);
  }

  /* ---- file intake ---- */

  var drop = $("#drop");
  if (drop) {
    drop.onclick = function () { $("#f-file").click(); };
    drop.ondragover = function (e) { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = function () { drop.classList.remove("over"); };
    drop.ondrop = function (e) {
      e.preventDefault(); drop.classList.remove("over");
      if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    };
    $("#f-file").onchange = function () { if (this.files[0]) handleFile(this.files[0]); };
  }
  if ($("#paste-go")) $("#paste-go").onclick = function () {
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
      if (out.kind === "sheets") {
        showPicker("That workbook has several sheets — which one holds the table?",
          out.sheets.map(function (sh) {
            return { label: sh.name, dim: sh.rows.toLocaleString() + " × " + sh.cols,
                     pick: function (cb) { out.pick(sh.name, cb); } };
          }));
        return;
      }
      if (out.kind === "classes") {
        showPicker("That file mixes geometry types — one layer shows one type. Which should this layer show?",
          out.classes.map(function (c) {
            return { label: c.label, dim: c.count.toLocaleString() + " features",
                     pick: function (cb) { out.pick(c.cls, cb); } };
          }));
        return;
      }
      startCheck(out.canonical);
    });
  }

  /* ================= step 2 · check & fix / geometry check ================= */

  function showPicker(title, entries) {
    goStep(2);
    $("#check-table").innerHTML = "";
    $("#geom-summary").hidden = true;
    $("#to-place").disabled = true;
    var pickWrap = $("#sheet-pick");
    pickWrap.hidden = false;
    $("#sheet-pick-title").textContent = title;
    var list = $("#sheet-list");
    list.innerHTML = "";
    entries.forEach(function (en) {
      var b = document.createElement("button");
      b.type = "button";
      b.innerHTML = "<b>" + esc(en.label) + '</b><span class="dim">' + esc(en.dim) + "</span>";
      b.onclick = function () {
        en.pick(function (err, out) {
          if (err) { msg("#msg-check", esc(err.message)); return; }
          if (out.kind !== "table") { msg("#msg-check", esc(out.message || "Nothing usable there.")); return; }
          pickWrap.hidden = true;
          startCheck(out.canonical);
        });
      };
      list.appendChild(b);
    });
  }

  function setTrack(spatial) {
    S.spatial = spatial;
    HOST.onStep(S.step, spatial);   // spatial uploads skip the matching step
  }

  function startCheck(canonical) {
    S.canonical = canonical;
    S.result = null;
    S.styleReady = false;
    $("#sheet-pick").hidden = true;
    var g = canonical.geoms && canonical.meta.geometry;
    setTrack(!!g);
    var gs = $("#geom-summary");
    if (g) {
      gs.hidden = false;
      gs.innerHTML = "<b>" + g.count.toLocaleString() + " " + esc(CLASS_LABEL[g.class] || g.class) + "</b>" +
        (g.vertices ? " · " + g.vertices.toLocaleString() + " points after cleaning" : "") +
        "<br>Shapes carry their own location — after this check they go straight to the map preview.";
      $("#check-title").textContent = "Check the shape details";
      $("#to-place").textContent = "Looks right — preview the layer";
    } else {
      gs.hidden = true;
      $("#check-title").textContent = "Choose the fields for your map" +
        (canonical.meta.sheet ? " — sheet “" + canonical.meta.sheet + "”" : "");
      $("#to-place").textContent = "Looks right — place it on the map";
    }
    LokaCheck.render($("#check-table"), canonical, { onChange: checkChanged });
    setupEnrich(canonical);
    checkChanged(canonical);
    msg("#msg-check", "");
    goStep(2);
  }

  /* ---- generate category + labels from a free-text description ----
     Offered when a longish text column is present. The generated columns are
     added to the canonical table (editable), then flow through the normal
     pickers — 'category' auto-colours, 'labels' becomes popup chips. */
  function avgLen(col) {
    var v = S.canonical.rows.map(function (r) { return String(r[col] == null ? "" : r[col]); }).filter(Boolean);
    return v.length ? v.reduce(function (a, s) { return a + s.length; }, 0) / v.length : 0;
  }
  function looksDelimited(col) {
    var n = 0, t = 0;
    S.canonical.rows.forEach(function (r) { var s = String(r[col] == null ? "" : r[col]); if (s) { t++; if (s.indexOf(";") >= 0) n++; } });
    return t && n / t >= 0.4;
  }
  // prose has spaces (multi-word); ids/URLs don't — cleanly excludes tag_id / image_urls
  function looksProse(col) {
    var n = 0, t = 0;
    S.canonical.rows.forEach(function (r) { var s = String(r[col] == null ? "" : r[col]).trim(); if (s) { t++; if (/\s/.test(s)) n++; } });
    return t && n / t >= 0.6;
  }
  function setupEnrich(canonical) {
    var panel = $("#enrich-panel");
    // candidate description columns = free-text prose (has spaces, avg length ≥ 20), not delimited tag lists
    var textCols = canonical.schema.filter(function (c) {
      return c.type === "string" && !c.ignored && !looksDelimited(c.name) && looksProse(c.name) && avgLen(c.name) >= 20;
    }).sort(function (a, b) { return avgLen(b.name) - avgLen(a.name); });
    if (!textCols.length) { panel.hidden = true; return; }
    panel.hidden = false;
    fillSelect("#s-desccol", textCols.map(function (c) { return c.name; }), textCols[0].name);
    msg("#msg-enrich", "");
  }

  $("#enrich-go").onclick = function () {
    if (!S.canonical) return;
    var descCol = $("#s-desccol").value;
    if (!descCol) return;
    // pass any existing ';'-delimited column as labels, so we gap-fill not overwrite
    var labelsCol = (S.canonical.schema.find(function (c) {
      return c.name !== descCol && !c.ignored && c.type === "string" && looksDelimited(c.name) && avgLen(c.name) <= 80;
    }) || {}).name || "";
    var rows = S.canonical.rows.map(function (r) {
      var o = {}; o[descCol] = r[descCol]; if (labelsCol) o[labelsCol] = r[labelsCol]; return o;
    });
    var btn = $("#enrich-go"), label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spin" aria-hidden="true"></span>Generating…';
    function done() { btn.disabled = false; btn.innerHTML = label; }
    msg("#msg-enrich", "Reading the descriptions…", "ok");
    api("layers/enrich", { method: "POST", body: {
      dataset: S.dataset, descriptionColumn: descCol, labelsColumn: labelsCol || undefined, rows: rows,
    } }).then(function (r) {
      done();
      applyEnrichment(r, labelsCol);
    }).catch(function (e) {
      done();
      msg("#msg-enrich", esc(errMsg(e)));
    });
  };

  function applyEnrichment(r, labelsCol) {
    var per = r.rows || [];
    var addCat = r.categorySet && r.categorySet.length;
    // add / update the columns on the canonical table
    if (addCat) ensureColumn("category", "string");
    var labelTarget = labelsCol || ensureColumn("labels", "string").name;
    S.canonical.rows.forEach(function (row, i) {
      var e = per[i] || {};
      if (addCat) row.category = e.category || "";
      if (e.labels && e.labels.length) row[labelTarget] = e.labels.join("; ");
    });
    // re-type so 'category' reads categorical and 'labels' reads as a tag set
    var names = S.canonical.schema.map(function (c) { return c.name; });
    var forced = {}; S.canonical.schema.forEach(function (c) { if (c.forced) forced[c.name] = c.forced; });
    var typed = LokaIngest.retype(names, S.canonical.rows, forced);
    typed.schema.forEach(function (c) {
      var prev = S.canonical.schema.find(function (p) { return p.name === c.name; });
      if (prev) { c.ignored = prev.ignored; c.forced = prev.forced; }
    });
    S.canonical.schema = typed.schema; S.canonical.rows = typed.rows;
    LokaCheck.render($("#check-table"), S.canonical, { onChange: checkChanged });
    setupEnrich(S.canonical);
    var bits = [];
    if (addCat) bits.push(r.categorySet.length + " categories");
    bits.push((r.generated ? r.generated.labelledRows : 0) + " rows labelled");
    msg("#msg-enrich", "Added " + bits.join(" + ") + (r.aiUsed ? "" : " (basic keywords — AI was unavailable, edit as needed)") +
      ". Review and edit the new columns below.", "ok");
    checkChanged();
  }

  // add a column to the canonical (unique name), return its schema entry
  function ensureColumn(base, type) {
    var name = base, n = 2;
    while (S.canonical.schema.some(function (c) { return c.name === name; })) name = base + "_" + n++;
    var entry = { name: name, type: type, issues: [] };
    S.canonical.schema.push(entry);
    return entry;
  }

  function activeColumns() {
    return (S.canonical ? S.canonical.schema : []).filter(function (c) { return !c.ignored; });
  }
  function checkChanged() {
    var ok = S.canonical && S.canonical.rows.length > 0 &&
      (activeColumns().length > 0 || S.spatial);   // geometry-only layers need no columns
    $("#to-place").disabled = !ok;
  }

  if ($("#back-1")) {
    $("#back-1").onclick = function () {
      if (HOST.onBack) HOST.onBack(); else location.reload();
    };
  }

  $("#to-place").onclick = function () {
    if (!S.canonical) return;
    var cols = activeColumns();
    var names = cols.map(function (c) { return c.name; });
    var rows = S.canonical.rows.map(function (r) {
      var o = {};
      names.forEach(function (n) { o[n] = r[n]; });
      return o;
    });
    var body = {
      dataset: S.dataset,
      region: (!S.dataset && opts.region) ? opts.region : undefined,
      filename: S.canonical.meta.sourceName,
      schema: cols.map(function (c) { return { name: c.name, type: c.type }; }),
      rows: rows,
      meta: S.canonical.meta,
    };
    if (S.spatial) { body.geoms = S.canonical.geoms; body.geomIdx = S.canonical.geomIdx; }
    $("#to-place").disabled = true;
    msg("#msg-check", S.spatial ? "Placing your shapes on the map…" : "Reading your table and matching it to the atlas…", "ok");
    Promise.all([
      api("layers/options?dataset=" + encodeURIComponent(S.dataset)),
      api("layers/ingest", { method: "POST", body: body }),
    ]).then(function (out) {
      S.options = out[0];
      S.names = names;
      if (S.spatial) {
        // shapes place themselves — build the draft and go straight to the preview
        S.result = out[1];
        runApply(function () {
          return api("layers/apply", { method: "POST", body: applyBody(true, S.result.spec) })
            .then(function (r) {
              S.result = r;
              msg("#msg-check", "");
              $("#to-place").disabled = false;
              if (STAGES === "checkPlace") { readyCheck(); return; }
              enterStyle(r);
            })
            .catch(function (e) { $("#to-place").disabled = false; msg("#msg-check", esc(errMsg(e))); });
        });
        return;
      }
      msg("#msg-check", "");
      $("#to-place").disabled = false;
      enterPlace(out[1]);
      if (STAGES === "checkPlace") readyCheck();
    }).catch(function (e) {
      $("#to-place").disabled = false;
      if (e.needsAuth) msg("#msg-check", "Sign in first — it's on the previous step, under the drop zone.");
      else msg("#msg-check", esc(errMsg(e)));
    });
  };

  // What the host needs to render a per-file verdict, and to know whether the
  // user still has to look at something.
  function readySummary() {
    var rep = (S.result && S.result.matchReport) || {};
    var open = (rep.ambiguous || []).length + (rep.unmatched || []).length;
    return {
      importId: S.result && S.result.importId,
      filename: (S.canonical && S.canonical.meta && S.canonical.meta.sourceName) || "",
      features: (S.result && S.result.stats && S.result.stats.features) || 0,
      rows: (S.canonical && S.canonical.rows.length) || 0,
      fields: activeColumns().length,
      spatial: S.spatial,
      strategy: S.result && S.result.strategy,
      joinLabel: rep.joinLabel || "",
      needsAttention: open,
      kind: (S.result && S.result.spec && S.result.spec.kind) || "",
    };
  }
  function readyCheck(explicit) {
    if (HOST.onReady) HOST.onReady(readySummary(), !!explicit);
  }

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
    // boundary options come from ingest (atlas's own layers + geoBoundaries levels
    // for the region); fall back to the options endpoint if absent
    var bounds = (result.boundaries && result.boundaries.length) ? result.boundaries : (S.options.boundaries || []);
    fillSelect("#s-join", bounds.map(function (b) {
      var tag = b.group === "geo" ? ", geoBoundaries" : b.group === "base" ? ", boundary layer" : "";
      return { value: b.id, label: b.label.replace(/ · geoBoundaries$/, "") + " (" + b.count + tag + ")" };
    }), result.joinLayer);
    fillSelect("#s-name", S.names, role(result, "placeName"), true);
    fillSelect("#s-parent", S.names, role(result, "adminParent"), true);
    fillSelect("#s-lat", S.names, role(result, "latitude"), true);
    fillSelect("#s-lng", S.names, role(result, "longitude"), true);
    // collapse the controls when we confidently detected a placement; open them
    // automatically only when the user still has to choose
    var detected = result.strategy === "coordinates"
      ? !!(role(result, "latitude") && role(result, "longitude"))
      : !!role(result, "placeName");
    $("#place-details").hidden = detected;
    $("#ps-change").textContent = detected ? "Change" : "Done";
    syncPlaceVisibility();
    renderReport(result);
    goStep(3);
  }

  function syncPlaceVisibility() {
    var strat = $("#s-strategy").value;
    $("#pd-name-fields").hidden = strat !== "adminJoin";
    $("#pd-coord-fields").hidden = strat !== "coordinates";
    root.querySelectorAll("#pd-seg .pd-opt").forEach(function (b) {
      b.classList.toggle("on", b.dataset.strat === strat);
    });
    updatePlaceSummary();
  }

  // the plain-language answer shown above the (collapsible) controls
  function updatePlaceSummary() {
    var strat = $("#s-strategy").value, line = $("#ps-line"), ico = $("#ps-ico");
    if (!line) return;
    if (strat === "coordinates") {
      var la = $("#s-lat").value, ln = $("#s-lng").value;
      ico.textContent = "🧭";
      line.innerHTML = la && ln
        ? "Placed by their coordinates — <b>" + esc(la) + "</b> and <b>" + esc(ln) + "</b>."
        : '<span class="warn">Pick the latitude and longitude columns.</span>';
    } else {
      var nm = $("#s-name").value, jo = $("#s-join");
      var joLabel = jo.options[jo.selectedIndex] ? jo.options[jo.selectedIndex].textContent.replace(/\s*\(.*\)$/, "") : "";
      var pa = $("#s-parent").value;
      ico.textContent = "📍";
      line.innerHTML = nm
        ? "Matched by name — <b>" + esc(nm) + "</b> → <b>" + esc(joLabel) + "</b>" + (pa ? ", within <b>" + esc(pa) + "</b>" : "") + "."
        : '<span class="warn">Pick the column that holds the place names.</span>';
    }
  }

  function outsideChoice() {
    var el = root.querySelector('input[name="outside"]:checked');
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

  // spatial sessions have no placement pickers — keep the server's roles,
  // updating only the value column from the style step
  function spatialColumns() {
    var placeName = S.result ? role(S.result, "placeName") : "";
    return S.names.map(function (c) {
      var r = "text";
      if (c === placeName) r = "placeName";
      else if (c === $("#s-value").value) r = "value";
      return { name: c, role: r };
    });
  }

  function applyBody(draft, spec) {
    var body = { importId: S.result.importId, draft: draft, spec: spec };
    if (S.spatial) {
      body.columns = spatialColumns();
    } else {
      body.strategy = $("#s-strategy").value;
      body.joinLayer = $("#s-join").value;
      body.columns = buildColumns();
    }
    return body;
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
    return api("layers/apply", { method: "POST", body: applyBody(false, spec) })
      .then(function (r) { S.result = r; renderReport(r); msg("#msg-place", ""); })
      .catch(function (e) { msg("#msg-place", esc(errMsg(e))); });
  }

  ["#s-join", "#s-name", "#s-parent", "#s-lat", "#s-lng"].forEach(function (sel) {
    $(sel).addEventListener("change", function () {
      syncPlaceVisibility();
      scheduleApply(applyPlace, 100);
    });
  });
  // segmented "By place name / By coordinates" drives the hidden strategy select
  root.querySelectorAll("#pd-seg .pd-opt").forEach(function (b) {
    b.addEventListener("click", function () {
      $("#s-strategy").value = b.dataset.strat;
      syncPlaceVisibility();
      scheduleApply(applyPlace, 100);
    });
  });
  // "Change" reveals the controls; "Done" collapses back to the summary
  $("#ps-change").addEventListener("click", function () {
    var d = $("#place-details");
    d.hidden = !d.hidden;
    $("#ps-change").textContent = d.hidden ? "Change" : "Done";
  });
  root.querySelectorAll('input[name="outside"]').forEach(function (r) {
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
    if (STAGES === "checkPlace") {
      if (!S.result.stats || !S.result.stats.features) {
        msg("#msg-place", "Nothing matched yet — pick the place-name column (or lat/lng) above."); return;
      }
      readyCheck(true);
      return;
    }
    if (!S.result.stats || !S.result.stats.features) {
      msg("#msg-place", "Nothing matched yet — pick the place-name column (or lat/lng) above."); return;
    }
    if (open && !confirm(open + " row" + (open > 1 ? "s are" : " is") + " still unmatched and will be left off the map. Continue anyway?")) return;
    $("#to-style").disabled = true;
    msg("#msg-place", "Building the preview…", "ok");
    runApply(function () {
      var spec = Object.assign({}, S.result.spec, { outsideAction: outsideChoice() });
      return api("layers/apply", { method: "POST", body: applyBody(true, spec) }).then(function (r) {
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

  var CATEGORY_CHOICE = { value: "category", label: "Coloured by category" };
  function kindChoices() {
    if (!S.spatial) {
      return [{ value: "markers", label: "Points / markers" },
              { value: "choropleth", label: "Choropleth (colour by value)" }, CATEGORY_CHOICE];
    }
    var cls = (S.canonical.meta.geometry || {}).class;
    if (cls === "line") return [{ value: "line", label: "Lines" }, CATEGORY_CHOICE];
    if (cls === "polygon") return [
      { value: "polygon", label: "Areas (single colour)" },
      { value: "choropleth", label: "Choropleth (colour by value)" },
      CATEGORY_CHOICE,
    ];
    return [{ value: "markers", label: "Points / markers" }, CATEGORY_CHOICE];
  }

  function enterStyle(result) {
    var spec = result.spec || {};
    if (!S.styleReady) {
      $("#s-label").value = spec.label || "";
      fillSelect("#s-kind", kindChoices(), spec.kind || "markers");
      fillSelect("#s-value", S.names, spec.valueColumn || role(result, "value"), true);
      fillSelect("#s-catcol", S.names, spec.categoryColumn || "", true);
      fillSelect("#s-image", S.names, spec.imageColumn || "", true);
      fillSelect("#s-palette", S.options.palettes || [], spec.palette || "greens");
      fillSelect("#s-marker", S.options.markerColors || [], spec.markerColor || "rust");
      fillSelect("#s-linecolor", S.options.markerColors || [], spec.lineColor || "slate");
      fillSelect("#s-fillcolor", S.options.markerColors || [], spec.fillColor || "moss");
      if (spec.lineWidth) $("#s-linewidth").value = String(spec.lineWidth);
      $("#s-linedash").checked = !!spec.lineDash;
      if (spec.fillOpacity) $("#s-fillopacity").value = String(spec.fillOpacity);
      $("#s-group").value = ["base", "agri", "eco", "userdata"].indexOf(spec.group) >= 0 ? spec.group : "userdata";
      fillSelect("#s-poptitle", S.names, spec.popupTitleColumn || role(result, "placeName"), true);
      $("#chat-hint").textContent = S.options.geminiAvailable ? "" :
        "AI refine is off (no key configured) — the pickers above do everything manually.";
      S.styleReady = true;
    }
    syncStyleVisibility();
    renderReport(result);
    if (result.draftDataset) refreshPreview(result.draftDataset);
    var rep = result.matchReport || {};
    var un = (rep.unmatched || []).length;
    $("#style-state").textContent = un
      ? un + " row" + (un > 1 ? "s" : "") + " had no geometry and " + (un > 1 ? "are" : "is") + " left off the map."
      : "";
    goStep(4);
  }

  function syncStyleVisibility() {
    var kind = $("#s-kind").value;
    var cls = S.spatial ? (S.canonical.meta.geometry || {}).class : "";
    $("#w-value").hidden = kind !== "choropleth";
    $("#w-catcol").hidden = kind !== "category";
    $("#w-palette").hidden = kind !== "choropleth";
    $("#w-marker").hidden = kind !== "markers";
    $("#w-linecolor").hidden = kind !== "line";
    $("#w-linewidth").hidden = !(kind === "line" || (kind === "category" && cls === "line"));
    $("#w-linedash").hidden = kind !== "line";
    $("#w-fillcolor").hidden = kind !== "polygon";
    $("#w-fillopacity").hidden = !(kind === "polygon" || (kind === "category" && cls === "polygon"));
  }

  function applyStyle() {
    if (!S.result) return Promise.resolve();
    var spec = Object.assign({}, S.result.spec, {
      label: $("#s-label").value.trim() || "My data",
      kind: $("#s-kind").value,
      group: $("#s-group").value,
      valueColumn: $("#s-value").value || undefined,
      categoryColumn: $("#s-catcol").value || undefined,
      imageColumn: $("#s-image").value || undefined,
      palette: $("#s-palette").value,
      markerColor: $("#s-marker").value,
      lineColor: $("#s-linecolor").value || undefined,
      lineWidth: Number($("#s-linewidth").value) || undefined,
      lineDash: $("#s-linedash").checked || undefined,
      fillColor: $("#s-fillcolor").value || undefined,
      fillOpacity: Number($("#s-fillopacity").value) || undefined,
      popupTitleColumn: $("#s-poptitle").value || undefined,
      outsideAction: outsideChoice(),
    });
    $("#style-state").textContent = "Updating the preview…";
    return api("layers/apply", { method: "POST", body: applyBody(true, spec) }).then(function (r) {
      S.result = r;
      $("#frag-json").textContent = JSON.stringify(r.fragment, null, 2);
      $("#style-state").textContent = "";
      if (r.draftDataset) refreshPreview(r.draftDataset);
    }).catch(function (e) {
      $("#style-state").textContent = "";
      msg("#msg-commit", esc(errMsg(e)));
    });
  }

  ["#s-label", "#s-kind", "#s-value", "#s-catcol", "#s-image", "#s-palette", "#s-marker", "#s-group", "#s-poptitle",
   "#s-linecolor", "#s-linewidth", "#s-linedash", "#s-fillcolor", "#s-fillopacity"].forEach(function (sel) {
    $(sel).addEventListener("change", function () {
      syncStyleVisibility();
      scheduleApply(applyStyle);
    });
  });
  $("#s-label").addEventListener("input", function () { scheduleApply(applyStyle, 700); });

  $("#back-3").onclick = function () { goStep(S.spatial ? 2 : 3); };

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
    api("layers/commit", { method: "POST", body: { importId: S.result.importId, dataset: S.dataset } })
      .then(function (r) {
        loadAddedLayers();
        HOST.onCommitted({ layerId: r.layerId, dataset: r.dataset });
        var openLink = '<a href="./?dataset=' + encodeURIComponent(r.dataset) + '" target="_blank">open the atlas</a>';
        msg("#msg-commit", "Layer added 🎉 — " + openLink, "ok");
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

    return {
      start: function (canonical) {
        startCheck(canonical);
        // auto-resolve so the host can show a one-line verdict straight away
        if (STAGES === "checkPlace" && !$("#to-place").disabled) $("#to-place").click();
      },
      step: function () { return S.step; },
      state: S,
      summary: function () { return readySummary(); },
      // the atlas exists now: adopt its slug so apply can write a draft and
      // commit knows where the layer goes
      bindDataset: function (slug) { S.dataset = slug; },
      // build the draft preview and show the style step for this file
      enterStyle: function () {
        if (!S.result) return Promise.reject(new Error("nothing to style yet"));
        var spec = Object.assign({}, S.result.spec, { outsideAction: outsideChoice() });
        return api("layers/apply", { method: "POST", body: applyBody(true, spec) })
          .then(function (r) { S.result = r; enterStyle(r); return readySummary(); });
      },
      commit: function () {
        if (!S.result) return Promise.reject(new Error("nothing to add yet"));
        return api("layers/commit", { method: "POST", body: { importId: S.result.importId, dataset: S.dataset } })
          .then(function (r) { HOST.onCommitted({ layerId: r.layerId, dataset: r.dataset }); return r; });
      },
      destroy: function () { root.innerHTML = ""; },
    };
  }

  window.LokaDataBench = { mount: mount };
})();
