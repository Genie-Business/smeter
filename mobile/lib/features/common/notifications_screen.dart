import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/session.dart';
import '../../shared/widgets.dart';
import '../../theme/smeter_theme.dart';
import '../landlord/landlord_repository.dart';
import '../tenant/tenant_repository.dart';

class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  bool get _tenant => ref.read(sessionProvider).role == Role.tenant;

  @override
  void initState() {
    super.initState();
    // Opening the list marks everything read; badges refresh on return.
    Future.microtask(() async {
      try {
        if (_tenant) {
          await ref.read(tenantRepositoryProvider).markNotificationsRead();
          ref.invalidate(tenantDashboardProvider);
        } else {
          await ref.read(landlordRepositoryProvider).markNotificationsRead();
          ref.invalidate(landlordDashboardProvider);
        }
      } catch (_) {
        /* badge just stays until next refresh */
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final tenant = ref.watch(sessionProvider).role == Role.tenant;
    final provider = tenant ? tenantNotificationsProvider : landlordNotificationsProvider;
    final value = ref.watch(provider);
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: AsyncBody<List<AppNotification>>(
        value: value,
        skeleton: const SkeletonList(hero: false),
        onRefresh: () => ref.refresh(provider.future),
        data: (list) {
          if (list.isEmpty) {
            return ListView(children: const [
              EmptyState(
                icon: Icons.notifications_none_rounded,
                title: "You're all caught up",
                message: 'Payments, tokens and meter alerts will show up here.',
              ),
            ]);
          }
          final groups = groupByDay(list, (n) => n.createdAt);
          return ListView(padding: const EdgeInsets.only(bottom: Space.xxxl), children: [
            for (final (label, items) in groups) ...[
              DayHeader(label),
              AppCard(
                padding: const EdgeInsets.symmetric(vertical: Space.xs),
                child: Column(children: [
                  for (final (i, n) in items.indexed) ...[
                    if (i > 0) const Divider(indent: 72),
                    _NotificationTile(n: n),
                  ],
                ]),
              ),
            ],
          ]);
        },
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({required this.n});

  final AppNotification n;

  @override
  Widget build(BuildContext context) {
    final (icon, tone) = switch (n.kind) {
      'vended' || 'payment' => (Icons.bolt_rounded, Tone.success),
      'vend_failed' || 'audit' => (Icons.report_gmailerrorred_rounded, Tone.warn),
      'meter_event' || 'relay' => (Icons.warning_amber_rounded, Tone.danger),
      'security' => (Icons.shield_outlined, Tone.info),
      'mode' => (Icons.swap_horiz_rounded, Tone.info),
      'service' => (Icons.cell_tower_rounded, Tone.brand),
      'tariff' => (Icons.sell_outlined, Tone.brand),
      'tenant_joined' => (Icons.person_add_alt_rounded, Tone.success),
      _ => (Icons.notifications_none_rounded, Tone.brand),
    };
    final (fg, bg) = toneColors(tone);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.md),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
          child: Icon(icon, color: fg, size: 20),
        ),
        const SizedBox(width: Space.md),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(
                child: Text(n.title, style: n.read ? SmeterText.bodyStrong(color: SmeterColors.inkSoft) : SmeterText.bodyStrong()),
              ),
              if (!n.read)
                Container(
                  width: 8,
                  height: 8,
                  decoration: const BoxDecoration(color: SmeterColors.primary, shape: BoxShape.circle),
                ),
            ]),
            const SizedBox(height: 2),
            Text(n.body, style: SmeterText.small()),
            const SizedBox(height: 4),
            Text(timeOfDay(n.createdAt), style: SmeterText.caption()),
          ]),
        ),
      ]),
    );
  }
}
