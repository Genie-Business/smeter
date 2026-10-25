import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'env.dart';
import 'session.dart';

/// A failed API call with a message that is safe to show to the user.
class ApiException implements Exception {
  ApiException(this.message, {this.status, this.code, this.fields});

  final String message;
  final int? status;
  final String? code;
  final Map<String, dynamic>? fields;

  @override
  String toString() => message;
}

class ApiClient {
  ApiClient(this._readToken, {this.onUnauthorized})
    : _dio = Dio(
        BaseOptions(
          baseUrl: Env.apiBaseUrl,
          connectTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(seconds: 45),
          contentType: 'application/json',
        ),
      );

  final Dio _dio;
  final String? Function() _readToken;
  final void Function()? onUnauthorized;

  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) =>
      _send(() => _dio.get(path, queryParameters: query, options: _opts()));

  Future<Map<String, dynamic>> post(String path, [Object? body]) =>
      _send(() => _dio.post(path, data: body ?? {}, options: _opts()));

  Future<Map<String, dynamic>> put(String path, [Object? body]) =>
      _send(() => _dio.put(path, data: body ?? {}, options: _opts()));

  Future<Map<String, dynamic>> patch(String path, [Object? body]) =>
      _send(() => _dio.patch(path, data: body ?? {}, options: _opts()));

  Future<Map<String, dynamic>> delete(String path) => _send(() => _dio.delete(path, options: _opts()));

  Options _opts() {
    final token = _readToken();
    return Options(headers: {if (token != null) 'Authorization': 'Bearer $token'});
  }

  Future<Map<String, dynamic>> _send(Future<Response<dynamic>> Function() call) async {
    try {
      final res = await call();
      final data = res.data;
      return data is Map<String, dynamic> ? data : <String, dynamic>{'data': data};
    } on DioException catch (e) {
      final res = e.response;
      if (res == null) {
        throw ApiException(
          e.type == DioExceptionType.connectionTimeout || e.type == DioExceptionType.receiveTimeout
              ? 'The server took too long to respond. Check your connection and try again.'
              : "Can't reach smeter right now. Check your internet connection.",
        );
      }
      final body = res.data;
      final error = body is Map ? body['error'] : null;
      if (res.statusCode == 401 && _readToken() != null) onUnauthorized?.call();
      throw ApiException(
        error is Map && error['message'] is String
            ? error['message'] as String
            : 'Something went wrong (${res.statusCode}).',
        status: res.statusCode,
        code: error is Map ? error['code'] as String? : null,
        fields: error is Map && error['details'] is Map ? Map<String, dynamic>.from(error['details'] as Map) : null,
      );
    }
  }
}

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    () => ref.read(sessionProvider).token,
    onUnauthorized: () => ref.read(sessionProvider.notifier).signOut(),
  );
});
