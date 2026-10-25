// Plain data classes mirroring the API's JSON.

double? _d(Object? v) => v == null ? null : (v as num).toDouble();

class Purchase {
  Purchase.fromJson(Map<String, dynamic> j)
    : reference = j['reference'] as String,
      meterId = j['meterId'] as String,
      status = j['status'] as String,
      kind = j['kind'] as String? ?? 'units',
      initiatedBy = j['initiatedBy'] as String? ?? 'tenant',
      amount = _d(j['amount']) ?? 0,
      debtRecovered = _d(j['debtRecovered']) ?? 0,
      energyAmount = _d(j['energyAmount']) ?? 0,
      fee = _d(j['fee']) ?? 0,
      feeBearer = j['feeBearer'] as String? ?? 'tenant',
      serviceCharge = _d(j['serviceCharge']) ?? 0,
      serviceDays = _d(j['serviceDays']) ?? 0,
      total = _d(j['total']) ?? 0,
      unitPrice = _d(j['unitPrice']) ?? 0,
      units = _d(j['units']),
      token = j['token'] as String?,
      delivery = j['delivery'] as String?,
      receiptId = j['receiptId'] as String?,
      failureReason = j['failureReason'] as String?,
      createdAt = j['createdAt'] as String?,
      vendedAt = j['vendedAt'] as String?,
      landlordNet = _d(j['landlordNet']),
      ownerServiceCharge = _d(j['ownerServiceCharge']) ?? 0,
      markup = _d(j['markup']);

  final String reference;
  final String meterId;
  final String status;

  /// 'units' (a power purchase) or 'service' (the GPRS service charge on its own).
  final String kind;
  final String initiatedBy;
  final double amount;
  final double debtRecovered;
  final double energyAmount;
  final double fee;
  final String feeBearer;

  /// GPRS service charge the buyer paid in this payment.
  final double serviceCharge;

  /// Days of service paid ahead (per-purchase charging).
  final double serviceDays;
  final double total;
  final double unitPrice;
  final double? units;
  final String? token;
  final String? delivery;
  final String? receiptId;
  final String? failureReason;
  final String? createdAt;
  final String? vendedAt;
  final double? landlordNet;

  /// Service charge taken from the owner's share (owner's view).
  final double ownerServiceCharge;
  final double? markup;

  bool get isService => kind == 'service';
  bool get isFinal => status == 'vended' || status == 'failed' || status == 'abandoned';
}

class Quote {
  Quote.fromJson(Map<String, dynamic> j)
    : amount = _d(j['amount'])!,
      debtRecovered = _d(j['debtRecovered']) ?? 0,
      energyAmount = _d(j['energyAmount'])!,
      units = _d(j['units'])!,
      fee = _d(j['fee'])!,
      feeBearer = j['feeBearer'] as String,
      serviceCharge = _d(j['serviceCharge']) ?? 0,
      serviceDays = _d(j['serviceDays']) ?? 0,
      total = _d(j['total'])!;

  final double amount;
  final double debtRecovered;
  final double energyAmount;
  final double units;
  final double fee;
  final String feeBearer;
  final double serviceCharge;
  final double serviceDays;
  final double total;
}

/// GPRS service charge that keeps an automatic-delivery meter online.
class MeterService {
  MeterService.fromJson(Map<String, dynamic> j)
    : gprs = j['gprs'] as bool? ?? false,
      payer = j['payer'] as String? ?? 'owner',
      monthlyFee = _d(j['monthlyFee']) ?? 0,
      due = _d(j['due']) ?? 0,
      ownerDue = _d(j['ownerDue']) ?? 0,
      billedUntil = j['billedUntil'] as String?;

  static MeterService? from(Object? j) => j == null ? null : MeterService.fromJson(Map<String, dynamic>.from(j as Map));

  final bool gprs;

  /// owner | tenant_monthly | tenant_per_purchase
  final String payer;
  final double monthlyFee;

  /// The tenant's unpaid service charge.
  final double due;

  /// The owner's unpaid service charge (owner's view only).
  final double ownerDue;
  final String? billedUntil;
}

