import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/session.dart';
import '../../shared/widgets.dart';
import '../../theme/smeter_theme.dart';
import 'landlord_home_screen.dart' show LandlordTransactionRow;
import 'landlord_repository.dart';

// Payments list
class LandlordRecentsScreen extends ConsumerWidget {
  const LandlordRecentsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tx = ref.watch(transactionsProvider);
    final unread = ref.watch(landlordDashboardProvider).value?.unread ?? 0;
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          PageTitle(
            'Payments',
            subtitle: 'Purchases across all your meters',
            trailing: NotificationBell(unread: unread, onDark: false, onTap: () => context.push('/landlord/notifications')),
          ),
          Expanded(
            child: AsyncBody<List<Purchase>>(
              value: tx,
              skeleton: const SkeletonList(hero: false, rows: 7),
              onRefresh: () => ref.refresh(transactionsProvider.future),
              data: (list) {
                if (list.isEmpty) {
                  return ListView(children: const [
                    EmptyState(icon: Icons.receipt_long_outlined, title: 'No payments yet'),
                  ]);
                }
                final groups = groupByDay(list, (p) => p.vendedAt ?? p.createdAt);
                return ListView(padding: const EdgeInsets.only(bottom: Space.xxxl), children: [
                  for (final (label, items) in groups) ...[
                    DayHeader(label),
                    AppCard(
                      padding: const EdgeInsets.symmetric(vertical: Space.xs),
                      child: Column(children: [
                        for (final (i, p) in items.indexed) ...[
                          if (i > 0) const Divider(indent: 76),
                          LandlordTransactionRow(purchase: p),
                        ],
                      ]),
                    ),
                  ],
                ]);
              },
            ),
          ),
        ]),
      ),
    );
  }
}

// Profile
class LandlordProfileScreen extends ConsumerWidget {
  const LandlordProfileScreen({super.key});

  Future<void> _signOut(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign out?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Sign out')),
        ],
      ),
    );
    if (ok == true) await ref.read(sessionProvider.notifier).signOut();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(landlordProfileProvider);
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: AsyncBody<Landlord>(
          value: me,
          skeleton: const SkeletonList(rows: 4),
          onRefresh: () => ref.refresh(landlordProfileProvider.future),
          data: (l) => ListView(padding: const EdgeInsets.only(bottom: Space.xxxl), children: [
            const PageTitle('Profile'),
            AppCard(
              onTap: () => context.push('/landlord/profile/edit'),
              child: Row(children: [
                CircleAvatar(
                  radius: 28,
                  backgroundColor: SmeterColors.primarySoft,
                  child: Text(_initials(l.fullName), style: SmeterText.title3(color: SmeterColors.primary)),
                ),
                const SizedBox(width: Space.md),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(l.fullName, style: SmeterText.title3()),
                    Text(l.email, style: SmeterText.small()),
                    Text(l.phone, style: SmeterText.small()),
                  ]),
                ),
                const Icon(Icons.edit_outlined, color: SmeterColors.muted),
              ]),
            ),
            const SectionHeader('Payouts'),
            Padding(padding: const EdgeInsets.symmetric(horizontal: Space.lg), child: _PayoutCard(landlord: l)),
            const SectionHeader('Pricing'),
            AppCard(
              padding: const EdgeInsets.symmetric(vertical: Space.xs),
              child: Column(children: [
                _NavRow(
                  icon: Icons.sell_outlined,
                  label: 'Price per unit',
                  value: l.unitPrice > 0 ? '${naira(l.unitPrice)} per kWh' : 'Not set',
                  onTap: () => context.push('/landlord/unit-price'),
                ),
                const Divider(indent: 60),
                _FeeBearerRow(landlord: l),
                const Divider(indent: 60),
                _NavRow(
                  icon: Icons.insights_rounded,
                  label: 'Profit & markup ledger',
                  onTap: () => context.push('/landlord/ledger'),
                ),
              ]),
            ),
            const SectionHeader('More'),
            AppCard(
              padding: const EdgeInsets.symmetric(vertical: Space.xs),
              child: Column(children: [
                _NavRow(icon: Icons.notifications_none_rounded, label: 'Notifications', onTap: () => context.push('/landlord/notifications')),
                const Divider(indent: 60),
                _NavRow(icon: Icons.support_agent_rounded, label: 'Help & support', onTap: () => context.push('/support')),
                const Divider(indent: 60),
                _NavRow(icon: Icons.logout_rounded, label: 'Sign out', danger: true, onTap: () => _signOut(context, ref)),
              ]),
            ),
          ]),
        ),
      ),
    );
  }

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    return parts.take(2).map((p) => p[0].toUpperCase()).join();
  }
}

