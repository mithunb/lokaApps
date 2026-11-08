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
  // Research mode's pin: a pure neutral grey, no warm tint, no other colour — the marks beside it carry the colour (Mithun, 7 Nov 2026)
  var RESEARCH_PIN = "#4A4A4A";
  // the grey of the discs' pooled arc (atlas.js DISC_POOL): the key's "Doesn't say" mark wears the same
  var POOL = "#B8B3A9";
  // the few-places shelf: under a quarter of the places, or under 8
  var FEW_SHARE = 0.25, FEW_PLACES = 8;
  // compare two questions only when the places answering both are at least a tenth, and at least 5 (Mithun, 25 Oct 2026)
  var CMP_SHARE = 0.10, CMP_PLACES = 5;
  var PEOPLE_REASON = "Its answers are the names of the people who tagged the places, so LOKA keeps it off the visitor page.";
  var PEOPLE_REFUSED = "That question\u2019s answers are the names of the people who tagged the places, so it stays off the visitor page.";
  var NO_QUESTIONS = "Insight needs the questions LOKA asks of the places. They appear once the atlas has been read.";
  // an atlas LOKA has not read yet shows the layer's own keys, and says what comes once it has
  var NOT_READ_YET = "LOKA has not read these places yet. Its questions, and the story of the place, appear here once it has.";
  // a plain key's value is written on each place under this working name + the column (viewer rawKeys)
  var RAW_COL = "_key:";
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

  /* Every atlas is drawn this way unless its manifest asks for Event or Explore
     (Mithun, 7 Nov 2026: Standard takes in Insight — one mode, "Standard"; a
     manifest that still says "insight" reads the same as one that says nothing,
     no data rewritten). atlas.js still falls back to its own layer list when
     the atlas has no marker layer of places for this panel to draw (layers()). */
  function isOn(manifest) {
    var m = manifest && manifest.mode, n = m && typeof m === "object" ? m.name : null;
    return n !== "event" && n !== "explore";
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
    // a question the owner took off the map from the layer's own fold (hiddenKeys, owner.js) stays off here too
    var hiddenKeys = (layer && layer.hiddenKeys) || [];
    var shown = {};
    order.forEach(function (c) {
      shown[c] = !isPeople(layer, c) && !(mode && mode.shown && mode.shown[c] === false) && hiddenKeys.indexOf(c) < 0;
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
  /* The split bar's partner question for a picked answer: the compare
     option with the most places answering both (Mithun, 7 Nov 2026, "ship
     the split bar first"). null when none qualifies. */
  function bestPair(list, features, col) {
    var opts = compareOptions(list, features, col);
    if (!opts.length) return null;
    return opts.reduce(function (best, x) { return x.both > best.both ? x : best; });
  }
  /* One answer of one question (ansKey, null for "Doesn't say") split by
     a partner question sb's answers, over the places answering both:
     { count, cells: [{ answer, key, color, count }] }. */
  function splitRow(features, col, ansKey, sb) {
    var rows = (features || []).filter(function (f) {
      var p = f && f.properties;
      var k = keyOf(p, col);
      return (ansKey === null ? k === "" : k === ansKey) && keyOf(p, sb.col);
    });
    return {
      count: rows.length,
      cells: sb.answers.map(function (b) {
        return { answer: b.name, key: b.key, color: b.color, count: rows.filter(function (f) { return keyOf(f.properties, sb.col) === b.key; }).length };
      }).filter(function (c) { return c.count > 0; }),
    };
  }
  /* The split bar's one line, in plain text (the caller escapes it). It names
     the picked answer, so it stays true after a slice tap narrows the list
     under the header (review, 7 Nov 2026). ansName null = "Doesn't say".
     total = places with the picked answer; row = splitRow(); q = partner question.
       bar:  "How the 21 places that say X answer “Q”"
             "How 17 of the 21 places that say X answer “Q”"
       one:  every place that answers Q says the same thing — no bar:
             "All 21 places that say X answer “Q” with Y."
             "Of the 21 places that say X, all 5 that answer “Q” say Y."
             "Of the 21 places that say X, the one that answers “Q” says Y." */
  function splitWording(ansName, total, row, q) {
    var one = total === 1;
    var grp = ansName === null
      ? (one ? "the one place with no answer here" : "the " + total + " places with no answer here")
      : (one ? "the one place that says " + ansName : "the " + total + " places that say " + ansName);
    var Q = "“" + q + "”";
    if (row.cells.length === 1) {
      var y = row.cells[0].answer;
      var Grp = grp.charAt(0).toUpperCase() + grp.slice(1);
      if (row.count === total) {
        return { kind: "one", text: (one ? Grp : "All " + grp.slice(4)) + " answer" + (one ? "s " : " ") + Q + " with " + y + "." };
      }
      return { kind: "one", text: "Of " + grp + ", " + (row.count === 1 ? "the one that answers " + Q + " says " : "all " + row.count + " that answer " + Q + " say ") + y + "." };
    }
    return { kind: "bar", text: row.count === total ? "How " + grp + " answer " + Q : "How " + row.count + " of " + grp + " answer " + Q };
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
  var PEOPLE_COL = /^(created_by|creator|creators|author|authors|owner|owners|user|users|username|user_name|tagger|taggers|contributor|contributors|photographer|reporter|observer|recorder|submitter|enumerator|surveyor|volunteer|respondent|email|e_mail|phone|mobile|contact|whatsapp)$/;
  /* Who wrote a quote: the name they post under on LOKA (Mithun, 5 Nov 2026,
     reversing "never a tagger's name on a page" for quotes only). Only a
     display name column — never an id, an email or a phone number — read
     fresh from the place, never stored with the story. */
  /* No names on non-LOKA quotes (Mithun, 8 Nov 2026): credit comes only
     from LOKA's own columns on a LOKA-shaped layer (atlas.js marks one
     _loka; a place with a UUID tag_id and a description is one too), or from
     a column that plainly means the author ("author", "written by") on any
     data — never from an enumerator, a surveyor, a "recorded by" or a
     respondent, who did not write the words. */
  var LOKA_AUTHOR_COLS = ["created_by", "creator", "username", "user_name", "tagged_by", "posted_by"];
  var HOUSE_ACCOUNTS = /^loka\s*finds$/i;
  var UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function lokaShapedPlace(layer, p) {
    if (layer && layer._loka) return true;
    return UUID_ID.test(String(p.tag_id || "").trim()) && ("description" in p);
  }
  function authorColumns(layer, p) {
    var cols = Object.keys(p).filter(function (k) {
      var w = String(k).replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(" ");
      return w === "author" || w === "authors" || w === "written by" || w === "author name";
    });
    return lokaShapedPlace(layer, p) ? LOKA_AUTHOR_COLS.concat(cols) : cols;
  }
  function authorOf(layer, f) {
    if (f === undefined) { f = layer; layer = null; }   // authorOf(f): a place with no layer to ask
    var p = (f && f.properties) || {};
    var cols = authorColumns(layer, p);
    for (var k = 0; k < cols.length; k++) {
      var v = p[cols[k]];
      if (v == null) continue;
      v = String(v).replace(/\s+/g, " ").trim();
      if (!v || v.length > 40) continue;
      if (/@|https?:|www\.|\d{6,}/.test(v)) continue;                     // an email, a link, a phone
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v) || /^[0-9a-f]{20,}$/i.test(v)) continue;   // an id
      // LOKA's own account posts places its super admin curates: credit LOKA, not a feature name (Mithun, 5 Nov 2026)
      if (HOUSE_ACCOUNTS.test(v)) return "From LOKA";
      return v;
    }
    return "";
  }
  /* The one shared rule (label-rules.js isPeopleColumn: a name about a
     person or an id, or values that are emails, phones or ids); the older,
     narrower rule stands in only if that file is not loaded. */
  function isPeopleColumn(name, values) {
    var shared = typeof LokaLabelRules !== "undefined" && LokaLabelRules && LokaLabelRules.isPeopleColumn;
    if (typeof shared === "function") return !!shared(name, values);
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
    /* Only from a column the rule calls people, and only values that look
       like a person — an email, a phone, an id, a display name ("Asha Rao";
       a single "Asha" only from a column strongly named, created_by or
       Enumerator) — never an answer such as "Yes", "Good" or "Piped water". */
    var shared = typeof LokaLabelRules !== "undefined" && LokaLabelRules && typeof LokaLabelRules.isPersonLikeValue === "function" ? LokaLabelRules : null;
    Object.keys(p).forEach(function (k) {
      if (!isPeopleColumn(k, [p[k]])) return;
      if (shared && !shared.isPersonLikeValue(p[k], !!shared.strongNotRead(k))) return;
      pushValue(out, p[k]);
    });
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
      if (c && !NOT_TEXT.test(String(c).toLowerCase()) && !/^pattern_\d+(_why)?$/.test(String(c)) && !isPeopleColumn(c, [p[c]]) && looksFree(p[c])) {
        out.push(String(p[c]).replace(/\s+/g, " ").trim());
      }
    });
    var best = "";
    Object.keys(p).forEach(function (k) {
      if (NOT_TEXT.test(String(k).toLowerCase()) || /^pattern_\d+(_why)?$/.test(k) || isPeopleColumn(k, [p[k]])) return;
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
      if (NOT_TEXT.test(String(k).toLowerCase()) || /^pattern_\d+(_why)?$/.test(k) || isPeopleColumn(k, [p[k]])) return;
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
      held.push({ id: q.id, text: q.text, name: placeLabelOf(layer, f), by: authorOf(layer, f), at: i });
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
      return '<li class="in-fq"><q>' + escText(q.text) + "</q>" + (q.by ? ' <span class="in-by-name">\u2014 ' + escText(q.by) + "</span>" : "") + " " +
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
    var t = [{ key: "q", label: "This map" }];
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

  /* ========= Research mode: shape + colour beside the pin (Mithun, 7 Nov 2026) =========
     Without research mode a question colours the pins alone (only one is ever
     active). With it, up to three questions are "ticked" to show on the map at
     once: the pins turn the atlas's neutral grey ink and each ticked question
     wears its own shape — 1st ticked a circle, 2nd a square, 3rd a triangle —
     beside the pin, in that question's answer colour. The same three shapes
     stand for the map key's blocks and the panel's own rows. */
  var SHAPES = ["circle", "square", "triangle"];
  var SHAPE_HEAD = ["Circles and discs", "Squares", "Triangles"];
  // one small mark, inline, for a key row or a panel answer row (not the map pin,
  // which is built as a real DOM node by atlas.js's api.markRowsEl)
  function markSVG(shape, color) {
    var c = escAttr(color);
    var path = shape === "square" ? "M2.6 2.6h8.8v8.8h-8.8z"
      : shape === "triangle" ? "M7 1.6L12.6 11.4H1.4z" : null;
    return '<svg class="in-mk" viewBox="0 0 14 14" aria-hidden="true">' +
      (path ? '<path d="' + path + '" fill="' + c + '"></path>' : '<circle cx="7" cy="7" r="5.4" fill="' + c + '"></circle>') +
      "</svg>";
  }
  /* A couple of the words an answer was read from, for its ⓘ popover ("the
     existing examples if any"): the first few places' own _why text, each
     shown once. Nothing invented — when no place carries one, the list is
     simply empty and the popover says so with silence, not a placeholder. */
  function answerExamples(features, col, key, max) {
    max = max || 2;
    var seen = {}, out = [];
    (features || []).some(function (f) {
      var p = f && f.properties;
      if (!p || keyOf(p, col) !== (key || "")) return false;
      var w = answerOf(p, col + "_why");
      if (!w || seen[w.toLowerCase()]) return false;
      seen[w.toLowerCase()] = true;
      out.push(w);
      return out.length >= max;
    });
    return out;
  }

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
    ".in-fq q{font:inherit;font-size:.95rem;line-height:1.5;color:var(--color-text,#2A2723);quotes:\"\\201C\" \"\\201D\"}",
    ".in-fq .in-by-name{color:var(--color-text-secondary,#5A5751);font-size:var(--t-meta,.8rem)}",
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
    /* The questions, minimal like the map's key (Mithun, 7 Nov 2026, round 2):
       no box, no card, no large serif heading — a question is a plain small
       bold line with a chevron, a hairline between questions, its answers the
       key's own rows beneath it. */
    ".in-q{margin:0;padding:.1rem 0}",
    ".in-q+.in-q{border-top:1px solid var(--color-divider,rgba(36,33,29,.1))}",
    ".in-qhead{display:block;width:100%;text-align:left;background:none;border:none;padding:.5rem 0;font:inherit;color:inherit;cursor:pointer}",
    ".in-qt{font-weight:600;font-size:var(--t-ui,.9rem);line-height:1.3;display:flex;gap:.5rem;justify-content:space-between}",
    ".in-qt .in-chev{font-family:var(--font-body,system-ui,sans-serif);color:var(--color-text-muted,#6E6A63);font-size:.85rem;flex:none;transition:transform .2s}",
    ".in-q.open .in-qt .in-chev{transform:rotate(180deg)}",
    ".in-cov{font-size:var(--t-meta,.8rem);color:var(--color-text-secondary,#5A5751);margin-top:.15rem}",
    ".in-mini{display:flex;height:6px;border-radius:3px;overflow:hidden;margin-top:.45rem;background:" + NONE + "}",
    ".in-mini span{height:100%}",
    ".in-q.sparse .in-qt{color:var(--color-text-secondary,#5A5751)}",
    // the map status under each question: plain for a closed one, the answers' dots + leaf green for the open one
    ".in-qs{display:flex;align-items:center;gap:.4rem;margin-top:.15rem;font-size:var(--t-meta,.8rem);font-weight:400;color:var(--color-text-muted,#6E6A63)}",
    ".in-qs.on{color:var(--color-leaf,#2A6B41);font-weight:700;font-size:var(--t-ui,.9rem);gap:.35rem}",
    // the question on the map: a quiet leaf-green border round the whole question, its answers inside
    ".in-q.in-on{border:1.5px solid var(--color-leaf,#2A6B41);border-radius:8px;padding:.1rem .75rem .45rem;margin:.4rem 0}",
    ".in-qbody{padding:0 0 .5rem}",
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
    // the split bar under a picked answer's "N places" header (Mithun, 7 Nov 2026)
    ".in-split{margin:0 0 .6rem}",
    ".in-split .in-from{margin-bottom:.3rem}",
    ".in-split .in-lg{display:flex;flex-wrap:wrap;gap:.15rem .7rem;font-size:var(--t-meta,.8rem);margin:.35rem 0 0;color:var(--color-text-secondary,#5A5751)}",
    ".in-split .in-lg span{display:inline-flex;align-items:center;gap:.3rem}",
    ".in-split .in-lg i{width:9px;height:9px;border-radius:2px;display:inline-block;flex:none}",
    ".in-split .in-lg b{font-weight:700;color:var(--color-text-primary,#24211D);font-variant-numeric:tabular-nums}",
    ".in-split-one{font-size:var(--t-meta,.8rem);color:var(--color-text-secondary,#5A5751);margin:0 0 .6rem}",
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
    ".in-live{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}",
    ".in-chip{display:inline-flex;align-items:center;gap:.4rem;background:var(--color-surface,#FDFCF8);border:1px solid var(--color-border,rgba(36,33,29,.18));border-radius:var(--radius-md,.25rem);padding:.28rem .75rem;font-size:var(--t-meta,.8rem);font-weight:600;box-shadow:0 1px 3px rgba(36,33,29,.1);max-width:100%;color:var(--color-text-primary,#24211D)}",
    ".in-chip .in-chip-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}",
    ".in-chip button{background:none;border:none;padding:0 0 0 .2rem;font:inherit;font-weight:700;font-size:1rem;line-height:1;color:var(--color-text-muted,#6E6A63);cursor:pointer;min-width:24px;min-height:24px}",
    /* The "Coloured by" chip is the key (Mithun, 7 Nov 2026): the question on
       top, then one row per answer — its dot, its name, its count — at most
       six, "+ n more" for the rest, and "Doesn't say" when any place is blank.
       Open everywhere; a tap on the question folds it to the one-line chip. */
    ".in-chips{align-items:flex-start}",
    ".in-chip.in-key{display:block;padding:0;max-width:260px}",
    ".in-chip .in-key-h{display:flex;align-items:center;gap:.4rem;width:100%;min-width:0;background:none;border:0;font:inherit;font-weight:600;font-size:inherit;line-height:1.3;color:inherit;text-align:left;padding:.28rem .75rem;cursor:pointer}",
    ".in-chip .in-key-h .in-chip-t{flex:1 1 auto;white-space:normal;overflow:visible;text-overflow:clip}",
    ".in-key[data-folded=\"1\"] .in-key-h .in-chip-t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".in-chip .in-key-h .in-key-c{flex:0 0 auto;font-size:.7em;color:var(--color-text-muted,#6E6A63)}",
    ".in-key-l{list-style:none;margin:0;padding:.1rem .75rem .4rem;border-top:1px solid var(--color-divider,rgba(36,33,29,.1))}",
    ".in-key-l li{display:flex;align-items:center;gap:.45rem;font-weight:400;line-height:1.25;padding:.17rem 0}",
    ".in-key-l .in-sw{border:1px solid rgba(36,33,29,.18)}",
    ".in-key-l .in-sw-none{background:" + POOL + "}",
    ".in-key-l .in-key-n{margin-left:auto;padding-left:.6rem;font-variant-numeric:tabular-nums;color:var(--color-text-muted,#6E6A63)}",
    ".in-key-l .in-key-more{color:var(--color-text-muted,#6E6A63)}",
    ".in-key[data-folded=\"1\"] .in-key-l{display:none}",
    // Research mode's blocks, one per ticked question, in tick order: side by side where there is room, a column on a phone
    ".in-keys{display:flex;gap:.4rem;flex-wrap:wrap;align-items:flex-start;max-width:100%}",
    // a wide screen: clear of the layers button and of a place's card docked at the right
    "@media (min-width:721px){.atlas-stage>.in-chips{right:auto;max-width:calc(100% - var(--in-left,24px) - 420px)}}",
    /* A phone: the chips stand in a column at the map's foot, the key lowest
       and the chosen answer's chip above it (never wrapped under the key),
       lifted over the strip the credits button (ⓘ) and the LOKA badge share,
       and narrow enough to clear the scale and the zoom buttons on the right.
       The one-time "Tap a pin" cue is lifted over the key by the key's own
       measured height (--in-chips-h, set by renderChips). */
    "@media (max-width:720px){.atlas-stage>.in-chips{left:10px;right:56px;top:auto;bottom:calc(var(--sheet-h,0px) + 48px);flex-direction:column-reverse;align-items:flex-start}.in-chip{font-size:.75rem;padding:.22rem .6rem}" +
      ".in-chip.in-key{max-width:228px}.in-chip .in-key-h{padding:.22rem .6rem}.in-key-l{padding:.1rem .6rem .35rem}.in-keys{flex-direction:column}" +
      ".atlas-stage.in-on .atlas-cue{bottom:calc(var(--sheet-h,0px) + var(--in-chips-h,0px) + 60px)}" +
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
    /* the default panel's answer rows: the same look as the map's key
       (Mithun, 7 Nov 2026) — a mark, the name, the count — plus a small
       ⓘ at the end of each row */
    ".in-arow{display:flex;align-items:center;gap:.15rem;margin:0;width:100%}",
    ".in-ans-row{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:.45rem;text-align:left;background:none;border:none;border-radius:var(--radius-md,.25rem);padding:.25rem .3rem;font:inherit;line-height:1.25;color:inherit;cursor:pointer}",
    ".in-ans-row:hover{background:var(--color-surface-alt,#F0EDE4)}",
    ".in-ans-row.on{background:var(--color-marigold-tint,rgba(233,162,55,.16))}",
    ".in-ans-row.dim{opacity:.45}",
    ".in-ans-row .in-nm{flex:1 1 auto;min-width:0;font-weight:400;display:flex;align-items:center;gap:.4rem}",
    ".in-ans-row.on .in-nm{font-weight:600}",
    ".in-ans-row .in-ct{flex:none;font-weight:400;font-variant-numeric:tabular-nums;color:var(--color-text-muted,#6E6A63)}",
    ".in-ans-row .in-ct small{font-weight:400;color:var(--color-text-muted,#6E6A63);font-size:inherit}",
    ".in-ans-row.none .in-nm{font-weight:600;color:var(--color-text-secondary,#5A5751)}",
    ".in-mk{width:13px;height:13px;flex:none}",
    ".in-ans-row .in-sw{width:11px;height:11px}",
    ".in-sw.in-sw-hollow{background:none;border:2px solid " + POOL + ";box-sizing:border-box}",
    ".in-arow + .in-caveat{margin-top:.6rem}",
    ".in-info-btn{flex:none;width:21px;height:21px;border-radius:50%;border:1px solid var(--color-border,rgba(36,33,29,.3));background:var(--color-surface,#FDFCF8);color:var(--color-text-muted,#6E6A63);font:inherit;font-size:.74rem;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}",
    ".in-info-btn:hover{color:var(--color-text-primary,#24211D)}",
    ".in-info-btn[aria-expanded=\"true\"]{background:var(--color-leaf,#2A6B41);border-color:var(--color-leaf,#2A6B41);color:#fff}",
    ".in-info{margin:0 0 .5rem;padding:.5rem .65rem;border-radius:var(--radius-md,.25rem);background:var(--color-surface-alt,#F0EDE4);font-size:var(--t-meta,.8rem);color:var(--color-text-secondary,#5A5751);line-height:1.4}",
    ".in-info p{margin:.3rem 0 0}",
    ".in-info p:first-child{margin-top:0}",
    ".in-info q{font-style:italic;font-family:var(--font-display,Georgia,serif);quotes:\"\\201C\" \"\\201D\"}",
    // the questions section's "Research mode" switch, bottom of the panel (Mithun, 7 Nov 2026)
    ".in-rmode{display:flex;align-items:flex-start;gap:.7rem;margin-top:1.2rem;padding-top:.9rem;border-top:1px solid var(--color-divider,rgba(36,33,29,.1))}",
    ".in-rsw{flex:none;position:relative;width:38px;height:22px;border-radius:11px;border:none;padding:0;background:var(--color-border,rgba(36,33,29,.3));cursor:pointer}",
    ".in-rsw::after{content:\"\";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s;box-shadow:0 1px 2px rgba(36,33,29,.3)}",
    ".in-rsw[aria-checked=\"true\"]{background:var(--color-leaf,#2A6B41)}",
    ".in-rsw[aria-checked=\"true\"]::after{transform:translateX(16px)}",
    ".in-rtext strong{display:block;font-weight:700;font-size:.95rem}",
    ".in-rtext span{display:block;font-size:var(--t-meta,.8rem);color:var(--color-text-muted,#6E6A63);margin-top:.1rem}",
    // the per-question tick box, beside the header, never inside its button (opening and ticking are separate taps)
    ".in-qrow{display:flex;align-items:flex-start;gap:.3rem}",
    ".in-qrow .in-qhead{flex:1 1 auto;min-width:0}",
    ".in-tick{flex:none;display:inline-flex;align-items:center;height:2.2rem;padding:0 .2rem}",
    // the phone's tiny chip (R5): the question, then its answers as dots with names, two lines at most
    ".in-chip.in-tiny{display:block;max-width:100%;max-height:40vh;overflow-y:auto;text-align:left;padding:.3rem .6rem;font:inherit;font-size:.75rem;line-height:1.3;cursor:pointer}",
    ".in-tiny-q{display:block;font-weight:600}",
    ".in-tiny-a{display:block;font-weight:400;margin-top:.1rem;color:var(--color-text-secondary,#5A5751)}",
    ".in-tiny-i{display:inline-flex;align-items:center;gap:.25rem;margin-right:.55rem;white-space:nowrap}",
    ".in-tiny-i .in-sw{width:8px;height:8px}",
    // "Doesn't say" wears the map's grey here too (it had no colour of its own in the chip)
    ".in-tiny-i .in-sw-none{background:" + POOL + "}",
    ".in-tiny-more{color:var(--color-text-muted,#6E6A63)}",
    // Research mode is not offered on a phone (R6, recommended): the switch is hidden below 600px
    "@media (max-width:600px){.in-rmode{display:none}}",
    // ...and in its place on a phone, one plain line saying where it lives
    // "More on this map": a fold that reads like a question row; layer rows with a small switch (the Research switch's look, smaller)
    ".in-moresect{margin-top:1rem;padding-top:.3rem;border-top:1px solid var(--color-divider,rgba(36,33,29,.1))}",
    ".in-fold .in-qt{font-weight:600}",
    ".in-fold[aria-expanded=\"true\"] .in-chev{transform:rotate(180deg)}",
    ".in-morebody{padding:0 0 .5rem}",
    ".in-morebody .in-sect{margin:.2rem 0 .25rem}",
    ".in-morebody .in-q:first-of-type{border-top:0}",
    ".in-lrow{display:flex;align-items:center;gap:.15rem;width:100%}",
    ".in-lline{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:.55rem;padding:.3rem .3rem;margin:0;line-height:1.25}",
    "label.in-lline{cursor:pointer}",
    ".in-lrow input{position:absolute;opacity:0;width:0;height:0}",
    ".in-lsw{flex:none;position:relative;width:32px;height:18px;border-radius:9px;background:var(--color-border,rgba(36,33,29,.3));transition:background .15s}",
    ".in-lsw::after{content:\"\";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(36,33,29,.3);transition:transform .15s}",
    ".in-lrow input:checked+.in-lsw{background:var(--color-leaf,#2A6B41)}",
    ".in-lrow input:checked+.in-lsw::after{transform:translateX(14px)}",
    ".in-lrow input:focus-visible+.in-lsw{outline:2px solid var(--color-leaf,#2A6B41);outline-offset:2px}",
    ".in-lname{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:.4rem;font-weight:400}",
    ".in-lmain .in-lname{padding-left:calc(32px + .55rem)}",
    ".in-lrow.off .in-lname,.in-lrow.off .in-lct{color:var(--color-text-muted,#6E6A63)}",
    ".in-lname .in-sw{width:11px;height:11px;border:1px solid rgba(36,33,29,.18)}",
    ".in-lname .in-sw-line{height:3px;width:14px;border-radius:2px;border:0}",
    ".in-lct{flex:none;font-variant-numeric:tabular-nums;color:var(--color-text-muted,#6E6A63)}",
    // the owner's doors on a row (owner.js): the row wraps so the menu and the fold sit under the name
    ".in-lrow{flex-wrap:wrap}",
    ".in-lrow .in-lextra{flex:1 1 100%}",
    ".in-lrow .in-lextra:empty,.in-lrow .own-fold:empty{display:none}",
    ".in-lrow .own-fold,.in-lrow .own-by{flex:1 1 100%}",
    ".in-rphone{display:none;margin:1.2rem 0 0;padding-top:.9rem;border-top:1px solid var(--color-divider,rgba(36,33,29,.1));font-size:var(--t-meta,.8rem);color:var(--color-text-muted,#6E6A63)}",
    "@media (max-width:600px){.in-rphone{display:block}}",
    ".in-tick input{width:17px;height:17px;margin:0}",
    ".in-tick.in-tick-off{opacity:.4}",
  ].join("\n");

  function viewer(mode, api) {
    var esc = api.esc, el = api.el;
    var srcLayer = null, X = null, titleProp = "name";
    var state = {
      ready: false, tab: null, open: null, filter: null, cmp: null, showAll: false, box: null, chips: null, keyFolded: false,
      // Research mode (off on every page load, never remembered): up to 3 ticked
      // questions, in the order ticked (their shape); which answer's ⓘ is open;
      // the map key's own fold, kept per ticked question
      research: false, ticks: [], info: null, rkeyFold: {},
      // "More on this map" (folded on every visit) and which layer's ⓘ is open
      more: false, linfo: null,
    };
    // every layer the manifest lists, as atlas.js handed them over (the main one swapped for X)
    var ALL = [];

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
      ALL = list.map(function (L) { return L === srcLayer ? X : L; });
      return ALL;
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
      var raw = rawKeys(feats());
      var byCol = {};
      list.forEach(function (st) { byCol[st.col] = st; });
      raw.forEach(function (st) { byCol[st.col] = st; });
      // cols: the questions alone (the story, the tabs and the card read them); byCol knows the plain keys too
      cache = { list: list, raw: raw, byCol: byCol, cols: list.map(function (st) { return st.col; }) };
      return cache;
    }
    // the first question (not one said by few); on an atlas not read yet, the first of the layer's own keys
    function firstOpen() {
      var l = Q().list;
      var main = l.filter(function (st) { return !st.sparse; })[0];
      return (main || l[0] || Q().raw[0] || {}).col || null;
    }
    /* The layer's own keys — the plain columns Standard offered as "Explore by"
       ("Category", "When it was added (by month)") — as rows like the
       questions, through the same stats, colours and map path (Mithun, 7 Nov
       2026). Which columns, and a place's value under one (the first of a list
       cell, a date's month), is atlas.js's one rule (api.keyOptions,
       api.optValues); the value is written on the place under a working name
       (RAW_COL + column) so that everything that reads an answer by column —
       the pins, the discs, the key, a tap on an answer — reads a plain key
       exactly as it reads a question. The owner's committed colours, if any,
       are not carried over: one palette for every key (Mithun, 7 Nov 2026). */
    function rawKeys(fs) {
      if (!X || !fs.length || !api.keyOptions || !api.optValues) return [];
      var opts;
      try { opts = api.keyOptions(X) || []; } catch (e) { opts = []; }
      var out = [];
      opts.forEach(function (o) {
        if (o.isQuestion || o.tooFew || o.scattered || !o.col) return;
        // a column of people or ids (by name or by values) is never a key on the visitor page (people-hidden)
        if (isPeopleColumn(o.col, fs.map(function (f) { return (f.properties || {})[o.col]; }))) return;
        var vcol = RAW_COL + o.col;
        fs.forEach(function (f) {
          var p = f.properties || (f.properties = {});
          var vals = api.optValues(X, o, f) || [];
          p[vcol] = vals.length ? vals[0] : "";
        });
        var lab = {}; lab[vcol] = o.label || o.col;
        var st = stats({ keyLabels: lab }, fs, vcol);
        if (!st.answered) return;
        st.question = String(o.label || o.col);   // a key's name is not a question: no "…" on the end
        st.sparse = false;
        st.raw = true;
        // a date's months in the order of the year, not of their counts
        if (o.grain && st.answers.every(function (a) { return isFinite(Date.parse("1 " + a.name)) || isFinite(Date.parse(a.name)); })) {
          st.answers.sort(function (a, b) {
            var da = Date.parse("1 " + a.name), db = Date.parse("1 " + b.name);
            return (isFinite(da) ? da : Date.parse(a.name)) - (isFinite(db) ? db : Date.parse(b.name));
          });
          st.answers.forEach(function (a, i) { a.color = PAL[i % PAL.length]; });
        }
        st.dated = !!o.grain;
        out.push(st);
      });
      // a date key ("When it was added") is bookkeeping: it comes after the keys that say what a place is
      return out.filter(function (st) { return !st.dated; }).concat(out.filter(function (st) { return st.dated; }));
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
    /* Research mode: no one question is "the" colouring any more, so every
       pin turns the atlas's neutral grey ink, and each ticked question (at
       most 3, in tick order) puts its own shape beside the pin in that
       question's answer colour — circle, square, triangle. A question the
       place does not answer leaves no mark at all. */
    function researchPinEl(f) {
      var rows = [];
      state.ticks.slice(0, 3).forEach(function (col, i) {
        var qst = Q().byCol[col];
        var c = qst && colourOf(qst, f && f.properties);
        if (c) rows.push({ shape: SHAPES[i], colors: [c] });
      });
      return api.markRowsEl ? api.markRowsEl(RESEARCH_PIN, rows) : api.locPinEl(RESEARCH_PIN, null);
    }
    function pinEl(L, f) {
      if (!L || !L._ev || !L._ev.insight) return null;
      if (state.research) return researchPinEl(f);
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
        // a research-mode pin sits inside a holder with its marks: the holder is what goes, never the pin alone
        var old = e.node && e.node.querySelector && (e.node.querySelector(".atlas-rowed") || e.node.querySelector(".atlas-pin"));
        var pin = old && pinEl(X, e.f);
        if (pin && old.parentNode) old.parentNode.replaceChild(pin, old);
        // how far the marks reach past the pin (0 without them), read by the fold, the merge and the fan (atlas.js)
        e._rowsW = (pin && pin._rowsW) || 0;
        e._rowsEl = (pin && pin._rowsEl) || null;
      });
    }
    function apply() {
      entries().forEach(function (e) { e.subOff = !matches((e.f && e.f.properties) || {}); });
      if (X) api.setLayerVisible(X, true);
    }
    /* The key (KEY_MAX rows at most, the same six answers the discs colour),
       folded to the one-line "Coloured by" chip by a tap on the question. */
    var KEY_MAX = 6;
    /* The key's counts are of the places on the map right now: a chosen
       answer, a search, "What's around here" take places off it, and the key
       follows (the question's own panel keeps the whole counts). Counted
       over the map's markers once there are any, else over the places that
       pass the filter. */
    function shownCounts(st) {
      var by = {}, none = 0, list = entries();
      var add = function (p) { var k = keyOf(p || {}, st.col); if (k) by[k] = (by[k] || 0) + 1; else none++; };
      if (list.length) list.forEach(function (e) { if (!e.hidden && !e.away && !e.subOff) add(e.f && e.f.properties); });
      else feats().forEach(function (x) { if (matches(x.properties || {})) add(x.properties); });
      return { by: by, none: none };
    }
    function keyHTML(st) {
      var folded = !!state.keyFolded;
      var shown = shownCounts(st);
      var rows = st.answers.slice(0, KEY_MAX).map(function (a) {
        return '<li><span class="in-sw" style="background:' + a.color + '"></span><span>' + escText(a.name) + '</span><span class="in-key-n">' + (shown.by[a.key] || 0) + "</span></li>";
      }).join("");
      if (st.answers.length > KEY_MAX) rows += '<li class="in-key-more">+ ' + (st.answers.length - KEY_MAX) + " more</li>";
      if (st.none) rows += '<li><span class="in-sw in-sw-none"></span><span>Doesn’t say</span><span class="in-key-n">' + shown.none + "</span></li>";
      return '<div class="in-chip in-key" data-folded="' + (folded ? 1 : 0) + '">' +
        '<button type="button" class="in-key-h" data-in="key" aria-expanded="' + (folded ? "false" : "true") + '" aria-label="' +
        (folded ? "Show the key: coloured by " : "Fold the key: coloured by ") + escAttr(st.question) + '"><span class="in-chip-t">Coloured by: ' + escText(st.question) +
        '</span><span class="in-key-c" aria-hidden="true">' + (folded ? "▸" : "▾") + "</span></button>" +
        '<ul class="in-key-l">' + rows + "</ul></div>";
    }
    /* Research mode's map key: one block per ticked question, headed by its
       shape ("Circles and discs: …", "Squares: …", "Triangles: …"), each with
       the same answer rows the default key has — a mark (now the question's
       shape, not a plain dot) and the count. Like the single-question key it
       stands down on desktop while the panel is open (hideKeyOnDesktop, in
       researchChipsHTML) and always stands on a phone; on a phone with more
       than one question ticked each block starts folded to its header line. */
    function researchKeyHTML() {
      var ticks = state.ticks.filter(function (c) { return !!Q().byCol[c]; });
      if (!ticks.length) return "";
      var defaultFold = api.onPhone() && ticks.length > 1;
      return ticks.map(function (col, i) {
        var st = Q().byCol[col];
        var folded = has(state.rkeyFold, col) ? state.rkeyFold[col] : defaultFold;
        var shown = shownCounts(st);
        var rows = st.answers.slice(0, KEY_MAX).map(function (a) {
          return "<li>" + markSVG(SHAPES[i], a.color) + "<span>" + escText(a.name) + '</span><span class="in-key-n">' + (shown.by[a.key] || 0) + "</span></li>";
        }).join("");
        if (st.answers.length > KEY_MAX) rows += '<li class="in-key-more">+ ' + (st.answers.length - KEY_MAX) + " more</li>";
        if (st.none) rows += '<li><span class="in-sw in-sw-none"></span><span>Doesn’t say</span><span class="in-key-n">' + shown.none + "</span></li>";
        // the discs ring by the first question only while it stands alone; with more ticked they wear no ring
        var label = (i === 0 && ticks.length > 1 ? "Circles" : SHAPE_HEAD[i]) + ": " + st.question;
        return '<div class="in-chip in-key" data-folded="' + (folded ? 1 : 0) + '">' +
          '<button type="button" class="in-key-h" data-in="rkey" data-col="' + escAttr(col) + '" aria-expanded="' + (folded ? "false" : "true") + '" aria-label="' +
          (folded ? "Show the key: " : "Fold the key: ") + escAttr(label) + '"><span class="in-chip-t">' + escText(label) +
          '</span><span class="in-key-c" aria-hidden="true">' + (folded ? "▸" : "▾") + "</span></button>" +
          '<ul class="in-key-l">' + rows + "</ul></div>";
      }).join("");
    }
    /* What the counted discs wear (atlas.js, COLOURED DISCS): the open
       question's answers in the key's order and colours, a place's slot the
       index of its answer, blank or past the sixth into the pool. */
    function discColouring() {
      // research mode: discs ring by the 1st ticked question only — never
      // stacked rings, and never a square or triangle on a disc
      // (and with MORE than one ticked, no ring and no colour at all: the plain
      // disc with its count — Mithun, 7 Nov 2026, round 2)
      var ticked = state.research ? state.ticks.filter(function (c) { return !!Q().byCol[c]; }) : [];
      if (state.research && ticked.length > 1) return null;
      var col = state.research ? ticked[0] : state.open;
      var st = col && Q().byCol[col];
      if (!st || !st.answers.length) return null;
      var slot = {};
      st.answers.forEach(function (a, i) { slot[a.key] = Math.min(i, KEY_MAX); });
      return {
        colours: st.answers.slice(0, KEY_MAX).map(function (a) { return a.color; }),
        names: st.answers.slice(0, KEY_MAX).map(function (a) { return a.name; }),
        pool: st.answers.length > KEY_MAX ? "Doesn’t say, or another answer" : "Doesn’t say",
        // any marker layer's place: one that does not answer the question (another
        // layer's, say) is in the pool, so a disc holding both keeps its shares right
        slotOf: function (L, f) {
          var k = keyOf((f && f.properties) || {}, st.col);
          return k && slot[k] !== undefined ? slot[k] : KEY_MAX;
        }
      };
    }
    /* Desktop: the map's "Coloured by" key says nothing the open Insights
       panel does not already say, so it stands down while the panel is open
       and comes back the moment it is folded. A phone's sheet is closed
       while you look at the map, so its key always stands (Mithun, 7 Nov
       2026). */
    function hideKeyOnDesktop() {
      if (typeof document === "undefined" || api.onPhone()) return false;
      var panel = document.getElementById("atlas-panel");
      return !!panel && !panel.classList.contains("collapsed");
    }
    /* A phone gets no big key on the map (Mithun, 7 Nov 2026, round 2): one
       tiny chip — the open question, then EVERY answer as a small colour dot
       with its name, wrapping as needed; nothing is cut to "+ n more" (Mithun,
       7 Nov 2026: "show all the answers to the chosen question in their
       entirety"). A tap opens the panel at that question. */
    function tinyChipHTML(st) {
      var items = st.answers.map(function (a) {
        return '<span class="in-tiny-i"><span class="in-sw" style="background:' + a.color + '"></span>' + escText(a.name) + "</span>";
      });
      if (st.none) items.push('<span class="in-tiny-i"><span class="in-sw in-sw-none"></span>Doesn\u2019t say</span>');
      return '<button type="button" class="in-chip in-tiny" data-in="panel" data-col="' + escAttr(st.col) + '" aria-label="Open the questions at: ' + escAttr(st.question) + '">' +
        '<span class="in-tiny-q">' + escText(st.question) + '</span><span class="in-tiny-a">' + items.join("") + "</span></button>";
    }
    function chipsHTML() {
      if (state.research) return researchChipsHTML();
      var st = state.open && Q().byCol[state.open];
      if (!st) return '<span class="in-chip"><span class="in-chip-t">Open a question to colour the map</span></span>';
      var h = api.onPhone() ? tinyChipHTML(st) : hideKeyOnDesktop() ? "" : keyHTML(st);
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
    // same filter chip as the default view (duplicated rather than shared,
    // so neither path can break the other): research mode's own key blocks
    // plus whichever answer or slice is picked
    function researchChipsHTML() {
      // the blocks stand together in one box, so a phone's column-reverse (the
      // picked answer's chip above the key) never turns the blocks' own order round
      var blocks = hideKeyOnDesktop() ? null : researchKeyHTML();
      var h = blocks === null ? "" : blocks ? '<div class="in-keys">' + blocks + "</div>" : '<span class="in-chip"><span class="in-chip-t">Tick a question to colour the map</span></span>';
      // a phone (Research mode is not offered below 600px; a small tablet may still reach it): the tiny chip of the first ticked question
      if (api.onPhone()) {
        var first = state.ticks.filter(function (c) { return !!Q().byCol[c]; })[0];
        h = first ? tinyChipHTML(Q().byCol[first]) : '<span class="in-chip"><span class="in-chip-t">Tick a question to colour the map</span></span>';
      }
      var f = state.filter;
      if (f) {
        var fs = Q().byCol[f.col], a = fs && fs.answers.filter(function (x) { return x.key === f.ans; })[0];
        var n = feats().filter(function (x) { return matches(x.properties || {}); }).length;
        var b = f.col2 && Q().byCol[f.col2] && Q().byCol[f.col2].answers.filter(function (x) { return x.key === f.ans2; })[0];
        var lab = f.ans === null ? "Doesn’t say" : a ? a.name : f.ans;
        h += '<span class="in-chip"><span class="in-sw" style="background:' + (f.ans === null ? NONE : a ? a.color : NONE) + '"></span><span class="in-chip-t">' +
          escText(lab) + (b ? " + " + escText(b.name) : "") + " · " + n + " " + placesWord(n) + '</span><button type="button" data-in="clear" aria-label="Show all places">×</button></span>';
      }
      return h;
    }
    function renderChips() {
      if (typeof document === "undefined") return;
      var stage = document.querySelector(".atlas-stage");
      if (!stage) return;
      if (!state.chips) {
        state.chips = el("div", "in-chips");
        state.chips.addEventListener("click", onClick);
      }
      /* What a screen reader hears: only that the map's colouring changed, once
         per question (the chips redraw on every move; a live region on them
         re-read the whole key each time). */
      if (!state.live) {
        state.live = el("div", "in-live");
        state.live.setAttribute("aria-live", "polite");
        state.live.setAttribute("role", "status");
        stage.appendChild(state.live);
      }
      if (state.chips.parentNode !== stage) stage.appendChild(state.chips);
      // clear of the side panel on a wide screen
      var panel = document.getElementById("atlas-panel");
      if (panel && !api.onPhone()) {
        var sr = stage.getBoundingClientRect(), pr = panel.getBoundingClientRect();
        var left = pr.right > sr.left && pr.left < sr.left + sr.width / 2 ? Math.round(pr.right - sr.left + 12) : 12;
        stage.style.setProperty("--in-left", left + "px");
      }
      var html = state.ready ? chipsHTML() : "";
      // drawn again only when the html changed (the tiny chip shows every answer: nothing to fit)
      if (state.chips._html !== html) {
        // the fold button keeps its focus across a redraw
        var focused = document.activeElement && state.chips.contains(document.activeElement) ? document.activeElement.getAttribute("data-in") : null;
        state.chips.innerHTML = html;
        state.chips._html = html;
        if (focused) { var again = state.chips.querySelector('[data-in="' + focused + '"]'); if (again && again.focus) again.focus(); }
      }
      var open = state.ready && state.open && Q().byCol[state.open];
      var said = open ? "Map coloured by: " + open.question : "";
      if (state.research) {
        var qs = state.ticks.map(function (c) { return Q().byCol[c]; }).filter(Boolean).map(function (q) { return q.question; });
        said = qs.length ? "Map showing: " + qs.join("; ") : "Map showing no question";
      }
      if (said !== state.said) { state.said = said; state.live.textContent = said; }
      // how tall the chips stand, for whatever else sits at the map's foot (the cue)
      try { stage.style.setProperty("--in-chips-h", (state.chips.offsetHeight || 0) + "px"); } catch (e) {}
    }

    /* ---- the place's card ---- */
    function photoHTML(props) {
      if (props.photo_file && api.dataUrl) return api.shotsHTML([api.dataUrl(String(props.photo_file))]);
      var links = api.linksIn(props.photo_urls || props.photo_1_url || props.image_urls);
      // else the column whose cells are image links, whatever it is called (label-rules.js photoLinksOf)
      if (!links.length && typeof LokaLabelRules !== "undefined" && LokaLabelRules && LokaLabelRules.photoLinksOf) links = LokaLabelRules.photoLinksOf(props);
      return api.shotsHTML(links);
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
    /* The questions section looks like the map's key (Mithun, 7 Nov 2026):
       a header line per question (the question, a chevron) and, open, one
       row per answer — mark, name, count — the mark the same dot the key
       draws, or the question's shape in Research mode when it is ticked. A
       small ⓘ at the row's end opens what the old long row said: the
       answer's description, "N of M places (x%)", and the words a couple of
       places' answers were read from. One ⓘ open at a time; Escape or a
       second tap closes it. The compare select and, under a picked answer,
       the split bar are Research mode's alone. */
    function tickIndex(col) { return state.research ? state.ticks.indexOf(col) : -1; }
    function rowMark(st, a) {
      var i = tickIndex(st.col);
      if (!a) return '<span class="in-sw in-sw-hollow"></span>';
      return i >= 0 ? markSVG(SHAPES[i], a.color) : '<span class="in-sw" style="background:' + a.color + '"></span>';
    }
    function infoHTML(st, a) {
      var n = a ? a.count : st.none, pct = st.total ? Math.round(100 * n / st.total) : 0;
      var h = '<div class="in-info" id="' + infoId(st, a) + '">';
      if (a && a.definition) h += "<p>" + escText(a.definition) + "</p>";
      h += "<p>" + n + " of " + st.total + " " + placesWord(st.total) + " (" + pct + "%)" + (a ? "" : " say nothing about this") + ".</p>";
      var ex = a ? answerExamples(feats(), st.col, a.key, 2) : [];
      if (ex.length) h += "<p>Read from: " + ex.map(function (w) { return "<q>" + escText(w) + "</q>"; }).join(" · ") + "</p>";
      return h + "</div>";
    }
    // the popover's id: the question's place in the list and the answer's place in it (none for "Doesn't say")
    // — numbers only, so any column name or answer key makes a sound id
    function infoId(st, a) {
      var qi = Q().cols.indexOf(st.col);
      return "in-info-" + (qi >= 0 ? qi : "x" + String(st.col).replace(/[^\w-]+/g, "_")) + "-" + (a ? st.answers.indexOf(a) : "none");
    }
    function answerRowHTML(st, a, f) {
      var key = a ? a.key : null, name = a ? a.name : "Doesn’t say", count = a ? a.count : st.none;
      var on = !!f && f.ans === key, dim = !!f && !on;
      var infoOpen = state.info === st.col + "|" + (key === null ? "" : key);
      var h = '<div class="in-arow"><button type="button" class="in-ans-row' + (a ? "" : " none") + (on ? " on" : "") + (dim ? " dim" : "") +
        '" data-in="ans" data-col="' + escAttr(st.col) + '" data-a="' + escAttr(key === null ? "" : key) + '" aria-pressed="' + on + '">' +
        '<span class="in-nm">' + rowMark(st, a) + escText(name) + '</span><span class="in-ct">' + count + "</span></button>" +
        '<button type="button" class="in-info-btn" data-in="info" data-col="' + escAttr(st.col) + '" data-a="' + escAttr(key === null ? "" : key) +
        '" aria-label="About ' + escAttr(name) + '" aria-expanded="' + infoOpen + '"' + (infoOpen ? ' aria-controls="' + infoId(st, a) + '"' : "") + ">i</button></div>";
      if (infoOpen) h += infoHTML(st, a);
      return h;
    }
    /* Under each question, what it does to the map (Mithun, 7 Nov 2026): a closed
       one says "Show this on the map"; the open one says "✓ Showing on the map", in
       the leaf green and bold (no dots: Mithun, 7 Nov 2026). In Research mode the
       tick boxes say it instead. */
    function mapStatusHTML(st, open) {
      if (state.research) return "";
      if (!open) return '<span class="in-qs">Show this on the map</span>';
      return '<span class="in-qs on"><span aria-hidden="true">\u2713</span>Showing on the map</span>';
    }
    function questionHTML(st) {
      var open = state.open === st.col;
      // the question on the map wears a border (Mithun, 7 Nov 2026); in Research mode the ticks say what is on the map
      var h = '<div class="in-q' + (open ? " open" : "") + (open && !state.research ? " in-on" : "") + (st.sparse ? " sparse" : "") + '"><div class="in-qrow">';
      if (state.research) {
        var ti = state.ticks.indexOf(st.col), full = ti < 0 && state.ticks.length >= 3;
        h += '<label class="in-tick' + (full ? " in-tick-off" : "") + '"' + (full ? ' title="Three at most"' : "") + '><input type="checkbox" data-in="tick" data-col="' + escAttr(st.col) +
          '" aria-label="Show ' + escAttr(st.question) + ' on the map"' + (ti >= 0 ? " checked" : "") + (full ? " disabled" : "") + "></label>";
      }
      h += '<button type="button" class="in-qhead" data-in="open" data-col="' + escAttr(st.col) + '" aria-expanded="' + open + '"><span class="in-qt"><span>' +
        escText(st.question) + '</span><span class="in-chev" aria-hidden="true">▾</span></span>' + mapStatusHTML(st, open) + "</button></div>";
      if (!open) return h + "</div>";
      var f = state.filter && state.filter.col === st.col && !state.filter.col2 ? state.filter : null;
      h += '<div class="in-qbody">';
      st.answers.forEach(function (a) { h += answerRowHTML(st, a, f); });
      if (st.none) h += answerRowHTML(st, null, f);
      if (st.sparse) h += '<p class="in-caveat warn">So few places answer this that it is a hint, not a pattern. Each place shows the words its answer was read from.</p>';
      if (state.research) {
        var opts = compareOptions(Q().list, feats(), st.col);
        if (opts.length) {
          var sid = "in-cmp-" + st.col;
          h += '<div class="in-cmprow"><label for="' + escAttr(sid) + '">Compare with</label><select id="' + escAttr(sid) + '" data-in="cmp"><option value="">another question…</option>' +
            opts.map(function (o) { return '<option value="' + escAttr(o.st.col) + '"' + (state.cmp === o.st.col ? " selected" : "") + ">" + escText(o.st.question) + "</option>"; }).join("") + "</select></div>";
          var pick = opts.filter(function (o) { return o.st.col === state.cmp; })[0];
          if (pick) h += compareHTML(st, pick.st, pick.both);
        }
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
    /* The ready-made split bar under a picked answer's "N places" header:
       how those places answer the compare rule's best-pair question, in the
       same colours the map would use for it. The line names the picked answer
       (splitWording, above), so it stays true after a slice tap. Counts are
       the panel's whole counts, like the rest of the question's panel (the
       map's key alone follows what is shown). Hidden while "Compare with" is
       set: that already shows this row. No pair, or none of this answer's
       places answer the partner: nothing. */
    function splitBarHTML(st, f) {
      if (!state.research) return "";   // Research mode's alone (Mithun, 7 Nov 2026)
      if (state.cmp) return ""; // "Compare with" already shows this answer's row: never the same bar twice
      var pair = bestPair(Q().list, feats(), st.col);
      if (!pair) return "";
      var sb = pair.st, ansKey = f.ans;
      var a = ansKey === null ? null : st.answers.filter(function (x) { return x.key === ansKey; })[0];
      var total = ansKey === null ? st.none : (a ? a.count : 0);
      if (!total) return "";
      var row = splitRow(feats(), st.col, ansKey, sb);
      if (!row.count) return "";
      var w = splitWording(ansKey === null ? null : a ? a.name : ansKey, total, row, sb.question);
      if (w.kind === "one") return '<p class="in-split-one">' + escText(w.text) + "</p>";
      var h = '<div class="in-split"><div class="in-from">' + escText(w.text) + '</div><div class="in-cbar">';
      row.cells.forEach(function (c) {
        var on = f.col2 === sb.col && f.ans2 === c.key;
        h += '<button type="button" class="' + (on ? "on" : "") + '" style="flex:' + c.count + ";background:" + c.color + '" data-in="slice" data-col="' + escAttr(st.col) +
          '" data-a="' + escAttr(ansKey === null ? "" : ansKey) + '" data-col2="' + escAttr(sb.col) + '" data-a2="' + escAttr(c.key) + '" aria-label="' + c.count + " " +
          placesWord(c.count) + ": " + escAttr(ansKey === null ? "Doesn\u2019t say" : a ? a.name : ansKey) + " and " + escAttr(c.answer) + '" aria-pressed="' + on + '">' +
          (c.count >= 3 ? c.count : "") + "</button>";
      });
      h += '</div><div class="in-lg">' + row.cells.map(function (c) {
        return '<span><i style="background:' + c.color + '"></i>' + escText(c.answer) + " <b>" + c.count + "</b></span>";
      }).join("") + "</div></div>";
      return h;
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
      h += splitBarHTML(st, f);
      idx.slice(0, lim).forEach(function (i) {
        var p = all[i].properties || {}, w = whyOf(p, st.col);
        h += '<button type="button" class="in-prow' + (sameF(all[i], openF) ? " in-open" : "") + '" data-in="place" data-i="' + i + '"><div class="in-rn">' + escText(nameOf(all[i])) + "</div>" +
          (w ? '<div class="in-from">Read from: <q>' + escText(w) + "</q></div>" : "") + "</button>";
      });
      if (idx.length > lim) h += '<button type="button" class="in-more" data-in="more">Show all ' + idx.length + "</button>";
      return h + "</div>";
    }
    /* ---- "More on this map" ---- */
    /* Every other layer of the atlas, folded away under the questions
       (Mithun, 7 Nov 2026: "This map" is one panel; the layers come second):
       the data layers with a switch each — except the MAIN one, the layer the
       questions colour, which has no switch — and the public map layers
       (boundaries, parks and the like) with theirs. Each row carries its
       count (data layers) and a ⓘ that opens what the layer is. The rows
       atlas.js's own list leaves out (a base-map row, a split file's points
       twin) are left out here too (api.rowLayer). */
    function layerRows() {
      return ALL.filter(function (L) { return !api.rowLayer || api.rowLayer(L); });
    }
    function layerIsOn(L) { return L._visible != null ? !!L._visible : L.default !== false; }
    function layerCount(L) { return ((api.data(L.id) || {}).features || []).length; }
    function layerNote(L) {
      if (L.info) return String(L.info);
      if (L.userLayer) {
        var n = layerCount(L), bits = [n + " " + placesWord(n) + " on this layer"];
        if (L.uploadedAs) bits.push("from " + L.uploadedAs);
        if (L.addedBy && L.addedBy.name) bits.push("added by " + L.addedBy.name);
        return bits.join(" \u00b7 ") + ".";
      }
      if (L.legend && L.legend.length) return L.legend.map(function (g) { return g.label; }).filter(Boolean).join(", ") + ".";
      return "A layer of the map.";
    }
    function layerSwatch(L) {
      if (L.userLayer) {
        var first = L.markers && Object.keys(L.markers)[0];
        var c = (first && L.markers[first] && L.markers[first].color) || (L.markerDefault && L.markerDefault.color) || null;
        return c ? '<span class="in-sw" style="background:' + escAttr(c) + '"></span>' : "";
      }
      var g = L.legend && L.legend[0];
      if (!g || !g.color) return "";
      return '<span class="in-sw' + (g.shape === "line" ? " in-sw-line" : "") + '" style="background:' + escAttr(g.color) + '"></span>';
    }
    /* A layer's name on its row. The main layer's label is often the upload's
       own file name or slug ("bengaluru-tags"): a slug is not a name, so it
       says "Places on this map" instead. Other layers keep what the owner
       called them. */
    function layerName(L, main) {
      var t = String(L.label || L.title || "").trim();
      if (!main) return t || String(L.id);
      var slug = !t || t === L.id || (!/\s/.test(t) && (/[-_]/.test(t) || /\.(csv|geojson|json|xlsx?)$/i.test(t)));
      return slug ? "Places on this map" : t;
    }
    function layerRowHTML(L) {
      var main = !!X && L.id === X.id, on = main || layerIsOn(L), open = state.linfo === L.id, name = layerName(L, main);
      var h = '<div class="in-lrow' + (on ? "" : " off") + (main ? " in-lmain" : "") + '" data-id="' + escAttr(L.id) + '">';
      if (main) {
        // the main layer: no switch (its places are what the questions colour), just its name
        h += '<span class="in-lline"><span class="in-lname">' + layerSwatch(L) + escText(name) + '</span><span class="in-lct">' + layerCount(L) + "</span></span>";
      } else {
        h += '<label class="in-lline"><input type="checkbox" role="switch" data-in="layer" data-id="' + escAttr(L.id) + '"' + (on ? " checked" : "") +
          ' aria-label="' + escAttr(name) + '"><span class="in-lsw"></span><span class="in-lname">' + layerSwatch(L) + escText(name) + "</span>" +
          (L.userLayer ? '<span class="in-lct">' + layerCount(L) + "</span>" : "") + "</label>";
      }
      h += '<button type="button" class="in-info-btn" data-in="linfo" data-id="' + escAttr(L.id) + '" aria-label="About ' + escAttr(name) + '" aria-expanded="' + open + '">i</button></div>';
      if (open) h += '<div class="in-info"><p>' + escText(layerNote(L)) + "</p></div>";
      return h;
    }
    function moreHTML(extraKeys) {
      // the main layer is a data layer whatever its manifest says of it
      var rows = layerRows(), data = rows.filter(function (L) { return L.userLayer || (X && L.id === X.id); }), pub = rows.filter(function (L) { return data.indexOf(L) < 0; });
      // nothing but the main layer (which has no switch): no fold at all
      var others = data.filter(function (L) { return !(X && L.id === X.id); });
      if (!others.length && !pub.length && !extraKeys.length) return "";
      var h = '<div class="in-moresect"><button type="button" class="in-qhead in-fold" data-in="fold" aria-expanded="' + !!state.more + '"><span class="in-qt"><span>More on this map</span><span class="in-chev" aria-hidden="true">\u25be</span></span></button>';
      if (!state.more) return h + "</div>";
      h += '<div class="in-morebody">';
      if (data.length) h += '<div class="in-sect"><span class="in-stamp">Layers</span></div>' + data.map(layerRowHTML).join("");
      if (pub.length) h += '<div class="in-sect" style="margin-top:.7rem"><span class="in-stamp">Map layers</span></div>' + pub.map(layerRowHTML).join("");
      if (extraKeys.length) h += '<div class="in-sect" style="margin-top:1rem"><span class="in-stamp">Other keys</span></div><p class="in-hint">Open one to colour the map by it instead.</p>' + extraKeys.map(questionHTML).join("");
      return h + "</div></div>";
    }
    function panelHTML() {
      if (!state.ready) return '<p class="ev-hint">' + (typeof window !== "undefined" && window.LokaWait ? window.LokaWait.html("Loading the places\u2026") : "Loading the places\u2026") + "</p>";
      var voice = voiceHTML();
      var list = Q().list, raw = Q().raw;
      if (!list.length) {
        /* Not read yet: the layer's own keys are the rows, the first open, and one
           plain line says the questions and the story come once LOKA has read the
           places (Mithun, 7 Nov 2026). No story: there is none to show. */
        if (!raw.length) return '<p class="in-hint">' + escText(NOT_READ_YET) + "</p>" + moreHTML([]);
        return '<div class="in-sect"><span class="in-stamp">The keys</span><span class="in-cov">' + raw.length + " on this layer</span></div>" +
          '<p class="in-hint">Open a key to colour the map by it, one at a time. Tap a row to show only those places.</p>' + raw.map(questionHTML).join("") +
          '<p class="in-hint" style="margin-top:.8rem">' + escText(NOT_READ_YET) + "</p>" + researchSwitchHTML() + moreHTML([]);
      }
      var main = list.filter(function (st) { return !st.sparse; }), few = list.filter(function (st) { return st.sparse; });
      var h = voice + '<div class="in-sect"><span class="in-stamp">The questions</span><span class="in-cov">' + list.length + " asked of every place</span></div>" +
        '<p class="in-hint">Open a question to colour the map by its answers, one at a time. Tap an answer to show only those places.</p>';
      h += main.map(questionHTML).join("");
      if (few.length) h += '<div class="in-sect" style="margin-top:1rem"><span class="in-stamp">Said by only a few places</span></div>' + few.map(questionHTML).join("");
      return h + researchSwitchHTML() + moreHTML(raw);
    }
    /* The Research mode switch, the very bottom of the panel: off on every
       page load, never remembered across visits (Mithun, 7 Nov 2026). */
    function researchSwitchHTML() {
      return '<div class="in-rmode"><button type="button" class="in-rsw" role="switch" aria-checked="' + !!state.research + '" data-in="research" aria-labelledby="in-rmode-lbl"></button>' +
        '<div class="in-rtext"><strong id="in-rmode-lbl">Research mode</strong><span>Put two or three questions or keys on the map at once and compare them.</span></div></div>' +
        // phones (no switch there): say where it lives instead (Mithun, 7 Nov 2026)
        '<p class="in-rphone">To put several questions or keys on the map at once, or compare one with another, open LOKA Atlas on a computer or in your browser’s desktop mode.</p>';
    }
    function renderPanel() {
      if (dropResearchIfSmall()) return;   // setResearch(false) draws everything again itself
      syncHead();
      renderChips();
      var box = state.box;
      if (!box) return;
      var sc = box.closest && box.closest(".sheet-body");
      var top = sc ? sc.scrollTop : 0;
      box.innerHTML = panelHTML();
      if (sc) sc.scrollTop = top;
      wireLayerDoors(box);
    }
    /* The owner's doors on each layer row under "More on this map" (Edit card,
       Remove, the reading's door — owner.js through atlas.js's onLayerExtra):
       every row drawn, the main layer's too, gets L._row and an empty L._extra
       and atlas.js is asked to hang the doors (api.layerDoors). The main row
       hands over the manifest's own layer, not the panel's copy, so a door
       saves to the layer the owner's tools know. A visitor's page has no
       hooks, so nothing is added. */
    function wireLayerDoors(box) {
      if (!api.layerDoors || !box.querySelectorAll) return;
      var rows = box.querySelectorAll(".in-lrow[data-id]");
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i], id = row.getAttribute("data-id");
        var L = layerRows().filter(function (x) { return x.id === id; })[0];
        if (!L) continue;
        if (X && L.id === X.id && srcLayer) L = srcLayer;
        var extra = el("div", "in-lextra ctl-extra");
        row.appendChild(extra);
        L._row = row;
        L._extra = extra;
        api.layerDoors(L);
      }
    }
    function sheetHead() {
      // one mode now, so the panel says what it is: "This map" (Mithun, 7 Nov 2026)
      if (!state.ready) return { label: "This map", small: "" };
      var n = feats().filter(function (x) { return matches(x.properties || {}); }).length;
      return { label: "This map", small: n + " " + placesWord(n) };
    }
    function syncHead() {
      if (typeof document === "undefined") return;
      renderTabs();
      var sh = sheetHead();
      var head = document.querySelector("#atlas-panel .sheet-who strong");
      if (head) head.textContent = sh.label;
      var who = document.getElementById("sheet-layer");
      // the kicker says "This map"; until the places are counted the line
      // stays empty (hidden), never "INSIGHTS / Insights" (7 Nov 2026)
      if (who) { who.innerHTML = ""; if (sh.small) who.appendChild(el("span", "sheet-layer-name", esc(sh.small))); }
    }

    /* ---- what a visitor does ---- */
    /* After the panel is drawn again the button a keyboard was on is found
       again and given focus: walked by attribute value, never a selector
       built from an answer key (a key may hold a quote or a backslash). */
    function refocus(kind, col, a) {
      if (!state.box || !state.box.querySelectorAll) return;
      var list = state.box.querySelectorAll('[data-in="' + kind + '"]');
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (col !== undefined && n.getAttribute("data-col") !== col) continue;
        if (a !== undefined && (n.getAttribute("data-a") || "") !== a) continue;
        if (n.focus) n.focus();
        return;
      }
    }
    /* Research mode on: the question that was open is ticked (circles); off:
       back to one question — the first ticked — with coloured pins, the
       compare select and the split bar gone, today's view. */
    // Research mode is not offered where its switch is hidden (below 600px, R6):
    // a screen that shrinks past that with it on (a phone turned upright) drops it
    function noResearchHere() {
      return typeof matchMedia !== "undefined" && !!matchMedia("(max-width:600px)").matches;
    }
    function dropResearchIfSmall() {
      if (state.research && noResearchHere()) { setResearch(false); return true; }
      return false;
    }
    function setResearch(on) {
      on = !!on;
      if (on === state.research) return;
      state.research = on;
      state.info = null; state.cmp = null; state.showAll = false; state.rkeyFold = {};
      if (on) {
        state.ticks = state.open && Q().byCol[state.open] ? [state.open] : [];
      } else {
        if (state.ticks.length) state.open = state.ticks[0];
        state.ticks = [];
      }
      // either way the view is left with one question's filter at most: a slice's
      // AND filter lives with the split bar, and a filter on a question that is
      // not the open (ticked) one would show places the panel no longer explains
      if (state.filter && (state.filter.col2 || state.filter.col !== state.open)) state.filter = null;
      if (on && !state.ticks.length) state.filter = null;   // nothing ticked (the open question is unknown): nothing to filter by
      changed(true);
    }
    function changed(repin, fit) {
      if (repin) repaint();
      // the discs wear the open question's colours as the pins do
      if (repin && api.colourDiscs) api.colourDiscs(discColouring());
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
        // opening is for reading; in Research mode it never ticks the question (and ticking never opens one)
        state.open = state.open === col ? null : col;
        state.filter = null; state.cmp = null; state.showAll = false; state.info = null;
        changed(true);
        // on a phone, opening a question lowers the sheet so the map it now colours is in view (Mithun, 7 Nov 2026)
        if (state.open && !state.research && api.onPhone() && api.setSheet) api.setSheet("peek");
        return;
      }
      if (d === "fold") { state.more = !state.more; renderPanel(); refocus("fold"); return; }
      if (d === "linfo") {
        var lid = t.getAttribute("data-id");
        state.linfo = state.linfo === lid ? null : lid;
        renderPanel();
        return;
      }
      if (d === "tick") {
        var at = state.ticks.indexOf(col);
        if (at >= 0) state.ticks.splice(at, 1);           // the shapes re-order: the next ticked moves up
        else if (state.ticks.length < 3) state.ticks.push(col);
        else return;                                      // three at most (the box is disabled; a keyboard can still get here)
        if (state.filter && state.filter.col2) state.filter = null;
        changed(true);
        refocus("tick", col);
        return;
      }
      if (d === "info") {
        var ia = t.getAttribute("data-a") || "", ik = col + "|" + ia;
        state.info = state.info === ik ? null : ik;       // one open at a time; a second tap closes
        renderPanel();
        refocus("info", col, ia);
        return;
      }
      if (d === "research") { setResearch(!state.research); return; }
      if (d === "panel") {
        // the phone's tiny chip: the panel opens at that question
        if (col && Q().byCol[col] && state.open !== col) { state.open = col; state.filter = null; state.cmp = null; state.info = null; changed(true); }
        if (api.setSheet) api.setSheet("full");
        var qh = state.box && state.box.querySelectorAll ? state.box.querySelectorAll('[data-in="open"]') : [];
        for (var qi = 0; qi < qh.length; qi++) {
          if (qh[qi].getAttribute("data-col") === col) { if (qh[qi].scrollIntoView) qh[qi].scrollIntoView({ block: "start" }); if (qh[qi].focus) qh[qi].focus(); break; }
        }
        return;
      }
      if (d === "rkey") {
        var ticked = state.ticks.filter(function (c) { return !!Q().byCol[c]; });
        var was = has(state.rkeyFold, col) ? state.rkeyFold[col] : (api.onPhone() && ticked.length > 1);
        state.rkeyFold[col] = !was;
        renderChips();
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
        // a slice under "Doesn't say" carries data-a="" — read it back as
        // null (as the "ans" case above does), so the filter and the chip
        // label match the "doesn't say" places instead of reading as blank
        // (Fable's finding, 7 Nov 2026)
        var a1 = t.getAttribute("data-a") || null, c2 = t.getAttribute("data-col2"), a2 = t.getAttribute("data-a2");
        var f = state.filter, same2 = f && f.col2 === c2 && f.ans === a1 && f.ans2 === a2;
        state.filter = same2 ? null : { col: col, ans: a1, col2: c2, ans2: a2 };
        state.showAll = false;
        changed(false, true);
        return;
      }
      if (d === "clear") { state.filter = null; state.showAll = false; changed(false); return; }
      // the key folds to the one-line chip and opens again; the panel is untouched
      if (d === "key") { state.keyFolded = !state.keyFolded; renderChips(); return; }
      if (d === "more") { state.showAll = true; renderPanel(); return; }
      if (d === "place") {
        var fe = feats()[+t.getAttribute("data-i")];
        if (fe) api.openPlace(X, fe);
      }
    }
    function onChange(e) {
      var s = e.target;
      if (s && s.getAttribute && s.getAttribute("data-in") === "layer") {
        // a layer's switch under "More on this map": never the main layer's (it has none)
        var id = s.getAttribute("data-id"), L = layerRows().filter(function (x) { return x.id === id && !(X && x.id === X.id); })[0];
        if (!L) return;
        api.setLayerVisible(L, !!s.checked);
        renderPanel();
        return;
      }
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
      sec.setAttribute("data-group-label", "This map");
      var box = el("div", "in-wrap");
      box.addEventListener("click", onClick);
      box.addEventListener("change", onChange);
      // Escape closes whichever answer's ⓘ is open (one open at a time), and
      // the keyboard lands back on that answer's ⓘ button
      box.addEventListener("keydown", function (e) {
        if (e.key !== "Escape" || !state.info) return;
        var cut = state.info.indexOf("|"), icol = state.info.slice(0, cut), ia = state.info.slice(cut + 1);
        state.info = null;
        renderPanel();
        refocus("info", icol, ia);
      });
      sec.appendChild(box);
      panel.appendChild(sec);
      state.box = box;
      renderPanel();
      var back = document.getElementById("sheet-card-back");
      if (back && back.lastChild && back.lastChild.nodeType === 3) back.lastChild.nodeValue = "This map";
      if (back) back.setAttribute("aria-label", "Back to the panel");
      // the map's key hides on desktop while this panel is open (hideKeyOnDesktop,
      // above) and must redraw the moment the panel folds or opens again
      if (typeof MutationObserver !== "undefined" && !panel._inFoldWatched) {
        panel._inFoldWatched = true;
        new MutationObserver(function () { renderChips(); }).observe(panel, { attributes: true, attributeFilter: ["class"] });
      }
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
            if (!m || !isOn({ mode: m })) { stop(true); return; }
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
      /* A place's name is written whole beside its pin when the map finds
         room (atlas.js syncPinNames: no cut, no "…"); where it would collide
         the map drops it and the hover bubble (desktop) or the tap (phone)
         says the name (Mithun, 7 Nov 2026, round 2). */
      fullNames: true,
      layers: layers,
      pinEl: pinEl,
      cardHTML: cardHTML,
      buildPanel: buildPanel,
      /* A chosen answer's places never fold into a counted disc (atlas.js,
         answerNamesOn): each stands as its own pin at every zoom, set out in
         a small ring where two would touch, as a Standard atlas's picked
         answer does (Mithun, 7 Nov 2026). */
      answerOn: function (L) { return !!state.filter && !!L && !!L._ev && !!L._ev.insight; },
      ready: function () {
        state.ready = true;
        forget();
        if (!state.open) state.open = firstOpen();
        changed(true);
        if (api.onMoveEnd) api.onMoveEnd(function () { renderChips(); });
        if (typeof window !== "undefined" && !viewer._resizeWired) {
          viewer._resizeWired = true;
          window.addEventListener("resize", function () {
            var cur = viewer._current;
            if (!cur) return;
            if (cur.dropResearchIfSmall()) return;   // the switch went: Research mode goes with it, and everything is drawn again
            cur.renderTabs(); cur.renderChips();
          });
        }
        pollSummary();
      },
      framed: function () { return X ? [X.id] : []; },
      // the map opens on most of the places, a far stray or two left out (as Explore)
      frameBox: function (pts) { return XM && XM.frameBox ? XM.frameBox(pts, 0.92) : null; },
      sheetHead: sheetHead,
      setMode: setMode,
      renderChips: renderChips,
      chipsHTML: chipsHTML,
      panelHTML: panelHTML,
      setResearch: setResearch,
      dropResearchIfSmall: dropResearchIfSmall,
      discColouring: discColouring,
      renderTabs: renderTabs,
      renderPanel: renderPanel,
      state: state,
      // the panel's own handlers, for the checks (test/insight-mode-test.mjs) to press a row without a page
      onClick: onClick,
      onChange: onChange,
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
    bestPair: bestPair,
    splitRow: splitRow,
    splitWording: splitWording,
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
    placeLabelOf: placeLabelOf, authorOf: authorOf,
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
    NOT_READ_YET: NOT_READ_YET,
    RAW_COL: RAW_COL,
    FEW_SHARE: FEW_SHARE, FEW_PLACES: FEW_PLACES, CMP_SHARE: CMP_SHARE, CMP_PLACES: CMP_PLACES,
    viewer: viewer,
  };
});
