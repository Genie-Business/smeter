/// Build-time configuration. Override with
/// `flutter run --dart-define=API_BASE_URL=https://api.example.com`.
class Env {
  /// Defaults to the hosted staging API. For a local backend on the Android
  /// emulator use `--dart-define=API_BASE_URL=http://10.0.2.2:8080`.
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://api.smeter.app',
  );

  /// Custom URL scheme the backend redirects to after checkout.
  static const appScheme = 'smeter';
}
