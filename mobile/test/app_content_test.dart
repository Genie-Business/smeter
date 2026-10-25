import 'package:flutter_test/flutter_test.dart';
import 'package:smeter/core/app_content.dart';

void main() {
  test('parses admin-edited app content', () {
    final c = AppContent.fromJson({
      'onboarding': [
        {'title': 'Hello', 'caption': 'World'},
      ],
      'announcement': {'enabled': true, 'tone': 'warn', 'title': 'Maintenance', 'body': 'Tonight 10pm', 'audience': 'tenants'},
      'support': {'phone': '+2341', 'email': 'a@b.c', 'whatsapp': ''},
      'buy': {
        'presets': [500, 1500, -1],
      },
      'tokenHelp': [
        {'title': 'Step', 'body': 'Do it'},
      ],
    });
    expect(c.onboarding.single.title, 'Hello');
    expect(c.announcement.showTo(tenant: true), isTrue);
    expect(c.announcement.showTo(tenant: false), isFalse);
    expect(c.presets, [500.0, 1500.0]);
    expect(c.support.whatsapp, '');
    expect(c.tokenHelp.single.body, 'Do it');
  });

  test('falls back to defaults for missing or malformed fields', () {
    final c = AppContent.fromJson({'onboarding': 'nope', 'buy': {}});
    expect(c.onboarding.length, AppContent.defaults.onboarding.length);
    expect(c.presets, AppContent.defaults.presets);
    expect(c.announcement.showTo(tenant: true), isFalse);
  });
}
