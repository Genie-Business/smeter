import 'dart:math' as math;

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/format.dart';
import '../../core/models.dart';
import '../../shared/widgets.dart';
import '../../theme/smeter_theme.dart';
import 'tenant_actions.dart';
import 'tenant_repository.dart';

const _periods = [('day', 'Day'), ('week', 'Week'), ('month', 'Month'), ('year', 'Year')];

class UsageScreen extends ConsumerStatefulWidget {
  const UsageScreen({super.key});

  @override
  ConsumerState<UsageScreen> createState() => _UsageScreenState();
}

class _UsageScreenState extends ConsumerState<UsageScreen> {
  String _period = 'month';
  DateTime _date = DateTime.now();

  UsageArgs get _args => (period: _period, date: DateTime(_date.year, _date.month, _date.day));

  DateTime _shifted(int dir) => switch (_period) {
        'day' => _date.add(Duration(days: dir)),
        'week' => _date.add(Duration(days: 7 * dir)),
        'year' => DateTime(_date.year + dir, _date.month, 1),
        _ => DateTime(_date.year, _date.month + dir, 1),
      };

  bool get _canGoForward => !_shifted(1).isAfter(DateTime.now());

  void _shift(int dir) {
    final next = _shifted(dir);
    if (next.isAfter(DateTime.now())) return;
    HapticFeedback.selectionClick();
    setState(() => _date = next);
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2020),
      lastDate: DateTime.now(),
    );
    if (picked != null) setState(() => _date = picked);
  }

  @override
  Widget build(BuildContext context) {
    final report = ref.watch(usageProvider(_args));
    final manual = ref.watch(tenantDashboardProvider).value?.tenant.isManual ?? report.value?.fromPurchases ?? false;

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          PageTitle(
            manual ? 'Units bought' : 'Usage',
            subtitle: manual ? 'Based on your token purchases' : 'Energy your meter has recorded',
            trailing: IconButton.filledTonal(
              onPressed: _pickDate,
              tooltip: 'Pick a date',
              icon: const Icon(Icons.calendar_month_rounded),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: Space.lg),
            child: _Segmented(
              value: _period,
              onChanged: (v) => setState(() {
                _period = v;
                _date = DateTime.now();
              }),
            ),
          ),
          Expanded(
            child: AsyncBody<UsageReport>(
              value: report,
              skeleton: const SkeletonList(rows: 3),
              onRefresh: () => ref.refresh(usageProvider(_args).future),
              data: (r) => ListView(
                padding: const EdgeInsets.only(top: Space.md, bottom: Space.xxxl),
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: Space.sm),
                    child: Row(children: [
                      IconButton(
                        onPressed: () => _shift(-1),
                        icon: const Icon(Icons.chevron_left_rounded),
                        tooltip: 'Previous',
                      ),
                      Expanded(child: Text(r.label, textAlign: TextAlign.center, style: SmeterText.title3())),
                      IconButton(
                        onPressed: _canGoForward ? () => _shift(1) : null,
                        icon: const Icon(Icons.chevron_right_rounded),
                        tooltip: 'Next',
                      ),
                    ]),
                  ),
                  _ChartCard(report: r),
                  const SizedBox(height: Space.md),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: Space.lg),
                    child: r.fromPurchases ? _PurchaseStats(r: r) : _MeterStats(r: r, period: _period),
                  ),
                  InfoBanner(icon: Icons.info_outline_rounded, tone: Tone.neutral, text: r.note),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(Space.lg, Space.xl, Space.lg, 0),
                    child: FilledButton.icon(
                      onPressed: () async {
                        final me = await ref.read(tenantProfileProvider.future);
                        if (context.mounted) await openBuyPower(context, ref, me);
                      },
                      icon: const Icon(Icons.bolt_rounded),
                      label: const Text('Buy power'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ]),
      ),
    );
  }
}

