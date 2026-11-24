import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/app_content.dart';
import '../../core/models.dart';
import '../payments/buy_power_screen.dart';
import '../payments/checkout.dart';
import '../payments/source_picker.dart';
import 'tenant_repository.dart';

/// Open the Buy Power flow and refresh tenant data afterwards.
Future<void> openBuyPower(BuildContext context, WidgetRef ref, TenantProfile tenant) async {
  final repo = ref.read(tenantRepositoryProvider);
  // A dual-source meter sells units for each supply the owner made prepaid.
  var source = 'a';
  var label = '';
  final b = tenant.prepaidSourceB;
  if (tenant.dualSource && b != null) {
    final a = tenant.sources.firstWhere((s) => s.key == 'a');
    final picked = await pickPowerSource(context, [a, b], {'a': tenant.unitPrice, 'b': tenant.unitPriceB});
    if (picked == null || !context.mounted) return;
    source = picked.key;
    label = ' · ${picked.label}';
  }
  // Latest payment options from the admin; refreshed in the background for next time.
  final content = ref.read(appContentProvider).value ?? AppContent.defaults;
  ref.invalidate(appContentProvider);
  await Navigator.of(context, rootNavigator: true).push(
    MaterialPageRoute(
      builder: (_) => BuyPowerScreen(
        title: 'Buy power$label',
        subtitle: 'Meter ${tenant.meterId}${tenant.apartment.isEmpty ? '' : ' · Apartment ${tenant.apartment}'}',
        unitPrice: source == 'b' ? tenant.unitPriceB : tenant.unitPrice,
        deliveryMode: tenant.deliveryMode,
        quote: (amount) => repo.quote(amount, source: source),
        start: (amount, channel) => repo.buy(amount, channel: channel, source: source),
        load: repo.purchase,
        presets: content.presets,
        minAmount: content.payments.minPurchase,
        maxAmount: content.payments.maxPurchase,
        channels: content.payments.channels,
      ),
    ),
  );
  ref.invalidate(tenantDashboardProvider);
  ref.invalidate(tenantPurchasesProvider);
}

/// Pay the meter's outstanding service charge, then refresh.
Future<void> openPayServiceCharge(BuildContext context, WidgetRef ref, TenantProfile tenant) async {
  final checkout = await ref.read(tenantRepositoryProvider).payServiceCharge();
  if (!context.mounted) return;
  await runCheckout(context, checkout, ref.read(tenantRepositoryProvider).purchase, deliveryMode: tenant.deliveryMode);
  ref.invalidate(tenantDashboardProvider);
  ref.invalidate(tenantPurchasesProvider);
}
