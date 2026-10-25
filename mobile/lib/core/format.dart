import 'package:flutter/material.dart' show DateUtils;
import 'package:intl/intl.dart';

final _naira = NumberFormat.currency(locale: 'en_NG', symbol: '₦', decimalDigits: 2);
final _nairaWhole = NumberFormat.currency(locale: 'en_NG', symbol: '₦', decimalDigits: 0);
final _num = NumberFormat('#,##0.00', 'en_NG');

String naira(num? v, {bool whole = false}) => v == null ? '-' : (whole ? _nairaWhole : _naira).format(v);
String units(num? v) => v == null ? '-' : _num.format(v);
String kwh(num? v) => v == null ? '-' : '${_num.format(v)} kWh';

/// "4.3 days", "1 day"
String days(num v) {
  final n = v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(1);
  return v == 1 ? '1 day' : '$n days';
}

/// Who pays a meter's GPRS service charge, for the owner's screens.
const servicePayerLabels = {
  'owner': 'I pay it',
  'tenant_monthly': 'Tenant pays monthly',
  'tenant_per_purchase': 'Tenant pays with each purchase',
};

DateTime? parseDate(String? s) => s == null ? null : DateTime.tryParse(s)?.toLocal();

/// 11-06-2026, the format used across the designs.
String shortDate(String? iso) {
  final d = parseDate(iso);
  return d == null ? '' : DateFormat('dd-MM-yyyy').format(d);
}

String dateTime(String? iso) {
  final d = parseDate(iso);
  return d == null ? '' : DateFormat('d MMM yyyy, h:mm a').format(d);
}

/// "Today", "Yesterday", weekday within the last week, else "12 Jun 2026".
String dayLabel(String? iso, {DateTime? now}) {
  final d = parseDate(iso);
  if (d == null) return 'Earlier';
  final today = DateUtils.dateOnly(now ?? DateTime.now());
  final day = DateUtils.dateOnly(d);
  final diff = today.difference(day).inDays;
  if (diff == 0) return 'Today';
  if (diff == 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return DateFormat('EEEE').format(d);
  return DateFormat(d.year == today.year ? 'd MMM' : 'd MMM yyyy').format(d);
}

/// "2:45 PM" today, otherwise "12 Jun, 2:45 PM".
String timeOfDay(String? iso) {
  final d = parseDate(iso);
  if (d == null) return '';
  return DateUtils.isSameDay(d, DateTime.now()) ? DateFormat('h:mm a').format(d) : DateFormat('d MMM, h:mm a').format(d);
}

/// Time-aware greeting for dashboards.
String greeting([DateTime? now]) {
  final h = (now ?? DateTime.now()).hour;
  return h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : 'Good evening');
}

String relative(String? iso) {
  final d = parseDate(iso);
  if (d == null) return 'never';
  final diff = DateTime.now().difference(d);
  if (diff.inSeconds < 60) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
  if (diff.inHours < 24) return '${diff.inHours} h ago';
  return '${diff.inDays} d ago';
}

/// Loose email check (the server validates properly).
bool validEmail(String? v) => RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch((v ?? '').trim());
