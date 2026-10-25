import 'package:flutter_test/flutter_test.dart';
import 'package:smeter/core/format.dart';
import 'package:smeter/core/models.dart';

void main() {
  test('naira formatting', () {
    expect(naira(123.55), '₦123.55');
    expect(naira(123000, whole: true), '₦123,000');
    expect(naira(null), '-');
  });

  test('short date matches the design format', () {
    expect(shortDate('2026-06-11T10:00:00Z'), '11-06-2026');
    expect(shortDate(null), '');
  });

  test('purchase parses API json', () {
    final p = Purchase.fromJson({
      'reference': 'SMABC',
      'meterId': '47001234567',
      'status': 'vended',
      'amount': 2000,
      'debtRecovered': 200,
      'energyAmount': 1800,
      'fee': 130,
      'feeBearer': 'tenant',
      'total': 2130,
      'unitPrice': 230,
      'units': 7.82,
      'token': '1234-5678-9012-3456-7890',
      'delivery': 'ota_queued',
      'createdAt': '2026-06-11T10:00:00Z',
    });
    expect(p.isFinal, isTrue);
    expect(p.units, 7.82);
    expect(p.total, 2130.0);
  });

  test('usage report parses points', () {
    final r = UsageReport.fromJson({
      'period': 'month',
      'label': 'May, 2026',
      'points': [
        {'label': '1', 'kwh': 4.2},
        {'label': '2', 'kwh': 5},
        {'label': '3', 'kwh': null},
      ],
      'totalKwh': 9.2,
      'avgUsageKwh': 4.6,
      'avgUsageChangePct': -10,
      'avgCost': 1058,
      'avgCostChangePct': null,
      'previousTotalKwh': 140,
      'projectedNextKwh': 150,
      'note': 'delayed',
    });
    expect(r.points.length, 3);
    expect(r.points[2].kwh, isNull);
    expect(r.points[1].kwh, 5.0);
    expect(r.avgUsageChangePct, -10.0);
    expect(r.avgCostChangePct, isNull);
  });

  test('meter label and tenant name fallbacks', () {
    final m = Meter.fromJson({
      'meterId': '470012',
      'address': '1a Bourdillon',
      'apartment': '1',
      'tenant': {'phone': '+2348021112222'},
      'status': 'invited',
    });
    expect(m.label, 'Apt 1 · 470012');
    expect(m.tenantName, 'Tenant');
  });
}
