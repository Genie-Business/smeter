// Central, validated configuration. Every external integration falls back to a
// mock when its credentials are missing so the whole flow runs locally.

const env = process.env;

function num(name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${raw}"`);
  return n;
}

function bool(name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

const nodeEnv = env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';

const geniHasCreds = Boolean(env.GENI_USER_ID && env.GENI_PASSWORD);
const geniMode = env.GENI_MODE ?? (geniHasCreds ? 'live' : 'mock');

const paystackHasKey = Boolean(env.PAYSTACK_SECRET_KEY);
const paymentsProvider = env.PAYMENTS_PROVIDER ?? (paystackHasKey ? 'paystack' : 'mock');

const smsProvider = env.SMS_PROVIDER ?? (env.TERMII_API_KEY ? 'termii' : 'log');

export const config = {
  nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',
  port: num('PORT', 8080),
  publicUrl: (env.PUBLIC_URL ?? `http://localhost:${num('PORT', 8080)}`).replace(/\/$/, ''),
  appScheme: env.APP_SCHEME ?? 'smeter',
  databasePath: env.DATABASE_PATH ?? './data/smeter.db',
  jwtSecret: env.JWT_SECRET || (isProduction ? '' : 'dev-only-insecure-secret-change-me'),
  corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),

  // Images uploaded from the admin dashboard; served at /uploads/<file>.
  uploadDir: env.UPLOAD_DIR || './data/uploads',
  // Optionally serve the static website and admin dashboard from this process
  // (handy locally; in production they're usually separate static hosts).
  siteDir: env.SITE_DIR || '',
  adminDir: env.ADMIN_DIR || '',
  // First admin-dashboard account, created on boot when no staff exist yet.
  bootstrapStaff: {
    email: env.ADMIN_EMAIL || '',
    password: env.ADMIN_PASSWORD || '',
    name: env.ADMIN_NAME || 'smeter admin',
  },

  geni: {
    mode: geniMode, // 'live' | 'mock'
    baseUrl: (env.GENI_BASE_URL ?? 'http://8.208.24.83:9200').replace(/\/$/, ''),
    company: env.GENI_COMPANY ?? 'Geni',
    userId: env.GENI_USER_ID ?? '',
    password: env.GENI_PASSWORD ?? '',
    // Separate "authorization password" the head-end requires to mint tokens.
    authorizationPassword: env.GENI_AUTHORIZATION_PASSWORD ?? '',
    successCodes: (env.GENI_SUCCESS_CODES ?? '0,200').split(',').map((s) => Number(s.trim())),
    timeoutMs: num('GENI_TIMEOUT_MS', 20000),
    customerType: num('GENI_CUSTOMER_TYPE', 0),
    // Remote-task protocol ids/payloads are meter-firmware specific; set them once
    // the vendor confirms the values for these meters.
    tokenTaskProtocolId: num('GENI_TOKEN_TASK_PROTOCOL_ID', 0),
    disconnectProtocolId: num('GENI_DISCONNECT_PROTOCOL_ID', 0),
    disconnectData: env.GENI_DISCONNECT_DATA ?? '0',
    reconnectProtocolId: num('GENI_RECONNECT_PROTOCOL_ID', 0),
    reconnectData: env.GENI_RECONNECT_DATA ?? '1',
    pushTokensOta: bool('GENI_PUSH_TOKENS_OTA', true),
    // Load-profile energy columns are cumulative register readings by default.
    energyMode: env.GENI_ENERGY_MODE ?? 'cumulative', // 'cumulative' | 'interval'
  },

  payments: {
    provider: paymentsProvider, // 'paystack' | 'mock'
    paystackSecretKey: env.PAYSTACK_SECRET_KEY ?? '',
    paystackBaseUrl: env.PAYSTACK_BASE_URL ?? 'https://api.paystack.co',
    channels: (env.PAYMENT_CHANNELS ?? 'card,bank_transfer,ussd').split(',').map((s) => s.trim()),
    // Paystack NG local pricing: 1.5% + ₦100 (flat waived under ₦2,500), capped at ₦2,000.
    feePercent: num('PAYMENT_FEE_PERCENT', 1.5),
    feeFlatKobo: num('PAYMENT_FEE_FLAT_NAIRA', 100) * 100,
    feeFlatThresholdKobo: num('PAYMENT_FEE_FLAT_THRESHOLD_NAIRA', 2500) * 100,
    feeCapKobo: num('PAYMENT_FEE_CAP_NAIRA', 2000) * 100,
    minPurchaseKobo: num('MIN_PURCHASE_NAIRA', 500) * 100,
    maxPurchaseKobo: num('MAX_PURCHASE_NAIRA', 500000) * 100,
    auditAfterMinutes: num('PAYMENT_AUDIT_AFTER_MINUTES', 5),
  },

  tariff: {
    // Regulatory cap on the landlord price per kWh (e.g. NERC band A ceiling).
    maxUnitPriceNaira: num('MAX_UNIT_PRICE_NAIRA', 250),
    // Base utility cost per kWh, used for the profit/markup ledger.
    baseUnitCostNaira: num('BASE_UNIT_COST_NAIRA', 209.5),
  },

  sms: {
    provider: smsProvider, // 'termii' | 'log'
    termiiApiKey: env.TERMII_API_KEY ?? '',
    termiiSenderId: env.TERMII_SENDER_ID ?? 'smeter',
    termiiBaseUrl: env.TERMII_BASE_URL ?? 'https://api.ng.termii.com',
  },

  otp: {
    ttlMinutes: num('OTP_TTL_MINUTES', 5),
    maxAttempts: num('OTP_MAX_ATTEMPTS', 5),
    // Return OTP codes in API responses. Never honoured in production.
    echo: !isProduction && bool('OTP_DEBUG_ECHO', nodeEnv !== 'production'),
  },

  liveCacheSeconds: num('LIVE_CACHE_SECONDS', 5),
};

export function assertConfig() {
  const problems = [];
  if (config.isProduction && config.jwtSecret.length < 32) {
    problems.push('JWT_SECRET must be at least 32 characters in production');
  }
  if (config.geni.mode === 'live' && !geniHasCreds) {
    problems.push('GENI_MODE=live requires GENI_USER_ID and GENI_PASSWORD');
  }
  if (config.payments.provider === 'paystack' && !paystackHasKey) {
    problems.push('PAYMENTS_PROVIDER=paystack requires PAYSTACK_SECRET_KEY');
  }
  if (config.isProduction && config.geni.mode === 'mock') {
    problems.push('Refusing to run production against the mock meter head-end (set GENI_* credentials)');
  }
  if (config.isProduction && config.payments.provider === 'mock') {
    problems.push('Refusing to run production with mock payments (set PAYSTACK_SECRET_KEY)');
  }
  if (problems.length) throw new Error('Invalid configuration:\n - ' + problems.join('\n - '));
}
