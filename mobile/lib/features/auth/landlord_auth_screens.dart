import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../shared/widgets.dart';
import 'auth_card.dart';
import 'auth_repository.dart';

class LandlordRegisterScreen extends ConsumerStatefulWidget {
  const LandlordRegisterScreen({super.key});

  @override
  ConsumerState<LandlordRegisterScreen> createState() => _LandlordRegisterScreenState();
}

class _LandlordRegisterScreenState extends ConsumerState<LandlordRegisterScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _password = TextEditingController();
  bool _hide = true;

  @override
  void dispose() {
    for (final c in [_name, _email, _phone, _password]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    try {
      await ref
          .read(authRepositoryProvider)
          .registerLandlord(
            fullName: _name.text.trim(),
            email: _email.text.trim(),
            phone: _phone.text.trim(),
            password: _password.text,
          );
      // Router redirect takes over once the session is signed in.
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AuthCardScaffold(
      onBack: () => context.pop(),
      children: [
        const AuthHeadline('Create your\nproperty owner account'),
        Form(
          key: _form,
          child: AutofillGroup(
            child: Column(
              children: [
                TextFormField(
                  controller: _name,
                  textCapitalization: TextCapitalization.words,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.name],
                  decoration: const InputDecoration(labelText: 'Full name (as on your bank account)'),
                  validator: (v) => (v ?? '').trim().length < 2 ? 'Enter your full name' : null,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.email],
                  decoration: const InputDecoration(labelText: 'Email address'),
                  validator: (v) =>
                      RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch((v ?? '').trim()) ? null : 'Enter a valid email',
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.telephoneNumber],
                  decoration: const InputDecoration(labelText: 'Phone number', hintText: '0803 123 4567'),
                  validator: (v) =>
                      (v ?? '').replaceAll(RegExp(r'\D'), '').length < 10 ? 'Enter a valid phone number' : null,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _password,
                  obscureText: _hide,
                  autofillHints: const [AutofillHints.newPassword],
                  onFieldSubmitted: (_) => _submit(),
                  decoration: InputDecoration(
                    labelText: 'Password',
                    helperText: 'At least 8 characters',
                    suffixIcon: IconButton(
                      onPressed: () => setState(() => _hide = !_hide),
                      icon: Icon(_hide ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                      tooltip: _hide ? 'Show password' : 'Hide password',
                    ),
                  ),
                  validator: (v) => (v ?? '').length < 8 ? 'Use at least 8 characters' : null,
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 24),
        BusyButton(label: 'Get Started', onPressed: _submit),
        const OrDivider(),
        AuthSwitchLink(
          prompt: 'Already registered?',
          action: 'Login',
          onTap: () => context.pushReplacement('/landlord/login'),
        ),
      ],
    );
  }
}

class LandlordLoginScreen extends ConsumerStatefulWidget {
  const LandlordLoginScreen({super.key});

  @override
  ConsumerState<LandlordLoginScreen> createState() => _LandlordLoginScreenState();
}

class _LandlordLoginScreenState extends ConsumerState<LandlordLoginScreen> {
  final _form = GlobalKey<FormState>();
  final _id = TextEditingController();
  final _password = TextEditingController();
  bool _hide = true;

  @override
  void dispose() {
    _id.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    try {
      await ref.read(authRepositoryProvider).loginLandlord(_id.text.trim(), _password.text);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AuthCardScaffold(
      onBack: () => context.pop(),
      children: [
        const AuthHeadline('Welcome back'),
        Form(
          key: _form,
          child: AutofillGroup(
            child: Column(
              children: [
                TextFormField(
                  controller: _id,
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.email, AutofillHints.username],
                  decoration: const InputDecoration(labelText: 'Email or phone number'),
                  validator: (v) => (v ?? '').trim().length < 3 ? 'Enter your email or phone' : null,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _password,
                  obscureText: _hide,
                  autofillHints: const [AutofillHints.password],
                  onFieldSubmitted: (_) => _submit(),
                  decoration: InputDecoration(
                    labelText: 'Password',
                    suffixIcon: IconButton(
                      onPressed: () => setState(() => _hide = !_hide),
                      icon: Icon(_hide ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                      tooltip: _hide ? 'Show password' : 'Hide password',
                    ),
                  ),
                  validator: (v) => (v ?? '').isEmpty ? 'Enter your password' : null,
                ),
              ],
            ),
          ),
        ),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(onPressed: () => context.push('/password/forgot'), child: const Text('Retrieve Account')),
        ),
        const SizedBox(height: 8),
        BusyButton(label: 'Login', onPressed: _submit),
        const OrDivider(),
        AuthSwitchLink(
          prompt: 'Don’t have an account?',
          action: 'Register',
          onTap: () => context.pushReplacement('/landlord/register'),
        ),
      ],
    );
  }
}

/// SM-SEC-001: email or phone → 6-digit code by email → new password.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _password = TextEditingController();
  int _step = 0;
  String _sentTo = '';
  String? _resetToken;

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    try {
      final sent = await ref.read(authRepositoryProvider).forgotPassword(_phone.text.trim());
      if (sent.devCode != null) _code.text = sent.devCode!;
      setState(() {
        _sentTo = sent.sentTo;
        _step = 1;
      });
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _verify() async {
    try {
      _resetToken = await ref.read(authRepositoryProvider).verifyReset(_phone.text.trim(), _code.text.trim());
      setState(() => _step = 2);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _reset() async {
    if (_password.text.length < 8) {
      showError(context, ApiException('Use at least 8 characters'));
      return;
    }
    try {
      await ref.read(authRepositoryProvider).resetPassword(_resetToken!, _password.text);
      if (!mounted) return;
      showInfo(context, 'Password updated. Log in with your new password.');
      context.pop();
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AuthCardScaffold(
      onBack: () => _step == 0 ? context.pop() : setState(() => _step -= 1),
      children: switch (_step) {
        0 => [
          const AuthHeadline('Retrieve your account'),
          const Text(
            "Enter the email or phone number on your account. We'll email you a 6-digit code.",
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 18),
          TextField(
            controller: _phone,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email, AutofillHints.telephoneNumber],
            decoration: const InputDecoration(labelText: 'Email or phone number'),
          ),
          const SizedBox(height: 20),
          BusyButton(label: 'Send code', onPressed: _send),
        ],
        1 => [
          const AuthHeadline('Enter the code'),
          Text('We emailed a 6-digit code to $_sentTo. It expires in 5 minutes. Check your spam folder if you can’t see it.', textAlign: TextAlign.center),
          const SizedBox(height: 18),
          OtpField(controller: _code, onCompleted: (_) => _verify()),
          const SizedBox(height: 20),
          BusyButton(label: 'Verify', onPressed: _verify),
          TextButton(onPressed: _send, child: const Text('Resend code')),
        ],
        _ => [
          const AuthHeadline('Set a new password'),
          TextField(
            controller: _password,
            obscureText: true,
            autofillHints: const [AutofillHints.newPassword],
            decoration: const InputDecoration(labelText: 'New password', helperText: 'At least 8 characters'),
          ),
          const SizedBox(height: 20),
          BusyButton(label: 'Save password', onPressed: _reset),
        ],
      },
    );
  }
}
