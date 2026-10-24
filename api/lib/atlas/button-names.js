/* Names for Explore buttons made from an atlas's own analysis ("smart
   buttons", Mithun, 24 October 2026).

   Which question the buttons come from, and which answers go under which
   button, is a fixed rule with no model in it (atlas/explore-mode.js
   pickQuestion / smartButtons — the same code the owner's page runs). What a
   model adds is only the words on the buttons: "Observation or habitat" plus
   "Wildlife sighting" might read "Nature & wildlife". One small call for all
   of an atlas's buttons, checked button by button; a name that fails, or no
   answer at all, gives the plain name (fallbackNames: the first answer, "or …"
   dropped, cut at a word to 20 letters) and a picture by keyword.

   The buttons are worked out again whenever the atlas's reading is written
   (api/apps/atlas.js, after commitLayer's fromReading write) — only for an
   atlas in Explore whose buttons came from the analysis and that the owner has
   not edited since (shouldRework). Nothing here talks to the model or writes a
   file; atlas.js makes the call (aiCaller, the server's allowance) and writes
   the overlay. */

import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const XM = createRequire(import.meta.url)(path.join(HERE, '..', '..', '..', 'atlas', 'explore-mode.js'));

const MAX_LABEL = XM.MAX_LABEL;
// pictures a model may give: every one an owner may choose
export const ICONS = XM.ICON_CHOICES.slice();
// plain words: letters, numbers, spaces and a little punctuation; no quotes, no emoji, no code
const PLAIN = /^[\p{L}\p{M}\p{N}](?:[\p{L}\p{M}\p{N} &'’,.\-]*[\p{L}\p{M}\p{N}.])?$/u;

/* What the buttons are made of, for the model and for the fingerprint: each
   button's answers with their definitions, how many places, a few names. */
export function groupsOf(smart) {
  const q = smart && smart.question;
  return ((q && q.groups) || []).map((g) => ({
    names: g.names.slice(),
    definitions: (g.definitions || []).slice(),
    count: g.count,
    examples: (g.examples || []).slice(0, 3),
  }));
}

// the fingerprint of what is being named: the column and its answer groups
export function buttonsSig(column, groups) {
  return crypto.createHash('sha1')
    .update(String(column) + '\u0003' + (groups || []).map((g) => g.names.join('\u0002')).join('\u0001'))
    .digest('hex').slice(0, 20);
}

export function promptFor(question, groups, title) {
  return [
    'A map' + (title ? ' called "' + title + '"' : '') + ' has buttons that show its places by their answer to the question: "' + question + '".',
    'Each button below holds one or more answers. Give each button a short name a visitor understands at a glance:',
    'plain everyday words, at most ' + MAX_LABEL + ' letters, no jargon, no quotes, no emoji. Names should be different from each other.',
    'You may join two ideas with "&" (for example "Art & history"). Also choose one picture for each button from: ' + ICONS.join(', ') + '.',
    'Answer for every button, giving its number as "group".',
    JSON.stringify({ buttons: (groups || []).map((g, i) => ({
      group: i,
      places: g.count,
      answers: g.names.map((n, j) => ({ answer: n, means: String((g.definitions || [])[j] || '').slice(0, 200) })),
      examples: g.examples,
    })) }),
  ].join('\n');
}

export function schemaFor(Type) {
  return {
    type: Type.OBJECT,
    required: ['buttons'],
    properties: {
      buttons: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ['group', 'label', 'icon'],
          properties: {
            group: { type: Type.INTEGER },
            label: { type: Type.STRING },
            icon: { type: Type.STRING, enum: ICONS },
          },
        },
      },
    },
  };
}

export function fallbackNames(groups) {
  return XM.fallbackNames(groups || []);
}

/* The model's answer, checked button by button. A name that is empty, over 20
   letters, not plain words, or the same as an earlier button's gives way to
   the plain name; a picture not on the list to the plain one. */
export function cleanNames(answer, groups) {
  const plain = fallbackNames(groups);
  const list = answer && Array.isArray(answer.buttons) ? answer.buttons : [];
  const said = {};
  list.forEach((b, i) => {
    if (!b || typeof b !== 'object') return;
    const k = Number.isInteger(b.group) && b.group >= 0 && b.group < plain.length ? b.group : i;
    if (said[k] === undefined) said[k] = b;
  });
  let fromModel = 0;
  const seen = {};
  const names = plain.map((p, i) => {
    const b = said[i] || {};
    let label = typeof b.label === 'string' ? b.label.replace(/\s+/g, ' ').trim() : '';
    const ok = label && Array.from(label).length <= MAX_LABEL && PLAIN.test(label) && !seen[label.toLowerCase()];
    if (!ok) label = p.label;
    else fromModel++;
    seen[label.toLowerCase()] = true;
    const icon = ICONS.includes(b.icon) ? b.icon : p.icon;
    return { label, icon };
  });
  return { names, fromModel };
}

