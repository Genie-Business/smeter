import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:share_plus/share_plus.dart';

import '../core/api_client.dart';
import '../core/app_content.dart';
import '../core/format.dart';
import '../core/models.dart';
import '../theme/smeter_theme.dart';

// Feedback
void showError(BuildContext context, Object error) {
  if (!context.mounted) return;
  HapticFeedback.mediumImpact();
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      backgroundColor: SmeterColors.danger,
      content: Row(children: [
        const Icon(Icons.error_outline_rounded, color: Colors.white, size: 20),
        const SizedBox(width: 10),
        Expanded(child: Text(error is ApiException ? error.message : 'Something went wrong. Please try again.')),
      ]),
    ));
}

void showInfo(BuildContext context, String message, {IconData icon = Icons.check_circle_rounded}) {
  if (!context.mounted) return;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Row(children: [
        Icon(icon, color: Colors.white, size: 20),
        const SizedBox(width: 10),
        Expanded(child: Text(message)),
      ]),
    ));
}

Future<void> copyText(BuildContext context, String text, String what) async {
  await Clipboard.setData(ClipboardData(text: text));
  HapticFeedback.selectionClick();
  if (context.mounted) showInfo(context, '$what copied', icon: Icons.copy_rounded);
}

// Async states
/// Loading / error / data for an [AsyncValue]. When [onRefresh] is set the
/// [data] builder must return its own scrollable (ListView etc.).
class AsyncBody<T> extends StatelessWidget {
  const AsyncBody({
    super.key,
    required this.value,
    required this.data,
    this.onRefresh,
    this.onDark = false,
    this.skeleton,
  });

  final AsyncValue<T> value;
  final Widget Function(T data) data;
  final Future<void> Function()? onRefresh;

  /// Sitting on the purple background: use a white spinner.
  final bool onDark;

  /// Placeholder shown while loading; defaults to a spinner.
  final Widget? skeleton;

  @override
  Widget build(BuildContext context) {
    return value.when(
      skipLoadingOnRefresh: true,
      skipLoadingOnReload: true,
      data: (d) => onRefresh == null
          ? data(d)
          : RefreshIndicator(color: SmeterColors.primary, onRefresh: onRefresh!, child: data(d)),
      loading: () =>
          skeleton ?? Center(child: CircularProgressIndicator(color: onDark ? Colors.white : SmeterColors.primary)),
      error: (e, st) {
        // Non-API errors are bugs (e.g. a parsing mismatch); keep them visible in logs.
        if (e is! ApiException) debugPrint('AsyncBody error: $e\n$st');
        return ErrorState(message: e is ApiException ? e.message : 'Something went wrong.', onRetry: onRefresh);
      },
    );
  }
}

class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.message, this.onRetry});

  final String message;
  final Future<void> Function()? onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(Space.xxxl),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const _IconBubble(icon: Icons.cloud_off_rounded, color: SmeterColors.muted, bg: SmeterColors.line),
          const SizedBox(height: Space.lg),
          Text("Couldn't load this", style: SmeterText.title3()),
          const SizedBox(height: Space.xs),
          Text(message, textAlign: TextAlign.center, style: SmeterText.small()),
          if (onRetry != null) ...[
            const SizedBox(height: Space.lg),
            OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh_rounded), label: const Text('Try again')),
          ],
        ]),
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.message, this.action});

  final IconData icon;
  final String title;
  final String? message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: Space.xxxl, vertical: 36),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        _IconBubble(icon: icon, color: SmeterColors.primary, bg: SmeterColors.primarySoft),
        const SizedBox(height: Space.lg),
        Text(title, textAlign: TextAlign.center, style: SmeterText.title3()),
        if (message != null) ...[
          const SizedBox(height: Space.xs),
          Text(message!, textAlign: TextAlign.center, style: SmeterText.small()),
        ],
        if (action != null) ...[const SizedBox(height: Space.lg), action!],
      ]),
    );
  }
}

