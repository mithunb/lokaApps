/* LOKA Atlas — from a website's colours to an atlas's look.
 *
 * look-read.js (server) reads a site and hands over what it found: a list of
 * colours, each with a weight (how much the site leans on it) and the roles
 * the site gives it (a link, a button, the page, the words…), plus the page
 * and text colours, whether buttons are square, and the logo's shape. This
 * file turns that into a theme block for theme.js, by one rule for every
 * site: no per-site hand rules, ever (docs/design-style-from-website.md §4).
 *
 * Pure: palette in, theme and notes out, no I/O — so the checks can drive it
 * and the owner's sheet can run it again in the browser when a colour is
 * swapped by hand, with the same numbers the server will check at save.
 *
 * What it never does: set a dark page (theme.js refuses one anyway, but this
 * checks first), set a title face (titles stay in LOKA's Lora), or touch the
 * map's own colours. Two rules keep the map readable under any look:
 *   - the ring round a chosen place (highlight) must differ from every colour
 *     a key gives its kinds (map-colours.js);
 *   - the accent (pressed buttons over the map) must not vanish into the park
 *     green or the water blue.
 *
 * Shared by the server (require) and the browser (window.LokaLookMap). */
(function (root, make) {
  if (typeof module === "object" && module.exports) {
    module.exports = make(require("./theme.js"), require("./map-colours.js"));
  } else {
    root.LokaLookMap = make(root.LokaTheme, root.LokaMapColours);
  }
})(typeof self !== "undefined" ? self : this, function (T, MC) {
  "use strict";

  var SLOTS = ["page", "surface", "surfaceAlt", "text", "textSecondary", "textMuted", "accent", "accentDeep", "highlight", "highlightDeep"];
  var ACCENT_ROLES = { accent: 1, brand: 1, link: 1, button: 1 };
  var HEX = /^#[0-9a-fA-F]{6}$/;

  /* ---------- colour maths ---------- */
  function hsl(h) {
    var c = T.rgb(h).map(function (v) { return v / 255; });
    var max = Math.max(c[0], c[1], c[2]), min = Math.min(c[0], c[1], c[2]), d = max - min;
    var l = (max + min) / 2, s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)), hue = 0;
    if (d !== 0) {
      if (max === c[0]) hue = ((c[1] - c[2]) / d) % 6;
      else if (max === c[1]) hue = (c[2] - c[0]) / d + 2;
      else hue = (c[0] - c[1]) / d + 4;
      hue = (hue * 60 + 360) % 360;
    }
    return { h: hue, s: s, l: l };
  }
  function hueDist(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  // how far from grey, 0..1. HSL's saturation calls near-white "fully
  // saturated" (#FFFDFD is s = 1), so neutrality is judged on chroma.
  function chroma(h) {
    var c = T.rgb(h);
    return (Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])) / 255;
  }
  function isNeutral(h) { var c = hsl(h); return chroma(h) < 0.12 || c.l < 0.06 || c.l > 0.96; }
  // CIE Lab, for "is this the same colour" questions (ΔE, CIE76 — enough to
  // tell a near-duplicate from a neighbour; the regression check uses it too)
  function lab(h) {
    var c = T.rgb(h).map(function (v) {
      v /= 255;
      return (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)) * 100;
    });
    var x = (c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 95.047;
    var y = (c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722) / 100;
    var z = (c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 108.883;
    var f = function (t) { return t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + 16 / 116; };
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  }
  function deltaE(a, b) {
    var p = lab(a), q = lab(b);
    return Math.sqrt(Math.pow(p[0] - q[0], 2) + Math.pow(p[1] - q[1], 2) + Math.pow(p[2] - q[2], 2));
  }
  // a plain name for a colour, for sentences like "the site's purple"
  function colourName(h) {
    var c = hsl(h);
    if (c.l >= 0.95) return "white";
    if (c.l <= 0.08 || (c.l <= 0.14 && chroma(h) < 0.15)) return "black";   // a near-black with a tint is still black
    if (chroma(h) < 0.12) return "grey";
    var H = c.h;
    if (H < 15 || H >= 345) return c.l < 0.35 ? "dark red" : "red";
    if (H < 40) return c.l < 0.4 ? "brown" : "orange";
    if (H < 65) return "yellow";
    if (H < 160) return "green";
    if (H < 195) return "teal";
    if (H < 255) return "blue";
    if (H < 290) return "purple";
    if (H < 345) return c.l > 0.6 ? "pink" : "purple";
    return "colour";
  }
  function isWarm(c) { return c.h <= 60 || c.h >= 330; }

  /* ---------- the mapping ---------- */
  function clean(found) {
    var f = found && typeof found === "object" ? found : {};
    var colours = Array.isArray(f.colours) ? f.colours.filter(function (c) {
      return c && typeof c.hex === "string" && HEX.test(c.hex);
    }).map(function (c) {
      return { hex: c.hex.toUpperCase(), weight: Number(c.weight) || 0, bg: Number(c.bg) || 0, roles: Array.isArray(c.roles) ? c.roles.slice() : [], usedFor: c.usedFor || "" };
    }) : [];
    colours.sort(function (a, b) { return b.weight - a.weight; });
    return {
      colours: colours,
      page: typeof f.page === "string" && HEX.test(f.page) ? f.page.toUpperCase() : null,
      text: typeof f.text === "string" && HEX.test(f.text) ? f.text.toUpperCase() : null,
      corners: f.corners === "square" ? "square" : (f.corners === "soft" ? "soft" : null),
      logo: f.logo && Number(f.logo.width) > 0 && Number(f.logo.height) > 0 ? { width: Number(f.logo.width), height: Number(f.logo.height) } : null,
      chosen: f.chosen && typeof f.chosen === "object" ? f.chosen : {},
    };
  }

  /* found → { theme, lines, leftOut, from } — `from` says, per slot, which of
     the site's colours it came from (hex and the plain words for it), for the
     sheet's "the site's purple: links and buttons". */
  function map(found) {
    var F = clean(found);
    var lines = [], leftOut = [], from = {}, c = {};
    var say = function (slot, cand, why) { from[slot] = { hex: cand.hex, name: colourName(cand.hex), usedFor: cand.usedFor, why: why || "" }; };
    var brand = null;   // the heaviest colour carrying a brand-ish role, light or not

    // the first brand-ish colour, before any test, so a dark page can be tinted toward it
    for (var i = 0; i < F.colours.length; i++) {
      if (F.colours[i].roles.some(function (r) { return !!ACCENT_ROLES[r]; }) && !isNeutral(F.colours[i].hex) && hsl(F.colours[i].hex).s >= 0.25) { brand = F.colours[i]; break; }
    }

    // accent: the heaviest brand-ish colour that can hold white words on a button
    var textHue = F.text && !isNeutral(F.text) ? hsl(F.text).h : null;
    var shading = null;   // a brand colour too light for links becomes the pale shading
    var tried = F.colours.filter(function (k) { return k.roles.some(function (r) { return !!ACCENT_ROLES[r]; }); });
    for (var j = 0; j < tried.length && !c.accent; j++) {
      var k = tried[j], kh = hsl(k.hex);
      if (isNeutral(k.hex) || kh.s < 0.25) continue;
      if (textHue !== null && hueDist(kh.h, textHue) < 25) continue;
      if (T.contrast("#FFFFFF", k.hex) < 3) {   // white words on it would not read, even darkened a little
        if (!shading) {
          shading = k;
          lines.push("The site's " + colourName(k.hex) + " is too light for links and buttons, so it is used as a pale shading instead.");
        }
        continue;
      }
      c.accent = k.hex; say("accent", k, "links and buttons");
    }
    if (!c.accent && F.colours.length) leftOut.push(tried.length ? "None of the site's colours is deep enough for links and white words on a button; LOKA's green is kept." : "The site gives no colour to its links or buttons; LOKA's green is kept.");
    // …and it must not vanish into the park green or the water
    if (c.accent) {
      var ah = hsl(c.accent);
      var clash = [MC.BASE_WARM.green, MC.BASE_WARM.wood, MC.BASE_WARM.water, MC.BASE_WARM.waterway].some(function (m) {
        return hueDist(ah.h, hsl(m).h) <= 20 && T.contrast(c.accent, m) <= 1.3;
      });
      if (clash) {
        c.accent = T.darken(c.accent, 0.15);
        lines.push("Darkened the site's " + colourName(from.accent.hex) + " a little so pressed buttons stand out from the map's own greens and blues.");
      }
      c.accentDeep = T.darken(c.accent, 0.30);
    }

    // page
    if (F.page) {
      if (T.luminance(F.page) >= T.LIGHT_ENOUGH) { c.page = F.page; say("page", { hex: F.page, usedFor: "the page" }); }
      else {
        var toward = c.accent || (brand ? brand.hex : null);
        c.page = T.over("#FFFFFF", toward || "#000000", 0.03);
        leftOut.push("The site's dark page (LOKA has no dark mode); the page stays light, tinted a little toward the site's " + (toward ? colourName(toward) : "grey") + ".");
      }
    }
    // surface: a touch lighter than the page, as on LOKA
    if (c.page) c.surface = T.luminance(c.page) >= 0.9 ? "#FFFFFF" : T.over(c.page, "#FFFFFF", 0.3);

    // text
    if (F.text) {
      var pageFor = c.page || T.LOKA.page;
      if (T.contrast(F.text, pageFor) >= 7 && T.luminance(F.text) < 0.2) {
        c.text = F.text; say("text", { hex: F.text, usedFor: "words" });
        c.textSecondary = T.over(F.text, pageFor, 0.22);
        c.textMuted = T.over(F.text, pageFor, 0.38);
      } else {
        leftOut.push("The site's colour for words, " + colourName(F.text) + ", reads too faintly on a light page; LOKA's own is kept.");
      }
    }

    // surfaceAlt: the pale shading. A big light colour the site uses (a hero
    // band) that cannot carry words becomes it; else the accent, faintly.
    var surfaceFor = c.surface || T.LOKA.surface;
    var tintFrom = shading;
    if (!tintFrom) {
      // the site's big light colour: the one it paints most as a background
      var bands = F.colours.filter(function (s) {
        return s.hex !== c.accent && !isNeutral(s.hex) && hsl(s.hex).s >= 0.25 &&
          T.contrast(s.hex, "#FFFFFF") < 4.5 && T.luminance(s.hex) < 0.75 && s.weight >= 8 && s.bg > 0;
      }).sort(function (a, b) { return b.bg - a.bg || b.weight - a.weight; });
      tintFrom = bands[0] || null;
    }
    if (!tintFrom && c.accent) tintFrom = { hex: c.accent, usedFor: from.accent.usedFor };
    if (tintFrom) {
      var alt = T.over(surfaceFor, tintFrom.hex, 0.10), alth = hsl(alt);
      // a shading that reads as park green (a strong green, not a pale tint:
      // judged on chroma) is faded further
      if (T.luminance(alt) < T.LIGHT_ENOUGH || (alth.h >= 90 && alth.h <= 150 && chroma(alt) > 0.25)) alt = T.over(surfaceFor, tintFrom.hex, 0.06);
      c.surfaceAlt = alt;
      say("surfaceAlt", tintFrom, "a pale shading");
    }

    // highlight: the ring round a chosen place — the site's warmest strong
    // colour. It must differ from the colours a key gives its kinds (the
    // answers on the map). The single-colour layers' pins are not in that
    // test: LOKA's own ring is the same Sindoor as a Sindoor pin already, told
    // apart by shape, so a site's red is no worse than LOKA's own.
    var pins = MC.keyColours().filter(function (p) { return !isNeutral(p); });   // "other" is grey: no hue to clash with
    var farFromAccent = function (k) { return !c.accent || hueDist(hsl(k.hex).h, hsl(c.accent).h) >= 40; };
    var notAccent = F.colours.filter(function (k) { return k.hex !== c.accent && !isNeutral(k.hex) && hsl(k.hex).s >= 0.25 && k.weight >= 3 && farFromAccent(k); });
    var warm = notAccent.filter(function (k) { var kh = hsl(k.hex); return isWarm(kh) && kh.s >= 0.5; });
    // the one the site leans on most; saturation breaks a tie
    var byUse = function (a, b) { return b.weight - a.weight || hsl(b.hex).s - hsl(a.hex).s; };
    var bySat = function (a, b) { return hsl(b.hex).s - hsl(a.hex).s; };
    var ring = warm.sort(byUse)[0] || notAccent.sort(bySat)[0] || null;
    if (ring) {
      var samePin = pins.filter(function (p) { return T.contrast(ring.hex, p) < 1.4 && hueDist(hsl(ring.hex).h, hsl(p).h) < 30; });
      if (samePin.length) {
        leftOut.push("The site's " + colourName(ring.hex) + " is one of the map's own, so the ring round a chosen place keeps LOKA's.");
      } else {
        c.highlight = ring.hex; c.highlightDeep = ring.hex;
        say("highlight", ring, "the ring round a chosen place");
      }
    }

    // the owner's own swaps (from the found list), after the rules: they are
    // the owner's call, within what the guard allows
    Object.keys(F.chosen).forEach(function (slot) {
      var v = F.chosen[slot];
      if (SLOTS.indexOf(slot) < 0 || typeof v !== "string" || !HEX.test(v)) return;
      v = v.toUpperCase();
      if ((slot === "page" || slot === "surface" || slot === "surfaceAlt") && T.luminance(v) < T.LIGHT_ENOUGH) {
        lines.push("The " + colourName(v) + " chosen for the " + slot + " is too dark for a page, so it is not used.");
        return;
      }
      c[slot] = v;
      var match = F.colours.filter(function (k) { return k.hex === v; })[0];
      say(slot, match || { hex: v, usedFor: "" }, "chosen by you");
      if (slot === "accent") c.accentDeep = T.darken(v, 0.30);
      if (slot === "highlight") c.highlightDeep = v;
      if (slot === "text" && c.page) { c.textSecondary = T.over(v, c.page, 0.22); c.textMuted = T.over(v, c.page, 0.38); }
    });

    var theme = { version: 1, colors: {} };
    SLOTS.forEach(function (k) { if (c[k]) theme.colors[k] = c[k]; });
    if (F.corners) theme.corners = F.corners;
    if (F.logo) {
      var ratio = F.logo.width / F.logo.height;
      theme.logoMaxWidth = ratio >= 3 ? 180 : (ratio <= 1.25 ? 120 : 150);
    }

    // the guard, once: what it darkens is written back, so the saved look
    // needs no change at run time, and each change is said in plain words
    var r = T.resolve(theme);
    SLOTS.forEach(function (k) {
      var v = r.vars[T.VARS[k]];
      if (theme.colors[k] && v && v !== theme.colors[k]) {
        var src = from[k] || from[k.replace(/Deep$/, "")];
        var who = src ? "the site's " + src.name : "the " + colourName(theme.colors[k]);
        lines.push("Darkened " + who + " a little so " + (k === "highlightDeep" ? "warning words" : k === "accentDeep" ? "pressed buttons" : "words") + " stay readable.");
        theme.colors[k] = v;
      }
    });
    return { theme: theme, lines: lines, leftOut: leftOut, from: from };
  }

  return { map: map, hsl: hsl, chroma: chroma, isNeutral: isNeutral, lab: lab, deltaE: deltaE, colourName: colourName, hueDist: hueDist, SLOTS: SLOTS };
});
