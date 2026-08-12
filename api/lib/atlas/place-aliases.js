// Place-name aliases for the geography search box.
//
// geoBoundaries mostly carries pre-renaming spellings (Bangalore, Mysore,
// Tumkur…) while people type the names they actually use (Bengaluru, Mysuru,
// Tumakuru…) — and inconsistently so even within one country: India's ADM2
// says "Bangalore" but ADM3 says "Bengaluru North". A search that only knows
// one spelling strands the user either way, so every group below works in
// BOTH directions: any spelling in a group finds units stored under any other.
//
// To extend: add a row (or a spelling to an existing row). Order within a row
// doesn't matter, casing/diacritics don't matter (keys are norm()ed), and rows
// that share a spelling merge automatically — no other bookkeeping.
//
// This is deliberately separate from the ALIAS table in lib/matching.js: that
// one canonicalises names during data joins (typos, transliteration drift);
// this one records official renamings for interactive search, where we must
// also REPORT which spelling the data uses, not silently rewrite the query.
import { norm } from '../matching.js';

const GROUPS = [
  // Karnataka's 2014 batch of renamings
  ['Bengaluru', 'Bangalore'],
  ['Mysuru', 'Mysore'],
  ['Tumakuru', 'Tumkur'],
  ['Belagavi', 'Belgaum'],
  ['Hubballi', 'Hubli'],
  ['Shivamogga', 'Shimoga'],
  ['Ballari', 'Bellary'],
  ['Vijayapura', 'Bijapur'],
  ['Kalaburagi', 'Gulbarga'],
  ['Chikkamagaluru', 'Chikmagalur'],
  // metros & other cities
  ['Mumbai', 'Bombay'],
  ['Chennai', 'Madras'],
  ['Kolkata', 'Calcutta'],
  ['Kochi', 'Cochin'],
  ['Thiruvananthapuram', 'Trivandrum'],
  ['Vadodara', 'Baroda'],
  ['Prayagraj', 'Allahabad'],
  ['Varanasi', 'Benares'],
  ['Gurugram', 'Gurgaon'],
  // states & union territories (Puduchcheri is geoBoundaries' own ADM3/4 variant)
  ['Puducherry', 'Puduchcheri', 'Pondicherry'],
  ['Odisha', 'Orissa'],
  ['Uttarakhand', 'Uttaranchal'],
];

// norm(spelling) -> Set of every normalised spelling in its (merged) group.
// All members of a group share ONE Set instance, which is what makes rows
// that overlap (e.g. two rows both mentioning "Pondicherry") merge transitively.
const BY_NORM = new Map();
for (const group of GROUPS) {
  const normed = group.map(norm).filter(Boolean);
  let set = null;
  for (const n of normed) if (BY_NORM.has(n)) { set = BY_NORM.get(n); break; }
  if (!set) set = new Set();
  for (const n of normed) {
    const prev = BY_NORM.get(n);
    if (prev && prev !== set) for (const m of prev) set.add(m); // bridge two existing groups
    set.add(n);
  }
  for (const m of set) BY_NORM.set(m, set);
}

/**
 * Every normalised spelling equivalent to `name`, the name's own norm first —
 * callers use position 0 to tell "matched as typed" from "matched via alias".
 * Unknown names just return [norm(name)], so callers never need a special case.
 */
export function aliasSpellings(name) {
  const n = norm(name);
  const set = BY_NORM.get(n);
  return set ? [n, ...[...set].filter((m) => m !== n)] : [n];
}
