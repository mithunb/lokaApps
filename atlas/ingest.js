/* LOKA Atlas — file ingest & canonicalization (window.LokaIngest).
   Every input format converges on ONE canonical form the rest of the bench
   trusts:

     { schema:  [{name, type: 'string'|'number'|'date'|'boolean', issues:[{code,count,rows}]}],
       rows:    [{col: typedValue}],       // numbers as numbers, booleans real, dates ISO
       meta:    {sourceName, sourceType, encoding, sheet, truncated:{rows,cols}, notices:[]} }

   Files are sniffed by CONTENT (magic bytes / first structural character);
   the extension only breaks ties. Text is decoded as UTF-8 first and re-read
   as windows-1252 when the replacement-character count says the guess was
   wrong. Nothing here talks to the network — parsing stays in the browser. */
(function () {
  "use strict";

  var MAX_FILE_BYTES = 25 * 1024 * 1024;
  var MAX_ROWS = 5000, MAX_COLS = 40;
  var TYPE_DOMINANCE = 0.95;            // share of non-empty values a type needs to win
  var ISSUE_ROWS_KEPT = 20;

  /* ================= entry points ================= */

  // fromFile(file, cb) → cb(err, result)
  //   result: {kind:'table', canonical}
  //         | {kind:'sheets', name, sheets:[{name, rows, cols}], pick(sheetName, cb2)}
  //         | {kind:'unsupported', message}
  function fromFile(file, cb) {
    var name = file.name || "file";
    if (file.size > MAX_FILE_BYTES) {
      return cb(null, { kind: "unsupported", message:
        "That file is " + Math.round(file.size / 1048576) + " MB — the limit is 25 MB. " +
        "Trim it to the columns and rows you need, or export a region subset." });
    }
    var rd = new FileReader();
    rd.onerror = function () { cb(new Error("couldn't read the file")); };
    rd.onload = function () { sniff(name, rd.result, cb); };
    rd.readAsArrayBuffer(file);
  }

  function fromPaste(text) {
    var parsed = Papa.parse(String(text || "").replace(/^﻿/, ""), {
      header: false, skipEmptyLines: "greedy",
    });
    return tableFromGrid("pasted-table", "paste", "utf-8", "", parsed.data || []);
  }

  /* ================= content sniffing ================= */

  function sniff(name, buf, cb) {
    var bytes = new Uint8Array(buf);
    if (!bytes.length) return cb(null, { kind: "unsupported", message: "That file is empty." });

    // PK zip container: xlsx/xlsm — or a zipped shapefile
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      if (/\.(zip|shp|dbf)$/i.test(name)) return cb(null, shapefileExplainer());
      return readWorkbook(name, buf, cb);
    }
    // legacy .xls (OLE compound file)
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf) return readWorkbook(name, buf, cb);
    if (/\.(shp|dbf)$/i.test(name)) return cb(null, shapefileExplainer());

    var dec = decodeText(buf);
    var text = dec.text.replace(/^﻿/, "");
    var head = text.slice(0, 4000).replace(/^\s+/, "");

    if (head[0] === "{" || head[0] === "[") return cb(null, fromJsonText(name, dec, text));
    if (head[0] === "<") return cb(null, fromXmlText(name, dec, text));

    // CSV / TSV — Papa auto-detects the delimiter
    var parsed = Papa.parse(text, { header: false, skipEmptyLines: "greedy" });
    if (!parsed.data || !parsed.data.length) {
      return cb(null, { kind: "unsupported", message: "Couldn't find a table in that file." });
    }
    cb(null, tableFromGrid(name, "csv", dec.encoding, "", parsed.data));
  }

  function shapefileExplainer() {
    return { kind: "unsupported", message:
      "That looks like a shapefile. Shapefiles aren't supported yet — open it in QGIS " +
      "(free, qgis.org) and export it as GeoJSON (right-click the layer → Export → " +
      "Save Features As → GeoJSON), then drop that file here." };
  }

  /* ---- encoding: UTF-8 first, windows-1252 when the mojibake count objects ---- */
  function decodeText(buf) {
    var utf8 = new TextDecoder("utf-8").decode(buf);
    var bad = (utf8.match(/�/g) || []).length;
    if (bad === 0) return { text: utf8, encoding: "utf-8" };
    try {
      var cp = new TextDecoder("windows-1252").decode(buf);
      // windows-1252 never produces U+FFFD, so any replacement chars meant UTF-8 was wrong
      return { text: cp, encoding: "windows-1252" };
    } catch (e) { return { text: utf8, encoding: "utf-8" }; }
  }

  /* ================= Excel workbooks ================= */

  var xlsxLoading = null;
  function withXlsx(cb) {
    if (window.XLSX) return cb(null);
    if (!xlsxLoading) {
      xlsxLoading = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = "./vendor/xlsx.full.min.js";
        s.onload = resolve;
        s.onerror = function () { reject(new Error("couldn't load the Excel reader")); };
        document.head.appendChild(s);
      });
    }
    xlsxLoading.then(function () { cb(null); }, function (e) { cb(e); });
  }

  function readWorkbook(name, buf, cb) {
    withXlsx(function (err) {
      if (err) return cb(err);
      var wb;
      try {
        wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
      } catch (e) {
        return cb(null, { kind: "unsupported", message: "Couldn't read that Excel file: " + e.message });
      }
      var sheets = wb.SheetNames.map(function (sn) {
        var ref = (wb.Sheets[sn] && wb.Sheets[sn]["!ref"]) || "A1:A1";
        var rng = XLSX.utils.decode_range(ref);
        return { name: sn, rows: rng.e.r + 1, cols: rng.e.c + 1 };
      });
      var pick = function (sheetName, cb2) {
        var ws = wb.Sheets[sheetName];
        if (!ws) return cb2(new Error("no such sheet"));
        // raw grid (arrays of arrays) so WE control headers and typing
        var grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });
        grid = grid.map(function (row) {
          return row.map(function (v) {
            if (v instanceof Date) return isoDate(v);
            return v;
          });
        });
        cb2(null, tableFromGrid(name, "excel", "", sheetName, grid));
      };
      // single real sheet: no picker needed
      var real = sheets.filter(function (s) { return s.rows > 0 && s.cols > 0; });
      if (real.length === 1) return pick(real[0].name, function (e, canonical) {
        cb(e, e ? null : { kind: "table", canonical: canonical });
      });
      cb(null, { kind: "sheets", name: name, sheets: sheets, pick: pick });
    });
  }

  function isoDate(d) {
    if (isNaN(d.getTime())) return "";
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  /* ================= JSON / XML ================= */

  function fromJsonText(name, dec, text) {
    var data;
    try { data = JSON.parse(text); }
    catch (e) { return { kind: "unsupported", message: "That file isn't valid JSON: " + e.message }; }
    if (data && (data.type === "FeatureCollection" || data.type === "Feature")) {
      var fc = data.type === "Feature" ? { type: "FeatureCollection", features: [data] } : data;
      return geojsonToTable(name, dec.encoding, fc);
    }
    var list = Array.isArray(data) ? data
      : (data && Array.isArray(data.data)) ? data.data
      : (data && Array.isArray(data.rows)) ? data.rows
      : (data && Array.isArray(data.records)) ? data.records
      : null;
    if (!list || !list.length || typeof list[0] !== "object") {
      return { kind: "unsupported", message: "Couldn't find a table in that JSON — expected an array of objects, or GeoJSON." };
    }
    return tableFromObjects(name, "json", dec.encoding, list);
  }

  function fromXmlText(name, dec, text) {
    var doc = new DOMParser().parseFromString(text, "text/xml");
    if (doc.getElementsByTagName("parsererror").length) {
      return { kind: "unsupported", message: "Couldn't read that XML file." };
    }
    var root = doc.documentElement ? doc.documentElement.localName.toLowerCase() : "";
    if (root === "kml") return kmlToTable(name, dec.encoding, doc);
    if (root === "gpx") return gpxToTable(name, dec.encoding, doc);
    return { kind: "unsupported", message: "Unrecognised XML — KML and GPX are the supported XML formats." };
  }

  /* ---- spatial → point table (full geometry lands with the spatial track) ---- */

  function geojsonToTable(name, encoding, fc) {
    var rows = [], skipped = 0;
    (fc.features || []).forEach(function (f) {
      var g = f && f.geometry;
      var c = g && g.type === "Point" ? g.coordinates
        : (g && g.type === "MultiPoint" && g.coordinates.length) ? g.coordinates[0] : null;
      if (!c || c.length < 2) { skipped++; return; }
      var row = {};
      Object.keys((f && f.properties) || {}).forEach(function (k) {
        var v = f.properties[k];
        row[k] = v != null && typeof v === "object" ? JSON.stringify(v) : v;
      });
      row.longitude = c[0];
      row.latitude = c[1];
      rows.push(row);
    });
    if (!rows.length) {
      return { kind: "unsupported", message:
        "No point features found — polygon and line layers aren't supported yet. Export points, or a table joined by place names." };
    }
    var t = tableFromObjects(name, "geojson", encoding, rows);
    if (skipped && t.kind === "table") {
      t.canonical.meta.notices.push(skipped + " non-point feature" + (skipped > 1 ? "s were" : " was") + " skipped — points carried through.");
    }
    return t;
  }

  function xtags(el, n) { return Array.prototype.slice.call(el.getElementsByTagNameNS("*", n)); }
  function xtext(el, n) { var x = xtags(el, n)[0]; return x ? x.textContent.trim() : ""; }

  function kmlToTable(name, encoding, doc) {
    var rows = [], skipped = 0;
    xtags(doc, "Placemark").forEach(function (pm) {
      var pt = xtags(pm, "Point")[0];
      var coords = pt ? xtext(pt, "coordinates") : "";
      var c = coords ? coords.split(",") : [];
      if (c.length < 2) { skipped++; return; }
      var row = { name: xtext(pm, "name"), description: xtext(pm, "description") };
      xtags(pm, "Data").forEach(function (d) { var k = d.getAttribute("name"); if (k) row[k] = xtext(d, "value"); });
      xtags(pm, "SimpleData").forEach(function (d) { var k = d.getAttribute("name"); if (k) row[k] = d.textContent.trim(); });
      row.longitude = parseFloat(c[0]);
      row.latitude = parseFloat(c[1]);
      rows.push(row);
    });
    if (!rows.length) return { kind: "unsupported", message: "No point placemarks found in that KML — polygon and line layers aren't supported yet." };
    var t = tableFromObjects(name, "kml", encoding, rows);
    if (skipped && t.kind === "table") {
      t.canonical.meta.notices.push(skipped + " non-point placemark" + (skipped > 1 ? "s were" : " was") + " skipped — points carried through.");
    }
    return t;
  }

  function gpxToTable(name, encoding, doc) {
    var rows = [];
    xtags(doc, "wpt").forEach(function (w) {
      var lat = parseFloat(w.getAttribute("lat")), lng = parseFloat(w.getAttribute("lon"));
      if (isNaN(lat) || isNaN(lng)) return;
      rows.push({ name: xtext(w, "name"), description: xtext(w, "desc"),
        elevation: xtext(w, "ele"), latitude: lat, longitude: lng });
    });
    if (!rows.length) return { kind: "unsupported", message: "No waypoints found in that GPX file — tracks and routes aren't supported yet." };
    return tableFromObjects(name, "gpx", encoding, rows);
  }

  /* ================= grid / objects → canonical ================= */

  // A grid (array of row arrays) whose first non-empty row is the header row.
  function tableFromGrid(name, sourceType, encoding, sheet, grid) {
    // drop leading fully-empty rows so a decorative first line doesn't become headers
    var start = 0;
    while (start < grid.length && rowEmpty(grid[start])) start++;
    if (start >= grid.length) return { kind: "unsupported", message: "That table looks empty." };

    var headerRow = grid[start];
    var totalCols = headerRow.length;
    var names = [], seen = {}, notices = [];
    var blank = 0, renamed = 0;
    for (var i = 0; i < Math.min(totalCols, MAX_COLS); i++) {
      var h = headerRow[i] == null ? "" : String(headerRow[i]).trim().replace(/\s+/g, " ");
      if (!h) { blank++; h = "col_" + (i + 1); }
      var base = h, n = 2;
      while (seen[h.toLowerCase()]) { h = base + "_" + n++; renamed++; }
      seen[h.toLowerCase()] = 1;
      names.push(h.slice(0, 80));
    }
    if (blank) notices.push(blank + " column" + (blank > 1 ? "s" : "") + " had no header — named col_1, col_2, … Rename them below.");
    if (renamed) notices.push(renamed + " duplicate header" + (renamed > 1 ? "s were" : " was") + " suffixed to stay unique.");

    var body = [];
    for (var r = start + 1; r < grid.length; r++) {
      if (rowEmpty(grid[r])) continue;
      var o = {};
      for (var c = 0; c < names.length; c++) {
        var v = grid[r][c];
        o[names[c]] = v == null ? "" : v;
      }
      body.push(o);
    }
    return finishTable(name, sourceType, encoding, sheet, names, body, totalCols, notices);
  }

  function tableFromObjects(name, sourceType, encoding, list) {
    var names = [], seen = {};
    list.forEach(function (o) {
      Object.keys(o || {}).forEach(function (k) { if (!seen[k]) { seen[k] = 1; names.push(k); } });
    });
    var totalCols = names.length;
    names = names.slice(0, MAX_COLS);
    var body = list.map(function (o) {
      var r = {};
      names.forEach(function (k) {
        var v = o ? o[k] : undefined;
        r[k] = v == null ? "" : (typeof v === "object" ? JSON.stringify(v) : v);
      });
      return r;
    });
    return finishTable(name, sourceType, encoding, "", names, body, totalCols, []);
  }

  function rowEmpty(row) {
    if (!row) return true;
    for (var i = 0; i < row.length; i++) {
      if (row[i] != null && String(row[i]).trim() !== "") return false;
    }
    return true;
  }

  function finishTable(name, sourceType, encoding, sheet, names, body, totalCols, notices) {
    var truncated = { rows: 0, cols: 0 };
    if (body.length > MAX_ROWS) { truncated.rows = body.length - MAX_ROWS; body = body.slice(0, MAX_ROWS); }
    if (totalCols > MAX_COLS) truncated.cols = totalCols - MAX_COLS;
    if (!names.length || !body.length) return { kind: "unsupported", message: "That table looks empty." };

    var typed = typeColumns(names, body);
    var canonical = {
      schema: typed.schema,
      rows: typed.rows,
      meta: {
        sourceName: name, sourceType: sourceType, encoding: encoding || "", sheet: sheet || "",
        truncated: truncated, notices: notices.slice(),
      },
    };
    if (encoding === "windows-1252") canonical.meta.notices.push("The file wasn't UTF-8 — read as Windows-1252 so accented characters survive.");
    if (truncated.rows) canonical.meta.notices.push("Only the first " + MAX_ROWS.toLocaleString() + " rows were kept — " + truncated.rows.toLocaleString() + " more were cut. Split the file if you need them all.");
    if (truncated.cols) canonical.meta.notices.push("Only the first " + MAX_COLS + " columns were kept — " + truncated.cols + " more were cut.");
    return { kind: "table", canonical: canonical };
  }

  /* ================= typing ================= */

  var BOOL_TRUE = /^(true|yes)$/i, BOOL_FALSE = /^(false|no)$/i;
  // 1,234 / 1 234 / 1234.5 / -7 / 12% — but NOT dates or empty
  var NUM_RE = /^-?(\d{1,3}([, ]\d{3})*|\d+)(\.\d+)?%?$/;
  var ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})([T ].*)?$/;
  var DMY_DATE = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/;

  function classify(v) {
    if (typeof v === "number") return isFinite(v) ? "number" : "string";
    if (typeof v === "boolean") return "boolean";
    var s = String(v).trim();
    if (s === "") return "empty";
    if (BOOL_TRUE.test(s) || BOOL_FALSE.test(s)) return "boolean";
    if (NUM_RE.test(s)) return "number";
    if (ISO_DATE.test(s) || DMY_DATE.test(s)) return "date";
    return "string";
  }

  function coerce(v, type) {
    if (type === "number") {
      if (typeof v === "number") return v;
      var n = Number(String(v).trim().replace(/%$/, "").replace(/[, ](?=\d{3}\b)/g, "").replace(/ /g, ""));
      return isFinite(n) ? n : String(v);
    }
    if (type === "boolean") {
      if (typeof v === "boolean") return v;
      return BOOL_TRUE.test(String(v).trim());
    }
    if (type === "date") {
      var s = String(v).trim();
      var m = ISO_DATE.exec(s);
      if (m) return m[1] + "-" + pad2(m[2]) + "-" + pad2(m[3]);
      m = DMY_DATE.exec(s);
      if (m) {
        // day-first (Indian/European convention); flagged as ambiguous when it could be either
        var d = Number(m[1]), mo = Number(m[2]);
        if (d > 12 && mo <= 12) return m[3] + "-" + pad2(m[2]) + "-" + pad2(m[1]);
        if (mo > 12 && d <= 12) return m[3] + "-" + pad2(m[1]) + "-" + pad2(m[2]); // clearly month-first
        return m[3] + "-" + pad2(m[2]) + "-" + pad2(m[1]);
      }
      return String(v);
    }
    return typeof v === "string" ? v : String(v);
  }
  function pad2(x) { var n = Number(x); return (n < 10 ? "0" : "") + n; }

  // Decide each column's type by dominance; coerce conforming values, keep the
  // rest as strings and record them as issues the Check step can show.
  // forced: {colName: type} — user overrides from the Check step beat dominance.
  function typeColumns(names, body, forced) {
    forced = forced || {};
    var schema = names.map(function (nm) {
      var counts = { number: 0, boolean: 0, date: 0, string: 0, empty: 0 };
      var ambiguousDates = 0;
      body.forEach(function (r) {
        var cls = classify(r[nm]);
        counts[cls]++;
        if (cls === "date") {
          var m = DMY_DATE.exec(String(r[nm]).trim());
          if (m && Number(m[1]) <= 12 && Number(m[2]) <= 12) ambiguousDates++;
        }
      });
      var filled = body.length - counts.empty;
      var type = "string";
      if (forced[nm]) {
        type = forced[nm];
      } else if (filled > 0) {
        var order = ["boolean", "number", "date"];
        for (var i = 0; i < order.length; i++) {
          if (counts[order[i]] / filled >= TYPE_DOMINANCE) { type = order[i]; break; }
        }
      }
      var issues = [];
      if (filled > 0 && type !== "string") {
        var offenders = [];
        body.forEach(function (r, idx) {
          var cls = classify(r[nm]);
          if (cls !== "empty" && cls !== type && offenders.length < ISSUE_ROWS_KEPT) offenders.push(idx);
        });
        var offCount = filled - counts[type];
        if (offCount > 0) issues.push({ code: "mixed-types", count: offCount, rows: offenders });
      } else if (filled > 0 && counts.string / filled < TYPE_DOMINANCE &&
                 (counts.number > 0 || counts.date > 0 || counts.boolean > 0) &&
                 counts.string > 0) {
        issues.push({ code: "mixed-types", count: Math.min(counts.string, filled - counts.string), rows: [] });
      }
      if (counts.empty > 0 && filled > 0 && counts.empty / body.length > 0.3) {
        issues.push({ code: "mostly-empty", count: counts.empty, rows: [] });
      }
      if (filled === 0) issues.push({ code: "empty-column", count: body.length, rows: [] });
      if (type === "date" && ambiguousDates > 0) {
        issues.push({ code: "ambiguous-dates", count: ambiguousDates, rows: [] });
      }
      return { name: nm, type: type, issues: issues };
    });

    var rows = body.map(function (r) {
      var o = {};
      schema.forEach(function (col) {
        var v = r[col.name];
        if (v == null || String(v).trim() === "") { o[col.name] = ""; return; }
        o[col.name] = classify(v) === col.type ? coerce(v, col.type)
          : (typeof v === "string" ? v : String(v));
      });
      return o;
    });
    return { schema: schema, rows: rows };
  }

  /* ================= exports ================= */

  window.LokaIngest = {
    fromFile: fromFile,
    fromPaste: fromPaste,
    retype: typeColumns,      // re-run typing after Check-step edits
    isoDate: isoDate,
    MAX_ROWS: MAX_ROWS,
    MAX_COLS: MAX_COLS,
  };
})();
