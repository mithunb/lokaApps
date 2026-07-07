/* LOKA Atlas — a generic, manifest-driven map engine (MapLibre GL JS).
 * Give it a dataset folder containing manifest.json + data files and it builds
 * the map, the layer-control widget, legends, popups and the credits footer.
 * No layer is hard-coded: everything is described declaratively in the manifest. */
(function () {
  "use strict";

  try {
    console.log(
      "%cLOKA Atlas%c · a Socratus project\n%cOpen data, openly mapped — discoverloka.org",
      "font:700 15px/1.5 Figtree,system-ui,sans-serif;color:#1A7048",
      "font:500 12px/1.5 system-ui,sans-serif;color:#4D6050",
      "font:400 11px/1.5 system-ui,sans-serif;color:#7A8E7A"
    );
  } catch (e) {}

  var DATASET = new URLSearchParams(location.search).get("dataset") || "deoria-bioregion";
  var BASE = "./datasets/" + DATASET + "/";
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var el = function (tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // Lucide icons (MIT) — a modern, consistent set, inlined so the app stays self-contained.
  var ICONS = {
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    factory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M17 18h1M12 18h1M7 18h1"/></svg>',
    flask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/></svg>'
  };

  var map, MANIFEST, activeBasemap, DATA = {}, markersByLayer = {}, cropState = {};

  fetch(BASE + "manifest.json")
    .then(function (r) { if (!r.ok) throw new Error("manifest " + r.status); return r.json(); })
    .then(start)
    .catch(function (err) {
      $("#atlas-map").innerHTML =
        '<div class="atlas-error">Could not load dataset “' + esc(DATASET) + '”.<br><small>' + esc(err.message) + "</small></div>";
    });

  function start(manifest) {
    MANIFEST = manifest;
    document.title = manifest.title + " — LOKA Atlas";
    setText("#atlas-title", manifest.title);
    setText("#atlas-subtitle", manifest.subtitle || "");
    setText("#atlas-about", manifest.about || "");

    activeBasemap = (manifest.basemaps.find(function (b) { return b.default; }) || manifest.basemaps[0]).id;

    map = new maplibregl.Map({
      container: "atlas-map",
      style: baseStyle(manifest),
      center: manifest.center,
      zoom: manifest.zoom,
      minZoom: manifest.minzoom || 5,
      maxZoom: manifest.maxzoom || 16,
      attributionControl: false,
      hash: false
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    window.__map = map;   // debug hook
    map.on("error", function (e) { console.error("Atlas map error:", e && e.error && e.error.message); });

    map.on("load", function () {
      try {
        buildLayers();
        buildControls();
        buildCredits();
        wirePopups();
        fitToData(false);
        // re-frame when the layout flips between the floating panel (desktop) and the bottom sheet (mobile)
        window.matchMedia("(max-width: 720px)").addEventListener("change", function () {
          setTimeout(function () { fitToData(true); }, 80);
        });
      } catch (err) { console.error("Atlas build error:", err && err.message, err && err.stack); }
    });
  }

  // Frame the data within the map area that's actually visible — i.e. to the right of the
  // control widget when it floats over the map (desktop), full width when it's docked below (mobile).
  function fitToData(animate) {
    if (!MANIFEST.bounds || !map) return;
    var pad = { top: 40, right: 40, bottom: 40, left: 40 };
    try {
      var mr = map.getContainer().getBoundingClientRect();
      var panel = document.getElementById("atlas-panel");
      if (panel && mr.width) {
        var pr = panel.getBoundingClientRect();
        var overlapsVertically = pr.bottom > mr.top + 16 && pr.top < mr.bottom - 16;
        var onLeftHalf = (pr.left + pr.right) / 2 < mr.left + mr.width / 2;
        var intersectsMap = pr.right > mr.left && pr.left < mr.right;
        if (overlapsVertically && onLeftHalf && intersectsMap) {
          pad.left = Math.min(mr.width * 0.55, (pr.right - mr.left) + 24);
        }
      }
    } catch (e) {}
    map.fitBounds(MANIFEST.bounds, { padding: pad, duration: animate ? 350 : 0 });
  }

  /* ---- base style (glyphs + background + basemaps) ---- */
  function baseStyle(m) {
    var sources = {}, layers = [
      { id: "bg", type: "background", paint: { "background-color": "#e6e4df" } }
    ];
    m.basemaps.forEach(function (b) {
      sources["base-" + b.id] = {
        type: "raster", tiles: b.tiles, tileSize: b.tileSize || 256,
        maxzoom: b.maxzoom || 19, attribution: b.attribution || ""
      };
      layers.push({
        id: "base-" + b.id, type: "raster", source: "base-" + b.id,
        layout: { visibility: b.id === activeBasemap ? "visible" : "none" }
      });
    });
    return { version: 8, glyphs: m.glyphs, sources: sources, layers: layers };
  }

  /* ==================================================================
     LAYERS
  ================================================================== */
  function buildLayers() {
    var layers = MANIFEST.layers;
    // Preload every source first, THEN add layers in manifest order so draw order
    // is deterministic (array order = bottom→top; markers are DOM and sit on top).
    Promise.all(layers.map(function (L) {
      if (L.type === "raster" || !L.source) return Promise.resolve();
      return fetch(BASE + L.source).then(function (r) { return r.json(); })
        .then(function (d) { DATA[L.id] = d; })
        .catch(function () {});
    })).then(function () {
      layers.forEach(function (L) {
        if (L.type === "fill") addFill(L);
        else if (L.type === "line") addLine(L);
        else if (L.type === "circle") addCircle(L);
        else if (L.type === "categories") addCategories(L);
        else if (L.type === "image") addImage(L);
        else if (L.type === "raster") addRaster(L);
        else if (L.type === "marker") addMarker(L);
      });
    });
  }
  function on(L) { return L.default !== false; }
  function vis(L) { return on(L) ? "visible" : "none"; }
  function srcId(L) { return "src-" + L.id; }

  function addGeoSource(L, done) {
    var gj = DATA[L.id];
    if (!gj) return;
    if (!map.getSource(srcId(L))) map.addSource(srcId(L), { type: "geojson", data: gj, generateId: true });
    done && done(gj);
  }

  function addFill(L) {
    L._ids = [];
    addGeoSource(L, function () {
      var p = L.paint || {};
      map.addLayer({
        id: L.id + "-fill", type: "fill", source: srcId(L),
        layout: { visibility: vis(L) },
        paint: { "fill-color": p.fillColor || "#888", "fill-opacity": p.fillOpacity != null ? p.fillOpacity : 0.4 }
      });
      L._ids.push(L.id + "-fill");
      if (p.outlineColor || p.outlineWidth) {
        var lp = { "line-color": p.outlineColor || "#fff", "line-width": p.outlineWidth || 1 };
        if (p.outlineOpacity != null) lp["line-opacity"] = p.outlineOpacity;
        if (p.outlineDash) lp["line-dasharray"] = p.outlineDash;
        map.addLayer({ id: L.id + "-line", type: "line", source: srcId(L), layout: { visibility: vis(L) }, paint: lp });
        L._ids.push(L.id + "-line");
      }
      addHighlight(L);
      addLabel(L);
    });
  }

  // Feature-state driven outline: invisible until a feature is hovered (thin dark) or
  // selected (bold orange, persists while the map pans). Only for clickable layers.
  function addHighlight(L) {
    if (!L.popup || !map.getSource(srcId(L))) return;
    map.addLayer({
      id: L.id + "-hl", type: "line", source: srcId(L), layout: { visibility: vis(L) },
      paint: {
        "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#A6522F", "#1e2a1c"],
        "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3.4, ["boolean", ["feature-state", "hover"], false], 1.8, 0],
        "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 1, ["boolean", ["feature-state", "hover"], false], 0.9, 0]
      }
    });
    L._ids.push(L.id + "-hl");
  }

  function addLine(L) {
    L._ids = [];
    addGeoSource(L, function () {
      var p = L.paint || {};
      var lp = { "line-color": p.color || "#38bdf8", "line-width": p.width || 1.2, "line-opacity": p.opacity != null ? p.opacity : 1 };
      if (p.dash) lp["line-dasharray"] = p.dash;
      map.addLayer({ id: L.id + "-line", type: "line", source: srcId(L), layout: { visibility: vis(L), "line-cap": "round", "line-join": "round" }, paint: lp });
      L._ids.push(L.id + "-line");
      addLabel(L);
    });
  }

  function addCircle(L) {
    L._ids = [];
    addGeoSource(L, function () {
      var p = L.paint || {};
      map.addLayer({
        id: L.id + "-circle", type: "circle", source: srcId(L), layout: { visibility: vis(L) },
        paint: {
          "circle-radius": p.radius || 5, "circle-color": p.color || "#f97316",
          "circle-stroke-color": p.strokeColor || "#fff", "circle-stroke-width": p.strokeWidth != null ? p.strokeWidth : 1.5,
          "circle-opacity": p.opacity != null ? p.opacity : 1
        }
      });
      L._ids.push(L.id + "-circle");
      addLabel(L);
    });
  }

  function addLabel(L) {
    var t = L.label_text;
    if (!t) return;
    var layout = {
      visibility: vis(L),
      "text-field": ["coalesce", ["get", t.property], ""],
      "text-size": t.size || 12,
      "text-font": ["Open Sans Regular"],
      "symbol-placement": L.type === "line" ? "line" : "point",
      "text-allow-overlap": false, "text-optional": true
    };
    if (t.transform) layout["text-transform"] = t.transform;
    if (t.letterSpacing) layout["text-letter-spacing"] = t.letterSpacing;
    if (t.minzoom == null) {} else layout["text-size"] = ["interpolate", ["linear"], ["zoom"], (t.minzoom - 0.5), 0, t.minzoom, t.size || 12];
    var paint = {
      "text-color": t.color || "#fff",
      "text-halo-color": t.haloColor || "#000",
      "text-halo-width": t.haloWidth || 1.2
    };
    map.addLayer({ id: L.id + "-label", type: "symbol", source: srcId(L), layout: layout, paint: paint });
    L._ids.push(L.id + "-label");
  }

  function addImage(L) {
    var meta = DATA[L.id];
    if (!meta) return;
    L._imageMeta = meta;
    map.addSource(srcId(L), { type: "image", url: BASE + meta.image, coordinates: meta.coordinates });
    map.addLayer({ id: L.id + "-img", type: "raster", source: srcId(L), layout: { visibility: vis(L) }, paint: { "raster-opacity": L.opacity != null ? L.opacity : 0.8, "raster-fade-duration": 0 } });
    L._ids = [L.id + "-img"];
    if (L.legendFrom === "source" && meta.legend) L._legend = meta.legend.map(function (c) { return { color: c.color, label: c.label + (c.pct != null ? " · " + c.pct + "%" : "") }; });
    refreshLegend(L);
  }

  function addRaster(L) {
    map.addSource(srcId(L), { type: "raster", tiles: L.tiles, tileSize: L.tileSize || 256, attribution: L.attribution || "" });
    var show = on(L) && (!L.onlyWithBasemap || L.onlyWithBasemap === activeBasemap);
    map.addLayer({ id: L.id + "-raster", type: "raster", source: srcId(L), layout: { visibility: show ? "visible" : "none" }, paint: { "raster-opacity": L.opacity != null ? L.opacity : 1 } });
    L._ids = [L.id + "-raster"];
  }

  /* ---- categories (crop distribution) ---- */
  function addCategories(L) {
    L._ids = [];
    cropState[L.id] = L.defaultMode || "diversity";
    addGeoSource(L, function () {
      map.addLayer({
        id: L.id + "-fill", type: "fill", source: srcId(L),
        layout: { visibility: vis(L) },
        paint: { "fill-color": "#888", "fill-opacity": 0.4, "fill-outline-color": "rgba(0,0,0,0)" }
      });
      L._ids.push(L.id + "-fill");
      addHighlight(L);
      applyCategoryPaint(L);
    });
  }

  function applyCategoryPaint(L) {
    var mode = cropState[L.id], id = L.id + "-fill";
    if (!map.getLayer(id)) return;
    if (mode === "diversity") {
      var d = L.diversity, ramp = d.ramp, stops = ["step", ["get", L.countProperty], ramp[0]];
      for (var i = 1; i < ramp.length; i++) stops.push(i + 1, ramp[i]);
      map.setPaintProperty(id, "fill-color", stops);
      map.setPaintProperty(id, "fill-opacity", 0.6);
    } else {
      var cat = L.categories.find(function (c) { return c.name === mode; });
      var color = cat ? cat.color : "#888";
      var has = ["in", mode, ["get", L.arrayProperty]];
      map.setPaintProperty(id, "fill-color", ["case", has, color, "#5b6b5b"]);
      map.setPaintProperty(id, "fill-opacity", ["case", has, 0.72, 0.06]);
    }
    refreshLegend(L);
  }

  function categoryLegend(L) {
    var mode = cropState[L.id];
    if (mode === "diversity") {
      var r = L.diversity.ramp;
      return { ramp: r, min: "1", max: r.length + "+", unit: "crops / block" };
    }
    var cat = L.categories.find(function (c) { return c.name === mode; });
    return [{ color: cat ? cat.color : "#888", label: "Grows " + mode }, { color: "#5b6b5b", label: "Not grown", faint: true }];
  }

  /* ---- markers (DOM) ---- */
  function addMarker(L) {
    markersByLayer[L.id] = [];
    var gj = DATA[L.id];
    if (!gj) return;
    var pts = [];
    gj.features.forEach(function (f) {
      var cfg = L.marker || (L.markers && L.markers[f.properties[L.markerBy]]) || {};
      var wrap = el("div", "atlas-marker");
      var pin = el("div", "atlas-pin" + (cfg.ring ? " ring" : ""));
      pin.style.setProperty("--pin", cfg.color || "#f97316");
      if (cfg.icon && ICONS[cfg.icon]) pin.innerHTML = ICONS[cfg.icon];
      else if (cfg.glyph) pin.textContent = cfg.glyph;
      wrap.appendChild(pin);
      if (L.label_text) wrap.appendChild(el("span", "atlas-mlabel", esc(f.properties[L.label_text.property])));
      wrap.addEventListener("click", function (e) { e.stopPropagation(); openPopup(L, f, f.geometry.coordinates); });
      markersByLayer[L.id].push(
        new maplibregl.Marker({ element: wrap, anchor: "bottom" }).setLngLat(f.geometry.coordinates).addTo(map)
      );
      pts.push(f.geometry.coordinates);
    });
    L._pts = pts;
    if (L.cluster && pts.length) setupCluster(L);
    applyMarkerVisibility(L);
  }

  // A single numbered badge stands in for a tight group at overview zoom; the
  // individual pins take over once you zoom past `belowZoom`.
  function setupCluster(L) {
    var pts = L._pts;
    var cx = pts.reduce(function (s, p) { return s + p[0]; }, 0) / pts.length;
    var cy = pts.reduce(function (s, p) { return s + p[1]; }, 0) / pts.length;
    var wrap = el("div", "atlas-cluster");
    wrap.innerHTML = '<span class="cl-count">' + pts.length + "</span>" +
      (L.cluster.label ? '<span class="cl-label">' + esc(L.cluster.label) + "</span>" : "");
    wrap.addEventListener("click", function (e) { e.stopPropagation(); fitPoints(pts); });
    L._clusterMarker = new maplibregl.Marker({ element: wrap, anchor: "center" }).setLngLat([cx, cy]).addTo(map);
    if (!L._zoomWired) { map.on("zoom", function () { applyMarkerVisibility(L); }); L._zoomWired = true; }
  }

  function applyMarkerVisibility(L) {
    var shown = L._visible !== false;
    var clustered = L.cluster && L._clusterMarker && map.getZoom() < L.cluster.belowZoom;
    (markersByLayer[L.id] || []).forEach(function (mk) { mk.getElement().style.display = (shown && !clustered) ? "" : "none"; });
    if (L._clusterMarker) L._clusterMarker.getElement().style.display = (shown && clustered) ? "" : "none";
  }

  function fitPoints(pts) {
    var b = new maplibregl.LngLatBounds(pts[0], pts[0]);
    pts.forEach(function (p) { b.extend(p); });
    map.fitBounds(b, { padding: 110, maxZoom: 13, duration: 600 });
  }

  /* ==================================================================
     TOGGLING
  ================================================================== */
  function setLayerVisible(L, show) {
    L._visible = show;
    (L._ids || []).forEach(function (id) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", show ? "visible" : "none");
    });
    if (markersByLayer[L.id]) applyMarkerVisibility(L);
    if (L.onlyWithBasemap && show && activeBasemap !== L.onlyWithBasemap) hideLayerIds(L);
  }
  function hideLayerIds(L) {
    (L._ids || []).forEach(function (id) { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none"); });
  }

  function switchBasemap(id) {
    activeBasemap = id;
    MANIFEST.basemaps.forEach(function (b) {
      if (map.getLayer("base-" + b.id)) map.setLayoutProperty("base-" + b.id, "visibility", b.id === id ? "visible" : "none");
    });
    // layers restricted to a basemap (e.g. satellite place-labels)
    MANIFEST.layers.forEach(function (L) {
      if (!L.onlyWithBasemap) return;
      var show = L._visible !== false && L.onlyWithBasemap === id;
      (L._ids || []).forEach(function (lid) { if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", show ? "visible" : "none"); });
    });
  }

  /* ==================================================================
     CONTROL WIDGET
  ================================================================== */
  function buildControls() {
    var panel = $("#atlas-controls");
    panel.innerHTML = "";

    // basemap switch
    var bm = el("div", "ctl-basemaps");
    MANIFEST.basemaps.forEach(function (b) {
      var btn = el("button", "bm-btn" + (b.id === activeBasemap ? " active" : ""), esc(b.label));
      btn.onclick = function () {
        switchBasemap(b.id);
        Array.prototype.forEach.call(bm.children, function (c) { c.classList.remove("active"); });
        btn.classList.add("active");
      };
      bm.appendChild(btn);
    });
    panel.appendChild(bm);

    // groups + layers
    MANIFEST.groups.forEach(function (g) {
      var layers = MANIFEST.layers.filter(function (L) { return L.group === g.id; });
      if (!layers.length) return;
      var sec = el("section", "ctl-group" + (g.open === false ? " collapsed" : ""));
      var head = el("button", "ctl-group-head");
      head.innerHTML = '<span>' + esc(g.label) + '</span><span class="chev">' + ICONS.chevron + '</span>';
      head.onclick = function () { sec.classList.toggle("collapsed"); };
      sec.appendChild(head);
      var body = el("div", "ctl-group-body");
      layers.forEach(function (L) { body.appendChild(layerRow(L)); });
      sec.appendChild(body);
      panel.appendChild(sec);
    });
  }

  function layerRow(L) {
    L._visible = on(L);
    var row = el("div", "ctl-row");
    var top = el("label", "ctl-toggle");
    var cb = el("input"); cb.type = "checkbox"; cb.checked = on(L);
    var sw = el("span", "ctl-switch");
    var name = el("span", "ctl-name", esc(L.label));
    top.appendChild(cb); top.appendChild(sw); top.appendChild(name);
    if (L.info) {
      var info = el("span", "ctl-info", ICONS.info);
      info.title = L.info;
      top.appendChild(info);
    }
    row.appendChild(top);

    var extra = el("div", "ctl-extra");
    row.appendChild(extra);
    L._extra = extra;

    cb.onchange = function () { setLayerVisible(L, cb.checked); row.classList.toggle("off", !cb.checked); renderExtra(L); };
    row.classList.toggle("off", !cb.checked);

    renderExtra(L);
    return row;
  }

  function renderExtra(L) {
    var box = L._extra; if (!box) return;
    box.innerHTML = "";
    if (!L._visible) return;

    // crop selector
    if (L.type === "categories") {
      var chips = el("div", "crop-chips");
      var mk = function (mode, label, color) {
        var c = el("button", "crop-chip" + (cropState[L.id] === mode ? " on" : ""), esc(label));
        if (color) c.style.setProperty("--c", color);
        else c.classList.add("diversity");
        c.onclick = function () {
          cropState[L.id] = mode;
          applyCategoryPaint(L);
          Array.prototype.forEach.call(chips.children, function (x) { x.classList.remove("on"); });
          c.classList.add("on");
        };
        return c;
      };
      chips.appendChild(mk("diversity", L.diversity.label || "Diversity", null));
      L.categories.forEach(function (cat) { chips.appendChild(mk(cat.name, cat.name, cat.color)); });
      box.appendChild(chips);
    }

    // opacity slider
    if (L.opacityControl) {
      var wrap = el("div", "ctl-opacity");
      var s = el("input"); s.type = "range"; s.min = 0; s.max = 100;
      s.value = Math.round((L.opacity != null ? L.opacity : 0.8) * 100);
      var prop = L.type === "image" ? "raster-opacity" : (L.type === "raster" ? "raster-opacity" : "fill-opacity");
      var target = L.type === "image" ? L.id + "-img" : (L.type === "raster" ? L.id + "-raster" : L.id + "-fill");
      s.oninput = function () { if (map.getLayer(target)) map.setPaintProperty(target, prop, +s.value / 100); };
      wrap.appendChild(el("span", "ctl-opacity-lbl", "Opacity"));
      wrap.appendChild(s);
      box.appendChild(wrap);
    }

    refreshLegend(L);
  }

  function refreshLegend(L) {
    if (!L._extra || !L._visible) return;
    var old = $(".ctl-legend", L._extra); if (old) old.remove();
    var data = L.type === "categories" ? categoryLegend(L) : (L._legend || L.legend);
    if (!data) return;
    var leg = el("div", "ctl-legend");
    if (data.ramp) {
      // sequential scale → one graduated bar with endpoint labels, not a row per step
      var bar = el("div", "leg-ramp");
      data.ramp.forEach(function (c) { var s = el("span", "leg-ramp-seg"); s.style.background = c; bar.appendChild(s); });
      var lab = el("div", "leg-ramp-labels");
      lab.appendChild(el("span", "leg-ramp-end", esc(data.min)));
      if (data.unit) lab.appendChild(el("span", "leg-ramp-unit", esc(data.unit)));
      lab.appendChild(el("span", "leg-ramp-end", esc(data.max)));
      leg.appendChild(bar);
      leg.appendChild(lab);
    } else {
      if (!data.length) return;
      data.forEach(function (it) {
        var r = el("div", "leg-item" + (it.faint ? " faint" : ""));
        r.appendChild(swatch(it));
        r.appendChild(el("span", "leg-label", esc(it.label)));
        leg.appendChild(r);
      });
    }
    L._extra.appendChild(leg);
  }

  function swatch(it) {
    if (it.icon && ICONS[it.icon]) {
      var w = el("span", "leg-icon", ICONS[it.icon]);
      w.style.setProperty("--c", it.color);
      return w;
    }
    var s = el("span", "leg-swatch " + (it.shape || "box"));
    s.style.setProperty("--c", it.color);
    return s;
  }

  /* ==================================================================
     POPUPS
  ================================================================== */
  function wirePopups() {
    var clickable = MANIFEST.layers.filter(function (L) { return L.popup && L.type !== "marker"; });
    var ids = [];
    clickable.forEach(function (L) { (L._ids || []).forEach(function (id) { if (/-(fill|line|circle)$/.test(id) && !/-hl$/.test(id)) ids.push({ id: id, L: L }); }); });
    var idList = ids.map(function (x) { return x.id; });
    var hoverRef = null, selRef = null;

    // Prefer the most specific layer (earliest in manifest order — a block's crop popup
    // wins over the transparent district fill that sits above it).
    function pick(pt) {
      var hits = map.queryRenderedFeatures(pt, { layers: idList });
      var best = null, bestRank = Infinity;
      hits.forEach(function (h) {
        var i = ids.findIndex(function (x) { return x.id === h.layer.id; });
        if (i >= 0 && i < bestRank) { bestRank = i; best = { f: h, L: ids[i].L }; }
      });
      return best;
    }
    function clearHover() { if (hoverRef) { try { map.setFeatureState(hoverRef, { hover: false }); } catch (e) {} hoverRef = null; } }
    function clearSel() { if (selRef) { try { map.setFeatureState(selRef, { selected: false }); } catch (e) {} selRef = null; } }

    map.on("mousemove", function (e) {
      var top = pick(e.point);
      map.getCanvas().style.cursor = top ? "pointer" : "";
      if (!top || top.f.id == null) { clearHover(); return; }
      var ref = { source: top.f.source, id: top.f.id };
      if (!hoverRef || hoverRef.id !== ref.id || hoverRef.source !== ref.source) {
        clearHover(); hoverRef = ref;
        try { map.setFeatureState(ref, { hover: true }); } catch (e) {}
      }
    });
    map.on("mouseout", clearHover);

    map.on("click", function (e) {
      var top = pick(e.point);
      if (!top) { clearSel(); return; }           // click on empty map clears the selection
      clearSel();
      if (top.f.id != null) {
        selRef = { source: top.f.source, id: top.f.id };
        try { map.setFeatureState(selRef, { selected: true }); } catch (e) {}
      }
      openPopup(top.L, top.f, e.lngLat);
    });
  }

  function openPopup(L, feature, lngLat) {
    var html = popupHTML(L, feature.properties);
    if (!html) return;
    new maplibregl.Popup({ closeButton: true, maxWidth: "320px", className: "atlas-popup" })
      .setLngLat(lngLat).setHTML(html).addTo(map);
  }

  function popupHTML(L, props) {
    var spec = L.popup; if (!spec) return "";
    var title = spec.title ? props[spec.title] : "";
    if (!title && spec.titleFallback) title = props[spec.titleFallback];
    var sub = spec.subtitle || (spec.subtitleProperty ? props[spec.subtitleProperty] : "");
    var h = '<div class="pop">';
    if (title) h += '<div class="pop-title">' + esc(title) + "</div>";
    if (sub) h += '<div class="pop-sub">' + esc(sub) + "</div>";
    (spec.fields || []).forEach(function (fld) {
      var v = props[fld.property];
      if (v == null || v === "" || v === "[]") return;
      if (fld.type === "tags") {
        var arr = Array.isArray(v) ? v : safeArr(v);
        if (!arr.length) return;
        h += '<div class="pop-field"><div class="pop-lbl">' + esc(fld.label) + '</div><div class="pop-tags">' +
          arr.map(function (t) { return '<span class="pop-tag">' + esc(t) + "</span>"; }).join("") + "</div></div>";
      } else if (fld.type === "notes") {
        var notes = Array.isArray(v) ? v : safeArr(v);
        if (!notes.length) return;
        h += '<div class="pop-notes">' + notes.map(function (n) {
          return '<div class="pop-note"><b>' + esc(n.title) + "</b>" + (n.body ? "<span>" + esc(n.body) + "</span>" : "") + "</div>";
        }).join("") + "</div>";
      } else {
        h += '<div class="pop-field"><div class="pop-lbl">' + esc(fld.label) + '</div><div class="pop-val">' +
          esc(v) + (fld.suffix || "") + "</div></div>";
      }
    });
    return h + "</div>";
  }
  function safeArr(v) { try { return JSON.parse(v); } catch (e) { return []; } }

  /* ==================================================================
     CREDITS (data sources from manifest)
  ================================================================== */
  function buildCredits() {
    var box = $("#data-credits");
    if (!box || !MANIFEST.attributions) return;
    box.innerHTML = MANIFEST.attributions.map(function (a) {
      var name = a.url ? '<a href="' + esc(a.url) + '" target="_blank" rel="noopener">' + esc(a.name) + "</a>" : esc(a.name);
      return '<li><span class="cr-name">' + name + "</span>" +
        (a.note ? '<span class="cr-note">' + esc(a.note) + "</span>" : "") +
        (a.license ? '<span class="cr-lic">' + esc(a.license) + "</span>" : "") + "</li>";
    }).join("");
  }

  function setText(sel, txt) { var e = $(sel); if (e) e.textContent = txt; }
})();
