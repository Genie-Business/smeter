import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

enum Role { tenant, landlord }

class Session {
  const Session({this.token, this.role, this.onboarded = false, this.restored = false});

  final String? token;
  final Role? role;

  /// Whether the intro walkthrough has been seen on this device.
  final bool onboarded;

  /// False until secure storage has been read on launch.
  final bool restored;

  bool get signedIn => token != null && role != null;

  Session copyWith({String? token, Role? role, bool? onboarded, bool? restored, bool clear = false}) => Session(
    token: clear ? null : (token ?? this.token),
    role: clear ? null : (role ?? this.role),
    onboarded: onboarded ?? this.onboarded,
    restored: restored ?? this.restored,
  );
}

class SessionController extends Notifier<Session> {
  static const _storage = FlutterSecureStorage();

  @override
  Session build() {
    _restore();
    return const Session();
  }

  Future<void> _restore() async {
    try {
      final token = await _storage.read(key: 'token');
      final role = await _storage.read(key: 'role');
      final onboarded = await _storage.read(key: 'onboarded') == '1';
      state = Session(
        token: token,
        role: Role.values.where((r) => r.name == role).firstOrNull,
        onboarded: onboarded,
        restored: true,
      );
    } catch (_) {
      // Unreadable keystore (e.g. restored backup): start signed out.
      state = const Session(restored: true);
    }
  }

  Future<void> signIn(String token, Role role) async {
    state = state.copyWith(token: token, role: role, onboarded: true);
    await _storage.write(key: 'token', value: token);
    await _storage.write(key: 'role', value: role.name);
    await _storage.write(key: 'onboarded', value: '1');
  }

  Future<void> completeOnboarding() async {
    state = state.copyWith(onboarded: true);
    await _storage.write(key: 'onboarded', value: '1');
  }

  Future<void> signOut() async {
    state = state.copyWith(clear: true);
    await _storage.delete(key: 'token');
    await _storage.delete(key: 'role');
  }
}

final sessionProvider = NotifierProvider<SessionController, Session>(SessionController.new);