class _Segmented extends StatelessWidget {
  const _Segmented({required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(color: SmeterColors.line.withValues(alpha: 0.6), borderRadius: BorderRadius.circular(Radii.md)),
      child: Row(children: [
        for (final (id, label) in _periods)
          Expanded(
            child: Semantics(
              selected: id == value,
              button: true,
              child: GestureDetector(
                onTap: () {
                  HapticFeedback.selectionClick();
                  onChanged(id);
                },
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  height: 40,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: id == value ? SmeterColors.surface : Colors.transparent,
                    borderRadius: BorderRadius.circular(Radii.sm),
                    boxShadow: id == value
                        ? const [BoxShadow(color: Color(0x1A000000), blurRadius: 6, offset: Offset(0, 2))]
                        : null,
                  ),
                  child: Text(label,
                      style: GoogleFonts.dmSans(
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                        color: id == value ? SmeterColors.primary : SmeterColors.inkSoft,
                      )),
                ),
              ),
            ),
          ),
      ]),
    );
  }
}

class _ChartCard extends StatelessWidget {
  const _ChartCard({required this.report});

  final UsageReport report;

  @override
  Widget build(BuildContext context) {
    final pts = report.points;
    final maxY = pts.fold<double>(0, (m, p) => math.max(m, p.kwh ?? 0));
    final top = maxY <= 0 ? 1.0 : maxY * 1.2;
    final every = math.max(1, (pts.length / 8).ceil());
    final lastIndex = pts.lastIndexWhere((p) => p.kwh != null);

    Widget bottomLabel(double v, TitleMeta meta) {
      final i = v.toInt();
      if (i < 0 || i >= pts.length || i % every != 0) return const SizedBox.shrink();
      return Padding(padding: const EdgeInsets.only(top: 6), child: Text(pts[i].label, style: SmeterText.caption()));
    }

    final titles = FlTitlesData(
      topTitles: const AxisTitles(),
      rightTitles: const AxisTitles(),
      leftTitles: AxisTitles(
        sideTitles: SideTitles(
          showTitles: true,
          reservedSize: 34,
          getTitlesWidget: (v, meta) => v == meta.max
              ? const SizedBox.shrink()
              : Text(v.toStringAsFixed(v < 10 ? 1 : 0), style: SmeterText.caption()),
        ),
      ),
      bottomTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, interval: 1, reservedSize: 24, getTitlesWidget: bottomLabel)),
    );
    final grid = FlGridData(
      drawVerticalLine: false,
      getDrawingHorizontalLine: (_) => const FlLine(color: SmeterColors.line, strokeWidth: 1, dashArray: [4, 4]),
    );

    return AppCard(
      padding: const EdgeInsets.fromLTRB(Space.md, Space.lg, Space.lg, Space.md),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
          padding: const EdgeInsets.only(left: Space.xs),
          child: Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
            Text(units(report.totalKwh), style: SmeterText.figure(26)),
            const SizedBox(width: 6),
            Text('kWh ${report.fromPurchases ? 'bought' : 'used'}', style: SmeterText.small()),
          ]),
        ),
        const SizedBox(height: Space.lg),
        SizedBox(
          height: 180,
          child: maxY <= 0
              ? Center(
                  child: Text(report.fromPurchases ? 'No purchases in this period' : 'No readings for this period yet',
                      style: SmeterText.small()),
                )
              : report.fromPurchases
                  ? BarChart(BarChartData(
                      maxY: top,
                      gridData: grid,
                      borderData: FlBorderData(show: false),
                      titlesData: titles,
                      barTouchData: BarTouchData(
                        touchTooltipData: BarTouchTooltipData(
                          getTooltipColor: (_) => SmeterColors.ink,
                          getTooltipItem: (g, _, rod, _) => BarTooltipItem(
                            '${pts[g.x].label}\n${rod.toY.toStringAsFixed(2)} kWh',
                            const TextStyle(color: Colors.white, fontSize: 12),
                          ),
                        ),
                      ),
                      barGroups: [
                        for (var i = 0; i < pts.length; i++)
                          BarChartGroupData(x: i, barRods: [
                            BarChartRodData(
                              toY: pts[i].kwh ?? 0,
                              width: pts.length > 20 ? 6 : 14,
                              color: SmeterColors.primary,
                              borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                            ),
                          ]),
                      ],
                    ))
                  : LineChart(LineChartData(
                      minX: 0,
                      maxX: (pts.length - 1).toDouble(),
                      minY: 0,
                      maxY: top,
                      gridData: grid,
                      borderData: FlBorderData(show: false),
                      titlesData: titles,
                      lineTouchData: LineTouchData(
                        touchTooltipData: LineTouchTooltipData(
                          getTooltipColor: (_) => SmeterColors.ink,
                          getTooltipItems: (spots) => spots
                              .map((s) => LineTooltipItem(
                                    '${pts[s.x.toInt()].label}\n${s.y.toStringAsFixed(2)} kWh',
                                    const TextStyle(color: Colors.white, fontSize: 12),
                                  ))
                              .toList(),
                        ),
                      ),
                      lineBarsData: [
                        LineChartBarData(
                          spots: [
                            for (var i = 0; i < pts.length; i++)
                              if (pts[i].kwh != null) FlSpot(i.toDouble(), pts[i].kwh!),
                          ],
                          isCurved: true,
                          preventCurveOverShooting: true,
                          color: SmeterColors.primary,
                          barWidth: 3,
                          belowBarData: BarAreaData(
                            show: true,
                            gradient: LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [SmeterColors.primary.withValues(alpha: 0.22), SmeterColors.primary.withValues(alpha: 0)],
                            ),
                          ),
                          dotData: FlDotData(
                            checkToShowDot: (spot, _) => spot.x.toInt() == lastIndex,
                            getDotPainter: (_, _, _, _) => FlDotCirclePainter(
                              radius: 5,
                              color: SmeterColors.green,
                              strokeWidth: 2,
                              strokeColor: Colors.white,
                            ),
                          ),
                        ),
                      ],
                    )),
        ),
      ]),
    );
  }
}

