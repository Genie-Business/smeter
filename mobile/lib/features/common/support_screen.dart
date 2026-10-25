import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/api_client.dart';
import '../../core/app_content.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/session.dart';
import '../../shared/widgets.dart';
import '../../theme/smeter_theme.dart';
import '../landlord/landlord_repository.dart';

const supportCategories = {
  'payment': 'Payment or vending',
  'billing': 'Billing or pricing',
  'hardware': 'Meter hardware',
  'connectivity': 'Meter offline / no data',
  'tamper': 'Tampering or safety',
  'other': 'Something else',
};

final supportTicketsProvider = FutureProvider.autoDispose<List<SupportTicket>>((ref) async {
  final r = await ref.watch(apiClientProvider).get('/v1/support/tickets');
  return (r['data'] as List).map((t) => SupportTicket.fromJson(Map<String, dynamic>.from(t as Map))).toList();
});

/// SM-SUP-001: report an issue; tickets get an id and go to finance or technical.
class SupportScreen extends ConsumerWidget {
  const SupportScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tickets = ref.watch(supportTicketsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Help & support')),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: SmeterColors.primary,
        foregroundColor: Colors.white,
        onPressed: () async {
          final created = await Navigator.of(context)
              .push<bool>(MaterialPageRoute(builder: (_) => const NewTicketScreen()));
          if (created == true) ref.invalidate(supportTicketsProvider);
        },
        icon: const Icon(Icons.add_comment_outlined),
        label: const Text('Report an issue'),
      ),
      body: AsyncBody<List<SupportTicket>>(
        value: tickets,
        onRefresh: () => ref.refresh(supportTicketsProvider.future),
        data: (list) => ListView(
          padding: const EdgeInsets.only(bottom: 96),
          children: [
            const _ContactCard(),
            if (list.isEmpty)
              const EmptyState(
                icon: Icons.support_agent_rounded,
                title: 'How can we help?',
                message: 'Report a payment, vending or meter problem and our team will get back to you.',
              )
            else ...[
              const SectionHeader('Your tickets'),
              AppCard(
                padding: const EdgeInsets.symmetric(vertical: Space.xs),
                child: Column(
                  children: [
                    for (final (i, t) in list.indexed) ...[
                      if (i > 0) const Divider(),
                      ListTile(
                        title: Text(
                          '${t.ticketRef} · ${supportCategories[t.category] ?? t.category}',
                          style: GoogleFonts.dmSans(fontWeight: FontWeight.w700, fontSize: 14.5),
                        ),
                        subtitle: Text(
                          '${t.description}\nMeter ${t.meterId} · ${shortDate(t.createdAt)} · ${t.department} team',
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                        ),
                        isThreeLine: true,
                        trailing: Pill(
                          t.status.replaceAll('_', ' '),
                          tone: t.status == 'resolved' ? Tone.success : Tone.warn,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Phone / WhatsApp / email, editable from the admin dashboard.
class _ContactCard extends ConsumerWidget {
  const _ContactCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = appContentOf(ref).support;
    Widget row(IconData icon, String label, String value) => ListTile(
      leading: Icon(icon, color: SmeterColors.primary),
      title: Text(label, style: SmeterText.bodyStrong()),
      subtitle: Text(value),
      trailing: const Icon(Icons.copy_rounded, size: 18),
      onTap: () => copyText(context, value, label),
    );
    return Padding(
      padding: const EdgeInsets.only(top: Space.md),
      child: AppCard(
        padding: const EdgeInsets.symmetric(vertical: Space.xs),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(Space.lg, Space.md, Space.lg, 0),
              child: Row(
                children: [
                  Expanded(child: Text('Talk to us', style: SmeterText.title3())),
                  Text('Tap to copy', style: SmeterText.caption()),
                ],
              ),
            ),
            if (s.phone.isNotEmpty) row(Icons.call_outlined, 'Phone', s.phone),
            if (s.whatsapp.isNotEmpty) row(Icons.chat_outlined, 'WhatsApp', s.whatsapp),
            if (s.email.isNotEmpty) row(Icons.mail_outline_rounded, 'Email', s.email),
          ],
        ),
      ),
    );
  }
}

class NewTicketScreen extends ConsumerStatefulWidget {
  const NewTicketScreen({super.key});

  @override
  ConsumerState<NewTicketScreen> createState() => _NewTicketScreenState();
}

class _NewTicketScreenState extends ConsumerState<NewTicketScreen> {
  String _category = 'payment';
  String? _meterId;
  final _description = TextEditingController();

  @override
  void dispose() {
    _description.dispose();
    super.dispose();
  }

  Future<void> _submit(bool isLandlord) async {
    if (isLandlord && _meterId == null) {
      showError(context, ApiException('Select the meter this is about'));
      return;
    }
    try {
      final r = await ref.read(apiClientProvider).post('/v1/support/tickets', {
        'category': _category,
        'description': _description.text.trim(),
        'meterId': ?_meterId,
      });
      if (!mounted) return;
      showInfo(context, 'Ticket ${(r['ticket'] as Map)['ticketRef']} created. We\'ll be in touch.');
      Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isLandlord = ref.watch(sessionProvider).role == Role.landlord;
    final meters = isLandlord ? ref.watch(metersProvider).value ?? const <Meter>[] : const <Meter>[];
    return Scaffold(
      appBar: AppBar(title: const Text('Report an issue')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          DropdownButtonFormField<String>(
            initialValue: _category,
            decoration: const InputDecoration(labelText: 'Category'),
            items: [for (final e in supportCategories.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
            onChanged: (v) => setState(() => _category = v ?? _category),
          ),
          if (isLandlord) ...[
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              initialValue: _meterId,
              decoration: const InputDecoration(labelText: 'Meter'),
              items: [for (final m in meters) DropdownMenuItem(value: m.meterId, child: Text(m.label))],
              onChanged: (v) => setState(() => _meterId = v),
            ),
          ],
          const SizedBox(height: 16),
          TextField(
            controller: _description,
            minLines: 5,
            maxLines: 10,
            maxLength: 2000,
            decoration: const InputDecoration(
              labelText: 'What happened?',
              alignLabelWithHint: true,
              hintText: 'e.g. I paid ₦5,000 at 2pm but my meter did not load units.',
            ),
          ),
          const SizedBox(height: 16),
          BusyButton(label: 'Submit', onPressed: () => _submit(isLandlord)),
        ],
      ),
    );
  }
}
