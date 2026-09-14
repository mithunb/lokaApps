/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* Asking a question of your own. No network — the model is a stub. */
import fs from 'node:fs';
import * as E from '../api/lib/atlas/enrich.js';
const feats = JSON.parse(fs.readFileSync(ROOT + '/test/fixtures/blr.geojson','utf8')).features;
const rows = feats.map((f) => { const p = {...f.properties}; for (const k of Object.keys(p)) if (/^pattern_/.test(k)) delete p[k]; return p; });
const fields = ['description', 'categories', 'labels'];

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

console.log('\n  working out what the answers look like');
let seen = '';
const digest = E.buildDigest(rows, fields);
const stub = (reply) => async (m, p, sc, o) => { seen = p; return reply; };

let r = await E.proposeKinds({ digest, question: 'Is it free to visit?', title: 'LOKA x Bengaluru',
  model: 'stub', alreadyKeyed: [{ column: 'categories', words: ['Culture', 'Nature'] }],
  callJSON: stub({ verdict: 'kinds', kinds: [
    { name: 'Free', definition: 'Places that', examples: [1,2,3] },
    { name: 'Ticketed', definition: 'Places that', examples: [4,5,6] }] }) });
check('the kinds come back', r.verdict, 'kinds');
check('named as the model gave them', r.kinds.map((k) => k.name), ['Free', 'Ticketed']);
check('the question is quoted to the model, not reworded',
  /has asked their own question of these 66 places: "Is it free to visit\?"/.test(seen), true);
check('and it is told the question is not its to change',
  /the question itself is settled and not yours to reword/.test(seen), true);
check('it is told what an answer becomes', /becomes a colour and a shape on the map/.test(seen), true);
check('and what the map already sorts by', /already sorts places by its categories/.test(seen), true);
check('the closed list is there too', /CLOSED list of 10/.test(seen), true);

console.log('\n  when the places cannot answer it');
r = await E.proposeKinds({ digest, question: 'How deep is the well?', title: 'T', model: 'stub',
  callJSON: stub({ verdict: 'cannot_answer', note: 'nothing here mentions a well' }) });
check('it says so plainly', r.verdict, 'cannot_answer');
check('and why', r.note, 'nothing here mentions a well');
check('the model is told that is a welcome answer',
  /That is a correct and welcome answer/.test(seen), true);

console.log('\n  one kind is not a colouring');
r = await E.proposeKinds({ digest, question: 'Is it a place?', title: 'T', model: 'stub',
  callJSON: stub({ verdict: 'kinds', kinds: [{ name: 'Yes', definition: 'd', examples: [1,2,3] }] }) });
check('so it is refused', r.verdict, 'cannot_answer');
check('in words a person can act on', /colour the map one colour/.test(r.note), true);

console.log('\n  the model refusing outright');
r = await E.proposeKinds({ digest, question: 'x', title: 'T', model: 'stub',
  callJSON: async () => { const e = new Error('the model refused (503)'); e.status = 503; throw e; } });
check('is told apart from a place that cannot answer', r.verdict, 'unavailable');

console.log('\n  the route, read from the code');
const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
check('three steps, not one', /phase === 'kinds'/.test(server) &&
  /phase === 'try' \|\| phase === 'keep'/.test(server), true);
/* the comment wraps, so the test must not care where the line breaks */
check('the try step answers rather than sampling',
  /This IS the\s+preview: the work is kept, not thrown away/.test(server), true);
check('and a sample was considered and refused, with the reason',
  /wrong by about a fifth at that size/.test(server), true);
/* A new question goes on the end; a repaired one goes back where it was, so
   the keys keep their order for anybody holding a link. */
check('a new question is added to the end',
  /if \(repairing\) all\[putRight\] = fresh; else all\.push\(fresh\);/.test(server), true);
check('a repaired one takes its own place back',
  /all\[putRight\] = fresh/.test(server), true);
check('which question is being put right comes from the column',
  /RULES\.isQuestionColumn\(String\(b\.replacing \|\| ''\)\)/.test(server), true);
/* The cap of five is gone: it was a guess made before anybody had five, and
   the first person to reach it was stopped from asking a sixth thing about
   their own places. Every question has a switch; how many is too many is
   visible to whoever made the map. */
check('nothing counts questions towards a limit',
  /MAX_QUESTIONS_ON_A_LAYER/.test(server), false);
check('an answer no place is using is still remembered',
  /count: tally\.get\(k\.name\) \|\| 0 \}\)\),/.test(server) &&
  !/\}\)\)\.filter\(\(c\) => c\.count > 0\)/.test(server), true);
check('the ones already there are read back rather than re-asked',
  /function questionsAsAnswered/.test(server), true);
check('and no wording tells somebody they have asked too many',
  /as many as a map can wear/.test(server), false);
check('a half-answered question does not live for ever', /ASK_TTL/.test(server), true);
check('and only an owner or collaborator may ask',
  /sign in as this atlas’s owner or a collaborator/.test(server.slice(server.indexOf("/layers/ask"))), true);

console.log('\n  the shelves, read from the code');
const owner = fs.readFileSync(ROOT + '/atlas/owner.js', 'utf8');
check('a visitor never gets a tab', /if \(!keyedLayers\(\)\.length\) return;/.test(owner), true);
check('the questions left the fold', /The questions used to be listed here/.test(owner), true);
check('the shelf says the share in words',
  /" of " \+ rows\.length \+ " places answer it"/.test(owner), true);
check('and shows what each question sorts into', /own-q-kinds/.test(owner), true);
check('asking walks three steps', /Work out the answers/.test(owner) &&
  /"Try it on " \+ allPlaces/.test(owner) && /Keep this question/.test(owner), true);
/* The copy said forty because forty is how many places are answered at a time
   inside the server. Every place is answered; on a map of two hundred it read
   "170 of the first 200 answered", which sounds like it stopped at two hundred. */
check('and counts the places there actually are, not a batch size',
  /forty/.test(owner.replace(/\/\*[\s\S]*?\*\//g, '')), false);
check('an answer can be added, not only reworded', /\+ Add an answer/.test(owner), true);
check('and one can be taken away', /own-ask-drop/.test(owner), true);
check('a question carries its answers so a repair can open on them',
  /kinds: \(\(L && L\.keyKinds\) \|\| \{\}\)\[c\] \|\| \[\]/.test(owner), true);
check('every question on the shelf can be put right',
  /if \(q\.kinds\.length\) line\.appendChild\(askBox\(L, q\)\)/.test(owner), true);
check('a repair shows what each place used to answer',
  /own-ask-eg-was/.test(owner), true);

console.log('\n  nothing an owner can press throws a reading away');
/* "Ask different questions" read every place again from nothing. Measured over
   ninety readings, a fresh set is good about two times in five, so the way out
   of a bad set was a throw of the dice — and it took the questions that were
   right with it. Repair replaced it. */
/* the comment that replaced it still names it, so read the code alone */
const ownerCode = owner.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
check('the door is gone', /Ask different questions/.test(ownerCode), false);
check('and so is its confirmation', /"Ask again"/.test(ownerCode), false);
check('and nothing asks for a fresh set from the map',
  /askQuestions\(L, feats, true\)/.test(owner), false);
check('the only call left keeps the settled questions',
  (owner.match(/askQuestions\(L, feats, (true|false)/g) || []), ['askQuestions(L, feats, false']);
check('the operator can still ask for one',
  /b\.afresh === true/.test(server), true);
check('each step says what it is waiting for',
  /about half a minute/.test(owner), true);
check('the proposed answers can be edited before anything is read',
  /own-ask-kind/.test(owner), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
