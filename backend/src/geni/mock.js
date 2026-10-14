// In-memory stand-in for the Geni head-end so the app works end to end before
// credentials exist. Deterministic per meter id.
//  - meter ids starting "000" don't exist (manufacturer lookup fails)
//  - meter ids ending "9" report offline (exercises the manual-token fallback)
import { createHash, randomInt } from 'node:crypto';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function seed(meterId) {
  return createHash('sha256').update(String(meterId)).digest().readUInt32BE(0) / 0xffffffff;
}

// Rough household shape: low overnight, morning bump, evening peak.
const SHAPE = [0.35, 0.3, 0.28, 0.28, 0.3, 0.45, 0.8, 1.1, 0.9, 0.7, 0.65, 0.65,
  0.7, 0.7, 0.65, 0.7, 0.85, 1.1, 1.5, 1.7, 1.6, 1.3, 0.9, 0.55];

function hourlyKwh(meterId, t) {
  const s = seed(meterId);
  const d = new Date(t);
  const dayNoise = 0.75 + 0.5 * Math.abs(Math.sin(Math.floor(t / DAY) * 12.9898 + s * 78.233));
  return (0.35 + s * 0.4) * SHAPE[d.getUTCHours()] * dayNoise;
}

export class MockGeniClient {
  constructor() {
    this.tariffs = new Map();
    this.accounts = new Map();
    this.customers = new Map();
    this.receipt = 100000;
    this.tasks = [];
  }

  async getMeter(meterId) {
    if (String(meterId).startsWith('000')) return null;
    return { meterId: String(meterId), isThreePhase: false, type: 0 };
  }

  async getAccount(meterId) {
    return this.accounts.get(String(meterId)) ?? null;
  }

  async upsertCustomer(c) {
    this.customers.set(c.customerId, c);
  }

  async bindAccount(a, existing) {
    const account = existing === undefined ? this.accounts.get(String(a.meterId)) : existing;
    const billedTo = account?.customerId ?? a.customerId;
    this.accounts.set(String(a.meterId), { ...a, customerId: billedTo });
    return billedTo;
  }

  async upsertTariff(t) {
    this.tariffs.set(t.tariffId, t);
  }

  async vendCredit({ meterId, amountNaira }) {
    const account = this.accounts.get(String(meterId));
    const price = this.tariffs.get(account?.tariffId)?.price || 200;
    const token = Array.from({ length: 20 }, () => randomInt(0, 10)).join('');
    this.receipt += 1;
    return {
      receiptId: String(this.receipt),
      token,
      units: Math.floor((amountNaira / price) * 100) / 100,
      totalPaid: amountNaira,
      tax: 0,
    };
  }

  async pushToken({ meterId, token }) {
    this.tasks.push({ kind: 'token', meterId, token });
    return { taskId: String(this.tasks.length) };
  }

  async control({ meterId, action }) {
    this.tasks.push({ kind: action, meterId });
    return { taskId: String(this.tasks.length) };
  }

  async onlineStatus(meterId) {
    const online = !String(meterId).endsWith('9');
    return { online, lastSeen: new Date(Date.now() - (online ? 60_000 : 3 * HOUR)).toISOString() };
  }

  async loadProfile({ meterId, from, to }) {
    const start = new Date(from).getTime();
    const end = Math.min(new Date(to).getTime(), Date.now());
    const step = end - start <= 8 * DAY ? HOUR : DAY;
    const rows = [];
    let register = 1000 + seed(meterId) * 5000 + Math.floor(start / DAY) * 9;
    for (let t = Math.floor(start / step) * step; t <= end; t += step) {
      if (step === HOUR) register += hourlyKwh(meterId, t);
      else for (let h = 0; h < 24; h++) register += hourlyKwh(meterId, t + h * HOUR);
      rows.push({
        meterId,
        currentDate: new Date(t).toISOString(),
        headline: 'Total Active Energy(kWh)',
        data: register.toFixed(2),
      });
    }
    return rows;
  }

  async instantaneous({ meterId }) {
    const t = Date.now();
    const kw = hourlyKwh(meterId, t) * (0.9 + Math.random() * 0.2);
    const volts = 225 + Math.random() * 10;
    return [{
      meterId,
      currentDate: new Date(t).toISOString(),
      headline: 'Voltage(V),Current(A),Active Power(kW),Frequency(Hz)',
      data: [volts.toFixed(1), ((kw * 1000) / volts).toFixed(2), kw.toFixed(3), '50.0'].join(','),
    }];
  }

  async events({ meterId }) {
    if (!String(meterId).endsWith('7')) return [];
    return [{ at: new Date(Date.now() - 2 * HOUR).toISOString(), code: 41, content: 'Meter cover opened' }];
  }
}