class _IconBubble extends StatelessWidget {
  const _IconBubble({required this.icon, required this.color, required this.bg});
  final IconData icon;
  final Color color;
  final Color bg;

  @override
  Widget build(BuildContext context) => Container(
        width: 64,
        height: 64,
        decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
        child: Icon(icon, color: color, size: 30),
      );
}

/// Pulsing placeholder block for skeleton screens.
class Skeleton extends StatefulWidget {
  const Skeleton({super.key, this.height = 16, this.width, this.radius = Radii.sm});

  final double height;
  final double? width;
  final double radius;

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduce = MediaQuery.of(context).disableAnimations;
    return AnimatedBuilder(
      animation: _c,
      builder: (_, _) => Container(
        height: widget.height,
        width: widget.width,
        decoration: BoxDecoration(
          color: Color.lerp(SmeterColors.line, SmeterColors.primaryTint, reduce ? 0.5 : _c.value),
          borderRadius: BorderRadius.circular(widget.radius),
        ),
      ),
    );
  }
}

/// Generic skeleton: a hero block and a few list rows.
class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, this.hero = true, this.rows = 5});

  final bool hero;
  final int rows;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const NeverScrollableScrollPhysics(),
      padding: const EdgeInsets.all(Space.lg),
      children: [
        if (hero) ...[const Skeleton(height: 168, radius: Radii.lg), const SizedBox(height: Space.xxl)],
        for (var i = 0; i < rows; i++) ...[
          Row(children: [
            const Skeleton(height: 44, width: 44, radius: 22),
            const SizedBox(width: Space.md),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: const [
                Skeleton(height: 14, width: 140),
                SizedBox(height: 8),
                Skeleton(height: 12, width: 90),
              ]),
            ),
            const Skeleton(height: 14, width: 64),
          ]),
          const SizedBox(height: Space.xl),
        ],
      ],
    );
  }
}

// Layout
/// Screen with a brand-gradient header that the content overlaps. Used by the
/// dashboards. [header] sits on the gradient; [children] scroll below.
class HeroScaffold extends StatelessWidget {
  const HeroScaffold({
    super.key,
    required this.header,
    required this.children,
    this.onRefresh,
    this.overlap = 44,
  });

  final Widget header;
  final List<Widget> children;
  final Future<void> Function()? onRefresh;
  final double overlap;

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    final list = ListView(
      padding: EdgeInsets.zero,
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        Container(
          decoration: const BoxDecoration(gradient: SmeterColors.heroGradient),
          padding: EdgeInsets.fromLTRB(Space.xl, top + Space.lg, Space.xl, overlap + Space.lg),
          child: header,
        ),
        Transform.translate(
          offset: Offset(0, -overlap),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
        ),
      ],
    );
    return AnnotatedRegion(
      value: SystemUiOverlayStyle.light,
      child: onRefresh == null ? list : RefreshIndicator(color: SmeterColors.primary, onRefresh: onRefresh!, child: list),
    );
  }
}

/// Plain page title row used at the top of tab screens.
class PageTitle extends StatelessWidget {
  const PageTitle(this.title, {super.key, this.subtitle, this.trailing});

  final String title;
  final String? subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(Space.xl, Space.lg, Space.lg, Space.md),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: SmeterText.title1()),
              if (subtitle != null) ...[const SizedBox(height: 2), Text(subtitle!, style: SmeterText.small())],
            ]),
          ),
          ?trailing,
        ]),
      );
}

class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(Space.lg),
    this.margin = const EdgeInsets.symmetric(horizontal: Space.lg),
    this.onTap,
    this.color = SmeterColors.surface,
    this.borderColor = SmeterColors.line,
  });

  final Widget child;
  final EdgeInsets padding;
  final EdgeInsets margin;
  final VoidCallback? onTap;
  final Color color;
  final Color borderColor;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: margin,
      child: Material(
        color: color,
        borderRadius: BorderRadius.circular(Radii.lg),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(Radii.lg),
          child: Container(
            padding: padding,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(Radii.lg),
              border: Border.all(color: borderColor),
              boxShadow: const [BoxShadow(color: Color(0x0F2A0A33), blurRadius: 18, offset: Offset(0, 6))],
            ),
            child: child,
          ),
        ),
      ),
    );
  }
}

