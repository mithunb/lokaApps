/* Run me with: node test/run.mjs — or on my own with node.
 * Paths are worked out from where this file sits, never from where you
 * happen to be standing when you run it. */
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* An organisation can add its logo in the setup wizard. The browser turns any
   picture into a PNG small enough to send; the server keeps its rule of "a PNG
   under 200 KB". These checks hold the two ends to the same rule. No network. */

const server = fs.readFileSync(ROOT + '/api/apps/atlas.js', 'utf8');
const setup = fs.readFileSync(ROOT + '/atlas/setup/setup.js', 'utf8');
const page = fs.readFileSync(ROOT + '/atlas/setup/index.html', 'utf8');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + label +
    (ok ? '' : '\n        got  ' + JSON.stringify(got) + '\n        want ' + JSON.stringify(want)));
}

/* ---- the server's own rule, lifted out of its source ---- */
const vStart = server.indexOf('const PNG_MAGIC');
const vEnd = server.indexOf('\n}\n', server.indexOf('function validLogo(', vStart));
if (vStart < 0 || vEnd < 0) throw new Error('validLogo not found in api/apps/atlas.js');
const validLogo = new Function('Buffer', server.slice(vStart, vEnd + 3) + '; return validLogo;')(Buffer);

// a real PNG, as a canvas would make it: signature, header, pixels, end
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, noisy) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;                      // 8-bit RGBA: see-through parts kept
  const rows = [];
  let seed = 7;
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 4);
    for (let i = 1; i < row.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      row[i] = noisy ? seed & 0xff : (i % 4 === 0 ? 0 : 120);
    }
    rows.push(row);
  }
  const idat = zlib.deflateSync(Buffer.concat(rows), { level: noisy ? 0 : 9 });
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
const asUrl = (buf, type = 'image/png') => 'data:' + type + ';base64,' + buf.toString('base64');

console.log('\n  what the server will take');
const small = asUrl(png(512, 512, false));
check('a 512 × 512 PNG, as the wizard sends it', validLogo(small), small);
check('a PNG just over 200 KB is refused', validLogo(asUrl(png(240, 240, true))), null);
check('a JPG is refused (the wizard converts it first)',
  validLogo(asUrl(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), 'image/jpeg')), null);
check('something calling itself a PNG that is not one is refused',
  validLogo(asUrl(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))), null);
check('no logo at all is simply no logo', validLogo(undefined), null);

console.log('\n  the wizard asks for the logo and sends it');
check('step 1 has a logo field', /id="logo-file"/.test(page) && /Your logo <span class="opt">\(optional\)<\/span>/.test(page), true);
const accept = (page.match(/id="logo-file"[^>]*accept="([^"]+)"/) || page.match(/accept="([^"]+)"[^>]*id="logo-file"/) || [, ''])[1];
check('it takes PNG, JPG, WEBP and SVG',
  ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].every((t) => accept.includes(t)), true);
check('the logo field sits inside step 1',
  page.indexOf('id="logo-file"') > page.indexOf('id="s1"') && page.indexOf('id="logo-file"') < page.indexOf('id="s2"'), true);
check('the build request carries it as branding.logoData', /logoData:\s*S\.logo/.test(setup), true);
check('it is sent as a PNG', /toDataURL\("image\/png"\)/.test(setup), true);
check('the wizard aims for the same 200 KB the server allows', /LOGO_BYTES = 200 \* 1024/.test(setup), true);
check('a picture that cannot be read gets a plain answer',
  setup.includes('That file isn’t an image we can read — try a PNG or JPG.'), true);
const limit = (server.match(/const jsonStd = express\.json\(\{ limit: '(\d+)mb' \}\)/) || [, '0'])[1];
check('a 200 KB logo, written out as text, fits in the request the server reads',
  Number(limit) * 1024 * 1024 > Math.ceil(200 * 1024 / 3) * 4 + 50 * 1024, true);

console.log('\n  how big the wizard draws it');
const grab = (name) => {
  const start = setup.indexOf('\n  function ' + name + '(');
  if (start < 0) throw new Error(name + ' not found in setup.js');
  const end = setup.indexOf('\n  }\n', start);
  return setup.slice(start, end + 5);
};
const { logoSize, dataUrlBytes } = new Function(grab('logoSize') + grab('dataUrlBytes') +
  '; return { logoSize, dataUrlBytes };')();
check('a wide banner keeps its shape inside 512', logoSize(2000, 500, 512, false), { w: 512, h: 128 });
check('a tall logo keeps its shape inside 512', logoSize(300, 1200, 512, false), { w: 128, h: 512 });
check('a small photo is never blown up', logoSize(120, 80, 512, false), { w: 120, h: 80 });
check('a drawing (SVG) is drawn as large as allowed', logoSize(24, 12, 512, true), { w: 512, h: 256 });
check('a picture with no size gets a square', logoSize(0, 0, 512, false), { w: 512, h: 512 });
const buf = png(64, 64, false);
check('the wizard measures a PNG the way the server does', dataUrlBytes(asUrl(buf)), buf.length);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
