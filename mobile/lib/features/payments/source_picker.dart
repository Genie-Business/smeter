import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../core/models.dart';
import '../../theme/smeter_theme.dart';

/// Colour a power source is drawn in: the main supply in the brand colour, the second in blue.
Color sourceColor(String key) => key == 'b' ? SmeterColors.info : SmeterColors.primary;

/// On a dual-source meter, ask which supply the units are for. [prices] maps source key → ₦/kWh.
Future<PowerSource?> pickPowerSource(BuildContext context, List<PowerSource> options, Map<String, double> prices) {
  return showModalBottomSheet<PowerSource>(
    context: context,
    builder: (ctx) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Space.xl, 0, Space.xl, Space.sm),
          child: Text('Buy units for which supply?', style: SmeterText.title2()),
        ),
        for (final s in options)
          ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: Space.xl, vertical: 2),
            leading: CircleAvatar(
              backgroundColor: sourceColor(s.key).withValues(alpha: 0.12),
              child: Icon(s.key == 'b' ? Icons.bolt_rounded : Icons.power_rounded, color: sourceColor(s.key)),
            ),
            title: Text(s.label),
            subtitle: Text('${naira(prices[s.key] ?? 0)} per kWh'),
            onTap: () => Navigator.of(ctx).pop(s),
          ),
        const SizedBox(height: Space.md),
      ]),
    ),
  );
}