class SectionHeader extends StatelessWidget {
  const SectionHeader(this.title, {super.key, this.action, this.onAction});

  final String title;
  final String? action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(Space.xl, Space.xxl, Space.sm, Space.sm),
        child: Row(children: [
          Expanded(child: Text(title, style: SmeterText.title3())),
          if (action != null) TextButton(onPressed: onAction, child: Text(action!)),
        ]),
      );
}

enum Tone { brand, success, warn, danger, info, neutral }

(Color, Color) toneColors(Tone t) => switch (t) {
      Tone.brand => (SmeterColors.primary, SmeterColors.primarySoft),
      Tone.success => (SmeterColors.success, SmeterColors.successSoft),
      Tone.warn => (SmeterColors.warn, SmeterColors.warnSoft),
      Tone.danger => (SmeterColors.danger, SmeterColors.dangerSoft),
      Tone.info => (SmeterColors.info, SmeterColors.infoSoft),
      Tone.neutral => (SmeterColors.inkSoft, SmeterColors.line),
    };

class Pill extends StatelessWidget {
  const Pill(this.label, {super.key, this.tone = Tone.neutral, this.icon, this.onDark = false});

  final String label;
  final Tone tone;
  final IconData? icon;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = onDark ? (Colors.white, Colors.white.withValues(alpha: 0.18)) : toneColors(tone);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[Icon(icon, size: 14, color: fg), const SizedBox(width: 5)],
        Text(label, style: GoogleFonts.dmSans(color: fg, fontSize: 12, fontWeight: FontWeight.w700)),
      ]),
    );
  }
}

/// Status of a purchase as a pill.
class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key, this.delivery});

  final String status;
  final String? delivery;

  @override
  Widget build(BuildContext context) {
    final (label, tone, icon) = switch (status) {
      'vended' when delivery == 'manual' => ('Token ready', Tone.success, Icons.vpn_key_rounded),
      'vended' => ('Sent to meter', Tone.success, Icons.check_rounded),
      'pending' => ('Awaiting payment', Tone.warn, Icons.schedule_rounded),
      'paid' || 'vending' => ('Processing', Tone.info, Icons.autorenew_rounded),
      'failed' => ('Failed', Tone.danger, Icons.close_rounded),
      _ => (status, Tone.neutral, null),
    };
    return Pill(label, tone: tone, icon: icon);
  }
}

/// How tokens reach this meter.
class ModeBadge extends StatelessWidget {
  const ModeBadge(this.mode, {super.key, this.onDark = false});

  final String mode;
  final bool onDark;

  @override
  Widget build(BuildContext context) => mode == 'manual'
      ? Pill('Manual token', tone: Tone.warn, icon: Icons.dialpad_rounded, onDark: onDark)
      : Pill('Auto · GPRS', tone: Tone.info, icon: Icons.cell_tower_rounded, onDark: onDark);
}

class InfoBanner extends StatelessWidget {
  const InfoBanner({super.key, required this.icon, required this.text, this.tone = Tone.info, this.title});

  final IconData icon;
  final String? title;
  final String text;
  final Tone tone;

  @override
  Widget build(BuildContext context) {
    final (fg, bg) = toneColors(tone);
    return Container(
      margin: const EdgeInsets.fromLTRB(Space.lg, Space.md, Space.lg, 0),
      padding: const EdgeInsets.all(Space.md + 2),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(Radii.md)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, color: fg, size: 20),
        const SizedBox(width: Space.md),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (title != null) Text(title!, style: SmeterText.bodyStrong(color: fg)),
            Text(text, style: SmeterText.small(color: SmeterColors.inkSoft)),
          ]),
        ),
      ]),
    );
  }
}

class StatTile extends StatelessWidget {
  const StatTile({super.key, required this.label, required this.value, this.icon, this.caption});

