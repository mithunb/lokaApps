/* LOKA Atlas — the data-to-layer wizard, as a mountable module.
   Check & fix → Place on map → Preview & add. Two hosts mount the same code:

     add-data/           mode "standalone" — also renders the upload step, the
                         dataset picker and the manage list. The atlas is
                         resolved by its host before this mounts, so a person
                         who cannot edit it never reaches the upload at all.
     setup/ (wizard)     mode "embedded"   — kept for the day setup wants to
                         take a file up front; nothing mounts it that way today

   Everything the wizard touches is looked up under its mount root, so a host
   page can put it anywhere without id collisions. Parsing stays in ingest.js,
   the typed table in checktable.js; the API only ever sees canonical JSON. */
(function () {
  "use strict";

  var STEP1_HTML = `    <section class="panel step" id="db-step-1">
      <!-- No "which atlas?" here. This markup only renders in standalone mode,
           and the only standalone host is the add-data page, which is reached
           from an atlas, is given the slug in its address, and refuses to mount
           this bench until it has fetched that atlas and confirmed you may edit
           it. The atlas is named in the page header above. Asking again — worse,
           asking for a raw dataset id — was a leftover from when this was a page
           you could land on cold. -->
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

      <!-- layers already contributed to this atlas, for context while adding.
           Changing or removing one happens on the atlas itself. -->
      <div id="added-layers" hidden>
        <h2 style="font-size:1rem; margin:1.4rem 0 .2rem">Layers added to this atlas</h2>
        <p class="hint" style="margin:0 0 .4rem">To change or remove one, go back to the atlas and open the layer there.</p>
        <div id="added-layers-list"></div>
      </div>
    </section>`;

  var STEPS234_HTML = `    <section class="panel step" id="db-step-2" hidden>
      <h2 id="check-title">Check your table</h2>
      <p class="hint db-prose">Here's every column we found, with the kind of thing it holds and the role it'll play on
        the map. Untick anything you don't want, or hit <b>✎</b> to rename one or change what it holds. Switch to
        <b>Preview rows</b> to see a sample of the data and fix entries by hand.</p>
      <div id="sheet-pick" hidden>
        <p id="sheet-pick-title">That workbook has several sheets — which one holds the table?</p>
        <div class="sheet-list" id="sheet-list"></div>
      </div>
      <!-- spatial uploads: what the geometry cleaning found -->
      <div id="geom-summary" class="infer-note" hidden></div>
      <!-- the first question: where are these rows? -->
      <div id="loc-first" class="loc-first" hidden></div>
      <!-- find themes: one NEW "themes" column suggested from the descriptive
           columns. The suggestion arrives as chips with real counts and lands
           in the table only when the owner keeps it. No regenerate button on
           purpose: the same question over the same words gives the same
           answer, so the honest retry is changing what's read. -->
      <div id="enrich-panel" class="enrich-panel" hidden>
        <div class="enrich-head">
          <b>Find themes</b>
          <span class="hint">Reads every place's description and tags, then suggests a few themes that run
            through them — so the map can be coloured by theme. They arrive as one new column for you to
            keep or discard. What you uploaded is never changed.</span>
        </div>
        <div class="enrich-row">
          <button class="btn secondary" id="enrich-go">Find themes</button>
        </div>
        <details class="enrich-read" id="enrich-read">
          <summary>Choose what's read</summary>
          <p class="hint" style="margin:.3rem 0 .4rem">Themes come only from what's ticked. Changing this and running again can give a genuinely different answer.</p>
          <div class="enrich-cols" id="enrich-cols"></div>
        </details>
        <div class="theme-offer" id="theme-offer" hidden>
          <p class="theme-lede" id="theme-lede"></p>
          <div class="theme-chips" id="theme-chips"></div>
          <div class="theme-verbs">
            <button class="btn" id="theme-keep">Keep</button>
            <button class="btn secondary" id="theme-discard">Discard</button>
            <span class="hint">Keep adds them as a new column below — your original columns are unchanged.</span>
          </div>
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
    <section class="panel step" id="db-step-3" hidden>
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
      <div id="db-widen" hidden style="margin:.5rem 0 0"></div>
      <div id="msg-place"></div>
    </section>

    <!-- ============ STEP 4 · PREVIEW & ADD ============
         The same questions, in the same order and the same words, as the
         layer's own card on the atlas (owner.js, #own-edit) — plus the two
         things that only exist at birth: the shape question (asked only when
         the data offers a real choice) and the moment of adding. A question
         with one possible answer is not asked; the map and the key show it. -->
    <section class="bench step" id="db-step-4" hidden>
      <div class="card">
        <h2>How it looks</h2>

        <label class="f">Layer name<input type="text" id="s-label" maxlength="60" /></label>

        <label class="f" id="w-shape" hidden>Show each place as<select id="s-shape"></select></label>

        <!-- one colour question, whose meaning follows the shape (the edit
             screen's own table): pins ask which column colours them, circles
             which number sizes them, areas what colours or shades them -->
        <label class="f" id="w-colour" hidden><span id="lbl-colour">Colour places by</span>
          <select id="s-colour"></select>
          <span class="note warnish" id="multi-note" hidden></span>
        </label>
        <!-- why a tag column is not offered for colour — said once, plainly,
             so the person who wanted it isn't left staring at an absence -->
        <p class="tag-note" id="tag-note" hidden></p>

        <label class="f" id="w-palette" hidden>Colour ramp<select id="s-palette"></select></label>

        <div class="f" id="w-onecolour" hidden><span id="one-colour-lbl">Which colour</span>
          <div class="swatches" role="group" aria-labelledby="one-colour-lbl" id="swatches"></div>
        </div>

        <!-- steering, not blocking: shown when shading is the wrong choice -->
        <p class="kind-steer" id="kind-steer" hidden>That column looks like a count — counts compare better as circles sized by the number (under “Show each place as”). Light-to-dark shading suits rates and averages.</p>

        <!-- the key is output, not a control: the same rows the atlas will
             show, drawn by the same code, with author-only counts. It replaces
             the old explainer sentence — it IS the explanation. -->
        <div class="key-head">
          <span class="key-stamp">Map key</span>
          <span class="key-note" id="key-note"></span>
        </div>
        <div class="key-block"><ul class="key" id="key-rows"></ul></div>
        <p class="hint" id="style-state" role="status"></p>

        <label class="f" id="w-poptitle">Call each place by
          <select id="s-poptitle"></select>
          <span class="note">The name shown when someone points at or opens a place.</span>
        </label>

        <label class="f" id="w-image" hidden><span>Show photos from <span class="hint">(optional)</span></span>
          <select id="s-image"></select>
          <span class="note">Photos appear when a place is opened.</span>
        </label>

        <!-- only lines and areas have anything finer to control; for pins the
             fold would be empty, so it doesn't render at all -->
        <details class="style-more" id="style-more" hidden>
          <summary>Finer control</summary>
          <div class="grid2">
            <label class="f" id="w-linewidth" hidden>Line width
              <select id="s-linewidth"><option value="1">Thin</option><option value="2" selected>Regular</option><option value="3.5">Bold</option><option value="5">Heavy</option></select>
            </label>
            <label class="f" id="w-linedash" hidden style="flex-direction:row; align-items:center; gap:.5rem"><input type="checkbox" id="s-linedash" style="width:auto" /> Dashed line</label>
            <label class="f" id="w-fillopacity" hidden>Fill strength
              <select id="s-fillopacity"><option value="0.25">Light</option><option value="0.45" selected>Medium</option><option value="0.7">Strong</option></select>
            </label>
          </div>
        </details>

        <div class="s4-foot">
          <p class="assure">Only you can see this preview. Nothing changes on the atlas until you add it.</p>
          <div class="step-nav">
            <button class="btn" id="commit">Add to the atlas</button>
            <button class="btn secondary" id="back-3">← Back</button>
            <button class="btn secondary" id="discard">Discard this upload</button>
          </div>
          <div id="msg-commit"></div>
          <p class="hint" id="commit-auth" hidden></p>
        </div>
      </div>

      <iframe id="db-preview-frame" title="Layer preview"></iframe>
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
      // hosts that auto-run the check (the setup wizard) show progress and
      // errors in their own one-line verdict at the top of the page — said
      // at the bottom of a long table, nobody sees it
      onStatus: typeof opts.onStatus === "function" ? opts.onStatus : null,
    };
    // "checkPlace" stops after placement; "all" runs through style and commit
    var STAGES = opts.stages === "checkPlace" ? "checkPlace" : "all";

    // Embedded, the host page has its own Back/forward buttons a few pixels
    // away. Two wizards showing step navigation at once reads as four rival
    // choices, so ours is scoped to the panel in words: nothing in here claims
    // to advance the host's flow, and the terminal action just closes up.
    if (MODE === "embedded") {
      var scoped = [
        ["#back-1", null],                              // the host's ✕ removes the file
        // With stages:"checkPlace" the host owns the forward action, and start()
        // clicks this one itself to produce the verdict — so by the time anyone
        // sees the panel its job is done. Leaving it visible put two forward
        // buttons side by side, one of which only re-ran what you were looking at.
        // Hidden rather than relabelled because startCheck() rewrites its text.
        ["#to-place", STAGES === "checkPlace" ? null : "Next — check the locations"],
        ["#back-2", "← Back to the columns"],
        ["#to-style", "Done — this looks right"],
      ];
      scoped.forEach(function (pair) {
        var b = root.querySelector(pair[0]);
        if (!b) return;
        if (pair[1] === null) b.hidden = true; else b.textContent = pair[1];
      });
    }


    // the host page knows its own depth to the API mount
    var API = opts.api || "./api/";
    // ...and to the viewer, which the preview frame loads. Defaults to "./" for
    // a host sitting beside it; a host one directory deeper must say so.
    var VIEWER = opts.viewer || "./";
    // a private atlas's draft is not a static file — the preview frame and the
    // shape tally both have to ask the API, which authorises by session here
    var PRIVATE = !!opts.private;
    var VIA = PRIVATE ? "&via=api" : "";
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
        // Remember WHICH call failed and how. A refusal that carries no words of
        // its own used to reach the person as "something went wrong", which is
        // the least useful true sentence there is — it cost a day of the owner's
        // time and two rounds of guessing to learn nothing from it.
        if (!r.ok) { j._status = r.status; j._path = String(path).split("?")[0]; throw j; }
        return j;
      });
    }, function (netErr) {
      // the request never landed at all — a different fault, and worth saying so
      throw { _status: 0, _path: String(path).split("?")[0], error: "could not reach the server — check your connection and try again" };
    });
  }
  /* Never let a failure arrive wordless. When the server says nothing we can
     read, say what we DO know — which step it was and what it answered — so the
     next report is a diagnosis instead of a shrug. */
  function errMsg(e) {
    var said = e && (e.error || e.message);
    if (said) return said;
    var st = e && e._status;
    // 502/503/504 mean the site is up but the part that does the work is not —
    // almost always the few seconds while a new version is being put in place.
    // Nothing is wrong with the person's file and nothing is lost; the honest
    // instruction is to wait and press it again.
    if (st === 502 || st === 503 || st === 504) {
      return "The server is being updated right now. Nothing is lost — wait a few seconds and press this again.";
    }
    if (st === 0) return "Could not reach the server — check your connection and try again.";
    var where = e && e._path ? e._path : "the server";
    console.error("[databench] " + where + " answered " + (st || "nothing"), e);
    return "Something went wrong at this step (" + where + " answered " + (st || "nothing") +
      "). Tell us that, and we can fix it.";
  }
  function msg(sel, text, cls) {
    $(sel).innerHTML = text ? '<div class="msg ' + (cls || "err") + '">' + text + "</div>" : "";
  }

  var S = {
    dataset: "", canonical: null, names: [], result: null, options: null,
    step: 1, me: null, styleReady: false, spatial: false,
    editToken: null, oneColour: "rust", pendingThemes: null,
  };
  var CLASS_LABEL = { point: "points", line: "lines", polygon: "areas (polygons)" };

  /* The map key is drawn by the product's one swatch renderer (iconkit.js —
     the same table the map and the edit screen draw from, so this key cannot
     disagree with them). Hosts don't all load it, so the module fetches it
     itself; until it lands the key shows plain colour marks, redrawn on
     arrival. The cache tag rides along from the host's own databench tag. */
  if (!window.LokaIcons && !document.querySelector("script[data-loka-iconkit]")) {
    (function () {
      var here = document.querySelector('script[src*="databench.js"]');
      var m = here && (here.getAttribute("src") || "").match(/[?&](v=[^&]+)/);
      var el = document.createElement("script");
      el.src = VIEWER + "iconkit.js" + (m ? "?" + m[1] : "");
      el.setAttribute("data-loka-iconkit", "1");
      el.onload = function () { if (S.step === 4) syncKey(); };
      document.head.appendChild(el);
    })();
  }

  /* ================= steps ================= */

  function goStep(n) {
    S.step = n;
    [1, 2, 3, 4].forEach(function (i) {
      var panel = $("#db-step-" + i);
      if (panel) panel.hidden = i !== n;
    });
    HOST.onStep(n, S.spatial);           // the host owns its stepper chrome
    if (MODE === "standalone") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ================= step 1 · upload + sign-in ================= */

  var qsDataset = MODE === "standalone" ? new URLSearchParams(location.search).get("dataset") : (opts.dataset || "");
  S.dataset = opts.dataset || qsDataset || "";
  if (opts.editToken) S.editToken = opts.editToken;

  // The atlas is settled before this bench exists: standalone gets it from the
  // address (and its host has already checked it), embedded gets it from the
  // host once the build names it. Nobody types it.
  function datasetReady() {
    S.dataset = S.dataset || opts.dataset || "";
    if (!S.dataset) { msg("#msg-start", "This atlas isn’t ready yet — go back and finish setting it up."); return false; }
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
      if ($("#commit-auth")) $("#commit-auth").hidden = true;
      return me;
    }).catch(function () {
      S.me = null;
      if (nav) { nav.hidden = true; nav.textContent = ""; }
      $("#signin-card").hidden = false;
      $("#auth-state").textContent = "Adding data changes the atlas, so sign in first — the owner or an invited collaborator.";
      $("#signin-form").hidden = false;
      if ($("#commit-auth")) {
        $("#commit-auth").hidden = false;
        $("#commit-auth").textContent = "You'll need to be signed in as this atlas's owner or a collaborator.";
      }
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
        : "This server can't send email yet — ask the LOKA team for your code.", r.sent ? "ok" : "err");
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
    var ds = S.dataset;
    if (!ds) return;
    api("layers/list?dataset=" + encodeURIComponent(ds)).then(function (r) {
      var wrap = $("#added-layers"), list = $("#added-layers-list");
      list.innerHTML = "";
      if (!r.layers.length) { wrap.hidden = true; return; }
      wrap.hidden = false;
      // names only: changing or removing a layer happens on the atlas itself
      // (the editor's layer view), so there is exactly one place that does it
      r.layers.forEach(function (l) {
        var row = document.createElement("div");
        row.style.cssText = "display:flex; align-items:center; gap:.6rem; padding:.45rem 0; border-top:1px solid var(--color-divider); font-size:.9rem";
        var credit = l.addedBy ? (l.addedBy.org || l.addedBy.name || l.addedBy.email) : "";
        row.innerHTML = '<span style="flex:1 1 auto; min-width:0"><b>' + esc(l.label) + "</b>" +
          (credit ? ' <span class="hint">— added by ' + esc(credit) + "</span>" : "") + "</span>";
        list.appendChild(row);
      });
    }).catch(function () { $("#added-layers").hidden = true; /* not signed in / no access */ });
  }
  if (MODE === "standalone") loadAddedLayers();

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
    if ($("#commit")) $("#commit").textContent = "Add to the atlas";
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
      $("#check-title").textContent = "Choose the columns for your map" +
        (canonical.meta.sheet ? " — sheet “" + canonical.meta.sheet + "”" : "");
      showLocationFirst(canonical);
      $("#to-place").textContent = "Looks right — place it on the map";
    }
    LokaCheck.render($("#check-table"), canonical, { onChange: checkChanged });
    setupEnrich();
    checkChanged(canonical);
    msg("#msg-check", "");
    goStep(2);
  }

  /* Where the rows are is the first question worth answering — a map with the
     right colours and no location is useless. State what we found at the top of
     the fields step, before anything about styling. */
  function showLocationFirst(canonical) {
    var box = $("#loc-first");
    if (!box) return;
    var num = canonical.schema.filter(function (c) { return c.type === "number"; });
    var lat = num.find(function (c) { return /lat/i.test(c.name); });
    var lng = num.find(function (c) { return /(lon|lng)/i.test(c.name); });
    var PLACE = /(name|place|village|town|city|district|ward|block|panchayat|taluk|tehsil|mandal|location|locality|area|region|state)/i;
    var place = canonical.schema.find(function (c) { return c.type === "string" && PLACE.test(c.name); });
    var geo = canonical.geoms && canonical.geoms.length;
    box.hidden = false;
    if (geo) {
      box.className = "loc-first ok";
      box.innerHTML = "📍 <b>Location: the shapes in your file.</b> They carry their own coordinates.";
    } else if (lat && lng) {
      box.className = "loc-first ok";
      box.innerHTML = "📍 <b>Location: " + esc(lat.name) + " + " + esc(lng.name) + ".</b> " +
        "Your rows will be placed at those coordinates. " +
        '<button type="button" class="linkish" id="loc-change">Place them another way</button>';
    } else if (place) {
      box.className = "loc-first ok";
      box.innerHTML = "📍 <b>Location: the place names in " + esc(place.name) + ".</b> We'll match them to boundaries — you confirm on the next step.";
    } else {
      box.className = "loc-first warn";
      box.innerHTML = "📍 <b>No location found yet.</b> A map needs either latitude and longitude columns, or a column of place names. Check the columns below — you can rename one, or say what it holds, if we read it wrongly.";
    }
    // the way back into the placement step, for the person who wants it after
    // coordinates carried them past it
    var change = $("#loc-change");
    if (change) change.onclick = function () {
      S.placeSkipped = false;
      if (S.result) { $("#place-details").hidden = false; goStep(3); }
    };
  }

  /* ---- find themes: one new "themes" column, kept or discarded ----
     Offered when descriptive columns exist. Description- and tag-like columns
     are all read by default; "Choose what's read" lets the owner change the
     input — the honest retry, because re-asking the same question over the
     same words cannot give a genuinely different answer. The suggestion
     arrives as chips with real counts, and lands in the table only on Keep.
     A refusal ("no clear themes") is a result, not an error. */
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
  function looksLikeUrl(col) {
    var n = 0, t = 0;
    S.canonical.rows.forEach(function (r) { var s = String(r[col] == null ? "" : r[col]).trim(); if (s) { t++; if (/^https?:\/\//i.test(s)) n++; } });
    return t > 0 && n / t >= 0.6;
  }
  // columns that carry words ABOUT the places are read by default; strings
  // that merely administer them (addresses, ids, dates) are offered unticked
  var NOT_ABOUT = /address|creator|created|updated|url|link|photo|image|(^|_)id$|^lat|^lon|^lng/i;
  function enrichCandidates() {
    return S.canonical.schema.filter(function (c) {
      return c.type === "string" && !c.ignored && !c.derived && !looksLikeUrl(c.name);
    }).map(function (c) {
      var descriptive = looksDelimited(c.name) || (looksProse(c.name) && avgLen(c.name) >= 20);
      return { name: c.name, on: descriptive && !NOT_ABOUT.test(c.name) };
    });
  }
  function setupEnrich() {
    var panel = $("#enrich-panel");
    var cands = enrichCandidates();
    if (!cands.some(function (c) { return c.on; })) { panel.hidden = true; return; }
    panel.hidden = false;
    // keep the owner's own ticks across re-renders (e.g. after a Keep)
    var prev = {};
    root.querySelectorAll("#enrich-cols input").forEach(function (i) {
      prev[i.getAttribute("data-col")] = i.checked;
    });
    var host = $("#enrich-cols");
    host.innerHTML = "";
    cands.forEach(function (c) {
      var on = c.name in prev ? prev[c.name] : c.on;
      var lab = document.createElement("label");
      lab.innerHTML = '<input type="checkbox" data-col="' + esc(c.name) + '"' + (on ? " checked" : "") + "> " + esc(c.name);
      host.appendChild(lab);
    });
    hideOffer();
    msg("#msg-enrich", "");
  }
  function chosenCols() {
    var out = [];
    root.querySelectorAll("#enrich-cols input:checked").forEach(function (i) { out.push(i.getAttribute("data-col")); });
    return out;
  }
  function hideOffer() {
    $("#theme-offer").hidden = true;
    S.pendingThemes = null;
  }

  $("#enrich-go").onclick = function () {
    if (!S.canonical) return;
    var cols = chosenCols();
    if (!cols.length) { msg("#msg-enrich", "Tick at least one thing to read — under “Choose what's read”."); return; }
    // only the ticked columns travel — theme-finding never sees the rest
    var rows = S.canonical.rows.map(function (r) {
      var o = {}; cols.forEach(function (c) { o[c] = r[c]; }); return o;
    });
    var btn = $("#enrich-go"), label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spin" aria-hidden="true"></span>Reading…';
    function done() { btn.disabled = false; btn.innerHTML = label; }
    hideOffer();
    msg("#msg-enrich", "Reading all " + S.canonical.rows.length + " places…", "ok");
    api("layers/enrich", { method: "POST", body: {
      dataset: S.dataset || undefined, fields: cols, rows: rows,
    } }).then(function (r) {
      done();
      themesVerdict(r);
    }).catch(function (e) {
      done();
      msg("#msg-enrich", esc(errMsg(e)));
    });
  };

  /* Every answer the server can give, in plain words. Nothing lands in the
     table until Keep; a refusal names which way it failed. */
  function themesVerdict(r) {
    if (r.verdict === "themes") { showOffer(r); return; }
    if (r.verdict === "no_clear_themes") {
      msg("#msg-enrich", "No clear themes here" + (r.note ? ": " + esc(r.note).replace(/\.?\s*$/, ".") : ".") +
        " Nothing was added. These places may just be too varied — or too alike — to split. You can still colour the map by a column you already have.");
      return;
    }
    if (r.verdict === "refused") {
      msg("#msg-enrich", "The themes that came back didn't hold up — " + esc(r.reason || "they didn't fit these places") +
        " — so nothing was added. Changing what's read (under “Choose what's read”) can give a different answer.");
      return;
    }
    if (r.verdict === "too_thin") {
      msg("#msg-enrich", "Too few places have descriptions or tags to find themes in. Add a few more and try again.");
      return;
    }
    msg("#msg-enrich", "Theme-finding isn't available right now, so nothing was added. Try again in a little while.");
  }

  // the suggestion, before anything lands: each theme as a chip with the real
  // count of places it covers, plus how many fit nothing
  function showOffer(r) {
    S.pendingThemes = r;
    var total = S.canonical.rows.length;
    var placed = 0;
    (r.counts || []).forEach(function (c) { placed += c.count; });
    $("#theme-lede").innerHTML = r.seeded
      ? "This atlas already has kept themes, so your places were filed into them — " + placed + " of " + total + " fit:"
      : "Found " + r.counts.length + " theme" + (r.counts.length === 1 ? "" : "s") + " across " + placed + " of " + total + " places:";
    var chips = $("#theme-chips");
    chips.innerHTML = "";
    (r.counts || []).forEach(function (c) {
      var el = document.createElement("span");
      el.className = "theme-chip";
      if (c.definition) el.title = c.definition;
      el.innerHTML = esc(c.name) + " <b>" + c.count + "</b>";
      chips.appendChild(el);
    });
    if (r.other) {
      var o = document.createElement("span");
      o.className = "theme-chip is-other";
      o.innerHTML = "didn't fit: <b>" + r.other + "</b> — shown as “other”";
      chips.appendChild(o);
    }
    $("#theme-offer").hidden = false;
    msg("#msg-enrich", "");
  }

  $("#theme-keep").onclick = function () {
    var r = S.pendingThemes;
    if (!r || !S.canonical) return;
    // exactly one NEW column — existing columns are never written
    var target = ensureColumn("themes", "string");
    target.derived = true;               // checktable shows its "generated" chip
    S.canonical.rows.forEach(function (row, i) {
      row[target.name] = (r.categories && r.categories[i]) || "";
    });
    // re-type so the new column reads as kinds for colouring, keeping flags
    var names = S.canonical.schema.map(function (c) { return c.name; });
    var forced = {}; S.canonical.schema.forEach(function (c) { if (c.forced) forced[c.name] = c.forced; });
    var typed = LokaIngest.retype(names, S.canonical.rows, forced);
    typed.schema.forEach(function (c) {
      var prev = S.canonical.schema.find(function (p) { return p.name === c.name; });
      if (prev) { c.ignored = prev.ignored; c.forced = prev.forced; c.derived = prev.derived; }
    });
    S.canonical.schema = typed.schema; S.canonical.rows = typed.rows;
    LokaCheck.render($("#check-table"), S.canonical, { onChange: checkChanged });
    setupEnrich();
    // only a Keep persists the themes, so later contributions file into them
    if (S.dataset) {
      api("layers/enrich/keep", { method: "POST", body: { dataset: S.dataset, categorySet: r.categorySet } })
        .catch(function () {});
    }
    // The rows may already be on the server — the setup flow sends them the moment
    // the check panel opens, and the add-data flow whenever the person pressed
    // "place it on the map". Either way its copy predates this column, so send
    // them again. Without this, Keep changed the table and nothing else: the
    // themes were real on screen and absent from the map, which is exactly what
    // the owner hit.
    var already = !!S.result;
    if (already) sendRows();
    msg("#msg-enrich", "Kept — “" + esc(target.name) + "” is a new column, and your original columns are unchanged." +
      (already ? " The map is being rebuilt to include it." : ""), "ok");
    checkChanged();
  };

  $("#theme-discard").onclick = function () {
    var r = S.pendingThemes;
    if (!r) return;
    // discard also clears the atlas's remembered themes, so the next run
    // starts clean instead of inheriting what was just rejected
    if (S.dataset) {
      api("layers/enrich/discard", { method: "POST", body: { dataset: S.dataset } }).catch(function () {});
    }
    hideOffer();
    msg("#msg-enrich", "Discarded — nothing was added." +
      (r.seeded ? " The atlas's remembered themes were cleared, so the next run starts fresh." : ""), "ok");
  };

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

  /* Sending the rows is the ONLY moment the server sees them — everything after
     works from its copy, keyed by importId. So anything that changes the table
     afterwards (keeping themes writes a whole new column) has to send them again,
     or the map is built from data the person is no longer looking at. Named so
     Keep can call it; the button just calls it too. */
  function sendRows() {
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
    // Progress and errors for this step go where the person is looking: a
    // host with its own verdict line (the wizard's, top of the page) takes
    // them; otherwise they sit beside the button that was just pressed.
    function say(text, cls) {
      if (HOST.onStatus) { HOST.onStatus(text || "", cls || ""); msg("#msg-check", ""); return; }
      msg("#msg-check", text ? esc(text) : "", cls);
    }
    $("#to-place").disabled = true;
    say(S.spatial ? "Placing your shapes on the map…" : "Reading your table and matching it to the atlas…", "ok");
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
              say("");
              $("#to-place").disabled = false;
              if (STAGES === "checkPlace") { readyCheck(); return; }
              enterStyle(r);
            })
            .catch(function (e) { $("#to-place").disabled = false; say(errMsg(e), "err"); });
        });
        return;
      }
      say("");
      $("#to-place").disabled = false;
      enterPlace(out[1]);
      warnDuplicate(out[1]);
      if (STAGES === "checkPlace") readyCheck();
    }).catch(function (e) {
      $("#to-place").disabled = false;
      if (e.needsAuth) say("Sign in first — it's on the previous step, under the drop zone.", "err");
      else say(errMsg(e), "err");
    });
  }
  $("#to-place").onclick = sendRows;

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

  // Already-on-the-atlas is worth saying before styling, not after: the commit
  // will refuse it, and by then the user has done work for nothing.
  function warnDuplicate(result) {
    var d = result && result.duplicateOf;
    if (!d) return;
    if (d.exact) {
      msg("#msg-place", "This is the same data as the layer <b>" + esc(d.label) +
        "</b> already on this atlas — adding it will be refused. Remove that layer first if you meant to replace it.", "err");
    } else {
      msg("#msg-place", "A layer called <b>" + esc(d.label) + "</b> is already on this atlas. If this file replaces it, " +
        "remove that one first — otherwise you'll end up with both.", "ok");
    }
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

    // Nothing to decide: coordinates place every row, exactly as a shape file
    // does, and shapes have always gone straight through. The step is kept for
    // the cases that ARE a question — matching names to boundaries, or rows
    // that failed to place — and the check step carries a Change back into it.
    if (detected && result.strategy === "coordinates" && !needsAnEye(result)) {
      S.placeSkipped = true;
      if (STAGES === "checkPlace") { readyCheck(); return; }
      runApply(function () {
        return api("layers/apply", { method: "POST", body: applyBody(true, S.result.spec) })
          .then(function (r) { S.result = r; enterStyle(r); })
          .catch(function () { S.placeSkipped = false; goStep(3); });
      });
      return;
    }
    S.placeSkipped = false;
    goStep(3);
  }

  // rows the placement could not settle are the whole reason the step exists
  function needsAnEye(result) {
    var rep = result.matchReport || {};
    return ((rep.unmatched || []).length > 0) || ((rep.ambiguous || []).length > 0);
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

  /* When name matching leaves rows behind, the likeliest cause is often NOT the
     column someone picked — it is that the data describes somewhere this atlas
     does not cover. The old wording only ever offered the column, which sent
     people hunting through their own spreadsheet for a fault that wasn't there.
     So name both causes, and only raise the area when the numbers make it the
     likely one. Rows placed by latitude and longitude are left alone: they get
     the out-of-area keep-or-drop choice already, which says it better. */
  function joinedTo(rep) {
    return esc(rep.joinLabel || rep.joinLayer || "the boundaries on this atlas");
  }
  function missedMost(rep, missed) {
    if (rep.strategy !== "adminJoin") return false;
    var total = (S.canonical && S.canonical.rows) ? S.canonical.rows.length : 0;
    return total > 0 && missed > total / 2;
  }
  /* When most rows name places this atlas does not cover, the honest fix is not a
     different column — it is a bigger atlas. Step 2 made the product SAY that;
     this makes it doable. Two taps: find out where the rows actually are, then
     widen. The atlas keeps serving its current map throughout, and a widening big
     enough to need the LOKA team's approval says so instead of failing. */
  function widenBox() { return $("#db-widen"); }
  function hideWiden() { var w = widenBox(); if (w) { w.hidden = true; w.innerHTML = ""; } }

  function offerWiden(rep) {
    var w = widenBox();
    if (!w) return;
    var open = (rep.unmatched || []).length;
    // only for an atlas that exists (a pre-build session has nothing to widen),
    // only for name matching, and only when the region is the likely cause
    if (!S.dataset || !missedMost(rep, open)) { hideWiden(); return; }
    w.hidden = false;
    w.innerHTML = '<div class="msg"><span></span> ' +
      '<button type="button" class="btn" id="db-widen-go">See where these places are</button></div>';
    w.querySelector("span").textContent =
      open + " of these rows name places this atlas does not cover.";
    w.querySelector("#db-widen-go").onclick = function () { findWhere(rep); };
  }

  function findWhere(rep) {
    var w = widenBox();
    var names = (rep.unmatched || []).map(function (u) { return u.name; }).filter(Boolean);
    if (!names.length) { hideWiden(); return; }
    w.innerHTML = '<div class="msg">Looking up where these rows belong…</div>';
    var inst = null;
    api("instances/" + encodeURIComponent(S.dataset))
      .then(function (i) {
        inst = i;
        var iso3 = (i.region && i.region.iso3) || "";
        return api("geo/infer", { method: "POST", body: { iso3: iso3, names: names } });
      })
      .then(function (d) {
        var units = (d && d.units) || [];
        if (!units.length) {
          w.innerHTML = '<div class="msg">We could not tell where these rows belong, so widening ' +
            'would be a guess. Check the column above, or leave these rows off the map.</div>';
          return;
        }
        // an atlas is built at ONE level of detail; widening can only add places
        // at the level it already uses
        var cur = (inst.region && inst.region.shapeIDs) || [];
        if (d.level !== (inst.region && inst.region.level)) {
          w.innerHTML = '<div class="msg"></div>';
          w.querySelector(".msg").textContent = "These rows look like they are in " +
            units.slice(0, 3).map(function (u) { return u.name; }).join(", ") +
            ", but at a different level of detail from this atlas. Widening it is a bigger " +
            "change than this step can make — open the atlas and change its area there.";
          return;
        }
        var add = units.map(function (u) { return u.id; }).filter(function (id) { return cur.indexOf(id) < 0; });
        if (!add.length) {
          w.innerHTML = '<div class="msg">These places are already inside this atlas, so the ' +
            'column above is the more likely problem.</div>';
          return;
        }
        var namesShown = units.slice(0, 3).map(function (u) { return u.name; }).join(", ") +
          (units.length > 3 ? " and " + (units.length - 3) + " more" : "");
        w.innerHTML = '<div class="msg"><span></span> ' +
          '<button type="button" class="btn" id="db-widen-do">Widen the atlas</button></div>';
        w.querySelector("span").textContent = "These rows are in " + namesShown +
          ", which this atlas does not cover. Widening rebuilds the map — a few minutes — " +
          "and your data stays where it is.";
        w.querySelector("#db-widen-do").onclick = function () { doWiden(inst, cur.concat(add)); };
      })
      .catch(function (e) {
        w.innerHTML = '<div class="msg err"></div>';
        w.querySelector(".msg").textContent = errMsg(e);
      });
  }

  function doWiden(inst, shapeIDs) {
    var w = widenBox();
    w.innerHTML = '<div class="msg">Widening the atlas…</div>';
    api("instances/" + encodeURIComponent(S.dataset) + "/rebuild", {
      method: "POST",
      body: { region: { iso3: inst.region.iso3, level: inst.region.level, shapeIDs: shapeIDs } },
    }).then(function (r) {
      w.innerHTML = '<div class="msg ok"></div>';
      w.querySelector(".msg").textContent = r.pendingApproval
        ? r.message
        : "The atlas is being rebuilt to cover " + (r.regionLabel || "the wider area") +
          ". Give it a few minutes, then upload this file again — the places will match.";
    }).catch(function (e) {
      w.innerHTML = '<div class="msg err"></div>';
      w.querySelector(".msg").textContent = errMsg(e) +
        " — your atlas and its data are untouched.";
    });
  }

  function nothingPlacedText(rep) {
    return rep.strategy === "adminJoin"
      ? "None of these places were found in " + joinedTo(rep) + ". Either the column above isn't the one with place names in it, or this data is about somewhere outside your atlas's area."
      : "Nothing matched yet — pick the place-name column (or lat/lng) above.";
  }

  function renderReport(result) {
    var rep = result.matchReport || {};
    offerWiden(rep);
    var bits = ["<b>" + (result.stats ? result.stats.features : 0) + "</b> features on the map"];
    if (rep.strategy === "adminJoin") {
      bits.push("joined to <b>" + esc(rep.joinLabel || rep.joinLayer || "boundaries") + "</b>");
      if (rep.ambiguous && rep.ambiguous.length) bits.push('<b style="color:var(--color-rust-deep)">' + rep.ambiguous.length + " need attention</b>");
      if (rep.unmatched && rep.unmatched.length) bits.push(rep.unmatched.length + " unmatched");
    }
    if (rep.note) bits.push(esc(rep.note));
    // a column that was kept, held something, and still did not make it onto the
    // map is a fault worth saying plainly rather than leaving to be discovered
    if (rep.droppedColumns && rep.droppedColumns.length) {
      bits.push('<b style="color:var(--color-rust-deep)">' +
        esc(rep.droppedColumns.join(", ")) + " did not reach the map — please report this</b>");
    }
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
  }

  function buildColumns() {
    return S.names.map(function (c) {
      var r = "text";
      if (c === $("#s-name").value) r = "placeName";
      else if (c === $("#s-parent").value) r = "adminParent";
      else if (c === $("#s-lat").value) r = "latitude";
      else if (c === $("#s-lng").value) r = "longitude";
      else if (c === valueColumnChosen()) r = "value";
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
      else if (c === valueColumnChosen()) r = "value";
      return { name: c, role: r };
    });
  }

  // point / line / polygon — from the upload when there is one, otherwise from
  // the session the server rebuilt for an existing layer
  function geomClass() {
    if (S.canonical && S.canonical.meta && S.canonical.meta.geometry) return S.canonical.meta.geometry.class;
    var t = S.result && S.result.fragment && S.result.fragment.type;
    return t === "fill" ? "polygon" : t === "line" ? "line" : "point";
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
        .then(function (r) {
          S.result = r;
          renderReport(r);
          if (draft) syncKey();
          if (draft && r.draftDataset) refreshPreview(r.draftDataset);
        })
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
        msg("#msg-place", nothingPlacedText(rep)); return;
      }
      readyCheck(true);
      return;
    }
    if (!S.result.stats || !S.result.stats.features) {
      msg("#msg-place", nothingPlacedText(rep)); return;
    }
    if (open) {
      var stillOpen = open + " row" + (open > 1 ? "s are" : " is") + " still unmatched and will be left off the map.";
      if (missedMost(rep, open)) stillOpen += " That's most of your data — these places may sit outside your atlas's area.";
      if (!confirm(stillOpen + " Continue anyway?")) return;
    }
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

  /* The preview blanked because this had two ways to navigate one frame: set
     src the first time, reload() after. Entering the style step can schedule a
     re-apply 60ms later, whose result refreshes the preview again — so a
     reload() landed on a frame still doing its FIRST navigation, aborted it,
     and left the canvas empty after a flash of the map.

     One navigation style now, and only one at a time: a refresh asked for
     while another is in flight is remembered and run when that one lands. The
     version counter makes each src a real navigation even when the draft id
     has not changed, so reload() is never needed. */
  var previewSeq = 0, previewBusy = false, previewPending = null, previewGuard = null;
  function refreshPreview(draftId) {
    var f = $("#db-preview-frame");
    if (!f) return;
    if (previewBusy) { previewPending = draftId; return; }
    previewBusy = true;
    previewPending = null;
    var done = function () {
      if (!previewBusy) return;
      previewBusy = false;
      clearTimeout(previewGuard);
      if (previewPending) { var d = previewPending; previewPending = null; refreshPreview(d); }
    };
    f.onload = done;
    // a frame that never fires load (a dead draft, an offline basemap) must not
    // wedge every later refresh behind it
    clearTimeout(previewGuard);
    previewGuard = setTimeout(done, 8000);
    f.dataset.draft = draftId;
    f.src = VIEWER + "?embed=map&dataset=" + encodeURIComponent(draftId) + VIA + "&v=" + (++previewSeq);
  }

  /* "How it looks" asks two questions — the shape a place is drawn as, and
     what colours (or sizes, or shades) it — and derives the server's kind
     from the pair. Both questions offer only answers the data can actually
     give, named in plain words; a question with one possible answer is not
     asked at all. The colour question is the edit screen's own: columns that
     can carry colour, each with its count of kinds, plus one flat colour. */

  // The geometry class the PLACEMENT produced, not what the upload carried:
  // a lat/lng CSV is points however tabular the file looked, an admin-name
  // join hands back the matched polygons. Kinds must be offered against this.
  function placedClass() {
    if (S.spatial) return geomClass();
    var strat = (S.result && S.result.strategy) || $("#s-strategy").value;
    return strat === "adminJoin" ? "polygon" : "point";
  }

  /* The server profiles every column on each apply (which could carry colour,
     how many kinds, which are tag sets) — these read that profile instead of
     re-deriving it, so this screen and the edit screen answer from the same
     truth. */
  function resultProfiles() { return (S.result && S.result.profiles) || []; }
  function profileOf(name) {
    return resultProfiles().filter(function (p) { return p.name === name; })[0] || null;
  }
  function catColumns() {
    return resultProfiles().filter(function (p) { return p.categorical && p.name.charAt(0) !== "_"; });
  }

  // Numeric columns a circle/shading could use — lat/lng aren't values.
  function numericColumns() {
    var drop = {};
    ((S.result && S.result.columns) || []).forEach(function (c) {
      if (c.role === "latitude" || c.role === "longitude") drop[c.name] = 1;
    });
    var LATLNG = /^(lat|latitude|lon|lng|long|longitude)$/i;
    var profs = resultProfiles();
    if (profs.length) {
      return profs.filter(function (p) {
        return p.type === "number" && p.name.charAt(0) !== "_" && !drop[p.name] && !LATLNG.test(p.name);
      }).map(function (p) { return p.name; });
    }
    if (S.canonical) {
      return S.canonical.schema.filter(function (c) {
        return c.type === "number" && !c.ignored && !drop[c.name] && !LATLNG.test(c.name);
      }).map(function (c) { return c.name; });
    }
    var v = S.result && S.result.spec && S.result.spec.valueColumn;
    return v ? [v] : [];
  }

  // Does this column hold an absolute count (vs a rate/average)? Counts belong
  // on sized circles: big areas dominate shading whatever their rate says.
  function looksLikeCount(col) {
    if (!col) return false;
    if (/count|total|number|pop|households|qty/i.test(col)) return true;
    if (!S.canonical) return false;
    var seen = 0;
    for (var i = 0; i < S.canonical.rows.length; i++) {
      var v = S.canonical.rows[i][col];
      if (v === "" || v == null) continue;
      var n = Number(v);
      if (!isFinite(n) || n % 1 !== 0) return false;
      seen++;
    }
    return seen > 0;
  }

  // the shape answers, in the words of what will actually be drawn
  function shapeLabelFor(v) {
    var joined = !S.spatial && placedClass() === "polygon";   // a name-matched table
    if (v === "pin") return joined ? "A pin at the middle of each area" : "A pin";
    if (v === "bubble") return "A circle sized by a number";
    if (v === "border") return joined ? "The matched area" : "The area from your file";
    return "A line";
  }

  function shapeChoices() {
    var cls = placedClass();
    var out;
    if (cls === "line") out = ["line"];
    else if (cls === "polygon") {
      // an admin-name join can hand back centroid pins honestly; an uploaded
      // polygon file is always drawn as areas by the server
      out = S.spatial ? ["border"] : ["border", "pin"];
      // sized circles need a number to size by (shapes collapse to centroids)
      if (numericColumns().length) out.push("bubble");
    } else {
      out = ["pin"];
      if (numericColumns().length) out.push("bubble");
    }
    return out.map(function (v) { return { value: v, label: shapeLabelFor(v) }; });
  }

  // what the colour question asks depends on the shape — the edit screen's
  // own table of words (its COLOUR_MODES)
  function colourLabelFor(shape) {
    return shape === "bubble" ? "Size circles by"
      : shape === "border" ? "Colour areas by"
      : shape === "line" ? "Colour lines by"
      : "Colour places by";
  }

  /* The colour answers. Option values carry their meaning ("cat:categories",
     "num:visitors", "one") so one control holds the whole rule — and a later
     control that picks MORE than one rule at a time can reuse the same
     encoding without reshaping what apply reads. */
  function colourOptions(shape) {
    var opts = [];
    // category on an admin join renders centroid pins (the server's
    // transform), so it's offered under pins there; uploaded shapes keep
    // their own geometry and can carry category colours directly
    var canCat = shape === "pin" || shape === "line" || (shape === "border" && S.spatial);
    if (canCat) catColumns().forEach(function (p) {
      opts.push({ value: "cat:" + p.name, label: p.name + " — " + p.kinds + " kinds" });
    });
    if (shape === "bubble" || shape === "border") numericColumns().forEach(function (n) {
      opts.push({ value: "num:" + n, label: shape === "border" ? n + " — light to dark" : n });
    });
    if (shape !== "bubble") opts.push({
      value: "one",
      label: shape === "border" ? "One colour for every area"
        : shape === "line" ? "One colour for every line"
        : "One colour for every place",
    });
    return opts;
  }

  function colourParts() {
    var v = $("#s-colour").value || "one";
    var i = v.indexOf(":");
    return { mode: i < 0 ? v : v.slice(0, i), column: i < 0 ? "" : v.slice(i + 1) };
  }
  function valueColumnChosen() {
    var c = colourParts();
    return c.mode === "num" ? c.column : "";
  }

  // the pair on screen → the spec the server accepts, always a real kind
  function derivedSpecBits() {
    var shape = $("#s-shape").value || "pin";
    var c = colourParts();
    if (c.mode === "cat" && c.column) return { kind: "category", categoryColumn: c.column };
    if (c.mode === "num" && c.column) {
      return shape === "bubble"
        ? { kind: "bubble", valueColumn: c.column }
        : { kind: "choropleth", valueColumn: c.column };
    }
    return { kind: { pin: "markers", border: "polygon", line: "line", bubble: "bubble" }[shape] || "markers" };
  }

  // spec.kind → the pair the two questions show. Category is the one kind
  // whose shape depends on the placement (an admin-name join collapses point
  // kinds to centroids, so category reads as a pin there).
  function seedFromSpec(spec) {
    var kind = spec.kind || "markers";
    var cls = placedClass();
    var shape =
      kind === "choropleth" || kind === "polygon" ? "border"
      : kind === "bubble" ? "bubble"
      : kind === "line" ? "line"
      : kind === "category" ? (cls === "line" ? "line" : (cls === "polygon" && S.spatial) ? "border" : "pin")
      : "pin";
    var colour = "one";
    if (kind === "category") {
      var cat = spec.categoryColumn || (catColumns()[0] || {}).name || "";
      colour = cat ? "cat:" + cat : "one";
    } else if (kind === "choropleth" || kind === "bubble") {
      var num = spec.valueColumn || numericColumns()[0] || "";
      colour = num ? "num:" + num : "one";
    }
    return { shape: shape, colour: colour };
  }

  // placement can change between visits to this step (a name-join hands back
  // areas, coordinates hand back points), so both lists follow the placed
  // class — keeping the current answer when it's still offered
  function syncShapeChoices() {
    var shapes = shapeChoices();
    var sel = $("#s-shape");
    var have = Array.prototype.map.call(sel.options, function (o) { return o.value + "·" + o.textContent; }).join("|");
    if (have === shapes.map(function (s) { return s.value + "·" + s.label; }).join("|")) return;
    var keep = sel.value;
    fillSelect("#s-shape", shapes, shapes.some(function (s) { return s.value === keep; }) ? keep : shapes[0].value);
  }
  function syncColourChoices() {
    var rules = colourOptions($("#s-shape").value);
    var sel = $("#s-colour");
    var have = Array.prototype.map.call(sel.options, function (o) { return o.value + "·" + o.textContent; }).join("|");
    if (have !== rules.map(function (r) { return r.value + "·" + r.label; }).join("|")) {
      var keep = sel.value;
      var fallback = rules.some(function (r) { return r.value === "one"; }) ? "one" : (rules[0] ? rules[0].value : "");
      fillSelect("#s-colour", rules, rules.some(function (r) { return r.value === keep; }) ? keep : fallback);
    }
  }

  /* ---- the five named colours and the ramps, for the swatch chips only.
     Both mirror api/lib/fragment.js; the key itself is always drawn from the
     server's legend, so if fragment.js ever changes the key stays truthful.
     (The edit screen carries the same two tables — a shared home is owed.) */
  var MARKER_COLORS = { rust: "#A6522F", moss: "#40573D", ochre: "#B0863A", sienna: "#9C5A34", slate: "#5f7f92" };
  var MARKER_NAMES = { rust: "Rust", moss: "Moss", ochre: "Ochre", sienna: "Sienna", slate: "Slate" };
  var PALETTE_NAMES = {
    greens: "Greens", blues: "Blues", rust: "Rust", ylorbr: "Sand to brown",
    brteal: "Brown to teal", tealbr: "Teal to brown", purples: "Purples",
  };
  function paletteOptions() {
    return ((S.options && S.options.palettes) || []).map(function (k) {
      return { value: k, label: PALETTE_NAMES[k] || k };
    });
  }

  function renderSwatches() {
    var host = $("#swatches");
    host.innerHTML = "";
    Object.keys(MARKER_COLORS).forEach(function (k) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "sw";
      b.setAttribute("aria-pressed", String(S.oneColour === k));
      b.setAttribute("aria-label", MARKER_NAMES[k]);
      b.title = MARKER_NAMES[k];
      b.innerHTML = '<i style="--c:' + MARKER_COLORS[k] + '"></i>';
      b.onclick = function () {
        S.oneColour = k;
        host.querySelectorAll(".sw").forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
        scheduleApply(applyStyle);
      };
      host.appendChild(b);
    });
  }

  /* ---- the live map key: output, not a control ----
     Rows come from the server's legend for the draft; marks are drawn by
     iconkit (the map's own table); counts are tallied from the draft's own
     rows exactly as the edit screen tallies them. One approach in two places
     on purpose: the earlier legend/map mismatch came from a second renderer. */
  var LEG_SHAPES = { box: 1, dot: 1, line: 1, dashed: 1, triangle: 1, diamond: 1 };
  function swatchFor(it) {
    if (!window.LokaIcons) {   // iconkit still loading — plain mark, redrawn on load
      return '<span class="leg-swatch ' + (LEG_SHAPES[it.shape] ? it.shape : "box") +
        '" style="--c:' + esc(it.color || "") + '"></span>';
    }
    var row = it;
    if (it.shape && !LEG_SHAPES[it.shape]) row = Object.assign({}, it, { shape: "box" });
    return LokaIcons.swatchHTML(row, esc);
  }

  function renderKey(rows, tally, total) {
    var ul = $("#key-rows"), note = $("#key-note");
    var shape = $("#s-shape").value;
    var unit = shape === "border" ? "area" : shape === "line" ? "line" : "place";
    var totalText = total != null ? total + " " + unit + (total === 1 ? "" : "s") : "";
    // a shaded scale reads as one graduated bar with its endpoints — the same
    // shape the viewer's own key uses, so the author sees what a reader will
    if (rows && !Array.isArray(rows) && rows.ramp) {
      ul.innerHTML = '<li class="k-ramp"><span class="k-ramp-bar">' +
        rows.ramp.map(function (c) { return '<i style="--c:' + esc(c) + '"></i>'; }).join("") +
        '</span><span class="k-ramp-ends"><span>' + esc(rows.min) + "</span>" +
        (rows.unit ? "<span>" + esc(rows.unit) + "</span>" : "") +
        "<span>" + esc(rows.max) + "</span></span></li>";
      note.textContent = totalText;
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
    ul.innerHTML = rows.map(function (it) {
      var n = null;
      if (single && total != null) n = total;
      else if (counted && it.categorical) {
        n = it.label === "other" ? Math.max(0, counted.total - keptSum) : counted.counts[it.label];
      }
      return "<li>" + swatchFor(it) + '<span class="k-label">' + esc(it.label) + "</span>" +
        (n != null ? '<span class="k-count">' + n + "</span>" : "") + "</li>";
    }).join("");
    var kinds = rows.filter(function (it) { return it.categorical; }).length;
    note.textContent =
      (kinds >= 2 ? kinds + " kinds" + (totalText ? " · " : "") : "") + totalText;
  }

  /* Count each kind from the draft's own rows — the edit screen's tally. For
     a multi-value column the server derives the primary tag onto "_category"
     (fragment.js); counting THAT counts exactly what the map colours by. */
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

  var keySeq = 0;
  function syncKey() {
    if (!S.result) return;
    var frag = S.result.fragment;
    var rows = (frag && frag.legend) || [];
    var total = S.result.stats && S.result.stats.features != null ? S.result.stats.features : null;
    renderKey(rows, null, total);
    syncMultiNote(null);
    var c = colourParts();
    var draft = S.result.draftDataset;
    if (c.mode !== "cat" || !draft || !frag || !frag.source) return;
    var mine = ++keySeq;
    tallyFile(VIEWER + (PRIVATE ? "api/datasets/" : "datasets/") + encodeURIComponent(draft) + "/" + frag.source, c.column)
      .then(function (t) {
        if (mine !== keySeq || !t || S.step !== 4) return;
        renderKey(rows, t, total);
        syncMultiNote(t);
      });
  }

  // said once, only when a multi-value column is chosen, with the count from
  // the data — the first value decides the colour (the edit screen's words)
  function syncMultiNote(tally) {
    var note = $("#multi-note");
    var c = colourParts();
    var p = c.mode === "cat" ? profileOf(c.column) : null;
    if (!p || !p.multiValue || !tally || !tally.multi) { note.hidden = true; return; }
    note.hidden = false;
    note.textContent = (tally.multi === 1
      ? "1 place carries two or more " + c.column
      : tally.multi + " places carry two or more " + c.column) +
      " — the first one decides the colour.";
  }

  /* Why a tag column is not offered for colour. The server flags tag sets
     (tagList: rich for opening and searching places, useless for colouring);
     the count of distinct tags is measured from the rows in hand. */
  function distinctTagCount(col) {
    if (!S.canonical) return 0;
    var vals = S.canonical.rows.map(function (r) { return r[col]; })
      .filter(function (v) { return v !== null && v !== undefined && v !== ""; })
      .map(String);
    if (!vals.length) return 0;
    var delim = null;
    [";", ","].some(function (d) {   // the server's own delimiter rule
      var n = vals.filter(function (v) { return v.indexOf(d) >= 0; }).length;
      if (n >= vals.length * 0.4) { delim = d; return true; }
      return false;
    });
    var seen = {}, count = 0;
    vals.forEach(function (v) {
      (delim ? v.split(delim) : [v]).forEach(function (t) {
        t = t.trim().toLowerCase();
        if (t && !seen[t]) { seen[t] = 1; count++; }
      });
    });
    return count;
  }
  function syncTagNote() {
    var note = $("#tag-note");
    var tags = resultProfiles().filter(function (p) { return p.tagList; });
    if (!tags.length) { note.hidden = true; return; }
    note.hidden = false;
    note.textContent = tags.map(function (p) {
      var n = distinctTagCount(p.name);
      return (n
        ? p.name + " has " + n + " different tags — too many to tell apart by colour."
        : p.name + " has too many different tags to tell apart by colour.") +
        " They stay searchable, and they show when a place is opened.";
    }).join(" ");
  }

  /* The layer name ships as the legend title on a public atlas, and the default
     the server hands back is the upload's filename with the extension dropped
     — "blr_full", which nobody chose. Tidy that into words. The default only:
     a name someone typed, or the name an existing layer was saved under, is
     never rewritten. */
  var SMALL_WORD = /^(a|an|and|as|at|by|for|from|in|of|on|or|per|the|to|v|vs|with)$/;
  function prettyName(raw) {
    var words = String(raw || "").replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
    if (!words) return "";
    return words.split(" ").map(function (w, i) {
      if (/[A-Z]/.test(w)) return w;                       // GPS, pH, geoJSON keep their own case
      if (i && SMALL_WORD.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");
  }
  function defaultLabel(spec) {
    var label = (spec && spec.label) || "";
    var src = (S.canonical && S.canonical.meta && S.canonical.meta.sourceName) || "";
    var stem = src.replace(/\.[a-z0-9]+$/i, "");
    if (!label) return prettyName(stem);
    // the untouched default is exactly the filename stem; anything else is a
    // name a person settled on, so it travels as typed
    return (stem && label === stem) ? prettyName(stem) : label;
  }

  // the columns a popup could be titled by, and the server's own preference
  // when the spec names none — the edit screen's rule, word for word
  var NAMEISH = /^(name|title|label|place|description|desc|site|spot)s?$/i;
  function titleColumns() {
    return resultProfiles().filter(function (p) {
      return p.type === "string" && !p.looksLikeImage && p.name.charAt(0) !== "_";
    }).map(function (p) { return p.name; });
  }
  function guessTitle() {
    var cols = titleColumns();
    var byName = cols.filter(function (n) { return NAMEISH.test(n.trim()); })[0];
    if (byName) return byName;
    var nameish = resultProfiles().filter(function (p) {
      return p.type === "string" && p.looksLikeName && !p.looksLikeImage && p.name.charAt(0) !== "_";
    })[0];
    return (nameish && nameish.name) || cols[0] || null;
  }
  function imageColumns() {
    return resultProfiles().filter(function (p) { return p.looksLikeImage; })
      .map(function (p) { return p.name; });
  }

  function enterStyle(result) {
    var spec = result.spec || {};
    if (!S.styleReady) {
      $("#s-label").value = defaultLabel(spec);
      // the inferred kind may not be offered for this geometry (e.g. choropleth
      // on points) — fall back to the first shape with one colour and rebuild
      // the preview so the map matches what the controls now say
      var pair = seedFromSpec(spec);
      var shapes = shapeChoices();
      if (!shapes.some(function (s) { return s.value === pair.shape; })) pair = { shape: shapes[0].value, colour: "one" };
      fillSelect("#s-shape", shapes, pair.shape);
      var rules = colourOptions(pair.shape);
      if (!rules.some(function (r) { return r.value === pair.colour; })) {
        pair.colour = rules.some(function (r) { return r.value === "one"; }) ? "one" : (rules[0] ? rules[0].value : "");
      }
      fillSelect("#s-colour", rules, pair.colour);
      var imgs = imageColumns();
      fillSelect("#s-image", imgs, spec.imageColumn && imgs.indexOf(spec.imageColumn) >= 0 ? spec.imageColumn : "", true);
      var pals = paletteOptions();
      fillSelect("#s-palette", pals, pals.some(function (p) { return p.value === spec.palette; }) ? spec.palette : "greens");
      // one row of swatches serves pins, circles, borders and lines alike —
      // seeded from whichever slot the saved spec filled
      var flat = (pair.shape === "border" ? spec.fillColor : pair.shape === "line" ? spec.lineColor : spec.markerColor) || spec.markerColor || "rust";
      S.oneColour = MARKER_COLORS[flat] ? flat : "rust";
      renderSwatches();
      if (spec.lineWidth) $("#s-linewidth").value = String(spec.lineWidth);
      $("#s-linedash").checked = !!spec.lineDash;
      if (spec.fillOpacity) $("#s-fillopacity").value = String(spec.fillOpacity);
      var titles = titleColumns();
      var seedTitle = (spec.popupTitleColumn && titles.indexOf(spec.popupTitleColumn) >= 0 && spec.popupTitleColumn) ||
        (role(result, "placeName") && titles.indexOf(role(result, "placeName")) >= 0 && role(result, "placeName")) ||
        guessTitle();
      if (titles.length) fillSelect("#s-poptitle", titles, seedTitle || titles[0]);
      $("#w-poptitle").hidden = !titles.length;
      S.styleReady = true;
    }
    syncStyleVisibility();
    // however we got here — a fresh entry whose inferred kind this geometry
    // can't draw, or a return trip after the placement changed — the lists were
    // just rebuilt, so when what the controls say disagrees with the spec the
    // preview was built from, re-apply until the map matches the controls. A
    // tidied default name rides along the same way, so the atlas gets the name
    // the field is showing.
    var d = derivedSpecBits();
    if (d.kind !== (spec.kind || "markers") ||
        (d.categoryColumn || "") !== (spec.categoryColumn || "") ||
        (d.valueColumn || "") !== (spec.valueColumn || "") ||
        $("#s-label").value !== (spec.label || "")) scheduleApply(applyStyle, 60);
    renderReport(result);
    if (result.draftDataset) refreshPreview(result.draftDataset);
    syncKey();
    var rep = result.matchReport || {};
    var un = (rep.unmatched || []).length;
    $("#style-state").textContent = un
      ? un + " row" + (un > 1 ? "s" : "") + " couldn't be placed and " + (un > 1 ? "are" : "is") + " left off the map."
        + (missedMost(rep, un) ? " That's most of your data — they may be outside your atlas's area." : "")
      : "";
    goStep(4);
  }

  function syncStyleVisibility() {
    syncShapeChoices();
    syncColourChoices();
    // a question with one possible answer is not asked — the map and the key
    // already show what's drawn
    $("#w-shape").hidden = $("#s-shape").options.length <= 1;
    $("#w-colour").hidden = $("#s-colour").options.length <= 1;
    var shape = $("#s-shape").value;
    var c = colourParts();
    var kind = derivedSpecBits().kind;
    $("#lbl-colour").textContent = colourLabelFor(shape);
    // each answer reveals only the follow-up it needs. The swatches stand in
    // for the whole colour question when one colour is the only possibility.
    $("#w-onecolour").hidden = !(c.mode === "one" || shape === "bubble");
    if (!$("#w-onecolour").hidden) {
      $("#one-colour-lbl").textContent =
        shape === "bubble" ? "Circle colour"
        : shape === "border" ? "Fill colour"
        : shape === "line" ? "Line colour"
        : "Which colour";
    }
    $("#w-palette").hidden = kind !== "choropleth";
    $("#w-linewidth").hidden = shape !== "line";
    $("#w-linedash").hidden = kind !== "line";
    // choropleth's opacity is fixed by the server, so only the other area kinds ask
    $("#w-fillopacity").hidden = !(shape === "border" && kind !== "choropleth");
    // the fold renders only when something is under it (lines and areas)
    $("#style-more").hidden = $("#w-linewidth").hidden && $("#w-linedash").hidden && $("#w-fillopacity").hidden;
    var img = $("#s-image");
    $("#w-image").hidden = !img || img.options.length <= 1;
    // steering, not blocking: shading an absolute count misleads (big areas
    // dominate the eye whatever their rate) — nudge towards sized circles
    $("#kind-steer").hidden = !(kind === "choropleth" && looksLikeCount(c.column));
    syncTagNote();
  }

  function applyStyle() {
    if (!S.result) return Promise.resolve();
    var shape = $("#s-shape").value || "pin";
    var d = derivedSpecBits();
    var one = S.oneColour || "rust";
    var spec = Object.assign({}, S.result.spec, {
      label: $("#s-label").value.trim() || "My data",
      kind: d.kind || "markers",
      group: "userdata",   // contributed layers land under "Your data"
      valueColumn: d.valueColumn || undefined,
      categoryColumn: d.categoryColumn || undefined,
      imageColumn: $("#s-image").value || undefined,
      palette: $("#s-palette").value || undefined,
      // the swatches feed whichever slot the shape reads; markerColor always
      // travels so a one-colour stanza never arrives without a paint
      markerColor: one,
      lineColor: shape === "line" ? one : undefined,
      fillColor: shape === "border" ? one : undefined,
      lineWidth: Number($("#s-linewidth").value) || undefined,
      lineDash: $("#s-linedash").checked || undefined,
      fillOpacity: Number($("#s-fillopacity").value) || undefined,
      popupTitleColumn: $("#s-poptitle").value || undefined,
      outsideAction: outsideChoice(),
    });
    $("#style-state").textContent = "Updating the preview…";
    return api("layers/apply", { method: "POST", body: applyBody(true, spec) }).then(function (r) {
      S.result = r;
      $("#style-state").textContent = "";
      syncKey();
      if (r.draftDataset) refreshPreview(r.draftDataset);
    }).catch(function (e) {
      $("#style-state").textContent = "";
      msg("#msg-commit", esc(errMsg(e)));
    });
  }

  ["#s-label", "#s-shape", "#s-colour", "#s-image", "#s-palette", "#s-poptitle",
   "#s-linewidth", "#s-linedash", "#s-fillopacity"].forEach(function (sel) {
    $(sel).addEventListener("change", function () {
      syncStyleVisibility();
      scheduleApply(applyStyle);
    });
  });
  $("#s-label").addEventListener("input", function () { scheduleApply(applyStyle, 700); });

  $("#back-3").onclick = function () { goStep(S.spatial ? 2 : 3); };

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