class TenantProfile {
  TenantProfile.fromJson(Map<String, dynamic> j)
    : meterId = j['meterId'] as String,
      address = j['address'] as String? ?? '',
      apartment = j['apartment'] as String? ?? '',
      firstName = j['firstName'] as String?,
      lastName = j['lastName'] as String?,
      email = j['email'] as String?,
      phone = j['phone'] as String? ?? '',
      debt = _d(j['debt']) ?? 0,
      debtRecoveryPercent = _d(j['debtRecoveryPercent']) ?? 0,
      relayState = j['relayState'] as String? ?? 'connected',
      landlordName = (j['landlord'] as Map?)?['name'] as String?,
      landlordPhone = (j['landlord'] as Map?)?['phone'] as String?,
      unitPrice = _d(j['unitPrice']) ?? 0,
      feeBearer = j['feeBearer'] as String? ?? 'tenant',
      deliveryMode = j['deliveryMode'] as String? ?? 'ota',
      service = MeterService.from(j['service']);

  final String meterId;
  final String address;
  final String apartment;
  final String? firstName;
  final String? lastName;
  final String? email;
  final String phone;
  final double debt;
  final double debtRecoveryPercent;
  final String relayState;
  final String? landlordName;
  final String? landlordPhone;
  final double unitPrice;
  final String feeBearer;

  /// 'ota' (tokens pushed over GPRS) or 'manual' (keyed into the meter remote).
  final String deliveryMode;
  final MeterService? service;

  bool get isManual => deliveryMode == 'manual';
  String get displayName => (firstName?.isNotEmpty ?? false) ? firstName! : 'there';
  String get fullName => [firstName, lastName].where((s) => s != null && s.isNotEmpty).join(' ');
}

class BankAccount {
  BankAccount.fromJson(Map<String, dynamic> j)
    : bankName = j['bankName'] as String? ?? '',
      bankCode = j['bankCode'] as String? ?? '',
      accountNumber = j['accountNumber'] as String? ?? '',
      accountName = j['accountName'] as String? ?? '',
      verified = j['verified'] as bool? ?? false,
      settlementActive = j['settlementActive'] as bool? ?? false;

  final String bankName;
  final String bankCode;
  final String accountNumber;
  final String accountName;
  final bool verified;
  final bool settlementActive;
}

class Landlord {
  Landlord.fromJson(Map<String, dynamic> j)
    : id = j['id'] as int,
      fullName = j['fullName'] as String,
      firstName = j['firstName'] as String? ?? '',
      email = j['email'] as String,
      phone = j['phone'] as String,
      address = j['address'] as String?,
      bank = j['bank'] == null ? null : BankAccount.fromJson(Map<String, dynamic>.from(j['bank'] as Map)),
      unitPrice = _d(j['unitPrice']) ?? 0,
      feeBearer = j['feeBearer'] as String? ?? 'tenant',
      maxUnitPrice = _d((j['tariffLimits'] as Map?)?['max']) ?? 0,
      baseCost = _d((j['tariffLimits'] as Map?)?['baseCost']) ?? 0,
      gprsFeeSinglePhase = _d((j['tariffLimits'] as Map?)?['gprsFeeSinglePhase']) ?? 0,
      gprsFeeThreePhase = _d((j['tariffLimits'] as Map?)?['gprsFeeThreePhase']) ?? 0,
      payoutSchedule = j['payoutSchedule'] as String? ?? 'daily';

  final int id;
  final String fullName;
  final String firstName;
  final String email;
  final String phone;
  final String? address;
  final BankAccount? bank;
  final double unitPrice;
  final String feeBearer;
  final double maxUnitPrice;
  final double baseCost;

  /// Monthly GPRS service charge per automatic-delivery meter.
  final double gprsFeeSinglePhase;
  final double gprsFeeThreePhase;

  /// How often earnings are paid out: daily | weekly | monthly.
  final String payoutSchedule;
}

class Meter {
  Meter.fromJson(Map<String, dynamic> j)
    : meterId = j['meterId'] as String,
      address = j['address'] as String? ?? '',
      apartment = j['apartment'] as String? ?? '',
      tenantFirstName = (j['tenant'] as Map?)?['firstName'] as String?,
      tenantLastName = (j['tenant'] as Map?)?['lastName'] as String?,
      tenantPhone = (j['tenant'] as Map?)?['phone'] as String? ?? '',
      tenantEmail = (j['tenant'] as Map?)?['email'] as String? ?? '',
      status = j['status'] as String,
      debt = _d(j['debt']) ?? 0,
      debtRecoveryPercent = _d(j['debtRecoveryPercent']) ?? 0,
      relayState = j['relayState'] as String? ?? 'connected',
      deliveryMode = j['deliveryMode'] as String? ?? 'ota',
      service = MeterService.from(j['service']);

