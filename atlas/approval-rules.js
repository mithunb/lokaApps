/* LOKA Atlas — what waits for the LOKA team's yes, and what is built now.
 *
 * One rule, run in two places with the same figures: the server, when an
 * atlas is asked for (api/apps/atlas.js splitForApproval, require), and the
 * wizard, before Build is pressed (catalog-rows.js, window.LokaApprovalRules)
 * — so the sentence beside Build and the build that follows never disagree.
 * The figures come from the server either way (GET /catalog estSecondsHere
 * and approvalAboveSeconds); this file only adds them up.
 *
 * Pure: a list in, a split out, no I/O. */
(function (root, make) {
  if (typeof module === "object" && module.exports) module.exports = make();
  else root.LokaApprovalRules = make();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* items: [{ id, label, seconds, heavy, required }] in catalogue order —
     heavy is a layer the team checks first (cost 'approval'), required one
     that never waits (the boundaries). cap: the seconds one build is given.
     Heavy layers wait; then, while the rest adds up to more than the cap,
     the dearest optional layer waits too, one at a time, until it fits.
     → { now: [ids], later: [{ id, label, why: 'heavy' | 'long' }], nowSeconds } */
  function split(items, cap) {
    var later = [], now = [];
    (items || []).forEach(function (it) { (it.heavy ? later : now).push(it); });
    later = later.map(function (it) { return { id: it.id, label: it.label, why: "heavy" }; });
    var total = function () { return now.reduce(function (t, it) { return t + (Number(it.seconds) || 0); }, 0); };
    while (Number(cap) > 0 && total() > Number(cap)) {
      var movable = now.filter(function (it) { return !it.required; });
      if (!movable.length) break;
      var dearest = movable.reduce(function (a, b) { return (Number(b.seconds) || 0) > (Number(a.seconds) || 0) ? b : a; });
      now = now.filter(function (it) { return it !== dearest; });
      later.push({ id: dearest.id, label: dearest.label, why: "long" });
    }
    var order = (items || []).map(function (it) { return it.id; });
    later.sort(function (a, b) { return order.indexOf(a.id) - order.indexOf(b.id); });
    return { now: now.map(function (it) { return it.id; }), later: later, nowSeconds: total() };
  }

  // "Floodplain (observed inundation)" → "Floodplain"; "Land use / land cover" → "Land use"
  function shortLabel(label) {
    return String(label == null ? "" : label).replace(/\s*\([^)]*\)\s*$/, "").split(" / ")[0].trim();
  }
  // "Floodplain, Land use and Reserved & protected forests"
  function list(labels) {
    return labels.length > 2 ? labels.slice(0, -1).join(", ") + " and " + labels[labels.length - 1] : labels.join(" and ");
  }
  // beside Build, and after it: what waits; then that the rest is not held
  function waitSentence(later) {
    if (!later || !later.length) return "";
    return list(later.map(function (p) { return shortLabel(p.label || p.id); })) +
      (later.length > 1 ? " are" : " is") + " added after a yes from the LOKA team. Everything else is built straight away.";
  }

  return { split: split, shortLabel: shortLabel, list: list, waitSentence: waitSentence };
});
