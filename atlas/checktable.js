/* LOKA Atlas — the "Choose the columns" step (window.LokaCheck).
   Reframes the imported table as a decision, not a spreadsheet: a compact
   card per field (auto-detected type + the role it will play on the map +
   an Include toggle) is the primary view, so the user can glance every field
   — including generated category / labels — without a wall of horizontal
   scroll. A secondary "Preview rows" view shows up to 50 randomly sampled
   rows with editable cells for hand-fixing values.

   Typing is automatic (dominant-class detection in ingest.js); the type
   override lives behind a per-field "edit" disclosure for the rare ambiguous
   column, rather than a dropdown on every field. Column tools kept: rename,
   type override, fill-down (merged-cell exports leave group values only on
   each group's first row), remove duplicates, derived count column. A
   coordinate sanity panel flags projected (UTM-looking) exports and swapped
   lat/lng before the placement step runs.

   LokaCheck.render(container, canonical, {onChange}) mutates `canonical` in
   place and calls onChange(canonical) after every edit. */
(function () {
  "use strict";

  var PREVIEW_ROWS = 50;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var TYPE_LABEL = { string: "text", number: "number", date: "date", boolean: "yes / no" };
  var ISSUE_TEXT = {
    "mixed-types": "entries that don't fit",
    "mostly-empty": "empty cells",
    "empty-column": "the whole column is empty",
    "ambiguous-dates": "dates that could be day- or month-first (read as day-first)",
  };
  var ROLE_LABEL = {
    location: "Location", colour: "Colour", tags: "Tags",
    value: "Value", text: "Popup text", off: "Off",
  };
  var ROLE_HINT = {
    location: "Used to place rows on the map (coordinates or place names).",
    colour: "A category — colours the markers and gets a legend.",
    tags: "Fine labels — shown as chips in the popup and searchable.",
    value: "A number the map can scale or shade by.",
    text: "Shown in the popup when a marker is clicked.",
    off: "Left out of the layer.",
  };

  // column-name hints (underscores/hyphens normalised to spaces so \b works)
  function nameNorm(n) { return " " + String(n).toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim() + " "; }
  var COORD_RE = /( )(lat|latitude|lon|long|lng|longitude|x|y|easting|northing|east|north)( )/;
  var PLACE_RE = /( )(name|place|placename|village|town|city|district|ward|block|panchayat|gp|taluk|tehsil|mandal|location|locality|region|address|state|province|country|zone|constituency|hamlet|colony|street|road|neighbourhood|neighborhood)( )/;

  function render(container, canonical, opts) {
    opts = opts || {};
    var forced = {};
    canonical.schema.forEach(function (c) { if (c.forced) forced[c.name] = c.forced; });

    var view = "fields";          // "fields" | "rows"
    var openEdit = {};            // column name -> edit disclosure open
    var sampleIdx = null, sampleFor = -1;   // stable random row sample for the preview

    /* ---------------- stable random sample for the preview ---------------- */

    function ensureSample() {
      var n = canonical.rows.length;
      if (sampleIdx && sampleFor === n) return sampleIdx;
      if (n <= PREVIEW_ROWS) {
        sampleIdx = []; for (var i = 0; i < n; i++) sampleIdx.push(i);
      } else {
        var pool = {}, picked = [];
        while (picked.length < PREVIEW_ROWS) {
          var k = Math.floor(Math.random() * n);
          if (!pool[k]) { pool[k] = 1; picked.push(k); }
        }
        picked.sort(function (a, b) { return a - b; });   // show in original order, not shuffled
        sampleIdx = picked;
      }
      sampleFor = n;
      return sampleIdx;
    }

    /* ---------------- per-draw column stats (cardinality + samples) ---------------- */

    function buildStats() {
      var stats = {};
      canonical.schema.forEach(function (c) {
        var seen = {}, order = [], filled = 0;
        canonical.rows.forEach(function (r) {
          var v = r[c.name];
          if (v === "" || v == null) return;
          filled++;
          var key = v === true ? "yes" : v === false ? "no" : String(v);
          if (!seen[key]) { seen[key] = 1; if (order.length < 4) order.push(key); }
        });
        stats[c.name] = { distinct: Object.keys(seen).length, filled: filled, samples: order };
      });
      return stats;
    }

    function roleOf(c, st) {
      if (c.ignored) return "off";
      var nm = nameNorm(c.name);
      if (c.type === "number" && COORD_RE.test(nm)) return "location";
      if (c.type === "string" && PLACE_RE.test(nm)) return "location";
      if (c.name === "category") return "colour";
      if (c.name === "labels") return "tags";
      if (c.type === "string") {
        if (looksDelimited(c.name)) return "tags";
        if (looksProse(c.name)) return "text";
        var d = st[c.name] || { distinct: 0, filled: 0 };
        if (d.filled && d.distinct >= 2 && d.distinct <= 12) return "colour";
        return "text";
      }
      if (c.type === "number" || c.type === "boolean") return "value";
      return "text";   // dates and everything else → popup text
    }

    function avgLen(name) {
      var t = 0, n = 0;
      canonical.rows.forEach(function (r) { var s = String(r[name] == null ? "" : r[name]); if (s) { n++; t += s.length; } });
      return n ? t / n : 0;
    }
    function looksDelimited(name) {
      var n = 0, t = 0;
      canonical.rows.forEach(function (r) { var s = String(r[name] == null ? "" : r[name]); if (s) { t++; if (s.indexOf(";") >= 0) n++; } });
      return t && n / t >= 0.4;
    }
    function looksProse(name) {
      var n = 0, t = 0;
      canonical.rows.forEach(function (r) { var s = String(r[name] == null ? "" : r[name]).trim(); if (s) { t++; if (/\s/.test(s)) n++; } });
      return t && n / t >= 0.6 && avgLen(name) >= 20;
    }

    /* ---------------- edits (shared with both views) ---------------- */

    function retypeAll() {
      var names = canonical.schema.map(function (c) { return c.name; });
      var flags = {};
      canonical.schema.forEach(function (c) { flags[c.name] = { ignored: !!c.ignored, derived: !!c.derived }; });
      var t = LokaIngest.retype(names, canonical.rows, forced);
      t.schema.forEach(function (c) {
        if (forced[c.name]) c.forced = forced[c.name];
        if (flags[c.name]) { c.ignored = flags[c.name].ignored; c.derived = flags[c.name].derived; }
      });
      canonical.schema = t.schema;
      canonical.rows = t.rows;
    }

    function changed() {
      draw();
      if (opts.onChange) opts.onChange(canonical);
    }

    function renameColumn(oldName, newName) {
      newName = String(newName || "").trim().replace(/\s+/g, " ").slice(0, 80);
      if (!newName || newName === oldName) return;
      var taken = canonical.schema.some(function (c) { return c.name.toLowerCase() === newName.toLowerCase(); });
      if (taken) return;
      canonical.schema.forEach(function (c) { if (c.name === oldName) c.name = newName; });
      canonical.rows.forEach(function (r) { r[newName] = r[oldName]; delete r[oldName]; });
      if (forced[oldName]) { forced[newName] = forced[oldName]; delete forced[oldName]; }
      if (openEdit[oldName]) { openEdit[newName] = true; delete openEdit[oldName]; }
      retypeAll(); changed();
    }

    function setType(name, type) {
      if (type === "auto") delete forced[name];
      else forced[name] = type;
      retypeAll(); changed();
    }

    function toggleInclude(name) {
      canonical.schema.forEach(function (c) { if (c.name === name) c.ignored = !c.ignored; });
      draw();
      if (opts.onChange) opts.onChange(canonical);
    }

    function fillDown(name) {
      var last = "";
      canonical.rows.forEach(function (r) {
        var v = r[name];
        if (v === "" || v == null) r[name] = last;
        else last = v;
      });
      retypeAll(); changed();
    }

    function dedupeRows() {
      var seen = {}, kept = [];
      canonical.rows.forEach(function (r) {
        var k = JSON.stringify(canonical.schema.map(function (c) { return r[c.name]; }));
        if (!seen[k]) { seen[k] = 1; kept.push(r); }
      });
      var removed = canonical.rows.length - kept.length;
      canonical.rows = kept;
      canonical.meta.notices.push(removed + " duplicate row" + (removed > 1 ? "s" : "") + " removed.");
      sampleIdx = null;   // row set changed — resample the preview
      retypeAll(); changed();
    }

    function addCountColumn(name, cols) {
      name = String(name || "").trim().slice(0, 80) || "Count";
      while (canonical.schema.some(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })) name += "_2";
      canonical.rows.forEach(function (r) {
        var n = 0;
        cols.forEach(function (c) {
          var v = r[c];
          if (v === true || (v !== false && v !== "" && v != null && !/^(no|false|0)$/i.test(String(v).trim()))) n++;
        });
        r[name] = n;
      });
      canonical.schema.push({ name: name, type: "number", issues: [], derived: true });
      retypeAll();
      changed();
    }

    // edit one cell in the preview (raw string; retype re-classifies it)
    function setCell(name, realIdx, raw) {
      var r = canonical.rows[realIdx];
      if (!r) return;
      if (String(r[name] == null ? "" : r[name]) === raw) return;   // no change
      r[name] = raw;
      retypeAll(); changed();
    }

    /* ---------------- analysis for the panels ---------------- */

    function duplicateCount() {
      var seen = {}, dup = 0;
      canonical.rows.forEach(function (r) {
        var k = JSON.stringify(canonical.schema.map(function (c) { return r[c.name]; }));
        if (seen[k]) dup++; else seen[k] = 1;
      });
      return dup;
    }

    function coordFindings() {
      var out = [];
      var numeric = canonical.schema.filter(function (c) { return c.type === "number" && !c.ignored; });
      var vals = function (c) {
        return canonical.rows.map(function (r) { return r[c.name]; })
          .filter(function (v) { return typeof v === "number"; });
      };
      var latish = numeric.filter(function (c) { return /lat/i.test(c.name); });
      var lngish = numeric.filter(function (c) { return /(lon|lng)/i.test(c.name); });
      var xyish = numeric.filter(function (c) { return /^(x|y|east(ing)?|north(ing)?)$/i.test(c.name.trim()); });

      var utmSuspects = numeric.filter(function (c) {
        var v = vals(c);
        if (v.length < 3) return false;
        var abs = v.map(Math.abs);
        var min = Math.min.apply(null, abs), max = Math.max.apply(null, abs);
        return min > 1000 && max > 10000;
      });
      if (utmSuspects.length >= 2 && (xyish.length >= 2 || latish.length + lngish.length === 0)) {
        out.push({ level: "err", text: "Columns " + utmSuspects.slice(0, 2).map(function (c) { return "“" + c.name + "”"; }).join(" and ") +
          " look like projected coordinates (UTM metres, not degrees). Maps need WGS84 latitude/longitude — re-export with EPSG:4326." });
      }
      if (latish.length && lngish.length) {
        var la = vals(latish[0]), ln = vals(lngish[0]);
        if (la.length && ln.length) {
          var laMax = Math.max.apply(null, la.map(Math.abs));
          var lnMax = Math.max.apply(null, ln.map(Math.abs));
          if (laMax > 90 && lnMax <= 90) {
            out.push({ level: "warn", text: "“" + latish[0].name + "” holds values beyond ±90 while “" + lngish[0].name +
              "” doesn't — latitude and longitude look swapped. They'll be swapped back automatically when the rows are placed." });
          } else if (laMax > 90) {
            out.push({ level: "err", text: "“" + latish[0].name + "” has values beyond ±90 — those rows can't be placed as latitudes." });
          }
        }
      }
      return out;
    }

    /* ---------------- drawing ---------------- */

    function headerHTML() {
      var h = "";
      var notices = (canonical.meta.notices || []);
      if (notices.length) {
        h += '<div class="ck-notices">' + notices.map(function (n) {
          return '<div class="ck-notice">' + esc(n) + "</div>";
        }).join("") + "</div>";
      }
      coordFindings().forEach(function (f) {
        h += '<div class="ck-notice ' + (f.level === "err" ? "ck-err" : "") + '">' + esc(f.text) + "</div>";
      });
      var dups = duplicateCount();
      if (dups) {
        h += '<div class="ck-chips"><button type="button" class="ck-chip ck-act" data-act="dedupe">' + dups +
          " duplicate row" + (dups > 1 ? "s" : "") + " — remove</button></div>";
      }
      return h;
    }

    function fieldsHTML(stats) {
      var s = canonical.schema, rows = canonical.rows;
      var h = '<div class="ck-fields">';
      s.forEach(function (c, ci) {
        var st = stats[c.name] || { distinct: 0, filled: 0, samples: [] };
        var role = roleOf(c, stats);
        var hasGaps = st.filled > 0 && st.filled < rows.length;
        var issue = (c.issues || [])[0];
        var sampleTxt = st.samples.length
          ? st.samples.slice(0, 3).map(function (v) { return esc(v.length > 26 ? v.slice(0, 25) + "…" : v); }).join(" · ")
          : "— empty —";

        h += '<div class="ck-field' + (c.ignored ? " off" : "") + '">' +
          '<div class="ck-field-top">' +
            '<input type="checkbox" class="ck-inc" data-ci="' + ci + '"' + (c.ignored ? "" : " checked") + ' title="Include this column in the layer" />' +
            '<span class="ck-fname" title="' + esc(c.name) + '">' + esc(c.name) + "</span>" +
            (c.derived ? '<span class="ck-gen">generated</span>' : "") +
            '<button type="button" class="ck-edit-btn' + (openEdit[c.name] ? " on" : "") + '" data-ci="' + ci + '" title="Rename or change the type" aria-label="Edit column">✎</button>' +
          "</div>" +
          '<div class="ck-meta">' +
            '<span class="ck-type-badge ck-tb-' + c.type + '">' + (TYPE_LABEL[c.type] || c.type) + "</span>" +
            '<span class="ck-role ck-role-' + role + '" title="' + esc(ROLE_HINT[role]) + '">' + ROLE_LABEL[role] + "</span>" +
          "</div>" +
          '<div class="ck-samples">' + sampleTxt + "</div>" +
          (issue ? '<div class="ck-issue" title="' + esc(ISSUE_TEXT[issue.code] || issue.code) + '">⚠ ' + issue.count + " " + esc(ISSUE_TEXT[issue.code] || issue.code) + "</div>" : "") +
          '<div class="ck-edit"' + (openEdit[c.name] ? "" : " hidden") + '>' +
            '<label class="ck-edit-row">Name<input class="ck-name" data-ci="' + ci + '" value="' + esc(c.name) + '" /></label>' +
            '<label class="ck-edit-row">Read as' +
              '<select class="ck-type" data-ci="' + ci + '">' +
                ["auto", "string", "number", "date", "boolean"].map(function (t) {
                  var sel = (c.forced ? c.forced === t : t === "auto") ? " selected" : "";
                  var lbl = t === "auto" ? "auto (" + (TYPE_LABEL[c.type] || c.type) + ")" : (TYPE_LABEL[t] || t);
                  return '<option value="' + t + '"' + sel + ">" + lbl + "</option>";
                }).join("") +
              "</select></label>" +
            (hasGaps ? '<button type="button" class="ck-mini" data-act="filldown" data-ci="' + ci + '" title="Copy each entry into the empty cells below it (merged-cell exports)">Fill empty cells ↓</button>' : "") +
          "</div>" +
        "</div>";
      });
      h += "</div>";

      // derived count column helper — only when there's a yes/no grid to count
      var boolCols = s.filter(function (c) { return c.type === "boolean" && !c.ignored; });
      if (boolCols.length >= 2) {
        h += '<details class="ck-derive"><summary>Add a count column (from the yes/no columns)</summary>' +
          '<p class="hint">Counts, per row, how many of the picked columns say yes — a number the map can colour by.</p>' +
          '<div class="ck-derive-cols">' + boolCols.map(function (c) {
            return '<label><input type="checkbox" class="ck-dc" value="' + esc(c.name) + '" checked /> ' + esc(c.name) + "</label>";
          }).join("") + "</div>" +
          '<div class="ck-derive-row"><input type="text" class="ck-dc-name" value="Count" maxlength="60" />' +
          '<button type="button" class="btn secondary ck-mini2" data-act="derive">Add column</button></div></details>';
      }
      return h;
    }

    function rowsHTML(stats) {
      var s = canonical.schema, rows = canonical.rows;
      var idx = ensureSample();
      var h = '<div class="ck-scroll"><table class="ck-table"><thead><tr>';
      s.forEach(function (c) {
        h += '<th class="' + (c.ignored ? "ck-ignored" : "") + '">' + esc(c.name) +
          ' <span class="ck-th-type">' + (TYPE_LABEL[c.type] || c.type) + "</span></th>";
      });
      h += "</tr></thead><tbody>";
      idx.forEach(function (ri) {
        var r = rows[ri];
        h += "<tr>";
        s.forEach(function (c) {
          var v = r[c.name];
          var empty = v === "" || v == null;
          var off = !empty && !c.ignored && c.type !== "string" && typeof v === "string";
          var cls = "ck-" + c.type + (c.ignored ? " ck-ignored" : "") + (off ? " ck-off" : "") + (empty ? " ck-empty" : "");
          var shown = v === true ? "yes" : v === false ? "no" : v;
          h += '<td class="ck-cell ' + cls + '" contenteditable="true" spellcheck="false"' +
            ' data-col="' + esc(c.name) + '" data-row="' + ri + '"' +
            ' title="' + (off ? "doesn't fit what this column holds — click to fix" : "click to edit") + '">' + esc(shown) + "</td>";
        });
        h += "</tr>";
      });
      h += "</tbody></table></div>";
      h += '<p class="ck-foot">' + (rows.length > PREVIEW_ROWS
        ? "Showing " + idx.length + " of " + rows.length.toLocaleString() + " rows, sampled at random — click any cell to edit. Every row is used on the map."
        : rows.length.toLocaleString() + " row" + (rows.length === 1 ? "" : "s") + " — click any cell to edit.") + "</p>";
      return h;
    }

    function draw() {
      var stats = buildStats();
      var included = canonical.schema.filter(function (c) { return !c.ignored; }).length;
      var h = headerHTML();
      h += '<div class="ck-viewtabs" role="tablist">' +
        '<button type="button" class="ck-viewtab' + (view === "fields" ? " on" : "") + '" data-view="fields">Columns · ' + included + " on</button>" +
        '<button type="button" class="ck-viewtab' + (view === "rows" ? " on" : "") + '" data-view="rows">Preview rows</button>' +
      "</div>";
      h += view === "fields" ? fieldsHTML(stats) : rowsHTML(stats);
      container.innerHTML = h;

      /* wire — view tabs */
      container.querySelectorAll(".ck-viewtab").forEach(function (b) {
        b.addEventListener("click", function () { view = b.dataset.view; draw(); });
      });
      var dd = container.querySelector('[data-act="dedupe"]');
      if (dd) dd.addEventListener("click", dedupeRows);

      if (view === "fields") {
        container.querySelectorAll(".ck-inc").forEach(function (cb) {
          cb.addEventListener("change", function () { toggleInclude(canonical.schema[Number(cb.dataset.ci)].name); });
        });
        container.querySelectorAll(".ck-edit-btn").forEach(function (b) {
          b.addEventListener("click", function () {
            var nm = canonical.schema[Number(b.dataset.ci)].name;
            openEdit[nm] = !openEdit[nm];
            draw();
          });
        });
        container.querySelectorAll(".ck-name").forEach(function (inp) {
          inp.addEventListener("change", function () { renameColumn(canonical.schema[Number(inp.dataset.ci)].name, inp.value); });
        });
        container.querySelectorAll(".ck-type").forEach(function (sel) {
          sel.addEventListener("change", function () { setType(canonical.schema[Number(sel.dataset.ci)].name, sel.value); });
        });
        container.querySelectorAll('[data-act="filldown"]').forEach(function (b) {
          b.addEventListener("click", function () { fillDown(canonical.schema[Number(b.dataset.ci)].name); });
        });
        var dv = container.querySelector('[data-act="derive"]');
        if (dv) dv.addEventListener("click", function () {
          var cols = Array.prototype.slice.call(container.querySelectorAll(".ck-dc:checked")).map(function (c) { return c.value; });
          if (cols.length) addCountColumn(container.querySelector(".ck-dc-name").value, cols);
        });
      } else {
        container.querySelectorAll(".ck-cell").forEach(function (td) {
          td.addEventListener("blur", function () {
            setCell(td.dataset.col, Number(td.dataset.row), td.textContent.trim());
          });
          td.addEventListener("keydown", function (e) {
            if (e.key === "Enter") { e.preventDefault(); td.blur(); }
          });
        });
      }
    }

    draw();
    return { redraw: draw };
  }

  window.LokaCheck = { render: render };
})();
