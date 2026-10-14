// Client for the Geni (Calin) prepaid-meter head-end. Every endpoint is a POST
// returning { code, reason, result }; auth is a bearer JWT from /API/User/Login.
import { config } from '../config.js';
import { upstream } from '../util/errors.js';

export class GeniError extends Error {
  constructor(message, { status, code, path } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.path = path;
  }
}

function jwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : Date.now() + 60 * 60 * 1000;
  } catch {
    return Date.now() + 60 * 60 * 1000;
  }
}

const fmtDate = (d) => new Date(d).toISOString();

export class GeniClient {
  constructor(cfg = config.geni, fetchImpl = fetch) {
    this.cfg = cfg;
    this.fetch = fetchImpl;
    this.token = null;
    this.tokenExpiresAt = 0;
    this.loggingIn = null;
  }

  async login() {
    const res = await this.raw('/API/User/Login', {
      userId: this.cfg.userId,
      password: this.cfg.password,
      company: this.cfg.company,
    }, { auth: false });
    const token = res?.token;
    if (!token) throw new GeniError('Meter head-end login returned no token', { path: '/API/User/Login' });
    this.token = token;
    this.tokenExpiresAt = jwtExpiry(token);
    return token;
  }

  async ensureToken() {
    if (this.token && this.tokenExpiresAt - Date.now() > 5 * 60 * 1000) return this.token;
    this.loggingIn ??= this.login().finally(() => {
      this.loggingIn = null;
    });
    return this.loggingIn;
  }

