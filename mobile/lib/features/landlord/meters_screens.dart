import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../shared/widgets.dart';
import '../../theme/smeter_theme.dart';
import '../tenant/tenant_profile_screen.dart' show MeterCard;
import 'landlord_actions.dart';
import 'landlord_home_screen.dart' show LandlordTransactionRow;
import 'landlord_repository.dart';

// List
class MetersScreen extends ConsumerStatefulWidget {
  const MetersScreen({super.key});

  @override
  ConsumerState<MetersScreen> createState() => _MetersScreenState();
}

class _MetersScreenState extends ConsumerState<MetersScreen> {
  String _filter = 'all';
  String _query = '';

  bool _matches(Meter m) {
    final q = _query.toLowerCase();
    final inQuery = q.isEmpty ||
        m.meterId.contains(q) ||
        m.tenantName.toLowerCase().contains(q) ||
        m.address.toLowerCase().contains(q) ||
        m.apartment.toLowerCase().contains(q);
    final inFilter = switch (_filter) {
      'active' => m.status == 'active',
      'invited' => m.status == 'invited',
      'manual' => m.isManual,
      _ => true,
    };
    return inQuery && inFilter;
  }

  @override
  Widget build(BuildContext context) {
    final meters = ref.watch(metersProvider);
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => context.push('/landlord/meters/add'),
        icon: const Icon(Icons.add_rounded),
        label: const Text('Add meter'),
      ),
      body: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          PageTitle('Meters', subtitle: meters.value == null ? null : '${meters.value!.length} on your account'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Space.lg),
            child: TextField(
              onChanged: (v) => setState(() => _query = v.trim()),
              decoration: const InputDecoration(
                hintText: 'Search tenant, apartment or meter number',
                prefixIcon: Icon(Icons.search_rounded),
              ),
            ),
          ),
          SizedBox(
            height: 56,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.sm),
              children: [
                for (final (id, label) in [('all', 'All'), ('active', 'Active'), ('invited', 'Invited'), ('manual', 'Manual token')])
                  Padding(
                    padding: const EdgeInsets.only(right: Space.sm),
                    child: ChoiceChip(
                      label: Text(label),
                      selected: _filter == id,
                      showCheckmark: false,
                      selectedColor: SmeterColors.primarySoft,
                      labelStyle: SmeterText.caption(color: _filter == id ? SmeterColors.primary : SmeterColors.inkSoft),
                      onSelected: (_) => setState(() => _filter = id),
                    ),
                  ),
              ],
            ),
          ),
          Expanded(
            child: AsyncBody<List<Meter>>(
              value: meters,
              skeleton: const SkeletonList(hero: false),
              onRefresh: () => ref.refresh(metersProvider.future),
              data: (list) {
                if (list.isEmpty) {
                  return ListView(children: const [
                    EmptyState(
                      icon: Icons.electric_meter_outlined,
                      title: 'No meters yet',
                      message: "Add a meter with your tenant's phone number. They'll get a text to connect.",
                    ),
                  ]);
                }
                final shown = list.where(_matches).toList();
                if (shown.isEmpty) {
                  return ListView(children: const [
                    EmptyState(icon: Icons.search_off_rounded, title: 'No matching meters'),
                  ]);
                }
                return ListView.separated(
                  padding: const EdgeInsets.only(bottom: 96, top: Space.xs),
                  itemCount: shown.length,
                  separatorBuilder: (_, _) => const SizedBox(height: Space.sm),
                  itemBuilder: (_, i) => _MeterCardRow(meter: shown[i]),
                );
              },
            ),
          ),
        ]),
      ),
    );
  }
}

class _MeterCardRow extends StatelessWidget {
  const _MeterCardRow({required this.meter});

  final Meter meter;