  final String label;
  final String value;
  final IconData? icon;
  final String? caption;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(Space.md + 2),
        decoration: BoxDecoration(
          color: SmeterColors.surface,
          borderRadius: BorderRadius.circular(Radii.md),
          border: Border.all(color: SmeterColors.line),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (icon != null) ...[Icon(icon, size: 18, color: SmeterColors.primary), const SizedBox(height: 6)],
          Text(label, style: SmeterText.caption(), maxLines: 2),
          const SizedBox(height: Space.sm),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(value, style: SmeterText.figure(18)),
          ),
          if (caption != null) ...[const SizedBox(height: 2), Text(caption!, style: SmeterText.caption())],
        ]),
      );
}

class KeyValueRow extends StatelessWidget {
  const KeyValueRow(this.label, this.value, {super.key, this.strong = false, this.valueColor});

  final String label;
  final String value;
  final bool strong;
  final Color? valueColor;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        // Label takes what it needs; the value fills the rest, flush right.
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: strong ? SmeterText.bodyStrong() : SmeterText.small()),
          const SizedBox(width: Space.lg),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: (strong ? SmeterText.figure(17) : SmeterText.bodyStrong()).copyWith(color: valueColor),
            ),
          ),
        ]),
      );
}

// Buttons & inputs
/// Primary action that shows a spinner while [onPressed] runs.
class BusyButton extends StatefulWidget {
  const BusyButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.inverted = false,
    this.icon,
    this.secondary = false,
  });

  final String label;
  final Future<void> Function()? onPressed;

  /// White button for purple backgrounds.
  final bool inverted;

  /// Outlined style.
  final bool secondary;
  final IconData? icon;

  @override
  State<BusyButton> createState() => _BusyButtonState();
}

class _BusyButtonState extends State<BusyButton> {
  bool _busy = false;

  Future<void> _run() async {
    if (_busy || widget.onPressed == null) return;
    HapticFeedback.lightImpact();
    setState(() => _busy = true);
    try {
      await widget.onPressed!();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final fg = widget.inverted ? SmeterColors.primary : (widget.secondary ? SmeterColors.primary : Colors.white);
    final child = _busy
        ? SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: fg))
        : Row(mainAxisSize: MainAxisSize.min, children: [
            if (widget.icon != null) ...[Icon(widget.icon, size: 20), const SizedBox(width: 10)],
            Flexible(child: Text(widget.label, overflow: TextOverflow.ellipsis)),
          ]);
    final onPressed = widget.onPressed == null ? null : _run;
    return SizedBox(
      width: double.infinity,
      child: widget.secondary
          ? OutlinedButton(onPressed: onPressed, child: child)
          : FilledButton(
              style: widget.inverted
                  ? FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: SmeterColors.primary)
                  : null,
              onPressed: onPressed,
              child: child,
            ),
    );
  }
}

class OtpField extends StatelessWidget {
  const OtpField({super.key, required this.controller, this.onCompleted, this.light = false});

  final TextEditingController controller;
  final ValueChanged<String>? onCompleted;
  final bool light;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      autofocus: true,
      keyboardType: TextInputType.number,
      textAlign: TextAlign.center,
      maxLength: 6,
      autofillHints: const [AutofillHints.oneTimeCode],
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      style: SmeterText.token(26, color: light ? Colors.white : SmeterColors.ink).copyWith(letterSpacing: 12),
      decoration: InputDecoration(
        counterText: '',
        hintText: '••••••',
        filled: !light,
        fillColor: light ? Colors.transparent : SmeterColors.surface,
        hintStyle: TextStyle(color: light ? Colors.white54 : SmeterColors.muted, letterSpacing: 12),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.md),
          borderSide: BorderSide(color: light ? Colors.white : SmeterColors.line, width: 1.6),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(Radii.md),
          borderSide: BorderSide(color: light ? Colors.white : SmeterColors.primary, width: 2),
        ),
      ),
      onChanged: (v) {
        if (v.length == 6) onCompleted?.call(v);
      },
    );
  }
}