/// Peach "Payment Details" card from the Transfer design.
class _PayoutCard extends StatelessWidget {
  const _PayoutCard({required this.landlord});

  final Landlord landlord;

  @override
  Widget build(BuildContext context) {
    final b = landlord.bank;
    return Container(
      padding: const EdgeInsets.fromLTRB(Space.xl, Space.lg, Space.sm, Space.lg),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(Radii.lg),
        gradient: const LinearGradient(colors: [Color(0xFFFCEBD0), SmeterColors.peach], begin: Alignment.topLeft, end: Alignment.bottomRight),
      ),
      child: b == null
          ? Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('No payout account yet', style: SmeterText.title3()),
              const SizedBox(height: Space.xs),
              Text('Add the bank account your tenants’ payments should settle into.',
                  style: SmeterText.small(color: SmeterColors.inkSoft)),
              const SizedBox(height: Space.md),
              FilledButton.icon(
                onPressed: () => context.push('/landlord/payout'),
                icon: const Icon(Icons.add_rounded),
                label: const Text('Add bank account'),
              ),
            ])
          : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text('PAYMENT DETAILS', style: SmeterText.overline(color: SmeterColors.inkSoft))),
                TextButton(onPressed: () => context.push('/landlord/payout'), child: const Text('Change')),
              ]),
              Row(children: [
                Text(b.accountNumber, style: GoogleFonts.poppins(fontSize: 28, fontWeight: FontWeight.w800, color: SmeterColors.primary)),
                IconButton(
                  tooltip: 'Copy account number',
                  icon: const Icon(Icons.copy_rounded, color: SmeterColors.primary),
                  onPressed: () => copyText(context, b.accountNumber, 'Account number'),
                ),
              ]),
              Text(b.bankName, style: SmeterText.bodyStrong()),
              Text(b.accountName, style: SmeterText.small(color: SmeterColors.inkSoft)),
              const SizedBox(height: Space.sm),
              Pill(
                b.settlementActive ? 'Verified · automatic payouts' : (b.verified ? 'Verified' : 'Pending verification'),
                tone: b.verified ? Tone.success : Tone.warn,
                icon: b.verified ? Icons.verified_rounded : Icons.pending_outlined,
              ),
            ]),
    );
  }
}

class _NavRow extends StatelessWidget {
  const _NavRow({required this.icon, required this.label, this.value, required this.onTap, this.danger = false});

  final IconData icon;
  final String label;
  final String? value;
  final VoidCallback onTap;
  final bool danger;

  @override
  Widget build(BuildContext context) => ListTile(
        onTap: onTap,
        leading: Icon(icon, color: danger ? SmeterColors.danger : SmeterColors.primary),
        title: Text(label, style: SmeterText.bodyStrong(color: danger ? SmeterColors.danger : SmeterColors.ink)),
        subtitle: value == null ? null : Text(value!),
        trailing: danger ? null : const Icon(Icons.chevron_right_rounded),
      );
}

class _FeeBearerRow extends ConsumerWidget {
  const _FeeBearerRow({required this.landlord});

  final Landlord landlord;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tenantPays = landlord.feeBearer == 'tenant';
    return SwitchListTile(
      secondary: const Icon(Icons.receipt_outlined, color: SmeterColors.primary),
      title: Text('Tenants pay the service fee', style: SmeterText.bodyStrong()),
      subtitle: Text(tenantPays ? 'Added to the tenant’s total at checkout' : 'Taken from your earnings instead'),
      value: tenantPays,
      onChanged: (v) async {
        try {
          await ref.read(landlordRepositoryProvider).setFeeBearer(v ? 'tenant' : 'landlord');
          ref.invalidate(landlordProfileProvider);
          ref.invalidate(landlordDashboardProvider);
        } catch (e) {
          if (context.mounted) showError(context, e);
        }
      },
    );
  }
}

class EditLandlordProfileScreen extends ConsumerStatefulWidget {
  const EditLandlordProfileScreen({super.key});

  @override
  ConsumerState<EditLandlordProfileScreen> createState() => _EditLandlordProfileScreenState();
}