  async raw(path, body, { auth = true, retried = false } = {}) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/plain' };
    if (auth) headers.Authorization = `Bearer ${await this.ensureToken()}`;
    let response;
    try {
      response = await this.fetch(`${this.cfg.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (err) {
      throw new GeniError(`Meter head-end unreachable: ${err.message}`, { path });
    }
    if (response.status === 401 && auth && !retried) {
      this.token = null;
      return this.raw(path, body, { auth, retried: true });
    }
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new GeniError(
        `No head-end API answered at this address (HTTP ${response.status}). Check the port: the API is usually :9200, the website :9201.`,
        { status: response.status, path },
      );
    }
    if (!response.ok) {
      throw new GeniError(json?.reason || `Meter head-end error ${response.status}`, { status: response.status, path });
    }
    const code = Number(json.code);
    if (json.code !== undefined && !this.cfg.successCodes.includes(code)) {
      throw new GeniError(json.reason || `Meter head-end rejected the request (code ${json.code})`, { code, path });
    }
    return json.result;
  }

  base(extra = {}) {
    return { company: this.cfg.company, ...extra };
  }

  async getMeter(meterId) {
    const result = await this.raw('/API/Meter/Read', this.base({ meterId, pageNumber: 1, pageSize: 5 }));
    const m = (result?.data ?? []).find((row) => String(row.meterId) === String(meterId));
    return m ? { meterId: m.meterId, isThreePhase: Boolean(m.isThreePhase), type: m.type } : null;
  }

  async getAccount(meterId) {
    const result = await this.raw('/API/Account/Read', this.base({ meterId, pageNumber: 1, pageSize: 5 }));
    return (result?.data ?? []).find((row) => String(row.meterId) === String(meterId)) ?? null;
  }

  async upsertCustomer({ customerId, customerName, phone, address }) {
    const row = this.base({ customerId, customerName, phone, address, type: this.cfg.customerType, remark: 'smeter' });
    const existing = await this.raw('/API/Customer/Read', this.base({ customerId, pageNumber: 1, pageSize: 1 }));
    const exists = (existing?.data ?? []).some((c) => c.customerId === customerId);
    await this.raw(exists ? '/API/Customer/Update' : '/API/Customer/Create', [row]);
  }

  /**
   * Put the meter on `tariffId`. An account is keyed by customer + meter, so a
   * meter that already has an account keeps it (and its customer); only its
   * tariff and region change. Returns the customer id the meter is billed under.
   */
  async bindAccount({ customerId, meterId, region, tariffId }, existing) {
    const account = existing === undefined ? await this.getAccount(meterId) : existing;
    const billedTo = account?.customerId ?? customerId;
    // "region" refers to a head-end region record (by default the operator
    // user), not a free-text address: keep an existing account's region, and
    // use the operator's for new accounts.
    const row = this.base({
      customerId: billedTo,
      meterId,
      region: account?.region || this.cfg.region || this.cfg.userId || region,
      tariffId,
      // Required by the head-end on update (it errors without them, although the
      // API collection doesn't list them): the second-rate tariff and CT ratio.
      tariffS2: tariffId,
      ctRatio: account?.ctRatio ?? '1',
      remark: 'smeter',
    });
    await this.raw(account ? '/API/Account/Update' : '/API/Account/Create', [row]);
    return billedTo;
  }

  async upsertTariff({ tariffId, tariffName, price, tax = 0 }) {
    const row = this.base({ tariffId, tariffName, price, tax, remark: 'smeter landlord tariff' });
    const existing = await this.raw('/API/Tariff/Read', this.base({ tariffId, pageNumber: 1, pageSize: 1 }));
    const exists = (existing?.data ?? []).some((t) => t.tariffId === tariffId);
    await this.raw(exists ? '/API/Tariff/Update' : '/API/Tariff/Create', [row]);
  }

  async vendCredit({ meterId, amountNaira, serialNumber }) {
    const r = await this.raw('/API/Token/CreditToken/Generate', this.base({
      meterId,
      amount: amountNaira,
      isPreview: false,
      isVendByTotalPaid: true,
      authorizationPassword: this.cfg.authorizationPassword,
      serialNumber,
    }));
    if (!r?.token) throw new GeniError('Token generation returned no token');
    let receiptId = String(r.receiptId ?? '');
    // The head-end sometimes answers a real vend with receiptId 0; the record has the real one.
    if (!receiptId || receiptId === '0') receiptId = (await this.findReceiptId({ meterId, token: r.token })) ?? receiptId;
    return {
      receiptId,
      token: String(r.token),
      units: Number(r.totalUnit ?? 0),
      totalPaid: Number(r.totalPaid ?? amountNaira),
      tax: Number(r.tax ?? 0),
    };
  }

  /** Receipt id of the credit-token record for this meter + token, or null (never throws). */
  async findReceiptId({ meterId, token }) {
    const digits = (t) => String(t).replace(/\D/g, '');
    try {
      const result = await this.raw('/API/Token/CreditTokenRecord/Read', this.base({ meterId, pageNumber: 1, pageSize: 20 }));
      const hit = (result?.data ?? [])
        .filter((row) => String(row.meterId) === String(meterId) && digits(row.token) === digits(token))
        .sort((a, b) => Number(b.receiptId) - Number(a.receiptId))[0];
      return hit && Number(hit.receiptId) > 0 ? String(hit.receiptId) : null;
    } catch {
      return null;
    }
  }

  async pushToken({ customerId, meterId, token }) {
    const result = await this.raw('/API/RemoteMeterTask/CreateTokenTask', [
      this.base({ customerId, meterId, protocolId: this.cfg.tokenTaskProtocolId, data: token }),
    ]);
    return { taskId: extractTaskId(result) };
  }

  async control({ customerId, meterId, action }) {
    const disconnect = action === 'disconnect';
    const result = await this.raw('/API/RemoteMeterTask/CreateControlTask', [
      this.base({
        customerId,
        meterId,
        protocolId: disconnect ? this.cfg.disconnectProtocolId : this.cfg.reconnectProtocolId,
        data: disconnect ? this.cfg.disconnectData : this.cfg.reconnectData,
      }),
    ]);
    return { taskId: extractTaskId(result) };
  }

  async onlineStatus(meterId) {
    const result = await this.raw('/API/GPRSOnlineStatus/View', this.base({ meterId }));
    const row = (Array.isArray(result) ? result : [result]).find((r) => r && String(r.meterId) === String(meterId));
    if (!row) return { online: false, lastSeen: null };
    const online = row.isOnline === true || row.isOnline === 'true' || row.isOnline === 1;
    return { online, lastSeen: row.statusUpdateDate ?? null };
  }

  async curve(path, { meterId, isThreePhase, from, to, maxPages = 20 }) {
    const rows = [];
    for (let page = 1; page <= maxPages; page++) {
      const result = await this.raw(path, {
        lang: 'en',
        IsThreePhase: isThreePhase ? 1 : 0,
        pageNumber: page,
        pageSize: 500,
        meterId,
        createDateRange: [fmtDate(from), fmtDate(to)],
        Company: this.cfg.company,
      });
      const data = result?.data ?? [];
      rows.push(...data);
      if (data.length < 500 || rows.length >= (result?.total ?? 0)) break;
    }
    return rows;
  }

  loadProfile(args) {
    return this.curve('/API/LoadProfile/ElectricEnergyCurve', args);
  }

  instantaneous(args) {
    return this.curve('/API/LoadProfile/InstantaneousValueCurve', { ...args, maxPages: 1 });
  }

  async events({ meterId, from, to }) {
    const result = await this.raw('/API/EventNotification/Read', this.base({
      meterId,
      lang: 'en',
      currentDateRange: [fmtDate(from), fmtDate(to)],
      pageNumber: 1,
      pageSize: 50,
    }));
    return (result?.data ?? []).map((e) => ({
      at: e.currentDate ?? e.createDate,
      code: e.eventCode,
      content: e.eventContent,
    }));
  }
}

function extractTaskId(result) {
  if (result == null) return null;
  if (typeof result === 'number' || typeof result === 'string') return String(result);
  if (Array.isArray(result)) return result.length ? extractTaskId(result[0]) : null;
  return result.id != null ? String(result.id) : null;
}

/** Map head-end failures to a 502 for API callers. */
export function asUpstream(err) {
  if (err instanceof GeniError) return upstream(err.message, { path: err.path, code: err.code });
  return err;
}
