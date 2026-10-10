// SMS delivery for OTPs and tenant invites. 'log' prints instead of sending
// (default until an SMS account is configured); 'termii' is a common NG gateway.
import { config } from '../config.js';

export const sentMessages = []; // inspected by tests; capped

class LogSms {
  async send(to, message) {
    sentMessages.push({ to, message, at: new Date().toISOString() });
    if (sentMessages.length > 200) sentMessages.shift();
    if (!config.isTest) console.log(`[sms:log] to=${to} :: ${message}`);
  }
}

class TermiiSms {
  async send(to, message) {
    const res = await fetch(`${config.sms.termiiBaseUrl}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.sms.termiiApiKey,
        to: to.replace(/^\+/, ''),
        from: config.sms.termiiSenderId,
        sms: message,
        type: 'plain',
        channel: 'dnd', // OTP-safe route on Nigerian networks
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`SMS send failed (${res.status}): ${await res.text()}`);
  }
}

let provider;
export function sms() {
  provider ??= config.sms.provider === 'termii' ? new TermiiSms() : new LogSms();
  return provider;
}

/** Best-effort send: failures are logged, never thrown into the request. */
export async function sendSms(to, message) {
  try {
    await sms().send(to, message);
    return true;
  } catch (err) {
    console.error('[sms] send failed', err.message);
    return false;
  }
}