  @override
  Widget build(BuildContext context) {
    final m = meter;
    final (statusLabel, statusTone) = m.status == 'invited'
        ? ('Invited', Tone.warn)
        : m.isOff
            ? ('Supply off', Tone.danger)
            : ('Active', Tone.success);
    return AppCard(
      onTap: () => context.push('/landlord/meters/${m.meterId}'),
      child: Row(children: [
        Container(
          width: 48,
          height: 48,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: SmeterColors.primarySoft, borderRadius: BorderRadius.circular(Radii.md)),
          child: Text(m.apartment.isEmpty ? '#' : m.apartment,
              style: SmeterText.title3(color: SmeterColors.primary), maxLines: 1, overflow: TextOverflow.clip),
        ),
        const SizedBox(width: Space.md),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(m.tenantName, style: SmeterText.bodyStrong()),
            Text('Meter ${m.meterId}', style: SmeterText.caption()),
            const SizedBox(height: Space.sm),
            Wrap(spacing: 6, runSpacing: 6, children: [
              Pill(statusLabel, tone: statusTone),
              ModeBadge(m.deliveryMode),
              if (m.debt > 0) Pill('Owes ${naira(m.debt, whole: true)}', tone: Tone.warn),
            ]),
          ]),
        ),
        const Icon(Icons.chevron_right_rounded, color: SmeterColors.muted),
      ]),
    );
  }
}

/// One option in a single-choice list of cards.
class ChoiceTile extends StatelessWidget {
  const ChoiceTile({
    super.key,
    required this.selected,
    required this.icon,
    required this.title,
    required this.body,
    required this.onTap,
  });

  final bool selected;
  final IconData icon;
  final String title;
  final String body;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
        selected: selected,
        inMutuallyExclusiveGroup: true,
        button: true,
        child: InkWell(
          onTap: () {
            HapticFeedback.selectionClick();
            onTap();
          },
          borderRadius: BorderRadius.circular(Radii.md),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 160),
            padding: const EdgeInsets.all(Space.md),
            decoration: BoxDecoration(
              color: selected ? SmeterColors.primaryTint : SmeterColors.surface,
              borderRadius: BorderRadius.circular(Radii.md),
              border: Border.all(color: selected ? SmeterColors.primary : SmeterColors.line, width: selected ? 1.6 : 1),
            ),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Icon(icon, color: selected ? SmeterColors.primary : SmeterColors.inkSoft),
              const SizedBox(width: Space.md),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(title, style: SmeterText.bodyStrong()),
                  const SizedBox(height: 2),
                  Text(body, style: SmeterText.small()),
                ]),
              ),
              Icon(selected ? Icons.radio_button_checked_rounded : Icons.radio_button_off_rounded,
                  color: selected ? SmeterColors.primary : SmeterColors.muted),
            ]),
          ),
        ),
      );
}

// Delivery mode picker
class DeliveryModePicker extends StatelessWidget {
  const DeliveryModePicker({super.key, required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) => Column(children: [
        ChoiceTile(
          selected: value == 'ota',
          icon: Icons.cell_tower_rounded,
          title: 'Automatic (GPRS)',
          body: 'Units are sent to the meter over the network. Enables live readings, usage and remote disconnect. '
              'Has a monthly service charge for the network link.',
          onTap: () => onChanged('ota'),
        ),
        const SizedBox(height: Space.sm),
        ChoiceTile(
          selected: value == 'manual',
          icon: Icons.dialpad_rounded,
          title: 'Manual token',
          body: 'No network link. The tenant gets a token after each purchase and types it into the meter remote.',
          onTap: () => onChanged('manual'),
        ),
      ]);
}

// Who pays the GPRS service charge
class ServicePayerPicker extends StatelessWidget {
  const ServicePayerPicker({super.key, required this.value, required this.feeText, required this.onChanged});

  final String value;