class _EditLandlordProfileScreenState extends ConsumerState<EditLandlordProfileScreen> {
  final _name = TextEditingController();
  final _address = TextEditingController();
  bool _loaded = false;

  @override
  void dispose() {
    _name.dispose();
    _address.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    try {
      await ref.read(landlordRepositoryProvider).updateMe(fullName: _name.text.trim(), address: _address.text.trim());
      ref.invalidate(landlordProfileProvider);
      ref.invalidate(landlordDashboardProvider);
      if (mounted) context.pop();
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(landlordProfileProvider).value;
    if (me != null && !_loaded) {
      _name.text = me.fullName;
      _address.text = me.address ?? '';
      _loaded = true;
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Edit profile')),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(Space.lg, Space.sm, Space.lg, Space.lg),
        child: BusyButton(label: 'Save', onPressed: _save),
      ),
      body: ListView(padding: const EdgeInsets.all(Space.lg), children: [
        TextField(
          controller: _name,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(
            labelText: 'Full name',
            helperText: 'Your payout bank account must be in this name',
          ),
        ),
        const SizedBox(height: Space.lg),
        TextField(
          controller: _address,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(
            labelText: 'Property address',
            helperText: 'Where your meters are. New meters start with this address.',
          ),
        ),
      ]),
    );
  }
}

// Unit price
class SetUnitPriceScreen extends ConsumerStatefulWidget {
  const SetUnitPriceScreen({super.key});

  @override
  ConsumerState<SetUnitPriceScreen> createState() => _SetUnitPriceScreenState();
}

class _SetUnitPriceScreenState extends ConsumerState<SetUnitPriceScreen> {
  final _price = TextEditingController();
  bool _loaded = false;

  @override
  void dispose() {
    _price.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final v = double.tryParse(_price.text);
    if (v == null || v <= 0) {
      showError(context, ApiException('Enter a price per unit'));
      return;
    }
    try {
      await ref.read(landlordRepositoryProvider).setUnitPrice(v);
      ref.invalidate(landlordProfileProvider);
      ref.invalidate(landlordDashboardProvider);
      if (!mounted) return;
      showInfo(context, 'Price updated. Tenants have been notified.');
      context.pop();
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(landlordProfileProvider).value;
    if (me != null && !_loaded) {
      if (me.unitPrice > 0) _price.text = me.unitPrice.toStringAsFixed(2);
      _loaded = true;
    }
    final price = double.tryParse(_price.text);
    final markup = me != null && price != null ? price - me.baseCost : null;
    final tooHigh = me != null && price != null && price > me.maxUnitPrice;
    final tooLow = me != null && price != null && price < me.baseCost;
    return Scaffold(
      appBar: AppBar(title: const Text('Price per unit')),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(Space.lg, Space.sm, Space.lg, Space.lg),
        child: BusyButton(label: 'Set price', onPressed: tooHigh || tooLow ? null : _save),
      ),
      body: ListView(padding: const EdgeInsets.all(Space.lg), children: [
        Text('What your tenants pay for each kWh. Changes apply from their next purchase.', style: SmeterText.small()),
        const SizedBox(height: Space.xxxl),
        Text('1 kWh costs', textAlign: TextAlign.center, style: SmeterText.title3(color: SmeterColors.inkSoft)),
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text('₦', style: SmeterText.figure(44, color: SmeterColors.primary)),
          IntrinsicWidth(
            child: TextField(
              controller: _price,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'^\d*\.?\d{0,2}'))],
              onChanged: (_) => setState(() {}),
              style: SmeterText.figure(44, color: SmeterColors.primary),
              decoration: InputDecoration(
                hintText: '0.00',
                hintStyle: SmeterText.figure(44, color: SmeterColors.line),
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                filled: false,
                isDense: true,
                contentPadding: const EdgeInsets.symmetric(horizontal: 4),
              ),
            ),
          ),
        ]),
        const SizedBox(height: Space.lg),
        if (me != null)
          AppCard(
            margin: EdgeInsets.zero,
            child: Column(children: [
              KeyValueRow('Utility cost', '${naira(me.baseCost)} / kWh'),
              KeyValueRow('Regulated maximum', '${naira(me.maxUnitPrice)} / kWh'),
              const Divider(),
              KeyValueRow(
                'You earn per kWh',
                tooLow ? 'Below cost' : (markup == null ? '-' : naira(markup)),
                strong: true,
                valueColor: tooLow ? SmeterColors.danger : SmeterColors.success,
              ),
            ]),
          ),
        if (tooHigh)
          InfoBanner(
            icon: Icons.gavel_rounded,
            tone: Tone.danger,
            text: 'That’s above the regulated maximum of ${naira(me.maxUnitPrice)} per kWh.',
          ),
      ]),
    );
  }
}

