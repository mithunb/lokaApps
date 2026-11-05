/* LOKA Atlas — Insight mode: for people reading patterns. The questions LOKA
 * asked of the places, each answered as a bar list that colours the map, and
 * "Story of the place in their own words" above them — what people are saying, written by AI
 * from their own words, with the quotes it rests on. One panel, "Insights"
 * (a visitor sees no tab row at all; the owner: "Insights · Settings").
 *
 * An atlas is in Insight when the `mode` in its manifest.local.json says so
 * (the owner's "How visitors explore" switch, POST /instances/:slug/mode):
 *
 *   mode: {
 *     name: "insight",
 *     layer: "<the layer whose questions are read>",
 *     summaryOn: true,                     // "Story of the place in their own words" on or off
 *     order: ["pattern_3", "pattern_4", …],   // the owner's order
 *     shown: { pattern_1: true, pattern_5: false, … },
 *     summary: { sig, sentences: [{ text, questions: [col…] }], at } | null,
 *     summaryPending: true                 // while the server writes it
 *   }
 *
 * The rules (which questions show, the few-places shelf, when two questions
 * can be compared, which numbers a summary may say) are here, once: the
 * server (api/apps/atlas.js, api/lib/atlas/insight-summary.js), the owner's
 * Settings tab (owner-modes.js) and the visitor's page all run this file.
 *
 * Never shown: a question whose answers are people — the layer's keyColumns
 * for it name created_by, created_by_user_id or any *_user_id column. No
 * good/bad colouring: answers wear colours in the order of how many places
 * give them, red kept late so a middle answer never reads as a warning.
 *
 * With no mode, or any other name, nothing here runs. */