// the stand-in's answer (no model): the plain names, so a check can predict them
export function standInAnswer(groups) {
  return { buttons: fallbackNames(groups).map((n, i) => ({ group: i, label: n.label, icon: n.icon })) };
}

/* Should the buttons of this atlas be worked out again now that its reading
   has been written? Only for an atlas in Explore, on this layer, whose buttons
   came from the analysis and that the owner has not edited — never the
   operator's own atlas. Answers true or a reason. */
export function shouldRework(dataset, local, layerId, neverRead) {
  if (neverRead && neverRead.has && neverRead.has(dataset)) return 'never touched';
  const m = local && local.mode;
  if (!m || typeof m !== 'object' || m.name !== 'explore') return 'not in Explore';
  if (m.buttonsFrom !== 'analysis') return 'buttons not from the analysis';
  if (m.buttonsEdited) return 'edited by the owner';
  if (layerId && m.layer && m.layer !== layerId) return 'another layer';
  return true;
}

/* The buttons from the analysis, named. `call` is the budgeted model caller
   (aiCaller) or null; `prev` the mode in use, whose names are kept, with no
   call, when the same answers make the same buttons (buttonsSig). Never
   throws: any trouble gives the plain names. Answers
   { tagColumn, buttons, buttonsSig, by } or null when no question qualifies. */
/* `prev` may also carry analysisNames: { sig, buttons: [{ label, icon }] },
   the last names LOKA gave these answers (never the owner's own edits),
   kept in the mode through Group by, edits and modeKept — so the model is
   asked again only when the answers change. Answers carry analysisNames to
   keep: the new names when the model gave them, else the old ones. */
export async function nameSmartButtons({ layer, features, prev, call, model, Type, title, timeoutMs }) {
  const smart = XM.smartButtons(layer, features);
  if (!smart) return null;
  const groups = groupsOf(smart);
  const sig = buttonsSig(smart.tagColumn, groups);
  const topics = smart.buttons.filter((b) => !b.rest);
  const restOf = smart.buttons.filter((b) => b.rest)[0] || null;
  let names = null, by = 'plain';
  const cache = prev && prev.analysisNames;
  const cached = cache && cache.sig === sig && Array.isArray(cache.buttons) && cache.buttons.length === topics.length &&
    cache.buttons.every((b) => b && typeof b.label === 'string' && b.label && XM.ICON_CHOICES.includes(b.icon)) ? cache.buttons : null;
  const prevTopics = !cached && prev && prev.buttonsFrom === 'analysis' && !prev.buttonsEdited && prev.buttonsSig === sig
    ? (prev.buttons || []).filter((b) => b && !b.rest) : null;
  if (cached) {
    names = cached.map((b) => ({ label: b.label, icon: b.icon }));
    by = 'kept';
  } else if (prevTopics && prevTopics.length === topics.length) {
    names = prevTopics.map((b) => ({ label: b.label, icon: b.icon }));
    by = 'kept';
  } else if (call) {
    try {
      const ask = call(model, promptFor(smart.question.question, groups, title || ''), schemaFor(Type), { file: true });
      let timer = null;
      const wait = new Promise((_, no) => { timer = setTimeout(() => no(new Error('the model took too long')), timeoutMs || 25000); });
      const answer = await Promise.race([ask, wait]).finally(() => clearTimeout(timer));
      const got = cleanNames(answer, groups);
      names = got.names;
      by = got.fromModel ? 'model' : 'plain';
    } catch (e) {
      names = null;
      by = 'plain (' + String((e && e.message) || 'no answer').slice(0, 80) + ')';
    }
  }
  if (!names) names = fallbackNames(groups);
  let buttons = topics.map((b, i) => ({ ...b, label: names[i].label, icon: names[i].icon }));
  // the owner's own name for Odds & ends, once given, is kept
  const prevRest = prev && (prev.buttons || []).filter((b) => b && b.rest)[0];
  if (restOf) buttons.push(XM.restButton(prevRest && prevRest.label));
  // colours follow the pictures the names came with
  buttons = XM.colourButtons(buttons);
  // what is kept for next time: names LOKA gave (kept or the model's), never a failure's stand-in
  const keep = by === 'kept' || by === 'model' ? { sig, buttons: names.map((n) => ({ label: n.label, icon: n.icon })) }
    : (cache && typeof cache === 'object' ? cache : undefined);
  return { tagColumn: smart.tagColumn, buttons, buttonsSig: sig, by, question: smart.question.question, analysisNames: keep };
}