// Payout account
/// SM-ONB-001: bank → account number → name verification → emailed code → save.
class PayoutAccountScreen extends ConsumerStatefulWidget {
  const PayoutAccountScreen({super.key});

  @override
  ConsumerState<PayoutAccountScreen> createState() => _PayoutAccountScreenState();
}

class _PayoutAccountScreenState extends ConsumerState<PayoutAccountScreen> {
  Bank? _bank;
  final _account = TextEditingController();
  final _code = TextEditingController();
  String? _resolvedName;
  bool? _matches;
  String? _sentTo;
  bool _resolving = false;

  @override
  void dispose() {
    _account.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _resolve() async {
    if (_bank == null || _account.text.length != 10) return;
    setState(() {
      _resolving = true;
      _resolvedName = null;
    });
    try {
      final r = await ref.read(landlordRepositoryProvider).resolveBank(_bank!.code, _bank!.name, _account.text);
      setState(() {
        _resolvedName = r.accountName;
        _matches = r.matches;
      });
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _resolving = false);
    }
  }

  Future<void> _request() async {
    try {
      final r = await ref.read(landlordRepositoryProvider).requestBankChange(_bank!.code, _bank!.name, _account.text);
      if (r.devCode != null) _code.text = r.devCode!;
      setState(() => _sentTo = r.sentTo);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _confirm() async {
    try {
      await ref.read(landlordRepositoryProvider).confirmBankChange(_code.text.trim());
      ref.invalidate(landlordProfileProvider);
      ref.invalidate(landlordDashboardProvider);
      if (!mounted) return;
      showInfo(context, 'Payout account saved');
      context.pop();
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final banks = ref.watch(banksProvider);
    final verifying = _sentTo != null;
    return Scaffold(
      appBar: AppBar(title: const Text('Payout account')),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(Space.lg, Space.sm, Space.lg, Space.lg),
        child: verifying
            ? BusyButton(label: 'Confirm', onPressed: _confirm)
            : BusyButton(label: 'Continue', onPressed: (_matches ?? false) ? _request : null),
      ),
      body: ListView(padding: const EdgeInsets.all(Space.lg), children: [
        if (!verifying) ...[
          const PayoutScheduleCard(),
          const SizedBox(height: Space.xl),
          Text(
            ref.watch(landlordProfileProvider).value?.bank == null ? 'Bank account' : 'Change bank account',
            style: SmeterText.title3(),
          ),
          const SizedBox(height: Space.xs),
          Text('Your share of each payment is paid into this account. It must be in your name.', style: SmeterText.small()),
          const SizedBox(height: Space.xl),
          banks.when(
            data: (list) => DropdownButtonFormField<Bank>(
              initialValue: _bank,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Bank'),
              items: [for (final b in list) DropdownMenuItem(value: b, child: Text(b.name))],
              onChanged: (b) {
                setState(() => _bank = b);
                _resolve();
              },
            ),
            loading: () => const LinearProgressIndicator(),
            error: (e, _) => Text('$e', style: SmeterText.small(color: SmeterColors.danger)),
          ),
          const SizedBox(height: Space.lg),
          TextField(
            controller: _account,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
            decoration: InputDecoration(
              labelText: 'Account number',
              helperText: '10 digits',
              suffixIcon: _resolving
                  ? const Padding(padding: EdgeInsets.all(14), child: CircularProgressIndicator(strokeWidth: 2))
                  : null,
            ),
            onChanged: (v) {
              setState(() => _resolvedName = null);
              if (v.length == 10) _resolve();
            },
          ),
          if (_resolvedName != null)
            InfoBanner(
              icon: (_matches ?? false) ? Icons.verified_rounded : Icons.error_outline_rounded,
              tone: (_matches ?? false) ? Tone.success : Tone.danger,
              title: _resolvedName,
              text: (_matches ?? false)
                  ? 'Name matches your profile.'
                  : 'This doesn’t match your profile name. Use an account in your own name.',
            ),
        ] else ...[
          Text('Confirm it’s you', style: SmeterText.title2()),
          const SizedBox(height: Space.xs),
          Text('Enter the 6-digit code we sent to $_sentTo.', style: SmeterText.small()),
          const SizedBox(height: Space.xl),
          OtpField(controller: _code, onCompleted: (_) => _confirm()),
          const SizedBox(height: Space.md),
          Center(child: TextButton(onPressed: _request, child: const Text('Resend code'))),
        ],
      ]),
    );
  }
}

/// How often the owner's share is paid out; saved straight away.
class PayoutScheduleCard extends ConsumerStatefulWidget {
  const PayoutScheduleCard({super.key});

  @override
  ConsumerState<PayoutScheduleCard> createState() => _PayoutScheduleCardState();
}

class _PayoutScheduleCardState extends ConsumerState<PayoutScheduleCard> {
  String? _saving;

  static const _options = [
    ('daily', 'Daily', 'Every working day'),
    ('weekly', 'Weekly', 'Once a week'),
    ('monthly', 'Monthly', 'Once a month'),
  ];

  Future<void> _set(String schedule) async {
    setState(() => _saving = schedule);
    try {
      await ref.read(landlordRepositoryProvider).setPayoutSchedule(schedule);
      ref.invalidate(landlordProfileProvider);
      ref.invalidate(landlordDashboardProvider);
      if (mounted) showInfo(context, 'Payout schedule saved');
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _saving = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(landlordProfileProvider).value;
    final current = me?.payoutSchedule ?? 'daily';
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('How often you’re paid', style: SmeterText.title3()),
        const SizedBox(height: Space.xs),
        Text('Your share of tenant payments is collected and sent to your bank on this schedule.', style: SmeterText.small()),
        const SizedBox(height: Space.md),
        RadioGroup<String>(
          groupValue: current,
          onChanged: (v) {
            if (me != null && _saving == null && v != null && v != current) _set(v);
          },
          child: Column(children: [
            for (final (value, label, hint) in _options)
              RadioListTile<String>(
                value: value,
                enabled: me != null && _saving == null,
                contentPadding: EdgeInsets.zero,
                title: Text(label, style: SmeterText.bodyStrong()),
                subtitle: Text(hint),
                secondary: _saving == value
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : null,
              ),
          ]),
        ),
      ]),
    );
  }
}