  /// e.g. "₦1,500 a month"
  final String feeText;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('The GPRS service charge ($feeText) keeps the meter online.', style: SmeterText.small()),
        const SizedBox(height: Space.md),
        ChoiceTile(
          selected: value == 'owner',
          icon: Icons.home_work_outlined,
          title: servicePayerLabels['owner']!,
          body: "Deducted from your share of your tenant's power purchases. Your tenant pays nothing extra.",
          onTap: () => onChanged('owner'),
        ),
        const SizedBox(height: Space.sm),
        ChoiceTile(
          selected: value == 'tenant_monthly',
          icon: Icons.calendar_month_outlined,
          title: servicePayerLabels['tenant_monthly']!,
          body: "Your tenant pays it each month in the app. If they don't, it is added to their next purchase.",
          onTap: () => onChanged('tenant_monthly'),
        ),
        const SizedBox(height: Space.sm),
        ChoiceTile(
          selected: value == 'tenant_per_purchase',
          icon: Icons.bolt_rounded,
          title: servicePayerLabels['tenant_per_purchase']!,
          body: "Each purchase includes the service charge for the days its units should last, based on the meter's usage.",
          onTap: () => onChanged('tenant_per_purchase'),
        ),
      ]);
}

/// "₦1,500 a month", or both rates while the meter's phase isn't known yet.
String _feeText(Landlord? l, bool? threePhase) {
  if (l == null) return 'a monthly fee';
  if (threePhase == null && l.gprsFeeThreePhase != l.gprsFeeSinglePhase) {
    return '${naira(l.gprsFeeSinglePhase, whole: true)} a month, ${naira(l.gprsFeeThreePhase, whole: true)} for three-phase';
  }
  return '${naira(threePhase == true ? l.gprsFeeThreePhase : l.gprsFeeSinglePhase, whole: true)} a month';
}

// Add
class AddMeterScreen extends ConsumerStatefulWidget {
  const AddMeterScreen({super.key});

  @override
  ConsumerState<AddMeterScreen> createState() => _AddMeterScreenState();
}

class _AddMeterScreenState extends ConsumerState<AddMeterScreen> {
  final _form = GlobalKey<FormState>();
  final _meter = TextEditingController();
  final _address = TextEditingController();
  final _apartment = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _first = TextEditingController();
  final _last = TextEditingController();
  final _debt = TextEditingController();
  final _percent = TextEditingController(text: '10');
  String _mode = 'ota';
  String _servicePayer = 'owner';
  bool _recoverDebt = false;
  MeterCheck? _check;
  String? _checkedId;
  bool _checking = false;
  bool _prefilled = false;

