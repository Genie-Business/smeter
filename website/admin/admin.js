// smeter admin dashboard: vanilla JS, hash-routed, talks to /v1/staff/*.
const API = (window.SMETER_API || '').replace(/\/$/, '');
// The dashboard lives at <site>/admin/, so the website is one level up.
const SITE = new URL('..', location.href).href.replace(/\/$/, '');
const app = document.getElementById('app');
const TOKEN_KEY = 'smeter.staff.token';

// Safe templating
class Raw { constructor(s) { this.s = s; } }
const raw = (s) => new Raw(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v instanceof Raw) out += v.s;
      else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
      else out += esc(v);
    }
  });
  return raw(out);
}
const render = (el, tpl) => (el.innerHTML = tpl.s);

// Formatting
const naira = (n) => (n == null ? '-' : '₦' + Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const nairaWhole = (n) => (n == null ? '-' : '₦' + Math.round(Number(n)).toLocaleString('en-NG'));
const num = (n) => (n == null ? '-' : Number(n).toLocaleString('en-NG'));
const date = (s) => (s ? new Date(s).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
const dateTime = (s) => (s ? new Date(s).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '-');
const humanize = (k) => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, (c) => c.toUpperCase());

const STATUS_TONE = { vended: 'ok', pending: 'warn', paid: 'info', vending: 'info', failed: 'bad', abandoned: '', active: 'ok', invited: 'warn', new: 'brand', contacted: 'info', surveyed: 'info', onboarded: 'ok', closed: '' };
const statusPill = (s) => html`<span class="pill ${STATUS_TONE[s] ?? ''}">${humanize(s)}</span>`;
const modePill = (m) => (m === 'manual' ? html`<span class="pill warn">Manual token</span>` : html`<span class="pill info">GPRS</span>`);

// API
let token = localStorage.getItem(TOKEN_KEY);
let me = null;

async function api(path, { method = 'GET', body, raw: rawBody, headers } = {}) {
  const res = await fetch(`${API}/v1/staff${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') {
    signOut();
    throw new Error('Your session expired. Sign in again.');
  }
  if (!res.ok) {
    const e = new Error(json?.error?.message || `Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return json;
}

function toast(msg, bad = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show${bad ? ' bad' : ''}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.className = ''), 2800);
}

function signOut() {
  token = null;
  me = null;
  localStorage.removeItem(TOKEN_KEY);
  location.hash = '#/login';
}

