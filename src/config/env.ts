import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ quiet: true });

/**
 * The only reader of process.env in app code. Parsed once at import; the
 * process refuses to boot with an invalid config.
 *
 * Adding a variable: add it here with a comment and to .env.example.
 */

/** Treat "" as unset so blank lines in .env behave like missing vars. */
const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = () =>
  z.preprocess(emptyToUndefined, z.string().optional());

const stringWithDefault = (defaultValue: string) =>
  z.preprocess(emptyToUndefined, z.string().default(defaultValue));

export const intWithDefault = (
  defaultValue: number,
  min: number,
  max: number,
) =>
  z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(min).max(max).default(defaultValue),
  );

const numberWithDefault = (defaultValue: number, min: number, max: number) =>
  z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(min).max(max).default(defaultValue),
  );

const booleanWithDefault = (defaultValue: boolean) =>
  z.preprocess(
    emptyToUndefined,
    z
      .enum(['true', 'false', '1', '0'])
      .transform((value) => value === 'true' || value === '1')
      .default(defaultValue),
  );

export const envSchema = z.object({
  // development | staging | production. Controls Swagger protection, query logging and demo tools.
  ENVIRONMENT: z.preprocess(
    emptyToUndefined,
    z.enum(['development', 'staging', 'production']).default('development'),
  ),
  PORT: intWithDefault(4100, 1, 65535),
  // Origin of the web app, for CORS and PayPal return URLs.
  WEB_ORIGIN: stringWithDefault('http://localhost:3100'),

  // Runtime Postgres connection (pg Pool via @prisma/adapter-pg).
  DATABASE_URL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'Must be a postgres:// connection URL.'),
  ),
  DIRECT_URL: optionalString(),

  // Basic auth for /docs when ENVIRONMENT=production.
  SWAGGER_USERNAME: stringWithDefault('admin'),
  SWAGGER_PASSWORD: optionalString(),

  // ─── Auth ───
  // HMAC secret for session JWTs (required, at least 32 chars).
  JWT_SECRET: z.preprocess(
    emptyToUndefined,
    z.string().min(32, 'Must be at least 32 characters.'),
  ),
  JWT_TTL_SECONDS: intWithDefault(604800, 300, 2592000),
  JWT_ISSUER: stringWithDefault('enrichmint-api'),
  JWT_AUDIENCE: stringWithDefault('enrichmint-frontend'),
  SIGNUP_ENABLED: booleanWithDefault(true),

  // ─── Rate limiting (per client IP) ───
  RATE_LIMIT_ENABLED: booleanWithDefault(true),
  RATE_LIMIT_PER_MINUTE: intWithDefault(300, 10, 100000),
  AUTH_RATE_LIMIT_PER_MINUTE: intWithDefault(10, 1, 1000),
  // Requests per minute that start model work (interview, recommendations, assistant).
  MODEL_RATE_LIMIT_PER_MINUTE: intWithDefault(20, 1, 1000),
  TRUST_PROXY_HOPS: intWithDefault(1, 0, 5),

  // ─── Marketplace economics ───
  // Platform commission in basis points (1500 = 15%). Snapshotted onto every order.
  COMMISSION_BPS: intWithDefault(1500, 0, 5000),
  // Share of each guide sale paid to field note authors, out of the platform commission (500 = 5%).
  ENRICHMENT_SHARE_BPS: intWithDefault(500, 0, 1000),
  // Lowest guide or response price a contributor may set, in cents.
  MIN_PRICE_CENTS: intWithDefault(500, 100, 100000),
  MAX_PRICE_CENTS: intWithDefault(50000, 100, 1000000),
  // Grounded assistant questions included with one guide purchase, and for how many days.
  AI_QUESTIONS_PER_PURCHASE: intWithDefault(10, 0, 100),
  AI_ACCESS_DAYS: intWithDefault(30, 1, 365),
  // Hours a contributor's earnings are held before they can be paid out (refund window). 0 for demos.
  PAYOUT_HOLD_HOURS: intWithDefault(0, 0, 2160),
  // Hours a learner has to pay after a contributor accepts a request.
  REQUEST_PAY_WINDOW_H: intWithDefault(24, 1, 336),

  // ─── PayPal (server only) ───
  // sandbox | live. The hackathon build is sandbox only.
  PAYPAL_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(['sandbox', 'live']).default('sandbox'),
  ),
  // REST app credentials. Optional at boot; checkout answers 503 payments_not_configured until set.
  PAYPAL_CLIENT_ID: optionalString(),
  PAYPAL_CLIENT_SECRET: optionalString(),
  // Webhook id from the developer dashboard, used to verify webhook signatures.
  PAYPAL_WEBHOOK_ID: optionalString(),
  PAYPAL_TIMEOUT_MS: intWithDefault(20000, 1000, 120000),
  // Every 5 minutes, re-check orders and payouts stuck mid-flow with PayPal.
  RECONCILE_ENABLED: booleanWithDefault(true),

  // ─── Models (OpenAI, server only) ───
  OPENAI_API_KEY: optionalString(),
  // Model for drafting guides and grounded answers.
  OPENAI_MODEL_GENERATE: stringWithDefault('gpt-5'),
  // Smaller model for clarifying questions and ranking explanations.
  OPENAI_MODEL_FAST: stringWithDefault('gpt-5-mini'),
  OPENAI_TIMEOUT_MS: intWithDefault(60000, 1000, 600000),
  OPENAI_MAX_RETRIES: intWithDefault(2, 0, 5),
  // USD per 1M tokens, used to cost each ModelCall. Keep in sync with the models above.
  OPENAI_PRICE_GENERATE_INPUT_PER_MTOK: numberWithDefault(1.25, 0, 1000),
  OPENAI_PRICE_GENERATE_OUTPUT_PER_MTOK: numberWithDefault(10, 0, 1000),
  OPENAI_PRICE_FAST_INPUT_PER_MTOK: numberWithDefault(0.25, 0, 1000),
  OPENAI_PRICE_FAST_OUTPUT_PER_MTOK: numberWithDefault(2, 0, 1000),
  // Hard daily spend cap across all model calls, in USD (UTC day).
  AI_DAILY_BUDGET_USD: numberWithDefault(10, 0, 10000),

  // ─── HCAI (optional external policy layer) ───
  // Off by default: local policy rules always run and are enough to run the product.
  HCAI_ENABLED: booleanWithDefault(false),
  HCAI_BASE_URL: optionalString(),
  HCAI_API_KEY: optionalString(),
  HCAI_TIMEOUT_MS: intWithDefault(3000, 500, 30000),

  // ─── Zapier (optional outbound events) ───
  // A Zapier "Catch Hook" URL. When set, marketplace events (ids, amounts, states; never emails or content) are posted to it.
  ZAPIER_WEBHOOK_URL: optionalString(),
  ZAPIER_TIMEOUT_MS: intWithDefault(3000, 500, 30000),

  // ─── Jobs ───
  // Request expiry, overdue and reconciliation ticks (default true; specs turn it off).
  JOBS_ENABLED: booleanWithDefault(true),

  // ─── Seed (yarn seed:demo only) ───
  // Password for every seeded demo account (admin, Maria, Alex, ...). Never logged.
  SEED_DEMO_PASSWORD: optionalString(),
  // Admin email for the seeded admin account.
  SEED_ADMIN_EMAIL: stringWithDefault('admin@enrichmint.demo'),
  // Maria's PayPal sandbox personal-account email, so the payout demo has a receiver.
  SEED_MARIA_PAYOUT_EMAIL: optionalString(),

  // ─── Demo tools ───
  // Admin-only "advance clock" on demo requests. Always off in production.
  DEMO_TOOLS_ENABLED: booleanWithDefault(true),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);

export const isProduction = env.ENVIRONMENT === 'production';