  /// Look the number up on the metering platform (also offered as a button).
  Future<void> _checkMeter() async {
    final id = _meter.text.trim();
    if (id.length < 6) {
      showError(context, ApiException('Enter the meter serial number first'));
      return;
    }
    setState(() => _checking = true);
    try {
      final c = await ref.read(landlordRepositoryProvider).checkMeter(id);
      if (mounted) {
        setState(() {
          _check = c;
          _checkedId = id;
        });
      }
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  @override
  void dispose() {
    for (final c in [_meter, _address, _apartment, _phone, _email, _first, _last, _debt, _percent]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    try {
      final m = await ref.read(landlordRepositoryProvider).addMeter({
        'meterId': _meter.text.trim(),
        'address': _address.text.trim(),
        'apartment': _apartment.text.trim(),
        'tenantPhone': _phone.text.trim(),
        'tenantEmail': _email.text.trim(),
        'deliveryMode': _mode,
        if (_mode == 'ota') 'servicePayer': _servicePayer,
        if (_first.text.trim().isNotEmpty) 'tenantFirstName': _first.text.trim(),
        if (_last.text.trim().isNotEmpty) 'tenantLastName': _last.text.trim(),
        if (_recoverDebt) 'debtAmount': double.tryParse(_debt.text) ?? 0,
        if (_recoverDebt) 'debtRecoveryPercent': double.tryParse(_percent.text) ?? 0,
      });
      ref.invalidate(metersProvider);
      ref.invalidate(landlordDashboardProvider);
      if (!mounted) return;
      showInfo(context, 'Meter added. We emailed your tenant to connect.');
      context.pushReplacement('/landlord/meters/${m.meterId}');
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    // Start the address from the owner's property address.
    final owner = ref.watch(landlordProfileProvider).value;
    if (!_prefilled && owner != null) {
      _prefilled = true;
      if (_address.text.isEmpty && (owner.address ?? '').isNotEmpty) _address.text = owner.address!;
    }
    final check = _checkedId == _meter.text.trim() ? _check : null;
    return Scaffold(
      appBar: AppBar(title: const Text('Add a meter')),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(Space.lg, Space.sm, Space.lg, Space.lg),
        child: BusyButton(label: 'Add meter', icon: Icons.add_rounded, onPressed: _submit),
      ),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.only(bottom: Space.xxxl), children: [
          const SectionHeader('Meter'),
          AppCard(
            child: Column(children: [
              TextFormField(
                controller: _meter,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(20)],
                decoration: InputDecoration(
                  labelText: 'Meter number',
                  helperText: 'The serial number printed on the meter',
                  suffixIcon: _checking
                      ? const Padding(padding: EdgeInsets.all(14), child: CircularProgressIndicator(strokeWidth: 2))
                      : TextButton(onPressed: _checkMeter, child: const Text('Check')),
                ),
                onChanged: (_) => setState(() {}),
                validator: (v) => (v ?? '').length < 6 ? 'Enter the meter serial number' : null,
              ),
              if (check != null)
                InfoBanner(
                  icon: check.available ? Icons.verified_rounded : Icons.error_outline_rounded,
                  tone: check.available ? Tone.success : Tone.danger,
                  title: check.available ? 'Verified with the metering platform' : 'Can’t add this meter',
                  text: check.message,
                ),
              const SizedBox(height: Space.md),
              TextFormField(
                controller: _address,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(labelText: 'Property address'),
                validator: (v) => (v ?? '').trim().length < 3 ? 'Enter the property address' : null,
              ),
              const SizedBox(height: Space.md),
              TextFormField(
                controller: _apartment,
                decoration: const InputDecoration(labelText: 'Apartment (optional)', hintText: 'e.g. 1, 2B, Flat 4'),
              ),
            ]),
          ),
          const SectionHeader('How do tokens reach this meter?'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Space.lg),
            child: DeliveryModePicker(value: _mode, onChanged: (v) => setState(() => _mode = v)),
          ),
          if (_mode == 'ota') ...[
            const SectionHeader('Who pays the service charge?'),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Space.lg),
              child: ServicePayerPicker(
                value: _servicePayer,
                feeText: _feeText(ref.watch(landlordProfileProvider).value, _check?.threePhase),
                onChanged: (v) => setState(() => _servicePayer = v),
              ),
            ),
          ],
          const SectionHeader('Tenant'),
          AppCard(
            child: Column(children: [
              TextFormField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                autocorrect: false,
                decoration: const InputDecoration(
                  labelText: "Tenant's email",
                  helperText: 'Login codes and the invite go to this address',
                ),
                validator: (v) => validEmail(v) ? null : "Enter the tenant's email address",
              ),
              const SizedBox(height: Space.md),
              TextFormField(
                controller: _phone,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: "Tenant's phone number"),
                validator: (v) => (v ?? '').replaceAll(RegExp(r'\D'), '').length < 10 ? "Enter the tenant's phone number" : null,
              ),
              const SizedBox(height: Space.md),
              Row(children: [
                Expanded(
                  child: TextFormField(
                    controller: _first,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(labelText: 'First name'),
                  ),
                ),
                const SizedBox(width: Space.md),
                Expanded(
                  child: TextFormField(
                    controller: _last,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(labelText: 'Last name'),
                  ),
                ),
              ]),
            ]),
          ),
          const SectionHeader('Debt recovery'),
          AppCard(
            child: Column(children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _recoverDebt,
                onChanged: (v) => setState(() => _recoverDebt = v),
                title: Text('Recover an outstanding debt', style: SmeterText.bodyStrong()),
                subtitle: const Text('Take a share of every purchase until it is cleared'),
              ),
              AnimatedSize(
                duration: const Duration(milliseconds: 200),
                child: !_recoverDebt
                    ? const SizedBox(width: double.infinity)
                    : Padding(
                        padding: const EdgeInsets.only(top: Space.md),
                        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Expanded(
                            child: TextFormField(
                              controller: _debt,
                              keyboardType: const TextInputType.numberWithOptions(decimal: true),
                              decoration: const InputDecoration(labelText: 'Amount owed', prefixText: '₦ '),
                              validator: (v) =>
                                  _recoverDebt && (double.tryParse(v ?? '') ?? 0) <= 0 ? 'Enter the amount owed' : null,
                            ),
                          ),
                          const SizedBox(width: Space.md),
                          SizedBox(
                            width: 120,
                            child: TextFormField(
                              controller: _percent,
                              keyboardType: TextInputType.number,
                              decoration: const InputDecoration(labelText: 'Per purchase', suffixText: '%'),
                              validator: (v) {
                                final p = double.tryParse(v ?? '') ?? 0;
                                return _recoverDebt && (p <= 0 || p > 100) ? 'Use 1 to 100' : null;
                              },
                            ),
                          ),
                        ]),
                      ),
              ),
            ]),
          ),
        ]),
      ),
    );
  }
}