// Icons
const I = {
  home: '<path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  owners: '<path d="M4 21V8l8-5 8 5v13M9 21v-6h6v6"/>',
  meters: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8v4H8zM9 15h.01M12 15h.01M15 15h.01"/>',
  purchases: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  leads: '<path d="M4 4h16v12H5l-1 4z"/>',
  signups: '<path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14"/>',
  site: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  team: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 11a3 3 0 1 0 0-6M21 20c0-2.6-1.7-4.8-4-5.6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/>',
};
const icon = (name) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${I[name]}</svg>`);
const brandMark = raw('<span class="mark"><svg viewBox="0 0 24 24"><path d="M13.5 3 6 13.5h4.8L9.5 21 18 10h-5.2z" fill="#fcdd71"/></svg></span>');

// Router
const routes = [
  [/^#\/?$/, overview],
  [/^#\/owners$/, ownersList],
  [/^#\/owners\/(\d+)$/, ownerDetail],
  [/^#\/meters$/, metersList],
  [/^#\/meters\/([\w-]+)$/, meterDetail],
  [/^#\/purchases$/, purchasesList],
  [/^#\/leads$/, leadsList],
  [/^#\/signups$/, signupsList],
  [/^#\/content\/(site|app)$/, contentEditor],
  [/^#\/team$/, team],
  [/^#\/settings\/payments$/, paymentSettings],
  [/^#\/settings\/pricing$/, tariffSettings],
];

let leaveGuard = null; // returns true if navigation should be blocked

async function route() {
  const hash = location.hash || '#/';
  if (!token) return loginView();
  if (hash === '#/login') return (location.hash = '#/');
  if (!me) {
    try {
      me = (await api('/me')).staff;
    } catch {
      return loginView();
    }
  }
  const match = routes.find(([re]) => re.test(hash));
  shell(hash);
  const main = document.getElementById('main');
  render(main, html`<div class="empty">Loading...</div>`);
  try {
    if (!match) return render(main, html`<div class="empty">Page not found.</div>`);
    await match[1](main, ...hash.match(match[0]).slice(1));
  } catch (e) {
    render(main, html`<div class="err-box">${e.message}</div>`);
  }
}

let lastHash = location.hash;
addEventListener('hashchange', () => {
  if (leaveGuard && leaveGuard() && !confirm('You have unsaved changes. Leave without saving?')) {
    history.replaceState(null, '', lastHash);
    return;
  }
  leaveGuard = null;
  lastHash = location.hash;
  route();
});
addEventListener('beforeunload', (e) => {
  if (leaveGuard && leaveGuard()) e.preventDefault();
});

let attention = null;

function shell(hash) {
  if (document.getElementById('main')) {
    document.querySelectorAll('.side a[href^="#"]').forEach((a) => {
      const h = a.getAttribute('href');
      a.classList.toggle('on', h === '#/' ? hash === '#/' || hash === '#' : hash.startsWith(h));
    });
    document.querySelector('.shell')?.classList.remove('nav-open');
    return;
  }
  const link = (href, ic, label, count) =>
    html`<a href="${href}">${icon(ic)}<span>${label}</span>${count ? html`<span class="count">${count}</span>` : ''}</a>`;
  render(app, html`
    <div class="shell">
      <aside class="side">
        <div class="brand">${brandMark}<span>smeter<small>Admin</small></span></div>
        <nav aria-label="Admin">
          ${link('#/', 'home', 'Overview')}
          <div class="group">Operations</div>
          ${link('#/owners', 'owners', 'Property owners')}
          ${link('#/meters', 'meters', 'Meters')}
          ${link('#/purchases', 'purchases', 'Purchases')}
          <div class="group">Growth</div>
          ${link('#/leads', 'leads', 'Owner leads', attention?.newLeads)}
          ${link('#/signups', 'signups', 'App sign-ups')}
          <div class="group">Content</div>
          ${link('#/content/site', 'site', 'Website')}
          ${link('#/content/app', 'phone', 'Mobile app')}
          <div class="group">Settings</div>
          ${link('#/settings/payments', 'card', 'Payments')}
          ${link('#/settings/pricing', 'tag', 'Pricing')}
          ${link('#/team', 'team', 'Team')}
        </nav>
        <div class="me"><b>${me.name}</b>${me.email}<br><span class="pill brand" style="margin-top:6px">${humanize(me.role)}</span><br><button type="button" id="signout">Sign out</button></div>
      </aside>
      <div>
        <div class="topbar"><button type="button" id="navbtn" aria-label="Open menu">${icon('menu')}</button><div class="brand" style="color:#fff">${brandMark}smeter</div><span></span></div>
        <main class="main" id="main"></main>
      </div>
    </div>`);
  document.getElementById('signout').onclick = signOut;
  document.getElementById('navbtn').onclick = (e) => {
    e.stopPropagation();
    document.querySelector('.shell').classList.toggle('nav-open');
  };
  document.querySelector('.shell').addEventListener('click', (e) => {
    if (!e.target.closest('.side') && !e.target.closest('#navbtn')) document.querySelector('.shell').classList.remove('nav-open');
  });
  shell(hash);
}

// Login
function loginView() {
  render(app, html`
    <div class="login">
      <form class="card" id="login" novalidate>
        <div class="brand" style="margin-bottom:22px">${brandMark}<span>smeter<small>Admin dashboard</small></span></div>
        <h1 style="font-size:22px;margin-bottom:4px">Sign in</h1>
        <p class="muted" style="margin:0 0 18px">For the smeter team. Property owners use the app.</p>
        <div id="login-err"></div>
        <div class="field"><label for="email">Email</label><input class="input" id="email" type="email" autocomplete="username" required></div>
        <div class="field"><label for="password">Password</label><input class="input" id="password" type="password" autocomplete="current-password" required></div>
        <button class="btn primary" style="width:100%;margin-top:6px" type="submit">Sign in</button>
      </form>
    </div>`);
  document.getElementById('email').focus();
  document.getElementById('login').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      const r = await api('/login', { method: 'POST', body: { email: e.target.email.value, password: e.target.password.value } });
      token = r.token;
      me = r.staff;
      localStorage.setItem(TOKEN_KEY, token);
      location.hash = '#/';
      route();
    } catch (err) {
      render(document.getElementById('login-err'), html`<div class="err-box">${err.message}</div>`);
      btn.disabled = false;
    }
  };
}

// Shared bits
function pager(main, { page, pageSize, total }, onPage) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const el = document.createElement('div');
  el.className = 'pager';
  render(el, html`<span>${num(total)} total · page ${page} of ${pages}</span><span style="display:flex;gap:6px">
    <button class="btn sm" ${page <= 1 ? raw('disabled') : ''} data-p="${page - 1}">Previous</button>
    <button class="btn sm" ${page >= pages ? raw('disabled') : ''} data-p="${page + 1}">Next</button></span>`);
  el.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => onPage(Number(b.dataset.p))));
  main.appendChild(el);
}

function purchaseRows(list, { showMeter = true } = {}) {
  if (!list.length) return html`<tr><td colspan="7" class="empty">No purchases yet.</td></tr>`;
  return list.map((p) => html`<tr>
    <td>${dateTime(p.vendedAt || p.createdAt)}</td>
    ${showMeter ? html`<td><a href="#/meters/${p.meterId}">${p.meterId}</a></td>` : ''}
    <td class="r num">${naira(p.total)}</td>
    <td class="r num">${p.units == null ? '-' : p.units.toFixed(2)}</td>
    <td class="r num">${naira(p.landlordNet)}</td>
    <td>${statusPill(p.status)} ${p.delivery === 'manual' ? html`<span class="pill">Token</span>` : ''}</td>
    <td class="mono">${p.reference}</td>
  </tr>`);
}
const purchaseHead = (showMeter = true) =>
  html`<tr><th>When</th>${showMeter ? html`<th>Meter</th>` : ''}<th class="r">Total</th><th class="r">kWh</th><th class="r">Owner gets</th><th>Status</th><th>Reference</th></tr>`;

// Overview
async function overview(main) {
  const o = await api('/overview');
  attention = o.attention;
  const max = Math.max(1, ...o.series.map((s) => s.gross));
  render(main, html`
    <div class="page-head"><div><h1>Overview</h1><p>Last 30 days across every meter on smeter.</p></div>
      <a class="btn" href="${SITE}/" target="_blank" rel="noopener">View website ↗</a></div>
    <div class="grid g4">
      <div class="card kpi"><div class="label">Collected (30 days)</div><div class="value">${nairaWhole(o.last30.gross)}</div><div class="sub">${num(o.last30.purchases)} purchases · ${num(o.last30.units)} kWh</div></div>
      <div class="card kpi"><div class="label">Paid to owners</div><div class="value">${nairaWhole(o.last30.toOwners)}</div><div class="sub">Fees ${nairaWhole(o.last30.fees)}</div></div>
      <div class="card kpi"><div class="label">Today</div><div class="value">${nairaWhole(o.today.gross)}</div><div class="sub">${num(o.today.purchases)} purchases</div></div>
      <div class="card kpi"><div class="label">Meters</div><div class="value">${num(o.meters.total)}</div><div class="sub">${num(o.meters.active ?? 0)} active · ${num(o.meters.invited ?? 0)} invited · ${num(o.meters.manual ?? 0)} manual</div></div>
    </div>
    <div class="grid g-wide" style="margin-top:14px">
      <div class="card"><h2>Daily sales</h2>
        ${o.series.length ? html`<div class="bars">${o.series.map((s) => html`<div style="height:${Math.max(2, (s.gross / max) * 100)}%" data-tip="${date(s.day)}: ${nairaWhole(s.gross)} · ${s.purchases}"></div>`)}</div>` : html`<div class="empty">No sales in the last 30 days.</div>`}
      </div>
      <div class="card"><h2>Needs attention</h2>
        <dl class="kv">
          <dt>Owners</dt><dd><a href="#/owners">${num(o.landlords)}</a></dd>
          <dt>Waiting for token</dt><dd>${o.attention.awaitingToken ? html`<span class="pill warn">${o.attention.awaitingToken}</span>` : '0'}</dd>
          <dt>Open support tickets</dt><dd>${num(o.attention.openTickets)}</dd>
          <dt>New owner leads</dt><dd><a href="#/leads">${num(o.attention.newLeads)}</a></dd>
          <dt>App sign-ups</dt><dd><a href="#/signups">${num(o.attention.notifySignups)}</a></dd>
          <dt>Supply off</dt><dd>${num(o.meters.off ?? 0)}</dd>
        </dl>
      </div>
    </div>
    <div class="card" style="margin-top:14px;padding:0"><h2 style="padding:16px 18px 0">Latest purchases</h2>
      <div class="table-wrap" style="border:0;border-top:1px solid var(--line);border-radius:0 0 var(--r) var(--r);margin-top:12px"><table><thead>${purchaseHead()}</thead><tbody>${purchaseRows(o.recent)}</tbody></table></div>
    </div>`);
  const count = document.querySelector('.side a[href="#/leads"] .count');
  if (!count && attention.newLeads) document.querySelector('.side a[href="#/leads"]').insertAdjacentHTML('beforeend', `<span class="count">${attention.newLeads}</span>`);
}

// Owners
async function ownersList(main, _x, state = { page: 1, search: '' }) {
  const r = await api(`/landlords?page=${state.page}&search=${encodeURIComponent(state.search)}`);
  render(main, html`
    <div class="page-head"><div><h1>Property owners</h1><p>Everyone who manages meters on smeter.</p></div></div>
    <div class="toolbar"><input class="input" id="q" type="search" placeholder="Search name, email or phone" value="${state.search}"></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Owner</th><th>Phone</th><th class="r">Meters</th><th class="r">Collected</th><th class="r">Earned</th><th>Payouts</th><th>Joined</th></tr></thead>
      <tbody>${r.data.length ? r.data.map((l) => html`<tr class="link" data-href="#/owners/${l.id}">
        <td><b>${l.fullName}</b><div class="muted">${l.email}</div></td><td>${l.phone}</td>
        <td class="r num">${l.meterCount}</td><td class="r num">${nairaWhole(l.collected)}</td><td class="r num">${nairaWhole(l.earned)}</td>
        <td>${l.bank ? (l.bank.settlementActive ? html`<span class="pill ok">Automatic</span>` : html`<span class="pill warn">Unverified</span>`) : html`<span class="pill">Not set</span>`}</td>
        <td>${date(l.createdAt)}</td></tr>`) : html`<tr><td colspan="7" class="empty">No property owners match.</td></tr>`}</tbody>
    </table></div>`);
  pager(main, r, (page) => ownersList(main, null, { ...state, page }));
  wireRows(main);
  wireSearch(main, state.search, (search) => ownersList(main, null, { page: 1, search }));
}

async function ownerDetail(main, id) {
  const r = await api(`/landlords/${id}`);
  const l = r.landlord;
  render(main, html`
    <a class="crumb" href="#/owners">← Property owners</a>
    <div class="page-head"><div><h1>${l.fullName}</h1><p>${l.email} · ${l.phone} · joined ${date(l.createdAt)}</p></div></div>
    <div class="grid g4">
      <div class="card kpi"><div class="label">Meters</div><div class="value">${r.meters.length}</div></div>
      <div class="card kpi"><div class="label">Collected</div><div class="value">${nairaWhole(r.totals.collected)}</div><div class="sub">${num(r.totals.purchases)} purchases</div></div>
      <div class="card kpi"><div class="label">Earned</div><div class="value">${nairaWhole(r.totals.earned)}</div></div>
      <div class="card kpi"><div class="label">Units sold</div><div class="value">${num(r.totals.units)}</div><div class="sub">kWh</div></div>
    </div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card"><h2>Pricing</h2><dl class="kv">
        <dt>Price per kWh</dt><dd>${l.unitPrice ? naira(l.unitPrice) : 'Not set'}</dd>
        <dt>Service fee paid by</dt><dd>${humanize(l.feeBearer)}</dd>
        <dt>Address</dt><dd>${l.address || '-'}</dd></dl></div>
      <div class="card"><h2>Payout account</h2>${l.bank ? html`<dl class="kv">
        <dt>Bank</dt><dd>${l.bank.bankName}</dd><dt>Account</dt><dd class="mono">${l.bank.accountNumber}</dd>
        <dt>Name</dt><dd>${l.bank.accountName}</dd><dt>Status</dt><dd>${l.bank.settlementActive ? html`<span class="pill ok">Automatic payouts</span>` : html`<span class="pill warn">Unverified</span>`}</dd></dl>` : html`<p class="muted">No payout account yet.</p>`}</div>
    </div>
    <h2 style="margin:22px 0 10px;font-size:17px">Meters</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Meter</th><th>Tenant</th><th>Address</th><th>Mode</th><th>Status</th><th class="r">Debt</th></tr></thead>
      <tbody>${r.meters.length ? r.meters.map((m) => html`<tr class="link" data-href="#/meters/${m.meterId}">
        <td class="mono">${m.meterId}</td><td>${[m.tenant.firstName, m.tenant.lastName].filter(Boolean).join(' ') || '-'}<div class="muted">${m.tenant.phone}</div></td>
        <td>${m.address}${m.apartment ? `, Apt ${m.apartment}` : ''}</td><td>${modePill(m.deliveryMode)}</td><td>${statusPill(m.status)}</td><td class="r num">${m.debt ? naira(m.debt) : '-'}</td></tr>`) : html`<tr><td colspan="6" class="empty">No meters yet.</td></tr>`}</tbody>
    </table></div>
    <h2 style="margin:22px 0 10px;font-size:17px">Recent purchases</h2>
    <div class="table-wrap"><table><thead>${purchaseHead()}</thead><tbody>${purchaseRows(r.purchases)}</tbody></table></div>`);
  wireRows(main);
}

// Meters
async function metersList(main, _x, state = { page: 1, search: '', mode: '', status: '' }) {
  const q = new URLSearchParams({ page: state.page, search: state.search, mode: state.mode, status: state.status });
  const r = await api(`/meters?${q}`);
  const opt = (v, label, cur) => html`<option value="${v}" ${v === cur ? raw('selected') : ''}>${label}</option>`;
  render(main, html`
    <div class="page-head"><div><h1>Meters</h1><p>Every meter, its tenant and owner.</p></div></div>
    <div class="toolbar">
      <input class="input" id="q" type="search" placeholder="Search meter, address, tenant or owner" value="${state.search}">
      <select class="input" id="mode" style="width:auto">${opt('', 'All modes', state.mode)}${opt('ota', 'GPRS', state.mode)}${opt('manual', 'Manual token', state.mode)}</select>
      <select class="input" id="status" style="width:auto">${opt('', 'Any status', state.status)}${opt('active', 'Active', state.status)}${opt('invited', 'Invited', state.status)}</select>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Meter</th><th>Owner</th><th>Tenant</th><th>Mode</th><th>Status</th><th class="r">Spent</th><th>Last purchase</th></tr></thead>
      <tbody>${r.data.length ? r.data.map((m) => html`<tr class="link" data-href="#/meters/${m.meterId}">
        <td class="mono">${m.meterId}<div class="muted" style="font-family:var(--font)">${m.address}${m.apartment ? `, Apt ${m.apartment}` : ''}</div></td>
        <td>${m.landlordName}</td><td>${[m.tenant.firstName, m.tenant.lastName].filter(Boolean).join(' ') || '-'}<div class="muted">${m.tenant.phone}</div></td>
        <td>${modePill(m.deliveryMode)}</td><td>${statusPill(m.status)} ${m.relayState.startsWith('disconnect') ? html`<span class="pill bad">Off</span>` : ''}</td>
        <td class="r num">${nairaWhole(m.spent)}</td><td>${date(m.lastPurchase)}</td></tr>`) : html`<tr><td colspan="7" class="empty">No meters match.</td></tr>`}</tbody>
    </table></div>`);
  pager(main, r, (page) => metersList(main, null, { ...state, page }));
  wireRows(main);
  wireSearch(main, state.search, (search) => metersList(main, null, { ...state, page: 1, search }));
  main.querySelector('#mode').onchange = (e) => metersList(main, null, { ...state, page: 1, mode: e.target.value });
  main.querySelector('#status').onchange = (e) => metersList(main, null, { ...state, page: 1, status: e.target.value });
}

async function meterDetail(main, meterId) {
  const r = await api(`/meters/${encodeURIComponent(meterId)}`);
  const m = r.meter;
  const live = r.live;
  render(main, html`
    <a class="crumb" href="#/meters">← Meters</a>
    <div class="page-head"><div><h1 class="mono" style="font-size:24px">${m.meterId}</h1><p>${m.address}${m.apartment ? `, Apt ${m.apartment}` : ''}</p></div>
      <div style="display:flex;gap:6px">${modePill(m.deliveryMode)} ${statusPill(m.status)}</div></div>
    <div class="grid g3">
      <div class="card"><h2>Tenant</h2><dl class="kv">
        <dt>Name</dt><dd>${[m.tenant.firstName, m.tenant.lastName].filter(Boolean).join(' ') || '-'}</dd>
        <dt>Phone</dt><dd>${m.tenant.phone}</dd><dt>Email</dt><dd>${m.tenant.email || '-'}</dd>
        <dt>Connected</dt><dd>${m.acceptedAt ? date(m.acceptedAt) : 'Not yet'}</dd>
        <dt>Debt</dt><dd>${m.debt ? `${naira(m.debt)} · ${m.debtRecoveryPercent}% per purchase` : 'None'}</dd></dl></div>
      <div class="card"><h2>Owner</h2>${r.landlord ? html`<dl class="kv"><dt>Name</dt><dd><a href="#/owners/${r.landlord.id}">${r.landlord.fullName}</a></dd><dt>Phone</dt><dd>${r.landlord.phone}</dd><dt>Email</dt><dd>${r.landlord.email}</dd></dl>` : html`<p class="muted">-</p>`}</div>
      <div class="card"><h2>Meter link</h2>${m.deliveryMode === 'manual' ? html`<p class="muted">Manual-token meter. It has no GPRS link, so there are no live readings.</p>` : live ? html`<dl class="kv">
        <dt>Connection</dt><dd>${live.online ? html`<span class="pill ok">Online</span>` : html`<span class="pill warn">Offline</span>`}</dd>
        <dt>Last seen</dt><dd>${dateTime(live.lastSeen)}</dd><dt>Voltage</dt><dd>${live.volts == null ? '-' : live.volts.toFixed(0) + ' V'}</dd>
        <dt>Current</dt><dd>${live.amps == null ? '-' : live.amps.toFixed(1) + ' A'}</dd><dt>Load</dt><dd>${live.kw == null ? '-' : live.kw.toFixed(2) + ' kW'}</dd>
        <dt>Supply</dt><dd>${humanize(m.relayState)}</dd></dl>` : html`<p class="muted">Couldn’t reach the meter head-end.</p>`}</div>
    </div>
    <h2 style="margin:22px 0 10px;font-size:17px">Purchases</h2>
    <div class="table-wrap"><table><thead>${purchaseHead(false)}</thead><tbody>${purchaseRows(r.purchases, { showMeter: false })}</tbody></table></div>`);
}

// Purchases
async function purchasesList(main, _x, state = { page: 1, status: '' }) {
  const r = await api(`/purchases?page=${state.page}&status=${state.status}`);
  const statuses = ['', 'vended', 'pending', 'paid', 'failed', 'abandoned'];
  render(main, html`
    <div class="page-head"><div><h1>Purchases</h1><p>Every power purchase, newest first.</p></div></div>
    <div class="toolbar"><select class="input" id="status" style="width:auto">${statuses.map((s) => html`<option value="${s}" ${s === state.status ? raw('selected') : ''}>${s ? humanize(s) : 'All statuses'}</option>`)}</select></div>
    <div class="table-wrap"><table><thead>${purchaseHead()}</thead><tbody>${purchaseRows(r.data)}</tbody></table></div>`);
  pager(main, r, (page) => purchasesList(main, null, { ...state, page }));
  main.querySelector('#status').onchange = (e) => purchasesList(main, null, { page: 1, status: e.target.value });
}

// Leads & sign-ups
async function leadsList(main, _x, state = { page: 1 }) {
  const r = await api(`/leads?page=${state.page}`);
  const statuses = ['new', 'contacted', 'surveyed', 'onboarded', 'closed'];
  render(main, html`
    <div class="page-head"><div><h1>Owner leads</h1><p>Site-survey requests from the property-owner page.</p></div>
      <a class="btn" href="${SITE}/owners#survey" target="_blank" rel="noopener">View form ↗</a></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Received</th><th>Contact</th><th>Property</th><th>Message</th><th>Status</th><th>Note</th></tr></thead>
      <tbody>${r.data.length ? r.data.map((l) => html`<tr data-id="${l.id}">
        <td>${dateTime(l.createdAt)}</td>
        <td><b>${l.fullName}</b><div><a href="tel:${l.phone}">${l.phone}</a></div>${l.email ? html`<div><a href="mailto:${l.email}">${l.email}</a></div>` : ''}</td>
        <td>${l.city || '-'}<div class="muted">${l.propertyType ? humanize(l.propertyType) : ''}${l.units ? ` · ${l.units} units` : ''}</div></td>
        <td style="max-width:260px">${l.message || '-'}</td>
        <td><select class="input lead-status" style="width:auto">${statuses.map((s) => html`<option value="${s}" ${s === l.status ? raw('selected') : ''}>${humanize(s)}</option>`)}</select></td>
        <td><textarea class="input lead-note" rows="2" placeholder="Add a note">${l.note || ''}</textarea></td></tr>`) : html`<tr><td colspan="6" class="empty">No leads yet. They’ll appear here when owners book a survey on the website.</td></tr>`}</tbody>
    </table></div>`);
  pager(main, r, (page) => leadsList(main, null, { page }));
  main.querySelectorAll('tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id;
    const save = async (body) => {
      try {
        await api(`/leads/${id}`, { method: 'PATCH', body });
        toast('Lead updated');
      } catch (e) {
        toast(e.message, true);
      }
    };
    tr.querySelector('.lead-status').onchange = (e) => save({ status: e.target.value });
    tr.querySelector('.lead-note').onchange = (e) => save({ note: e.target.value });
  });
}

async function signupsList(main) {
  const r = await api('/notify-requests');
  render(main, html`
    <div class="page-head"><div><h1>App sign-ups</h1><p>People who asked to be told when the app is in the stores.</p></div>
      <button class="btn" id="csv" ${r.data.length ? '' : raw('disabled')}>Export CSV</button></div>
    <div class="table-wrap"><table><thead><tr><th>Contact</th><th>Phone type</th><th>Signed up</th></tr></thead>
      <tbody>${r.data.length ? r.data.map((s) => html`<tr><td>${s.contact}</td><td>${humanize(s.platform)}</td><td>${dateTime(s.createdAt)}</td></tr>`) : html`<tr><td colspan="3" class="empty">No sign-ups yet.</td></tr>`}</tbody></table></div>`);
  main.querySelector('#csv').onclick = () => {
    const rows = [['contact', 'platform', 'signed_up'], ...r.data.map((s) => [s.contact, s.platform, s.createdAt])];
    const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'smeter-app-signups.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };
}

// Content editor
const LONG_KEYS = /^(body|intro|mission|caption|a|comingSoonBody|formBody|formSuccess|note|message|label)$/;
const SELECTS = {
  'announcement.tone': ['info', 'success', 'warn', 'danger'],
  'announcement.audience': ['all', 'tenants', 'owners'],
};
const HINTS = {
  'home.body': 'Wrap words in **double asterisks** to make them bold.',
  'home.headline': 'Four short lines (about 10 characters each). Longer lines make the whole headline shrink.',
  'product.headline': 'Keep each line short. Every item is one line of the big headline.',
  'company.headline': 'Keep each line short. Every item is one line of the big headline.',
  'owners.headline': 'Keep each line short. Every item is one line of the big headline.',
  'download.androidUrl': 'Google Play listing URL. Leave empty to show “coming soon” and collect sign-ups.',
  'download.iosUrl': 'App Store listing URL. Leave empty to show “coming soon”.',
  'announcement.enabled': 'Shows a banner on the app’s home screen.',
  'buy.presets': 'Quick-pick amounts (₦) on the Buy power screen.',
};

function contentEditor(main, key) {
  const label = key === 'site' ? 'Website' : 'Mobile app';
  let doc;
  let version;
  let saved;
  let history = [];

  const imgUrl = (u) => (!u ? '' : u.startsWith('/uploads/') ? API + u : u.startsWith('assets/') ? `${SITE}/${u}` : u);
  const get = (path) => path.reduce((o, k) => o?.[k], doc);
  const set = (path, value) => {
    const parent = get(path.slice(0, -1));
    parent[path[path.length - 1]] = value;
    updateBar();
  };
  const dirty = () => JSON.stringify(doc) !== saved;
  const pathStr = (path) => path.filter((p) => typeof p === 'string').join('.');

  function field(path, value, { isImage = false } = {}) {
    const k = path[path.length - 1];
    const id = `f-${path.join('-')}`;
    const name = typeof k === 'number' ? `Item ${k + 1}` : humanize(k);
    const hint = HINTS[pathStr(path)] ? html`<div class="hint">${HINTS[pathStr(path)]}</div>` : '';
    const p = esc(JSON.stringify(path));
    if (typeof value === 'boolean') {
      return html`<div class="field"><label style="display:flex;gap:8px;align-items:center;font-size:14px"><input type="checkbox" id="${id}" data-path="${raw(p)}" data-kind="bool" ${value ? raw('checked') : ''}> ${name}</label></div>${hint}`;
    }
    if (typeof value === 'number') {
      return html`<div class="field"><label for="${id}">${name}</label><input class="input" type="number" id="${id}" data-path="${raw(p)}" data-kind="num" value="${value}"></div>${hint}`;
    }
    if (isImage) {
      return html`<div class="img-field"><div class="thumb" style="background-image:url('${imgUrl(value)}')"></div><div>
        <label for="${id}" style="font-size:12.5px;font-weight:600;color:var(--ink-soft)">${name}</label>
        <div class="row"><input class="input" id="${id}" data-path="${raw(p)}" data-kind="img" value="${value}"><button class="btn sm" type="button" data-upload="${raw(p)}">Upload</button></div></div></div>`;
    }
    const sel = SELECTS[pathStr(path)];
    if (sel) {
      return html`<div class="field"><label for="${id}">${name}</label><select class="input" id="${id}" data-path="${raw(p)}">${sel.map((o) => html`<option ${o === value ? raw('selected') : ''}>${o}</option>`)}</select></div>${hint}`;
    }
    const long = LONG_KEYS.test(String(k)) || String(value).length > 70;
    return long
      ? html`<div class="field"><label for="${id}">${name}</label><textarea class="input" id="${id}" data-path="${raw(p)}" rows="${Math.min(6, Math.ceil(String(value).length / 70) + 1)}">${value}</textarea></div>${hint}`
      : html`<div class="field"><label for="${id}">${name}</label><input class="input" id="${id}" data-path="${raw(p)}" value="${value}"></div>${hint}`;
  }

  function node(path, value, ctx = {}) {
    const k = path[path.length - 1];
    if (Array.isArray(value)) {
      const p = esc(JSON.stringify(path));
      const title = html`<div class="obj-title">${humanize(k)}</div>${HINTS[pathStr(path)] ? html`<div class="hint" style="margin:0 0 8px">${HINTS[pathStr(path)]}</div>` : ''}`;
      if (value.every((v) => typeof v !== 'object')) {
        return html`${title}<div class="str-list">${value.map((v, i) => html`<div class="row">${typeof v === 'number'
          ? html`<input class="input" type="number" data-path="${raw(esc(JSON.stringify([...path, i])))}" data-kind="num" value="${v}">`
          : html`<input class="input" data-path="${raw(esc(JSON.stringify([...path, i])))}" value="${v}">`}
          <button class="btn sm" type="button" data-del="${raw(esc(JSON.stringify([...path, i])))}" aria-label="Remove">✕</button></div>`)}
          <div><button class="btn sm" type="button" data-add="${raw(p)}">+ Add</button></div></div>`;
      }
      return html`${title}${value.map((item, i) => html`<div class="arr-item"><div class="arr-num">#${i + 1}</div>
        <div class="arr-tools">
          <button type="button" data-move="${raw(esc(JSON.stringify([...path, i])))}" data-dir="-1" aria-label="Move up" ${i === 0 ? raw('disabled') : ''}>↑</button>
          <button type="button" data-move="${raw(esc(JSON.stringify([...path, i])))}" data-dir="1" aria-label="Move down" ${i === value.length - 1 ? raw('disabled') : ''}>↓</button>
          <button type="button" data-del="${raw(esc(JSON.stringify([...path, i])))}" aria-label="Remove">✕</button></div>
        ${Object.entries(item).map(([kk, vv]) => node([...path, i, kk], vv, ctx))}</div>`)}
        <button class="btn sm" type="button" data-add="${raw(p)}" style="margin-bottom:14px">+ Add ${humanize(k).replace(/s$/, '').toLowerCase()}</button>`;
    }
    if (value && typeof value === 'object') {
      const isImages = k === 'images' || ctx.isImage;
      return html`${path.length > 1 ? html`<div class="obj-title">${humanize(k)}</div>` : ''}<div class="${path.length > 1 ? 'obj' : ''}">${Object.entries(value).map(([kk, vv]) => node([...path, kk], vv, { ...ctx, isImage: isImages }))}</div>`;
    }
    return field(path, value, { isImage: ctx.isImage });
  }

  function updateBar() {
    const bar = main.querySelector('.savebar .grow');
    if (!bar) return;
    bar.textContent = dirty() ? 'Unsaved changes' : `Saved · version ${version}`;
    main.querySelector('#save').disabled = !dirty();
    main.querySelector('#discard').disabled = !dirty();
  }

  function draw() {
    const sections = Object.keys(doc);
    const scroll = scrollY;
    render(main, html`
      <div class="page-head"><div><h1>${label} content</h1><p>${key === 'site' ? 'Copy, images, contact details and store links for the website.' : 'Onboarding text, home-screen announcement, support contacts and buy presets in the app.'}</p></div>
        ${key === 'site' ? html`<a class="btn" href="${SITE}/" target="_blank" rel="noopener">Open website ↗</a>` : ''}</div>
      <div class="editor">
        <nav class="toc" aria-label="Sections">${sections.map((s) => html`<a href="#sec-${s}" data-jump="${s}">${humanize(s)}</a>`)}
          <div class="card" style="margin-top:14px;padding:12px"><h2 style="font-size:13px;margin-bottom:8px">History</h2>
            <div class="history">${history.length ? history.slice(0, 8).map((h) => html`<div class="row"><span>v${h.version} · ${date(h.savedAt)}<br><span class="muted">${h.by || '-'}</span></span>${h.version !== version ? html`<button class="btn sm" type="button" data-restore="${h.version}">Restore</button>` : html`<span class="pill ok">Live</span>`}</div>`) : html`<span class="muted">Using defaults. Nothing saved yet.</span>`}</div>
            <button class="btn sm danger" type="button" id="reset" style="margin-top:10px;width:100%">Reset to defaults</button></div>
        </nav>
        <div>${sections.map((s) => html`<section class="card section" id="sec-${s}"><h2>${humanize(s)}</h2>${node([s], doc[s])}</section>`)}
          <div class="savebar"><span class="grow"></span><button class="btn" id="discard" type="button">Discard</button><button class="btn primary" id="save" type="button">Save &amp; publish</button></div>
        </div>
      </div>`);
    scrollTo(0, scroll);
    updateBar();
    wire();
  }

  function wire() {
    main.querySelectorAll('[data-path]').forEach((el) => {
      const path = JSON.parse(el.dataset.path);
      const evt = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(evt, () => {
        let v = el.type === 'checkbox' ? el.checked : el.value;
        if (el.dataset.kind === 'num') v = el.value === '' ? 0 : Number(el.value);
        set(path, v);
        if (el.dataset.kind === 'img') el.closest('.img-field').querySelector('.thumb').style.backgroundImage = `url('${imgUrl(v)}')`;
      });
    });
    main.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => {
      const path = JSON.parse(b.dataset.add);
      const arr = get(path);
      const blank = (v) => (Array.isArray(v) ? [] : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blank(x)])) : typeof v === 'number' ? 0 : typeof v === 'boolean' ? false : '');
      arr.push(arr.length ? blank(arr[0]) : '');
      updateBar();
      draw();
    }));
    main.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
      const path = JSON.parse(b.dataset.del);
      get(path.slice(0, -1)).splice(path[path.length - 1], 1);
      updateBar();
      draw();
    }));
    main.querySelectorAll('[data-move]').forEach((b) => (b.onclick = () => {
      const path = JSON.parse(b.dataset.move);
      const arr = get(path.slice(0, -1));
      const i = path[path.length - 1];
      const j = i + Number(b.dataset.dir);
      [arr[i], arr[j]] = [arr[j], arr[i]];
      updateBar();
      draw();
    }));
    main.querySelectorAll('[data-upload]').forEach((b) => (b.onclick = () => upload(JSON.parse(b.dataset.upload))));
    main.querySelectorAll('[data-jump]').forEach((a) => (a.onclick = (e) => {
      e.preventDefault();
      document.getElementById(`sec-${a.dataset.jump}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    main.querySelectorAll('[data-restore]').forEach((b) => (b.onclick = async () => {
      if (dirty() && !confirm('Discard your unsaved changes and restore this version?')) return;
      try {
        load(await api(`/content/${key}/restore`, { method: 'POST', body: { version: Number(b.dataset.restore) } }));
        toast(`Restored version ${b.dataset.restore}. It’s live now`);
      } catch (e) {
        toast(e.message, true);
      }
    }));
    main.querySelector('#reset').onclick = async () => {
      if (!confirm(`Reset all ${label.toLowerCase()} content to the built-in defaults? You can restore the current version from History.`)) return;
      try {
        load(await api(`/content/${key}/reset`, { method: 'POST' }));
        toast('Reset to defaults');
      } catch (e) {
        toast(e.message, true);
      }
    };
    main.querySelector('#discard').onclick = () => {
      doc = JSON.parse(saved);
      draw();
    };
    main.querySelector('#save').onclick = async (e) => {
      e.target.disabled = true;
      try {
        load(await api(`/content/${key}`, { method: 'PUT', body: { data: doc, version } }));
        toast(`${label} content published`);
      } catch (err) {
        toast(err.message, true);
        updateBar();
      }
    };
  }

  function upload(path) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 6 * 1024 * 1024) return toast('Images must be under 6 MB', true);
      try {
        const r = await api('/uploads', { method: 'POST', raw: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
        set(path, r.url);
        draw();
        toast('Image uploaded. Save to publish it');
      } catch (e) {
        toast(e.message, true);
      }
    };
    input.click();
  }

  function load(r) {
    doc = r.data;
    version = r.version;
    history = r.history || [];
    saved = JSON.stringify(doc);
    draw();
  }

  leaveGuard = () => doc && dirty();
  return api(`/content/${key}`).then(load);
}

