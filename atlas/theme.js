/* LOKA Atlas — an atlas's own look (colours, type, corners).
 *
 * An atlas may carry an optional `theme` in its manifest (written into
 * manifest.local.json, the file a rebuild leaves alone). The viewer turns it
 * into the page's colour and type variables; an atlas without one looks
 * exactly as it always has, because nothing here runs unless a theme is
 * given.
 *
 *   theme: {
 *     colors: { page, surface, surfaceAlt, text, textSecondary, textMuted,
 *               accent, accentDeep, highlight, highlightDeep },   // "#RRGGBB"
 *     fonts:  { display, text, displayWeight, cssUrl },
 *     corners: "square" | "soft",
 *     logoMaxWidth: 60..220                                       // px
 *   }
 *
 * What a theme can never do, whatever it says:
 *   - make the page dark. LOKA has no dark mode; a background that is not
 *     light is refused and LOKA's own is kept.
 *   - make words hard to read. Every pair of words-on-background is checked
 *     against the WCAG AA rule (4.5 to 1 for words, 3 to 1 for a ring or
 *     border). A colour that fails is darkened, step by step, until it
 *     passes, and the change is written in `notes` so a person can see it.
 *   - load fonts from anywhere but Google Fonts.
 *   - touch the map's own colours (ground, water, ramps, the places' dots and
 *     the answer colours), so places stay as distinguishable as they are.
 *   - touch "Powered by LOKA Atlas". index.html pins the badge's colours and
 *     faces to LOKA's own, inside the badge, so no variable set here reaches
 *     it.
 *
 * Shared by the viewer (window.LokaTheme), the one-off deploy script and the
 * checks (require), so the rule is one rule. */