  final String meterId;
  final String address;
  final String apartment;
  final String? tenantFirstName;
  final String? tenantLastName;
  final String tenantPhone;

  /// Where the tenant's login codes go. Empty on meters added before email codes.
  final String tenantEmail;
  final String status;
  final double debt;
  final double debtRecoveryPercent;
  final String relayState;
  final String deliveryMode;
  final MeterService? service;

  bool get isManual => deliveryMode == 'manual';
  bool get isOff => relayState.startsWith('disconnect');

  String get tenantName {
    final n = [tenantFirstName, tenantLastName].where((s) => s != null && s.isNotEmpty).join(' ');
    return n.isEmpty ? 'Tenant' : n;
  }

  String get label => apartment.isEmpty ? meterId : 'Apt $apartment · $meterId';
}

class LiveReading {
  LiveReading.fromJson(Map<String, dynamic> j)
    : mode = j['mode'] as String? ?? 'ota',
      online = j['online'] as bool? ?? false,
      lastSeen = j['lastSeen'] as String?,
      readingAt = j['readingAt'] as String?,
      volts = _d(j['volts']),
      amps = _d(j['amps']),
      kw = _d(j['kw']),
      relayState = j['relayState'] as String? ?? 'connected';

  final String mode;
  final bool online;
  final String? lastSeen;
  final String? readingAt;
  final double? volts;
  final double? amps;
  final double? kw;
  final String relayState;
}

class UsagePoint {
  UsagePoint(this.label, this.kwh);
  final String label;

  /// Null for periods that haven't started yet.
  final double? kwh;
}

class UsageReport {
  UsageReport.fromJson(Map<String, dynamic> j)
    : period = j['period'] as String,
      source = j['source'] as String? ?? 'meter',
      purchasesCount = j['purchasesCount'] as int? ?? 0,
      label = j['label'] as String,
      points = (j['points'] as List)
          .map((p) => UsagePoint(p['label'] as String, (p['kwh'] as num?)?.toDouble()))
          .toList(),
      totalKwh = _d(j['totalKwh']) ?? 0,
      avgUsageKwh = _d(j['avgUsageKwh']) ?? 0,
      avgUsageChangePct = _d(j['avgUsageChangePct']),
      avgCost = _d(j['avgCost']) ?? 0,
      avgCostChangePct = _d(j['avgCostChangePct']),
      previousTotalKwh = _d(j['previousTotalKwh']) ?? 0,
      projectedNextKwh = _d(j['projectedNextKwh']) ?? 0,
      note = j['note'] as String? ?? '';

  final String period;

  /// 'meter' (consumption readings) or 'purchases' (manual-token meters).
  final String source;
  final int purchasesCount;
  final String label;
  final List<UsagePoint> points;

  bool get fromPurchases => source == 'purchases';
  final double totalKwh;
  final double avgUsageKwh;
  final double? avgUsageChangePct;
  final double avgCost;
  final double? avgCostChangePct;
  final double previousTotalKwh;
  final double projectedNextKwh;
  final String note;
}

class AppNotification {
  AppNotification.fromJson(Map<String, dynamic> j)
    : id = '${j['id']}',
      kind = j['kind'] as String? ?? '',
      title = j['title'] as String? ?? '',
      body = j['body'] as String? ?? '',
      read = j['read'] as bool? ?? true,
      createdAt = j['createdAt'] as String?;

  final String id;
  final String kind;
  final String title;
  final String body;
  final bool read;
  final String? createdAt;
}

class SupportTicket {
  SupportTicket.fromJson(Map<String, dynamic> j)
    : ticketRef = j['ticketRef'] as String,
      meterId = j['meterId'] as String,
      category = j['category'] as String,
      department = j['department'] as String,
      description = j['description'] as String? ?? '',
      status = j['status'] as String,
      createdAt = j['createdAt'] as String?;

  final String ticketRef;
  final String meterId;
  final String category;
  final String department;
  final String description;
  final String status;
  final String? createdAt;
}

/// Result of starting checkout.
class Checkout {
  Checkout.fromJson(Map<String, dynamic> j)
    : reference = j['reference'] as String,
      authorizationUrl = j['authorizationUrl'] as String,
      quote = j['quote'] == null ? null : Quote.fromJson(Map<String, dynamic>.from(j['quote'] as Map));

  final String reference;
  final String authorizationUrl;

  /// Null for a service-charge payment.
  final Quote? quote;
}
