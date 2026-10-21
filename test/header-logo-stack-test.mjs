// With a logo, the header stacks: logo, then the organisation's name, then the title (Mithun, 2026-10-21).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'atlas', 'index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (label, got, want) => { if (got === want) { pass++; console.log('  PASS  ' + label); } else { fail++; console.log('  FAIL  ' + label + '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)); } };
check('with a logo the header is one column', /\.org-head:has\(\.org-brand-logo\) \{ grid-template-columns:minmax\(0,1fr\);/.test(html), true);
check('the logo on the first row', /\.org-head:has\(\.org-brand-logo\) \.org-brand-logo \{ grid-column:1; grid-row:1;/.test(html), true);
check('the organisation name under it', /\.org-head:has\(\.org-brand-logo\) \.org-brand-line > span \{ grid-column:1; grid-row:2; \}/.test(html), true);
check('the title under that, and larger', /\.org-head:has\(\.org-brand-logo\) #atlas-title \{ grid-column:1; grid-row:3; font-size:1\.45rem; \}/.test(html), true);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
