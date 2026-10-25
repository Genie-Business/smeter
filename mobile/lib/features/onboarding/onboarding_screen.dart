import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/app_content.dart';
import '../../core/session.dart';
import '../../theme/smeter_theme.dart';

class _Slide {
  const _Slide(this.image, this.title, this.caption);
  final String image;
  final String title;
  final String caption;
}

const _slides = [
  _Slide('assets/images/onboard_welcome.jpg', 'Welcome to smeter.', "Your home's energy, now in your hands."),
  _Slide(
    'assets/images/onboard_bill.jpg',
    'View My Bill',
    'See what you use and what you spend, day by day, with no meter keypad needed.',
  ),
  _Slide(
    'assets/images/onboard_owners.jpg',
    'Property Owners',
    "Manage your tenant(s) electricity payments all from one screen",
  ),
  _Slide('assets/images/onboard_sources.jpg', 'All Energy Sources', 'One meter, One App to manage them all'),
  _Slide(
    'assets/images/onboard_power.jpg',
    'Manage Your Power',
    "Solar or Grid or Generator power, you'll always know exactly what's happening",
  ),
];

class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final _controller = PageController();
  int _index = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    await ref.read(sessionProvider.notifier).completeOnboarding();
    if (mounted) context.go('/welcome');
  }

  void _next() {
    if (_index == _slides.length - 1) {
      _finish();
    } else {
      _controller.nextPage(duration: const Duration(milliseconds: 380), curve: Curves.easeOutCubic);
    }
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final panelTop = size.height * 0.56;
    final last = _index == _slides.length - 1;
    // Text is editable from the admin dashboard; images stay bundled.
    final copy = appContentOf(ref).onboarding;
    String title(int i) => i < copy.length && copy[i].title.isNotEmpty ? copy[i].title : _slides[i].title;
    String caption(int i) => i < copy.length && copy[i].caption.isNotEmpty ? copy[i].caption : _slides[i].caption;

    return Scaffold(
      backgroundColor: SmeterColors.primary,
      body: Stack(
        children: [
          PageView.builder(
            controller: _controller,
            itemCount: _slides.length,
            onPageChanged: (i) => setState(() => _index = i),
            itemBuilder: (context, i) => Stack(
              children: [
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  height: panelTop + 60,
                  child: Image.asset(_slides[i].image, fit: BoxFit.cover, alignment: Alignment.topCenter),
                ),
                Positioned(
                  top: panelTop,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: ClipPath(
                    clipper: _WaveClipper(),
                    child: Container(
                      color: SmeterColors.primary.withValues(alpha: 0.93),
                      padding: const EdgeInsets.fromLTRB(28, 92, 28, 0),
                      child: Column(
                        children: [
                          Text(
                            title(i),
                            textAlign: TextAlign.center,
                            style: GoogleFonts.poppins(fontSize: 24, fontWeight: FontWeight.w700, color: Colors.white),
                          ),
                          const SizedBox(height: 14),
                          Text(
                            caption(i),
                            textAlign: TextAlign.center,
                            style: GoogleFonts.montserrat(
                              fontSize: 15,
                              color: Colors.white.withValues(alpha: 0.85),
                              height: 1.45,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          // Progress ring + next arrow sits in the wave's bump.
          Positioned(
            top: panelTop + 8,
            left: 0,
            right: 0,
            child: Center(
              child: Semantics(
                button: true,
                label: last ? 'Finish' : 'Next',
                child: GestureDetector(
                  onTap: _next,
                  child: SizedBox(
                    width: 52,
                    height: 52,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        TweenAnimationBuilder<double>(
                          tween: Tween(end: (_index + 1) / _slides.length),
                          duration: const Duration(milliseconds: 380),
                          builder: (_, v, _) => CircularProgressIndicator(
                            value: v,
                            strokeWidth: 3,
                            color: SmeterColors.green,
                            backgroundColor: Colors.white24,
                          ),
                        ),
                        Container(
                          width: 40,
                          height: 40,
                          decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                          child: const Icon(Icons.chevron_right_rounded, color: SmeterColors.navy),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          SafeArea(
            child: Align(
              alignment: Alignment.topRight,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(0, 12, 12, 0),
                child: TextButton(
                  onPressed: _finish,
                  child: Text(
                    'SKIP',
                    style: GoogleFonts.montserrat(
                      color: SmeterColors.primary,
                      fontWeight: FontWeight.w800,
                      fontSize: 14,
                    ),
                  ),
                ),
              ),
            ),
          ),
          if (last)
            Positioned(
              left: 38,
              right: 38,
              bottom: MediaQuery.paddingOf(context).bottom + 48,
              child: FilledButton(
                onPressed: _finish,
                style: FilledButton.styleFrom(
                  backgroundColor: Colors.white,
                  foregroundColor: SmeterColors.navy,
                  shape: const StadiumBorder(),
                  textStyle: GoogleFonts.montserrat(fontWeight: FontWeight.w600, fontSize: 18),
                ),
                child: const Text('Let’s Get Started'),
              ),
            ),
        ],
      ),
    );
  }
}

/// Panel top edge with a soft bump in the middle that cradles the button.
class _WaveClipper extends CustomClipper<Path> {
  @override
  Path getClip(Size size) {
    final w = size.width;
    final mid = w / 2;
    return Path()
      ..moveTo(0, 30)
      ..quadraticBezierTo(w * 0.22, 14, mid - 52, 22)
      ..cubicTo(mid - 30, 24, mid - 30, 0, mid, 0)
      ..cubicTo(mid + 30, 0, mid + 30, 26, mid + 52, 26)
      ..quadraticBezierTo(w * 0.8, 30, w, 20)
      ..lineTo(w, size.height)
      ..lineTo(0, size.height)
      ..close();
  }

  @override
  bool shouldReclip(covariant CustomClipper<Path> oldClipper) => false;
}
