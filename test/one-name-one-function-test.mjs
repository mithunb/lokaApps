/* Run me with: node test/run.mjs — or on my own with node.
 *
 * One name, one function.
 *
 * The atlas's browser scripts are each one long file wrapped in a single
 * function, and a function declared twice under the same name in the same
 * place does not fail: the later one silently replaces the earlier, everywhere
 * in that file, including above it. That is how the Questions tab went blank
 * for every owner. The shelf asked placesOf(layer) for a list of places; a
 * second placesOf(layer, then) added much later for the "Identify each place
 * by" choice took its place, and the shelf stopped half-way through drawing
 * because it had not passed the second argument.
 *
 * So this reads every script the atlas page loads and refuses any name declared
 * as a function twice in the same scope. No parser is installed, so it walks
 * the text itself — skipping strings, comments and patterns — and it also
 * checks that walk comes out level at the end of each file, so a mistake in the
 * walk shows up here rather than as a silent pass.
 *
 * No network. Reads the product's own files only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

/* Returns { dupes: ["name (lines a, b)"], level: true|false }. A scope is a
   function body; blocks inside it share its scope, which is how a browser
   treats a function declared in a block of a non-strict script. */
function repeats(src) {
  const REGEX_AFTER = /[(,=:[!&|?{};+\-*%<>~^]$|^$|\b(return|typeof|case|do|else|in|of|new|delete|void|throw)$/;
  let i = 0, line = 1, prev = '';
  const braces = [];            // for each open {, whether it opens a function body
  const scopes = [new Map()];   // names declared in each open function body
  let wantBody = false, parenDepth = 0, paramsFrom = -1;
  const dupes = [];
  const word = /[A-Za-z_$][\w$]*/y;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      for (let k = i; k < end; k++) if (src[k] === '\n') line++;
      i = end + 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      // template literals with ${…} holding braces are rare in these files and
      // would unbalance the walk; the level check below would say so
      i++;
      while (i < src.length && src[i] !== c) { if (src[i] === '\\') i++; else if (src[i] === '\n') line++; i++; }
      i++; prev = 'str'; continue;
    }
    if (c === '/' && REGEX_AFTER.test(prev)) {
      i++; let cls = false;
      while (i < src.length) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '[') cls = true; else if (d === ']') cls = false;
        else if (d === '/' && !cls) break;
        i++;
      }
      i++; while (/[a-z]/.test(src[i] || '')) i++;
      prev = 're'; continue;
    }
    word.lastIndex = i;
    const w = word.exec(src);
    if (w) {
      const tok = w[0];
      i += tok.length;
      if (tok === 'function') {
        // a declaration only where a statement can start; `x = function name()` is an expression
        const decl = /[;{}]$|^$/.test(prev);
        word.lastIndex = i;
        while (/\s/.test(src[word.lastIndex] || '')) { if (src[word.lastIndex] === '\n') line++; word.lastIndex++; }
        const nm = word.exec(src);
        if (nm && decl) {
          const scope = scopes[scopes.length - 1];
          if (scope.has(nm[0])) dupes.push(nm[0] + ' (lines ' + scope.get(nm[0]) + ', ' + line + ')');
          else scope.set(nm[0], line);
        }
        if (nm) i = word.lastIndex;
        wantBody = true; paramsFrom = parenDepth;
        prev = 'function'; continue;
      }
      prev = tok; continue;
    }
    if (c === '=' && n === '>') { i += 2; wantBody = true; paramsFrom = parenDepth; prev = '=>'; continue; }
    if (c === '(') parenDepth++;
    if (c === ')') parenDepth--;
    if (c === '{') {
      const body = wantBody && parenDepth === paramsFrom;
      braces.push(body);
      if (body) { scopes.push(new Map()); wantBody = false; }
    }
    if (c === '}') {
      if (braces.pop()) scopes.pop();
    }
    if (c === ';' && parenDepth === paramsFrom) wantBody = false;   // `=> x;` had no body
    prev = c; i++;
  }
  return { dupes, level: braces.length === 0 && parenDepth === 0 && scopes.length === 1 };
}

console.log('\n  the walk itself');
check('finds a repeat in the same scope',
  repeats('(function(){ function a(){} var x = 1; function a(b){} })();').dupes, ['a (lines 1, 1)']);
check('allows the same name in two different functions',
  repeats('(function(){ function f(){ function a(){} } function g(){ function a(){} } })();').dupes, []);
check('is not fooled by a name inside a string, a comment or a pattern',
  repeats('(function(){ function a(){} var s = "function a(){}"; /* function a(){} */ var r = /function a\\(\\)\\{/; })();').dupes, []);
check('does not count a named function written as a value',
  repeats('(function(){ function a(){} var b = function a(){}; })();').dupes, []);

console.log('\n  every script the atlas page loads');
const files = fs.readdirSync(path.join(ROOT, 'atlas')).filter((f) => f.endsWith('.js')).sort();
for (const f of files) {
  const r = repeats(fs.readFileSync(path.join(ROOT, 'atlas', f), 'utf8'));
  check(f + ': the walk comes out level', r.level, true);
  check(f + ': no function name is declared twice in one place', r.dupes, []);
}

console.log('\n  the Questions shelf reaches the function it means');
const owner = fs.readFileSync(path.join(ROOT, 'atlas', 'owner.js'), 'utf8');
check('there is exactly one placesOf in owner.js',
  (owner.match(/\bfunction placesOf\s*\(/g) || []).length, 1);
check('and it is the one that hands back a list (the shelf calls it with one argument)',
  /function placesOf\(L\)\s*\{[^}]*return/.test(owner), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
