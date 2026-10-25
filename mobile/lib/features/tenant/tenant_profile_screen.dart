import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/models.dart';
import '../../core/session.dart';
import '../../shared/widgets.dart';
import '../../theme/smeter_theme.dart';
import 'tenant_repository.dart';

class TenantProfileScreen extends ConsumerWidget {
  const TenantProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(tenantProfileProvider);
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: AsyncBody<TenantProfile>(
          value: profile,
          skeleton: const SkeletonList(rows: 4),
          onRefresh: () => ref.refresh(tenantProfileProvider.future),
          data: (t) => _ProfileBody(key: ValueKey(t.meterId), tenant: t),
        ),
      ),
    );
  }
}

class _ProfileBody extends ConsumerStatefulWidget {
  const _ProfileBody({super.key, required this.tenant});

  final TenantProfile tenant;

  @override
  ConsumerState<_ProfileBody> createState() => _ProfileBodyState();
}

class _ProfileBodyState extends ConsumerState<_ProfileBody> {
  late final _first = TextEditingController(text: widget.tenant.firstName ?? '');
  late final _last = TextEditingController(text: widget.tenant.lastName ?? '');
  late final _email = TextEditingController(text: widget.tenant.email ?? '');
  bool _dirty = false;

  @override
  void initState() {
    super.initState();
    for (final c in [_first, _last, _email]) {
      c.addListener(() {
        if (!_dirty) setState(() => _dirty = true);
      });
    }
  }

  @override
  void dispose() {
    for (final c in [_first, _last, _email]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    try {
      await ref.read(tenantRepositoryProvider).updateMe(
            firstName: _first.text.trim(),
            lastName: _last.text.trim(),
            email: _email.text.trim(),
          );
      ref.invalidate(tenantProfileProvider);
      ref.invalidate(tenantDashboardProvider);
      if (mounted) {
        setState(() => _dirty = false);
        showInfo(context, 'Profile saved');
      }
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _signOut() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text('You can sign back in any time with your meter number.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Sign out')),
        ],
      ),
    );
    if (ok == true) await ref.read(sessionProvider.notifier).signOut();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.tenant;
    return ListView(padding: const EdgeInsets.only(bottom: Space.xxxl), children: [
      const PageTitle('Profile'),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: Space.lg),
        child: MeterCard(meterId: t.meterId, address: t.address, apartment: t.apartment),
      ),
      const SectionHeader('Token delivery'),
      AppCard(
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: t.isManual ? SmeterColors.warnSoft : SmeterColors.infoSoft,
              borderRadius: BorderRadius.circular(Radii.sm),
            ),
            child: Icon(
              t.isManual ? Icons.dialpad_rounded : Icons.cell_tower_rounded,
              color: t.isManual ? SmeterColors.warn : SmeterColors.info,
            ),
          ),
          const SizedBox(width: Space.md),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(t.isManual ? 'Manual token' : 'Automatic (GPRS)', style: SmeterText.bodyStrong()),
              const SizedBox(height: 2),
              Text(
                t.isManual
                    ? 'After each purchase you get a 20-digit token to type into your meter remote.'
                    : 'Units are sent to your meter over the network after each purchase.',
                style: SmeterText.small(),
              ),
              const SizedBox(height: Space.sm),
              Text('Set by your property owner', style: SmeterText.caption()),
            ]),
          ),
        ]),
      ),
      const SectionHeader('Your details'),
      AppCard(
        child: Column(children: [
          Row(children: [
            Expanded(
              child: TextField(
                controller: _first,
                textCapitalization: TextCapitalization.words,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(labelText: 'First name'),
              ),
            ),
            const SizedBox(width: Space.md),
            Expanded(
              child: TextField(
                controller: _last,
                textCapitalization: TextCapitalization.words,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(labelText: 'Last name'),
              ),
            ),
          ]),
          const SizedBox(height: Space.md),
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: 'Email (for receipts)'),
          ),
          const SizedBox(height: Space.md),
          TextFormField(
            initialValue: t.phone,
            enabled: false,
            decoration: const InputDecoration(
              labelText: 'Phone',
              helperText: 'Login codes go here. Ask your property owner to change it.',
              suffixIcon: Icon(Icons.lock_outline_rounded, size: 18),
            ),
          ),
          AnimatedSize(
            duration: const Duration(milliseconds: 200),
            child: _dirty
                ? Padding(
                    padding: const EdgeInsets.only(top: Space.lg),
                    child: BusyButton(label: 'Save changes', onPressed: _save),
                  )
                : const SizedBox(width: double.infinity),
          ),
        ]),
      ),
      const SectionHeader('More'),
      AppCard(
        padding: const EdgeInsets.symmetric(vertical: Space.xs),
        child: Column(children: [
          _Row(icon: Icons.notifications_none_rounded, label: 'Notifications', onTap: () => context.push('/tenant/notifications')),
          const Divider(indent: 60),
          _Row(icon: Icons.support_agent_rounded, label: 'Help & support', onTap: () => context.push('/support')),
          if (t.landlordName != null) ...[
            const Divider(indent: 60),
            _Row(
              icon: Icons.home_work_outlined,
              label: 'Property owner',
              value: t.landlordName,
              onTap: t.landlordPhone == null
                  ? null
                  : () => copyText(context, t.landlordPhone!, 'Phone number'),
            ),
          ],
          const Divider(indent: 60),
          _Row(icon: Icons.logout_rounded, label: 'Sign out', danger: true, onTap: _signOut),
        ]),
      ),
    ]);
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.icon, required this.label, this.value, this.onTap, this.danger = false});

  final IconData icon;
  final String label;
  final String? value;
  final VoidCallback? onTap;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final color = danger ? SmeterColors.danger : SmeterColors.ink;
    return ListTile(
      onTap: onTap,
      leading: Icon(icon, color: danger ? SmeterColors.danger : SmeterColors.primary),
      title: Text(label, style: SmeterText.bodyStrong(color: color)),
      subtitle: value == null ? null : Text(value!),
      trailing: onTap == null || danger ? null : const Icon(Icons.chevron_right_rounded),
    );
  }
}

