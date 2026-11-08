/* Run me with: node test/run.mjs — or on my own with node.
 *
 * Emails to a LOKA Atlas user wear one HTML look (api/lib/atlas/email-layout.js)
 * and still carry today's plain words as their text part. Light only — no
 * dark-mode styles anywhere in it. Every value is escaped. A private or
 * unpublished atlas shows neither photo nor region on its card. Emails to
 * the operator stay plain text, and the mailer passes html on only when it
 * is given one. Nothing here sends a mail: the mailer is run in its log mode.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { layout, paragraphsFromLines, escapeHtml } = await import(ROOT + '/api/lib/atlas/email-layout.js');
process.env.MAIL_TRANSPORT = 'log';
const { sendMail } = await import(ROOT + '/api/lib/mailer.js');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok ? '' : '\n         got  ' + JSON.stringify(got) + '\n         want ' + JSON.stringify(want)));
}

const title = 'Emergence Festival of Future Cities';
const pub = { title, region: 'Panaji, Goa', url: 'https://loka.place/apps/atlas/a/emergence', photo: 'https://loka.place/apps/atlas/datasets/emergence/small-1.jpg', photoName: 'Kala Academy' };
const priv = { title, url: 'https://loka.place/apps/atlas/a/emergence' };

/* the nine user emails, as api/apps/atlas.js builds them */
const samples = {
  'sign-in code': { headline: 'Your sign-in code', code: '482913', paragraphs: ['Type it into the LOKA Atlas sign-in box. It works once and expires in 10 minutes.'], quiet: `If you didn't request this, ignore this email.`, footer: 'You asked to sign in to LOKA Atlas with this email address.', text: `Your sign-in code is:\n\n    482913\n\nType it into the LOKA Atlas sign-in box. It works once and expires in 10 minutes.\n\nIf you didn't request this, ignore this email.` },
  'edit token': { headline: 'Your edit token', code: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2', paragraphs: ['Edit token (keep it safe — it\'s the only way to manage this atlas).', 'Use it to add data layers, publish changes, or delete the atlas.'], atlasCard: priv, button: { label: 'Open the atlas', href: priv.url }, footer: 'x', text: `Your atlas: ${title}\nLink: ${priv.url}\n\nEdit token (keep it safe — it's the only way to manage this atlas):\na1b2\n\nUse it to add data layers, publish changes, or delete the atlas.\n` },
  'invited': { headline: `You're invited to contribute`, paragraphs: [`priya@example.org invited you to contribute to “${title}” (Panaji, Goa) on LOKA Atlas.`, 'To get started:'], steps: ['Open https://loka.place/apps/atlas/setup/', `Sign in with this email address — we'll send you a 6-digit code.`], atlasCard: pub, button: { label: 'Open LOKA Atlas', href: 'https://loka.place/apps/atlas/setup/' }, quiet: `If you weren't expecting this, you can ignore this email.`, footer: 'x', text: 'invited text' },
  'approved': { headline: 'Approved — building now', paragraphs: [`Your atlas “${title}” was approved and is building now.`], atlasCard: priv, button: { label: 'Check progress', href: 'https://loka.place/apps/atlas/setup/' }, footer: 'x', text: 'approved text' },
  'not approved': { headline: 'Not approved this time', paragraphs: [`Your atlas “${title}” wasn't approved this time.`], atlasCard: priv, footer: 'x', text: 'not approved text' },
  'not widened': { headline: 'Not widened this time', paragraphs: [`"${title}" stays as it is for now — covering more ground wasn't approved this time.`], atlasCard: pub, footer: 'x', text: 'not widened text' },
  'built without': { headline: 'Built without Protected areas', paragraphs: ['a', 'b'], atlasCard: pub, button: { label: 'Open the atlas', href: pub.url }, footer: 'x', text: 'built without text' },
  'adding': { headline: 'Adding Protected areas', paragraphs: ['a', 'b'], atlasCard: pub, button: { label: 'Open the atlas', href: pub.url }, footer: 'x', text: 'adding text' },
  'atlas read': { headline: 'Your atlas has been read', paragraphs: paragraphsFromLines(['The AI could not be reached when you added this data, so nothing was written at the time.', 'It has been read now.', '', title, '  Why here? — answered for 12 places', '', 'Open your atlas: https://loka.place/apps/atlas/?dataset=emergence']), atlasCard: pub, footer: 'x', text: 'read text' },
};

