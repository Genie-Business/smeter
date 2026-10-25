import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/session.dart';
import 'features/auth/landlord_auth_screens.dart';
import 'features/auth/tenant_login_screen.dart';
import 'features/auth/welcome_screens.dart';
import 'features/common/notifications_screen.dart';
import 'features/common/support_screen.dart';
import 'features/landlord/landlord_account_screens.dart';
import 'features/landlord/landlord_home_screen.dart';
import 'features/landlord/meters_screens.dart';
import 'features/onboarding/onboarding_screen.dart';
import 'features/tenant/tenant_home_screen.dart';
import 'features/tenant/tenant_profile_screen.dart';
import 'features/tenant/tenant_recent_screens.dart';
import 'features/tenant/usage_screen.dart';
import 'shared/widgets.dart';
import 'theme/smeter_theme.dart';

final _rootKey = GlobalKey<NavigatorState>();

const _publicPaths = {
  '/onboarding',
  '/welcome',
  '/account-type',
  '/landlord/login',
  '/landlord/register',
  '/password/forgot',
  '/tenant/login',
};

const _tenantNav = [
  NavItem(Icons.home_outlined, Icons.home_rounded, 'Home'),
  NavItem(Icons.insights_outlined, Icons.insights_rounded, 'Usage'),
  NavItem(Icons.vpn_key_outlined, Icons.vpn_key_rounded, 'Tokens'),
  NavItem(Icons.person_outline_rounded, Icons.person_rounded, 'Profile'),
];

const _landlordNav = [
  NavItem(Icons.home_outlined, Icons.home_rounded, 'Home'),
  NavItem(Icons.electric_meter_outlined, Icons.electric_meter_rounded, 'Meters'),
  NavItem(Icons.receipt_long_outlined, Icons.receipt_long_rounded, 'Payments'),
  NavItem(Icons.person_outline_rounded, Icons.person_rounded, 'Profile'),
];

class _Shell extends StatelessWidget {
  const _Shell({required this.shell, required this.items});

  final StatefulNavigationShell shell;
  final List<NavItem> items;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SmeterColors.bg,
      body: shell,
      bottomNavigationBar: SmeterBottomNav(
        items: items,
        index: shell.currentIndex,
        onTap: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
      ),
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: SmeterColors.primary,
    body: Center(
      child: Text('smeter', style: SmeterText.wordmark(size: 52, color: Colors.white)),
    ),
  );
}

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier(0);
  ref.listen(sessionProvider, (_, _) => refresh.value++);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    navigatorKey: _rootKey,
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) {
      final s = ref.read(sessionProvider);
      final loc = state.matchedLocation;
      if (!s.restored) return loc == '/splash' ? null : '/splash';

      if (!s.signedIn) {
        if (!s.onboarded && loc != '/onboarding') return '/onboarding';
        if (loc == '/splash' || !_publicPaths.contains(loc)) return '/welcome';
        return null;
      }

      final home = s.role == Role.tenant ? '/tenant' : '/landlord';
      if (loc == '/splash' || _publicPaths.contains(loc)) return home;
      if (s.role == Role.tenant && loc.startsWith('/landlord')) return home;
      if (s.role == Role.landlord && loc.startsWith('/tenant')) return home;
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const _Splash()),
      GoRoute(path: '/onboarding', builder: (_, _) => const OnboardingScreen()),
      GoRoute(path: '/welcome', builder: (_, _) => const WelcomeScreen()),
      GoRoute(
        path: '/account-type',
        builder: (_, state) => AccountTypeScreen(signup: state.uri.queryParameters['intent'] == 'signup'),
      ),
      GoRoute(path: '/landlord/login', builder: (_, _) => const LandlordLoginScreen()),
      GoRoute(path: '/landlord/register', builder: (_, _) => const LandlordRegisterScreen()),
      GoRoute(path: '/password/forgot', builder: (_, _) => const ForgotPasswordScreen()),
      GoRoute(path: '/tenant/login', builder: (_, _) => const TenantLoginScreen()),
      GoRoute(path: '/support', builder: (_, _) => const SupportScreen()),

      // ---- Tenant -------------------------------------------------------
      StatefulShellRoute.indexedStack(
        builder: (_, _, shell) => _Shell(shell: shell, items: _tenantNav),
        branches: [
          StatefulShellBranch(
            routes: [GoRoute(path: '/tenant', builder: (_, _) => const TenantHomeScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/tenant/usage', builder: (_, _) => const UsageScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/tenant/recent', builder: (_, _) => const TenantRecentsScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/tenant/profile', builder: (_, _) => const TenantProfileScreen())],
          ),
        ],
      ),
      GoRoute(path: '/tenant/notifications', builder: (_, _) => const NotificationsScreen()),
      GoRoute(
        path: '/tenant/purchases/:reference',
        builder: (_, state) => PurchaseDetailScreen(reference: state.pathParameters['reference']!),
      ),

      // ---- Property owner -----------------------------------------------
      StatefulShellRoute.indexedStack(
        builder: (_, _, shell) => _Shell(shell: shell, items: _landlordNav),
        branches: [
          StatefulShellBranch(
            routes: [GoRoute(path: '/landlord', builder: (_, _) => const LandlordHomeScreen())],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/landlord/meters',
                builder: (_, _) => const MetersScreen(),
                routes: [
                  GoRoute(path: 'add', parentNavigatorKey: _rootKey, builder: (_, _) => const AddMeterScreen()),
                  GoRoute(
                    path: ':meterId',
                    parentNavigatorKey: _rootKey,
                    builder: (_, state) => MeterDetailScreen(meterId: state.pathParameters['meterId']!),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/landlord/recent', builder: (_, _) => const LandlordRecentsScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/landlord/profile', builder: (_, _) => const LandlordProfileScreen())],
          ),
        ],
      ),
      GoRoute(path: '/landlord/notifications', builder: (_, _) => const NotificationsScreen()),
      GoRoute(path: '/landlord/unit-price', builder: (_, _) => const SetUnitPriceScreen()),
      GoRoute(path: '/landlord/payout', builder: (_, _) => const PayoutAccountScreen()),
      GoRoute(path: '/landlord/profile/edit', builder: (_, _) => const EditLandlordProfileScreen()),
      GoRoute(path: '/landlord/ledger', builder: (_, _) => const LedgerScreen()),
    ],
  );
});