(function (root, make) {
  var node = typeof module === "object" && module.exports;
  var made = make(node ? require("./explore-mode.js") : root.LokaExploreMode);
  if (node) module.exports = made;
  else root.LokaInsightMode = made;
})(typeof self !== "undefined" ? self : this, function (XM) {
  "use strict";

  // red is kept late in the order so a middle answer never reads as a warning
  var PAL = ["#2A6B41", "#3A7FA1", "#E9A237", "#8A5A9E", "#B5541B", "#C9402B", "#6E8B3D"];
  var NONE = "#CFCBC2", PLAIN_PIN = "#7A756C", HOLLOW = "#A39E94";
  // the few-places shelf: under a quarter of the places, or under 8
  var FEW_SHARE = 0.25, FEW_PLACES = 8;
  // compare two questions only when the places answering both are at least a tenth, and at least 5 (Mithun, 25 Oct 2026)
  var CMP_SHARE = 0.10, CMP_PLACES = 5;
  var PEOPLE_REASON = "Its answers are the names of the people who tagged the places, so LOKA keeps it off the visitor page.";
  var PEOPLE_REFUSED = "That question\u2019s answers are the names of the people who tagged the places, so it stays off the visitor page.";
  var NO_QUESTIONS = "Insight needs the questions LOKA asks of the places. They appear once the atlas has been read.";
  var MIN_SENTENCES = 2, MAX_SENTENCES = 5, MAX_SENTENCE = 320;
  /* A story "being written" for longer than this is taken as stuck: not
     pending, and a new one may start. Seven minutes, because the story is up
     to four calls to a Pro model with 90 seconds each (it was two minutes
     while the summary was four quick calls to a flash model). */
  var PENDING_STALE_MS = 7 * 60 * 1000;
  function isPending(mode, now) {
    return !!(mode && mode.summaryPending && typeof mode.summaryPendingAt === "number" &&
      (now || Date.now()) - mode.summaryPendingAt < PENDING_STALE_MS);
  }
  /* Amounts written in words cannot be checked against the counts, so a
     sentence with one is dropped: "two", "a dozen", "half", "twice", "one in
     five". "one of the …" and "no one" are the only number words let by. */
  var NUMBER_WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|dozens?|half|halves|twice|thrice|double|triple|third|thirds|quarters?|fifths?|tenths?|majority|minority)\b/gi;
  function hasNumberWords(text) {
    var t = String(text || "").replace(/\bno one\b/gi, " ").replace(/\bone of\b/gi, " ");
    NUMBER_WORDS.lastIndex = 0;
    return NUMBER_WORDS.test(t);
  }
  /* A share said in words is a claim about how many, and nothing counts it
     (Mithun, 5 Nov 2026, on "This map is mostly Bengaluru's green side"). In
     a sentence that carries a checked cell these words are fine, because the
     numbers beside them say what they mean; in a sentence with no number
     they are dropped. */
  var SHARE_WORDS = /\b(most|mostly|almost all|nearly all|virtually all|the bulk|a good part|the larger part|the greater part|the lion\u2019s share|lion's share|majority|minority|predominantly|overwhelmingly|largely|mainly|chiefly|primarily|generally|typically|usually|commonly|few|a few|many|plenty|hardly any|barely any|scarcely any|rarely|seldom|dominated|dominate|dominates|outnumber|outnumbers)\b/i;
  function hasShareWords(text) { return SHARE_WORDS.test(String(text || "")); }
  /* The story says no amounts at all (Mithun, 5 Nov 2026): the questions
     below it already show every count, so a sentence of the story may carry
     no digit, no number word and no word for how many. These are the ones
     SHARE_WORDS and NUMBER_WORDS do not already catch. "all" and "every" are
     amounts too; "at all" and "every day" are not. */
  var AMOUNT_WORDS = /\b(a handful|handfuls|a couple|a number of|a range of|a bunch of|several|numerous|countless|scores of|a lot of|lots of|plenty of|some|much of|all|every|each one|none|nobody|no one|no place|no places|more than|less than|fewer|at least|at most|up to|one of|everywhere|nowhere|is common|are common|common here|commonly|is rare|are rare|rare here|the only|often|sometimes|occasionally|frequently|widespread)\b/i;
  /* Saying which is biggest is saying how many, without the number (Opus
     review, 5 Nov 2026, on the mock's "Trees come first here"). SHARE_WORDS
     already holds mostly, mainly, largely and their kin; these are the rest. */
  var RANK_WORDS = /\b(comes? first|came first|first and foremost|above all|for the most part|most of|in the main|leads? the way|tops? the list|more than anything|stands? out above|the bulk of|outnumbers? )\b/i;
  /* A word is an amount only where it counts something. "A common myna", "a
     rare fig tree", "the sole banyan" say what a thing IS, not how many there
     are, so the adjectives alone are not enough: it takes the phrase ("is
     common", "common here"). Likewise "at all", "all day" and "every day" are
     idioms, not amounts. */
  function hasAmountWords(text) {
    var t = String(text || "")
      .replace(/\bat all\b/gi, " ")
      .replace(/\ball (?:day|night|year|round|the way|over the)\b/gi, " ")
      .replace(/\bevery ?day\b/gi, " ")
      /* Gathering words are not counts (Mithun, 6 Nov 2026): "one person",
         "one note", "one line" name a single voice, which is how a quote
         standing on its own is spoken of. */
      .replace(/\bone (person|note|line|voice|writer|note-?taker)\b/gi, " ");
    return hasNumberWords(t) || hasShareWords(t) || AMOUNT_WORDS.test(t) || RANK_WORDS.test(t);
  }

  function isOn(manifest) {
    var m = manifest && manifest.mode;
    return !!(m && typeof m === "object" && m.name === "insight");
  }
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }

  /* ---------------- the questions ---------------- */
  // the layer's questions, in the analysis's own order (pattern_1, pattern_2, …)
  function colsOf(layer) {
    var labels = (layer && layer.keyLabels) || {};
    return Object.keys(labels).filter(function (c) { return String(labels[c] || "").trim(); }).sort(function (a, b) {
      var na = Number(String(a).split("_")[1]), nb = Number(String(b).split("_")[1]);
      return (isFinite(na) && isFinite(nb)) ? na - nb : (a < b ? -1 : a > b ? 1 : 0);
    });
  }
  // a question whose answers are people: read from who created the place.
  // The test is shared with the viewer (label-rules.js); the same rule stands
  // here in case that file is not loaded, so a missing file never shows people.
  function isPeople(layer, col) {
    var shared = typeof LokaLabelRules !== "undefined" && LokaLabelRules && LokaLabelRules.isPeopleQuestion;
    if (typeof shared === "function") return !!shared(layer, col);
    var kc = ((layer && layer.keyColumns) || {})[col];
    var list = Array.isArray(kc) ? kc : kc ? [kc] : [];
    return list.some(function (c) {
      var s = String(c || "").trim().toLowerCase();
      return s === "created_by" || s === "created_by_user_id" || /_user_id$/.test(s);
    });
  }
  // "what species can be seen?" -> "What species can be seen?"; a question saved cut off ends "…"
  function questionText(label) {
    var t = String(label || "").replace(/\s+/g, " ").trim();
    if (!t) return t;
    t = t.charAt(0).toUpperCase() + t.slice(1);
    if (!/[?.!\u2026]$/.test(t)) t += "\u2026";
    return t;
  }
  function answerOf(props, col) {
    var v = props ? props[col] : null;
    if (v == null) return "";
    return String(Array.isArray(v) ? v.join("; ") : v).replace(/\s+/g, " ").trim();
  }
  function keyOf(props, col) { return answerOf(props, col).toLowerCase(); }

  /* One question over the places: its answers with how many places give
     each, most first (ties in the analysis's order), each with its colour;
     how many answer at all; and whether it is said by only a few. */
  function stats(layer, features, col) {
    var feats = features || [];
    var total = feats.length;
    var label = ((layer && layer.keyLabels) || {})[col] || "";
    var noun = ((layer && layer.keyNouns) || {})[col] || "";
    var out = { col: col, question: questionText(label), noun: String(noun || "").trim(), answers: [], answered: 0, total: total, none: total, sparse: true, people: isPeople(layer, col) };
    // a people question's answers are never counted, let alone shown
    if (out.people) return out;
    var kindAt = {};
    (((layer && layer.keyKinds) || {})[col] || []).forEach(function (k, i) {
      if (k && k.name) kindAt[String(k.name).trim().toLowerCase()] = { i: i, name: String(k.name).trim(), def: String(k.definition || "").trim() };
    });
    var by = {}, list = [];
    feats.forEach(function (f) {
      var a = answerOf(f && f.properties, col);
      if (!a) return;
      var k = a.toLowerCase();
      if (!by[k]) {
        var kd = kindAt[k];
        by[k] = { name: kd ? kd.name : a, key: k, definition: kd ? kd.def : "", count: 0, order: kd ? kd.i : 1000 + list.length };
        list.push(by[k]);
      }
      by[k].count++;
    });
    list.sort(function (a, b) { return b.count - a.count || a.order - b.order; });
    list.forEach(function (a, i) { a.color = PAL[i % PAL.length]; });
    out.answers = list.map(function (a) { return { name: a.name, key: a.key, definition: a.definition, count: a.count, color: a.color }; });
    out.answered = list.reduce(function (s, a) { return s + a.count; }, 0);
    out.none = total - out.answered;
    out.sparse = isSparse(out.answered, total);
    return out;
  }
  function isSparse(answered, total) { return answered < FEW_PLACES || answered < total * FEW_SHARE; }
  function coverWords(st) {
    if (st.answered === st.total) return "Answered for all " + st.total + " places";
    if (st.sparse) return "Only " + st.answered + " of " + st.total + " places say anything about this";
    return "Answered for " + st.answered + " of " + st.total + " places";
  }
  function colourOf(st, props) {
    var k = keyOf(props, st.col);
    if (!k) return null;
    var a = st.answers.filter(function (x) { return x.key === k; })[0];
    return a ? a.color : null;
  }

  /* The owner's settings over the layer's questions as they are now: the
     saved order first (questions gone since are dropped), questions new since
     after it; each shown unless the owner switched it off. A people question
     is never shown, whatever was saved. */
  function settingsOf(layer, mode) {
    var cols = colsOf(layer), seen = {}, order = [];
    var saved = mode && Array.isArray(mode.order) ? mode.order : [];
    saved.forEach(function (c) { if (cols.indexOf(c) >= 0 && !seen[c]) { seen[c] = true; order.push(c); } });
    cols.forEach(function (c) { if (!seen[c]) { seen[c] = true; order.push(c); } });
    var shown = {};
    order.forEach(function (c) {
      shown[c] = !isPeople(layer, c) && !(mode && mode.shown && mode.shown[c] === false);
    });
    return { order: order, shown: shown, summaryOn: !(mode && mode.summaryOn === false) };
  }
  // the questions a visitor sees, in the owner's order: shown, not people, answered by at least one place
  function shownStats(layer, features, mode) {
    var s = settingsOf(layer, mode);
    return s.order.filter(function (c) { return s.shown[c]; })
      .map(function (c) { return stats(layer, features, c); })
      .filter(function (st) { return !st.people && st.answered > 0; });
  }
  // can this atlas be in Insight: at least one question, not about people, that some place answers
  function canInsight(layer, features) {
    return colsOf(layer).some(function (c) { return !isPeople(layer, c) && stats(layer, features, c).answered > 0; });
  }

  /* ---------------- compare ---------------- */
  function bothCount(features, a, b) {
    return (features || []).filter(function (f) { var p = f && f.properties; return keyOf(p, a) && keyOf(p, b); }).length;
  }
  function canCompare(both, total) { return both >= CMP_PLACES && both >= total * CMP_SHARE; }
  // the questions an open one may be compared with: shown, and enough places answer both
  function compareOptions(list, features, col) {
    var total = (features || []).length;
    return (list || []).filter(function (st) { return st.col !== col; }).map(function (st) {
      return { st: st, both: bothCount(features, col, st.col) };
    }).filter(function (x) { return canCompare(x.both, total); });
  }
  /* Each answer of one question, split by the answers of the other, over the
     places answering both: [{ answer, count, cells: [{ answer, count, color }] }]. */
  function crossTable(features, sa, sb) {
    return sa.answers.map(function (a) {
      var rows = (features || []).filter(function (f) { var p = f && f.properties; return keyOf(p, sa.col) === a.key && keyOf(p, sb.col); });
      return {
        answer: a.name, key: a.key, count: rows.length,
        cells: sb.answers.map(function (b) {
          return { answer: b.name, key: b.key, color: b.color, count: rows.filter(function (f) { return keyOf(f.properties, sb.col) === b.key; }).length };
        }).filter(function (c) { return c.count > 0; }),
      };
    }).filter(function (r) { return r.count > 0; });
  }

  /* ---------------- the owner's settings, as the server keeps them ---------------- */
  function defaultInsight(layer) {
    var cols = colsOf(layer), shown = {};
    cols.forEach(function (c) { shown[c] = !isPeople(layer, c); });
    return { name: "insight", layer: layer && layer.id, summaryOn: true, order: cols, shown: shown, summary: null };
  }
  /* What an owner sent ({ summaryOn, order, shown }), made safe or refused:
     { settings } or { error } in plain words. Every question named must be
     one of the layer's; a people question can never be shown. */
  function cleanSettings(layer, input, mode) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "The settings were not sent properly." };
    var cols = colsOf(layer);
    var now = settingsOf(layer, mode);
    var out = { summaryOn: now.summaryOn, order: now.order.slice(), shown: {} };
    now.order.forEach(function (c) { out.shown[c] = now.shown[c]; });
    if (has(input, "summaryOn")) {
      if (typeof input.summaryOn !== "boolean") return { error: "Say whether the summary is on or off." };
      out.summaryOn = input.summaryOn;
    }
    if (has(input, "order")) {
      if (!Array.isArray(input.order)) return { error: "The order was not sent as a list." };
      var seen = {}, order = [];
      for (var i = 0; i < input.order.length; i++) {
        var c = input.order[i];
        if (typeof c !== "string" || cols.indexOf(c) < 0) return { error: "That question is not one of this atlas\u2019s." };
        if (seen[c]) return { error: "A question is in the order twice." };
        seen[c] = true; order.push(c);
      }
      cols.forEach(function (c) { if (!seen[c]) order.push(c); });
      out.order = order;
    }
    if (has(input, "shown")) {
      if (!input.shown || typeof input.shown !== "object" || Array.isArray(input.shown)) return { error: "Which questions show was not sent properly." };
      var ks = Object.keys(input.shown);
      for (var j = 0; j < ks.length; j++) {
        var k = ks[j], v = input.shown[k];
        if (cols.indexOf(k) < 0) return { error: "That question is not one of this atlas\u2019s." };
        if (typeof v !== "boolean") return { error: "Say whether each question shows or not." };
        if (v && isPeople(layer, k)) return { error: PEOPLE_REFUSED };
        out.shown[k] = v;
      }
    }
    cols.forEach(function (c) { if (isPeople(layer, c)) out.shown[c] = false; });
    return { settings: out };
  }

  /* ---------------- the summary's numbers ----------------
     The model is given these tables and nothing else: no place's own words,
     no names. Every question not about people that some place answers, and
     every pair of them that passes the compare rule. */
  function summaryTables(layer, features) {
    var total = (features || []).length;
    var qs = colsOf(layer).map(function (c) { return stats(layer, features, c); })
      .filter(function (st) { return !st.people && st.answered > 0; });
    var questions = qs.map(function (st) {
      return { id: st.col, question: st.question, answered: st.answered, places: total, saysNothing: st.none, fewPlaces: st.sparse,
        answers: st.answers.map(function (a) { return { answer: a.name, places: a.count }; }) };
    });
    var pairs = [];
    for (var i = 0; i < qs.length; i++) for (var j = i + 1; j < qs.length; j++) {
      var both = bothCount(features, qs[i].col, qs[j].col);
      if (!canCompare(both, total)) continue;
      var rows = crossTable(features, qs[i], qs[j]), cols = {}, colOrder = [];
      rows.forEach(function (r) { r.cells.forEach(function (c) { if (!(c.answer in cols)) { cols[c.answer] = 0; colOrder.push(c.answer); } cols[c.answer] += c.count; }); });
      pairs.push({ questions: [qs[i].col, qs[j].col], answerBoth: both,
        rows: rows.map(function (r) {
          return { answer: r.answer, places: r.count, split: r.cells.map(function (c) { return { answer: c.answer, places: c.count }; }) };
        }),
        // the second question's answers over the same places
        columns: colOrder.map(function (a) { return { answer: a, places: cols[a] }; }) });
    }
    return { places: total, questions: questions, pairs: pairs };
  }

  /* ========= the places' own words ("Story of the place in their own words", 5 Nov 2026) =========
     This is what the visitor card shows (Mithun, 5 Nov 2026: "go with 1").
     summaryTables above is what the older summary reads, and nothing here
     touches it: an atlas written before the story goes on showing that
     summary until its story is written.

     Mithun, 5 Nov 2026: the second version is a short STORY, not statistics —
     "focus on writing a short summary or story of the places. Stats are less
     important because the questions cover it." So the digest hands the model
     the places themselves and no counts at all (storyDigest):
       - for each place with words of its own: its id, the name it would be
         shown by, those words, and its answers to the questions on show as
         plain labels. The words are the place's own description, scrubbed
         sentence by sentence: never an email, a phone number, a link, an
         @handle, a credit line, anything a people column of that place says,
         or words that stand on more than SHARED_MAX places (a LOKA space's
         name copied onto every place is not a place's own words);
       - on a big atlas a sample spread across the answers, so the story is
         not written from one corner of the map;
       - quality: how many places have words at all, and how many repeat
         another place's words.
     A tagger's name is never in it, and a question whose answers are people
     is never read. */
  var QUOTE_MIN = 25, QUOTE_MAX = 180;
  // words standing on more places than this are a field the places share, not one place’s own words
  var SHARED_MAX = 2;
  // at most this many places are offered to the model, and this many characters of each one's words
  var STORY_PLACES = 80, STORY_WORDS = 400;
  /* How many pointed sentences are held up to the model as the evidence it
     may cite. Twenty, not twelve, so a feeling can be shown from places all
     over the map (Mithun, 6 Nov 2026). */
  var STORY_CANDIDATES = 20;
  /* The story's shape (Mithun, 5 Nov 2026): one short paragraph of 3 to 5
     sentences, each naming the 2 to 6 places it draws from, and two short
     quotes from two different places. Under MIN_STORY sentences left after
     the checks, nothing is shown. */
  /* The shape (Mithun, 5-6 Nov 2026): "Summarize what people are saying using
     the quotes. Whether they are curious, concerned, enjoying and so on.
     Mention the quotes at the bottom as evidence." So a sentence cites the
     quotes it rests on (STORY_CITES_MIN..MAX), and the quotes those kept
     sentences cite are shown underneath, in the order they are cited: at
     least STORY_QUOTES_MIN of them, at most STORY_QUOTES_MAX. */
  var MIN_STORY = 2, MAX_STORY = 5, STORY_CITES_MIN = 1, STORY_CITES_MAX = 3;
  var STORY_QUOTES_MIN = 2, STORY_QUOTES_MAX = 5;
  /* Under this many pointed quotes there is nothing to gather: the card shows
     the quotes themselves, under "In their own words", and no model writes a
     word (Mithun, 6 Nov 2026). */
  var STORY_VOICES_MIN = 4;
  // a place with fewer than this share of words, or this many repeats, is a thin atlas
  var THIN_WORDS = 0.5, THIN_SAME = 0.3;

  /* The wider people rule (the plan's "one wider people rule, shared"): the
     narrow isPeople above reads the layer's keyColumns and so misses a plain
     column called "creator", which no question was read from but which still
     names a person. Used for quotes only; which questions show is unchanged. */
  var PEOPLE_COL = /^(created_by|creator|creators|author|authors|owner|owners|user|users|username|user_name|tagger|taggers|contributor|contributors|photographer|reporter|observer|recorder|submitter|member|members|person|people)$/;
  function isPeopleColumn(name) {
    var s = String(name || "").trim().toLowerCase().replace(/[\s.-]+/g, "_");
    return PEOPLE_COL.test(s) || /_user_id$/.test(s) || /^user_/.test(s) || /_by$/.test(s) || /_name$/.test(s) && /user|member|author|owner|creator|tagger/.test(s);
  }
  function pushValue(into, v) {
    if (v == null) return;
    var whole = String(Array.isArray(v) ? v.join("; ") : v).replace(/\s+/g, " ").trim();
    if (!whole) return;
    into.push(whole);
    whole.split(/[;,/|]+/).forEach(function (bit) { var b = bit.trim(); if (b && b !== whole) into.push(b); });
  }
  /* Everything this place's people columns say: the plain people columns, and
     every people question with the columns it was read from and its evidence
     words. Short bits are left out: a two-letter name cannot be told from a
     word. */
  function peopleValuesOf(layer, props) {
    var out = [], p = props || {};
    Object.keys(p).forEach(function (k) { if (isPeopleColumn(k)) pushValue(out, p[k]); });
    colsOf(layer).forEach(function (c) {
      if (!isPeople(layer, c)) return;
      pushValue(out, p[c]); pushValue(out, p[c + "_why"]);
      var kc = ((layer && layer.keyColumns) || {})[c];
      (Array.isArray(kc) ? kc : kc ? [kc] : []).forEach(function (col) { pushValue(out, p[col]); });
    });
    var seen = {}, keep = [];
    out.forEach(function (v) { var f = foldName(v); if (f.length >= 3 && !seen[f]) { seen[f] = true; keep.push(v); } });
    return keep;
  }

  // a link, an email, a phone number or an @handle anywhere in the sentence
  var CONTACT = /(https?:\/\/|www\.[a-z0-9-]+\.|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(^|\s)@[A-Za-z0-9_]{3,}|(^|\s)\+?\d[\d–— ()-]{7,}\d)/i;
  // "Photo: J. H. Furneaux, Public domain, via Wikimedia Commons" and its kin
  var CREDIT = /((^|\s)(photo|photos|photograph|image|images|picture|pic|img|credit|credits|courtesy|source|src)\s*(by\b|:|—|-\s))|\b(public domain|wikimedia|wikipedia|creative commons|cc[ -]?by(?:-[a-z]{2,3})*|cc0|all rights reserved|rights reserved|unsplash|pexels|shutterstock|getty images|flickr)\b|©|\(c\)\s*\d{4}/i;
  // markup or a stray code fragment: never shown as a place's own words
  var QUOTE_JUNK = /[<>*#`_\[\]{}|\\]|\{\{|\}\}/;
  var ABBREV = /(^|\s)(st|mt|dr|mr|mrs|ms|sr|jr|rd|ave|blvd|no|vs|etc|approx|govt|co|ltd|pvt|fig|sq|ft|km|hrs|e\.g|i\.e|[a-z])\.$/i;

  /* The sentences of a text. A line break always ends one (a credit line sits
     on its own line); a full stop ends one unless the word before it is an
     abbreviation or an initial ("St. John's", "J. H. Furneaux"). */
  function splitSentences(text) {
    var out = [];
    String(text == null ? "" : text).split(/[\n\r]+/).forEach(function (para) {
      var buf = "";
      for (var i = 0; i < para.length; i++) {
        var ch = para.charAt(i);
        buf += ch;
        if (!/[.!?…]/.test(ch)) continue;
        var next = para.charAt(i + 1);
        if (next && !/\s/.test(next)) continue;
        if (ch === "." && ABBREV.test(buf.replace(/\s+$/, ""))) continue;
        out.push(buf); buf = "";
      }
      out.push(buf);
    });
    return out.map(function (s) { return s.replace(/\s+/g, " ").trim(); }).filter(function (s) { return !!s; });
  }
  /* Is this sentence safe to show as a place's own words? Answers "" when it
     is, else why not (the mock-up's dropped list prints the reason). */
  function quoteFault(sentence, peopleValues) {
    var s = String(sentence || "").trim();
    if (s.length < QUOTE_MIN) return "too short";
    if (s.length > QUOTE_MAX) return "too long for a quote";
    if (!/[\p{L}]{3}/u.test(s)) return "no words in it";
    if (QUOTE_JUNK.test(s)) return "it has markup in it";
    if (CONTACT.test(s)) return "it has a link, an email, a phone number or an @handle";
    if (CREDIT.test(s)) return "it is a credit line";
    var folded = foldName(s);
    for (var i = 0; i < (peopleValues || []).length; i++) {
      if (hasWhole(folded, foldName(peopleValues[i]))) return "it names a person (" + peopleValues[i] + ")";
    }
    return "";
  }
  function placeIdOf(f, i) {
    var p = (f && f.properties) || {};
    var id = p.tag_id || p.loka_id || p.id || p.uuid || p.slug || "";
    id = String(id).replace(/\s+/g, " ").trim();
    // a pasted table has no id of its own: the place's position in the layer stands in, held by the fingerprint
    return id || "at:" + i;
  }
  function placeNameOf(layer, f) {
    var p = (f && f.properties) || {};
    var t = (layer && layer.popup && layer.popup.title) || (layer && layer.label_text && layer.label_text.property) || "";
    return String((t && p[t]) || p.loka_name || p.name || p.title || "").replace(/\s+/g, " ").trim();
  }
  // the columns a quote may come from: free text nobody would mistake for a field
  var NOT_TEXT = /^(address|latitude|longitude|lat|lon|lng|created_at|updated_at|date|time|tag_id|id|uuid|slug|public_link|photo_small|thumbnail_url|photo_urls|photo_count|likes|comments|spaces|categories|labels|themes|_category|loka_name|name|title)$/;
  function looksFree(v) {
    var s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
    return s.length >= QUOTE_MIN && s.split(" ").length >= 4 && !/^https?:/i.test(s);
  }
  /* The text a quote for this question comes from: the column the question
     was read from when that column holds free text, else the place's longest
     free-text column. pattern_N and pattern_N_why are the reading's own words,
     not the place's, so they are never the source. */
  function quoteSourcesOf(layer, props, col) {
    var p = props || {}, out = [];
    var kc = ((layer && layer.keyColumns) || {})[col];
    (Array.isArray(kc) ? kc : kc ? [kc] : []).forEach(function (c) {
      // the same columns are barred here as anywhere else: a space's name, an address, a link are not words of a place's own
      if (c && !NOT_TEXT.test(String(c).toLowerCase()) && !/^pattern_\d+(_why)?$/.test(String(c)) && !isPeopleColumn(c) && looksFree(p[c])) {
        out.push(String(p[c]).replace(/\s+/g, " ").trim());
      }
    });
    var best = "";
    Object.keys(p).forEach(function (k) {
      if (NOT_TEXT.test(String(k).toLowerCase()) || /^pattern_\d+(_why)?$/.test(k) || isPeopleColumn(k)) return;
      var v = p[k];
      if (typeof v !== "string" || !looksFree(v)) return;
      var s = v.replace(/\s+/g, " ").trim();
      if (s.length > best.length) best = s;
    });
    if (best && out.indexOf(best) < 0) out.push(best);
    return out;
  }
  function quoteSourceOf(layer, props, col) { return quoteSourcesOf(layer, props, col)[0] || ""; }
  /* One place's own words, scrubbed: the sentences of its description that
     are safe to show, in order, up to STORY_WORDS characters. "" with the
     reason when it has none. The sentences are kept apart as well as joined,
     because a quote is one of them and the code puts its own copy back. */
  function placeWords(layer, f, col, opts) {
    var p = (f && f.properties) || {};
    var sources = quoteSourcesOf(layer, p, col);
    if (!sources.length) return { text: "", sentences: [], why: "the place has nothing written about it" };
    var people = peopleValuesOf(layer, p);
    var shared = opts && typeof opts.shared === "function" ? opts.shared : null;
    var firstFault = "";
    for (var s = 0; s < sources.length; s++) {
      /* Words several places share are a field, not this place's own words
         (a LOKA space's name read as the answer to "what kind of place is
         it?", a pasted boilerplate line). */
      if (shared && shared(sources[s])) { firstFault = firstFault || "those words stand on several places, so they are not this place’s own"; continue; }
      var ok = [], faults = [], len = 0;
      splitSentences(sources[s]).forEach(function (one) {
        var bad = quoteFault(one, people);
        if (bad) { faults.push(bad); return; }
        if (ok.length && len + one.length > STORY_WORDS) return;
        ok.push(one); len += one.length + 1;
      });
      if (!ok.length) { firstFault = firstFault || faults[0] || "nothing that can be quoted"; continue; }
      return { text: ok.join(" "), sentences: ok, why: "" };
    }
    return { text: "", sentences: [], why: firstFault || "nothing that can be quoted" };
  }
  /* Which of a place's own sentences is worth showing (Mithun, 6 Nov 2026:
     "show pointed quotes like questions or insightful descriptions"). The
     code scores each candidate and the story may quote only the pointed ones:

       + it asks something ("Does anyone know who the artist is?")      +3
       + it speaks as somebody ("we", "I", "my", "our", "us")           +2
       + it says how a place feels or what it is worth (FEELING)        +2
       + it turns ("but", "however", "used to", "no longer", "instead") +2
       + it is a sentence with a verb doing something, not a caption    +1
       - it is a bare label: a short noun phrase with no verb at all    -2
         ("table made with waste materials", "The Bier Library in Sarjapur.")

     A sentence at POINTED_MIN or above may be quoted; below it, the words
     still feed the story, they are just not held up as a quote. */
  var FEELING = /\b(beautiful|lovely|pleasant|peaceful|quiet|serene|calm|cool|cooler|shade|shelter|relief|great|wonderful|charming|interesting|strange|odd|sad|sadly|unfortunately|struggle|struggles|neglected|run down|wish|wishes|hope|hopes|wonder|wonders|why|how|feels?|seems?|remember|remembers|miss|misses|love|loves|enjoy|enjoys|favourite|favorite|worth|rare treat|no seats|should|must|used to|no longer|worried|worry|worries|concerned|sorry|afraid|proud|curious|annoyed|angry|grateful|thankful|glad|happy|lucky|shame|pity|please|hate)\b/i;
  var TURN = /\b(but|however|though|although|while|whereas|instead|yet|even so|no longer|used to|now)\b/i;
  var FIRST_PERSON = /\b(i|we|us|our|ours|my|mine|me)\b/i;
  var DOING = /\b(is|are|was|were|has|have|had|can|could|will|would|should|must|does|do|did|goes|go|sits|sit|stands|stand|grows|grow|reads|read|keeps|keep|feels|feel|seems|seem|provides?|serves?|offers?|gives?|makes?|takes?|covers?|brings?|attracts?|conducts?|starts?|opens?|remains?|functions?|traces?|anchors?|holds?|wish|wonder|struggle|struggles|cross|crosses|drink|drinks|cut|cuts|built|build|builds|wrote|writes|came|comes|stays?|runs?|leads?|shows?|says?|needs?|lives?|works?)\b/i;
  var LABEL_WORDS = 8, POINTED_MIN = 2;
  function quoteScore(text) {
    var t = String(text || "").trim();
    if (!t) return 0;
    var n = 0;
    if (/\?/.test(t)) n += 3;
    // the marks of somebody feeling something: "??", "!"
    if (/\?\?|!/.test(t)) n += 1;
    if (FIRST_PERSON.test(t)) n += 2;
    if (FEELING.test(t)) n += 2;
    if (TURN.test(t)) n += 2;
    var doing = DOING.test(t), words = t.split(/\s+/).length;
    if (doing) n += 1;
    if (!doing && words <= LABEL_WORDS) n -= 2;
    return n;
  }
  function isPointed(text) { return quoteScore(text) >= POINTED_MIN; }

  /* ---- what a quote is feeling, and what it is about (Mithun, 6 Nov 2026:
     "Gather feeling across quotes. Do not enumerate feelings one after the
     other in the sentences.") The code sorts the quotes into groups first, so
     the model is asked for ONE sentence that gathers a group, not a sentence
     a quote. A quote's feeling is the one whose cue words it carries most of;
     nothing recognised leaves it "describing". ---- */
  var FEELINGS = [
    { key: "wonder", label: "wondering or curious", re: /\?|\b(wonder|wonders|wondering|curious|anyone know|anybody know|does anyone|what is this|who made|why is|how deep|how old|not sure|i think this|must be)\b/gi },
    { key: "worry", label: "worried or concerned", re: /\b(worry|worried|concern|concerned|struggle|struggles|deteriorat\w*|cut down|cutting|destroy\w*|degrad\w*|polluted|dirty|garbage|dumped|encroach\w*|threat\w*|danger\w*|dying|drying|disappear\w*|hardly any|unfortunately|sadly|not present|no longer|scarce|affected|effects|underprivileged)\b/gi },
    { key: "wistful", label: "remembering how it was", re: /\b(used to|once was|earlier|before|remember|remembers|miss|missed|gone now|was having|previously|old days|history of)\b/gi },
    { key: "annoyed", label: "put out or asking for better", re: /\b(should be paid|not allowed|locked|closed|no seats|not open|rude|noisy|noise|ugly|hate|shame|pity|at least|nobody seems|why do|why don\u2019t|why dont|we should|i wish|wish there|wish they|if only|hope there|hoping for)\b/gi },
    { key: "delight", label: "enjoying it", re: /\b(beautiful|lovely|love|loves|great|wonderful|pleasant|enjoy\w*|favourite|favorite|glad|happy|peaceful|serene|calm|relief|cooler|cool off|shade|shelter|charming|perfect|amazing|nice|a treat|worth)\b/gi },
    { key: "pride", label: "proud of what is here", re: /\b(proud|heritage|famous|world famous|landmark|tradition\w*|historic\w*|ancient|oldest|five-hundred|legacy|memorial|archive|inscription\w*|serves as|anchor\w*|witness)\b/gi },
  ];
  var PLAIN_FEELING = { key: "describing", label: "simply describing it" };
  function feelingOf(text) {
    var t = String(text || ""), best = null;
    FEELINGS.forEach(function (f) {
      f.re.lastIndex = 0;
      var hits = (t.match(f.re) || []).length;
      if (hits && (!best || hits > best.hits)) best = { key: f.key, label: f.label, hits: hits };
    });
    return best ? { key: best.key, label: best.label } : { key: PLAIN_FEELING.key, label: PLAIN_FEELING.label };
  }
  // at most this many groups are offered, and this many quotes in one group
  var MAX_GROUPS = 6, GROUP_MAX = 3, GROUP_MIN = 2, PLAIN_GROUPS = 2;
  /* The groups: quotes that feel the same way about something in common. A
     group of two or more is what a sentence should gather; a quote left on
     its own is offered alone, and a sentence may rest on it only because
     there was nothing to put it with. */
  function groupQuotes(candidates) {
    var left = (candidates || []).slice(), groups = [], n = 0;
    var byFeeling = {};
    left.forEach(function (c) {
      var k = (c.feeling && c.feeling.key) || "describing";
      (byFeeling[k] = byFeeling[k] || []).push(c);
    });
    Object.keys(byFeeling).forEach(function (k) {
      var list = byFeeling[k].slice();
      while (list.length) {
        var head = list.shift();
        var topics = (head.topics || []).slice();
        var mates = [], rest = [];
        list.forEach(function (c) {
          var shared = (c.topics || []).filter(function (t) { return topics.indexOf(t) >= 0; });
          if (shared.length && mates.length < GROUP_MAX - 1) mates.push({ c: c, shared: shared[0] });
          else rest.push(c);
        });
        list = rest;
        var quotes = [head].concat(mates.map(function (m) { return m.c; }));
        groups.push({ id: "g" + (++n), feeling: head.feeling.key, feels: head.feeling.label,
          about: mates.length ? mates[0].shared : (topics[0] || ""),
          quotes: quotes.map(function (q) { return q.id; }), alone: quotes.length < GROUP_MIN,
          words: thingWords(quotes.map(function (q) { return q.text || ""; }).join(" ")) });
      }
    });
    /* A group that carries a feeling comes before one that merely describes,
       and a fuller group before a thinner one. Plain description is held to
       PLAIN_GROUPS, so the paragraph is about how people feel and not about
       what things are. */
    groups.sort(function (a, b) {
      var fa = a.feeling === "describing" ? 0 : 1, fb = b.feeling === "describing" ? 0 : 1;
      return (fb - fa) || (b.quotes.length - a.quotes.length);
    });
    var plain = 0;
    return groups.filter(function (g) {
      if (g.feeling !== "describing") return true;
      plain += 1;
      return plain <= PLAIN_GROUPS;
    }).slice(0, MAX_GROUPS);
  }
  /* Two groups that feel differently about the same thing: a sentence may
     hold them together ("...while others..."). */
  /* The things a group's quotes name: words of four letters or more that are
     not glue. Two groups are about "the same thing" only when they share one
     of these — a shared answer label ("Natural feature") is far too wide: it
     let "relief under the trees, while someone wonders about an ant's
     burrow" stand as a contrast (Gemini run, 5 Nov 2026). */
  var GLUE = /^(this|that|these|those|there|their|them|they|have|with|from|were|been|being|will|would|could|should|what|when|where|which|while|about|very|just|also|into|onto|over|under|here|some|more|most|much|many|only|than|then|like|such|each|every|other|another|your|ours|mine|does|done|doing|make|made|look|looks|feel|feels|felt|place|places|thing|things|area|spot|near|around|because|instead|still|even|again|ever)$/;
  function thingWords(text) {
    var out = [];
    String(text || "").toLowerCase().replace(/[^a-z\u00c0-\u024f\s]/g, " ").split(/\s+/).forEach(function (w) {
      if (w.length < 4 || GLUE.test(w)) return;
      var stem = w.replace(/ies$/, "y").replace(/(s|x|ch|sh)es$/, "$1").replace(/([^s])s$/, "$1");
      if (out.indexOf(stem) < 0) out.push(stem);
    });
    return out;
  }
  function tensionsOf(groups) {
    var out = [];
    (groups || []).forEach(function (a, i) {
      (groups || []).forEach(function (b, j) {
        if (j <= i || out.length >= 2) return;
        if (a.feeling === b.feeling || !a.about || a.about !== b.about) return;
        var common = (a.words || []).filter(function (w) { return (b.words || []).indexOf(w) >= 0; });
        if (!common.length) return;
        out.push({ about: a.about, groups: [a.id, b.id], feels: [a.feels, b.feels] });
      });
    });
    return out;
  }
  // the group a quote belongs to, by its id
  function groupOfQuote(groups, id) {
    var found = null;
    (groups || []).forEach(function (g) { if (!found && g.quotes.indexOf(id) >= 0) found = g; });
    return found;
  }

  /* The name this place would be shown by, or "" when it has none that can
     be shown: a title that is really a list, one that only repeats the
     place's categories (blr-finds-test titles its places by them), one its
     own people columns say, one with a link or a credit in it, or one that is
     only the first words of the description cut short ("Grooves on a tree
     bark, from…" on the real Bengaluru layer) — a cut-off line is not a name,
     and the link says "this place" instead. */
  function placeLabelOf(layer, f) {
    var p = (f && f.properties) || {};
    var nm = placeNameOf(layer, f);
    if (!nm || nm.length > 90) return "";
    if (/(…|\.\.\.)$/.test(nm)) return "";
    if (/[;|]/.test(nm)) return "";
    if (foldName(nm) === foldName(p.categories || "") || foldName(nm) === foldName(p._category || "")) return "";
    if (CONTACT.test(nm) || CREDIT.test(nm)) return "";
    var folded = foldName(nm);
    var named = peopleValuesOf(layer, p).some(function (v) { return hasWhole(folded, foldName(v)); });
    return named ? "" : nm;
  }

  /* The story's digest: the places themselves, no counts. For each place with
     words of its own — its id, the name it would be shown by, those words,
     and its answers to the questions on show as plain labels. On a big atlas
     a sample, taken a place at a time from each answer of each question in
     turn, so the offered places are spread across the answers instead of
     being the first eighty in the file.

     Reads only; never a people question, never a tagger's name, and never a
     question the owner has switched off (opts.shownCols). */
  function storyDigest(layer, features, opts) {
    var feats = features || [], total = feats.length;
    var only = (opts && opts.shownCols) || null;
    var cap = (opts && opts.cap) || STORY_PLACES;
    var qs = colsOf(layer).map(function (c) { return stats(layer, features, c); })
      .filter(function (st) { return !st.people && st.answered > 0 && (!only || only.indexOf(st.col) >= 0); });

    /* Words standing on more places than SHARED_MAX are a field the places
       have in common, not anybody's own words. */
    var times = Object.create(null);
    feats.forEach(function (f) {
      var seen = Object.create(null);
      qs.forEach(function (st) {
        quoteSourcesOf(layer, (f && f.properties) || {}, st.col).forEach(function (t) {
          var k = foldName(t);
          if (seen[k]) return;
          seen[k] = true; times[k] = (times[k] || 0) + 1;
        });
      });
    });
    var isShared = function (text) { return (times[foldName(text)] || 0) > SHARED_MAX; };
    var first = (qs[0] || {}).col || "";

    var rows = feats.map(function (f, i) {
      var p = (f && f.properties) || {};
      var w = placeWords(layer, f, first, { shared: isShared });
      var answers = [];
      qs.forEach(function (st) {
        var a = answerOf(p, st.col);
        if (a) answers.push({ question: st.question, answer: a });
      });
      return { id: placeIdOf(f, i), name: placeLabelOf(layer, f), words: w.text, sentences: w.sentences,
        answers: answers, why: w.why, at: i };
    });

    // one bucket per answer of each question, holding the places with words
    var buckets = [], spare = [];
    qs.forEach(function (st) {
      st.answers.forEach(function (a) {
        var hits = rows.filter(function (r) { return r.words && keyOf((feats[r.at] || {}).properties, st.col) === a.key; });
        if (hits.length) buckets.push(hits);
      });
    });
    rows.forEach(function (r) { if (r.words && !r.answers.length) spare.push(r); });
    var taken = Object.create(null), places = [];
    for (var round = 0; places.length < cap; round++) {
      var moved = false;
      for (var b = 0; b < buckets.length && places.length < cap; b++) {
        var list = buckets[b];
        if (round >= list.length) continue;
        moved = true;
        var r = list[round];
        if (taken[r.id]) continue;
        taken[r.id] = true;
        places.push(r);
      }
      if (!moved) break;
    }
    for (var k = 0; places.length < cap && k < spare.length; k++) {
      if (!taken[spare[k].id]) { taken[spare[k].id] = true; places.push(spare[k]); }
    }

    // how much the places have to say at all
    var words = 0, same = Object.create(null), repeats = 0;
    rows.forEach(function (r) {
      if (!r.words) return;
      words++;
      var k = foldName(r.words).slice(0, 120);
      if (same[k]) repeats++; else same[k] = true;
    });
    var quality = { places: total, withWords: words, repeated: repeats, offered: places.length,
      thin: total > 0 && (words / total < THIN_WORDS || repeats / total > THIN_SAME) };
    quality.warning = quality.thin ? "Many places have little written about them, so read this with care" : "";

    /* The quotes worth offering: the pointed sentences of the offered places,
       the sharpest first, at most one from each place so two quotes are never
       two halves of the same note, and at most STORY_CANDIDATES in all. */
    var candidates = [];
    places.forEach(function (r) {
      var best = null;
      (r.sentences || []).forEach(function (one) {
        var n = quoteScore(one);
        if (n >= POINTED_MIN && (!best || n > best.score)) {
          best = { id: r.id, text: one, score: n, feeling: feelingOf(one),
            topics: (r.answers || []).map(function (a) { return a.answer; }) };
        }
      });
      if (best) candidates.push(best);
    });
    candidates.sort(function (x, y) { return y.score - x.score; });
    candidates = candidates.slice(0, STORY_CANDIDATES);
    var groups = groupQuotes(candidates);
    var tensions = tensionsOf(groups);

    return { places: total,
      questions: qs.map(function (st) { return { id: st.col, text: st.question, answers: st.answers.map(function (a) { return a.name; }) }; }),
      offered: places.map(function (r) { return { id: r.id, name: r.name, words: r.words, sentences: r.sentences, answers: r.answers }; }),
      candidates: candidates, groups: groups, tensions: tensions,
      /* The reason a place could not be used names no one: quoteFault says
         which person it saw, and that name is nobody's business outside the
         check itself. */
      unquotable: rows.filter(function (r) { return !r.words; })
        .map(function (r) { return { id: r.id, why: String(r.why).replace(/\s*\([^)]*\)\s*$/, "") }; }),
      quality: quality };
  }
  /* The places offered, by id. The map has no prototype, so a place whose id
     is "__proto__" or "constructor" is itself and nothing else, and an id the
     model made up never finds an inherited member to stand in for a place
     (Opus review, 5 Nov 2026). */
  function offeredById(digest) {
    var by = Object.create(null);
    ((digest && digest.offered) || []).forEach(function (o) { by[o.id] = o; });
    return by;
  }

  // the numbers written in a sentence: "1,234" is 1234
  function numbersIn(text) {
    return (String(text || "").match(/\d+(?:,\d{3})*(?:\.\d+)?/g) || []).map(function (s) { return s.replace(/,/g, ""); });
  }
  /* ---------------- the summary's check (v3, Mithun, 25 Oct 2026) ----------------
     Each sentence comes with the one cell of the tables it states: its
     questions (for a pair, the first question first), the answers it names in
     the same order, its count (M) and the group that count is out of (of, N).
     The cell must be in the tables exactly, and the sentence must say it:
       - one question, one answer: count is that answer's places, of is the
         places that answer the question;
       - one question, no answer: the places that say nothing, out of every
         place; or, for a question few places answer, those few (count = of);
       - a pair: count is the split entry under the first answer's row, of is
         that row or the places that answer both.
     Then: no number but the cell's own (and the map's total); both of them in
     the text; every answer named; "all" or "every" only when count is the
     whole group. The old check asked only whether each number was true
     somewhere for the questions named, so 36 where the cell says 37 passed
     when 36 was true of another row. */
  // answer names as a reader sees them: case, spacing and the kind of apostrophe or quote do not count
  function foldName(s) {
    return String(s == null ? "" : s).replace(/[‘’`“”"']/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
  }
  /* A name stands whole in a text when no letter or digit touches it on
     either side (and no "1,2" or "1.5" runs on from it): answer "1" is not in
     "12", "No" is not in "nothing", "4" is not in "40". Both already folded. */
  var WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
  function wholeAt(hay, needle, from) {
    var at = hay.indexOf(needle, from);
    while (at >= 0) {
      var b = hay.charAt(at - 1), bb = hay.charAt(at - 2), e = at + needle.length, a = hay.charAt(e), aa = hay.charAt(e + 1);
      var before = at > 0 && (WORD_CHAR.test(b) || (/[.,]/.test(b) && /\d/.test(bb)));
      var after = e < hay.length && (WORD_CHAR.test(a) || (/[.,]/.test(a) && /\d/.test(aa)));
      if (!before && !after) return at;
      at = hay.indexOf(needle, at + 1);
    }
    return -1;
  }
  function hasWhole(hay, needle) { return !!needle && wholeAt(hay, needle, 0) >= 0; }
  // the text with every whole stand of the name taken out
  function cutWhole(hay, needle) {
    if (!needle) return hay;
    var at = wholeAt(hay, needle, 0);
    while (at >= 0) {
      hay = hay.slice(0, at) + " " + hay.slice(at + needle.length);
      at = wholeAt(hay, needle, at + 1);
    }
    return hay;
  }
  function findAnswer(list, name) {
    var f = foldName(name);
    for (var i = 0; i < (list || []).length; i++) if (foldName(list[i].answer) === f) return list[i];
    return null;
  }
  function toCount(v) {
    if (typeof v === "number" && isFinite(v) && Math.floor(v) === v && v >= 0) return v;
    if (typeof v === "string" && /^\s*\d+\s*$/.test(v)) return Number(v);
    return null;
  }
  /* The cell a sentence says it states: { cell } or { why }. The cell holds
     its shape (single, unanswered, few, pair), its questions and answers in
     the tables' order, count, of, and for a pair whether of is the row. */
  function sentenceCell(s, tables) {
    var byId = {};
    (tables.questions || []).forEach(function (q) { byId[q.id] = q; });
    var qs = Array.isArray(s.questions) ? s.questions.filter(function (c, i, a) { return a.indexOf(c) === i; }) : [];
    if (!qs.length) return { why: "names no question" };
    for (var i = 0; i < qs.length; i++) if (!byId[qs[i]]) return { why: "no such cell: there is no question " + qs[i] };
    var ans = Array.isArray(s.answers) ? s.answers.filter(function (a) { return typeof a === "string" && a.trim(); }) : [];
    var count = toCount(s.count), of = toCount(s.of);
    if (count === null || of === null) return { why: "no such cell: it gives no count and group" };
    if (qs.length === 1) {
      var q = byId[qs[0]];
      if (!ans.length) {
        if (q.fewPlaces && count === q.answered && of === q.answered) return { cell: { shape: "few", questions: [q.id], answers: [], count: count, of: of } };
        // "N of the {places} places say nothing": the two numbers either way round are the same cell
        if ((count === q.saysNothing && of === tables.places) || (of === q.saysNothing && count === tables.places)) {
          return { cell: { shape: "unanswered", questions: [q.id], answers: [], count: q.saysNothing, of: tables.places } };
        }
        return { why: "no such cell: " + count + " of " + of + " for " + q.id + "; the table says " + q.saysNothing + " of the " + tables.places + " places say nothing" +
          (q.fewPlaces ? ", and " + q.answered + " answer" : "") };
      }
      if (ans.length !== 1) return { why: "no such cell: one question with " + ans.length + " answers" };
      var a = findAnswer(q.answers, ans[0]);
      if (!a) return { why: "no such cell: " + q.id + " has no answer " + ans[0] };
      if (count !== a.places) return { why: count + " is not the cell for " + a.answer + "; the table says " + a.places };
      if (of !== q.answered) return { why: of + " is not the group for " + a.answer + "; the table says " + q.answered + " places answer " + q.id };
      return { cell: { shape: "single", questions: [q.id], answers: [a.answer], count: count, of: of } };
    }
    if (qs.length === 2) {
      var pair = null;
      (tables.pairs || []).forEach(function (p) {
        if (!pair && p.questions.length === 2 && p.questions.indexOf(qs[0]) >= 0 && p.questions.indexOf(qs[1]) >= 0) pair = p;
      });
      if (!pair) return { why: "no such cell: the tables do not compare " + qs[0] + " and " + qs[1] };
      if (ans.length !== 2) return { why: "no such cell: a pair needs one answer to each of its questions" };
      // the ids the other way round from the pair: the answers too
      var flip = pair.questions[0] !== qs[0];
      var A = flip ? ans[1] : ans[0], B = flip ? ans[0] : ans[1];
      var row = findAnswer(pair.rows, A);
      if (!row) return { why: "no such cell: no row " + A + " for " + pair.questions[0] };
      var hit = findAnswer(row.split, B);
      if (!hit) return { why: "no such cell: no place answers both " + row.answer + " and " + B };
      var label = row.answer + " + " + hit.answer;
      if (count !== hit.places) return { why: count + " is not the cell for " + label + "; the table says " + hit.places };
      if (of !== row.places && of !== pair.answerBoth) {
        return { why: of + " is not the group for " + label + "; the table says " + row.places + " (the row) or " + pair.answerBoth + " (both answered)" };
      }
      return { cell: { shape: "pair", questions: pair.questions.slice(), answers: [row.answer, hit.answer], count: count, of: of,
        ofRow: of === row.places && of !== pair.answerBoth, flip: flip } };
    }
    return { why: "no such cell: a sentence states one question or one pair" };
  }
  /* The model's sentences, checked one by one: { kept, dropped }. kept holds
     { text, questions, answers, count, of, cell } and is empty when under two
     pass (no summary); dropped holds { index, text, why } for each that
     failed, `index` its place in the list given. The sentences are written
     from the counts only, so the reasons are safe to log and to show the
     model again. */
  function checkSentencesWithReasons(list, tables) {
    var byId = {};
    (tables.questions || []).forEach(function (q) { byId[q.id] = q; });
    var kept = [], dropped = [];
    (Array.isArray(list) ? list : []).forEach(function (s, i) {
      if (kept.length >= MAX_SENTENCES) return;
      var raw = typeof s === "string" ? s : s && typeof s.text === "string" ? s.text : "";
      var drop = function (why) { dropped.push({ index: i, text: String(raw).slice(0, MAX_SENTENCE), why: why }); };
      // the model sometimes tags a sentence with its question's id ("(pattern_2)"): not a number, never shown
      var text = raw.replace(/\s*\(?\bpattern_\d+\b\)?/g, "").replace(/\s+/g, " ").trim().replace(/([.!?])[,;]+$/, "$1");
      if (!text) return drop("it is empty");
      if (text.length > MAX_SENTENCE) return drop("it is too long");
      if (/[%<>*#`_\[\]{}|\\]|https?:/i.test(text)) return drop("it has a percentage, a link or markup");
      var r = sentenceCell(s && typeof s === "object" ? s : {}, tables);
      if (r.why) return drop(r.why);
      var c = r.cell;
      var cited = s.questions.filter(function (q, k, a) { return a.indexOf(q) === k; });
      var qTexts = cited.map(function (q) { return byId[q].question; });
      /* The words a sentence borrows from its cell (an answer's name, a
         question quoted whole) are not its own: a number or a number word
         in them is allowed ("Two-wheeler"), and an "all" in them is not the
         sentence saying all. Taken out only where they stand whole. */
      var folded = foldName(text), bare = folded;
      c.answers.concat(qTexts).forEach(function (n) { bare = cutWhole(bare, foldName(n)); });
      if (hasNumberWords(bare)) return drop("it writes an amount in words");
      var ok = {};
      [c.count, c.of, tables.places].forEach(function (n) { ok[String(n)] = true; });
      qTexts.forEach(function (t) { numbersIn(t).forEach(function (n) { ok[n] = true; }); });
      var nums = numbersIn(bare);
      var stray = nums.filter(function (n) { return !ok[n]; });
      if (stray.length) return drop("number " + stray[0] + " is not in its cell");
      // every number of the cell must stand in the text
      var missing = [c.count, c.of].filter(function (n) { return nums.indexOf(String(n)) < 0; });
      if (missing.length) return drop("number " + missing[0] + " of its cell is not in it");
      var unnamed = c.answers.filter(function (n) { return !hasWhole(folded, foldName(n)); });
      if (unnamed.length) return drop("it does not name " + unnamed[0]);
      /* "nothing at all", "none at all": the idiom is not the sentence saying
         every place (found on the real Bengaluru layer, 5 Nov 2026), so it is
         taken out before the all-of-a-part test. Only the idiom: an "at all"
         that is not after one of those words, or that runs straight into a
         number ("at all 25 of the 40 places"), still counts as "all". */
      var IDIOM = /\b(nothing|none|not|nobody|no one|anything|anybody|hardly|barely|scarcely)\s+at all\b(?!\s*[\d,.]*\d)/gi;
      if (/\b(all|every)\b/i.test(bare.replace(IDIOM, " ")) && c.count !== c.of) return drop("it says all but the count is a part (" + c.count + " of " + c.of + ")");
      // the answers in the sentence's own order of questions, spelt as the tables spell them
      var answers = c.flip ? c.answers.slice().reverse() : c.answers.slice();
      kept.push({ text: text, questions: cited, answers: answers, count: c.count, of: c.of, cell: c });
    });
    return { kept: kept.length >= MIN_SENTENCES ? kept : [], dropped: dropped };
  }
  /* The sentences that pass, as they are kept and shown: { text, questions }.
     Under two pass: none (no summary). */
  function checkSentences(list, tables) {
    return checkSentencesWithReasons(list, tables).kept.map(function (s) { return { text: s.text, questions: s.questions }; });
  }
  // the sentences a visitor sees: those whose every question is on show; under two, none
  function visibleSentences(summary, shownCols) {
    var list = summary && Array.isArray(summary.sentences) ? summary.sentences : [];
    var out = list.filter(function (s) {
      var qs = (s && Array.isArray(s.questions)) ? s.questions : [];
      return s && typeof s.text === "string" && qs.length > 0 && qs.every(function (c) { return shownCols.indexOf(c) >= 0; });
    });
    return out.length >= MIN_SENTENCES ? out : [];
  }
  /* ---------------- "Story of the place in their own words": the story on the card ----------------
     The server writes it (insight-summary.js writeStory) and keeps it in
     mode.story: { sig, sentences: [{ text, quotes:[id] }], quotes: [{ id,
     text, name }], ownWords, at }. An atlas written before the story has no
     mode.story at all, and goes on showing mode.summary until its next update.

     Nothing is taken on trust at render time. Every quote is looked up among
     the places as they stand now: one whose place the owner has hidden (it is
     no longer in the layer) is dropped, and so is one whose words have been
     edited since, because the quote must be word for word what the place
     says. A sentence left with none of its quotes goes too — there is no
     sentence without its evidence. Under two sentences, or under two quotes
     left to show, the card falls back to the quotes themselves ("In their own
     words"); under two of those nothing is shown, heading and all, and the
     questions stand alone. */
  /* The place's own words as they stand now, as a visitor could read them:
     the columns the questions ON SHOW are read from, and the place's own
     free-text columns that no question is read from at all. A column only a
     switched-off question is read from is left out, so a quote taken from it
     is no longer shown (Mithun, 5 Nov 2026) — even when it is the longest
     thing the place says. The same columns are barred as everywhere else: an
     address, a link, a name, the reading's own pattern_N words, a people
     column. */
  function wordsNow(layer, props, cols) {
    var p = props || {}, keys = ((layer && layer.keyColumns) || {});
    var all = colsOf(layer), on = cols && cols.length ? cols : all;
    var claimed = Object.create(null), open = Object.create(null);
    all.forEach(function (c) {
      var kc = keys[c];
      (Array.isArray(kc) ? kc : kc ? [kc] : []).forEach(function (k) {
        claimed[String(k)] = true;
        if (on.indexOf(c) >= 0) open[String(k)] = true;
      });
    });
    var out = [], seen = Object.create(null);
    Object.keys(p).forEach(function (k) {
      if (NOT_TEXT.test(String(k).toLowerCase()) || /^pattern_\d+(_why)?$/.test(k) || isPeopleColumn(k)) return;
      if (claimed[k] && !open[k]) return;      // only a question now switched off is read from it
      if (!looksFree(p[k])) return;
      var one = foldName(String(p[k]).replace(/\s+/g, " ").trim());
      if (one && !seen[one]) { seen[one] = true; out.push(one); }
    });
    return out.join(" \u0004 ");
  }
  function storyToShow(mode, layer, features, shownCols) {
    var st = mode && mode.story;
    if (!st || typeof st !== "object" || (mode && mode.summaryOn === false)) return null;
    var feats = features || [];
    var cols = shownCols || colsOf(layer);
    var at = Object.create(null);
    feats.forEach(function (f, i) { var id = placeIdOf(f, i); if (!(id in at)) at[id] = i; });
    var held = [];
    (Array.isArray(st.quotes) ? st.quotes : []).forEach(function (q) {
      if (!q || typeof q.text !== "string" || !q.text) return;
      var i = at[q.id];
      if (i === undefined) return;                       // the place is off the map now
      var f = feats[i], p = (f && f.properties) || {};
      if (wordsNow(layer, p, cols).indexOf(foldName(q.text)) < 0) return;   // changed since, or from a question now off
      /* The name is worked out again from the place as it stands, by the same
         rule that chose it (placeLabelOf): a name that is a credit line, a
         category, or anybody's name is no name to show, and "Show this place
         on the map" stands in its stead. Never placeNameOf here — that would
         put back the very names the rule keeps out. */
      held.push({ id: q.id, text: q.text, name: placeLabelOf(layer, f), at: i });
    });
    var ownWords = function () {
      return held.length >= STORY_QUOTES_MIN ? { sentences: [], quotes: held, ownWords: true } : null;
    };
    if (st.ownWords) return ownWords();
    var byId = Object.create(null);
    held.forEach(function (q) { byId[q.id] = true; });
    var sents = (Array.isArray(st.sentences) ? st.sentences : []).filter(function (s) {
      return s && typeof s.text === "string" && (s.quotes || []).some(function (id) { return byId[id]; });
    });
    var cited = held.filter(function (q) {
      return sents.some(function (s) { return (s.quotes || []).indexOf(q.id) >= 0; });
    });
    if (sents.length < MIN_STORY || cited.length < STORY_QUOTES_MIN) return ownWords();
    return { sentences: sents, quotes: cited, ownWords: false };
  }
  /* The card itself. The paragraph is the sentences run together, then the
     quotes that back them, each a button to its place on the map (the same
     data-in="place" data-i row the question lists use). */
  function voiceHead() { return '<div class="in-sect"><span class="in-stamp">Story of the place in their own words</span></div>'; }
  function storyCardHTML(shown) {
    if (!shown) return "";
    var quotes = shown.quotes.map(function (q) {
      return '<li class="in-fq"><q>' + escText(q.text) + "</q> " +
        '<button type="button" data-in="place" data-i="' + q.at + '">' +
        // a name that is long, or is only the quote's own first words, says nothing new:
        // the plain link instead (it ran off the panel on Divar Island, 5 Nov 2026)
        (q.name && q.name.length <= 40 && String(q.text || "").toLowerCase().indexOf(String(q.name).toLowerCase()) !== 0
          ? "See “" + escText(q.name) + "”" : "Show this place on the map") +
        "</button></li>";
    }).join("");
    return '<section class="in-sum" aria-label="Story of the place in their own words">' + voiceHead() +
      (shown.ownWords
        ? ''
        : '<p class="in-story">' + shown.sentences.map(function (s) { return escText(s.text); }).join(" ") + "</p>") +
      '<ul class="in-quotes">' + quotes + "</ul>" +
      // quotes alone need no small print: the heading already says whose words they are (Mithun, 5 Nov 2026)
      (shown.ownWords ? "" : '<div class="in-by">Written by AI from what people wrote about these places. The counts are in the questions.</div>') +
      "</section>";
  }

  /* The panel's tabs. One panel now, "Insights": Voices at the
     top, the questions below it (Mithun, 5 Nov 2026 — there is no second tab
     to flip to any more). A visitor has that one panel and so no tab row at
     all; the owner has one more tab, Settings (`extra`, owner-modes.js), so
     the row shows "Insights · Settings". Fewer than two tabs: none. */
  function panelTabs(mode, shownCols, extra) {
    var t = [{ key: "q", label: "Insights" }];
    if (extra) t.push(extra);
    return t.length > 1 ? t : [];
  }

  /* ==================================================================
     THE VIEWER. atlas.js hands over what it owns (eventApi, the same one
     Event and Explore get) and calls back at the same points: layers(),
     pinEl(), cardHTML(), buildPanel(), ready(), framed(), frameBox(),
     sheetHead(). `insight: true` tells atlas.js there is no row of buttons.
  ================================================================== */
  function escText(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function escAttr(s) { return escText(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  // a sentence, its numbers in bold: everything escaped first, the model gives plain text only
  function sentenceHTML(text) { return escText(text).replace(/\d+(?:,\d{3})*(?:\.\d+)?/g, "<b>$&</b>"); }
  function placesWord(n) { return n === 1 ? "place" : "places"; }

  var CSS = [
    ".in-panel{padding:.15rem 0 1rem;font-size:var(--t-ui,.9rem)}",
    ".in-panel .in-stamp,.in-card .in-stamp{font-size:var(--t-label,.72rem);font-weight:700;letter-spacing:.12em;text-transform:uppercase}",
    // Voices: plain body text, no box, no rules, no indent (Mithun, 5 Nov 2026)
    ".in-sum{margin:0 0 1.4rem}",
    ".in-sum .in-stamp{color:var(--color-leaf-deep,#1F5232)}",
    ".in-sum p{margin:.3rem 0 0;font-size:.92rem;line-height:1.5;color:var(--color-text-primary,#24211D)}",
    // the panel's tabs stand where the head's word stood, and look as it did: the chosen one underlined in Sindoor
    ".panel-head.in-tabbed .sheet-who>strong{display:none !important}",
    ".in-tabs{display:flex;gap:.9rem;min-width:0;flex:1 1 auto;overflow:hidden}",
    ".in-tab{flex:none;position:relative;white-space:nowrap;background:none;border:0;border-bottom:2px solid transparent;border-radius:0;margin:0;padding:.15rem .1rem;font:inherit;font-size:var(--t-label,.72rem);font-weight:700;letter-spacing:.12em;text-transform:uppercase;line-height:1.1;color:var(--color-text-muted,#6E6A63);cursor:pointer}",
    ".in-tab:hover{color:var(--color-text-secondary,#5A5751)}",
    ".in-tab.on{color:var(--color-text-primary,#24211D);border-bottom-color:var(--color-sindoor,#C9402B)}",
    ".in-tab:focus-visible{outline:2px solid var(--color-leaf,#2A6B41);outline-offset:2px}",
    ".in-tab .in-ts,.in-tabs.in-short .in-tab .in-tl{display:none}",
    ".in-tabs.in-short .in-tab .in-ts{display:inline}",
    ".atlas-panel.collapsed .in-tab.on{border-bottom-color:transparent}",
    // a phone: the head's row is one line taller than the word, so each tab gets a taller target than it shows
    "@media (max-width:720px){.in-tabs{margin-bottom:.2rem}.in-tab::after{content:\"\";position:absolute;left:-.4rem;right:-.4rem;top:-10px;bottom:-6px}}",
    ".in-sum .in-by{margin-top:.55rem;font-size:var(--t-meta,.8rem);color:var(--color-text-muted,#6E6A63)}",
    // the story, and the quotes under it that it rests on
    ".in-sum .in-story{margin:.35rem 0 0;font-size:.95rem;line-height:1.55;color:var(--color-text-primary,#24211D)}",
    ".in-quotes{margin:.8rem 0 0;padding:0;list-style:none}",
    ".in-fq{margin:.6rem 0 0;padding:0}",
    ".in-fq q{font-family:var(--font-display,Georgia,serif);font-style:italic;font-size:.92rem;line-height:1.45;color:var(--color-text-secondary,#5A5751);quotes:\"\\201C\" \"\\201D\"}",
    ".in-fq button{background:none;border:none;padding:0;margin:0;font:inherit;font-size:var(--t-meta,.8rem);font-weight:700;color:var(--color-leaf-deep,#1F5232);text-decoration:underline;text-underline-offset:2px;cursor:pointer;text-align:left;white-space:normal;overflow-wrap:anywhere}",
    ".in-fq button:focus-visible{outline:2px solid var(--color-leaf,#2A6B41);outline-offset:2px}",
    "@media (max-width:720px){.in-sum .in-story{font-size:.92rem}.in-fq q{font-size:.88rem}}",
    ".in-writing{display:flex;gap:.7rem;align-items:flex-start}",
    ".in-writing .in-lines{flex:none;width:44px;padding-top:.45rem}",
    ".in-writing .in-lines i{display:block;height:5px;border-radius:3px;background:var(--color-leaf,#2A6B41);opacity:.25;margin-bottom:5px;transform-origin:left;animation:in-grow 2.4s ease-in-out infinite}",
    ".in-writing .in-lines i:nth-child(2){animation-delay:.3s;width:80%}",
    ".in-writing .in-lines i:nth-child(3){animation-delay:.6s;width:60%}",
    "@keyframes in-grow{0%,100%{opacity:.18;transform:scaleX(.6)}50%{opacity:.55;transform:scaleX(1)}}",
    "@media (prefers-reduced-motion:reduce){.in-writing .in-lines i{animation:none;opacity:.4}}",
    ".in-sect{display:flex;align-items:baseline;justify-content:space-between;gap:.5rem;margin:.2rem 0 .5rem}",
    ".in-sect .in-stamp{color:var(--color-text-muted,#6E6A63)}",
    ".in-hint{font-size:var(--t-meta,.8rem);color:var(--color-text-muted,#6E6A63);margin:-.2rem 0 .7rem}",
    ".in-q{border:1px solid var(--color-border,rgba(36,33,29,.18));border-radius:var(--radius-lg,.375rem);margin-bottom:.6rem;background:var(--color-surface,#FDFCF8)}",
    ".in-q.open{border-color:rgba(36,33,29,.35);box-shadow:0 2px 10px rgba(36,33,29,.07)}",
    ".in-qhead{display:block;width:100%;text-align:left;background:none;border:none;padding:.65rem .8rem .6rem;font:inherit;color:inherit;cursor:pointer}",
    ".in-qt{font-family:var(--font-display,Georgia,serif);font-weight:700;font-size:1.02rem;line-height:1.3;display:flex;gap:.5rem;justify-content:space-between}",
    ".in-qt .in-chev{font-family:var(--font-body,system-ui,sans-serif);color:var(--color-text-muted,#6E6A63);font-size:.85rem;flex:none;transition:transform .2s}",
    ".in-q.open .in-qt .in-chev{transform:rotate(180deg)}",
    ".in-cov{font-size:var(--t-meta,.8rem);color:var(--color-text-secondary,#5A5751);margin-top:.15rem}",
    ".in-mini{display:flex;height:6px;border-radius:3px;overflow:hidden;margin-top:.45rem;background:" + NONE + "}",
    ".in-mini span{height:100%}",
    ".in-q.sparse .in-qt{color:var(--color-text-secondary,#5A5751)}",
    ".in-qbody{padding:0 .8rem .75rem}",
    ".in-ans{display:grid;grid-template-columns:1fr auto;gap:.1rem .6rem;text-align:left;background:none;border:none;border-radius:var(--radius-md,.25rem);padding:.4rem .45rem;margin:0 -.45rem;width:calc(100% + .9rem);font:inherit;color:inherit;cursor:pointer}",
    ".in-ans:hover{background:var(--color-surface-alt,#F0EDE4)}",
    ".in-ans.on{background:var(--color-marigold-tint,rgba(233,162,55,.16))}",
    ".in-ans.dim{opacity:.45}",
    ".in-ans .in-nm{font-weight:700;display:flex;align-items:center;gap:.4rem}",
    ".in-sw{width:10px;height:10px;border-radius:50%;flex:none;display:inline-block}",
    ".in-ans .in-ct{font-weight:700;font-variant-numeric:tabular-nums;text-align:right}",
    ".in-ans .in-ct small{font-weight:400;color:var(--color-text-muted,#6E6A63);font-size:inherit}",
    ".in-ans .in-bar{grid-column:1 / -1;height:8px;border-radius:4px;background:var(--color-surface-alt,#F0EDE4);overflow:hidden}",
    ".in-ans .in-bar span{display:block;height:100%;border-radius:4px}",
    ".in-ans .in-def{grid-column:1 / -1;font-size:var(--t-meta,.8rem);color:var(--color-text-muted,#6E6A63);line-height:1.35}",
    ".in-ans.none .in-nm{font-weight:600;color:var(--color-text-secondary,#5A5751)}",
    ".in-caveat{font-size:var(--t-meta,.8rem);color:var(--color-text-secondary,#5A5751);background:var(--color-surface-alt,#F0EDE4);border-radius:var(--radius-md,.25rem);padding:.45rem .6rem;margin:.6rem 0 0}",
    ".in-caveat.warn{background:var(--color-marigold-tint,rgba(233,162,55,.16))}",
    ".in-cmprow{display:flex;align-items:center;gap:.5rem;margin-top:.7rem;font-size:var(--t-meta,.8rem);color:var(--color-text-secondary,#5A5751)}",
    ".in-cmprow select{font:inherit;font-size:var(--t-meta,.8rem);border:1px solid var(--color-border,rgba(36,33,29,.18));border-radius:var(--radius-md,.25rem);padding:.2rem .5rem;background:var(--color-surface,#FDFCF8);max-width:230px;min-width:0;color:inherit}",
    ".in-cmp{margin-top:.6rem}",
    ".in-cmp .in-lg{display:flex;flex-wrap:wrap;gap:.2rem .7rem;font-size:var(--t-meta,.8rem);margin:.2rem 0 .5rem}",
    ".in-cmp .in-lg span{display:inline-flex;align-items:center;gap:.3rem}",
    ".in-cmp .in-lg i{width:9px;height:9px;border-radius:2px;display:inline-block}",
    ".in-crow{margin-bottom:.45rem}",
    ".in-crow .in-cl{font-size:var(--t-meta,.8rem);font-weight:700;display:flex;justify-content:space-between}",
    ".in-crow .in-cl small{font-weight:400;color:var(--color-text-muted,#6E6A63);font-size:inherit}",
    ".in-cbar{display:flex;height:18px;border-radius:3px;overflow:hidden;gap:1px;background:var(--color-surface,#FDFCF8)}",
    ".in-cbar button{border:none;padding:0;height:100%;font:inherit;font-size:.68rem;font-weight:700;color:#fff;min-width:0;overflow:hidden;cursor:pointer}",
    ".in-cbar button.on{outline:2px solid #24211D;outline-offset:-2px}",
    ".in-from{font-size:var(--t-meta,.8rem);color:var(--color-text-secondary,#5A5751)}",
    ".in-from q{font-style:italic;font-family:var(--font-display,Georgia,serif);font-weight:400;quotes:\"\\201C\" \"\\201D\"}",
    ".in-plist{margin-top:.7rem;border-top:1px solid var(--color-divider,rgba(36,33,29,.10));padding-top:.5rem}",
    ".in-plist .in-ph{display:flex;justify-content:space-between;align-items:baseline;gap:.5rem;font-size:var(--t-meta,.8rem);color:var(--color-text-secondary,#5A5751);margin-bottom:.2rem}",
    ".in-plist .in-ph button{white-space:nowrap;background:none;border:none;padding:0;font:inherit;color:var(--color-sindoor-deep,#9E3220);font-weight:700;font-size:var(--t-meta,.8rem);cursor:pointer}",
    ".in-prow{display:block;width:100%;text-align:left;background:none;border:none;border-bottom:1px solid var(--color-divider,rgba(36,33,29,.10));padding:.4rem 0;font:inherit;color:inherit;cursor:pointer}",
    ".in-prow:hover .in-rn{text-decoration:underline}",
    // the place whose card is open (25 Oct 2026)
    ".in-prow.in-open{background:var(--color-marigold-tint,rgba(233,162,55,.16))}",
    ".in-rn{font-weight:600;line-height:1.25}",
    ".in-more{background:none;border:none;color:var(--color-text-secondary,#5A5751);font:inherit;font-size:var(--t-meta,.8rem);padding:.4rem 0;font-weight:700;cursor:pointer}",
    ".in-panel button:focus-visible,.in-panel select:focus-visible,.in-chips button:focus-visible{outline:2px solid var(--color-leaf,#2A6B41);outline-offset:2px}",
    // the map's chips: what colours the map, and what it is showing
    ".atlas-stage>.in-chips{position:absolute;z-index:4;top:12px;left:calc(var(--in-left,24px));right:64px;display:flex;gap:.4rem;flex-wrap:wrap;pointer-events:none}",
    ".in-chips>*{pointer-events:auto}",
    ".in-chip{display:inline-flex;align-items:center;gap:.4rem;background:var(--color-surface,#FDFCF8);border:1px solid var(--color-border,rgba(36,33,29,.18));border-radius:var(--radius-md,.25rem);padding:.28rem .75rem;font-size:var(--t-meta,.8rem);font-weight:600;box-shadow:0 1px 3px rgba(36,33,29,.1);max-width:100%;color:var(--color-text-primary,#24211D)}",
    ".in-chip .in-chip-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}",
    ".in-chip button{background:none;border:none;padding:0 0 0 .2rem;font:inherit;font-weight:700;font-size:1rem;line-height:1;color:var(--color-text-muted,#6E6A63);cursor:pointer;min-width:24px;min-height:24px}",
    // a wide screen: clear of the layers button and of a place's card docked at the right
    "@media (min-width:721px){.atlas-stage>.in-chips{right:auto;max-width:calc(100% - var(--in-left,24px) - 420px)}}",
    "@media (max-width:720px){.atlas-stage>.in-chips{left:10px;right:56px;top:auto;bottom:calc(var(--sheet-h,0px) + 10px)}.in-chip{font-size:.75rem;padding:.22rem .6rem}" +
      "body:has(#atlas-panel[data-h=\"full\"]) .atlas-stage>.in-chips{display:none}}",
    // a place with no answer to the open question: a hollow grey pin
    ".atlas-pin.loc.in-hollow .pin-body path{fill:#FDFCF8;stroke:" + HOLLOW + ";stroke-width:2.5}",
    ".atlas-pin.loc.in-hollow .pin-heart circle{fill:" + HOLLOW + "}",
    // the place's card
    ".in-card .in-pa{padding:.4rem 0;border-top:1px solid var(--color-divider,rgba(36,33,29,.10));font-size:var(--t-ui,.9rem)}",
    ".in-card .in-pa .in-ql{font-size:var(--t-meta,.8rem);color:var(--color-text-muted,#6E6A63)}",
    ".in-card .in-pa .in-an{font-weight:700;display:flex;align-items:center;gap:.4rem}",
    ".in-card .in-pa .in-an .in-sw{width:9px;height:9px}",
    ".in-card .in-pa.cur{background:var(--color-marigold-tint,rgba(233,162,55,.16));margin:0 -.6rem;padding:.4rem .6rem;border-radius:var(--radius-md,.25rem)}",
    ".in-card .in-answers{margin:.5rem 0 .4rem}",
  ].join("\n");

  function viewer(mode, api) {
    var esc = api.esc, el = api.el;
    var srcLayer = null, X = null, titleProp = "name";
    var state = { ready: false, tab: null, open: null, filter: null, cmp: null, showAll: false, box: null, chips: null };

    /* the row whose card is open keeps a Marigold wash until the card closes
       (atlas.js says which place's card is open: "atlas:card") */
    var openF = null;
    function sameF(a, b) { return !!a && !!b && (a === b || (!!a.properties && a.properties === b.properties)); }
    function markOpen() {
      if (typeof document === "undefined" || !document.querySelectorAll) return;
      Array.prototype.forEach.call(document.querySelectorAll(".in-prow"), function (r) {
        var f = feats()[+r.getAttribute("data-i")];
        if (r.classList) r.classList.toggle("in-open", sameF(f, openF));
      });
    }
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("atlas:card", function (e) { openF = (e && e.detail && e.detail.feature) || null; markOpen(); });
    }
    var cache = null, sCache, pollT = null;
    // the questions on show and the story's checked quotes are worked out once per change
    function forget() { cache = null; sCache = undefined; }
    function Story() {
      if (sCache === undefined) sCache = storyToShow(mode, srcLayer, feats(), Q().cols);
      return sCache;
    }

    function layers(list) {
      srcLayer = list.filter(function (L) { return L.id === mode.layer; })[0] ||
        list.filter(function (L) { return L.userLayer && L.type === "marker" && L.keyLabels; })[0] ||
        list.filter(function (L) { return L.userLayer && L.type === "marker"; })[0] || null;
      if (!srcLayer) return null;
      titleProp = (srcLayer.popup && srcLayer.popup.title) || (srcLayer.label_text && srcLayer.label_text.property) || "name";
      X = {};
      for (var k in srcLayer) X[k] = srcLayer[k];
      X.default = true; X._visible = true;
      X._ev = { insight: true };
      return list.map(function (L) { return L === srcLayer ? X : L; });
    }
    function feats() { return (X && (api.data(X.id) || {}).features) || []; }
    function entries() { return (X && api.markers(X.id)) || []; }
    function nameOf(f) {
      var p = (f && f.properties) || {};
      return String(p[titleProp] || p.loka_name || p.name || "").trim() || "A place";
    }
    // the questions on show, worked out once per change
    function Q() {
      if (cache) return cache;
      var list = shownStats(srcLayer, feats(), mode);
      var byCol = {};
      list.forEach(function (st) { byCol[st.col] = st; });
      cache = { list: list, byCol: byCol, cols: list.map(function (st) { return st.col; }) };
      return cache;
    }
    function firstOpen() {
      var l = Q().list;
      var main = l.filter(function (st) { return !st.sparse; })[0];
      return (main || l[0] || {}).col || null;
    }
    function matches(p) {
      var f = state.filter;
      if (!f) return true;
      var a = keyOf(p, f.col);
      if (f.ans === null ? a !== "" : a !== f.ans) return false;
      if (f.col2 && keyOf(p, f.col2) !== f.ans2) return false;
      return true;
    }

    /* ---- the map ---- */
    function pinEl(L, f) {
      if (!L || !L._ev || !L._ev.insight) return null;
      var st = state.open && Q().byCol[state.open];
      if (!st) return api.locPinEl(PLAIN_PIN, null);
      var c = colourOf(st, f && f.properties);
      if (c) return api.locPinEl(c, null);
      var pin = api.locPinEl(HOLLOW, null);
      pin.classList.add("in-hollow");
      return pin;
    }
    function repaint() {
      entries().forEach(function (e) {
        var old = e.node && e.node.querySelector && e.node.querySelector(".atlas-pin");
        var pin = old && pinEl(X, e.f);
        if (pin && old.parentNode) old.parentNode.replaceChild(pin, old);
      });
    }
    function apply() {
      entries().forEach(function (e) { e.subOff = !matches((e.f && e.f.properties) || {}); });
      if (X) api.setLayerVisible(X, true);
    }
    function chipsHTML() {
      var st = state.open && Q().byCol[state.open];
      if (!st) return '<span class="in-chip"><span class="in-chip-t">Open a question to colour the map</span></span>';
      var h = '<span class="in-chip"><span class="in-chip-t">Coloured by: ' + escText(st.question) + "</span></span>";
      var f = state.filter;
      if (f) {
        var fs = Q().byCol[f.col], a = fs && fs.answers.filter(function (x) { return x.key === f.ans; })[0];
        var n = feats().filter(function (x) { return matches(x.properties || {}); }).length;
        var b = f.col2 && Q().byCol[f.col2] && Q().byCol[f.col2].answers.filter(function (x) { return x.key === f.ans2; })[0];
        var lab = f.ans === null ? "Doesn\u2019t say" : a ? a.name : f.ans;
        h += '<span class="in-chip"><span class="in-sw" style="background:' + (f.ans === null ? NONE : a ? a.color : NONE) + '"></span><span class="in-chip-t">' +
          escText(lab) + (b ? " + " + escText(b.name) : "") + " \u00b7 " + n + " " + placesWord(n) + '</span><button type="button" data-in="clear" aria-label="Show all places">\u00d7</button></span>';
      }
      return h;
    }
    function renderChips() {
      if (typeof document === "undefined") return;
      var stage = document.querySelector(".atlas-stage");
      if (!stage) return;
      if (!state.chips) {
        state.chips = el("div", "in-chips");
        state.chips.setAttribute("aria-live", "polite");
        state.chips.addEventListener("click", onClick);
      }
      if (state.chips.parentNode !== stage) stage.appendChild(state.chips);
      // clear of the side panel on a wide screen
      var panel = document.getElementById("atlas-panel");
      if (panel && !api.onPhone()) {
        var sr = stage.getBoundingClientRect(), pr = panel.getBoundingClientRect();
        var left = pr.right > sr.left && pr.left < sr.left + sr.width / 2 ? Math.round(pr.right - sr.left + 12) : 12;
        stage.style.setProperty("--in-left", left + "px");
      }
      state.chips.innerHTML = state.ready ? chipsHTML() : "";
    }

    /* ---- the place's card ---- */
    function photoHTML(props) {
      if (props.photo_file && api.dataUrl) return api.shotsHTML([api.dataUrl(String(props.photo_file))]);
      return api.shotsHTML(api.linksIn(props.photo_urls || props.photo_1_url || props.image_urls));
    }
    function whyOf(props, col) { return answerOf(props, col + "_why"); }
    function cardHTML(L, props, f) {
      if (!L || !L._ev || !L._ev.insight) return null;
      var list = Q().list;
      var hasIt = list.filter(function (st) { return keyOf(props, st.col); });
      var not = list.filter(function (st) { return !keyOf(props, st.col); });
      hasIt.sort(function (a, b) { return (b.col === state.open) - (a.col === state.open); });
      var h = '<div class="pop ev-card in-card">';
      h += '<div class="pop-title">' + esc(nameOf(f || { properties: props })) + "</div>";
      h += photoHTML(props);
      if (props.description) h += '<p class="pop-caption">' + esc(api.cellShown(props.description)) + "</p>";
      h += '<div class="in-answers">';
      if (!hasIt.length) h += '<div class="in-from">This place says too little to answer any of the questions.</div>';
      hasIt.forEach(function (st) {
        var a = answerOf(props, st.col), c = colourOf(st, props) || NONE, w = whyOf(props, st.col);
        h += '<div class="in-pa' + (st.col === state.open ? " cur" : "") + '"><div class="in-ql">' + escText(st.question) + "</div>" +
          '<div class="in-an"><span class="in-sw" style="background:' + c + '"></span>' + escText(a) + "</div>" +
          (w ? '<div class="in-from">Read from: <q>' + escText(w) + "</q></div>" : "") + "</div>";
      });
      if (hasIt.length && not.length) h += '<div class="in-pa"><div class="in-from">Doesn\u2019t say: ' +
        not.map(function (st) { return escText(st.noun || st.question); }).join(" \u00b7 ") + "</div></div>";
      h += "</div>";
      if (props.address) h += '<p class="ev-addr">' + esc(api.cellShown(props.address)) + "</p>";
      if (api.navLinkHTML) h += api.navLinkHTML(props, f);
      if (api.lokaLinkHTML) h += api.lokaLinkHTML(srcLayer || L, props);
      return h + "</div>";
    }

    /* ---- the panel ---- */
    /* ---- the tabs ---- */
    function tabList() {
      if (!state.ready) return [];
      var x = viewer.extraTab;
      return panelTabs(mode, Q().cols, x && !(x.hidden && x.hidden()) ? x : null, Story());
    }
    function curTab(list) {
      list = list || tabList();
      if (!list.length) return "q";
      return list.some(function (t) { return t.key === state.tab; }) ? state.tab : list[0].key;
    }
    function showTab(k) {
      state.tab = k;
      renderPanel();
      if (typeof document === "undefined") return;
      var box = state.box, sc = box && box.closest && box.closest(".sheet-body"), ctl = document.getElementById("atlas-controls");
      if (sc) sc.scrollTop = 0;
      if (ctl) ctl.scrollTop = 0;
    }
    function onTab(e) {
      var t = e.target && e.target.closest && e.target.closest("[data-tab]");
      if (!t) return;
      var panel = document.getElementById("atlas-panel");
      // a folded wide panel opens as it always did; otherwise the head's own tap (fold, or the sheet's flip) waits
      if (!(panel && panel.classList.contains("collapsed") && !api.onPhone())) e.stopPropagation();
      if (api.onPhone() && panel && panel.getAttribute("data-h") === "peek" && api.setSheet) api.setSheet("full");
      showTab(t.getAttribute("data-tab"));
    }
    /* The tab row sits in the head where its word ("Patterns") stood. Drawn
       again only when the tabs themselves change, so a tab keeps its focus. */
    function renderTabs() {
      if (typeof document === "undefined") return;
      var head = document.querySelector("#atlas-panel .panel-head"), who = head && head.querySelector(".sheet-who");
      var list = tabList(), cur = curTab(list), row = who && who.querySelector(".in-tabs");
      if (who && !list.length) {
        if (row) row.parentNode.removeChild(row);
        head.classList.remove("in-tabbed");
      } else if (who) {
        var sig = list.map(function (t) { return t.key + ":" + t.label; }).join("|");
        if (!row) {
          row = el("div", "in-tabs");
          row.setAttribute("role", "tablist");
          row.setAttribute("aria-label", "What the panel shows");
          row.addEventListener("click", onTab);
          who.insertBefore(row, who.firstChild);
        }
        if (row._sig !== sig) {
          row._sig = sig;
          row.innerHTML = list.map(function (t) {
            return '<button type="button" role="tab" class="in-tab" data-tab="' + escAttr(t.key) + '">' +
              (t.short ? '<span class="in-tl">' + escText(t.label) + '</span><span class="in-ts">' + escText(t.short) + "</span>" : escText(t.label)) + "</button>";
          }).join("");
        }
        Array.prototype.forEach.call(row.querySelectorAll(".in-tab"), function (b) {
          var on = b.getAttribute("data-tab") === cur;
          b.classList.toggle("on", on);
          b.setAttribute("aria-selected", String(on));
        });
        head.classList.add("in-tabbed");
        // a tab gives way to its short name only where the row does not fit (a phone)
        row.classList.remove("in-short");
        if (row.clientWidth && row.scrollWidth > row.clientWidth + 1) row.classList.add("in-short");
      }
      var x = viewer.extraTab;
      if (x && x.show) x.show(cur === x.key);
    }

    /* ---- the panel ---- */
    /* "Story of the place in their own words": the top of the one Insights panel. Nothing to say
       — turned off, nothing written, nothing being written — and it is not
       there at all, heading and all: the questions stand alone. */
    function voiceHTML() {
      var shown = Story();
      if (shown) return storyCardHTML(shown);
      /* An atlas whose story has nothing in it yet — none written, or one
         that found nothing to say — goes on showing the summary it has. The
         server takes the summary away the moment a story stands in its place. */
      var sents = mode.summaryOn === false ? [] : visibleSentences(mode.summary, Q().cols);
      if (sents.length) {
        return '<section class="in-sum" aria-label="Story of the place in their own words">' + voiceHead() +
          sents.map(function (s) { return '<p class="in-s">' + sentenceHTML(s.text) + "</p>"; }).join("") +
          '<div class="in-by">Written by AI from the answers to the questions, when the atlas was last updated. Numbers count places, not people.</div></section>';
      }
      if (isPending(mode)) {
        return '<section class="in-sum" aria-live="polite" aria-label="Story of the place in their own words">' + voiceHead() + '<div class="in-writing">' +
          '<div class="in-lines" aria-hidden="true"><i></i><i></i><i></i></div><p>LOKA is reading what people wrote about these ' + feats().length +
          " places, to say what they are saying. This takes a minute or two. The questions are below.</p></div></section>";
      }
      return "";
    }
    function questionHTML(st) {
      var open = state.open === st.col;
      var mini = st.answers.map(function (a) { return '<span style="width:' + (100 * a.count / (st.total || 1)) + "%;background:" + a.color + '"></span>'; }).join("");
      var h = '<div class="in-q' + (open ? " open" : "") + (st.sparse ? " sparse" : "") + '"><button type="button" class="in-qhead" data-in="open" data-col="' + escAttr(st.col) +
        '" aria-expanded="' + open + '"><span class="in-qt"><span>' + escText(st.question) + '</span><span class="in-chev" aria-hidden="true">\u25be</span></span>' +
        '<span class="in-cov" style="display:block">' + coverWords(st) + "</span>" + (open ? "" : '<span class="in-mini" aria-hidden="true">' + mini + "</span>") + "</button>";
      if (!open) return h + "</div>";
      var max = Math.max.apply(null, st.answers.map(function (a) { return a.count; }).concat([1]));
      var f = state.filter && state.filter.col === st.col && !state.filter.col2 ? state.filter : null;
      h += '<div class="in-qbody">';
      st.answers.forEach(function (a) {
        var on = !!f && f.ans === a.key, dim = !!f && !on;
        h += '<button type="button" class="in-ans' + (on ? " on" : "") + (dim ? " dim" : "") + '" data-in="ans" data-col="' + escAttr(st.col) + '" data-a="' + escAttr(a.key) + '" aria-pressed="' + on + '">' +
          '<span class="in-nm"><span class="in-sw" style="background:' + a.color + '"></span>' + escText(a.name) + "</span>" +
          '<span class="in-ct">' + a.count + " <small>" + placesWord(a.count) + "</small></span>" +
          '<span class="in-bar"><span style="width:' + (100 * a.count / max) + "%;background:" + a.color + '"></span></span>' +
          (a.definition ? '<span class="in-def">' + escText(a.definition) + "</span>" : "") + "</button>";
      });
      if (st.none) {
        var on0 = !!f && f.ans === null, dim0 = !!f && !on0;
        h += '<button type="button" class="in-ans none' + (on0 ? " on" : "") + (dim0 ? " dim" : "") + '" data-in="ans" data-col="' + escAttr(st.col) + '" data-a="" aria-pressed="' + on0 + '">' +
          '<span class="in-nm"><span class="in-sw" style="background:' + NONE + '"></span>Doesn\u2019t say</span><span class="in-ct">' + st.none + " <small>" + placesWord(st.none) + "</small></span></button>";
      }
      h += st.sparse
        ? '<p class="in-caveat warn">So few places answer this that it is a hint, not a pattern. Each place shows the words its answer was read from.</p>'
        : '<p class="in-caveat">LOKA read these answers from what people wrote when they tagged each place. Tap a place to see the words each answer came from.</p>';
      var opts = compareOptions(Q().list, feats(), st.col);
      if (opts.length) {
        var sid = "in-cmp-" + st.col;
        h += '<div class="in-cmprow"><label for="' + escAttr(sid) + '">Compare with</label><select id="' + escAttr(sid) + '" data-in="cmp"><option value="">another question\u2026</option>' +
          opts.map(function (o) { return '<option value="' + escAttr(o.st.col) + '"' + (state.cmp === o.st.col ? " selected" : "") + ">" + escText(o.st.question) + "</option>"; }).join("") + "</select></div>";
        var pick = opts.filter(function (o) { return o.st.col === state.cmp; })[0];
        if (pick) h += compareHTML(st, pick.st, pick.both);
      }
      h += listHTML(st);
      return h + "</div></div>";
    }
    function compareHTML(sa, sb, both) {
      var h = '<div class="in-cmp"><div class="in-from">The ' + both + " places that answer both. Each row is one answer above, split by " + escText(sb.noun || sb.question) +
        ". Tap a slice to show those places.</div>" + '<div class="in-lg">' +
        sb.answers.map(function (a) { return '<span><i style="background:' + a.color + '"></i>' + escText(a.name) + "</span>"; }).join("") + "</div>";
      crossTable(feats(), sa, sb).forEach(function (r) {
        h += '<div class="in-crow"><div class="in-cl"><span>' + escText(r.answer) + "</span><small>" + r.count + " " + placesWord(r.count) + '</small></div><div class="in-cbar">';
        r.cells.forEach(function (c) {
          var f = state.filter, on = !!f && f.col2 === sb.col && f.ans === r.key && f.ans2 === c.key;
          h += '<button type="button" class="' + (on ? "on" : "") + '" style="flex:' + c.count + ";background:" + c.color + '" data-in="slice" data-col="' + escAttr(sa.col) +
            '" data-a="' + escAttr(r.key) + '" data-col2="' + escAttr(sb.col) + '" data-a2="' + escAttr(c.key) + '" title="' + c.count + " " + escAttr(r.answer) + ": " + escAttr(c.answer) +
            '" aria-label="' + c.count + " " + placesWord(c.count) + ": " + escAttr(r.answer) + " and " + escAttr(c.answer) + '" aria-pressed="' + on + '">' + (c.count >= 3 ? c.count : "") + "</button>";
        });
        h += "</div></div>";
      });
      return h + "</div>";
    }
    function listHTML(st) {
      var f = state.filter;
      if (!f || f.col !== st.col) return "";
      var all = feats(), idx = [];
      all.forEach(function (x, i) { if (matches(x.properties || {})) idx.push(i); });
      var lim = state.showAll ? idx.length : 8;
      var a = st.answers.filter(function (x) { return x.key === f.ans; })[0];
      var b = f.col2 && Q().byCol[f.col2] && Q().byCol[f.col2].answers.filter(function (x) { return x.key === f.ans2; })[0];
      var h = '<div class="in-plist"><div class="in-ph"><span>' + idx.length + " " + placesWord(idx.length) + ": " +
        escText(f.ans === null ? "doesn\u2019t say" : a ? a.name : f.ans) + (b ? " and " + escText(b.name) : "") +
        '</span><button type="button" data-in="clear">Show all</button></div>';
      idx.slice(0, lim).forEach(function (i) {
        var p = all[i].properties || {}, w = whyOf(p, st.col);
        h += '<button type="button" class="in-prow' + (sameF(all[i], openF) ? " in-open" : "") + '" data-in="place" data-i="' + i + '"><div class="in-rn">' + escText(nameOf(all[i])) + "</div>" +
          (w ? '<div class="in-from">Read from: <q>' + escText(w) + "</q></div>" : "") + "</button>";
      });
      if (idx.length > lim) h += '<button type="button" class="in-more" data-in="more">Show all ' + idx.length + "</button>";
      return h + "</div>";
    }
    function panelHTML() {
      if (!state.ready) return '<p class="ev-hint">' + (typeof window !== "undefined" && window.LokaWait ? window.LokaWait.html("Loading the places\u2026") : "Loading the places\u2026") + "</p>";
      var voice = voiceHTML();
      var list = Q().list;
      if (!list.length) return voice || '<p class="in-hint">No questions to show yet.</p>';
      var main = list.filter(function (st) { return !st.sparse; }), few = list.filter(function (st) { return st.sparse; });
      var h = voice + '<div class="in-sect"><span class="in-stamp">The questions</span><span class="in-cov">' + list.length + " asked of every place</span></div>" +
        '<p class="in-hint">Open a question to colour the map by its answers. Tap an answer to see only those places.</p>';
      h += main.map(questionHTML).join("");
      if (few.length) h += '<div class="in-sect" style="margin-top:1rem"><span class="in-stamp">Said by only a few places</span></div>' + few.map(questionHTML).join("");
      return h;
    }
    function renderPanel() {
      syncHead();
      renderChips();
      var box = state.box;
      if (!box) return;
      var sc = box.closest && box.closest(".sheet-body");
      var top = sc ? sc.scrollTop : 0;
      box.innerHTML = panelHTML();
      if (sc) sc.scrollTop = top;
    }
    function sheetHead() {
      if (!state.ready) return { label: "Insights", small: "" };
      var n = feats().filter(function (x) { return matches(x.properties || {}); }).length;
      return { label: "Insights", small: n + " " + placesWord(n) };
    }
    function syncHead() {
      if (typeof document === "undefined") return;
      renderTabs();
      var sh = sheetHead();
      var head = document.querySelector("#atlas-panel .sheet-who strong");
      if (head) head.textContent = sh.label;
      var who = document.getElementById("sheet-layer");
      if (who) { who.innerHTML = ""; who.appendChild(el("span", "sheet-layer-name", esc(sh.small || sh.label))); }
    }

    /* ---- what a visitor does ---- */
    function changed(repin, fit) {
      if (repin) repaint();
      apply();
      renderPanel();
      // an answer or a slice chosen: the map goes to its places
      if (fit && state.filter && api.fitPoints) {
        var pts = feats().filter(function (x) { return matches(x.properties || {}) && x.geometry && x.geometry.coordinates; })
          .map(function (x) { return x.geometry.coordinates; });
        if (pts.length) api.fitPoints(pts);
      }
    }
    function onClick(e) {
      var t = e.target && e.target.closest && e.target.closest("[data-in]");
      if (!t || t.tagName === "SELECT") return;
      var d = t.getAttribute("data-in"), col = t.getAttribute("data-col");
      if (d === "open") {
        state.open = state.open === col ? null : col;
        state.filter = null; state.cmp = null; state.showAll = false;
        changed(true);
        return;
      }
      if (d === "ans") {
        var ans = t.getAttribute("data-a") || null;
        var same = state.filter && !state.filter.col2 && state.filter.col === col && state.filter.ans === ans;
        state.filter = same ? null : { col: col, ans: ans };
        state.showAll = false;
        changed(false, true);
        return;
      }
      if (d === "slice") {
        var a1 = t.getAttribute("data-a"), c2 = t.getAttribute("data-col2"), a2 = t.getAttribute("data-a2");
        var f = state.filter, same2 = f && f.col2 === c2 && f.ans === a1 && f.ans2 === a2;
        state.filter = same2 ? null : { col: col, ans: a1, col2: c2, ans2: a2 };
        state.showAll = false;
        changed(false, true);
        return;
      }
      if (d === "clear") { state.filter = null; state.showAll = false; changed(false); return; }
      if (d === "more") { state.showAll = true; renderPanel(); return; }
      if (d === "place") {
        var fe = feats()[+t.getAttribute("data-i")];
        if (fe) api.openPlace(X, fe);
      }
    }
    function onChange(e) {
      var s = e.target;
      if (!s || s.getAttribute("data-in") !== "cmp") return;
      state.cmp = s.value || null;
      if (state.filter && state.filter.col2) { state.filter = null; apply(); }
      renderPanel();
    }

    function injectStyle(doc) {
      if (!doc || doc.getElementById("in-style")) return;
      var s = doc.createElement("style");
      s.id = "in-style";
      s.textContent = CSS;
      (doc.head || doc.documentElement).appendChild(s);
    }
    function buildPanel(panel) {
      injectStyle(document);
      // no buttons row in Insight: anything another mode left goes
      Array.prototype.forEach.call(document.querySelectorAll(".ev-chips,.ev-subchips"), function (old) {
        if (old.parentNode) old.parentNode.removeChild(old);
      });
      var stage = document.querySelector(".atlas-stage");
      if (stage) { stage.classList.remove("ev-on"); stage.classList.remove("ex-on"); stage.classList.add("in-on"); }
      var sec = el("section", "ctl-group ev-group in-panel");
      sec.setAttribute("data-group", "insight");
      sec.setAttribute("data-group-label", "Insights");
      var box = el("div", "in-wrap");
      box.addEventListener("click", onClick);
      box.addEventListener("change", onChange);
      sec.appendChild(box);
      panel.appendChild(sec);
      state.box = box;
      renderPanel();
      var back = document.getElementById("sheet-card-back");
      if (back && back.lastChild && back.lastChild.nodeType === 3) back.lastChild.nodeValue = "Insights";
      if (back) back.setAttribute("aria-label", "Back to the questions");
    }

    /* While the server writes the summary the card says so; the page asks
       for the overlay again now and then, and shows the summary once it is
       there (about a minute; it stops asking after five). */
    function pollSummary() {
      if (pollT || typeof fetch === "undefined" || !api.dataUrl) return;
      if (mode.summaryOn === false || !isPending(mode)) return;
      var tries = 0, MAX_TRIES = 70;   // every 6 seconds, seven minutes at most (as PENDING_STALE_MS)
      function stop(giveUp) {
        clearInterval(pollT); pollT = null;
        if (giveUp) { delete mode.summaryPending; delete mode.summaryPendingAt; renderPanel(); }
      }
      pollT = setInterval(function () {
        tries++;
        if (tries > MAX_TRIES) { stop(true); return; }
        fetch(api.dataUrl("manifest.local.json"), { cache: "no-store" })
          .then(function (r) { if (!r.ok) throw new Error("not there"); return r.json(); })
          .then(function (local) {
            if (!pollT) return;
            var m = local && local.mode;
            if (!m || m.name !== "insight") { stop(true); return; }
            if (isPending(m)) return;
            stop(false);
            mode.summary = m.summary || null;
            if ("story" in m) mode.story = m.story; else delete mode.story;
            delete mode.summaryPending; delete mode.summaryPendingAt;
            forget();
            renderPanel();
          })
          .catch(function () { if (pollT) stop(true); });
      }, 6000);
    }

    /* The owner's Settings tab (owner-modes.js) hands over the mode as the
       server saved it: the panel and the map follow at once. */
    function setMode(m) {
      if (!m || typeof m !== "object") return;
      Object.keys(mode).forEach(function (k) { if (!(k in m)) delete mode[k]; });
      Object.keys(m).forEach(function (k) { mode[k] = m[k]; });
      forget();
      if (!state.ready) return;
      if (state.open && !Q().byCol[state.open]) { state.open = firstOpen(); state.filter = null; state.cmp = null; }
      if (state.filter && (!Q().byCol[state.filter.col] || (state.filter.col2 && !Q().byCol[state.filter.col2]))) state.filter = null;
      if (state.cmp && !Q().byCol[state.cmp]) state.cmp = null;
      changed(true);
      pollSummary();
    }

    var me = {
      insight: true,
      layers: layers,
      pinEl: pinEl,
      cardHTML: cardHTML,
      buildPanel: buildPanel,
      ready: function () {
        state.ready = true;
        forget();
        if (!state.open) state.open = firstOpen();
        changed(true);
        if (api.onMoveEnd) api.onMoveEnd(function () { renderChips(); });
        if (typeof window !== "undefined" && !viewer._resizeWired) {
          viewer._resizeWired = true;
          window.addEventListener("resize", function () { if (viewer._current) { viewer._current.renderTabs(); viewer._current.renderChips(); } });
        }
        pollSummary();
      },
      framed: function () { return X ? [X.id] : []; },
      // the map opens on most of the places, a far stray or two left out (as Explore)
      frameBox: function (pts) { return XM && XM.frameBox ? XM.frameBox(pts, 0.92) : null; },
      sheetHead: sheetHead,
      setMode: setMode,
      renderChips: renderChips,
      renderTabs: renderTabs,
      renderPanel: renderPanel,
      state: state,
    };
    viewer._current = me;
    return me;
  }

  return {
    isOn: isOn,
    colsOf: colsOf,
    isPeople: isPeople,
    questionText: questionText,
    answerOf: answerOf,
    stats: stats,
    isSparse: isSparse,
    coverWords: coverWords,
    settingsOf: settingsOf,
    shownStats: shownStats,
    canInsight: canInsight,
    bothCount: bothCount,
    canCompare: canCompare,
    compareOptions: compareOptions,
    crossTable: crossTable,
    defaultInsight: defaultInsight,
    cleanSettings: cleanSettings,
    summaryTables: summaryTables,
    numbersIn: numbersIn,
    checkSentences: checkSentences,
    checkSentencesWithReasons: checkSentencesWithReasons,
    // "Story of the place in their own words" — the story the visitor card shows
    storyDigest: storyDigest,
    offeredById: offeredById,
    placeWords: placeWords,
    placeLabelOf: placeLabelOf,
    quoteFault: quoteFault,
    quoteSourceOf: quoteSourceOf,
    quoteSourcesOf: quoteSourcesOf,
    SHARED_MAX: SHARED_MAX,
    splitSentences: splitSentences,
    peopleValuesOf: peopleValuesOf,
    isPeopleColumn: isPeopleColumn,
    placeIdOf: placeIdOf,
    placeNameOf: placeNameOf,
    foldName: foldName,
    hasWhole: hasWhole,
    QUOTE_MIN: QUOTE_MIN, QUOTE_MAX: QUOTE_MAX,
    STORY_PLACES: STORY_PLACES, STORY_WORDS: STORY_WORDS, STORY_CANDIDATES: STORY_CANDIDATES,
    quoteScore: quoteScore, isPointed: isPointed, POINTED_MIN: POINTED_MIN,
    feelingOf: feelingOf, groupQuotes: groupQuotes, tensionsOf: tensionsOf, thingWords: thingWords, groupOfQuote: groupOfQuote,
    GROUP_MIN: GROUP_MIN, GROUP_MAX: GROUP_MAX, MAX_GROUPS: MAX_GROUPS, STORY_VOICES_MIN: STORY_VOICES_MIN,
    MIN_STORY: MIN_STORY, MAX_STORY: MAX_STORY,
    STORY_CITES_MIN: STORY_CITES_MIN, STORY_CITES_MAX: STORY_CITES_MAX,
    STORY_QUOTES_MIN: STORY_QUOTES_MIN, STORY_QUOTES_MAX: STORY_QUOTES_MAX,
    CSS: CSS,
    visibleSentences: visibleSentences,
    storyToShow: storyToShow,
    storyCardHTML: storyCardHTML,
    panelTabs: panelTabs,
    hasNumberWords: hasNumberWords,
    hasShareWords: hasShareWords,
    hasAmountWords: hasAmountWords,
    isPending: isPending,
    PENDING_STALE_MS: PENDING_STALE_MS,
    sentenceHTML: sentenceHTML,
    PAL: PAL,
    NONE: NONE,
    PEOPLE_REASON: PEOPLE_REASON,
    PEOPLE_REFUSED: PEOPLE_REFUSED,
    NO_QUESTIONS: NO_QUESTIONS,
    FEW_SHARE: FEW_SHARE, FEW_PLACES: FEW_PLACES, CMP_SHARE: CMP_SHARE, CMP_PLACES: CMP_PLACES,
    viewer: viewer,
  };
});
