/* LOKA Atlas — the rules a reading obeys.
 *
 * A reading happens in two places. An owner can ask for one from the map, and
 * then the browser shapes what came back and posts it; and the server reads a
 * layer on its own, when a new atlas is built or a reading that failed is owed.
 * Both have to agree on three things:
 *
 *   which columns hold words worth reading,
 *   how a set of answers becomes columns on a place,
 *   which questions a layer has already settled on.
 *
 * They used to agree by having the same code twice, and they stopped agreeing.
 * The browser's copy learned to clear the previous answers before writing the
 * new ones; the server's copy did not. So a re-read that found three questions
 * left the fourth one's column sitting on all 66 places — its name correctly
 * dropped, which only made it worse, because the map then fell back to the raw
 * column and called the key "Pattern 4". That is what one rule in two places
 * costs. This file is the fix: one copy, read by both.
 *
 * It is a plain script, so the browser loads it with a tag and no build step,
 * and it also hands itself to module.exports so Node can require it. There is
 * no package.json above atlas/, so Node reads this as an ordinary script.
 *
 * Nothing here talks to the network or the disk. Both callers send the result
 * their own way — the browser posts it, the server calls its own ingest — and
 * that difference is the only thing they are still allowed to disagree about.
 */
(function (root, make) {
  var made = make();
  if (typeof module === "object" && module.exports) module.exports = made;
  else root.LokaReadingRules = made;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* Eight is the palette: a key draws at most this many kinds, so recovering a
     question's kinds from what the map already shows stops at eight too. */
  var MAX_KINDS_KEPT = 8;

  function isAnswerColumn(k) { return /^pattern_/.test(k); }
  function isQuestionColumn(k) { return /^pattern_\d+$/.test(k); }

  /* Which columns hold words worth reading.
     Given the places as plain rows — the browser holds them as features, so it
     passes their properties. */
  function wordColumns(rows) {
    var first = (rows && rows[0]) || {};
    return Object.keys(first).filter(function (k) {
      /* Never read our own answers back in: a question's column is an answer,
         not evidence, and feeding it to the next reading would let one reading
         put words into the mouth of the next. */
      if (k.charAt(0) === "_" || k === "themes" || isAnswerColumn(k)) return false;
      if (/^(lat|latitude|lon|lng|long|longitude)$/i.test(k)) return false;
      var seen = {}, distinct = 0, spaced = 0, filled = 0, datey = 0;
      for (var i = 0; i < rows.length; i++) {
        var v = (rows[i] || {})[k];
        if (typeof v !== "string") continue;
        v = v.trim();
        if (!v) continue;
        if (/^https?:\/\//i.test(v)) return false;      // a link, not words
        filled++;
        if (v.indexOf(" ") >= 0) spaced++;
        if (/^\d{4}-\d{2}(-\d{2})?([T ].*)?$/.test(v)) datey++;
        if (!seen[v]) { seen[v] = 1; distinct++; }
      }
      if (!filled) return false;
      /* A date is not a reason. Measured on a real reading: with a date column
         in the mix the model answered "Cultural or historical" and offered
         "2025" as the words that justified it — which is the answer restated,
         not evidence for it. Time is worth asking about, but as a key built
         from the column itself, where no justification is needed or possible.
         Kept tight to ISO-ish dates so a house number is not mistaken for one. */
      if (datey >= filled * 0.9) return false;
      // all different and none of them spaced: that is an id, not words
      return !(distinct === filled && spaced === 0);
    });
  }

  /* What the columns are, for whoever is about to save them. Only the two the
     map needs as numbers are numbers; everything else is words. */
  function schemaFor(rows) {
    return Object.keys((rows && rows[0]) || {}).map(function (name) {
      return {
        name: name,
        type: (name === "latitude" || name === "longitude") ? "number" : "string",
      };
    });
  }

  /* A copy of the places with every trace of a previous reading removed.
     Every previous answer goes before new ones are written. Without this, a
     fresh set with fewer questions leaves the old last question's column on
     every place, answering a question nobody is asking any more. */
  function withoutAnswers(rows) {
    return (rows || []).map(function (p) {
      var o = Object.assign({}, p);
      delete o._category;                 // the engine's own, re-derived on build
      Object.keys(o).forEach(function (k) { if (isAnswerColumn(k)) delete o[k]; });
      return o;
    });
  }

  /* A reading turned into columns on each place.
     One column per question — pattern_1, pattern_2 … — plus pattern_N_why
     beside it. The question's own wording is not the column name: it travels
     separately as the key's name, so a reader meets "What can you do here?"
     rather than a column named after how it was made. */
  function shapeReading(rows, questions) {
    var out = withoutAnswers(rows);
    var keyLabels = {}, keyKinds = {};
    (questions || []).forEach(function (q, n) {
      var col = "pattern_" + (n + 1);
      var whyCol = col + "_why";
      keyLabels[col] = q.question;
      // the kinds travel with the wording, so this question can be asked again
      // later unchanged rather than re-invented
      keyKinds[col] = (q.counts || []).map(function (c) {
        return { name: c.name, definition: c.definition || "" };
      });
      (q.categories || []).forEach(function (c, i) {
        if (out[i]) out[i][col] = c === "other" ? "" : (c || "");
      });
      /* The words that put each place where it is, kept beside the answer. An
         answer with nothing under it is a judgement nobody can check. */
      (q.why || []).forEach(function (w, i) {
        if (out[i]) out[i][whyCol] = (w || []).join(", ");
      });
      out.forEach(function (o) {
        if (o[col] === undefined) o[col] = "";
        if (o[whyCol] === undefined) o[whyCol] = "";
      });
    });
    return { rows: out, keyLabels: keyLabels, keyKinds: keyKinds, schema: schemaFor(out) };
  }

  /* An atlas read before the kinds were kept has the wording and nothing else.
     Rather than let it drift once more before it can settle, the kinds are
     recovered from what the map is currently showing: the answers on the places
     ARE the kinds. Only what a reader can already see becomes settled, which is
     the right thing to freeze. */
  function kindsSeenIn(rows, col) {
    var seen = [];
    for (var i = 0; i < (rows || []).length; i++) {
      var v = String((rows[i] && rows[i][col]) || "").trim();
      if (v && v !== "other" && seen.indexOf(v) < 0) seen.push(v);
    }
    return seen.slice(0, MAX_KINDS_KEPT).map(function (name) {
      return { name: name, definition: "" };
    });
  }

  /* The questions a layer has already settled on, in the shape a reading wants
     them back. A layer with wording but no kinds and no answers to recover them
     from is treated as unasked rather than half-asked — there is nothing to be
     done about that except read it afresh. */
  function settledQuestions(layer, rows) {
    var labels = (layer && layer.keyLabels) || {};
    var kinds = (layer && layer.keyKinds) || {};
    return Object.keys(labels)
      .filter(isQuestionColumn)
      .sort(function (a, b) { return Number(a.split("_")[1]) - Number(b.split("_")[1]); })
      .map(function (col) {
        return { question: labels[col], kinds: kinds[col] || kindsSeenIn(rows, col) };
      })
      .filter(function (q) { return q.question && q.kinds.length; });
  }

  return {
    MAX_KINDS_KEPT: MAX_KINDS_KEPT,
    isAnswerColumn: isAnswerColumn,
    isQuestionColumn: isQuestionColumn,
    wordColumns: wordColumns,
    schemaFor: schemaFor,
    withoutAnswers: withoutAnswers,
    shapeReading: shapeReading,
    kindsSeenIn: kindsSeenIn,
    settledQuestions: settledQuestions,
  };
});