// Detail
class MeterDetailScreen extends ConsumerWidget {
  const MeterDetailScreen({super.key, required this.meterId});

  final String meterId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(meterDetailProvider(meterId));
    final landlord = ref.watch(landlordDashboardProvider).value?.landlord;
    return Scaffold(
      appBar: AppBar(
        title: Text(detail.value?.meter.tenantName ?? 'Meter'),
        actions: [
          if (detail.value != null)
            PopupMenuButton<String>(
              tooltip: 'More',
              onSelected: (v) {
                if (v == 'remove') _remove(context, ref, detail.value!.meter);
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'remove', child: Text('Remove from my account')),
              ],
            ),
        ],
      ),
      body: AsyncBody<MeterDetail>(
        value: detail,
        skeleton: const SkeletonList(),
        onRefresh: () => ref.refresh(meterDetailProvider(meterId).future),
        data: (d) {
          final m = d.meter;
          return ListView(padding: const EdgeInsets.only(bottom: Space.xxxl), children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(Space.lg, Space.sm, Space.lg, 0),
              child: MeterCard(meterId: m.meterId, address: m.address, apartment: m.apartment),
            ),
            if (m.status == 'invited')
              const InfoBanner(
                icon: Icons.hourglass_top_rounded,
                tone: Tone.warn,
                title: 'Waiting for your tenant',
                text: 'They connect by signing in to smeter with this meter number and the code we text them.',
              ),
            if (landlord != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(Space.lg, Space.lg, Space.lg, 0),
                child: FilledButton.icon(
                  onPressed: () => openMakePayment(context, ref, landlord, meter: m),
                  icon: const Icon(Icons.bolt_rounded),
                  label: const Text('Buy units for this meter'),
                ),
              ),
            const SectionHeader('Tenant'),
            AppCard(
              child: Column(children: [
                KeyValueRow('Name', m.tenantName),
                KeyValueRow('Phone', m.tenantPhone),
                InkWell(
                  onTap: () => _editEmail(context, ref, m),
                  child: KeyValueRow('Email', m.tenantEmail.isEmpty ? 'Add email (needed to log in)' : m.tenantEmail,
                      valueColor: m.tenantEmail.isEmpty ? SmeterColors.warn : null),
                ),
                KeyValueRow('Status', m.status == 'invited' ? 'Invited' : 'Connected'),
                KeyValueRow(
                  'Debt',
                  m.debt > 0 ? '${naira(m.debt)} · ${m.debtRecoveryPercent.toStringAsFixed(0)}% per purchase' : 'None',
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    onPressed: () => _editDebt(context, ref, m),
                    icon: const Icon(Icons.edit_outlined, size: 18),
                    label: const Text('Edit debt'),
                  ),
                ),
              ]),
            ),
            const SectionHeader('Token delivery'),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: Space.lg),
              child: DeliveryModePicker(value: m.deliveryMode, onChanged: (v) => _changeMode(context, ref, m, v)),
            ),
            if (m.service != null && (!m.isManual || m.service!.due > 0 || m.service!.ownerDue > 0)) ...[
              const SectionHeader('GPRS service charge'),
              if (!m.isManual)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: Space.lg),
                  child: ServicePayerPicker(
                    value: m.service!.payer,
                    feeText: '${naira(m.service!.monthlyFee, whole: true)} a month',
                    onChanged: (v) => _changePayer(context, ref, m, v),
                  ),
                ),
              AppCard(
                child: Column(children: [
                  KeyValueRow('Monthly charge', naira(m.service!.monthlyFee)),
                  KeyValueRow('You owe', naira(m.service!.ownerDue),
                      valueColor: m.service!.ownerDue > 0 ? SmeterColors.warn : null),
                  KeyValueRow('Tenant owes', naira(m.service!.due),
                      valueColor: m.service!.due > 0 ? SmeterColors.warn : null),
                  if (m.service!.billedUntil != null) KeyValueRow('Covered until', shortDate(m.service!.billedUntil)),
                ]),
              ),
            ],
            if (!m.isManual) ...[
              const SectionHeader('Meter link'),
              AppCard(
                child: Column(children: [
                  if (d.live != null)
                    KeyValueRow(
                      'Connection',
                      d.live!.online ? 'Online' : 'Offline · seen ${relative(d.live!.lastSeen)}',
                      valueColor: d.live!.online ? SmeterColors.success : SmeterColors.warn,
                    ),
                  if (d.live?.volts != null) KeyValueRow('Voltage', '${d.live!.volts!.toStringAsFixed(0)} V'),
                  if (d.live?.kw != null) KeyValueRow('Load', '${d.live!.kw!.toStringAsFixed(2)} kW'),
                  KeyValueRow(
                    'Supply',
                    switch (m.relayState) {
                      'disconnect_pending' => 'Disconnect queued',
                      'disconnected' => 'Off',
                      'reconnect_pending' => 'Reconnect queued',
                      _ => 'On',
                    },
                  ),
                  const SizedBox(height: Space.sm),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: m.isOff ? SmeterColors.success : SmeterColors.danger,
                        side: BorderSide(color: m.isOff ? SmeterColors.success : SmeterColors.danger),
                      ),
                      onPressed: () => _toggleRelay(context, ref, m, disconnect: !m.isOff),
                      icon: Icon(m.isOff ? Icons.power_rounded : Icons.power_off_rounded),
                      label: Text(m.isOff ? 'Reconnect supply' : 'Disconnect supply'),
                    ),
                  ),
                ]),
              ),
            ],
            const SectionHeader('Purchases'),
            if (d.purchases.isEmpty)
              const EmptyState(icon: Icons.receipt_long_outlined, title: 'No purchases on this meter yet')
            else
              AppCard(
                padding: const EdgeInsets.symmetric(vertical: Space.xs),
                child: Column(children: [
                  for (final (i, p) in d.purchases.indexed) ...[
                    if (i > 0) const Divider(indent: 76),
                    LandlordTransactionRow(purchase: p),
                  ],
                ]),
              ),
          ]);
        },
      ),
    );
  }

  Future<void> _editEmail(BuildContext context, WidgetRef ref, Meter m) async {
    final controller = TextEditingController(text: m.tenantEmail);
    final email = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text("Tenant's email"),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: TextInputType.emailAddress,
          autocorrect: false,
          decoration: const InputDecoration(helperText: 'Login codes for this meter go here'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, controller.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    controller.dispose();
    if (email == null || email == m.tenantEmail) return;
    if (!validEmail(email)) {
      if (context.mounted) showError(context, ApiException("Enter the tenant's email address"));
      return;
    }
    try {
      await ref.read(landlordRepositoryProvider).updateMeter(m.meterId, {'tenantEmail': email});
      ref.invalidate(meterDetailProvider(m.meterId));
      ref.invalidate(metersProvider);
      if (context.mounted) showInfo(context, 'Email saved. Login codes for this meter now go there.');
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }

  Future<void> _changeMode(BuildContext context, WidgetRef ref, Meter m, String mode) async {
    if (mode == m.deliveryMode) return;
    final toManual = mode == 'manual';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(toManual ? 'Switch to manual tokens?' : 'Switch to automatic delivery?'),
        content: Text(toManual
            ? 'Your tenant will type each token into the meter remote. Live readings and remote disconnect stop for this meter.'
            : 'Units will be sent to the meter over GPRS after each purchase. Only do this if the meter has a working network link.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Switch')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(landlordRepositoryProvider).updateMeter(m.meterId, {'deliveryMode': mode});
      ref.invalidate(meterDetailProvider(m.meterId));
      ref.invalidate(metersProvider);
      if (context.mounted) showInfo(context, 'Updated. We let your tenant know.');
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }

  Future<void> _changePayer(BuildContext context, WidgetRef ref, Meter m, String payer) async {
    if (payer == m.service?.payer) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Change who pays?'),
        content: Text('${servicePayerLabels[payer]}. Anything already owed stays with whoever owes it now. '
            "We'll let your tenant know."),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Change')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(landlordRepositoryProvider).updateMeter(m.meterId, {'servicePayer': payer});
      ref.invalidate(meterDetailProvider(m.meterId));
      if (context.mounted) showInfo(context, 'Updated. We let your tenant know.');
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }

  Future<void> _toggleRelay(BuildContext context, WidgetRef ref, Meter m, {required bool disconnect}) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(disconnect ? 'Disconnect supply?' : 'Reconnect supply?'),
        content: Text(disconnect
            ? 'This cuts power to ${m.label} remotely. Your tenant will be notified.'
            : 'This restores power to ${m.label}.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: disconnect ? SmeterColors.danger : SmeterColors.success),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(disconnect ? 'Disconnect' : 'Reconnect'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      final queued = await ref.read(landlordRepositoryProvider).relay(m.meterId, disconnect: disconnect);
      ref.invalidate(meterDetailProvider(m.meterId));
      ref.invalidate(metersProvider);
      if (context.mounted) {
        showInfo(context, queued ? 'Meter is offline. This runs when it reconnects.' : 'Command sent to the meter.');
      }
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }

  Future<void> _editDebt(BuildContext context, WidgetRef ref, Meter m) async {
    final amount = TextEditingController(text: m.debt > 0 ? m.debt.toStringAsFixed(2) : '');
    final percent = TextEditingController(text: m.debtRecoveryPercent.toStringAsFixed(0));
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(Space.xl, 0, Space.xl, MediaQuery.viewInsetsOf(ctx).bottom + Space.xl),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Debt recovery', style: SmeterText.title2()),
          const SizedBox(height: Space.xs),
          Text('A share of each purchase goes to you until the debt is cleared.', style: SmeterText.small()),
          const SizedBox(height: Space.lg),
          TextField(
            controller: amount,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(labelText: 'Outstanding debt', prefixText: '₦ '),
          ),
          const SizedBox(height: Space.md),
          TextField(
            controller: percent,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Deduct per purchase', suffixText: '%'),
          ),
          const SizedBox(height: Space.lg),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
        ]),
      ),
    );
    if (saved == true) {
      try {
        await ref.read(landlordRepositoryProvider).updateMeter(m.meterId, {
          'debtAmount': double.tryParse(amount.text) ?? 0,
          'debtRecoveryPercent': double.tryParse(percent.text) ?? 0,
        });
        ref.invalidate(meterDetailProvider(m.meterId));
        ref.invalidate(metersProvider);
      } catch (e) {
        if (context.mounted) showError(context, e);
      }
    }
    amount.dispose();
    percent.dispose();
  }

  Future<void> _remove(BuildContext context, WidgetRef ref, Meter m) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remove meter?'),
        content: Text('${m.tenantName} will be signed out and can no longer buy power through your account.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: SmeterColors.danger),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(landlordRepositoryProvider).removeMeter(m.meterId);
      ref.invalidate(metersProvider);
      ref.invalidate(landlordDashboardProvider);
      if (context.mounted) context.pop();
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }
}
