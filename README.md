# smeter

Mobile-first app for **screenless prepaid smart meters**: tenants buy power and
watch their usage on their phone; property owners ("Admin" in the designs) onboard
meters, set the unit price, recover debts, get paid, and can remotely disconnect a
meter.

```
smeter/
├── backend/   Node.js (plain JavaScript, Express 5) API — owns users, payments, pricing, content
├── website/   4-page marketing site (static HTML/CSS/JS, no build) — drives app downloads
├── admin/     Admin dashboard for the smeter team (static, no build) — content + operations
└── docs/      Geni head-end API collection (sanitised — no tokens/passwords)
```

The Flutter mobile app (tenant and property-owner experiences) is kept in a separate
repository; this repo holds the API, the website and the admin dashboard.

The app never talks to the meter head-end directly. The backend holds the Geni
(Calin) credentials and the token-vending authorization password, and exposes a
small, role-scoped API to the app.

## How it fits together

```
Flutter app ──HTTPS──▶ smeter API ──▶ Geni head-end (meters, tariffs, STS tokens, load profiles)
                          │      └──▶ Paystack (card / transfer / USSD checkout, settlement split)
                          │      └──▶ Termii SMS (OTP codes, tenant invites)
                          └── SQLite (landlords, meters, purchases, OTPs, notifications, tickets)
```

