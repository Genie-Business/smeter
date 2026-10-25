import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/format.dart';
import '../../core/models.dart';
import '../../shared/widgets.dart';
import '../../theme/smeter_theme.dart';
import '../payments/checkout.dart';
import 'tenant_repository.dart';

/// All purchases, grouped by day, with one-tap token copy.
class TenantRecentsScreen extends ConsumerWidget {
  const TenantRecentsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final purchases = ref.watch(tenantPurchasesProvider);
    final unread = ref.watch(tenantDashboardProvider).value?.unread ?? 0;
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          PageTitle(
            'Tokens',
            subtitle: 'Every purchase and its token',
            trailing: NotificationBell(unread: unread, onDark: false, onTap: () => context.push('/tenant/notifications')),
          ),
          Expanded(
            child: AsyncBody<List<Purchase>>(
              value: purchases,
              skeleton: const SkeletonList(hero: false, rows: 7),
              onRefresh: () => ref.refresh(tenantPurchasesProvider.future),
              data: (list) {
                if (list.isEmpty) {
                  return ListView(children: const [
                    EmptyState(
                      icon: Icons.vpn_key_outlined,
                      title: 'No tokens yet',
                      message: 'When you buy power, the token and receipt are kept here.',
                    ),
                  ]);
                }
                final groups = groupByDay(list, (p) => p.vendedAt ?? p.createdAt);
                return ListView(
                  padding: const EdgeInsets.only(bottom: Space.xxxl),
                  children: [
                    for (final (label, items) in groups) ...[
                      DayHeader(label),
                      AppCard(
                        padding: const EdgeInsets.symmetric(vertical: Space.xs),
                        child: Column(children: [
                          for (final (i, p) in items.indexed) ...[
                            if (i > 0) const Divider(indent: 76),
                            PurchaseRow(purchase: p, onTap: () => context.push('/tenant/purchases/${p.reference}')),
                          ],
                        ]),
                      ),
                    ],
                  ],
                );
              },
            ),
          ),
        ]),
      ),
    );
  }
}

class PurchaseDetailScreen extends ConsumerWidget {
  const PurchaseDetailScreen({super.key, required this.reference});

  final String reference;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final purchase = ref.watch(purchaseProvider(reference));
    final profile = ref.watch(tenantProfileProvider).value;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Receipt'),
        actions: [
          if (purchase.value != null)
            IconButton(
              tooltip: 'Share receipt',
              icon: const Icon(Icons.ios_share_rounded),
              onPressed: () => SharePlus.instance.share(
                ShareParams(text: _receiptText(purchase.value!, profile), subject: 'smeter receipt'),
              ),
            ),
        ],
      ),
      body: AsyncBody<Purchase>(
        value: purchase,
        onRefresh: () => ref.refresh(purchaseProvider(reference).future),
        data: (p) => ListView(
          padding: const EdgeInsets.only(bottom: Space.xxxl),
          children: [
            ReceiptBody(
              purchase: p,
              deliveryMode: profile?.deliveryMode ?? 'ota',
              address: profile == null
                  ? null
                  : '${profile.address}${profile.apartment.isEmpty ? '' : ', Apt ${profile.apartment}'}',
            ),
          ],
        ),
      ),
    );
  }

  String _receiptText(Purchase p, TenantProfile? t) => [
        'smeter power purchase receipt',
        'Meter: ${p.meterId}',
        if (t != null) 'Address: ${t.address}${t.apartment.isEmpty ? '' : ', Apt ${t.apartment}'}',
        'Date: ${dateTime(p.vendedAt ?? p.createdAt)}',
        'Amount: ${naira(p.amount)}',
        'Units: ${units(p.units)} kWh @ ${naira(p.unitPrice)}/kWh',
        if (p.debtRecovered > 0) 'Debt recovered: ${naira(p.debtRecovered)}',
        'Total paid: ${naira(p.total)}',
        if (p.token != null) 'Token: ${p.token}',
        'Reference: ${p.reference}',
      ].join('\n');
}
