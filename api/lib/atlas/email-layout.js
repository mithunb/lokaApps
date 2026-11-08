/* The one look every email to a LOKA Atlas user wears (Mithun, 8 Nov 2026:
   "Stylize the emails sent by LOKA Atlas to its users using HTML"; light only —
   "do not want dark mode").

   A quiet letter: the words "LOKA Atlas" over a thin rule, a plain headline,
   a few short paragraphs, at most one button, the atlas named on a small card
   (with its best place photo only when the atlas is public and published),
   and a quiet footer saying why the mail came. Tables and inline styles, so
   it reads the same in Gmail, Apple Mail and Outlook; no remote fonts, no
   tracking pixel, no script. Colours are the atlas's own (Bazaar L1, see
   DESIGN.md) and still read if a client force-inverts them.

   layout() returns both parts. The text part is whatever the caller passes
   in — today's plain words, unchanged — so a reader whose client shows text
   only sees exactly what they saw before. Every value is escaped; nothing a
   user typed (an atlas title, an email address) can become markup.

   Emails to the operator do not come through here: they stay plain text. */

const PAGE = '#FAF8F3';    // the page behind the letter
const PANEL = '#FDFCF8';   // the letter
const TEXT = '#24211D';
const MUTED = '#5A5751';
const ACTION = '#2A6B41';  // banana-leaf: the one button
const RULE = '#E6E1D6';
const CODE_BG = '#FBF1D9'; // the ramp's first step, behind a code

const SERIF = "'Source Serif 4', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif";
const SANS = "'Source Sans 3', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

