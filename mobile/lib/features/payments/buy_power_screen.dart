import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/format.dart';
import '../../core/models.dart';
import '../../shared/widgets.dart';
import '../../theme/smeter_theme.dart';
import 'checkout.dart';

/// Two-step purchase: amount → review & pay → hosted checkout → receipt.
/// Used by tenants ("Buy power") and owners ("Make a payment" for a meter).
class BuyPowerScreen extends StatefulWidget {
  const BuyPowerScreen({
    super.key,
    required this.title,
    required this.subtitle,
    required this.unitPrice,
    required this.deliveryMode,
    required this.start,
    required this.load,
    this.quote,
    this.minAmount = 500,
    this.maxAmount = 500000,
    this.channels = const ['card', 'bank_transfer', 'ussd'],
    this.presets = const [1000, 2000, 3000, 5000, 10000, 20000],
  });

  final String title;
  final String subtitle;
  final double unitPrice;

  /// 'ota' or 'manual': explains how the token will reach the meter.
  final String deliveryMode;

  /// Exact price breakdown for an amount (tenant flow).
  final Future<Quote> Function(double amount)? quote;
  final Future<Checkout> Function(double amount, String channel) start;
  final Future<Purchase> Function(String reference) load;
  final double minAmount;
  final double maxAmount;

  /// Channels enabled in the admin (API ids); the rest are hidden.
  final List<String> channels;

  /// Quick-pick amounts (editable from the admin dashboard).
  final List<double> presets;

  @override
  State<BuyPowerScreen> createState() => _BuyPowerScreenState();
}

class _BuyPowerScreenState extends State<BuyPowerScreen> {
  final _amount = TextEditingController();
  final _focus = FocusNode();
  int _step = 0;
  late final List<PayChannel> _channels = () {
    final on = PayChannel.values.where((c) => widget.channels.contains(c.api)).toList();
    return on.isEmpty ? PayChannel.values.toList() : on;
  }();
  late PayChannel _channel = _channels.first;
  Quote? _quote;

  @override
  void dispose() {
    _amount.dispose();
    _focus.dispose();
    super.dispose();
  }

  double? get _value => double.tryParse(_amount.text.replaceAll(',', ''));
  bool get _tooBig => (_value ?? 0) > widget.maxAmount;
  bool get _valid => (_value ?? 0) >= widget.minAmount && !_tooBig;

  void _setPreset(double v) {
    HapticFeedback.selectionClick();
    setState(() => _amount.text = v.toStringAsFixed(0));
  }

  Future<void> _continue() async {
    if (!_valid) return;
    _focus.unfocus();
    if (widget.quote != null) {
      try {
        _quote = await widget.quote!(_value!);
      } catch (e) {
        if (mounted) showError(context, e);
        return;
      }
    }
    if (mounted) setState(() => _step = 1);
  }

