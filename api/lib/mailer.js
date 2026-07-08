// Minimal mail sender, in preference order:
//   1. SendGrid Web API when SG_KEY is set — the same service and env-var names
//      the LOKA dashboard (loka-server) uses, so the server can reuse the exact
//      values from loka-server/.env (SG_KEY, SG_HOST, FROM_EMAIL),
//   2. SMTP via nodemailer when SMTP_HOST is configured,
//   3. the local sendmail binary (postfix/exim) when present,
//   4. log fallback — the full message (with any links) lands in `pm2 logs`.
import fs from 'node:fs';

let transportPromise = null;

const SENDMAIL_PATHS = ['/usr/sbin/sendmail', '/usr/lib/sendmail'];

function fromAddress() {
  return process.env.MAIL_FROM || process.env.FROM_EMAIL || process.env.SMTP_USER ||
    'LOKA Atlas <atlas@loka.place>';
}

async function sendViaSendGrid({ to, subject, text }) {
  const host = (process.env.SG_HOST || 'https://api.sendgrid.com').replace(/\/$/, '');
  const res = await fetch(host + '/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.SG_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: fromAddress().replace(/^.*<|>.*$/g, '') },
      subject,
      content: [{ type: 'text/plain', value: text }],
    }),
  });
  if (res.status >= 300) {
    const body = await res.text().catch(() => '');
    throw new Error(`sendgrid ${res.status}: ${body.slice(0, 200)}`);
  }
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
          console.log(`[mail] no SendGrid/SMTP configured — using ${bin}`);
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
  if (process.env.SG_KEY) {
    try {
      await sendViaSendGrid({ to, subject, text });
      return { sent: true, via: 'sendgrid' };
    } catch (e) {
      console.warn('[mail] sendgrid failed, trying fallback:', e.message);
    }
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
