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

  /* 4. A PLACE'S SHORT NAME. A layer out of the LOKA app has no name column,
     only the tagger's sentence ("description"), so a pin, a search hit and a
     card heading showed half a sentence. The server writes each such place a
     short name of the tagger's own words into NAME_FIELD (api/lib/atlas/
     place-names.js); until that lands, and wherever the model's answer breaks
     the rules, the plain cut below stands in: the first clause when it is
     short enough, else the first words, cut at a word, never past NAME_MAX
     characters with its ellipsis. The same 32 as SHORT_MAX, for the same
     reason: it is what fits beside a pin (label_text.maxChars) and on one
     line of a card heading. The column is the machinery's, never a label, a
     key, a card fact or a plain choice — label-rules, reading-rules and the
     naming controls all leave it out by this name. */
  var NAME_FIELD = "loka_name";
  var NAME_MAX = 32;

  /* Columns that are never labels: the machinery's own answer columns, the
     written short name, private columns, and the coordinates. */
  function isLabelColumn(col) {
    var c = String(col || "");
    if (!c || c.charAt(0) === "_" || /^pattern_\d+/.test(c) || c === NAME_FIELD) return false;
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
       "Do you have access to a handpump?"              → "access to a handpump"
     Anything else ("How long have you been…?", and every heading not in
     English — this is English question grammar) is kept as it is and cut at
     a word; the model's short name replaces the cut where there is a key. */
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

  /* 4. The first words of a place's description, as a name. Not long: the
     whole thing, as it is. Long: the first clause — up to a full stop, a
     question mark, a colon, a spaced dash, a bracket or a line break — when
     that is a name's length (8 to NAME_MAX); otherwise the first words, cut
     at a word, with an ellipsis, so the whole thing never passes NAME_MAX.
     Every word is the description's own, in its order; nothing is added. */
  function firstWords(text) {
    var raw = String(text == null ? "" : text).trim();
    if (!raw) return "";
    var whole = raw.replace(/\s+/g, " ").trim();
    if (whole.length <= NAME_MAX) return whole;
    var line = raw.split(/\n+/)[0].replace(/\s+/g, " ").trim();
    var stops = [];
    var i;
    var m = line.match(/[.!?]+(\s|$)/);
    // a sentence's end: the full stop is dropped, a question or exclamation mark kept
    if (m && m.index > 0) stops.push(line.slice(0, m.index) + m[0].replace(/[.\s]+/g, ""));
    if ((i = line.indexOf(":")) > 0) stops.push(line.slice(0, i));
    if ((i = line.search(/\s[–—-]\s/)) > 0) stops.push(line.slice(0, i));
    if ((i = line.indexOf("(")) > 0) stops.push(line.slice(0, i));
    stops.sort(function (a, b) { return a.length - b.length; });
    for (var k = 0; k < stops.length; k++) {
      var head = stops[k].replace(/[\s,;:]+$/, "").trim();
      if (head.length >= 8 && head.length <= NAME_MAX) return head;
    }
    if (line.length <= NAME_MAX) return line;
    var cut = line.slice(0, NAME_MAX - 1);
    var sp = cut.lastIndexOf(" ");
    if (sp > (NAME_MAX - 1) * 0.5) cut = cut.slice(0, sp);
    return cut.replace(/[\s,;:(–—-]+$/, "") + "…";
  }

  /* 5. "Explore by …" — the heading over a key's row ("version D", Mithun,
     October 2026). A question's row is headed "Explore <place> by <noun>",
     and the question itself sits under it in a small grey line, always.

     The noun is picked by the model from the question's own words, and it is
     checked here, on the server before it is stored and in the page before
     it is shown: every word of it must be a word of the question (any case,
     singular or plural), at most NOUN_WORDS words and NOUN_MAX letters. A
     noun that adds a word, or that is only asking words ("what", "is it"),
     is no noun. With no noun, and always for a yes-or-no question, the
     heading is the question exactly as it was written — a yes-or-no question
     has no honest noun ("by whether it's free" is a rewording).

     The place is the owner's own ("Call this place", in Settings), and is
     left out until they set one: "Explore by function". */
  var NOUN_WORDS = 4;
  var NOUN_MAX = 32;
  var PLACE_MAX = 40;
  var YES_NO = /^(is|isn't|are|aren't|was|wasn't|were|weren't|am|does|doesn't|do|don't|did|didn't|can|can't|could|has|hasn't|have|haven't|had|will|won't|would|should|shall|may|might|must)\b/i;
  // words that ask, point or join — a noun made only of these names nothing
  var ASKING = ("what which who whom whose where when why how is are was were be been am do does did " +
    "can could has have had will would should it its it's this that these those there here the a an " +
    "of to in on at for by and or as with from").split(" ");
  var ASKING_START = /^(what|which|who|whom|whose|where|when|why|how)$/;

  function isYesNo(question) {
    return YES_NO.test(String(question == null ? "" : question).trim().replace(/^[¿¡"“'‘(\[]+/, ""));
  }
  // a word as it is compared: lower case, the punctuation round it dropped
  function bare(w) {
    return String(w).toLowerCase().replace(/’/g, "'")
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  }
  // the same word, singular or plural
  function forms(w) {
    var out = [w];
    if (/ies$/.test(w) && w.length > 4) out.push(w.slice(0, -3) + "y");
    if (/y$/.test(w) && w.length > 2) out.push(w.slice(0, -1) + "ies");
    if (/es$/.test(w) && w.length > 3) out.push(w.slice(0, -2));
    if (/s$/.test(w) && w.length > 3) out.push(w.slice(0, -1));
    out.push(w + "s", w + "es");
    return out;
  }
  function cleanPhrase(s) {
    return String(s == null ? "" : s).replace(/\s+/g, " ").trim()
      .replace(/^["“'‘]+|["”'’]+$/g, "").replace(/[\s?.!,;:…]+$/, "").trim();
  }

  /* The model's noun for a question, checked. Answers the noun to keep, or ""
     when it breaks a rule. Words are given back in the question's own case
     where the question capitalises them inside the sentence (a name), and in
     lower case otherwise ("function", not "Function"). */
  function nounFromQuestion(noun, question) {
    var q = String(question == null ? "" : question).replace(/\s+/g, " ").trim();
    if (!q || isYesNo(q)) return "";
    var s = cleanPhrase(noun);
    if (!s || s.length > NOUN_MAX) return "";
    var words = s.split(" ");
    if (words.length > NOUN_WORDS) return "";
    // the question's words, each with the case it was written in
    var asked = {};
    q.split(" ").forEach(function (raw, i) {
      var parts = [raw].concat(raw.indexOf("-") > 0 ? raw.split("-") : []);
      parts.forEach(function (p) {
        var k = bare(p);
        if (!k) return;
        var kept = String(p).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
        // a capital on the question's first word is the sentence's, not the word's
        if (!(k in asked) || (i > 0 && asked[k] === k)) asked[k] = i === 0 ? k : kept;
      });
    });
    var out = [], named = false;
    for (var i = 0; i < words.length; i++) {
      var k = bare(words[i]);
      if (!k) return "";
      var hit = null;
      var fs = forms(k);
      for (var j = 0; j < fs.length; j++) if (fs[j] in asked) { hit = fs[j]; break; }
      if (hit === null) return "";
      if (i === 0 && ASKING_START.test(k)) return "";
      if (ASKING.indexOf(k) < 0) named = true;
      // the question's own capitals only when the word is the question's word as written
      out.push(hit === k && asked[hit] !== hit ? asked[hit] : k);
    }
    return named ? out.join(" ") : "";
  }

  // a column's name made singular, on its last word: "Categories" → "Category"
  var NOT_PLURAL = /^(species|series|news|means|physics|status|address|bus|gas|analysis|basis|lens|canvas|census)$/i;
  function singular(word) {
    var w = String(word);
    if (NOT_PLURAL.test(w)) return w;
    if (/ies$/i.test(w) && w.length > 4) return w.slice(0, -3) + (/IES$/.test(w) ? "Y" : "y");
    if (/(ss|us|is|ics)$/i.test(w)) return w;
    if (/(ches|shes|xes|zes|sses|uses)$/i.test(w)) return w.slice(0, -2);
    if (/[^s]s$/i.test(w) && w.length > 3) return w.slice(0, -1);
    return w;
  }
  /* A column's name as the end of "Explore by …": singular, and in lower case
     where it only wore a capital to start a label ("Tag id" → "tag id"; GPS
     and Arunachal Pradesh keep theirs). A name that is itself a question, or
     was cut short with an ellipsis, cannot follow "by" — it is answered "". */
  function columnNoun(label) {
    var s = String(label == null ? "" : label).replace(/\s+/g, " ").trim();
    if (!s || /[?…]$/.test(s) || /\.\.\.$/.test(s)) return "";
    if (ASKING_START.test(bare(s.split(" ")[0])) || isYesNo(s)) return "";
    var words = s.split(" ");
    words[words.length - 1] = singular(words[words.length - 1]);
    // a label in sentence case ("Tag id") wore its one capital to start a
    // label; one with a capital further in ("Arunachal Pradesh …") is a name
    var sentence = words.slice(1).every(function (w) { return !/^\p{Lu}/u.test(w); });
    return words.map(function (w, i) {
      return i === 0 && sentence && /^\p{Lu}[^\p{Lu}]*$/u.test(w) ? w.toLowerCase() : w;
    }).join(" ");
  }

  // the owner's name for the place, tidied; "" when there is none
  function cleanPlaceName(s) {
    var t = String(s == null ? "" : s).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
    return t.slice(0, PLACE_MAX).trim();
  }

  /* The heading over one key's row, and the small line under it.
       o.question — a question's own wording (keyLabels), for a question
       o.noun     — the noun stored for it (keyNouns), checked again here
       o.label    — what the row is called, for a spreadsheet column
       o.column   — the column's own heading, for "Column: …"
     Answers { heading, sub }; sub is "" when there is no second line (a
     question shown as written says the same thing twice otherwise). */
  function keyHeading(o) {
    o = o || {};
    /* No place name, ever (Mithun, 2026-10-20): "Explore Bengaluru by …" on
       every row of a panel is repetitive, and the atlas's title already says
       where it is. Every heading reads "Explore by <noun>". */
    var explore = function (noun) { return "Explore by " + noun; };
    if (o.question != null && o.question !== "") {
      var q = String(o.question);
      var noun = nounFromQuestion(o.noun, q);
      return noun ? { heading: explore(noun), sub: q } : { heading: q, sub: "" };
    }
    var label = String(o.label == null ? "" : o.label);
    var col = String(o.column == null ? "" : o.column) || label;
    var cn = columnNoun(label);
    return { heading: cn ? explore(cn) : label, sub: col ? "Column: " + col : "" };
  }

  /* No two rows of one panel share a heading (Mithun, 2026-10-21: "'Explore
     by Place' gets repeated"). Two questions can pick the same noun — "Which
     place is it?" and "What place does it sit beside?" both say place — and
     two rows both reading "Explore by place" tell a reader nothing about which
     is which. The first keeps its heading; every later row with the same one
     shows its own words as written instead (a question's wording, a column's
     heading), with no grey line, since that line would only say it again.
       list — [{ heading, sub, asWritten }] in panel order
     Answers a new list of { heading, sub }; the input is left alone. */
  function distinctHeadings(list) {
    var seen = {};
    return (list || []).map(function (h) {
      h = h || {};
      var key = String(h.heading || "").trim().toLowerCase();
      var out = { heading: h.heading, sub: h.sub };
      if (key && seen[key] && h.asWritten) out = { heading: String(h.asWritten), sub: "" };
      seen[key] = true;
      return out;
    });
  }

  /* People and ID columns are never read (Mithun, 8 Nov 2026: "stop reading
     people columns", and the reading must hold on data that is not LOKA's).
     One rule, shared by the reader (enrich.js textColumns), the viewer's
     keys, Insight's questions panel, Other keys, the story's quotes, the
     search index and the measuring scripts. A column is passed over when
     EITHER

       its NAME says it is about a person — any whole word of it (case and
       separators aside: "Recorded by", "_submitted_by", "created_by_user_id",
       "Respondent phone") is on PEOPLE_WORDS, or the name ends in "by" or
       "user id". A column merely called "name" is the PLACE's name, never a
       person; "name" is not on the list, "name of respondent" is caught by
       "respondent";

       or its VALUES say so — most of the filled cells are email addresses,
       phone numbers, or opaque ids (UUIDs, long hex, long runs of digits,
       long mixed tokens). An id column is never a question either.

     The name test is enough on its own because the viewer has only names to
     go by (a question's keyColumns); the reader, which has the values, asks
     both. Seen 8 Nov 2026: a re-read of Divar Island ASKED its
     created_by_user_id column (found nothing, showed nothing — still wrong:
     privacy and cost). Before that, the rule was LOKA-shaped (created_by,
     *_by, *_user_id) and a KoboToolbox "Enumerator" or a spreadsheet's
     "Email" went through. */
  /* Words that say a person on their own ("Enumerator", "created_by",
     "Respondent phone"). Company words — owner, contact, mobile, collector —
     say a person only beside a person or contact word ("Owner name",
     "Contact number", "Mobile no") or as the whole name ("Owner"): "Owner
     occupied?", "Contact type", "Mobile clinic", "Storm water collector" are
     about the place and stay read. Object.create(null): a column called
     "constructor" is a column. */
  var PEOPLE_WORDS = Object.create(null);
  ("user users username usernames userid userids author authors creator creators " +
   "observer observers recorder recorders surveyor surveyors enumerator enumerators volunteer volunteers " +
   "submitter submitters uploader uploaders contributor contributors reporter reporters " +
   "editor editors tagger taggers photographer photographers respondent respondents informant informants " +
   "interviewer interviewers interviewee interviewees " +
   "email emails phone phones telephone whatsapp").split(" ").forEach(function (w) { PEOPLE_WORDS[w] = true; });
  var COMPANY_WORDS = Object.create(null);
  "owner owners contact contacts mobile collector collectors".split(" ").forEach(function (w) { COMPANY_WORDS[w] = true; });
  // the words that make a company word a person: "owner name", "contact person", "mobile number"
  var WITH_WORDS = Object.create(null);
  "name names person persons people number numbers no nos num details detail info id phone email mail address".split(" ")
    .forEach(function (w) { WITH_WORDS[w] = true; });
  var ID_WORDS = Object.create(null);
  "id ids uuid uuids guid guids objectid identifier fid gid oid".split(" ").forEach(function (w) { ID_WORDS[w] = true; });
  // a column name as words: "created_by_user_id" → ["created","by","user","id"]; camelCase is opened too
  function nameWords(name) {
    return String(name == null ? "" : name).replace(/whatsapp/ig, "whatsapp").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase()
      .split(/[^a-z0-9]+/).filter(Boolean);
  }
  /* What a column's NAME says: { why: "people" | "id" | "", strong }.
     Strong is an explicit people name — "by" as the last word or before a
     person word ("Recorded by", "submitted_by"; "Crops grown by block" is
     about the crops), a person word, "e mail" as the pair, "cell phone". A
     company word alone or with a person word is "people" but weak; an id
     word is "id" and weak. Weak matches are passed over when questions are
     looked for, but never take an existing question off the map. */
  function nameSignal(name) {
    var words = nameWords(name), none = { why: "", strong: false };
    if (!words.length) return none;
    for (var i = 0; i < words.length; i++) {
      var w = words[i], next = words[i + 1];
      if (w === "by") { if (next === undefined || PEOPLE_WORDS[next] || next === "name") return { why: "people", strong: true }; continue; }
      if (w === "e") { if (next === "mail") return { why: "people", strong: true }; continue; }
      if (w === "cell") { if (next === "phone") return { why: "people", strong: true }; continue; }
      if (PEOPLE_WORDS[w]) return { why: "people", strong: true };
    }
    for (var c = 0; c < words.length; c++) {
      if (!COMPANY_WORDS[words[c]]) continue;
      if (words.length === 1) return { why: "people", strong: false };
      var before = words[c - 1], after = words[c + 1];
      if ((after !== undefined && WITH_WORDS[after]) || (before !== undefined && WITH_WORDS[before])) return { why: "people", strong: false };
    }
    for (var j = 0; j < words.length; j++) if (ID_WORDS[words[j]]) return { why: "id", strong: false };
    return none;
  }
  function whyNameNotRead(name) { return nameSignal(name).why; }
  function isPeopleName(name) { return whyNameNotRead(name) === "people"; }
  function isIdName(name) { return whyNameNotRead(name) === "id"; }

  var EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
  // a phone: written with a + or separators (never a dot: 12.971600 is a coordinate) and seven digits or more
  var PHONE = /^(\+|[\d\s()\-]*[\s()\-])[\d\s()\-]{6,}$/;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var LONG_HEX = /^[0-9a-f]{16,}$/i;
  var DIGIT_RUN = /^\d{10,}$/;     // ten digits or more: a count never; an id (a census or LGD code, a timestamp)
  // a long token with no spaces and a few digits in it: an api key, a record id
  var OPAQUE = /^(?=(?:[^\d]*\d){3})[A-Za-z0-9_\-:]{14,}$/;
  var DATE_LIKE = /^\d{1,4}[-\/.]\d{1,2}[-\/.]\d{1,4}$/;   // 04-03-2021 is a date, not a phone
  var VALUES_MOSTLY = 0.6;    // this share of the filled cells, and the column is what they are
  function cellOf(v) {
    if (v == null) return "";
    return String(Array.isArray(v) ? v.join("; ") : v).replace(/\s+/g, " ").trim();
  }
  function isPersonValue(s) {
    if (DATE_LIKE.test(s)) return false;
    return EMAIL.test(s) || (PHONE.test(s) && (s.match(/\d/g) || []).length >= 7);
  }
  function isIdValue(s) { return UUID.test(s) || LONG_HEX.test(s) || DIGIT_RUN.test(s) || OPAQUE.test(s); }
  /* What a column's VALUES say: "people" when most filled cells are emails
     or phone numbers, "id" when most are opaque ids, "" otherwise (an empty
     column says nothing). Strong when most are emails, phones or UUIDs. */
  function valuesSignal(values) {
    var filled = 0, person = 0, id = 0, uuid = 0;
    (values || []).forEach(function (v) {
      var s = cellOf(v);
      if (!s) return;
      filled++;
      if (isPersonValue(s)) person++;
      else if (isIdValue(s)) { id++; if (UUID.test(s)) uuid++; }
    });
    if (!filled) return { why: "", strong: false };
    if (person / filled >= VALUES_MOSTLY) return { why: "people", strong: true };
    if (id / filled >= VALUES_MOSTLY) return { why: "id", strong: uuid / filled >= VALUES_MOSTLY };
    return { why: "", strong: false };
  }
  function whyValuesNotRead(values) { return valuesSignal(values).why; }
  /* The one rule: why a column is not read — "people", "id" or "". Given the
     values too, either the name or the values is enough. */
  function notReadSignal(name, values) {
    var byName = nameSignal(name);
    if (byName.why && byName.strong) return byName;
    var byValues = values && values.length ? valuesSignal(values) : { why: "", strong: false };
    if (byValues.why && byValues.strong) return byValues;   // a weak name with values that are mostly emails: strong
    return byName.why ? byName : byValues;
  }
  function whyNotRead(name, values) { return notReadSignal(name, values).why; }
  function isPeopleColumn(name, values) { return !!whyNotRead(name, values); }
  // only a strong signal takes a question an earlier reading found off the map
  function strongNotRead(name, values) { var s = notReadSignal(name, values); return s.why && s.strong ? s.why : ""; }
  /* A value worth scrubbing from a place's shown words: an email, a phone,
     an id, or a short display name (title case, no digits: "Asha Rao"). A
     single capitalised word counts only from a column whose name is a strong
     people name (created_by, Enumerator: its words are names); from a weaker
     column "Good" or "Yes" is an answer, not a person. Never "Piped water". */
  var DISPLAY_NAME = /^(?:[A-Z][A-Za-z'’.\-]*)(?:\s+[A-Z][A-Za-z'’.\-]*){1,3}$/;
  var ONE_NAME = /^[A-Z][A-Za-z'’.\-]{2,}$/;
  var AN_ANSWER = Object.create(null);   // one capitalised word that is an answer, never a name
  "yes no none good bad fair poor other unknown true false ok okay high low medium many few some all nil".split(" ")
    .forEach(function (w) { AN_ANSWER[w] = true; });
  function isPersonLikeValue(v, strongName) {
    var s = cellOf(v);
    if (!s || s.length > 60) return false;
    if (isPersonValue(s) || isIdValue(s)) return true;
    if (DISPLAY_NAME.test(s)) return true;
    return !!strongName && ONE_NAME.test(s) && !AN_ANSWER[s.toLowerCase()];
  }
  // the owner's words for it, on the column's line of the record
  var NOT_READ_WHY = {
    people: "not read — it is about who added the place",
    id: "not read — it is an id, not something about the place"
  };

  /* A question whose answers are people: it was read from a column that
     names a person, by the rule above. Visitors never see these, in any
     mode, so this one test is shared by the viewer and by Insight. Any of the
     question's columns is enough (a mixed list is hidden too): when unsure,
     hide. Given the places (features), their values are asked as well. */
  function isPeopleQuestion(layer, col, features) {
    var kc = ((layer && layer.keyColumns) || {})[col];
    var list = Array.isArray(kc) ? kc : kc ? [kc] : [];
    return list.some(function (c) {
      var values = Array.isArray(features) && features.length
        ? features.map(function (f) { return f && f.properties ? f.properties[c] : (f ? f[c] : null); }) : null;
      return !!whyNotRead(c, values);
    });
  }

  /* Photos found by what the cells hold, not by LOKA's column names (Mithun,
     8 Nov 2026): the first column whose filled cells are mostly https links
     to an image (jpg, jpeg, png, webp, gif — or LOKA's own /api/images/
     path). LOKA's own columns are preferred when present and filled, so a
     LOKA export reads exactly as before. Takes rows (plain objects) or
     features; answers the column's name, or "". */
  var LOKA_PHOTO_COLS = ["photo_urls", "photo_1_url", "image_urls"];
  var NOT_A_PHOTO = Object.create(null);
  "thumb thumbs thumbnail thumbnails icon icons logo logos small avatar".split(" ").forEach(function (w) { NOT_A_PHOTO[w] = true; });
  /* One token is an image link when it parses as an https URL whose PATH
     ends in an image extension (the query is never looked at:
     https://x/a.exe?x=.png is not a photo), or LOKA's own /api/images/ path
     on loka.place alone. A cell is split on spaces and list separators. */
  var IMAGE_PATH = /\.(jpe?g|png|webp|gif)$/i;
  function isImageLink(token) {
    var t = String(token || "").trim();
    if (!/^https:\/\//i.test(t)) return false;
    var u;
    try { u = new URL(t); } catch (e) { return false; }
    if (u.protocol !== "https:") return false;
    if (IMAGE_PATH.test(u.pathname)) return true;
    return u.hostname === "loka.place" && u.pathname.indexOf("/api/images/") === 0;
  }
  function tokensOf(v) { return cellOf(v).split(/[\s;,|"'\]\[]+/).filter(Boolean); }
  function imageLinksIn(v) { return tokensOf(v).filter(isImageLink); }
  // every token an image link: a description or a website cell with prose and a link never counts
  function linksOnly(v) { var t = tokensOf(v); return t.length > 0 && t.every(isImageLink); }
  function photoColumnOf(rows) {
    var list = (rows || []).map(function (r) { return r && r.properties ? r.properties : (r || {}); });
    if (!list.length) return "";
    var filledIn = function (col) { return list.some(function (p) { return cellOf(p[col]); }); };
    for (var i = 0; i < LOKA_PHOTO_COLS.length; i++) if (filledIn(LOKA_PHOTO_COLS[i])) return LOKA_PHOTO_COLS[i];
    var cols = [], seen = Object.create(null);
    list.forEach(function (p) { Object.keys(p).forEach(function (k) { if (!seen[k]) { seen[k] = true; cols.push(k); } }); });
    for (var c = 0; c < cols.length; c++) {
      // a thumbnail, an icon or a logo is not the place's photograph (LOKA's thumbnail_url among them)
      if (nameWords(cols[c]).some(function (w) { return NOT_A_PHOTO[w]; })) continue;
      var filled = 0, images = 0;
      list.forEach(function (p) {
        var s = cellOf(p[cols[c]]);
        if (!s) return;
        filled++;
        if (linksOnly(s)) images++;
      });
      if (filled && images / filled >= VALUES_MOSTLY) return cols[c];
    }
    return "";
  }
  /* The image links of one place. Given the layer's rows (or features) the
     column is decided from the whole layer; given the place alone, a cell is
     taken only when it is links-only — every token an image link — so a link
     pasted into a description or a notes cell is never a photo. LOKA's own
     columns first, either way. */
  function photoLinksOf(props, rows) {
    var p = props && props.properties ? props.properties : (props || {});
    if (Array.isArray(rows) && rows.length) {
      var col = photoColumnOf(rows);
      return col ? imageLinksIn(p[col]) : [];
    }
    for (var i = 0; i < LOKA_PHOTO_COLS.length; i++) if (cellOf(p[LOKA_PHOTO_COLS[i]])) return imageLinksIn(p[LOKA_PHOTO_COLS[i]]);
    var keys = Object.keys(p);
    for (var k = 0; k < keys.length; k++) {
      if (nameWords(keys[k]).some(function (w) { return NOT_A_PHOTO[w]; })) continue;
      if (linksOnly(p[keys[k]])) return imageLinksIn(p[keys[k]]);
    }
    return [];
  }

  return {
    isPeopleQuestion: isPeopleQuestion,
    isPeopleColumn: isPeopleColumn,
    isPeopleName: isPeopleName,
    isIdName: isIdName,
    whyNotRead: whyNotRead,
    whyNameNotRead: whyNameNotRead,
    whyValuesNotRead: whyValuesNotRead,
    strongNotRead: strongNotRead,
    isPersonValue: isPersonValue,
    isIdValue: isIdValue,
    isPersonLikeValue: isPersonLikeValue,
    NOT_READ_WHY: NOT_READ_WHY,
    photoColumnOf: photoColumnOf,
    photoLinksOf: photoLinksOf,
    imageLinksIn: imageLinksIn,
    isImageLink: isImageLink,
    distinctHeadings: distinctHeadings,
    NOUN_WORDS: NOUN_WORDS,
    NOUN_MAX: NOUN_MAX,
    PLACE_MAX: PLACE_MAX,
    isYesNo: isYesNo,
    nounFromQuestion: nounFromQuestion,
    singular: singular,
    columnNoun: columnNoun,
    cleanPlaceName: cleanPlaceName,
    keyHeading: keyHeading,
    LONG_HEADING: LONG_HEADING,
    SHORT_MAX: SHORT_MAX,
    NAME_FIELD: NAME_FIELD,
    NAME_MAX: NAME_MAX,
    firstWords: firstWords,
    isLabelColumn: isLabelColumn,
    headingCase: headingCase,
    isLong: isLong,
    shortHeading: shortHeading,
    longHeadingsOf: longHeadingsOf,
    acceptableShort: acceptableShort,
    labelFor: labelFor
  };
});