for (const [name, o] of Object.entries(samples)) {
  const out = layout(o);
  check(name + ': the text part is returned as given', out.text, o.text);
  check(name + ': html renders a whole document with the headline', /^<!doctype html>[\s\S]*<\/html>$/.test(out.html) && out.html.includes('<h1') && out.html.includes(escapeHtml(o.headline)), true);
  check(name + ': no dark-mode styles', /prefers-color-scheme|dark/i.test(out.html), false);
  check(name + ': says light only', out.html.includes('<meta name="color-scheme" content="light only">') && out.html.includes('<meta name="supported-color-schemes" content="light">') && out.html.includes('color-scheme: light only'), true);
  check(name + ': at most one button', (out.html.match(/padding:13px 26px/g) || []).length, o.button ? 1 : 0);
  check(name + ': no tracking pixel, script or remote font', /<script|@import|fonts\.googleapis|width="1" height="1"/i.test(out.html), false);
}

/* the nine text bodies are today's words: the source still carries each `text:` expression exactly as
   it stood at HEAD when this check was written (test/fixtures/emails/text-at-head.json; whitespace at
   the start of a line is the only thing allowed to differ, since the strings were re-indented) */
const headText = JSON.parse(fs.readFileSync(ROOT + '/test/fixtures/emails/text-at-head.json', 'utf8'));
const srcNow = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8').split('\n').map((l) => l.trim()).join('\n');
check('the fixture names all nine user emails', Object.keys(headText).length, 9);
for (const [name, lines] of Object.entries(headText)) {
  check(name + ': text body is byte-identical to HEAD', srcNow.includes(lines.map((l) => l.trim()).join('\n')), true);
}

/* the card: photo and region only when the caller gives them (public + published), never otherwise */
const withPhoto = layout(samples['built without']).html;
check('public, published atlas: photo on the card', withPhoto.includes('<img src="' + pub.photo + '"') && withPhoto.includes('Panaji, Goa'), true);
const noPhoto = layout(samples['approved']).html;
check('unpublished atlas: no photo, no region', /<img|Panaji/.test(noPhoto), false);
check('private atlas: card names and links the atlas', noPhoto.includes('<a href="' + priv.url + '"') && noPhoto.includes(escapeHtml(title)), true);
check('a photo that is not https is left off', /<img/.test(layout({ ...samples['adding'], atlasCard: { ...pub, photo: 'http://loka.place/y.jpg' } }).html), false);
check('a photo on any other host is left off (it would act as a tracker)', /<img/.test(layout({ ...samples['adding'], atlasCard: { ...pub, photo: 'https://images.example.com/y.jpg' } }).html), false);
check('a photo on a host that merely starts like ours is left off', /<img/.test(layout({ ...samples['adding'], atlasCard: { ...pub, photo: 'https://loka.place.evil.com/y.jpg' } }).html), false);
check('a photo the site serves itself is kept', /<img src="https:\/\/loka\.place\/api\/images\/1\.jpg"/.test(layout({ ...samples['adding'], atlasCard: { ...pub, photo: 'https://loka.place/api/images/1.jpg' } }).html), true);
check('an http button link becomes the site', layout({ button: { label: 'Go', href: 'http://loka.place/x' }, text: '' }).html.includes('<a href="https://loka.place" style="display:inline-block'), true);

/* the code: big and copyable when short, wrapped when it is a long token */
check('sign-in code is shown big and selectable', /font-size:44px[^>]*>482913</.test(layout(samples['sign-in code']).html.replace(/\n/g, ' ')) && layout(samples['sign-in code']).html.includes('user-select:all'), true);
check('a long token wraps at a readable size', layout(samples['edit token']).html.includes('word-break:break-all') && layout(samples['edit token']).html.includes('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'), true);