// Team
async function team(main) {
  const r = await api('/users');
  render(main, html`
    <div class="page-head"><div><h1>Team</h1><p>People who can sign in to this dashboard.</p></div></div>
    <div class="grid g2" style="align-items:start">
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Last sign-in</th></tr></thead>
        <tbody>${r.data.map((s) => html`<tr><td><b>${s.name}</b><div class="muted">${s.email}</div></td><td><span class="pill ${s.role === 'owner' ? 'brand' : ''}">${humanize(s.role)}</span></td><td>${dateTime(s.lastLoginAt)}</td></tr>`)}</tbody></table></div>
      ${me.role === 'owner' ? html`<form class="card" id="add" novalidate><h2>Add a team member</h2>
        <div id="add-err"></div>
        <div class="field"><label for="n">Name</label><input class="input" id="n" required></div>
        <div class="field"><label for="e">Email</label><input class="input" id="e" type="email" required></div>
        <div class="field"><label for="pw">Temporary password</label><input class="input" id="pw" type="text" minlength="10" required autocomplete="new-password"><div class="hint" style="margin:4px 0 0">At least 10 characters. Share it privately.</div></div>
        <div class="field"><label for="role">Role</label><select class="input" id="role"><option value="editor">Editor: content and data</option><option value="owner">Owner: can also manage the team</option></select></div>
        <button class="btn primary" type="submit">Add member</button></form>`
        : html`<div class="card"><p class="muted">Only account owners can add team members.</p></div>`}
    </div>`);
  const form = main.querySelector('#add');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/users', { method: 'POST', body: { name: form.n.value, email: form.e.value, password: form.pw.value, role: form.role.value } });
        toast('Team member added');
        team(main);
      } catch (err) {
        render(main.querySelector('#add-err'), html`<div class="err-box">${err.message}</div>`);
      }
    };
  }
}

