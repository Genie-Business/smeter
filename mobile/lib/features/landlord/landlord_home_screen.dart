import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart';
import '../../core/models.dart';
import '../../shared/widgets.dart';
import '../../theme/smeter_theme.dart';
import 'landlord_actions.dart';
import 'landlord_repository.dart';

class LandlordHomeScreen extends ConsumerWidget {
  const LandlordHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dash = ref.watch(landlordDashboardProvider);
    return Scaffold(
      body: AsyncBody<LandlordDashboard>(
        value: dash,
        skeleton: const SkeletonList(),
        data: (d) => HeroScaffold(
          onRefresh: () => ref.refresh(landlordDashboardProvider.future),
          overlap: 52,
          header: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(greeting(), style: SmeterText.small(color: Colors.white70)),
                  Text(d.landlord.firstName, style: SmeterText.title2(color: Colors.white)),
                ]),
              ),
              NotificationBell(unread: d.unread, onTap: () => context.push('/landlord/notifications')),
            ]),
            const SizedBox(height: Space.xl),
            Text('YOUR EARNINGS', style: SmeterText.overline(color: Colors.white70)),
            const SizedBox(height: Space.xs),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(naira(d.earnings), style: SmeterText.display(color: Colors.white)),
            ),
            const SizedBox(height: Space.xs),
            Text('${naira(d.earningsThisMonth, whole: true)} this month · ${naira(d.collected, whole: true)} collected in total',
                style: SmeterText.small(color: Colors.white70)),
          ]),
          children: [
            AppCard(
              padding: const EdgeInsets.symmetric(vertical: Space.lg, horizontal: Space.sm),
              child: Row(children: [
                _Action(icon: Icons.add_home_work_outlined, label: 'Add meter', onTap: () => context.push('/landlord/meters/add')),
                _Action(icon: Icons.bolt_rounded, label: 'Buy units', onTap: () => openMakePayment(context, ref, d.landlord)),
                _Action(icon: Icons.sell_outlined, label: 'Unit price', onTap: () => context.push('/landlord/unit-price')),
                _Action(icon: Icons.insights_rounded, label: 'Ledger', onTap: () => context.push('/landlord/ledger')),
              ]),
            ),
            const AnnouncementBanner(tenant: false),
            _SetupChecklist(d: d),
            const SectionHeader('Overview'),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Space.lg),
              child: Row(children: [
                Expanded(
                  child: StatTile(
                    label: 'Meters',
                    value: '${d.meterCount}',
                    icon: Icons.electric_meter_outlined,
                    caption: '${d.activeMeters} active · ${d.invitedMeters} invited',
                  ),
                ),
                const SizedBox(width: Space.sm),
                Expanded(
                  child: StatTile(
                    label: 'Unit price',
                    value: d.landlord.unitPrice > 0 ? naira(d.landlord.unitPrice) : 'Not set',
                    icon: Icons.sell_outlined,
                    caption: 'per kWh',
                  ),
                ),
              ]),
            ),
            SectionHeader(
              'Recent payments',
              action: d.recent.isEmpty ? null : 'See all',
              onAction: () => context.go('/landlord/recent'),
            ),
            if (d.recent.isEmpty)
              EmptyState(
                icon: Icons.receipt_long_outlined,
                title: 'No payments yet',
                message: d.meterCount == 0
                    ? 'Add a meter and invite your tenant to start receiving payments.'
                    : 'Payments from your tenants will show up here.',
              )
            else
              AppCard(
                padding: const EdgeInsets.symmetric(vertical: Space.xs),
                child: Column(children: [
                  for (final (i, p) in d.recent.indexed) ...[
                    if (i > 0) const Divider(indent: 76),
                    LandlordTransactionRow(purchase: p),
                  ],
                ]),
              ),
            const SizedBox(height: Space.xxxl),
          ],
        ),
      ),
    );
  }
}

class _Action extends StatelessWidget {
  const _Action({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Expanded(
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(Radii.md),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: Space.xs),
            child: Column(children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(color: SmeterColors.primarySoft, borderRadius: BorderRadius.circular(Radii.md)),
                child: Icon(icon, color: SmeterColors.primary),
              ),
              const SizedBox(height: Space.sm),
              Text(label, textAlign: TextAlign.center, style: SmeterText.caption(color: SmeterColors.ink)),
            ]),
          ),
        ),
      );
}

class _SetupChecklist extends StatelessWidget {
  const _SetupChecklist({required this.d});

  final LandlordDashboard d;

  @override
  Widget build(BuildContext context) {
    final steps = [
      ('Add your property address', (d.landlord.address ?? '').trim().isNotEmpty, '/landlord/profile/edit'),
      ('Set your price per unit', d.landlord.unitPrice > 0, '/landlord/unit-price'),
      ('Add a payout bank account and schedule', d.landlord.bank != null, '/landlord/payout'),
      ('Add your first meter', d.meterCount > 0, '/landlord/meters/add'),
    ];
    final done = steps.where((s) => s.$2).length;
    if (done == steps.length) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: Space.lg),
      child: AppCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text('Finish setting up', style: SmeterText.title3())),
            Text('$done of ${steps.length}', style: SmeterText.caption()),
          ]),
          const SizedBox(height: Space.sm),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(value: done / steps.length, minHeight: 6, backgroundColor: SmeterColors.line),
          ),
          const SizedBox(height: Space.sm),
          for (final (label, ok, route) in steps)
            InkWell(
              onTap: ok ? null : () => context.push(route),
              borderRadius: BorderRadius.circular(Radii.sm),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: Space.sm),
                child: Row(children: [
                  Icon(ok ? Icons.check_circle_rounded : Icons.radio_button_unchecked_rounded,
                      color: ok ? SmeterColors.success : SmeterColors.muted, size: 22),
                  const SizedBox(width: Space.md),
                  Expanded(
                    child: Text(label,
                        style: ok
                            ? SmeterText.small().copyWith(decoration: TextDecoration.lineThrough)
                            : SmeterText.bodyStrong()),
                  ),
                  if (!ok) const Icon(Icons.chevron_right_rounded, color: SmeterColors.muted),
                ]),
              ),
            ),
        ]),
      ),
    );
  }
}

/// Row in the owner's payment lists: amount, meter, earnings, status.
class LandlordTransactionRow extends ConsumerWidget {
  const LandlordTransactionRow({super.key, required this.purchase});

  final Purchase purchase;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = purchase;
    final earn = p.landlordNet != null && p.status == 'vended' ? 'you earn ${naira(p.landlordNet)}' : null;
    return PurchaseRow(
      purchase: p,
      showToken: false,
      subtitlePrefix: ['Meter ${p.meterId}', ?earn].join(' · '),
      onTap: p.status == 'paid'
          ? () async {
              try {
                await ref.read(landlordRepositoryProvider).retryVend(p.reference);
                ref.invalidate(landlordDashboardProvider);
                ref.invalidate(transactionsProvider);
                if (context.mounted) showInfo(context, 'Token generation retried');
              } catch (e) {
                if (context.mounted) showError(context, e);
              }
            }
          : () => context.push('/landlord/meters/${p.meterId}'),
    );
  }
}