/* escaping: nothing a user typed becomes markup, in any slot */
const evil = '<script>alert(1)</script>&"';
const esc = layout({ headline: evil, paragraphs: [evil], steps: [evil], quiet: evil, footer: evil, code: evil, atlasCard: { title: evil, region: evil, url: 'javascript:alert(1)', photo: 'https://x/y.jpg', photoName: evil }, button: { label: evil, href: 'javascript:alert(1)' }, text: evil }).html;
check('every slot escapes markup', esc.includes('<script'), false);
check('escaped text is still there', (esc.match(/&lt;script&gt;alert\(1\)&lt;\/script&gt;&amp;&quot;/g) || []).length >= 8, true);
check('a javascript: link becomes the site', /javascript:/.test(esc), false);
check('the text part is returned untouched, not escaped', layout({ text: evil }).text, evil);
check('escapeHtml covers the five characters', escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');

/* links inside plain paragraphs become links; lines become paragraphs */
const linked = layout({ paragraphs: ['Open your atlas: https://loka.place/apps/atlas/?dataset=a&b'], text: '' }).html;
check('an https address in a paragraph is a link', linked.includes('<a href="https://loka.place/apps/atlas/?dataset=a&amp;b"'), true);
check('blank lines split paragraphs; runs keep their line breaks', paragraphsFromLines(['a', 'b', '', '', 'c']), ['a\nb', 'c']);

/* the mailer: html goes with the text; log mode sends nothing */
const r = await sendMail({ to: 'nobody@example.org', subject: 'test', text: 'plain', html: '<p>x</p>' });
check('log mode sends nothing and says so', [r.sent, r.via], [false, 'log']);
const mailerSrc = fs.readFileSync(ROOT + '/api/lib/mailer.js', 'utf8');
check('the mailer hands nodemailer the html part when given one', mailerSrc.includes('text, ...(html ? { html } : {})'), true);
check('the mailer takes html as an option', /sendMail\(\{ to, subject, text, html \}\)/.test(mailerSrc), true);

/* operator emails stay plain text; every user email has the html part */
const src = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const calls = [...src.matchAll(/sendMail\(\{[\s\S]*?\}\);/g)].map((m) => m[0]);
const toOperator = calls.filter((c) => c.includes('ADMIN_EMAIL'));
const toUser = calls.filter((c) => !c.includes('ADMIN_EMAIL'));
check('six operator emails in atlas.js (five plus the trouble notifier), all plain text', [toOperator.length, toOperator.every((c) => !c.includes('emailLayout'))], [6, true]);
check('every user email in atlas.js carries the html part', [toUser.length, toUser.every((c) => c.includes('emailLayout('))], [9, true]);
check('the trouble notifier (to the operator) stays plain text', /sendMail\(\{ to: ADMIN_EMAIL, subject, text: text \+ footer \+ '\\n' \}\)/.test(src) && !fs.readFileSync(ROOT + '/api/lib/atlas/trouble.js', 'utf8').includes('html'), true);
check('the card helper shows photo and region only for a public, published atlas', src.includes('if (!previewEligible(inst)) return card;') && src.indexOf('card.region =') > src.indexOf('if (!previewEligible(inst)) return card;'), true);
check('the card helper keeps a photo only when the site itself serves it', src.includes("String(photo.url || '').startsWith(PREVIEW_BASE + '/')"), true);
const htmlParts = toUser.map((c) => { const a = c.indexOf('emailLayout('); const b = c.indexOf('text:', a); return c.slice(a, b < 0 ? undefined : b); });
check('every link in the html parts uses the configured public base, never the request host', [htmlParts.length, htmlParts.every((h) => !h.includes('siteBase(') && !h.includes('req.headers'))], [9, true]);
check('the owner notice goes even when the atlas cannot be looked up', src.includes("try { inst = reg.getInstance(o.dataset); } catch { inst = null; }"), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
