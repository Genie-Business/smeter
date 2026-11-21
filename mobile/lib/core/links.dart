import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// Public pages on smeter.app the app links to (also given to the app stores).
abstract final class SmeterLinks {
  static const privacy = 'https://www.smeter.app/privacy';
  static const terms = 'https://www.smeter.app/terms';
  static const deleteAccount = 'https://www.smeter.app/delete-account';
}

/// Open a web page in the browser; shows a message if no browser can open it.
Future<void> openLink(BuildContext context, String url) async {
  final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  if (!ok && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Couldn’t open $url')));
  }
}