**Buying power (SM-VEN-001, SM-PAY-001/002):** tenant picks an amount → sees the
price per kWh and a breakdown (debt recovery, units, service fee, total) → pays in
Paystack's hosted checkout (in-app web view) → the backend verifies the payment
(HMAC-signed webhook, the redirect, or the app's poll — all idempotent) → mints an
STS token on the head-end → pushes it to the meter over the air if it's online, or
shows the token for manual entry if it's offline. A sweeper re-verifies payments
whose webhook is more than 5 minutes late ("audit alert") and retries failed token
generation.

**Token delivery modes:** each meter is set by its property owner to either
*Automatic (GPRS)*, where tokens are pushed over the air and live readings, usage
and remote disconnect are available, or *Manual token*, for meters without a
network link. In manual mode the app is just for buying: after payment the tenant
gets the 20-digit token, shown in groups of four with step-by-step instructions,
and types it into the meter remote. The head-end is never polled for that meter,
and its "usage" is built from purchases. Owners choose the mode when adding a
meter and can switch it later; the tenant is notified when they do.

**Money split:** units are priced at the landlord's rate. The platform keeps the
base utility cost (and the gateway fee when the tenant pays it); the landlord's
Paystack subaccount gets the markup plus any recovered debt (minus the fee when the
landlord chooses to bear it). The ledger screen shows this per meter.

### Requirements coverage

| Story | Where |
|---|---|
| SM-SEC-001 OTP password reset (5-min expiry, "Number not found") | `routes/auth.js`, Forgot password screens |
| SM-ONB-001 Bank setup: account-name verification + SMS 2FA | `routes/landlord.js` `/bank/*`, Payout account screen |
| SM-TNS-001 Meter binding: validated on the head-end, no double assignment, tenant accepts by signing in | `POST /v1/landlord/meters`, tenant OTP login |
| SM-VEN-001 One-tap purchase, OTA delivery, offline fallback token | `services/vending.js` |
| SM-MON-001 Virtual display (volts/amps/load, 5 s refresh, "last seen") | `GET /v1/tenant/live`, Live display card |
| SM-FIN-001 Price per kWh with regulatory cap | `PUT /v1/landlord/tariff`, Set Unit Price |
| SM-ADM-001 Remote kill-switch (queued when offline) | `/meters/:id/disconnect|reconnect` |
| SM-SUP-001 Support tickets routed to finance/technical | `routes/support.js`, Help & support |
| SM-PAY-001/002/004 Multi-channel checkout, webhook verification, fee bearer toggle | `providers/payments.js`, `routes/payments.js` |
| Debt recovery %, profit/markup ledger, tariff visibility | `services/pricing.js`, Ledger screen, Buy Power breakdown |

**Not in this codebase:** solar/battery monitoring, grid↔solar relay switching and
BLE manual sync. They need meter firmware and hardware support the Geni API doesn't
expose.

## Website, admin dashboard and content

**Website** (`website/`): Home, Product, Company and Property owners pages. Home is the
editorial mosaic composition from the design brief (a 1280×800 canvas scaled to the
viewport on desktop, with phone, landscape-phone and tablet layouts). The other pages
reuse its header, type and tiles. Every “Get the app” button opens a download sheet:
store buttons when the URLs are set in the admin, otherwise a *coming soon — notify me*
form. The owners page posts *Book a free site survey* leads to the API. Text, images,
contact details and store links are fetched from `/v1/public/content/site` and
override the HTML defaults, so the pages still render and index without the API. Set
the API origin in `website/assets/config.js`.

Imagery in `website/assets/img/` is AI-generated for smeter (Nigerian homes, owners,
tenants, installers, Lagos) plus 3D renders, alongside the meter render from the sales
deck. Any image can be replaced from the admin dashboard.

**Admin dashboard** (`admin/`) for the smeter team, separate from the website and the
owners’ app:
- **Overview:** 30-day sales, today, meters by mode/status, and items needing attention.
- **Property owners, Meters, Purchases:** search and drill into every owner and meter, with tenant details, live readings (GPRS meters) and purchases.
- **Owner leads** from the website (status and notes) and **App sign-ups** (CSV export).
- **Website** and **Mobile app** content editors, generated from the content schema: image upload, version history, restore and reset. App content covers onboarding text, a home-screen announcement, support contacts, buy-amount presets and the token-loading steps.
- **Team:** owners can add editors.

Create the first account with `ADMIN_EMAIL` + `ADMIN_PASSWORD` in `.env` (created on
first boot), or `npm run staff:create -- <email> <name> <password> [owner|editor]`.
The server can serve both sites itself (`SITE_DIR=../website`, `ADMIN_DIR=../admin`,
with the admin at `/admin`). When they’re hosted separately, add their origins to
`CORS_ORIGINS` and set `window.SMETER_API` in each `config.js`.

## Running locally

### Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev        # http://localhost:8080 — mock head-end, mock checkout, SMS printed to the console
npm test           # 32 tests: pricing, curve parsing, purchase flow, manual mode, admin & content
```

With no credentials set, everything runs against mocks:
- **Mock head-end:** any 6–20-digit meter number exists, except numbers starting `000`. Numbers ending in `9` report offline, which exercises the manual-token path.
- **Mock checkout:** served at `/pay/mock/:reference`.
- **OTP codes:** printed to the server log and returned as `devCode`. This never happens when `NODE_ENV=production`.

## Going live — credentials to add

| Variable | What |
|---|---|
| `GENI_USER_ID`, `GENI_PASSWORD`, `GENI_COMPANY` | Head-end login (`/API/User/Login`) |
| `GENI_AUTHORIZATION_PASSWORD` | Required by `/API/Token/CreditToken/Generate` |
| `GENI_TOKEN_TASK_PROTOCOL_ID`, `GENI_DISCONNECT_*`, `GENI_RECONNECT_*` | Remote-task protocol ids/payloads for these meters — confirm with the vendor |
| `PAYSTACK_SECRET_KEY` | Checkout, webhooks (`POST /v1/webhooks/paystack`), bank resolution, subaccounts |
| `TERMII_API_KEY` | SMS for OTPs and invites |
| `JWT_SECRET`, `PUBLIC_URL`, `NODE_ENV=production` | The server refuses to start in production with mocks or a weak secret |

Things to verify against the real head-end once credentials are in (the collection
only documents placeholders):
1. The success `code` value (`GENI_SUCCESS_CODES`, default `0,200`).
2. The `headline`/`data` format of `LoadProfile/*` rows. The parser accepts JSON and common delimiters, and picks the energy/volts/amps columns by name.
3. Whether energy readings are cumulative registers or per-interval (`GENI_ENERGY_MODE`).

## API overview

All JSON; `Authorization: Bearer <token>`. Errors: `{ "error": { "code", "message", "details" } }`.

- **Auth** `/v1/auth`: `landlord/register`, `landlord/login`, `tenant/start` → `tenant/verify`, `password/forgot` → `password/verify` → `password/reset`
- **Tenant** `/v1/tenant`: `me`, `dashboard`, `live`, `usage?period=day|week|month|year&date=`, `quote`, `purchases`, `purchases/:ref`, `notifications`
- **Landlord** `/v1/landlord`: `me`, `dashboard`, `tariff`, `fee-bearer`, `banks`, `bank/resolve|request|confirm`, `meters` (+ `/:id`, `/:id/disconnect|reconnect`), `transactions`, `purchases` (+ `/:ref`, `/:ref/retry`), `ledger`, `notifications`
- **Support** `/v1/support`: `categories`, `tickets`
- **Public** `/v1/public`: `content/site|app`, `owner-leads`, `notify`
- **Staff (admin)** `/v1/staff`: `login`, `me`, `users`, `overview`, `landlords` (+ `/:id`), `meters` (+ `/:id`), `purchases`, `leads`, `notify-requests`, `content/:key` (+ `restore`, `reset`), `uploads`
- **Payments** `POST /v1/webhooks/paystack`, `GET /pay/return`, mock checkout `/pay/mock/:ref`

## Design

Screens follow the smeter Figma file. The onboarding and login photos in
`mobile/assets/images/` were cropped from screen exports because Figma's plan limit
blocked raw asset downloads. Swap in the original images for full resolution.