/// Salmon meter card from the Tenant Profile design.
class MeterCard extends StatelessWidget {
  const MeterCard({super.key, required this.meterId, required this.address, required this.apartment});

  final String meterId;
  final String address;
  final String apartment;

  @override
  Widget build(BuildContext context) {
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Radii.lg),
        gradient: const LinearGradient(
          colors: [Color(0xFFFFC2B9), SmeterColors.salmon, Color(0xFFF59A92)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: CustomPaint(
        painter: _ContourPainter(),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(Space.xl, Space.lg, Space.sm, Space.lg),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('METER NUMBER', style: SmeterText.overline(color: SmeterColors.navySoft)),
            Row(children: [
              Flexible(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(meterId, style: GoogleFonts.poppins(color: Colors.white, fontSize: 32, fontWeight: FontWeight.w700)),
                ),
              ),
              IconButton(
                tooltip: 'Copy meter number',
                icon: const Icon(Icons.copy_rounded, color: SmeterColors.primaryInk),
                onPressed: () => copyText(context, meterId, 'Meter number'),
              ),
            ]),
            Text(address, style: SmeterText.bodyStrong(color: SmeterColors.primaryInk)),
            if (apartment.isNotEmpty) Text('Apartment $apartment', style: SmeterText.small(color: SmeterColors.primaryInk)),
          ]),
        ),
      ),
    );
  }
}

class _ContourPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.8
      ..color = const Color(0x339D10A9);
    for (var i = 0; i < 7; i++) {
      final r = 30.0 + i * 16;
      canvas.drawOval(Rect.fromCenter(center: Offset(size.width * 0.85, size.height * 0.3), width: r * 1.8, height: r), paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