// Payment settings
// Same maths as the API's pricing service, for the live example.
function gatewayFeeKobo(kobo, s) {
  const pct = Math.round((kobo * s.feePercent) / 100);
  const flat = kobo >= s.feeFlatThresholdNaira * 100 ? Math.round(s.feeFlatNaira * 100) : 0;
  return Math.min(Math.round(s.feeCapNaira * 100), pct + flat);
}
function grossUpKobo(amount, s) {
  let total = amount;
  for (let i = 0; i < 8; i++) {
    const next = amount + gatewayFeeKobo(total, s);
    if (next === total) break;
    total = next;
  }
  while (total - gatewayFeeKobo(total, s) < amount) total += 1;
  return total;
}

const PAY_FIELDS = [
  ['feePercent', 'Percentage fee', '%', 'Charged on every payment.', '0.1'],
  ['feeFlatNaira', 'Flat fee', '₦', 'Added on top of the percentage for larger payments.', '1'],
  ['feeFlatThresholdNaira', 'Flat fee applies from', '₦', 'Payments at or above this amount get the flat fee.', '1'],
  ['feeCapNaira', 'Fee cap', '₦', 'The fee never goes above this.', '1'],
  ['minPurchaseNaira', 'Minimum purchase', '₦', 'Smallest amount a tenant or owner can buy.', '1'],
  ['maxPurchaseNaira', 'Maximum purchase', '₦', 'Largest amount in one payment.', '1'],
  ['auditAfterMinutes', 'Check unconfirmed payments after', 'min', 'If Paystack hasn’t confirmed a payment by then, the server asks Paystack directly.', '1'],
];

