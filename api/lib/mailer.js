// Minimal mail sender. Uses nodemailer + SMTP env vars when configured;
// otherwise logs the full message so the flow still works in dev (grab the
// magic/approval link from `pm2 logs`).
//
// Env: SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, MAIL_FROM.
let transportPromise = null;

async function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  if (!transportPromise) {
    transportPromise = import('nodemailer')
      .then((nm) =>
        nm.default.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT) || 587,
          secure: Number(process.env.SMTP_PORT) === 465,
          auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
        }),
      )
      .catch((e) => {
        console.warn('[mail] nodemailer unavailable:', e.message);
        return null;
      });
  }
  return transportPromise;
}

export async function sendMail({ to, subject, text }) {
  const transport = await getTransport();
  if (!transport) {
    console.log(`[mail:fallback] To: ${to}\n[mail:fallback] Subject: ${subject}\n[mail:fallback] ${text.replace(/\n/g, '\n[mail:fallback] ')}`);
    return { sent: false, logged: true };
  }
  try {
    await transport.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to, subject, text,
    });
    return { sent: true };
  } catch (e) {
    console.warn('[mail] send failed:', e.message);
    console.log(`[mail:fallback] To: ${to}\n[mail:fallback] Subject: ${subject}\n[mail:fallback] ${text.replace(/\n/g, '\n[mail:fallback] ')}`);
    return { sent: false, logged: true, error: e.message };
  }
}
