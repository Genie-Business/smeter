import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../shared/widgets.dart';
import '../../theme/smeter_theme.dart';
import 'auth_repository.dart';

/// Tenant login from the design: meter number, then a code sent to the phone
/// the property owner registered for that meter.
class TenantLoginScreen extends ConsumerStatefulWidget {
  const TenantLoginScreen({super.key});

  @override
  ConsumerState<TenantLoginScreen> createState() => _TenantLoginScreenState();
}

class _TenantLoginScreenState extends ConsumerState<TenantLoginScreen> {
  final _meter = TextEditingController();
  final _code = TextEditingController();
  String? _sentTo;

  @override
  void dispose() {
    _meter.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    final meterId = _meter.text.replaceAll(RegExp(r'\D'), '');
    if (meterId.length < 6) {
      showInfo(context, 'Enter the meter number printed on your meter');
      return;
    }
    try {
      final sent = await ref.read(authRepositoryProvider).startTenant(meterId);
      if (sent.devCode != null) _code.text = sent.devCode!;
      setState(() => _sentTo = sent.sentTo);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _verify() async {
    try {
      await ref.read(authRepositoryProvider).verifyTenant(_meter.text.replaceAll(RegExp(r'\D'), ''), _code.text.trim());
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bodyStyle = GoogleFonts.montserrat(color: Colors.white, fontSize: 16, height: 1.6, letterSpacing: 0.3);
    final verifying = _sentTo != null;
    return Scaffold(
      backgroundColor: SmeterColors.primary,
      body: CustomScrollView(
        slivers: [
          SliverToBoxAdapter(
            child: Stack(
              children: [
                AspectRatio(
                  aspectRatio: 375 / 300,
                  child: Image.asset('assets/images/tenant_login.jpg', fit: BoxFit.cover),
                ),
                // Rounded top edge of the purple panel, overlapping the photo.
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: -1,
                  height: 31,
                  child: Container(
                    decoration: const BoxDecoration(
                      color: SmeterColors.primary,
                      borderRadius: BorderRadius.only(topLeft: Radius.circular(30), topRight: Radius.circular(30)),
                    ),
                  ),
                ),
                SafeArea(
                  child: IconButton(
                    onPressed: () => verifying ? setState(() => _sentTo = null) : context.pop(),
                    icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white),
                    tooltip: 'Back',
                  ),
                ),
              ],
            ),
          ),
          SliverFillRemaining(
            hasScrollBody: false,
            child: Container(
              color: SmeterColors.primary,
              padding: const EdgeInsets.fromLTRB(18, 0, 18, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Welcome',
                    style: GoogleFonts.montserrat(
                      color: Colors.white,
                      fontWeight: FontWeight.w600,
                      fontSize: 16,
                      letterSpacing: 0.8,
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text(
                    verifying ? 'Enter the 6-digit code we sent to $_sentTo.' : 'Turn your smartphone into your home’s smart power hub. Monitor usage, buy units, and manage power, all in one place',
                    style: bodyStyle,
                  ),
                  const SizedBox(height: 40),
                  if (!verifying) ...[
                    Text(
                      'Please enter the meter number you were given',
                      style: GoogleFonts.montserrat(color: Colors.white, fontSize: 11, letterSpacing: 0.6),
                    ),
                    const SizedBox(height: 14),
                    LightField(
                      controller: _meter,
                      label: 'Meter Number',
                      keyboardType: TextInputType.number,
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(20)],
                      textInputAction: TextInputAction.done,
                    ),
                  ] else ...[
                    OtpField(controller: _code, light: true, onCompleted: (_) => _verify()),
                    Align(
                      alignment: Alignment.centerRight,
                      child: TextButton(
                        onPressed: _start,
                        child: const Text('Resend code', style: TextStyle(color: Colors.white)),
                      ),
                    ),
                  ],
                  const Spacer(),
                  const SizedBox(height: 32),
                  BusyButton(
                    label: verifying ? 'Verify' : 'Continue',
                    inverted: true,
                    onPressed: verifying ? _verify : _start,
                  ),
                  const SizedBox(height: 14),
                  Center(
                    child: Text.rich(
                      TextSpan(
                        style: GoogleFonts.montserrat(color: Colors.white, fontSize: 12),
                        children: const [
                          TextSpan(text: 'By enrolling you agree with our '),
                          TextSpan(
                            text: 'Terms and Conditions',
                            style: TextStyle(color: SmeterColors.green),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