/// White-outlined field used on purple backgrounds (tenant login).
class LightField extends StatelessWidget {
  const LightField({
    super.key,
    required this.controller,
    required this.label,
    this.keyboardType,
    this.enabled = true,
    this.inputFormatters,
    this.textInputAction,
  });

  final TextEditingController controller;
  final String label;
  final TextInputType? keyboardType;
  final bool enabled;
  final List<TextInputFormatter>? inputFormatters;
  final TextInputAction? textInputAction;

  @override
  Widget build(BuildContext context) {
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(Radii.md),
      borderSide: const BorderSide(color: Colors.white, width: 1.6),
    );
    return TextField(
      controller: controller,
      enabled: enabled,
      keyboardType: keyboardType,
      inputFormatters: inputFormatters,
      textInputAction: textInputAction,
      cursorColor: Colors.white,
      style: GoogleFonts.dmSans(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w600, letterSpacing: 1),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: GoogleFonts.dmSans(color: Colors.white.withValues(alpha: 0.85), fontSize: 15),
        floatingLabelStyle: GoogleFonts.dmSans(color: Colors.white, fontWeight: FontWeight.w600),
        filled: true,
        fillColor: Colors.white.withValues(alpha: 0.08),
        enabledBorder: border,
        focusedBorder: border.copyWith(borderSide: const BorderSide(color: Colors.white, width: 2.2)),
        disabledBorder: border.copyWith(borderSide: BorderSide(color: Colors.white.withValues(alpha: 0.5))),
      ),
    );
  }
}

// Tokens
/// A 20-digit STS token shown in groups of four, the way it's typed into a
/// meter keypad, with copy and share.
class TokenDisplay extends StatelessWidget {
  const TokenDisplay({super.key, required this.token, this.units, this.compact = false, this.onDark = false});

  final String token;
  final double? units;
  final bool compact;
  final bool onDark;

  List<String> get _groups {
    final digits = token.replaceAll(RegExp(r'\D'), '');
    return [for (var i = 0; i < digits.length; i += 4) digits.substring(i, (i + 4).clamp(0, digits.length))];
  }

  @override
  Widget build(BuildContext context) {
    final fg = onDark ? Colors.white : SmeterColors.ink;
    final chipBg = onDark ? Colors.white.withValues(alpha: 0.16) : SmeterColors.surface;
    final raw = token.replaceAll(RegExp(r'\D'), '');
    return Semantics(
      label: 'Token ${_groups.join(' ')}',
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        // Always one line of five groups, scaled to fit, so it is easier to read off
        // while typing on the meter remote than a wrapped block.
        FittedBox(
          fit: BoxFit.scaleDown,
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            for (final (i, g) in _groups.indexed) ...[
              if (i > 0) SizedBox(width: compact ? 5 : 6),
              Container(
                padding: EdgeInsets.symmetric(horizontal: compact ? 7 : 8, vertical: compact ? 7 : 10),
                decoration: BoxDecoration(
                  color: chipBg,
                  borderRadius: BorderRadius.circular(Radii.sm),
                  border: onDark ? null : Border.all(color: SmeterColors.line),
                ),
                child: Text(g, style: SmeterText.token(compact ? 17 : 20, color: fg)),
              ),
            ],
          ]),
        ),
        if (!compact) ...[
          const SizedBox(height: Space.md),
          Row(children: [
            Expanded(
              child: OutlinedButton.icon(
                style: onDark
                    ? OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: Colors.white54))
                    : null,
                onPressed: () => copyText(context, raw, 'Token'),
                icon: const Icon(Icons.copy_rounded, size: 18),
                label: const Text('Copy'),
              ),
            ),
            const SizedBox(width: Space.sm),
            Expanded(
              child: OutlinedButton.icon(
                style: onDark
                    ? OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: Colors.white54))
                    : null,
                onPressed: () => SharePlus.instance.share(ShareParams(
                  text: 'smeter token: ${_groups.join(' ')}${units != null ? ' (${units!.toStringAsFixed(2)} kWh)' : ''}',
                )),
                icon: const Icon(Icons.ios_share_rounded, size: 18),
                label: const Text('Share'),
              ),
            ),
          ]),
        ],
      ]),
    );
  }
}

