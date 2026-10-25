import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/models.dart';

Map<String, dynamic> _m(Object? o) => Map<String, dynamic>.from(o as Map);

class LandlordDashboard {
  LandlordDashboard(Map<String, dynamic> j)
    : landlord = Landlord.fromJson(_m(j['landlord'])),
      earnings = (j['earnings'] as num).toDouble(),
      earningsThisMonth = (j['earningsThisMonth'] as num).toDouble(),
      collected = (j['collected'] as num).toDouble(),
      meterCount = (j['meters'] as Map)['total'] as int? ?? 0,
      activeMeters = (j['meters'] as Map)['active'] as int? ?? 0,
      invitedMeters = (j['meters'] as Map)['invited'] as int? ?? 0,
      unread = j['unreadNotifications'] as int? ?? 0,
      recent = (j['recent'] as List).map((p) => Purchase.fromJson(_m(p))).toList();

  final Landlord landlord;
  final double earnings;
  final double earningsThisMonth;
  final double collected;
  final int meterCount;
  final int activeMeters;
  final int invitedMeters;
  final int unread;
  final List<Purchase> recent;
}

class MeterDetail {
  MeterDetail(Map<String, dynamic> j)
    : meter = Meter.fromJson(_m(j['meter'])),
      live = j['live'] == null ? null : LiveReading.fromJson(_m(j['live'])),
      purchases = (j['purchases'] as List).map((p) => Purchase.fromJson(_m(p))).toList();

  final Meter meter;
  final LiveReading? live;
  final List<Purchase> purchases;
}

class LedgerLine {
  LedgerLine(Map<String, dynamic> j)
    : meterId = j['meterId'] as String?,
      purchases = j['purchases'] as int? ?? 0,
      units = (j['units'] as num? ?? 0).toDouble(),
      collected = (j['collected'] as num? ?? 0).toDouble(),
      baseUtilityCost = (j['baseUtilityCost'] as num? ?? 0).toDouble(),
      markup = (j['markup'] as num? ?? 0).toDouble(),
      debtRecovered = (j['debtRecovered'] as num? ?? 0).toDouble(),
      fees = (j['fees'] as num? ?? 0).toDouble(),
      net = (j['net'] as num? ?? 0).toDouble();

  final String? meterId;
  final int purchases;
  final double units;
  final double collected;
  final double baseUtilityCost;
  final double markup;
  final double debtRecovered;
  final double fees;
  final double net;
}

class Ledger {
  Ledger(Map<String, dynamic> j)
    : totals = LedgerLine(_m(j['totals'])),
      meters = (j['meters'] as List).map((m) => LedgerLine(_m(m))).toList();
  final LedgerLine totals;
  final List<LedgerLine> meters;
}

class Bank {
  Bank(this.name, this.code);
  final String name;
  final String code;
}

class LandlordRepository {
  LandlordRepository(this._api);
  final ApiClient _api;

  Future<LandlordDashboard> dashboard() async => LandlordDashboard(await _api.get('/v1/landlord/dashboard'));

  Future<Landlord> me() async => Landlord.fromJson(_m((await _api.get('/v1/landlord/me'))['landlord']));

  Future<Landlord> updateMe({String? fullName, String? address}) async => Landlord.fromJson(
    _m((await _api.patch('/v1/landlord/me', {'fullName': ?fullName, 'address': ?address}))['landlord']),
  );

  Future<Landlord> setUnitPrice(double price) async =>
      Landlord.fromJson(_m((await _api.put('/v1/landlord/tariff', {'unitPrice': price}))['landlord']));

  Future<Landlord> setFeeBearer(String bearer) async =>
      Landlord.fromJson(_m((await _api.put('/v1/landlord/fee-bearer', {'feeBearer': bearer}))['landlord']));

  Future<List<Bank>> banks() async => ((await _api.get('/v1/landlord/banks'))['banks'] as List)
      .map((b) => Bank(b['name'] as String, b['code'] as String))
      .toList();

  Future<({String accountName, bool matches})> resolveBank(
    String bankCode,
    String bankName,
    String accountNumber,
  ) async {
    final r = await _api.post('/v1/landlord/bank/resolve', {
      'bankCode': bankCode,
      'bankName': bankName,
      'accountNumber': accountNumber,
    });
    return (accountName: r['accountName'] as String, matches: r['matchesProfile'] as bool? ?? false);
  }