// the site's own public base (the same one api/apps/atlas.js calls PREVIEW_BASE):
// every link in an email points here, and a photo is shown only when this
// host serves it — an image from any other host would act as a tracker
export const SITE = (process.env.ATLAS_PUBLIC_BASE || 'https://loka.place').replace(/\/+$/, '');
export function ownImage(u) {
  const s = String(u || '');
  return /^https:\/\//i.test(s) && s.startsWith(SITE + '/') && !/[\s"'<>]/.test(s);
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// an href is only ever an https address; anything else becomes the site itself
function safeHref(u) {
  const s = String(u || '').trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? escapeHtml(s) : SITE;
}

const para = (inner, extra) =>
  `<p style="margin:0 0 14px; font-family:${SANS}; font-size:17px; line-height:1.5; color:${TEXT};${extra || ''}">${inner}</p>`;

// a paragraph given as plain words: escaped, and a bare https address in it
// becomes a link, so "Open your atlas: https://…" stays clickable
function paragraph(text) {
  const parts = String(text).split(/(https?:\/\/[^\s<>"']+)/g);
  const inner = parts.map((part, i) => (i % 2
    ? `<a href="${safeHref(part)}" style="color:${ACTION}; word-break:break-all;">${escapeHtml(part)}</a>`
    : escapeHtml(part).replace(/\n/g, '<br>'))).join('');
  return para(inner);
}

function button(b) {
  if (!b || !b.label) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 10px;"><tr>
  <td style="background:${ACTION}; border-radius:6px;">
    <a href="${safeHref(b.href)}" style="display:inline-block; padding:13px 26px; font-family:${SANS}; font-size:17px; font-weight:600; color:#FFFFFF; text-decoration:none;">${escapeHtml(b.label)}</a>
  </td></tr></table>`;
}

// a code or token: selectable text (never an image) so it can be copied; a
// short code is big and letter-spaced, a long token wraps at a readable size
function codeBlock(code) {
  const s = String(code == null ? '' : code);
  if (!s) return '';
  const big = s.length <= 8;
  const style = big
    ? `font-size:44px; font-weight:700; letter-spacing:10px;`
    : `font-size:16px; font-weight:600; letter-spacing:0.5px; word-break:break-all; line-height:1.6;`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:6px 0 22px;"><tr>
  <td align="center" style="background:${CODE_BG}; border:1px solid ${RULE}; border-radius:8px; padding:${big ? '22px 10px' : '16px 18px'}; font-family:${MONO}; color:${TEXT}; ${style} -webkit-user-select:all; user-select:all;">${escapeHtml(s)}</td>
</tr></table>`;
}

function steps(list) {
  if (!Array.isArray(list) || !list.length) return '';
  return `<ol style="margin:0 0 14px; padding-left:22px; font-family:${SANS}; font-size:17px; line-height:1.55; color:${TEXT};">` +
    list.map((s) => `<li style="margin:0 0 6px;">${paragraph(s).replace(/^<p[^>]*>|<\/p>$/g, '')}</li>`).join('') + '</ol>';
}

/* The atlas on a small card: its title (a link when there is one), its
   region, and a small photo beside them. The caller decides what the card
   may show — a private or unpublished atlas arrives here with neither photo
   nor region (see emailCard in api/apps/atlas.js) — and a photo is shown only
   when the site itself serves it (ownImage). */
function atlasCard(c) {
  if (!c || !c.title) return '';
  const photo = ownImage(c.photo)
    ? `<td width="112" style="padding:0 14px 0 0; vertical-align:top;"><img src="${escapeHtml(c.photo)}" width="112" height="84" alt="${escapeHtml(c.photoName || '')}" style="display:block; border:0; width:112px; height:84px; object-fit:cover; border-radius:5px;"></td>`
    : '';
  const title = escapeHtml(c.title);
  const titleStyle = `font-family:${SERIF}; font-size:19px; font-weight:700; line-height:1.3; color:${TEXT}; text-decoration:none;`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:8px 0 18px; border:1px solid ${RULE}; border-radius:8px;"><tr>
  <td style="padding:14px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${photo}
    <td style="vertical-align:top;">
      ${c.url ? `<a href="${safeHref(c.url)}" style="${titleStyle}">${title}</a>` : `<span style="${titleStyle}">${title}</span>`}
      ${c.region ? `<div style="margin-top:4px; font-family:${SANS}; font-size:15px; color:${MUTED};">${escapeHtml(c.region)}</div>` : ''}
    </td></tr></table></td></tr></table>`;
}

/* Lines as the plain-text emails are written (an array, blank lines between
   paragraphs) become paragraphs: a run of lines is one paragraph with line
   breaks, a blank line ends it. */
export function paragraphsFromLines(lines) {
  const out = [];
  let cur = [];
  for (const l of lines || []) {
    if (String(l).trim() === '') { if (cur.length) out.push(cur.join('\n')); cur = []; }
    else cur.push(String(l));
  }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}

/* layout({ headline, paragraphs, steps, button, atlasCard, footer, text, code, quiet })
     headline    the one line at the top (plain words)
     code        a sign-in code or token, shown big and copyable, right under the headline
     paragraphs  short plain paragraphs ("\n" is a line break; https links become links)
     steps       a numbered list of plain lines
     atlasCard   { title, region, url, photo, photoName } — see atlasCard above
     button      { label, href } — at most one
     quiet       a last, smaller line ("If you didn't request this, ignore this email.")
     footer      why this mail came, in one plain line
     text        today's plain-text body, returned exactly as given
   → { html, text } */
export function layout(o) {
  const e = o || {};
  const preheader = (e.paragraphs && e.paragraphs[0]) || e.headline || '';
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(e.headline || 'LOKA Atlas')}</title>
<style>
  :root { color-scheme: light only; }
  body { margin:0; padding:0; -webkit-text-size-adjust:100%; }
  table { border-collapse:collapse; }
  @media only screen and (max-width: 480px) {
    .wrap { width:100% !important; }
    .pad { padding-left:20px !important; padding-right:20px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background:${PAGE};">
<div style="display:none; max-height:0; overflow:hidden; font-size:1px; line-height:1px; color:${PAGE};">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE};"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" class="wrap" style="width:600px; max-width:600px; background:${PANEL}; border-radius:10px;">
  <tr><td class="pad" style="padding:22px 36px 14px; border-bottom:1px solid ${RULE};"><span style="font-family:${SERIF}; font-size:18px; font-weight:700; letter-spacing:0.5px; color:${TEXT};">LOKA <span style="font-weight:400;">Atlas</span></span></td></tr>
  <tr><td class="pad" style="padding:26px 36px 8px;">
    <h1 style="margin:0 0 16px; font-family:${SERIF}; font-size:26px; line-height:1.25; font-weight:700; color:${TEXT};">${escapeHtml(e.headline || '')}</h1>
    ${codeBlock(e.code)}
    ${(e.paragraphs || []).map(paragraph).join('\n    ')}
    ${steps(e.steps)}
    ${atlasCard(e.atlasCard)}
    ${button(e.button)}
    ${e.quiet ? para(escapeHtml(e.quiet), ` font-size:15px; color:${MUTED}; margin-top:18px;`) : ''}
  </td></tr>
  <tr><td class="pad" style="padding:16px 36px 22px; border-top:1px solid ${RULE};">
    ${e.footer ? `<p style="margin:0 0 4px; font-family:${SANS}; font-size:13px; line-height:1.5; color:${MUTED};">${escapeHtml(e.footer)}</p>` : ''}
    <p style="margin:0; font-family:${SANS}; font-size:13px; line-height:1.5; color:${MUTED};"><a href="${SITE}" style="color:${MUTED}; text-decoration:underline;">loka.place</a> · LOKA Atlas, a map made from your own data</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { html, text: String(e.text == null ? '' : e.text) };
}