String _change(double? pct) {
  if (pct == null) return 'No earlier data';
  final arrow = pct > 0 ? '↑' : (pct < 0 ? '↓' : '→');
  return '$arrow ${pct.abs().toStringAsFixed(0)}% vs before';
}

class _MeterStats extends StatelessWidget {
  const _MeterStats({required this.r, required this.period});

  final UsageReport r;
  final String period;

  @override
  Widget build(BuildContext context) {
    final per = switch (period) { 'day' => 'hour', 'year' => 'month', _ => 'day' };
    final prev = switch (period) { 'day' => 'Yesterday', 'week' => 'Last week', 'year' => 'Last year', _ => 'Last month' };
    final next = switch (period) { 'day' => 'Tomorrow', 'week' => 'Next week', 'year' => 'Next year', _ => 'Next month' };
    return _Grid(children: [
      StatTile(label: 'Avg per $per', value: kwh(r.avgUsageKwh), icon: Icons.monitor_heart_outlined, caption: _change(r.avgUsageChangePct)),
      StatTile(label: 'Avg cost per $per', value: naira(r.avgCost), icon: Icons.payments_outlined, caption: _change(r.avgCostChangePct)),
      StatTile(label: prev, value: kwh(r.previousTotalKwh), icon: Icons.history_rounded),
      StatTile(label: '$next (projected)', value: kwh(r.projectedNextKwh), icon: Icons.trending_up_rounded),
    ]);
  }
}

class _PurchaseStats extends StatelessWidget {
  const _PurchaseStats({required this.r});

  final UsageReport r;

  @override
  Widget build(BuildContext context) => _Grid(children: [
        StatTile(label: 'Units bought', value: kwh(r.totalKwh), icon: Icons.bolt_rounded, caption: _change(r.avgUsageChangePct)),
        StatTile(label: 'Spent', value: naira(r.avgCost), icon: Icons.payments_outlined, caption: _change(r.avgCostChangePct)),
        StatTile(label: 'Purchases', value: '${r.purchasesCount}', icon: Icons.receipt_long_outlined),
        StatTile(label: 'Previous period', value: kwh(r.previousTotalKwh), icon: Icons.history_rounded),
      ]);
}

class _Grid extends StatelessWidget {
  const _Grid({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Column(children: [
        Row(children: [Expanded(child: children[0]), const SizedBox(width: Space.sm), Expanded(child: children[1])]),
        const SizedBox(height: Space.sm),
        Row(children: [Expanded(child: children[2]), const SizedBox(width: Space.sm), Expanded(child: children[3])]),
      ]);
}