  Future<void> _pay() async {
    try {
      final checkout = await widget.start(_value!, _channel.api);
      if (!mounted) return;
      await runCheckout(context, checkout, widget.load, deliveryMode: widget.deliveryMode);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: _step == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) setState(() => _step = 0);
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(widget.title),
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(4),
            child: TweenAnimationBuilder<double>(
              tween: Tween(end: _step == 0 ? 0.5 : 1),
              duration: const Duration(milliseconds: 260),
              builder: (_, v, _) => LinearProgressIndicator(
                value: v,
                minHeight: 4,
                backgroundColor: SmeterColors.line,
                semanticsLabel: 'Step ${_step + 1} of 2',
              ),
            ),
          ),
        ),
        body: AnimatedSwitcher(
          duration: const Duration(milliseconds: 240),
          switchInCurve: Curves.easeOutCubic,
          transitionBuilder: (child, anim) => FadeTransition(
            opacity: anim,
            child: SlideTransition(
              position: Tween(begin: const Offset(0.04, 0), end: Offset.zero).animate(anim),
              child: child,
            ),
          ),
          child: _step == 0 ? _amountStep() : _reviewStep(),
        ),
        bottomNavigationBar: SafeArea(
          minimum: const EdgeInsets.fromLTRB(Space.lg, Space.sm, Space.lg, Space.lg),
          child: _step == 0
              ? BusyButton(
                  label: _valid
                      ? 'Continue'
                      : _tooBig
                          ? 'Maximum is ${naira(widget.maxAmount, whole: true)}'
                          : 'Enter at least ${naira(widget.minAmount, whole: true)}',
                  onPressed: _valid ? _continue : null,
                )
              : BusyButton(
                  label: 'Pay ${naira(_quote?.total ?? _value)}',
                  icon: Icons.lock_rounded,
                  onPressed: _pay,
                ),
        ),
      ),
    );
  }

  Widget _amountStep() {
    final v = _value;
    final est = widget.unitPrice > 0 && v != null && v > 0 ? v / widget.unitPrice : null;
    return ListView(
      key: const ValueKey('amount'),
      padding: const EdgeInsets.fromLTRB(Space.xl, Space.lg, Space.xl, Space.xl),
      children: [
        Text(widget.subtitle, style: SmeterText.small()),
        const SizedBox(height: Space.xxxl),
        Text('How much power?', textAlign: TextAlign.center, style: SmeterText.title3(color: SmeterColors.inkSoft)),
        const SizedBox(height: Space.sm),
        // ₦ sits right beside the figure, and the pair stays centred as it grows.
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text('₦', style: SmeterText.figure(44, color: SmeterColors.primary)),
          IntrinsicWidth(
            child: TextField(
              controller: _amount,
              focusNode: _focus,
              autofocus: true,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(7)],
              onChanged: (_) => setState(() {}),
              style: SmeterText.figure(44, color: SmeterColors.primary),
              decoration: InputDecoration(
                hintText: '0',
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
        AnimatedOpacity(
          opacity: est == null ? 0.5 : 1,
          duration: const Duration(milliseconds: 180),
          child: Text(
            est == null
                ? '1 kWh = ${naira(widget.unitPrice)}'
                : '≈ ${units(est)} kWh  ·  ${naira(widget.unitPrice)}/kWh',
            textAlign: TextAlign.center,
            style: SmeterText.bodyStrong(color: SmeterColors.success),
          ),
        ),
        const SizedBox(height: Space.xxxl),
        GridView.count(
          crossAxisCount: 3,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: Space.sm,
          crossAxisSpacing: Space.sm,
          childAspectRatio: 2.3,
          children: [
            for (final p in widget.presets.where((p) => p >= widget.minAmount && p <= widget.maxAmount))
              _PresetChip(
                label: naira(p, whole: true),
                selected: v == p,
                onTap: () => _setPreset(p),
              ),
          ],
        ),
      ],
    );
  }

  Widget _reviewStep() {
    final q = _quote;
    final amount = _value ?? 0;
    final kwhOut = q?.units ?? (widget.unitPrice > 0 ? amount / widget.unitPrice : null);
    final manual = widget.deliveryMode == 'manual';
    return ListView(
      key: const ValueKey('review'),
      padding: const EdgeInsets.only(top: Space.md, bottom: Space.xl),
      children: [
        AppCard(
          padding: const EdgeInsets.all(Space.xl),
          child: Column(children: [
            Text('YOU GET', style: SmeterText.overline()),
            const SizedBox(height: Space.xs),
            Text('${units(kwhOut)} kWh', style: SmeterText.display(color: SmeterColors.primary)),
            const SizedBox(height: Space.lg),
            const Divider(),
            const SizedBox(height: Space.sm),
            KeyValueRow('Amount', naira(amount)),
            if (q != null && q.debtRecovered > 0)
              KeyValueRow('Debt recovery', '− ${naira(q.debtRecovered)}', valueColor: SmeterColors.warn),
            if (q != null) KeyValueRow('Power', naira(q.energyAmount)),
            if (q != null)
              KeyValueRow('Service fee', q.feeBearer == 'tenant' ? naira(q.fee) : 'Paid by owner'),
            KeyValueRow('Price per kWh', naira(widget.unitPrice)),
            const SizedBox(height: Space.xs),
            const Divider(),
            KeyValueRow('Total', naira(q?.total ?? amount), strong: true, valueColor: SmeterColors.primary),
          ]),
        ),
        InfoBanner(
          icon: manual ? Icons.dialpad_rounded : Icons.cell_tower_rounded,
          tone: manual ? Tone.warn : Tone.info,
          title: manual ? 'You’ll get a token to enter' : 'Sent to your meter automatically',
          text: manual
              ? 'After payment we show a 20-digit token. Type it into your meter remote to load the units.'
              : 'Units are sent over the network straight after payment. We also show the token, just in case.',
        ),
        const SectionHeader('Pay with'),
        for (final c in _channels)
          Padding(
            padding: const EdgeInsets.fromLTRB(Space.lg, 0, Space.lg, Space.sm),
            child: _ChannelTile(channel: c, selected: c == _channel, onTap: () => setState(() => _channel = c)),
          ),
        Padding(
          padding: const EdgeInsets.all(Space.lg),
          child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Icon(Icons.verified_user_outlined, size: 16, color: SmeterColors.muted),
            const SizedBox(width: 6),
            Text('Secured by Paystack. We never see your card.', style: SmeterText.caption()),
          ]),
        ),
      ],
    );
  }
}

class _PresetChip extends StatelessWidget {
  const _PresetChip({required this.label, required this.selected, required this.onTap});

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? SmeterColors.primarySoft : SmeterColors.surface,
      borderRadius: BorderRadius.circular(Radii.md),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(Radii.md),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(Radii.md),
            border: Border.all(color: selected ? SmeterColors.primary : SmeterColors.line, width: selected ? 1.6 : 1),
          ),
          child: Text(label,
              style: GoogleFonts.dmSans(
                  fontWeight: FontWeight.w700, fontSize: 15, color: selected ? SmeterColors.primary : SmeterColors.ink)),
        ),
      ),
    );
  }
}

class _ChannelTile extends StatelessWidget {
  const _ChannelTile({required this.channel, required this.selected, required this.onTap});

  final PayChannel channel;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      selected: selected,
      inMutuallyExclusiveGroup: true,
      button: true,
      child: Material(
        color: selected ? SmeterColors.primaryTint : SmeterColors.surface,
        borderRadius: BorderRadius.circular(Radii.md),
        child: InkWell(
          borderRadius: BorderRadius.circular(Radii.md),
          onTap: () {
            HapticFeedback.selectionClick();
            onTap();
          },
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 160),
            padding: const EdgeInsets.symmetric(horizontal: Space.lg, vertical: Space.md),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(Radii.md),
              border: Border.all(color: selected ? SmeterColors.primary : SmeterColors.line, width: selected ? 1.6 : 1),
            ),
            child: Row(children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: selected ? SmeterColors.primary : SmeterColors.primarySoft,
                  borderRadius: BorderRadius.circular(Radii.sm),
                ),
                child: Icon(channel.icon, color: selected ? Colors.white : SmeterColors.primary, size: 22),
              ),
              const SizedBox(width: Space.md),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(channel.label, style: SmeterText.bodyStrong()),
                  Text(channel.hint, style: SmeterText.caption()),
                ]),
              ),
              Icon(selected ? Icons.radio_button_checked_rounded : Icons.radio_button_off_rounded,
                  color: selected ? SmeterColors.primary : SmeterColors.muted),
            ]),
          ),
        ),
      ),
    );
  }
}
