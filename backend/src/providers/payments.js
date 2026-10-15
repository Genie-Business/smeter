// Payment gateway abstraction. Paystack covers card / bank transfer / USSD in
// one checkout; the mock serves a local checkout page with the same lifecycle.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db.js';

// Our payout intervals → Paystack subaccount settlement_schedule values.
export const PAYSTACK_SCHEDULE = { daily: 'auto', weekly: 'weekly', monthly: 'monthly' };

class PaystackPayments {
  name = 'paystack';

  async call(method, path, body) {
    const res = await fetch(`${config.payments.paystackBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.payments.paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.status === false) {
      const err = new Error(json.message || `Paystack error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return json.data;
  }

  /** split: { subaccount, platformShareKobo, bearer } when the landlord has a settlement account. */
  async initialize({ reference, amountKobo, email, callbackUrl, channels, metadata, split }) {
    const body = {
      reference,
      amount: amountKobo,
      email,
      currency: 'NGN',
      callback_url: callbackUrl,
      channels: channels ?? config.payments.channels,
      metadata,
    };
    if (split?.subaccount) {
      body.subaccount = split.subaccount;
      body.transaction_charge = split.platformShareKobo;
      body.bearer = split.bearer;
    }
    const data = await this.call('POST', '/transaction/initialize', body);
    return { authorizationUrl: data.authorization_url, accessCode: data.access_code };
  }

  async verify(reference) {
    const data = await this.call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    return {
      status: data.status === 'success' ? 'success' : data.status === 'failed' || data.status === 'abandoned' ? 'failed' : 'pending',
      amountKobo: data.amount,
      transactionId: String(data.id),
      gatewayResponse: data.gateway_response,
    };
  }

  verifyWebhook(rawBody, signature) {
    if (!signature || !rawBody) return false;
    const expected = createHmac('sha512', config.payments.paystackSecretKey).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(String(signature), 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async listBanks() {
    const data = await this.call('GET', '/bank?country=nigeria&perPage=100');
    return data.map((b) => ({ name: b.name, code: b.code }));
  }

  async resolveAccount({ accountNumber, bankCode }) {
    const data = await this.call(
      'GET',
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    );
    return { accountName: data.account_name };
  }

  async createSettlementAccount({ businessName, bankCode, accountNumber, schedule = 'daily' }) {
    const data = await this.call('POST', '/subaccount', {
      business_name: businessName,
      settlement_bank: bankCode,
      account_number: accountNumber,
      percentage_charge: 0, // per-transaction split is set via transaction_charge
      settlement_schedule: PAYSTACK_SCHEDULE[schedule],
    });
    return { settlementRef: data.subaccount_code };
  }

  /** How often Paystack pays this owner's share out. */
  async setSettlementSchedule(settlementRef, schedule) {
    await this.call('PUT', `/subaccount/${encodeURIComponent(settlementRef)}`, { settlement_schedule: PAYSTACK_SCHEDULE[schedule] });
  }
}

const MOCK_BANKS = [
  { name: 'Access Bank', code: '044' },
  { name: 'First Bank of Nigeria', code: '011' },
  { name: 'Guaranty Trust Bank', code: '058' },
  { name: 'Kuda Bank', code: '50211' },
  { name: 'Moniepoint MFB', code: '50515' },
  { name: 'Opay', code: '999992' },
  { name: 'United Bank For Africa', code: '033' },
  { name: 'Zenith Bank', code: '057' },
];

// Outcomes live in the database (not memory) so checkout, return page and
// polling can land on different serverless instances.
class MockPayments {
  name = 'mock';

  async initialize({ reference, amountKobo }) {
    await db().run(
      `INSERT INTO mock_payments (reference, status, amount_kobo) VALUES (?, 'pending', ?)
       ON CONFLICT (reference) DO NOTHING`,
      reference, amountKobo,
    );
    return { authorizationUrl: `${config.publicUrl}/pay/mock/${encodeURIComponent(reference)}`, accessCode: null };
  }

  /** Called by the mock checkout page. */
  async complete(reference, success) {
    await db().run(
      `UPDATE mock_payments SET status = ? WHERE reference = ? AND status = 'pending'`,
      success ? 'success' : 'failed', reference,
    );
  }

  async verify(reference) {
    const o = await db().get('SELECT status, amount_kobo FROM mock_payments WHERE reference = ?', reference);
    return { status: o?.status ?? 'pending', amountKobo: o?.amount_kobo ?? 0, transactionId: `mock-${reference}` };
  }

  verifyWebhook() {
    return false; // the mock settles through its checkout page, never a webhook
  }

  async listBanks() {
    return MOCK_BANKS;
  }

  // Any 10-digit account resolves; the name is supplied by the caller's profile
  // so the mismatch check can be exercised with the "0000000000" account.
  async resolveAccount({ accountNumber }, profileName = 'SMETER TEST ACCOUNT') {
    if (!/^\d{10}$/.test(accountNumber)) throw Object.assign(new Error('Could not resolve account name'), { status: 422 });
    if (accountNumber === '0000000000') return { accountName: 'UNRELATED PERSON' };
    return { accountName: profileName.toUpperCase() };
  }

  async createSettlementAccount({ accountNumber, schedule = 'daily' }) {
    const settlementRef = `ACCT_mock${accountNumber.slice(-4)}`;
    this.schedules.set(settlementRef, schedule);
    return { settlementRef };
  }

  schedules = new Map();

  async setSettlementSchedule(settlementRef, schedule) {
    this.schedules.set(settlementRef, schedule);
  }
}

let provider;
export function payments() {
  provider ??= config.payments.provider === 'paystack' ? new PaystackPayments() : new MockPayments();
  return provider;
}

export function setPayments(next) {
  provider = next;
}
