/* LOKA Atlas — Insight mode: for people reading patterns. The questions LOKA
 * asked of the places, each answered as a bar list that colours the map, with
 * a short summary on top written by AI from the answer counts.
 *
 * An atlas is in Insight when the `mode` in its manifest.local.json says so
 * (the owner's "How visitors explore" switch, POST /instances/:slug/mode):
 *
 *   mode: {
 *     name: "insight",
 *     layer: "<the layer whose questions are read>",
 *     summaryOn: true,                     // the "What the places say" card
 *     order: ["pattern_3", "pattern_4", …],   // the owner's order
 *     shown: { pattern_1: true, pattern_5: false, … },
 *     summary: { sig, sentences: [{ text, questions: [col…] }], at } | null,
 *     summaryPending: true                 // while the server writes it
 *   }
 *
 * The rules (which questions show, the few-places shelf, when two questions
 * can be compared, which numbers a summary may say) are here, once: the
 * server (api/apps/atlas.js, api/lib/atlas/insight-summary.js), the owner's
 * Questions tab (owner-modes.js) and the visitor's page all run this file.
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
  // a summary "being written" for longer than this is taken as stuck: not pending, and a new one may start
  var PENDING_STALE_MS = 2 * 60 * 1000;
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
  // a question whose answers are people: read from who created the place
  function isPeople(layer, col) {
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
  // the numbers written in a sentence: "1,234" is 1234
  function numbersIn(text) {
    return (String(text || "").match(/\d+(?:,\d{3})*(?:\.\d+)?/g) || []).map(function (s) { return s.replace(/,/g, ""); });
  }
  // every number the tables hold for these questions (all of them when none are named)
  function allowedNumbers(tables, cols) {
    var ok = {}, add = function (n) { ok[String(n)] = true; };
    var want = cols && cols.length ? cols : null;
    add(tables.places);
    (tables.questions || []).forEach(function (q) {
      if (want && want.indexOf(q.id) < 0) return;
      add(q.answered); add(q.saysNothing);
      q.answers.forEach(function (a) { add(a.places); numbersIn(a.answer).forEach(add); });
      numbersIn(q.question).forEach(add);
    });
    (tables.pairs || []).forEach(function (p) {
      if (want && !(want.indexOf(p.questions[0]) >= 0 && want.indexOf(p.questions[1]) >= 0)) return;
      add(p.answerBoth);
      p.rows.forEach(function (r) { add(r.places); r.split.forEach(function (c) { add(c.places); }); });
      (p.columns || []).forEach(function (c) { add(c.places); });
    });
    return ok;
  }
  /* The model's sentences, checked one by one: plain text, at least one
     number, and every number in it one the tables hold for the questions it
     names. A failing sentence is dropped; under two left, no summary. */
  function checkSentences(list, tables) {
    var ids = (tables.questions || []).map(function (q) { return q.id; });
    var kept = [];
    (Array.isArray(list) ? list : []).forEach(function (s) {
      if (kept.length >= MAX_SENTENCES) return;
      var text = typeof s === "string" ? s : s && typeof s.text === "string" ? s.text : "";
      // the model sometimes tags a sentence with its question's id ("(pattern_2)"): not a number, never shown
      text = text.replace(/\s*\(?\bpattern_\d+\b\)?/g, "").replace(/\s+/g, " ").trim();
      if (!text || text.length > MAX_SENTENCE) return;
      if (/[%<>*#`_\[\]{}|\\]|https?:/i.test(text)) return;
      if (hasNumberWords(text)) return;
      var nums = numbersIn(text);
      if (!nums.length) return;
      // every sentence names at least one of the questions it draws on
      var cited = s && typeof s === "object" && Array.isArray(s.questions)
        ? s.questions.filter(function (c, i, a) { return ids.indexOf(c) >= 0 && a.indexOf(c) === i; }) : [];
      if (!cited.length) return;
      var ok = allowedNumbers(tables, cited);
      if (!nums.every(function (n) { return ok[n]; })) return;
      kept.push({ text: text, questions: cited });
    });
    return kept.length >= MIN_SENTENCES ? kept : [];
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
    ".in-sum{background:var(--color-page,#FAF8F3);border:1px solid var(--color-divider,rgba(36,33,29,.10));border-left:3px solid var(--color-leaf,#2A6B41);border-radius:var(--radius-md,.25rem);padding:.75rem .85rem .7rem;margin:0 0 1.1rem}",
    ".in-sum .in-stamp{color:var(--color-leaf-deep,#1F5232)}",
    ".in-sum p{margin:.3rem 0 0;font-size:.92rem;line-height:1.5;color:var(--color-text-primary,#24211D)}",
    ".in-sum.short p.in-s:not(:first-of-type),.in-sum.short .in-by{display:none}",
    ".in-more-sum{background:none;border:none;padding:0;margin-top:.35rem;font:inherit;font-size:var(--t-meta,.8rem);font-weight:700;color:var(--color-leaf-deep,#1F5232);cursor:pointer}",
    ".in-sum .in-by{margin-top:.55rem;font-size:var(--t-meta,.8rem);color:var(--color-text-muted,#6E6A63)}",
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
    var state = { ready: false, open: null, filter: null, cmp: null, showAll: false, sumOpen: false, box: null, chips: null };

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
    var cache = null, pollT = null;

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
      if (api.lokaLinkHTML) h += api.lokaLinkHTML(srcLayer || L, props);
      return h + "</div>";
    }

    /* ---- the panel ---- */
    function summaryHTML() {
      if (mode.summaryOn === false) return "";
      var sents = visibleSentences(mode.summary, Q().cols);
      if (sents.length) {
        var short = api.onPhone() && !state.sumOpen;
        return '<section class="in-sum' + (short ? " short" : "") + '" aria-label="What the places say"><div class="in-stamp">What the places say</div>' +
          sents.map(function (s) { return '<p class="in-s">' + sentenceHTML(s.text) + "</p>"; }).join("") +
          (short ? '<button type="button" class="in-more-sum" data-in="summore">Read the whole summary (' + sents.length + " sentences)</button>" : "") +
          '<div class="in-by">Written by AI from the answers below, when the atlas was last updated. Numbers count places, not people.</div></section>';
      }
      if (isPending(mode)) {
        return '<section class="in-sum" aria-live="polite"><div class="in-stamp">What the places say</div><div class="in-writing">' +
          '<div class="in-lines" aria-hidden="true"><i></i><i></i><i></i></div><p>LOKA is reading the ' + feats().length +
          " places to write a short summary. This takes about a minute. The questions below are ready now.</p></div></section>";
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
      var list = Q().list;
      if (!list.length) return summaryHTML() + '<p class="in-hint">No questions to show yet.</p>';
      var main = list.filter(function (st) { return !st.sparse; }), few = list.filter(function (st) { return st.sparse; });
      var h = summaryHTML();
      h += '<div class="in-sect"><span class="in-stamp">The questions</span><span class="in-cov">' + list.length + " asked of every place</span></div>" +
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
      if (!state.ready) return { label: "Patterns", small: "" };
      var n = feats().filter(function (x) { return matches(x.properties || {}); }).length;
      return { label: "Patterns", small: n + " " + placesWord(n) };
    }
    function syncHead() {
      if (typeof document === "undefined") return;
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
      if (d === "summore") { state.sumOpen = true; renderPanel(); return; }
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
      sec.setAttribute("data-group-label", "Patterns");
      var box = el("div", "in-wrap");
      box.addEventListener("click", onClick);
      box.addEventListener("change", onChange);
      sec.appendChild(box);
      panel.appendChild(sec);
      state.box = box;
      renderPanel();
      var back = document.getElementById("sheet-card-back");
      if (back && back.lastChild && back.lastChild.nodeType === 3) back.lastChild.nodeValue = "Patterns";
      if (back) back.setAttribute("aria-label", "Back to the questions");
    }

    /* While the server writes the summary the card says so; the page asks
       for the overlay again now and then, and shows the summary once it is
       there (about a minute; it stops asking after five). */
    function pollSummary() {
      if (pollT || typeof fetch === "undefined" || !api.dataUrl) return;
      if (mode.summaryOn === false || !isPending(mode)) return;
      var tries = 0, MAX_TRIES = 30;   // every 6 seconds, three minutes at most
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
            delete mode.summaryPending; delete mode.summaryPendingAt;
            renderPanel();
          })
          .catch(function () { if (pollT) stop(true); });
      }, 6000);
    }

    /* The owner's Questions tab (owner-modes.js) hands over the mode as the
       server saved it: the panel and the map follow at once. */
    function setMode(m) {
      if (!m || typeof m !== "object") return;
      Object.keys(mode).forEach(function (k) { if (!(k in m)) delete mode[k]; });
      Object.keys(m).forEach(function (k) { mode[k] = m[k]; });
      cache = null;
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
        cache = null;
        if (!state.open) state.open = firstOpen();
        changed(true);
        if (api.onMoveEnd) api.onMoveEnd(function () { renderChips(); });
        if (typeof window !== "undefined" && !viewer._resizeWired) {
          viewer._resizeWired = true;
          window.addEventListener("resize", function () { if (viewer._current) viewer._current.renderChips(); });
        }
        pollSummary();
      },
      framed: function () { return X ? [X.id] : []; },
      // the map opens on most of the places, a far stray or two left out (as Explore)
      frameBox: function (pts) { return XM && XM.frameBox ? XM.frameBox(pts, 0.92) : null; },
      sheetHead: sheetHead,
      setMode: setMode,
      renderChips: renderChips,
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
    allowedNumbers: allowedNumbers,
    checkSentences: checkSentences,
    visibleSentences: visibleSentences,
    hasNumberWords: hasNumberWords,
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