/// Step-by-step instructions for keying a token into the meter remote (CIU).
/// The steps are editable from the admin dashboard.
class HowToLoadToken extends ConsumerWidget {
  const HowToLoadToken({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final steps = [for (final s in appContentOf(ref).tokenHelp) (s.title, s.body)];
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('How to load it', style: SmeterText.title3()),
      const SizedBox(height: Space.md),
      for (var i = 0; i < steps.length; i++)
        Padding(
          padding: const EdgeInsets.only(bottom: Space.md),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              width: 28,
              height: 28,
              alignment: Alignment.center,
              decoration: const BoxDecoration(color: SmeterColors.primarySoft, shape: BoxShape.circle),
              child: Text('${i + 1}', style: SmeterText.bodyStrong(color: SmeterColors.primary)),
            ),
            const SizedBox(width: Space.md),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(steps[i].$1, style: SmeterText.bodyStrong()),
                Text(steps[i].$2, style: SmeterText.small()),
              ]),
            ),
          ]),
        ),
      Text('If it shows “Reject”, check the digits and try again. A token can only be used once, on this meter.',
          style: SmeterText.caption()),
    ]);
  }
}

/// List row for a purchase: status icon, amount + units, date, quick copy.
class PurchaseRow extends StatelessWidget {
  const PurchaseRow({super.key, required this.purchase, this.onTap, this.subtitlePrefix, this.showToken = true});

  final Purchase purchase;
  final VoidCallback? onTap;
  final String? subtitlePrefix;
  final bool showToken;

  @override
  Widget build(BuildContext context) {
    final p = purchase;
    final (icon, tone) = switch (p.status) {
      'vended' when p.delivery == 'manual' => (Icons.vpn_key_rounded, Tone.success),
      'vended' => (Icons.bolt_rounded, Tone.success),
      'failed' => (Icons.close_rounded, Tone.danger),
      'pending' => (Icons.schedule_rounded, Tone.warn),
      _ => (Icons.autorenew_rounded, Tone.info),
    };
    final (fg, bg) = toneColors(tone);
    final sub = [
      ?subtitlePrefix,
      if (p.units != null) '${units(p.units)} kWh',
      timeOfDay(p.vendedAt ?? p.createdAt),
    ].join(' · ');
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Space.xl, vertical: Space.md),
        child: Row(children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
            child: Icon(icon, color: fg, size: 22),
          ),
          const SizedBox(width: Space.md),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(naira(p.amount), style: SmeterText.bodyStrong()),
              const SizedBox(height: 2),
              Text(sub, style: SmeterText.caption(), maxLines: 1, overflow: TextOverflow.ellipsis),
            ]),
          ),
          if (showToken && p.token != null)
            IconButton(
              tooltip: 'Copy token',
              onPressed: () => copyText(context, p.token!.replaceAll('-', ''), 'Token'),
              icon: const Icon(Icons.copy_rounded, size: 20, color: SmeterColors.primary),
            )
          else if (p.status != 'vended')
            StatusChip(p.status, delivery: p.delivery)
          else
            const Icon(Icons.chevron_right_rounded, color: SmeterColors.muted),
        ]),
      ),
    );
  }
}

/// Splits items into day sections: Today, Yesterday, then dates.
List<(String, List<T>)> groupByDay<T>(List<T> items, String? Function(T) dateOf) {
  final out = <(String, List<T>)>[];
  for (final item in items) {
    final label = dayLabel(dateOf(item));
    if (out.isEmpty || out.last.$1 != label) {
      out.add((label, [item]));
    } else {
      out.last.$2.add(item);
    }
  }
  return out;
}

