# smeter

Mobile-first app for **screenless prepaid smart meters**: tenants buy power and
watch their usage on their phone; property owners ("Admin" in the designs) onboard
meters, set the unit price, recover debts, get paid, and can remotely disconnect a
meter.

```
smeter/
├── backend/   Node.js (plain JavaScript, Express 5) API — owns users, payments, pricing, content
├── mobile/    Flutter app (Android + iOS) — tenant and property-owner experiences
├── website/   4-page marketing site (static HTML/CSS/JS, no build) — drives app downloads
│   └── admin/ Admin dashboard for the smeter team, served at /admin — content + operations
└── docs/      Geni head-end API collection (sanitised — no tokens/passwords)
```

The app never talks to the meter head-end directly. The backend holds the Geni
(Calin) credentials and the token-vending authorization password, and exposes a
small, role-scoped API to the app.

## How it fits together

```
Flutter app ──HTTPS──▶ smeter API ──▶ Geni head-end (meters, tariffs, STS tokens, load profiles)
                          │      └──▶ Paystack (card / transfer / USSD checkout, settlement split)
                          │      └──▶ Resend email (login codes, password resets, tenant invites)
                          └── Postgres / Neon (landlords, meters, purchases, OTPs, notifications, tickets, content)
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
| SM-SEC-001 Password reset by emailed code (5-min expiry), found by email or phone | `routes/auth.js`, Forgot password screens |
| SM-ONB-001 Bank setup: account-name verification + emailed 2FA code | `routes/landlord.js` `/bank/*`, Payout account screen |
| SM-TNS-001 Meter binding: validated on the head-end, no double assignment, tenant accepts by signing in | `POST /v1/landlord/meters`, tenant login by meter number + code emailed to the address the owner entered |
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

**Website** (`website/`): Home, Product, Company and Property owners pages at clean URLs
(`/`, `/product`, `/company`, `/owners`; old `.html` links redirect). Home opens with the
editorial mosaic composition from the design brief (a 1280×800 canvas scaled to the
first screen on desktop, with phone, landscape-phone and tablet layouts). Below it come
the promise, how it works, tenants, property owners, the meter render, load modes, why
it matters, FAQ and a download band, plus a floating "Get the app" button. The other
pages reuse its header, type and tiles. To host it on Vercel, make a project with root
directory `website` (`website/vercel.json` turns on clean URLs). Locally, the API serves
it with `SITE_DIR`. Every “Get the app” button opens a download sheet:
store buttons when the URLs are set in the admin, otherwise a *coming soon — notify me*
form. The owners page posts *Book a free site survey* leads to the API. Text, images,
contact details and store links are fetched from `/v1/public/content/site` and
override the HTML defaults, so the pages still render and index without the API. The
API origin is set in `website/assets/config.js` (the hosted API by default, the local
one on localhost).

Imagery in `website/assets/img/` is AI-generated for smeter (Nigerian homes, owners,
tenants, installers, Lagos) plus 3D renders, alongside the meter render from the sales
deck. Any image can be replaced from the admin dashboard.

**Admin dashboard** (`website/admin/`, deployed with the website at `/admin`, not
indexed) for the smeter team, separate from the owners’ app:
- **Overview:** 30-day sales, today, meters by mode/status, and items needing attention.
- **Property owners, Meters, Purchases:** search and drill into every owner and meter, with tenant details, live readings (GPRS meters) and purchases.
- **Owner leads** from the website (status and notes) and **App sign-ups** (CSV export).
- **Website** and **Mobile app** content editors, generated from the content schema: image upload, version history, restore and reset. App content covers onboarding text, a home-screen announcement, support contacts, buy-amount presets and the token-loading steps.
- **Team:** owners can add editors.

Create the first account with `ADMIN_EMAIL` + `ADMIN_PASSWORD` in `.env` (created on
first boot), or `npm run staff:create -- <email> <name> <password> [owner|editor]`.
The API can serve the website (and so the admin) itself with `SITE_DIR` pointing at
`website/`. When the website is hosted separately, add its origin to `CORS_ORIGINS`.

## Running locally

### Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev        # http://localhost:8080 — mock head-end, mock checkout, emails printed to the console
npm test           # 33 tests: pricing, curve parsing, purchase flow, manual mode, admin & content
```

Data lives in Postgres. Locally, with `DATABASE_URL` blank, the API runs an embedded
Postgres (PGlite) in `backend/data/pglite`, so there is nothing to install. Tests use a
throwaway in-memory one. To run the suite through the real `pg` driver, set
`TEST_DATABASE_URL` to a **non-production** database: the suite only touches a
`smeter_test` schema, which it creates and drops.

With no credentials set, everything runs against mocks:
- **Mock head-end:** any 6–20-digit meter number exists, except numbers starting `000`. Numbers ending in `9` report offline, which exercises the manual-token path.
- **Mock checkout:** served at `/pay/mock/:reference`.
- **Login codes and emails:** printed to the server log (no `RESEND_API_KEY`), and codes are returned as `devCode` in development. Staging can opt in with `OTP_DEBUG_ECHO=true`. Never in production.

### Mobile

```bash
cd mobile
flutter pub get
flutter run                                                   # hosted API (https://api.smeter.app)
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8080   # Android emulator → your machine
```

Cleartext HTTP is allowed only to `10.0.2.2`/`localhost`
(`android/app/src/main/res/xml/network_security_config.xml`).

## Domains

| Address | What | Vercel project |
|---|---|---|
| `www.smeter.app` (`smeter.app` redirects) | Website | website (root `website`) |
| `admin.smeter.app` | Admin dashboard (`www.smeter.app/admin` redirects here) | website, same project |
| `api.smeter.app` | API, Paystack webhook `/v1/webhooks/paystack`, checkout return `/pay/return` | backend (root `backend`) |
| `no-reply@smeter.app` | Sender for login codes and invites (Resend; domain verified by DNS) | — |

`website/vercel.json` serves the dashboard at the root of `admin.smeter.app` and
redirects `/admin` on the website there. The website and admin call the API at
`https://api.smeter.app` (`website/assets/config.js`); the app's default
`API_BASE_URL` is the same.

## Deploying the API on Vercel

`backend/` deploys as one serverless function (`backend/api/index.js`, routed by
`backend/vercel.json`). Set the project's **Root Directory** to `backend` and add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon Postgres — use the **pooled** connection string (`…-pooler…`) |
| `APP_ENV` | `staging` (allows mocks) or `production` (requires real Geni + Paystack) |
| `JWT_SECRET` | 32+ random characters |
| `CORS_ORIGINS` | The website's origin, `https://www.smeter.app,https://smeter.app,https://admin.smeter.app` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First admin-dashboard account |
| `CRON_SECRET` | Random string; Vercel Cron uses it to call `/internal/sweep` |
| `OTP_DEBUG_ECHO` | `true` on staging to see login codes without email |
| `RESEND_API_KEY`, `EMAIL_FROM` | Resend key and a sender on your verified domain |

Tables are created automatically on the first request. If the config is invalid the
API answers every request with `503 misconfigured` and the reason. Uploaded admin
images are stored in the database. Payment reconciliation (late webhooks, token
retries) runs from Vercel Cron, daily on the Hobby plan. On Pro you can change the
schedule in `vercel.json` to every few minutes. The app's status polling and the
Paystack webhook settle payments as they happen either way.

## Going live — credentials to add

| Variable | What |
|---|---|
| `GENI_USER_ID`, `GENI_PASSWORD`, `GENI_COMPANY` | Head-end login (`/API/User/Login`) |
| `GENI_TARIFF_PREFIX` | Prefix of owner tariff ids on the head-end (default `SML`); give each environment sharing a head-end its own |
| `GENI_AUTHORIZATION_PASSWORD` | Required by `/API/Token/CreditToken/Generate` |
| `GENI_TOKEN_TASK_PROTOCOL_ID`, `GENI_DISCONNECT_*`, `GENI_RECONNECT_*` | Remote-task protocol ids/payloads for these meters — confirm with the vendor |
| `PAYSTACK_SECRET_KEY` | Checkout, webhooks (`POST /v1/webhooks/paystack`), bank resolution, subaccounts |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email for login codes, password resets, payout codes and tenant invites (verify your domain in Resend) |
| `JWT_SECRET`, `PUBLIC_URL`, `APP_ENV=production` | The server refuses to start in production with mocks or a weak secret |

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
