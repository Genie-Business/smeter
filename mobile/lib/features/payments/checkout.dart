import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../core/env.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../shared/widgets.dart';
import '../../theme/smeter_theme.dart';

/// Payment channels the gateway offers (design: "Pay With").
enum PayChannel {
  card('card', 'Card', 'Visa, Mastercard or Verve', Icons.credit_card_rounded),
  transfer('bank_transfer', 'Bank transfer', 'Pay from your bank app', Icons.account_balance_outlined),
  ussd('ussd', 'USSD', 'Dial a code, no internet needed', Icons.dialpad_rounded);

  const PayChannel(this.api, this.label, this.hint, this.icon);
  final String api;
  final String label;
  final String hint;
  final IconData icon;
}

/// Hosted checkout in a web view. Pops when the gateway redirects back to the
/// app scheme (`smeter://payment?reference=...`) or the user closes it.
class CheckoutWebView extends StatefulWidget {
  const CheckoutWebView({super.key, required this.url});

  final String url;

  @override
  State<CheckoutWebView> createState() => _CheckoutWebViewState();
}

class _CheckoutWebViewState extends State<CheckoutWebView> {
  late final WebViewController _controller;
  int _progress = 0;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(
        onProgress: (p) => mounted ? setState(() => _progress = p) : null,
        onNavigationRequest: (req) {
          if (req.url.startsWith('${Env.appScheme}://')) {
            Navigator.of(context).pop(true);
            return NavigationDecision.prevent;
          }
          return NavigationDecision.navigate;
        },
      ))
      ..loadRequest(Uri.parse(widget.url));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Row(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.lock_rounded, size: 18, color: SmeterColors.success),
          const SizedBox(width: 8),
          Text('Secure checkout', style: SmeterText.title3()),
        ]),
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          tooltip: 'Close checkout',
          onPressed: () => Navigator.of(context).pop(false),
        ),
        bottom: _progress < 100
            ? PreferredSize(
                preferredSize: const Size.fromHeight(3),
                child: LinearProgressIndicator(value: _progress / 100, minHeight: 3),
              )
            : null,
      ),
      body: WebViewWidget(controller: _controller),
    );
  }
}

/// After checkout: polls the purchase until it is final, then shows the
/// receipt, with the token front and centre for manual-token meters.
class PaymentStatusScreen extends StatefulWidget {
  const PaymentStatusScreen({super.key, required this.reference, required this.load, this.deliveryMode = 'ota'});

  final String reference;
  final Future<Purchase> Function(String reference) load;
  final String deliveryMode;

  @override
  State<PaymentStatusScreen> createState() => _PaymentStatusScreenState();
}

class _PaymentStatusScreenState extends State<PaymentStatusScreen> {
  Purchase? _purchase;
  Object? _error;
  Timer? _timer;
  int _polls = 0;

  @override
  void initState() {
    super.initState();
    _poll();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _poll() async {
    try {
      final p = await widget.load(widget.reference);
      if (!mounted) return;
      final wasFinal = _purchase?.isFinal ?? false;
      setState(() {
        _purchase = p;
        _error = null;
      });
      if (p.status == 'vended' && !wasFinal) HapticFeedback.heavyImpact();
      _polls++;
      // Pending for up to ~2 minutes (bank transfers can lag), then stop.
      if (!p.isFinal && _polls < 40) _timer = Timer(const Duration(seconds: 3), _poll);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e);
      if (_polls++ < 40) _timer = Timer(const Duration(seconds: 4), _poll);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _purchase;
    return Scaffold(
      appBar: AppBar(automaticallyImplyLeading: false, title: const Text('Payment')),
      body: p == null
          ? (_error != null
              ? ErrorState(message: '$_error', onRetry: _poll)
              : const Center(child: CircularProgressIndicator()))
          : ListView(
              padding: const EdgeInsets.only(bottom: Space.xxxl),
              children: [ReceiptBody(purchase: p, deliveryMode: widget.deliveryMode)],
            ),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(Space.lg, Space.sm, Space.lg, Space.lg),
        child: FilledButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Done')),
      ),
    );
  }
}

/// Status hero + token + details. Shared by the post-payment screen and the
/// purchase details screen.
class ReceiptBody extends StatelessWidget {
  const ReceiptBody({super.key, required this.purchase, required this.deliveryMode, this.address});

  final Purchase purchase;
  final String deliveryMode;
  final String? address;

