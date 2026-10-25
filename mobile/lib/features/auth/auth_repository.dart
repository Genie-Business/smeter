import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/session.dart';

/// OTP dispatch result. [devCode] is only present on non-production backends.
class OtpSent {
  OtpSent(Map<String, dynamic> j) : sentTo = j['sentTo'] as String? ?? '', devCode = j['devCode'] as String?;
  final String sentTo;
  final String? devCode;
}

class AuthRepository {
  AuthRepository(this._api, this._session);

  final ApiClient _api;
  final SessionController _session;

  Future<void> registerLandlord({
    required String fullName,
    required String email,
    required String phone,
    required String password,
  }) async {
    final r = await _api.post('/v1/auth/landlord/register', {
      'fullName': fullName,
      'email': email,
      'phone': phone,
      'password': password,
    });
    await _session.signIn(r['token'] as String, Role.landlord);
  }

  Future<void> loginLandlord(String identifier, String password) async {
    final r = await _api.post('/v1/auth/landlord/login', {'identifier': identifier, 'password': password});
    await _session.signIn(r['token'] as String, Role.landlord);
  }

  Future<OtpSent> startTenant(String meterId) async =>
      OtpSent(await _api.post('/v1/auth/tenant/start', {'meterId': meterId}));

  Future<void> verifyTenant(String meterId, String code) async {
    final r = await _api.post('/v1/auth/tenant/verify', {'meterId': meterId, 'code': code});
    await _session.signIn(r['token'] as String, Role.tenant);
  }

  /// [identifier] is the account's email or phone; the code is always emailed.
  Future<OtpSent> forgotPassword(String identifier) async =>
      OtpSent(await _api.post('/v1/auth/password/forgot', {'identifier': identifier}));

  Future<String> verifyReset(String identifier, String code) async =>
      (await _api.post('/v1/auth/password/verify', {'identifier': identifier, 'code': code}))['resetToken'] as String;

  Future<void> resetPassword(String resetToken, String newPassword) =>
      _api.post('/v1/auth/password/reset', {'resetToken': resetToken, 'newPassword': newPassword});
}

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => AuthRepository(ref.watch(apiClientProvider), ref.read(sessionProvider.notifier)),
);
