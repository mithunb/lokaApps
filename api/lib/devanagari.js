// Devanagari place names, spelt the way the English boundary lists spell them.
//
// A name written in Hindi or Marathi script used to normalise to nothing:
// norm("देवरिया") was "" (measured), so a column of Devanagari names placed no
// row at all. This is a plain table, no model and no dependency: each letter
// becomes the Latin letters the Hunterian convention (the one LGD, the census
// and geoBoundaries all descend from) writes it as, then the inherent "a" that
// Devanagari does not write is dropped where Hindi does not say it.
//
// English spellings of Indian places are not a function of the script, though.
// देवरिया is Deoria, not Devriya; मेरठ is Meerut. So there are three readings of
// one name, each used by a different stage of the matcher:
//   transliterate()  one best guess, for a key and for a similarity score
//   variants()       the handful of spellings the guess could equally be
//                    (v/w, dev/deo, iya/ia, schwa kept or dropped), tried as
//                    exact keys
//   skeleton()       a lossy form applied to BOTH sides, so "Deoria" and
//                    "devriya" meet in the middle without either being wrong
// None of this touches a name that has no Devanagari in it; the Latin path
// through the matcher is byte-for-byte what it was.

const RANGE = /[\u0900-\u097F]/;
export function hasDevanagari(s) { return RANGE.test(String(s || '')); }

const CONSONANT = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'ळ': 'l',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
  // precomposed nukta forms (NFC decomposes these, but a raw string may carry them)
  'क़': 'q', 'ख़': 'kh', 'ग़': 'gh', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f', 'य़': 'y',
};
// the same letters with a nukta dot under them — Persian/Arabic sounds
const NUKTA = { 'क': 'q', 'ख': 'kh', 'ग': 'gh', 'ज': 'z', 'ड': 'r', 'ढ': 'rh', 'फ': 'f', 'य': 'y' };
const VOWEL = {            // independent vowels, written at a word or syllable start
  'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ऋ': 'ri', 'ऌ': 'l',
  'ऍ': 'e', 'ऎ': 'e', 'ए': 'e', 'ऐ': 'ai', 'ऑ': 'o', 'ऒ': 'o', 'ओ': 'o', 'औ': 'au',
};
const SIGN = {             // vowel signs, written on a consonant
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri', 'ॄ': 'ri', 'ॢ': 'l',
  'ॅ': 'e', 'ॆ': 'e', 'े': 'e', 'ै': 'ai', 'ॉ': 'o', 'ॊ': 'o', 'ो': 'o', 'ौ': 'au',
};
const VIRAMA = '\u094D', NUKTA_SIGN = '\u093C', ANUSVARA = '\u0902', CHANDRABINDU = '\u0901', VISARGA = '\u0903';
const DIGITS = '०१२३४५६७८९';

/* Read a word into syllables: {c, v, n} — consonant letters, vowel letters
   ('' after a virama), nasal after it. `inherent` marks a vowel nobody wrote. */
function syllables(word) {
  const out = [];
  const chars = Array.from(word.normalize('NFC'));
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '\u200C' || ch === '\u200D' || ch === '\u093D') continue; // joiners, avagraha
    if (ch in CONSONANT) {
      let c = CONSONANT[ch];
      if (chars[i + 1] === NUKTA_SIGN) { c = NUKTA[ch] || c; i++; }
      const s = { c, v: 'a', n: '', inherent: true };
      const next = chars[i + 1];
      if (next === VIRAMA) { s.v = ''; s.inherent = false; i++; }
      else if (next in SIGN) { s.v = SIGN[next]; s.inherent = false; i++; }
      out.push(s);
      continue;
    }
    if (ch in VOWEL) { out.push({ c: '', v: VOWEL[ch], n: '', inherent: false }); continue; }
    if (ch === ANUSVARA || ch === CHANDRABINDU) {
      if (out.length) out[out.length - 1].n = 'n';
      continue;
    }
    if (ch === VISARGA) { if (out.length) out[out.length - 1].n += 'h'; continue; }
    const d = DIGITS.indexOf(ch);
    if (d >= 0) { out.push({ c: String(d), v: '', n: '', inherent: false, digit: true }); continue; }
    // anything else (Latin, punctuation) passes through untouched
    out.push({ c: ch, v: '', n: '', inherent: false, other: true });
  }
  // anusvara before a lip consonant is written m: कौशाम्बी Kaushambi, चम्पारण Champaran
  // and before ह it is the ng of सिंह Singh
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].n === 'n' && /^(p|b|bh|ph|m)/.test(out[i + 1].c)) out[i].n = 'm';
    else if (out[i].n === 'n' && out[i + 1].c === 'h') out[i].n = 'ng';
  }
  return out;
}