  @override
  Widget build(BuildContext context) {
    final p = purchase;
    final manualDelivery = p.delivery == 'manual';
    final (icon, tone, title, message) = switch (p.status) {
      'vended' when manualDelivery => (
          Icons.vpn_key_rounded,
          Tone.success,
          'Your token is ready',
          deliveryMode == 'manual'
              ? 'Type it into your meter remote to load your units.'
              : 'Your meter was offline, so enter this token on the meter remote.'
        ),
      'vended' => (
          Icons.bolt_rounded,
          Tone.success,
          'Power on the way',
          'Units are being sent to your meter and usually arrive within seconds.'
        ),
      'failed' => (
          Icons.close_rounded,
          Tone.danger,
          'Payment not completed',
          p.failureReason ?? 'No money was taken. You can try again.'
        ),
      'paid' || 'vending' => (
          Icons.autorenew_rounded,
          Tone.info,
          'Generating your token',
          'Payment received. This takes a few seconds.'
        ),
      _ => (
          Icons.schedule_rounded,
          Tone.warn,
          'Confirming payment',
          'Waiting for your bank. Transfers can take a minute.'
        ),
    };
    final (fg, bg) = toneColors(tone);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const SizedBox(height: Space.xl),
      Center(
        child: TweenAnimationBuilder<double>(
          key: ValueKey(p.status),
          tween: Tween(begin: 0.6, end: 1),
          duration: const Duration(milliseconds: 420),
          curve: Curves.elasticOut,
          builder: (_, s, child) => Transform.scale(scale: s, child: child),
          child: Container(
            width: 76,
            height: 76,
            decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
            child: Icon(icon, color: fg, size: 38),
          ),
        ),
      ),
      const SizedBox(height: Space.lg),
      Text(title, textAlign: TextAlign.center, style: SmeterText.title1()),
      Padding(
        padding: const EdgeInsets.fromLTRB(Space.xxxl, Space.xs, Space.xxxl, 0),
        child: Text(message, textAlign: TextAlign.center, style: SmeterText.small()),
      ),
      const SizedBox(height: Space.xl),
      Text(naira(p.amount), textAlign: TextAlign.center, style: SmeterText.display()),
      if (p.units != null)
        Text('${units(p.units)} kWh', textAlign: TextAlign.center, style: SmeterText.title3(color: SmeterColors.success)),
      if (p.token != null) ...[
        const SizedBox(height: Space.xl),
        AppCard(
          color: manualDelivery ? SmeterColors.primaryTint : SmeterColors.surface,
          borderColor: manualDelivery ? SmeterColors.primarySoft : SmeterColors.line,
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(manualDelivery ? 'YOUR TOKEN' : 'BACKUP TOKEN', textAlign: TextAlign.center, style: SmeterText.overline()),
            const SizedBox(height: Space.md),
            TokenDisplay(token: p.token!, units: p.units),
          ]),
        ),
        if (manualDelivery)
          const Padding(
            padding: EdgeInsets.fromLTRB(Space.xl, Space.xl, Space.xl, 0),
            child: HowToLoadToken(),
          ),
      ],
      const SectionHeader('Details'),
      AppCard(
        child: Column(children: [
          KeyValueRow('Unit price', naira(p.unitPrice)),
          if (p.debtRecovered > 0) KeyValueRow('Debt recovered', naira(p.debtRecovered)),
          if (p.fee > 0 && p.feeBearer == 'tenant') KeyValueRow('Service fee', naira(p.fee)),
          KeyValueRow('Total paid', naira(p.total)),
          KeyValueRow('Date', dateTime(p.vendedAt ?? p.createdAt)),
          if (address != null) KeyValueRow('Address', address!),
          KeyValueRow('Meter', p.meterId),
          KeyValueRow('Reference', p.reference),
          if (p.receiptId != null && p.receiptId!.isNotEmpty) KeyValueRow('Receipt no.', p.receiptId!),
        ]),
      ),
    ]);
  }
}

/// Open checkout, then the status screen. Returns once the user is done.
Future<void> runCheckout(
  BuildContext context,
  Checkout checkout,
  Future<Purchase> Function(String reference) load, {
  String deliveryMode = 'ota',
}) async {
  await Navigator.of(context).push<bool>(
    MaterialPageRoute(fullscreenDialog: true, builder: (_) => CheckoutWebView(url: checkout.authorizationUrl)),
  );
  if (!context.mounted) return;
  // Even if the user closed the web view, the payment may have gone through.
  await Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => PaymentStatusScreen(reference: checkout.reference, load: load, deliveryMode: deliveryMode),
    ),
  );
}