async function paymentSettings(main) {
  const r = await api('/settings/payments');
  const canEdit = me.role === 'owner';
  let saved = r.settings;
  let s = structuredClone(saved);
  const options = r.channelOptions;
  const labelOf = (id) => options.find((o) => o.id === id)?.label ?? id;
  const dirty = () => JSON.stringify(pick(s)) !== JSON.stringify(pick(saved));
  const pick = (x) => Object.fromEntries([...PAY_FIELDS.map(([k]) => [k, Number(x[k])]), ['channels', [...x.channels].sort()]]);
  leaveGuard = dirty;

  const field = ([key, label, unit, hint, step]) => html`
    <div class="field">
      <label for="f-${key}">${label}</label>
      <div class="affix ${unit === '₦' ? 'pre' : 'post'}">
        ${unit === '₦' ? html`<span>₦</span>` : ''}
        <input class="input" id="f-${key}" data-key="${key}" type="number" inputmode="decimal" min="0" step="${step}" value="${s[key]}" ${canEdit ? '' : raw('disabled')}>
        ${unit !== '₦' ? html`<span>${unit}</span>` : ''}
      </div>
      <div class="hint">${hint} <span class="muted">Default: ${unit === '₦' ? '₦' : ''}${num(r.defaults[key])}${unit !== '₦' ? ` ${unit}` : ''}</span></div>
    </div>`;

  render(main, html`
    <div class="page-head"><div><h1>Payments</h1><p>How tenants and owners pay for power. Changes apply to new payments within a few seconds.</p></div></div>
    ${canEdit ? '' : html`<div class="card" style="margin-bottom:14px"><p class="muted" style="margin:0">Only account owners can change payment settings.</p></div>`}
    <div id="pay-err"></div>
    <div class="grid g2" style="align-items:start">
      <div class="card">
        <h2>Payment channels</h2>
        <div class="field">
          <label id="ch-label">Channels offered at checkout</label>
          <div class="ms" id="channels">
            <button type="button" class="input ms-btn" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="ch-label" ${canEdit ? '' : raw('disabled')}>
              <span class="ms-val"></span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            <div class="ms-pop" role="listbox" aria-multiselectable="true" aria-labelledby="ch-label" hidden>
              ${options.map((o) => html`<label class="ms-opt"><input type="checkbox" value="${o.id}"> <span>${o.label}</span></label>`)}
            </div>
          </div>
          <div class="hint">The app only shows these, and the server refuses the others. Default: ${r.defaults.channels.map(labelOf).join(', ')}</div>
        </div>
        <h2 style="margin-top:22px">Purchase limits</h2>
        ${PAY_FIELDS.slice(4, 6).map(field)}
        <h2 style="margin-top:22px">Unconfirmed payments</h2>
        ${field(PAY_FIELDS[6])}
      </div>
      <div class="card">
        <h2>Service fee</h2>
        ${PAY_FIELDS.slice(0, 4).map(field)}
        <div class="example" id="example"></div>
      </div>
    </div>
    <div class="savebar">
      <span class="grow muted" id="pay-meta"></span>
      ${canEdit ? html`<button class="btn" type="button" id="pay-reset">Reset to defaults</button><button class="btn primary" type="button" id="pay-save">Save changes</button>` : ''}
    </div>`);

  const ms = main.querySelector('#channels');
  const btn = ms.querySelector('.ms-btn');
  const pop = ms.querySelector('.ms-pop');
  const boxes = [...pop.querySelectorAll('input')];

  function paint() {
    boxes.forEach((b) => (b.checked = s.channels.includes(b.value)));
    render(ms.querySelector('.ms-val'), s.channels.length
      ? html`${options.filter((o) => s.channels.includes(o.id)).map((o) => html`<span class="chip">${o.label}</span>`)}`
      : html`<span class="muted">Choose channels</span>`);
    const ex = (buys) => {
      const amount = buys * 100;
      const total = grossUpKobo(amount, s);
      return html`<tr><td>₦${num(buys)}</td><td class="r num">${naira((total - amount) / 100)}</td><td class="r num">${naira(total / 100)}</td></tr>`;
    };
    const valid = PAY_FIELDS.every(([k]) => Number.isFinite(Number(s[k])));
    render(main.querySelector('#example'), valid
      ? html`<div class="hint" style="margin:14px 0 8px">What the tenant pays when they cover the fee</div>
          <div class="table-wrap"><table><thead><tr><th>Buys</th><th class="r">Fee</th><th class="r">Pays</th></tr></thead>
          <tbody>${[1000, 5000, 20000, 100000].map(ex)}</tbody></table></div>`
      : '');
    render(main.querySelector('#pay-meta'), html`${saved.updatedAt ? html`Last changed ${dateTime(saved.updatedAt)}${saved.updatedBy ? ` by ${saved.updatedBy}` : ''}` : 'Using the defaults.'}${dirty() ? html` <span class="pill warn">Unsaved changes</span>` : ''}`);
  }

  const open = (on) => {
    pop.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
    if (on) boxes[0]?.focus();
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    open(pop.hidden);
  };
  pop.onclick = (e) => e.stopPropagation();
  pop.onkeydown = (e) => {
    if (e.key === 'Escape') {
      open(false);
      btn.focus();
    }
  };
  main.onclick = () => open(false); // click outside the dropdown closes it
  boxes.forEach((b) => (b.onchange = () => {
    s.channels = options.map((o) => o.id).filter((id) => (id === b.value ? b.checked : s.channels.includes(id)));
    paint();
  }));
  main.querySelectorAll('input[data-key]').forEach((inp) => (inp.oninput = () => {
    s[inp.dataset.key] = inp.value === '' ? NaN : Number(inp.value);
    paint();
  }));

  const showErr = (err) => render(main.querySelector('#pay-err'), err ? html`<div class="err-box">${err}</div>` : '');
  const apply = (res, msg) => {
    saved = res.settings;
    s = structuredClone(saved);
    main.querySelectorAll('input[data-key]').forEach((inp) => (inp.value = s[inp.dataset.key]));
    showErr(null);
    paint();
    toast(msg);
  };
  main.querySelector('#pay-save')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      apply(await api('/settings/payments', { method: 'PUT', body: pick(s) }), 'Payment settings saved');
    } catch (err) {
      showErr(err.message);
    } finally {
      b.disabled = false;
    }
  });
  main.querySelector('#pay-reset')?.addEventListener('click', async () => {
    if (!confirm('Reset all payment settings to the defaults?')) return;
    try {
      apply(await api('/settings/payments/reset', { method: 'POST' }), 'Payment settings reset to defaults');
    } catch (err) {
      showErr(err.message);
    }
  });
  paint();
}

