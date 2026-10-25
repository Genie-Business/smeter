import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../theme/smeter_theme.dart';
import 'auth_card.dart';

/// First auth screen: "Your phone, your home's power hub."
class WelcomeScreen extends StatelessWidget {
  const WelcomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return AuthCardScaffold(
      children: [
        const SizedBox(height: 70),
        const AuthHeadline("Your phone, your\nhome's power hub."),
        const SizedBox(height: 90),
        FilledButton(onPressed: () => context.push('/account-type?intent=signup'), child: const Text('Get Started')),
        const OrDivider(),
        AuthSwitchLink(
          prompt: 'Already registered?',
          action: 'Login',
          onTap: () => context.push('/account-type?intent=login'),
        ),
      ],
    );
  }
}

/// Account type picker ("Kindly select the account type to login as"): Admin or Tenants.
class AccountTypeScreen extends StatelessWidget {
  const AccountTypeScreen({super.key, required this.signup});

  final bool signup;

  @override
  Widget build(BuildContext context) {
    return AuthCardScaffold(
      onBack: () => context.pop(),
      children: [
        AuthHeadline(
          signup ? 'Kindly select the\naccount type to\nsign up as' : 'Kindly select the\naccount type to\nlogin as',
        ),
        const SizedBox(height: 40),
        FilledButton.icon(
          onPressed: () => context.push(signup ? '/landlord/register' : '/landlord/login'),
          icon: const Icon(Icons.home_outlined),
          label: const Text('Admin'),
        ),
        const SizedBox(height: 6),
        Text(
          'Property owners & managers',
          textAlign: TextAlign.center,
          style: TextStyle(color: SmeterColors.ink.withValues(alpha: 0.6), fontSize: 12),
        ),
        const SizedBox(height: 40),
        FilledButton.icon(
          onPressed: () => context.push('/tenant/login'),
          icon: const Icon(Icons.people_alt_outlined),
          label: const Text('Tenants'),
        ),
        const SizedBox(height: 6),
        Text(
          'Sign in with your meter number',
          textAlign: TextAlign.center,
          style: TextStyle(color: SmeterColors.ink.withValues(alpha: 0.6), fontSize: 12),
        ),
        const OrDivider(),
        signup
            ? AuthSwitchLink(
                prompt: 'Already registered?',
                action: 'Login',
                onTap: () => context.pushReplacement('/account-type?intent=login'),
              )
            : AuthSwitchLink(
                prompt: 'New to smeter?',
                action: 'Get Started',
                onTap: () => context.pushReplacement('/account-type?intent=signup'),
              ),
      ],
    );
  }
}
