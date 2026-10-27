// Jest setupFiles: runs before any module imports src/config/env.
// Always the disposable test database, even if a dev DATABASE_URL is exported:
// e2e specs truncate every table.
process.env.ENVIRONMENT = 'development';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://enrichmint:enrichmint@localhost:5435/enrichmint_test';
process.env.DIRECT_URL = '';
process.env.JWT_SECRET ??= 'test-only-jwt-secret-0123456789abcdef-0123';
// Model and PayPal calls are always faked in specs; never use real keys.
process.env.OPENAI_API_KEY = '';
process.env.PAYPAL_CLIENT_ID = 'test-client';
process.env.PAYPAL_CLIENT_SECRET = 'test-secret';
process.env.PAYPAL_WEBHOOK_ID = 'test-webhook';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.JOBS_ENABLED = 'false';
process.env.HCAI_ENABLED = 'false';
process.env.PAYOUT_HOLD_HOURS = '0';
process.env.COMMISSION_BPS = '1500';