// Unit price limits
const TARIFF_FIELDS = [
  ['maxUnitPriceNaira', 'Maximum price per kWh', 'The highest price an owner can charge (the regulated cap).'],
  ['baseUnitCostNaira', 'Utility cost per kWh', 'What smeter pays the utility for each kWh. Owners can’t price below it; the difference is their margin.'],
];

async function tariffSettings(main) {
  const r = await api('/settings/tariff');
  const canEdit = me.role === 'owner';
  let saved = r.settings;
  let s = structuredClone(saved);
  let impact = r.impact;
  const pick = (x) => Object.fromEntries(TARIFF_FIELDS.map(([k]) => [k, Number(x[k])]));
  const dirty = () => JSON.stringify(pick(s)) !== JSON.stringify(pick(saved));
  leaveGuard = dirty;

  render(main, html`
    <div class="page-head"><div><h1>Pricing</h1><p>Property owners set their own price per kWh between these limits. Changes apply within a few seconds.</p></div></div>
    ${canEdit ? '' : html`<div class="card" style="margin-bottom:14px"><p class="muted" style="margin:0">Only account owners can change pricing limits.</p></div>`}
    <div id="tar-err"></div>
    <div class="grid g2" style="align-items:start">
      <div class="card">
        <h2>Unit price limits</h2>
        ${TARIFF_FIELDS.map(([key, label, hint]) => html`
          <div class="field">
            <label for="t-${key}">${label}</label>
            <div class="affix pre"><span>₦</span><input class="input" id="t-${key}" data-key="${key}" type="number" inputmode="decimal" min="0" step="0.5" value="${s[key]}" ${canEdit ? '' : raw('disabled')}></div>
            <div class="hint">${hint} <span class="muted">Default: ₦${num(r.defaults[key])}</span></div>
          </div>`)}
      </div>
      <div class="card">
        <h2>What owners can charge</h2>
        <div id="tar-summary"></div>
        <div id="tar-impact" style="margin-top:14px"></div>
      </div>
    </div>
    <div class="savebar">
      <span class="grow muted" id="tar-meta"></span>
      ${canEdit ? html`<button class="btn" type="button" id="tar-reset">Reset to defaults</button><button class="btn primary" type="button" id="tar-save">Save changes</button>` : ''}
    </div>`);

  function paint() {
    const ok = Number.isFinite(Number(s.maxUnitPriceNaira)) && Number.isFinite(Number(s.baseUnitCostNaira));
    render(main.querySelector('#tar-summary'), ok
      ? html`<dl class="kv">
          <dt>Price range</dt><dd>${naira(s.baseUnitCostNaira)} to ${naira(s.maxUnitPriceNaira)} per kWh</dd>
          <dt>Most an owner earns</dt><dd>${naira(s.maxUnitPriceNaira - s.baseUnitCostNaira)} per kWh</dd>
        </dl>`
      : '');
    const lines = [];
    if (impact?.belowCost) lines.push(html`<div class="err-box">${num(impact.belowCost)} owner${impact.belowCost === 1 ? ' is' : 's are'} priced below this utility cost. Their tenants can’t buy power until they raise their price.</div>`);
    if (impact?.aboveMax) lines.push(html`<div class="err-box" style="background:var(--warn-soft);color:var(--warn)">${num(impact.aboveMax)} owner${impact.aboveMax === 1 ? ' is' : 's are'} priced above this maximum. Their current price stays until they change it.</div>`);
    if (!lines.length && impact) {
      lines.push(html`<p class="muted" style="margin:0">${impact.priced
        ? `All ${num(impact.priced)} owner${impact.priced === 1 ? '' : 's'} with a price ${impact.priced === 1 ? 'is' : 'are'} within these limits.`
        : 'No owners have set a price yet.'}</p>`);
    }
    render(main.querySelector('#tar-impact'), html`${lines}`);
    render(main.querySelector('#tar-meta'), html`${saved.updatedAt ? html`Last changed ${dateTime(saved.updatedAt)}${saved.updatedBy ? ` by ${saved.updatedBy}` : ''}` : 'Using the defaults.'}${dirty() ? html` <span class="pill warn">Unsaved changes</span>` : ''}`);
  }

  let t;
  const preview = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      try {
        impact = (await api('/settings/tariff/preview', { method: 'POST', body: pick(s) })).impact;
        showErr(null);
      } catch (err) {
        impact = null;
        showErr(err.message);
      }
      paint();
    }, 350);
  };
  main.querySelectorAll('input[data-key]').forEach((inp) => (inp.oninput = () => {
    s[inp.dataset.key] = inp.value === '' ? NaN : Number(inp.value);
    paint();
    preview();
  }));

  const showErr = (err) => render(main.querySelector('#tar-err'), err ? html`<div class="err-box">${err}</div>` : '');
  const apply = (res, msg) => {
    saved = res.settings;
    s = structuredClone(saved);
    impact = res.impact;
    main.querySelectorAll('input[data-key]').forEach((inp) => (inp.value = s[inp.dataset.key]));
    showErr(null);
    paint();
    toast(msg);
  };
  main.querySelector('#tar-save')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (impact?.belowCost && !confirm(`${impact.belowCost} owner(s) will be priced below the utility cost, so their tenants can’t buy power until they raise their price. Save anyway?`)) return;
    b.disabled = true;
    try {
      apply(await api('/settings/tariff', { method: 'PUT', body: pick(s) }), 'Pricing limits saved');
    } catch (err) {
      showErr(err.message);
    } finally {
      b.disabled = false;
    }
  });
  main.querySelector('#tar-reset')?.addEventListener('click', async () => {
    if (!confirm('Reset the pricing limits to the defaults?')) return;
    try {
      apply(await api('/settings/tariff/reset', { method: 'POST' }), 'Pricing limits reset to defaults');
    } catch (err) {
      showErr(err.message);
    }
  });
  paint();
}

// Helpers
function wireRows(main) {
  main.querySelectorAll('tr.link').forEach((tr) => {
    tr.tabIndex = 0;
    tr.onclick = (e) => {
      if (!e.target.closest('a')) location.hash = tr.dataset.href;
    };
    tr.onkeydown = (e) => e.key === 'Enter' && (location.hash = tr.dataset.href);
  });
}

function wireSearch(main, current, onSearch) {
  const q = main.querySelector('#q');
  if (!q) return;
  let t;
  q.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => onSearch(q.value.trim()), 300);
  };
  if (current) {
    q.focus();
    q.setSelectionRange(q.value.length, q.value.length);
  }
}

route();
