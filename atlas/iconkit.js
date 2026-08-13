/* ==========================================================================
   LOKA Atlas — category icons, shared.
   --------------------------------------------------------------------------
   The viewer draws a category's marker and its legend swatch; the editor's
   panel draws that same legend beside the map. Those used to be two bodies of
   code, and they disagreed: the editor showed a coloured dot where the map
   showed an icon, because the editor's renderer never knew icons existed.
   One table, one matcher, loaded by both — a divergence you cannot introduce
   by forgetting, only by editing this file.

   Lucide icons (MIT), inlined so the app stays self-contained and needs no CDN.
   ========================================================================== */
(function (global) {
  "use strict";

  function svgIcon(inner) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + "</svg>";
  }

  var ICONS = {
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    factory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/><path d="M17 18h1M12 18h1M7 18h1"/></svg>',
    flask: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/></svg>',
    // theme icons for on-the-fly category → icon mapping
    leaf: svgIcon('<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/>'),
    trees: svgIcon('<path d="M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z"/><path d="M7 16v6"/><path d="M13 19v3"/><path d="M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5"/>'),
    droplet: svgIcon('<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5C11.5 5.5 10 7.9 8 9.5 6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>'),
    utensils: svgIcon('<path d="M3 2v7c0 1.1.9 2 2 2a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>'),
    landmark: svgIcon('<line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7"/>'),
    palette: svgIcon('<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C22 6.012 17.461 2 12 2z"/>'),
    cap: svgIcon('<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>'),
    store: svgIcon('<path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M2 7h20"/><path d="M18 12a2 2 0 0 1-4 0 2 2 0 0 1-4 0 2 2 0 0 1-4 0"/>'),
    health: svgIcon('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>'),
    home: svgIcon('<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
    alert: svgIcon('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
    users: svgIcon('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    pin: svgIcon('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>')
  };

  /* Category → icon. Entries are WORD STEMS, matched against whole words in the
     value, so "learn" catches Learning and "activit" catches Activities.

     They are stems rather than substrings because substring matching was
     actively wrong on real data: "drink" fired inside "Food and Drink" before
     "food" could, "tree" fired inside "Street Food", and "eat" fired inside
     Creativity, Theatre and Great Outdoors. Data enrichment invents category
     names, so the input space is open-ended and near misses are the norm,
     not the exception. A wrong icon is worse than none — a monogram badge at
     least never claims the place is a restaurant. */
  var KEYWORD_ICONS = {
    nature: "leaf", ecolog: "leaf", green: "leaf", park: "leaf", garden: "leaf", plant: "leaf", biodiversit: "leaf",
    tree: "trees", forest: "trees", wood: "trees", grove: "trees",
    water: "droplet", river: "droplet", lake: "droplet", wetland: "droplet", pond: "droplet",
    stream: "droplet", drink: "droplet", well: "droplet", tank: "droplet",
    food: "utensils", restaurant: "utensils", cafe: "utensils", eatery: "utensils",
    cuisine: "utensils", meal: "utensils", dining: "utensils", kitchen: "utensils",
    heritage: "landmark", historic: "landmark", monument: "landmark", temple: "landmark",
    shrine: "landmark", idol: "landmark", memorial: "landmark", archaeolog: "landmark",
    culture: "palette", cultural: "palette", art: "palette", craft: "palette", music: "palette",
    creative: "palette", creativit: "palette", decor: "palette", design: "palette", theatre: "palette", theater: "palette",
    learn: "cap", education: "cap", school: "cap", college: "cap", library: "cap",
    study: "cap", univers: "cap", teach: "cap",
    market: "store", shop: "store", store: "store", vendor: "store", retail: "store",
    commerce: "store", bazaar: "store", trade: "store",
    health: "health", clinic: "health", hospital: "health", medical: "health", care: "health", pharmac: "health",
    infra: "home", building: "home", housing: "home", home: "home", construction: "home", residential: "home",
    hazard: "alert", danger: "alert", risk: "alert", waste: "alert", pollution: "alert",
    safety: "alert", civic: "alert", sanitation: "alert",
    social: "users", communit: "users", people: "users", activit: "users",
    gathering: "users", public: "users", club: "users"
  };

  function words(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  /* The earliest word that matches wins, and among stems matching that same
     word the longest one does. "Food and Drink" is food before it is drink;
     "Street Food" is food, because "street" matches nothing at all. Reading
     left to right is how the label reads, so it is how we resolve it. */
  function iconFor(value) {
    var w = words(value);
    for (var i = 0; i < w.length; i++) {
      var best = null;
      for (var stem in KEYWORD_ICONS) {
        if (w[i].indexOf(stem) === 0 && (!best || stem.length > best.length)) best = stem;
      }
      if (best) return { icon: KEYWORD_ICONS[best] };
    }
    // no theme fits: a lettered monogram, which says "a category" and nothing more
    var initials = w.slice(0, 2).map(function (x) { return x.charAt(0); }).join("").toUpperCase();
    return { badge: initials || "?" };
  }

  // pale fills (the auto palette's cyan and sand) need dark ink, not white
  function paleHex(h) {
    if (!/^#[0-9a-fA-F]{6}$/.test(h || "")) return false;
    var r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 145;
  }

  /* One legend swatch as an HTML string: an icon if the value suggests a theme,
     a monogram if it does not, a plain shape for non-categorical rows. Callers
     supply their own class prefix because the viewer's panel and the editor's
     panel size these differently; what they must not do is decide differently
     WHICH mark to draw. */
  function swatchHTML(row, esc) {
    var key = row.icon;
    if (!key && row.categorical) {
      var ic = iconFor(row.label);
      if (ic.icon) key = ic.icon;
      else return '<span class="leg-badge' + (paleHex(row.color) ? " pale" : "") +
        '" style="--c:' + esc(row.color || "") + '">' + esc(ic.badge) + "</span>";
    }
    if (key && ICONS[key]) {
      return '<span class="leg-icon" style="--c:' + esc(row.color || "") + '">' + ICONS[key] + "</span>";
    }
    return '<span class="leg-swatch ' + (row.shape || "box") + '" style="--c:' + esc(row.color || "") + '"></span>';
  }

  global.LokaIcons = {
    svgIcon: svgIcon,
    ICONS: ICONS,
    KEYWORD_ICONS: KEYWORD_ICONS,
    iconFor: iconFor,
    paleHex: paleHex,
    swatchHTML: swatchHTML
  };
})(window);