class DayHeader extends StatelessWidget {
  const DayHeader(this.label, {super.key});
  final String label;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(Space.xl, Space.lg, Space.xl, Space.xs),
        child: Text(label.toUpperCase(), style: SmeterText.overline()),
      );
}

/// Home-screen announcement set by the smeter team in the admin dashboard.
class AnnouncementBanner extends ConsumerWidget {
  const AnnouncementBanner({super.key, required this.tenant});

  final bool tenant;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final a = appContentOf(ref).announcement;
    if (!a.showTo(tenant: tenant)) return const SizedBox.shrink();
    final (tone, icon) = switch (a.tone) {
      'success' => (Tone.success, Icons.celebration_outlined),
      'warn' => (Tone.warn, Icons.warning_amber_rounded),
      'danger' => (Tone.danger, Icons.error_outline_rounded),
      _ => (Tone.info, Icons.campaign_outlined),
    };
    return InfoBanner(icon: icon, tone: tone, title: a.title.isEmpty ? null : a.title, text: a.body);
  }
}

// Chrome
class NotificationBell extends StatelessWidget {
  const NotificationBell({super.key, required this.unread, required this.onTap, this.onDark = true});

  final int unread;
  final VoidCallback onTap;
  final bool onDark;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: unread > 0 ? 'Notifications, $unread unread' : 'Notifications',
      child: Material(
        color: onDark ? Colors.white.withValues(alpha: 0.16) : SmeterColors.surface,
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(
            width: 44,
            height: 44,
            child: Stack(alignment: Alignment.center, clipBehavior: Clip.none, children: [
              Icon(Icons.notifications_none_rounded, color: onDark ? Colors.white : SmeterColors.ink, size: 24),
              if (unread > 0)
                Positioned(
                  right: 8,
                  top: 8,
                  child: Container(
                    constraints: const BoxConstraints(minWidth: 16),
                    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                    decoration: BoxDecoration(
                      color: SmeterColors.danger,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: onDark ? SmeterColors.primary : Colors.white, width: 1.5),
                    ),
                    child: Text(unread > 9 ? '9+' : '$unread',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.white, fontSize: 9.5, fontWeight: FontWeight.w800)),
                  ),
                ),
            ]),
          ),
        ),
      ),
    );
  }
}

class NavItem {
  const NavItem(this.icon, this.activeIcon, this.label);
  final IconData icon;
  final IconData activeIcon;
  final String label;
}

/// Bottom navigation: every tab labelled (clearer than icon-only), the active
/// one inside a soft purple pill as in the design.
class SmeterBottomNav extends StatelessWidget {
  const SmeterBottomNav({super.key, required this.items, required this.index, required this.onTap});

  final List<NavItem> items;
  final int index;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: SmeterColors.surface,
        border: Border(top: BorderSide(color: SmeterColors.line)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 68,
          child: Row(children: [
            for (var i = 0; i < items.length; i++)
              Expanded(child: _NavButton(item: items[i], active: i == index, onTap: () => onTap(i))),
          ]),
        ),
      ),
    );
  }
}

class _NavButton extends StatelessWidget {
  const _NavButton({required this.item, required this.active, required this.onTap});

  final NavItem item;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = active ? SmeterColors.primary : SmeterColors.muted;
    return Semantics(
      selected: active,
      button: true,
      label: item.label,
      child: InkResponse(
        onTap: () {
          if (!active) HapticFeedback.selectionClick();
          onTap();
        },
        containedInkWell: true,
        highlightShape: BoxShape.rectangle,
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 220),
            curve: Curves.easeOutCubic,
            width: active ? 56 : 40,
            height: 30,
            decoration: BoxDecoration(
              color: active ? SmeterColors.primarySoft : Colors.transparent,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(active ? item.activeIcon : item.icon, color: color, size: 23),
          ),
          const SizedBox(height: 4),
          Text(item.label,
              style: GoogleFonts.dmSans(
                  fontSize: 12, fontWeight: active ? FontWeight.w700 : FontWeight.w500, color: color)),
        ]),
      ),
    );
  }
}
