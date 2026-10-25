import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_content.dart';
import '../../core/models.dart';
import '../../shared/widgets.dart';
import '../../theme/smeter_theme.dart';
import '../payments/buy_power_screen.dart';
import 'landlord_repository.dart';

/// "Make a payment": pick one of your meters, then buy units for it.
Future<void> openMakePayment(BuildContext context, WidgetRef ref, Landlord landlord, {Meter? meter}) async {
  if (landlord.unitPrice <= 0) {
    showInfo(context, 'Set your unit price first', icon: Icons.sell_outlined);
    context.push('/landlord/unit-price');
    return;
  }
  var target = meter;
  if (target == null) {
    final meters = await ref.read(metersProvider.future);
    if (!context.mounted) return;
    if (meters.isEmpty) {
      showInfo(context, 'Add a meter first', icon: Icons.electric_meter_outlined);
      return;
    }
    target = await showModalBottomSheet<Meter>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(ctx).height * 0.7),
          child: ListView(shrinkWrap: true, children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(Space.xl, 0, Space.xl, Space.sm),
              child: Text('Buy units for which meter?', style: SmeterText.title2()),
            ),
            for (final m in meters)
              ListTile(
                contentPadding: const EdgeInsets.symmetric(horizontal: Space.xl, vertical: 2),
                leading: CircleAvatar(
                  backgroundColor: SmeterColors.primarySoft,
                  child: Text(m.apartment.isEmpty ? '#' : m.apartment, style: SmeterText.bodyStrong(color: SmeterColors.primary)),
                ),
                title: Text(m.tenantName),
                subtitle: Text('${m.label} · ${m.address}', maxLines: 1, overflow: TextOverflow.ellipsis),
                trailing: ModeBadge(m.deliveryMode),
                onTap: () => Navigator.of(ctx).pop(m),
              ),
            const SizedBox(height: Space.md),
          ]),
        ),
      ),
    );
  }
  if (target == null || !context.mounted) return;
  final repo = ref.read(landlordRepositoryProvider);
  // Latest payment options from the admin; refreshed in the background for next time.
  final content = ref.read(appContentProvider).value ?? AppContent.defaults;
  ref.invalidate(appContentProvider);
  final m = target;
  await Navigator.of(context, rootNavigator: true).push(
    MaterialPageRoute(
      builder: (_) => BuyPowerScreen(
        title: 'Make a payment',
        subtitle: 'Buying units for ${m.tenantName} · ${m.label}',
        unitPrice: landlord.unitPrice,
        deliveryMode: m.deliveryMode,
        start: (amount, channel) => repo.buyFor(m.meterId, amount, channel: channel),
        load: repo.purchase,
        presets: content.presets,
        minAmount: content.payments.minPurchase,
        maxAmount: content.payments.maxPurchase,
        channels: content.payments.channels,
      ),
    ),
  );
  ref.invalidate(landlordDashboardProvider);
  ref.invalidate(transactionsProvider);
  ref.invalidate(meterDetailProvider(m.meterId));
}
