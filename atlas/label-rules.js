/* LOKA Atlas — how a column heading becomes a label.
 *
 * A spreadsheet's column heading is often a whole survey question: "What
 * languages do you primarily work in? Feel free to mention all if there is
 * more than one." That heading is the honest name of the column, and it is
 * also far too long to be a key's name in a 320-pixel drawer, a field label on
 * a card, or a line in the Map Browser. So every place that prints a heading
 * as a label needs the same two things: a short name to print, and the whole
 * heading one hover (or one tap on ⓘ) away.
 *
 * This file is the one rule for that, read by the browser (atlas.js, a plain
 * script tag) and by the server (api/apps/atlas.js and the one-off script,
 * through createRequire), so that a name worked out on the server and a name
 * worked out in the browser are the same name. It replaces three rules that
 * had grown separately — the viewer lowercased every heading after its first
 * letter ("What languages do you primarily work in? feel free…"), the card
 * builder cut at seventy-two, and the key list cut nowhere.
 *
 * Three decisions live here:
 *
 *   1. CASING. A heading keeps its own capitals. Only a column id written as a
 *      slug (created_at, place-tags) is opened out and given a capital, and a
 *      heading SHOUTED IN CAPITALS is brought down to a sentence, because a
 *      shouted heading has no case to keep. "Feel free" never becomes "feel
 *      free", and "Arunachal Pradesh" is never "arunachal pradesh".
 *
 *   2. LONG. A heading longer than LONG_HEADING characters is long. Thirty-six,
 *      from a measurement (October 2026, the 320px drawer at 1280×800): a key's
 *      row is 244px wide, and a 34-character name at the key's .8rem font took
 *      209px — about 6.2px a character, so roughly 35 characters fit on one
 *      line beside the tick, and about 31 once the ⓘ sits after the name.
 *      SHORT_MAX is 32 for that reason: it is what the model is asked for, so
 *      a stored name and its ⓘ share a line. The plain cut below runs to the
 *      line itself (35 letters with its ellipsis), because a cut that keeps
 *      one more word is worth the ⓘ moving along.
 *      (A discovered question's own wording, in keyLabels, is never shortened
 *      — it wins as an owner's name does — and the reading already clips one
 *      to forty, so a question can still take two lines. That is allowed.)
 *
 *   3. SHORT. The plain-code short name, used until the server has stored a
 *      better one and whenever it cannot: the first clause of the heading —
 *      up to its question mark, or before a bracket, colon or dash — with the
 *      asking words taken off a "What … do you …?" question, cut at a word to
 *      SHORT_MAX characters with an ellipsis. It never invents a word: every
 *      word of a short name is a word of the heading, in the heading's order.
 *
 * The server may ask the model for a better short name, once per layer, and
 * store it on the layer as shortLabels (api/lib/atlas/short-labels.js). A name
 * the owner gave by hand (keyLabels) always wins over both.
 *
 * Nothing here talks to the network or the disk.
 */
