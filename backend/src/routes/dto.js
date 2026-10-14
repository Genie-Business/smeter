import { tariffNow } from '../services/settings.js';
import { koboToNaira } from '../util/http.js';
import { maskPhone } from '../util/phone.js';

export function landlordDto(l) {
  return {
    id: l.id,
    fullName: l.full_name,
    firstName: l.full_name.split(/\s+/)[0],
    email: l.email,
    phone: l.phone,
    address: l.address,
    bank: l.account_number
      ? {
          bankName: l.bank_name,
          bankCode: l.bank_code,
          accountNumber: l.account_number,
          accountName: l.account_name,
          verified: Boolean(l.bank_verified_at),
          settlementActive: Boolean(l.settlement_ref),
        }
      : null,
    unitPrice: koboToNaira(l.unit_price_kobo),
    feeBearer: l.fee_bearer,
    tariffLimits: {
      max: tariffNow().maxUnitPriceNaira,
      baseCost: tariffNow().baseUnitCostNaira,
    },
  };
}

export function meterDto(m) {
  return {
    meterId: m.meter_id,
    address: m.address,
    apartment: m.apartment,
    tenant: {
      firstName: m.tenant_first_name,
      lastName: m.tenant_last_name,
      email: m.tenant_email,
      phone: m.tenant_phone,
    },
    status: m.status,
    acceptedAt: m.accepted_at,
    debt: koboToNaira(m.debt_kobo),
    debtRecoveryPercent: m.debt_recovery_percent,
    relayState: m.relay_state,
    deliveryMode: m.delivery_mode,
    createdAt: m.created_at,
  };
}

export function tenantDto(m, landlord) {
  return {
    meterId: m.meter_id,
    address: m.address,
    apartment: m.apartment,
    firstName: m.tenant_first_name,
    lastName: m.tenant_last_name,
    email: m.tenant_email,
    phone: m.tenant_phone,
    phoneMasked: maskPhone(m.tenant_phone),
    debt: koboToNaira(m.debt_kobo),
    debtRecoveryPercent: m.debt_recovery_percent,
    relayState: m.relay_state,
    deliveryMode: m.delivery_mode,
    landlord: landlord
      ? { name: landlord.full_name, phone: landlord.phone }
      : null,
    unitPrice: landlord ? koboToNaira(landlord.unit_price_kobo) : 0,
    feeBearer: landlord?.fee_bearer ?? 'tenant',
  };
}