(function (root, make) {
  var made = make();
  if (typeof module === "object" && module.exports) module.exports = made;
  else root.LokaTheme = made;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // LOKA's own values (index.html :root). Used as the background a colour is
  // checked against when the theme leaves that background alone.
  var LOKA = {
    page: "#FAF8F3", surface: "#FDFCF8", surfaceAlt: "#F0EDE4",
    text: "#24211D", textSecondary: "#5A5751", textMuted: "#6E6A63",
    accent: "#2A6B41", accentDeep: "#1F5232", highlight: "#C9402B", highlightDeep: "#9E3220",
  };

  // theme key -> the page variable it sets
  var VARS = {
    page: "--color-page", surface: "--color-surface", surfaceAlt: "--color-surface-alt",
    text: "--color-text-primary", textSecondary: "--color-text-secondary", textMuted: "--color-text-muted",
    accent: "--color-leaf", accentDeep: "--color-leaf-deep",
    highlight: "--color-sindoor", highlightDeep: "--color-sindoor-deep",
  };

  var BACKGROUNDS = ["page", "surface", "surfaceAlt"];
  var LIGHT_ENOUGH = 0.75;     // relative luminance a background must reach
  var TEXT = 4.5, RING = 3;    // WCAG AA: words; a border or ring

  // The one host fonts may come from. Its stylesheet is plain CSS that points
  // at fonts.gstatic.com; nothing else is fetched.
  var FONT_CSS = /^https:\/\/fonts\.googleapis\.com\/css2\?[A-Za-z0-9=&:;@,.+%_-]{1,400}$/;
  var FONT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ]{0,39}$/;
  var HEX = /^#[0-9a-fA-F]{6}$/;

  function rgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function hex(c) {
    return "#" + c.map(function (v) { return ("0" + Math.round(v).toString(16)).slice(-2); }).join("").toUpperCase();
  }
  function luminance(h) {
    var c = rgb(h).map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) {
    var x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function darken(h, t) {   // t: 0..1 toward black
    return hex(rgb(h).map(function (v) { return v * (1 - t); }));
  }
  function rgba(h, a) {
    var c = rgb(h);
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
  }
  // `fg` laid over `bg` at opacity `a`, as the eye sees it
  function over(bg, fg, a) {
    var b = rgb(bg), f = rgb(fg);
    return hex(b.map(function (v, i) { return v * (1 - a) + f[i] * a; }));
  }
  // darken `fg` just enough that it reaches `need` against every one of `bgs`
  function fit(fg, bgs, need) {
    for (var i = 0; i <= 50; i++) {
      var c = i ? darken(fg, i * 0.02) : fg.toUpperCase();
      if (bgs.every(function (b) { return contrast(c, b) >= need; })) return c;
    }
    return "#000000";
  }

  /* Read a theme and say what it does. Returns
       { vars: { "--color-page": "#…", … }, fontCss: url|null, notes: [ … ] }
     `vars` is empty when there is no usable theme. Never throws. */
  function resolve(theme) {
    var out = { vars: {}, fontCss: null, notes: [] };
    if (!theme || typeof theme !== "object") return out;
    var note = function (s) { out.notes.push(s); };
    var given = (theme.colors && typeof theme.colors === "object") ? theme.colors : {};
    var c = {};
    Object.keys(VARS).forEach(function (k) {
      if (given[k] === undefined) return;
      if (typeof given[k] === "string" && HEX.test(given[k])) c[k] = given[k].toUpperCase();
      else note(k + ": “" + String(given[k]).slice(0, 20) + "” is not a colour like #6B1164; LOKA’s own is kept");
    });

    // light backgrounds only
    BACKGROUNDS.forEach(function (k) {
      if (c[k] && luminance(c[k]) < LIGHT_ENOUGH) {
        note(k + ": " + c[k] + " is too dark for a page (LOKA has no dark mode); LOKA’s own is kept");
        delete c[k];
      }
    });
    var bg = BACKGROUNDS.map(function (k) { return c[k] || LOKA[k]; });

    function guard(k, bgs, need, why) {
      if (!c[k]) return;
      var got = fit(c[k], bgs, need);
      if (got !== c[k]) {
        note(k + ": " + c[k] + " was too faint " + why + "; darkened to " + got);
        c[k] = got;
      }
    }
    guard("text", bg, TEXT, "for words on the page");
    guard("textSecondary", bg, TEXT, "for words on the page");
    guard("textMuted", bg, TEXT, "for words on the page");
    // the accent is a link on the page AND the ground of white words on a button
    guard("accent", bg.concat(["#FFFFFF"]), TEXT, "for links, or for white words on a button");
    // the deep shades are also words on their own tint (a pressed button)
    var tintOf = function (k) { return over(bg[1], c[k] || LOKA[k], 0.10); };
    guard("accentDeep", bg.concat(["#FFFFFF", tintOf("accent")]), TEXT, "for links, or for white words on a button");
    // the highlight is a ring and a border: 3 to 1 is the rule for those
    guard("highlight", bg, RING, "as a ring on the page");
    guard("highlightDeep", bg.concat([tintOf("highlight")]), TEXT, "for words on the page");

    Object.keys(c).forEach(function (k) { out.vars[VARS[k]] = c[k]; });
    if (c.accent) out.vars["--color-leaf-tint"] = rgba(c.accent, 0.10);
    if (c.highlight) out.vars["--color-sindoor-tint"] = rgba(c.highlight, 0.10);
    if (c.text) {
      out.vars["--color-border"] = rgba(c.text, 0.18);
      out.vars["--color-divider"] = rgba(c.text, 0.10);
    }

    // type
    var f = (theme.fonts && typeof theme.fonts === "object") ? theme.fonts : null;
    if (f) {
      if (f.cssUrl !== undefined && !(typeof f.cssUrl === "string" && FONT_CSS.test(f.cssUrl))) {
        note("fonts: only Google Fonts (https://fonts.googleapis.com/css2?…) can be loaded; LOKA’s own faces are kept");
      } else {
        if (f.cssUrl) out.fontCss = f.cssUrl;
        if (f.display !== undefined) {
          if (typeof f.display === "string" && FONT_NAME.test(f.display)) out.vars["--font-display"] = '"' + f.display + '","Lora",var(--font-companions-serif),serif';
          else note("fonts.display: not a font name; LOKA’s own is kept");
        }
        if (f.text !== undefined) {
          if (typeof f.text === "string" && FONT_NAME.test(f.text)) out.vars["--font-body"] = '"' + f.text + '","Karla",var(--font-companions-sans),sans-serif';
          else note("fonts.text: not a font name; LOKA’s own is kept");
        }
        var w = Number(f.displayWeight);
        if (f.displayWeight !== undefined) {
          if (w >= 400 && w <= 800 && w % 100 === 0) out.vars["--weight-display"] = String(w);
          else note("fonts.displayWeight: use 400 to 800 in hundreds; LOKA’s own is kept");
        }
      }
    }

    if (theme.corners === "square") { out.vars["--radius-md"] = "0"; out.vars["--radius-lg"] = "0"; }
    else if (theme.corners !== undefined && theme.corners !== "soft") note("corners: use “square” or “soft”");

    if (theme.logoMaxWidth !== undefined) {
      var lw = Number(theme.logoMaxWidth);
      if (lw >= 60 && lw <= 220) out.vars["--logo-max-width"] = Math.round(lw) + "px";
      else note("logoMaxWidth: use 60 to 220 (pixels)");
    }
    return out;
  }

  /* In the browser: put the resolved theme on the page. Returns the notes. */
  function apply(theme, doc) {
    doc = doc || (typeof document !== "undefined" ? document : null);
    var r = resolve(theme);
    if (!doc || !Object.keys(r.vars).length && !r.fontCss) return r.notes;
    var rootEl = doc.documentElement;
    Object.keys(r.vars).forEach(function (k) { rootEl.style.setProperty(k, r.vars[k]); });
    rootEl.classList.add("atlas-themed");
    if (r.fontCss && !doc.querySelector('link[data-atlas-theme-fonts]')) {
      var link = doc.createElement("link");
      link.rel = "stylesheet";
      link.href = r.fontCss;
      link.setAttribute("data-atlas-theme-fonts", "");
      doc.head.appendChild(link);
    }
    return r.notes;
  }

  return { resolve: resolve, apply: apply, contrast: contrast, luminance: luminance, LOKA: LOKA, VARS: VARS, FONT_CSS: FONT_CSS };
});