// Ledger
class LedgerScreen extends ConsumerWidget {
  const LedgerScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ledger = ref.watch(ledgerProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Profit & markup')),
      body: AsyncBody<Ledger>(
        value: ledger,
        skeleton: const SkeletonList(rows: 3),
        onRefresh: () => ref.refresh(ledgerProvider.future),
        data: (l) => ListView(padding: const EdgeInsets.only(bottom: Space.xxxl), children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(Space.xl, Space.sm, Space.xl, Space.sm),
            child: Text('Last 30 days', style: SmeterText.small()),
          ),
          _LedgerCard(title: 'All meters', line: l.totals, highlight: true),
          if (l.meters.isEmpty)
            const EmptyState(icon: Icons.insights_rounded, title: 'No sales in this period')
          else ...[
            const SectionHeader('By meter'),
            for (final m in l.meters) _LedgerCard(title: 'Meter ${m.meterId}', line: m),
          ],
        ]),
      ),
    );
  }
}

class _LedgerCard extends StatelessWidget {
  const _LedgerCard({required this.title, required this.line, this.highlight = false});

  final String title;
  final LedgerLine line;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: Space.md),
      child: AppCard(
        color: highlight ? SmeterColors.primaryTint : SmeterColors.surface,
        borderColor: highlight ? SmeterColors.primarySoft : SmeterColors.line,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Text(title, style: SmeterText.title3())),
            Text(naira(line.net), style: SmeterText.figure(18, color: SmeterColors.primary)),
          ]),
          Text('${line.purchases} purchases · ${units(line.units)} kWh', style: SmeterText.caption()),
          const SizedBox(height: Space.sm),
          const Divider(),
          KeyValueRow('Collected', naira(line.collected)),
          KeyValueRow('Utility cost', '− ${naira(line.baseUtilityCost)}'),
          KeyValueRow('Your markup', naira(line.markup), valueColor: SmeterColors.success),
          if (line.debtRecovered > 0) KeyValueRow('Debt recovered', naira(line.debtRecovered)),
          KeyValueRow('Payment fees', naira(line.fees)),
        ]),
      ),
    );
  }
}