/* Which unwritten "a"s Hindi actually says. Right to left: the last one is
   silent (नगर is nagar, not nagara); one between two spoken vowels is silent
   (गोरखपुर is gorakhpur, not gorakhapur); the first syllable always keeps
   its vowel. `keep` is true for the variant that drops none but the last. */
function spell(syls, keep) {
  const spoken = syls.map((s) => s.v !== '');
  for (let i = syls.length - 1; i >= 0; i--) {
    const s = syls[i];
    if (!s.inherent) continue;
    const last = i === syls.length - 1 || syls[i + 1].other;
    const first = i === 0 || syls[i - 1].other;
    if (last && !s.n) { spoken[i] = false; continue; }
    if (first || keep) continue;
    const prevSpoken = spoken[i - 1], nextSpoken = spoken[i + 1];
    // a conjunct's first half never carries the vowel: स्त is st, so the syllable before it stays open
    if (prevSpoken && nextSpoken && !s.n) spoken[i] = false;
  }
  return syls.map((s, i) => s.c + (spoken[i] ? s.v : '') + s.n).join('');
}

/* One best-guess Latin spelling of a Devanagari string. Latin letters and
   punctuation already in the string pass through where they stand. */
export function transliterate(s, o) {
  return String(s || '').split(/(\s+)/).map((w) => (RANGE.test(w) ? spell(syllables(w), o && o.keepSchwa) : w)).join('');
}

/* The spellings the guess could equally be. Each swap is a convention English
   is inconsistent about, so each is tried as an exact key before anything
   fuzzy runs. Capped: a long name with every swap available is still a
   handful of lookups, not an explosion. */
const SWAPS = [
  [/v/g, 'w'],                       // Siwan / Sivan, Alwar / Alvar
  [/dev(?=[^aeiou])/g, 'deo'],       // Deoria, Deoghar, Deoband
  [/(?<=[^aeiou])av$/g, 'ao'],       // Unnao
  [/iya$/g, 'ia'],                   // Ballia, Purnia
  [/anv$/g, 'aon'],                  // Gurgaon, Rajnandgaon
  [/(?<=[^aeiou])ay(?=[^aeiou]|$)/g, 'ai'], // Jaipur, Udaipur, Begusarai
  [/ch/g, 'chh'],                    // छ written ch as often as chh
];
export function variants(s) {
  const seen = new Set();
  const base = [transliterate(s), transliterate(s, { keepSchwa: true })];
  let pool = base;
  for (const [re, to] of SWAPS) {
    const more = [];
    for (const p of pool) { const q = p.replace(re, to); if (q !== p) more.push(q); }
    pool = pool.concat(more);
    if (pool.length > 48) break;
  }
  const out = [];
  for (const p of pool) { if (!seen.has(p)) { seen.add(p); out.push(p); } }
  return out;
}

/* A lossy Latin form for comparing a transliteration with an English
   spelling. The same reductions on both sides, so what it loses it loses
   equally: the short "a" that Devanagari leaves unwritten and English writes
   or not by habit; v and w; the o that English uses for a v between vowels;
   the vowel pairs (au/o, ai/ei/e, ee/i) that Hunterian and everyday spelling
   disagree on; doubled letters; a silent final h. Latin-only names never
   go through here — the exact and dice stages see them untouched. */
export function skeleton(latin) {
  let s = String(latin || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!s) return '';
  s = s.replace(/ph/g, 'f').replace(/chh/g, 'ch').replace(/w/g, 'v');
  s = s.replace(/(?<=[aeiou])h$/, '');                 // Etawah
  s = s.replace(/n(?=v$)/, '').replace(/av$/, 'ao');   // Gurgaon, Unnao
  s = s.replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/au/g, 'o').replace(/ai|ei|ae/g, 'e').replace(/(?<=[^aeiou])ay/g, 'e');
  s = s.replace(/iy/g, 'i').replace(/y(?=[aeiou])/g, '').replace(/y$/, 'i');
  s = s.replace(/(.)(?=\1)/g, '');                     // doubled letters
  s = s.replace(/(?<=[a-z0-9])a/g, '');                // every "a" but a leading one
  s = s.replace(/(?<=[eiou])v(?=[^aeiou]|$)/g, 'o');   // Deoria, Deoghar
  s = s.replace(/(?<=[^aeiou])e$/, '').replace(/e/g, 'i'); // Indore, Sehore, Rewa
  s = s.replace(/(?<=[iou])n$/, '');                   // Jalgaon / Jalgav, Jhunjhunu / Jhunjhunun
  s = s.replace(/(.)(?=\1)/g, '');
  return s;
}
