/* A made-up sheet of 120 recording sites, shaped like the plain spreadsheet the
 * rules in test/column-shapes-test.mjs were learnt from (28 Nov 2026) — and
 * none of its data: every name here is invented.
 *
 *   name               the site
 *   state              one of 12 made-up states; the sites of a state sit together on the map
 *   habitat            30 spellings of three kinds of habitat, filled on under half the sites
 *   gear               a word or two a site (14 values): a second short column, read with habitat
 *   animal_groups      "Birds; Mammals" — a short closed list
 *   main_animal_group  one of four groups: a plain key
 *   animals_heard      a list of 1 to 20 animals joined by "; "
 *   species_count      how long that list is — a number
 *   recordings         a number
 *   first_recorded     a date
 *   source             the same on every site
 *
 * No prose anywhere. Also here: a stand-in model that answers each column from
 * its own words, the way a real reading answered the real sheet. No network. */

export const STATES = ['North Vale', 'Reedland', 'Stonemoor', 'Eastmarch', 'Low Fen', 'Pinehold',
  'Saltreach', 'Highwater', 'West Barrow', 'Greywold', 'Fernside', 'Oxmere'];
export const HABITATS = {
  Forest: ['Dry forest', 'forest edge', 'Evergreen Forest', 'Forest', 'old forest path', 'Pine forest', 'burnt forest', 'Forest stream', 'mixed forest', 'riverine forest'],
  Wetland: ['Marsh', 'reed marsh', 'Lake shore', 'lake', 'Salt marsh', 'flooded field marsh', 'Pond', 'tank bund pond', 'Marsh edge', 'village pond'],
  'Open country': ['Grassland', 'scrub', 'Thorn scrub', 'fallow grassland', 'Pasture scrub', 'rocky scrub', 'Grass hill grassland', 'open scrub', 'farm edge scrub', 'Dry grassland'],
};
const HABITAT_KINDS = Object.keys(HABITATS);
export const GROUPS = {
  Birds: ['Sunbird', 'Drongo', 'Koel', 'Barbet', 'Brown Hawk Owl', 'Tailorbird', 'Bulbul', 'Magpie Robin', 'Coucal', 'Oriole', 'Iora', 'Babbler'],
  Mammals: ['Macaque', 'Giant Squirrel', 'Jackal', 'Langur'],
  Frogs: ['Bush Frog', 'Tree Frog', 'Bull Frog', 'Cricket Frog'],
  Insects: ['Cicada', 'Field Cricket', 'Katydid', 'Mole Cricket'],
};
const GROUP_NAMES = Object.keys(GROUPS);
export const GROUP_AS = { Birds: 'Feathered', Mammals: 'Furred', Frogs: 'Small and loud', Insects: 'Small and loud' };
const ALL_ANIMALS = GROUP_NAMES.flatMap((g) => GROUPS[g]);
const GEAR = ['handheld', 'parabolic mic', 'phone', 'song meter', 'shotgun mic', 'lapel mic', 'field recorder',
  'phone app', 'stereo pair', 'hydrophone', 'bat detector', 'camera mic', 'dictaphone', 'array'];
const rotate = (list, by) => list.map((_, k) => list[(k + by) % list.length]);
export const groupOf = (animal) => GROUP_NAMES.find((g) => GROUPS[g].includes(animal)) || '';

export function soundSites() {
  const rows = [];
  for (let i = 0; i < 120; i++) {
    const s = i % STATES.length;
    const main = i % 10 < 5 ? 'Birds' : i % 10 < 7 ? 'Mammals' : i % 10 < 9 ? 'Frogs' : 'Insects';
    const size = 1 + ((i * 7) % 20);
    const mine = rotate(GROUPS[main], i);
    const heard = mine.concat(rotate(ALL_ANIMALS.filter((a) => !mine.includes(a)), i)).slice(0, size);
    const groups = [...new Set(heard.map(groupOf))];
    const kind = HABITAT_KINDS[i % 3];
    rows.push({
      name: 'Site ' + (i + 1),
      state: STATES[s],
      habitat: i % 9 < 4 ? HABITATS[kind][(i * 3) % 10] : '',
      gear: GEAR[i % GEAR.length],
      animal_groups: groups.join('; '),
      main_animal_group: main,
      animals_heard: heard.join('; '),
      species_count: String(size),
      recordings: String(3 + ((i * 13) % 40)),
      first_recorded: '2024-0' + (1 + (i % 9)) + '-1' + (i % 9),
      source: 'Listening survey',
      // each state's sites sit round its own centre, three degrees from the next
      latitude: 10 + 3 * Math.floor(s / 4) + (((i * 37) % 100) / 100 - 0.5) * 1.6,
      longitude: 72 + 3 * (s % 4) + (((i * 53) % 100) / 100 - 0.5) * 1.6,
    });
  }
  return rows;
}

