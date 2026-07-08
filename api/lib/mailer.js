// Minimal mail sender with three tiers:
//   1. SMTP via nodemailer when SMTP_HOST is configured (most reliable),
//   2. the local sendmail binary (postfix/exim) when present — works on most
//      Apache servers with no extra config, though deliverability depends on
//      the host's SPF/DKIM setup,
//   3. log fallback — the full message (with any links) lands in `pm2 logs`.
//
// Env: SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, MAIL_FROM.
import fs from 'node:fs';

let transportPromise = null;

const SENDMAIL_PATHS = ['/usr/sbin/sendmail', '/usr/lib/sendmail'];

async function getTransport() {
  if (!transportPromise) {
    transportPromise = import('nodemailer')
      .then((nm) => {
        if (process.env.SMTP_HOST) {
          return { kind: 'smtp', t: nm.default.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: Number(process.env.SMTP_PORT) === 465,
            auth: process.env.SMTP_USER
              ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
              : undefined,
          }) };
        }
        const bin = SENDMAIL_PATHS.find((p) => fs.existsSync(p));
        if (bin) {
          console.log(`[mail] no SMTP configured — using ${bin}`);
          return { kind: 'sendmail', t: nm.default.createTransport({ sendmail: true, path: bin, newline: 'unix' }) };
        }
        return null;
      })
      .catch((e) => {
        console.warn('[mail] nodemailer unavailable:', e.message);
        return null;
      });
  }
  return transportPromise;
}

function logFallback(to, subject, text) {
  console.log(`[mail:fallback] To: ${to}\n[mail:fallback] Subject: ${subject}\n[mail:fallback] ${text.replace(/\n/g, '\n[mail:fallback] ')}`);
}

export async function sendMail({ to, subject, text }) {
  const transport = await getTransport();
  if (!transport) {
    logFallback(to, subject, text);
    return { sent: false, via: 'log' };
  }
  try {
    await transport.t.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER || 'LOKA Atlas <atlas@loka.place>',
      to, subject, text,
    });
    return { sent: true, via: transport.kind };
  } catch (e) {
    console.warn(`[mail] ${transport.kind} send failed:`, e.message);
    logFallback(to, subject, text);
    return { sent: false, via: 'log', error: e.message };
  }
}
