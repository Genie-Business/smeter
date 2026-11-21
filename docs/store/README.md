# Publishing smeter to Google Play and the App Store

Publisher: **Genie Business Ltd** · App ID (both stores): **`app.smeter`** · Version **1.0.0 (1)**

## 1. What's ready in the code

| Item | Where |
|---|---|
| App ID `app.smeter` (Android `applicationId`, iOS bundle id) | `mobile/android/app/build.gradle.kts`, `mobile/ios/Runner.xcodeproj` |
| Android release signing with the upload key (read from `mobile/android/key.properties`, git-ignored) | `build.gradle.kts` |
| Play bundle: `flutter build appbundle --release --dart-define=API_BASE_URL=https://api.smeter.app` | output `mobile/build/app/outputs/bundle/release/app-release.aab` |
| iOS: iPhone only, portrait, no export-compliance prompt (`ITSAppUsesNonExemptEncryption = NO`) | `ios/Runner/Info.plist`, project settings |
| In-app account deletion for property owners (Profile → Delete account) | app + `POST /v1/landlord/me/delete` |
| Privacy policy, terms and account-deletion pages, linked in the app | https://www.smeter.app/privacy · /terms · /delete-account |
| Store-review demo sign-in (fixed code for one demo meter, off by default) | `REVIEW_METER_ID`, `REVIEW_LOGIN_CODE` |
| CI compiles the iOS app on macOS (unsigned) | `.github/workflows/ci.yml` → `ios` |

**Upload key:** `C:\Users\DELL\Documents\Keys\smeter\smeter-upload.jks`, password in
`README-PASSWORD.txt` next to it. Back both up (password manager + offline copy). Use
**Play App Signing** (Google keeps the app signing key; this file is only the upload key).

## 2. Before submitting (your side)

1. **Legal review**: have a lawyer check /privacy, /terms and /delete-account (drafted from how
   smeter works; dated 21 November 2026).
2. **Developer accounts**: Google Play Console (organisation account for Genie Business Ltd,
   D-U-N-S number needed) and Apple Developer Program (organisation, D-U-N-S).
3. **Review demo** (Apple and Google both sign in to test):
   - Create a demo property owner in production with a password, complete its setup
     (address, price, payout account) and add one demo meter with a tenant email you control.
   - In Vercel (backend project) set `REVIEW_METER_ID` to that meter number and
     `REVIEW_LOGIN_CODE` to a 6-digit code, then redeploy. That meter's tenant can then sign in
     with the code; every other meter still uses emailed codes.
   - Remove both variables after approval if you prefer.
4. **Screenshots**: phone screenshots of tenant home, buy power, usage, receipt, owner home and
   meter detail (Play: at least 2, 1080×1920 or similar; Apple: 6.9" iPhone set, 1320×2868).
5. **Feature graphic** (Play): 1024×500.

## 3. Building iOS (needs a Mac)

iOS apps can only be built, signed and uploaded from macOS:

```bash
cd mobile
flutter build ipa --release --dart-define=API_BASE_URL=https://api.smeter.app
```

Then upload `build/ios/ipa/*.ipa` with Apple's Transporter app (or open
`ios/Runner.xcworkspace` in Xcode → Product → Archive → Distribute). Set the Team in Xcode
(Runner → Signing & Capabilities) to Genie Business Ltd's team first. The CI `ios` job only
checks that it compiles; signed CI builds need the distribution certificate and provisioning
profile added as GitHub secrets.

## 4. Store listing text

**Name:** smeter
**Subtitle (Apple, 30):** Prepaid power for your home
**Short description (Play, 80):** Buy prepaid electricity for your meter in seconds and track what you use.
**Category:** Play: House & Home · Apple: Utilities
**Content rating:** Everyone / 4+ (no user-generated content, no ads)

**Full description:**

> smeter makes prepaid electricity simple for rented homes.
>
> For tenants
> • Buy power for your meter in seconds with card, bank transfer or USSD
> • Units are sent straight to your smart meter, and you also get the token to key in
> • See the price per unit and every charge before you pay
> • Track your usage by day, week, month and year
> • Get alerts for purchases and your meter's status
>
> For property owners
> • Add your meters and invite tenants by email
> • Set your price per kWh within the regulated limit
> • Tenants' power payments settle straight to your bank account
> • Recover old debts automatically from each purchase
> • See live meter readings and switch supply remotely
>
> smeter works with GPRS smart prepaid meters. Sign in as a tenant with your meter number
> and a code sent to your email, or as a property owner with your email and password.

**Keywords (Apple, 100):** electricity,prepaid,meter,power,token,units,tenant,landlord,NEPA,utility
**Support URL:** https://www.smeter.app/company · **Marketing URL:** https://www.smeter.app
**Privacy policy URL:** https://www.smeter.app/privacy
**Account deletion URL (Play):** https://www.smeter.app/delete-account

## 5. Google Play: Data safety

- Data is encrypted in transit: **Yes**. Users can request deletion: **Yes** (in app and /delete-account).
- Collected (all **required**, **not shared** for advertising, used for **App functionality**,
  **Account management**, **Fraud prevention**):
  - Personal info: **Name, Email address, Phone number, Address** (owners' property address)
  - Financial info: **Purchase history**; **Other financial info** (owners' payout bank details)
  - App activity: **Other actions** (meter usage readings)
  - App info and performance: **Crash logs / diagnostics** only if you add crash reporting (none today)
- Shared with service providers (payments: Paystack; email; hosting): declare under "Data shared"
  only if Google's definitions require it for processors (generally they don't count as sharing).
- No location, contacts, photos, or device identifiers are collected.

## 6. App Store: App Privacy ("nutrition label")

Data **linked to the user**, **not used for tracking**:
- Contact info: Name, Email address, Phone number, Physical address → App Functionality
- Financial info: Other financial info (owners' bank details for payouts) → App Functionality
- Purchases: Purchase history → App Functionality
- Identifiers: User ID → App Functionality
- Usage data: Product interaction (meter usage) → App Functionality

Payments are taken in Paystack's checkout (a web page), for electricity, which is a real-world
service consumed outside the app, so Apple's in-app purchase rules don't apply (guideline 3.1.3(e) /
3.1.5). Mention this in the review notes.

## 7. Review notes (paste into both stores)

> smeter sells prepaid electricity for physical smart meters in rented homes in Nigeria.
> Payments are for electricity (a real-world utility consumed outside the app) and are processed
> by Paystack in a web checkout, so in-app purchase does not apply.
>
> Property owner demo: tap "Get Started", then "Admin"; email [demo owner email], password [demo password].
> Tenant demo: tap "Get Started", then "Tenants", meter number [REVIEW_METER_ID], then enter code [REVIEW_LOGIN_CODE].
> Buying power charges a real card, so please don't complete a payment; the quote screen shows
> the full price breakdown before checkout.
>
> Account deletion: Profile → Delete account (property owners). Tenants have no account of their
> own; access comes from the meter their owner links.