const kindsOf = (names, at = 0) => names.map((name, k) => ({ name, definition: 'Places that', examples: [at + k + 1, at + k + 11, at + k + 21] }));
const found = (questions) => ({ verdict: 'questions', reading: 'Recording sites and what was heard at them.', facts: ['what was heard'], questions });

/* What the finder says of each column — the questions the real reading wrote
   for the real sheet, and two more a model could as easily write. */
export const ASKED = {
  state: 'Which state is this place in?',
  animal: 'What kind of animal is heard here?',
  howMany: 'How many different species are heard here?',
  rich: 'How rich is the soundscape here?',
  group: 'Which group of animals is this place known for?',
  habitat: 'What kind of habitat is this place?',
};
export function soundModel(log = {}) {
  log.finder = []; log.answers = [];
  return async (model, prompt, schema, o) => {
    if (schema && schema.properties && schema.properties.checks) return { checks: [] };
    if (o && o.think) {
      log.finder.push(prompt);
      const one = (prompt.match(/ONE column of its data, called "([^"]+)"/) || [])[1] || '';
      const together = /columns of its data say/.test(prompt);
      if (one === 'animals_heard') {
        return found([
          { question: ASKED.animal, kinds: kindsOf(['Sunbird', 'Drongo', 'Koel', 'Barbet']) },
          { question: ASKED.howMany, kinds: kindsOf(['One species', 'Two to four', 'Five to ten']) },
          { question: ASKED.rich, kinds: kindsOf(['Sparse', 'Moderate', 'Rich']) },
          // the plain main_animal_group column over again, in other words and with two of its groups merged
          { question: ASKED.group, kinds: kindsOf(Object.values(GROUP_AS).filter((v, k, all) => all.indexOf(v) === k)) },
        ]);
      }
      if (one === 'state' || (together && /"state"/.test(prompt))) {
        return found([
          { question: ASKED.state, kinds: kindsOf(STATES.slice(0, 7).concat(['Other States'])) },
          { question: ASKED.habitat, kinds: kindsOf(HABITAT_KINDS.concat(['Other habitats'])) },
        ]);
      }
      if (one === 'habitat' || (together && /"habitat"/.test(prompt))) {
        return found([{ question: ASKED.habitat, kinds: kindsOf(HABITAT_KINDS.concat(['Other habitats'])) }]);
      }
      return { verdict: 'no_clear_questions', note: '' };
    }
    log.answers.push(prompt);
    const qs = [...prompt.matchAll(/^q(\d+) — (.*?)(?:   \(asked of the (.+?) columns? only\))?$/gm)].map((x) => [Number(x[1]), x[2]]);
    const kindsUnder = (n) => {
      const block = (prompt.split(new RegExp('^q' + n + ' — ', 'm'))[1] || '').split(/\n\n/)[0];
      return block.split('\n').slice(1).map((l) => l.trim().split(' — ')[0]).filter(Boolean);
    };
    const blocks = prompt.split(/\n(?=\d+\. )/).filter((b) => /^\d+\. /.test(b));
    return { rows: blocks.map((b) => {
      const i = Number(b.match(/^(\d+)\./)[1]);
      const r = { i };
      // the animals on this line, in the order written (a list is shown as tags)
      const heard = ALL_ANIMALS.map((a) => [b.indexOf(a), a]).filter(([at]) => at >= 0).sort((x, y) => x[0] - y[0]).map(([, a]) => a);
      for (const [n, wording] of qs) {
        const offered = kindsUnder(n);
        const give = (kind, words) => { if (offered.includes(kind)) { r['q' + n] = kind; r['w' + n] = words; } else r['q' + n] = 'other'; };
        if (wording === ASKED.state) {
          const state = STATES.find((s) => b.includes(s));
          // the model cites WORDS: "North" and "Vale" for North Vale
          if (state) give(offered.includes(state) ? state : 'Other States', state.split(' '));
        } else if (wording === ASKED.animal) {
          const first = heard.find((a) => offered.includes(a));
          if (first) give(first, first.split(' ').slice(0, 2));
        } else if (wording === ASKED.howMany || wording === ASKED.rich) {
          if (!heard.length) continue;
          const names = wording === ASKED.howMany ? ['One species', 'Two to four', 'Five to ten'] : ['Sparse', 'Moderate', 'Rich'];
          give(heard.length === 1 ? names[0] : heard.length <= 4 ? names[1] : names[2], [heard[0].split(' ')[0]]);
        } else if (wording === ASKED.group) {
          if (heard.length) give(GROUP_AS[groupOf(heard[0])], heard[0].split(' ').slice(0, 2));
        } else if (wording === ASKED.habitat) {
          const kind = HABITAT_KINDS.find((k) => HABITATS[k].some((h) => b.includes(h)));
          const written = kind && HABITATS[kind].filter((h) => b.includes(h)).sort((x, y) => y.length - x.length)[0];
          if (kind) give(kind, written.split(' ').slice(0, 3));
        }
      }
      return r;
    }) };
  };
}
