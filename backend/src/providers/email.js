// Email delivery for login codes, password resets, payout-change codes and
// tenant invites. 'resend' sends through Resend (https://resend.com); 'log'
// prints instead of sending (default until RESEND_API_KEY is set).
import { config } from '../config.js';

export const sentEmails = []; // inspected by tests; capped

class LogEmail {
  async send({ to, subject, text }) {
    sentEmails.push({ to, subject, text, at: new Date().toISOString() });
    if (sentEmails.length > 200) sentEmails.shift();
    if (!config.isTest) console.log(`[email:log] to=${to} subject="${subject}" :: ${text}`);
  }
}

class ResendEmail {
  async send({ to, subject, text, html }) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.email.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: config.email.from,
        to: [to],
        subject,
        text,
        html,
        ...(config.email.replyTo ? { reply_to: config.email.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Email send failed (${res.status}): ${await res.text()}`);
  }
}

let provider;
export function email() {
  provider ??= config.email.provider === 'resend' ? new ResendEmail() : new LogEmail();
  return provider;
}

/** Best-effort send: failures are logged, never thrown into the request. */
export async function sendEmail(message) {
  try {
    await email().send(message);
    return true;
  } catch (err) {
    console.error('[email] send failed', err.message);
    return false;
  }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#f5f4ef;font-family:Arial,Helvetica,sans-serif;color:#0f0f0e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px">
<tr><td style="padding:28px 28px 8px;font-size:22px;font-weight:800;letter-spacing:-0.5px">SMETER<span style="color:#9d10a9">.</span></td></tr>
<tr><td style="padding:8px 28px 28px;font-size:15px;line-height:1.55">
<h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>${bodyHtml}</td></tr></table>
<p style="font-size:12px;color:#62615d;margin:16px 0 0">smeter. Smart prepaid metering for African homes.</p>
</td></tr></table></body></html>`;
}

const codeBlock = (code) =>
  `<p style="font-size:32px;font-weight:800;letter-spacing:8px;margin:18px 0;color:#9d10a9">${esc(code)}</p>`;

/** A one-time code email. `purpose` is shown in the subject and heading. */
export function codeEmail({ to, purpose, code, detail }) {
  const minutes = config.otp.ttlMinutes;
  const subject = `${code} is your smeter ${purpose} code`;
  const text = `Your smeter ${purpose} code is ${code}. ${detail ? `${detail} ` : ''}It expires in ${minutes} minutes. If you didn't ask for it, you can ignore this email.`;
  const html = layout(`Your ${purpose} code`, `${detail ? `<p style="margin:0">${esc(detail)}</p>` : ''}${codeBlock(code)}
<p style="margin:0;color:#62615d">It expires in ${minutes} minutes. Don't share it with anyone. If you didn't ask for it, you can ignore this email.</p>`);
  return { to, subject, text, html };
}

export function inviteEmail({ to, ownerName, meterId }) {
  const subject = `${ownerName} added your meter to smeter`;
  const text = `${ownerName} added your meter ${meterId} to smeter. Get the smeter app and sign in with your meter number to buy power and track your usage. Your login codes will come to this email.`;
  const html = layout('Your meter is on smeter', `<p style="margin:0 0 12px">${esc(ownerName)} added your meter <b>${esc(meterId)}</b> to smeter.</p>
<p style="margin:0 0 12px">Get the smeter app and sign in with your meter number to buy power and track your usage. Your login codes will come to this email.</p>`);
  return { to, subject, text, html };
}

/** j***@example.com */
export function maskEmail(address) {
  const [user, domain] = String(address ?? '').split('@');
  if (!domain) return '';
  return `${user.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}
