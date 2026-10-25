import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Colour tokens. Brand purple and accents come from the smeter Figma file;
/// neutrals are purple-tinted so greys don't look muddy next to the brand.
class SmeterColors {
  // Brand
  static const primary = Color(0xFF9D10A9);
  static const primaryDeep = Color(0xFF6A0A73);
  static const primaryInk = Color(0xFF4B0752);
  static const primarySoft = Color(0xFFF1E1F4); // pills, selected states
  static const primaryTint = Color(0xFFFAF4FB); // subtle fills

  // Neutrals
  static const bg = Color(0xFFF6F4F8);
  static const surface = Colors.white;
  static const line = Color(0xFFE9E4EE);
  static const ink = Color(0xFF1C1726);
  static const inkSoft = Color(0xFF4A4458);
  static const muted = Color(0xFF6B6579); // ≥4.5:1 on white

  // Semantic
  static const success = Color(0xFF15834F);
  static const successSoft = Color(0xFFE3F4EB);
  static const warn = Color(0xFFA76200);
  static const warnSoft = Color(0xFFFFF2DC);
  static const danger = Color(0xFFC8372D);
  static const dangerSoft = Color(0xFFFDECEA);
  static const info = Color(0xFF0F5E9C);
  static const infoSoft = Color(0xFFE6F0FA);

  // Figma accents
  static const green = Color(0xFF5BBE7E);
  static const greenSoft = Color(0xFFDDF3E5);
  static const navy = Color(0xFF0F3D63);
  static const navySoft = Color(0xFF104B6F);
  static const salmon = Color(0xFFFFAEA5);
  static const peach = Color(0xFFF6D3A0);
  static const surfaceAlt = Color(0xFFF5F6F7);

  static const heroGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFFB21CBE), primary, primaryDeep],
    stops: [0, 0.45, 1],
  );
}

/// Spacing and radius scales. Use these instead of ad-hoc numbers.
class Space {
  static const xs = 4.0, sm = 8.0, md = 12.0, lg = 16.0, xl = 20.0, xxl = 24.0, xxxl = 32.0;
}

class Radii {
  static const sm = 10.0, md = 14.0, lg = 20.0, xl = 28.0;
}

/// Type scale: Poppins for headings and figures, DM Sans for everything else.
class SmeterText {
  static TextStyle _p(double size, FontWeight w, {Color color = SmeterColors.ink, double? height, double? ls}) =>
      GoogleFonts.poppins(fontSize: size, fontWeight: w, color: color, height: height, letterSpacing: ls);
  static TextStyle _d(double size, FontWeight w, {Color color = SmeterColors.ink, double? height}) =>
      GoogleFonts.dmSans(fontSize: size, fontWeight: w, color: color, height: height);

  static TextStyle display({Color color = SmeterColors.ink}) => _p(34, FontWeight.w700, color: color, height: 1.1, ls: -0.5);
  static TextStyle title1({Color color = SmeterColors.ink}) => _p(24, FontWeight.w600, color: color, height: 1.2);
  static TextStyle title2({Color color = SmeterColors.ink}) => _p(19, FontWeight.w600, color: color, height: 1.25);
  static TextStyle title3({Color color = SmeterColors.ink}) => _p(16, FontWeight.w600, color: color, height: 1.3);
  static TextStyle body({Color color = SmeterColors.ink}) => _d(15, FontWeight.w400, color: color, height: 1.5);
  static TextStyle bodyStrong({Color color = SmeterColors.ink}) => _d(15, FontWeight.w600, color: color, height: 1.4);
  static TextStyle small({Color color = SmeterColors.muted}) => _d(13.5, FontWeight.w400, color: color, height: 1.45);
  static TextStyle caption({Color color = SmeterColors.muted}) => _d(12, FontWeight.w500, color: color, height: 1.35);
  static TextStyle overline({Color color = SmeterColors.muted}) =>
      GoogleFonts.dmSans(fontSize: 11.5, fontWeight: FontWeight.w700, color: color, letterSpacing: 0.8);
  static TextStyle figure(double size, {Color color = SmeterColors.ink, FontWeight w = FontWeight.w700}) =>
      _p(size, w, color: color, height: 1.1, ls: -0.3);
  static TextStyle token(double size, {Color color = SmeterColors.ink}) =>
      GoogleFonts.jetBrainsMono(fontSize: size, fontWeight: FontWeight.w700, color: color, letterSpacing: 0.5);