  Future<({String sentTo, String? devCode})> requestBankChange(
    String bankCode,
    String bankName,
    String accountNumber,
  ) async {
    final r = await _api.post('/v1/landlord/bank/request', {
      'bankCode': bankCode,
      'bankName': bankName,
      'accountNumber': accountNumber,
    });
    return (sentTo: r['sentTo'] as String? ?? '', devCode: r['devCode'] as String?);
  }

  Future<Landlord> setPayoutSchedule(String schedule) async =>
      Landlord.fromJson(_m((await _api.put('/v1/landlord/payout-schedule', {'schedule': schedule}))['landlord']));

  /// Look a meter number up on the metering platform before adding it.
  Future<MeterCheck> checkMeter(String meterId) async =>
      MeterCheck(_m(await _api.get('/v1/landlord/meters/check/${Uri.encodeComponent(meterId)}')));

  Future<Landlord> confirmBankChange(String code) async =>
      Landlord.fromJson(_m((await _api.post('/v1/landlord/bank/confirm', {'code': code}))['landlord']));

  Future<List<Meter>> meters() async =>
      ((await _api.get('/v1/landlord/meters'))['meters'] as List).map((m) => Meter.fromJson(_m(m))).toList();

  Future<Meter> addMeter(Map<String, dynamic> body) async =>
      Meter.fromJson(_m((await _api.post('/v1/landlord/meters', body))['meter']));

  Future<MeterDetail> meter(String meterId) async => MeterDetail(await _api.get('/v1/landlord/meters/$meterId'));

  Future<Meter> updateMeter(String meterId, Map<String, dynamic> body) async =>
      Meter.fromJson(_m((await _api.patch('/v1/landlord/meters/$meterId', body))['meter']));

  Future<void> removeMeter(String meterId) => _api.delete('/v1/landlord/meters/$meterId');

  Future<bool> relay(String meterId, {required bool disconnect}) async {
    final r = await _api.post('/v1/landlord/meters/$meterId/${disconnect ? 'disconnect' : 'reconnect'}');
    return r['queued'] as bool? ?? false;
  }

  Future<List<Purchase>> transactions({int page = 1}) async {
    final r = await _api.get('/v1/landlord/transactions', query: {'page': page, 'pageSize': 50});
    return (r['data'] as List).map((p) => Purchase.fromJson(_m(p))).toList();
  }

  Future<Checkout> buyFor(String meterId, double amount, {String? channel}) async => Checkout.fromJson(
    await _api.post('/v1/landlord/purchases', {'meterId': meterId, 'amount': amount, 'channel': ?channel}),
  );

  Future<Purchase> purchase(String reference) async =>
      Purchase.fromJson(_m((await _api.get('/v1/landlord/purchases/$reference'))['purchase']));

  Future<void> retryVend(String reference) => _api.post('/v1/landlord/purchases/$reference/retry');

  Future<Ledger> ledger() async => Ledger(await _api.get('/v1/landlord/ledger'));

  Future<List<AppNotification>> notifications() async =>
      ((await _api.get('/v1/landlord/notifications'))['data'] as List)
          .map((n) => AppNotification.fromJson(_m(n)))
          .toList();

  Future<void> markNotificationsRead() => _api.post('/v1/landlord/notifications/read');
}

final landlordRepositoryProvider = Provider((ref) => LandlordRepository(ref.watch(apiClientProvider)));

final landlordDashboardProvider = FutureProvider.autoDispose(
  (ref) => ref.watch(landlordRepositoryProvider).dashboard(),
);
class MeterCheck {
  MeterCheck(Map<String, dynamic> j)
    : found = j['found'] as bool? ?? false,
      available = j['available'] as bool? ?? false,
      threePhase = j['threePhase'] as bool?,
      message = j['message'] as String? ?? '';

  final bool found;
  final bool available;
  final bool? threePhase;
  final String message;
}

final landlordProfileProvider = FutureProvider.autoDispose((ref) => ref.watch(landlordRepositoryProvider).me());
final metersProvider = FutureProvider.autoDispose((ref) => ref.watch(landlordRepositoryProvider).meters());
final meterDetailProvider = FutureProvider.autoDispose.family<MeterDetail, String>(
  (ref, id) => ref.watch(landlordRepositoryProvider).meter(id),
);
final transactionsProvider = FutureProvider.autoDispose((ref) => ref.watch(landlordRepositoryProvider).transactions());
final ledgerProvider = FutureProvider.autoDispose((ref) => ref.watch(landlordRepositoryProvider).ledger());
final landlordNotificationsProvider = FutureProvider.autoDispose(
  (ref) => ref.watch(landlordRepositoryProvider).notifications(),
);
final banksProvider = FutureProvider((ref) => ref.watch(landlordRepositoryProvider).banks());
