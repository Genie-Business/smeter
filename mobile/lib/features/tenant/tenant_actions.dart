import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/app_content.dart';
import '../../core/models.dart';
import '../payments/buy_power_screen.dart';
import '../payments/checkout.dart';
import 'tenant_repository.dart';

/// Open the Buy Power flow and refresh tenant data afterwards.
Future<void> openBuyPower(BuildContext context, WidgetRef ref, TenantProfile tenant) async {
  final repo = ref.read(tenantRepositoryProvider);
  // Latest payment options from the admin; refreshed in the background for next time.
  final content = ref.read(appContentProvider).value ?? AppContent.defaults;
  ref.invalidate(appContentProvider);
  await Navigator.of(context, rootNavigator: true).push(
    MaterialPageRoute(
      builder: (_) => BuyPowerScreen(
        title: 'Buy power',
        subtitle: 'Meter ${tenant.meterId}${tenant.apartment.isEmpty ? '' : ' · Apartment ${tenant.apartment}'}',
        unitPrice: tenant.unitPrice,
        deliveryMode: tenant.deliveryMode,
        quote: repo.quote,
        start: (amount, channel) => repo.buy(amount, channel: channel),
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
