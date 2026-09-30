/* The open-data catalogue, as a person sees it.

   Two places offer the same choice — the setup wizard's "What open data goes
   on it?" step, and the Owner menu's "Open data layers" sheet on a built atlas
   — and they have to read the same: the same grouping, the same plain names,
   the same "needs approval" tag, the same "too wide an area" excuse. So the
   words and the row markup live here, once, and both pages ask for them.

   Plain script, no module: the wizard includes it with a tag; owner.js fetches
   it the first time the sheet opens. Nothing here touches the page — it hands
   back strings and lists, and each caller wires its own checkboxes. */
(function () {
  "use strict";

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var GROUP_LABELS = { base: "Boundaries & basics", eco: "Ecological landscape",
    context: "Context & infrastructure", people: "People & services" };

  // catalogue names can be technical ("Admin boundaries"); these speak to a
  // person setting up their first atlas
  var PLAIN_NAMES = { admin: "your region’s boundaries", labels: "place names" };

  // the layers that are not a choice: boundaries (required) and place names
  function isGiven(l) { return !!(l.required || l.id === "labels"); }

  function givenLine(catalog) {
    var names = (catalog || []).filter(isGiven).map(function (l) {
      return "<b>" + esc(PLAIN_NAMES[l.id] || l.label) + "</b>";
    });
    if (!names.length) return "";
    return "Included in every atlas: " +
      (names.length === 2 ? names.join(" and ") : names.join(", ")) +
      ". Sources are credited on the map.";
  }

  /* The optional layers, in the catalogue's four groups and, inside a group,
     A to Z by name — so the order carries no opinion about which to pick
     (the owner's rule: everything shown up front, nothing favoured). A layer
     the region is too wide for goes to the end of its group, greyed, where it
     is still seen but not in the way. */
  var GROUP_ORDER = ["base", "eco", "context", "people"];
  function byName(a, b) {
    var ca = cannotBuild(a) ? 1 : 0, cb = cannotBuild(b) ? 1 : 0;
    if (ca !== cb) return ca - cb;
    return String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base" });
  }
  function groups(catalog) {
    var by = {}, order = [];
    (catalog || []).forEach(function (l) {
      if (isGiven(l)) return;
      var g = l.group || "context";
      if (!by[g]) { by[g] = []; order.push(g); }
      by[g].push(l);
    });
    order.sort(function (a, b) {
      var ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return order.map(function (g) {
      return { id: g, label: GROUP_LABELS[g] || g, layers: by[g].slice().sort(byName) };
    });
  }

  // built from imagery or downloaded by the box, over a region too wide for
  // the time a build gets
  function cannotBuild(l) { return l.feasible === false; }

  var TOO_WIDE_TITLE = "This is built for the area you pick, and the work grows with it. " +
    "Choose a smaller region to include it.";

  /* One row: a checkbox, the layer's name, its plain description, and either
     why it cannot be had here or the fact that it needs approval. `checked`
     is the caller's — the wizard pre-ticks defaults, the owner sheet pre-ticks
     what the atlas already has. */
  function rowHTML(l, checked, opts) {
    var cannot = cannotBuild(l);
    // a layer every atlas gets (the boundaries): ticked, not untickable, and
    // it says so — the wizard shows it so the whole list is in view
    var locked = !!(opts && opts.locked);
    return '<input type="checkbox" value="' + esc(l.id) + '"' +
        ((checked || locked) && !cannot ? " checked" : "") + (cannot || locked ? " disabled" : "") + " />" +
      "<span><b>" + esc(l.label) + "</b>" +
        (locked ? ' <span class="cost cost-given">always included</span>' : "") +
        '<span class="src">' + esc(l.info || "") +
        (cannot ? " · too wide an area for this one" : "") +
        (!cannot && l.cost && l.cost !== "free" ? ' <span class="cost cost-ask">needs approval</span>' : "") +
      "</span></span>";
  }

  function needsApproval(l) { return !!(l && l.cost && l.cost !== "free"); }

  window.LokaCatalogRows = {
    GROUP_LABELS: GROUP_LABELS, GROUP_ORDER: GROUP_ORDER, PLAIN_NAMES: PLAIN_NAMES, TOO_WIDE_TITLE: TOO_WIDE_TITLE,
    isGiven: isGiven, givenLine: givenLine, groups: groups,
    cannotBuild: cannotBuild, needsApproval: needsApproval, rowHTML: rowHTML,
  };
})();
