# smeter — mobile

Flutter app for tenants and property owners. See the [root README](../README.md)
for the architecture and backend setup.

```bash
flutter pub get
flutter run                                                   # hosted API (api.smeter.app)
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8080   # Android emulator → local API
flutter analyze && flutter test
flutter build apk --release                                   # add --dart-define=API_BASE_URL=… for another API
```

Layout: `lib/core` (API client, session, models, formatting), `lib/theme`,
`lib/shared` (widgets), `lib/features/<area>` (screens + repository/providers per
area: `auth`, `onboarding`, `tenant`, `landlord`, `payments`, `common`), and
`lib/router.dart` (role-aware redirects, one bottom-nav shell per role).
