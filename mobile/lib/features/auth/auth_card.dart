import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../theme/smeter_theme.dart';

/// Frosted card over the grayscale background used by the Authentication,
/// account-type, admin login and admin registration designs.
class AuthCardScaffold extends StatelessWidget {
  const AuthCardScaffold({super.key, required this.children, this.onBack, this.showLegal = true});

  final List<Widget> children;
  final VoidCallback? onBack;
  final bool showLegal;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF2A2A2A),
      body: Stack(
        fit: StackFit.expand,
        children: [
          Image.asset('assets/images/auth_bg.jpg', fit: BoxFit.cover),
          SafeArea(
            child: LayoutBuilder(
              builder: (context, constraints) => SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 26, 16, 16),
                child: ConstrainedBox(
                  constraints: BoxConstraints(minHeight: constraints.maxHeight - 42),
                  child: Column(
                    children: [
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.fromLTRB(22, 22, 22, 26),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(12),
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [
                              Colors.white.withValues(alpha: 0.94),
                              const Color(0xFFE9D4EC).withValues(alpha: 0.93),
                              const Color(0xFFC8A2CC).withValues(alpha: 0.95),
                            ],
                          ),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Row(
                              children: [
                                if (onBack != null)
                                  IconButton(
                                    onPressed: onBack,
                                    icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 18),
                                    color: SmeterColors.primary,
                                    tooltip: 'Back',
                                  ),
                                Text('smeter', style: SmeterText.wordmark()),
                              ],
                            ),
                            ...children,
                          ],
                        ),
                      ),
                      if (showLegal) ...[const SizedBox(height: 28), const LegalFooter()],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class LegalFooter extends StatelessWidget {
  const LegalFooter({super.key, this.prefix = 'By Signing In, you agree to our '});

  final String prefix;

  @override
  Widget build(BuildContext context) {
    const link = TextStyle(color: SmeterColors.green);
    return Text.rich(
      TextSpan(
        style: GoogleFonts.montserrat(color: Colors.white, fontSize: 11, height: 1.5),
        children: [
          TextSpan(text: prefix),
          const TextSpan(text: 'Privacy Policy', style: link),
          const TextSpan(text: ' and '),
          const TextSpan(text: 'Terms and Conditions', style: link),
        ],
      ),
      textAlign: TextAlign.center,
    );
  }
}

class AuthHeadline extends StatelessWidget {
  const AuthHeadline(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 22, bottom: 24),
    child: Text(
      text,
      textAlign: TextAlign.center,
      style: GoogleFonts.dmSans(
        fontSize: 22,
        fontWeight: FontWeight.w700,
        color: const Color(0xFF24262E),
        height: 1.35,
      ),
    ),
  );
}

class OrDivider extends StatelessWidget {
  const OrDivider({super.key});

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 16),
    child: Row(
      children: [
        const Expanded(child: Divider(color: SmeterColors.navySoft)),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 18),
          child: Text('Or', style: GoogleFonts.montserrat(color: SmeterColors.navySoft)),
        ),
        const Expanded(child: Divider(color: SmeterColors.navySoft)),
      ],
    ),
  );
}

class AuthSwitchLink extends StatelessWidget {
  const AuthSwitchLink({super.key, required this.prompt, required this.action, required this.onTap});

  final String prompt;
  final String action;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
      Text(prompt, style: GoogleFonts.montserrat(color: const Color(0xFF3B3F48), fontSize: 14)),
      TextButton(
        onPressed: onTap,
        style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 6), minimumSize: const Size(0, 36)),
        child: Text(
          action,
          style: GoogleFonts.montserrat(color: SmeterColors.navy, fontWeight: FontWeight.w700, fontSize: 14),
        ),
      ),
    ],
  );
}
