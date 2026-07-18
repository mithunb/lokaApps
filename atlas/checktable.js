/* LOKA Atlas — the "Check & fix" table (window.LokaCheck).
   Renders the canonical import as a typed, color-coded, correctable table —
   the user SEES exactly what will land on the map before anything is sent.

   Column tools: rename, type override, ignore, fill-down (merged-cell exports
   leave group values only on each group's first row). Table tools: remove
   duplicate rows, derived count column (turns a yes/no grid into a mappable
   number). A coordinate sanity panel flags projected (UTM-looking) exports
   and swapped lat/lng before the join step ever runs.

   LokaCheck.render(container, canonical, {onChange}) mutates `canonical` in
   place and calls onChange(canonical) after every edit. */
(function () {
  "use strict";

  var SHOW_ROWS = 100;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var TYPE_LABEL = { string: "text", number: "number", date: "date", boolean: "yes / no" };
  var ISSUE_TEXT = {
    "mixed-types": "values that don't fit the column type",
    "mostly-empty": "empty cells",
    "empty-column": "the whole column is empty",
    "ambiguous-dates": "dates that could be day-first or month-first (read as day-first)",
  };

  function render(container, canonical, opts) {
    opts = opts || {};
    var forced = {};
    canonical.schema.forEach(function (c) { if (c.forced) forced[c.name] = c.forced; });

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

    /* ---------------- edits ---------------- */

    function renameColumn(oldName, newName) {
      newName = String(newName || "").trim().replace(/\s+/g, " ").slice(0, 80);
      if (!newName || newName === oldName) return;
      var taken = canonical.schema.some(function (c) { return c.name.toLowerCase() === newName.toLowerCase(); });
      if (taken) return;
      canonical.schema.forEach(function (c) { if (c.name === oldName) c.name = newName; });
      canonical.rows.forEach(function (r) { r[newName] = r[oldName]; delete r[oldName]; });
      if (forced[oldName]) { forced[newName] = forced[oldName]; delete forced[oldName]; }
      retypeAll(); changed();
    }

    function setType(name, type) {
      if (type === "auto") delete forced[name];
      else forced[name] = type;
      retypeAll(); changed();
    }

    function toggleIgnore(name) {
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
      // schema entry first — retypeAll() rebuilds from schema names
      canonical.schema.push({ name: name, type: "number", issues: [], derived: true });
      retypeAll();
      changed();
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
        return min > 1000 && max > 10000; // way past any lat/lng
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

    function draw() {
      var s = canonical.schema, rows = canonical.rows;
      var h = "";

      // notices
      var notices = (canonical.meta.notices || []);
      if (notices.length) {
        h += '<div class="ck-notices">' + notices.map(function (n) {
          return '<div class="ck-notice">' + esc(n) + "</div>";
        }).join("") + "</div>";
      }
      coordFindings().forEach(function (f) {
        h += '<div class="ck-notice ' + (f.level === "err" ? "ck-err" : "") + '">' + esc(f.text) + "</div>";
      });

      // issue summary chips
      var chips = [];
      s.forEach(function (c) {
        (c.issues || []).forEach(function (iss) {
          chips.push('<span class="ck-chip" title="' + esc(ISSUE_TEXT[iss.code] || iss.code) + '">' +
            esc(c.name) + ": " + iss.count + " " + esc(ISSUE_TEXT[iss.code] || iss.code) + "</span>");
        });
      });
      var dups = duplicateCount();
      if (dups) {
        chips.push('<button type="button" class="ck-chip ck-act" data-act="dedupe">' + dups +
          " duplicate row" + (dups > 1 ? "s" : "") + " — remove</button>");
      }
      if (chips.length) h += '<div class="ck-chips">' + chips.join(" ") + "</div>";

      // the table
      h += '<div class="ck-scroll"><table class="ck-table"><thead><tr>';
      s.forEach(function (c, ci) {
        var hasGaps = rows.some(function (r) { return r[c.name] === "" || r[c.name] == null; }) &&
                      rows.some(function (r) { return r[c.name] !== "" && r[c.name] != null; });
        h += '<th class="' + (c.ignored ? "ck-ignored" : "") + '">' +
          '<input class="ck-name" data-ci="' + ci + '" value="' + esc(c.name) + '" title="Rename column" />' +
          '<div class="ck-coltools">' +
            '<select class="ck-type" data-ci="' + ci + '" title="Column type">' +
              ["auto", "string", "number", "date", "boolean"].map(function (t) {
                var sel = (c.forced ? c.forced === t : t === "auto") ? " selected" : "";
                var lbl = t === "auto" ? "auto: " + (TYPE_LABEL[c.type] || c.type) : (TYPE_LABEL[t] || t);
                return '<option value="' + t + '"' + sel + ">" + lbl + "</option>";
              }).join("") +
            "</select>" +
            (hasGaps ? '<button type="button" class="ck-mini" data-act="filldown" data-ci="' + ci + '" title="Copy each value into the empty cells below it (merged-cell exports)">fill ↓</button>' : "") +
            '<button type="button" class="ck-mini' + (c.ignored ? " on" : "") + '" data-act="ignore" data-ci="' + ci + '" title="Leave this column out of the layer">' + (c.ignored ? "ignored" : "skip") + "</button>" +
          "</div></th>";
      });
      h += "</tr></thead><tbody>";
      rows.slice(0, SHOW_ROWS).forEach(function (r) {
        h += "<tr>";
        s.forEach(function (c) {
          var v = r[c.name];
          var empty = v === "" || v == null;
          var off = !empty && !c.ignored && c.type !== "string" && typeof v === "string";
          var cls = "ck-" + c.type + (c.ignored ? " ck-ignored" : "") + (off ? " ck-off" : "") + (empty ? " ck-empty" : "");
          var shown = v === true ? "yes" : v === false ? "no" : v;
          h += '<td class="' + cls + '" title="' + (off ? "doesn't fit the column type" : "") + '">' + esc(shown) + "</td>";
        });
        h += "</tr>";
      });
      h += "</tbody></table></div>";
      if (rows.length > SHOW_ROWS) {
        h += '<p class="ck-foot">Showing the first ' + SHOW_ROWS + " of " + rows.length.toLocaleString() + " rows — every row is used on the map.</p>";
      } else {
        h += '<p class="ck-foot">' + rows.length.toLocaleString() + " row" + (rows.length === 1 ? "" : "s") + ".</p>";
      }

      // derived count column helper — only offered when there's a yes/no grid to count
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

      container.innerHTML = h;

      /* wire */
      container.querySelectorAll(".ck-name").forEach(function (inp) {
        inp.addEventListener("change", function () {
          renameColumn(canonical.schema[Number(inp.dataset.ci)].name, inp.value);
        });
      });
      container.querySelectorAll(".ck-type").forEach(function (sel) {
        sel.addEventListener("change", function () {
          setType(canonical.schema[Number(sel.dataset.ci)].name, sel.value);
        });
      });
      container.querySelectorAll('[data-act="filldown"]').forEach(function (b) {
        b.addEventListener("click", function () { fillDown(canonical.schema[Number(b.dataset.ci)].name); });
      });
      container.querySelectorAll('[data-act="ignore"]').forEach(function (b) {
        b.addEventListener("click", function () { toggleIgnore(canonical.schema[Number(b.dataset.ci)].name); });
      });
      var dd = container.querySelector('[data-act="dedupe"]');
      if (dd) dd.addEventListener("click", dedupeRows);
      var dv = container.querySelector('[data-act="derive"]');
      if (dv) dv.addEventListener("click", function () {
        var cols = Array.prototype.slice.call(container.querySelectorAll(".ck-dc:checked")).map(function (c) { return c.value; });
        if (cols.length) addCountColumn(container.querySelector(".ck-dc-name").value, cols);
      });
    }

    draw();
    return { redraw: draw };
  }

  window.LokaCheck = { render: render };
})();
