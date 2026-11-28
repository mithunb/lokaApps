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

  /* ===== What SHAPE a column is: a list, a number, a place on the map =====
     (Mithun, 28 Nov 2026, after a plain sheet of 312 recording sites: a
     "state" column asked as "Which state is this place in?", a list of up to
     77 animals answered with one of them, the same list asked "how many", two
     lists of bird names shown as somebody's "own words", and "Read from"
     printing "West, Bengal" for West Bengal.) Every rule here goes by what the
     cells hold; a column's name is only ever a helper. One copy, read by the
     server's reading (api/lib/atlas/enrich.js) and by the viewer. */

  /* The items of a cell that holds several things: split at ";" or "|" when
     it has either, else at ",". The words inside an item are left as written. */
  function listItems(v) {
    var s = cellOf(v);
    if (!s) return [];
    return (/[;|]/.test(s) ? s.split(/[;|]/) : s.split(","))
      .map(function (t) { return t.trim(); }).filter(Boolean);
  }
  // small words a sentence is built with and a list of names is not
  var SENTENCE_WORDS = Object.create(null);
  ("is are was were am be been the a an we i you they he she it this that these those there here " +
   "has have had my our your their very not but because so").split(" ").forEach(function (w) { SENTENCE_WORDS[w] = true; });
  var LIST_ITEM_WORDS = 4;       // an item is a name or a short label: at most this many words
  var LIST_COMMA_ITEMS = 3;      // commas live inside prose, so a comma list needs this many items; ";" or "|" needs two
  /* Is this cell a LIST — names or labels joined by separators — and not a
     sentence somebody wrote? "Sunbird; Drongo; Brown Hawk Owl" is; so is
     "Birds, Mammals, Frogs". "We came at dawn, saw two herons, and left." is
     not: it ends as a sentence does, one of its pieces runs long, and it is
     built with sentence words. A list is data, never anybody's own words. */
  function isListCell(v) {
    var s = cellOf(v);
    if (!s || /[.!?…]$/.test(s)) return false;
    var items = listItems(s);
    if (items.length < (/[;|]/.test(s) ? 2 : LIST_COMMA_ITEMS)) return false;
    var words = 0, small = 0, long = 0;
    items.forEach(function (it) {
      var ws = it.split(" ");
      if (ws.length > LIST_ITEM_WORDS) long++;
      ws.forEach(function (w) { words++; if (SENTENCE_WORDS[w.toLowerCase().replace(/[^a-z]/g, "")]) small++; });
    });
    return long <= items.length * 0.2 && small < words * 0.1;
  }
  /* Where the whole items of a cell begin and end, when the cell is made of
     short items (a list, or one short value such as "West Bengal"); none for
     prose, whose pieces are clauses, not items. */
  function itemSpans(text) {
    if (!text || /[.!?…]$/.test(text)) return [];
    var spans = [], from = 0, sep = /[;|]/.test(text) ? /[;|]/ : /,/;
    for (var i = 0; i <= text.length; i++) {
      if (i < text.length && !sep.test(text.charAt(i))) continue;
      var raw = text.slice(from, i), lead = raw.length - raw.replace(/^\s+/, "").length, body = raw.trim();
      if (body) {
        if (body.split(" ").length > LIST_ITEM_WORDS) return [];
        spans.push({ from: from + lead, to: from + lead + body.length });
      }
      from = i + 1;
    }
    return spans;
  }
  /* The words behind an answer, as the place wrote them ("Read from").
     The reading cites one to three words; shown joined by commas they read
     "West, Bengal" for West Bengal and "Brown, Hawk" for Brown Hawk Owl. So
     each cited word is found in the place's own cells and given back as it
     stands there: words that sit side by side are one phrase, a word inside
     a short item (a list's item, a one-value cell) is the whole item, and the
     phrases come in the order the cells have them. A word found in no cell
     (the cell has changed since) is kept as it was given. */
  function phrasesAsWritten(words, cells) {
    var texts = (cells || []).map(cellOf).filter(Boolean);
    var lows = texts.map(function (t) { return t.toLowerCase(); });
    var spans = [], loose = [], out = [], seen = Object.create(null);
    var inWord = function (text, k) { return k >= 0 && k < text.length && /[\p{L}\p{N}]/u.test(text.charAt(k)); };
    // where the cited letters stand in a cell: as whole words when asked so, else anywhere
    var findIn = function (c, low, wholeOnly) {
      if (lows[c].length !== texts[c].length) return -1;      // a script whose lower case moves the letters: not searched
      for (var at = lows[c].indexOf(low); at >= 0; at = lows[c].indexOf(low, at + 1)) {
        if (!wholeOnly || (!inWord(texts[c], at - 1) && !inWord(texts[c], at + low.length))) return at;
      }
      return -1;
    };
    (words || []).forEach(function (w) {
      var word = cellOf(w), low = word.toLowerCase();
      if (!word) return;
      // "West" is the West of "West Bengal" before it is the start of "Western Ghats" in another cell
      for (var pass = 0; pass < 2; pass++) {
        for (var c = 0; c < texts.length; c++) {
          var at = findIn(c, low, pass === 0);
          if (at < 0) continue;
          var to = at + low.length;
          // the whole word, when the cited letters stop inside one
          while (inWord(texts[c], at - 1)) at--;
          while (inWord(texts[c], to)) to++;
          spans.push({ c: c, from: at, to: to });
          return;
        }
      }
      loose.push(word);
    });
    spans.sort(function (a, b) { return (a.c - b.c) || (a.from - b.from); });
    var merged = [];
    spans.forEach(function (s) {
      var last = merged[merged.length - 1];
      if (last && last.c === s.c && (s.from <= last.to || /^\s*$/.test(texts[s.c].slice(last.to, s.from)))) {
        last.to = Math.max(last.to, s.to);
        return;
      }
      merged.push({ c: s.c, from: s.from, to: s.to });
    });
    var push = function (p) { var k = p.toLowerCase(); if (p && !seen[k]) { seen[k] = true; out.push(p); } };
    /* "Read from" may only show words the reading actually cited. A short
       item used to be shown WHOLE whenever one of its words was cited, so
       ["PURAM", "DEVASANDRA"] came back as "KR PURAM DEVASANDRA MARKET" —
       two words the model never said, put in its mouth. The whole item is
       shown only when the reading cited every word of it, or when the item
       is the whole cell ("West Bengal", a state column, cited as "West").
       Otherwise the cited words are shown as they stand in the cell, in the
       cell's order and spelling, and only joined where they sit side by
       side. */
    var cited = Object.create(null);
    (words || []).forEach(function (w) {
      cellOf(w).split(/\s+/).forEach(function (p) {
        var k = p.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
        if (k) cited[k] = true;
      });
    });
    merged.forEach(function (s) {
      var text = texts[s.c], items = itemSpans(text), whole = null;
      for (var k = 0; k < items.length; k++) if (items[k].from <= s.from && s.to <= items[k].to) whole = items[k];
      if (whole) {
        var item = text.slice(whole.from, whole.to);
        var everyWord = item.split(/\s+/).every(function (p) {
          var t = p.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
          return !t || cited[t];
        });
        if (!everyWord && item !== text.trim()) whole = null;
      }
      push(text.slice(whole ? whole.from : s.from, whole ? whole.to : s.to));
    });
    loose.forEach(push);
    return out;
  }

  /* A NUMBER column: nearly every filled cell is a number ("12", "1,204",
     "3.5", "40%"). A count is worked out, never read: sent to the reader as
     words, "likes" or "species_count" comes back as a question with made-up
     kinds. (A run of ten digits or more is an id, and a date is a date:
     neither is a number here.) */
  var NUMBER_CELL = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?\s*%?$/;
  var NUMBERS_MOSTLY = 0.9;
  function isNumberCell(v) { var s = cellOf(v); return NUMBER_CELL.test(s) && !DIGIT_RUN.test(s); }
  function isNumberColumn(values) {
    var filled = 0, numbers = 0;
    (values || []).forEach(function (v) { var s = cellOf(v); if (!s) return; filled++; if (isNumberCell(s)) numbers++; });
    return filled > 0 && numbers / filled >= NUMBERS_MOSTLY;
  }
  /* A COMMA IS A LIST'S COMMA UNLESS THE WHOLE COLUMN SAYS OTHERWISE.
     "1,200" is one number with its thousands marked; "123,456" is that
     shape too, and it is just as likely to be two three-digit things
     somebody typed with a comma between them. The cell cannot tell; the
     column can. It is grouped numbers only when every comma in it groups
     exactly three digits, no comma is followed by a space ("123, 456" is a
     list, written as a list), and nearly every cell is a number by that
     convention. Anything else keeps its commas and stays a list. */
  var GROUPED_CELL = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?\s*%?$/;
  function isGroupedNumberColumn(values) {
    var filled = 0, grouped = 0, plain = 0, byList = false;
    (values || []).forEach(function (v) {
      var s = cellOf(v);
      if (!s) return;
      filled++;
      if (s.indexOf(",") < 0) { if (isNumberCell(s)) plain++; return; }
      if (/,\s/.test(s) || !GROUPED_CELL.test(s) || DIGIT_RUN.test(s)) byList = true;
      else grouped++;
    });
    return !byList && filled > 0 && grouped > 0 && (grouped + plain) / filled >= NUMBERS_MOSTLY;
  }

  /* ===== A NUMBER KEY: a number column offered as 3 to 5 ranges =====
     (Mithun, 28 Nov 2026: "build number ranges as a general feature".) A
     column of numbers is never read into a question — and used to be offered
     as nothing at all once it held more than ten different values. Now the
     map can be coloured by it: the Atlas works out a few ranges and each
     place falls in one. No model, no cost; decided by the values, the name
     only helping.

     NOT a number key (numberKey answers null, and the column is treated as
     it always was):
       - not numbers (isNumberColumn), or fewer than NUMBER_KEY_MIN of them;
       - one value everywhere;
       - a coordinate, a person's or record's id, a postal code — by its
         name (latitude, x, "id", "pin code": the people/id and location
         rules above), or by its values: whole numbers that are all
         different and run on from each other (row numbers, record ids), or
         all of one length with the same leading digits (pincodes, census
         codes). A population is all different too, but neither of those.
     A column of YEARS (whole numbers between 1000 and 2100) is grouped the
     same way but worded as years: "1990–2005", never "1,990–2,005".

     A FEW VALUES. A rating of 1 to 5, a count of storeys: five different
     numbers or fewer are not cut at all — each number is its own kind, in
     order ("1", "2", "3", "4", "5"). (The viewer never offered such a column
     as a plain key: a kind has to read as a word, and "3" does not.)

     THE RANGES. Quantiles, so the places spread across them, each edge then
     moved to the nearest round number that keeps every range in use. Skewed
     data cannot fall into one range: with one place at 392 and most at 1,
     the edges come out 1, 2, 4 … and a single value stands alone ("1",
     "2–4", "5–10", "More than 10"). Never an empty range; every place with
     a number is in exactly one; a blank stays blank. Whole numbers are
     worded lo–hi; decimals "Up to 2.5", "2.5–10", "More than 10" (a value
     on an edge belongs to the range below). */
  var NUMBER_KEY_MIN = 8, NUMBER_RANGES = 5;
  var COORDINATE_NAME = /^(lat|latitude|lon|lng|long|longitude|x|y|easting|northing)$/i;
  function toNumber(v) {
    var s = cellOf(v);
    if (!isNumberCell(s)) return NaN;
    return Number(s.replace(/[,%\s]/g, ""));
  }
  // a round number at the number's own size: its first `digits` figures, the rest zeroed.
  // Worked out from the figures themselves, so it holds at any scale — 0.0023 rounds
  // to 0.002 as surely as 2,300 rounds to 2,000.
  function roundTo(x, digits) {
    if (!x || !isFinite(x)) return 0;
    return Number(Number(x).toPrecision(digits));
  }
  /* HOW MANY DECIMALS THE WORDS NEED — the one thing that decided whether a
     number key could be read. The words used to round to two decimals (to a
     whole number at a hundred and above) whatever the data's own precision,
     so a column that lives in a narrow band came out as nonsense: salinity
     0.001–0.009 read "Up to 0 / 0–0 / 0–0.01 / 0.01–0.01 / 0.01", prices
     199.50–199.99 read "200–200" four times over. Two ranges with the same
     words are not two ranges: the panel counted them as one and the map
     coloured them as two.

     So the precision comes from the numbers, not from a constant: the FEWEST
     decimals that tell every edge apart (none at all for 20 / 50 / 100,
     three for a band of salinities), and the edges themselves are then moved
     onto that precision so the words say exactly where a range ends. Capped,
     because a reader cannot use twelve decimals either — a column whose
     ranges cannot be told apart within the cap makes fewer ranges, or is not
     a number key. */
  var NUMBER_DECIMALS_MAX = 12;
  function decimalsFor(list) {
    for (var d = 0; d <= NUMBER_DECIMALS_MAX; d++) {
      var seen = Object.create(null), ok = true;
      for (var i = 0; i < list.length; i++) {
        var s = list[i].toFixed(d);
        if (seen[s]) { ok = false; break; }
        seen[s] = 1;
      }
      if (ok) return d;
    }
    return -1;
  }
  function numberWords(x, year, dp) {
    if (year) return String(x);
    var d = Math.max(0, Math.min(dp == null ? 2 : dp, 20));
    var s = Number(x).toFixed(d);
    if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
    if (/^-0$/.test(s)) s = "0";
    var parts = s.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }
  function numberKey(name, values) {
    var nums = [];
    (values || []).forEach(function (v) { var x = toNumber(v); if (isFinite(x)) nums.push(x); });
    if (nums.length < NUMBER_KEY_MIN || !isNumberColumn(values)) return null;
    var words = nameWords(name).join(" ");
    if (COORDINATE_NAME.test(words) || whyNotRead(name, values) || locationSignal(name, values, null).why) return null;
    nums.sort(function (a, b) { return a - b; });
    var distinct = [];
    nums.forEach(function (x) { if (!distinct.length || distinct[distinct.length - 1] !== x) distinct.push(x); });
    if (distinct.length < 2) return null;
    var whole = nums.every(function (x) { return Math.floor(x) === x; });
    var min = nums[0], max = nums[nums.length - 1];
    var year = whole && min >= 1000 && max <= 2100;
    /* AN ID IS NOT A MEASURE — but ALL DIFFERENT is not what tells them
       apart. The first try asked only how tightly the values packed (every
       all-different whole-number column spanning less than three times the
       row count was called an id), which threw away real measures: a change
       of -20 to 19 percent, percentages 0 to 78, a column of likes where no
       two places agree, one year per place. What an id actually has is one
       of three marks:
         - its NAME says so (id, serial, code, reference, row);
         - its values RUN ON at a fixed step from a counting base (1, 1,000,
           40,000 — a serial, a row number), which is not how a size behaves;
         - it is WRITTEN as a code: leading zeros ("007"), or all of one
           width, five digits or more, under the same two leading digits
           (pincodes, census codes).
       A year is none of these, however tidily it runs. */
    var ID_WORD = /\b(id|ids|uid|uuid|guid|identifier|identifiers|serial|serials|serialno|sno|srno|code|codes|barcode|ref|refs|reference|rowid|objectid|fid|gid|roll)\b/i;
    var ID_ALONE = /^(index|idx|row|rows|no|num|number|sl|key|rank|order)$/i;
    var SIZE_WORD = /\b(count|counts|total|totals|sum|amount|how many|likes|views|visits|comments|photos|population|people|households|families|area|size|length|width|height|depth|distance|weight|price|cost|budget|income|spend|rate|score|rating|percent|percentage|pct|share|age|capacity|seats|beds|rooms|storeys|floors|trees|species|visitors|members|units|km|metres|meters|hectares|acres)\b/i;
    if (whole && distinct.length === nums.length) {
      if (ID_WORD.test(words) || ID_ALONE.test(words.replace(/\s+/g, " ").trim())) return null;
      /* a serial: the same step all the way up, counted from 1 or from a
         round base — unless the name says a size, because a count of bees
         that happens to run 1, 2, 3 … is still a count, and a year is a
         year however tidily it runs */
      var gaps = [], step = nums.length > 1 ? nums[1] - nums[0] : 0, even = 0;
      for (var gi = 1; gi < nums.length; gi++) { gaps.push(nums[gi] - nums[gi - 1]); if (nums[gi] - nums[gi - 1] === step) even++; }
      var place = Math.pow(10, String(Math.abs(min)).length - 1);
      var counting = min >= 1 && (min === 1 || min % place === 0);
      if (!year && !SIZE_WORD.test(words) && step > 0 && gaps.length && even >= gaps.length * 0.9 && counting) return null;
      // written as a code: leading zeros on nine cells in ten ("007", "0450")
      var filledCells = 0, zeros = 0;
      (values || []).forEach(function (v) { var s = cellOf(v); if (!s) return; filledCells++; if (/^0\d/.test(s)) zeros++; });
      if (filledCells && zeros >= filledCells * 0.9) return null;
      // codes: one length, five digits or more, the same two leading digits on nine in ten
      var lead = Object.create(null), top = 0, len = String(Math.abs(min)).length;
      nums.forEach(function (x) { var t = String(Math.abs(x)); if (t.length === len) { var k = t.slice(0, 2); lead[k] = (lead[k] || 0) + 1; if (lead[k] > top) top = lead[k]; } });
      if (len >= 5 && top >= nums.length * 0.9) return null;
    }
    var w = function (x, dp) { return numberWords(x, year, dp); };
    // a few values: each its own kind, in order (told apart to the data's own precision)
    if (distinct.length <= NUMBER_RANGES) {
      var dpFew = year || whole ? 0 : decimalsFor(distinct);
      if (dpFew < 0) return null;
      return { ranges: distinct.map(function (x, k) { return { label: w(x, dpFew), max: k === distinct.length - 1 ? Infinity : x }; }), year: year };
    }
    var inUpTo = function (from, to) { return nums.filter(function (x) { return x > from && x <= to; }).length; };
    // the upper edge of every range but the last: quantiles, each moved to a round number where one fits
    function edgesFor(n) {
      var edges = [];
      for (var i = 1; i < n; i++) {
        var q = nums[Math.min(nums.length - 1, Math.floor(i * nums.length / n))];
        var prev = edges.length ? edges[edges.length - 1] : -Infinity;
        var tries = (whole && Math.abs(q) < 20) || year ? [year ? roundTo(q, 3) : q, q] : [roundTo(q, 1), roundTo(q, 2), q];
        for (var t = 0; t < tries.length; t++) {
          var e = whole ? Math.round(tries[t]) : tries[t];
          if (!(e > prev && e < max && inUpTo(prev, e) > 0)) continue;     // no range may be empty, and one must be left above
          // a ROUND edge may sit a little to either side of its quantile: by at most half a range's share of the places
          var drift = Math.abs(inUpTo(-Infinity, e) - i * nums.length / n);
          if (e !== q && drift > nums.length / (n * 2)) continue;
          edges.push(e);
          break;
        }
      }
      return edges;
    }
    // "2–4"; with a number below zero in it, "-40 to -20", so the dash is never read as a minus
    function labelled(edges, dp) {
      var span = function (a, b) { return a < 0 || b < 0 ? w(a, dp) + " to " + w(b, dp) : w(a, dp) + "\u2013" + w(b, dp); };
      var ranges = [], said = Object.create(null), list = edges.concat([Infinity]);
      for (var k = 0; k < list.length; k++) {
        var e = list[k], from = k ? edges[k - 1] : -Infinity, label;
        var inside = nums.filter(function (x) { return x > from && x <= e; });
        if (!inside.length) return null;                                  // never an empty range
        var lo = inside[0], hi = inside[inside.length - 1];
        if (e === Infinity) label = lo === hi ? w(lo, dp) : (year ? "After " : "More than ") + w(from, dp);
        else if (whole) { lo = k ? from + 1 : lo; label = lo === e ? w(e, dp) : span(lo, e); }
        else label = k ? span(from, e) : "Up to " + w(e, dp);
        if (!label || said[label]) return null;                           // and never the same words twice
        said[label] = 1;
        ranges.push({ label: label, max: e });
      }
      return ranges;
    }
    /* n ranges, or nothing. Every edge is moved onto the precision the words
       are written at, so "Up to 0.002" says exactly where the range ends; if
       that move empties a range, or two ranges still read alike, the words
       gain a decimal and it is tried again. Whole numbers and years are
       already on their own precision, so they are tried once. */
    function rangesFor(n) {
      var edges = edgesFor(n);
      if (!edges.length) return null;
      var start = (whole || year) ? 0 : decimalsFor(edges);
      if (start < 0) return null;
      for (var dp = start; dp <= NUMBER_DECIMALS_MAX; dp++) {
        var snapped = [], good = true, prev = -Infinity;
        for (var i = 0; i < edges.length; i++) {
          var e = (whole || year) ? edges[i] : Number(edges[i].toFixed(dp));
          if (!(e > prev && e < max && inUpTo(prev, e) > 0)) { good = false; break; }
          snapped.push(e); prev = e;
        }
        if (good && inUpTo(prev, Infinity) > 0) {
          var built = labelled(snapped, dp);
          if (built && built.length >= 2) return built;
        }
        if (whole || year) break;
      }
      return null;
    }
    /* Five ranges where the numbers can fill five, fewer where they cannot,
       down to two; a column that cannot make two ranges whose words differ is
       not a number key at all. */
    var fewer = null;
    for (var n = NUMBER_RANGES; n >= 2; n--) {
      var got = rangesFor(n);
      if (got && got.length >= 3) return { ranges: got, year: year };
      if (got && got.length >= 2 && !fewer) fewer = got;
    }
    return fewer ? { ranges: fewer, year: year } : null;
  }
  /* The range a cell falls in, by its label; "" for a blank or a cell that is not a number. */
  function numberBucket(v, ranges) {
    var x = toNumber(v);
    if (!isFinite(x)) return "";
    for (var i = 0; i < (ranges || []).length; i++) if (x <= ranges[i].max) return ranges[i].label;
    return "";
  }
  /* The colours of a number key: one hue (the palette's moss), light to
     dark, so more reads as more — told apart by lightness alone, which is
     what a colour-blind reader has. n of them, spread across the ramp. */
  /* A NUMBER KEY THAT IS MOSTLY ONE RANGE. A key whose commonest answer
     holds more than 85 places in a hundred is no key: it tells the places
     apart hardly at all, and the map comes out one colour. A number key
     earns an exception, because the few places that differ are exactly what
     a reader is after and the ranges say how far they differ: most corners
     have no likes at all, and "0 / 1–2 / 3–10 / More than 10" is a real
     picture of the handful that do. Kept when at least two ranges hold
     places AND the minority is a real one — five places, or three in a
     hundred; otherwise it is dropped like any other flat key. */
  var RANGE_MINORITY_MIN = 5, RANGE_MINORITY_SHARE = 0.03;
  function numberKeySpreads(rangesHeld, minority, places) {
    return rangesHeld >= 2 && minority > 0 &&
      (minority >= RANGE_MINORITY_MIN || minority >= (places || 0) * RANGE_MINORITY_SHARE);
  }
  /* WHERE A KIND SITS in its key's own order — one answer, read by the map
     (atlas.js keyMarkRows) and by the Insights panel (insight-mode.js)
     alike, so the two can never disagree about which colour a kind wears or
     which row it belongs to. -1 when the key does not hold that kind: the
     map draws it grey, the panel puts it last. (It can only be one place
     now that a number key's ranges never read alike; when two ranges carried
     the same words, the panel merged them and the map drew them apart.) */
  function kindIndex(kept, name) {
    return (kept || []).indexOf(name);
  }
  var NUMBER_RAMP = ["#A9D3B3", "#74B787", "#45935E", "#2A6B41", "#143D25"];
  function rampColors(n) {
    if (n >= NUMBER_RAMP.length) return NUMBER_RAMP.slice();
    if (n <= 1) return [NUMBER_RAMP[3]];
    var out = [];
    for (var i = 0; i < n; i++) out.push(NUMBER_RAMP[Math.round(i * (NUMBER_RAMP.length - 1) / (n - 1))]);
    return out;
  }

  /* A LEFTOVER answer: "Other States", "Others", "Miscellaneous", "Everything
     else". It names no kind — it is what is left when the kinds run out — so
     a place given it reads as a contradiction beside its own value ("Other
     States / Read from: West Bengal"). The reading already has an honest
     leftover (no answer for that place), so a kind named like this is never
     kept as a kind; a place it would have taken keeps its own value on the
     card and has no answer to that one question. */
  var LEFTOVER = /^(other|others|misc|miscellaneous|everything else|all others?|all the rest|the rest|elsewhere|unspecified|none of (these|the above))\b/i;
  function isLeftoverName(name) { return LEFTOVER.test(cellOf(name)); }

  /* A LOCATION column says where a place is — a country, state, district,
     taluk, city, village, ward, pincode. The map already shows that, from the
     place's own coordinates, so such a column is never read into a question
     (Mithun, 8 Nov 2026: location is from the map). An address is caught by
     its own rule (enrich.js looksLikeAPlace); this one catches the clean
     one-name-a-cell column an address rule cannot see.

     How it is decided, by the values, with the name only as a helper:
       1. KNOWN NAMES, whatever the column is called: most filled cells are
          names the atlas's own boundaries carry (opts.places, lower-cased —
          the server hands them to the reading). KNOWN_SHARE of the cells;
          KNOWN_NAMED when the column's name also says place ("state",
          "district", "ward"). Strong.
       2. A name that can only mean a place (district, taluk, village, city,
          country, pincode …) AND values with the shape of place names (one
          short capitalised name a cell, no digits, no lists) or of postal
          codes. Strong.
     Nothing else is a location. A name that only MAY mean a place decides
     nothing without known names behind it: a "state" of repair (Under
     repair, Collapsed), a body "region" (Left arm), a hospital "ward"
     (Maternity), a park's "zone" (Core, Buffer), a "block" (Rose Block), a
     "division" (Water Works), a "locality" type (Dense Urban) all have
     tidy capitalised values, and all sit together on the map as real
     states do — so neither the shape nor the map can tell them from
     places, and asking a question too many is the smaller harm than
     silencing a real one or retiring it. There is no weak signal: a
     column is a location on strong evidence or it is read. */
  var PLACE_SURE = Object.create(null), PLACE_MAYBE = Object.create(null);
  ("country countries nation province provinces district districts subdistrict taluk taluka taluks talukas tehsil tehsils tahsil mandal mandals " +
   "city cities town towns village villages county counties municipality municipalities panchayat " +
   "pincode pincodes postcode postcodes zipcode zip").split(" ").forEach(function (w) { PLACE_SURE[w] = true; });
  "state states region regions ward wards block blocks division divisions zone zones locality localities neighbourhood neighborhood suburb area"
    .split(" ").forEach(function (w) { PLACE_MAYBE[w] = true; });
  /* What the NAME says: "sure", "maybe" or "". The name's last word decides,
     a trailing "name" or "code" aside ("Home state", "district_name", "Pin
     code"); "State of repair" and "Village type" end on other words. */
  function locationName(name) {
    var words = nameWords(name);
    var last = words.length - 1;
    if (last > 0 && /^(name|names)$/.test(words[last])) last--;
    if (last < 0) return "";
    if (words[last] === "code" && last > 0 && /^(pin|post|postal|zip)$/.test(words[last - 1])) return "sure";
    return PLACE_SURE[words[last]] ? "sure" : PLACE_MAYBE[words[last]] ? "maybe" : "";
  }
  var PLACE_NAME = /^[\p{Lu}\p{Lo}][\p{L}\p{M}'’.\-]*(?:\s+(?:[\p{L}\p{M}'’.\-]+|&))*$/u;   // "West Bengal", "Dadra & Nagar Haveli"
  var POSTAL_CODE = /^(\d{3}\s?\d{3}|\d{5}(-\d{4})?|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i;
  var PLACE_SHAPE = 0.8, KNOWN_SHARE = 0.6, KNOWN_NAMED = 0.4;
  function placeShape(cells) {
    var names = 0, codes = 0, answers = 0;
    cells.forEach(function (s) {
      if (POSTAL_CODE.test(s)) { codes++; return; }
      if (/[;|,\d]/.test(s) || s.split(" ").length > 4 || !PLACE_NAME.test(s)) return;
      names++;
      if (AN_ANSWER[s.toLowerCase()]) answers++;
    });
    if (codes >= cells.length * PLACE_SHAPE) return "codes";
    return names >= cells.length * PLACE_SHAPE && answers < names * 0.5 ? "names" : "";
  }
  /* The one rule: { why: "location" | "", strong, by } for a column, given its
     name and values and — when the caller has them — the atlas's own
     boundary names (opts.places: an object or Set of lower-cased names).
     `by` says which signal decided. */
  function locationSignal(name, values, opts) {
    var none = { why: "", strong: false, by: "" };
    var cells = (values || []).map(cellOf).filter(Boolean);
    if (cells.length < 2) return none;
    var named = locationName(name);
    var places = opts && opts.places, knows = function (s) {
      return !!places && (typeof places.has === "function" ? places.has(s) : !!places[s]);
    };
    if (places) {
      var known = cells.filter(function (s) { return knows(s.toLowerCase()); }).length;
      if (known >= cells.length * (named ? KNOWN_NAMED : KNOWN_SHARE)) return { why: "location", strong: true, by: "known names" };
    }
    if (named !== "sure") return none;
    var shape = placeShape(cells);
    if (!shape) return none;
    /* A name that can only mean a place, with place-shaped values, PASSES
       OVER a new question — but it does not RETIRE a settled one. A
       "district" column holding hospital wards, a "city" column holding team
       names, a "country" column holding the origins of species all wear this
       exact shape: a sure-sounding name and tidy capitalised words. The name
       is enough to leave a question unasked (the harm is one question
       missing); it is not enough to take a reading off the map that is
       already there (the harm is a question silently lost). What is enough:
       the values are names the atlas's own boundaries carry (above), or they
       are postal codes, which nothing else is shaped like. */
    return { why: "location", strong: shape === "codes", by: "name and values" };
  }
  var LOCATION_WHY = "says where each place is, and the map already shows that";

  /* Do these rows hold anything WRITTEN — a description, a comment, a note —
     in any column? The story on an atlas is written from such words and
     quotes them; a sheet of categories, lists and numbers has none, and its
     owner should hear that before building (the wizard's check line). A
     column counts when one filled cell in five is prose: four words or
     more, twenty-five characters, not a list of names, not a link, and not
     a column about people or ids. Rows are plain objects, a column a key. */
  var PROSE_WORDS = 4, PROSE_CHARS = 25, PROSE_SHARE = 0.2;
  function isProseCell(v) {
    var s = cellOf(v);
    return s.length >= PROSE_CHARS && s.split(" ").length >= PROSE_WORDS && !/^https?:/i.test(s) && !isListCell(s);
  }
  function hasWrittenWords(rows) {
    var list = (rows || []).filter(function (r) { return r && typeof r === "object"; });
    var cols = Object.create(null);
    list.forEach(function (r) { Object.keys(r).forEach(function (k) { cols[k] = true; }); });
    return Object.keys(cols).some(function (k) {
      if (k.charAt(0) === "_" || /^pattern_\d+(_why)?$/.test(k)) return false;
      var values = list.map(function (r) { return r[k]; });
      if (whyNotRead(k, values)) return false;
      var filled = 0, prose = 0;
      values.forEach(function (v) { if (!cellOf(v)) return; filled++; if (isProseCell(v)) prose++; });
      return prose > 0 && prose >= filled * PROSE_SHARE;
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
    listItems: listItems,
    isListCell: isListCell,
    phrasesAsWritten: phrasesAsWritten,
    isNumberCell: isNumberCell,
    isNumberColumn: isNumberColumn,
    isGroupedNumberColumn: isGroupedNumberColumn,
    numberKey: numberKey,
    numberBucket: numberBucket,
    kindIndex: kindIndex,
    numberKeySpreads: numberKeySpreads,
    rampColors: rampColors,
    isLeftoverName: isLeftoverName,
    locationName: locationName,
    locationSignal: locationSignal,
    LOCATION_WHY: LOCATION_WHY,
    hasWrittenWords: hasWrittenWords,
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
