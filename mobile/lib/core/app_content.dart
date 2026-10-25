import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';

/// Copy the smeter team edits from the admin dashboard (`/v1/public/content/app`).
/// Every field has a built-in default, so the app works offline or if the API
/// is unreachable.
class AppContent {
  const AppContent({
    required this.onboarding,
    required this.announcement,
    required this.support,
    required this.presets,
    required this.tokenHelp,
    this.payments = PaymentOptions.defaults,
  });

  final List<({String title, String caption})> onboarding;
  final Announcement announcement;
  final SupportContacts support;
  final List<double> presets;
  final List<({String title, String body})> tokenHelp;

  /// Enabled payment channels and purchase limits (admin → Payments).
  final PaymentOptions payments;

  static const defaults = AppContent(
    onboarding: [
      (title: 'Welcome to smeter.', caption: 'Your home’s energy, now in your hands.'),
      (title: 'View My Bill', caption: 'See what you use and what you spend, day by day, with no meter keypad needed.'),
      (title: 'Property Owners', caption: 'Manage your tenant(s) electricity payments all from one screen'),
      (title: 'All Energy Sources', caption: 'One meter, One App to manage them all'),
      (title: 'Manage Your Power', caption: 'Solar or Grid or Generator power, you’ll always know exactly what’s happening'),
    ],
    announcement: Announcement(enabled: false, tone: 'info', title: '', body: '', audience: 'all'),
    support: SupportContacts(phone: '+234 800 000 0001', email: 'support@smeter.app', whatsapp: '+234 800 000 0001'),
    presets: [1000, 2000, 3000, 5000, 10000, 20000],
    tokenHelp: [
      (title: 'Wake the remote', body: 'Press any key on your meter remote (the keypad unit inside your home).'),
      (title: 'Type the 20 digits', body: 'Enter the token exactly as shown. The groups of four make it easier to check.'),
      (title: 'Press Enter', body: 'Press the Enter (or #) key. The remote shows “Accept” and your units are added.'),
    ],
  );

  /// Parses the API document; anything missing or malformed keeps its default.
  factory AppContent.fromJson(Map<String, dynamic> j) {
    final d = defaults;
    List<T> list<T>(Object? raw, T Function(Map<String, dynamic>) f, List<T> fallback) {
      if (raw is! List || raw.isEmpty) return fallback;
      try {
        return raw.whereType<Map>().map((m) => f(Map<String, dynamic>.from(m))).toList();
      } catch (_) {
        return fallback;
      }
    }

    String s(Object? v, String fallback) => v is String ? v : fallback;
    final a = j['announcement'] is Map ? Map<String, dynamic>.from(j['announcement'] as Map) : const <String, dynamic>{};
    final sup = j['support'] is Map ? Map<String, dynamic>.from(j['support'] as Map) : const <String, dynamic>{};
    final presets = (j['buy'] is Map ? (j['buy'] as Map)['presets'] : null);
    return AppContent(
      onboarding: list(j['onboarding'], (m) => (title: s(m['title'], ''), caption: s(m['caption'], '')), d.onboarding),
      announcement: Announcement(
        enabled: a['enabled'] == true,
        tone: s(a['tone'], 'info'),
        title: s(a['title'], ''),
        body: s(a['body'], ''),
        audience: s(a['audience'], 'all'),
      ),
      support: SupportContacts(
        phone: s(sup['phone'], d.support.phone),
        email: s(sup['email'], d.support.email),
        whatsapp: s(sup['whatsapp'], d.support.whatsapp),
      ),
      presets: presets is List && presets.isNotEmpty
          ? presets.whereType<num>().map((n) => n.toDouble()).where((n) => n > 0).toList()
          : d.presets,
      tokenHelp: list(j['tokenHelp'], (m) => (title: s(m['title'], ''), body: s(m['body'], '')), d.tokenHelp),
      payments: j['payments'] is Map ? PaymentOptions.fromJson(Map<String, dynamic>.from(j['payments'] as Map)) : d.payments,
    );
  }
}

class PaymentOptions {
  const PaymentOptions({required this.channels, required this.minPurchase, required this.maxPurchase});

  /// API ids: card | bank_transfer | ussd.
  final List<String> channels;
  final double minPurchase;
  final double maxPurchase;

  static const defaults = PaymentOptions(channels: ['card', 'bank_transfer', 'ussd'], minPurchase: 500, maxPurchase: 500000);

  factory PaymentOptions.fromJson(Map<String, dynamic> j) {
    final d = defaults;
    final ch = j['channels'] is List ? (j['channels'] as List).whereType<String>().toList() : <String>[];
    double n(Object? v, double fallback) => v is num && v > 0 ? v.toDouble() : fallback;
    return PaymentOptions(
      channels: ch.isEmpty ? d.channels : ch,
      minPurchase: n(j['minPurchase'], d.minPurchase),
      maxPurchase: n(j['maxPurchase'], d.maxPurchase),
    );
  }
}

class Announcement {
  const Announcement({required this.enabled, required this.tone, required this.title, required this.body, required this.audience});

  final bool enabled;
  final String tone; // info | success | warn | danger
  final String title;
  final String body;
  final String audience; // all | tenants | owners

  bool showTo({required bool tenant}) =>
      enabled && (title.isNotEmpty || body.isNotEmpty) && (audience == 'all' || audience == (tenant ? 'tenants' : 'owners'));
}

class SupportContacts {
  const SupportContacts({required this.phone, required this.email, required this.whatsapp});
  final String phone;
  final String email;
  final String whatsapp;
}

/// Loaded once per app session; falls back to defaults on any failure.
final appContentProvider = FutureProvider<AppContent>((ref) async {
  try {
    final r = await ref.read(apiClientProvider).get('/v1/public/content/app');
    final data = r['data'];
    return data is Map ? AppContent.fromJson(Map<String, dynamic>.from(data)) : AppContent.defaults;
  } catch (_) {
    return AppContent.defaults;
  }
});

/// Synchronous access with defaults while loading.
AppContent appContentOf(WidgetRef ref) => ref.watch(appContentProvider).value ?? AppContent.defaults;
