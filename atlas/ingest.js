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

  // Where this script lives — lazy-loaded vendor files (the Excel reader) must
  // resolve relative to ingest.js itself, not the page: the bench sits next to
  // it but the setup wizard includes it from a subdirectory.
  var SCRIPT_BASE = (function () {
    var s = document.currentScript;
    if (!s || !s.src) {
      var tags = document.querySelectorAll('script[src*="ingest"]');
      s = tags.length ? tags[tags.length - 1] : null;
    }
    return s && s.src ? s.src.replace(/[^/]*$/, "") : "./";
  })();

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
        s.src = SCRIPT_BASE + "vendor/xlsx.full.min.js";
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
      return geojsonToSpatial(name, "geojson", dec.encoding, fc);
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
    if (root === "kml") return geojsonToSpatial(name, "kml", dec.encoding, kmlToFC(doc));
    if (root === "gpx") return geojsonToSpatial(name, "gpx", dec.encoding, gpxToFC(doc));
    return { kind: "unsupported", message: "Unrecognised XML — KML and GPX are the supported XML formats." };
  }

  /* ================= the spatial track =================
     GeoJSON / KML / GPX already know where they live — no place-matching
     needed. Every feature is normalized to clean WGS84 (altitude stripped,
     rings closed, winding per RFC 7946, degenerates dropped), one layer holds
     ONE geometry class (a class picker appears for mixed files), and the
     total vertex count is simplified down to a budget the browser and the
     draft pipeline can carry. */

  var VERTEX_BUDGET = 150000;
  var SELF_INTERSECT_MAX = 2000;   // O(n²) check cap per ring
  var MAX_SPATIAL_FEATURES = 5000;

  function classOf(type) {
    if (type === "Point" || type === "MultiPoint") return "point";
    if (type === "LineString" || type === "MultiLineString") return "line";
    if (type === "Polygon" || type === "MultiPolygon") return "polygon";
    return null;
  }
  var CLASS_LABEL = { point: "points", line: "lines", polygon: "areas (polygons)" };

  function geojsonToSpatial(name, sourceType, encoding, fc) {
    var buckets = { point: [], line: [], polygon: [] };
    var skipped = 0, exploded = 0;
    (fc.features || []).forEach(function (f) {
      var g = f && f.geometry;
      var cls = g && classOf(g.type);
      if (!cls) {
        // GeometryCollections and null geometries: keep the richest member if any
        if (g && g.type === "GeometryCollection" && Array.isArray(g.geometries)) {
          var best = null;
          g.geometries.forEach(function (m) { if (!best && classOf(m.type)) best = m; });
          if (best) { g = best; cls = classOf(best.type); }
        }
        if (!cls) { skipped++; return; }
      }
      var props = (f && f.properties) || {};
      if (g.type === "MultiPoint") {
        (g.coordinates || []).forEach(function (c) {
          buckets.point.push({ props: props, geom: { type: "Point", coordinates: c } });
        });
        if ((g.coordinates || []).length > 1) exploded++;
      } else {
        buckets[cls].push({ props: props, geom: g });
      }
    });

    var present = ["point", "line", "polygon"].filter(function (c) { return buckets[c].length; });
    if (!present.length) {
      // no usable geometry at all — fall back to the tabular track on properties
      var propRows = (fc.features || []).map(function (f) { return (f && f.properties) || {}; })
        .filter(function (p) { return Object.keys(p).length; });
      if (propRows.length) {
        var t = tableFromObjects(name, sourceType, encoding, propRows);
        if (t.kind === "table") t.canonical.meta.notices.push("The file had no usable geometry — its attribute table was read instead.");
        return t;
      }
      return { kind: "unsupported", message: "No usable features found in that file." };
    }

    var build = function (cls) {
      return buildSpatial(name, sourceType, encoding, buckets[cls], cls, {
        skipped: skipped, exploded: exploded,
        others: present.filter(function (c) { return c !== cls; })
          .map(function (c) { return buckets[c].length + " " + CLASS_LABEL[c]; }),
      });
    };
    if (present.length === 1) return build(present[0]);
    return {
      kind: "classes", name: name,
      classes: present.map(function (c) { return { cls: c, label: CLASS_LABEL[c], count: buckets[c].length }; }),
      pick: function (cls, cb) { cb(null, build(cls)); },
    };
  }

  /* ---- geometry cleaning (pure functions, no dependencies) ---- */

  function stripAlt(g) {
    (function walk(c) {
      if (typeof c[0] === "number") { if (c.length > 2) c.length = 2; return; }
      c.forEach(walk);
    })(g.coordinates);
    return g;
  }
  function coordsValid(g) {
    var ok = true;
    (function walk(c) {
      if (!ok || !Array.isArray(c)) { ok = false; return; }
      if (typeof c[0] === "number") {
        if (c.length < 2 || !isFinite(c[0]) || !isFinite(c[1]) ||
            c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90) ok = false;
      } else c.forEach(walk);
    })(g.coordinates);
    return ok;
  }
  function vertexCount(g) {
    var n = 0;
    (function walk(c) {
      if (typeof c[0] === "number") { n++; return; }
      c.forEach(walk);
    })(g.coordinates);
    return n;
  }
  function signedArea(ring) {
    var a = 0;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
    }
    return a / 2;
  }
  function samePt(a, b) { return a[0] === b[0] && a[1] === b[1]; }

  // close, deduplicate-endpoints, orient (outer CCW, holes CW), drop degenerates
  function cleanPolygonRings(rings, stats) {
    var out = [];
    rings.forEach(function (ring, ri) {
      var r = ring.slice();
      if (r.length && !samePt(r[0], r[r.length - 1])) { r.push(r[0].slice()); stats.closed++; }
      if (r.length < 4) { stats.degenerate++; return; }
      var area = signedArea(r);
      if (area === 0) { stats.degenerate++; return; }
      var wantCCW = ri === 0 && out.length === 0;   // first surviving ring is the outer
      var isCCW = area > 0;
      if (out.length === 0 ? !isCCW : isCCW) { r.reverse(); stats.rewound++; }
      out.push(r);
    });
    return out;
  }

  // flag (not fix) self-intersecting outer rings — O(n²) segment test, capped
  function ringSelfIntersects(ring) {
    var n = ring.length - 1;
    if (n > SELF_INTERSECT_MAX) return null;   // "not checked"
    function ccw(A, B, C) { return (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0]); }
    function cross(A, B, C, D) { return ccw(A, C, D) !== ccw(B, C, D) && ccw(A, B, C) !== ccw(A, B, D); }
    for (var i = 0; i < n; i++) {
      for (var j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;   // closing segment adjacency
        if (cross(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true;
      }
    }
    return false;
  }

  function simplifyLine(pts, tol) {
    if (typeof simplify !== "function" || pts.length < 3) return pts;
    var xs = pts.map(function (p) { return { x: p[0], y: p[1] }; });
    return simplify(xs, tol, true).map(function (p) { return [p.x, p.y]; });
  }
  function simplifyGeom(g, tol) {
    if (g.type === "LineString") {
      var s = simplifyLine(g.coordinates, tol);
      if (s.length >= 2) g.coordinates = s;
    } else if (g.type === "MultiLineString") {
      g.coordinates = g.coordinates.map(function (line) {
        var s = simplifyLine(line, tol);
        return s.length >= 2 ? s : line;
      });
    } else if (g.type === "Polygon") {
      g.coordinates = g.coordinates.map(function (ring) {
        var open = ring.slice(0, -1);
        var s = simplifyLine(open, tol);
        if (s.length >= 3) { s.push(s[0].slice()); return s; }
        return ring;
      });
    } else if (g.type === "MultiPolygon") {
      g.coordinates = g.coordinates.map(function (poly) {
        return poly.map(function (ring) {
          var open = ring.slice(0, -1);
          var s = simplifyLine(open, tol);
          if (s.length >= 3) { s.push(s[0].slice()); return s; }
          return ring;
        });
      });
    }
    return g;
  }

  function buildSpatial(name, sourceType, encoding, items, cls, ctx) {
    var notices = [];
    if (ctx.others && ctx.others.length) {
      notices.push("This layer keeps the " + CLASS_LABEL[cls] + " — the file also held " + ctx.others.join(" and ") +
        " (upload again and pick that class for a second layer).");
    }
    if (ctx.skipped) notices.push(ctx.skipped + " feature" + (ctx.skipped > 1 ? "s" : "") + " had no usable geometry and " + (ctx.skipped > 1 ? "were" : "was") + " skipped.");
    if (ctx.exploded) notices.push("Multi-point features were split into individual points.");
    var truncatedFeats = 0;
    if (items.length > MAX_SPATIAL_FEATURES) {
      truncatedFeats = items.length - MAX_SPATIAL_FEATURES;
      items = items.slice(0, MAX_SPATIAL_FEATURES);
      notices.push("Only the first " + MAX_SPATIAL_FEATURES.toLocaleString() + " features were kept — " + truncatedFeats.toLocaleString() + " more were cut.");
    }

    var stats = { closed: 0, rewound: 0, degenerate: 0, invalid: 0, selfIntersecting: 0, unchecked: 0 };
    var geoms = [], rows = [];
    items.forEach(function (it) {
      var g = { type: it.geom.type, coordinates: JSON.parse(JSON.stringify(it.geom.coordinates)) };
      stripAlt(g);
      if (!coordsValid(g)) { stats.invalid++; return; }
      if (g.type === "Polygon") {
        g.coordinates = cleanPolygonRings(g.coordinates, stats);
        if (!g.coordinates.length) { stats.degenerate++; return; }
      } else if (g.type === "MultiPolygon") {
        g.coordinates = g.coordinates.map(function (poly) { return cleanPolygonRings(poly, stats); })
          .filter(function (poly) { return poly.length; });
        if (!g.coordinates.length) { stats.degenerate++; return; }
      } else if (g.type === "LineString") {
        if (g.coordinates.length < 2) { stats.degenerate++; return; }
      } else if (g.type === "MultiLineString") {
        g.coordinates = g.coordinates.filter(function (l) { return l.length >= 2; });
        if (!g.coordinates.length) { stats.degenerate++; return; }
      }
      if (g.type === "Polygon" || g.type === "MultiPolygon") {
        var outer = g.type === "Polygon" ? g.coordinates[0] : g.coordinates[0][0];
        var si = ringSelfIntersects(outer);
        if (si === true) stats.selfIntersecting++;
        else if (si === null) stats.unchecked++;
      }
      var row = {};
      Object.keys(it.props).forEach(function (k) {
        var v = it.props[k];
        row[k] = v != null && typeof v === "object" ? JSON.stringify(v) : (v == null ? "" : v);
      });
      rows.push(row);
      geoms.push(g);
    });

    if (!geoms.length) return { kind: "unsupported", message: "No valid geometry survived cleaning — check the file's coordinates (they must be WGS84 longitude/latitude)." };

    if (stats.invalid) notices.push(stats.invalid + " feature" + (stats.invalid > 1 ? "s" : "") + " had out-of-range coordinates (not WGS84?) and " + (stats.invalid > 1 ? "were" : "was") + " dropped.");
    if (stats.degenerate) notices.push(stats.degenerate + " degenerate shape" + (stats.degenerate > 1 ? "s were" : " was") + " dropped.");
    if (stats.closed) notices.push(stats.closed + " unclosed ring" + (stats.closed > 1 ? "s were" : " was") + " closed.");
    if (stats.rewound) notices.push(stats.rewound + " ring" + (stats.rewound > 1 ? "s" : "") + " had reversed winding — fixed.");
    if (stats.selfIntersecting) notices.push(stats.selfIntersecting + " polygon" + (stats.selfIntersecting > 1 ? "s look" : " looks") + " self-intersecting — the map will render them, but check the source if shapes look wrong.");
    if (stats.unchecked) notices.push(stats.unchecked + " large polygon" + (stats.unchecked > 1 ? "s were" : " was") + " not checked for self-intersection.");

    // vertex budget: escalate the simplification tolerance until it fits
    var total = 0;
    geoms.forEach(function (g) { total += vertexCount(g); });
    if (total > VERTEX_BUDGET && cls !== "point") {
      var tol = 0.00005, before = total;
      for (var k = 0; k < 8 && total > VERTEX_BUDGET; k++) {
        geoms.forEach(function (g) { simplifyGeom(g, tol); });
        total = 0;
        geoms.forEach(function (g) { total += vertexCount(g); });
        tol *= 2.5;
      }
      notices.push("The geometry was simplified to keep the map fast — " +
        Math.max(1, Math.round((total / before) * 100)) + "% of the original detail kept (" +
        before.toLocaleString() + " → " + total.toLocaleString() + " points).");
    }

    // properties → typed table (same canonicalization as the tabular track)
    var t = tableFromObjects(name, sourceType, encoding, rows.length ? rows : geoms.map(function () { return {}; }));
    if (t.kind !== "table") {
      // features with no properties at all still make a layer
      t = { kind: "table", canonical: { schema: [], rows: geoms.map(function () { return {}; }), meta: {
        sourceName: name, sourceType: sourceType, encoding: encoding || "", sheet: "",
        truncated: { rows: 0, cols: 0 }, notices: [] } } };
    }
    var canonical = t.canonical;
    // tableFromObjects can only have dropped trailing rows via MAX_ROWS — geoms are capped
    // at MAX_SPATIAL_FEATURES (= MAX_ROWS) above, so rows and geoms stay index-aligned
    canonical.geoms = geoms;
    canonical.geomIdx = canonical.rows.map(function (_, i) { return i; });
    canonical.meta.geometry = {
      class: cls,
      count: geoms.length,
      vertices: total,
      notices: notices.slice(),
    };
    notices.forEach(function (n) { canonical.meta.notices.push(n); });
    return { kind: "table", canonical: canonical };
  }

  /* ---- KML / GPX → GeoJSON, then the same spatial pipeline ---- */

  function xtags(el, n) { return Array.prototype.slice.call(el.getElementsByTagNameNS("*", n)); }
  function xtext(el, n) { var x = xtags(el, n)[0]; return x ? x.textContent.trim() : ""; }
  function kmlCoords(text) {
    return String(text || "").trim().split(/\s+/).map(function (tok) {
      var p = tok.split(",").map(Number);
      return [p[0], p[1]];
    }).filter(function (c) { return isFinite(c[0]) && isFinite(c[1]); });
  }

  function kmlToFC(doc) {
    var features = [];
    xtags(doc, "Placemark").forEach(function (pm) {
      var props = { name: xtext(pm, "name"), description: xtext(pm, "description") };
      xtags(pm, "Data").forEach(function (d) { var k = d.getAttribute("name"); if (k) props[k] = xtext(d, "value"); });
      xtags(pm, "SimpleData").forEach(function (d) { var k = d.getAttribute("name"); if (k) props[k] = d.textContent.trim(); });
      var geoms = [];
      function readGeom(el) {
        var tag = el.localName;
        if (tag === "Point") {
          var c = kmlCoords(xtext(el, "coordinates"))[0];
          if (c) geoms.push({ type: "Point", coordinates: c });
        } else if (tag === "LineString") {
          var line = kmlCoords(xtext(el, "coordinates"));
          if (line.length >= 2) geoms.push({ type: "LineString", coordinates: line });
        } else if (tag === "Polygon") {
          var rings = [];
          var outer = xtags(el, "outerBoundaryIs")[0];
          if (outer) rings.push(kmlCoords(xtext(outer, "coordinates")));
          xtags(el, "innerBoundaryIs").forEach(function (ib) { rings.push(kmlCoords(xtext(ib, "coordinates"))); });
          rings = rings.filter(function (r) { return r.length >= 3; });
          if (rings.length) geoms.push({ type: "Polygon", coordinates: rings });
        } else if (tag === "MultiGeometry") {
          Array.prototype.slice.call(el.children).forEach(readGeom);
        }
      }
      Array.prototype.slice.call(pm.children).forEach(readGeom);
      geoms.forEach(function (g) { features.push({ type: "Feature", properties: props, geometry: g }); });
    });
    return { type: "FeatureCollection", features: features };
  }

  function gpxToFC(doc) {
    var features = [];
    xtags(doc, "wpt").forEach(function (w) {
      var lat = parseFloat(w.getAttribute("lat")), lng = parseFloat(w.getAttribute("lon"));
      if (isNaN(lat) || isNaN(lng)) return;
      features.push({ type: "Feature",
        properties: { name: xtext(w, "name"), description: xtext(w, "desc"), elevation: xtext(w, "ele") },
        geometry: { type: "Point", coordinates: [lng, lat] } });
    });
    function segPts(seg) {
      return xtags(seg, "trkpt").concat(xtags(seg, "rtept")).map(function (p) {
        return [parseFloat(p.getAttribute("lon")), parseFloat(p.getAttribute("lat"))];
      }).filter(function (c) { return isFinite(c[0]) && isFinite(c[1]); });
    }
    xtags(doc, "trk").forEach(function (trk) {
      var segs = xtags(trk, "trkseg").map(segPts).filter(function (s) { return s.length >= 2; });
      if (!segs.length) return;
      features.push({ type: "Feature",
        properties: { name: xtext(trk, "name"), description: xtext(trk, "desc") },
        geometry: segs.length === 1 ? { type: "LineString", coordinates: segs[0] }
          : { type: "MultiLineString", coordinates: segs } });
    });
    xtags(doc, "rte").forEach(function (rte) {
      var pts = segPts(rte);
      if (pts.length < 2) return;
      features.push({ type: "Feature",
        properties: { name: xtext(rte, "name"), description: xtext(rte, "desc") },
        geometry: { type: "LineString", coordinates: pts } });
    });
    return { type: "FeatureCollection", features: features };
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
