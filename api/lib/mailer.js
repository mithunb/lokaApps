// Minimal mail sender, in preference order:
//   1. SMTP via nodemailer when SMTP_HOST is configured — this is Resend, which
//      the project moved to in August 2026. Its SMTP interface needs no special
//      casing here: host, port, user and pass live in api/.env, which pm2 loads
//      with --env-file.
//   2. the local sendmail binary (postfix/exim) when present,
//   3. log fallback — the full message (with any links) lands in `pm2 logs`.
//
// SendGrid used to be first and is gone. It was tried ahead of SMTP whenever
// SG_KEY was set, so a lapsed SendGrid account meant every send burned a failed
// request and a warning line before falling through — and the code claimed a
// preference the infrastructure no longer had.
import fs from 'node:fs';

let transportPromise = null;

const SENDMAIL_PATHS = ['/usr/sbin/sendmail', '/usr/lib/sendmail'];

function fromAddress() {
  return process.env.MAIL_FROM || process.env.FROM_EMAIL || process.env.SMTP_USER ||
    'LOKA Atlas <atlas@loka.place>';
}

async function getFallbackTransport() {
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
          // worth shouting about: local sendmail from this host is very likely
          // to be filtered, so a sign-in code sent this way may never arrive
          console.warn(`[mail] SMTP_HOST is not set — falling back to ${bin}; delivery is unreliable`);
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
  // dev override: MAIL_TRANSPORT=log forces links into the console
  if (process.env.MAIL_TRANSPORT === 'log') {
    logFallback(to, subject, text);
    return { sent: false, via: 'log' };
  }
  const transport = await getFallbackTransport();
  if (!transport) {
    logFallback(to, subject, text);
    return { sent: false, via: 'log' };
  }
  try {
    await transport.t.sendMail({ from: fromAddress(), to, subject, text });
    return { sent: true, via: transport.kind };
  } catch (e) {
    console.warn(`[mail] ${transport.kind} send failed:`, e.message);
    logFallback(to, subject, text);
    return { sent: false, via: 'log', error: e.message };
  }
}
