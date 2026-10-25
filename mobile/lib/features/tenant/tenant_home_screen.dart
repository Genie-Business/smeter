import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart';
import '../../shared/widgets.dart';
import '../../theme/smeter_theme.dart';
import 'live_display.dart';
import 'tenant_actions.dart';
import 'tenant_repository.dart';

class TenantHomeScreen extends ConsumerWidget {
  const TenantHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dash = ref.watch(tenantDashboardProvider);
    Future<void> refresh() => ref.refresh(tenantDashboardProvider.future);

    return Scaffold(
      body: AsyncBody<TenantDashboard>(
        value: dash,
        skeleton: const SkeletonList(),
        data: (d) {
          final t = d.tenant;
          return HeroScaffold(
            onRefresh: refresh,
            header: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(greeting(), style: SmeterText.small(color: Colors.white70)),
                    const SizedBox(height: 2),
                    Text(t.displayName, style: SmeterText.title1(color: Colors.white)),
                  ]),
                ),
                NotificationBell(unread: d.unread, onTap: () => context.push('/tenant/notifications')),
              ]),
              const SizedBox(height: Space.md),
              Wrap(spacing: Space.sm, runSpacing: Space.sm, children: [
                Pill('Meter ${t.meterId}', icon: Icons.electric_meter_outlined, onDark: true),
                ModeBadge(t.deliveryMode, onDark: true),
              ]),
            ]),
            children: [
              _HeroCard(dash: d, onBuy: () => openBuyPower(context, ref, t)),
              const AnnouncementBanner(tenant: true),
              if (t.relayState.startsWith('disconnect'))
                const InfoBanner(
                  icon: Icons.power_off_rounded,
                  tone: Tone.danger,
                  title: 'Supply switched off',
                  text: 'Your property owner has disconnected this meter. Contact them to restore power.',
                ),
              if (t.debt > 0)
                InfoBanner(
                  icon: Icons.account_balance_wallet_outlined,
                  tone: Tone.warn,
                  title: '${naira(t.debt)} outstanding',
                  text: '${t.debtRecoveryPercent.toStringAsFixed(0)}% of each purchase goes towards it until it is cleared.',
                ),
              const SectionHeader('This month'),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: Space.lg),
                child: Row(children: [
                  Expanded(child: StatTile(label: 'Spent', value: naira(d.monthSpend, whole: true), icon: Icons.payments_outlined)),
                  const SizedBox(width: Space.sm),
                  Expanded(child: StatTile(label: 'Units bought', value: units(d.monthUnits), icon: Icons.bolt_rounded)),
                  const SizedBox(width: Space.sm),
                  Expanded(child: StatTile(label: 'Purchases', value: '${d.monthPurchases}', icon: Icons.receipt_long_outlined)),
                ]),
              ),
              if (!t.isManual) ...[
                const SectionHeader('Meter'),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: Space.lg),
                  child: LiveDisplayCard(load: () => ref.read(tenantRepositoryProvider).live()),
                ),
              ],
              SectionHeader(
                'Recent purchases',
                action: d.recent.isEmpty ? null : 'See all',
                onAction: () => context.go('/tenant/recent'),
              ),
              if (d.recent.isEmpty)
                const EmptyState(
                  icon: Icons.bolt_outlined,
                  title: 'No purchases yet',
                  message: 'Your first power purchase takes under a minute.',
                )
              else
                AppCard(
                  padding: const EdgeInsets.symmetric(vertical: Space.xs),
                  child: Column(children: [
                    for (final (i, p) in d.recent.take(4).indexed) ...[
                      if (i > 0) const Divider(indent: 76),
                      PurchaseRow(purchase: p, onTap: () => context.push('/tenant/purchases/${p.reference}')),
                    ],
                  ]),
                ),
              const SizedBox(height: Space.xxxl),
            ],
          );
        },
      ),
    );
  }
}

/// The main card: last token for manual meters, units left for GPRS meters.
class _HeroCard extends StatelessWidget {
  const _HeroCard({required this.dash, required this.onBuy});

  final TenantDashboard dash;
  final VoidCallback onBuy;

  @override
  Widget build(BuildContext context) {
    final t = dash.tenant;
    final last = dash.lastToken;
    return AppCard(
      padding: const EdgeInsets.all(Space.xl),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (t.isManual) ...[
          Row(children: [
            Text('LAST TOKEN', style: SmeterText.overline()),
            const Spacer(),
            if (last != null) Text(timeOfDay(last.vendedAt ?? last.createdAt), style: SmeterText.caption()),
          ]),
          const SizedBox(height: Space.md),
          if (last?.token != null) ...[
            TokenDisplay(token: last!.token!, units: last.units, compact: true),
            const SizedBox(height: Space.md),
            Row(children: [
              Expanded(
                child: Text('${units(last.units)} kWh · ${naira(last.amount)}',
                    style: SmeterText.bodyStrong(color: SmeterColors.inkSoft)),
              ),
              TextButton.icon(
                onPressed: () => copyText(context, last.token!.replaceAll('-', ''), 'Token'),
                icon: const Icon(Icons.copy_rounded, size: 18),
                label: const Text('Copy'),
              ),
            ]),
          ] else
            Padding(
              padding: const EdgeInsets.symmetric(vertical: Space.sm),
              child: Text('Buy power and your token appears here, ready to type into your meter remote.',
                  style: SmeterText.small()),
            ),
        ] else ...[
          Row(children: [
            Text('ESTIMATED UNITS LEFT', style: SmeterText.overline()),
            const Spacer(),
            const Icon(Icons.info_outline_rounded, size: 16, color: SmeterColors.muted),
          ]),
          const SizedBox(height: Space.sm),
          Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
            Text(units(dash.points), style: SmeterText.display(color: SmeterColors.primary)),
            const SizedBox(width: 6),
            Text('kWh', style: SmeterText.title3(color: SmeterColors.muted)),
          ]),
          const SizedBox(height: 4),
          Text('Bought minus what your meter has used. Updates as readings arrive.', style: SmeterText.caption()),
        ],
        const SizedBox(height: Space.lg),
        FilledButton.icon(
          onPressed: onBuy,
          icon: const Icon(Icons.bolt_rounded),
          label: Text(t.unitPrice > 0 ? 'Buy power · ${naira(t.unitPrice)}/kWh' : 'Buy power'),
        ),
      ]),
    );
  }
}
