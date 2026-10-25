import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/models.dart';

class TenantDashboard {
  TenantDashboard(Map<String, dynamic> j)
    : tenant = TenantProfile.fromJson(Map<String, dynamic>.from(j['tenant'] as Map)),
      points = (j['points'] as num?)?.toDouble(),
      monthUnits = ((j['month'] as Map?)?['units'] as num? ?? 0).toDouble(),
      monthSpend = ((j['month'] as Map?)?['spend'] as num? ?? 0).toDouble(),
      monthPurchases = (j['month'] as Map?)?['purchases'] as int? ?? 0,
      lastToken = j['lastToken'] == null ? null : Purchase.fromJson(Map<String, dynamic>.from(j['lastToken'] as Map)),
      recent = (j['recent'] as List).map((p) => Purchase.fromJson(Map<String, dynamic>.from(p as Map))).toList(),
      unread = j['unreadNotifications'] as int? ?? 0;

  final TenantProfile tenant;

  /// Estimated kWh left (GPRS meters only; null for manual-token meters).
  final double? points;
  final double monthUnits;
  final double monthSpend;
  final int monthPurchases;
  final Purchase? lastToken;
  final List<Purchase> recent;
  final int unread;
}

class TenantRepository {
  TenantRepository(this._api);
  final ApiClient _api;

  Future<TenantDashboard> dashboard() async => TenantDashboard(await _api.get('/v1/tenant/dashboard'));

  Future<TenantProfile> me() async =>
      TenantProfile.fromJson(Map<String, dynamic>.from((await _api.get('/v1/tenant/me'))['tenant'] as Map));

  Future<TenantProfile> updateMe({String? firstName, String? lastName, String? email}) async {
    final r = await _api.patch('/v1/tenant/me', {'firstName': ?firstName, 'lastName': ?lastName, 'email': ?email});
    return TenantProfile.fromJson(Map<String, dynamic>.from(r['tenant'] as Map));
  }

  Future<LiveReading> live() async => LiveReading.fromJson(await _api.get('/v1/tenant/live'));

  Future<UsageReport> usage(String period, DateTime date) async =>
      UsageReport.fromJson(await _api.get('/v1/tenant/usage', query: {'period': period, 'date': _ymd(date)}));

  Future<Quote> quote(double amount) async => Quote.fromJson(
    Map<String, dynamic>.from((await _api.post('/v1/tenant/quote', {'amount': amount}))['quote'] as Map),
  );

  Future<Checkout> buy(double amount, {String? channel}) async =>
      Checkout.fromJson(await _api.post('/v1/tenant/purchases', {'amount': amount, 'channel': ?channel}));

  Future<List<Purchase>> purchases({int page = 1}) async {
    final r = await _api.get('/v1/tenant/purchases', query: {'page': page, 'pageSize': 50});
    return (r['data'] as List).map((p) => Purchase.fromJson(Map<String, dynamic>.from(p as Map))).toList();
  }

  Future<Purchase> purchase(String reference) async => Purchase.fromJson(
    Map<String, dynamic>.from((await _api.get('/v1/tenant/purchases/$reference'))['purchase'] as Map),
  );

  Future<List<AppNotification>> notifications() async {
    final r = await _api.get('/v1/tenant/notifications');
    return (r['data'] as List).map((n) => AppNotification.fromJson(Map<String, dynamic>.from(n as Map))).toList();
  }

  Future<void> markNotificationsRead() => _api.post('/v1/tenant/notifications/read');
}

String _ymd(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

final tenantRepositoryProvider = Provider((ref) => TenantRepository(ref.watch(apiClientProvider)));

final tenantDashboardProvider = FutureProvider.autoDispose((ref) => ref.watch(tenantRepositoryProvider).dashboard());

final tenantProfileProvider = FutureProvider.autoDispose((ref) => ref.watch(tenantRepositoryProvider).me());

final tenantPurchasesProvider = FutureProvider.autoDispose((ref) => ref.watch(tenantRepositoryProvider).purchases());

final tenantNotificationsProvider = FutureProvider.autoDispose(
  (ref) => ref.watch(tenantRepositoryProvider).notifications(),
);

typedef UsageArgs = ({String period, DateTime date});

final usageProvider = FutureProvider.autoDispose.family<UsageReport, UsageArgs>(
  (ref, args) => ref.watch(tenantRepositoryProvider).usage(args.period, args.date),
);

final purchaseProvider = FutureProvider.autoDispose.family<Purchase, String>(
  (ref, reference) => ref.watch(tenantRepositoryProvider).purchase(reference),
);
