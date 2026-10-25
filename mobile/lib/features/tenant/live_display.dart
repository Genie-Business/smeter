import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import '../../core/format.dart';
import '../../core/models.dart';
import '../../theme/smeter_theme.dart';

/// The meter has no screen, so this card is its display (SM-MON-001): volts,
/// amps and load, refreshed every 5 seconds while the app is in the foreground.
/// Only shown for GPRS meters.
class LiveDisplayCard extends StatefulWidget {
  const LiveDisplayCard({super.key, required this.load});

  final Future<LiveReading> Function() load;

  @override
  State<LiveDisplayCard> createState() => _LiveDisplayCardState();
}

class _LiveDisplayCardState extends State<LiveDisplayCard> {
  LiveReading? _reading;
  bool _failed = false;
  Timer? _timer;
  late final AppLifecycleListener _lifecycle;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(onResume: _start, onPause: _stop, onHide: _stop);
    _start();
  }

  @override
  void dispose() {
    _stop();
    _lifecycle.dispose();
    super.dispose();
  }

  void _start() {
    _stop();
    _refresh();
    _timer = Timer.periodic(const Duration(seconds: 5), (_) => _refresh());
  }

  void _stop() => _timer?.cancel();

  Future<void> _refresh() async {
    if (SchedulerBinding.instance.lifecycleState != AppLifecycleState.resumed && _reading != null) return;
    try {
      final r = await widget.load();
      if (mounted) {
        setState(() {
          _reading = r;
          _failed = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = _reading;
    final online = r?.online ?? false;
    final statusColor = r == null ? SmeterColors.muted : (online ? SmeterColors.success : SmeterColors.warn);
    final statusText = r == null
        ? (_failed ? 'Meter data unavailable' : 'Connecting to your meter...')
        : online
            ? 'Online · updates every 5s'
            : 'Offline · last seen ${relative(r.lastSeen)}';
    return Container(
      padding: const EdgeInsets.all(Space.lg),
      decoration: BoxDecoration(
        color: SmeterColors.surface,
        borderRadius: BorderRadius.circular(Radii.lg),
        border: Border.all(color: SmeterColors.line),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          _PulseDot(color: statusColor, pulsing: online),
          const SizedBox(width: Space.sm),
          Expanded(child: Text(statusText, style: SmeterText.caption(color: SmeterColors.inkSoft))),
          if (r != null && r.relayState.startsWith('disconnect'))
            Text('Supply off', style: SmeterText.caption(color: SmeterColors.danger)),
        ]),
        const SizedBox(height: Space.lg),
        Row(children: [
          _Gauge(label: 'Voltage', value: r?.volts, unit: 'V', digits: 0, icon: Icons.electric_bolt_rounded),
          _Gauge(label: 'Current', value: r?.amps, unit: 'A', digits: 1, icon: Icons.waves_rounded),
          _Gauge(label: 'Load', value: r?.kw, unit: 'kW', digits: 2, icon: Icons.speed_rounded),
        ]),
      ]),
    );
  }
}

class _PulseDot extends StatefulWidget {
  const _PulseDot({required this.color, required this.pulsing});
  final Color color;
  final bool pulsing;

  @override
  State<_PulseDot> createState() => _PulseDotState();
}

class _PulseDotState extends State<_PulseDot> with SingleTickerProviderStateMixin {
  late final _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final animate = widget.pulsing && !MediaQuery.of(context).disableAnimations;
    return SizedBox(
      width: 14,
      height: 14,
      child: AnimatedBuilder(
        animation: _c,
        builder: (_, _) => Stack(alignment: Alignment.center, children: [
          if (animate)
            Container(
              width: 6 + 8 * _c.value,
              height: 6 + 8 * _c.value,
              decoration: BoxDecoration(shape: BoxShape.circle, color: widget.color.withValues(alpha: 0.35 * (1 - _c.value))),
            ),
          Container(width: 8, height: 8, decoration: BoxDecoration(shape: BoxShape.circle, color: widget.color)),
        ]),
      ),
    );
  }
}

class _Gauge extends StatelessWidget {
  const _Gauge({required this.label, required this.value, required this.unit, required this.digits, required this.icon});

  final String label;
  final double? value;
  final String unit;
  final int digits;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(icon, size: 14, color: SmeterColors.primary),
          const SizedBox(width: 4),
          Text(label, style: SmeterText.caption()),
        ]),
        const SizedBox(height: 4),
        Text.rich(TextSpan(children: [
          TextSpan(text: value == null ? '-' : value!.toStringAsFixed(digits), style: SmeterText.figure(22)),
          TextSpan(text: ' $unit', style: SmeterText.caption()),
        ])),
      ]),
    );
  }
}