  // Kept for the auth/onboarding screens that mirror the Figma closely.
  static TextStyle sectionLabel() => _d(13, FontWeight.w700, color: SmeterColors.primary);
  static TextStyle onPurpleTitle() => _p(24, FontWeight.w600, color: Colors.white);
  static TextStyle wordmark({double size = 44, Color color = SmeterColors.primary}) =>
      GoogleFonts.inter(fontSize: size, fontWeight: FontWeight.w400, color: color, letterSpacing: -0.5);
}

class SmeterTheme {
  static ThemeData light() {
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: SmeterColors.primary,
        primary: SmeterColors.primary,
        secondary: SmeterColors.success,
        surface: SmeterColors.surface,
        error: SmeterColors.danger,
      ),
      scaffoldBackgroundColor: SmeterColors.bg,
      splashFactory: InkSparkle.splashFactory,
    );
    // Apply the family directly: google_fonts' *TextTheme helpers use the
    // split-out material_ui TextTheme, which isn't Flutter's.
    final text = base.textTheme.apply(
      fontFamily: GoogleFonts.dmSans().fontFamily,
      bodyColor: SmeterColors.ink,
      displayColor: SmeterColors.ink,
    );
    final buttonShape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.md));
    final buttonText = GoogleFonts.dmSans(fontSize: 16, fontWeight: FontWeight.w700);
    OutlineInputBorder border(Color c, [double w = 1.2]) =>
        OutlineInputBorder(borderRadius: BorderRadius.circular(Radii.md), borderSide: BorderSide(color: c, width: w));

    return base.copyWith(
      textTheme: text,
      appBarTheme: AppBarTheme(
        backgroundColor: SmeterColors.bg,
        foregroundColor: SmeterColors.ink,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0.5,
        centerTitle: false,
        titleTextStyle: SmeterText.title2(),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: SmeterColors.primary,
          foregroundColor: Colors.white,
          disabledBackgroundColor: SmeterColors.line,
          disabledForegroundColor: SmeterColors.muted,
          minimumSize: const Size(64, 54),
          shape: buttonShape,
          textStyle: buttonText,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: SmeterColors.primary,
          minimumSize: const Size(64, 50),
          side: const BorderSide(color: SmeterColors.line, width: 1.4),
          shape: buttonShape,
          textStyle: buttonText.copyWith(fontSize: 15),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: SmeterColors.primary,
          minimumSize: const Size(44, 44),
          textStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w700, fontSize: 14.5),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: SmeterColors.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 17),
        labelStyle: GoogleFonts.dmSans(color: SmeterColors.muted, fontSize: 15),
        floatingLabelStyle: GoogleFonts.dmSans(color: SmeterColors.primary, fontWeight: FontWeight.w600),
        helperStyle: SmeterText.caption(),
        hintStyle: GoogleFonts.dmSans(color: SmeterColors.muted.withValues(alpha: 0.7)),
        border: border(SmeterColors.line),
        enabledBorder: border(SmeterColors.line),
        focusedBorder: border(SmeterColors.primary, 1.8),
        errorBorder: border(SmeterColors.danger),
        focusedErrorBorder: border(SmeterColors.danger, 1.8),
      ),
      chipTheme: base.chipTheme.copyWith(
        backgroundColor: SmeterColors.surface,
        side: const BorderSide(color: SmeterColors.line),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.sm)),
        labelStyle: GoogleFonts.dmSans(fontWeight: FontWeight.w600, color: SmeterColors.ink),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? Colors.white : null),
        trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? SmeterColors.primary : null),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: SmeterColors.surface,
        surfaceTintColor: Colors.transparent,
        showDragHandle: true,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(Radii.xl))),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: SmeterColors.surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.lg)),
        titleTextStyle: SmeterText.title2(),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: SmeterColors.ink,
        contentTextStyle: GoogleFonts.dmSans(color: Colors.white, fontSize: 14.5),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.md)),
      ),
      dividerTheme: const DividerThemeData(color: SmeterColors.line, thickness: 1, space: 1),
      listTileTheme: ListTileThemeData(
        iconColor: SmeterColors.inkSoft,
        titleTextStyle: SmeterText.bodyStrong(),
        subtitleTextStyle: SmeterText.small(),
        minVerticalPadding: 12,
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(color: SmeterColors.primary),
      // Android gets predictive-back transitions; iOS keeps its native default.
      pageTransitionsTheme: PageTransitionsTheme(
        builders: {
          ...const PageTransitionsTheme().builders,
          TargetPlatform.android: const PredictiveBackPageTransitionsBuilder(),
        },
      ),
    );
  }
}
