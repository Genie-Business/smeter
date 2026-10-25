import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'router.dart';
import 'theme/smeter_theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  runApp(const ProviderScope(child: SmeterApp()));
}

class SmeterApp extends ConsumerWidget {
  const SmeterApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: MaterialApp.router(
        title: 'smeter',
        debugShowCheckedModeBanner: false,
        theme: SmeterTheme.light(),
        routerConfig: ref.watch(routerProvider),
      ),
    );
  }
}
