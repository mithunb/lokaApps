/* LOKA Atlas — the map's own colours, in one list.
 *
 * Three sets the viewer paints on the map, which no theme may touch and which
 * a look read from a website must stay distinguishable from:
 *   KEY_COLORS  the dots and answers of a key (one colour per kind, shape per
 *               key — see atlas.js for why colours repeat between keys)
 *   KEY_OTHER   the "other" kind
 *   ONE_COLORS  the wizard's named single colours ("one colour" layers); the
 *               old names keep resolving to the Bazaar palette's values
 *   BASE_WARM   the ground, water, parks and roads of the warm base map
 *
 * The viewer read these from its own text until the look-from-a-website
 * feature needed them on the server too (look-map.js keeps a chosen place's
 * ring and the pressed buttons apart from every pin and from the park green).
 * One list, read by both, so the two can never disagree. Loaded by index.html
 * as a plain script (window.LokaMapColours) and by Node with require. */
(function (root, make) {
  var made = make();
  if (typeof module === "object" && module.exports) module.exports = made;
  else root.LokaMapColours = made;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var KEY_COLORS = ["#332288", "#999933", "#44AA99", "#AA4499", "#117733", "#882255", "#88CCEE", "#DDCC77"];
  var KEY_OTHER = "#7a756c";
  var ONE_COLORS = {
    sindoor: "#C9402B", leaf: "#2A6B41", marigold: "#E9A237", blue: "#3A7FA1",
    stone: "#A39E94", ink: "#26231F", turmeric: "#B99A1C",
    rust: "#C9402B", moss: "#2A6B41", ochre: "#E9A237", sienna: "#D2692A", slate: "#3A7FA1",
  };
  var BASE_WARM = {
    ground: "#F5F1E6", outside: "#EAE6DC", water: "#C8DBE5", waterway: "#3A7FA1",
    green: "#E9EDDF", wood: "#DCE3CF", landuse: "#EFEAE0", road: "#E2DDD0", roadMajor: "#D6D0C0",
    roadCasing: "#CFC9B8", building: "#E8E2D6", boundary: "#8C8985", label: "#5A5751", halo: "#F5F1E6",
    labelStrong: "#24211D",
  };

  // the colours a key gives its kinds (the answers), with "other"
  function keyColours() { return KEY_COLORS.concat([KEY_OTHER]).map(function (c) { return c.toUpperCase(); }); }
  // every colour a place's dot can wear, with no repeats
  function pinColours() {
    var seen = {}, out = [];
    keyColours().concat(Object.keys(ONE_COLORS).map(function (k) { return ONE_COLORS[k].toUpperCase(); }))
      .forEach(function (c) { if (!seen[c]) { seen[c] = true; out.push(c); } });
    return out;
  }

  return { KEY_COLORS: KEY_COLORS, KEY_OTHER: KEY_OTHER, ONE_COLORS: ONE_COLORS, BASE_WARM: BASE_WARM, keyColours: keyColours, pinColours: pinColours };
});