(function (root, make) {
  var made = make();
  if (typeof module === "object" && module.exports) module.exports = made;
  else root.LokaLabelRules = made;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LONG_HEADING = 36;   // longer than this is "long": shown short, whole on hover (measured, above)
  var SHORT_MAX = 32;      // a short name is at most this many characters

  /* Columns that are never labels: the machinery's own answer columns, private
     columns, and the coordinates. */
  function isLabelColumn(col) {
    var c = String(col || "");
    if (!c || c.charAt(0) === "_" || /^pattern_\d+/.test(c)) return false;
    return !/^(lat|latitude|lng|lon|long|longitude|x|y|geometry|wkt)$/i.test(c.trim());
  }

  /* 1. Casing, and nothing else: the whole heading, tidied. */
  function headingCase(name) {
    var raw = String(name == null ? "" : name).trim();
    if (!raw) return "";
    var t;
    if (!/\s/.test(raw) && /[_-]/.test(raw)) {
      /* A slug: created_at, place-tags, created_by_user_id. Opened out and
         given one capital. (A hyphen inside a heading that has spaces is a
         word's own — "human-friendly" — and is left alone below.) */
      t = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    } else {
      t = raw.replace(/_+/g, " ").replace(/\s+/g, " ").trim()
        // "affiliation ?" is how a form wrote it; nobody reads it that way
        .replace(/\s+([?!.,;:])/g, "$1");
      /* Shouted — every letter a capital, more than one word — is brought down
         to a sentence. A single capitalised word (GPS, NGO, ID) is an
         abbreviation and keeps its capitals. */
      var letters = t.replace(/[^A-Za-z]/g, "");
      if (letters.length > 1 && letters === letters.toUpperCase() && /\s/.test(t)) t = t.toLowerCase();
    }
    return t.replace(/^[a-z]/, function (c) { return c.toUpperCase(); });
  }

  function isLong(heading) { return headingCase(heading).length > LONG_HEADING; }

  /* Cut at a word, never past max, and never leave a dangling joining word
     ("Name of Organisation or…") in front of the ellipsis. */
  function cutAtWord(t, max) {
    if (t.length <= max) return t;
    /* Before cutting mid-phrase, try dropping a trailing "and why", "or
       other", ", if any": a whole phrase that then fits a line is better than
       a cut with an ellipsis. */
    var JOINER = /^(.{8,})(\s(and|or|but|if|when|where|which|with)\s|,\s)/i;
    var m = t.slice(0, LONG_HEADING + 2).match(JOINER);   // greedy: the last joiner on the line
    while (m) {
      var head = m[1].replace(/[\s,;:]+$/, "");
      if (head.length <= LONG_HEADING && head.length >= Math.floor(max / 2)) return head;
      m = head.match(JOINER);
    }
    var cut = t.slice(0, max + 1).lastIndexOf(" ");
    var s = cut >= Math.floor(max / 2) ? t.slice(0, cut) : t.slice(0, max);
    // a trailing "or", "and", "of", "the"… says nothing on its own
    var JOIN = /\s+(or|and|of|the|a|an|in|to|for|with|on|at|by|your|its|their|from|about|if|is|are|be|this|that|these|those)$/i;
    var was;
    do { was = s; s = s.replace(/[\s,;:(–—-]+$/, "").replace(JOIN, ""); } while (s !== was);
    return s + "…";
  }

  /* Form scaffolding that is not the heading's own meaning: "Please select all
     that apply", "Tick one", "(if applicable)". A clause that is only this is
     skipped in favour of the clause after it. */
  var SCAFFOLD = /^(please\s+|kindly\s+)?(select|tick|choose|check|mark|pick)(\s+all|\s+one|\s+any|\s+as\s+many)?(\s+that|\s+which|\s+as)?(\s+apply|\s+applies|\s+applicable)?\.?$/i;

  /* The first clause: up to the question mark, or before a bracket, a colon,
     a spaced dash or a sentence's full stop. Kept only when it says enough;
     a stop that leaves too little ("Approx.") is passed over for the next. */
  function firstClause(t) {
    var stops = [];
    var i;
    if ((i = t.indexOf("?")) > 0) stops.push({ at: i, keep: 1 });
    if ((i = t.indexOf("(")) > 0) stops.push({ at: i, keep: 0 });
    if ((i = t.indexOf(":")) > 0) stops.push({ at: i, keep: 0, tail: true });
    if ((i = t.search(/\s[\u2013\u2014-]\s/)) > 0) stops.push({ at: i, keep: 0, tail: true });
    if ((i = t.search(/[.!](\s|$)/)) > 0) stops.push({ at: i, keep: 0 });
    stops.sort(function (a, b) { return a.at - b.at; });
    for (var k = 0; k < stops.length; k++) {
      var head = t.slice(0, stops[k].at + stops[k].keep).trim();
      if (head.length < 8) continue;
      /* "Please select all that apply: water sources used" — the words before
         the colon are the form's, the words after it are the heading's */
      if (stops[k].tail && SCAFFOLD.test(head.replace(/[?:]$/, ""))) {
        var rest = t.slice(stops[k].at + 1).replace(/^[\s\u2013\u2014-]+/, "").trim();
        return rest.length >= 8 ? rest.replace(/^[a-z]/, function (c) { return c.toUpperCase(); }) : head;
      }
      return head;
    }
    return t;
  }

  /* The asking words off a question, leaving the thing asked about.
       "What languages do you primarily work in?"        → "languages"
       "Which geographic areas do you work in?"          → "geographic areas"
       "What best describes your work, profile, role?"  → "work, profile, role"
       "Please share links to any relevant resources."  → "links to any relevant resources"
       "How long have you been involved in this work?"  → "How long involved in this work?"
       "Do you have access to a handpump?"              → "access to a handpump"
     Anything else is kept as it is and cut at a word. */
  function unasked(q) {
    var t = q.replace(/^(what|which)\s+of\s+the\s+following\s+/i, function (m0) { return m0.slice(0, 5).trim() + " "; });
    var m = t.match(/^(what|which)\s+(kind of\s+|kinds of\s+|type of\s+|types of\s+|sort of\s+)?(.+?)\s+(do|does|did|are|is|was|were|have|has|had|would|will|can|could|should|might)\s+(you|your|they|it|we|the|this|that|there|these|those)\b/i);
    if (m && m[3].length >= 3) return m[3];
    m = t.match(/^(what|which)\s+(best\s+)?(describes|is|are|was|were)\s+(the\s+|your\s+|its\s+|their\s+)?(.+?)[?]?$/i);
    if (m && m[5].length >= 3) return m[5];
    m = t.match(/^(please|kindly)\s+(share|mention|enter|write|give|provide|specify|list|tell us|describe|name|add|select|choose|tick|indicate|state|note|upload|attach)\s+(.+?)[?.]?$/i);
    if (m && m[3].length >= 3) return m[3];
    m = t.match(/^(please|kindly)\s+(.+?)[?.]?$/i);
    if (m && m[2].length >= 3) return m[2];
    // "Do you have access to a handpump?" → "access to a handpump"
    m = t.match(/^(do|does|did)\s+(you|your\s+\w+|they|the\s+\w+)\s+(have|get|own|use|possess|know|see)\s+(any\s+|a\s+|an\s+|the\s+)?(.+?)[?]?$/i);
    if (m && m[5].length >= 3) return m[5];
    // "Is there a primary school in the village?" → "primary school in the village"
    m = t.match(/^(is|are)\s+there\s+(any\s+|a\s+|an\s+)?(.+?)[?]?$/i);
    if (m && m[3].length >= 3) return m[3];
    // "How long have you been involved in this work?" → "How long involved in this work?"
    m = t.match(/^(how\s+(?:long|often|many\s+times))\s+(have|has|had)\s+(you|they|it|we)\s+(been\s+)?(.+?)[?]?$/i);
    if (m && m[5].length >= 3) return m[1] + " " + m[5] + "?";
    return t;
  }

  /* 3. The plain-code short name of a heading. Not long: the heading itself. */
  function shortHeading(name) {
    var full = headingCase(name);
    if (full.length <= LONG_HEADING) return full;
    /* A whole clause that fits a line (LONG_HEADING) is kept whole, even past
       SHORT_MAX: "Name of Organisation or Collective" says more than "Name of
       Organisation…", and the ⓘ sits at the row's end either way. Only a
       clause that would not fit is taken apart. */
    var t = firstClause(full);
    if (t.length > LONG_HEADING) {
      var bare = unasked(t.replace(/[?]$/, ""));
      if (bare !== t.replace(/[?]$/, "")) {
        t = bare.replace(/^(the|a|an|your|its|their)\s+/i, "");
        t = t.replace(/^[a-z]/, function (c) { return c.toUpperCase(); });
      }
    }
    // the cut runs to the line, ellipsis included: a 35-letter cut that keeps
    // "credited" beats a 32-letter one that stops at "How would you like"
    if (t.length > LONG_HEADING) t = cutAtWord(t, LONG_HEADING - 1);
    return t.replace(/^[a-z]/, function (c) { return c.toUpperCase(); });
  }

  /* Every column of these rows that is a label and is long — the ones a
     short name is wanted for. */
  function longHeadingsOf(columns) {
    var out = [];
    (columns || []).forEach(function (c) {
      if (isLabelColumn(c) && isLong(c) && out.indexOf(c) < 0) out.push(c);
    });
    return out;
  }

  /* Is this a short name worth keeping (from the model, or from anybody)?
     Plain words, no longer than the rule allows, and not the heading again. */
  function acceptableShort(short, heading) {
    var s = String(short == null ? "" : short).replace(/\s+/g, " ").trim();
    if (!s || s.length > LONG_HEADING - 1) return "";   // the line, ellipsis and all — what the plain cut may also run to
    // no cap on words: the plain cut can run to seven ("How would you like to be credited…"); the line is the limit
    if (s.toLowerCase() === headingCase(heading).toLowerCase()) return "";
    return s;
  }

  /* 2 + 3 together: what to print for a column, and what to say on hover.
       given   — a name the owner gave (keyLabels[col]); always wins, never ⓘ
       stored  — the short name the server kept (shortLabels[col])
       else    — the plain-code short name, when the heading is long
     Answers { text, full, shortened }: print text; when shortened, the full
     heading is the hover and the ⓘ. */
  function labelFor(col, layer) {
    var L = layer || {};
    var given = L.keyLabels && L.keyLabels[col];
    if (given) return { text: String(given), full: String(given), shortened: false };
    var full = headingCase(col);
    var stored = L.shortLabels && acceptableShort(L.shortLabels[col], col);
    if (stored) return { text: stored, full: full, shortened: true };
    if (full.length <= LONG_HEADING) return { text: full, full: full, shortened: false };
    var short = shortHeading(col);
    return { text: short, full: full, shortened: short !== full };
  }

  return {
    LONG_HEADING: LONG_HEADING,
    SHORT_MAX: SHORT_MAX,
    isLabelColumn: isLabelColumn,
    headingCase: headingCase,
    isLong: isLong,
    shortHeading: shortHeading,
    longHeadingsOf: longHeadingsOf,
    acceptableShort: acceptableShort,
    labelFor: labelFor
  };
});
